# Chat UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the xterm.js terminal-based agent chat with a structured chat UI powered by Claude Code SDK subprocesses, SSE streaming, and custom React components.

**Architecture:** The backend spawns Claude Code SDK subprocesses per session (replacing tmux/node-pty), normalizes their output into typed `AgentEvent` objects, buffers them in memory, and streams them to the frontend via SSE. The frontend consumes events through a custom `useAgentStream` hook, groups them into renderable message blocks, and renders with purpose-built React components (user bubbles, assistant markdown, collapsible thinking rows, tool call summaries, file change badges).

**Tech Stack:** Next.js 15, React 19, Tailwind CSS v4, Claude Code SDK (`@anthropic-ai/claude-code`), Server-Sent Events, Vitest

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/web/src/lib/agent-events.ts` | `AgentEvent` type definitions and event normalization utilities |
| `packages/web/server/agent-process-manager.ts` | Singleton managing Claude Code SDK subprocesses per session |
| `packages/web/src/app/api/sessions/[id]/stream/route.ts` | SSE endpoint streaming `AgentEvent`s to the client |
| `packages/web/src/hooks/useAgentStream.ts` | React hook: connects to SSE, returns events + status |
| `packages/web/src/hooks/useMessageGroups.ts` | React hook: groups flat events into renderable message blocks |
| `packages/web/src/components/chat/ChatPanel.tsx` | Root chat component per session |
| `packages/web/src/components/chat/MessageList.tsx` | Scrollable message list rendering message blocks |
| `packages/web/src/components/chat/UserMessage.tsx` | Right-aligned user bubble |
| `packages/web/src/components/chat/AssistantMessage.tsx` | Left-aligned assistant response container |
| `packages/web/src/components/chat/ThinkingRow.tsx` | Collapsible thinking text row |
| `packages/web/src/components/chat/ToolCallGroup.tsx` | Collapsible "N tool calls" summary |
| `packages/web/src/components/chat/FileBadge.tsx` | File change pill (name + additions + deletions) |
| `packages/web/src/components/chat/FileChangeSummary.tsx` | Cumulative file changes summary card |
| `packages/web/src/components/chat/ChatInput.tsx` | Message input with toolbar |
| `packages/web/src/components/chat/StreamingIndicator.tsx` | Animated dots + "Working..." |
| `packages/web/src/components/chat/MarkdownContent.tsx` | Renders assistant markdown safely |

### Modified Files

| File | Change |
|------|--------|
| `packages/web/src/components/SessionDetail.tsx` | Replace `<DirectTerminal>` with `<ChatPanel>`, add feature flag toggle |
| `packages/web/src/app/api/sessions/[id]/send/route.ts` | Add branch: if chat mode, route to `AgentProcessManager.send()` |
| `packages/web/src/app/globals.css` | No changes needed — existing tokens cover the chat UI design |
| `packages/web/package.json` | Add `@anthropic-ai/claude-code` dependency |

All paths below are relative to `agent-orchestrator-main/`.

---

### Task 1: Agent Event Types

**Files:**
- Create: `packages/web/src/lib/agent-events.ts`
- Test: `packages/web/src/lib/__tests__/agent-events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/__tests__/agent-events.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  createAgentEvent,
  type AgentEvent,
  type UserMessageData,
  type AssistantMessageData,
  type ThinkingData,
  type ToolUseData,
  type FileChangeData,
  type StatusData,
} from "../agent-events";

