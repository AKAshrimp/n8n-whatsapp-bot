# n8n Nodes 設定紀錄

這份文件用來記錄目前 workflow 的每一個 node。請注意：每個 node 的程式碼或 JSON 都要放在自己的 node 裡，不要把所有內容貼在同一個地方。

## Workflow 順序

```txt
Webhook
→ Switch command
  ├─ chat / memory → prepare memory → Deepseek → save memory → return message
  └─ image → Image API → return image
```

---

## 1. Webhook

用途：接收 `whatsapp-bridge` 轉發過來的 WhatsApp 訊息。

設定：

```txt
HTTP Method: POST
Path: whatsapp-trigger
Authentication: None
Respond: Immediately
```

Production URL：

```txt
http://n8n:5678/webhook/whatsapp-trigger
```

Test URL：

```txt
http://localhost:5678/webhook-test/whatsapp-trigger
```

收到的 body 範例：

```json
{
  "from": "85266209126-1591312833@g.us",
  "groupId": "85266209126-1591312833@g.us",
  "groupName": "Private Wutsapp Group",
  "userId": "852xxxxxxx@c.us",
  "memoryKey": "85266209126-1591312833@g.us:852xxxxxxx@c.us",
  "command": "chat",
  "memoryLimit": 10,
  "text": "我叫 Alex",
  "timestamp": 1234567890,
  "author": "852xxxxxxx@c.us",
  "fromMe": true
}
```

圖片指令收到的 body 範例：

```json
{
  "from": "85266209126-1591312833@g.us",
  "groupId": "85266209126-1591312833@g.us",
  "groupName": "Private Wutsapp Group",
  "userId": "852xxxxxxx@c.us",
  "memoryKey": "85266209126-1591312833@g.us:852xxxxxxx@c.us",
  "command": "image",
  "mode": "generate",
  "memoryLimit": 10,
  "text": "一隻穿西裝的柴犬在中環街頭",
  "prompt": "一隻穿西裝的柴犬在中環街頭",
  "image": null
}
```

如果是「傳圖片 + caption `@aiimg ...`」，會是：

```json
{
  "command": "image",
  "mode": "edit",
  "prompt": "幫我改成漫畫風",
  "image": {
    "mimetype": "image/jpeg",
    "filename": "input-image",
    "data": "base64..."
  }
}
```

---

## 2. prepare memory

Node type：Code

用途：根據 `memoryKey = groupId:userId` 讀取記憶，並組裝 DeepSeek 要用的 `messages` array。

設定：

```txt
Mode: Run Once for All Items
Language: JavaScript
```

Code：

```js
const store = $getWorkflowStaticData('global');
const body = $input.first().json.body;
const key = body.memoryKey;
const history = store[key] || [];

const system = {
  role: 'system',
  content: '你是一個 WhatsApp 群組 AI 助手。請根據該使用者在該群組的上下文回答，使用繁體中文，簡潔自然。'
};

if (body.command === 'memory') {
  return [{
    json: {
      ...body,
      messages: [
        system,
        ...history,
        {
          role: 'user',
          content: '請總結你目前記得關於我的資訊。若沒有記憶，請說目前沒有足夠記憶。'
        }
      ],
      existingMemory: history
    }
  }];
}

return [{
  json: {
    ...body,
    messages: [
      system,
      ...history,
      {
        role: 'user',
        content: body.text
      }
    ],
    existingMemory: history
  }
}];
```

輸出重點：

```json
{
  "groupId": "原始群組ID",
  "userId": "使用者ID",
  "memoryKey": "groupId:userId",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "existingMemory": []
}
```

---

## 2A. Switch command

Node type：Switch

用途：根據 Webhook body 裡的 `command` 分流。

建議規則：

```txt
Route 1: command equals image
Route 2: command equals chat
Route 3: command equals memory
```

連線：

```txt
image  → Image API → return image
chat   → prepare memory → Deepseek → save memory → return message
memory → prepare memory → Deepseek → save memory → return message
```

---

## 3. Deepseek

Node type：HTTP Request

用途：呼叫 DeepSeek API。

設定：

```txt
Method: POST
URL: https://api.deepseek.com/chat/completions
Authentication: Generic Credential Type
Generic Auth Type: Header Auth
Header Auth: Header Auth account
Send Body: ON
Body Content Type: JSON
Specify Body: Using JSON
```

JSON Body：

```json
{
  "model": "deepseek-v4-flash",
  "messages": {{ JSON.stringify($json.messages) }},
  "stream": false
}
```

重要：

- `messages` 不能寫成 `"{{ $json.messages }}"`，那會變成 string。
- `messages` 也不要整段用 `{{ { ... } }}` 放在 Using JSON 裡，容易變成 `[object Object]`。
- 在 `Using JSON` 欄位中，使用 `{{ JSON.stringify($json.messages) }}` 才會變成真正 JSON array。

DeepSeek 回傳重點：

```json
{
  "choices": [
    {
      "message": {
        "content": "AI 回覆文字"
      }
    }
  ]
}
```

