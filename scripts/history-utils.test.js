const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildMemberIndexPoint,
  buildMemberProfilePrompt,
  buildQdrantMessagePoint,
  createHistoryMessageId,
  normalizeGroupName,
  normalizeHistoryMessage,
  shouldImportHistoryText,
} = require("./history-utils");

test("normalizeGroupName treats bracketed Marathon group names as the same group", () => {
  assert.equal(normalizeGroupName("珍•Marathon Part-time•珠"), "珍•Marathon Part-time•珠");
  assert.equal(normalizeGroupName("(珍•Marathon Part-time•珠)"), "珍•Marathon Part-time•珠");
  assert.equal(normalizeGroupName("（珍•Marathon Part-time•珠）"), "珍•Marathon Part-time•珠");
});

test("normalizeHistoryMessage accepts valid group history", () => {
  assert.deepEqual(
    normalizeHistoryMessage({
      groupId: "852xxx@g.us",
      groupName: "（珍•Marathon Part-time•珠）",
      userId: "111@lid",
      userName: "Kelvin",
      text: " 我8月去旅行 ",
      timestamp: "1780222830",
    }),
    {
      groupId: "852xxx@g.us",
      groupName: "珍•Marathon Part-time•珠",
      userId: "111@lid",
      userName: "Kelvin",
      text: "我8月去旅行",
      timestamp: 1780222830,
    }
  );
});

test("normalizeHistoryMessage rejects missing userId", () => {
  assert.throws(
    () =>
      normalizeHistoryMessage({
        groupId: "852xxx@g.us",
        groupName: "珍•Marathon Part-time•珠",
        text: "我8月去旅行",
        timestamp: 1780222830,
      }),
    /userId/
  );
});

test("shouldImportHistoryText filters low value messages", () => {
  assert.equal(shouldImportHistoryText("ok"), false);
  assert.equal(shouldImportHistoryText("哈哈"), false);
  assert.equal(shouldImportHistoryText("🔥🔥🔥"), false);
  assert.equal(shouldImportHistoryText("我8月去旅行"), true);
  assert.equal(shouldImportHistoryText("I prefer morning shifts"), true);
});

test("createHistoryMessageId is deterministic", () => {
  const message = normalizeHistoryMessage({
    groupId: "852xxx@g.us",
    groupName: "珍•Marathon Part-time•珠",
    userId: "111@lid",
    text: "我8月去旅行",
    timestamp: 1780222830,
  });

  assert.equal(createHistoryMessageId(message), createHistoryMessageId(message));
  assert.match(
    createHistoryMessageId(message),
    /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/
  );
});

test("buildQdrantMessagePoint requires a 1024 dimension vector", () => {
  const message = normalizeHistoryMessage({
    groupId: "852xxx@g.us",
    groupName: "珍•Marathon Part-time•珠",
    userId: "111@lid",
    text: "我8月去旅行",
    timestamp: 1780222830,
  });

  assert.throws(() => buildQdrantMessagePoint(message, [0.1]), /1024/);
});

test("buildQdrantMessagePoint sets history payload shape", () => {
  const message = normalizeHistoryMessage({
    groupId: "852xxx@g.us",
    groupName: "珍•Marathon Part-time•珠",
    userId: "111@lid",
    userName: "Kelvin",
    text: "我8月去旅行",
    timestamp: 1780222830,
  });
  const vector = Array.from({ length: 1024 }, () => 0.1);
  const point = buildQdrantMessagePoint(message, vector);

  assert.equal(point.vector.length, 1024);
  assert.equal(point.payload.type, "whatsapp_message");
  assert.equal(point.payload.source, "history-seed");
  assert.equal(point.payload.userName, "Kelvin");
});

test("buildMemberProfilePrompt includes safety instructions", () => {
  const prompt = buildMemberProfilePrompt("Kelvin", [
    { text: "我鍾意 backend 同 Docker", timestamp: 1780222830 },
  ]);

  assert.match(prompt, /Forbidden/);
  assert.match(prompt, /protected attributes/);
  assert.match(prompt, /Kelvin/);
});

test("buildMemberIndexPoint stores searchable name tokens", () => {
  const point = buildMemberIndexPoint({
    groupId: "852xxx@g.us",
    groupName: "珍•Marathon Part-time•珠",
    userId: "111@lid",
    userName: "Kelvin Cheng",
    aliases: ["K", "Wing"],
    timestamp: 1780222830,
  });

  assert.equal(point.payload.type, "member_index");
  assert.match(point.payload.text, /kelvin/);
  assert.match(point.payload.text, /wing/);
});
