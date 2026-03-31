"use client";

import type { MessageBlock } from "@/hooks/useMessageGroups";
import { ThinkingRow } from "./ThinkingRow";
import { ToolCallGroup } from "./ToolCallGroup";
import { FileBadge } from "./FileBadge";
import { FileChangeSummary } from "./FileChangeSummary";
import { MarkdownContent } from "./MarkdownContent";

interface AssistantMessageProps {
  blocks: MessageBlock[];
}

/** Renders a group of blocks that form one assistant turn. */
export function AssistantMessage({ blocks }: AssistantMessageProps) {
  // Collect all file changes for the cumulative summary at the bottom
  const allFileChanges = blocks
    .filter((b): b is Extract<MessageBlock, { type: "file_changes" }> => b.type === "file_changes")
    .flatMap((b) => b.files);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-[var(--color-text-tertiary)]">
        Claude
      </span>

      {blocks.map((block, i) => {
        switch (block.type) {
          case "thinking":
            return <ThinkingRow key={i} text={block.text} />;
          case "tool_group":
            return <ToolCallGroup key={i} tools={block.tools} />;
          case "file_changes":
            return (
              <div key={i} className="flex flex-wrap gap-1.5 py-0.5">
                {block.files.map((f) => (
                  <FileBadge key={f.path} path={f.path} additions={f.additions} deletions={f.deletions} />
                ))}
              </div>
            );
          case "assistant_message":
            return <MarkdownContent key={i} text={block.text} />;
          case "error":
            return (
              <div key={i} className="text-[13px] text-[var(--color-status-error)]">
                Error: {block.message}
              </div>
            );
          default:
            return null;
        }
      })}

      {allFileChanges.length > 0 && <FileChangeSummary files={allFileChanges} />}
    </div>
  );
}
