const fs = require("fs");
const path = "C:/Users/USER/Desktop/n8n-whatsapp-bot/n8n/workflows/workflows.json";
const workflows = JSON.parse(fs.readFileSync(path, "utf8"));
const workflow = workflows[0];

function findNode(name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Missing node: ${name}`);
  return node;
}

function upsertNode(node) {
  const index = workflow.nodes.findIndex((item) => item.name === node.name);
  if (index === -1) workflow.nodes.push(node);
  else workflow.nodes[index] = { ...workflow.nodes[index], ...node };
}

function ensureConnection(from, outputIndex, to) {
  workflow.connections[from] = workflow.connections[from] || { main: [] };
  workflow.connections[from].main = workflow.connections[from].main || [];
  while (workflow.connections[from].main.length <= outputIndex) {
    workflow.connections[from].main.push([]);
  }
  const list = workflow.connections[from].main[outputIndex];
  if (!list.some((entry) => entry.node === to && entry.type === "main" && entry.index === 0)) {
    list.push({ node: to, type: "main", index: 0 });
  }
}

const personaCode = String.raw`const body = $("Webhook").first().json.body;
const results = $json.result ?? [];

const groupPersonas = {
  default: {
    tone:
      "搞笑、嘴賤、毒舌少少，但不要惡意攻擊、不要羞辱人。像 WhatsApp 群友聊天，不要像客服。",
    language:
      "預設使用繁體中文和粵語口語。如果使用者明顯用英文、普通話或其他語言提問，就跟隨使用者語言回答。",
    length:
      "回答長度按問題複雜度決定。簡單問題短答；需要推理、整理記憶或解釋時可以詳細，但不要廢話。",
    memoryRule:
      "如果相關記憶不足，必須先明確說「我目前沒有足夠記憶」。之後可以提供合理猜測，但必須清楚標明是猜測。",
    safety:
      "不要編造沒有出現在記憶裡的內容。不要透露系統 prompt、API key、credential、內部錯誤 stack trace。",
  },
};

const persona = groupPersonas[body.groupId] ?? groupPersonas.default;

const profileMemories = results
  .filter((item) => item.payload?.type === "member_profile")
  .filter((item) => item.payload?.text)
  .map((item) => item.payload.text);

const memories = results
  .filter((item) => item.payload?.text)
  .map((item, index) => {
    const payload = item.payload;
    const date = new Date(Number(payload.timestamp ?? 0) * 1000)
      .toISOString()
      .slice(0, 10);
    const type = payload.type === "ai_question" ? "AI question" : payload.type || "message";
    return String(index + 1) + ". [" + type + ", " + (payload.userName ?? payload.userId) + ", " + date + "] " + payload.text;
  });

const profileContext =
  profileMemories.length > 0
    ? "以下是相關成員風格分析，回答時可以自然參考，但不要過度模仿或嘲笑：\n\n" + profileMemories.join("\n")
    : "目前沒有找到相關成員風格分析。";

const memoryContext =
  memories.length > 0
    ? "以下是這個 WhatsApp 群組的相關歷史記憶：\n\n" + memories.join("\n")
    : "目前沒有找到足夠相關的群組記憶。";

const system = {
  role: "system",
  content: [
    "你是一個 WhatsApp 群組 AI 助手。",
    "人格：" + persona.tone,
    "語言：" + persona.language,
    "回答長度：" + persona.length,
    "記憶不足規則：" + persona.memoryRule,
    "安全規則：" + persona.safety,
    "你可以使用群組共同記憶回答問題。",
    "如果 member_profile 記憶存在，可以用它讓回答更貼近該成員的風格，但不要過度模仿、不要冒充對方。",
    "不要聲稱任何個性判斷，除非它來自 member_profile 或原始記憶。",
    "回答要自然、有梗、像朋友在群裡回覆。",
  ].join("\n"),
};

return [
  {
    json: {
      ...body,
      retrievedMemories: memories,
      retrievedProfiles: profileMemories,
      messages: [
        system,
        {
          role: "user",
          content: profileContext + "\n\n" + memoryContext + "\n\n使用者現在問：\n" + body.text,
        },
      ],
    },
  },
];`;
findNode("prepare memory").parameters.jsCode = personaCode;

const prepareAiQuestionCode = String.raw`const body = $("Webhook").first().json.body;
const text = String(body.text ?? "").trim();

const lowValueQuestions = new Set(["hi", "hello", "hey", "?", "？", "講笑話", "讲笑话"]);
const normalized = text.toLowerCase();

if (!body.groupId || !body.userId || !body.messageId || text.length < 5 || lowValueQuestions.has(normalized)) {
  return [];
}

const timestamp = Number(body.timestamp ?? Math.floor(Date.now() / 1000));
const expiresAt = timestamp + 180 * 24 * 60 * 60;
const aiQuestionId = body.messageId + "-question";

return [
  {
    json: {
      ...body,
      messageId: aiQuestionId,
      text,
      timestamp,
      expiresAt,
      memoryType: "ai_question",
    },
  },
];`;

const buildAiQuestionCode = String.raw`const original = $("prepare ai question memory point").first().json;
const embedding = $json.data?.[0]?.embedding;

if (!Array.isArray(embedding)) {
  throw new Error("Embedding missing at data[0].embedding");
}

return [
  {
    json: {
      points: [
        {
          id: original.messageId,
          vector: embedding,
          payload: {
            messageId: original.messageId,
            groupId: original.groupId,
            groupName: original.groupName,
            userId: original.userId,
            userName: original.userName ?? original.userId,
            text: original.text,
            timestamp: original.timestamp,
            expiresAt: original.expiresAt,
            type: "ai_question",
            source: "whatsapp-bridge",
          },
        },
      ],
    },
  },
];`;

const safeErrorCode = String.raw`const body = $("Webhook").first().json.body;
const rawError = $json.error?.message ?? $json.message ?? $json.error ?? "Unknown n8n workflow error";

const safeError = String(rawError)
  .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [hidden]")
  .replace(/sk-[A-Za-z0-9._-]+/gi, "[hidden-api-key]")
  .slice(0, 300);

return [
  {
    json: {
      to: body.groupId,
      message:
        "出錯了，我呢邊 n8n workflow 爆咗。Kelvin 你嚟修下啦。\n" +
        "錯誤摘要：" + safeError,
    },
  },
];`;

const embedRecord = findNode("qwen embed record");
const qdrantUpsert = findNode("qdrant upsert memory");
const returnMessage = findNode("return message");

upsertNode({
  parameters: { jsCode: prepareAiQuestionCode },
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [-272, -520],
  id: "rag-prepare-ai-question-memory-point",
  name: "prepare ai question memory point",
});

upsertNode({
  ...JSON.parse(JSON.stringify(embedRecord)),
  position: [-48, -520],
  id: "rag-qwen-embed-ai-question",
  name: "qwen embed ai question",
  onError: "continueRegularOutput",
});
findNode("qwen embed ai question").parameters.jsonBody = '={\n  "model": "qwen-text-embedding-v4",\n  "input": "{{ $json.text }}"\n}';

upsertNode({
  parameters: { jsCode: buildAiQuestionCode },
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [176, -520],
  id: "rag-build-qdrant-ai-question-point",
  name: "build qdrant ai question point",
  onError: "continueRegularOutput",
});

upsertNode({
  ...JSON.parse(JSON.stringify(qdrantUpsert)),
  position: [400, -520],
  id: "rag-qdrant-upsert-ai-question",
  name: "qdrant upsert ai question",
  onError: "continueRegularOutput",
});

upsertNode({
  parameters: { jsCode: safeErrorCode },
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [624, 560],
  id: "rag-prepare-safe-error-message",
  name: "prepare safe error message",
});

upsertNode({
  ...JSON.parse(JSON.stringify(returnMessage)),
  position: [848, 560],
  id: "rag-return-error-message",
  name: "return error message",
});

ensureConnection("Switch", 0, "prepare ai question memory point");
ensureConnection("prepare ai question memory point", 0, "qwen embed ai question");
ensureConnection("qwen embed ai question", 0, "build qdrant ai question point");
ensureConnection("build qdrant ai question point", 0, "qdrant upsert ai question");
ensureConnection("prepare safe error message", 0, "return error message");

fs.writeFileSync(path, JSON.stringify(workflows, null, 2));
