"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { cn } from "@/lib/utils";
import { fetchLeaderboard } from "@/lib/mock-data";
import type { LeaderboardEntry } from "@/lib/api";

const PERIODS = [
  { key: "all", label: "All Time" },
  { key: "30d", label: "30D" },
  { key: "7d", label: "7D" },
] as const;

type Period = (typeof PERIODS)[number]["key"];

function formatUsdc(raw: string): string {
  const n = Number(BigInt(raw)) / 1_000_000;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatProfit(raw: string): { text: string; positive: boolean; zero: boolean } {
  const n = Number(BigInt(raw)) / 1_000_000;
  const positive = n > 0;
  const zero = n === 0;
  const abs = Math.abs(n);
  let text: string;
  if (abs >= 1_000_000) text = `$${(abs / 1_000_000).toFixed(1)}M`;
  else if (abs >= 1_000) text = `$${(abs / 1_000).toFixed(1)}K`;
  else text = `$${abs.toFixed(2)}`;
  if (positive) text = `+${text}`;
  else if (!zero) text = `-${text}`;
  return { text, positive, zero };
}

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function LeaderboardPage() {
  const { address: connectedAddress } = useAccount();
  const [period, setPeriod] = useState<Period>("all");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Leaderboard | Pundit";
    return () => { document.title = "Pundit"; };
  }, []);

  const fetchData = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchLeaderboard({ period: p, limit: 50 });
      setEntries(res.leaderboard);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leaderboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(period);
  }, [period, fetchData]);

  const connectedEntry = connectedAddress
    ? entries.find((e) => e.address.toLowerCase() === connectedAddress.toLowerCase())
    : null;

  return (
    <div className="flex flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <div className="flex gap-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                "rounded px-2 py-1 text-[11px] font-medium transition-colors",
                period === p.key
                  ? "bg-cyan-500/15 text-cyan-400"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {connectedEntry && (
          <div className="ml-auto flex items-center gap-3 text-[11px]">
            <span className="text-muted-foreground">
              Your rank: <span className="font-mono text-foreground">#{connectedEntry.rank}</span>
            </span>
            <span className={cn(
              "font-mono",
              Number(BigInt(connectedEntry.profit)) > 0 ? "text-cyan-400" : Number(BigInt(connectedEntry.profit)) < 0 ? "text-pink-400" : "text-muted-foreground"
            )}>
              {formatProfit(connectedEntry.profit).text}
            </span>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          </div>
        ) : error ? (
          <div className="px-4 py-12 text-center">
            <p className="text-xs text-pink-400">{error}</p>
            <button onClick={() => fetchData(period)} className="mt-2 text-[10px] text-cyan-400 hover:underline">
              Try again
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-12 text-center text-xs text-muted-foreground">
            No traders yet for this period.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">#</th>
                <th className="px-3 py-2 text-left font-medium">Trader</th>
                <th className="px-3 py-2 text-right font-medium">Profit</th>
                <th className="px-3 py-2 text-right font-medium">ROI</th>
                <th className="px-3 py-2 text-right font-medium">Win Rate</th>
                <th className="px-3 py-2 text-right font-medium">Markets</th>
                <th className="px-3 py-2 text-right font-medium">Invested</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isMe = connectedAddress && entry.address.toLowerCase() === connectedAddress.toLowerCase();
                const profit = formatProfit(entry.profit);

                return (
                  <tr
                    key={entry.address}
                    className={cn(
                      "border-b border-border transition-colors hover:bg-secondary/50",
                      isMe && "bg-cyan-500/5"
                    )}
                  >
                    <td className="px-4 py-2">
                      <span className={cn(
                        "font-mono",
                        entry.rank <= 3 ? "font-semibold text-amber-400" : "text-muted-foreground"
                      )}>
                        {entry.rank}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn("font-mono", isMe ? "text-cyan-400" : "text-foreground")}>
                        {shortenAddress(entry.address)}
                      </span>
                      {isMe && (
                        <span className="ml-1.5 rounded bg-cyan-500/15 px-1 py-0.5 text-[9px] font-medium text-cyan-400">
                          YOU
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={cn(
                        "font-mono font-medium",
                        profit.positive ? "text-cyan-400" : profit.zero ? "text-muted-foreground" : "text-pink-400"
                      )}>
                        {profit.text}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={cn(
                        "font-mono",
                        entry.roi > 0 ? "text-cyan-400" : entry.roi < 0 ? "text-pink-400" : "text-muted-foreground"
                      )}>
                        {entry.roi >= 0 ? "+" : ""}{entry.roi.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="font-mono text-foreground">{entry.winRate.toFixed(0)}%</span>
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        ({entry.wins}W/{entry.losses}L)
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {entry.marketsTraded}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {formatUsdc(entry.totalInvested)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
