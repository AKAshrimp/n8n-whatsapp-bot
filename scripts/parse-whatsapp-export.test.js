const assert = require("node:assert/strict");
const test = require("node:test");

const {
  filterMessagesByAgeWindow,
  filterMessagesByRecentDays,
  parseWhatsAppExport,
} = require("./parse-whatsapp-export");

test("parseWhatsAppExport parses dated messages and skips system/media lines", () => {
  const messages = parseWhatsAppExport(
    [
      "15/6/2023 17:24 - 訊息和通話經端對端加密。",
      "15/6/2023 17:33 - CVVC: 第一行",
      "第二行",
      "15/6/2023 17:34 - Riley: <媒體已略去>",
      "15/6/2023 17:35 - Riley: 我8月去旅行",
    ].join("\n"),
    {
      groupId: "group@g.us",
      groupName: "珍•Marathon Part-time•珠",
    }
  );

  assert.deepEqual(messages, [
    {
      groupId: "group@g.us",
      groupName: "珍•Marathon Part-time•珠",
      userId: "CVVC",
      userName: "CVVC",
      text: "第一行\n第二行",
      timestamp: 1686821580,
    },
    {
      groupId: "group@g.us",
      groupName: "珍•Marathon Part-time•珠",
      userId: "Riley",
      userName: "Riley",
      text: "我8月去旅行",
      timestamp: 1686821700,
    },
  ]);
});

test("filterMessagesByRecentDays keeps last month relative to latest export message", () => {
  const messages = [
    { timestamp: 1000, text: "old" },
    { timestamp: 40 * 24 * 60 * 60, text: "latest" },
  ];

  const recent = filterMessagesByRecentDays(messages, 30);

  assert.deepEqual(recent, [messages[1]]);
});

test("filterMessagesByAgeWindow keeps messages between day offsets from latest message", () => {
  const day = 24 * 60 * 60;
  const latest = 100 * day;
  const messages = [
    { timestamp: latest - 10 * day, text: "last10" },
    { timestamp: latest - 31 * day, text: "last31" },
    { timestamp: latest - 45 * day, text: "last45" },
    { timestamp: latest - 60 * day, text: "last60" },
    { timestamp: latest - 61 * day, text: "last61" },
    { timestamp: latest, text: "latest" },
  ];

  const window = filterMessagesByAgeWindow(messages, {
    fromDays: 31,
    toDays: 60,
  });

  assert.deepEqual(window, [messages[1], messages[2], messages[3]]);
});
