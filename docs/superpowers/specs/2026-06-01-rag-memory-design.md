# RAG Memory Design

## Goal

Build group-level shared memory for the WhatsApp bot. The bot records useful text messages from configured WhatsApp groups into Qdrant, then uses those memories when someone asks with `@ai`.

## Scope

First implementation includes:

- Recording normal group text messages.
- Recording `@ai` questions.
- Searching only the same WhatsApp group when answering.
- OpenAI `text-embedding-3-small` embeddings.
- Qdrant collection `whatsapp_memory` with vector size `1536`.
- Management commands:
  - `@ai memory status`
  - `@ai forget me`
- 180-day retention cleanup.
- Existing `@aiimg` image generation/editing remains unchanged.

Out of scope for the first implementation:

- Voice transcription.
- Image OCR.
- Multi-image memory.
- Per-user private memory.
- Automatic summaries/chunk compression.

## Architecture

The project keeps the current split:

- `whatsapp-bridge` handles WhatsApp events and forwards structured JSON to n8n.
- n8n owns RAG workflow orchestration.
- OpenAI creates embeddings.
- Qdrant stores and searches vectors.
- DeepSeek generates final chat answers.

Flow:

```txt
WhatsApp
→ whatsapp-bridge
→ n8n
  ├─ record → OpenAI Embedding → Qdrant upsert
  ├─ chat → OpenAI Embedding → Qdrant search → DeepSeek → WhatsApp
  ├─ memory_status → Qdrant count/sample → WhatsApp
  ├─ forget_me → Qdrant delete by groupId + userId → WhatsApp
  ├─ cleanup → Qdrant delete expired memories
  └─ image → existing image workflow
```

## Docker Services

Add Qdrant to `docker-compose.yml`:

- service: `qdrant`
- image: `qdrant/qdrant:latest`
- port: `6333:6333`
- volume: `qdrant_storage:/qdrant/storage`
- network: `bot-network`

n8n calls Qdrant at:

```txt
http://qdrant:6333
```

Browser dashboard:

```txt
http://localhost:6333/dashboard
```

## Bridge Behavior

`index.js` currently forwards only `@ai` and `@aiimg`. It will change to forward normal useful group text too.

Command mapping:

| Input | Command | Behavior |
|---|---|---|
| Normal group text | `record` | Store memory only, no reply |
| `@ai question` | `chat` | Search memory and answer |
| `@ai memory status` | `memory_status` | Show memory status |
| `@ai forget me` | `forget_me` | Delete sender memory in the current group |
| `@aiimg prompt` | `image` | Existing image flow |

Bridge filtering:

- Only allowed groups from `TARGET_GROUP_NAMES`.
- Ignore bot/self messages for `record`.
- Ignore empty text.
- Ignore short low-value messages under 5 characters.
- Ignore sticker, voice, video, and image body unless there is caption text.
- Preserve current image reference handling.

Payload sent to n8n:

```json
{
  "command": "record",
  "groupId": "852xxx@g.us",
  "groupName": "Private Wutsapp Group",
  "userId": "111702765606@lid",
  "userName": "Kelvin",
  "messageId": "stable-message-id",
  "text": "我星期五要去深圳",
  "timestamp": 1780222830,
  "fromMe": false
}
```

## Qdrant Data Model

Collection:

```txt
whatsapp_memory
```

Vector:

```json
{
  "size": 1536,
  "distance": "Cosine"
}
```

Payload:

```json
{
  "messageId": "stable-message-id",
  "groupId": "852xxx@g.us",
  "groupName": "Private Wutsapp Group",
  "userId": "111702765606@lid",
  "userName": "Kelvin",
  "text": "我星期五要去深圳",
  "timestamp": 1780222830,
  "expiresAt": 1795774830,
  "type": "whatsapp_message",
  "source": "whatsapp-bridge"
}
```

ID strategy:

- Prefer WhatsApp native message ID.
- If unavailable, hash `groupId + userId + timestamp + text`.
- Use the same value as Qdrant point ID and `payload.messageId`.

Retention:

- `expiresAt = timestamp + 180 days`.
- Cleanup deletes memories where `expiresAt` is less than current Unix time.

## n8n Workflow Design

### Init Collection

An initialization path or manual HTTP Request creates the Qdrant collection if missing:

```txt
PUT http://qdrant:6333/collections/whatsapp_memory
```

