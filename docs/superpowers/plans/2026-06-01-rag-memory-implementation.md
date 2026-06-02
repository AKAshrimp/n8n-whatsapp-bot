# RAG Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add group-level shared RAG memory to the WhatsApp bot using OpenAI embeddings and Qdrant.

**Architecture:** `whatsapp-bridge` forwards normal useful text, `@ai`, management commands, and existing image commands to n8n. n8n orchestrates OpenAI embeddings, Qdrant upsert/search/delete, DeepSeek responses, and WhatsApp replies. Qdrant runs as a Docker service with persistent local storage.

**Tech Stack:** Node.js, whatsapp-web.js, Express, Axios, n8n, Docker Compose, Qdrant, OpenAI `text-embedding-3-small`, DeepSeek.

---

## File Structure

- Modify `C:\Users\USER\Desktop\n8n-whatsapp-bot\docker-compose.yml`
  - Add Qdrant service and `qdrant_storage` volume.
  - Add `qdrant` to service dependencies.
- Modify `C:\Users\USER\Desktop\n8n-whatsapp-bot\message-utils.js`
  - Add message command classification helpers.
  - Add stable message ID helper.
  - Add recordable text filtering helper.
  - Keep current image reference helper.
- Modify `C:\Users\USER\Desktop\n8n-whatsapp-bot\message-utils.test.js`
  - Keep current image reference tests.
  - Add tests for RAG command parsing and record filtering.
- Modify `C:\Users\USER\Desktop\n8n-whatsapp-bot\index.js`
  - Use helpers from `message-utils.js`.
  - Forward normal group text as `command: record`.
  - Forward `@ai memory status` and `@ai forget me`.
  - Preserve existing `@aiimg` behavior.
- Create or update n8n workflow manually in the n8n UI
  - Add Qdrant initialization.
  - Add `record`, `chat`, `memory_status`, `forget_me`, and cleanup branches.
  - Keep current image branch.

---

### Task 1: Add Qdrant Docker Service

**Files:**
- Modify: `C:\Users\USER\Desktop\n8n-whatsapp-bot\docker-compose.yml`

- [ ] **Step 1: Update docker-compose.yml**

Replace the file content with:

```yaml
version: "3.8"

services:
  n8n:
    image: n8nio/n8n:latest
    container_name: n8n
    ports:
      - "5678:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=admin
      - N8N_BASIC_AUTH_PASSWORD=admin123
      - GENERIC_TIMEZONE=Asia/Taipei
    volumes:
      - n8n_data:/home/node/.n8n
    restart: unless-stopped
    depends_on:
      - qdrant
    networks:
      - bot-network

  whatsapp-bridge:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: whatsapp-bridge
    ports:
      - "3000:3000"
    environment:
      - N8N_WEBHOOK_URL=http://n8n:5678/webhook/whatsapp-trigger
      - TARGET_GROUP_NAMES=Private Wutsapp Group,珍•Marathon Part-time•珠
      - MEMORY_LIMIT=10
    volumes:
      - whatsapp_session:/app/session
    restart: unless-stopped
    depends_on:
      - n8n
      - qdrant
    networks:
      - bot-network

  qdrant:
    image: qdrant/qdrant:latest
    container_name: qdrant
    ports:
      - "6333:6333"
    volumes:
      - qdrant_storage:/qdrant/storage
    restart: unless-stopped
    networks:
      - bot-network

volumes:
  n8n_data:
  whatsapp_session:
  qdrant_storage:

networks:
  bot-network:
    driver: bridge
```

- [ ] **Step 2: Start Qdrant**

Run:

```powershell
docker compose up -d qdrant
```

Expected:

```txt
Container qdrant Started
```

- [ ] **Step 3: Verify Qdrant is reachable from host**

Run:

```powershell
curl.exe http://localhost:6333/collections
```

Expected:

```json
{"result":{"collections":[]},"status":"ok","time":...}
```

If collections already exist, the `collections` array may not be empty.

---

