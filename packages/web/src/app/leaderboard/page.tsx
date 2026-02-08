"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { cn } from "@/lib/utils";
import { getLeaderboard } from "@/lib/api";
import type { LeaderboardEntry } from "@/lib/api";

// ─── Period Tabs ────────────────────────────────────────────────────────────

const PERIODS = [
  { key: "all", label: "All Time" },
  { key: "30d", label: "30 Days" },
  { key: "7d", label: "7 Days" },
] as const;

type Period = (typeof PERIODS)[number]["key"];

// ─── Formatters ─────────────────────────────────────────────────────────────

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

// ─── Medal Colors ───────────────────────────────────────────────────────────

const MEDAL_STYLES: Record<number, { bg: string; border: string; badge: string; text: string }> = {
  1: {
    bg: "bg-amber-500/5",
    border: "border-amber-500/20",
    badge: "bg-amber-500 text-amber-950",
    text: "text-amber-400",
  },
  2: {
    bg: "bg-slate-300/5",
    border: "border-slate-400/20",
    badge: "bg-slate-400 text-slate-900",
    text: "text-slate-300",
  },
  3: {
    bg: "bg-orange-600/5",
    border: "border-orange-600/20",
    badge: "bg-orange-700 text-orange-100",
    text: "text-orange-400",
  },
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function LeaderboardPage() {
  const { address: connectedAddress } = useAccount();
  const [period, setPeriod] = useState<Period>("all");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getLeaderboard({ period: p, limit: 50 });
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

  // Find connected user's entry
  const connectedEntry = connectedAddress
    ? entries.find((e) => e.address.toLowerCase() === connectedAddress.toLowerCase())
    : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-white">
          Leaderboard
        </h1>
        <p className="mt-2 text-slate-400">
          Top traders ranked by profit across all resolved markets.
        </p>
      </div>

      {/* Period Tabs */}
      <div className="mb-6 flex items-center gap-1">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              period === p.key
                ? "bg-blue-600 text-white"
                : "bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Connected User Highlight */}
      {connectedEntry && (
        <div className="mb-6 rounded-xl border border-blue-500/20 bg-blue-950/20 p-4">
          <p className="mb-1 text-xs font-medium text-blue-400">Your Ranking</p>
          <div className="flex items-center gap-4">
            <span className="font-heading text-2xl font-bold text-white">
              #{connectedEntry.rank}
            </span>
            <div className="flex-1">
              <p className="text-sm text-slate-300">
                {shortenAddress(connectedEntry.address)}
              </p>
            </div>
            <div className="text-right">
              <p
                className={cn(
                  "font-heading text-lg font-bold",
                  Number(BigInt(connectedEntry.profit)) > 0
                    ? "text-emerald-400"
                    : Number(BigInt(connectedEntry.profit)) < 0
                      ? "text-rose-400"
                      : "text-slate-400"
                )}
              >
                {formatProfit(connectedEntry.profit).text}
              </p>
              <p className="text-xs text-slate-500">
                {connectedEntry.roi >= 0 ? "+" : ""}
                {connectedEntry.roi.toFixed(1)}% ROI
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <LeaderboardSkeleton />
      ) : error ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-8 text-center">
          <p className="text-rose-400">{error}</p>
          <button
            onClick={() => fetchData(period)}
            className="mt-3 text-sm text-blue-400 hover:text-blue-300"
          >
            Try again
          </button>
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-12 text-center">
          <p className="text-lg text-slate-400">No traders yet for this period.</p>
          <p className="mt-1 text-sm text-slate-500">
            Leaderboard populates once markets are resolved.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3 sm:px-6">Rank</th>
                <th className="px-4 py-3 sm:px-6">Trader</th>
                <th className="px-4 py-3 text-right sm:px-6">Profit</th>
                <th className="hidden px-4 py-3 text-right sm:table-cell sm:px-6">ROI</th>
                <th className="hidden px-4 py-3 text-right md:table-cell md:px-6">Win Rate</th>
                <th className="hidden px-4 py-3 text-right lg:table-cell lg:px-6">Markets</th>
                <th className="hidden px-4 py-3 text-right sm:px-6 xl:table-cell">Invested</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {entries.map((entry) => {
                const isConnected =
                  connectedAddress &&
                  entry.address.toLowerCase() === connectedAddress.toLowerCase();
                const medal = MEDAL_STYLES[entry.rank];
                const profit = formatProfit(entry.profit);

                return (
                  <tr
                    key={entry.address}
                    className={cn(
                      "transition-colors",
                      isConnected
                        ? "bg-blue-950/20 ring-1 ring-inset ring-blue-500/20"
                        : medal
                          ? cn(medal.bg, "hover:bg-slate-800/30")
                          : "hover:bg-slate-800/30"
                    )}
                  >
                    {/* Rank */}
                    <td className="px-4 py-3.5 sm:px-6">
                      {medal ? (
                        <span
                          className={cn(
                            "inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                            medal.badge
                          )}
                        >
                          {entry.rank}
                        </span>
                      ) : (
                        <span className="pl-1 text-sm text-slate-500">
                          {entry.rank}
                        </span>
                      )}
                    </td>

                    {/* Address */}
                    <td className="px-4 py-3.5 sm:px-6">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "font-mono text-sm",
                            isConnected ? "text-blue-300" : medal ? medal.text : "text-slate-200"
                          )}
                        >
                          {shortenAddress(entry.address)}
                        </span>
                        {isConnected && (
                          <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
                            YOU
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Profit */}
                    <td className="px-4 py-3.5 text-right sm:px-6">
                      <span
                        className={cn(
                          "font-heading text-sm font-semibold",
                          profit.positive
                            ? "text-emerald-400"
                            : profit.zero
                              ? "text-slate-400"
                              : "text-rose-400"
                        )}
                      >
                        {profit.text}
                      </span>
                    </td>

                    {/* ROI */}
                    <td className="hidden px-4 py-3.5 text-right sm:table-cell sm:px-6">
                      <span
                        className={cn(
                          "text-sm",
                          entry.roi > 0
                            ? "text-emerald-400"
                            : entry.roi < 0
                              ? "text-rose-400"
                              : "text-slate-400"
                        )}
                      >
                        {entry.roi >= 0 ? "+" : ""}
                        {entry.roi.toFixed(1)}%
                      </span>
                    </td>

                    {/* Win Rate */}
                    <td className="hidden px-4 py-3.5 text-right md:table-cell md:px-6">
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-sm text-slate-300">
                          {entry.winRate.toFixed(0)}%
                        </span>
                        <span className="text-xs text-slate-500">
                          ({entry.wins}W/{entry.losses}L)
                        </span>
                      </div>
                    </td>

                    {/* Markets Traded */}
                    <td className="hidden px-4 py-3.5 text-right lg:table-cell lg:px-6">
                      <span className="text-sm text-slate-400">
                        {entry.marketsTraded}
                      </span>
                    </td>

                    {/* Total Invested */}
                    <td className="hidden px-4 py-3.5 text-right sm:px-6 xl:table-cell">
                      <span className="text-sm text-slate-400">
                        {formatUsdc(entry.totalInvested)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────────────────

function LeaderboardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
      <div className="border-b border-slate-800 px-6 py-3">
        <div className="flex items-center gap-6">
          <div className="h-3 w-8 animate-pulse rounded bg-slate-700" />
          <div className="h-3 w-24 animate-pulse rounded bg-slate-700" />
          <div className="ml-auto h-3 w-16 animate-pulse rounded bg-slate-700" />
          <div className="hidden h-3 w-12 animate-pulse rounded bg-slate-700 sm:block" />
          <div className="hidden h-3 w-16 animate-pulse rounded bg-slate-700 md:block" />
        </div>
      </div>
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-6 border-b border-slate-800/50 px-6 py-4 last:border-0"
        >
          <div className="h-7 w-7 animate-pulse rounded-full bg-slate-800" />
          <div className="h-4 w-28 animate-pulse rounded bg-slate-800" />
          <div className="ml-auto h-4 w-20 animate-pulse rounded bg-slate-800" />
          <div className="hidden h-4 w-12 animate-pulse rounded bg-slate-800 sm:block" />
          <div className="hidden h-4 w-16 animate-pulse rounded bg-slate-800 md:block" />
        </div>
      ))}
    </div>
  );
}
