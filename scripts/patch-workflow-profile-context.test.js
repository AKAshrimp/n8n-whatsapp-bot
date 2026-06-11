const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  buildPrepareMemoryCode,
  buildProfileScrollRequestCode,
  buildRecentReplyContextScrollRequestCode,
  buildAppendWebSearchContextCode,
  buildBraveSearchCode,
  buildSaveMemoryCode,
  buildSearchClassifierRequestCode,
  buildParseWebSearchDecisionCode,
  patchWebSearchWorkflow,
  patchWorkflow,
} = require("./patch-workflow-profile-context");

test("buildProfileScrollRequestCode requests member profiles only", () => {
  const code = buildProfileScrollRequestCode();

  assert.match(code, /member_profile/);
  assert.doesNotMatch(code, /group_profile/);
  assert.match(code, /with_vector: false/);
  assert.match(code, /limit: 20/);
});

test("buildRecentReplyContextScrollRequestCode requests only recent same-group messages", () => {
  const code = buildRecentReplyContextScrollRequestCode();

  assert.match(code, /RECENT_REPLY_CONTEXT_WINDOW_SECONDS = 5 \* 60/);
  assert.match(code, /RECENT_REPLY_CONTEXT_LIMIT = 80/);
  assert.match(code, /groupId/);
  assert.match(code, /timestamp/);
  assert.match(code, /range/);
  assert.match(code, /whatsapp_message/);
  assert.match(code, /with_vector: false/);
});

