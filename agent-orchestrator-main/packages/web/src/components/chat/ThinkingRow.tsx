"use client";

import { useState } from "react";

export function ThinkingRow({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = text.length > 80 ? text.slice(0, 77) + "..." : text;

  return (
    <div>
      <div
        className="flex cursor-pointer items-start gap-1.5 select-none py-0.5"
        onClick={() => setExpanded(!expanded)}
      >
        <span
          className="mt-[3px] text-[9px] text-[var(--color-text-tertiary)] transition-transform"
          style={{ display: "inline-block", transform: expanded ? "rotate(90deg)" : "none" }}
        >
          &#9654;
        </span>
        <span className="text-[12px] font-medium text-[var(--color-text-tertiary)]">Thinking</span>
        {!expanded && (
          <span className="flex-1 truncate text-[12px] italic text-[var(--color-text-tertiary)]">
            {preview}
          </span>
        )}
      </div>
      {expanded && (
        <div className="-mt-0.5 mb-0.5 pl-[22px] text-[12px] leading-relaxed italic text-[var(--color-text-secondary)]">
          {text}
        </div>
      )}
    </div>
  );
}
