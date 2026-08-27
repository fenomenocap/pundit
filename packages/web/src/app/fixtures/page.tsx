"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  fetchCompetitions,
  fetchRecentMatches,
  fetchStandings,
  fetchUpcomingMatches,
} from "@/lib/mock-data";
import { getTeamMonogram, getTeamColor } from "@/lib/team-logos";
import { buildAskUrl, modelFixtureIdentity } from "@/lib/api";
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
  const [sinceLast, setSinceLast] = useState<number>(0);
  const sinceLastTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    setSinceLast(0);
  }, [competitionFilter]);

  useEffect(() => {
    let cancelled = false;
    void load().then(() => {
      if (cancelled) return;
    });
    return () => { cancelled = true; };
  }, [load]);

  useEffect(() => {
    if (sinceLastTimerRef.current) clearInterval(sinceLastTimerRef.current);
    sinceLastTimerRef.current = setInterval(() => {
      setSinceLast((seconds) => seconds + 1);
    }, 1_000);
    return () => {
      if (sinceLastTimerRef.current) clearInterval(sinceLastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const hasLive = matches.some((match) => match.status === "IN_PLAY");
    if (!hasLive) return;
    const timer = setInterval(() => {
      void load(true);
    }, LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [matches, load]);

  return { matches, standings, lastUpdated, error, loading, sinceLast, reload: () => load() };
}

function formatKickoffTime(utcDate: string): string {
  return new Date(utcDate).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
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

function Monogram({ name }: { name: string }) {
  const monogram = getTeamMonogram(name);
  const accent = getTeamColor(name);
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white shadow-card"
      style={{ backgroundColor: accent }}
      aria-hidden
    >
      {monogram ?? "·"}
    </span>
  );
}

function MatchRow({ match }: { match: MatchResponse }) {
  const finished = match.status === "FINISHED";
  const live = match.status === "IN_PLAY";
  const showScore = finished || live;
  const accent = getTeamColor(match.homeTeam);
  const askHref = isAskable(match)
    ? buildAskUrl(
      `${match.homeTeam} vs ${match.awayTeam}`,
      modelFixtureIdentity({ competitionId: match.competitionId, fixtureId: match.id })
    )
    : null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-card-rim bg-card shadow-card">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-0.5"
        style={{ backgroundColor: accent }}
      />
      <div className="flex flex-col gap-2 px-3 pb-2.5 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Monogram name={match.homeTeam} />
            <Monogram name={match.awayTeam} />
            <div className="ml-1 flex min-w-0 flex-col text-xs leading-tight">
              <span className="truncate font-medium text-foreground" title={match.homeTeam}>
                {match.homeTeam}
              </span>
              <span className="truncate font-medium text-foreground" title={match.awayTeam}>
                {match.awayTeam}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end text-right">
            <span className="font-mono text-base font-bold tabular-nums text-foreground">
              {formatKickoffTime(match.utcDate)}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {new Date(match.utcDate).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-md bg-secondary/40 px-2 py-1.5">
          <span className="flex-1 truncate text-xs font-semibold text-foreground">
            {match.homeTeam}
          </span>
          <div className="flex items-center gap-2 font-mono text-base font-black tabular-nums text-foreground">
            <span>{showScore ? match.score?.home ?? "–" : ""}</span>
            <span className="text-muted-foreground/60">·</span>
            <span>{showScore ? match.score?.away ?? "–" : ""}</span>
          </div>
          <span className="flex-1 truncate text-right text-xs font-semibold text-foreground">
            {match.awayTeam}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
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
              {finished ? "Full Time" : "Scheduled"}
            </span>
          )}
        </div>
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
    <div className="overflow-hidden rounded-xl border border-card-rim bg-card shadow-card">
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
                  qualifying ? "text-foreground" : "text-muted-foreground",
                  qualifying && "border-l-2 border-primary/60",
                )}
              >
                <td className="max-w-[160px] truncate px-3 py-1.5 font-semibold">
                  <span className="flex items-center gap-1.5">
                    {qualifying && (
                      <span
                        aria-label="Champions League qualification"
                        title="Champions League qualification"
                        className="font-mono text-[10px] leading-none text-primary"
                      >
                        •
                      </span>
                    )}
                    <span className="truncate">{standing.team}</span>
                  </span>
                </td>
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

function stageLabel(stage: string | null): string {
  if (!stage) return "";
  return stage.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function GroupStandingsTable({
  group,
  rows,
  stage,
}: {
  group: string;
  rows: StandingResponse[];
  stage: string | null;
}) {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  const stageText = stage ? stageLabel(stage) : "";
  return (
    <div className="overflow-hidden rounded-xl border border-card-rim bg-card shadow-card">
      <div className="border-b border-border bg-secondary/50 px-3 py-2">
        <h4 className="text-xs font-black uppercase tracking-wider text-foreground">
          Group {group}
          {stageText && (
            <span className="ml-2 font-mono text-[10px] font-normal normal-case tracking-wide text-muted-foreground">
              · {stageText}
            </span>
          )}
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
  const { matches, standings, lastUpdated, error, loading, sinceLast, reload } =
    useFixturesData(selectedCompetition);

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

  const hasLive = matches.some((match) => match.status === "IN_PLAY");

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Fixtures"
        eyebrow="Schedule · Standings"
        subtitle="Live schedules from ESPN for enabled competitions."
        lastUpdated={lastUpdated}
        loading={loading}
        sticky
        rightSlot={hasLive && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-red-400"
            aria-live="polite"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" aria-hidden />
            Live · updated {sinceLast}s ago
          </span>
        )}
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      ) : matches.length === 0 ? (
        <EmptyState message="No fixture data available for this competition right now." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
            {groupedStandings.map((group) => (
              <GroupStandingsTable
                key={group}
                group={group}
                stage={matches.find((match) => match.group === group)?.stage ?? null}
                rows={standings.filter((row) => row.group === group)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
