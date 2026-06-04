const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  buildPrepareMemoryCode,
  buildProfileScrollRequestCode,
  buildAppendWebSearchContextCode,
  buildBraveSearchCode,
  buildSaveMemoryCode,
  buildSearchClassifierRequestCode,
  buildParseWebSearchDecisionCode,
  patchWebSearchWorkflow,
  patchWorkflow,
} = require("./patch-workflow-profile-context");

test("buildProfileScrollRequestCode requests group and member profiles", () => {
  const code = buildProfileScrollRequestCode();

  assert.match(code, /group_profile/);
  assert.match(code, /member_profile/);
  assert.match(code, /with_vector: false/);
  assert.match(code, /limit: 20/);
});

test("buildPrepareMemoryCode keeps unified persona by default but allows explicit imitation", () => {
  const code = buildPrepareMemoryCode();

  assert.match(code, /groupProfileMemories/);
  assert.match(code, /memberProfileMemories/);
  assert.match(code, /使用者現在問的具體要求最優先/);
  assert.match(code, /預設統一使用同一個群友人格/);
  assert.match(code, /明確要求模仿某位成員/);
  assert.match(code, /輕量模仿該成員的節奏、語氣和互動方式/);
  assert.doesNotMatch(code, /更貼近該成員的風格/);
});

test("buildPrepareMemoryCode only requires memory disclaimer for group-memory questions", () => {
  const code = buildPrepareMemoryCode();

  assert.match(code, /一般知識、旅遊建議、笑話、寫作、翻譯、腦震盪/);
  assert.match(code, /直接用大模型常識回答/);
  assert.match(code, /只有當使用者問群內歷史、成員私事、過去聊天記錄/);
  assert.match(code, /才需要先說目前沒有足夠記憶/);
  assert.match(code, /不要叫使用者先提供笑話/);
});

test("buildPrepareMemoryCode treats member phrases as background, not reusable quotes", () => {
  const code = buildPrepareMemoryCode();

  assert.match(code, /不要把舊訊息或成員經典語句當成可直接複製/);
  assert.match(code, /預設不要逐字引用、照抄或反覆使用任何成員的原句/);
  assert.match(code, /Kelvin/);
  assert.match(code, /用自己的話自然改寫/);
  assert.match(code, /明確要求原句、逐字、引用或 exact wording/);
});

test("buildPrepareMemoryCode does not expose member profiles or raw history by default", () => {
  const code = buildPrepareMemoryCode();

  assert.match(code, /非模仿要求：不提供 member_profile 原文/);
  assert.match(code, /selectedProfiles: \[\]/);
  assert.doesNotMatch(code, /非模仿要求：可以提供所有 member_profile 作背景參考/);
  assert.match(code, /普通聊天不提供群組歷史原文/);
  assert.match(code, /只在使用者明確詢問群內歷史、過去事件、某人之前講過什麼/);
});

test("buildPrepareMemoryCode keeps exact quotes behind explicit quote requests", () => {
  const code = buildPrepareMemoryCode();

  assert.match(code, /isExactQuoteRequest/);
  assert.match(code, /即使用到歷史記憶，也預設只能概述/);
  assert.match(code, /只有使用者明確要求原句、逐字、引用或 exact wording 時/);
  assert.match(code, /隱私、安全、資料使用或洩漏問題/);
  assert.match(code, /不要引用任何成員舊句/);
});

test("buildPrepareMemoryCode filters member profiles to one target for imitation requests", () => {
  const code = buildPrepareMemoryCode();

  assert.match(code, /selectMemberProfilesForQuestion/);
  assert.match(code, /isImitationRequest/);
  assert.match(code, /只提供被模仿目標的 member_profile/);
  assert.match(code, /如果模仿目標不明確或有歧義/);
  assert.match(code, /避免把 A 的語氣混入 B 的口頭禪/);
  assert.match(code, /matchedTargetName/);
  assert.match(code, /retrievedMemberProfiles: selectedMemberProfileMemories/);
});

test("buildPrepareMemoryCode includes marathon member alias matching rules", () => {
  const code = buildPrepareMemoryCode();

  assert.match(code, /memberAliasMap/);
  assert.match(code, /vincy/);
  assert.match(code, /曾詠靖/);
  assert.match(code, /cvvc/);
  assert.match(code, /kelvincheng/);
  assert.match(code, /riley/);
  assert.match(code, /互剪/);
  assert.match(code, /惠/);
  assert.match(code, /stone/);
  assert.match(code, /石學恩/);
  assert.match(code, /chineseAliasCharacters/);
});

