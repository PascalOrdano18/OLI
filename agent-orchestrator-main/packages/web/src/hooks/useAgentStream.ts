"use client";

import { useEffect, useReducer, useCallback } from "react";
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
