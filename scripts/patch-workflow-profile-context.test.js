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

test("buildPrepareMemoryCode loads private prompt config", () => {
  const code = buildPrepareMemoryCode();

  assert.match(code, /memory-prompts\.json/);
  assert.match(code, /promptConfig\.strings/);
  assert.match(code, /memberProfileMemories/);
  assert.doesNotMatch(code, /groupProfileMemories/);
  assert.doesNotMatch(code, /retrievedGroupProfiles/);
  assert.doesNotMatch(code, /group_profile/);
});

test("buildPrepareMemoryCode keeps routing and model logic without inline prompts", () => {
  const code = buildPrepareMemoryCode();

  assert.match(code, /STRONG_RESPONSE_MODEL = "deepseek-v4-pro"/);
  assert.match(code, /needsStrongResponseModel/);
  assert.match(code, /groupHistoryRequested/);
  assert.match(code, /responseModel/);
  assert.match(code, /format_semantic_memory_/);
  assert.match(code, /set_persona_policy_/);
});

test("buildPrepareMemoryCode builds reply assist fields from private prompts", () => {
  const code = buildPrepareMemoryCode();

  assert.match(code, /qdrant scroll recent reply context/);
  assert.match(code, /isReplyAssistRequest/);
  assert.match(code, /recentReplyContext/);
  assert.match(code, /selectOwnMemberProfileForReplyAssist/);
  assert.match(code, /replyAssistTargetProfile/);
  assert.match(code, /format_recent_context_/);
  assert.match(code, /responseMode: isReplyAssist \? "reply_assist" : "chat"/);
});

test("buildPrepareMemoryCode filters profile and raw history exposure", () => {
  const code = buildPrepareMemoryCode();

  assert.match(code, /selectMemberProfilesForQuestion/);
  assert.match(code, /isImitationRequest/);
  assert.match(code, /selectedProfiles: \[\]/);
  assert.match(code, /matchedTargetName/);
  assert.match(code, /retrievedMemberProfiles: selectedMemberProfileMemories/);
  assert.match(code, /select_member_profiles_/);
  assert.match(code, /format_semantic_memory_/);
});

test("buildPrepareMemoryCode keeps member alias matching rules private", () => {
  const code = buildPrepareMemoryCode();

  assert.match(code, /memberAliasMap/);
  assert.match(code, /vincy/);
  assert.match(code, /cvvc/);
  assert.match(code, /kelvincheng/);
  assert.match(code, /riley/);
  assert.match(code, /stone/);
  assert.match(code, /select_member_profiles_/);
});

test("web search context upgrades final response model to pro", () => {
  const code = buildAppendWebSearchContextCode();

  assert.match(code, /STRONG_RESPONSE_MODEL = "deepseek-v4-pro"/);
  assert.match(code, /input\.webSearch\?\.shouldSearch/);
  assert.match(code, /responseModel: webSearchContext \|\| input\.webSearch\?\.shouldSearch/);
});

