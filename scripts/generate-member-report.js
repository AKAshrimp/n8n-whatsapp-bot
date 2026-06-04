const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const { normalizeHistoryMessage, shouldImportHistoryText } = require("./history-utils");
const { resolveEmbeddingKey, withRetry } = require("./seed-whatsapp-history");

const chatUrl =
  process.env.CHAT_COMPLETIONS_URL ||
  "https://tokendance.space/gateway/v1/chat/completions";
const chatModel = process.env.CHAT_MODEL || "deepseek-v4-flash";
const PERSONA_PROMPT_VERSION = "persona-v2";
const STYLE_PROMPT_VERSION = "style-v1";

function groupMessagesByUser(rawMessages) {
  const groups = new Map();
  for (const raw of rawMessages) {
    const message = normalizeHistoryMessage(raw);
    if (!shouldImportHistoryText(message.text)) continue;
    const current = groups.get(message.userId) || {
      userId: message.userId,
      userName: message.userName,
      messageCount: 0,
      messages: [],
    };
    current.messageCount += 1;
    current.messages.push(message);
    groups.set(message.userId, current);
  }
  return Array.from(groups.values()).sort((a, b) => b.messageCount - a.messageCount);
}

function sampleMessages(messages, limit = 80) {
  if (messages.length <= limit) return messages;
  const step = Math.max(1, Math.floor(messages.length / limit));
  return messages.filter((_message, index) => index % step === 0).slice(0, limit);
}

function chunkMessages(messages, chunkSize = 120) {
  const chunks = [];
  for (let index = 0; index < messages.length; index += chunkSize) {
    chunks.push(messages.slice(index, index + chunkSize));
  }
  return chunks;
}

function buildMemberReportChunkPrompt({ userName, messages, chunkIndex, totalChunks }) {
  const lines = messages
    .map((message, index) => `${index + 1}. ${message.text}`)
    .join("\n");

  return [
    "你正在分析 WhatsApp 群組聊天記錄，用於生成成員溝通風格報告。",
    `成員：${userName}`,
    `第 ${chunkIndex}/${totalChunks} 段`,
    "",
    "請只根據這一段訊息生成「局部觀察」。",
    "不要推斷敏感屬性，例如政治、宗教、性取向、健康、家庭背景、受保護身份。",
    "如果證據不足，要寫「證據不足」。",
    "evidence 必須是聊天原句短引用，例如「好有情緒價值」；不要用訊息序號當證據。",
    "",
    "請只輸出 JSON，不要 markdown。格式：",
    JSON.stringify(
      {
        communicationStyle: "",
        humorStyle: "",
        commonTopics: [],
        responsePattern: "",
        languageStyle: "",
        howAiShouldReply: "",
        evidence: [],
        uncertainty: "",
      },
      null,
      2
    ),
    "",
    "Messages:",
    lines,
  ].join("\n");
}

function buildMemberReportFromChunkSummariesPrompt({
  userName,
  messageCount,
  chunkSummaries,
}) {
  return [
    "你正在把多段 WhatsApp 局部觀察整合成最終成員溝通風格報告。",
    `成員：${userName}`,
    `總訊息數：${messageCount}`,
    "",
    "請綜合所有局部觀察，保留反覆出現、有足夠證據支持的模式。",
    "不要推斷敏感屬性，例如政治、宗教、性取向、健康、家庭背景、受保護身份。",
    "避免把單次偶然訊息誇大成固定性格。",
    "最終 evidence 必須保留聊天原句短引用；不要用 1、2、3 或純數字序號當證據。",
    "",
    "請只輸出 JSON，不要 markdown。格式：",
    JSON.stringify(
      {
        userName,
        messageCount,
        communicationStyle: "",
        humorStyle: "",
        commonTopics: [],
        responsePattern: "",
        languageStyle: "",
        howAiShouldReply: "",
        evidence: [],
        uncertainty: "",
      },
      null,
      2
    ),
    "",
    "Chunk summaries:",
    JSON.stringify(chunkSummaries, null, 2),
  ].join("\n");
}

