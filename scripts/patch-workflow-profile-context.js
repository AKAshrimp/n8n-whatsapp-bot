const fs = require("fs");

function findNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Missing node: ${name}`);
  return node;
}

function maybeFindNode(workflow, name) {
  return workflow.nodes.find((item) => item.name === name);
}

function upsertNode(workflow, node) {
  const index = workflow.nodes.findIndex((item) => item.name === node.name);
  if (index === -1) workflow.nodes.push(node);
  else workflow.nodes[index] = { ...workflow.nodes[index], ...node };
}

function removeNode(workflow, name) {
  workflow.nodes = workflow.nodes.filter((item) => item.name !== name);
  delete workflow.connections[name];
  for (const connection of Object.values(workflow.connections || {})) {
    connection.main = (connection.main || []).map((outputs) =>
      (outputs || []).filter((item) => item.node !== name)
    );
  }
}

function removeSwitchRule(workflow, switchName, predicate) {
  const switchNode = maybeFindNode(workflow, switchName);
  const values = switchNode?.parameters?.rules?.values;
  const outputs = workflow.connections?.[switchName]?.main;
  if (!Array.isArray(values)) return;

  const keptValues = [];
  const keptOutputs = [];
  values.forEach((value, index) => {
    if (predicate(value)) return;
    keptValues.push(value);
    if (Array.isArray(outputs)) keptOutputs.push(outputs[index] || []);
  });

  switchNode.parameters.rules.values = keptValues;
  if (Array.isArray(outputs)) workflow.connections[switchName].main = keptOutputs;
}

function buildMemoryStatusCode() {
  return String.raw`const body = $json.body;

return [
  {
    json: {
      to: body.groupId,
      message:
        "群組記憶已啟用。\n目前只會記錄有效文字訊息，保留 180 天。",
    },
  },
];`;
}

function connectOnly(workflow, from, outputIndex, to) {
  workflow.connections[from] = workflow.connections[from] || { main: [] };
  workflow.connections[from].main = workflow.connections[from].main || [];
  while (workflow.connections[from].main.length <= outputIndex) {
    workflow.connections[from].main.push([]);
  }
  workflow.connections[from].main[outputIndex] = [
    { node: to, type: "main", index: 0 },
  ];
}

function setNodePosition(workflow, name, position) {
  const node = maybeFindNode(workflow, name);
  if (node) node.position = position;
}

function upsertStickyNote(workflow, { name, id, position, width, height, color, content }) {
  upsertNode(workflow, {
    parameters: {
      content,
      height,
      width,
      color,
    },
    id,
    name,
    type: "n8n-nodes-base.stickyNote",
    typeVersion: 1,
    position,
  });
}

function applyPresentationLayout(workflow) {
  workflow.nodes
    .filter((node) => /^layout note /.test(node.name))
    .map((node) => node.name)
    .forEach((name) => removeNode(workflow, name));

  const notes = [
    {
      name: "layout note main chat brain",
      id: "rag-layout-note-main-chat-brain",
      position: [-900, -560],
      width: 4200,
      height: 720,
      color: 7,
      content:
        "## Main Chat Brain\nInput, RAG retrieval, member context, web check, DeepSeek, short-term memory, and WhatsApp reply.",
    },
    {
      name: "layout note image",
      id: "rag-layout-note-image",
      position: [-300, 220],
      width: 1120,
      height: 420,
      color: 7,
      content:
        "## Image\nGenerate or edit images, then return image output or a safe error message.",
    },
    {
      name: "layout note memory status",
      id: "rag-layout-note-memory-status",
      position: [-300, 700],
      width: 1280,
      height: 260,
      color: 7,
      content:
        "## Memory & Status\nRecord normal messages into Qdrant and answer the memory status command.",
    },
    {
      name: "layout note setup",
      id: "rag-layout-note-setup",
      position: [-900, 700],
      width: 560,
      height: 260,
      color: 7,
      content:
        "## Setup\nManual Qdrant collection initialization.",
    },
  ];

  notes.forEach((note) => upsertStickyNote(workflow, note));

  setNodePosition(workflow, "Webhook", [-760, -140]);
  setNodePosition(workflow, "Switch", [-520, -140]);

  setNodePosition(workflow, "qwen embed question", [-240, -300]);
  setNodePosition(workflow, "build qdrant search", [0, -300]);
  setNodePosition(workflow, "qdrant search memory", [240, -300]);
  setNodePosition(workflow, "build qdrant profile scroll", [480, -300]);
  setNodePosition(workflow, "qdrant scroll profiles", [720, -300]);
  setNodePosition(workflow, "build recent reply context scroll", [960, -460]);
  setNodePosition(workflow, "qdrant scroll recent reply context", [1200, -460]);

  setNodePosition(workflow, "prepare memory", [1200, -180]);
  setNodePosition(workflow, "build web search classifier", [1440, -180]);
  setNodePosition(workflow, "DeepSeek search classifier", [1680, -180]);
  setNodePosition(workflow, "parse web search decision", [1920, -180]);
  setNodePosition(workflow, "needs web search", [2160, -180]);
  setNodePosition(workflow, "Brave Search", [2400, -340]);
  setNodePosition(workflow, "append web search context", [2400, -180]);

  setNodePosition(workflow, "Deepseek", [2640, -180]);
  setNodePosition(workflow, "save memory", [2880, -180]);
  setNodePosition(workflow, "return message", [3120, -180]);

  setNodePosition(workflow, "If", [-240, 420]);
  setNodePosition(workflow, "prepare image binary", [0, 420]);
  setNodePosition(workflow, "edit Gpt image2", [240, 340]);
  setNodePosition(workflow, "Gpt-image2", [240, 500]);
  setNodePosition(workflow, "prepare image error message", [520, 280]);
  setNodePosition(workflow, "return image", [520, 420]);

  setNodePosition(workflow, "prepare memory point", [-240, 800]);
  setNodePosition(workflow, "qwen embed record", [0, 800]);
  setNodePosition(workflow, "build qdrant record point", [240, 800]);
  setNodePosition(workflow, "qdrant upsert memory", [480, 800]);
  setNodePosition(workflow, "prepare memory status", [720, 800]);
  setNodePosition(workflow, "qdrant init collection", [-760, 800]);
}

function buildProfileScrollRequestCode() {
  return String.raw`const body = $("Webhook").first().json.body;

