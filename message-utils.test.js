const assert = require("node:assert/strict");
const test = require("node:test");

const { getImagePayloadFromMessage } = require("./message-utils");

test("uses direct image media for image edit commands", async () => {
  const result = await getImagePayloadFromMessage({
    hasMedia: true,
    downloadMedia: async () => ({
      mimetype: "image/png",
      filename: "direct.png",
      data: "direct-base64",
    }),
  });

  assert.equal(result.imageMode, "edit");
  assert.equal(result.imageSource, "direct");
  assert.deepEqual(result.imagePayload, {
    mimetype: "image/png",
    filename: "direct.png",
    data: "direct-base64",
  });
});

test("uses quoted image media when command is a reply to an image", async () => {
  const result = await getImagePayloadFromMessage({
    hasMedia: false,
    hasQuotedMsg: true,
    getQuotedMessage: async () => ({
      hasMedia: true,
      downloadMedia: async () => ({
        mimetype: "image/jpeg",
        filename: undefined,
        data: "quoted-base64",
      }),
    }),
  });

  assert.equal(result.imageMode, "edit");
  assert.equal(result.imageSource, "quoted");
  assert.deepEqual(result.imagePayload, {
    mimetype: "image/jpeg",
    filename: "input-image.jpg",
    data: "quoted-base64",
  });
});

test("falls back to generate mode when no image media is available", async () => {
  const result = await getImagePayloadFromMessage({
    hasMedia: false,
    hasQuotedMsg: true,
    getQuotedMessage: async () => ({
      hasMedia: false,
    }),
  });

  assert.equal(result.imageMode, "generate");
  assert.equal(result.imageSource, null);
  assert.equal(result.imagePayload, null);
});

const {
  classifyIncomingText,
  createAiOutboxRecord,
  createHistoryImportDecision,
  createOutgoingMessageTracker,
  createTextHash,
  formatGroupList,
  createAllowedGroupSettingsStore,
  isRecordableText,
  createStableMessageId,
} = require("./message-utils");

const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

test("classifies normal text as record command", () => {
  assert.deepEqual(classifyIncomingText("我星期五要去深圳"), {
    command: "record",
    text: "我星期五要去深圳",
    prompt: undefined,
    isAiCommand: false,
    isImageCommand: false,
  });
});

test("classifies @ai question as chat command", () => {
  assert.deepEqual(classifyIncomingText("@ai Kelvin 最近有咩安排？"), {
    command: "chat",
    text: "Kelvin 最近有咩安排？",
    prompt: undefined,
    isAiCommand: true,
    isImageCommand: false,
  });
});

test("classifies memory status command", () => {
  assert.deepEqual(classifyIncomingText("@ai memory status"), {
    command: "memory_status",
    text: "memory status",
    prompt: undefined,
    isAiCommand: true,
    isImageCommand: false,
  });
});

test("classifies forget me command", () => {
  assert.deepEqual(classifyIncomingText("@ai forget me"), {
    command: "forget_me",
    text: "forget me",
    prompt: undefined,
    isAiCommand: true,
    isImageCommand: false,
  });
});

test("classifies @aiimg as image command", () => {
  assert.deepEqual(classifyIncomingText("@aiimg p走字幕"), {
    command: "image",
    text: "p走字幕",
    prompt: "p走字幕",
    isAiCommand: false,
    isImageCommand: true,
  });
});

test("rejects short record text", () => {
  assert.equal(isRecordableText("ok"), false);
  assert.equal(isRecordableText("哈哈"), false);
  assert.equal(isRecordableText("yes"), false);
});

test("accepts useful record text", () => {
  assert.equal(isRecordableText("我星期五要去深圳"), true);
});

test("creates stable UUID message id from native message id", () => {
  const id = createStableMessageId({
    id: {
      _serialized: "native-message-id",
    },
  });
  const sameId = createStableMessageId({
    id: {
      _serialized: "native-message-id",
    },
  });

  assert.match(id, UUID_PATTERN);
  assert.equal(id, sameId);
  assert.notEqual(id, "native-message-id");
});

test("creates stable UUID message id when native id is unavailable", () => {
  const id = createStableMessageId(
    {
      timestamp: 1780222830,
    },
    {
      groupId: "852xxx@g.us",
      userId: "111@lid",
      text: "我星期五要去深圳",
    }
  );
  const sameId = createStableMessageId(
    {
      timestamp: 1780222830,
    },
    {
      groupId: "852xxx@g.us",
      userId: "111@lid",
      text: "我星期五要去深圳",
    }
  );

  assert.match(id, UUID_PATTERN);
  assert.equal(id, sameId);
});

test("creates different UUID message ids for different source material", () => {
  const firstId = createStableMessageId({
    id: {
      _serialized: "native-message-id",
    },
  });
  const secondId = createStableMessageId({
    id: {
      _serialized: "another-native-message-id",
    },
  });
  const fallbackId = createStableMessageId(
    {
      timestamp: 1780222830,
    },
    {
      groupId: "852xxx@g.us",
      userId: "111@lid",
      text: "我星期五要去深圳",
    }
  );

  assert.match(firstId, UUID_PATTERN);
  assert.match(secondId, UUID_PATTERN);
  assert.match(fallbackId, UUID_PATTERN);
  assert.notEqual(firstId, secondId);
  assert.notEqual(firstId, fallbackId);
  assert.notEqual(secondId, fallbackId);
});

