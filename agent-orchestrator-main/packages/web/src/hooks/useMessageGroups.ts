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
