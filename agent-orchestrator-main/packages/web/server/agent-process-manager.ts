// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import { claude } from "@anthropic-ai/claude-code";
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

const agentProcessManager = new AgentProcessManager();
export default agentProcessManager;
