"use client";

import { useState } from "react";

interface ToolCall {
  toolName: string;
  summary: string;
  callId: string;
}

export function ToolCallGroup({ tools }: { tools: ToolCall[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <div
        className="flex cursor-pointer items-center gap-1.5 select-none py-0.5"
        onClick={() => setExpanded(!expanded)}
      >
        <span
          className="text-[9px] text-[var(--color-text-tertiary)] transition-transform"
          style={{ display: "inline-block", transform: expanded ? "rotate(90deg)" : "none" }}
        >
          &#9654;
        </span>
        <span className="text-[12px] font-medium text-[var(--color-text-tertiary)]">
          {tools.length} tool call{tools.length !== 1 ? "s" : ""}
        </span>
      </div>
      {expanded && (
        <div className="mt-0.5 mb-0.5 pl-[22px]">
          {tools.map((tool) => (
            <div key={tool.callId} className="flex items-center gap-1.5 py-0.5 text-[12px]">
              <span className="text-[11px] text-[var(--color-status-ready)]">&#10003;</span>
              <span
                className="min-w-[50px] text-[11px] font-medium"
                style={{ fontFamily: "var(--font-jetbrains-mono)", color: "var(--color-accent)" }}
              >
                {tool.toolName}
              </span>
              <span className="text-[var(--color-text-secondary)]">{tool.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
