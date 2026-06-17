const fs = require("node:fs");
const path = require("node:path");

const WORKFLOW_NAME = "whatsapp bot AI Agent tools";
const QDRANT_COLLECTION = "whatsapp_memory";
const QDRANT_COLLECTION_URL = `http://qdrant:6333/collections/${QDRANT_COLLECTION}`;
const WHATSAPP_BRIDGE_SEND_URL = "http://whatsapp-bridge:3000/send-message";

const expectedNodeNames = Object.freeze([
  "Sticky: Entry and routing",
  "Sticky: Agent core",
  "Sticky: Agent tools",
  "Sticky: Data and memory",
  "Sticky: Output and errors",
  "WhatsApp Webhook",
  "Normalize Payload",
  "Intent Router",
  "Agent Memory Instructions",
  "Agent Context Builder",
  "DeepSeek Chat Model",
  "WhatsApp AI Agent",
  "Structured Reply Parser",
  "Tool: Search Memory",
  "Tool: Embed Memory Record",
  "Format Memory Write Point",
  "Tool: Write Memory",
  "Format Memory Write Result",
  "Tool: Web Search Router",
  "Tool: Brave Search",
  "Tool: Format Brave Results",
  "Tool: Image Generate/Edit",
  "Format Image Result",
  "Tool: Memory Status",
  "Format Memory Status Result",
  "Existing Qdrant Collection",
  "Format Admin Status Result",
  "Member Profile Retriever",
  "Recent Context Store",
  "Compatibility Formatter",
  "Error Fallback",
  "Format WhatsApp Reply",
  "Send WhatsApp Reply",
  "Save Recent AI Turn",
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function node(name, type, position, parameters = {}, extra = {}) {
  return {
    parameters,
    type,
    typeVersion: extra.typeVersion ?? 1,
    position,
    id: extra.id ?? stableId(name),
    name,
    ...extra,
  };
}

function stableId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function sticky(name, position, content, color) {
  return node(
    name,
    "n8n-nodes-base.stickyNote",
    position,
    {
      content,
      height: 420,
      width: 620,
      color,
    },
    { typeVersion: 1 }
  );
}

function connection(nodeName, index = 0) {
  return { node: nodeName, type: "main", index };
}

function buildNormalizePayloadCode() {
  return String.raw`const body = $json.body ?? $json;

return [
  {
    json: {
      raw: body,
      command: body.command || "chat",
      groupId: body.groupId || body.to || body.chatId,
      userId: body.userId || body.author || body.from,
      userName: body.userName || body.pushName || body.notifyName || "",
      text: String(body.text || body.message || body.caption || "").trim(),
      messageId: body.messageId || body.id || "",
      timestamp: Number(body.timestamp || Math.floor(Date.now() / 1000)),
      hasMedia: Boolean(body.hasMedia || body.media),
      media: body.media || null,
    },
  },
];`;
}

function buildAgentContextCode() {
  return String.raw`const input = $json;

function nodeItems(nodeName) {
  try {
    return $items(nodeName).map((item) => item.json || {});
  } catch (error) {
    return [];
  }
}

function firstNodeJson(nodeName) {
  return nodeItems(nodeName)[0] || {};
}

function extractQdrantPayloads(response) {
  const points = response?.result?.points || response?.result || response?.points || [];
  return Array.isArray(points)
    ? points.map((point) => point.payload || point).filter(Boolean)
    : [];
}

function extractBraveResults(response) {
  const results = response?.web?.results || response?.results || [];
  return Array.isArray(results)
    ? results.slice(0, 5).map((result) => ({
        title: result.title || "",
        url: result.url || "",
        description: result.description || result.snippet || "",
      }))
    : [];
}

const normalizedPayload = firstNodeJson("Normalize Payload");
const normalized = {
  ...input,
  ...normalizedPayload,
};
const searchMemory = firstNodeJson("Tool: Search Memory");
const memberProfile = firstNodeJson("Member Profile Retriever");
const recentContext = firstNodeJson("Recent Context Store");
const braveResults = firstNodeJson("Tool: Format Brave Results");
const message = normalizedPayload.text || input.text || input.message || "";
const groupId = normalizedPayload.groupId || input.groupId || input.to || input.chatId || "";
const userId = normalizedPayload.userId || input.userId || input.author || input.from || "";
const userName = normalizedPayload.userName || input.userName || input.pushName || input.notifyName || "";
const webSearchContext = Array.isArray(braveResults.webSearchContext)
  ? braveResults.webSearchContext
  : extractBraveResults(braveResults);

return [
  {
    json: {
      ...input,
      ...normalized,
      text: message,
      groupId,
      userId,
      userName,
      webSearchContext,
      agentContext: {
        message,
        groupId,
        userId,
        userName,
        webSearchContext,
        sender: {
          id: userId,
          name: userName,
        },
        collection: "whatsapp_memory",
        memorySearchContext: extractQdrantPayloads(searchMemory),
        memberProfiles: extractQdrantPayloads(memberProfile),
        recentContext: extractQdrantPayloads(recentContext),
        availableTools: [
          "Tool: Search Memory",
          "Tool: Write Memory",
          "Tool: Brave Search",
          "Tool: Image Generate/Edit",
          "Tool: Memory Status",
        ],
      },
    },
  },
];`;
}

function buildCompatibilityFormatterCode() {
  return String.raw`return $input.all().map((item) => ({
  json: {
    ...item.json,
    memoryCollection: "whatsapp_memory",
    memoryEndpoint: "http://qdrant:6333/collections/whatsapp_memory",
  },
}));`;
}

function buildFormatBraveResultsCode() {
  return String.raw`function extractBraveResults(response) {
  const results = response?.web?.results || response?.results || [];
  return Array.isArray(results)
    ? results.slice(0, 5).map((result) => ({
        title: result.title || "",
        url: result.url || "",
        description: result.description || result.snippet || "",
      }))
    : [];
}

return $input.all().map((item) => ({
  json: {
    ...item.json,
    webSearchContext: extractBraveResults(item.json),
  },
}));`;
}

function buildEmbedMemoryRecordParameters(sourceWorkflow) {
  const sourceEmbedRecord = findSourceNode(sourceWorkflow, "qwen embed record");

  if (sourceEmbedRecord?.parameters) {
    return clone(sourceEmbedRecord.parameters);
  }

  return {
    method: "POST",
    url: "={{ $env.EMBEDDING_URL }}",
    sendHeaders: true,
    headerParameters: {
      parameters: [
        {
          name: "Authorization",
          value: '={{ "Bearer " + $env.EMBEDDING_API_KEY }}',
        },
        {
          name: "Content-Type",
          value: "application/json",
        },
      ],
    },
    sendBody: true,
    specifyBody: "json",
    jsonBody: '={\n  "model": "{{ $env.EMBEDDING_MODEL }}",\n  "input": "{{ $json.text }}"\n}',
    options: {},
  };
}

function buildEmbedMemoryRecordExtra(sourceWorkflow) {
  const sourceEmbedRecord = findSourceNode(sourceWorkflow, "qwen embed record");
  const safeExtra = {
    typeVersion: sourceEmbedRecord?.typeVersion ?? 4.4,
    onError: "continueRegularOutput",
  };

  if (sourceEmbedRecord?.credentials && Object.keys(sourceEmbedRecord.credentials).length > 0) {
    safeExtra.credentials = clone(sourceEmbedRecord.credentials);
  }

  return safeExtra;
}

function buildWebSearchRouterParameters() {
  return {
    conditions: {
      options: {
        caseSensitive: false,
        leftValue: "",
        typeValidation: "strict",
        version: 3,
      },
      conditions: [
        {
          id: "ai-agent-tools-web-search-trigger",
          leftValue: "={{ $json.text || '' }}",
          rightValue:
            "(current|fresh|news|latest|recent|api|version|price|status|today|now|update|updates|release|pricing|cost|stock|weather)",
          operator: {
            type: "string",
            operation: "regex",
            name: "filter.operator.regex",
          },
        },
      ],
      combinator: "and",
    },
    options: {},
  };
}

function buildStructuredReplyParserCode() {
  return String.raw`const response = $json.output || $json.text || $json.message || "";
let parsed = null;

if (typeof response === "string") {
  try {
    parsed = JSON.parse(response);
  } catch (error) {
    parsed = { text: response };
  }
}

const reply = parsed && typeof parsed === "object" ? parsed : { text: String(response || "") };

return [
  {
    json: {
      ...$json,
      replyText: String(reply.text || reply.message || "").trim(),
      replyType: reply.type || "text",
      imagePayload: reply.imagePayload || null,
      memoryAction: reply.memoryAction || null,
    },
  },
];`;
}

function buildFormatMemoryWritePointCode() {
  return String.raw`const input = $json || {};
let embeddingResponse = {};
let original = {};

try {
  embeddingResponse = $("Tool: Embed Memory Record").first().json || {};
} catch (error) {
  embeddingResponse = input;
}

try {
  original = $("Normalize Payload").first().json || {};
} catch (error) {
  original = input;
}

const vector = embeddingResponse.data?.[0]?.embedding || embeddingResponse.embedding || input.data?.[0]?.embedding;

if (!Array.isArray(vector) || vector.length === 0) {
  throw new Error("Embedding missing for memory write; refusing to upsert an empty vector.");
}

const groupId = original.groupId || input.groupId || "";
const userId = original.userId || input.userId || "";
const userName = original.userName || input.userName || "";
const text = String(original.text || input.text || input.message || "").trim();
const timestamp = original.timestamp || input.timestamp || Math.floor(Date.now() / 1000);
const id = original.messageId || input.messageId || [groupId, userId, timestamp].join(":");

return [
  {
    json: {
      ...original,
      ...input,
      memoryPoint: {
        points: [
          {
            id,
            vector,
            payload: {
              type: "whatsapp_message",
              groupId,
              userId,
              userName,
              text,
              timestamp,
            },
          },
        ],
      },
    },
  },
];`;
}

function buildOriginalPayloadAccessorCode() {
  return String.raw`function originalPayload() {
  try {
    return $("Normalize Payload").first().json || {};
  } catch (error) {
    return {};
  }
}

const original = originalPayload();
const response = $json || {};`;
}

function buildMemoryWriteResultCode() {
  return `${buildOriginalPayloadAccessorCode()}
const failed = Boolean(response.error || response.message?.error);
const replyText = failed
  ? "記低唔成功，等陣再試。"
  : "記低咗。";

return [
  {
    json: {
      ...original,
      groupId: original.groupId || response.groupId || "",
      userId: original.userId || response.userId || "",
      text: original.text || response.text || "",
      replyText,
      replyType: "text",
      message: replyText,
    },
  },
];`;
}

function buildMemoryStatusResultCode() {
  return `${buildOriginalPayloadAccessorCode()}
const failed = Boolean(response.error || response.message?.error);
const pointsCount = response.result?.points_count ?? response.result?.pointsCount ?? response.points_count;
const vectorsCount = response.result?.vectors_count ?? response.result?.vectorsCount ?? response.vectors_count;
const status = response.result?.status || response.status || "";
const details = [
  status ? \`狀態：\${status}\` : "",
  pointsCount !== undefined ? \`記憶數量：\${pointsCount}\` : "",
  vectorsCount !== undefined ? \`向量數量：\${vectorsCount}\` : "",
].filter(Boolean).join("\\n");
const replyText = failed
  ? "暫時查唔到記憶狀態。"
  : details || "記憶庫連線正常。";

return [
  {
    json: {
      ...original,
      groupId: original.groupId || response.groupId || "",
      userId: original.userId || response.userId || "",
      text: original.text || response.text || "",
      replyText,
      replyType: "text",
      message: replyText,
    },
  },
];`;
}

function buildImageResultCode() {
  return `${buildOriginalPayloadAccessorCode()}
const failed = Boolean(response.error || response.message?.error);
const imageUrl =
  response.data?.[0]?.url ||
  response.result?.url ||
  response.url ||
  response.imageUrl ||
  "";
const imagePayload = response.data?.[0] || response.result || response.imagePayload || null;
const replyText = failed
  ? "圖片處理暫時失敗，等陣再試。"
  : imageUrl
    ? \`圖片準備好：\${imageUrl}\`
    : "圖片請求已處理。";

return [
  {
    json: {
      ...original,
      groupId: original.groupId || response.groupId || "",
      userId: original.userId || response.userId || "",
      text: original.text || response.text || "",
      replyText,
      replyType: imageUrl ? "image" : "text",
      imagePayload,
      message: replyText,
    },
  },
];`;
}

function buildAdminStatusResultCode() {
  return `${buildOriginalPayloadAccessorCode()}
const failed = Boolean(response.error || response.message?.error);
const collectionName = response.result?.config?.params?.vectors ? "whatsapp_memory" : "whatsapp_memory";
const pointsCount = response.result?.points_count ?? response.result?.pointsCount ?? response.points_count;
const status = response.result?.status || response.status || "";
const replyText = failed
  ? "暫時查唔到管理狀態。"
  : [
      \`Collection：\${collectionName}\`,
      status ? \`狀態：\${status}\` : "",
      pointsCount !== undefined ? \`記憶數量：\${pointsCount}\` : "",
    ].filter(Boolean).join("\\n") || "管理檢查完成。";

return [
  {
    json: {
      ...original,
      groupId: original.groupId || response.groupId || "",
      userId: original.userId || response.userId || "",
      text: original.text || response.text || "",
      replyText,
      replyType: "text",
      message: replyText,
    },
  },
];`;
}

function buildFormatReplyCode() {
  return String.raw`const fallback = "我而家有少少甩轆，等陣再試。";

return [
  {
    json: {
      to: $json.groupId,
      groupId: $json.groupId,
      userId: $json.userId,
      question: $json.text,
      message: $json.replyText || fallback,
      type: $json.replyType || "text",
      imagePayload: $json.imagePayload || null,
      originalMessageId: $json.messageId || "",
    },
  },
];`;
}

function buildSaveRecentTurnCode() {
  return String.raw`const staticData = $getWorkflowStaticData("global");
const key = [$json.to, $json.userId].filter(Boolean).join(":") || $json.to || "default";
const turns = staticData.aiTurnBuffer ?? {};
staticData.aiTurnBuffer = turns;

turns[key] = (Array.isArray(turns[key]) ? turns[key] : [])
  .concat([
    {
      answer: $json.message,
      question: $json.question,
      savedAt: Date.now(),
    },
  ])
  .slice(-6);

return [{ json: { saved: true, to: $json.to } }];`;
}

function buildFallbackCode() {
  return String.raw`return [
  {
    json: {
      groupId: $json.groupId,
      replyText: "我而家有少少甩轆，等陣再試。",
      replyType: "text",
    },
  },
];`;
}

function findSourceNode(sourceWorkflow, name) {
  return (sourceWorkflow.nodes || []).find((item) => item.name === name);
}

function buildDeepSeekChatModelExtra(sourceWorkflow) {
  return {
    typeVersion: 1.2,
    credentials: {
      openAiApi: {
        id: "REPLACE_WITH_DEEPSEEK_OPENAI_CREDENTIAL",
        name: "DeepSeek OpenAI-compatible credential",
      },
    },
  };
}

function buildNodes(sourceWorkflow) {
  const sourceWebhook = (sourceWorkflow.nodes || []).find((item) => item.type === "n8n-nodes-base.webhook");
  const webhookPath = sourceWebhook?.parameters?.path || "whatsapp-trigger";

  return [
    sticky(
      "Sticky: Entry and routing",
      [-820, -260],
      "## Entry and routing\nReceive WhatsApp payloads, normalize fields, and route chat, record, memory, image, admin, and fallback intents.",
      4
    ),
    sticky(
      "Sticky: Agent core",
      [180, -340],
      "## Agent core\nUse a central WhatsApp AI Agent with a DeepSeek-compatible chat model, explicit memory instructions, and structured replies.",
      5
    ),
    sticky(
      "Sticky: Agent tools",
      [-120, 500],
      "## Agent tools\nExpose memory search, memory writes, Brave search, image actions, and status checks as focused tool branches.",
      6
    ),
    sticky(
      "Sticky: Data and memory",
      [-980, 500],
      "## Data and memory\nKeep the existing Qdrant collection whatsapp_memory intact and adapt schemas in small compatibility nodes.",
      3
    ),
    sticky(
      "Sticky: Output and errors",
      [980, -260],
      "## Output and errors\nFormat bridge replies, send them through the WhatsApp bridge, save recent AI turns, and fail softly.",
      7
    ),
    node(
      "WhatsApp Webhook",
      "n8n-nodes-base.webhook",
      [-720, 0],
      {
        httpMethod: "POST",
        path: webhookPath,
        options: {},
      },
      { typeVersion: 2.1, webhookId: "ai-agent-tools-whatsapp-trigger" }
    ),
    node(
      "Normalize Payload",
      "n8n-nodes-base.code",
      [-500, 0],
      { jsCode: buildNormalizePayloadCode() },
      { typeVersion: 2 }
    ),
    node(
      "Intent Router",
      "n8n-nodes-base.switch",
      [-280, 0],
      {
        rules: {
          values: [
            switchRule("chat"),
            switchRule("record"),
            switchRule("memory_status"),
            switchRule("image"),
            switchRule("admin"),
          ],
        },
        options: {
          fallbackOutput: "extra",
        },
      },
      { typeVersion: 3.3 }
    ),
    node(
      "Agent Memory Instructions",
      "n8n-nodes-base.set",
      [160, -160],
      {
        assignments: {
          assignments: [
            {
              id: "agent-memory-instructions",
              name: "systemInstructions",
              type: "string",
              value:
                "Use WhatsApp group memory only when it is relevant. Do not expose raw private history unless the user explicitly asks for exact wording. Keep replies natural, concise, and safe.",
            },
          ],
        },
        options: {},
      },
      { typeVersion: 3.4 }
    ),
    node(
      "Agent Context Builder",
      "n8n-nodes-base.code",
      [380, 0],
      { jsCode: buildAgentContextCode() },
      { typeVersion: 2 }
    ),
    node(
      "DeepSeek Chat Model",
      "@n8n/n8n-nodes-langchain.lmChatOpenAi",
      [380, -240],
      {
        model: "deepseek-v4-flash",
        options: {
          baseURL: "https://api.deepseek.com",
        },
      },
      buildDeepSeekChatModelExtra(sourceWorkflow)
    ),
    node(
      "WhatsApp AI Agent",
      "@n8n/n8n-nodes-langchain.agent",
      [620, 0],
      {
        promptType: "define",
        text: "={{ $json.agentContext.message }}",
        options: {
          systemMessage: "={{ $json.systemInstructions || 'You are a WhatsApp group AI assistant.' }}",
        },
      },
      { typeVersion: 1.8 }
    ),
    node(
      "Structured Reply Parser",
      "n8n-nodes-base.code",
      [860, 0],
      { jsCode: buildStructuredReplyParserCode() },
      { typeVersion: 2 }
    ),
    node(
      "Tool: Search Memory",
      "n8n-nodes-base.httpRequest",
      [-60, 260],
      {
        method: "POST",
        url: `${QDRANT_COLLECTION_URL}/points/scroll`,
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          '={{ { limit: 8, with_payload: true, with_vector: false, filter: { must: [{ key: "groupId", match: { value: $json.groupId } }, { key: "type", match: { value: "whatsapp_message" } }] } } }}',
        options: {},
      },
      { typeVersion: 4.4, onError: "continueRegularOutput" }
    ),
    node(
      "Tool: Embed Memory Record",
      "n8n-nodes-base.httpRequest",
      [-280, 460],
      buildEmbedMemoryRecordParameters(sourceWorkflow),
      buildEmbedMemoryRecordExtra(sourceWorkflow)
    ),
    node(
      "Format Memory Write Point",
      "n8n-nodes-base.code",
      [-60, 460],
      { jsCode: buildFormatMemoryWritePointCode() },
      { typeVersion: 2 }
    ),
    node(
      "Tool: Write Memory",
      "n8n-nodes-base.httpRequest",
      [180, 460],
      {
        method: "PUT",
        url: `${QDRANT_COLLECTION_URL}/points?wait=true`,
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ $json.memoryPoint }}",
        options: {},
      },
      { typeVersion: 4.4, onError: "continueRegularOutput" }
    ),
    node(
      "Format Memory Write Result",
      "n8n-nodes-base.code",
      [420, 460],
      { jsCode: buildMemoryWriteResultCode() },
      { typeVersion: 2 }
    ),
    node(
      "Tool: Web Search Router",
      "n8n-nodes-base.if",
      [-100, 620],
      buildWebSearchRouterParameters(),
      { typeVersion: 2.3 }
    ),
    node(
      "Tool: Brave Search",
      "n8n-nodes-base.httpRequest",
      [-60, 660],
      {
        method: "GET",
        url: "https://api.search.brave.com/res/v1/web/search",
        sendQuery: true,
        queryParameters: {
          parameters: [
            {
              name: "q",
              value: "={{ $json.text }}",
            },
          ],
        },
        sendHeaders: true,
        headerParameters: {
          parameters: [
            {
              name: "X-Subscription-Token",
              value: "={{ $env.BRAVE_SEARCH_API_KEY }}",
            },
          ],
        },
        options: {},
      },
      { typeVersion: 4.4, onError: "continueRegularOutput" }
    ),
    node(
      "Tool: Format Brave Results",
      "n8n-nodes-base.code",
      [180, 660],
      { jsCode: buildFormatBraveResultsCode() },
      { typeVersion: 2 }
    ),
    node(
      "Tool: Image Generate/Edit",
      "n8n-nodes-base.httpRequest",
      [-60, 860],
      {
        method: "POST",
        url: "={{ $env.IMAGE_PROVIDER_URL || 'https://api.openai.com/v1/images/generations' }}",
        sendBody: true,
        specifyBody: "json",
        jsonBody: '={{ { prompt: $json.text, image: $json.media } }}',
        options: {},
      },
      { typeVersion: 4.4, onError: "continueRegularOutput" }
    ),
    node(
      "Format Image Result",
      "n8n-nodes-base.code",
      [180, 860],
      { jsCode: buildImageResultCode() },
      { typeVersion: 2 }
    ),
    node(
      "Tool: Memory Status",
      "n8n-nodes-base.httpRequest",
      [-60, 1060],
      {
        method: "GET",
        url: QDRANT_COLLECTION_URL,
        options: {},
      },
      { typeVersion: 4.4, onError: "continueRegularOutput" }
    ),
    node(
      "Format Memory Status Result",
      "n8n-nodes-base.code",
      [180, 1060],
      { jsCode: buildMemoryStatusResultCode() },
      { typeVersion: 2 }
    ),
    node(
      "Existing Qdrant Collection",
      "n8n-nodes-base.httpRequest",
      [-820, 620],
      {
        method: "GET",
        url: QDRANT_COLLECTION_URL,
        options: {},
      },
      { typeVersion: 4.4, onError: "continueRegularOutput" }
    ),
    node(
      "Format Admin Status Result",
      "n8n-nodes-base.code",
      [-580, 820],
      { jsCode: buildAdminStatusResultCode() },
      { typeVersion: 2 }
    ),
    node(
      "Member Profile Retriever",
      "n8n-nodes-base.httpRequest",
      [-580, 620],
      {
        method: "POST",
        url: `${QDRANT_COLLECTION_URL}/points/scroll`,
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          '={{ { limit: 20, with_payload: true, with_vector: false, filter: { must: [{ key: "groupId", match: { value: $json.groupId } }, { key: "type", match: { value: "member_profile" } }] } } }}',
        options: {},
      },
      { typeVersion: 4.4, onError: "continueRegularOutput" }
    ),
    node(
      "Recent Context Store",
      "n8n-nodes-base.httpRequest",
      [-340, 620],
      {
        method: "POST",
        url: `${QDRANT_COLLECTION_URL}/points/scroll`,
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          '={{ { limit: 80, with_payload: true, with_vector: false, filter: { must: [{ key: "groupId", match: { value: $json.groupId } }] } } }}',
        options: {},
      },
      { typeVersion: 4.4, onError: "continueRegularOutput" }
    ),
    node(
      "Compatibility Formatter",
      "n8n-nodes-base.code",
      [420, 620],
      { jsCode: buildCompatibilityFormatterCode() },
      { typeVersion: 2 }
    ),
    node(
      "Error Fallback",
      "n8n-nodes-base.code",
      [1040, 240],
      { jsCode: buildFallbackCode() },
      { typeVersion: 2 }
    ),
    node(
      "Format WhatsApp Reply",
      "n8n-nodes-base.code",
      [1100, 0],
      { jsCode: buildFormatReplyCode() },
      { typeVersion: 2 }
    ),
    node(
      "Send WhatsApp Reply",
      "n8n-nodes-base.httpRequest",
      [1320, 0],
      {
        method: "POST",
        url: WHATSAPP_BRIDGE_SEND_URL,
        sendBody: true,
        bodyParameters: {
          parameters: [
            {
              name: "to",
              value: "={{ $json.to }}",
            },
            {
              name: "message",
              value: "={{ $json.message }}",
            },
          ],
        },
        options: {},
      },
      { typeVersion: 4.4, onError: "continueRegularOutput" }
    ),
    node(
      "Save Recent AI Turn",
      "n8n-nodes-base.code",
      [1540, 0],
      { jsCode: buildSaveRecentTurnCode() },
      { typeVersion: 2 }
    ),
  ];
}