function buildMemberPersonaChunkPrompt({ userName, messages, chunkIndex, totalChunks }) {
  const lines = messages
    .map((message, index) => `${index + 1}. ${message.text}`)
    .join("\n");

  return [
    "你正在分析 WhatsApp 群組聊天記錄，用於生成有味道的人物画像，不是安全審計報告。",
    `成員：${userName}`,
    `第 ${chunkIndex}/${totalChunks} 段`,
    "",
    "請只根據這一段訊息做局部人物觀察。",
    "不要推斷敏感屬性，例如政治、宗教、性取向、健康、家庭背景、受保護身份。",
    "可以分析聊天風格、性格傾向、互動模式、講話習慣/口癖、常見梗，但避免把單次偶然訊息講成固定性格。",
    "語氣要半認真半搞笑，像熟悉群友的人在做人物分析；可以詳細一點，但不要硬作。",
    "需要包含一句話人設、人物画像、經典語句和回覆方法。不要輸出證據欄位，不要列證據清單。",
    "",
    "請只輸出 JSON，不要 markdown。格式：",
    JSON.stringify(
      {
        persona: "一句話人設",
        personalityAnalysis: "人物分析/性格與互動氣質",
        portrait: "画像：這個人在群入面通常扮演的角色",
        speakingHabits: [],
        commonInteractionTargets: [],
        classicLines: [],
        replyMethod: "回覆方法",
        uncertainty: "",
      },
      null,
      2
    ),
    "",
    "Messages:",
    lines,
  ].join("\n");
}

function buildMemberPersonaFromChunkSummariesPrompt({
  userName,
  messageCount,
  chunkSummaries,
}) {
  return [
    "你正在把多段 WhatsApp 局部人物觀察，整合成一份自然、有味道、像群友理解的最終人物画像。",
    `成員：${userName}`,
    `總訊息數：${messageCount}`,
    "",
    "輸出目的：幫 AI 理解這個人在群友眼中的聊天性格、回覆方式、口癖和常見互動，而不是列證據。",
    "不要推斷敏感屬性，例如政治、宗教、性取向、健康、家庭背景、受保護身份。",
    "不要輸出證據欄位，不要列證據清單。",
    "請用繁體中文/粵語口語寫，保留少量英文詞如果符合此人成員風格。",
    "語氣半認真半搞笑：要有分析力，但可以帶少少群友式吐槽。",
    "可以寫長一點、詳細一點；如果某人訊息很多，就多寫一些細節和互動模式。",
    "必須覆蓋：人物分析、人設、画像、講話習慣、常互動對象、經典語句、回覆方法。",
    "",
    "請只輸出 JSON，不要 markdown。格式：",
    JSON.stringify(
      {
        userName,
        messageCount,
        persona: "人設：群友眼中的一句話或幾句話定位",
        personalityAnalysis: "人物分析：性格、互動氣質、在群中的角色",
        portrait: "画像：如果把這個人畫成一個群聊角色，會是怎樣",
        speakingHabits: ["講話習慣/口癖"],
        commonInteractionTargets: [
          {
            target: "常互動對象",
            pattern: "互動方式",
          },
        ],
        classicLines: ["經典語句：常見句式、口頭禪、代表性講法"],
        replyMethod: "回覆方法：AI 跟他/她互動時應該怎樣講、怎樣接梗、怎樣避免踩雷",
        uncertainty: "哪些地方證據不足或可能只是短期現象",
      },
      null,
      2
    ),
    "",
    "Chunk summaries:",
    JSON.stringify(chunkSummaries, null, 2),
  ].join("\n");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function createChunkSummaryCacheKey({
  mode,
  model,
  promptVersion,
  member,
  chunkIndex,
  totalChunks,
  messages,
}) {
  const keyMaterial = {
    mode,
    model,
    promptVersion,
    userId: member.userId,
    userName: member.userName,
    chunkIndex,
    totalChunks,
    messages: messages.map((message) => ({
      text: message.text,
      timestamp: message.timestamp,
    })),
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(keyMaterial)))
    .digest("hex");
}

async function getChunkSummaryWithCache({
  cacheDir,
  createSummary,
  ...cacheKeyInput
}) {
  if (!cacheDir) return createSummary();

  const cacheKey = createChunkSummaryCacheKey(cacheKeyInput);
  const cachePath = path.join(cacheDir, `${cacheKey}.json`);
  if (fs.existsSync(cachePath)) {
    try {
      return JSON.parse(fs.readFileSync(cachePath, "utf8"));
    } catch {
      // Ignore corrupt cache entries and regenerate them.
    }
  }

  const summary = await createSummary();
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cachePath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
}

function buildMemberReportPrompt(member) {
  const lines = sampleMessages(member.messages)
    .map((message, index) => `${index + 1}. ${message.text}`)
    .join("\n");

  return [
    "你正在分析 WhatsApp 群組最近一個月的聊天記錄。",
    `成員：${member.userName}`,
    `樣本數：${member.messages.length}`,
    "",
    "請根據下面訊息，生成安全的成員溝通風格報告。",
    "只根據訊息內容描述；不要推斷敏感屬性，例如政治、宗教、性取向、健康、家庭背景、受保護身份。",
    "如果證據不足，要寫「證據不足」。",
    "",
    "請只輸出 JSON，不要 markdown。格式：",
    JSON.stringify(
      {
        userName: member.userName,
        messageCount: member.messages.length,
        communicationStyle: "",
        humorStyle: "",
        commonTopics: [],
        responsePattern: "",
        languageStyle: "",
        howAiShouldReply: "",
        evidence: [],
        uncertainty: "",
      },
      null,
      2
    ),
    "",
    "Messages:",
    lines,
  ].join("\n");
}

