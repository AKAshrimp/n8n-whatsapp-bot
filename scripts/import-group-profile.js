const crypto = require("crypto");
const fs = require("fs");
const {
  TARGET_VECTOR_SIZE,
  normalizeGroupName,
} = require("./history-utils");
const {
  embedBatch,
  resolveEmbeddingKey,
  withRetry,
} = require("./seed-whatsapp-history");
const { normalizeGroupProfile } = require("./generate-group-profile");

const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";

function normalizeText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uuidFromSource(source) {
  const hash = crypto.createHash("sha256").update(source).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(
    13,
    16
  )}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function createGroupProfileId({ groupId }) {
  return uuidFromSource(["group-profile", normalizeText(groupId)].join("|"));
}

function formatRoles(roles) {
  return roles
    .map((item) => (item.role ? `${item.member}：${item.role}` : item.member))
    .filter(Boolean)
    .join("；");
}

function buildGroupProfileText(profile) {
  return [
    `Group profile: ${profile.groupName}`,
    `群整體人設：${profile.groupPersona}`,
    `群整體氣氛：${profile.vibe}`,
    `群內分工：${formatRoles(profile.roles)}`,
    `常見梗：${profile.commonJokes.join("；")}`,
    `群內互動規則：${profile.interactionRules.join("；")}`,
    `統一回覆風格：${profile.unifiedReplyStyle}`,
    `回覆邊界：${profile.replyBoundaries.join("；")}`,
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

function buildGroupProfilePoint({
  groupId,
  groupName,
  profile,
  vector,
  timestamp = Math.floor(Date.now() / 1000),
}) {
  assertVector(vector);
  const normalizedGroupId = normalizeText(groupId);
  const normalizedGroupName = normalizeGroupName(groupName || profile.groupName);
  const normalizedProfile = normalizeGroupProfile({
    ...profile,
    groupName: profile.groupName || normalizedGroupName,
  });
  const pointId = createGroupProfileId({ groupId: normalizedGroupId });

  return {
    id: pointId,
    vector,
    payload: {
      messageId: pointId,
      groupId: normalizedGroupId,
      groupName: normalizedGroupName,
      userId: "__group__",
      userName: "group_profile",
      text: buildGroupProfileText(normalizedProfile),
      timestamp: Number(timestamp),
      expiresAt: Number(timestamp) + 365 * 24 * 60 * 60,
      type: "group_profile",
      source: "history-group-profile-summary",
      groupPersona: normalizedProfile.groupPersona,
      vibe: normalizedProfile.vibe,
      roles: normalizedProfile.roles,
      commonJokes: normalizedProfile.commonJokes,
      interactionRules: normalizedProfile.interactionRules,
      unifiedReplyStyle: normalizedProfile.unifiedReplyStyle,
      replyBoundaries: normalizedProfile.replyBoundaries,
      uncertainty: normalizedProfile.uncertainty,
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
  const inputPath = positional[0];
  if (!inputPath) {
    console.error(
      "Usage: node scripts/import-group-profile.js <group-profile.json> --groupId=<id> --groupName=<name>"
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

  const profile = normalizeGroupProfile(JSON.parse(fs.readFileSync(inputPath, "utf8")));
  const axios = require("axios");
  const [vector] = await embedBatch({
    axios,
    embeddingKey,
    texts: [buildGroupProfileText(profile)],
  });
  const point = buildGroupProfilePoint({
    groupId,
    groupName,
    profile,
    vector,
  });
  await upsertPoints({ axios, points: [point] });
  console.log(
    JSON.stringify(
      {
        imported: 1,
        groupId,
        groupName,
        type: "group_profile",
        source: "history-group-profile-summary",
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
  buildGroupProfilePoint,
  buildGroupProfileText,
  createGroupProfileId,
};
