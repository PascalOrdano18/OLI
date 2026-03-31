import { describe, it, expect } from "vitest";
import { groupEvents } from "../useMessageGroups";

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
    const blocks = groupEvents(events as any);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("user_message");
    expect((blocks[0] as any).text).toBe("hello");
  });

  it("groups consecutive tool_use events into a tool_group block", () => {
    const events = [
      makeEvent("tool_use", { toolName: "Read", summary: "file.ts", callId: "1" }),
      makeEvent("tool_use", { toolName: "Edit", summary: "file.ts", callId: "2" }),
      makeEvent("tool_use", { toolName: "Bash", summary: "npm test", callId: "3" }),
    ];
    const blocks = groupEvents(events as any);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("tool_group");
    expect((blocks[0] as any).tools).toHaveLength(3);
  });

  it("creates thinking blocks", () => {
    const events = [makeEvent("thinking", { text: "Let me analyze..." })];
    const blocks = groupEvents(events as any);
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
    const blocks = groupEvents(events as any);
    expect(blocks.length).toBeGreaterThanOrEqual(4);
  });
});
