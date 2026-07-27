"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getWc2026Evaluation, type Wc2026EvaluationResponse } from "@/lib/api";

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

  useEffect(() => {
    document.title = "WC 2026 Evaluation | Pundit";
    let cancelled = false;
    getWc2026Evaluation()
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Could not load evaluation data.");
        }
      });
    return () => {
      cancelled = true;
      document.title = "Pundit";
    };
  }, []);

  const metrics = data?.metrics;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              Frozen evaluation
            </span>
            <span className="rounded border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
              Reconstructed pre-kickoff
            </span>
          </div>
          <h1 className="font-heading text-2xl font-bold text-white">World Cup 2026 backtest</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Immutable pre-kickoff probabilities rebuilt from eloratings.net World ratings and
            Dixon-Coles at neutral venues. This is separate from the live model page, which
            recalculates older fixtures with current Elo.
          </p>
        </div>
        <Link
          href="/model"
          className="text-xs text-cyan-400 transition-colors hover:text-cyan-300"
        >
          ← Live model reference
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-pink-500/30 bg-pink-950 px-4 py-3 text-sm text-pink-200">
          {error}
        </div>
      ) : !data ? (
        <div className="text-sm text-muted-foreground">Loading evaluation…</div>
      ) : (
        <div className="grid gap-6">
          <section className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs leading-relaxed text-muted-foreground">{data.disclaimer}</p>
            <p className="mt-2 font-mono text-[10px] text-muted-foreground">
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
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Average predicted probability for the outcome that happened vs observed frequency.
                </p>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="text-[9px] uppercase tracking-wide text-muted-foreground">
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
                        <td className="pr-4 font-mono text-cyan-300">{percent(bucket.actualRate)}</td>
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
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Pre-kickoff 1X2 probabilities and authoritative ESPN results.
              </p>
            </div>
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-card text-[9px] uppercase tracking-wide text-muted-foreground">
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
                          <div className="mt-0.5 text-[9px] text-muted-foreground">
                            {fixture.utcDate.slice(0, 10)} · {stageLabel(fixture.stage)}
                          </div>
                        </td>
                        <td className="font-mono text-muted-foreground">{percent(fixture.pHome)}</td>
                        <td className="font-mono text-muted-foreground">{percent(fixture.pDraw)}</td>
                        <td className="font-mono text-muted-foreground">{percent(fixture.pAway)}</td>
                        <td className={`font-mono ${correct ? "text-emerald-400" : "text-muted-foreground"}`}>
                          {outcomeLabel(fixture.predictedOutcome, fixture.home, fixture.away)}
                        </td>
                        <td className="pr-3 font-mono text-foreground">
                          {fixture.result.homeScore}–{fixture.result.awayScore}
                          {" "}
                          <span className="text-[9px] text-muted-foreground">
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
      )}
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
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-xl text-white">{value}</div>
      <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>
    </div>
  );
}
