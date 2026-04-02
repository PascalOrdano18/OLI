// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

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
