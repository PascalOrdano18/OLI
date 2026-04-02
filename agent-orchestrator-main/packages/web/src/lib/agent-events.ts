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
