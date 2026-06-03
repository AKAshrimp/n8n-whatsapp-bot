# WhatsApp History Memory Seeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe one-time pipeline to import historical WhatsApp group messages into Qdrant and optionally generate initial member profile memories for the RAG chatbot.

**Architecture:** Use local Node.js scripts instead of changing the live WhatsApp bot first. The scripts will read exported WhatsApp history, normalize messages, filter low-value text, call TokenDance `qwen-text-embedding-v4`, and upsert records into Qdrant `whatsapp_memory` with deterministic IDs. Member profile summaries will be a separate optional step so message history can be imported without automatically profiling users.

**Tech Stack:** Node.js, Docker, Qdrant, TokenDance OpenAI-compatible embeddings, optional LLM summarization, existing n8n RAG workflow.

---

## Current Assumptions

- Project root: `C:\Users\USER\Desktop\n8n-whatsapp-bot`
- Qdrant host URL: `http://localhost:6333`
- Qdrant collection: `whatsapp_memory`
- Embedding endpoint: `https://tokendance.space/gateway/v1/embeddings`
- Embedding model: `qwen-text-embedding-v4`
- Confirmed embedding dimension: `1024`
- Qdrant vector size must stay `1024`
- Existing old workflow `whatsapp booot` should not be touched
- RAG workflow is `whatsapp booot RAG memory`

## Recommended Member Identification Strategy

Use a hybrid strategy:

```txt
member_index + fuzzy resolver + userId Qdrant filter + ambiguity confirmation
```

This is the preferred approach because:

- `userId` is the stable source of truth for distinguishing members.
- `userName` and generated name tokens make names human-readable.
- Fuzzy matching lets users ask for `kelvin` even if the stored name is `Kelvin Cheng`.
- Qdrant should search by resolved `userId` when the user asks about a specific member's style or memory.
- If multiple candidates are too similar, the bot should ask the user to confirm instead of guessing.

Example flow:

```txt
User asks: @ai 用 kelvin 的風格回答
Resolver sees: kelvin
Member index matches: Kelvin Cheng -> 85260000000@c.us
Qdrant filter becomes: groupId=current group AND userId=85260000000@c.us
AI receives only Kelvin's relevant memories/profile and answers in that style
```

Do not rely only on the LLM to guess who `kelvin` is, because it may confuse messages written by Kelvin with messages where other people mention Kelvin.

## Privacy Rules

- Only import group history the user is allowed to process.
- Do not store sensitive profile claims.
- Profile summaries should describe communication style, interests, preferences, and interaction habits only.
- Do not infer protected attributes, medical conditions, politics, religion, sexuality, or private identity details.
- Use deterministic IDs so re-running import does not duplicate messages.

## Planned Files

- Create: `scripts/history-utils.js`
  - Normalize messages, filter text, create deterministic UUIDs, build Qdrant points.
- Create: `scripts/history-utils.test.js`
  - Unit tests for normalization, filtering, IDs, and payload shape.
- Create: `scripts/seed-whatsapp-history.js`
  - Import historical messages into Qdrant.
- Create: `scripts/summarize-member-profiles.js`
  - Optional second step to summarize members and store profile memories.
- Create: `scripts/member-resolver.js`
  - Builds a lightweight member index and resolves names like `kelvin` to the most likely `userId` using display names, profile memories, and fuzzy matching.
- Create: `scripts/member-resolver.test.js`
  - Unit tests for resolving partial names such as `kelvin` to `Kelvin Cheng`.
- Modify: `package.json`
  - Add `test`, `seed:history`, and `seed:profiles` scripts.
- Optional Modify: `n8n/workflows/workflows.json`
  - Add member-resolution routing only after history/profile import is working.

---

## Input Format

Use a normalized JSON array first:

```json
[
  {
    "groupId": "120363000000000000@g.us",
    "groupName": "Example Group",
    "userId": "85260000000@c.us",
    "userName": "Kelvin",
    "text": "I prefer backend projects because I like database and API design.",
    "timestamp": 1714550400
  }
]
```

Message memory payload shape:

```json
{
  "messageId": "deterministic-uuid",
  "groupId": "120363000000000000@g.us",
  "groupName": "Example Group",
  "userId": "85260000000@c.us",
  "userName": "Kelvin",
  "text": "I prefer backend projects because I like database and API design.",
  "timestamp": 1714550400,
  "expiresAt": 2029910400,
  "type": "whatsapp_message",
  "source": "history-seed"
}
```

Profile memory payload shape:

```json
{
  "messageId": "deterministic-profile-uuid",
  "groupId": "120363000000000000@g.us",
  "groupName": "Example Group",
  "userId": "85260000000@c.us",
  "userName": "Kelvin",
  "text": "Member profile for Kelvin: Kelvin often asks for step-by-step technical guidance and focuses on backend, Docker, API, and deployment details.",
  "timestamp": 1714550400,
  "expiresAt": 2029910400,
  "type": "member_profile",
  "source": "history-profile-summary"
}
```