### Task 2: Add RAG Command Parsing Tests

**Files:**
- Modify: `C:\Users\USER\Desktop\n8n-whatsapp-bot\message-utils.test.js`
- Modify later: `C:\Users\USER\Desktop\n8n-whatsapp-bot\message-utils.js`

- [ ] **Step 1: Add failing tests**

Append this code to `message-utils.test.js`:

```js
const {
  classifyIncomingText,
  isRecordableText,
  createStableMessageId,
} = require("./message-utils");

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

test("creates stable message id from native message id", () => {
  const id = createStableMessageId({
    id: {
      _serialized: "native-message-id",
    },
  });

  assert.equal(id, "native-message-id");
});

test("creates hash message id when native id is unavailable", () => {
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

  assert.match(id, /^[a-f0-9]{64}$/);
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
node --test C:\Users\USER\Desktop\n8n-whatsapp-bot\message-utils.test.js
```

Expected:

```txt
not ok ... classifyIncomingText is not a function
```

The existing image media tests may pass; the new RAG tests should fail because helpers do not exist yet.

---

### Task 3: Implement RAG Message Helpers

**Files:**
- Modify: `C:\Users\USER\Desktop\n8n-whatsapp-bot\message-utils.js`
- Test: `C:\Users\USER\Desktop\n8n-whatsapp-bot\message-utils.test.js`

- [ ] **Step 1: Replace message-utils.js with helper implementation**

Use this content:

```js
const crypto = require("crypto");

const AI_COMMAND_PATTERN = /^@ai(?:\s+|$)/i;
const IMAGE_COMMAND_PATTERN = /^@aiimg(?:\s+|$)/i;
const MIN_RECORD_TEXT_LENGTH = 5;
const LOW_VALUE_TEXTS = new Set(["ok", "okay", "yes", "no", "哈哈", "ha", "lol"]);

function normalizeText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isRecordableText(value) {
  const text = normalizeText(value);
  if (text.length < MIN_RECORD_TEXT_LENGTH) return false;
  return !LOW_VALUE_TEXTS.has(text.toLowerCase());
}

function classifyIncomingText(value) {
  const body = normalizeText(value);
  const isImageCommand = IMAGE_COMMAND_PATTERN.test(body);
  const isAiCommand = !isImageCommand && AI_COMMAND_PATTERN.test(body);

  if (isImageCommand) {
    const text = body.replace(IMAGE_COMMAND_PATTERN, "").trim();
    return {
      command: "image",
      text,
      prompt: text,
      isAiCommand: false,
      isImageCommand: true,
    };
  }

  if (isAiCommand) {
    const text = body.replace(AI_COMMAND_PATTERN, "").trim();
    const normalized = text.toLowerCase();
    const command =
      normalized === "memory status"
        ? "memory_status"
        : normalized === "forget me"
          ? "forget_me"
          : "chat";

    return {
      command,
      text,
      prompt: undefined,
      isAiCommand: true,
      isImageCommand: false,
    };
  }

  return {
    command: "record",
    text: body,
    prompt: undefined,
    isAiCommand: false,
    isImageCommand: false,
  };
}

function createStableMessageId(message, fallback = {}) {
  const nativeId = message?.id?._serialized || message?.id?.id;
  if (nativeId) return nativeId;

  return crypto
    .createHash("sha256")
    .update(
      [
        fallback.groupId || "",
        fallback.userId || "",
        message?.timestamp || fallback.timestamp || "",
        fallback.text || "",
      ].join("|")
    )
    .digest("hex");
}

async function getDownloadableImageMedia(message) {
  if (!message?.hasMedia || typeof message.downloadMedia !== "function") {
    return null;
  }

  const media = await message.downloadMedia();
  if (!media?.mimetype?.startsWith("image/")) {
    return null;
  }

  return {
    mimetype: media.mimetype,
    filename: media.filename || "input-image",
    data: media.data,
  };
}

async function getImagePayloadFromMessage(message) {
  const directImage = await getDownloadableImageMedia(message);
  if (directImage) {
    return {
      imageMode: "edit",
      imagePayload: directImage,
      imageSource: "direct",
    };
  }

  if (message?.hasQuotedMsg && typeof message.getQuotedMessage === "function") {
    const quotedMessage = await message.getQuotedMessage();
    const quotedImage = await getDownloadableImageMedia(quotedMessage);
    if (quotedImage) {
      return {
        imageMode: "edit",
        imagePayload: quotedImage,
        imageSource: "quoted",
      };
    }
  }

  return {
    imageMode: "generate",
    imagePayload: null,
    imageSource: null,
  };
}

module.exports = {
  classifyIncomingText,
  createStableMessageId,
  getImagePayloadFromMessage,
  isRecordableText,
  normalizeText,
};
```

