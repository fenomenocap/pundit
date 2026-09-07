import { fmtPct } from "@/desk/lib/format";

export function ProbBar({
  home,
  draw,
  away,
}: {
  home: number;
  draw: number;
  away: number;
}) {
  return (
    <div>
      <div className="flex justify-between text-2xs uppercase tracking-wider text-quiet mb-1.5">
        <span>Model 1X2</span>
        <span className="tabular-nums normal-case">
          {fmtPct(home)} / {fmtPct(draw)} / {fmtPct(away)}
        </span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-elevated">
        <div className="bg-accent" style={{ width: `${home * 100}%` }} />
        <div className="bg-subtle" style={{ width: `${draw * 100}%` }} />
        <div className="bg-fg/35" style={{ width: `${away * 100}%` }} />
      </div>
    </div>
  );
}
