
//
// const      → 宣告一個「不可重新賦值」的常數變數 (constant)
// let        → 宣告一個「可重新賦值」的變數 (variable)
// function   → 定義一個函式 (function)
// () => {}   → 箭頭函式 (arrow function)，是 function 的簡寫語法
// async/await→ 處理非同步操作 (asynchronous)，讓程式「等」某件事完成再繼續
// try/catch  → 錯誤處理機制：try 執行正常流程，catch 捕捉錯誤
// require()  → Node.js 載入外部模組/套件的方法 (CommonJS module system)
// {}         → 解構賦值 (destructuring)，從物件中取出特定屬性
// `字串 ${var}` → 模板字串 (template literal)，用反引號包住字串，${} 內可放變數
//
// ==========================================

// ==========================================
// 引入套件 (Import Dependencies)
// ==========================================

// require("套件名稱") → 載入外部套件，回傳該套件的內容
// const { Client, LocalAuth, MessageMedia } → 解構賦值：從 whatsapp-web.js 套件中取出需要的 class
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js"); // WhatsApp Web 的 Node.js Client
const fs = require("fs"); // 檔案系統，用來記錄 AI outbox metadata
const path = require("path"); // 路徑工具，用來建立 outbox log 路徑
const qrcode = require("qrcode-terminal"); // 在 terminal 顯示 QR Code
const express = require("express"); // HTTP Server framework，用來接收 n8n 回傳的 AI 回覆
const axios = require("axios"); // HTTP Client library，用來發送 Webhook 到 n8n
const {
  classifyIncomingText,
  createAiOutboxRecord,
  createAllowedGroupSettingsStore,
  createOutgoingMessageTracker,
  createServiceStatusSummary,
  createStableMessageId,
  formatGroupList,
  getImagePayloadFromMessage,
  isRecordableText,
} = require("./message-utils");

// ==========================================
// 環境變數與常數 (Environment Variables & Constants)
// ==========================================

// process.env.XXX → 讀取系統環境變數（在 docker-compose.yml 的 environment 區塊設定）
// || → 邏輯「或」運算子：左邊為 falsy（空字串、undefined）時使用右邊的預設值
const N8N_WEBHOOK_URL =
  process.env.N8N_WEBHOOK_URL || "http://n8n:5678/webhook/whatsapp-trigger";
// n8n Webhook 的目標 URL，透過 docker-compose 的 environment 設定
const PORT = process.env.PORT || 3000;
// Express Server 監聽的 Port 號
const TARGET_GROUP_NAMES = (
  process.env.TARGET_GROUP_NAMES ||
  process.env.TARGET_GROUP_NAME ||
  "Private Wutsapp Group,珍•Marathon Part-time•珠"
)
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
// 只監聽這些 WhatsApp Group 名稱，避免其他群組誤觸發 bot
const MEMORY_LIMIT = Number(process.env.MEMORY_LIMIT || 10);
// 每個 group + user 最多保留幾筆 memory
const outgoingMessageTracker = createOutgoingMessageTracker();
const AI_OUTBOX_LOG_PATH =
  process.env.AI_OUTBOX_LOG_PATH || path.join("n8n", "backups", "ai-outbox.jsonl");
const GROUP_SETTINGS_PATH =
  process.env.GROUP_SETTINGS_PATH || path.join("session", "group-settings.json");
