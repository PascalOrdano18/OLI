# Chat UI Redesign — Replace Terminal with Structured Chat

## Overview

Replace the xterm.js terminal-based agent chat with a structured chat UI. Each agent (one per issue) becomes a Claude Code SDK subprocess emitting typed JSON events, rendered as a proper chat interface with user messages, assistant responses, collapsible thinking blocks, tool call summaries, and file change badges.

## Scope

### V1 (this spec)
- User messages, assistant markdown responses
- Collapsible thinking blocks (plain text rows, not boxed)
- Collapsible tool call groups with one-line summaries
- File change badges (inline + cumulative summary)
- Message input with model selector, attach, and thinking toggle
- Multiple concurrent agents (one per issue)
- Replace tmux/node-pty with Claude Code SDK subprocesses
- SSE streaming from backend to frontend

### V2 (future, documented only)
- Session tabs within each issue for multiple conversation threads
- Currently handled by the existing sidebar for issue/agent switching

## Backend Architecture

### Agent Process Management

A singleton `AgentProcessManager` replaces the current tmux-based `sessionManager`.

```
AgentProcessManager (singleton)
  agents: Map<sessionId, AgentProcess>

  spawn(sessionId, config) -> AgentProcess
  kill(sessionId)
  send(sessionId, message)
  getHistory(sessionId) -> AgentEvent[]

  Each AgentProcess:
    - Claude Code SDK subprocess
    - Event buffer (AgentEvent[])
    - SSE subscriber list
    - Status: spawning | active | idle | waiting_input | error
```

Each `AgentProcess` wraps a Claude Code SDK subprocess. Events from the SDK are buffered in memory and broadcast to SSE subscribers. When a client connects, it receives the full history first, then live events.

### API Endpoints

- `GET /api/sessions/[id]/stream` — SSE endpoint, streams structured `AgentEvent`s
- `GET /api/sessions/[id]/history` — returns buffered message history (for reconnects)
- `POST /api/sessions/[id]/message` — adapted to feed user input into SDK subprocess (existing route, new implementation)

### Event Format

Every event from the SDK subprocess is normalized into a typed envelope:

```typescript
type AgentEvent = {
  id: string;
  sessionId: string;
  timestamp: string; // ISO 8601
  type: EventType;
  data: EventData;
}

type EventType =
  | "user_message"
  | "assistant_message"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "file_change"
  | "status"
  | "error";

type UserMessageData = { text: string }
type AssistantMessageData = { text: string } // markdown
type ThinkingData = { text: string }
type ToolUseData = {
  toolName: string;
  summary: string;   // one-line: "Read file: src/App.tsx"
  callId: string;
}
type FileChangeData = {
  path: string;
  additions: number;
  deletions: number;
  action: "created" | "modified" | "deleted";
}
type StatusData = {
  status: "spawning" | "active" | "idle" | "waiting_input" | "error";
}
```

Grouping logic (consecutive tool calls into groups, file change aggregation) lives on the frontend, not the backend. The backend streams flat events.

## Frontend Architecture

### Component Tree

```
<ChatPanel sessionId={id}>
  <MessageList>
    <UserMessage text />
    <AssistantMessage>
      <ThinkingRow text />           // plain text row, chevron to expand/collapse
      <ToolCallGroup calls[] />      // "5 tool calls" summary, chevron expands list
      <FileBadges files[] />         // inline colored pills per file
      <MarkdownContent text />       // rendered markdown response
      <FileChangeSummary files[] />  // bordered summary box at bottom of response
    </AssistantMessage>
    <StreamingIndicator />
  <MessageList>
  <ChatInput>
    textarea (auto-resize)
    <InputToolbar>
      model selector
      attach button
      thinking toggle (configures agent's extended thinking)
    </InputToolbar>
  </ChatInput>
  <MessageMeta duration model />
</ChatPanel>
```

### Custom Hooks

- `useAgentStream(sessionId)` — connects to SSE endpoint, returns `events[]` and `status`. Handles reconnection and history replay.
- `useMessageGroups(events)` — transforms flat event array into renderable message blocks. Groups consecutive `tool_use` events into `ToolCallGroup`s, aggregates `file_change` events into summaries.
- `useAgentControl(sessionId)` — exposes `sendMessage()`, `stopAgent()`, `toggleThinking()`.

### State Flow

SSE events -> event buffer -> useMessageGroups transforms into message blocks -> React renders components

### Visual Design

Light/clear palette. No dark theme in v1.

- **User messages**: right-aligned bubbles with accent color background, white text
- **Assistant messages**: left-aligned, no bubble, plain text with "CLAUDE" label above
- **Thinking blocks**: plain text row with chevron + "Thinking" label + truncated preview. Expands inline to show full italic text. No border/box.
- **Tool call groups**: plain text row with chevron + "N tool calls" label. Expands to show list of tool items (checkmark + tool name in mono + one-line summary). No border/box.
- **File badges**: pills with border, mono font, filename + green additions + red deletions
- **File change summary**: bordered card at bottom of response with "Files changed" header, all file badges, and total +/- count
- **Input area**: bordered textarea with toolbar below (model selector, attach, thinking toggle, send button). Accent glow on focus.
- **Streaming indicator**: animated dots + "Working..." text
- **Message meta**: duration (mono) + model tag (subtle background pill)

Reference mockup: `.context/chat-mockup.html`

## Integration with Existing App

### Removed
- xterm.js terminal renderer and dependencies
- tmux/node-pty session management
- Raw terminal output parsing

### Preserved
- Session/issue model (one agent per issue)
- Sidebar/navigation for issue switching
- API route structure (`/api/sessions/[id]/*`)

### Changed
- Main content area: `<Terminal>` replaced by `<ChatPanel>`
- Session creation: spawns Claude Code SDK subprocess instead of tmux session
- Streaming transport: WebSocket replaced by SSE

### Migration
Build chat UI alongside terminal, switchable via feature flag. Once stable, remove terminal code.

## Thinking Toggle

The "Thinking" toggle in the input toolbar is a **configuration control** for the agent — it enables/disables extended thinking on the Claude Code SDK subprocess. When thinking is enabled, thinking content appears inline as collapsible `ThinkingRow` blocks in the message flow.

## Tool Call Detail Level

Expanded tool call groups show one-line summaries only:
- Tool name (e.g., `Read`, `Edit`, `Bash`)
- One-line description (e.g., "src/components/App.tsx")
- Completion checkmark

No input/output details, no duration per tool call.

## File Change Badges

Displayed in two locations:
1. **Inline** within the assistant message, near the tool calls that produced them
2. **Cumulative summary** at the bottom of the assistant response, showing all files changed with total +/- counts
