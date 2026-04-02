export function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-tertiary)]">
      <div className="flex gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 w-1 rounded-full bg-[var(--color-accent)]"
            style={{
              animation: "chat-pulse 1.4s infinite",
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
      Working...
    </div>
  );
}
