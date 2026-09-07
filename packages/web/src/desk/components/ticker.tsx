"use client";

import { modelProbFor } from "@/desk/lib/data/fixtures";
import { TEAMS } from "@/desk/lib/data/teams";
import { fmtPct } from "@/desk/lib/format";
import { useDesk } from "@/desk/lib/store";
import { KitPip } from "@/desk/components/kit";
import { useLiveSlate } from "@/desk/components/use-live-slate";

export function Ticker() {
  const scores = useDesk((s) => s.scores);
  const { open } = useLiveSlate();
  const items = [...open, ...open];
  return (
    <div className="relative overflow-hidden border-b border-border bg-elevated">
      <div className="ticker-track flex w-max items-center gap-8 py-1.5 pr-8">
        {items.map((f, i) => {
          const score = scores[f.id];
          const p = modelProbFor(f, f.modelPick);
          return (
            <div key={`${f.id}-${i}`} className="flex items-center gap-2 text-xs whitespace-nowrap">
              <KitPip team={f.home} size="sm" />
              <span className="font-display uppercase tracking-wide">{TEAMS[f.home].short}</span>
              <span className="font-display tabular-nums text-quiet">
                {score ? `${score[0]}–${score[1]}` : "v"}
              </span>
              <span className="font-display uppercase tracking-wide">{TEAMS[f.away].short}</span>
              <KitPip team={f.away} size="sm" />
              <span className="font-display tabular-nums text-accent">{fmtPct(p)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
