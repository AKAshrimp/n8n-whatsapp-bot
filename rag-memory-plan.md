# WhatsApp 群組 Shared RAG Memory Plan

## 目標

建立一個「獨有的群組 AI」，讓 bot 記錄指定 WhatsApp 群組內 5 個人的所有文字訊息，並在任何人使用 `@ai` 發問時，AI 可以查詢整個群組的共同記憶。

核心效果：

```txt
A 說過的內容會被記錄
B 問 @ai 時，AI 可以根據 A 以前說過的內容回答
```

這不是 per-user memory，而是：

```txt
group-level shared memory
```

---

## Qdrant Docker 是什麼？

`Qdrant` 是一個向量資料庫。

簡單理解：

```txt
普通資料庫：用關鍵字找文字
Qdrant：用語意找文字
```

例子：

```txt
Kelvin 說：我下星期去東京跑馬拉松
```

之後有人問：

```txt
@ai Kelvin 最近有咩計劃？
```

就算問題沒有出現「東京」或「馬拉松」，Qdrant 也可以用語意相似度找回相關記憶。

`Qdrant Docker` 代表：

```txt
用 docker compose 多開一個 qdrant container
資料存在本機 Docker volume
n8n 透過 http://qdrant:6333 呼叫它
```

它不是雲端服務，是本機跑的資料庫。

---

## 整體架構

```txt
WhatsApp Group
→ whatsapp-bridge
→ n8n
→ OpenAI Embeddings API
→ Qdrant (向量資料庫)
→ DeepSeek (回答)
→ WhatsApp 回覆
```

Docker 服務：

```txt
n8n               → 工作流引擎
whatsapp-bridge   → WhatsApp 收發
qdrant            → 向量資料庫 (新)
```

---

## 記憶流程

### 1. 平時記錄所有群訊息

群裡任何人說話：

```txt
A: 我星期五要去深圳
B: 我最近想買相機
C: 晚餐去邊？
```

`whatsapp-bridge` 送到 n8n：

```json
{
  "command": "record",
  "groupId": "852xxx@g.us",
  "groupName": "Private Wutsapp Group",
  "userId": "111702765606:38@lid",
  "userName": "Kelvin",
  "text": "我星期五要去深圳",
  "timestamp": 1780222830
}
```

n8n 做：

```txt
清理文字
→ 轉 embedding
→ 存入 Qdrant
```

普通聊天只記錄，不回覆。

---

### 2. 有人 `@ai` 時查記憶

使用者問：

```txt
@ai Kelvin 最近有咩安排？
```

n8n 做：

```txt
問題 → embedding
→ Qdrant search
→ 取回 top 5-10 條相關群記憶
→ prepare RAG prompt
→ DeepSeek
→ return message
```

DeepSeek 回答時可以使用整個群組的共同記憶。

---

## Qdrant 資料設計

每條記憶存成一個 point：

```json
{
  "id": "message-id",
  "vector": [0.01, 0.22, 0.33],
  "payload": {
    "groupId": "852xxx@g.us",
    "groupName": "Private Wutsapp Group",
    "userId": "111702765606:38@lid",
    "userName": "Kelvin",
    "text": "我星期五要去深圳",
    "timestamp": 1780222830,
    "type": "whatsapp_message"
  }
}
```

重要欄位：

| 欄位 | 用途 |
|---|---|
| `groupId` | 區分不同 WhatsApp group |
| `userId` | 記錄是誰說的 |
| `userName` | 顯示用名稱 |
| `text` | 原始訊息文字 |
| `timestamp` | 訊息時間 |
| `type` | 資料類型 |

---

## SSD 空間估算

5 人小群文字訊息不會太誇張。

粗略估算：

| 記錄方式 | 1000 訊息 / 日 | 一年 |
|---|---:|---:|
| 只存原文 | 約 1MB / 日 | 幾百 MB |
| 每句都做 embedding | 約 5-10MB / 日 | 2-4GB |
| 多條訊息合併成 chunk 再 embedding | 約 0.5-1MB / 日 | 幾百 MB |

