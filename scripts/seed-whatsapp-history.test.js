const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  embedBatch,
  buildImportCandidates,
  pointExists,
  pointsExist,
  resolveEmbeddingKey,
  withRetry,
} = require("./seed-whatsapp-history");
const { createTextHash } = require("../message-utils");

test("resolveEmbeddingKey reads direct environment key first", () => {
  const key = resolveEmbeddingKey({
    env: {
      EMBEDDING_API_KEY: "direct-key",
      EMBEDDING_API_KEY_FILE: "unused",
    },
  });

  assert.equal(key, "direct-key");
});

test("resolveEmbeddingKey reads key from file when env key is absent", () => {
  const keyPath = path.join(os.tmpdir(), `embedding-key-${process.pid}.txt`);
  fs.writeFileSync(keyPath, " file-key \n", "utf8");

  try {
    const key = resolveEmbeddingKey({
      env: {
        EMBEDDING_API_KEY_FILE: keyPath,
      },
    });

    assert.equal(key, "file-key");
  } finally {
    fs.unlinkSync(keyPath);
  }
});

test("pointExists checks Qdrant by deterministic point id", async () => {
  const calls = [];
  const axios = {
    post: async (url, body) => {
      calls.push({ url, body });
      return { data: { result: [{ id: "point-1" }] } };
    },
  };

  const exists = await pointExists({
    axios,
    qdrantUrl: "http://qdrant",
    pointId: "point-1",
  });

  assert.equal(exists, true);
  assert.equal(calls[0].url, "http://qdrant/collections/whatsapp_memory/points");
  assert.deepEqual(calls[0].body.ids, ["point-1"]);
});

test("pointsExist returns ids found in Qdrant", async () => {
  const calls = [];
  const axios = {
    post: async (url, body) => {
      calls.push({ url, body });
      return { data: { result: [{ id: "point-1" }, { id: "point-3" }] } };
    },
  };

  const existing = await pointsExist({
    axios,
    qdrantUrl: "http://qdrant",
    pointIds: ["point-1", "point-2", "point-3"],
  });

  assert.deepEqual(Array.from(existing).sort(), ["point-1", "point-3"]);
  assert.deepEqual(calls[0].body.ids, ["point-1", "point-2", "point-3"]);
});

test("embedBatch sends multiple texts and returns vectors in order", async () => {
  const calls = [];
  const axios = {
    post: async (url, body) => {
      calls.push({ url, body });
      return {
        data: {
          data: [
            { index: 1, embedding: [0.2, 0.3] },
            { index: 0, embedding: [0.1, 0.2] },
          ],
        },
      };
    },
  };

  const vectors = await embedBatch({
    axios,
    embeddingKey: "key",
    texts: ["one", "two"],
  });

  assert.deepEqual(calls[0].body.input, ["one", "two"]);
  assert.deepEqual(vectors, [
    [0.1, 0.2],
    [0.2, 0.3],
  ]);
});

test("buildImportCandidates rejects known ai replies and recent bot-account messages", () => {
  const now = 1_700_000_000;
  const raw = [
    {
      groupId: "120@g.us",
      groupName: "Test Group",
      userId: "bot@c.us",
      userName: "Bot",
      text: "This is an AI reply that must not be imported",
      timestamp: now - 60,
    },
    {
      groupId: "120@g.us",
      groupName: "Test Group",
      userId: "bot@c.us",
      userName: "Bot",
      text: "Another long bot account reply that must be skipped",
      timestamp: now - 120,
    },
    {
      groupId: "120@g.us",
      groupName: "Test Group",
      userId: "human@c.us",
      userName: "Human",
      text: "Useful human marathon planning message",
      timestamp: now - 180,
    },
  ];

  const candidates = buildImportCandidates(raw, {
    botUserId: "bot@c.us",
    aiOutboxHashes: new Set([createTextHash(raw[0].text)]),
    now,
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].message.userId, "human@c.us");
});

test("withRetry retries transient socket errors", async () => {
  let attempts = 0;

  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("socket hang up");
        error.code = "ECONNRESET";
        throw error;
      }
      return "ok";
    },
    { maxAttempts: 3, baseDelayMs: 1 }
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("withRetry retries aborted stream errors", async () => {
  let attempts = 0;

  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("stream has been aborted");
      }
      return "ok";
    },
    { maxAttempts: 2, baseDelayMs: 1 }
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});

test("withRetry retries temporary dns lookup failures", async () => {
  let attempts = 0;

  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 2) {
        const error = new Error("getaddrinfo ENOTFOUND tokendance.space");
        error.code = "ENOTFOUND";
        throw error;
      }
      return "ok";
    },
    { maxAttempts: 2, baseDelayMs: 1 }
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});
