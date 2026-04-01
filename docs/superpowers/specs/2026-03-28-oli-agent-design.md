# Oli Agent — Reactive OLI Team Member

**Date:** 2026-03-28
**Status:** Approved design

## Overview

Oli is a separate OLI bot that responds when `@oli`'d or DM'd. It answers questions about the codebase, company, and issues in a concise, direct style. It runs inside the existing `ai-service/` as a new endpoint alongside Fiona's `/analyze`.

## Decisions

| Decision | Choice | Alternatives considered |
|---|---|---|
| Interaction model | Reactive only (`@oli` / DM) | Proactive+reactive, Fiona rebrand |
| Where it runs | Extend existing `ai-service/` | Separate service, Go plugin direct |
| Bot identity | Separate `oli-agent` bot | Same bot as Fiona, rebrand |
| Codebase access | Local repo clone, read at query time | Embeddings/RAG, curated docs only |
| LLM | GPT-4o-mini | GPT-4o, Claude, configurable |
| Response style | Concise teammate | Thorough explainer, adaptive |

## Permissions

| Domain | Read | Write | Delete |
|---|---|---|---|
| Codebase | Yes | No | No |
| Company info | Yes | Yes | No |
| Issues | Yes | Yes | Yes |

## Architecture

### 1. Bot Registration & Message Routing (Go plugin)

Register a second bot in `OnActivate()`:
- Username: `oli-agent`, display name: "Oli"
- Stored as `p.oliAgentUserID`, separate from existing `oli-bot` (Fiona notifications)

Message routing in `MessageHasBeenPosted`:
- Detect `@oli` mentions: extract question text (strip `@oli` prefix), send to AI service `/chat` endpoint via async goroutine, post response back as `oli-agent` bot user.
- Thread-aware: if the mention is in a thread, reply in that thread. If in main channel, post as new message.
- DMs to `oli-agent` bot also trigger the `/chat` flow.
- Existing Fiona logic (`@fiona` → flush conversation) remains unchanged.

### 2. AI Service — `/chat` Endpoint

New endpoint in `index.ts` alongside existing `/analyze`.

**Request:**
```typescript
{
  message: string;         // user's question (stripped of @oli)
  channel_id: string;      // for channel history context
  username: string;        // who's asking
  callback_url: string;
  internal_secret: string;
  openai_api_key: string;
}
```

**Response:**
```typescript
{
  text: string;            // markdown response text
  code_snippets: Array<{
    file: string;
    lines: string;
    language: string;
    content: string;
  }>;
  issue_refs: Array<{
    id: string;
    identifier: string;
    title: string;
    status: string;
    priority: string;
  }>;
}
```

The `code_snippets` and `issue_refs` are extracted by post-processing tool call results — when the agent uses `read_file`, the file/lines/content are captured; when it uses issue tools, referenced issues are captured.

### 3. Oli Agent (`oli-agent.ts`)

New module alongside `agent.ts`. Uses `generateText()` from Vercel `ai` SDK with GPT-4o-mini.

**System prompt:**
```
You are Oli, a team member in this OLI workspace. You answer questions
about the codebase, company, and issues.

Be concise and direct — like a senior dev responding to a quick ping. Short
answers, code snippets when relevant, file paths with line numbers. Don't
over-explain.

You have access to:
- The codebase (read-only): search files, read code, list directories
- The issue tracker: list, search, create, update, and delete issues
- Company info: read and update company details, mission, state
- Channel history: see recent messages for context

When answering codebase questions, look at the actual code — don't guess.
When managing issues, confirm what you did briefly.
```

- Max steps: 10
- No conversation memory — each `@oli` message is independent. Channel history tool provides recent context if needed.
- Pre-fetched context: none. The LLM decides what to fetch via tools based on the question.

### 4. Oli Tools (`oli-tools.ts`)

**Codebase (read-only):**
- `search_files` — glob pattern search (e.g. `**/*.go`), returns matching file paths relative to repo root. Capped at 50 results.
- `read_file` — read file contents with optional `start_line`/`end_line`. Returns content with line numbers. Capped at 500 lines per read.
- `list_directory` — list entries (files + subdirectories) one level deep, with type indicators.

**Issues (read/write/delete) — reused from existing `tools.ts`:**
- `list_projects`, `list_issues`, `get_issue`, `search_all_issues`
- `create_issue`, `update_issue`, `delete_issue`