建議第一版先用：

```txt
每條有效文字訊息都存
太短訊息不記
圖片 / 語音 / 影片先不記
保留 180 天
```

---

## 第一版記錄規則

### 要記錄

- 指定 WhatsApp 群組內所有人的文字訊息
- `@ai` 問題
- 使用者普通聊天
- 圖片 caption 文字

### 暫時不記錄

- 空訊息
- 太短訊息，例如 `ok`、`哈哈`、`yes`
- 貼圖
- 語音
- 影片
- 圖片本身
- bot 自己送出的 AI 回覆

### 建議最短文字長度

```txt
至少 5 個字元
```

---

## n8n Workflow 設計

### 主 workflow

```txt
Webhook
→ Switch command
  ├─ record → clean message → embedding → qdrant upsert
  ├─ chat   → query embedding → qdrant search → prepare RAG prompt → DeepSeek → return message
  └─ image  → Image API → return image
```

### `command` 分工

| command | 來源 | 功能 |
|---|---|---|
| `record` | 普通群訊息 | 只記錄，不回覆 |
| `chat` | `@ai 問題` | 查 RAG，然後回答 |
| `memory` | `@ai memory` | 可選，總結目前群記憶 |
| `image` | `@aiimg prompt` | 生圖 / 改圖 |

---

## whatsapp-bridge 需要修改

目前 bridge 只處理：

```txt
@ai
@aiimg
```

RAG 版本要改成：

```txt
普通群訊息 → command: record → n8n
@ai        → command: chat / memory → n8n
@aiimg     → command: image → n8n
```

注意：

```txt
普通群訊息只 forward，不回覆
```

而且要避免記錄 bot 自己的回覆，否則 AI 會把自己的答案也反覆寫進記憶。

---

## Embedding 選擇

Embedding 是把文字轉成向量。

### 決定使用：OpenAI `text-embedding-3-small`

原因：

- 設定比本地 model 簡單
- 穩定、速度快
- 中文 / 英文語意效果可靠
- 適合先把 RAG 跑通
- 訊息量小，成本可控

Model：

```txt
text-embedding-3-small
```

Vector size：

```txt
1536
```

所以 Qdrant collection 要設：

```json
{
  "vectors": {
    "size": 1536,
    "distance": "Cosine"
  }
}
```

n8n 呼叫 OpenAI embedding：

```txt
POST https://api.openai.com/v1/embeddings
```

Headers：

```txt
Authorization: Bearer OPENAI_API_KEY
Content-Type: application/json
```

Body：

```json
{
  "model": "text-embedding-3-small",
  "input": "我星期五要去深圳"
}
```

回傳：

```json
{
  "data": [
    {
      "embedding": [0.012, -0.33, "..."]
    }
  ]
}
```

n8n 要取：

```txt
$json.data[0].embedding
```

然後把這個 vector 存進 Qdrant。

### 其他可選方案（之後可換）

```txt
Jina embeddings                → 中文效果好，付費
Voyage embeddings              → 效果好，付費
Ollama + nomic-embed-text      → 本地免費，但設定較多
```

---

## Qdrant Docker Compose

在 `docker-compose.yml` 加 Qdrant：

```yaml
qdrant:
  image: qdrant/qdrant:latest
  container_name: qdrant
  ports:
    - "6333:6333"
  volumes:
    - qdrant_storage:/qdrant/storage
```

再加 volume：

```yaml
volumes:
  qdrant_storage:
```

Container 內呼叫：

```txt
Qdrant: http://qdrant:6333
```

Windows 瀏覽器查看：

```txt
Qdrant dashboard: http://localhost:6333/dashboard
```

---

## Qdrant API 流程

### 1. 建 collection

只需要做一次。

```txt
PUT http://qdrant:6333/collections/whatsapp_memory
```

