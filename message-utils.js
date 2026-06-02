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
  const source = nativeId
    ? String(nativeId)
    : [
        fallback.groupId || "",
        fallback.userId || "",
        message?.timestamp || fallback.timestamp || "",
        fallback.text || "",
      ].join("|");

  const hash = crypto
    .createHash("sha256")
    .update(source)
    .digest("hex");

  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(
    13,
    16
  )}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
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
