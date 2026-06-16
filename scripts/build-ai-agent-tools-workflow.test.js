const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildAiAgentToolsWorkflow,
  buildWorkflowExport,
  expectedNodeNames,
} = require("./build-ai-agent-tools-workflow");

function loadCurrentWorkflow() {
  const workflowPath = path.join(__dirname, "..", "n8n", "workflows", "workflows.json");
  return JSON.parse(fs.readFileSync(workflowPath, "utf8"))[0];
}

function node(workflow, name) {
  return workflow.nodes.find((item) => item.name === name);
}

function connectionTargetNames(workflow, fromNode, outputIndex) {
  return (workflow.connections[fromNode]?.main?.[outputIndex] || []).map((target) => target.node);
}

function directMainInputs(workflow, toNode) {
  const inputs = [];

  for (const [fromNode, connections] of Object.entries(workflow.connections)) {
    for (const output of connections.main || []) {
      for (const target of output || []) {
        if (target.node === toNode) {
          inputs.push(fromNode);
        }
      }
    }
  }

  return inputs;
}

function mainOutputTargets(workflow, fromNode, outputIndex = 0) {
  return workflow.connections[fromNode]?.main?.[outputIndex] || [];
}

function routeReachesTargetWithoutNode(workflow, fromNode, outputIndex, targetNode, forbiddenNode) {
  const queue = mainOutputTargets(workflow, fromNode, outputIndex).map((target) => target.node);
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();

    if (current === forbiddenNode) {
      return false;
    }

    if (current === targetNode) {
      return true;
    }

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    for (const output of workflow.connections[current]?.main || []) {
      for (const target of output || []) {
        queue.push(target.node);
      }
    }
  }

  return false;
}

test("buildAiAgentToolsWorkflow creates a new inactive workflow without mutating source", () => {
  const source = loadCurrentWorkflow();
  const sourceSnapshot = JSON.stringify(source);
  const workflow = buildAiAgentToolsWorkflow(source);

  assert.equal(workflow.name, "whatsapp bot AI Agent tools");
  assert.equal(workflow.active, false);
  assert.equal(workflow.isArchived, false);
  assert.notEqual(workflow.id, source.id);
  assert.equal(JSON.stringify(source), sourceSnapshot);
});

test("generated workflow contains the approved visual sections and nodes", () => {
  const workflow = buildAiAgentToolsWorkflow(loadCurrentWorkflow());
  const names = workflow.nodes.map((item) => item.name);

  for (const name of expectedNodeNames) {
    assert.ok(names.includes(name), `missing node ${name}`);
  }

  assert.equal(node(workflow, "Sticky: Entry and routing").type, "n8n-nodes-base.stickyNote");
  assert.equal(node(workflow, "Sticky: Agent core").type, "n8n-nodes-base.stickyNote");
  assert.equal(node(workflow, "Sticky: Agent tools").type, "n8n-nodes-base.stickyNote");
  assert.equal(node(workflow, "Sticky: Data and memory").type, "n8n-nodes-base.stickyNote");
  assert.equal(node(workflow, "Sticky: Output and errors").type, "n8n-nodes-base.stickyNote");
});

test("generated workflow keeps existing Qdrant collection and WhatsApp bridge endpoints", () => {
  const workflow = buildAiAgentToolsWorkflow(loadCurrentWorkflow());
  const searchMemory = node(workflow, "Tool: Search Memory");
  const sendReply = node(workflow, "Send WhatsApp Reply");
  const parameterUrls = workflow.nodes
    .map((item) => item.parameters?.url)
    .filter((url) => typeof url === "string");

  assert.ok(searchMemory, "missing Tool: Search Memory node");
  assert.ok(sendReply, "missing Send WhatsApp Reply node");
  assert.ok(
    searchMemory.parameters.url.includes(
      "http://qdrant:6333/collections/whatsapp_memory/points/scroll"
    )
  );
  assert.ok(sendReply.parameters.url.includes("http://whatsapp-bridge:3000/send-message"));
  assert.ok(
    parameterUrls.every((url) => !url.includes("/points/delete")),
    "node parameter URLs must not delete Qdrant points"
  );
});

test("generated workflow avoids large legacy code node names", () => {
  const workflow = buildAiAgentToolsWorkflow(loadCurrentWorkflow());
  const names = workflow.nodes.map((item) => item.name);

  assert.ok(!names.includes("prepare memory"));
  assert.ok(!names.includes("Brave Search"));
  assert.ok(!names.includes("append web search context"));
  assert.ok(!names.includes("parse web search decision"));
  assert.ok(!names.includes("build qdrant search"));
});

