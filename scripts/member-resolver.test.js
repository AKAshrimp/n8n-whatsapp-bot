const assert = require("node:assert/strict");
const test = require("node:test");

const { buildMemberIndex, resolveMember } = require("./member-resolver");

const members = [
  {
    userId: "111@lid",
    userName: "Kelvin Cheng",
    aliases: ["K", "Wing"],
  },
  {
    userId: "222@lid",
    userName: "Alice Chan",
    aliases: ["Ali"],
  },
];

test("buildMemberIndex includes lowercase name and aliases", () => {
  const index = buildMemberIndex(members);

  assert.deepEqual(index[0].tokens, ["kelvin", "cheng", "k", "wing"]);
});

test("resolveMember resolves partial names", () => {
  const index = buildMemberIndex(members);

  assert.equal(resolveMember(index, "kelvin")?.userId, "111@lid");
  assert.equal(resolveMember(index, "wing")?.userId, "111@lid");
  assert.equal(resolveMember(index, "alice")?.userId, "222@lid");
});

test("resolveMember returns null for ambiguous names", () => {
  const index = buildMemberIndex([
    { userId: "111@lid", userName: "Kelvin Lee", aliases: ["K"] },
    { userId: "222@lid", userName: "Kelvin Cheng", aliases: ["K"] },
  ]);

  assert.equal(resolveMember(index, "kelvin"), null);
});

test("resolveMember returns null for unknown names", () => {
  const index = buildMemberIndex(members);

  assert.equal(resolveMember(index, "nobody"), null);
});
