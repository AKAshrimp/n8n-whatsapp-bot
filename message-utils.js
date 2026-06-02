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
  getImagePayloadFromMessage,
};
