"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { getWc2026Evaluation, type Wc2026EvaluationResponse } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { ErrorBanner } from "@/components/error-banner";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function stageLabel(stage: string | null): string {
  if (!stage) return "Knockout";
  return stage.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function outcomeLabel(outcome: "home" | "draw" | "away", home: string, away: string): string {
  if (outcome === "home") return home;
  if (outcome === "away") return away;
  return "Draw";
}

export default function Wc2026EvaluationPage() {
  const [data, setData] = useState<Wc2026EvaluationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    getWc2026Evaluation()
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
        title="World Cup 2026 backtest"
        subtitle="Immutable pre-kickoff probabilities reconstructed for backtesting. Separate from the live model page, which recalculates older fixtures with current ratings."
        badge={(
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
              Frozen evaluation
            </span>
            <span className="rounded border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
              Reconstructed pre-kickoff
            </span>
          </div>
        )}
      />

      <div className="mb-6">
        <Link
          href="/model"
          className="text-xs text-primary transition-colors hover:text-primary/80"
        >
          ← Predictions
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
              Built {new Date(data.builtAt).toLocaleString()} · {data.metrics.fixtureCount} finished fixtures
            </p>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Brier score (1X2)" value={metrics ? metrics.brierScore.toFixed(4) : "—"} hint="Lower is better" />
            <MetricCard label="Log loss" value={metrics ? metrics.logLoss.toFixed(4) : "—"} hint="Lower is better" />
            <MetricCard label="Outcome accuracy" value={metrics ? percent(metrics.winnerAccuracy) : "—"} hint="Predicted 1X2 vs actual" />
            <MetricCard label="Draws" value={metrics ? String(metrics.drawCount) : "—"} hint="Finished matches" />
          </section>

          {metrics && metrics.calibration.length > 0 ? (
            <section className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-white">Calibration buckets</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Average predicted probability for the outcome that happened vs observed frequency.
                </p>
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
                        <td className="font-mono text-muted-foreground">{percent(bucket.avgPredicted)}</td>
                        <td className="pr-4 font-mono text-primary">{percent(bucket.actualRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-white">Fixture results vs model</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Pre-kickoff 1X2 probabilities and authoritative ESPN results.
              </p>
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
                    const correct = fixture.predictedOutcome === fixture.result.winner;
                    return (
                      <tr key={fixture.id} className="border-t border-border/60">
                        <td className="px-3 py-2">
                          <div className="font-medium text-foreground">
                            {fixture.home} · {fixture.away}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {fixture.utcDate.slice(0, 10)} · {stageLabel(fixture.stage)}
                          </div>
                        </td>
                        <td className="font-mono text-muted-foreground">{percent(fixture.pHome)}</td>
                        <td className="font-mono text-muted-foreground">{percent(fixture.pDraw)}</td>
                        <td className="font-mono text-muted-foreground">{percent(fixture.pAway)}</td>
                        <td className={`font-mono ${correct ? "text-emerald-400" : "text-muted-foreground"}`}>
                          <span className="inline-flex items-center gap-1">
                            {correct ? (
                              <Check className="size-3 text-emerald-400" aria-label="Correct" />
                            ) : (
                              <X className="size-3 text-muted-foreground" aria-label="Incorrect" />
                            )}
                            {outcomeLabel(fixture.predictedOutcome, fixture.home, fixture.away)}
                          </span>
                        </td>
                        <td className="pr-3 font-mono text-foreground">
                          {fixture.result.homeScore}–{fixture.result.awayScore}
                          {" "}
                          <span className="text-xs text-muted-foreground">
                            ({outcomeLabel(fixture.result.winner, fixture.home, fixture.away)})
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <dl className="rounded-lg border border-border bg-card px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-xl text-white">{value}</dd>
      <dd className="mt-1 text-xs text-muted-foreground">{hint}</dd>
    </dl>
  );
}
