const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildGroupProfilePrompt,
  buildGroupProfileMarkdown,
  normalizeGroupProfile,
} = require("./generate-group-profile");

test("buildGroupProfilePrompt requests unified humorous toxic group style", () => {
  const prompt = buildGroupProfilePrompt({
    groupName: "珍•Marathon Part-time•珠",
    memberProfiles: [
      {
        userName: "Riley",
        persona: "群聊中的多面手",
        classicLines: ["今晚玩唔玩。。。"],
      },
    ],
  });

  assert.match(prompt, /群整體人設/);
  assert.match(prompt, /群內分工/);
  assert.match(prompt, /常見梗/);
  assert.match(prompt, /幽默、嘴賤、毒舌少少/);
  assert.match(prompt, /不要按每個成員改變回覆人格/);
  assert.match(prompt, /Riley/);
});

test("normalizeGroupProfile keeps expected group profile shape", () => {
  const profile = normalizeGroupProfile({
    groupName: "珍•Marathon Part-time•珠",
    groupPersona: "一班會互相照顧但嘴上唔饒人的朋友",
    vibe: "半認真半搞笑",
    roles: [{ member: "Vincy", role: "活動協調" }],
    commonJokes: ["今晚玩唔玩"],
    interactionRules: ["可以串，但不要惡意攻擊"],
    unifiedReplyStyle: "幽默、嘴賤、毒舌少少",
    replyBoundaries: ["不要模仿單一成員"],
    uncertainty: "只基於群聊文字",
  });

  assert.deepEqual(profile.roles, [{ member: "Vincy", role: "活動協調" }]);
  assert.equal(profile.unifiedReplyStyle, "幽默、嘴賤、毒舌少少");
});

test("buildGroupProfileMarkdown renders group profile sections", () => {
  const markdown = buildGroupProfileMarkdown({
    groupName: "珍•Marathon Part-time•珠",
    groupPersona: "一班會互相照顧但嘴上唔饒人的朋友",
    vibe: "半認真半搞笑",
    roles: [{ member: "Vincy", role: "活動協調" }],
    commonJokes: ["今晚玩唔玩"],
    interactionRules: ["可以串，但不要惡意攻擊"],
    unifiedReplyStyle: "幽默、嘴賤、毒舌少少",
    replyBoundaries: ["不要模仿單一成員"],
    uncertainty: "只基於群聊文字",
  });

  assert.match(markdown, /# 珍•Marathon Part-time•珠 群組人物画像/);
  assert.match(markdown, /## 群內分工/);
  assert.match(markdown, /Vincy：活動協調/);
  assert.match(markdown, /## 統一回覆風格/);
});