function switchRule(command) {
  return {
    conditions: {
      options: {
        caseSensitive: true,
        leftValue: "",
        typeValidation: "strict",
        version: 3,
      },
      conditions: [
        {
          leftValue: "={{ $json.command }}",
          rightValue: command,
          operator: {
            type: "string",
            operation: "equals",
            name: "filter.operator.equals",
          },
        },
      ],
      combinator: "and",
    },
  };
}

function buildConnections() {
  return {
    "WhatsApp Webhook": {
      main: [[connection("Normalize Payload")]],
    },
    "Normalize Payload": {
      main: [[connection("Intent Router")]],
    },
    "Intent Router": {
      main: [
        [connection("Tool: Search Memory")],
        [connection("Tool: Embed Memory Record")],
        [connection("Tool: Memory Status")],
        [connection("Tool: Image Generate/Edit")],
        [connection("Existing Qdrant Collection")],
        [connection("Error Fallback")],
      ],
    },
    "Tool: Search Memory": {
      main: [[connection("Member Profile Retriever")]],
    },
    "Member Profile Retriever": {
      main: [[connection("Recent Context Store")]],
    },
    "Recent Context Store": {
      main: [[connection("Tool: Web Search Router")]],
    },
    "Tool: Web Search Router": {
      main: [[connection("Tool: Brave Search")], [connection("Compatibility Formatter")]],
    },
    "Tool: Brave Search": {
      main: [[connection("Tool: Format Brave Results")]],
    },
    "Tool: Format Brave Results": {
      main: [[connection("Compatibility Formatter")]],
    },
    "Compatibility Formatter": {
      main: [[connection("Agent Memory Instructions")]],
    },
    "Tool: Embed Memory Record": {
      main: [[connection("Format Memory Write Point")]],
    },
    "Format Memory Write Point": {
      main: [[connection("Tool: Write Memory")]],
    },
    "Tool: Write Memory": {
      main: [[connection("Format Memory Write Result")]],
    },
    "Format Memory Write Result": {
      main: [[connection("Format WhatsApp Reply")]],
    },
    "Tool: Memory Status": {
      main: [[connection("Format Memory Status Result")]],
    },
    "Format Memory Status Result": {
      main: [[connection("Format WhatsApp Reply")]],
    },
    "Tool: Image Generate/Edit": {
      main: [[connection("Format Image Result")]],
    },
    "Format Image Result": {
      main: [[connection("Format WhatsApp Reply")]],
    },
    "Existing Qdrant Collection": {
      main: [[connection("Format Admin Status Result")]],
    },
    "Format Admin Status Result": {
      main: [[connection("Format WhatsApp Reply")]],
    },
    "Agent Memory Instructions": {
      main: [[connection("Agent Context Builder")]],
    },
    "Agent Context Builder": {
      main: [[connection("WhatsApp AI Agent")]],
    },
    "DeepSeek Chat Model": {
      ai_languageModel: [[{ node: "WhatsApp AI Agent", type: "ai_languageModel", index: 0 }]],
    },
    "WhatsApp AI Agent": {
      main: [[connection("Structured Reply Parser")]],
    },
    "Structured Reply Parser": {
      main: [[connection("Format WhatsApp Reply")]],
    },
    "Error Fallback": {
      main: [[connection("Format WhatsApp Reply")]],
    },
    "Format WhatsApp Reply": {
      main: [[connection("Send WhatsApp Reply")]],
    },
    "Send WhatsApp Reply": {
      main: [[connection("Save Recent AI Turn")]],
    },
  };
}