**Company (read/write):**
- `get_company_info` — fetch company details, mission, repo info, state
- `update_company_info` — partial update of company info fields

**Context:**
- `get_channel_history` — reused from existing tools

Shared tools are extracted into a `shared-tools.ts` module that exports factory functions (e.g. `createIssueTools(client)`, `createContextTools(client)`). Both `agent.ts` (Fiona) and `oli-agent.ts` (Oli) import from it. Fiona-only tools (none currently) stay in `tools.ts`; Oli-only tools (file tools, company tools) stay in `oli-tools.ts`.

### 5. File Tool Safety

- **Path containment:** All file operations resolve against `REPO_PATH` env var and verify the resolved path starts with `REPO_PATH`. Rejects `../` traversal.
- **Ignored patterns:** `node_modules/`, `.git/`, `dist/`, `release/`, binary files, files over 100KB.
- **Implementation:** Node.js `fs` + `fast-glob`. No shell execution.

### 6. Plugin-Side Go Changes

**New internal API endpoints:**
- `GET /internal/company` — returns `CompanyInfo`
- `PUT /internal/company` — partial merge update of `CompanyInfo`
- Authenticated with existing `X-Internal-Secret` header, registered in `initRouter()`

**New `AIClient` method:**
```go
func (c *AIClient) Chat(req *ChatRequest) (*ChatResponse, error)
```
HTTP POST to `{aiServiceURL}/chat`. Same pattern as existing `Analyze()`.

**New types in `model.go`:**
```go
type ChatRequest struct {
    Message        string `json:"message"`
    ChannelID      string `json:"channel_id"`
    Username       string `json:"username"`
    CallbackURL    string `json:"callback_url"`
    InternalSecret string `json:"internal_secret"`
    OpenAIAPIKey   string `json:"openai_api_key"`
}

type ChatResponse struct {
    Text         string        `json:"text"`
    CodeSnippets []CodeSnippet `json:"code_snippets"`
    IssueRefs    []IssueRef    `json:"issue_refs"`
}

type CodeSnippet struct {
    File     string `json:"file"`
    Lines    string `json:"lines"`
    Language string `json:"language"`
    Content  string `json:"content"`
}

type IssueRef struct {
    ID         string `json:"id"`
    Identifier string `json:"identifier"`
    Title      string `json:"title"`
    Status     string `json:"status"`
    Priority   string `json:"priority"`
}
```

**Post creation** uses custom post type with structured Props:
```go
post := &model.Post{
    UserId:    p.oliAgentUserID,
    ChannelId: channelID,
    Message:   response.Text,  // plain markdown fallback
    Type:      "custom_oli_response",
    Props: map[string]interface{}{
        "oli_data": map[string]interface{}{
            "code_snippets": response.CodeSnippets,
            "issue_refs":    response.IssueRefs,
        },
    },
}
```

### 7. Rich Rendering (Webapp)

Register a custom post type renderer:
```typescript
registry.registerPostTypeComponent('custom_oli_response', OliResponsePost);
```

**`OliResponsePost` component** renders:
1. The markdown text (using OLI's built-in markdown renderer)
2. Embedded code snippet cards
3. Embedded issue mention cards

**Code snippet card:**
- Dark background container (matching OLI's code block theme)
- Header bar with file path as monospace pill, language tag, line range
- Syntax-highlighted code body (OLI's built-in highlight.js)
- Rounded corners, subtle border

**Issue mention card:**
- Compact inline card with OLI icon on the left
- Identifier in bold (e.g. `OLI-12`)
- Status badge using existing `STATUS_COLORS` palette (backlog: #909399, todo: #409EFF, in_progress: #E6A23C, in_review: #9B59B6, done: #67C23A, cancelled: #F56C6C)
- Priority icon using existing `PRIORITY_COLORS`
- Clickable — opens the issue in the RHS panel

Both card types reuse the existing color palette and inline React styling conventions from `issue_card.tsx` and `issue_status_badge.tsx` (same border-radius, opacity patterns, `issues-` CSS prefix).

## Out of Scope

- Conversation memory / multi-turn context (each `@oli` is independent)
- Codebase write access
- Proactive responses (Oli only speaks when spoken to)
- Model switching (GPT-4o-mini only for v1)
- Embeddings or vector search
- Interactive message buttons/modals