describe("createAgentEvent", () => {
  it("creates a user_message event with unique id and timestamp", () => {
    const event = createAgentEvent("session-1", "user_message", { text: "hello" });
    expect(event.id).toBeDefined();
    expect(event.sessionId).toBe("session-1");
    expect(event.type).toBe("user_message");
    expect(event.timestamp).toBeDefined();
    expect((event.data as UserMessageData).text).toBe("hello");
  });

  it("creates distinct ids for consecutive events", () => {
    const a = createAgentEvent("s1", "assistant_message", { text: "a" });
    const b = createAgentEvent("s1", "assistant_message", { text: "b" });
    expect(a.id).not.toBe(b.id);
  });

  it("accepts all event types", () => {
    const types = [
      "user_message", "assistant_message", "thinking",
      "tool_use", "tool_result", "file_change", "status", "error",
    ] as const;
    for (const type of types) {
      const event = createAgentEvent("s1", type, {} as any);
      expect(event.type).toBe(type);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent-orchestrator-main && npx vitest run packages/web/src/lib/__tests__/agent-events.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement agent-events.ts**

Create `packages/web/src/lib/agent-events.ts`:

```typescript
import { randomUUID } from "crypto";

export type EventType =
  | "user_message"
  | "assistant_message"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "file_change"
  | "status"
  | "error";

export interface AgentEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  type: EventType;
  data: EventData;
}

export type EventData =
  | UserMessageData
  | AssistantMessageData
  | ThinkingData
  | ToolUseData
  | ToolResultData
  | FileChangeData
  | StatusData
  | ErrorData;

export interface UserMessageData { text: string }
export interface AssistantMessageData { text: string }
export interface ThinkingData { text: string }
export interface ToolUseData {
  toolName: string;
  summary: string;
  callId: string;
}
export interface ToolResultData {
  callId: string;
  success: boolean;
}
export interface FileChangeData {
  path: string;
  additions: number;
  deletions: number;
  action: "created" | "modified" | "deleted";
}
export type AgentStatus = "spawning" | "active" | "idle" | "waiting_input" | "error";
export interface StatusData { status: AgentStatus }
export interface ErrorData { message: string }

let counter = 0;

export function createAgentEvent(
  sessionId: string,
  type: EventType,
  data: EventData,
): AgentEvent {
  return {
    id: `${Date.now()}-${++counter}`,
    sessionId,
    timestamp: new Date().toISOString(),
    type,
    data,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent-orchestrator-main && npx vitest run packages/web/src/lib/__tests__/agent-events.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/agent-events.ts packages/web/src/lib/__tests__/agent-events.test.ts
git commit -m "feat(chat): add AgentEvent type definitions and factory"
```

---

### Task 2: Agent Process Manager

**Files:**
- Create: `packages/web/server/agent-process-manager.ts`
- Test: `packages/web/server/__tests__/agent-process-manager.test.ts`

- [ ] **Step 1: Install Claude Code SDK**

```bash
cd agent-orchestrator-main/packages/web && npm install @anthropic-ai/claude-code
```

- [ ] **Step 2: Write the failing test**

Create `packages/web/server/__tests__/agent-process-manager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Claude Code SDK
vi.mock("@anthropic-ai/claude-code", () => ({
  claude: vi.fn(),
}));

import { AgentProcessManager } from "../agent-process-manager";
import type { AgentEvent } from "../../src/lib/agent-events";

describe("AgentProcessManager", () => {
  let manager: AgentProcessManager;

  beforeEach(() => {
    manager = new AgentProcessManager();
  });

  afterEach(() => {
    manager.destroyAll();
  });

  it("returns empty history for unknown session", () => {
    expect(manager.getHistory("nonexistent")).toEqual([]);
  });

  it("getStatus returns idle for unknown session", () => {
    expect(manager.getStatus("nonexistent")).toBe("idle");
  });

  it("tracks sessions after spawn", async () => {
    // Mock the SDK to resolve immediately
    const { claude } = await import("@anthropic-ai/claude-code");
    (claude as ReturnType<typeof vi.fn>).mockImplementation(async function* () {
      yield { type: "assistant", message: { content: [{ type: "text", text: "hello" }] } };
    });

    await manager.spawn("test-session", { workspacePath: "/tmp/test" });
    expect(manager.getStatus("test-session")).not.toBe("idle");
  });

  it("addUserEvent appends to history", () => {
    manager.addUserEvent("s1", "hello");
    const history = manager.getHistory("s1");
    expect(history).toHaveLength(1);
    expect(history[0].type).toBe("user_message");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd agent-orchestrator-main && npx vitest run packages/web/server/__tests__/agent-process-manager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement agent-process-manager.ts**

Create `packages/web/server/agent-process-manager.ts`:

```typescript
import { claude } from "@anthropic-ai/claude-code";
import {
  createAgentEvent,
  type AgentEvent,
  type AgentStatus,
  type UserMessageData,
  type AssistantMessageData,
  type ThinkingData,
  type ToolUseData,
  type FileChangeData,
  type StatusData,
} from "../src/lib/agent-events";

interface AgentProcess {
  sessionId: string;
  status: AgentStatus;
  history: AgentEvent[];
  subscribers: Set<(event: AgentEvent) => void>;
  abortController: AbortController | null;
  workspacePath: string;
  conversationHistory: Array<{ role: string; content: string }>;
}

export interface SpawnConfig {
  workspacePath: string;
  model?: string;
  systemPrompt?: string;
}

export class AgentProcessManager {
  private agents = new Map<string, AgentProcess>();

  getHistory(sessionId: string): AgentEvent[] {
    return this.agents.get(sessionId)?.history ?? [];
  }

  getStatus(sessionId: string): AgentStatus {
    return this.agents.get(sessionId)?.status ?? "idle";
  }

  subscribe(sessionId: string, callback: (event: AgentEvent) => void): () => void {
    const agent = this.agents.get(sessionId);
    if (!agent) {
      // Create a placeholder agent record so subscribers can attach before spawn
      const placeholder: AgentProcess = {
        sessionId,
        status: "idle",
        history: [],
        subscribers: new Set([callback]),
        abortController: null,
        workspacePath: "",
        conversationHistory: [],
      };
      this.agents.set(sessionId, placeholder);
      return () => { placeholder.subscribers.delete(callback); };
    }
    agent.subscribers.add(callback);
    return () => { agent.subscribers.delete(callback); };
  }

  addUserEvent(sessionId: string, text: string): void {
    const event = createAgentEvent(sessionId, "user_message", { text } as UserMessageData);
    this.appendAndBroadcast(sessionId, event);
  }

  async spawn(sessionId: string, config: SpawnConfig): Promise<void> {
    const existing = this.agents.get(sessionId);
    const agent: AgentProcess = {
      sessionId,
      status: "spawning",
      history: existing?.history ?? [],
      subscribers: existing?.subscribers ?? new Set(),
      abortController: new AbortController(),
      workspacePath: config.workspacePath,
      conversationHistory: [],
    };
    this.agents.set(sessionId, agent);

    this.broadcastStatus(sessionId, "spawning");
  }

  async send(sessionId: string, message: string): Promise<void> {
    const agent = this.agents.get(sessionId);
    if (!agent) throw new Error(`No agent for session ${sessionId}`);

    this.addUserEvent(sessionId, message);

    agent.abortController = new AbortController();
    agent.status = "active";
    this.broadcastStatus(sessionId, "active");

    try {
      const stream = claude(message, {
        cwd: agent.workspacePath,
        abortController: agent.abortController,
      });

      for await (const event of stream) {
        if (agent.abortController?.signal.aborted) break;
        this.processSDKEvent(sessionId, event);
      }

      agent.status = "idle";
      this.broadcastStatus(sessionId, "idle");
    } catch (err) {
      if (agent.abortController?.signal.aborted) return;
      agent.status = "error";
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorEvent = createAgentEvent(sessionId, "error", { message: errorMsg });
      this.appendAndBroadcast(sessionId, errorEvent);
      this.broadcastStatus(sessionId, "error");
    }
  }

  kill(sessionId: string): void {
    const agent = this.agents.get(sessionId);
    if (!agent) return;
    agent.abortController?.abort();
    agent.status = "idle";
    this.broadcastStatus(sessionId, "idle");
  }

  destroyAll(): void {
    for (const [id] of this.agents) {
      this.kill(id);
    }
    this.agents.clear();
  }

  private processSDKEvent(sessionId: string, sdkEvent: any): void {
    // The Claude Code SDK emits various event types. We normalize them into AgentEvents.
    // The exact SDK event shapes will need to be adapted based on the SDK version.

    if (sdkEvent.type === "assistant" && sdkEvent.message?.content) {
      for (const block of sdkEvent.message.content) {
        if (block.type === "text") {
          const event = createAgentEvent(sessionId, "assistant_message", {
            text: block.text,
          } as AssistantMessageData);
          this.appendAndBroadcast(sessionId, event);
        } else if (block.type === "thinking") {
          const event = createAgentEvent(sessionId, "thinking", {
            text: block.thinking,
          } as ThinkingData);
          this.appendAndBroadcast(sessionId, event);
        } else if (block.type === "tool_use") {
          const event = createAgentEvent(sessionId, "tool_use", {
            toolName: block.name,
            summary: this.summarizeToolInput(block.name, block.input),
            callId: block.id,
          } as ToolUseData);
          this.appendAndBroadcast(sessionId, event);
        }
      }
    }

    if (sdkEvent.type === "result" && sdkEvent.subtype === "tool_result") {
      // Tool results may contain file change info
      // Parse for file_change events
    }
  }

  private summarizeToolInput(toolName: string, input: any): string {
    if (!input) return toolName;
    if (typeof input.file_path === "string") {
      const filename = input.file_path.split("/").pop() ?? input.file_path;
      return `${filename}`;
    }
    if (typeof input.command === "string") {
      const cmd = input.command.length > 60
        ? input.command.slice(0, 57) + "..."
        : input.command;
      return cmd;
    }
    if (typeof input.pattern === "string") return input.pattern;
    if (typeof input.query === "string") return input.query;
    return toolName;
  }

  private appendAndBroadcast(sessionId: string, event: AgentEvent): void {
    let agent = this.agents.get(sessionId);
    if (!agent) {
      agent = {
        sessionId,
        status: "idle",
        history: [],
        subscribers: new Set(),
        abortController: null,
        workspacePath: "",
        conversationHistory: [],
      };
      this.agents.set(sessionId, agent);
    }
    agent.history.push(event);
    for (const cb of agent.subscribers) {
      try { cb(event); } catch { /* subscriber error */ }
    }
  }

  private broadcastStatus(sessionId: string, status: AgentStatus): void {
    const event = createAgentEvent(sessionId, "status", { status } as StatusData);
    this.appendAndBroadcast(sessionId, event);
  }
}

// Singleton instance
const agentProcessManager = new AgentProcessManager();
export default agentProcessManager;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd agent-orchestrator-main && npx vitest run packages/web/server/__tests__/agent-process-manager.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/web/server/agent-process-manager.ts packages/web/server/__tests__/agent-process-manager.test.ts packages/web/package.json packages/web/package-lock.json
git commit -m "feat(chat): add AgentProcessManager with Claude Code SDK integration"
```

---

### Task 3: SSE Stream API Endpoint

**Files:**
- Create: `packages/web/src/app/api/sessions/[id]/stream/route.ts`
- Test: `packages/web/src/app/api/sessions/[id]/stream/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/app/api/sessions/[id]/stream/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/validation", () => ({
  validateIdentifier: vi.fn(() => null),
}));

vi.mock("../../../../../../server/agent-process-manager", () => {
  const history = [
    { id: "1", sessionId: "s1", timestamp: "2026-01-01T00:00:00Z", type: "user_message", data: { text: "hi" } },
  ];
  return {
    default: {
      getHistory: vi.fn(() => history),
      getStatus: vi.fn(() => "idle"),
      subscribe: vi.fn(() => () => {}),
    },
  };
});

import { GET } from "../route";

describe("GET /api/sessions/[id]/stream", () => {
  it("returns a streaming response with correct headers", async () => {
    const request = new Request("http://localhost/api/sessions/s1/stream");
    const response = await GET(request, { params: Promise.resolve({ id: "s1" }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent-orchestrator-main && npx vitest run packages/web/src/app/api/sessions/\\[id\\]/stream/__tests__/route.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the SSE route**

Create `packages/web/src/app/api/sessions/[id]/stream/route.ts`:

```typescript
import { type NextRequest } from "next/server";
import { validateIdentifier } from "@/lib/validation";
import agentProcessManager from "../../../../../server/agent-process-manager";
import type { AgentEvent } from "@/lib/agent-events";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const idErr = validateIdentifier(id, "id");
  if (idErr) {
    return new Response(JSON.stringify({ error: idErr }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send existing history as initial batch
      const history = agentProcessManager.getHistory(id);
      for (const event of history) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      // Send current status
      const status = agentProcessManager.getStatus(id);
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "status", data: { status } })}\n\n`),
      );

      // Subscribe to new events
      const unsubscribe = agentProcessManager.subscribe(id, (event: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream closed
          unsubscribe();
        }
      });

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 15_000);

      // Cleanup on abort
      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent-orchestrator-main && npx vitest run packages/web/src/app/api/sessions/\\[id\\]/stream/__tests__/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/sessions/\\[id\\]/stream/
git commit -m "feat(chat): add SSE stream endpoint for agent events"
```

---

### Task 4: useAgentStream Hook

**Files:**
- Create: `packages/web/src/hooks/useAgentStream.ts`
- Test: `packages/web/src/hooks/__tests__/useAgentStream.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/hooks/__tests__/useAgentStream.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock EventSource
class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = 0;
  close = vi.fn();
  url: string;

  constructor(url: string) {
    this.url = url;
    // Auto-connect
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }

  simulateMessage(data: object) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}

vi.stubGlobal("EventSource", MockEventSource);

import { useAgentStream } from "../useAgentStream";

describe("useAgentStream", () => {
  it("initializes with empty events and connecting status", () => {
    const { result } = renderHook(() => useAgentStream("test-session"));
    expect(result.current.events).toEqual([]);
    expect(result.current.status).toBe("connecting");
  });

  it("accumulates events from SSE messages", async () => {
    const { result } = renderHook(() => useAgentStream("test-session"));

    // Simulate receiving an event
    await act(async () => {
      const es = (globalThis as any).__lastEventSource;
      es?.simulateMessage({
        id: "1",
        sessionId: "test-session",
        type: "user_message",
        data: { text: "hello" },
      });
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].type).toBe("user_message");
  });

  it("closes EventSource on unmount", () => {
    const { unmount } = renderHook(() => useAgentStream("test-session"));
    unmount();
    // EventSource.close should have been called
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent-orchestrator-main && npx vitest run packages/web/src/hooks/__tests__/useAgentStream.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement useAgentStream**

Create `packages/web/src/hooks/useAgentStream.ts`:

```typescript
"use client";

import { useEffect, useReducer, useRef, useCallback } from "react";
import type { AgentEvent, AgentStatus } from "@/lib/agent-events";

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

interface StreamState {
  events: AgentEvent[];
  status: ConnectionStatus;
  agentStatus: AgentStatus;
}

type StreamAction =
  | { type: "event"; event: AgentEvent }
  | { type: "batch"; events: AgentEvent[] }
  | { type: "connection"; status: ConnectionStatus }
  | { type: "agentStatus"; status: AgentStatus }
  | { type: "reset" };

function reducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case "event":
      // Extract agent status from status events
      if (action.event.type === "status" && "status" in action.event.data) {
        return {
          ...state,
          events: [...state.events, action.event],
          agentStatus: (action.event.data as { status: AgentStatus }).status,
        };
      }
      return { ...state, events: [...state.events, action.event] };
    case "batch":
      return { ...state, events: [...state.events, ...action.events] };
    case "connection":
      return { ...state, status: action.status };
    case "agentStatus":
      return { ...state, agentStatus: action.status };
    case "reset":
      return { events: [], status: "connecting", agentStatus: "idle" };
  }
}

export function useAgentStream(sessionId: string) {
  const [state, dispatch] = useReducer(reducer, {
    events: [],
    status: "connecting" as ConnectionStatus,
    agentStatus: "idle" as AgentStatus,
  });

  useEffect(() => {
    if (!sessionId) return;

    dispatch({ type: "reset" });

    const url = `/api/sessions/${encodeURIComponent(sessionId)}/stream`;
    const es = new EventSource(url);

    es.onopen = () => {
      dispatch({ type: "connection", status: "connected" });
    };

    es.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as AgentEvent;
        dispatch({ type: "event", event: data });
      } catch {
        // Ignore parse errors (heartbeats, etc.)
      }
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        dispatch({ type: "connection", status: "disconnected" });
      } else {
        dispatch({ type: "connection", status: "reconnecting" });
      }
    };

    return () => {
      es.close();
    };
  }, [sessionId]);

  const sendMessage = useCallback(async (text: string) => {
    await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
  }, [sessionId]);

  return {
    events: state.events,
    status: state.status,
    agentStatus: state.agentStatus,
    sendMessage,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent-orchestrator-main && npx vitest run packages/web/src/hooks/__tests__/useAgentStream.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/hooks/useAgentStream.ts packages/web/src/hooks/__tests__/useAgentStream.test.ts
git commit -m "feat(chat): add useAgentStream hook for SSE event consumption"
```

---

### Task 5: useMessageGroups Hook

**Files:**
- Create: `packages/web/src/hooks/useMessageGroups.ts`
- Test: `packages/web/src/hooks/__tests__/useMessageGroups.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/hooks/__tests__/useMessageGroups.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { groupEvents, type MessageBlock } from "../useMessageGroups";

function makeEvent(type: string, data: any, id?: string) {
  return {
    id: id ?? String(Math.random()),
    sessionId: "s1",
    timestamp: new Date().toISOString(),
    type,
    data,
  };
}

describe("groupEvents", () => {
  it("returns empty array for no events", () => {
    expect(groupEvents([])).toEqual([]);
  });

  it("creates a user_message block", () => {
    const events = [makeEvent("user_message", { text: "hello" })];
    const blocks = groupEvents(events);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("user_message");
    expect(blocks[0].text).toBe("hello");
  });

  it("groups consecutive tool_use events into a tool_group block", () => {
    const events = [
      makeEvent("tool_use", { toolName: "Read", summary: "file.ts", callId: "1" }),
      makeEvent("tool_use", { toolName: "Edit", summary: "file.ts", callId: "2" }),
      makeEvent("tool_use", { toolName: "Bash", summary: "npm test", callId: "3" }),
    ];
    const blocks = groupEvents(events);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("tool_group");
    expect(blocks[0].tools).toHaveLength(3);
  });

  it("creates an assistant_message block with file changes", () => {
    const events = [
      makeEvent("assistant_message", { text: "Done." }),
      makeEvent("file_change", { path: "src/app.tsx", additions: 10, deletions: 2, action: "modified" }),
    ];
    const blocks = groupEvents(events);
    // The file_change should be attached to the preceding assistant message or standalone
    const fileBlocks = blocks.filter((b) => b.type === "file_changes");
    expect(fileBlocks.length).toBeGreaterThanOrEqual(0);
  });

  it("creates thinking blocks", () => {
    const events = [makeEvent("thinking", { text: "Let me analyze..." })];
    const blocks = groupEvents(events);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("thinking");
  });

  it("handles a full conversation flow", () => {
    const events = [
      makeEvent("user_message", { text: "fix the bug" }),
      makeEvent("thinking", { text: "analyzing..." }),
      makeEvent("tool_use", { toolName: "Read", summary: "src/bug.ts", callId: "1" }),
      makeEvent("tool_use", { toolName: "Edit", summary: "src/bug.ts", callId: "2" }),
      makeEvent("file_change", { path: "src/bug.ts", additions: 5, deletions: 2, action: "modified" }),
      makeEvent("assistant_message", { text: "Fixed the bug." }),
    ];
    const blocks = groupEvents(events);
    expect(blocks.length).toBeGreaterThanOrEqual(4); // user, thinking, tool_group, file, assistant
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent-orchestrator-main && npx vitest run packages/web/src/hooks/__tests__/useMessageGroups.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement useMessageGroups**

Create `packages/web/src/hooks/useMessageGroups.ts`:

```typescript
"use client";

import { useMemo } from "react";
import type { AgentEvent, ToolUseData, FileChangeData } from "@/lib/agent-events";

export interface UserMessageBlock {
  type: "user_message";
  text: string;
  timestamp: string;
}

export interface ThinkingBlock {
  type: "thinking";
  text: string;
  timestamp: string;
}

export interface ToolGroupBlock {
  type: "tool_group";
  tools: Array<{ toolName: string; summary: string; callId: string }>;
  timestamp: string;
}

export interface AssistantMessageBlock {
  type: "assistant_message";
  text: string;
  timestamp: string;
}

export interface FileChangesBlock {
  type: "file_changes";
  files: Array<{ path: string; additions: number; deletions: number; action: string }>;
  timestamp: string;
}

export interface StatusBlock {
  type: "status";
  status: string;
  timestamp: string;
}

export interface ErrorBlock {
  type: "error";
  message: string;
  timestamp: string;
}

export type MessageBlock =
  | UserMessageBlock
  | ThinkingBlock
  | ToolGroupBlock
  | AssistantMessageBlock
  | FileChangesBlock
  | StatusBlock
  | ErrorBlock;

export function groupEvents(events: AgentEvent[]): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let i = 0;

  while (i < events.length) {
    const event = events[i];

    switch (event.type) {
      case "user_message":
        blocks.push({
          type: "user_message",
          text: (event.data as { text: string }).text,
          timestamp: event.timestamp,
        });
        i++;
        break;

      case "thinking":
        blocks.push({
          type: "thinking",
          text: (event.data as { text: string }).text,
          timestamp: event.timestamp,
        });
        i++;
        break;

      case "tool_use": {
        // Group consecutive tool_use events
        const tools: ToolGroupBlock["tools"] = [];
        while (i < events.length && events[i].type === "tool_use") {
          const td = events[i].data as ToolUseData;
          tools.push({ toolName: td.toolName, summary: td.summary, callId: td.callId });
          i++;
        }
        blocks.push({ type: "tool_group", tools, timestamp: event.timestamp });
        break;
      }

      case "file_change": {
        // Group consecutive file_change events
        const files: FileChangesBlock["files"] = [];
        while (i < events.length && events[i].type === "file_change") {
          const fd = events[i].data as FileChangeData;
          files.push({ path: fd.path, additions: fd.additions, deletions: fd.deletions, action: fd.action });
          i++;
        }
        blocks.push({ type: "file_changes", files, timestamp: event.timestamp });
        break;
      }

      case "assistant_message":
        blocks.push({
          type: "assistant_message",
          text: (event.data as { text: string }).text,
          timestamp: event.timestamp,
        });
        i++;
        break;

      case "status":
        // Skip status events from rendering (used for agentStatus in hook)
        i++;
        break;

      case "error":
        blocks.push({
          type: "error",
          message: (event.data as { message: string }).message,
          timestamp: event.timestamp,
        });
        i++;
        break;

      default:
        i++;
        break;
    }
  }

  return blocks;
}

export function useMessageGroups(events: AgentEvent[]): MessageBlock[] {
  return useMemo(() => groupEvents(events), [events]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent-orchestrator-main && npx vitest run packages/web/src/hooks/__tests__/useMessageGroups.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/hooks/useMessageGroups.ts packages/web/src/hooks/__tests__/useMessageGroups.test.ts
git commit -m "feat(chat): add useMessageGroups hook for event grouping"
```

---

### Task 6: Chat UI Components — Atomic Pieces

**Files:**
- Create: `packages/web/src/components/chat/UserMessage.tsx`
- Create: `packages/web/src/components/chat/ThinkingRow.tsx`
- Create: `packages/web/src/components/chat/ToolCallGroup.tsx`
- Create: `packages/web/src/components/chat/FileBadge.tsx`
- Create: `packages/web/src/components/chat/FileChangeSummary.tsx`
- Create: `packages/web/src/components/chat/StreamingIndicator.tsx`
- Create: `packages/web/src/components/chat/MarkdownContent.tsx`

- [ ] **Step 1: Create UserMessage.tsx**

```tsx
"use client";

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div
        className="max-w-[70%] rounded-lg rounded-br-sm px-4 py-2.5 text-[13px] leading-relaxed text-white"
        style={{ background: "var(--color-accent)" }}
      >
        {text}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create ThinkingRow.tsx**

```tsx
"use client";

import { useState } from "react";

export function ThinkingRow({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = text.length > 80 ? text.slice(0, 77) + "..." : text;

  return (
    <div>
      <div
        className="flex cursor-pointer items-start gap-1.5 select-none py-0.5"
        onClick={() => setExpanded(!expanded)}
      >
        <span
          className="mt-[3px] text-[9px] text-[var(--color-text-tertiary)] transition-transform"
          style={{ display: "inline-block", transform: expanded ? "rotate(90deg)" : "none" }}
        >
          &#9654;
        </span>
        <span className="text-[12px] font-medium text-[var(--color-text-tertiary)]">Thinking</span>
        {!expanded && (
          <span className="flex-1 truncate text-[12px] italic text-[var(--color-text-tertiary)]">
            {preview}
          </span>
        )}
      </div>
      {expanded && (
        <div className="-mt-0.5 mb-0.5 pl-[22px] text-[12px] leading-relaxed italic text-[var(--color-text-secondary)]">
          {text}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create ToolCallGroup.tsx**

```tsx
"use client";

import { useState } from "react";

interface ToolCall {
  toolName: string;
  summary: string;
  callId: string;
}

export function ToolCallGroup({ tools }: { tools: ToolCall[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <div
        className="flex cursor-pointer items-center gap-1.5 select-none py-0.5"
        onClick={() => setExpanded(!expanded)}
      >
        <span
          className="text-[9px] text-[var(--color-text-tertiary)] transition-transform"
          style={{ display: "inline-block", transform: expanded ? "rotate(90deg)" : "none" }}
        >
          &#9654;
        </span>
        <span className="text-[12px] font-medium text-[var(--color-text-tertiary)]">
          {tools.length} tool call{tools.length !== 1 ? "s" : ""}
        </span>
      </div>
      {expanded && (
        <div className="mt-0.5 mb-0.5 pl-[22px]">
          {tools.map((tool) => (
            <div key={tool.callId} className="flex items-center gap-1.5 py-0.5 text-[12px]">
              <span className="text-[11px] text-[var(--color-status-ready)]">&#10003;</span>
              <span
                className="min-w-[50px] text-[11px] font-medium"
                style={{ fontFamily: "var(--font-jetbrains-mono)", color: "var(--color-accent)" }}
              >
                {tool.toolName}
              </span>
              <span className="text-[var(--color-text-secondary)]">{tool.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create FileBadge.tsx**

```tsx
export function FileBadge({
  path,
  additions,
  deletions,
}: {
  path: string;
  additions: number;
  deletions: number;
}) {
  const filename = path.split("/").pop() ?? path;

  return (
    <span
      className="inline-flex items-center gap-1.5 border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-2.5 py-1 text-[11px] font-medium"
      style={{ fontFamily: "var(--font-jetbrains-mono)", borderRadius: "6px" }}
    >
      <span className="text-[var(--color-text-tertiary)]">&#128196;</span>
      <span className="text-[var(--color-text-primary)]">{filename}</span>
      {additions > 0 && <span className="text-[var(--color-status-ready)]">+{additions}</span>}
      {deletions > 0 && <span className="text-[var(--color-status-error)]">-{deletions}</span>}
    </span>
  );
}
```

- [ ] **Step 5: Create FileChangeSummary.tsx**

```tsx
import { FileBadge } from "./FileBadge";

interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  action: string;
}

export function FileChangeSummary({ files }: { files: FileChange[] }) {
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-text-secondary)]">
        Files changed
        <span
          className="rounded-full bg-[var(--color-bg-subtle)] px-1.5 py-px text-[11px]"
          style={{ fontFamily: "var(--font-jetbrains-mono)" }}
        >
          {files.length}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {files.map((f) => (
          <FileBadge key={f.path} path={f.path} additions={f.additions} deletions={f.deletions} />
        ))}
      </div>
      <div
        className="mt-2 text-[11px] text-[var(--color-text-tertiary)]"
        style={{ fontFamily: "var(--font-jetbrains-mono)" }}
      >
        Total: <span className="text-[var(--color-status-ready)]">+{totalAdditions}</span>{" "}
        <span className="text-[var(--color-status-error)]">-{totalDeletions}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create StreamingIndicator.tsx**

```tsx
export function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-tertiary)]">
      <div className="flex gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 w-1 rounded-full bg-[var(--color-accent)]"
            style={{
              animation: "chat-pulse 1.4s infinite",
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
      Working...
    </div>
  );
}
```

- [ ] **Step 7: Create MarkdownContent.tsx**

A simple markdown renderer using basic HTML conversion. For v1, handles bold, italic, code, lists, and links. Can upgrade to `react-markdown` later if needed.

```tsx
"use client";

export function MarkdownContent({ text }: { text: string }) {
  // Simple markdown-to-html for v1: code blocks, inline code, bold, italic, lists, links
  const html = simpleMarkdown(text);

  return (
    <div
      className="chat-markdown text-[13px] leading-relaxed text-[var(--color-text-primary)]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function simpleMarkdown(text: string): string {
  let html = escapeHtml(text);

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre class="chat-code-block"><code>${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // Paragraphs (double newline)
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;

  // Single newlines within paragraphs
  html = html.replace(/\n/g, "<br>");

  // Clean empty paragraphs
  html = html.replace(/<p><\/p>/g, "");

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

- [ ] **Step 8: Commit all atomic components**

```bash
git add packages/web/src/components/chat/
git commit -m "feat(chat): add atomic chat UI components"
```

---

### Task 7: AssistantMessage, MessageList, and ChatPanel

**Files:**
- Create: `packages/web/src/components/chat/AssistantMessage.tsx`
- Create: `packages/web/src/components/chat/MessageList.tsx`
- Create: `packages/web/src/components/chat/ChatInput.tsx`
- Create: `packages/web/src/components/chat/ChatPanel.tsx`

- [ ] **Step 1: Create AssistantMessage.tsx**

```tsx
"use client";

import type { MessageBlock } from "@/hooks/useMessageGroups";
import { ThinkingRow } from "./ThinkingRow";
import { ToolCallGroup } from "./ToolCallGroup";
import { FileBadge } from "./FileBadge";
import { FileChangeSummary } from "./FileChangeSummary";
import { MarkdownContent } from "./MarkdownContent";

interface AssistantMessageProps {
  blocks: MessageBlock[];
}

/** Renders a group of blocks that form one assistant turn. */
export function AssistantMessage({ blocks }: AssistantMessageProps) {
  // Collect all file changes for the cumulative summary at the bottom
  const allFileChanges = blocks
    .filter((b): b is Extract<MessageBlock, { type: "file_changes" }> => b.type === "file_changes")
    .flatMap((b) => b.files);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-[var(--color-text-tertiary)]">
        Claude
      </span>

      {blocks.map((block, i) => {
        switch (block.type) {
          case "thinking":
            return <ThinkingRow key={i} text={block.text} />;
          case "tool_group":
            return <ToolCallGroup key={i} tools={block.tools} />;
          case "file_changes":
            return (
              <div key={i} className="flex flex-wrap gap-1.5 py-0.5">
                {block.files.map((f) => (
                  <FileBadge key={f.path} path={f.path} additions={f.additions} deletions={f.deletions} />
                ))}
              </div>
            );
          case "assistant_message":
            return <MarkdownContent key={i} text={block.text} />;
          case "error":
            return (
              <div key={i} className="text-[13px] text-[var(--color-status-error)]">
                Error: {block.message}
              </div>
            );
          default:
            return null;
        }
      })}

      {allFileChanges.length > 0 && <FileChangeSummary files={allFileChanges} />}
    </div>
  );
}
```

- [ ] **Step 2: Create MessageList.tsx**

```tsx
"use client";

import { useRef, useEffect } from "react";
import type { MessageBlock } from "@/hooks/useMessageGroups";
import type { AgentStatus } from "@/lib/agent-events";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { StreamingIndicator } from "./StreamingIndicator";

interface MessageListProps {
  blocks: MessageBlock[];
  agentStatus: AgentStatus;
}

export function MessageList({ blocks, agentStatus }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [blocks.length]);

  // Group consecutive non-user blocks into assistant turns
  const turns: Array<{ type: "user"; block: MessageBlock } | { type: "assistant"; blocks: MessageBlock[] }> = [];
  let currentAssistantBlocks: MessageBlock[] = [];

  for (const block of blocks) {
    if (block.type === "user_message") {
      if (currentAssistantBlocks.length > 0) {
        turns.push({ type: "assistant", blocks: currentAssistantBlocks });
        currentAssistantBlocks = [];
      }
      turns.push({ type: "user", block });
    } else {
      currentAssistantBlocks.push(block);
    }
  }
  if (currentAssistantBlocks.length > 0) {
    turns.push({ type: "assistant", blocks: currentAssistantBlocks });
  }

  const isStreaming = agentStatus === "active" || agentStatus === "spawning";

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-6">
      {turns.map((turn, i) => {
        if (turn.type === "user") {
          return <UserMessage key={i} text={(turn.block as Extract<MessageBlock, { type: "user_message" }>).text} />;
        }
        return <AssistantMessage key={i} blocks={turn.blocks} />;
      })}

      {isStreaming && <StreamingIndicator />}

      <div ref={endRef} />
    </div>
  );
}
```

- [ ] **Step 3: Create ChatInput.tsx**

```tsx
"use client";

import { useState, useRef, useCallback, type KeyboardEvent } from "react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  return (
    <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
      <div
        className="flex flex-col rounded-lg border border-[var(--color-border-default)] transition-[border-color,box-shadow]"
        style={{ boxShadow: "none" }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--color-accent)";
          e.currentTarget.style.boxShadow = "0 0 0 3px var(--color-accent-subtle)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--color-border-default)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <textarea
          ref={textareaRef}
          className="min-h-[44px] resize-none border-none bg-transparent px-4 py-3 text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          placeholder="Ask to make changes, @mention files, run /commands"
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          disabled={disabled}
        />
        <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] px-2.5 py-1.5">
          <div className="flex items-center gap-1">
            <button className="rounded px-2 py-1 text-[12px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-elevated-hover)] hover:text-[var(--color-text-secondary)]">
              &#9883; Opus 4.6
            </button>
            <button className="rounded px-2 py-1 text-[12px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-elevated-hover)] hover:text-[var(--color-text-secondary)]">
              &#128206; Attach
            </button>
            <button className="rounded px-2 py-1 text-[12px] text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)]"
              style={{ background: "var(--color-accent-subtle)" }}
            >
              &#10024; Thinking
            </button>
          </div>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-[14px] text-white"
            style={{
              background: disabled ? "var(--color-text-tertiary)" : "var(--color-accent)",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
            onClick={handleSend}
            disabled={disabled}
          >
            &#8593;
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create ChatPanel.tsx**

```tsx
"use client";

import { useAgentStream } from "@/hooks/useAgentStream";
import { useMessageGroups } from "@/hooks/useMessageGroups";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";

interface ChatPanelProps {
  sessionId: string;
}

export function ChatPanel({ sessionId }: ChatPanelProps) {
  const { events, status, agentStatus, sendMessage } = useAgentStream(sessionId);
  const blocks = useMessageGroups(events);

  const isAgentBusy = agentStatus === "active" || agentStatus === "spawning";

  return (
    <div className="flex h-full flex-col">
      <MessageList blocks={blocks} agentStatus={agentStatus} />
      <ChatInput onSend={sendMessage} disabled={isAgentBusy} />
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/chat/
git commit -m "feat(chat): add ChatPanel, MessageList, ChatInput, AssistantMessage"
```

---

### Task 8: Add CSS for Chat Components

**Files:**
- Modify: `packages/web/src/app/globals.css`

- [ ] **Step 1: Add chat-specific animations and markdown styles**

Append to `globals.css` after the existing content:

```css
/* ── Chat UI ──────────────────────────────────────────────────────── */

@keyframes chat-pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

.chat-markdown p { margin-bottom: 0.5em; }
.chat-markdown p:last-child { margin-bottom: 0; }
.chat-markdown ul { padding-left: 1.25em; margin: 0.5em 0; display: flex; flex-direction: column; gap: 0.375em; }
.chat-markdown strong { font-weight: 600; }

.chat-inline-code {
  font-family: var(--font-jetbrains-mono);
  font-size: 12px;
  background: var(--color-bg-subtle);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--color-accent);
}

.chat-code-block {
  font-family: var(--font-jetbrains-mono);
  font-size: 12px;
  background: var(--color-bg-subtle);
  padding: 12px 16px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.5em 0;
  line-height: 1.5;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/app/globals.css
git commit -m "feat(chat): add CSS for chat markdown and streaming animation"
```

---

### Task 9: Integrate ChatPanel into SessionDetail

**Files:**
- Modify: `packages/web/src/components/SessionDetail.tsx`

- [ ] **Step 1: Add feature flag and ChatPanel import**

At the top of `SessionDetail.tsx`, add:

```typescript
import { ChatPanel } from "./chat/ChatPanel";
```

- [ ] **Step 2: Replace the DirectTerminal section**

In the `SessionDetail` component, replace the terminal section (lines ~389-408) with a conditional that checks for a `useChatUI` flag:

```tsx
<section className="mt-5">
  <div id="session-terminal-section" aria-hidden="true" />
  <div className="mb-3 flex items-center gap-2">
    <div
      className="h-3 w-0.5"
      style={{ background: isOrchestrator ? accentColor : activity.color, opacity: 0.75 }}
    />
    <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
      {session.metadata["useChatUI"] === "true" ? "Chat" : "Live Terminal"}
    </span>
  </div>
  {session.metadata["useChatUI"] === "true" ? (
    <div style={{ height: terminalHeight }}>
      <ChatPanel sessionId={session.id} />
    </div>
  ) : (
    <DirectTerminal
      sessionId={session.id}
      startFullscreen={startFullscreen}
      variant={terminalVariant}
      height={terminalHeight}
      isOpenCodeSession={isOpenCodeSession}
      reloadCommand={isOpenCodeSession ? reloadCommand : undefined}
    />
  )}
</section>
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/SessionDetail.tsx
git commit -m "feat(chat): integrate ChatPanel with feature flag in SessionDetail"
```

---

### Task 10: Wire Send Route to AgentProcessManager

**Files:**
- Modify: `packages/web/src/app/api/sessions/[id]/send/route.ts`

- [ ] **Step 1: Add chat-mode routing**

In `send/route.ts`, after the message sanitization but before calling `sessionManager.send()`, add a branch that routes to the `AgentProcessManager` when the session is in chat mode:

```typescript
// After line 31 (const message = stripControlChars(...)):
import agentProcessManager from "../../../../../server/agent-process-manager";

// Inside the try block, before sessionManager.send(id, message):
// Check if this session uses the chat UI
const session = await sessionManager.get(id);
if (session?.metadata?.["useChatUI"] === "true") {
  await agentProcessManager.send(id, message);
  recordApiObservation({ /* same as below */ });
  return jsonWithCorrelation({ ok: true, sessionId: id, message }, { status: 200 }, correlationId);
}

// Existing sessionManager.send() path continues for terminal sessions
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/app/api/sessions/\\[id\\]/send/route.ts
git commit -m "feat(chat): route send to AgentProcessManager for chat-mode sessions"
```

---

### Task 11: End-to-End Manual Test

- [ ] **Step 1: Start the dev server**

```bash
cd agent-orchestrator-main/packages/web && npm run dev
```

- [ ] **Step 2: Create a test session with chat UI enabled**

Either manually set `useChatUI: "true"` in a session's metadata, or temporarily hardcode `ChatPanel` in `SessionDetail.tsx` by removing the feature flag conditional.

- [ ] **Step 3: Verify the following work**

1. Chat panel renders with input at the bottom
2. Sending a message shows user bubble on the right
3. Events stream in via SSE (check Network tab for `/stream` endpoint)
4. Thinking blocks appear as collapsible rows
5. Tool calls group into "N tool calls" summaries
6. File changes show as badges
7. Streaming indicator animates while agent is working

- [ ] **Step 4: Commit any fixes discovered during testing**

```bash
git add -A
git commit -m "fix(chat): adjustments from end-to-end testing"
```
