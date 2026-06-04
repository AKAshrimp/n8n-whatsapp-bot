const fs = require("fs");
const path = require("path");
const {
  createHistoryImportDecision,
  normalizeText,
} = require("../message-utils");
const { normalizeHistoryMessage } = require("./history-utils");

function loadAiOutboxHashes(jsonl = "") {
  const hashes = new Set();
  for (const line of String(jsonl).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);
      if (record.type === "ai_reply" && record.textHash) {
        hashes.add(record.textHash);
      }
    } catch {
      // Ignore malformed historical log lines.
    }
  }
  return hashes;
}

function increment(object, key, field) {
  object[key] = object[key] || {};
  object[key][field] = (object[key][field] || 0) + 1;
}

function analyzeHistory(
  rawMessages,
  { botUserId = "", aiOutboxHashes = new Set(), now = Math.floor(Date.now() / 1000) } = {}
) {
  const clean = [];
  const suspicious = [];
  const byUser = {};
  const byReason = {};

  for (const raw of rawMessages) {
    let message;
    try {
      message = normalizeHistoryMessage(raw);
    } catch (error) {
      const item = { raw, reason: `invalid:${error.message}` };
      suspicious.push(item);
      byReason[item.reason] = (byReason[item.reason] || 0) + 1;
      continue;
    }

    const decision = createHistoryImportDecision(message, {
      aiOutboxHashes,
      botUserId,
      now,
    });

    if (decision.import) {
      clean.push(message);
      increment(byUser, message.userId, "clean");
    } else {
      suspicious.push({ ...message, reason: decision.reason });
      increment(byUser, message.userId, "suspicious");
      byReason[decision.reason] = (byReason[decision.reason] || 0) + 1;
    }
  }

  return {
    total: rawMessages.length,
    clean,
    suspicious,
    byUser,
    byReason,
    estimatedEmbeddingCount: clean.length,
  };
}

function readJsonArray(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("History input must be a JSON array");
  }
  return parsed;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error(
      "Usage: node scripts/history-analysis.js <history.json> [--botUserId=<id>] [--outbox=<ai-outbox.jsonl>] [--outDir=<dir>]"
    );
    process.exit(1);
  }

  const options = Object.fromEntries(
    process.argv
      .slice(3)
      .filter((arg) => arg.startsWith("--"))
      .map((arg) => {
        const [key, ...rest] = arg.slice(2).split("=");
        return [key, rest.join("=")];
      })
  );

  let botUserId = normalizeText(options.botUserId);
  if (!botUserId && options.healthUrl) {
    const response = await fetch(options.healthUrl);
    const health = await response.json();
    botUserId = normalizeText(health.userId);
  }

  const outboxText = options.outbox && fs.existsSync(options.outbox)
    ? fs.readFileSync(options.outbox, "utf8")
    : "";
  const aiOutboxHashes = loadAiOutboxHashes(outboxText);
  const result = analyzeHistory(readJsonArray(inputPath), {
    botUserId,
    aiOutboxHashes,
  });

  const outDir = options.outDir || path.join(path.dirname(inputPath), "analysis");
  writeJson(path.join(outDir, "history.clean.json"), result.clean);
  writeJson(path.join(outDir, "history.suspicious.json"), result.suspicious);
  writeJson(path.join(outDir, "history.summary.json"), {
    total: result.total,
    clean: result.clean.length,
    suspicious: result.suspicious.length,
    byUser: result.byUser,
    byReason: result.byReason,
    estimatedEmbeddingCount: result.estimatedEmbeddingCount,
  });

  console.log(
    JSON.stringify(
      {
        total: result.total,
        clean: result.clean.length,
        suspicious: result.suspicious.length,
        byReason: result.byReason,
        outputDirectory: outDir,
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
  analyzeHistory,
  loadAiOutboxHashes,
};
