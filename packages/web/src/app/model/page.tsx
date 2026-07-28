"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  getActiveModelFixtures,
  getCompetitions,
  type ModelFixtureResponse,
} from "@/lib/api";

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function stageLabel(stage: string): string {
  return stage.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function ModelPage() {
  const [fixtures, setFixtures] = useState<ModelFixtureResponse[]>([]);
  const [selectedCompetition, setSelectedCompetition] = useState<string>("all");
  const [competitions, setCompetitions] = useState<Array<{ id: string; name: string }>>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Model | Pundit";
    let cancelled = false;
    Promise.all([getActiveModelFixtures(), getCompetitions()])
      .then(([fixtureData, competitionData]) => {
        if (cancelled) return;
        setFixtures(fixtureData.fixtures);
        setLastUpdated(fixtureData.lastUpdated);
        setCompetitions(
          competitionData.competitions
            .filter((competition) => competition.enabled)
            .map((competition) => ({ id: competition.id, name: competition.name }))
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load model data.");
      });
    return () => {
      cancelled = true;
      document.title = "Pundit";
    };
  }, []);

  const filteredFixtures = useMemo(() => (
    selectedCompetition === "all"
      ? fixtures
      : fixtures.filter((fixture) => fixture.competitionId === selectedCompetition)
  ), [fixtures, selectedCompetition]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
              Local model
            </span>
            <span className="text-[10px] text-muted-foreground">Reference only · not tradeable</span>
          </div>
          <h1 className="font-heading text-2xl font-bold text-white">Club season model</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Live 1X2 probabilities for active Premier League and UCL qualifier fixtures,
            with home-field advantage where applicable.
            {" "}
            <Link href="/evaluation/wc-2026" className="text-cyan-400 hover:text-cyan-300">
              WC 2026 backtest →
            </Link>
          </p>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleString()}` : "Loading current run…"}
        </span>
      </div>

      {error ? (
        <div className="rounded-lg border border-pink-500/30 bg-pink-950 px-4 py-3 text-sm text-pink-200">
          {error}
        </div>
      ) : (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">Active fixtures</h2>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {filteredFixtures.length || "…"} upcoming matches with model 1X2 probabilities.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedCompetition("all")}
                  className={`rounded-full border px-3 py-1 text-[10px] ${
                    selectedCompetition === "all"
                      ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  All
                </button>
                {competitions.map((competition) => (
                  <button
                    key={competition.id}
                    type="button"
                    onClick={() => setSelectedCompetition(competition.id)}
                    className={`rounded-full border px-3 py-1 text-[10px] ${
                      selectedCompetition === competition.id
                        ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {competition.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-card text-[9px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Match</th>
                  <th>Home</th>
                  <th>Draw</th>
                  <th>Away</th>
                  <th className="pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredFixtures.map((fixture) => (
                  <tr key={`${fixture.competitionId}-${fixture.date}-${fixture.home}-${fixture.away}`} className="border-t border-border/60">
                    <td className="px-3 py-2">
                      <div className="font-medium text-foreground">{fixture.home} · {fixture.away}</div>
                      <div className="mt-0.5 text-[9px] text-muted-foreground">
                        {fixture.competition} · {fixture.date}
                        {fixture.stage !== "match" ? ` · ${stageLabel(fixture.stage)}` : ""}
                      </div>
                    </td>
                    <td className="font-mono text-muted-foreground">{percent(fixture.pHome)}</td>
                    <td className="font-mono text-muted-foreground">{percent(fixture.pDraw)}</td>
                    <td className="font-mono text-muted-foreground">{percent(fixture.pAway)}</td>
                    <td className="pr-3 font-mono text-foreground">
                      {fixture.result ? `${fixture.result.homeScore}–${fixture.result.awayScore}` : "Upcoming"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