test("buildSearchClassifierRequestCode asks DeepSeek to decide search need by task type", () => {
  const code = buildSearchClassifierRequestCode();

  assert.match(code, /searchClassifierMessages/);
  assert.match(code, /不要問自己有沒有訓練資料/);
  assert.match(code, /介紹遊戲/);
  assert.match(code, /建議/);
  assert.match(code, /最新|價格|狀態|API|版本/);
  assert.match(code, /JSON only/);
});

test("web search code parses classifier output and formats snippets for DeepSeek", () => {
  assert.match(buildParseWebSearchDecisionCode(), /choices\?\.\[0\]\?\.message\?\.content/);
  assert.match(buildParseWebSearchDecisionCode(), /classifier-unavailable/);
  assert.match(buildParseWebSearchDecisionCode(), /shouldSearch: Boolean/);
  assert.match(buildBraveSearchCode(), /api\.search\.brave\.com\/res\/v1\/web\/search/);
  assert.doesNotMatch(buildBraveSearchCode(), /process\.env/);
  assert.match(buildBraveSearchCode(), /\/home\/node\/\.n8n\/bravesearch-key/);
  assert.match(buildBraveSearchCode(), /extra_snippets/);
  assert.match(buildAppendWebSearchContextCode(), /外部網頁搜尋結果/);
  assert.match(buildAppendWebSearchContextCode(), /description/);
  assert.match(buildAppendWebSearchContextCode(), /url/);
});

test("buildSaveMemoryCode appends an English period marker to AI replies", () => {
  const code = buildSaveMemoryCode();

  assert.match(code, /appendAiReplyExportMarker/);
  assert.match(code, /trimEnd\(\)/);
  assert.match(code, /text\.endsWith\("\."\)/);
  assert.match(code, /message: markedAiReply/);
});

test("chat branch uses static data short-term AI turn buffer without Qdrant pollution", () => {
  const prepareCode = buildPrepareMemoryCode();
  const saveCode = buildSaveMemoryCode();

  assert.match(prepareCode, /getWorkflowStaticData\("global"\)/);
  assert.match(prepareCode, /aiTurnBuffer/);
  assert.match(prepareCode, /shortTermAiContext/);
  assert.match(prepareCode, /最近幾輪 @ai 對話/);
  assert.match(prepareCode, /User:/);
  assert.match(prepareCode, /AI:/);

  assert.match(saveCode, /getWorkflowStaticData\("global"\)/);
  assert.match(saveCode, /aiTurnBuffer/);
  assert.match(saveCode, /MAX_SHORT_TERM_AI_TURNS = 6/);
  assert.match(saveCode, /SHORT_TERM_AI_TURN_TTL_MS/);
  assert.match(saveCode, /question: input\.text/);
  assert.match(saveCode, /answer: markedAiReply/);
  assert.doesNotMatch(saveCode, /qdrant/i);
});

test("patchWorkflow inserts profile scroll between qdrant search and prepare memory", () => {
  const workflow = {
    nodes: [
      { name: "prepare memory", parameters: { jsCode: "old" } },
      { name: "qdrant search memory", parameters: {}, type: "http", typeVersion: 1, position: [0, 0], id: "search" },
    ],
    connections: {
      "qdrant search memory": {
        main: [[{ node: "prepare memory", type: "main", index: 0 }]],
      },
    },
  };

  patchWorkflow(workflow);

  assert.ok(workflow.nodes.some((node) => node.name === "build qdrant profile scroll"));
  assert.ok(workflow.nodes.some((node) => node.name === "qdrant scroll profiles"));
  assert.ok(workflow.nodes.some((node) => node.name === "build web search classifier"));
  assert.ok(workflow.nodes.some((node) => node.name === "DeepSeek search classifier"));
  assert.ok(workflow.nodes.some((node) => node.name === "parse web search decision"));
  assert.ok(workflow.nodes.some((node) => node.name === "needs web search"));
  assert.ok(workflow.nodes.some((node) => node.name === "Brave Search"));
  assert.ok(workflow.nodes.some((node) => node.name === "append web search context"));
  assert.equal(workflow.nodes.find((node) => node.name === "prepare memory").parameters.jsCode, buildPrepareMemoryCode());
  assert.deepEqual(workflow.connections["qdrant search memory"].main[0], [
    { node: "build qdrant profile scroll", type: "main", index: 0 },
  ]);
  assert.deepEqual(workflow.connections["qdrant scroll profiles"].main[0], [
    { node: "prepare memory", type: "main", index: 0 },
  ]);
  assert.deepEqual(workflow.connections["prepare memory"].main[0], [
    { node: "build web search classifier", type: "main", index: 0 },
  ]);
  assert.deepEqual(workflow.connections["build web search classifier"].main[0], [
    { node: "DeepSeek search classifier", type: "main", index: 0 },
  ]);
  assert.deepEqual(workflow.connections["DeepSeek search classifier"].main[0], [
    { node: "parse web search decision", type: "main", index: 0 },
  ]);
  assert.deepEqual(workflow.connections["DeepSeek search classifier"].main[1], [
    { node: "parse web search decision", type: "main", index: 0 },
  ]);
  assert.deepEqual(workflow.connections["parse web search decision"].main[0], [
    { node: "needs web search", type: "main", index: 0 },
  ]);
  assert.deepEqual(workflow.connections["needs web search"].main[0], [
    { node: "Brave Search", type: "main", index: 0 },
  ]);
  assert.deepEqual(workflow.connections["needs web search"].main[1], [
    { node: "append web search context", type: "main", index: 0 },
  ]);
  assert.deepEqual(workflow.connections["Brave Search"].main[0], [
    { node: "append web search context", type: "main", index: 0 },
  ]);
  assert.deepEqual(workflow.connections["append web search context"].main[0], [
    { node: "Deepseek", type: "main", index: 0 },
  ]);
});