Member index payload shape:

```json
{
  "messageId": "deterministic-member-index-uuid",
  "groupId": "120363000000000000@g.us",
  "groupName": "Example Group",
  "userId": "85260000000@c.us",
  "userName": "Kelvin Cheng",
  "text": "Member index: Kelvin Cheng. Known name tokens: kelvin, cheng, wing. This member can be referred to as Kelvin, Kelvin Cheng, or Wing.",
  "timestamp": 1714550400,
  "expiresAt": 2029910400,
  "type": "member_index",
  "source": "history-member-index"
}
```

---

## Task 1: Build History Utilities

**Files:**
- Create: `scripts/history-utils.js`
- Create: `scripts/history-utils.test.js`

- [ ] **Step 1: Add tests**

Test cases:

```txt
normalizeHistoryMessage accepts valid groupId/userId/text/timestamp
normalizeHistoryMessage rejects missing userId
shouldImportHistoryText rejects short text and emoji-only text
shouldImportHistoryText accepts useful Chinese/English text
createHistoryMessageId returns the same UUID for the same message
buildQdrantMessagePoint requires a 1024-dim vector
buildQdrantMessagePoint sets type=whatsapp_message and source=history-seed
buildMemberProfilePrompt includes safety instructions
```

- [ ] **Step 2: Implement utilities**

Functions to export:

```js
normalizeHistoryMessage(raw)
shouldImportHistoryText(text)
createHistoryMessageId(message)
createMemberProfileId({ groupId, userId })
buildQdrantMessagePoint(message, vector)
buildQdrantProfilePoint(profile, vector)
buildMemberProfilePrompt({ userName, messages })
```

- [ ] **Step 3: Run tests**

```powershell
node --test C:\Users\USER\Desktop\n8n-whatsapp-bot\scripts\history-utils.test.js
```

Expected: all tests pass.

---

## Task 2: Build Message Backfill Script

**Files:**
- Create: `scripts/seed-whatsapp-history.js`
- Modify: `package.json`

- [ ] **Step 1: Implement script behavior**

The script must:

```txt
1. Require TOKENDANCE_API_KEY from environment
2. Read JSON file path from command argument
3. Parse JSON array
4. Normalize each message
5. Skip low-value text
6. Call TokenDance embeddings endpoint
7. Assert embedding length is 1024
8. Build Qdrant points
9. Upsert in batches of 32
10. Print imported/skipped counts
```

- [ ] **Step 2: Add package script**

Add:

```json
"seed:history": "node scripts/seed-whatsapp-history.js"
```

- [ ] **Step 3: Test with one sample message**

```powershell
$env:TOKENDANCE_API_KEY = "your_key_here"
node scripts/seed-whatsapp-history.js tmp-history-sample.json
```

Expected:

```json
{
  "imported": 1,
  "skipped": 0
}
```

- [ ] **Step 4: Verify Qdrant count**

```powershell
curl.exe http://localhost:6333/collections/whatsapp_memory
```

Expected: `points_count` increases.

---

## Task 3: Build Optional Member Profile Seeder

**Files:**
- Create: `scripts/summarize-member-profiles.js`
- Modify: `package.json`

- [ ] **Step 1: Implement script behavior**

The script must:

```txt
1. Require TOKENDANCE_API_KEY
2. Require LLM_API_KEY
3. Read the same history JSON file
4. Group messages by groupId + userId
5. Only summarize members with at least 10 useful messages
6. Use at most the latest 120 messages per member
7. Ask LLM for a safe communication-style summary
8. Embed the summary with qwen-text-embedding-v4
9. Upsert profile memory into Qdrant
10. Print profile count
```

- [ ] **Step 2: Profile prompt safety text**

The prompt must include:

```txt
Focus only on communication style, technical interests, recurring preferences, and interaction habits.
Do not infer sensitive attributes, protected traits, medical conditions, political beliefs, religion, sexuality, or private identity details.
Do not diagnose personality disorders.
Use cautious wording such as often, appears to, or tends to.
```

- [ ] **Step 3: Add package script**

Add:

```json
"seed:profiles": "node scripts/summarize-member-profiles.js"
```

- [ ] **Step 4: Run after user approval**

```powershell
$env:TOKENDANCE_API_KEY = "your_tokendance_key"
$env:LLM_API_KEY = "your_llm_key"
node scripts/summarize-member-profiles.js history.json
```

Expected:

```json
{
  "profiles": 3
}
```

---

## Task 4: Add Automatic Member Name Resolver

**Files:**
- Create: `scripts/member-resolver.js`
- Create: `scripts/member-resolver.test.js`
- Optional Modify: `n8n/workflows/workflows.json`

- [ ] **Step 1: Add automatic member name resolver tests**

Test cases:

