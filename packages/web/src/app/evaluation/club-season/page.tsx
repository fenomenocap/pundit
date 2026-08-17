"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { type ClubSeasonEvaluationResponse } from "@/lib/api";
import { fetchClubSeasonEvaluation } from "@/lib/mock-data";
import { PageHeader } from "@/components/page-header";
import { ErrorBanner } from "@/components/error-banner";
import { MetricCard } from "@/components/metric-card";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function outcomeLabel(outcome: "home" | "draw" | "away", home: string, away: string): string {
  if (outcome === "home") return home;
  if (outcome === "away") return away;
  return "Draw";
}

function CalibrationBar({ avgPredicted, actualRate }: { avgPredicted: number; actualRate: number }) {
  const max = Math.max(avgPredicted, actualRate, 0.001);
  return (
    <div
      role="img"
      aria-label={`Predicted ${percent(avgPredicted)} versus actual ${percent(actualRate)}`}
      className="flex h-1.5 w-32 items-center gap-1.5"
    >
      <span
        aria-hidden="true"
        className="h-1.5 rounded-full bg-muted-foreground/60"
        style={{ width: `${(avgPredicted / max) * 100}%` }}
      />
      <span
        aria-hidden="true"
        className="h-1.5 rounded-full bg-primary"
        style={{ width: `${(actualRate / max) * 100}%` }}
      />
    </div>
  );
}

export default function ClubSeasonEvaluationPage() {
  const [data, setData] = useState<ClubSeasonEvaluationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchClubSeasonEvaluation()
      .then((response) => setData(response))
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Could not load evaluation data.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const metrics = data?.metrics;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <PageHeader
        title="Club season calibration"
        eyebrow="Rolling snapshots · Premier League & UCL qualifiers"
        badge={(
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded border border-primary/25 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              Rolling snapshots
            </span>
            <span className="rounded border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Premier League &amp; UCL qualifiers
            </span>
          </div>
        )}
      />
      <p className="mb-6 -mt-4 max-w-2xl text-lg leading-snug text-foreground">
        Immutable Fundamental forecasts sealed inside the 90-minute pre-kickoff window. Separate from the live model page, which recalculates with current ratings.
      </p>

      <div className="mb-6 flex flex-wrap gap-4">
        <Link href="/model" className="text-xs text-primary transition-colors hover:text-primary/80">
          ← Model reference
        </Link>
        <Link href="/evaluation/wc-2026" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
          WC 2026 backtest
        </Link>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading ? (
        <div className="grid gap-6">
          <div className="h-20 animate-pulse rounded-lg bg-card" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-lg bg-card" />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-lg bg-card" />
        </div>
      ) : data ? (
        <div className="grid gap-6">
          <section className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs leading-relaxed text-muted-foreground">{data.disclaimer}</p>
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              Updated {new Date(data.updatedAt).toLocaleString()} · {data.metrics.fixtureCount} finished snapshots
            </p>
          </section>

          {metrics && metrics.fixtureCount > 0 ? (
            <>
              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="Brier score (1X2)" value={metrics.brierScore?.toFixed(4) ?? "—"} hint="Lower is better" />
                <MetricCard label="Log loss" value={metrics.logLoss?.toFixed(4) ?? "—"} hint="Lower is better" />
                <MetricCard label="Outcome accuracy" value={metrics.winnerAccuracy === null ? "—" : percent(metrics.winnerAccuracy)} hint="Predicted 1X2 vs actual" />
                <MetricCard label="Draws" value={String(metrics.drawCount)} hint="Finished matches" />
              </section>

              {metrics.calibration.length > 0 ? (
                <section className="overflow-hidden rounded-lg border border-border bg-card">
                  <div className="border-b border-border px-4 py-3">
                    <h2 className="text-sm font-semibold text-foreground">Calibration buckets</h2>
                  </div>
                  <div className="overflow-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2">Bucket</th>
                          <th>Fixtures</th>
                          <th>Avg predicted</th>
                          <th className="pr-4">Actual rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.calibration.map((bucket) => (
                          <tr key={bucket.label} className="border-t border-border/60">
                            <td className="px-4 py-2 text-foreground">{bucket.label}</td>
                            <td className="font-mono text-muted-foreground">{bucket.count}</td>
                            <td className="font-mono text-muted-foreground">
                              <span className="inline-flex items-center gap-2">
                                {percent(bucket.avgPredicted)}
                                <CalibrationBar avgPredicted={bucket.avgPredicted} actualRate={bucket.actualRate} />
                              </span>
                            </td>
                            <td className="pr-4 font-mono text-primary">
                              <span className="inline-flex items-center gap-2">
                                <span>{percent(bucket.actualRate)}</span>
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <section className="rounded-lg border border-border bg-card p-6 text-center">
              <p className="text-sm text-muted-foreground">
                No finished forecasts yet. Eligible probabilities are sealed before kickoff; unavailable checkpoints are recorded rather than reconstructed later.
              </p>
            </section>
          )}

          {data.fixtures.length > 0 ? (
            <section className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">Snapshotted fixtures</h2>
              </div>
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Match</th>
                      <th>Home</th>
                      <th>Draw</th>
                      <th>Away</th>
                      <th>Pred</th>
                      <th className="pr-3">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.fixtures].reverse().map((fixture) => {
                      const predicted = fixture.pHome >= fixture.pDraw && fixture.pHome >= fixture.pAway
                        ? "home"
                        : fixture.pDraw >= fixture.pAway ? "draw" : "away";
                      const actual = fixture.result?.winner;
                      const correct = actual ? predicted === actual : false;
                      return (
                        <tr key={`${fixture.competitionId}-${fixture.fixtureId}`} className="border-t border-border/60">
                          <td className="px-3 py-2">
                            <div className="font-medium text-foreground">{fixture.home} · {fixture.away}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {fixture.date} · {fixture.competitionId}
                            </div>
                          </td>
                          <td className="font-mono text-muted-foreground">{percent(fixture.pHome)}</td>
                          <td className="font-mono text-muted-foreground">{percent(fixture.pDraw)}</td>
                          <td className="font-mono text-muted-foreground">{percent(fixture.pAway)}</td>
                          <td className={`font-mono ${correct ? "text-emerald-400" : "text-muted-foreground"}`}>
                            {actual ? (
                              <span className="inline-flex items-center gap-1">
                                {correct ? (
                                  <Check className="size-3 text-emerald-400" aria-label="Correct" />
                                ) : (
                                  <X className="size-3 text-muted-foreground" aria-label="Incorrect" />
                                )}
                                {outcomeLabel(predicted, fixture.home, fixture.away)}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="pr-3 font-mono text-foreground">
                            {fixture.result
                              ? `${fixture.result.homeScore}–${fixture.result.awayScore}`
                              : "Pending"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
