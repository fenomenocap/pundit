"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  fetchCompetitions,
  fetchRecentMatches,
  fetchStandings,
  fetchUpcomingMatches,
} from "@/lib/mock-data";
import { formatStage, STAGE_ORDER } from "@/lib/stage-label";
import { getTeamFlagUrl, getTeamColor } from "@/lib/team-logos";
import type { CompetitionResponse, MatchResponse, StandingResponse } from "@/lib/api";

const LIVE_POLL_MS = 60_000;
const ALL_TAB = "all";

function useFixturesData(selectedCompetition: string) {
  const [matches, setMatches] = useState<MatchResponse[]>([]);
  const [standings, setStandings] = useState<StandingResponse[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const competitionFilter = selectedCompetition === ALL_TAB ? undefined : selectedCompetition;

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [upcoming, recent, standingsData] = await Promise.all([
      fetchUpcomingMatches(competitionFilter),
      fetchRecentMatches(competitionFilter),
      fetchStandings(competitionFilter),
    ]);
    const merged = [...recent.matches, ...upcoming.matches].sort(
      (a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime()
    );
    setMatches(merged);
    setStandings(standingsData.standings);
    setLastUpdated(
      upcoming.lastUpdated
      ?? recent.lastUpdated
      ?? standingsData.lastUpdated
    );
    setError(upcoming.error || recent.error || standingsData.error);
    setLoading(false);
  }, [competitionFilter]);

  useEffect(() => {
    let cancelled = false;
    void load().then(() => {
      if (cancelled) return;
    });
    return () => { cancelled = true; };
  }, [load]);

  useEffect(() => {
    const hasLive = matches.some((match) => match.status === "IN_PLAY");
    if (!hasLive) return;
    const timer = setInterval(() => {
      void load(true);
    }, LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [matches, load]);

  return { matches, standings, lastUpdated, error, loading };
}

function formatKickoff(utcDate: string): string {
  return new Date(utcDate).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isAskable(match: MatchResponse): boolean {
  return (match.status === "SCHEDULED" || match.status === "IN_PLAY")
    && Boolean(match.homeTeam)
    && Boolean(match.awayTeam)
    && match.homeTeam.toLowerCase() !== "tbd"
    && match.awayTeam.toLowerCase() !== "tbd"
    && !/\b(?:winner|loser)\b/i.test(match.homeTeam)
    && !/\b(?:winner|loser)\b/i.test(match.awayTeam);
}

function TeamLabel({ name, bold }: { name: string; bold?: boolean }) {
  const flagUrl = getTeamFlagUrl(name);
  return (
    <span className={cn("flex items-center gap-2 truncate", bold && "font-bold text-white")}>
      {flagUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={flagUrl}
          alt=""
          aria-hidden
          loading="lazy"
          className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover"
        />
      )}
      <span className="truncate">{name}</span>
    </span>
  );
}

function MatchRow({ match }: { match: MatchResponse }) {
  const finished = match.status === "FINISHED";
  const live = match.status === "IN_PLAY";
  const showScore = finished || live;
  const accent = getTeamColor(match.homeTeam);
  const askHref = isAskable(match)
    ? `/?q=${encodeURIComponent(`${match.homeTeam} vs ${match.awayTeam}`)}`
    : null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border/60 bg-card px-3 py-3 transition-colors hover:border-cyan-500/30">
      <div className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />
      <div className="flex items-center justify-between gap-3 pl-2">
        <div className="min-w-0 flex-1 space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <TeamLabel
              name={match.homeTeam}
              bold={finished && (match.score?.home ?? 0) > (match.score?.away ?? 0)}
            />
            <span className="shrink-0 font-mono text-lg font-black text-foreground">
              {showScore ? match.score?.home ?? "–" : ""}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <TeamLabel
              name={match.awayTeam}
              bold={finished && (match.score?.away ?? 0) > (match.score?.home ?? 0)}
            />
            <span className="shrink-0 font-mono text-lg font-black text-foreground">
              {showScore ? match.score?.away ?? "–" : ""}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 pl-2">
        {askHref ? (
          <Link
            href={askHref}
            className="text-[10px] font-semibold uppercase tracking-wide text-cyan-400 transition-colors hover:text-cyan-300"
          >
            Ask about this match
          </Link>
        ) : (
          <span className="text-[10px] text-muted-foreground">{match.competition}</span>
        )}
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

function LeagueStandingsTable({ rows }: { rows: StandingResponse[] }) {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
        <h4 className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
          League table
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
          {sorted.map((standing) => (
            <tr key={standing.team} className="border-t border-border/40 text-foreground">
              <td className="px-3 py-1.5 max-w-[160px] truncate font-semibold">{standing.team}</td>
              <td className="py-1.5 text-center font-mono">{standing.playedGames}</td>
              <td className="py-1.5 text-center font-mono">
                {standing.goalDifference > 0 ? `+${standing.goalDifference}` : standing.goalDifference}
              </td>
              <td className="py-1.5 pr-3 text-center font-mono font-black">{standing.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupStandingsTable({ group, rows }: { group: string; rows: StandingResponse[] }) {
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
          {sorted.map((standing, index) => (
            <tr
              key={standing.team}
              className={cn(
                "border-t border-border/40",
                index < 2 ? "text-white" : "text-muted-foreground"
              )}
            >
              <td className="px-3 py-1.5 truncate max-w-[120px] font-semibold">{standing.team}</td>
              <td className="py-1.5 text-center font-mono">{standing.playedGames}</td>
              <td className="py-1.5 text-center font-mono">
                {standing.goalDifference > 0 ? `+${standing.goalDifference}` : standing.goalDifference}
              </td>
              <td className="py-1.5 pr-3 text-center font-mono font-black">{standing.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FixturesPage() {
  const [competitions, setCompetitions] = useState<CompetitionResponse[]>([]);
  const [selectedCompetition, setSelectedCompetition] = useState(ALL_TAB);
  const { matches, standings, lastUpdated, error, loading } = useFixturesData(selectedCompetition);

  useEffect(() => {
    document.title = "Fixtures | Pundit";
    void fetchCompetitions().then((payload) => {
      setCompetitions(payload.competitions.filter((competition) => competition.enabled));
    });
    return () => { document.title = "Pundit"; };
  }, []);

  const enabledTabs = useMemo(
    () => [{ id: ALL_TAB, name: "All" }, ...competitions.map((c) => ({ id: c.id, name: c.name }))],
    [competitions]
  );

  const isKnockoutView = selectedCompetition === "fifa.world"
    || (selectedCompetition === ALL_TAB && matches.some((match) => match.competitionId === "fifa.world"));

  const byStage = STAGE_ORDER.map((stage) => ({
    stage,
    matches: matches.filter((match) => match.stage === stage),
  })).filter((section) => section.matches.length > 0);

  const upcomingAndRecent = matches.filter((match) => !match.stage || !STAGE_ORDER.includes(match.stage));
  const chronological = [...matches].sort(
    (a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime()
  );

  const groupedStandings = Array.from(
    new Set(standings.map((row) => row.group).filter(Boolean))
  ) as string[];
  groupedStandings.sort();
  const leagueStandings = standings.filter((row) => !row.group);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-white sm:text-3xl">
            Fixtures
          </h1>
          <p className="mt-1.5 max-w-lg text-sm text-muted-foreground">
            Live schedules from ESPN for enabled competitions — reference only, not tradeable here.
          </p>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {lastUpdated
            ? `Updated ${new Date(lastUpdated).toLocaleString()}`
            : loading
              ? "Loading…"
              : "Update time unavailable"}
        </span>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {enabledTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSelectedCompetition(tab.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors",
              selectedCompetition === tab.id
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.name}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-pink-500/30 bg-pink-950 px-4 py-3 text-sm text-pink-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-lg bg-card" />
          ))}
        </div>
      ) : matches.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No fixture data available for this competition right now.
        </p>
      ) : isKnockoutView && byStage.length > 0 ? (
        <div className="space-y-8">
          {byStage.map(({ stage, matches: stageMatches }, index) => (
            <section key={stage} className="relative pl-4">
              <div className="absolute left-0 top-1 h-full w-0.5 rounded-full bg-gradient-to-b from-cyan-500 to-pink-500 opacity-40" />
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary font-heading text-[11px] font-black text-cyan-400">
                  {index + 1}
                </span>
                <h2 className="font-heading text-base font-black uppercase tracking-tight text-foreground">
                  {formatStage(stage)}
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {stageMatches.map((match) => (
                  <MatchRow key={match.id} match={match} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {(upcomingAndRecent.length > 0 ? chronological : matches).map((match) => (
            <MatchRow key={match.id} match={match} />
          ))}
        </div>
      )}

      {leagueStandings.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 font-heading text-base font-black uppercase tracking-tight text-foreground">
            Standings
          </h2>
          <LeagueStandingsTable rows={leagueStandings} />
        </div>
      )}

      {groupedStandings.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 font-heading text-base font-black uppercase tracking-tight text-foreground">
            Group Standings
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {groupedStandings.map((group) => (
              <GroupStandingsTable
                key={group}
                group={group}
                rows={standings.filter((row) => row.group === group)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