function escapeControlCharsInJsonStrings(text) {
  let inString = false;
  let escaped = false;
  let result = "";

  for (const char of text) {
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      result += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }
    if (inString && char === "\n") {
      result += "\\\\n";
      continue;
    }
    if (inString && char === "\r") {
      result += "\\\\r";
      continue;
    }
    if (inString && char === "\t") {
      result += "\\\\t";
      continue;
    }
    result += char;
  }

  return result;
}

function parseJsonFromModel(content) {
  const text = String(content || "").trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced ? fenced[1] : text;
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    if (!/control character/i.test(error.message)) throw error;
    return JSON.parse(escapeControlCharsInJsonStrings(jsonText));
  }
}

async function generateProfile({ embeddingKey, member }) {
  const response = await withRetry(() =>
    axios.post(
      chatUrl,
      {
        model: chatModel,
        messages: [
          {
            role: "system",
            content:
              "你是嚴謹的對話風格分析助手。輸出必須是有效 JSON。不要猜測敏感身份。",
          },
          { role: "user", content: buildMemberReportPrompt(member) },
        ],
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${embeddingKey}`,
          "Content-Type": "application/json",
        },
        timeout: 120000,
      }
    )
  );
  return parseJsonFromModel(response.data?.choices?.[0]?.message?.content);
}

async function callJsonChat({ embeddingKey, prompt, timeout = 180000 }) {
  const response = await withRetry(() =>
    axios.post(
      chatUrl,
      {
        model: chatModel,
        messages: [
          {
            role: "system",
            content:
              "你是嚴謹的對話風格分析助手。輸出必須是有效 JSON。不要猜測敏感身份。",
          },
          { role: "user", content: prompt },
        ],
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${embeddingKey}`,
          "Content-Type": "application/json",
        },
        timeout,
      }
    )
  );
  return parseJsonFromModel(response.data?.choices?.[0]?.message?.content);
}

async function generateProfileChunked({
  embeddingKey,
  member,
  chunkSize = 120,
  chunkCacheDir = "",
}) {
  const chunks = chunkMessages(member.messages, chunkSize);
  const chunkSummaries = [];

  for (let index = 0; index < chunks.length; index += 1) {
    console.log(
      `  chunk ${index + 1}/${chunks.length} for ${member.userName} (${chunks[index].length})`
    );
    chunkSummaries.push(
      await getChunkSummaryWithCache({
        cacheDir: chunkCacheDir,
        mode: "style",
        model: chatModel,
        promptVersion: STYLE_PROMPT_VERSION,
        member,
        chunkIndex: index + 1,
        totalChunks: chunks.length,
        messages: chunks[index],
        createSummary: () =>
          callJsonChat({
            embeddingKey,
            prompt: buildMemberReportChunkPrompt({
              userName: member.userName,
              messages: chunks[index],
              chunkIndex: index + 1,
              totalChunks: chunks.length,
            }),
          }),
        }),
    );
  }

  return callJsonChat({
    embeddingKey,
    prompt: buildMemberReportFromChunkSummariesPrompt({
      userName: member.userName,
      messageCount: member.messageCount,
      chunkSummaries,
    }),
  });
}

async function generatePersonaChunked({
  embeddingKey,
  member,
  chunkSize = 120,
  chunkCacheDir = "",
}) {
  const chunks = chunkMessages(member.messages, chunkSize);
  const chunkSummaries = [];

  for (let index = 0; index < chunks.length; index += 1) {
    console.log(
      `  persona chunk ${index + 1}/${chunks.length} for ${member.userName} (${chunks[index].length})`
    );
    chunkSummaries.push(
      await getChunkSummaryWithCache({
        cacheDir: chunkCacheDir,
        mode: "persona",
        model: chatModel,
        promptVersion: PERSONA_PROMPT_VERSION,
        member,
        chunkIndex: index + 1,
        totalChunks: chunks.length,
        messages: chunks[index],
        createSummary: () =>
          callJsonChat({
            embeddingKey,
            prompt: buildMemberPersonaChunkPrompt({
              userName: member.userName,
              messages: chunks[index],
              chunkIndex: index + 1,
              totalChunks: chunks.length,
            }),
          }),
        }),
    );
  }

  return callJsonChat({
    embeddingKey,
    prompt: buildMemberPersonaFromChunkSummariesPrompt({
      userName: member.userName,
      messageCount: member.messageCount,
      chunkSummaries,
    }),
  });
}

