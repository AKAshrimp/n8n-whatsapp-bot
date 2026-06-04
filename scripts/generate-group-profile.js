const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { resolveEmbeddingKey, withRetry } = require("./seed-whatsapp-history");
const { parseJsonFromModel } = require("./generate-member-report");

const chatUrl =
  process.env.CHAT_COMPLETIONS_URL ||
  "https://tokendance.space/gateway/v1/chat/completions";
const chatModel = process.env.CHAT_MODEL || "deepseek-v4-flash";

function normalizeText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return normalizeText(value) ? [normalizeText(value)] : [];
  return value.map(normalizeText).filter(Boolean);
}

function normalizeRoles(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return { member: normalizeText(item), role: "" };
      return {
        member: normalizeText(item?.member),
        role: normalizeText(item?.role),
      };
    })
    .filter((item) => item.member || item.role);
}

function buildGroupProfilePrompt({ groupName, memberProfiles }) {
  return [
    "你正在根據 WhatsApp 群組成員人物画像，整合一份群組層級 profile。",
    `群組：${groupName}`,
    "",
    "輸出目的：讓 AI 之後回覆時理解這個群的整體氣氛、群內分工、常見梗和互動規則。",
    "重要：回覆人格必須統一，不要按每個成員改變回覆人格；member profile 只用來理解背景，不用來模仿任何人。",
    "統一回覆風格：幽默、嘴賤、毒舌少少，但不要惡意攻擊、不要羞辱人。像 WhatsApp 群友聊天，不要像客服。",
    "不要推斷敏感屬性，例如政治、宗教、性取向、健康、家庭背景、受保護身份。",
    "不要輸出證據欄位，不要列證據清單。",
    "",
    "請只輸出 JSON，不要 markdown。格式：",
    JSON.stringify(
      {
        groupName,
        groupPersona: "群整體人設",
        vibe: "群整體氣氛",
        roles: [
          {
            member: "成員名",
            role: "群內分工/常見定位",
          },
        ],
        commonJokes: ["常見梗/經典語句/互動笑位"],
        interactionRules: ["群內互動規則"],
        unifiedReplyStyle: "統一回覆風格",
        replyBoundaries: ["回覆禁忌/不要怎樣做"],
        uncertainty: "哪些地方只是根據聊天記錄推測",
      },
      null,
      2
    ),
    "",
    "Member profiles:",
    JSON.stringify(memberProfiles, null, 2),
  ].join("\n");
}

function normalizeGroupProfile(raw) {
  return {
    groupName: normalizeText(raw?.groupName),
    groupPersona: normalizeText(raw?.groupPersona),
    vibe: normalizeText(raw?.vibe),
    roles: normalizeRoles(raw?.roles),
    commonJokes: normalizeStringArray(raw?.commonJokes),
    interactionRules: normalizeStringArray(raw?.interactionRules),
    unifiedReplyStyle: normalizeText(raw?.unifiedReplyStyle),
    replyBoundaries: normalizeStringArray(raw?.replyBoundaries),
    uncertainty: normalizeText(raw?.uncertainty),
  };
}

function buildGroupProfileMarkdown(profile) {
  return [
    `# ${profile.groupName} 群組人物画像`,
    "",
    `## 群整體人設`,
    profile.groupPersona,
    "",
    `## 群整體氣氛`,
    profile.vibe,
    "",
    `## 群內分工`,
    ...profile.roles.map((item) => `- ${item.member}：${item.role}`),
    "",
    `## 常見梗`,
    ...profile.commonJokes.map((item) => `- ${item}`),
    "",
    `## 群內互動規則`,
    ...profile.interactionRules.map((item) => `- ${item}`),
    "",
    `## 統一回覆風格`,
    profile.unifiedReplyStyle,
    "",
    `## 回覆邊界`,
    ...profile.replyBoundaries.map((item) => `- ${item}`),
    "",
    `## 不確定性`,
    profile.uncertainty,
  ].join("\n");
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

async function callJsonChat({ embeddingKey, prompt }) {
  const response = await withRetry(() =>
    axios.post(
      chatUrl,
      {
        model: chatModel,
        messages: [
          {
            role: "system",
            content:
              "你是嚴謹但有群友感的 WhatsApp 群組画像分析助手。輸出必須是有效 JSON。不要猜測敏感身份。",
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
        timeout: 180000,
      }
    )
  );
  return parseJsonFromModel(response.data?.choices?.[0]?.message?.content);
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const inputPath = positional[0];
  if (!inputPath) {
    console.error(
      "Usage: node scripts/generate-group-profile.js <member-persona-report.json> [--groupName=<name>] [--out=<group-profile.json>]"
    );
    process.exit(1);
  }

  const embeddingKey = resolveEmbeddingKey();
  if (!embeddingKey) {
    console.error("Missing EMBEDDING_API_KEY or EMBEDDING_API_KEY_FILE.");
    process.exit(1);
  }

  const groupName = options.groupName || "珍•Marathon Part-time•珠";
  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!Array.isArray(raw)) throw new Error("Member persona report must be a JSON array");

  const prompt = buildGroupProfilePrompt({ groupName, memberProfiles: raw });
  const profile = normalizeGroupProfile(await callJsonChat({ embeddingKey, prompt }));
  const outPath =
    options.out || path.join(path.dirname(inputPath), "marathon-group-profile.json");
  const markdownPath = outPath.replace(/\.json$/i, ".md");
  fs.writeFileSync(outPath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, `${buildGroupProfileMarkdown(profile)}\n`, "utf8");
  console.log(JSON.stringify({ outPath, markdownPath }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildGroupProfileMarkdown,
  buildGroupProfilePrompt,
  normalizeGroupProfile,
};
