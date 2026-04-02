"use client";

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div
        className="max-w-[70%] rounded-lg rounded-br-sm px-4 py-2.5 text-[13px] leading-relaxed text-white"
        style={{ background: "var(--color-accent)" }}
      >
        {text}
      </div>
    </div>
  );
}
