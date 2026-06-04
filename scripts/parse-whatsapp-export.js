const fs = require("fs");
const path = require("path");
const { normalizeText } = require("../message-utils");

const MESSAGE_LINE_PATTERN =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}) - (?:(.*?): )?([\s\S]*)$/;
const MEDIA_PLACEHOLDERS = new Set(["<媒體已略去>", "<Media omitted>"]);

function toTimestamp({ day, month, year, hour, minute }) {
  return Math.floor(
    new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)).getTime() /
      1000
  );
}

function isSkippableText(text) {
  const normalized = normalizeText(text);
  return !normalized || MEDIA_PLACEHOLDERS.has(normalized);
}

function parseWhatsAppExport(text, { groupId, groupName }) {
  const messages = [];
  let current = null;

  function flush() {
    if (!current) return;
    const messageText = current.text.join("\n").trim();
    if (!isSkippableText(messageText)) {
      messages.push({
        groupId,
        groupName,
        userId: current.sender,
        userName: current.sender,
        text: messageText,
        timestamp: current.timestamp,
      });
    }
    current = null;
  }

  for (const rawLine of String(text).split(/\r?\n/)) {
    const match = rawLine.match(MESSAGE_LINE_PATTERN);
    if (match) {
      flush();
      const [, day, month, year, hour, minute, sender, body] = match;
      if (!sender) continue;
      current = {
        sender: sender.trim(),
        timestamp: toTimestamp({ day, month, year, hour, minute }),
        text: [body || ""],
      };
      continue;
    }

    if (current) {
      current.text.push(rawLine);
    }
  }

  flush();
  return messages;
}

function filterMessagesByRecentDays(messages, days) {
  if (!messages.length) return [];
  const latestTimestamp = Math.max(...messages.map((message) => Number(message.timestamp) || 0));
  const cutoff = latestTimestamp - Number(days) * 24 * 60 * 60;
  return messages.filter((message) => Number(message.timestamp) >= cutoff);
}

function filterMessagesByAgeWindow(messages, { fromDays, toDays }) {
  if (!messages.length) return [];
  const latestTimestamp = Math.max(...messages.map((message) => Number(message.timestamp) || 0));
  const newest = latestTimestamp - Number(fromDays) * 24 * 60 * 60;
  const oldest = latestTimestamp - Number(toDays) * 24 * 60 * 60;
  return messages.filter((message) => {
    const timestamp = Number(message.timestamp);
    return timestamp <= newest && timestamp >= oldest;
  });
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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const inputPath = positional[0];
  if (!inputPath) {
    console.error(
      "Usage: node scripts/parse-whatsapp-export.js <export.txt> --groupId=<id> --groupName=<name> [--days=30] [--fromDays=31 --toDays=60] [--out=<file>]"
    );
    process.exit(1);
  }

  const groupName = options.groupName || "珍•Marathon Part-time•珠";
  const groupId = options.groupId || groupName;
  const days = Number(options.days || 30);
  const fromDays = options.fromDays ? Number(options.fromDays) : null;
  const toDays = options.toDays ? Number(options.toDays) : null;
  const outPath =
    options.out ||
    path.join(
      path.dirname(inputPath),
      fromDays && toDays
        ? `whatsapp-history.days${fromDays}-${toDays}.normalized.json`
        : `whatsapp-history.last${days}.normalized.json`
    );

  const allMessages = parseWhatsAppExport(fs.readFileSync(inputPath, "utf8"), {
    groupId,
    groupName,
  });
  const exportedMessages =
    fromDays && toDays
      ? filterMessagesByAgeWindow(allMessages, { fromDays, toDays })
      : filterMessagesByRecentDays(allMessages, days);
  writeJson(outPath, exportedMessages);

  console.log(
    JSON.stringify(
      {
        parsed: allMessages.length,
        exported: exportedMessages.length,
        latestTimestamp: exportedMessages.at(-1)?.timestamp,
        output: outPath,
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  filterMessagesByAgeWindow,
  filterMessagesByRecentDays,
  parseWhatsAppExport,
};
