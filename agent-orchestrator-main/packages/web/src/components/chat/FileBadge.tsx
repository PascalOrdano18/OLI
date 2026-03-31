export function FileBadge({
  path,
  additions,
  deletions,
}: {
  path: string;
  additions: number;
  deletions: number;
}) {
  const filename = path.split("/").pop() ?? path;

  return (
    <span
      className="inline-flex items-center gap-1.5 border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-2.5 py-1 text-[11px] font-medium"
      style={{ fontFamily: "var(--font-jetbrains-mono)", borderRadius: "6px" }}
    >
      <span className="text-[var(--color-text-tertiary)]">&#128196;</span>
      <span className="text-[var(--color-text-primary)]">{filename}</span>
      {additions > 0 && <span className="text-[var(--color-status-ready)]">+{additions}</span>}
      {deletions > 0 && <span className="text-[var(--color-status-error)]">-{deletions}</span>}
    </span>
  );
}
