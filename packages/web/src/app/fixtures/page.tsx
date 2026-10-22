"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  fetchCompetitions,
  fetchActiveModelFixtures,
  fetchRecentMatches,
  fetchRecognizedFixtures,
  fetchStandings,
  fetchUpcomingMatches,
} from "@/lib/mock-data";
import { getTeamMonogram, getTeamColor } from "@/lib/team-logos";
import { SourcesToggle } from "@/components/sources-toggle";
import { DeskPage, DeskPageHeader, DeskSection } from "@/components/desk-page";
import { ApiError, buildAskUrl, modelFixtureIdentity } from "@/lib/api";
import type {
  ClubFormResponse,
  CompetitionResponse,
  FixtureCapability,
  MatchResponse,
  ModelFixtureResponse,
  RecognizedFixtureSnapshotRow,
  StandingResponse,
} from "@/lib/api";
import { Disclaimer } from "@/components/disclaimer";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import {
  capabilityLabel,
  capabilityTone,
  formatObservedAt,
  formatKickoffDay,
  formatKickoffTime,
  goalForecastDisclosure,
  KICKOFF_TIME_NOTE,
  formatPercent,
  marketRowsFromModel,
  recognizedFixtureMap,
  sortFixturesChronologically,
} from "@/lib/fixture-presentation";

const LIVE_POLL_MS = 60_000;
const ALL_TAB = "all";

function useFixturesData(selectedCompetition: string) {
  const [matches, setMatches] = useState<MatchResponse[]>([]);
  const [standings, setStandings] = useState<StandingResponse[]>([]);
  const [recognized, setRecognized] = useState<RecognizedFixtureSnapshotRow[]>([]);
  const [modelFixtures, setModelFixtures] = useState<ModelFixtureResponse[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coverageWarning, setCoverageWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sinceLast, setSinceLast] = useState<number>(0);
  const sinceLastTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadGenerationRef = useRef(0);

  const competitionFilter = selectedCompetition === ALL_TAB ? undefined : selectedCompetition;

  const load = useCallback(async (silent = false) => {
    const generation = ++loadGenerationRef.current;
    if (!silent) setLoading(true);
    const [upcoming, recent, standingsData, recognizedData, modelData] = await Promise.all([
      fetchUpcomingMatches(competitionFilter),
      fetchRecentMatches(competitionFilter),
      fetchStandings(competitionFilter),
      fetchRecognizedFixtures(),
      fetchActiveModelFixtures(),
    ]);
    if (generation !== loadGenerationRef.current) return;
    const merged = sortFixturesChronologically([...recent.matches, ...upcoming.matches]);
    setMatches(merged);
    setStandings(standingsData.standings);
    setRecognized(recognizedData.fixtures);
    setModelFixtures(modelData.fixtures);
    setLastUpdated(
      upcoming.lastUpdated
      ?? recent.lastUpdated
      ?? standingsData.lastUpdated
    );
    setError(upcoming.error || recent.error || standingsData.error);
    setCoverageWarning(recognizedData.error || modelData.error);
    setLoading(false);
    setSinceLast(0);
  }, [competitionFilter]);

  useEffect(() => {
    void load();
    return () => {
      // Invalidate any request owned by the previous competition selection.
      loadGenerationRef.current += 1;
    };
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

  return {
    matches,
    standings,
    recognized,
    modelFixtures,
    lastUpdated,
    error,
    coverageWarning,
    loading,
    sinceLast,
    reload: () => load(),
  };
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
      className="flex size-6 shrink-0 items-center justify-center rounded-xs text-[10px] font-bold text-white"
      style={{ backgroundColor: accent }}
      aria-hidden
    >
      {monogram ?? "·"}
    </span>
  );
}

function dayHeading(utcDate: string): string {
  return new Date(utcDate).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London",
  });
}