test("patchWebSearchWorkflow preserves existing prepare memory code", () => {
  const workflow = {
    nodes: [
      { name: "prepare memory", parameters: { jsCode: "custom active persona code" } },
      { name: "save memory", parameters: { jsCode: "old save memory code" } },
      { name: "Deepseek", parameters: {}, type: "http", typeVersion: 1, position: [0, 0], id: "deepseek" },
    ],
    connections: {
      "prepare memory": {
        main: [[{ node: "Deepseek", type: "main", index: 0 }]],
      },
    },
  };

  patchWebSearchWorkflow(workflow);

  assert.equal(workflow.nodes.find((node) => node.name === "prepare memory").parameters.jsCode, "custom active persona code");
  assert.equal(workflow.nodes.find((node) => node.name === "save memory").parameters.jsCode, buildSaveMemoryCode());
  assert.ok(workflow.nodes.some((node) => node.name === "Brave Search"));
  assert.ok(workflow.nodes.some((node) => node.name === "DeepSeek search classifier"));
  assert.deepEqual(workflow.connections["append web search context"].main[0], [
    { node: "Deepseek", type: "main", index: 0 },
  ]);
});

test("patchWorkflow accepts single workflow export objects", () => {
  const workflow = {
    nodes: [
      { name: "prepare memory", parameters: { jsCode: "old" } },
      { name: "qdrant search memory", parameters: {}, type: "http", typeVersion: 1, position: [0, 0], id: "search" },
    ],
    connections: {
      "qdrant search memory": {
        main: [[{ node: "prepare memory", type: "main", index: 0 }]],
      },
    },
  };

  patchWorkflow(workflow);

  assert.equal(workflow.nodes.find((node) => node.name === "prepare memory").parameters.jsCode, buildPrepareMemoryCode());
});

test("patchWorkflow does not connect error output when safe error node is missing", () => {
  const workflow = {
    nodes: [
      { name: "prepare memory", parameters: { jsCode: "old" } },
      { name: "qdrant search memory", parameters: {}, type: "http", typeVersion: 1, position: [0, 0], id: "search" },
    ],
    connections: {
      "qdrant search memory": {
        main: [[{ node: "prepare memory", type: "main", index: 0 }]],
      },
    },
  };

  patchWorkflow(workflow);

  assert.equal(workflow.connections["qdrant scroll profiles"].main.length, 1);
});

test("local workflow sends image edit failures back to WhatsApp", () => {
  const workflows = JSON.parse(
    fs.readFileSync("n8n/workflows/workflows.json", "utf8")
  );
  const workflow = Array.isArray(workflows) ? workflows[0] : workflows;
  const editNode = workflow.nodes.find((node) => node.name === "edit Gpt image2");
  const errorNode = workflow.nodes.find(
    (node) => node.name === "prepare image error message"
  );

  assert.equal(editNode?.onError, "continueErrorOutput");
  assert.ok(errorNode, "prepare image error message node should exist");
  assert.match(errorNode.parameters.jsCode, /圖片生成失敗/);
  assert.doesNotMatch(errorNode.parameters.jsCode, /Authorization|Bearer|API key/i);
  assert.deepEqual(workflow.connections["edit Gpt image2"].main[1], [
    { node: "prepare image error message", type: "main", index: 0 },
  ]);
  assert.deepEqual(workflow.connections["prepare image error message"].main[0], [
    { node: "return message", type: "main", index: 0 },
  ]);
});