- [ ] **Step 2: Run tests and verify pass**

Run:

```powershell
node --test C:\Users\USER\Desktop\n8n-whatsapp-bot\message-utils.test.js
```

Expected:

```txt
# pass 12
# fail 0
```

The pass count may differ if additional tests exist, but all tests must pass.

---

### Task 4: Update Bridge Forwarding Logic

**Files:**
- Modify: `C:\Users\USER\Desktop\n8n-whatsapp-bot\index.js`
- Test: `C:\Users\USER\Desktop\n8n-whatsapp-bot\message-utils.test.js`

- [ ] **Step 1: Replace helper import**

Find:

```js
const { getImagePayloadFromMessage } = require("./message-utils");
```

Replace with:

```js
const {
  classifyIncomingText,
  createStableMessageId,
  getImagePayloadFromMessage,
  isRecordableText,
} = require("./message-utils");
```

- [ ] **Step 2: Remove local command regex constants**

Find and remove:

```js
const AI_COMMAND_PATTERN = /^@ai(?:\s+|$)/i;
// 只接受 "@ai" 或 "@ai 空格..."，避免 "@air"、"@aigame" 這類文字誤觸發
const IMAGE_COMMAND_PATTERN = /^@aiimg(?:\s+|$)/i;
// 只接受 "@aiimg" 或 "@aiimg 空格..."，用來觸發生圖 / 改圖
```

- [ ] **Step 3: Replace the early command parsing block**

Inside `client.on("message_create", async (msg) => {`, replace:

```js
  const body = (msg.body || "").trim();
  const isImageCommand = IMAGE_COMMAND_PATTERN.test(body);
  const isAiCommand = AI_COMMAND_PATTERN.test(body);
  if (!isAiCommand && !isImageCommand) return;
```

With:

```js
  const body = (msg.body || "").trim();
  const classification = classifyIncomingText(body);
  const { command, text, prompt, isAiCommand, isImageCommand } = classification;
  if (!text) return;
```

- [ ] **Step 4: Add record filtering after allowed group check**

After:

```js
  if (!isAllowedGroup) return;
```

Add:

```js
  if (command === "record") {
    if (msg.fromMe) return;
    if (!isRecordableText(text)) return;
  }
```

- [ ] **Step 5: Replace duplicate command derivation**

Remove this block:

```js
  const activeCommandPattern = isImageCommand
    ? IMAGE_COMMAND_PATTERN
    : AI_COMMAND_PATTERN;
  const text = body.replace(activeCommandPattern, "").trim();
  if (!text) return; // 如果 @ai 後面沒有文字就忽略
  const command = isImageCommand
    ? "image"
    : text.toLowerCase() === "memory"
      ? "memory"
      : "chat";
```

Keep:

```js
  const memoryKey = `${groupId}:${userId}`;
```

- [ ] **Step 6: Create messageId before sending to n8n**

Before `await axios.post(N8N_WEBHOOK_URL, {`, add:

```js
    const messageId = createStableMessageId(msg, {
      groupId,
      userId,
      text,
      timestamp: msg.timestamp,
    });
```

- [ ] **Step 7: Add fields to n8n payload**

