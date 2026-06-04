const fs = require("fs");
const {
  buildMemberIndexPoint,
  buildMemberProfilePrompt,
  normalizeHistoryMessage,
  shouldImportHistoryText,
} = require("./history-utils");

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: node scripts/summarize-member-profiles.js <history.json>");
  process.exit(1);
}

function groupByUser(messages) {
  const groups = new Map();
  for (const raw of messages) {
    const message = normalizeHistoryMessage(raw);
    if (!shouldImportHistoryText(message.text)) continue;
    const current = groups.get(message.userId) || {
      userId: message.userId,
      userName: message.userName,
      groupId: message.groupId,
      groupName: message.groupName,
      messages: [],
    };
    current.messages.push(message);
    groups.set(message.userId, current);
  }
  return Array.from(groups.values());
}

function main() {
  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error("History input must be a JSON array");
  }

  const members = groupByUser(raw);
  const output = members.map((member) => ({
    userId: member.userId,
    userName: member.userName,
    messageCount: member.messages.length,
    memberIndexPoint: buildMemberIndexPoint({
      groupId: member.groupId,
      groupName: member.groupName,
      userId: member.userId,
      userName: member.userName,
      timestamp: member.messages[0]?.timestamp,
    }),
    profilePrompt: buildMemberProfilePrompt(member.userName, member.messages),
  }));

  console.log(JSON.stringify(output, null, 2));
}

main();
