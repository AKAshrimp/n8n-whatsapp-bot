const crypto = require("crypto");

const TARGET_VECTOR_SIZE = 1024;

function normalizeText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGroupName(name) {
  return normalizeText(name).replace(/[()（）]/g, "").trim();
}

function normalizeHistoryMessage(raw) {
  const groupId = normalizeText(raw?.groupId);
  const groupName = normalizeGroupName(raw?.groupName);
  const userId = normalizeText(raw?.userId);
  const userName = normalizeText(raw?.userName) || userId;
  const text = normalizeText(raw?.text);
  const timestamp = Number(raw?.timestamp);

  if (!groupId) throw new Error("History message requires groupId");
  if (!groupName) throw new Error("History message requires groupName");
  if (!userId) throw new Error("History message requires userId");
  if (!text) throw new Error("History message requires text");
  if (!Number.isFinite(timestamp)) {
    throw new Error("History message requires numeric timestamp");
  }

  return {
    groupId,
    groupName,
    userId,
    userName,
    text,
    timestamp,
  };
}

function shouldImportHistoryText(value) {
  const text = normalizeText(value);
  if (text.length < 5) return false;

  const lowValue = new Set([
    "ok",
    "okay",
    "yes",
    "no",
    "哈哈",
    "haha",
    "lol",
    "收到",
    "thx",
  ]);

  if (lowValue.has(text.toLowerCase())) return false;
  if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(text)) {
    return false;
  }

  return true;
}

function uuidFromSource(source) {
  const hash = crypto.createHash("sha256").update(source).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(
    13,
    16
  )}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function createHistoryMessageId(message) {
  return uuidFromSource(
    [
      "history",
      message.groupId,
      message.userId,
      message.timestamp,
      message.text,
    ].join("|")
  );
}

function createMemberProfileId({ groupId, userId }) {
  return uuidFromSource(["member-profile", groupId, userId].join("|"));
}

function createMemberIndexId({ groupId, userId }) {
  return uuidFromSource(["member-index", groupId, userId].join("|"));
}

function assertVector(vector) {
  if (!Array.isArray(vector) || vector.length !== TARGET_VECTOR_SIZE) {
    throw new Error(`Qdrant vector must have ${TARGET_VECTOR_SIZE} dimensions`);
  }
}

function buildQdrantMessagePoint(message, vector) {
  assertVector(vector);
  const normalized = normalizeHistoryMessage(message);
  return {
    id: createHistoryMessageId(normalized),
    vector,
    payload: {
      messageId: createHistoryMessageId(normalized),
      groupId: normalized.groupId,
      groupName: normalized.groupName,
      userId: normalized.userId,
      userName: normalized.userName,
      text: normalized.text,
      timestamp: normalized.timestamp,
      expiresAt: normalized.timestamp + 180 * 24 * 60 * 60,
      type: "whatsapp_message",
      source: "history-seed",
    },
  };
}

function buildMemberProfilePrompt(userName, messages) {
  const lines = messages
    .slice(0, 80)
    .map((message, index) => `${index + 1}. ${normalizeText(message.text)}`)
    .join("\n");

  return [
    "You are summarizing WhatsApp group chat history for a RAG assistant.",
    `Member: ${normalizeText(userName)}`,
    "",
    "Create a safe communication style profile for this member.",
    "",
    "Allowed:",
    "- communication style",
    "- humor style",
    "- preferred language",
    "- common topics",
    "- planning habits",
    "- response patterns",
    "- interests that appear directly in messages",
    "",
    "Forbidden:",
    "- protected attributes",
    "- medical condition guesses",
    "- politics / religion / sexuality guesses",
    "- sensitive personal identity inferences",
    "- claims not supported by messages",
    "",
    "Write in Traditional Chinese with some Cantonese if natural.",
    "Keep it concise.",
    "Separate facts from uncertain observations.",
    "",
    "Messages:",
    lines,
  ].join("\n");
}

function buildMemberIndexPoint({
  groupId,
  groupName,
  userId,
  userName,
  aliases = [],
  timestamp = Math.floor(Date.now() / 1000),
}) {
  const normalizedName = normalizeText(userName) || normalizeText(userId);
  const tokens = Array.from(
    new Set(
      [normalizedName, ...aliases]
        .flatMap((value) => normalizeText(value).split(/\s+/))
        .map((value) => value.toLowerCase())
        .filter(Boolean)
    )
  );

  const pointId = createMemberIndexId({ groupId, userId });

  return {
    id: pointId,
    vector: null,
    payload: {
      messageId: pointId,
      groupId: normalizeText(groupId),
      groupName: normalizeGroupName(groupName),
      userId: normalizeText(userId),
      userName: normalizedName,
      text: `Member index: ${normalizedName}. Known name tokens: ${tokens.join(
        ", "
      )}. This member can be referred to as ${[normalizedName, ...aliases]
        .map(normalizeText)
        .filter(Boolean)
        .join(", ")}.`,
      timestamp: Number(timestamp),
      expiresAt: Number(timestamp) + 180 * 24 * 60 * 60,
      type: "member_index",
      source: "history-member-index",
    },
  };
}

module.exports = {
  TARGET_VECTOR_SIZE,
  buildMemberIndexPoint,
  buildMemberProfilePrompt,
  buildQdrantMessagePoint,
  createHistoryMessageId,
  createMemberIndexId,
  createMemberProfileId,
  normalizeGroupName,
  normalizeHistoryMessage,
  shouldImportHistoryText,
};