Inside the axios JSON payload, add:

```js
      messageId: messageId,
```

And replace:

```js
      prompt: isImageCommand ? text : undefined,
```

With:

```js
      prompt: prompt,
```

- [ ] **Step 8: Run syntax checks**

Run:

```powershell
node --check C:\Users\USER\Desktop\n8n-whatsapp-bot\index.js
node --check C:\Users\USER\Desktop\n8n-whatsapp-bot\message-utils.js
```

Expected:

```txt
no output
```

- [ ] **Step 9: Run tests**

Run:

```powershell
node --test C:\Users\USER\Desktop\n8n-whatsapp-bot\message-utils.test.js
```

Expected:

```txt
# fail 0
```

---

### Task 5: Rebuild and Verify Bridge Container

**Files:**
- Uses: `C:\Users\USER\Desktop\n8n-whatsapp-bot\Dockerfile`
- Uses: `C:\Users\USER\Desktop\n8n-whatsapp-bot\docker-compose.yml`

- [ ] **Step 1: Rebuild bridge**

Run:

```powershell
docker compose up -d --build whatsapp-bridge
```

Expected:

```txt
Container whatsapp-bridge Started
```

- [ ] **Step 2: If Chromium session lock appears, remove stale lock files**

If logs show:

```txt
The profile appears to be in use by another Chromium process
```

Run:

```powershell
docker stop whatsapp-bridge
docker run --rm -v n8n-whatsapp-bot_whatsapp_session:/session node:18-slim sh -lc 'rm -f /session/session/SingletonLock /session/session/SingletonSocket /session/session/SingletonCookie'
docker compose up -d whatsapp-bridge
```

Expected:

```txt
WhatsApp Client authenticated.
WhatsApp Client is ready!
```

- [ ] **Step 3: Verify bridge logs show RAG commands**

Send a normal message in an allowed group:

```txt
我星期五要去深圳
```

Run:

```powershell
docker logs --tail 50 whatsapp-bridge
```

Expected log includes:

```txt
Command: record
```

Send:

```txt
@ai Kelvin 最近有咩安排？
```

Expected log includes:

```txt
Command: chat
```

---

### Task 6: Add n8n Qdrant Init Path

**Files:**
- n8n workflow in browser: `http://localhost:5678`

- [ ] **Step 1: Add HTTP Request node named `qdrant init collection`**

Settings:

```txt
Method: PUT
URL: http://qdrant:6333/collections/whatsapp_memory
Authentication: None
Send Body: ON
Body Content Type: JSON
Specify Body: Using JSON
```

JSON:

```json
{
  "vectors": {
    "size": 1536,
    "distance": "Cosine"
  }
}
```

- [ ] **Step 2: Execute node once**

Expected output:

```json
{
  "result": true,
  "status": "ok"
}
```

If the collection already exists, Qdrant may return an error. In that case run:

```powershell
curl.exe http://localhost:6333/collections/whatsapp_memory
```

Expected:

```json
"status":"ok"
```

---

### Task 7: Add n8n record Branch

**Files:**
- n8n workflow in browser: `http://localhost:5678`

- [ ] **Step 1: Add Switch rule for record**

In the existing `Switch` node, add a rule:

```txt
{{ $json.body.command }} equals record
```

Connect this output to a new Code node named `prepare memory point`.

- [ ] **Step 2: Add Code node `prepare memory point`**

Mode:

```txt
Run Once for Each Item
```

Code:

```js
const body = $json.body;
const text = String(body.text || "").trim();

if (!body.groupId || !body.userId || !body.messageId || text.length < 5) {
  return [];
}

const timestamp = Number(body.timestamp || Math.floor(Date.now() / 1000));
const expiresAt = timestamp + 180 * 24 * 60 * 60;

return [
  {
    json: {
      ...body,
      text,
      timestamp,
      expiresAt,
    },
  },
];
```

- [ ] **Step 3: Add HTTP Request node `openai embed record`**

Settings:

```txt
Method: POST
URL: https://api.openai.com/v1/embeddings
Authentication: None
Send Headers: ON
Header 1 Name: Authorization
Header 1 Value: Bearer YOUR_OPENAI_API_KEY
Header 2 Name: Content-Type
Header 2 Value: application/json
Send Body: ON
Body Content Type: JSON
Specify Body: Using JSON
```

JSON:

```json
{
  "model": "text-embedding-3-small",
  "input": "{{ $json.text }}"
}
```

- [ ] **Step 4: Add Code node `build qdrant record point`**

Code:

```js
const original = $("prepare memory point").first().json;
const embedding = $json.data?.[0]?.embedding;

if (!Array.isArray(embedding)) {
  throw new Error("OpenAI embedding missing at data[0].embedding");
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
            userName: original.userName || original.userId,
            text: original.text,
            timestamp: original.timestamp,
            expiresAt: original.expiresAt,
            type: "whatsapp_message",
            source: "whatsapp-bridge",
          },
        },
      ],
    },
  },
];
```

- [ ] **Step 5: Add HTTP Request node `qdrant upsert memory`**

Settings:

```txt
Method: PUT
URL: http://qdrant:6333/collections/whatsapp_memory/points?wait=true
Authentication: None
Send Body: ON
Body Content Type: JSON
Specify Body: Using JSON
```

JSON:

```txt
{{ JSON.stringify($json) }}
```

- [ ] **Step 6: Test record path**

Send in WhatsApp:

```txt
我星期五要去深圳
```

Run:

```powershell
curl.exe http://localhost:6333/collections/whatsapp_memory
```

Expected:

```json
"points_count":1
```

If other points already exist, `points_count` should increase.

---

### Task 8: Replace n8n chat Memory With RAG Search

**Files:**
- n8n workflow in browser: `http://localhost:5678`

- [ ] **Step 1: Add HTTP Request node `openai embed question` after chat switch output**

Settings:

```txt
Method: POST
URL: https://api.openai.com/v1/embeddings
Authentication: None
Send Headers: ON
Header 1 Name: Authorization
Header 1 Value: Bearer YOUR_OPENAI_API_KEY
Header 2 Name: Content-Type
Header 2 Value: application/json
Send Body: ON
Body Content Type: JSON
Specify Body: Using JSON
```

JSON:

```json
{
  "model": "text-embedding-3-small",
  "input": "{{ $json.body.text }}"
}
```

- [ ] **Step 2: Add Code node `build qdrant search`**

Code:

```js
const body = $("Webhook").first().json.body;
const embedding = $json.data?.[0]?.embedding;

if (!Array.isArray(embedding)) {
  throw new Error("OpenAI embedding missing at data[0].embedding");
}

return [
  {
    json: {
      vector: embedding,
      limit: 8,
      filter: {
        must: [
          {
            key: "groupId",
            match: {
              value: body.groupId,
            },
          },
        ],
      },
      with_payload: true,
    },
  },
];
```

- [ ] **Step 3: Add HTTP Request node `qdrant search memory`**

Settings:

```txt
Method: POST
URL: http://qdrant:6333/collections/whatsapp_memory/points/search
Authentication: None
Send Body: ON
Body Content Type: JSON
Specify Body: Using JSON
```

JSON:

```txt
{{ JSON.stringify($json) }}
```

- [ ] **Step 4: Replace `prepare memory` code with RAG prompt builder**

Use this code in `prepare memory`:

```js
const body = $("Webhook").first().json.body;
const results = $json.result || [];

const memories = results
  .filter((item) => item.payload?.text)
  .map((item, index) => {
    const payload = item.payload;
    const date = new Date(Number(payload.timestamp || 0) * 1000)
      .toISOString()
      .slice(0, 10);
    return `${index + 1}. [${payload.userName || payload.userId}, ${date}] ${payload.text}`;
  });

const context =
  memories.length > 0
    ? `以下是這個 WhatsApp 群組的相關歷史記憶：\n\n${memories.join("\n")}`
    : "目前沒有找到足夠相關的群組記憶。";

const system = {
  role: "system",
  content:
    "你是一個 WhatsApp 群組 AI 助手。你可以使用群組共同記憶回答問題。如果記憶不足，請明確說「我目前沒有足夠記憶」。不要編造沒有出現在記憶裡的內容。回答請簡潔、自然，使用繁體中文或粵語。",
};

return [
  {
    json: {
      ...body,
      messages: [
        system,
        {
          role: "user",
          content: `${context}\n\n使用者現在問：\n${body.text}`,
        },
      ],
    },
  },
];
```

- [ ] **Step 5: Connect chat path**

Connect:

```txt
Switch chat output
→ openai embed question
→ build qdrant search
→ qdrant search memory
→ prepare memory
→ Deepseek
→ save memory / return message path
```

- [ ] **Step 6: Update or bypass `save memory`**

The old `save memory` stores conversation in n8n static data. For RAG, replace `save memory` code with:

```js
const input = $("prepare memory").first().json;
const deepseekOutput = $input.first().json;
const aiReply = deepseekOutput.choices?.[0]?.message?.content;

if (!aiReply) {
  throw new Error("DeepSeek did not return choices[0].message.content");
}

return [
  {
    json: {
      to: input.groupId,
      message: aiReply,
    },
  },
];
```

- [ ] **Step 7: Test chat path**

Send:

```txt
A: 我星期五要去深圳
B: @ai A 星期五去哪？
```

Expected WhatsApp reply:

```txt
根據群組之前的聊天，A 星期五要去深圳。
```

The wording can vary, but it must use the recorded memory and not invent unrelated details.

---

### Task 9: Add memory_status Branch

**Files:**
- n8n workflow in browser: `http://localhost:5678`

- [ ] **Step 1: Add Switch rule**

In `Switch`, add:

```txt
{{ $json.body.command }} equals memory_status
```

Connect to Code node `prepare memory status`.

- [ ] **Step 2: Add Code node `prepare memory status`**

Code:

```js
const body = $json.body;

return [
  {
    json: {
      to: body.groupId,
      message:
        "群組記憶已啟用。\n目前只會記錄有效文字訊息，保留 180 天。\n你可以用 @ai forget me 刪除你在此群組的記憶。",
    },
  },
];
```

- [ ] **Step 3: Connect to `return message`**

Connect:

```txt
prepare memory status → return message
```

- [ ] **Step 4: Test status command**

Send:

```txt
@ai memory status
```

Expected reply:

```txt
群組記憶已啟用。
```

---

### Task 10: Add forget_me Branch

**Files:**
- n8n workflow in browser: `http://localhost:5678`

- [ ] **Step 1: Add Switch rule**

In `Switch`, add:

```txt
{{ $json.body.command }} equals forget_me
```

Connect to Code node `build forget me request`.

- [ ] **Step 2: Add Code node `build forget me request`**

Code:

```js
const body = $json.body;

return [
  {
    json: {
      filter: {
        must: [
          {
            key: "groupId",
            match: {
              value: body.groupId,
            },
          },
          {
            key: "userId",
            match: {
              value: body.userId,
            },
          },
        ],
      },
      groupId: body.groupId,
    },
  },
];
```

- [ ] **Step 3: Add HTTP Request node `qdrant forget me`**

Settings:

```txt
Method: POST
URL: http://qdrant:6333/collections/whatsapp_memory/points/delete?wait=true
Authentication: None
Send Body: ON
Body Content Type: JSON
Specify Body: Using JSON
```

JSON:

```json
{
  "filter": {{ JSON.stringify($json.filter) }}
}
```

- [ ] **Step 4: Add Code node `prepare forget me response`**

Code:

```js
const body = $("Webhook").first().json.body;

return [
  {
    json: {
      to: body.groupId,
      message: "已刪除你在這個群組的 AI 記憶。",
    },
  },
];
```