test("tracks a sent bot message and recognizes it once", () => {
  const tracker = createOutgoingMessageTracker({ ttlMs: 30000 });

  tracker.remember({ to: "group-1", text: "AI reply", now: 1000 });

  assert.equal(
    tracker.isKnownOutgoing({ from: "group-1", text: "AI reply", now: 1000 }),
    true
  );
  assert.equal(
    tracker.isKnownOutgoing({ from: "group-1", text: "AI reply", now: 1000 }),
    false
  );
});

test("does not recognize unrelated self-sent text", () => {
  const tracker = createOutgoingMessageTracker({ ttlMs: 30000 });

  tracker.remember({ to: "group-1", text: "AI reply", now: 1000 });

  assert.equal(
    tracker.isKnownOutgoing({
      from: "group-1",
      text: "manual message",
      now: 1000,
    }),
    false
  );
});

test("expires old sent bot messages", () => {
  const tracker = createOutgoingMessageTracker({ ttlMs: 1000 });

  tracker.remember({ to: "group-1", text: "AI reply", now: 1000 });

  assert.equal(
    tracker.isKnownOutgoing({ from: "group-1", text: "AI reply", now: 2001 }),
    false
  );
});

test("creates stable text hash for normalized text", () => {
  assert.equal(createTextHash("AI reply"), createTextHash(" AI   reply "));
  assert.notEqual(createTextHash("AI reply"), createTextHash("manual reply"));
});

test("creates ai outbox record metadata without changing visible text", () => {
  const record = createAiOutboxRecord({
    groupId: "group-1",
    senderId: "bot@c.us",
    text: "你8月要去旅行啊",
    sentAt: 1780222830,
  });

  assert.equal(record.type, "ai_reply");
  assert.equal(record.source, "whatsapp-bridge");
  assert.equal(record.groupId, "group-1");
  assert.equal(record.senderId, "bot@c.us");
  assert.equal(record.textLength, 8);
  assert.equal(record.sentAt, 1780222830);
  assert.equal(record.textHash, createTextHash("你8月要去旅行啊"));
  assert.equal(Object.hasOwn(record, "text"), false);
});

test("history import decision skips known ai outbox hash", () => {
  const decision = createHistoryImportDecision(
    {
      userId: "bot@c.us",
      text: "AI reply that should be filtered",
      timestamp: 1780222830,
    },
    {
      aiOutboxHashes: new Set([createTextHash("AI reply that should be filtered")]),
      botUserId: "bot@c.us",
      now: 1780222830,
    }
  );

  assert.equal(decision.import, false);
  assert.equal(decision.reason, "known_ai_reply");
});

test("history import decision skips recent long bot-account messages", () => {
  const decision = createHistoryImportDecision(
    {
      userId: "bot@c.us",
      text: "這是一段超過十五個字而且最近五天內的文字",
      timestamp: 1780222830,
    },
    {
      aiOutboxHashes: new Set(),
      botUserId: "bot@c.us",
      now: 1780222830 + 60,
    }
  );

  assert.equal(decision.import, false);
  assert.equal(decision.reason, "recent_long_bot_account_message");
});

test("history import decision keeps old bot-account messages", () => {
  const decision = createHistoryImportDecision(
    {
      userId: "bot@c.us",
      text: "這是一段很久以前的真人訊息，所以可以保留",
      timestamp: 1780222830 - 10 * 24 * 60 * 60,
    },
    {
      aiOutboxHashes: new Set(),
      botUserId: "bot@c.us",
      now: 1780222830,
    }
  );

  assert.equal(decision.import, true);
  assert.equal(decision.reason, "import");
});

test("formatGroupList returns safe group names and ids only", () => {
  const groups = formatGroupList([
    {
      isGroup: true,
      name: " 珍•Marathon Part-time•珠 ",
      id: { _serialized: "123-456@g.us" },
      participants: [{}, {}],
    },
    {
      isGroup: false,
      name: "Private chat",
      id: { _serialized: "123@c.us" },
    },
    {
      isGroup: true,
      name: "",
      id: { _serialized: "" },
    },
  ]);

  assert.deepEqual(groups, [
    {
      id: "123-456@g.us",
      name: "珍•Marathon Part-time•珠",
      participantsCount: 2,
    },
  ]);
});

test("allowed group settings store normalizes and matches group names", () => {
  const writes = [];
  const store = createAllowedGroupSettingsStore({
    initialGroupNames: ["Private Wutsapp Group"],
    readText: () => "",
    writeText: (text) => writes.push(text),
  });

  assert.deepEqual(store.getGroupNames(), ["Private Wutsapp Group"]);
  assert.equal(store.isAllowed("Private Wutsapp Group"), true);
  assert.equal(store.isAllowed("(Private Wutsapp Group)"), true);
  assert.equal(store.isAllowed("Other Group"), false);

  const updated = store.setGroupNames([
    " 珍•Marathon Part-time•珠 ",
    "珍•Marathon Part-time•珠",
    "",
    "New Group",
  ]);

  assert.deepEqual(updated, ["珍•Marathon Part-time•珠", "New Group"]);
  assert.equal(store.isAllowed("（珍•Marathon Part-time•珠）"), true);
  assert.equal(store.isAllowed("Private Wutsapp Group"), false);
  assert.match(writes.at(-1), /"groupNames":/);
  assert.match(writes.at(-1), /New Group/);
});

test("allowed group settings store loads persisted group names", () => {
  const store = createAllowedGroupSettingsStore({
    initialGroupNames: ["Fallback Group"],
    readText: () => JSON.stringify({ groupNames: ["Persisted Group"] }),
    writeText: () => {},
  });

  assert.deepEqual(store.getGroupNames(), ["Persisted Group"]);
  assert.equal(store.isAllowed("Persisted Group"), true);
  assert.equal(store.isAllowed("Fallback Group"), false);
});
