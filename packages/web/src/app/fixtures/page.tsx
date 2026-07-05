"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchUpcomingMatches, fetchRecentMatches, fetchStandings } from "@/lib/mock-data";
import { formatStage, STAGE_ORDER } from "@/lib/stage-label";
import { getTeamFlag, getTeamColor } from "@/lib/team-logos";
import type { MatchResponse, StandingResponse } from "@/lib/api";

function useFixturesData() {
  const [matches, setMatches] = useState<MatchResponse[]>([]);
  const [standings, setStandings] = useState<StandingResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchUpcomingMatches(), fetchRecentMatches(), fetchStandings()]).then(
      ([upcoming, recent, standingsData]) => {
        if (cancelled) return;
        const merged = [...recent, ...upcoming].sort(
          (a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime()
        );
        setMatches(merged);
        setStandings(standingsData);
        setLoading(false);
      }
    );
    return () => { cancelled = true; };
  }, []);

  return { matches, standings, loading };
}

function formatKickoff(utcDate: string): string {
  return new Date(utcDate).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function TeamLabel({ name, bold }: { name: string; bold?: boolean }) {
  const flag = getTeamFlag(name);
  return (
    <span className={cn("flex items-center gap-2 truncate", bold && "font-bold text-white")}>
      {flag && <span className="shrink-0 text-xl">{flag}</span>}
      <span className="truncate">{name}</span>
    </span>
  );
}

function MatchRow({ match }: { match: MatchResponse }) {
  const finished = match.status === "FINISHED";
  const live = match.status === "IN_PLAY";
  const accent = getTeamColor(match.homeTeam);

  return (
    <div className="relative overflow-hidden rounded-xl border border-border/60 bg-card px-3 py-3 transition-colors hover:border-cyan-500/30">
      <div className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />
      <div className="flex items-center justify-between gap-3 pl-2">
        <div className="min-w-0 flex-1 space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <TeamLabel name={match.homeTeam} bold={finished && (match.score?.home ?? 0) > (match.score?.away ?? 0)} />
            <span className="shrink-0 font-mono text-lg font-black text-foreground">
              {finished ? match.score?.home ?? "-" : ""}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <TeamLabel name={match.awayTeam} bold={finished && (match.score?.away ?? 0) > (match.score?.home ?? 0)} />
            <span className="shrink-0 font-mono text-lg font-black text-foreground">
              {finished ? match.score?.away ?? "-" : ""}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex justify-end pl-2">
        {live ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[9px] font-black uppercase text-red-400">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
            Live
          </span>
        ) : (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase",
              finished ? "bg-secondary text-muted-foreground" : "bg-cyan-500/10 text-cyan-400"
            )}
          >
            {finished ? "Full Time" : formatKickoff(match.utcDate)}
          </span>
        )}
      </div>
    </div>
  );
}

function StandingsTable({ group, rows }: { group: string; rows: StandingResponse[] }) {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
        <h4 className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
          Group {group}
        </h4>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="px-3 pb-1 pt-2 font-medium">Team</th>
            <th className="pb-1 pt-2 text-center font-medium">P</th>
            <th className="pb-1 pt-2 text-center font-medium">GD</th>
            <th className="pb-1 pr-3 pt-2 text-center font-medium">Pts</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s, i) => (
            <tr
              key={s.team}
              className={cn(
                "border-t border-border/40",
                i < 2 ? "text-white" : "text-muted-foreground"
              )}
            >
              <td className="px-3 py-1.5 truncate max-w-[120px] font-semibold">
                <span className={cn("mr-1.5 inline-block h-1.5 w-1.5 rounded-full", i < 2 ? "bg-emerald-400" : "bg-transparent")} />
                {s.team}
              </td>
              <td className="py-1.5 text-center font-mono">{s.playedGames}</td>
              <td className="py-1.5 text-center font-mono">
                {s.goalDifference > 0 ? `+${s.goalDifference}` : s.goalDifference}
              </td>
              <td className="py-1.5 pr-3 text-center font-mono font-black">{s.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FixturesPage() {
  const { matches, standings, loading } = useFixturesData();

  const byStage = STAGE_ORDER.map((stage) => ({
    stage,
    matches: matches.filter((m) => m.stage === stage),
  })).filter((s) => s.matches.length > 0);

  const groups = Array.from(new Set(standings.map((s) => s.group).filter(Boolean))) as string[];
  groups.sort();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-bold text-white sm:text-3xl">
          Fixtures &amp; Bracket
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground max-w-lg">
          Live FIFA World Cup 2026 schedule and results — reference only, not tradeable here.
        </p>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-card" />
          ))}
        </div>
      ) : byStage.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No fixture data available right now.
        </p>
      ) : (
        <div className="space-y-8">
          {byStage.map(({ stage, matches: stageMatches }, idx) => (
            <section key={stage} className="relative pl-4">
              <div className="absolute left-0 top-1 h-full w-0.5 rounded-full bg-gradient-to-b from-cyan-500 to-pink-500 opacity-40" />
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary font-heading text-[11px] font-black text-cyan-400">
                  {idx + 1}
                </span>
                <h2 className="font-heading text-base font-black uppercase tracking-tight text-foreground">
                  {formatStage(stage)}
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {stageMatches.map((m) => (
                  <MatchRow key={m.id} match={m} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {groups.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 font-heading text-base font-black uppercase tracking-tight text-foreground">
            Group Standings
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {groups.map((g) => (
              <StandingsTable key={g} group={g} rows={standings.filter((s) => s.group === g)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
