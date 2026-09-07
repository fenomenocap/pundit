"use client";

import { useEffect, useMemo, useState } from "react";
import { PLAYERS_BY_ADP, HEAT_LABELS, getPlayer, type Pos } from "@/desk/lib/data/players";
import { TEAMS } from "@/desk/lib/data/teams";
import {
  ROUNDS,
  TEAMS_N,
  USER_SEAT,
  legal,
  needs,
  rosterScore,
  snakeSeat,
  useDesk,
} from "@/desk/lib/store";
import { cn } from "@/lib/utils";
import { KitPip } from "./kit";
import { Button } from "./ui/button";

const POS: Pos[] = ["GK", "DEF", "MID", "FWD"];

export function DraftView() {
  const phase = useDesk((s) => s.draftPhase);
  const start = useDesk((s) => s.startDraft);
  const reset = useDesk((s) => s.resetDraft);
  const pick = useDesk((s) => s.draftPick);
  const teams = useDesk((s) => s.draftTeams);
  const makePick = useDesk((s) => s.makePick);
  const timerEnds = useDesk((s) => s.draftTimerEnds);
  const [filter, setFilter] = useState<Pos | "ALL">("ALL");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (phase !== "live") return;
    const id = window.setInterval(() => {
      setNow(Date.now());
      useDesk.getState().tickDraft();
    }, 200);
    setNow(Date.now());
    return () => window.clearInterval(id);
  }, [phase]);

  const seat = snakeSeat(Math.min(pick, TEAMS_N * ROUNDS - 1));
  const onClock = phase === "live" && seat === USER_SEAT;
  const taken = useMemo(() => new Set(teams.flatMap((t) => t.picks)), [teams]);
  const you = teams[USER_SEAT];
  const remaining = Math.max(0, timerEnds - now);
  const board = PLAYERS_BY_ADP.filter((p) => (filter === "ALL" ? true : p.pos === filter));
  const report = phase === "done" ? rosterScore(you.picks) : null;

  if (phase === "idle") {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="eyebrow">FPL-style · 8 managers · snake</p>
        <h1 className="font-display text-5xl mt-3 tracking-wide uppercase">Draftroom</h1>
        <p className="mt-4 text-quiet leading-relaxed">
          Eleven rounds. One keeper, three at the back, three in midfield, one up top — the rest is
          yours. Heat is goals, assists, xG, minutes, clean sheets, bonus. Beat seven other managers.
        </p>
        <Button className="mt-8" size="lg" variant="primary" onClick={start}>
          Enter public draft
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-3 sm:px-4 py-2">
        <div className="font-mono text-2xl tabular-nums tracking-tight">
          {phase === "done" ? "00:00" : formatMs(remaining)}
        </div>
        <div className="text-xs uppercase tracking-wider text-quiet">
          Rd {Math.min(Math.floor(pick / TEAMS_N) + 1, ROUNDS)}/{ROUNDS} · Pick {Math.min(pick + 1, TEAMS_N * ROUNDS)}
        </div>
        <div className="text-sm">
          {phase === "done" ? (
            <span className="text-accent">Draft complete</span>
          ) : onClock ? (
            <span className="text-accent">You are on the clock</span>
          ) : (
            <span className="text-quiet">
              On the clock: <span className="text-fg">{teams[seat]?.name}</span>
            </span>
          )}
        </div>
        <div className="ml-auto">
          <Button size="sm" variant="ghost" onClick={reset}>
            Leave room
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[200px_minmax(0,1fr)_280px] min-h-0">
        <ol className="border-b lg:border-b-0 lg:border-r border-border">
          {teams.map((t) => {
            const active = phase === "live" && t.id === seat;
            const n = needs(t.picks);
            return (
              <li
                key={t.id}
                className={cn(
                  "px-3 py-2.5 border-b border-border",
                  active && "bg-panel",
                  t.id === USER_SEAT && "ring-1 ring-inset ring-accent/40",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-subtle w-4">{t.id + 1}</span>
                  <span className={cn("text-sm font-medium truncate", t.id === USER_SEAT && "text-accent")}>
                    {t.name}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-quiet tabular-nums">
                    {t.picks.length}/{ROUNDS}
                  </span>
                </div>
                <div className="mt-1 flex gap-1 text-[10px] uppercase tracking-wide text-subtle">
                  <span>GK {n.GK}</span>
                  <span>D {n.DEF}</span>
                  <span>M {n.MID}</span>
                  <span>F {n.FWD}</span>
                </div>
              </li>
            );
          })}
        </ol>

        <section className="min-w-0 border-b lg:border-b-0 lg:border-r border-border">
          <div className="flex items-center gap-1 px-3 py-2 border-b border-border overflow-x-auto">
            {(["ALL", ...POS] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setFilter(p)}
                className={cn(
                  "h-8 px-3 rounded-full text-[11px] uppercase tracking-wide",
                  filter === p ? "bg-panel text-fg" : "text-quiet hover:text-fg",
                )}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-[10px] uppercase tracking-wider text-quiet">
                <tr>
                  <th className="text-left font-medium px-3 py-2">ADP</th>
                  <th className="text-left font-medium px-2 py-2">Player</th>
                  <th className="text-left font-medium px-2 py-2">Pos</th>
                  {HEAT_LABELS.map((h) => (
                    <th key={h} className="text-right font-medium px-1 py-2 hidden md:table-cell">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {board.map((p) => {
                  const gone = taken.has(p.id);
                  const can = !gone && phase === "live" && onClock && you && legal(you.picks, p.pos);
                  return (
                    <tr
                      key={p.id}
                      className={cn(
                        "border-t border-border",
                        gone && "opacity-35 line-through",
                        can && "hover:bg-panel cursor-pointer",
                      )}
                      onClick={() => {
                        if (can) makePick(p.id);
                      }}
                    >
                      <td className="px-3 py-2 font-mono text-xs tabular-nums text-quiet">{p.adp.toFixed(1)}</td>
                      <td className="px-2 py-2">
                        <span className="inline-flex items-center gap-2">
                          <KitPip team={p.team} size="sm" />
                          <span className="font-medium">{p.name}</span>
                          <span className="text-[11px] text-subtle">{TEAMS[p.team].short}</span>
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs text-quiet">{p.pos}</td>
                      {p.heat.map((h, i) => (
                        <td key={i} className="px-1 py-2 hidden md:table-cell">
                          <HeatCell v={h} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="min-w-0">
          <header className="px-3 py-2 border-b border-border text-xs uppercase tracking-[0.16em] text-quiet">
            Your XI
          </header>
          <ol>
            {you.picks.map((id, i) => {
              const p = getPlayer(id);
              if (!p) return null;
              const delta = p.adp - (i * 8 + USER_SEAT + 1);
              return (
                <li key={id} className="flex items-center gap-2 px-3 py-2 border-b border-border text-sm">
                  <span className="font-mono text-[11px] text-subtle w-5">{i + 1}</span>
                  <KitPip team={p.team} size="sm" />
                  <span className="min-w-0 truncate">{p.name}</span>
                  <span className="text-[11px] text-quiet">{p.pos}</span>
                  <span
                    className={cn(
                      "ml-auto font-mono text-[11px] tabular-nums",
                      delta < -4 ? "text-up" : delta > 8 ? "text-down" : "text-subtle",
                    )}
                  >
                    {delta > 0 ? `Reach +${Math.round(delta)}` : delta < -4 ? `${Math.round(delta)}` : "—"}
                  </span>
                </li>
              );
            })}
          </ol>
          {you.picks.length === 0 ? (
            <p className="px-3 py-4 text-sm text-quiet">No picks yet. You sit fourth in the snake.</p>
          ) : null}

          {report ? (
            <div className="p-3">
              <div className="rounded-lg border border-border bg-elevated p-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-quiet">Draft report</div>
                <div className="mt-2 flex items-end justify-between">
                  <div className="font-display text-3xl tracking-tight">{report.grade}</div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-quiet">Mean heat</div>
                    <div className="font-mono tabular-nums">{report.mean.toFixed(0)}</div>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  {HEAT_LABELS.map((l, i) => (
                    <div key={l} className="flex items-center gap-2">
                      <span className="w-8 text-[10px] uppercase text-quiet">{l}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-bg overflow-hidden">
                        <div
                          className={cn("h-full rounded-full", report.avg[i] >= 55 ? "bg-up" : "bg-accent")}
                          style={{ width: `${Math.min(100, report.avg[i])}%` }}
                        />
                      </div>
                      <span className="w-6 text-right font-mono text-[10px] tabular-nums text-quiet">
                        {Math.round(report.avg[i])}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : you.picks.length > 0 ? (
            <div className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-quiet mb-2">Category heat</div>
              {HEAT_LABELS.map((l, i) => {
                const avg =
                  you.picks.reduce((a, id) => a + (getPlayer(id)?.heat[i] ?? 0), 0) / you.picks.length;
                return (
                  <div key={l} className="flex items-center gap-2 mb-1">
                    <span className="w-8 text-[10px] uppercase text-quiet">{l}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-elevated overflow-hidden">
                      <div className="h-full bg-accent/80" style={{ width: `${avg}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function formatMs(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function HeatCell({ v }: { v: number }) {
  const alpha = Math.max(0.08, v / 100);
  return (
    <div className="flex justify-end">
      <span
        className="inline-block w-8 text-center font-mono text-[10px] tabular-nums rounded-xs"
        style={{ background: `color-mix(in oklab, var(--color-accent) ${alpha * 70}%, transparent)` }}
      >
        {v}
      </span>
    </div>
  );
}
