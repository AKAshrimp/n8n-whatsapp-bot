const fs = require("fs");
const path = "C:/Users/USER/Desktop/n8n-whatsapp-bot/n8n/workflows/workflows.json";
const workflows = JSON.parse(fs.readFileSync(path, "utf8"));
const workflow = workflows[0];

function findNode(name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Missing node: ${name}`);
  return node;
}

function ensureConnection(from, outputIndex, to) {
  workflow.connections[from] = workflow.connections[from] || { main: [] };
  workflow.connections[from].main = workflow.connections[from].main || [];
  while (workflow.connections[from].main.length <= outputIndex) {
    workflow.connections[from].main.push([]);
  }
  const list = workflow.connections[from].main[outputIndex];
  if (!list.some((entry) => entry.node === to && entry.type === "main" && entry.index === 0)) {
    list.push({ node: to, type: "main", index: 0 });
  }
}

const highRiskNodes = [
  "qwen embed record",
  "qwen embed question",
  "qwen embed ai question",
  "qdrant search memory",
  "qdrant upsert memory",
  "qdrant upsert ai question",
  "Deepseek",
];

for (const nodeName of highRiskNodes) {
  const node = findNode(nodeName);
  node.onError = "continueErrorOutput";
  ensureConnection(nodeName, 1, "prepare safe error message");
}

fs.writeFileSync(path, JSON.stringify(workflows, null, 2));