- [ ] **Step 5: Connect response**

Connect:

```txt
qdrant forget me → prepare forget me response → return message
```

- [ ] **Step 6: Test forget command**

Send:

```txt
@ai forget me
```

Expected reply:

```txt
已刪除你在這個群組的 AI 記憶。
```

Then ask about a memory only that user had provided. Expected result:

```txt
我目前沒有足夠記憶
```

---

### Task 11: Add Daily Cleanup Workflow

**Files:**
- n8n workflow in browser: `http://localhost:5678`

- [ ] **Step 1: Create a separate n8n workflow named `whatsapp memory cleanup`**

Add Schedule Trigger:

```txt
Trigger Interval: Days
Days Between Triggers: 1
```

- [ ] **Step 2: Add Code node `build expired memory filter`**

Code:

```js
const now = Math.floor(Date.now() / 1000);

return [
  {
    json: {
      filter: {
        must: [
          {
            key: "expiresAt",
            range: {
              lt: now,
            },
          },
        ],
      },
    },
  },
];
```

- [ ] **Step 3: Add HTTP Request node `qdrant delete expired memories`**

Settings:

```txt
Method: POST
URL: http://qdrant:6333/collections/whatsapp_memory/points/delete?wait=true
Authentication: None
Send Body: ON
Body Content Type: JSON
Specify Body: Using JSON
```

JSON:

```json
{
  "filter": {{ JSON.stringify($json.filter) }}
}
```

- [ ] **Step 4: Activate cleanup workflow**

Expected:

```txt
Workflow active
```

---

### Task 12: Final Validation

**Files:**
- `C:\Users\USER\Desktop\n8n-whatsapp-bot\index.js`
- `C:\Users\USER\Desktop\n8n-whatsapp-bot\message-utils.js`
- `C:\Users\USER\Desktop\n8n-whatsapp-bot\message-utils.test.js`
- n8n workflows
- Qdrant container

- [ ] **Step 1: Run JavaScript tests**

Run:

```powershell
node --test C:\Users\USER\Desktop\n8n-whatsapp-bot\message-utils.test.js
```

Expected:

```txt
# fail 0
```

- [ ] **Step 2: Run syntax checks**

Run:

```powershell
node --check C:\Users\USER\Desktop\n8n-whatsapp-bot\index.js
node --check C:\Users\USER\Desktop\n8n-whatsapp-bot\message-utils.js
```

Expected:

```txt
no output
```

- [ ] **Step 3: Verify containers**

Run:

```powershell
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

Expected includes:

```txt
n8n
whatsapp-bridge
qdrant
```

- [ ] **Step 4: Verify Qdrant collection**

Run:

```powershell
curl.exe http://localhost:6333/collections/whatsapp_memory
```

Expected:

```json
"status":"ok"
```

- [ ] **Step 5: End-to-end test**

In WhatsApp allowed group, send:

```txt
我星期五要去深圳
```

Then send:

```txt
@ai 我星期五去哪？
```

Expected:

```txt
深圳
```

- [ ] **Step 6: Management command tests**

Send:

```txt
@ai memory status
```

Expected:

```txt
群組記憶已啟用
```

Send:

```txt
@ai forget me
```

Expected:

```txt
已刪除你在這個群組的 AI 記憶。
```

- [ ] **Step 7: Verify image command still works**

Send:

```txt
@aiimg 一隻貓在香港喝奶茶
```

Expected:

```txt
Bot returns an image.
```

If the image provider returns a 504, that is an upstream provider issue and does not fail the RAG implementation.

---

## Self-Review Notes

- Spec coverage: Docker, bridge forwarding, Qdrant schema, record, chat, status, forget, cleanup, and validation are covered.
- Placeholder scan: No placeholders or unresolved options are included.
- Type consistency: Commands use `record`, `chat`, `memory_status`, `forget_me`, and `image` consistently across bridge and n8n tasks.
- Scope check: This is a single implementation plan with n8n manual steps plus focused bridge code changes.
