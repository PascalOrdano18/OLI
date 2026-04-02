import { FileBadge } from "./FileBadge";

interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  action: string;
}

export function FileChangeSummary({ files }: { files: FileChange[] }) {
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-text-secondary)]">
        Files changed
        <span
          className="rounded-full bg-[var(--color-bg-subtle)] px-1.5 py-px text-[11px]"
          style={{ fontFamily: "var(--font-jetbrains-mono)" }}
        >
          {files.length}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {files.map((f) => (
          <FileBadge key={f.path} path={f.path} additions={f.additions} deletions={f.deletions} />
        ))}
      </div>
      <div
        className="mt-2 text-[11px] text-[var(--color-text-tertiary)]"
        style={{ fontFamily: "var(--font-jetbrains-mono)" }}
      >
        Total: <span className="text-[var(--color-status-ready)]">+{totalAdditions}</span>{" "}
        <span className="text-[var(--color-status-error)]">-{totalDeletions}</span>
      </div>
    </div>
  );
}
