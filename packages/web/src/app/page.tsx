"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { fetchMarkets } from "@/lib/mock-data";
import type { MarketResponse } from "@/lib/api";

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    timerRef.current = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timerRef.current);
  }, [value, delay]);
  return debounced;
}

const CATEGORIES = [
  { key: "ALL", label: "All" },
  { key: "TOURNAMENT", label: "Tournament" },
  { key: "GROUP_STAGE", label: "Group" },
  { key: "QUARTER_FINAL", label: "QF" },
  { key: "SEMI_FINAL", label: "SF" },
  { key: "FINAL", label: "Final" },
] as const;

function formatUsdc(raw: string): string {
  const n = Number(BigInt(raw)) / 1_000_000;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function getTimeLeft(ts: string): string {
  const diff = new Date(ts).getTime() - Date.now();
  if (diff <= 0) return "Ended";
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function getOdds(market: MarketResponse): { yes: number; no: number } {
  const y = BigInt(market.poolYes);
  const n = BigInt(market.poolNo);
  const t = y + n;
  if (t === 0n) return { yes: 50, no: 50 };
  const yes = Number((y * 10000n) / t) / 100;
  return { yes, no: 100 - yes };
}

export default function MarketsPage() {
  const [markets, setMarkets] = useState<MarketResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("ALL");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    fetchMarkets({ category: category === "ALL" ? undefined : category, sort: "volume" })
      .then((res) => setMarkets(res.markets))
      .finally(() => setLoading(false));
  }, [category]);

  const debouncedSearch = useDebounce(search, 250);
  const filtered = useMemo(() => {
    if (!debouncedSearch.trim()) return markets;
    const q = debouncedSearch.toLowerCase();
    return markets.filter((m) => m.question.toLowerCase().includes(q));
  }, [markets, debouncedSearch]);

  return (
    <div className="flex flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <div className="flex gap-0.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setCategory(cat.key)}
              className={cn(
                "rounded px-2 py-1 text-[11px] font-medium transition-colors",
                category === cat.key
                  ? "bg-teal-500/15 text-teal-400"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="h-7 w-44 rounded border border-border bg-secondary px-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-teal-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">Market</th>
              <th className="px-3 py-2 text-right font-medium">Yes</th>
              <th className="px-3 py-2 text-right font-medium">No</th>
              <th className="px-3 py-2 text-right font-medium">Volume</th>
              <th className="px-3 py-2 text-right font-medium">Closes</th>
              <th className="px-3 py-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="px-4 py-3" colSpan={6}>
                      <div className="h-3 w-full animate-pulse rounded bg-secondary" />
                    </td>
                  </tr>
                ))
              : filtered.length === 0
                ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      No markets found
                    </td>
                  </tr>
                )
                : filtered.map((m) => {
                    const odds = getOdds(m);
                    return (
                      <tr
                        key={m.id}
                        className="border-b border-border transition-colors hover:bg-secondary/50"
                      >
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/market/${m.id}`}
                            className="font-medium text-foreground hover:text-teal-400"
                          >
                            {m.question}
                          </Link>
                          <span className="ml-2 text-[10px] text-muted-foreground">
                            {m.category.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-teal-400">
                          {odds.yes.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-rose-400">
                          {odds.no.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-foreground">
                          {formatUsdc(m.totalVolume)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-muted-foreground">
                          {getTimeLeft(m.resolutionTimestamp)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-medium",
                              m.status === "OPEN"
                                ? "bg-teal-500/10 text-teal-400"
                                : m.status === "RESOLVED"
                                  ? "bg-blue-500/10 text-blue-400"
                                  : "bg-muted text-muted-foreground"
                            )}
                          >
                            {m.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