return [
  {
    json: {
      limit: 20,
      with_payload: true,
      with_vector: false,
      filter: {
        must: [
          {
            key: "groupId",
            match: {
              value: body.groupId,
            },
          },
          {
            key: "type",
            match: {
              value: "member_profile",
            },
          },
        ],
      },
    },
  },
];`;
}

function buildRecentReplyContextScrollRequestCode() {
  return String.raw`const body = $("Webhook").first().json.body;
const RECENT_REPLY_CONTEXT_WINDOW_SECONDS = 5 * 60;
const RECENT_REPLY_CONTEXT_LIMIT = 80;
const nowSeconds = Number(body.timestamp || Math.floor(Date.now() / 1000));
const sinceSeconds = nowSeconds - RECENT_REPLY_CONTEXT_WINDOW_SECONDS;

return [
  {
    json: {
      limit: RECENT_REPLY_CONTEXT_LIMIT,
      with_payload: true,
      with_vector: false,
      filter: {
        must: [
          {
            key: "groupId",
            match: {
              value: body.groupId,
            },
          },
          {
            key: "type",
            match: {
              value: "whatsapp_message",
            },
          },
          {
            key: "timestamp",
            range: {
              gte: sinceSeconds,
              lte: nowSeconds,
            },
          },
        ],
      },
    },
  },
];`;
}

function buildPrepareMemoryCode() {
  return "const body = $(\"Webhook\").first().json.body;\nconst fs = require(\"fs\");\nconst PROMPTS_PATH = \"/home/node/.n8n/private-prompts/memory-prompts.json\";\nconst promptConfig = JSON.parse(fs.readFileSync(PROMPTS_PATH, \"utf8\"));\nconst semanticSearchResult = $(\"qdrant search memory\").first().json.result;\nconst semanticResults = Array.isArray(semanticSearchResult)\n  ? semanticSearchResult\n  : semanticSearchResult?.points ?? [];\nconst profilePoints = $(\"qdrant scroll profiles\").first().json.result?.points ?? [];\nconst recentReplyContextPoints = $(\"qdrant scroll recent reply context\").first().json.result?.points ?? [];\nconst staticData = $getWorkflowStaticData(\"global\");\nconst MAX_SHORT_TERM_AI_TURNS = 6;\nconst SHORT_TERM_AI_TURN_TTL_MS = 6 * 60 * 60 * 1000;\nconst FAST_RESPONSE_MODEL = \"deepseek-v4-flash\";\nconst STRONG_RESPONSE_MODEL = \"deepseek-v4-pro\";\nconst shortTermKey = [body.groupId, body.userId].filter(Boolean).join(\":\");\nconst aiTurnBuffer = staticData.aiTurnBuffer ?? {};\nstaticData.aiTurnBuffer = aiTurnBuffer;\n\nconst shortTermAiTurns = (\n  Array.isArray(aiTurnBuffer[shortTermKey]) ? aiTurnBuffer[shortTermKey] : []\n)\n  .filter((turn) => Date.now() - Number(turn.savedAt ?? 0) <= SHORT_TERM_AI_TURN_TTL_MS)\n  .slice(-MAX_SHORT_TERM_AI_TURNS);\n\nconst groupPersonas = {\n  default: {\n    tone:\n      promptConfig.strings[\"set_persona_policy_0\"],\n    language:\n      promptConfig.strings[\"set_persona_policy_1\"],\n    length:\n      promptConfig.strings[\"set_persona_policy_2\"],\n    memoryRule:\n      promptConfig.strings[\"set_persona_policy_3\"],\n    safety:\n      promptConfig.strings[\"set_persona_policy_4\"],\n  },\n};\n\nconst persona = groupPersonas[body.groupId] ?? groupPersonas.default;\n\nfunction formatPoint(item, index) {\n  const payload = item.payload ?? {};\n  const date = new Date(Number(payload.timestamp ?? 0) * 1000)\n    .toISOString()\n    .slice(0, 10);\n  const type = payload.type === \"ai_question\" ? \"AI question\" : payload.type || \"message\";\n  return String(index + 1) + \". [\" + type + \", \" + (payload.userName ?? payload.userId) + \", \" + date + \"] \" + payload.text;\n}\n\nconst memberProfileMemories = profilePoints\n  .filter((item) => item.payload?.type === \"member_profile\")\n  .filter((item) => item.payload?.text)\n  .map((item) => item.payload);\n\nfunction normalizeForMatch(value) {\n  return String(value || \"\")\n    .toLowerCase()\n    .replace(/[^\\p{L}\\p{N}@._\\-\\s]/gu, \" \")\n    .replace(/\\s+/g, \" \")\n    .trim();\n}\n\nconst memberAliasMap = [\n  {\n    profileHints: [\"vincy\", promptConfig.strings[\"select_member_profiles_0\"]],\n    aliases: [\"vincy\", promptConfig.strings[\"select_member_profiles_0\"], promptConfig.strings[\"select_member_profiles_2\"], promptConfig.strings[\"select_member_profiles_3\"], promptConfig.strings[\"select_member_profiles_4\"]],\n  },\n  {\n    profileHints: [\"cvvc\", \"kelvin\", \"kelvincheng\", \"kelvin cheng\"],\n    aliases: [\"kelvin\", \"cvvc\", \"kelvincheng\", \"kelvin cheng\"],\n  },\n  {\n    profileHints: [\"riley\", promptConfig.strings[\"select_member_profiles_5\"], promptConfig.strings[\"select_member_profiles_6\"]],\n    aliases: [\"riley\", promptConfig.strings[\"select_member_profiles_5\"], promptConfig.strings[\"select_member_profiles_6\"]],\n  },\n  {\n    profileHints: [\"stone\", promptConfig.strings[\"select_member_profiles_9\"]],\n    aliases: [\"stone\", promptConfig.strings[\"select_member_profiles_9\"], promptConfig.strings[\"select_member_profiles_11\"], promptConfig.strings[\"select_member_profiles_12\"], promptConfig.strings[\"select_member_profiles_13\"]],\n  },\n];\n\nfunction chineseAliasCharacters(value) {\n  return Array.from(String(value || \"\")).filter((char) => /[\\p{Script=Han}]/u.test(char));\n}\n\nfunction profileMatchTokens(profile) {\n  const userName = normalizeForMatch(profile.userName);\n  const userId = normalizeForMatch(profile.userId);\n  const firstLine = normalizeForMatch(String(profile.text || \"\").split(\"\\n\")[0]);\n  const fullProfileText = normalizeForMatch([profile.userName, profile.userId, profile.text].join(\" \"));\n  const nameParts = userName.split(\" \").filter((token) => token.length >= 3);\n  const mappedAliases = memberAliasMap\n    .filter((entry) =>\n      entry.profileHints.some((hint) => fullProfileText.includes(normalizeForMatch(hint)))\n    )\n    .flatMap((entry) => entry.aliases)\n    .flatMap((alias) => [alias, ...chineseAliasCharacters(alias)])\n    .map(normalizeForMatch);\n  return Array.from(\n    new Set([userName, userId, firstLine, ...nameParts, ...mappedAliases].filter((token) => token.length >= 1))\n  );\n}\n\nfunction isImitationRequest(text) {\n  return /(模仿|扮|扮演|學|学|imitate|impersonate|in the style of)/i.test(String(text || \"\"));\n}\n\nfunction isExactQuoteRequest(text) {\n  return /(原句|逐字|引用|quote|exact wording|exactly|一字不漏|之前.*(?:講|说|說)過咩|之前.*(?:講|说|說)過什麼|之前.*(?:點講|怎么说|怎麼說))/i.test(String(text || \"\"));\n}\n\nfunction isGroupHistoryRequest(text) {\n  return /(群內歷史|群内历史|過去|过去|以前|之前|舊事|旧事|聊天記錄|聊天记录|記錄|记录|發生過|发生过|講過|讲过|說過|说过|history|previous|old message)/i.test(String(text || \"\"));\n}\n\nfunction isPrivacySafetyQuestion(text) {\n  return /(洩漏|泄漏|外洩|外泄|私隱|隐私|privacy|資料|资料|data|記錄我|记录我|偷看|公開|公开|外傳|外传|安全|security|credential|api key)/i.test(String(text || \"\"));\n}\n\nfunction isReplyAssistRequest(text) {\n  return /(扮我覆|扮我回|我要點覆|我要点复|我要(?:怎麼|怎么|點|点)(?:回|覆|复)|(?:怎麼|怎么)回(?:覆|复)?|幫我回|帮我回|幫我覆|帮我复|幫我諗點回|帮我想怎么回|這句(?:怎麼|怎么)回|这句(?:怎么|怎麼)回|how.*reply|what.*reply)/i.test(String(text || \"\"));\n}\n\nfunction needsStrongResponseModel(text) {\n  return /(詳細|详细|分析|整理|總結|总结|比較|比较|推理|原因|點解|为什么|為什麼|深度|深入|歸納|归纳|review|analyze|summarize|compare|reasoning)/i.test(String(text || \"\"));\n}\n\nfunction selectOwnMemberProfileForReplyAssist(profiles, inputBody) {\n  const candidates = [\n    inputBody.userId,\n    inputBody.author,\n    inputBody.from,\n    inputBody.fromMe,\n  ]\n    .map(normalizeForMatch)\n    .filter(Boolean);\n\n  return profiles.find((profile) => {\n    const tokens = [\n      profile.userId,\n      profile.userName,\n      String(profile.text || \"\").split(\"\\n\")[0],\n    ].map(normalizeForMatch);\n    return tokens.some((token) => token && candidates.some((candidate) => candidate.includes(token) || token.includes(candidate)));\n  }) || null;\n}\n\nfunction selectMemberProfilesForQuestion(profiles, question) {\n  if (!isImitationRequest(question)) {\n    return {\n      selectedProfiles: [],\n      matchedTargetName: \"\",\n      selectionNote: promptConfig.strings[\"select_member_profiles_14\"],\n    };\n  }\n\n  const normalizedQuestion = normalizeForMatch(question);\n  const matches = profiles.filter((profile) =>\n    profileMatchTokens(profile).some((token) => normalizedQuestion.includes(token))\n  );\n\n  if (matches.length === 1) {\n    return {\n      selectedProfiles: matches,\n      matchedTargetName: matches[0].userName || matches[0].userId || \"\",\n      selectionNote:\n        promptConfig.strings[\"select_member_profiles_15\"],\n    };\n  }\n\n  return {\n    selectedProfiles: [],\n    matchedTargetName: \"\",\n    selectionNote:\n      promptConfig.strings[\"select_member_profiles_16\"],\n  };\n}\n\nconst isReplyAssist = isReplyAssistRequest(body.text);\nconst replyAssistTargetProfile = isReplyAssist\n  ? selectOwnMemberProfileForReplyAssist(memberProfileMemories, body)\n  : null;\nconst memberProfileSelection = selectMemberProfilesForQuestion(memberProfileMemories, body.text);\nconst selectedMemberProfileMemories = isReplyAssist && replyAssistTargetProfile\n  ? [replyAssistTargetProfile.text]\n  : memberProfileSelection.selectedProfiles.map((profile) => profile.text);\nconst exactQuoteRequested = isExactQuoteRequest(body.text);\nconst groupHistoryRequested = isGroupHistoryRequest(body.text);\nconst privacySafetyQuestion = isPrivacySafetyQuestion(body.text);\nconst shouldExposeRawHistory = !privacySafetyQuestion && (exactQuoteRequested || groupHistoryRequested);\nconst responseModel =\n  isReplyAssist || needsStrongResponseModel(body.text) || groupHistoryRequested || exactQuoteRequested\n    ? STRONG_RESPONSE_MODEL\n    : FAST_RESPONSE_MODEL;\nconst responseMode = isReplyAssist ? \"reply_assist\" : \"chat\";\n\nconst memories = shouldExposeRawHistory\n  ? semanticResults\n      .filter((item) => item.payload?.text)\n      .map(formatPoint)\n  : [];\n\nconst memberProfileContext =\n  selectedMemberProfileMemories.length > 0\n    ? promptConfig.strings[\"set_persona_policy_5\"] + (isReplyAssist ? promptConfig.strings[\"set_persona_policy_6\"] : memberProfileSelection.selectionNote) + (memberProfileSelection.matchedTargetName ? promptConfig.strings[\"set_persona_policy_7\"] + memberProfileSelection.matchedTargetName : \"\") + \"\\n\\n\" + selectedMemberProfileMemories.join(\"\\n\")\n    : memberProfileSelection.selectionNote + promptConfig.strings[\"set_persona_policy_8\"];\n\nconst memoryContext =\n  shouldExposeRawHistory\n    ? memories.length > 0\n      ? promptConfig.strings[\"format_semantic_memory_0\"] + memories.join(\"\\n\")\n      : promptConfig.strings[\"format_semantic_memory_1\"]\n    : promptConfig.strings[\"format_semantic_memory_2\"];\n\nconst shortTermAiContext =\n  shortTermAiTurns.length > 0\n    ? promptConfig.strings[\"format_recent_context_0\"] +\n      shortTermAiTurns\n        .map((turn, index) => String(index + 1) + \". User: \" + turn.question + \"\\nAI: \" + turn.answer)\n        .join(\"\\n\\n\")\n    : promptConfig.strings[\"format_recent_context_1\"];\n\nconst recentReplyMessages = recentReplyContextPoints\n  .map((item) => item.payload ?? {})\n  .filter((payload) => payload.text)\n  .sort((a, b) => Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0))\n  .slice(-80);\n\nfunction formatTime(seconds) {\n  const date = new Date(Number(seconds || 0) * 1000);\n  return date.toISOString().slice(11, 16);\n}\n\nconst recentReplyContext =\n  recentReplyMessages.length > 0\n    ? promptConfig.strings[\"format_recent_context_2\"] +\n      recentReplyMessages\n        .map((payload) => \"[\" + formatTime(payload.timestamp) + \"] \" + (payload.userName || payload.userId || \"unknown\") + \": \" + payload.text)\n        .join(\"\\n\")\n    : promptConfig.strings[\"format_recent_context_3\"];\n\nconst replyAssistInstructions = isReplyAssist\n  ? [\n      promptConfig.strings[\"set_persona_policy_9\"],\n      promptConfig.strings[\"set_persona_policy_10\"],\n      promptConfig.strings[\"set_persona_policy_11\"],\n      promptConfig.strings[\"set_persona_policy_12\"],\n      promptConfig.strings[\"set_persona_policy_13\"],\n      promptConfig.strings[\"set_persona_policy_14\"],\n      promptConfig.strings[\"set_persona_policy_15\"],\n      promptConfig.strings[\"set_persona_policy_16\"],\n    ].join(\"\\n\")\n  : \"\";\n\nconst system = {\n  role: \"system\",\n  content: [\n    promptConfig.strings[\"set_persona_policy_17\"],\n    promptConfig.strings[\"set_persona_policy_18\"] + persona.tone,\n    promptConfig.strings[\"set_persona_policy_19\"] + persona.language,\n    promptConfig.strings[\"set_persona_policy_20\"] + persona.length,\n    promptConfig.strings[\"set_persona_policy_21\"] + persona.memoryRule,\n    promptConfig.strings[\"set_persona_policy_22\"] + persona.safety,\n    promptConfig.strings[\"set_persona_policy_23\"],\n    promptConfig.strings[\"set_persona_policy_24\"],\n    promptConfig.strings[\"set_persona_policy_25\"],\n    promptConfig.strings[\"set_persona_policy_26\"],\n    promptConfig.strings[\"set_persona_policy_27\"],\n    promptConfig.strings[\"set_persona_policy_28\"],\n    promptConfig.strings[\"set_persona_policy_29\"],\n    promptConfig.strings[\"set_persona_policy_30\"],\n    promptConfig.strings[\"set_persona_policy_31\"],\n    promptConfig.strings[\"set_persona_policy_32\"],\n    promptConfig.strings[\"set_persona_policy_33\"],\n    promptConfig.strings[\"set_persona_policy_34\"],\n    promptConfig.strings[\"set_persona_policy_35\"],\n    promptConfig.strings[\"set_persona_policy_36\"],\n    promptConfig.strings[\"set_persona_policy_37\"],\n    promptConfig.strings[\"set_persona_policy_38\"],\n    promptConfig.strings[\"set_persona_policy_39\"],\n    promptConfig.strings[\"set_persona_policy_40\"],\n    promptConfig.strings[\"set_persona_policy_41\"],\n  ].join(\"\\n\"),\n};\n\nreturn [\n  {\n    json: {\n      ...body,\n      retrievedMemories: memories,\n      retrievedMemberProfiles: selectedMemberProfileMemories,\n      retrievedMemberProfileSelection: memberProfileSelection,\n      retrievedShortTermAiTurns: shortTermAiTurns,\n      retrievedRecentReplyContext: recentReplyMessages,\n      replyAssistTargetProfile: replyAssistTargetProfile ? {\n        userId: replyAssistTargetProfile.userId,\n        userName: replyAssistTargetProfile.userName,\n      } : null,\n      responseMode: isReplyAssist ? \"reply_assist\" : \"chat\",\n      responseModel,\n      messages: [\n        system,\n        {\n          role: \"user\",\n          content:\n            memberProfileContext +\n            \"\\n\\n\" +\n            memoryContext +\n            \"\\n\\n\" +\n            shortTermAiContext +\n            \"\\n\\n\" +\n            recentReplyContext +\n            (replyAssistInstructions ? \"\\n\\n\" + replyAssistInstructions : \"\") +\n            promptConfig.strings[\"assemble_llm_messages_0\"] +\n            body.text,\n        },\n      ],\n    },\n  },\n];";
}

function decideWebSearch(text) {
  const value = String(text || "").toLowerCase();
  const explicitSearch =
    /(幫我查|帮我查|查一下|查下|搜一下|搜尋|搜索|search|google|上網查|上网查|網上查|网上查)/i.test(value);
  const currentInfo =
    /(最新|新聞|新闻|現在|现在|而家|今日|今天|今晚|current|latest|news|recent|today|tonight|pricing|price|價格|价格|費用|费用|官網|官网|release|status|down|還開|还开|附近|營業|营业|優惠|优惠|新店|版本|model|api)/i.test(value);
  const localAvailability =
    /(附近|還開|还开|營業|营业|優惠|优惠|新店)/i.test(value);
  const plainAdvice =
    /(建議|建议|今晚吃什么|今晚食咩|吃什么|食咩)/i.test(value) &&
    !explicitSearch &&
    !localAvailability &&
    !/(最新|新聞|新闻|現在|现在|而家|今日|今天|current|latest|news|recent|pricing|price|價格|价格|版本|model|api)/i.test(value);

  const shouldSearch = !plainAdvice && (explicitSearch || currentInfo || localAvailability);
  return {
    shouldSearch,
    reason: shouldSearch
      ? explicitSearch
        ? "explicit-search-request"
        : localAvailability
          ? "local-current-info"
          : "current-info-request"
      : "no-search-needed",
    query: value.trim(),
  };
}

function buildWebSearchDecisionCode() {
  return String.raw`function decideWebSearch(text) {
  const value = String(text || "").toLowerCase();
  const explicitSearch =
    /(幫我查|帮我查|查一下|查下|搜一下|搜尋|搜索|search|google|上網查|上网查|網上查|网上查)/i.test(value);
  const currentInfo =
    /(最新|新聞|新闻|現在|现在|而家|今日|今天|今晚|current|latest|news|recent|today|tonight|pricing|price|價格|价格|費用|费用|官網|官网|release|status|down|還開|还开|附近|營業|营业|優惠|优惠|新店|版本|model|api)/i.test(value);
  const localAvailability =
    /(附近|還開|还开|營業|营业|優惠|优惠|新店)/i.test(value);
  const plainAdvice =
    /(建議|建议|今晚吃什么|今晚食咩|吃什么|食咩)/i.test(value) &&
    !explicitSearch &&
    !localAvailability &&
    !/(最新|新聞|新闻|現在|现在|而家|今日|今天|current|latest|news|recent|pricing|price|價格|价格|版本|model|api)/i.test(value);

  const shouldSearch = !plainAdvice && (explicitSearch || currentInfo || localAvailability);
  return {
    shouldSearch,
    reason: shouldSearch
      ? explicitSearch
        ? "explicit-search-request"
        : localAvailability
          ? "local-current-info"
          : "current-info-request"
      : "no-search-needed",
    query: value.trim(),
  };
}

