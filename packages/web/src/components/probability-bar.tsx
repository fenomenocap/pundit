import { cn } from "@/lib/utils";

interface ProbabilityBarProps {
  pHome: number;
  pDraw: number | null;
  pAway: number;
  size?: "sm" | "md";
  className?: string;
  homeLabel?: string;
  awayLabel?: string;
}

function clampPct(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 100;
  return value * 100;
}

/**
 * Pure CSS horizontal stacked bar for 1X2 probabilities.
 * Home (cyan), Draw (slate), Away (pink). Draw segment is hidden when null.
 */
export function ProbabilityBar({
  pHome,
  pDraw,
  pAway,
  size = "md",
  className,
  homeLabel = "Home",
  awayLabel = "Away",
}: ProbabilityBarProps) {
  const homePct = clampPct(pHome);
  const awayPct = clampPct(pAway);
  const drawRaw = pDraw;
  const drawPct = drawRaw === null ? 0 : clampPct(drawRaw);

  const homeText = `${(pHome * 100).toFixed(1)}%`;
  const drawText = drawRaw === null ? "—" : `${(drawRaw * 100).toFixed(1)}%`;
  const awayText = `${(pAway * 100).toFixed(1)}%`;

  const ariaLabel = `${homeLabel} ${homeText}, Draw ${drawText}, ${awayLabel} ${awayText}.`;

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      title={`${homeLabel} ${homeText} · Draw ${drawText} · ${awayLabel} ${awayText}`}
      className={cn(
        "flex w-full overflow-hidden rounded-full bg-secondary/40 font-mono",
        size === "sm" ? "h-1.5" : "h-2",
        className,
      )}
    >
      <span
        className="shrink-0 bg-primary/80"
        style={{ width: `${homePct}%` }}
        aria-hidden
      />
      {drawRaw !== null && (
        <span
          className="shrink-0 bg-slate-500/70"
          style={{ width: `${drawPct}%` }}
          aria-hidden
        />
      )}
      <span
        className="shrink-0 bg-pink-500/70"
        style={{ width: `${awayPct}%` }}
        aria-hidden
      />
    </div>
  );
}
