// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import { resolve } from "path";
import {
  createAgentEvent,
  type AgentEvent,
  type AgentStatus,
  type UserMessageData,
  type AssistantMessageData,
  type ThinkingData,
  type ToolUseData,
  type StatusData,
} from "../src/lib/agent-events";

const CLAUDE_CLI_PATH = resolve(
  process.cwd(),
  "node_modules/@anthropic-ai/claude-code/cli.js",
);

interface AgentProcess {
  sessionId: string;
  claudeSessionId: string | null;
  status: AgentStatus;
  history: AgentEvent[];
  subscribers: Set<(event: AgentEvent) => void>;
  childProcess: ChildProcess | null;
  workspacePath: string;
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
      const placeholder: AgentProcess = {
        sessionId,
        claudeSessionId: null,
        status: "idle",
        history: [],
        subscribers: new Set([callback]),
        childProcess: null,
        workspacePath: "",
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
      claudeSessionId: existing?.claudeSessionId ?? null,
      status: "spawning",
      history: existing?.history ?? [],
      subscribers: existing?.subscribers ?? new Set(),
      childProcess: null,
      workspacePath: config.workspacePath,
    };
    this.agents.set(sessionId, agent);
    this.broadcastStatus(sessionId, "spawning");
  }

  async send(sessionId: string, message: string): Promise<void> {
    const agent = this.agents.get(sessionId);
    if (!agent) throw new Error(`No agent for session ${sessionId}`);

    this.addUserEvent(sessionId, message);

    agent.status = "active";
    this.broadcastStatus(sessionId, "active");

    const args = [
      CLAUDE_CLI_PATH,
      "--print",
      "--output-format", "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];

    if (agent.claudeSessionId) {
      args.push("--resume", agent.claudeSessionId);
    }

    args.push(message);

    const proc = spawn("node", args, {
      cwd: agent.workspacePath,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    agent.childProcess = proc;

    const rl = createInterface({ input: proc.stdout! });
    rl.on("line", (line: string) => {
      if (!line.trim()) return;
      try {
        const sdkEvent = JSON.parse(line);
        this.processSDKEvent(sessionId, sdkEvent);

        if (sdkEvent.type === "system" && sdkEvent.subtype === "init" && sdkEvent.session_id) {
          agent.claudeSessionId = sdkEvent.session_id;
        }
      } catch {
        // Non-JSON output — ignore
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      console.warn(`[AgentProcessManager] Claude CLI stderr: ${data.toString().slice(0, 200)}`);
    });

    return new Promise<void>((resolvePromise) => {
      proc.on("close", () => {
        agent.childProcess = null;
        if (agent.status !== "error") {
          agent.status = "idle";
          this.broadcastStatus(sessionId, "idle");
        }
        resolvePromise();
      });

      proc.on("error", (err) => {
        agent.childProcess = null;
        agent.status = "error";
        const errorEvent = createAgentEvent(sessionId, "error", { message: err.message });
        this.appendAndBroadcast(sessionId, errorEvent);
        this.broadcastStatus(sessionId, "error");
        resolvePromise();
      });
    });
  }

  kill(sessionId: string): void {
    const agent = this.agents.get(sessionId);
    if (!agent) return;
    if (agent.childProcess) {
      agent.childProcess.kill("SIGTERM");
      agent.childProcess = null;
    }
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
        claudeSessionId: null,
        status: "idle",
        history: [],
        subscribers: new Set(),
        childProcess: null,
        workspacePath: "",
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

const agentProcessManager = new AgentProcessManager();
export default agentProcessManager;
