function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeToken(value).split(" ").filter(Boolean);
}

function buildMemberIndex(members) {
  return members.map((member) => {
    const tokens = Array.from(
      new Set([...(tokenize(member.userName)), ...(member.aliases || []).flatMap(tokenize)])
    );

    return {
      userId: member.userId,
      userName: member.userName,
      aliases: member.aliases || [],
      tokens,
    };
  });
}

function resolveMember(index, query) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return null;

  const matches = index.filter((member) =>
    queryTokens.some((queryToken) =>
      member.tokens.some(
        (token) => token === queryToken || token.startsWith(queryToken)
      )
    )
  );

  if (matches.length !== 1) return null;
  return matches[0];
}

module.exports = {
  buildMemberIndex,
  resolveMember,
};
