"use client";

import { useRef, useEffect } from "react";
import type { MessageBlock } from "@/hooks/useMessageGroups";
import type { AgentStatus } from "@/lib/agent-events";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { StreamingIndicator } from "./StreamingIndicator";

interface MessageListProps {
  blocks: MessageBlock[];
  agentStatus: AgentStatus;
}

export function MessageList({ blocks, agentStatus }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [blocks.length]);

  // Group consecutive non-user blocks into assistant turns
  const turns: Array<
    | { type: "user"; block: MessageBlock }
    | { type: "assistant"; blocks: MessageBlock[] }
  > = [];
  let currentAssistantBlocks: MessageBlock[] = [];

  for (const block of blocks) {
    if (block.type === "user_message") {
      if (currentAssistantBlocks.length > 0) {
        turns.push({ type: "assistant", blocks: currentAssistantBlocks });
        currentAssistantBlocks = [];
      }
      turns.push({ type: "user", block });
    } else {
      currentAssistantBlocks.push(block);
    }
  }
  if (currentAssistantBlocks.length > 0) {
    turns.push({ type: "assistant", blocks: currentAssistantBlocks });
  }

  const isStreaming = agentStatus === "active" || agentStatus === "spawning";

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-6">
      {turns.map((turn, i) => {
        if (turn.type === "user") {
          return (
            <UserMessage
              key={i}
              text={(turn.block as Extract<MessageBlock, { type: "user_message" }>).text}
            />
          );
        }
        return <AssistantMessage key={i} blocks={turn.blocks} />;
      })}

      {isStreaming && <StreamingIndicator />}

      <div ref={endRef} />
    </div>
  );
}
