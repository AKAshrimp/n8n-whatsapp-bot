# n8n AI Agent tools redesign

## Goal

Create a new n8n workflow for the WhatsApp bot instead of patching the current one. The new workflow should use n8n's existing and community nodes where practical, with an AI Agent at the center and external capabilities exposed as tools.

The selected direction is **Hybrid Agent Tools**:

- Keep the full current feature set.
- Use an AI Agent as the main decision and reply layer.
- Turn memory, web search, image handling, profile lookup, and status/admin actions into clear tool branches.
- Keep using the existing Qdrant memory data.
- Allow small Code nodes only for payload compatibility or binary formatting.

## Scope

The first version should preserve these capabilities:

- WhatsApp webhook intake and reply through the existing bridge.
- Normal chat replies through DeepSeek or another OpenAI-compatible chat model.
- RAG memory search against the existing Qdrant collection.
- Memory writing for explicit record commands and important conversation summaries.
- Member and group profile context.
- Recent conversation context.
- Brave web search.
- Image generation and image editing branch.
- Existing command routes such as chat, record, memory, image, admin/status, and error fallback.

The first version should not delete, migrate, or recreate the existing Qdrant data. Any schema adaptation should happen in the new workflow.

## Architecture

The workflow canvas should be organized as five visual sections with Sticky Notes:

1. **Entry and routing**
   - Receive WhatsApp webhook payloads.
   - Normalize fields such as sender, group, text, message id, timestamp, and media fields.
   - Route high-level intents with Switch nodes.

2. **Agent core**
   - Connect an OpenAI-compatible Chat Model node, preferably configured for DeepSeek.
   - Use a WhatsApp AI Agent node as the main reasoning and response component.
   - Keep persona, privacy, and reply rules in Prompt Template or Set/Edit Fields nodes instead of one large Code node.
   - Use a structured output parser where possible so downstream nodes get predictable fields.

3. **Agent tools**
   - Search Memory tool: query Qdrant for relevant memories.
   - Write Memory tool: store explicit records and selected summaries.
   - Brave Search tool: call Brave through HTTP Request using n8n credentials.
   - Image Tool: generate or edit images through the existing image provider.
   - Memory Status/Admin tool: answer memory/status checks and collection health questions.

4. **Data and memory**
   - Use the current Qdrant collection and schema.
   - Retrieve sender profile, group profile, and recent context.
   - Keep any required compatibility Code node small and isolated.
   - Avoid putting prompt assembly, RAG logic, and tool logic in a single Code node.

5. **Output and errors**
   - Format text and image replies for the WhatsApp bridge.
   - Send replies through HTTP Request.
   - Save recent AI turns for short-term context.
   - Add fallback replies for tool or model failures.

## Node replacement map

| Current area | New design |
| --- | --- |
| `prepare memory` large Code node | Prompt Template, profile retriever, memory search tool, recent context store, small schema formatter if needed |
| `Brave Search` Code node | HTTP Request node with n8n credential and Agent tool description |
| Qdrant request-builder Code nodes | Qdrant vector store/community node where possible, otherwise small HTTP Request templates |
| `parse web search decision` Code node | Agent tool choice plus structured output parser |
| `prepare image binary` Code node | Dedicated image tool output formatter, with a small Code node only if binary conversion is unavoidable |
| `save memory` Code node | Data Store, Qdrant write tool, or small focused persistence node |

## Data flow

1. WhatsApp bridge sends a message to the new workflow webhook.
2. Entry nodes normalize the payload.
3. Switch nodes identify whether the message is a normal chat, record, memory/status, image, or admin request.
4. Normal chat enters the AI Agent.
5. The Agent can call tools for memory search, profile lookup, recent context, Brave Search, or image actions.
6. The Agent returns a structured response.
7. Output nodes format and send the reply through the WhatsApp bridge.
8. The workflow saves the AI turn and any approved memory write.

## Error handling

The workflow should fail softly:

- If Qdrant search fails, continue with a reply that does not claim memory access.
- If Brave Search fails, answer from model knowledge and mention that fresh search was unavailable only when useful.
- If image generation fails, return a short user-facing error instead of exposing provider details.
- If the model fails, return a generic retry message.
- Internal errors should avoid printing secrets, API keys, credential values, or raw local key-file contents.

## Visual design

The n8n canvas should look like a product architecture diagram:

- Main flow runs left to right.
- Tool branches sit below or beside the Agent core.
- Each section has one Sticky Note title.
- Node names use a consistent prefix, such as `Tool: Search Memory` and `Tool: Brave Search`.
- Long diagonal connections should be avoided where practical.
- Existing workflow JSON should remain untouched until implementation begins.

## Implementation constraints

- Create a new n8n workflow/project rather than editing the old workflow in place.
- Before workflow edits, list the n8n JSON paths and node names that will change.
- Do not print secrets or credential values.
- Prefer community or built-in nodes over Code nodes.
- Accept small Code nodes for compatibility, especially existing Qdrant payload shape and image binary formatting.
- Keep the current Qdrant data intact.

## Acceptance criteria

- The new workflow has a clear AI Agent core with visible tools.
- The first version preserves chat, RAG memory, profile context, recent context, Brave Search, image actions, command routes, and fallback behavior.
- The existing Qdrant data remains usable.
- Large multi-purpose Code nodes are removed or split into small focused nodes.
- Credentials are managed by n8n credentials or environment references, not hard-coded in Code nodes.
- The canvas is easy to scan visually and grouped by responsibility.

## Design artifacts

- `docs/n8n-community-redesign-proposal.html`
- `docs/n8n-ai-agent-tools-redesign.html`