test("buildSearchClassifierRequestCode asks DeepSeek to decide search need by task type", () => {
  const code = buildSearchClassifierRequestCode();

  assert.match(code, /searchClassifierMessages/);
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
  assert.match(buildAppendWebSearchContextCode(), /webSearchContext/);
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
  assert.match(prepareCode, /format_recent_context_/);
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

test("patchWorkflow applies compact neutral presentation layout", () => {
  const workflow = {
    nodes: [
      { name: "Webhook", parameters: {}, type: "webhook", typeVersion: 1, position: [0, 0], id: "webhook" },
      { name: "Switch", parameters: {}, type: "switch", typeVersion: 1, position: [0, 0], id: "switch" },
      { name: "qwen embed question", parameters: {}, type: "http", typeVersion: 1, position: [0, 0], id: "embed-question" },
      { name: "build qdrant search", parameters: {}, type: "code", typeVersion: 1, position: [0, 0], id: "build-search" },
      { name: "qdrant search memory", parameters: {}, type: "http", typeVersion: 1, position: [0, 0], id: "search" },
      { name: "prepare memory", parameters: { jsCode: "old" }, type: "code", typeVersion: 1, position: [0, 0], id: "prepare" },
      { name: "Deepseek", parameters: {}, type: "http", typeVersion: 1, position: [0, 0], id: "deepseek" },
      { name: "save memory", parameters: {}, type: "code", typeVersion: 1, position: [0, 0], id: "save" },
      { name: "return message", parameters: {}, type: "http", typeVersion: 1, position: [0, 0], id: "return" },
      { name: "prepare image binary", parameters: {}, type: "code", typeVersion: 1, position: [0, 0], id: "image-binary" },
      { name: "Gpt-image2", parameters: {}, type: "http", typeVersion: 1, position: [0, 0], id: "image-generate" },
      { name: "edit Gpt image2", parameters: {}, type: "http", typeVersion: 1, position: [0, 0], id: "image-edit" },
      { name: "return image", parameters: {}, type: "http", typeVersion: 1, position: [0, 0], id: "return-image" },
      { name: "prepare memory point", parameters: {}, type: "code", typeVersion: 1, position: [0, 0], id: "memory-point" },
      { name: "qwen embed record", parameters: {}, type: "http", typeVersion: 1, position: [0, 0], id: "embed-record" },
      { name: "build qdrant record point", parameters: {}, type: "code", typeVersion: 1, position: [0, 0], id: "record-point" },
      { name: "qdrant upsert memory", parameters: {}, type: "http", typeVersion: 1, position: [0, 0], id: "upsert" },
      { name: "prepare memory status", parameters: {}, type: "code", typeVersion: 1, position: [0, 0], id: "status" },
      { name: "qdrant init collection", parameters: {}, type: "http", typeVersion: 1, position: [0, 0], id: "init" },
    ],
    connections: {
      "qdrant search memory": { main: [[{ node: "prepare memory", type: "main", index: 0 }]] },
    },
  };

  patchWorkflow(workflow);

  const stickyNotes = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.stickyNote");
  assert.equal(stickyNotes.length, 4);
  assert.ok(stickyNotes.every((node) => node.parameters.color === 7));
  assert.ok(stickyNotes.some((node) => /Main Chat Brain/.test(node.parameters.content)));
  assert.ok(stickyNotes.some((node) => /Image/.test(node.parameters.content)));
  assert.ok(stickyNotes.some((node) => /Memory & Status/.test(node.parameters.content)));
  assert.ok(stickyNotes.some((node) => /Setup/.test(node.parameters.content)));
  assert.deepEqual(workflow.nodes.find((node) => node.name === "prepare memory").position, [1200, -180]);
  assert.deepEqual(workflow.nodes.find((node) => node.name === "Deepseek").position, [2640, -180]);
  assert.deepEqual(workflow.nodes.find((node) => node.name === "return message").position, [3120, -180]);
  assert.deepEqual(workflow.nodes.find((node) => node.name === "prepare image binary").position, [0, 420]);
  assert.deepEqual(workflow.nodes.find((node) => node.name === "qdrant init collection").position, [-760, 800]);
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
      { name: "prepare memory status", parameters: { jsCode: "memory status response" } },
      { name: "build forget me request", parameters: {} },
      { name: "qdrant forget me", parameters: { url: "http://qdrant:6333/collections/whatsapp_memory/points/delete?wait=true" } },
      { name: "prepare forget me response", parameters: { jsCode: "forget me response" } },
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
  const memoryStatusNode = workflow.nodes.find((node) => node.name === "prepare memory status");
  if (memoryStatusNode) {
    assert.doesNotMatch(memoryStatusNode.parameters.jsCode, /delete|forget me/i);
  }
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
  assert.ok(errorNode.parameters.jsCode.length > 0);
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
  const memoryStatusNode = workflow.nodes.find((node) => node.name === "prepare memory status");
  if (memoryStatusNode) {
    assert.doesNotMatch(memoryStatusNode.parameters.jsCode, /delete|forget me/i);
  }
});