Body:

```json
{
  "vectors": {
    "size": 1536,
    "distance": "Cosine"
  }
}
```

### record Branch

Steps:

1. Receive webhook.
2. Confirm `command === "record"`.
3. Validate text length and required fields.
4. Call OpenAI embeddings:

```txt
POST https://api.openai.com/v1/embeddings
```

Body:

```json
{
  "model": "text-embedding-3-small",
  "input": "message text"
}
```

5. Upsert point to Qdrant:

```txt
PUT http://qdrant:6333/collections/whatsapp_memory/points?wait=true
```

6. End without replying to WhatsApp.

### chat Branch

Steps:

1. Receive webhook.
2. Confirm `command === "chat"`.
3. Embed the user question.
4. Search Qdrant with `groupId` filter and `limit: 8`.
5. Build RAG context from payload text, userName, and timestamp.
6. Send system prompt, context, and user question to DeepSeek.
7. Send answer to WhatsApp through `http://whatsapp-bridge:3000/send-message`.

Qdrant search filter:

```json
{
  "must": [
    {
      "key": "groupId",
      "match": {
        "value": "852xxx@g.us"
      }
    }
  ]
}
```

System prompt:

```txt
你是一個 WhatsApp 群組 AI 助手。
你可以使用群組共同記憶回答問題。
如果記憶不足，請明確說「我目前沒有足夠記憶」。
不要編造沒有出現在記憶裡的內容。
回答請簡潔、自然，使用繁體中文或粵語。
```

### memory_status Branch

Purpose:

- Tell the sender whether memory is enabled.
- Show approximate memory count for the current group.
- Show retention period.

Output example:

```txt
群組記憶已啟用。
目前只會記錄有效文字訊息，保留 180 天。
你可以用 @ai forget me 刪除你在此群組的記憶。
```

### forget_me Branch

Deletes memories matching both:

- current `groupId`
- sender `userId`

Qdrant delete filter:

```json
{
  "filter": {
    "must": [
      {
        "key": "groupId",
        "match": {
          "value": "852xxx@g.us"
        }
      },
      {
        "key": "userId",
        "match": {
          "value": "111702765606@lid"
        }
      }
    ]
  }
}
```

Bot response:

```txt
已刪除你在這個群組的 AI 記憶。
```

### cleanup Branch

Use an n8n Schedule Trigger once per day.

Delete Qdrant points where:

```txt
expiresAt < current Unix timestamp
```

If Qdrant filtering does not support direct less-than deletion in the current node setup, use scroll + delete selected point IDs.

## Error Handling

Record failures:

- If OpenAI embedding fails, log and stop.
- If Qdrant upsert fails, log and stop.
- Do not send error messages for normal `record` messages.

Chat failures:

- If embedding or Qdrant search fails, reply:

```txt
我暫時查不到群組記憶，請稍後再試。
```

- If no relevant memories are found, DeepSeek should answer with insufficient-memory wording instead of inventing.

Management command failures:

- Reply with a short failure message.
- Do not expose API keys, stack traces, or internal URLs.

## Privacy and Safety

Before enabling, announce in the group:

```txt
這個群組 AI 會記錄群內文字訊息，用於之後回答群內問題。
不會記錄語音、影片、圖片本身。
如果不想被記錄，可以使用 @ai forget me。
```

Safety requirements:

- Never log API keys.
- Do not include full image base64 in logs.
- Do not search across different `groupId`s.
- Do not record bot-generated replies.

## Testing Strategy

Bridge tests:

- Normal group text produces `command: record`.
- `@ai memory status` produces `memory_status`.
- `@ai forget me` produces `forget_me`.
- `@aiimg` still produces `image`.
- Bot/self messages are not recorded.
- Short messages are skipped.

n8n manual validation:

- Qdrant collection exists.
- Normal group message creates a Qdrant point.
- `@ai` question searches only the current group.
- `@ai forget me` deletes only current user's memories in current group.
- Cleanup removes expired points.
- Existing image workflow still works.

Acceptance test:

```txt
A: 我星期五要去深圳
B: @ai A 星期五去哪？
AI: 根據群組之前的聊天，A 星期五要去深圳。
```

Required guarantees:

- No reply for normal chat.
- Reply only for `@ai` commands.
- Same-group memory only.
- Bot messages not recorded.
- Short/noisy messages skipped.
- User can delete own group memory.