const allowedGroupStore = createAllowedGroupSettingsStore({
  initialGroupNames: TARGET_GROUP_NAMES,
  readText: () => {
    try {
      return fs.readFileSync(GROUP_SETTINGS_PATH, "utf8");
    } catch (err) {
      if (err?.code === "ENOENT") return "";
      throw err;
    }
  },
  writeText: (text) => {
    fs.mkdirSync(path.dirname(GROUP_SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(GROUP_SETTINGS_PATH, text, "utf8");
  },
});

// normalizeGroupName(name) → 標準化 group 名稱，移除半形/全形括號後再比對
function normalizeGroupName(name) {
  return (name || "").replace(/[()（）]/g, "").trim();
}

// stripN8nValuePrefix(value) → 清掉 n8n 欄位不小心帶進來的 "Value:" 文字
function stripN8nValuePrefix(value) {
  return String(value || "")
    .replace(/^Value:\s*/i, "")
    .trim();
}

// getMessageUserId(msg) → 取得真正發問者 ID
// groupId:userId 會成為 memory key，確保不同群組、不同使用者的記憶分開
function getMessageUserId(msg) {
  return (
    msg.author ||
    (msg.fromMe ? client.info?.wid?._serialized : msg.from) ||
    "unknown-user"
  );
}

function getLoggedInUserId() {
  return client.info?.wid?._serialized || "";
}

function appendJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

// ==========================================
// 初始化 WhatsApp Client (Initialize WhatsApp Client)
// ==========================================

// new ClassName({...}) → 建立一個 class 的實例 (instance)，{...} 是傳入的設定物件
const client = new Client({
  // authStrategy → 認證策略：決定如何保存登入狀態
  // LocalAuth → 將 session 資料存到本地檔案，重新啟動時不需要重新掃 QR Code
  // { dataPath: "./session" } → session 檔案的儲存路徑
  authStrategy: new LocalAuth({ dataPath: "./session" }),
  // puppeteer → WhatsApp Web 底層使用 Puppeteer（無頭瀏覽器）來運作
  puppeteer: {
    // args → 傳給 Chromium 的啟動參數
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    // Docker 環境中需要關閉 sandbox，否則權限不足會報錯
  },
});

async function checkHttpService({ name, url, timeoutMs = 2500, summarize }) {
  try {
    const response = await axios.get(url, { timeout: timeoutMs });
    return {
      ok: response.status >= 200 && response.status < 300,
      detail: summarize ? summarize(response.data) : `${name} responded`,
    };
  } catch (err) {
    return {
      ok: false,
      detail: err?.message || `${name} unavailable`,
    };
  }
}

async function getServiceStatus() {
  const [n8n, qdrant] = await Promise.all([
    checkHttpService({
      name: "n8n",
      url: "http://n8n:5678/healthz",
      summarize: (data) => data?.status || "healthy",
    }),
    checkHttpService({
      name: "Qdrant",
      url: "http://qdrant:6333/collections",
      summarize: (data) => {
        const count = Array.isArray(data?.result?.collections)
          ? data.result.collections.length
          : 0;
        return `${count} collection${count === 1 ? "" : "s"}`;
      },
    }),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    ...createServiceStatusSummary({
      whatsappConnected: Boolean(client.info),
      userId: getLoggedInUserId(),
      n8n,
      qdrant,
      webhookUrl: N8N_WEBHOOK_URL,
    }),
  };
}

// ==========================================
// WhatsApp Client 事件監聽 (Event Listeners)
// ==========================================

// client.on("事件名稱", callback) → 監聽 WhatsApp Client 的特定事件
// callback（回呼函式）→ 當事件觸發時自動執行的函式
// (qr) => {} → 箭頭函式 (arrow function)，qr 是 callback 的 parameter（參數）
//   這裡的 qr 參數是 WhatsApp 產生的 QR Code 字串

client.on("qr", (qr) => {
  console.log("\n=== WhatsApp QR Code ===\n");
  // qrcode.generate(qr, { small: true }) → 呼叫函式，傳入兩個 argument（引數）：
  //   第1個 qr：要顯示的 QR Code 字串
  //   第2個 { small: true }：設定物件，讓 QR Code 顯示小一點
  qrcode.generate(qr, { small: true });
  console.log("\n========================\n");
});

// () => {} → 沒有參數的 arrow function
// 當 Client 成功連線並準備好接收訊息時觸發
client.on("ready", () => {
  console.log("WhatsApp Client is ready!");
});

// 當使用者成功通過驗證時觸發
client.on("authenticated", () => {
  console.log("WhatsApp Client authenticated.");
});

// (msg) => {} → msg 參數包含驗證失敗的相關資訊
// 當驗證失敗時觸發（例如 QR Code 過期）
client.on("auth_failure", (msg) => {
  console.error("Authentication failure:", msg);
});

// (reason) => {} → reason 參數包含斷線原因
// 當 Client 與 WhatsApp 斷線時觸發
client.on("disconnected", (reason) => {
  console.log("WhatsApp Client disconnected:", reason);
});

// ==========================================
// 訊息監聽與轉發邏輯 (Message Listener & Forwarder)
// ==========================================

// async (msg) => {} → async 關鍵字讓函式變成「非同步函式」
//   函式內可以使用 await 來等待 Promise（非同步操作）完成
// msg → 訊息物件，包含 from（來源）、body（文字內容）、author（發送者）等屬性
// message_create → 監聽「所有建立的訊息」，包含別人傳來的訊息，也包含自己帳號發出的訊息
// 如果只用 message event，自己用同一個 WhatsApp 帳號發的 @ai 可能不會被 bot 處理
client.on("message_create", async (msg) => {
  // msg.body → 訊息的文字內容（string）
  // .trim() → 字串方法：移除首尾空白字元
  const body = (msg.body || "").trim();
  const classification = classifyIncomingText(body);
  const { command, text, prompt, isImageCommand } = classification;
  if (!text) return;

  // await msg.getChat() → 取得這則訊息所屬的 Chat 物件
  // chat.isGroup → 判斷這個 Chat 是否為 WhatsApp Group
  // chat.name → 群組名稱，例如 "Private Wutsapp Group"
  const chat = await msg.getChat();
  if (!chat.isGroup) return;
  if (!allowedGroupStore.isAllowed(chat.name)) return;

  // chat.id._serialized → 群組真正的 ID，格式通常是 "數字@g.us"
  // 自己發出的訊息中 msg.from 可能不是群組 ID，所以這裡統一使用 chat.id._serialized
  const groupId = chat.id._serialized;
  const userId = getMessageUserId(msg);

  if (command === "record") {
    if (
      msg.fromMe &&
      outgoingMessageTracker.isKnownOutgoing({ from: groupId, text })
    ) {
      return;
    }
    if (!isRecordableText(text)) return;
  }

  const memoryKey = `${groupId}:${userId}`;

  const { imageMode, imagePayload, imageSource } = isImageCommand
    ? await getImagePayloadFromMessage(msg)
    : { imageMode: "generate", imagePayload: null, imageSource: null };

  // `... ${var}` → 模板字串 (template literal)：用反引號 `` 包住字串
  // ${var} → 在字串中嵌入變數的值
  console.log(
    `[Received] Group: ${chat.name} (${groupId}) | User: ${userId} | Command: ${command} | ImageMode: ${imageMode} | ImageSource: ${imageSource || "none"} | Text: ${text}`
  );

  if (isImageCommand && imagePayload) {
    console.log("[Image Payload]", {
      source: imageSource,
      mimetype: imagePayload.mimetype,
      filename: imagePayload.filename,
      base64Length: String(imagePayload.data || "").length,
    });
  }
  // try/catch → 錯誤處理機制
  // try 區塊：放「可能出錯」的程式碼
  // catch 區塊：如果 try 裡面出錯，會跳到這裡執行，err 參數包含錯誤資訊
  try {
    const messageId = createStableMessageId(msg, {
      groupId,
      userId,
      text,
      timestamp: msg.timestamp,
    });

    // await → 等待後方的 Promise（非同步操作）完成後才繼續往下執行
    // axios.post(url, data) → 發送 HTTP POST 請求
    //   url：目標網址（n8n Webhook URL）
    //   data：要傳送的 JSON 資料（第2個參數，是個物件）
    await axios.post(N8N_WEBHOOK_URL, {
      from: groupId, // 群組 ID（格式：數字@g.us）
      groupId: groupId, // 明確提供 groupId，讓 n8n 不需要猜
      groupName: chat.name, // 群組名稱
      userId: userId, // 發問者 ID
      messageId: messageId, // 穩定訊息 ID，用於去重與記憶
      memoryKey: memoryKey, // groupId:userId，用來分開記憶
      command: command, // chat 或 memory
      mode: isImageCommand ? imageMode : undefined, // image 指令使用：generate 或 edit
      memoryLimit: MEMORY_LIMIT, // n8n 儲存 memory 時使用
      text: text, // 使用者輸入的文字（去除 @ai 後）
      prompt: prompt, // image 指令使用的 prompt
      image: imagePayload, // 如果使用者傳圖 + @aiimg caption，這裡會帶 base64 image
      timestamp: msg.timestamp, // 訊息的 UNIX 時間戳（秒）
      author: userId, // 發送者 ID
      fromMe: msg.fromMe, // 是否為 bot 登入帳號自己發出的訊息
    });
    console.log("[Forwarded] Message sent to n8n webhook.");
  } catch (err) {
    // err.message → 錯誤物件中的錯誤訊息字串
    console.error("[Error] Failed to forward to n8n:", err.message);
  }
});

// ==========================================
// Express Server - 接收 n8n 回傳的 AI 回覆
// (Express Server for receiving AI replies from n8n)
// ==========================================

// express() → 建立 Express 應用程式實例
const app = express();

// app.use(middleware) → 註冊中介軟體 (middleware)
// middleware 是一個函式，每個請求進來時都會先經過它處理
// express.json() → middleware：自動把 request body 的 JSON 字串解析成 JavaScript 物件
app.use(express.json({ limit: "25mb" }));

function renderSettingsPage(groupNames) {
  const initialGroupNames = JSON.stringify(groupNames);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WhatsApp Bot Settings</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #0f1115; color: #f4f4f5; }
    main { max-width: 760px; margin: 40px auto; padding: 24px; }
    .card { background: #181b20; border: 1px solid #2b3038; border-radius: 14px; padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    h2 { margin: 24px 0 12px; font-size: 18px; }
    p { color: #a1a1aa; line-height: 1.5; }
    label { display: block; margin: 18px 0 8px; font-weight: 700; }
    textarea { width: 100%; min-height: 180px; box-sizing: border-box; border-radius: 10px; border: 1px solid #3f4652; background: #0f1115; color: #f4f4f5; padding: 14px; font-size: 15px; line-height: 1.5; }
    button { margin-top: 14px; border: 0; border-radius: 10px; background: #f4f4f5; color: #0f1115; padding: 10px 16px; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: 0.6; cursor: wait; }
    .status { margin-top: 14px; min-height: 22px; color: #a1e3a1; }
    .hint { font-size: 14px; }
    .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 12px 0 4px; }
    .service { border: 1px solid #2b3038; border-radius: 12px; padding: 14px; background: #111318; }
    .service-name { display: flex; align-items: center; gap: 8px; font-weight: 700; }
    .dot { width: 10px; height: 10px; border-radius: 999px; background: #71717a; }
    .ok .dot { background: #22c55e; }
    .warning .dot { background: #f59e0b; }
    .error .dot { background: #ef4444; }
    .service-detail { margin-top: 8px; color: #a1a1aa; font-size: 13px; overflow-wrap: anywhere; }
    .checked-at { color: #71717a; font-size: 12px; margin-top: 8px; }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <h1>WhatsApp Bot Groups</h1>
      <p>One group name per line. Messages from these WhatsApp groups can use the chatbot immediately after saving.</p>
      <h2>Service Status</h2>
      <div class="status-grid" id="serviceStatus">
        <div class="service"><div class="service-name"><span class="dot"></span>Loading...</div></div>
      </div>
      <div class="checked-at" id="checkedAt"></div>
      <label for="groups">Allowed group names</label>
      <textarea id="groups" spellcheck="false"></textarea>
      <p class="hint">Use the exact WhatsApp group display name. Parentheses are ignored when matching.</p>
      <button id="save">Save groups</button>
      <div class="status" id="status"></div>
    </section>
  </main>
  <script>
    const initialGroupNames = ${initialGroupNames};
    const textarea = document.getElementById("groups");
    const saveButton = document.getElementById("save");
    const status = document.getElementById("status");
    const serviceStatus = document.getElementById("serviceStatus");
    const checkedAt = document.getElementById("checkedAt");
    textarea.value = initialGroupNames.join("\\n");

    function escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    async function loadStatus() {
      try {
        const response = await fetch("/api/status");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Status check failed");
        serviceStatus.innerHTML = data.services.map((service) => {
          const state = escapeHtml(service.status);
          return '<div class="service ' + state + '">' +
            '<div class="service-name"><span class="dot"></span>' + escapeHtml(service.name) + '</div>' +
            '<div class="service-detail">' + escapeHtml(service.detail) + '</div>' +
            '</div>';
        }).join("");
        checkedAt.textContent = "Checked " + new Date(data.checkedAt).toLocaleString();
      } catch (err) {
        serviceStatus.innerHTML = '<div class="service error"><div class="service-name"><span class="dot"></span>Status unavailable</div><div class="service-detail">' + escapeHtml(err.message || err) + '</div></div>';
        checkedAt.textContent = "";
      }
    }

    loadStatus();
    setInterval(loadStatus, 30000);

    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true;
      status.textContent = "Saving...";
      try {
        const groupNames = textarea.value.split(/\\r?\\n/).map((name) => name.trim()).filter(Boolean);
        const response = await fetch("/api/settings/groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupNames }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Save failed");
        textarea.value = data.groupNames.join("\\n");
        status.textContent = "Saved. New groups are active now.";
      } catch (err) {
        status.textContent = err.message || String(err);
      } finally {
        saveButton.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

app.get("/settings", (_req, res) => {
  res.type("html").send(renderSettingsPage(allowedGroupStore.getGroupNames()));
});

app.get("/api/settings/groups", (_req, res) => {
  res.json({ groupNames: allowedGroupStore.getGroupNames() });
});

app.post("/api/settings/groups", (req, res) => {
  const groupNames = req.body?.groupNames;
  if (!Array.isArray(groupNames)) {
    return res.status(400).json({ error: "groupNames must be an array." });
  }

  res.json({ groupNames: allowedGroupStore.setGroupNames(groupNames) });
});

app.get("/api/status", async (_req, res) => {
  res.json(await getServiceStatus());
});

// ------------------------------------------
// POST /send-message 路由 (Route)
// ------------------------------------------
// app.post(path, handler) → 註冊一個 HTTP POST 路由
//   path → URL 路徑，例如 "/send-message"
//   handler → 處理函式，參數為 (req, res)
//     req (request)  → 包含客戶端傳來的請求資料（headers, body, params...）
//     res (response) → 用來回傳回應給客戶端的方法（res.json(), res.status()...）
//
// n8n 工作流最後一個 Node 會呼叫這個 endpoint，傳入 AI 回覆
// request body 格式：{ "to": "群組ID", "message": "AI 回覆文字" }
app.post("/send-message", async (req, res) => {
  // const { to, message } = req.body → 解構賦值 (destructuring assignment)
  // 從 req.body（請求體）這個物件中，取出 to 和 message 兩個屬性，存成同名變數
  // 等同於：const to = req.body.to; const message = req.body.message;
  const { to, message } = req.body;
  const targetChatId = stripN8nValuePrefix(to);
  const outgoingMessage = stripN8nValuePrefix(message)
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .trim();

  // 驗證必要欄位：to 和 message 都必須存在
  if (!targetChatId || !outgoingMessage) {
    // res.status(400).json({...}) → 回傳 HTTP 400 狀態碼（Bad Request）+ JSON 回應
    // 400 代表「客戶端傳了不正確的資料」
    return res.status(400).json({ error: "Missing 'to' or 'message' field." });
    // return → 提前結束函式，後面的程式碼不會執行
  }

  if (!client.info) {
    return res.status(503).json({ error: "WhatsApp Client is not ready." });
  }

  try {
    // client.getChatById(targetChatId) → 先確認目標 chat 存在
    // chat.sendMessage(outgoingMessage) → 再把訊息送到該 chat，對群組更穩定
    const chat = await client.getChatById(targetChatId);
    outgoingMessageTracker.remember({
      to: targetChatId,
      text: outgoingMessage,
    });
    await chat.sendMessage(outgoingMessage);
    appendJsonLine(
      AI_OUTBOX_LOG_PATH,
      createAiOutboxRecord({
        groupId: targetChatId,
        senderId: getLoggedInUserId(),
        text: outgoingMessage,
      })
    );
    console.log(`[Sent] To: ${targetChatId} | Message: ${outgoingMessage}`);
    // res.json({...}) → 回傳 HTTP 200（預設）+ JSON 回應
    res.json({ success: true });
  } catch (err) {
    console.error("[Error] Failed to send message:", {
      to: targetChatId,
      messagePreview: outgoingMessage.slice(0, 200),
      errorMessage: err?.message,
      errorName: err?.name,
      errorStack: err?.stack,
      rawError: err,
    });
    // res.status(500).json({...}) → 回傳 HTTP 500 狀態碼（Internal Server Error）
    // 500 代表「伺服器內部發生錯誤」
    res.status(500).json({
      error: "Failed to send message.",
      detail: err?.message || String(err),
    });
  }
});

// ------------------------------------------
// POST /send-image 路由 (Route)
// ------------------------------------------
// request body 可用兩種方式：
// 1. { to, imageUrl, caption }
// 2. { to, imageBase64, mimetype, filename, caption }
app.post("/send-image", async (req, res) => {
  const { to, imageUrl, imageBase64, data, mimetype, filename, caption } =
    req.body;
  const targetChatId = stripN8nValuePrefix(to);
  const safeCaption = stripN8nValuePrefix(caption);
  const safeImageUrl = stripN8nValuePrefix(imageUrl);
  let safeImageBase64 = stripN8nValuePrefix(imageBase64 || data);

  if (!targetChatId || (!safeImageUrl && !safeImageBase64)) {
    return res.status(400).json({
      error: "Missing 'to' and either 'imageUrl' or 'imageBase64' field.",
    });
  }

  if (!client.info) {
    return res.status(503).json({ error: "WhatsApp Client is not ready." });
  }

  try {
    let media;

    if (safeImageUrl) {
      media = await MessageMedia.fromUrl(safeImageUrl, { unsafeMime: true });
    } else {
      safeImageBase64 = safeImageBase64.replace(
        /^data:image\/[a-zA-Z0-9.+-]+;base64,/,
        ""
      );
      media = new MessageMedia(
        mimetype || "image/png",
        safeImageBase64,
        filename || "ai-image.png"
      );
    }

    const chat = await client.getChatById(targetChatId);
    await chat.sendMessage(media, { caption: safeCaption });
    console.log(`[Sent Image] To: ${targetChatId} | Caption: ${safeCaption}`);
    res.json({ success: true });
  } catch (err) {
    console.error("[Error] Failed to send image:", {
      to: targetChatId,
      hasImageUrl: Boolean(safeImageUrl),
      hasImageBase64: Boolean(safeImageBase64),
      captionPreview: safeCaption.slice(0, 200),
      errorMessage: err?.message,
      errorName: err?.name,
      errorStack: err?.stack,
      rawError: err,
    });
    res.status(500).json({
      error: "Failed to send image.",
      detail: err?.message || String(err),
    });
  }
});

// ------------------------------------------
// GET /health 健康檢查路由 (Health Check Route)
// ------------------------------------------
// app.get(path, handler) → 註冊一個 HTTP GET 路由
// _req → 底線開頭代表「這個參數我不會用到」，是開發者的慣例寫法
app.get("/health", (_req, res) => {
  // client.info → 如果 WhatsApp Client 已連線，info 會包含帳號資訊（truthy）
  //               如果還沒連線，info 是 undefined（falsy）
  // 三元運算子：condition ? 值A : 值B → 條件為 true 回傳值A，否則回傳值B
  res.json({
    status: "ok",
    whatsapp: client.info ? "connected" : "pending",
    userId: getLoggedInUserId() || undefined,
  });
});

app.get("/groups", async (_req, res) => {
  if (process.env.ENABLE_GROUPS_ENDPOINT !== "true") {
    return res.status(404).json({ error: "Not found" });
  }

  if (!client.info) {
    return res.status(503).json({ error: "WhatsApp Client is not ready." });
  }

  try {
    const chats = await client.getChats();
    res.json({ groups: formatGroupList(chats) });
  } catch (err) {
    res.status(500).json({
      error: "Failed to list groups.",
      detail: err?.message || String(err),
    });
  }
});

// ==========================================
// 啟動 (Start)
// ==========================================

// client.initialize() → 開始初始化 WhatsApp Client，啟動連線流程
// （會觸發 qr → authenticated → ready 等事件）
client.initialize();

// app.listen(port, host, callback) → 啟動 Express Server
//   port → 監聽的 Port 號（3000）
//   "0.0.0.0" → 監聽所有網路介面（Docker 容器對外開放需要這樣設定）
//   () => {} → 啟動成功後執行的 callback 函式
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Express server listening on port ${PORT}`);
  console.log(`n8n webhook target: ${N8N_WEBHOOK_URL}`);
});
