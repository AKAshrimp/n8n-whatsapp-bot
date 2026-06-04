const assert = require("node:assert/strict");
const test = require("node:test");

const { analyzeHistory, loadAiOutboxHashes } = require("./history-analysis");
const { createTextHash } = require("../message-utils");

test("loadAiOutboxHashes reads ai_reply hashes from jsonl", () => {
  const hashes = loadAiOutboxHashes(
    [
      JSON.stringify({ type: "ai_reply", textHash: createTextHash("AI reply") }),
      JSON.stringify({ type: "manual", textHash: createTextHash("manual") }),
      "",
    ].join("\n")
  );

  assert.equal(hashes.has(createTextHash("AI reply")), true);
  assert.equal(hashes.has(createTextHash("manual")), false);
});

test("analyzeHistory separates clean and suspicious messages", () => {
  const now = 1780222830;
  const result = analyzeHistory(
    [
      {
        groupId: "group@g.us",
        groupName: "珍•Marathon Part-time•珠",
        userId: "bot@c.us",
        userName: "Bot owner",
        text: "這是一段最近五天內超過十五個字的訊息",
        timestamp: now,
      },
      {
        groupId: "group@g.us",
        groupName: "珍•Marathon Part-time•珠",
        userId: "friend@c.us",
        userName: "Friend",
        text: "我9月要去日本",
        timestamp: now,
      },
      {
        groupId: "group@g.us",
        groupName: "珍•Marathon Part-time•珠",
        userId: "friend@c.us",
        userName: "Friend",
        text: "ok",
        timestamp: now,
      },
    ],
    {
      botUserId: "bot@c.us",
      aiOutboxHashes: new Set(),
      now,
    }
  );

  assert.equal(result.total, 3);
  assert.equal(result.clean.length, 1);
  assert.equal(result.suspicious.length, 2);
  assert.equal(result.byUser["friend@c.us"].clean, 1);
  assert.equal(result.byReason.recent_long_bot_account_message, 1);
  assert.equal(result.byReason.low_value_text, 1);
});