test("generated workflow has agent-centered connections", () => {
  const workflow = buildAiAgentToolsWorkflow(loadCurrentWorkflow());

  assert.deepEqual(workflow.connections["WhatsApp Webhook"].main[0], [
    { node: "Normalize Payload", type: "main", index: 0 },
  ]);
  assert.deepEqual(workflow.connections["Normalize Payload"].main[0], [
    { node: "Intent Router", type: "main", index: 0 },
  ]);
  assert.deepEqual(workflow.connections["Agent Context Builder"].main[0], [
    { node: "WhatsApp AI Agent", type: "main", index: 0 },
  ]);
  assert.deepEqual(workflow.connections["WhatsApp AI Agent"].main[0], [
    { node: "Structured Reply Parser", type: "main", index: 0 },
  ]);
  assert.deepEqual(workflow.connections["Structured Reply Parser"].main[0], [
    { node: "Format WhatsApp Reply", type: "main", index: 0 },
  ]);
});

test("intent router fans out to the expected tool outputs", () => {
  const workflow = buildAiAgentToolsWorkflow(loadCurrentWorkflow());

  assert.deepEqual(connectionTargetNames(workflow, "Intent Router", 0), [
    "Tool: Search Memory",
    "Tool: Brave Search",
  ]);
  assert.deepEqual(connectionTargetNames(workflow, "Intent Router", 1), ["Tool: Write Memory"]);
  assert.deepEqual(connectionTargetNames(workflow, "Intent Router", 2), ["Tool: Memory Status"]);
  assert.deepEqual(connectionTargetNames(workflow, "Intent Router", 3), [
    "Tool: Image Generate/Edit",
  ]);
  assert.deepEqual(connectionTargetNames(workflow, "Intent Router", 4), [
    "Existing Qdrant Collection",
  ]);
  assert.deepEqual(connectionTargetNames(workflow, "Intent Router", 5), ["Error Fallback"]);
});

test("chat route enters Agent Context Builder only after memory instructions", () => {
  const workflow = buildAiAgentToolsWorkflow(loadCurrentWorkflow());

  assert.deepEqual(connectionTargetNames(workflow, "Tool: Brave Search", 0), [
    "Tool: Format Brave Results",
  ]);
  assert.deepEqual(connectionTargetNames(workflow, "Tool: Format Brave Results", 0), [
    "Compatibility Formatter",
  ]);
  assert.deepEqual(directMainInputs(workflow, "Agent Context Builder"), [
    "Agent Memory Instructions",
  ]);
});

test("non-chat command routes reach reply formatter without entering agent context", () => {
  const workflow = buildAiAgentToolsWorkflow(loadCurrentWorkflow());

  for (const outputIndex of [1, 2, 3, 4]) {
    assert.equal(
      routeReachesTargetWithoutNode(
        workflow,
        "Intent Router",
        outputIndex,
        "Format WhatsApp Reply",
        "Agent Context Builder"
      ),
      true,
      `Intent Router output ${outputIndex} should reach Format WhatsApp Reply without Agent Context Builder`
    );
  }
});


test("buildWorkflowExport wraps the generated workflow in an n8n export array", () => {
  const source = loadCurrentWorkflow();
  const exportObject = buildWorkflowExport(source);

  assert.ok(Array.isArray(exportObject));
  assert.equal(exportObject.length, 1);
  assert.equal(exportObject[0].name, "whatsapp bot AI Agent tools");
});

test("generated workflow has unique node ids and names", () => {
  const workflow = buildAiAgentToolsWorkflow(loadCurrentWorkflow());
  const ids = workflow.nodes.map((item) => item.id);
  const names = workflow.nodes.map((item) => item.name);

  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(names).size, names.length);
});

test("every connection target exists", () => {
  const workflow = buildAiAgentToolsWorkflow(loadCurrentWorkflow());
  const names = new Set(workflow.nodes.map((item) => item.name));

  for (const [from, connection] of Object.entries(workflow.connections)) {
    assert.ok(names.has(from), `connection source missing: ${from}`);
    for (const output of connection.main || []) {
      for (const target of output || []) {
        assert.ok(names.has(target.node), `connection target missing: ${target.node}`);
      }
    }
  }
});

test("workflow export file can be regenerated and parsed", () => {
  const source = loadCurrentWorkflow();
  const exportObject = buildWorkflowExport(source);
  const parsed = JSON.parse(JSON.stringify(exportObject));

  assert.equal(parsed[0].name, "whatsapp bot AI Agent tools");
  assert.equal(parsed[0].nodes.length, expectedNodeNames.length);
});
