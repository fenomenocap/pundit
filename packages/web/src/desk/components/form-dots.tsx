import { FORM, type ResultMark } from "@/desk/lib/data/form";
import type { TeamId } from "@/desk/lib/data/teams";
import { cn } from "@/lib/utils";

const TONE: Record<ResultMark, string> = {
  W: "bg-up",
  D: "bg-muted",
  L: "bg-down",
};

export function FormDots({ team, size = "md" }: { team: TeamId; size?: "sm" | "md" }) {
  const marks = FORM[team] ?? [];
  if (marks.length === 0) {
    return <span className="text-2xs text-subtle" aria-label="Form unavailable">—</span>;
  }
  const dim = size === "sm" ? "size-1.5" : "size-2";
  return (
    <span className="inline-flex items-center gap-0.5" title={marks.join("")} aria-label={`Form ${marks.join(" ")}`}>
      {marks.map((m, i) => (
        <span key={`${m}-${i}`} className={cn("rounded-full", dim, TONE[m])} />
      ))}
    </span>
  );
}

export function FormLetters({ team }: { team: TeamId }) {
  const marks = FORM[team] ?? [];
  if (marks.length === 0) {
    return <span className="text-2xs text-subtle">No league form yet</span>;
  }
  return (
    <span className="inline-flex items-center gap-0.5 font-display text-xs tracking-wide">
      {marks.map((m, i) => (
        <span
          key={`${m}-${i}`}
          className={cn(
            "inline-flex size-4 items-center justify-center rounded-xs",
            m === "W" && "bg-up/20 text-up",
            m === "D" && "bg-elevated text-quiet",
            m === "L" && "bg-down/20 text-down",
          )}
        >
          {m}
        </span>
      ))}
    </span>
  );
}
