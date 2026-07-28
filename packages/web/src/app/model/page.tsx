"use client";

import { useEffect, useMemo, useState, Fragment } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fetchActiveModelFixtures, fetchCompetitions } from "@/lib/mock-data";
import { getReadiness } from "@/lib/api";
import type { ModelFixtureResponse } from "@/lib/api";
import { Disclaimer } from "@/components/disclaimer";
import { PageHeader } from "@/components/page-header";
import { ErrorBanner } from "@/components/error-banner";
import { EmptyState } from "@/components/empty-state";
import { FilterPill } from "@/components/filter-pill";

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function stageLabel(stage: string): string {
  return stage.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fixtureRowKey(fixture: ModelFixtureResponse): string {
  return `${fixture.competitionId}-${fixture.fixtureId}`;
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
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <PageHeader
        title="Club season model"
        subtitle="Live 1X2 probabilities for active Premier League and UCL qualifier fixtures, with home-field advantage where applicable."
        lastUpdated={lastUpdated}
        loading={loading}
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
        <section className="overflow-hidden rounded-lg border border-border bg-card">
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
          <div className="max-h-[70vh] overflow-auto">
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
                    <th>Home</th>
                    <th>Draw</th>
                    <th>Away</th>
                    <th>Status</th>
                    <th className="pr-3" aria-label="Ask about match" />
                  </tr>
                </thead>
                <tbody>
                  {filteredFixtures.map((fixture) => {
                    const key = fixtureRowKey(fixture);
                    const isExpanded = expanded.has(key);
                    const topScores = fixture.topScores.slice(0, 3);
                    return (
                      <Fragment key={key}>
                        <tr className="border-t border-border/60">
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() => toggleExpanded(key)}
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
                              {fixture.competition} · {fixture.date}
                              {fixture.stage !== "match" ? ` · ${stageLabel(fixture.stage)}` : ""}
                            </div>
                          </td>
                          <td className="font-mono text-muted-foreground">{percent(fixture.pHome)}</td>
                          <td className="font-mono text-muted-foreground">{percent(fixture.pDraw)}</td>
                          <td className="font-mono text-muted-foreground">{percent(fixture.pAway)}</td>
                          <td className="font-mono text-foreground">
                            {fixture.result ? `${fixture.result.homeScore}–${fixture.result.awayScore}` : "Upcoming"}
                          </td>
                          <td className="pr-3">
                            <Link
                              href={`/?q=${encodeURIComponent(`${fixture.home} vs ${fixture.away}`)}`}
                              className="text-xs font-semibold uppercase tracking-wide text-primary transition-colors hover:text-primary/80"
                            >
                              Ask
                            </Link>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-t border-border/40 bg-secondary/20">
                            <td colSpan={7} className="px-4 py-3">
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Goals
                                  </p>
                                  <p className="mt-1 text-sm text-foreground">
                                    Over 2.5 {percent(fixture.pOver2_5)} · Under 2.5 {percent(fixture.pUnder2_5)}
                                  </p>
                                  <p className="mt-0.5 text-sm text-foreground">
                                    BTTS Yes {percent(fixture.pBttsYes)} · No {percent(fixture.pBttsNo)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Likely scorelines
                                  </p>
                                  <ul className="mt-1 space-y-0.5 text-sm text-foreground">
                                    {topScores.map(({ score, probability }) => (
                                      <li key={score}>
                                        {score} · {percent(probability)}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
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