function MatchRow({
  match,
  recognized,
  modelFixture,
}: {
  match: MatchResponse;
  recognized?: RecognizedFixtureSnapshotRow;
  modelFixture?: ModelFixtureResponse;
}) {
  const finished = match.status === "FINISHED";
  const live = match.status === "IN_PLAY";
  const showScore = finished || live;
  const askHref = isAskable(match)
    ? buildAskUrl(
      `${match.homeTeam} vs ${match.awayTeam}`,
      modelFixtureIdentity({ competitionId: match.competitionId, fixtureId: match.id })
    )
    : null;
  const marketRows = modelFixture ? marketRowsFromModel(modelFixture) : [];

  return (
    <div
      data-testid="fixture-row"
      data-fixture-id={modelFixtureIdentity({ competitionId: match.competitionId, fixtureId: match.id })}
      data-capability={modelFixture ? "priced" : "unpriced"}
      data-p-home={modelFixture?.pHome}
      data-p-draw={modelFixture?.pDraw}
      data-p-away={modelFixture?.pAway}
      className="relative border-b border-border px-4 py-3 last:border-b-0"
    >
      <div className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-3">
        <div className="text-2xs uppercase tracking-wider text-quiet tabular-nums">
          {live ? (
            <span className="inline-flex items-center gap-1 font-semibold text-live">
              <span className="size-1.5 rounded-full bg-live live-dot" aria-hidden />
              Live
            </span>
          ) : finished ? "FT" : formatKickoffTime(match.utcDate)}
          <div className="text-[10px] text-subtle">{formatKickoffDay(match.utcDate)}</div>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Monogram name={match.homeTeam} />
            <span className="truncate text-sm font-medium text-fg" title={match.homeTeam}>{match.homeTeam}</span>
            <span className="ml-auto font-display text-lg tabular-nums leading-none">{showScore ? match.score?.home ?? "–" : ""}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <Monogram name={match.awayTeam} />
            <span className="truncate text-sm font-medium text-fg" title={match.awayTeam}>{match.awayTeam}</span>
            <span className="ml-auto font-display text-lg tabular-nums leading-none">{showScore ? match.score?.away ?? "–" : ""}</span>
          </div>
        </div>
        <div className="hidden w-40 sm:block">
          {modelFixture ? (
            <ProbabilityStrip home={modelFixture.pHome} draw={modelFixture.pDraw} away={modelFixture.pAway} />
          ) : (
            <span className="text-2xs text-subtle">No forecast</span>
          )}
        </div>
      </div>

      {modelFixture && (
        <div data-testid="fixture-forecast" className="mt-2 sm:ml-[4rem]">
          <div
            data-testid="model-fixture-row"
            data-fixture-id={modelFixtureIdentity(modelFixture)}
            data-capability="priced"
            data-p-home={modelFixture.pHome}
            data-p-draw={modelFixture.pDraw}
            data-p-away={modelFixture.pAway}
            data-model-version={modelFixture.forecastProvenance?.modelVersion}
            data-forecast-at={modelFixture.forecastProvenance?.forecastAt}
          >
          <table className="w-full max-w-md table-fixed text-2xs tabular-nums" aria-label={`${match.homeTeam} versus ${match.awayTeam} forecast and market probabilities`}>
            <thead className="text-subtle">
              <tr>
                <th scope="col" className="w-[46%] pb-1 text-left font-medium uppercase tracking-wider">Source</th>
                <th scope="col" className="pb-1 text-right font-medium uppercase tracking-wider">Home</th>
                <th scope="col" className="pb-1 text-right font-medium uppercase tracking-wider">Draw</th>
                <th scope="col" className="pb-1 text-right font-medium uppercase tracking-wider">Away</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className="pr-2 text-left font-normal text-quiet">My forecast</th>
                <td className="text-right text-fg">{formatPercent(modelFixture.pHome)}</td>
                <td className="text-right text-fg">{formatPercent(modelFixture.pDraw)}</td>
                <td className="text-right text-fg">{formatPercent(modelFixture.pAway)}</td>
              </tr>
            </tbody>
          </table>
          </div>
          <details data-testid="fixture-goals" className="group mt-1.5 text-2xs text-quiet">
            <summary className="cursor-pointer select-none list-none uppercase tracking-wider text-subtle hover:text-fg [&::-webkit-details-marker]:hidden">
              <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>›</span> Goals and scorelines
            </summary>
            <div className="mt-1.5 grid max-w-md grid-cols-2 gap-x-6 gap-y-0.5 tabular-nums">
              <div className="space-y-0.5">
                {([
                  ["Over 2.5", modelFixture.pOver2_5],
                  ["Under 2.5", modelFixture.pUnder2_5],
                  ["BTTS Yes", modelFixture.pBttsYes],
                  ["BTTS No", modelFixture.pBttsNo],
                ] as const).map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-2">
                    <span>{label}</span>
                    <span className="text-fg">{formatPercent(value)}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-0.5">
                <div className="uppercase tracking-wider text-subtle">Likely scorelines</div>
                {modelFixture.topScores.slice(0, 3).map(({ score, probability }) => (
                  <div key={score} className="flex justify-between gap-2">
                    <span className="text-fg">{score}</span>
                    <span>{formatPercent(probability)}</span>
                  </div>
                ))}
              </div>
            </div>
            <SourcesToggle className="mt-1.5" testId="fixture-goals-sources">
              <p data-testid="totals-honesty">{goalForecastDisclosure(modelFixture.goalCalibration)}</p>
            </SourcesToggle>
          </details>
          {marketRows.length > 0 ? (
            <SourcesToggle className="mt-1.5" label="Market comparison" testId="fixture-market-sources">
              <table className="w-full max-w-md table-fixed text-2xs tabular-nums" aria-label={`${match.homeTeam} versus ${match.awayTeam} market comparison`}>
                <tbody>
                  {marketRows.map((row) => (
                    <tr key={row.id}>
                      <th scope="row" className="w-[46%] break-words pr-2 pt-1 text-left align-top font-normal">
                        <span className="block">{row.label}</span>
                        {row.observedAt && (
                          <time dateTime={row.observedAt} className="block text-[10px] leading-tight text-subtle">
                            {formatObservedAt(row.observedAt)}
                          </time>
                        )}
                      </th>
                      <td className="pt-1 text-right align-top">{formatPercent(row.pHome)}</td>
                      <td className="pt-1 text-right align-top">{formatPercent(row.pDraw)}</td>
                      <td className="pt-1 text-right align-top">{formatPercent(row.pAway)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SourcesToggle>
          ) : null}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 sm:ml-[4rem]">
        {askHref ? (
          <div className="min-w-0">
            <Link
              href={askHref}
              className="text-2xs font-semibold uppercase tracking-wider text-accent transition-colors hover:text-accent/80"
            >
              Ask about this match
            </Link>
            {recognized ? (
              <CapabilityText capability={recognized.capability} />
            ) : (
              <p className="mt-0.5 text-2xs text-quiet">
                Forecast status temporarily unavailable · you can still ask
              </p>
            )}
          </div>
        ) : (
          <span className="text-2xs text-quiet">{match.competition}</span>
        )}
        <span className="text-2xs uppercase tracking-wider text-subtle">
          {live ? "In play" : finished ? "Full time" : "Scheduled"}
        </span>
      </div>
    </div>
  );
}

function ProbabilityStrip({ home, draw, away }: { home: number; draw: number; away: number }) {
  return (
    <div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-elevated" aria-hidden>
        <span className="bg-accent" style={{ width: `${home * 100}%` }} />
        <span className="bg-quiet/60" style={{ width: `${draw * 100}%` }} />
        <span className="bg-fg/80" style={{ width: `${away * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-2xs tabular-nums text-quiet">
        <span>{Math.round(home * 100)}</span>
        <span>{Math.round(draw * 100)}</span>
        <span>{Math.round(away * 100)}</span>
      </div>
    </div>
  );
}

function CapabilityText({ capability }: { capability: FixtureCapability }) {
  const tone = capabilityTone(capability);
  return (
    <p className={cn(
      "mt-0.5 truncate text-2xs",
      tone === "ready" && "text-accent/80",
      tone === "waiting" && "text-warn",
      tone === "outside" && "text-quiet",
    )}>
      {capabilityLabel(capability)}
    </p>
  );
}

/** Premier League zones for 2026-27 (UCL top 4; 5th can be added by coefficient). */
function zoneFor(position: number, total: number): "ucl" | "europe" | "relegation" | null {
  if (position <= 4) return "ucl";
  if (position <= 6) return "europe";
  if (position > total - 3) return "relegation";
  return null;
}

const ZONE_CLASS = {
  ucl: "border-l-2 border-l-accent",
  europe: "border-l-2 border-l-quiet",
  relegation: "border-l-2 border-l-down",
} as const;

function FormMarks({ form }: { form?: Array<"W" | "D" | "L"> }) {
  if (!form?.length) return <span className="text-subtle">—</span>;
  return (
    <span className="inline-flex gap-0.5" aria-label={`Last ${form.length}: ${form.join(" ")}`}>
      {form.slice(-5).map((mark, index) => (
        <span
          key={index}
          aria-hidden
          className={cn(
            "flex size-4 items-center justify-center rounded-[3px] text-[9px] font-bold",
            mark === "W" ? "bg-up/20 text-up" : mark === "L" ? "bg-down/20 text-down" : "bg-elevated text-quiet",
          )}
        >
          {mark}
        </span>
      ))}
    </span>
  );
}

function LeagueTable({
  rows,
  form,
}: {
  rows: StandingResponse[];
  form: Map<string, Array<"W" | "D" | "L">>;
}) {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  return (
    <div className="overflow-x-auto">
      <table data-testid="league-table" className="w-full text-sm tabular-nums" aria-label="Premier League table">
        <thead>
          <tr className="border-b border-border text-2xs uppercase tracking-wider text-subtle">
            <th scope="col" className="w-8 py-2 pl-3 text-left font-semibold">#</th>
            <th scope="col" className="py-2 text-left font-semibold">Club</th>
            <th scope="col" className="px-1 py-2 text-right font-semibold">P</th>
            <th scope="col" className="px-1 py-2 text-right font-semibold">W</th>
            <th scope="col" className="px-1 py-2 text-right font-semibold">D</th>
            <th scope="col" className="px-1 py-2 text-right font-semibold">L</th>
            <th scope="col" className="hidden px-1 py-2 text-right font-semibold sm:table-cell">GF</th>
            <th scope="col" className="hidden px-1 py-2 text-right font-semibold sm:table-cell">GA</th>
            <th scope="col" className="px-1 py-2 text-right font-semibold">GD</th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">Pts</th>
            <th scope="col" className="hidden py-2 pr-3 text-left font-semibold md:table-cell">Form</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const zone = zoneFor(row.position, sorted.length);
            return (
              <tr key={row.team} data-testid="league-table-row" className={cn("border-b border-border last:border-b-0", zone && ZONE_CLASS[zone])}>
                <td className="py-1.5 pl-3 text-quiet">{row.position}</td>
                <td className="max-w-[9rem] py-1.5">
                  <span className="flex items-center gap-2">
                    <Monogram name={row.team} />
                    <span className="truncate font-medium">{row.team}</span>
                  </span>
                </td>
                <td className="px-1 py-1.5 text-right text-quiet">{row.playedGames}</td>
                <td className="px-1 py-1.5 text-right text-quiet">{row.won}</td>
                <td className="px-1 py-1.5 text-right text-quiet">{row.draw}</td>
                <td className="px-1 py-1.5 text-right text-quiet">{row.lost}</td>
                <td className="hidden px-1 py-1.5 text-right text-quiet sm:table-cell">{row.goalsFor}</td>
                <td className="hidden px-1 py-1.5 text-right text-quiet sm:table-cell">{row.goalsAgainst}</td>
                <td className="px-1 py-1.5 text-right">{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                <td className="px-2 py-1.5 text-right font-display text-base leading-none">{row.points}</td>
                <td className="hidden py-1.5 pr-3 md:table-cell"><FormMarks form={form.get(row.team)} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-2xs text-quiet">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-accent" aria-hidden />Champions League</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-quiet" aria-hidden />Europa / Conference League</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-down" aria-hidden />Relegation</span>
      </div>
    </div>
  );
}

function GroupTable({ group, rows }: { group: string; rows: StandingResponse[] }) {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  return (
    <DeskSection title={`Group ${group}`}>
      <table className="w-full text-sm tabular-nums">
        <tbody>
          {sorted.map((row) => (
            <tr key={row.team} className="border-b border-border last:border-b-0">
              <td className="w-8 py-1.5 pl-3 text-quiet">{row.position}</td>
              <td className="max-w-[9rem] truncate py-1.5">{row.team}</td>
              <td className="px-1 py-1.5 text-right text-quiet">{row.playedGames}</td>
              <td className="px-1 py-1.5 text-right">{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
              <td className="px-3 py-1.5 text-right font-display text-base leading-none">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DeskSection>
  );
}

function useLeagueTable() {
  const [rows, setRows] = useState<StandingResponse[]>([]);
  const [form, setForm] = useState<Map<string, Array<"W" | "D" | "L">>>(new Map());
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchStandings("eng.1"), fetchRecentMatches("eng.1")]).then(([standings, recent]) => {
      if (cancelled) return;
      setRows(standings.standings.filter((row) => !row.group && row.competitionId === "eng.1"));
      setLastUpdated(standings.lastUpdated);
      const clubForm: ClubFormResponse | undefined = recent.clubForm;
      setForm(new Map((clubForm?.teams ?? []).map((team) => [team.team, team.form])));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);
  return { rows, form, lastUpdated, loading };
}

function competitionTabClass(active: boolean) {
  return cn(
    "h-8 rounded-sm px-3 text-xs font-semibold uppercase tracking-wider transition-colors duration-150",
    active ? "bg-panel text-fg" : "text-quiet hover:text-fg",
  );
}

export default function FixturesPage() {
  const [competitions, setCompetitions] = useState<CompetitionResponse[]>([]);
  const [competitionError, setCompetitionError] = useState<string | null>(null);
  const [competitionRetry, setCompetitionRetry] = useState(0);
  const [selectedCompetition, setSelectedCompetition] = useState(ALL_TAB);
  const {
    matches,
    standings,
    recognized,
    modelFixtures,
    lastUpdated,
    error,
    coverageWarning,
    loading,
    sinceLast,
    reload,
  } =
    useFixturesData(selectedCompetition);
  const league = useLeagueTable();

  useEffect(() => {
    let cancelled = false;
    setCompetitionError(null);
    void fetchCompetitions().then((payload) => {
      if (!cancelled) {
        setCompetitions(payload.competitions.filter((competition) => competition.enabled));
      }
    }).catch((failure: unknown) => {
      if (!cancelled) {
        setCompetitionError(failure instanceof ApiError && failure.status === 429
          ? "Competition filters are temporarily limited. Please wait a moment, then retry."
          : "Competition filters are unavailable right now. Retry to load them.");
      }
    });
    return () => { cancelled = true; };
  }, [competitionRetry]);

  const enabledTabs = useMemo(
    () => [{ id: ALL_TAB, name: "All" }, ...competitions.map((c) => ({ id: c.id, name: c.name }))],
    [competitions]
  );

  const chronological = sortFixturesChronologically(matches);
  const recognizedById = recognizedFixtureMap(recognized);
  const modelById = new Map(modelFixtures.map((fixture) => [modelFixtureIdentity(fixture), fixture]));
  const days: Array<{ day: string; matches: MatchResponse[] }> = [];
  for (const match of chronological) {
    const day = dayHeading(match.utcDate);
    const last = days[days.length - 1];
    if (last?.day === day) last.matches.push(match);
    else days.push({ day, matches: [match] });
  }

  const groupedStandings = Array.from(
    new Set(standings.map((row) => row.group).filter(Boolean))
  ) as string[];
  groupedStandings.sort();
  const hasLive = matches.some((match) => match.status === "IN_PLAY");

  return (
    <DeskPage>
      <DeskPageHeader
        eyebrow="Schedule · results · table"
        title="Fixtures"
        subtitle={<><Disclaimer /> <span>{KICKOFF_TIME_NOTE}</span></>}
        right={hasLive ? (
          <span className="inline-flex items-center gap-1.5 text-2xs uppercase tracking-wider text-live" aria-live="polite">
            <span className="size-1.5 rounded-full bg-live live-dot" aria-hidden />
            Live · updated {sinceLast}s ago
          </span>
        ) : lastUpdated ? (
          <span className="text-2xs text-subtle">Updated {formatObservedAt(lastUpdated)}</span>
        ) : null}
      />

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Competition">
            {enabledTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={selectedCompetition === tab.id}
                onClick={() => setSelectedCompetition(tab.id)}
                className={competitionTabClass(selectedCompetition === tab.id)}
              >
                {tab.name}
              </button>
            ))}
          </div>

          {competitionError && (
            <ErrorBanner message={competitionError} onRetry={() => setCompetitionRetry((attempt) => attempt + 1)} />
          )}
          {coverageWarning && (
            <p className="text-2xs text-quiet">
              Some forecast or capability details are temporarily unavailable; the schedule remains current.
            </p>
          )}
          {error && <ErrorBanner message={error} onRetry={reload} />}

          <DeskSection title="Schedule and results" aside={loading ? "Loading…" : `${matches.length} matches`}>
            {loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="h-12 animate-pulse rounded-sm bg-elevated" />
                ))}
              </div>
            ) : matches.length === 0 ? (
              <EmptyState message="No fixture data available for this competition right now." />
            ) : (
              days.map((group) => (
                <div key={group.day}>
                  <h3 className="border-b border-border bg-elevated px-4 py-1.5 text-2xs font-semibold uppercase tracking-wider text-quiet">
                    {group.day}
                  </h3>
                  {group.matches.map((match) => (
                    <MatchRow
                      key={`${match.competitionId}-${match.id}`}
                      match={match}
                      recognized={recognizedById.get(modelFixtureIdentity({
                        competitionId: match.competitionId,
                        fixtureId: match.id,
                      }))}
                      modelFixture={modelById.get(modelFixtureIdentity({
                        competitionId: match.competitionId,
                        fixtureId: match.id,
                      }))}
                    />
                  ))}
                </div>
              ))
            )}
          </DeskSection>
        </div>

        <div className="min-w-0 space-y-3 lg:sticky lg:top-16 lg:self-start">
          <DeskSection
            title="Premier League table"
            aside={league.lastUpdated ? `Updated ${formatObservedAt(league.lastUpdated)}` : undefined}
          >
            {league.loading ? (
              <div className="h-64 animate-pulse bg-elevated/40" />
            ) : league.rows.length === 0 ? (
              <p className="px-4 py-3 text-sm text-quiet">The table is unavailable right now.</p>
            ) : (
              <LeagueTable rows={league.rows} form={league.form} />
            )}
          </DeskSection>
          {groupedStandings.map((group) => (
            <GroupTable key={group} group={group} rows={standings.filter((row) => row.group === group)} />
          ))}
          <SourcesToggle className="px-1">
            <p>Schedules, results, table and form: ESPN. Forecasts: our club-season model. Market comparison: Kalshi, Polymarket and Stake, shown only behind each match’s market comparison toggle.</p>
          </SourcesToggle>
        </div>
      </div>
    </DeskPage>
  );
}