需要知道 embedding vector size，例如：

```json
{
  "vectors": {
    "size": 1536,
    "distance": "Cosine"
  }
}
```

`size` 必須跟 embedding model 輸出的向量長度一致。

使用 `text-embedding-3-small` 時：

```json
{
  "vectors": {
    "size": 1536,
    "distance": "Cosine"
  }
}
```

---

### 2. 寫入記憶

```txt
PUT http://qdrant:6333/collections/whatsapp_memory/points
```

body：

```json
{
  "points": [
    {
      "id": "unique-message-id",
      "vector": [0.01, 0.22, 0.33],
      "payload": {
        "groupId": "852xxx@g.us",
        "userId": "111702765606:38@lid",
        "userName": "Kelvin",
        "text": "我星期五要去深圳",
        "timestamp": 1780222830
      }
    }
  ]
}
```

---

### 3. 搜尋記憶

```txt
POST http://qdrant:6333/collections/whatsapp_memory/points/search
```

body：

```json
{
  "vector": [0.01, 0.22, 0.33],
  "limit": 8,
  "filter": {
    "must": [
      {
        "key": "groupId",
        "match": {
          "value": "852xxx@g.us"
        }
      }
    ]
  },
  "with_payload": true
}
```

---

## Prompt 設計

`prepare RAG prompt` node 要把 Qdrant 找到的資料整理成：

```txt
以下是這個 WhatsApp 群組的相關歷史記憶：

1. [Kelvin, 2026-05-31] 我星期五要去深圳
2. [Alex, 2026-05-30] 我最近想買 Sony 相機
3. [May, 2026-05-29] 我下星期生日

使用者現在問：
Kelvin 最近有咩安排？
```

System prompt：

```txt
你是一個 WhatsApp 群組 AI 助手。
你可以使用群組共同記憶回答問題。
如果記憶不足，請明確說「我目前沒有足夠記憶」。
不要編造沒有出現在記憶裡的內容。
回答請簡潔、自然，使用繁體中文或粵語。
```

---

## 隱私與安全

因為這個功能會記錄所有群訊息，建議在群裡先講清楚：

```txt
這個群組 AI 會記錄群內文字訊息，用於之後回答群內問題。
不會記錄語音、影片、圖片本身。
如果有人不想被記錄，可以提出。
```

未來可加：

```txt
@ai forget me
@ai forget user
@ai memory status
@ai export memory
```

---

## 建議實作順序

### Phase 1：Qdrant 基礎

- 在 `docker-compose.yml` 加 Qdrant
- 啟動並確認 Qdrant dashboard 可開
- 建立 `whatsapp_memory` collection (size: 1536)
- 在 n8n 設定 OpenAI API key credential

### Phase 2：記錄普通群訊息

- 修改 `index.js`
- 普通群訊息送到 n8n：`command: record`
- n8n 加 `record` 分支

### Phase 3：Embedding + 寫入 Qdrant

- n8n record 分支呼叫 OpenAI `text-embedding-3-small`
- 取得 vector
- upsert 到 Qdrant
- 確認 Qdrant 有資料

### Phase 4：`@ai` 查 RAG

- `@ai` 問題轉 embedding (OpenAI)
- Qdrant search 同群記憶
- prepare RAG prompt
- DeepSeek 根據記憶回答

### Phase 5：清理策略

- 忽略太短訊息
- 忽略 bot 自己回覆
- 加保留天數
- 未來加 forget 指令

---

## 第一版完成標準

能做到：

```txt
A 在群裡說：我星期五要去深圳
B 問：@ai A 星期五去哪？
AI 回答：根據群裡之前的聊天，A 星期五要去深圳。
```

並且：

- 不會回覆普通聊天
- 只在 `@ai` 時回答
- 只搜尋同一個 WhatsApp group 的記憶
- 不記錄 bot 自己的回覆
- 不記錄太短或無意義訊息