const input = $input.first().json;
const decision = decideWebSearch(input.text);

return [
  {
    json: {
      ...input,
      webSearch: {
        shouldSearch: decision.shouldSearch,
        reason: decision.reason,
        query: decision.query,
        results: [],
      },
    },
  },
];`;
}

function buildSearchClassifierRequestCode() {
  return String.raw`const input = $input.first().json;
const question = String(input.text || "");

const searchClassifierMessages = [
  {
    role: "system",
    content: [
      "You are a web-search routing classifier for a WhatsApp AI bot.",
      "Return JSON only. No markdown. Shape: {\"shouldSearch\": boolean, \"query\": string, \"reason\": string}.",
      "Only decide whether the answer depends on external or current information.",
      "Search is needed for current news, prices, status, APIs, versions, model comparisons, product or service recommendations, software or game discovery, public people or companies, local availability, business hours, promotions, or explicit search requests.",
      "Search is not needed for casual chat, translation, rewriting, creative writing, general social advice, memory questions, questions already answerable from group memory or member profiles, or jokes.",
      "For advice requests, search only when the advice depends on current products, games, APIs, prices, news, or market information.",
      "The query must be a short Brave Search query and must not include @ai.",
    ].join("\n"),
  },
  {
    role: "user",
    content:
      "User question:\n" +
      question +
      "\n\nDecide whether web search is needed. JSON only.",
  },
];

