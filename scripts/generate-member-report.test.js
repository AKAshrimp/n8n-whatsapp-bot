const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildMemberPersonaFromChunkSummariesPrompt,
  buildMemberPersonaChunkPrompt,
  createChunkSummaryCacheKey,
  getChunkSummaryWithCache,
  buildMemberReportPrompt,
  buildMemberReportFromChunkSummariesPrompt,
  buildMemberReportChunkPrompt,
  chunkMessages,
  groupMessagesByUser,
  parseJsonFromModel,
} = require("./generate-member-report");

test("groupMessagesByUser groups normalized messages by sender", () => {
  const members = groupMessagesByUser([
    {
      groupId: "group@g.us",
      groupName: "珍•Marathon Part-time•珠",
      userId: "Riley",
      userName: "Riley",
      text: "我都係見無人講",
      timestamp: 1780000000,
    },
    {
      groupId: "group@g.us",
      groupName: "珍•Marathon Part-time•珠",
      userId: "Riley",
      userName: "Riley",
      text: "好有情緒價值",
      timestamp: 1780000060,
    },
  ]);

  assert.equal(members.length, 1);
  assert.equal(members[0].userName, "Riley");
  assert.equal(members[0].messages.length, 2);
});

test("buildMemberReportPrompt includes safety and output shape", () => {
  const prompt = buildMemberReportPrompt({
    userName: "Riley",
    messages: [{ text: "好有情緒價值" }],
  });

  assert.match(prompt, /Riley/);
  assert.match(prompt, /不要推斷敏感屬性/);
  assert.match(prompt, /howAiShouldReply/);
});

test("chunkMessages splits messages into fixed size chunks", () => {
  const chunks = chunkMessages(
    [{ text: "one" }, { text: "two" }, { text: "three" }],
    2
  );

  assert.deepEqual(chunks, [
    [{ text: "one" }, { text: "two" }],
    [{ text: "three" }],
  ]);
});

test("buildMemberReportChunkPrompt includes chunk metadata", () => {
  const prompt = buildMemberReportChunkPrompt({
    userName: "Riley",
    chunkIndex: 1,
    totalChunks: 3,
    messages: [{ text: "好有情緒價值" }],
  });

  assert.match(prompt, /第 1\/3 段/);
  assert.match(prompt, /局部觀察/);
  assert.match(prompt, /好有情緒價值/);
  assert.match(prompt, /不要用訊息序號當證據/);
  assert.match(prompt, /聊天原句短引用/);
});

test("buildMemberReportFromChunkSummariesPrompt combines chunk summaries", () => {
  const prompt = buildMemberReportFromChunkSummariesPrompt({
    userName: "Riley",
    messageCount: 120,
    chunkSummaries: [{ communicationStyle: "短句互動" }],
  });

  assert.match(prompt, /120/);
  assert.match(prompt, /短句互動/);
  assert.match(prompt, /howAiShouldReply/);
  assert.match(prompt, /不要用 1、2、3/);
  assert.match(prompt, /保留聊天原句短引用/);
});

test("buildMemberPersonaChunkPrompt asks for persona observations without evidence list", () => {
  const prompt = buildMemberPersonaChunkPrompt({
    userName: "Riley",
    chunkIndex: 1,
    totalChunks: 2,
    messages: [{ text: "好有情緒價值" }],
  });

  assert.match(prompt, /人物画像/);
  assert.match(prompt, /一句話人設/);
  assert.match(prompt, /講話習慣/);
  assert.match(prompt, /半認真半搞笑/);
  assert.match(prompt, /詳細一點/);
  assert.doesNotMatch(prompt, /evidence/);
});

test("buildMemberPersonaFromChunkSummariesPrompt includes final persona shape", () => {
  const prompt = buildMemberPersonaFromChunkSummariesPrompt({
    userName: "Riley",
    messageCount: 120,
    chunkSummaries: [{ oneLinePersona: "群入面嘅情緒價值偵探" }],
  });

  assert.match(prompt, /群友眼中/);
  assert.match(prompt, /人物分析/);
  assert.match(prompt, /人設/);
  assert.match(prompt, /画像/);
  assert.match(prompt, /講話習慣/);
  assert.match(prompt, /常互動對象/);
  assert.match(prompt, /經典語句/);
  assert.match(prompt, /回覆方法/);
  assert.match(prompt, /半認真半搞笑/);
  assert.match(prompt, /可以寫長一點/);
  assert.match(prompt, /commonInteractionTargets/);
  assert.match(prompt, /replyMethod/);
  assert.doesNotMatch(prompt, /evidence/);
});

test("createChunkSummaryCacheKey changes when prompt version or messages change", () => {
  const base = {
    mode: "persona",
    model: "qwen-max",
    promptVersion: "v1",
    member: { userId: "Riley", userName: "Riley" },
    chunkIndex: 1,
    totalChunks: 2,
    messages: [{ text: "好有情緒價值", timestamp: 1780000000 }],
  };

  assert.notEqual(
    createChunkSummaryCacheKey(base),
    createChunkSummaryCacheKey({ ...base, promptVersion: "v2" })
  );
  assert.notEqual(
    createChunkSummaryCacheKey(base),
    createChunkSummaryCacheKey({
      ...base,
      messages: [{ text: "另一句", timestamp: 1780000000 }],
    })
  );
});

test("getChunkSummaryWithCache reuses local chunk summaries", async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "member-report-cache-"));
  let calls = 0;
  const request = {
    cacheDir,
    mode: "persona",
    model: "qwen-max",
    promptVersion: "v1",
    member: { userId: "Riley", userName: "Riley" },
    chunkIndex: 1,
    totalChunks: 1,
    messages: [{ text: "好有情緒價值", timestamp: 1780000000 }],
    createSummary: async () => {
      calls += 1;
      return { oneLinePersona: "群入面嘅情緒價值偵探" };
    },
  };

  assert.deepEqual(await getChunkSummaryWithCache(request), {
    oneLinePersona: "群入面嘅情緒價值偵探",
  });
  assert.deepEqual(await getChunkSummaryWithCache(request), {
    oneLinePersona: "群入面嘅情緒價值偵探",
  });
  assert.equal(calls, 1);
});

test("parseJsonFromModel accepts fenced json", () => {
  assert.deepEqual(
    parseJsonFromModel('```json\n{"userName":"Riley"}\n```'),
    { userName: "Riley" }
  );
});

test("parseJsonFromModel tolerates raw newlines inside json strings", () => {
  assert.deepEqual(
    parseJsonFromModel('{"typicalJokesAndExamples":["line one\nline two"]}'),
    { typicalJokesAndExamples: ["line one\\nline two"] }
  );
});
