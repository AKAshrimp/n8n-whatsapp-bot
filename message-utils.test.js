const assert = require("node:assert/strict");
const test = require("node:test");

const { getImagePayloadFromMessage } = require("./message-utils");

test("uses direct image media for image edit commands", async () => {
  const result = await getImagePayloadFromMessage({
    hasMedia: true,
    downloadMedia: async () => ({
      mimetype: "image/png",
      filename: "direct.png",
      data: "direct-base64",
    }),
  });

  assert.equal(result.imageMode, "edit");
  assert.equal(result.imageSource, "direct");
  assert.deepEqual(result.imagePayload, {
    mimetype: "image/png",
    filename: "direct.png",
    data: "direct-base64",
  });
});

test("uses quoted image media when command is a reply to an image", async () => {
  const result = await getImagePayloadFromMessage({
    hasMedia: false,
    hasQuotedMsg: true,
    getQuotedMessage: async () => ({
      hasMedia: true,
      downloadMedia: async () => ({
        mimetype: "image/jpeg",
        filename: undefined,
        data: "quoted-base64",
      }),
    }),
  });

  assert.equal(result.imageMode, "edit");
  assert.equal(result.imageSource, "quoted");
  assert.deepEqual(result.imagePayload, {
    mimetype: "image/jpeg",
    filename: "input-image",
    data: "quoted-base64",
  });
});

test("falls back to generate mode when no image media is available", async () => {
  const result = await getImagePayloadFromMessage({
    hasMedia: false,
    hasQuotedMsg: true,
    getQuotedMessage: async () => ({
      hasMedia: false,
    }),
  });

  assert.equal(result.imageMode, "generate");
  assert.equal(result.imageSource, null);
  assert.equal(result.imagePayload, null);
});