return [
  {
    json: {
      ...input,
      searchClassifierMessages,
    },
  },
];`;
}

function buildParseWebSearchDecisionCode() {
  return String.raw`const input = $("build web search classifier").first().json;
const classifierOutput = $input.first().json;
const raw = classifierOutput.choices?.[0]?.message?.content ?? "";

function parseJson(value) {
  const text = String(value || "").trim();
  const fence = String.fromCharCode(96).repeat(3);
  const fenced = text.match(new RegExp(fence + "(?:json)?\\\\s*([\\\\s\\\\S]*?)" + fence, "i"));
  const candidate = fenced ? fenced[1] : text;
  const objectMatch = candidate.match(/\{[\s\S]*\}/);
  if (!objectMatch) throw new Error("classifier returned no json object");
  return JSON.parse(objectMatch[0]);
}

let decision;
try {
  decision = parseJson(raw);
} catch (error) {
  decision = {
    shouldSearch: false,
    query: input.text || "",
    reason: "classifier-unavailable: " + error.message,
  };
}

const query = String(decision.query || input.text || "")
  .replace(/@ai/gi, "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 180);

return [
  {
    json: {
      ...input,
      webSearch: {
        shouldSearch: Boolean(decision.shouldSearch),
        reason: String(decision.reason || ""),
        query,
        classifierRaw: raw,
        results: [],
      },
    },
  },
];`;
}

function buildBraveSearchCode() {
  return String.raw`const fs = require("fs");

const input = $input.first().json;
const keyPath = "/home/node/.n8n/bravesearch-key";
const query = input.webSearch?.query || input.text || "";

try {
  const key = fs.readFileSync(keyPath, "utf8").trim();
  if (!key) throw new Error("Brave Search key file is empty");

  const url =
    "https://api.search.brave.com/res/v1/web/search?q=" +
    encodeURIComponent(query) +
    "&count=5";
  const response = await fetch(url, {
    headers: {
      "X-Subscription-Token": key,
      Accept: "application/json",
    },
  });
  const data = await response.json();
  const webResults = data.web?.results || [];
  const faqResults = data.faq?.results || [];
  const results = webResults.slice(0, 5).map((item, index) => ({
    rank: index + 1,
    title: item.title || "",
    url: item.url || "",
    description: item.description || "",
    age: item.age || item.page_age || "",
    extra_snippets: item.extra_snippets || [],
  }));
  const faq = faqResults.slice(0, 3).map((item) => ({
    question: item.question || "",
    answer: item.answer || "",
    title: item.title || "",
    url: item.url || "",
  }));

  return [
    {
      json: {
        ...input,
        webSearch: {
          ...input.webSearch,
          ok: response.ok,
          status: response.status,
          results,
          faq,
        },
      },
    },
  ];
} catch (error) {
  return [
    {
      json: {
        ...input,
        webSearch: {
          ...input.webSearch,
          ok: false,
          status: 0,
          results: [],
          faq: [],
          error: error.message,
        },
      },
    },
  ];
}`;
}

function buildAppendWebSearchContextCode() {
  return String.raw`const input = $input.first().json;
const messages = Array.isArray(input.messages) ? [...input.messages] : [];
const results = input.webSearch?.results || [];
const faq = input.webSearch?.faq || [];
const STRONG_RESPONSE_MODEL = "deepseek-v4-pro";

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

const faqLines = faq.map((item, index) =>
  String(index + 1) +
    ". Q: " +
    stripHtml(item.question) +
    "\n   A: " +
    stripHtml(item.answer) +
    "\n   來源: " +
    item.url
);

const resultLines = results.map((item) =>
  String(item.rank) +
    ". " +
    stripHtml(item.title) +
    (item.age ? " (" + item.age + ")" : "") +
    "\n   摘要: " +
    stripHtml(item.description) +
    (item.extra_snippets?.length ? "\n   補充: " + item.extra_snippets.map(stripHtml).join(" ") : "") +
    "\n   來源: " +
    item.url
);

const webSearchContext =
  resultLines.length || faqLines.length
    ? "外部網頁搜尋結果（只可根據這些摘要回答最新/價格/狀態/新聞類問題；不要假裝已打開完整網頁。回答時可簡短附來源）：\n\n" +
      [...faqLines, ...resultLines].join("\n\n")
    : input.webSearch?.shouldSearch
      ? "外部網頁搜尋：這次沒有取得可用搜尋摘要，請不要編造最新資料。"
      : "";

if (webSearchContext && messages.length > 0) {
  const lastIndex = messages.length - 1;
  messages[lastIndex] = {
    ...messages[lastIndex],
    content: String(messages[lastIndex].content || "") + "\n\n" + webSearchContext,
  };
}

return [
  {
    json: {
      ...input,
      messages,
      webSearchContext,
      responseModel: webSearchContext || input.webSearch?.shouldSearch
        ? STRONG_RESPONSE_MODEL
        : input.responseModel,
    },
  },
];`;
}

function buildSaveMemoryCode() {
  return String.raw`const input = $("prepare memory").first().json;
const deepseekOutput = $input.first().json;
const aiReply = deepseekOutput.choices?.[0]?.message?.content;
const staticData = $getWorkflowStaticData("global");
const MAX_SHORT_TERM_AI_TURNS = 6;
const SHORT_TERM_AI_TURN_TTL_MS = 6 * 60 * 60 * 1000;

if (!aiReply) {
  throw new Error("DeepSeek did not return choices[0].message.content");
}

function appendAiReplyExportMarker(value) {
  const text = String(value).trimEnd();
  return text.endsWith(".") ? text : text + ".";
}

const markedAiReply = appendAiReplyExportMarker(aiReply);
const shortTermKey = [input.groupId, input.userId].filter(Boolean).join(":");
const aiTurnBuffer = staticData.aiTurnBuffer ?? {};
staticData.aiTurnBuffer = aiTurnBuffer;
const existingTurns = Array.isArray(aiTurnBuffer[shortTermKey])
  ? aiTurnBuffer[shortTermKey]
  : [];
aiTurnBuffer[shortTermKey] = existingTurns
  .filter((turn) => Date.now() - Number(turn.savedAt ?? 0) <= SHORT_TERM_AI_TURN_TTL_MS)
  .concat([
    {
      question: input.text,
      answer: markedAiReply,
      savedAt: Date.now(),
    },
  ])
  .slice(-MAX_SHORT_TERM_AI_TURNS);

return [
  {
    json: {
      to: input.groupId,
      message: markedAiReply,
    },
  },
];`;
}

function upsertWebSearchNodes(workflow) {
  const deepseek = maybeFindNode(workflow, "Deepseek");

  removeNode(workflow, "decide web search");

  upsertNode(workflow, {
    parameters: { jsCode: buildSearchClassifierRequestCode() },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1072, -240],
    id: "rag-build-web-search-classifier",
    name: "build web search classifier",
  });

  upsertNode(workflow, {
    parameters: {
      method: "POST",
      url: deepseek?.parameters?.url || "https://api.deepseek.com/chat/completions",
      authentication: deepseek?.parameters?.authentication,
      genericAuthType: deepseek?.parameters?.genericAuthType,
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        '=     {\n       "model": "deepseek-v4-flash",\n       "messages": {{ JSON.stringify($json.searchClassifierMessages) }},\n       "stream": false\n     }',
      options: {},
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [1296, -240],
    id: "rag-deepseek-search-classifier",
    name: "DeepSeek search classifier",
    credentials: deepseek?.credentials,
    onError: "continueErrorOutput",
  });

  upsertNode(workflow, {
    parameters: { jsCode: buildParseWebSearchDecisionCode() },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1520, -240],
    id: "rag-parse-web-search-decision",
    name: "parse web search decision",
  });

  upsertNode(workflow, {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
          version: 3,
        },
        conditions: [
          {
            id: "rag-needs-web-search-condition",
            leftValue: "={{ $json.webSearch.shouldSearch }}",
            rightValue: true,
            operator: {
              type: "boolean",
              operation: "equals",
              name: "filter.operator.equals",
            },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    type: "n8n-nodes-base.if",
    typeVersion: 2.3,
    position: [1744, -240],
    id: "rag-needs-web-search",
    name: "needs web search",
  });

  upsertNode(workflow, {
    parameters: { jsCode: buildBraveSearchCode() },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1968, -336],
    id: "rag-brave-search",
    name: "Brave Search",
  });

  upsertNode(workflow, {
    parameters: { jsCode: buildAppendWebSearchContextCode() },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2192, -240],
    id: "rag-append-web-search-context",
    name: "append web search context",
  });
}

function patchWebSearchWorkflow(workflow) {
  findNode(workflow, "prepare memory");
  const deepseek = findNode(workflow, "Deepseek");
  const saveMemoryNode = maybeFindNode(workflow, "save memory");
  if (saveMemoryNode) saveMemoryNode.parameters.jsCode = buildSaveMemoryCode();

  upsertWebSearchNodes(workflow);

  deepseek.position = [2416, -240];
  const saveMemory = maybeFindNode(workflow, "save memory");
  if (saveMemory) saveMemory.position = [2640, -240];

  connectOnly(workflow, "prepare memory", 0, "build web search classifier");
  connectOnly(workflow, "build web search classifier", 0, "DeepSeek search classifier");
  connectOnly(workflow, "DeepSeek search classifier", 0, "parse web search decision");
  connectOnly(workflow, "DeepSeek search classifier", 1, "parse web search decision");
  connectOnly(workflow, "parse web search decision", 0, "needs web search");
  connectOnly(workflow, "needs web search", 0, "Brave Search");
  connectOnly(workflow, "needs web search", 1, "append web search context");
  connectOnly(workflow, "Brave Search", 0, "append web search context");
  connectOnly(workflow, "append web search context", 0, "Deepseek");

  applyPresentationLayout(workflow);
  return workflow;
}

function patchWorkflow(workflow) {
  findNode(workflow, "prepare memory").parameters.jsCode = buildPrepareMemoryCode();
  const memoryStatusNode = maybeFindNode(workflow, "prepare memory status");
  if (memoryStatusNode) memoryStatusNode.parameters.jsCode = buildMemoryStatusCode();
  const saveMemoryNode = maybeFindNode(workflow, "save memory");
  if (saveMemoryNode) saveMemoryNode.parameters.jsCode = buildSaveMemoryCode();
  removeSwitchRule(workflow, "Switch", (value) =>
    JSON.stringify(value).includes("forget_me") ||
    JSON.stringify(value).includes("rag-switch-forget-me")
  );
  removeNode(workflow, "build forget me request");
  removeNode(workflow, "qdrant forget me");
  removeNode(workflow, "prepare forget me response");

  upsertNode(workflow, {
    parameters: { jsCode: buildProfileScrollRequestCode() },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [400, -240],
    id: "rag-build-qdrant-profile-scroll",
    name: "build qdrant profile scroll",
  });

  upsertNode(workflow, {
    parameters: {
      method: "POST",
      url: "http://qdrant:6333/collections/whatsapp_memory/points/scroll",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json) }}",
      options: {},
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [624, -240],
    id: "rag-qdrant-scroll-profiles",
    name: "qdrant scroll profiles",
    onError: "continueErrorOutput",
  });

  upsertNode(workflow, {
    parameters: { jsCode: buildRecentReplyContextScrollRequestCode() },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [848, -520],
    id: "rag-build-recent-reply-context-scroll",
    name: "build recent reply context scroll",
  });

  upsertNode(workflow, {
    parameters: {
      method: "POST",
      url: "http://qdrant:6333/collections/whatsapp_memory/points/scroll",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json) }}",
      options: {},
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [1072, -520],
    id: "rag-qdrant-scroll-recent-reply-context",
    name: "qdrant scroll recent reply context",
    onError: "continueRegularOutput",
  });

  upsertWebSearchNodes(workflow);

  findNode(workflow, "prepare memory").position = [1296, -240];
  const deepseek = maybeFindNode(workflow, "Deepseek");
  if (deepseek) {
    deepseek.position = [2416, -240];
    deepseek.parameters.jsonBody =
      '=     {\n       "model": "{{ $json.responseModel || \'deepseek-v4-flash\' }}",\n       "messages": {{ JSON.stringify($json.messages) }},\n       "stream": false\n     }';
  }
  const saveMemory = maybeFindNode(workflow, "save memory");
  if (saveMemory) saveMemory.position = [2640, -240];

  connectOnly(workflow, "qdrant search memory", 0, "build qdrant profile scroll");
  connectOnly(workflow, "build qdrant profile scroll", 0, "qdrant scroll profiles");
  connectOnly(workflow, "qdrant scroll profiles", 0, "build recent reply context scroll");
  connectOnly(workflow, "build recent reply context scroll", 0, "qdrant scroll recent reply context");
  connectOnly(workflow, "qdrant scroll recent reply context", 0, "prepare memory");
  connectOnly(workflow, "prepare memory", 0, "build web search classifier");
  connectOnly(workflow, "build web search classifier", 0, "DeepSeek search classifier");
  connectOnly(workflow, "DeepSeek search classifier", 0, "parse web search decision");
  connectOnly(workflow, "DeepSeek search classifier", 1, "parse web search decision");
  connectOnly(workflow, "parse web search decision", 0, "needs web search");
  connectOnly(workflow, "needs web search", 0, "Brave Search");
  connectOnly(workflow, "needs web search", 1, "append web search context");
  connectOnly(workflow, "Brave Search", 0, "append web search context");
  connectOnly(workflow, "append web search context", 0, "Deepseek");
  if (maybeFindNode(workflow, "prepare safe error message")) {
    if (workflow.connections["qdrant scroll profiles"].main.length < 2) {
      workflow.connections["qdrant scroll profiles"].main.push([]);
    }
    workflow.connections["qdrant scroll profiles"].main[1] = [
      { node: "prepare safe error message", type: "main", index: 0 },
    ];
  } else {
    workflow.connections["qdrant scroll profiles"].main =
      workflow.connections["qdrant scroll profiles"].main.slice(0, 1);
  }

  applyPresentationLayout(workflow);
  return workflow;
}

function main() {
  const workflowPath =
    process.argv[2] ||
    "C:/Users/USER/Desktop/n8n-whatsapp-bot/n8n/workflows/workflows.json";
  const workflows = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
  patchWorkflow(workflows[0]);
  fs.writeFileSync(workflowPath, JSON.stringify(workflows, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  buildAppendWebSearchContextCode,
  buildBraveSearchCode,
  buildMemoryStatusCode,
  buildParseWebSearchDecisionCode,
  buildPrepareMemoryCode,
  buildProfileScrollRequestCode,
  buildRecentReplyContextScrollRequestCode,
  buildSaveMemoryCode,
  buildSearchClassifierRequestCode,
  buildWebSearchDecisionCode,
  decideWebSearch,
  patchWebSearchWorkflow,
  patchWorkflow,
};
