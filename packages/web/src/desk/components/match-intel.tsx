"use client";

import Link from "next/link";
import { getFixture, modelProbFor, selectionLabel } from "@/desk/lib/data/fixtures";
import { TEAMS } from "@/desk/lib/data/teams";
import { fmtKickoff, fmtPct } from "@/desk/lib/format";
import { scorersForTeam, statsForTeam } from "@/desk/lib/live";
import { useDesk } from "@/desk/lib/store";
import { FormLetters } from "@/desk/components/form-dots";
import { KitPip } from "@/desk/components/kit";
import { ProbBar } from "@/desk/components/prob-bar";
import { Button } from "@/desk/components/ui/button";
import { useLiveSlate } from "@/desk/components/use-live-slate";

export function MatchIntel() {
  const selectedId = useDesk((s) => s.selectedId);
  const f = getFixture(selectedId);
  const scores = useDesk((s) => s.scores);
  const simulate = useDesk((s) => s.simulate);
  const queueAsk = useDesk((s) => s.queueAsk);
  useLiveSlate();

  if (!f) return null;
  const homeMen = scorersForTeam(f.home, 3);
  const awayMen = scorersForTeam(f.away, 3);
  const homeStats = statsForTeam(f.home);
  const awayStats = statsForTeam(f.away);
  const leanP = modelProbFor(f, f.modelPick);
  const settledScore = f.status === "ft" ? (scores[f.id] ?? f.score) : undefined;
  const projectedScore = f.status === "upcoming" ? scores[f.id] : undefined;

  return (
    <aside className="hidden lg:block border-l border-border bg-surface min-w-0 lg:h-[calc(100dvh-7.5rem)] lg:overflow-y-auto">
      <div className="px-4 py-4">
        <div className="flex items-center gap-2 text-2xs uppercase tracking-wider text-quiet">
          <span>{f.venue}</span>
          <span className="text-border-strong">·</span>
          <span>{fmtKickoff(f.kickoff)}</span>
        </div>

        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <KitPip team={f.home} size="lg" />
              <h2 className="font-display text-4xl uppercase tracking-wide leading-none">
                {TEAMS[f.home].short}
              </h2>
            </div>
            <div className="mt-1.5">
              <FormLetters team={f.home} />
            </div>
            <LeagueLine stats={homeStats} />
            <div className="flex items-center gap-2 mt-3">
              <KitPip team={f.away} size="lg" />
              <h2 className="font-display text-4xl uppercase tracking-wide leading-none text-quiet">
                {TEAMS[f.away].short}
              </h2>
            </div>
            <div className="mt-1.5">
              <FormLetters team={f.away} />
            </div>
            <LeagueLine stats={awayStats} />
          </div>
          {settledScore ? (
            <div className="font-display text-5xl tabular-nums leading-none">
              {settledScore[0]}–{settledScore[1]}
            </div>
          ) : projectedScore ? (
            <div className="text-right">
              <div className="eyebrow">Proj</div>
              <div className="font-display text-3xl tabular-nums leading-none text-quiet">
                {projectedScore[0]}–{projectedScore[1]}
              </div>
            </div>
          ) : (
            <Button size="sm" variant="subtle" onClick={() => simulate(f.id)}>
              Project score
            </Button>
          )}
        </div>

        <div className="mt-5">
          <ProbBar home={f.model.home} draw={f.model.draw} away={f.model.away} />
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat k="xG" v={`${f.xg[0].toFixed(2)}–${f.xg[1].toFixed(2)}`} />
          <Stat k="O2.5" v={fmtPct(f.model.over25)} />
          <Stat k="BTTS" v={fmtPct(f.model.btts)} />
        </dl>

        <p className="mt-4 text-sm leading-relaxed text-quiet">
          Model lean{" "}
          <span className="text-fg font-medium">{selectionLabel(f, f.modelPick)}</span> at{" "}
          <span className="text-accent tabular-nums">{fmtPct(leanP)}</span>. {f.brief}
        </p>

        <div className="mt-5">
          <div className="eyebrow mb-2">Recent scorers</div>
          {homeMen.length + awayMen.length === 0 ? (
            <p className="text-sm text-quiet">
              No goals in the last five league matches for either side.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {homeMen.map((p) => (
                <PlayerLine
                  key={p.id}
                  name={p.name}
                  pos={p.pos}
                  goals={p.goals}
                  team={TEAMS[f.home].short}
                />
              ))}
              {awayMen.map((p) => (
                <PlayerLine
                  key={p.id}
                  name={p.name}
                  pos={p.pos}
                  goals={p.goals}
                  team={TEAMS[f.away].short}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <Button
            variant="accent"
            onClick={() =>
              queueAsk(
                `Give me the match briefing for ${TEAMS[f.home].name} vs ${TEAMS[f.away].name}. Tactics, who decides it, and the model lean.`,
              )
            }
          >
            Ask Pundit
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/model">Open the model page</Link>
          </Button>
        </div>

        <p className="mt-4 text-2xs text-subtle leading-relaxed">
          Analysis only — not betting advice. Paper board is a simulation, not a bookmaker.
        </p>
      </div>
    </aside>
  );
}

function LeagueLine({
  stats,
}: {
  stats: { position: number | null; playedGames: number | null; points: number | null; goalsFor: number | null; goalsAgainst: number | null } | null;
}) {
  if (!stats || stats.position == null || stats.playedGames == null) return null;
  const gf = stats.goalsFor ?? 0;
  const ga = stats.goalsAgainst ?? 0;
  const pts = stats.points ?? 0;
  return (
    <div className="mt-1 text-2xs tabular-nums text-quiet">
      {ordinal(stats.position)} · {stats.playedGames} played · {pts} pts · {gf}–{ga}
    </div>
  );
}

function ordinal(n: number) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-sm border border-border bg-elevated px-2 py-2">
      <dt className="eyebrow">{k}</dt>
      <dd className="mt-1 font-display text-lg tabular-nums leading-none">{v}</dd>
    </div>
  );
}

function PlayerLine({
  name,
  pos,
  goals,
  team,
}: {
  name: string;
  pos: string;
  goals: number;
  team: string;
}) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="text-2xs uppercase tracking-wide text-subtle w-8">{pos}</span>
      <span className="truncate">{name}</span>
      <span className="text-2xs text-quiet">{team}</span>
      <span className="ml-auto font-display tabular-nums text-accent">{goals}</span>
    </li>
  );
}
