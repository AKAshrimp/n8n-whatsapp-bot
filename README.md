# n8n WhatsApp Bot

This project is a local Docker-based WhatsApp AI group assistant.  
When someone sends `@ai question` in an allowed WhatsApp group, the bot forwards the message to n8n, n8n calls the DeepSeek API, and the AI reply is sent back to the original group.

## Current Features

- WhatsApp Web QR-code login
- Only monitors configured WhatsApp groups
- Only handles real `@ai` commands
- Ignores non-`@ai` messages without logging them
- n8n workflow calls the DeepSeek API
- Replies are sent back to the original group
- Per-user memory:
  - Uses `memoryKey = groupId:userId`
  - Separates memory by group and user
  - Keeps up to the latest 10 messages per user
- `@ai memory`: summarizes what the AI currently remembers about that user
- `@aiimg`: image command
  - Text-to-image: `@aiimg a cat drinking milk tea in Hong Kong`
  - Image editing: send an image and write `@aiimg make this comic style` in the caption

## Project Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | Starts n8n and whatsapp-bridge |
| `Dockerfile` | Builds the whatsapp-bridge container |
| `package.json` | Node.js dependencies |
| `index.js` | Main WhatsApp bridge program |
| `n8n-nodes.md` | n8n node configuration notes |
| `technical-guide.html` | Technical learning guide; open it in a browser |
| `plan.md` | Development plan and checklist |
| `n8n/workflows/workflows.json` | Sanitized exported n8n workflow |

## How to Resume After Reboot

Open Docker Desktop first and wait until it finishes starting.

Enter the project folder:

```powershell
cd C:\Users\USER\Desktop\n8n-whatsapp-bot
```

Start the containers:

```powershell
docker compose up -d
```

Check container status:

```powershell
docker ps
```

Check WhatsApp bridge logs:

```powershell
docker logs whatsapp-bridge --tail 120
```

Successful startup should show:

```txt
WhatsApp Client authenticated.
WhatsApp Client is ready!
```

If a QR code appears, scan it with WhatsApp on your phone.

## If You Hit a Chromium Profile Lock

If the logs show:

```txt
The profile appears to be in use by another Chromium process
```

Run:

```powershell
docker compose stop whatsapp-bridge
docker run --rm -v n8n-whatsapp-bot_whatsapp_session:/data alpine sh -c "rm -f /data/session/SingletonSocket /data/session/SingletonCookie /data/session/SingletonLock"
docker compose start whatsapp-bridge
```

Then check again:

```powershell
docker logs whatsapp-bridge --tail 80
```

## n8n

Open in your browser:

```txt
http://localhost:5678
```

Workflow order:

```txt
Webhook
→ prepare memory
→ Deepseek
→ save memory
→ return message
```

Recommended image workflow branch:

```txt
Webhook
→ Switch command
  ├─ chat / memory → existing text workflow
  └─ image → Image API → return image
```

For detailed node configuration, see:

```txt
n8n-nodes.md
```

If you modify the workflow, remember to **Publish** it.

## Testing

Send this in an allowed WhatsApp group:

```txt
@ai hi
```

Test memory:

```txt
@ai my name is Alex
@ai memory
```

Test image generation:

```txt
@aiimg a Shiba Inu wearing a suit on a Central street
```

Test image editing:

```txt
Send an image and write this in the caption:
@aiimg make this cyberpunk style
```

Check logs:

```powershell
docker logs whatsapp-bridge --since 5m
```

Expected logs:

```txt
[Received] ...
[Forwarded] Message sent to n8n webhook.
[Sent] To: ... | Message: ...
```

## Currently Allowed Groups

Configured in `docker-compose.yml`:

```txt
TARGET_GROUP_NAMES=Private Wutsapp Group,珍•Marathon Part-time•珠
```

The program ignores half-width and full-width parentheses in group names:

```txt
珍•Marathon Part-time•珠
(珍•Marathon Part-time•珠)
（珍•Marathon Part-time•珠）
```

## Important Concepts

- Access n8n from the Windows browser: `http://localhost:5678`
- Docker containers call each other by service name:
  - n8n: `http://n8n:5678`
  - whatsapp bridge: `http://whatsapp-bridge:3000`
- The bot calls the n8n production webhook:

```txt
http://n8n:5678/webhook/whatsapp-trigger
```

- n8n sends text replies back to the WhatsApp bridge:

```txt
http://whatsapp-bridge:3000/send-message
```

- n8n sends image replies back to the WhatsApp bridge:

```txt
http://whatsapp-bridge:3000/send-image
```

`/send-image` supports two body formats:

```json
{
  "to": "groupId@g.us",
  "imageUrl": "https://example.com/image.png",
  "caption": "Generated"
}
```

Or:

```json
{
  "to": "groupId@g.us",
  "imageBase64": "base64...",
  "mimetype": "image/png",
  "filename": "ai-image.png",
  "caption": "Generated"
}
```

## Before Shutting Down

You can shut down directly.  
If you want to stop the containers first:

```powershell
docker compose stop
```

Use this tomorrow to start them again:

```powershell
docker compose up -d
```
