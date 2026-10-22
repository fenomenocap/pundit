"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ClubSeasonEvaluationResponse } from "@/lib/api";
import { fetchClubSeasonEvaluation } from "@/lib/mock-data";
import { ErrorBanner } from "@/components/error-banner";
import { SourcesToggle } from "@/components/sources-toggle";
import { DeskPage, DeskPageHeader, DeskSection, DeskStat } from "@/components/desk-page";
import {
  SMALL_SAMPLE,
  UNIFORM_BASELINE,
  buildTrackRecord,
  favouredOutcome,
  probabilityFor,
  type TrackRecordRow,
} from "@/lib/track-record";
import { cn } from "@/lib/utils";
import { ClubCrest } from "@/desk/components/kit";
import { formalTeamName } from "@/desk/lib/data/teams";

const COMPETITION_NAME: Record<string, string> = {
  "eng.1": "Premier League",
  "uefa.champions_qual": "Champions League qualifying",
};

function pct(value: number | null, digits = 1) {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function num(value: number | null, digits = 3) {
  return value === null ? "—" : value.toFixed(digits);
}

function day(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso.endsWith("Z") ? iso : `${iso}Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "Europe/London",
  });
}

function outcomeName(row: TrackRecordRow, outcome: "home" | "draw" | "away") {
  return outcome === "home" ? formalTeamName(row.home) : outcome === "away" ? formalTeamName(row.away) : "Draw";
}

function versionLabel(version: string) {
  return /^\d+$/.test(version) ? `Version ${version}` : "Unversioned";
}

export default function TrackRecordPage() {
  const [data, setData] = useState<ClubSeasonEvaluationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchClubSeasonEvaluation()
      .then((response) => setData(response))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load the track record."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const record = useMemo(
    () => (data ? buildTrackRecord(data.fixtures as unknown as TrackRecordRow[]) : null),
    [data],
  );
  const current = record?.current;
  const matches = useMemo(() => [...(record?.counted ?? [])].reverse(), [record]);
  const earlier = (record?.segments ?? []).filter(
    (segment) => !(segment.modelVersion === current?.version && segment.competitionId === current?.competitionId),
  );

  return (
    <DeskPage>
      <DeskPageHeader
        eyebrow="Track record · club season"
        title="Track record"
        subtitle="How our pre-kickoff forecasts have done against final results. Each match is counted once, using the forecast sealed in the scheduled window before kickoff."
        right={data ? <span className="text-2xs text-subtle tabular-nums">Updated {day(data.updatedAt)}</span> : null}
      />

      <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-4 px-4 py-5 sm:px-6">
        {error ? <ErrorBanner message={error} onRetry={load} /> : null}

        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-md border border-border bg-surface" />
            ))}
          </div>
        ) : record && current ? (
          <>
            <section aria-labelledby="current-heading" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="current-heading" className="font-display text-xl uppercase tracking-wide">
                  Current forecasts · {COMPETITION_NAME[current.competitionId] ?? current.competitionId}
                </h2>
                {current.scores.n > 0 && current.scores.n < SMALL_SAMPLE ? (
                  <span data-testid="small-sample" className="rounded-xs border border-border px-1.5 py-0.5 text-2xs uppercase tracking-wider text-quiet">
                    Small sample
                  </span>
                ) : null}
              </div>
              {current.scores.n === 0 ? (
                <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-quiet">
                  No finished forecasts yet for the current version.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <DeskStat
                    label="Matches counted"
                    value={String(current.scores.n)}
                    note={`${day(current.scores.from)} – ${day(current.scores.to)}, one forecast per match.`}
                  />
                  <DeskStat
                    label="Favourite won"
                    value={pct(current.scores.hitRate, 0)}
                    note="Share of matches where our most likely result happened."
                  />
                  <DeskStat
                    label="Brier score (1X2)"
                    value={num(current.scores.brier)}
                    note={`Lower is better. Guessing a third for each result scores ${UNIFORM_BASELINE.brier.toFixed(3)}.`}
                  />
                  <DeskStat
                    label="Log loss"
                    value={num(current.scores.logLoss)}
                    note={`Lower is better. Guessing a third for each result scores ${UNIFORM_BASELINE.logLoss.toFixed(3)}.`}
                  />
                </div>
              )}
            </section>

            {current.calibration.length > 0 ? (
              <DeskSection title="Calibration · current forecasts" aside={`${current.scores.n} matches × 3 outcomes`}>
                <p className="px-4 pt-3 text-2xs leading-5 text-quiet">
                  Every match has three outcomes (home, draw, away), so each match is scored three times here. When we
                  say 40–60%, that result should happen about half the time.
                </p>
                <div className="overflow-x-auto">
                  <table className="mt-2 w-full text-sm tabular-nums">
                    <thead>
                      <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-subtle">
                        <th scope="col" className="px-4 py-2 font-semibold">Our probability</th>
                        <th scope="col" className="px-2 py-2 text-right font-semibold">Outcomes scored</th>
                        <th scope="col" className="px-2 py-2 text-right font-semibold">Average forecast</th>
                        <th scope="col" className="px-4 py-2 text-right font-semibold">Happened</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.calibration.map((bucket) => (
                        <tr key={bucket.label} className="border-b border-border last:border-b-0">
                          <td className="px-4 py-2">{bucket.label}</td>
                          <td className="px-2 py-2 text-right text-quiet">{bucket.count}</td>
                          <td className="px-2 py-2 text-right">{pct(bucket.avgPredicted)}</td>
                          <td className="px-4 py-2 text-right">{pct(bucket.actualRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DeskSection>
            ) : null}

            {earlier.length > 0 ? (
              <DeskSection title="Earlier versions" aside="Shown separately, never added together">
                <details data-testid="earlier-versions" className="group">
                  <summary className="cursor-pointer list-none px-4 py-2.5 text-sm text-quiet hover:text-fg [&::-webkit-details-marker]:hidden">
                    <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>›</span>{" "}
                    {earlier.length} earlier {earlier.length === 1 ? "group" : "groups"} of forecasts
                  </summary>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm tabular-nums">
                      <thead>
                        <tr className="border-y border-border text-left text-2xs uppercase tracking-wider text-subtle">
                          <th scope="col" className="px-4 py-2 font-semibold">Version</th>
                          <th scope="col" className="px-2 py-2 font-semibold">Competition</th>
                          <th scope="col" className="px-2 py-2 text-right font-semibold">Matches</th>
                          <th scope="col" className="px-2 py-2 text-right font-semibold">Favourite won</th>
                          <th scope="col" className="px-2 py-2 text-right font-semibold">Brier</th>
                          <th scope="col" className="px-4 py-2 text-right font-semibold">Log loss</th>
                        </tr>
                      </thead>
                      <tbody>
                        {earlier.map((segment) => (
                          <tr key={`${segment.modelVersion}-${segment.competitionId}`} className="border-b border-border last:border-b-0">
                            <td className="px-4 py-2">{versionLabel(segment.modelVersion)}</td>
                            <td className="px-2 py-2 text-quiet">{COMPETITION_NAME[segment.competitionId] ?? segment.competitionId}</td>
                            <td className="px-2 py-2 text-right">{segment.scores.n}</td>
                            <td className="px-2 py-2 text-right">{pct(segment.scores.hitRate, 0)}</td>
                            <td className="px-2 py-2 text-right">{num(segment.scores.brier)}</td>
                            <td className="px-4 py-2 text-right">{num(segment.scores.logLoss)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </DeskSection>
            ) : null}

            <DeskSection
              title="Matches"
              aside={`${record.counted.length} matches · each counted once`}
            >
              {matches.length === 0 ? (
                <p className="px-4 py-3 text-sm text-quiet">No finished matches yet.</p>
              ) : (
                <div className="max-h-[32rem] overflow-auto">
                  <table data-testid="track-record-matches" className="w-full text-sm tabular-nums">
                    <thead className="sticky top-0 bg-surface">
                      <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-subtle">
                        <th scope="col" className="px-4 py-2 font-semibold">Date</th>
                        <th scope="col" className="px-2 py-2 font-semibold">Match</th>
                        <th scope="col" className="hidden px-2 py-2 text-right font-semibold sm:table-cell">Home / Draw / Away</th>
                        <th scope="col" className="px-2 py-2 text-right font-semibold">Result</th>
                        <th scope="col" className="px-4 py-2 text-right font-semibold">Favourite</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matches.map((row) => {
                        const favourite = favouredOutcome(row);
                        const hit = row.result?.winner === favourite;
                        return (
                          <tr
                            key={`${row.competitionId}:${row.fixtureId}`}
                            data-testid="track-record-row"
                            data-fixture-key={`${row.competitionId}:${row.fixtureId}`}
                            className="border-b border-border last:border-b-0"
                          >
                            <td className="whitespace-nowrap px-4 py-2 text-quiet">{day(row.utcDate)}</td>
                            <td className="px-2 py-2">
                              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                <ClubCrest name={row.home} size="sm" />
                                <span className="truncate">{formalTeamName(row.home)}</span>
                                <span className="text-subtle">v</span>
                                <ClubCrest name={row.away} size="sm" />
                                <span className="truncate">{formalTeamName(row.away)}</span>
                              </span>
                              <span className="block text-2xs text-subtle">
                                {COMPETITION_NAME[row.competitionId] ?? row.competitionId}
                                {row.modelVersion ? ` · ${versionLabel(row.modelVersion)}` : ""}
                              </span>
                            </td>
                            <td className="hidden whitespace-nowrap px-2 py-2 text-right sm:table-cell">
                              {pct(row.pHome, 0)} / {pct(row.pDraw, 0)} / {pct(row.pAway, 0)}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2 text-right">
                              {row.result ? `${row.result.homeScore}–${row.result.awayScore}` : "—"}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2 text-right">
                              <span className="text-quiet">{outcomeName(row, favourite)} {pct(probabilityFor(row, favourite), 0)}</span>{" "}
                              <span className={cn("text-2xs font-semibold uppercase tracking-wider", hit ? "text-up" : "text-down")}>
                                {hit ? "Won" : "Lost"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {record.notCounted + record.duplicatesRemoved > 0 ? (
                <p className="border-t border-border px-4 py-2.5 text-2xs leading-5 text-quiet">
                  Not counted: {record.notCounted} ledger {record.notCounted === 1 ? "row" : "rows"} sealed outside the
                  scheduled pre-kickoff window or without full records
                  {record.duplicatesRemoved > 0 ? `, and ${record.duplicatesRemoved} repeat forecasts for a match already counted` : ""}.
                  The ledger keeps every row; only the scoring skips them.
                </p>
              ) : null}
            </DeskSection>
          </>
        ) : null}

        <DeskSection id="methodology" title="How the forecasts work">
          <div className="grid gap-3 px-4 py-3 text-sm leading-relaxed text-quiet">
            <p>
              <span className="text-fg">Team strength.</span> Each club has a strength rating built from its past
              results, with a home advantage added. The gap between the two sides sets the home, draw and away chances.
            </p>
            <p>
              <span className="text-fg">Goals.</span> I estimate goals from historical scoring and team strength;
              these are forecasts, not guarantees. Over/under 2.5, both teams to score, expected goals and the
              projected score all come from one table of scoreline chances, so they always agree with each other.
            </p>
            <p>
              <span className="text-fg">Projected score.</span> The likeliest scoreline within the most likely result. The
              single likeliest score on the whole table is shown as a second line when it differs (often 1-1, because
              draws concentrate in one score while wins are spread over several). It is not a prediction of the exact
              score: even the single likeliest score usually has well under a one-in-five chance.
            </p>
            <p>
              <span className="text-fg">Markets.</span> Market prices are shown only for comparison. They are never
              an input, and we make no claim of beating them: on long historical tests the forecasts trail closing
              market prices.
            </p>
            <p>
              <span className="text-fg">What counts here.</span> A forecast is sealed in a fixed window before kickoff
              and never edited. Each match is scored once. Earlier versions are listed separately and never pooled with
              the current one.
            </p>
            <p>
              <Link href="/evaluation/wc-2026" className="text-fg underline-offset-4 hover:underline">
                World Cup 2026 backtest
              </Link>{" "}
              <span className="text-subtle">(reconstructed after the event, historical; not part of this record)</span>
            </p>
          </div>
          <div className="border-t border-border px-4 py-2.5">
            <SourcesToggle testId="track-record-sources">
              <p>Ratings: ClubElo club ratings, pinned snapshot. Goals: calibrated Dixon–Coles score grid anchored to the rating 1X2.</p>
              <p>Fixtures, results and tables: ESPN. Market comparison only: Kalshi, Polymarket and Stake.</p>
              {data ? <p>{data.disclaimer}</p> : null}
            </SourcesToggle>
          </div>
        </DeskSection>
      </div>
    </DeskPage>
  );
}
