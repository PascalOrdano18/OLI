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