---

## 4. save memory

Node type：Code

用途：把這次 user 問題與 AI 回覆寫回 static memory，最多保留 10 筆 messages。

設定：

```txt
Mode: Run Once for All Items
Language: JavaScript
```

Code：

```js
const store = $getWorkflowStaticData('global');

const input = $('prepare memory').item.json;
const aiReply = $json.choices[0].message.content;
const limit = input.memoryLimit || 10;

let history = input.existingMemory || [];

if (input.command !== 'memory') {
  history.push({ role: 'user', content: input.text });
  history.push({ role: 'assistant', content: aiReply });
  history = history.slice(-limit);
  store[input.memoryKey] = history;
}

return [{
  json: {
    to: input.groupId,
    message: aiReply
  }
}];
```

注意：

- Node 名稱是小寫 `prepare memory`，所以要用 `$('prepare memory').item.json`。
- `@ai memory` 只總結，不會寫入 memory。
- 一輪對話會寫入 2 筆 message：一筆 user，一筆 assistant。
- `memoryLimit = 10` 代表最多保留最近 10 筆 messages。

---

## 5. return message

Node type：HTTP Request

用途：把 AI 回覆送回 `whatsapp-bridge`，再由 bridge 發回原本 WhatsApp group。

設定：

```txt
Method: POST
URL: http://whatsapp-bridge:3000/send-message
Authentication: None
Send Body: ON
Body Content Type: JSON
Specify Body: Using Fields Below
```

Body Parameters：

```txt
Name: to
Value: {{ $json.to }}

Name: message
Value: {{ $json.message }}
```

重要：

- `to` 來自 `save memory` 的 `input.groupId`。
- 所以哪個 group 問，就會回到哪個 group。
- 不要在這個 node 手寫 JSON Body，因為 AI 回覆可能包含換行、引號或特殊字元，容易造成 `JSON Body is not valid JSON`。
- 使用 `Using Fields Below` 時，n8n 會自動把欄位安全轉成 JSON。
- 在 n8n 的 Value 欄位裡只填 `{{ $json.to }}` 或 `{{ $json.message }}`，不要手動輸入 `Value:` 這個字。
- 如果 `save memory` 左側 output 有 `to` 和 `message`，但此 node 仍失敗，先執行前一個 `save memory` node，再執行此 node。

---

## 測試流程

### 一般對話

在允許的 WhatsApp group 發：

```txt
@ai 我叫 Alex
```

再發：

```txt
@ai 我叫什麼？
```

AI 應該能回答它記得你叫 Alex。

### 查看記憶

```txt
@ai memory
```

AI 會總結目前對該 user 在該 group 的記憶。

### 隔離測試

1. 在 group A 用 user A 設定名字。
2. 換 user B 問 `@ai memory`，不應該看到 user A 的記憶。
3. 換 group B 用 user A 問 `@ai memory`，不應該看到 group A 的記憶。

---

## 6. Image API

Node type：HTTP Request

用途：收到 `@aiimg` 後，呼叫圖片生成 / 圖片修改 API。

目前先記錄通用規格，實際欄位會依你選的 image provider 調整。

### 文字生圖

輸入：

```txt
command: image
mode: generate
prompt: 使用者輸入的生圖 prompt
```

輸出建議統一成其中一種：

```json
{
  "imageUrl": "https://example.com/generated-image.png",
  "caption": "生成完成"
}
```

或：

```json
{
  "imageBase64": "base64...",
  "mimetype": "image/png",
  "filename": "ai-image.png",
  "caption": "生成完成"
}
```

### 圖片修改

輸入：

```txt
command: image
mode: edit
prompt: 使用者 caption 裡的修改需求
image.data: 使用者傳入圖片的 base64
image.mimetype: image/jpeg 或 image/png
```

---

## 7. return image

Node type：HTTP Request

用途：把 Image API 產生的新圖片送回 WhatsApp group。

設定：

```txt
Method: POST
URL: http://whatsapp-bridge:3000/send-image
Authentication: None
Send Body: ON
Body Content Type: JSON
Specify Body: Using Fields Below
```

如果 Image API 回傳 `imageUrl`：

```txt
Name: to
Value: {{ $('Webhook').item.json.body.groupId }}

Name: imageUrl
Value: {{ $json.imageUrl }}

Name: caption
Value: {{ $json.caption || '生成完成' }}
```

如果 Image API 回傳 base64：

```txt
Name: to
Value: {{ $('Webhook').item.json.body.groupId }}

Name: imageBase64
Value: {{ $json.imageBase64 }}

Name: mimetype
Value: {{ $json.mimetype || 'image/png' }}

Name: filename
Value: {{ $json.filename || 'ai-image.png' }}

Name: caption
Value: {{ $json.caption || '生成完成' }}
```

重要：

- 不要手寫 JSON Body，仍然建議用 `Using Fields Below`。
- `to` 必須用原始 group ID，確保圖片回到發問群組。
- 如果欄位不確定，先只做 text-to-image，確定成功後再做 image edit。
