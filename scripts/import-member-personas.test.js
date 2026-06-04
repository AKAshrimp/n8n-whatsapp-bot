const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildMemberPersonaPoint,
  buildMemberPersonaText,
  normalizePersonaProfile,
} = require("./import-member-personas");

test("normalizePersonaProfile keeps qwen persona report fields", () => {
  const profile = normalizePersonaProfile({
    userName: "Riley",
    messageCount: 557,
    persona: "群聊中的多面手",
    personalityAnalysis: "活躍、友好、直率",
    portrait: "隨時準備伸出援手的樂天派",
    speakingHabits: ["簡短直接", "鍾意用emoji"],
    commonInteractionTargets: [{ target: "Vincy", pattern: "邀請打機" }],
    classicLines: ["今晚玩唔玩。。。"],
    replyMethod: "快速明確回覆，輕鬆接梗",
    uncertainty: "只基於群聊文字",
  });

  assert.deepEqual(profile, {
    userName: "Riley",
    messageCount: 557,
    persona: "群聊中的多面手",
    personalityAnalysis: "活躍、友好、直率",
    portrait: "隨時準備伸出援手的樂天派",
    speakingHabits: ["簡短直接", "鍾意用emoji"],
    commonInteractionTargets: [{ target: "Vincy", pattern: "邀請打機" }],
    classicLines: ["今晚玩唔玩。。。"],
    replyMethod: "快速明確回覆，輕鬆接梗",
    uncertainty: "只基於群聊文字",
  });
});

test("buildMemberPersonaText formats profile for RAG retrieval", () => {
  const text = buildMemberPersonaText({
    userName: "Riley",
    messageCount: 557,
    persona: "群聊中的多面手",
    personalityAnalysis: "活躍、友好、直率",
    portrait: "隨時準備伸出援手的樂天派",
    speakingHabits: ["簡短直接"],
    commonInteractionTargets: [{ target: "Vincy", pattern: "邀請打機" }],
    classicLines: ["今晚玩唔玩。。。"],
    replyMethod: "快速明確回覆，輕鬆接梗",
    uncertainty: "只基於群聊文字",
  });

  assert.match(text, /Member persona: Riley/);
  assert.match(text, /人設：群聊中的多面手/);
  assert.match(text, /常互動對象：Vincy：邀請打機/);
  assert.match(text, /經典語句：今晚玩唔玩。。。/);
  assert.match(text, /回覆方法：快速明確回覆，輕鬆接梗/);
});

test("buildMemberPersonaPoint creates searchable member_profile qdrant point", () => {
  const vector = Array.from({ length: 1024 }, () => 0.1);
  const point = buildMemberPersonaPoint({
    groupId: "120363142022323634@g.us",
    groupName: "珍•Marathon Part-time•珠",
    profile: normalizePersonaProfile({
      userName: "Riley",
      messageCount: 557,
      persona: "群聊中的多面手",
      personalityAnalysis: "活躍、友好、直率",
      portrait: "隨時準備伸出援手的樂天派",
      speakingHabits: ["簡短直接"],
      commonInteractionTargets: [{ target: "Vincy", pattern: "邀請打機" }],
      classicLines: ["今晚玩唔玩。。。"],
      replyMethod: "快速明確回覆，輕鬆接梗",
      uncertainty: "只基於群聊文字",
    }),
    vector,
    timestamp: 1780000000,
  });

  assert.equal(point.vector.length, 1024);
  assert.equal(point.payload.type, "member_profile");
  assert.equal(point.payload.source, "history-persona-report");
  assert.equal(point.payload.groupId, "120363142022323634@g.us");
  assert.equal(point.payload.userId, "Riley");
  assert.equal(point.payload.userName, "Riley");
  assert.match(point.payload.text, /群聊中的多面手/);
});
