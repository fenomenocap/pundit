"use client";

import { useEffect, useMemo, useState, Fragment } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fetchActiveModelFixtures, fetchCompetitions } from "@/lib/mock-data";
import { buildAskUrl, getReadiness, modelFixtureIdentity } from "@/lib/api";
import type { ModelFixtureResponse } from "@/lib/api";
import { Disclaimer } from "@/components/disclaimer";
import { PageHeader } from "@/components/page-header";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { FilterPill } from "@/components/filter-pill";
import { ProbabilityBar } from "@/components/probability-bar";

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function stageLabel(stage: string): string {
  return stage.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fixtureRowKey(fixture: ModelFixtureResponse): string {
  return `${fixture.competitionId}-${fixture.fixtureId}`;
}

function kickoffTime(utcDate: string): string {
  return new Date(utcDate).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function kickoffDay(utcDate: string): string {
  return new Date(utcDate).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function marketComparisonRows(fixture: ModelFixtureResponse) {
  const rows: Array<{ label: string; pHome: number; pDraw: number | null; pAway: number }> = [];
  if (
    fixture.stakePHome !== null
    && fixture.stakePDraw !== null
    && fixture.stakePAway !== null
  ) {
    rows.push({
      label: "Stake",
      pHome: fixture.stakePHome,
      pDraw: fixture.stakePDraw,
      pAway: fixture.stakePAway,
    });
  }
  for (const source of fixture.oddsSources ?? []) {
    rows.push({
      label: source.source === "kalshi" ? "Kalshi" : "Polymarket",
      pHome: source.pHome,
      pDraw: source.pDraw,
      pAway: source.pAway,
    });
  }
  return rows;
}

export default function ModelPage() {
  const [fixtures, setFixtures] = useState<ModelFixtureResponse[]>([]);
  const [selectedCompetition, setSelectedCompetition] = useState<string>("all");
  const [competitions, setCompetitions] = useState<Array<{ id: string; name: string }>>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [modelReady, setModelReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = () => {
    setLoading(true);
    Promise.all([fetchActiveModelFixtures(), fetchCompetitions(), getReadiness().catch(() => null)])
      .then(([fixtureData, competitionData, readiness]) => {
        setFixtures(fixtureData.fixtures);
        setLastUpdated(fixtureData.lastUpdated);
        setError(fixtureData.error);
        setModelReady(readiness?.model.ready ?? null);
        setCompetitions(
          competitionData.competitions
            .filter((competition) => competition.enabled)
            .map((competition) => ({ id: competition.id, name: competition.name }))
        );
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Could not load model data.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const filteredFixtures = useMemo(() => (
    selectedCompetition === "all"
      ? fixtures
      : fixtures.filter((fixture) => fixture.competitionId === selectedCompetition)
  ), [fixtures, selectedCompetition]);

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Club season model"
        eyebrow="Predictions · Active fixtures"
        subtitle="Live 1X2 probabilities for active Premier League and UCL qualifier fixtures, with home-field advantage where applicable."
        lastUpdated={lastUpdated}
        loading={loading}
        sticky
        badge={(
          <span className="mb-2 inline-block rounded border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
            Local model
          </span>
        )}
      />

      <p className="-mt-4 mb-6 text-xs text-muted-foreground">
        <Disclaimer />
        {modelReady !== null && (
          <span className="ml-2 text-muted-foreground/80">
            · Model cache {modelReady ? "ready" : "loading"}
          </span>
        )}
      </p>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {!error && (
        <section className="overflow-hidden rounded-xl border border-card-rim bg-card shadow-card">
          <div className="border-b border-border px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">Active fixtures</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {loading ? "…" : filteredFixtures.length} upcoming matches with model 1X2 probabilities.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <FilterPill
                  label="All"
                  active={selectedCompetition === "all"}
                  onClick={() => setSelectedCompetition("all")}
                />
                {competitions.map((competition) => (
                  <FilterPill
                    key={competition.id}
                    label={competition.name}
                    active={selectedCompetition === competition.id}
                    onClick={() => setSelectedCompetition(competition.id)}
                  />
                ))}
              </div>
            </div>
          </div>
          <p id="model-scroll-hint" className="px-4 py-2 text-xs text-muted-foreground sm:hidden">
            Scroll the table sideways for more columns and match actions.
          </p>
          <div
            role="region"
            aria-label="Active fixtures results"
            aria-describedby="model-scroll-hint"
            tabIndex={0}
            className="max-h-[70vh] overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          >
            {loading ? (
              <div className="space-y-0">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className="border-t border-border/60 px-3 py-4">
                    <div className="h-4 w-48 animate-pulse rounded bg-secondary" />
                    <div className="mt-2 h-3 w-32 animate-pulse rounded bg-secondary/60" />
                  </div>
                ))}
              </div>
            ) : filteredFixtures.length === 0 ? (
              <EmptyState
                message="No upcoming fixtures in the next 14 days — the model window may be between rounds or off-season. Try a table question in chat or browse standings."
                actionLabel="View fixtures & standings"
                actionHref="/fixtures"
                className="border-0 bg-transparent"
              />
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-8 px-2 py-2" aria-label="Expand" />
                    <th className="px-1 py-2">Match</th>
                    <th className="hidden px-1 py-2 sm:table-cell">Stage</th>
                    <th className="px-1 py-2">Kickoff</th>
                    <th className="min-w-[140px] px-3 py-2">1X2</th>
                    <th className="px-1 py-2">Status</th>
                    <th className="pr-3" aria-label="Ask about match" />
                  </tr>
                </thead>
                <tbody>
                  {filteredFixtures.map((fixture) => {
                    const key = fixtureRowKey(fixture);
                    const isExpanded = expanded.has(key);
                    const topScores = fixture.topScores.slice(0, 3);
                    const markets = marketComparisonRows(fixture);
                    return (
                      <Fragment key={key}>
                        <tr
                          className="cursor-pointer border-t border-border/60 transition-colors hover:bg-secondary/30"
                          onClick={() => toggleExpanded(key)}
                          aria-expanded={isExpanded}
                        >
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleExpanded(key);
                              }}
                              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                              aria-expanded={isExpanded}
                              aria-label={isExpanded ? "Collapse details" : "Expand details"}
                            >
                              {isExpanded ? (
                                <ChevronDown className="size-4" />
                              ) : (
                                <ChevronRight className="size-4" />
                              )}
                            </button>
                          </td>
                          <td className="px-1 py-2">
                            <div className="font-medium text-foreground">{fixture.home} · {fixture.away}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {fixture.competition}
                            </div>
                          </td>
                          <td className="hidden px-1 py-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground sm:table-cell">
                            {fixture.stage !== "match" ? stageLabel(fixture.stage) : "—"}
                          </td>
                          <td className="px-1 py-2 font-mono text-xs text-foreground">
                            <div className="leading-tight">{kickoffTime(fixture.utcDate)}</div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {kickoffDay(fixture.utcDate)}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <ProbabilityBar
                              pHome={fixture.pHome}
                              pDraw={fixture.pDraw}
                              pAway={fixture.pAway}
                              size="sm"
                              homeLabel={fixture.home}
                              awayLabel={fixture.away}
                            />
                            <div className="mt-1 grid grid-cols-3 gap-1 font-mono text-[10px] tabular-nums text-muted-foreground">
                              <span className="text-primary">{percent(fixture.pHome)}</span>
                              <span className="text-center text-slate-300">{percent(fixture.pDraw)}</span>
                              <span className="text-right text-pink-400">{percent(fixture.pAway)}</span>
                            </div>
                          </td>
                          <td className="font-mono text-foreground">
                            {fixture.result ? `${fixture.result.homeScore}–${fixture.result.awayScore}` : "Upcoming"}
                          </td>
                          <td className="pr-3">
                            <Link
                              href={buildAskUrl(
                                `${fixture.home} vs ${fixture.away}`,
                                modelFixtureIdentity(fixture)
                              )}
                              className="text-xs font-semibold uppercase tracking-wide text-primary transition-colors hover:text-primary/80"
                              onClick={(event) => event.stopPropagation()}
                            >
                              Ask
                            </Link>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-t border-border/40 bg-secondary/20">
                            <td colSpan={7} className="px-4 py-3">
                              <div className={`grid gap-4 sm:grid-cols-2 ${markets.length > 0 ? "lg:grid-cols-3" : ""} sm:divide-x sm:divide-border/60`}>
                                <div className="space-y-1">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Goals
                                  </p>
                                  <div className="flex items-center justify-between font-mono text-sm tabular-nums">
                                    <span className="text-muted-foreground">Over 2.5</span>
                                    <span className="text-foreground">{percent(fixture.pOver2_5)}</span>
                                  </div>
                                  <div className="flex items-center justify-between font-mono text-sm tabular-nums">
                                    <span className="text-muted-foreground">Under 2.5</span>
                                    <span className="text-foreground">{percent(fixture.pUnder2_5)}</span>
                                  </div>
                                  <div className="flex items-center justify-between font-mono text-sm tabular-nums">
                                    <span className="text-muted-foreground">BTTS Yes</span>
                                    <span className="text-foreground">{percent(fixture.pBttsYes)}</span>
                                  </div>
                                  <div className="flex items-center justify-between font-mono text-sm tabular-nums">
                                    <span className="text-muted-foreground">BTTS No</span>
                                    <span className="text-foreground">{percent(fixture.pBttsNo)}</span>
                                  </div>
                                </div>
                                <div className="space-y-1 sm:pl-4">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Likely scorelines
                                  </p>
                                  <ul className="space-y-0.5 font-mono text-sm tabular-nums">
                                    {topScores.map(({ score, probability }) => (
                                      <li
                                        key={score}
                                        className="flex items-center justify-between"
                                      >
                                        <span className="text-foreground">{score}</span>
                                        <span className="text-muted-foreground">{percent(probability)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                {markets.length > 0 && (
                                  <div className="space-y-1 sm:pl-4">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                      Markets
                                    </p>
                                    <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-x-3 gap-y-0.5 font-mono text-sm tabular-nums">
                                      <span />
                                      <span className="text-right text-[10px] uppercase tracking-wide text-muted-foreground">Home</span>
                                      <span className="text-right text-[10px] uppercase tracking-wide text-muted-foreground">Draw</span>
                                      <span className="text-right text-[10px] uppercase tracking-wide text-muted-foreground">Away</span>
                                      <span className="text-muted-foreground">Model</span>
                                      <span className="text-right text-foreground">{percent(fixture.pHome)}</span>
                                      <span className="text-right text-foreground">{percent(fixture.pDraw)}</span>
                                      <span className="text-right text-foreground">{percent(fixture.pAway)}</span>
                                      {markets.map((row) => (
                                        <Fragment key={row.label}>
                                          <span className="text-muted-foreground">{row.label}</span>
                                          <span className="text-right text-foreground">{percent(row.pHome)}</span>
                                          <span className="text-right text-foreground">{percent(row.pDraw)}</span>
                                          <span className="text-right text-foreground">{percent(row.pAway)}</span>
                                        </Fragment>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        <Link href="/evaluation/club-season" className="text-primary hover:text-primary/80">
          Club season calibration
        </Link>
        {" · "}
        <Link href="/evaluation/wc-2026" className="text-primary hover:text-primary/80">
          WC 2026 backtest
        </Link>
      </p>
    </div>
  );
}
