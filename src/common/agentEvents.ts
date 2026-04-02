// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export type EventType =
    | 'user_message'
    | 'assistant_message'
    | 'thinking'
    | 'tool_use'
    | 'tool_result'
    | 'status'
    | 'error';

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
export type AgentStatus = 'spawning' | 'active' | 'idle' | 'waiting_input' | 'error';
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
