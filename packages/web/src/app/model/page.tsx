"use client";

import { useEffect, useState } from "react";
import {
  getModelFixtures,
  getModelProbabilities,
  type ModelFixtureResponse,
  type ModelTeamResponse,
} from "@/lib/api";

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function stageLabel(stage: string): string {
  return stage.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function ModelPage() {
  const [teams, setTeams] = useState<ModelTeamResponse[]>([]);
  const [fixtures, setFixtures] = useState<ModelFixtureResponse[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Model | Pundit";
    let cancelled = false;
    Promise.all([getModelProbabilities(), getModelFixtures()])
      .then(([probabilities, fixtureData]) => {
        if (cancelled) return;
        setTeams(probabilities.teams);
        setFixtures(fixtureData.fixtures);
        setLastUpdated(probabilities.lastUpdated ?? fixtureData.lastUpdated);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load model data.");
      });
    return () => {
      cancelled = true;
      document.title = "Pundit";
    };
  }, []);

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
          <h1 className="font-heading text-2xl font-bold text-white">World Cup model</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Live Elo ratings, a Dixon-Coles score model, and 100,000 Poisson tournament simulations run inside Pundit.
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
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-white">Title probabilities</h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground">All 48 teams, ordered by championship probability.</p>
            </div>
            <div className="max-h-[65vh] overflow-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-card text-[9px] uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-3 py-2">Team</th><th>Win</th><th>SF</th><th>QF</th><th className="pr-3">Market</th></tr>
                </thead>
                <tbody>
                  {teams.map((team) => (
                    <tr key={team.team} className="border-t border-border/60">
                      <td className="px-3 py-2 font-medium text-foreground">{team.team}</td>
                      <td className="font-mono text-cyan-300">{percent(team.winProb)}</td>
                      <td className="font-mono text-muted-foreground">{percent(team.sfProb)}</td>
                      <td className="font-mono text-muted-foreground">{percent(team.qfProb)}</td>
                      <td className="pr-3 font-mono text-muted-foreground">{percent(team.marketPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-white">Fixture model history</h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {fixtures.length || "…"} fixtures with model 1X2 probabilities and authoritative results.
              </p>
            </div>
            <div className="max-h-[65vh] overflow-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-card text-[9px] uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-3 py-2">Match</th><th>Home</th><th>Draw</th><th>Away</th><th className="pr-3">Result</th></tr>
                </thead>
                <tbody>
                  {[...fixtures].reverse().map((fixture) => (
                    <tr key={`${fixture.date}-${fixture.home}-${fixture.away}`} className="border-t border-border/60">
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{fixture.home} · {fixture.away}</div>
                        <div className="mt-0.5 text-[9px] text-muted-foreground">{fixture.date} · {stageLabel(fixture.stage)}</div>
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
        </div>
      )}
    </div>
  );
}
