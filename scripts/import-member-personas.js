const fs = require("fs");
const {
  TARGET_VECTOR_SIZE,
  createMemberProfileId,
  normalizeGroupName,
} = require("./history-utils");
const {
  embedBatch,
  resolveEmbeddingKey,
  withRetry,
} = require("./seed-whatsapp-history");

const inputPath = process.argv[2];
const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";

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

function normalizeInteractionTargets(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") {
        return { target: normalizeText(item), pattern: "" };
      }
      return {
        target: normalizeText(item?.target),
        pattern: normalizeText(item?.pattern),
      };
    })
    .filter((item) => item.target || item.pattern);
}

function parseBullets(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.match(/^-\s+(.*)$/)?.[1]?.trim())
    .filter(Boolean);
}

function sectionBody(block, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`^### ${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=^### |^## |(?![\\s\\S]))`, "m"));
  return match ? match[1].trim() : "";
}

function parseInteractionBullet(value) {
  const text = normalizeText(value);
  const separatorIndex = text.search(/[：:]/);
  if (separatorIndex === -1) return { target: text, pattern: "" };
  return {
    target: normalizeText(text.slice(0, separatorIndex)),
    pattern: normalizeText(text.slice(separatorIndex + 1)),
  };
}

function parseMemberPersonaMarkdown(markdown) {
  return String(markdown || "")
    .replace(/^\uFEFF/, "")
    .split(/(?=^## )/m)
    .filter((block) => block.startsWith("## "))
    .map((block) => {
      const userName = normalizeText(block.match(/^##\s+(.+)$/m)?.[1]);
      const messageCount = Number(block.match(/^- 訊息數：\s*(\d+)/m)?.[1] || 0);
      const persona = normalizeText(block.match(/^- 一句話人設：\s*(.+)$/m)?.[1]);
      const speakingHabits = parseBullets(sectionBody(block, "講話習慣/口癖"));
      const commonInteractionTargets = parseBullets(sectionBody(block, "常見互動對象")).map(parseInteractionBullet);
      const classicLines = parseBullets(sectionBody(block, "經典語句 / 模仿參考短句"));

      return normalizePersonaProfile({
        userName,
        messageCount,
        persona,
        personalityAnalysis: sectionBody(block, "人物分析"),
        portrait: sectionBody(block, "群友眼中的画像"),
        speakingHabits,
        commonInteractionTargets,
        classicLines,
        replyMethod: sectionBody(block, "回覆方法"),
        uncertainty: "只基於群聊文字與生成画像",
      });
    });
}

function normalizePersonaProfile(raw) {
  const userName = normalizeText(raw?.userName);
  if (!userName) throw new Error("Persona profile requires userName");

  return {
    userName,
    messageCount: Number(raw?.messageCount || 0),
    persona: normalizeText(raw?.persona || raw?.oneLinePersona),
    personalityAnalysis: normalizeText(raw?.personalityAnalysis || raw?.personalityRead),
    portrait: normalizeText(raw?.portrait),
    speakingHabits: normalizeStringArray(raw?.speakingHabits),
    commonInteractionTargets: normalizeInteractionTargets(raw?.commonInteractionTargets),
    classicLines: normalizeStringArray(raw?.classicLines || raw?.typicalJokesAndExamples),
    replyMethod: normalizeText(raw?.replyMethod || raw?.howToReplyToThem),
    uncertainty: normalizeText(raw?.uncertainty),
  };
}

function formatInteractionTargets(targets) {
  return targets
    .map((item) =>
      item.pattern ? `${item.target}：${item.pattern}` : item.target
    )
    .filter(Boolean)
    .join("；");
}

function buildMemberPersonaText(profile) {
  return [
    `Member persona: ${profile.userName}`,
    `訊息數：${profile.messageCount}`,
    `人設：${profile.persona}`,
    `人物分析：${profile.personalityAnalysis}`,
    `画像：${profile.portrait}`,
    `講話習慣/口癖：${profile.speakingHabits.join("；")}`,
    `常互動對象：${formatInteractionTargets(profile.commonInteractionTargets)}`,
    `經典語句：${profile.classicLines.join("；")}`,
    `回覆方法：${profile.replyMethod}`,
    `不確定性：${profile.uncertainty}`,
  ]
    .filter((line) => !line.endsWith("："))
    .join("\n");
}

function assertVector(vector) {
  if (!Array.isArray(vector) || vector.length !== TARGET_VECTOR_SIZE) {
    throw new Error(`Qdrant vector must have ${TARGET_VECTOR_SIZE} dimensions`);
  }
}

function buildMemberPersonaPoint({
  groupId,
  groupName,
  profile,
  vector,
  timestamp = Math.floor(Date.now() / 1000),
}) {
  assertVector(vector);
  const normalizedGroupId = normalizeText(groupId);
  const normalizedGroupName = normalizeGroupName(groupName);
  const userId = profile.userName;
  const pointId = createMemberProfileId({
    groupId: normalizedGroupId,
    userId,
  });

  return {
    id: pointId,
    vector,
    payload: {
      messageId: pointId,
      groupId: normalizedGroupId,
      groupName: normalizedGroupName,
      userId,
      userName: profile.userName,
      text: buildMemberPersonaText(profile),
      timestamp: Number(timestamp),
      expiresAt: Number(timestamp) + 365 * 24 * 60 * 60,
      type: "member_profile",
      source: "history-persona-report",
      messageCount: profile.messageCount,
      persona: profile.persona,
      personalityAnalysis: profile.personalityAnalysis,
      portrait: profile.portrait,
      speakingHabits: profile.speakingHabits,
      commonInteractionTargets: profile.commonInteractionTargets,
      classicLines: profile.classicLines,
      replyMethod: profile.replyMethod,
      uncertainty: profile.uncertainty,
    },
  };
}

async function upsertPoints({ axios, points }) {
  await withRetry(() =>
    axios.put(
      `${qdrantUrl}/collections/whatsapp_memory/points?wait=true`,
      { points },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 60000,
      }
    )
  );
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
  const reportPath = positional[0] || inputPath;
  if (!reportPath) {
    console.error(
      "Usage: node scripts/import-member-personas.js <persona-report.json> --groupId=<id> --groupName=<name>"
    );
    process.exit(1);
  }

  const groupId = options.groupId || "120363142022323634@g.us";
  const groupName = options.groupName || "珍•Marathon Part-time•珠";
  const embeddingKey = resolveEmbeddingKey();
  if (!embeddingKey) {
    console.error("Missing EMBEDDING_API_KEY or EMBEDDING_API_KEY_FILE.");
    process.exit(1);
  }

  const reportText = fs.readFileSync(reportPath, "utf8");
  let raw;
  if (/\.md$/i.test(reportPath)) {
    raw = parseMemberPersonaMarkdown(reportText);
  } else {
    raw = JSON.parse(reportText);
  }
  if (!Array.isArray(raw)) throw new Error("Persona report must be a JSON array or markdown persona report");

  const profiles = raw.map(normalizePersonaProfile);
  const texts = profiles.map(buildMemberPersonaText);
  const axios = require("axios");
  const vectors = await embedBatch({ axios, embeddingKey, texts });
  const timestamp = Math.floor(Date.now() / 1000);
  const points = profiles.map((profile, index) =>
    buildMemberPersonaPoint({
      groupId,
      groupName,
      profile,
      vector: vectors[index],
      timestamp,
    })
  );

  await upsertPoints({ axios, points });
  console.log(
    JSON.stringify(
      {
        imported: points.length,
        groupId,
        groupName,
        type: "member_profile",
        source: "history-persona-report",
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildMemberPersonaPoint,
  buildMemberPersonaText,
  normalizePersonaProfile,
  parseMemberPersonaMarkdown,
};