```txt
resolveMember("kelvin") matches userName "Kelvin Cheng"
resolveMember("Kelvin") is case-insensitive
resolveMember("wing") can match aliases generated from profile/index text
resolveMember returns null when no candidate score is high enough
resolveMember prefers exact token match over weak fuzzy match
```

- [ ] **Step 2: Implement member resolver**

Create a resolver with this behavior:

```txt
1. Build candidate list from known group members in imported history.
2. For each member, keep userId, userName, normalized name tokens, and recent profile/index text.
3. When user asks about a name, normalize the query name.
4. Score candidates:
   - exact full name match: highest
   - exact token match: high
   - startsWith/contains match: medium
   - fuzzy similarity: low
5. Return the best candidate only if score passes threshold.
6. If two candidates are too close, return ambiguous result instead of guessing.
```

Function shape:

```js
resolveMemberName({ queryName, members })
```

Expected result:

```js
{
  status: "matched",
  userId: "85260000000@c.us",
  userName: "Kelvin Cheng",
  score: 0.95
}
```

Ambiguous result:

```js
{
  status: "ambiguous",
  candidates: [
    { userId: "user-1", userName: "Kelvin Cheng", score: 0.82 },
    { userId: "user-2", userName: "Kevin Chan", score: 0.78 }
  ]
}
```

- [ ] **Step 3: Store member index memories**

During history/profile seeding, create one `member_index` memory per member:

```txt
type = member_index
source = history-member-index
text = "Member index: Kelvin Cheng. Known name tokens: kelvin, cheng, wing..."
```

This lets the AI find `Kelvin Cheng` even if the user asks only `kelvin`.

- [ ] **Step 4: Add optional n8n member-resolution step**

Only after seeding works, add a code node before Qdrant search:

```txt
detect target person name from the question
search member_index/profile memories first
resolve target name to userId
if matched, add userId filter to Qdrant search
if ambiguous, ask user which member they mean
```

Example:

```txt
User asks: @ai 用 kelvin 的风格回答这个问题
Resolver finds: Kelvin Cheng -> 85260000000@c.us
Qdrant filter: groupId=current group AND userId=85260000000@c.us
```

- [ ] **Step 5: Keep manual aliases optional, not required**

Manual alias file should remain optional only:

```txt
member-aliases.json can override resolver mistakes later, but the first version should not require the user to maintain aliases manually.
```

---

## Task 5: Decide Whether n8n Retrieval Needs Changes

**Files:**
- Optional Modify: `n8n/workflows/workflows.json`

- [ ] **Step 1: Test current retrieval first**

Ask in WhatsApp:

```txt
@ai 根據群組記憶，Kelvin 平時偏好什麼技術方向？
```

Expected: bot can retrieve normal history and profile memories.

- [ ] **Step 2: If profile memories are not appearing, increase Qdrant search limit**

Change `build qdrant search` from:

```js
limit: 8
```

to:

```js
limit: 12
```

Expected: more relevant memory candidates reach the final prompt.

---

## Task 6: Validation

- [ ] **Step 1: Run unit tests**

```powershell
node --test C:\Users\USER\Desktop\n8n-whatsapp-bot\message-utils.test.js C:\Users\USER\Desktop\n8n-whatsapp-bot\scripts\history-utils.test.js
```

- [ ] **Step 2: Run syntax checks**

```powershell
node --check C:\Users\USER\Desktop\n8n-whatsapp-bot\index.js
node --check C:\Users\USER\Desktop\n8n-whatsapp-bot\message-utils.js
node --check C:\Users\USER\Desktop\n8n-whatsapp-bot\scripts\history-utils.js
node --check C:\Users\USER\Desktop\n8n-whatsapp-bot\scripts\member-resolver.js
node --check C:\Users\USER\Desktop\n8n-whatsapp-bot\scripts\seed-whatsapp-history.js
node --check C:\Users\USER\Desktop\n8n-whatsapp-bot\scripts\summarize-member-profiles.js
```

- [ ] **Step 3: Verify Qdrant collection config**

```powershell
curl.exe http://localhost:6333/collections/whatsapp_memory
```

Expected:

```txt
vector size = 1024
status = green
```

---

## Open Questions To Fill Later

- How will historical WhatsApp messages be exported: WhatsApp native export, whatsapp-web.js fetch, or manual JSON?
- Should media messages be ignored or stored as captions only?
- Should member profiles be generated for all members or only frequent members?
- Should profile memories expire, or should they be long-lived initial memory?
- Should imported history include only one group or multiple groups?
- Should we add a delete script for seeded history if the user wants rollback?
- Should automatic member resolution ask the user when ambiguous, or silently use the best match?
- Should member_index memories be regenerated every time history/profile seeding runs?

## Recommended First Implementation

Start with only message backfill:

```txt
history JSON -> clean/filter -> qwen embedding -> Qdrant upsert
```

Then test RAG quality. Add member profile summaries only after confirming the raw history import works.