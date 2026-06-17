<div align="center">

# n8n RAG WhatsApp chatbot

An n8n workflow that gives a WhatsApp group chat long-term memory, member context, web search, and a slightly rude group-friend personality.

[![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![n8n](https://img.shields.io/badge/n8n-workflow-EA4B71?logo=n8n&logoColor=white)](https://n8n.io/)
[![Qdrant](https://img.shields.io/badge/Qdrant-vector_memory-DC244C)](https://qdrant.tech/)
[![Docker](https://img.shields.io/badge/Docker-compose-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)

</div>

![Main Chat Brain](docs/images/chat-brain.png)

## What it does

This is a self-hosted WhatsApp group AI bot. It listens to WhatsApp messages, decides whether the message should be answered, pulls relevant group memory from Qdrant, optionally searches the web, asks DeepSeek for a reply, then sends the answer back to WhatsApp.

The fun part is the memory layer. The bot does not just answer the latest message. It can use:

- long-term WhatsApp message memory from Qdrant
- member profiles and group background
- recent 5-minute group context
- short-term `@ai` conversation turns
- Brave Search results when the question needs fresh web context

## Workflow

The main workflow export is here:

```text
n8n/workflows/n8n-rag-whatsapp-chatbot-better-version.json
```

High-level flow:

```text
WhatsApp
  -> n8n webhook
  -> Qwen embedding
  -> Qdrant RAG search
  -> profile + recent context
  -> web-search classifier
  -> Brave Search, if needed
  -> DeepSeek response
  -> save memory
  -> WhatsApp reply
```

## Stack

| Layer | Tool |
| --- | --- |
| Workflow | n8n |
| WhatsApp bridge | `whatsapp-web.js` |
| Vector memory | Qdrant |
| Embeddings | Qwen / DashScope compatible embeddings |
| LLM | DeepSeek |
| Optional web context | Brave Search |
| Runtime | Docker Compose |

## Quick start

Clone the repo:

```powershell
git clone https://github.com/AKAshrimp/n8n-whatsapp-bot.git
cd n8n-whatsapp-bot
```

Create a local `.env` file. Keep it private.

```text
EMBEDDING_URL: your embedding endpoint
EMBEDDING_API_KEY: your embedding provider key
EMBEDDING_MODEL: text-embedding-v4
BRAVE_SEARCH_API_KEY: your Brave Search key, optional
```

Start the stack:

```powershell
docker compose up -d
```

Open n8n:

```text
http://localhost:5678
```

Import the workflow:

```text
n8n/workflows/n8n-rag-whatsapp-chatbot-better-version.json
```

Then scan the WhatsApp Web QR code:

```powershell
docker logs -f whatsapp-bridge
```

## Group settings

Allowed WhatsApp groups can be edited from the small settings page:

```text
http://localhost:3000/settings
```

This lets you change which groups the bot responds to without rebuilding the container.

## Memory design

The bot uses Qdrant for long-term memory:

- `whatsapp_message`, normal group messages
- `member_profile`, summarized member style and background
- recent message scrolls, used for "what just happened" context

The prompt layer is split into smaller n8n Code nodes so the workflow is easier to read:

```text
prepare memory
-> classify request
-> select member profiles
-> format semantic memory
-> format recent context
-> set persona policy
-> assemble LLM messages
```

## Development

Run the tests:

```powershell
npm test
```

Current test coverage includes message classification, group settings, history import filtering, workflow patching, and Qdrant request builders.

## Safety notes

- Do not commit `.env`, n8n credentials, local n8n databases, Qdrant storage, or WhatsApp sessions.
- The workflow export should use credential references, not raw API keys.
- The screenshot is from the n8n canvas. n8n officially exports workflow JSON, but it does not have a dedicated "make my workflow look beautiful in README" button yet.
