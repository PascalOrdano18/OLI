"use client";

import { useAgentStream } from "@/hooks/useAgentStream";
import { useMessageGroups } from "@/hooks/useMessageGroups";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";

interface ChatPanelProps {
  sessionId: string;
}

export function ChatPanel({ sessionId }: ChatPanelProps) {
  const { events, agentStatus, sendMessage } = useAgentStream(sessionId);
  const blocks = useMessageGroups(events);

  const isAgentBusy = agentStatus === "active" || agentStatus === "spawning";

  return (
    <div className="flex h-full flex-col">
      <MessageList blocks={blocks} agentStatus={agentStatus} />
      <ChatInput onSend={sendMessage} disabled={isAgentBusy} />
    </div>
  );
}
