"use client";

import { useState, useRef, useCallback, type KeyboardEvent } from "react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  return (
    <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
      <div
        className="flex flex-col rounded-lg border border-[var(--color-border-default)] transition-[border-color,box-shadow]"
        style={{ boxShadow: "none" }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--color-accent)";
          e.currentTarget.style.boxShadow = "0 0 0 3px var(--color-accent-subtle)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--color-border-default)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <textarea
          ref={textareaRef}
          className="min-h-[44px] resize-none border-none bg-transparent px-4 py-3 text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          placeholder="Ask to make changes, @mention files, run /commands"
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          disabled={disabled}
        />
        <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] px-2.5 py-1.5">
          <div className="flex items-center gap-1">
            <button className="rounded px-2 py-1 text-[12px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-elevated-hover)] hover:text-[var(--color-text-secondary)]">
              &#9883; Opus 4.6
            </button>
            <button className="rounded px-2 py-1 text-[12px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-elevated-hover)] hover:text-[var(--color-text-secondary)]">
              &#128206; Attach
            </button>
            <button
              className="rounded px-2 py-1 text-[12px] text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)]"
              style={{ background: "var(--color-accent-subtle)" }}
            >
              &#10024; Thinking
            </button>
          </div>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-[14px] text-white"
            style={{
              background: disabled ? "var(--color-text-tertiary)" : "var(--color-accent)",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
            onClick={handleSend}
            disabled={disabled}
          >
            &#8593;
          </button>
        </div>
      </div>
    </div>
  );
}
