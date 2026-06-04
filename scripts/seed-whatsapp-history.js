const fs = require("fs");
const { createHistoryImportDecision } = require("../message-utils");
const { loadAiOutboxHashes } = require("./history-analysis");
const {
  buildQdrantMessagePoint,
  createHistoryMessageId,
  normalizeHistoryMessage,
} = require("./history-utils");

const inputPath = process.argv[2];
const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
const embeddingUrl =
  process.env.EMBEDDING_URL || "https://tokendance.space/gateway/v1/embeddings";
const embeddingModel = process.env.EMBEDDING_MODEL || "qwen-text-embedding-v4";

function resolveEmbeddingKey({ env = process.env } = {}) {
  if (env.EMBEDDING_API_KEY) return String(env.EMBEDDING_API_KEY).trim();
  if (env.EMBEDDING_API_KEY_FILE) {
    return fs.readFileSync(env.EMBEDDING_API_KEY_FILE, "utf8").trim();
  }
  return "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "ECONNRESET" ||
    error?.code === "ETIMEDOUT" ||
    error?.code === "ECONNABORTED" ||
    error?.code === "ENOTFOUND" ||
    error?.code === "EAI_AGAIN" ||
    message.includes("socket hang up") ||
    message.includes("getaddrinfo") ||
    message.includes("stream has been aborted") ||
    message.includes("timeout")
  );
}

async function withRetry(fn, { maxAttempts = 4, baseDelayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt === maxAttempts) {
        throw error;
      }
      await sleep(baseDelayMs * attempt);
    }
  }
  throw lastError;
}

async function embed({ axios, embeddingKey, text }) {
  const vectors = await embedBatch({ axios, embeddingKey, texts: [text] });
  return vectors[0];
}

async function embedBatch({ axios, embeddingKey, texts }) {
  if (!texts.length) return [];
  const response = await withRetry(() =>
    axios.post(
      embeddingUrl,
      {
        model: embeddingModel,
        input: texts,
      },
      {
        headers: {
          Authorization: `Bearer ${embeddingKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    )
  );

  const rows = response.data?.data;
  if (!Array.isArray(rows)) {
    throw new Error("Embedding missing at data");
  }

  const vectors = rows
    .slice()
    .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
    .map((item) => item.embedding);

  if (vectors.length !== texts.length || vectors.some((vector) => !Array.isArray(vector))) {
    throw new Error("Embedding batch result length mismatch");
  }
  return vectors;
}

async function upsert({ axios, points }) {
  await withRetry(() =>
    axios.put(
      `${qdrantUrl}/collections/whatsapp_memory/points?wait=true`,
      { points },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    )
  );
}

async function pointExists({ axios, qdrantUrl, pointId }) {
  const existing = await pointsExist({ axios, qdrantUrl, pointIds: [pointId] });
  return existing.has(pointId);
}

async function pointsExist({ axios, qdrantUrl, pointIds }) {
  if (!pointIds.length) return new Set();
  const response = await withRetry(() =>
    axios.post(
      `${qdrantUrl}/collections/whatsapp_memory/points`,
      {
        ids: pointIds,
        with_payload: false,
        with_vector: false,
      },
      { timeout: 60000 }
    )
  );
  return new Set((response.data?.result || []).map((point) => point.id));
}

function loadAiOutboxHashesFromPath(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return new Set();
  return loadAiOutboxHashes(fs.readFileSync(filePath, "utf8"));
}

function buildImportCandidates(
  rawMessages,
  {
    aiOutboxHashes = new Set(),
    botUserId = "",
    now = Math.floor(Date.now() / 1000),
  } = {}
) {
  const candidates = [];
  const seenCandidateIds = new Set();

  for (const item of rawMessages) {
    const message = normalizeHistoryMessage(item);
    const decision = createHistoryImportDecision(message, {
      aiOutboxHashes,
      botUserId,
      now,
    });
    if (!decision.import) {
      continue;
    }
    const pointId = createHistoryMessageId(message);
    if (seenCandidateIds.has(pointId)) continue;
    seenCandidateIds.add(pointId);
    candidates.push({
      message,
      pointId,
    });
  }

  return candidates;
}

async function main() {
  if (!inputPath) {
    console.error("Usage: node scripts/seed-whatsapp-history.js <history.json>");
    process.exit(1);
  }

  const embeddingKey = resolveEmbeddingKey();
  if (!embeddingKey) {
    console.error(
      "Missing EMBEDDING_API_KEY environment variable or EMBEDDING_API_KEY_FILE."
    );
    process.exit(1);
  }

  const axios = require("axios");
  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error("History input must be a JSON array");
  }

  const candidates = buildImportCandidates(raw, {
    aiOutboxHashes: loadAiOutboxHashesFromPath(process.env.AI_OUTBOX_LOG_PATH),
    botUserId: process.env.BOT_USER_ID || process.env.WHATSAPP_BOT_USER_ID || "",
  });

  const existingIds = new Set();
  const batchSize = Number(process.env.EXISTING_CHECK_BATCH_SIZE || 100);
  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize);
    const found = await pointsExist({
      axios,
      qdrantUrl,
      pointIds: batch.map((item) => item.pointId),
    });
    for (const pointId of found) existingIds.add(pointId);
  }

  let imported = 0;
  let existing = 0;

  const pending = [];
  for (const candidate of candidates) {
    if (existingIds.has(candidate.pointId)) {
      existing += 1;
      continue;
    }
    pending.push(candidate);
  }

  const embeddingBatchSize = Number(process.env.EMBEDDING_BATCH_SIZE || 25);
  for (let index = 0; index < pending.length; index += embeddingBatchSize) {
    const batch = pending.slice(index, index + embeddingBatchSize);
    const vectors = await embedBatch({
      axios,
      embeddingKey,
      texts: batch.map((item) => item.message.text),
    });
    const points = batch.map((item, offset) =>
      buildQdrantMessagePoint(item.message, vectors[offset])
    );
    await upsert({ axios, points });
    imported += points.length;

    if (imported % 25 === 0 || imported === pending.length) {
      console.log(`Imported ${imported}; existing ${existing}.`);
    }
  }

  console.log(
    `Imported ${imported} history messages; existing ${existing}; candidates ${candidates.length}.`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildImportCandidates,
  embedBatch,
  loadAiOutboxHashesFromPath,
  pointExists,
  pointsExist,
  resolveEmbeddingKey,
  withRetry,
};