function buildAiAgentToolsWorkflow(sourceWorkflow) {
  const workflow = {
    updatedAt: sourceWorkflow.updatedAt || "2026-06-16T00:00:00.000Z",
    createdAt: sourceWorkflow.createdAt || "2026-06-16T00:00:00.000Z",
    id: "whatsapp-bot-ai-agent-tools",
    name: WORKFLOW_NAME,
    description:
      "Generated redesign of the WhatsApp bot workflow around an AI Agent with focused memory, search, image, and reply tools.",
    active: false,
    isArchived: false,
    nodes: buildNodes(sourceWorkflow),
    connections: buildConnections(),
    settings: sourceWorkflow.settings ? clone(sourceWorkflow.settings) : {},
    staticData: null,
    pinData: {},
    tags: [],
  };

  return workflow;
}

function buildWorkflowExport(sourceWorkflow) {
  return [buildAiAgentToolsWorkflow(sourceWorkflow)];
}

function main() {
  const workflowsPath = path.resolve(__dirname, "..", "n8n", "workflows", "workflows.json");
  const outputPath = path.resolve(__dirname, "..", "n8n", "workflows", "ai-agent-tools-redesign.json");
  const workflowExport = JSON.parse(fs.readFileSync(workflowsPath, "utf8"));
  const sourceWorkflow = Array.isArray(workflowExport) ? workflowExport[0] : workflowExport;
  const output = buildWorkflowExport(sourceWorkflow);

  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${outputPath}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildAiAgentToolsWorkflow,
  buildWorkflowExport,
  expectedNodeNames,
};
