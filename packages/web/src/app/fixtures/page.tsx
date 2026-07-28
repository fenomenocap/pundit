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
import { getTeamMonogram, getTeamColor } from "@/lib/team-logos";
import type { CompetitionResponse, MatchResponse, StandingResponse } from "@/lib/api";
import { Disclaimer } from "@/components/disclaimer";
import { PageHeader } from "@/components/page-header";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { FilterPill } from "@/components/filter-pill";

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

  return { matches, standings, lastUpdated, error, loading, reload: () => load() };
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
  const monogram = getTeamMonogram(name);
  const accent = getTeamColor(name);
  return (
    <span className={cn("flex items-center gap-2 truncate", bold && "font-bold text-white")}>
      {monogram && (
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
          style={{ backgroundColor: accent }}
          aria-hidden
        >
          {monogram}
        </span>
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
    <div className="relative overflow-hidden rounded-xl border border-border/60 bg-card px-3 py-3 transition-colors hover:border-primary/30">
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
            className="text-xs font-semibold uppercase tracking-wide text-primary transition-colors hover:text-primary/80"
          >
            Ask about this match
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">{match.competition}</span>
        )}
        {live ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-black uppercase text-red-400">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
            Live
          </span>
        ) : (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-bold uppercase",
              finished ? "bg-secondary text-muted-foreground" : "bg-primary/10 text-primary"
            )}
          >
            {finished ? "Full Time" : formatKickoff(match.utcDate)}
          </span>
        )}
      </div>
    </div>
  );
}

function isQualifyingPosition(competitionId: string, position: number): boolean {
  if (competitionId === "eng.1") return position <= 4;
  return false;
}

function LeagueStandingsTable({
  rows,
  competitionId,
}: {
  rows: StandingResponse[];
  competitionId: string;
}) {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-secondary/50 px-3 py-2">
        <h4 className="text-xs font-black uppercase tracking-wider text-foreground">
          League table
        </h4>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="px-3 pb-1 pt-2 font-medium">Team</th>
            <th className="pb-1 pt-2 text-center font-medium">P</th>
            <th className="pb-1 pt-2 text-center font-medium">GD</th>
            <th className="pb-1 pr-3 pt-2 text-center font-medium">Pts</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((standing) => {
            const qualifying = isQualifyingPosition(competitionId, standing.position);
            return (
              <tr
                key={standing.team}
                className={cn(
                  "border-t border-border/40",
                  qualifying ? "text-foreground" : "text-muted-foreground"
                )}
              >
                <td className="max-w-[160px] truncate px-3 py-1.5 font-semibold">{standing.team}</td>
                <td className="py-1.5 text-center font-mono">{standing.playedGames}</td>
                <td className="py-1.5 text-center font-mono">
                  {standing.goalDifference > 0 ? `+${standing.goalDifference}` : standing.goalDifference}
                </td>
                <td className="py-1.5 pr-3 text-center font-mono font-black">{standing.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GroupStandingsTable({ group, rows }: { group: string; rows: StandingResponse[] }) {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-secondary/50 px-3 py-2">
        <h4 className="text-xs font-black uppercase tracking-wider text-foreground">
          Group {group}
        </h4>
      </div>
      <table className="w-full text-xs">
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
            <tr key={standing.team} className="border-t border-border/40 text-muted-foreground">
              <td className="max-w-[120px] truncate px-3 py-1.5 font-semibold">{standing.team}</td>
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
  const { matches, standings, lastUpdated, error, loading, reload } = useFixturesData(selectedCompetition);

  useEffect(() => {
    void fetchCompetitions().then((payload) => {
      setCompetitions(payload.competitions.filter((competition) => competition.enabled));
    });
  }, []);

  const enabledTabs = useMemo(
    () => [{ id: ALL_TAB, name: "All" }, ...competitions.map((c) => ({ id: c.id, name: c.name }))],
    [competitions]
  );

  const chronological = [...matches].sort(
    (a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime()
  );

  const groupedStandings = Array.from(
    new Set(standings.map((row) => row.group).filter(Boolean))
  ) as string[];
  groupedStandings.sort();
  const leagueStandings = standings.filter((row) => !row.group);
  const standingsCompetitionId = leagueStandings[0]?.competitionId ?? selectedCompetition;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Fixtures"
        subtitle="Live schedules from ESPN for enabled competitions."
        lastUpdated={lastUpdated}
        loading={loading}
      />

      <p className="-mt-4 mb-6 text-xs text-muted-foreground">
        <Disclaimer />
      </p>

      <div className="mb-6 flex flex-wrap gap-2">
        {enabledTabs.map((tab) => (
          <FilterPill
            key={tab.id}
            label={tab.name}
            active={selectedCompetition === tab.id}
            onClick={() => setSelectedCompetition(tab.id)}
          />
        ))}
      </div>

      {error && <ErrorBanner message={error} onRetry={reload} />}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-lg bg-card" />
          ))}
        </div>
      ) : matches.length === 0 ? (
        <EmptyState message="No fixture data available for this competition right now." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {chronological.map((match) => (
            <MatchRow key={match.id} match={match} />
          ))}
        </div>
      )}

      {leagueStandings.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 font-heading text-base font-black uppercase tracking-tight text-foreground">
            Standings
          </h2>
          <LeagueStandingsTable
            rows={leagueStandings}
            competitionId={standingsCompetitionId === ALL_TAB ? "eng.1" : standingsCompetitionId}
          />
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