test("buildPrepareMemoryCode keeps unified persona by default but allows explicit imitation", () => {
  const code = buildPrepareMemoryCode();

  assert.match(code, /memberProfileMemories/);
  assert.doesNotMatch(code, /groupProfileMemories/);
  assert.doesNotMatch(code, /retrievedGroupProfiles/);
  assert.doesNotMatch(code, /group_profile/);
  assert.match(code, /使用者現在問的具體要求最優先/);
  assert.match(code, /預設統一使用同一個群友人格/);
  assert.match(code, /明確要求模仿某位成員/);
  assert.match(code, /輕量模仿該成員的節奏、語氣、互動方式和口頭禪/);
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

test("buildPrepareMemoryCode chooses pro model for reasoning and memory organization", () => {
  const code = buildPrepareMemoryCode();

  assert.match(code, /FAST_RESPONSE_MODEL = "deepseek-v4-flash"/);
  assert.match(code, /STRONG_RESPONSE_MODEL = "deepseek-v4-pro"/);
  assert.match(code, /needsStrongResponseModel/);
  assert.match(code, /分析|整理|總結|总结|比較|比较|推理/);
  assert.match(code, /groupHistoryRequested/);
  assert.match(code, /responseModel/);
});

test("buildPrepareMemoryCode builds reply assist prompt from recent context and own profile", () => {
  const code = buildPrepareMemoryCode();

  assert.match(code, /qdrant scroll recent reply context/);
  assert.match(code, /isReplyAssistRequest/);
  assert.match(code, /扮我覆/);
  assert.match(code, /我要點覆/);
  assert.doesNotMatch(code, /\(\?:怎麼\|怎么\|點\|点\)回/);
  assert.match(code, /recentReplyContext/);
  assert.match(code, /selectOwnMemberProfileForReplyAssist/);
  assert.match(code, /replyAssistTargetProfile/);
  assert.match(code, /最近 5 分鐘群聊現場/);
  assert.match(code, /幫 user 寫一條像他本人會講的回覆/);
  assert.match(code, /首選：/);
  assert.match(code, /嘴賤版：/);
  assert.match(code, /安全版：/);
  assert.match(code, /responseMode: isReplyAssist \? "reply_assist" : "chat"/);
});

test("buildPrepareMemoryCode treats member phrases as background, not reusable quotes", () => {
  const code = buildPrepareMemoryCode();

  assert.match(code, /可以合理使用少量口頭禪或常見句式增加群味/);
  assert.match(code, /每次最多用一個/);
  assert.match(code, /不要硬塞、不要連續每句都用、不要列出口頭禪清單/);
  assert.match(code, /Kelvin/);
  assert.match(code, /只使用該成員的語氣、節奏和口頭禪/);
  assert.match(code, /不要混用其他成員的口頭禪/);
  assert.match(code, /明確要求原句、逐字、引用或 exact wording/);
});

test("web search context upgrades final response model to pro", () => {
  const code = buildAppendWebSearchContextCode();

  assert.match(code, /STRONG_RESPONSE_MODEL = "deepseek-v4-pro"/);
  assert.match(code, /input\.webSearch\?\.shouldSearch/);
  assert.match(code, /responseModel: webSearchContext \|\| input\.webSearch\?\.shouldSearch/);
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
  assert.ok(workflow.nodes.some((node) => node.name === "build recent reply context scroll"));
  assert.ok(workflow.nodes.some((node) => node.name === "qdrant scroll recent reply context"));
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
    { node: "build recent reply context scroll", type: "main", index: 0 },
  ]);
  assert.deepEqual(workflow.connections["build recent reply context scroll"].main[0], [
    { node: "qdrant scroll recent reply context", type: "main", index: 0 },
  ]);
  assert.deepEqual(workflow.connections["qdrant scroll recent reply context"].main[0], [
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

test("patchWorkflow removes forget-me deletion branch", () => {
  const workflow = {
    nodes: [
      {
        name: "Switch",
        parameters: {
          rules: {
            values: [
              {
                conditions: {
                  conditions: [
                    {
                      id: "rag-switch-memory-status",
                      rightValue: "memory_status",
                    },
                  ],
                },
              },
              {
                conditions: {
                  conditions: [
                    {
                      id: "rag-switch-forget-me",
                      rightValue: "forget_me",
                    },
                  ],
                },
              },
            ],
          },
        },
      },
      { name: "prepare memory", parameters: { jsCode: "old" } },
      { name: "qdrant search memory", parameters: {}, type: "http", typeVersion: 1, position: [0, 0], id: "search" },
      { name: "prepare memory status", parameters: { jsCode: "你可以用 @ai forget me 刪除你在此群組的記憶。" } },
      { name: "build forget me request", parameters: {} },
      { name: "qdrant forget me", parameters: { url: "http://qdrant:6333/collections/whatsapp_memory/points/delete?wait=true" } },
      { name: "prepare forget me response", parameters: { jsCode: "已刪除你在這個群組的 AI 記憶。" } },
    ],
    connections: {
      Switch: {
        main: [
          [{ node: "qdrant search memory", type: "main", index: 0 }],
          [{ node: "prepare memory status", type: "main", index: 0 }],
          [{ node: "build forget me request", type: "main", index: 0 }],
        ],
      },
      "build forget me request": {
        main: [[{ node: "qdrant forget me", type: "main", index: 0 }]],
      },
      "qdrant forget me": {
        main: [[{ node: "prepare forget me response", type: "main", index: 0 }]],
      },
      "prepare forget me response": {
        main: [[{ node: "return message", type: "main", index: 0 }]],
      },
      "qdrant search memory": {
        main: [[{ node: "prepare memory", type: "main", index: 0 }]],
      },
    },
  };

  patchWorkflow(workflow);

  assert.equal(workflow.nodes.some((node) => /forget me/i.test(node.name)), false);
  assert.doesNotMatch(JSON.stringify(workflow), /points\/delete\?wait=true/);
  assert.doesNotMatch(JSON.stringify(workflow), /forget_me|rag-switch-forget-me/);
  assert.doesNotMatch(
    workflow.nodes.find((node) => node.name === "prepare memory status").parameters.jsCode,
    /刪除|删除|forget me/
  );
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

test("local workflow does not include forget-me deletion nodes", () => {
  const workflows = JSON.parse(
    fs.readFileSync("n8n/workflows/workflows.json", "utf8")
  );
  const workflow = Array.isArray(workflows) ? workflows[0] : workflows;
  const serialized = JSON.stringify(workflow);

  assert.equal(workflow.nodes.some((node) => /forget me/i.test(node.name)), false);
  assert.doesNotMatch(serialized, /points\/delete\?wait=true/);
  assert.doesNotMatch(serialized, /forget_me|rag-switch-forget-me/);
  assert.doesNotMatch(
    workflow.nodes.find((node) => node.name === "prepare memory status").parameters.jsCode,
    /刪除|删除|forget me/
  );
});
