# n8n WhatsApp Bot

本專案是一個本機 Docker 版 WhatsApp AI 群組助手。  
在指定 WhatsApp group 裡發送 `@ai 問題`，bot 會把訊息送到 n8n，n8n 呼叫 DeepSeek API，再把 AI 回覆送回原本發問的 group。

## 目前功能

- WhatsApp Web 掃碼登入
- 只偵測指定 WhatsApp groups
- 只處理真正的 `@ai` 指令
- 非 `@ai` 訊息直接忽略、不印 log
- n8n workflow 呼叫 DeepSeek API
- 回覆會送回原本發問的 group
- Per-user memory：
  - 使用 `memoryKey = groupId:userId`
  - 不同 group / 不同 user 的記憶分開
  - 每個 user 最多保留最近 10 筆 messages
- `@ai memory`：總結目前 AI 對該 user 的記憶
- `@aiimg`：圖片功能指令
  - 文字生圖：`@aiimg 一隻貓在香港喝奶茶`
  - 圖片修改：傳圖片並在 caption 寫 `@aiimg 幫我改成漫畫風`

## 專案檔案

| 檔案 | 用途 |
|---|---|
| `docker-compose.yml` | 啟動 n8n 與 whatsapp-bridge |
| `Dockerfile` | 建立 whatsapp-bridge container |
| `package.json` | Node.js dependencies |
| `index.js` | WhatsApp Bridge 主程式 |
| `n8n-nodes.md` | n8n nodes 設定紀錄 |
| `technical-guide.html` | 技術學習文檔，用瀏覽器打開看 |
| `plan.md` | 開發計畫與 checklist |

## 明天開機後怎麼恢復

先打開 Docker Desktop，等它啟動完成。

進入專案資料夾：

```powershell
cd C:\Users\USER\Desktop\n8n-whatsapp-bot
```

啟動 containers：

```powershell
docker compose up -d
```

看狀態：

```powershell
docker ps
```

看 WhatsApp bridge logs：

```powershell
docker logs whatsapp-bridge --tail 120
```

成功狀態應該看到：

```txt
WhatsApp Client authenticated.
WhatsApp Client is ready!
```

如果看到 QR Code，就用手機 WhatsApp 掃碼登入。

## 如果遇到 Chromium profile lock

如果 logs 看到：

```txt
The profile appears to be in use by another Chromium process
```

執行：

```powershell
docker compose stop whatsapp-bridge
docker run --rm -v n8n-whatsapp-bot_whatsapp_session:/data alpine sh -c "rm -f /data/session/SingletonSocket /data/session/SingletonCookie /data/session/SingletonLock"
docker compose start whatsapp-bridge
```

再確認：

```powershell
docker logs whatsapp-bridge --tail 80
```

## n8n

瀏覽器打開：

```txt
http://localhost:5678
```

workflow 順序：

```txt
Webhook
→ prepare memory
→ Deepseek
→ save memory
→ return message
```

圖片 workflow 建議分支：

```txt
Webhook
→ Switch command
  ├─ chat / memory → 原本文字 workflow
  └─ image → Image API → return image
```

詳細每個 node 的設定看：

```txt
n8n-nodes.md
```

如果修改 workflow，記得 **Publish**。

## 測試方式

在允許的 WhatsApp group 發：

```txt
@ai hi
```

測 memory：

```txt
@ai 我叫 Alex
@ai memory
```

測圖片指令：

```txt
@aiimg 一隻穿西裝的柴犬在中環街頭
```

圖片修改：

```txt
傳一張圖片，caption 寫：
@aiimg 幫我改成 cyberpunk 風格
```

確認 logs：

```powershell
docker logs whatsapp-bridge --since 5m
```

正常會看到：

```txt
[Received] ...
[Forwarded] Message sent to n8n webhook.
[Sent] To: ... | Message: ...
```

## 目前允許的 groups

在 `docker-compose.yml`：

```txt
TARGET_GROUP_NAMES=Private Wutsapp Group,珍•Marathon Part-time•珠
```

程式會忽略 group name 裡的半形 / 全形括號：

```txt
珍•Marathon Part-time•珠
(珍•Marathon Part-time•珠)
（珍•Marathon Part-time•珠）
```

## 重要觀念

- Windows 瀏覽器看 n8n：`http://localhost:5678`
- Docker container 互相呼叫：
  - n8n：`http://n8n:5678`
  - whatsapp bridge：`http://whatsapp-bridge:3000`
- bot 打 n8n production webhook：

```txt
http://n8n:5678/webhook/whatsapp-trigger
```

- n8n 回 WhatsApp bridge：

```txt
http://whatsapp-bridge:3000/send-message
```

- n8n 回 WhatsApp bridge 發圖片：

```txt
http://whatsapp-bridge:3000/send-image
```

`/send-image` 支援兩種 body：

```json
{
  "to": "groupId@g.us",
  "imageUrl": "https://example.com/image.png",
  "caption": "生成完成"
}
```

或：

```json
{
  "to": "groupId@g.us",
  "imageBase64": "base64...",
  "mimetype": "image/png",
  "filename": "ai-image.png",
  "caption": "生成完成"
}
```

## 關機前

可以直接關機。  
如果想先停掉 containers：

```powershell
docker compose stop
```

明天再用：

```powershell
docker compose up -d
```
