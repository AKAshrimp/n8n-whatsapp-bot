const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildGroupProfilePoint,
  buildGroupProfileText,
  createGroupProfileId,
} = require("./import-group-profile");

test("createGroupProfileId is deterministic", () => {
  assert.equal(
    createGroupProfileId({ groupId: "group@g.us" }),
    createGroupProfileId({ groupId: "group@g.us" })
  );
  assert.match(
    createGroupProfileId({ groupId: "group@g.us" }),
    /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/
  );
});

test("buildGroupProfileText formats group context for RAG retrieval", () => {
  const text = buildGroupProfileText({
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

  assert.match(text, /Group profile: 珍•Marathon Part-time•珠/);
  assert.match(text, /群整體人設：一班會互相照顧/);
  assert.match(text, /群內分工：Vincy：活動協調/);
  assert.match(text, /統一回覆風格：幽默、嘴賤、毒舌少少/);
});

test("buildGroupProfilePoint creates group_profile qdrant point", () => {
  const vector = Array.from({ length: 1024 }, () => 0.1);
  const point = buildGroupProfilePoint({
    groupId: "120363142022323634@g.us",
    groupName: "珍•Marathon Part-time•珠",
    profile: {
      groupName: "珍•Marathon Part-time•珠",
      groupPersona: "一班會互相照顧但嘴上唔饒人的朋友",
      vibe: "半認真半搞笑",
      roles: [{ member: "Vincy", role: "活動協調" }],
      commonJokes: ["今晚玩唔玩"],
      interactionRules: ["可以串，但不要惡意攻擊"],
      unifiedReplyStyle: "幽默、嘴賤、毒舌少少",
      replyBoundaries: ["不要模仿單一成員"],
      uncertainty: "只基於群聊文字",
    },
    vector,
    timestamp: 1780000000,
  });

  assert.equal(point.vector.length, 1024);
  assert.equal(point.payload.type, "group_profile");
  assert.equal(point.payload.source, "history-group-profile-summary");
  assert.equal(point.payload.userId, "__group__");
  assert.equal(point.payload.userName, "group_profile");
  assert.match(point.payload.text, /幽默、嘴賤、毒舌少少/);
});
