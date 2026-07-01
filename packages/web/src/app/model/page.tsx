"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { getModelWcProbabilities, type ModelTeamProbability } from "@/lib/api";

type SortKey = "winProb" | "sfProb" | "qfProb" | "marketPrice" | "edge";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "winProb", label: "Win%" },
  { key: "sfProb", label: "SF%" },
  { key: "qfProb", label: "QF%" },
  { key: "marketPrice", label: "Mkt Price" },
  { key: "edge", label: "Edge" },
];

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export default function ModelPage() {
  const [teams, setTeams] = useState<ModelTeamProbability[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("winProb");
  const [sortDesc, setSortDesc] = useState(true);

  useEffect(() => {
    document.title = "Model | Pundit";
    return () => { document.title = "Pundit"; };
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getModelWcProbabilities();
      setTeams(res.teams);
      setLastUpdated(res.lastUpdated);
      if (res.error) setError(res.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load model data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const sorted = useMemo(() => {
    const copy = [...teams];
    copy.sort((a, b) => (sortDesc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]));
    return copy;
  }, [teams, sortKey, sortDesc]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <span className="rounded border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
          Model
        </span>
        <span className="text-[10px] text-muted-foreground">
          Reference only — Elo/Poisson simulation, not tradeable
        </span>
        {lastUpdated && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            Updated {new Date(lastUpdated).toLocaleString()}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          </div>
        ) : error && teams.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-xs text-pink-400">{error}</p>
            <button onClick={() => fetchData()} className="mt-2 text-[10px] text-cyan-400 hover:underline">
              Try again
            </button>
          </div>
        ) : teams.length === 0 ? (
          <div className="px-4 py-12 text-center text-xs text-muted-foreground">
            No model data available.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Team</th>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className="cursor-pointer select-none px-3 py-2 text-right font-medium hover:text-foreground"
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                    {sortKey === col.key && (sortDesc ? " ▼" : " ▲")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.team} className="border-b border-border transition-colors hover:bg-secondary/50">
                  <td className="px-4 py-2 font-medium text-foreground">{t.team}</td>
                  <td className="px-3 py-2 text-right font-mono text-foreground">{pct(t.winProb)}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">{pct(t.sfProb)}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">{pct(t.qfProb)}</td>
                  <td className="px-3 py-2 text-right font-mono text-purple-400">{pct(t.marketPrice)}</td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={cn(
                        "font-mono font-medium",
                        t.edge > 0 ? "text-cyan-400" : t.edge < 0 ? "text-pink-400" : "text-muted-foreground"
                      )}
                    >
                      {t.edge >= 0 ? "+" : ""}{pct(t.edge)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
