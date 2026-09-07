"use client";

import { modelProbFor, selectionLabel } from "@/desk/lib/data/fixtures";
import { TEAMS } from "@/desk/lib/data/teams";
import { fmtKickoffShort, fmtPct } from "@/desk/lib/format";
import { useDesk } from "@/desk/lib/store";
import { cn } from "@/lib/utils";
import { FormDots } from "@/desk/components/form-dots";
import { KitPip, TeamMark } from "@/desk/components/kit";
import { useLiveSlate } from "@/desk/components/use-live-slate";

export function SlateRail() {
  const selectedId = useDesk((s) => s.selectedId);
  const select = useDesk((s) => s.selectFixture);
  const scores = useDesk((s) => s.scores);
  const { open, settled, source } = useLiveSlate();

  return (
    <section className="hidden lg:flex flex-col border-r border-border min-w-0 bg-surface lg:h-[calc(100dvh-7.5rem)]">
      <header className="flex items-center justify-between px-3 py-2 border-b border-border">
        <h2 className="eyebrow">Slate · {source === "live" ? "LIVE" : "GW4"}</h2>
        <span className="text-2xs text-subtle tabular-nums">{open.length}</span>
      </header>
      <ul className="flex-1 overflow-y-auto">
        {open.map((f) => {
          const active = f.id === selectedId;
          const score = scores[f.id];
          const p = modelProbFor(f, f.modelPick);
          return (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => select(f.id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b border-border transition-colors duration-150",
                  active ? "bg-panel" : "hover:bg-elevated",
                )}
              >
                <div className="flex items-center gap-2 text-2xs uppercase tracking-wide text-quiet">
                  <span>{fmtKickoffShort(f.kickoff)}</span>
                  <span className="ml-auto tabular-nums">
                    xG {f.xg[0].toFixed(1)}–{f.xg[1].toFixed(1)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <KitPip team={f.home} />
                      <span className="font-medium truncate text-sm">{TEAMS[f.home].short}</span>
                      <FormDots team={f.home} size="sm" />
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <KitPip team={f.away} />
                      <span className="font-medium truncate text-sm">{TEAMS[f.away].short}</span>
                      <FormDots team={f.away} size="sm" />
                    </div>
                  </div>
                  {score ? (
                    <div className="font-display text-xl tabular-nums leading-none">
                      {score[0]}–{score[1]}
                    </div>
                  ) : (
                    <div className="text-right shrink-0">
                      <div className="font-display text-xl tabular-nums leading-none text-accent">
                        {fmtPct(p)}
                      </div>
                      <div className="text-2xs text-quiet mt-0.5">{selectionLabel(f, f.modelPick)}</div>
                    </div>
                  )}
                </div>
                <div className="mt-2 h-1 rounded-full bg-elevated overflow-hidden">
                  <div className="h-full bg-accent" style={{ width: `${f.model.home * 100}%` }} />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <header className="flex items-center justify-between px-3 py-2 border-y border-border">
        <h2 className="eyebrow">GW3 settled</h2>
      </header>
      <ul className="max-h-48 overflow-y-auto">
        {settled.map((f) => (
          <li
            key={f.id}
            className="flex items-center gap-2 px-3 py-1.5 border-b border-border text-sm"
          >
            <TeamMark team={f.home} withName={false} size="sm" />
            <span className="font-display text-sm tabular-nums text-quiet w-10 text-center">
              {f.score?.[0]}–{f.score?.[1]}
            </span>
            <TeamMark team={f.away} withName={false} size="sm" />
            <span
              className={cn(
                "ml-auto text-2xs uppercase tracking-wider font-semibold",
                f.modelHit ? "text-up" : "text-down",
              )}
            >
              {f.modelHit ? "HIT" : "MISS"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SlateChips() {
  const selectedId = useDesk((s) => s.selectedId);
  const select = useDesk((s) => s.selectFixture);
  const scores = useDesk((s) => s.scores);
  const { open } = useLiveSlate();

  return (
    <div className="lg:hidden border-b border-border bg-surface">
      <div className="flex gap-2 overflow-x-auto px-3 py-2">
        {open.map((f) => {
          const active = f.id === selectedId;
          const score = scores[f.id];
          const p = modelProbFor(f, f.modelPick);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => select(f.id)}
              className={cn(
                "shrink-0 rounded-sm border px-3 py-2 min-h-11 text-left transition-colors duration-150",
                active ? "border-accent/50 bg-panel" : "border-border bg-elevated",
              )}
            >
              <div className="flex items-center gap-1.5">
                <KitPip team={f.home} size="sm" />
                <span className="font-display text-sm uppercase tracking-wide">
                  {TEAMS[f.home].short}
                </span>
                <span className="text-subtle text-2xs">
                  {score ? `${score[0]}–${score[1]}` : "v"}
                </span>
                <span className="font-display text-sm uppercase tracking-wide">
                  {TEAMS[f.away].short}
                </span>
                <KitPip team={f.away} size="sm" />
              </div>
              {!score ? (
                <div className="mt-1 text-2xs text-accent tabular-nums">{fmtPct(p)} lean</div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