function renderMarkdownReport(profiles) {
  const sections = profiles.map((profile) =>
    [
      `## ${profile.userName}`,
      "",
      `- 訊息數：${profile.messageCount}`,
      `- 溝通風格：${profile.communicationStyle}`,
      `- 幽默方式：${profile.humorStyle}`,
      `- 常見話題：${Array.isArray(profile.commonTopics) ? profile.commonTopics.join("、") : profile.commonTopics}`,
      `- 回覆模式：${profile.responsePattern}`,
      `- 語言風格：${profile.languageStyle}`,
      `- AI 應如何回覆：${profile.howAiShouldReply}`,
      `- 不確定性：${profile.uncertainty}`,
      "",
      "證據：",
      ...(Array.isArray(profile.evidence) ? profile.evidence.map((item) => `- ${item}`) : []),
    ].join("\n")
  );
  return ["# 珍•Marathon Part-time•珠 成員回覆風格報告", "", ...sections].join("\n\n");
}

function renderPersonaMarkdownReport(profiles) {
  const sections = profiles.map((profile) =>
    [
      `## ${profile.userName}`,
      "",
      `- 訊息數：${profile.messageCount}`,
      `- 人設：${profile.persona || profile.oneLinePersona || ""}`,
      `- 人物分析：${profile.personalityAnalysis || profile.personalityRead || ""}`,
      `- 画像：${profile.portrait || ""}`,
      "",
      "### 講話習慣/口癖",
      ...(Array.isArray(profile.speakingHabits)
        ? profile.speakingHabits.map((item) => `- ${item}`)
        : [`- ${profile.speakingHabits || ""}`]),
      "",
      "### 常互動對象",
      ...(Array.isArray(profile.commonInteractionTargets)
        ? profile.commonInteractionTargets.map((item) =>
            typeof item === "string"
              ? `- ${item}`
              : `- ${item.target}: ${item.pattern}`
          )
        : [`- ${profile.commonInteractionTargets || ""}`]),
      "",
      "### 經典語句",
      ...(Array.isArray(profile.classicLines || profile.typicalJokesAndExamples)
        ? (profile.classicLines || profile.typicalJokesAndExamples).map((item) => `- ${item}`)
        : [`- ${profile.classicLines || profile.typicalJokesAndExamples || ""}`]),
      "",
      `### 回覆方法`,
      profile.replyMethod || profile.howToReplyToThem || "",
      "",
      `### 不確定性`,
      profile.uncertainty || "",
    ].join("\n")
  );
  return ["# 珍•Marathon Part-time•珠 成員人物画像報告", "", ...sections].join("\n\n");
}

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [key, ...rest] = arg.slice(2).split("=");
    options[key] = rest.join("=");
  }
  return { positional, options };
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const inputPath = positional[0];
  if (!inputPath) {
    console.error(
      "Usage: node scripts/generate-member-report.js <history.clean.json> [--out=<report.json>]"
    );
    process.exit(1);
  }

  const embeddingKey = resolveEmbeddingKey();
  if (!embeddingKey) {
    console.error("Missing EMBEDDING_API_KEY or EMBEDDING_API_KEY_FILE.");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const members = groupMessagesByUser(raw);
  const profiles = [];
  const useChunked = options.chunked === "true";
  const mode = options.mode || "style";
  const chunkSize = Number(options.chunkSize || 120);
  const chunkCacheDir =
    options.chunkCacheDir ||
    (mode === "persona"
      ? path.join(path.dirname(inputPath), ".member-report-chunk-cache")
      : "");

  for (const member of members) {
    console.log(`Generating report for ${member.userName} (${member.messageCount})...`);
    profiles.push(
      mode === "persona"
        ? await generatePersonaChunked({
            embeddingKey,
            member,
            chunkSize,
            chunkCacheDir,
          })
        : useChunked
        ? await generateProfileChunked({
            embeddingKey,
            member,
            chunkSize,
            chunkCacheDir: options.chunkCacheDir || "",
          })
        : await generateProfile({ embeddingKey, member })
    );
  }

  const outPath =
    options.out || path.join(path.dirname(inputPath), "marathon-member-report.json");
  const markdownPath = outPath.replace(/\.json$/i, ".md");
  fs.writeFileSync(outPath, `${JSON.stringify(profiles, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    markdownPath,
    `${mode === "persona" ? renderPersonaMarkdownReport(profiles) : renderMarkdownReport(profiles)}\n`,
    "utf8"
  );
  console.log(JSON.stringify({ outPath, markdownPath, profiles: profiles.length }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildMemberPersonaChunkPrompt,
  buildMemberPersonaFromChunkSummariesPrompt,
  buildMemberReportChunkPrompt,
  buildMemberReportFromChunkSummariesPrompt,
  buildMemberReportPrompt,
  chunkMessages,
  createChunkSummaryCacheKey,
  getChunkSummaryWithCache,
  groupMessagesByUser,
  parseJsonFromModel,
};
