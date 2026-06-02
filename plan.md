# 🤖 WhatsApp AI 群組助手開發計畫 (n8n + Node.js)

## 📌 專案概述
透過本地 Docker 環境部署，攔截 WhatsApp 群組中 `@ai` 開頭的訊息，轉發至 n8n 工作流處理，並呼叫 AI 模型生成回覆後自動傳送至原群組。

## 🛠️ 技術棧與前置準備
- [x] 電腦已啟動 Docker Desktop 確保容器環境就緒
- [ ] 準備好 Google Gemini API Key（作為 n8n 處理文字生成的大腦）
- [ ] 準備一個可以用來測試的 WhatsApp 帳號與群組
- [ ] VS Code (搭配 Claude Code 擴充功能或終端機介面)

---

## 🗺️ 實作階段拆解 (Checklist)

### Phase 1: 基礎環境建置 (Docker Compose)
- [x] 建立全新的專案資料夾（例如：`n8n-whatsapp-bot`）
- [x] 請 Claude Code 生成 `docker-compose.yml` (需包含 `n8n` 與 `whatsapp-bridge` 兩個服務容器)
- [x] 請 Claude Code 生成 `package.json` 並安裝 `whatsapp-web.js`、`express`、`qrcode-terminal` 等必要套件
- [x] 在終端機執行 `docker-compose up -d` 確保容器皆成功啟動

### Phase 2: WhatsApp Bridge 開發 (Node.js 監聯與轉發)
- [x] 撰寫 `index.js` 實現 WhatsApp Web 掃碼登入邏輯，並確保 QR Code 能顯示於終端機
- [x] 實作訊息監聽邏輯：篩選 `msg.from` 為群組，且 `msg.body.startsWith('@ai')` 的訊息
- [x] 實作 Webhook 觸發器：將攔截到的 `@ai` 訊息文字，透過 HTTP POST 發送至 n8n Webhook
- [x] 實作 Express 接收端：建立 `POST /send-message` 路由，用來接收 n8n 傳來的 AI 回覆，並透過 whatsapp-web.js 傳送回群組

### Phase 3: n8n 視覺化工作流設定
- [x] 開啟瀏覽器進入 n8n 介面 (`http://localhost:5678`)
- [x] 新增 **Webhook Node**：設定為 POST 方法，獲取測試 URL 並更新回 Node.js 腳本中 （path = whatsapp-trigger)
- [x] 新增 **HTTP Request Node (AI 處理)**：設定呼叫 Gemini API，將收到的訊息字串傳送給 AI 處理 (https://api.deepseek.com/chat/completions)
- [x] 新增 **HTTP Request Node (回傳結果)**：將 AI 產出的純文字結果，發送至 `http://whatsapp-bridge:3000/send-message` (注意：需使用 Docker 容器名稱進行跨容器通訊)

### Phase 4: 測試與優化
- [ ] 在 WhatsApp 測試群組發送 `@ai 你好`
- [ ] 檢查 Node.js 終端機的 Console Log，確認是否有成功攔截到訊息
- [ ] 檢查 n8n 的 Executions 紀錄，確認工作流是否成功跑完全程沒有報錯
- [ ] 確認 WhatsApp 群組有成功收到 AI 的回覆

---

## 🗣️ 給 Claude Code 的啟動 Prompt
> 「我想要在本地環境構建一個 WhatsApp AI 群組助手。整體架構包含兩個部分：
> 1. 一個基於 Node.js 和 whatsapp-web.js 的 WhatsApp Bridge（包含監聽群組 @ai 訊息並發送 Webhook 的功能，以及一個 Express 接收端用來發送回覆）。
> 2. 本地的 n8n。
> 
> 請幫我生成一份 `docker-compose.yml` 將這兩者容器化。接著，請幫我撰寫 Node.js 腳本的完整代碼，確保它能在終端機顯示登入 QR Code，並正確處理與 n8n Webhook 之間的跨容器 HTTP 請求。請一步一步帶我操作，我們從 Phase 1 開始。」