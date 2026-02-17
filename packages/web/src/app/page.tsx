"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchMarkets, MOCK_PARTICIPANTS } from "@/lib/mock-data";
import { MarketCard, MarketCardSkeleton, MarketsEmptyState } from "@/components/market-card";
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
  { key: "WORLD_CUP", label: "World Cup" },
  { key: "EPL", label: "Premier League" },
  { key: "LA_LIGA", label: "La Liga" },
] as const;

// Mock football news items
const FOOTBALL_NEWS = [
  {
    id: 1,
    headline: "England announce 26-man squad for World Cup 2026",
    source: "BBC Sport",
    time: "2h ago",
    tag: "World Cup",
  },
  {
    id: 2,
    headline: "Arsenal extend lead at the top with derby victory",
    source: "Sky Sports",
    time: "4h ago",
    tag: "EPL",
  },
  {
    id: 3,
    headline: "Barcelona confirm Lamine Yamal contract extension",
    source: "Marca",
    time: "6h ago",
    tag: "La Liga",
  },
  {
    id: 4,
    headline: "Brazil vs Germany: tactical preview of the quarter-final clash",
    source: "The Athletic",
    time: "8h ago",
    tag: "World Cup",
  },
  {
    id: 5,
    headline: "Liverpool target January reinforcements after draw",
    source: "ESPN",
    time: "12h ago",
    tag: "EPL",
  },
];

// Mock trending markets / movers
function getMovers(markets: MarketResponse[]): { market: MarketResponse; change: number }[] {
  return markets.slice(0, 3).map((m) => ({
    market: m,
    change: Math.round((Math.random() - 0.3) * 10),
  }));
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

  const movers = useMemo(() => getMovers(markets), [markets]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Hero section */}
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-bold text-white sm:text-3xl">
          Pundit
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground max-w-lg">
          Your edge in sports prediction markets. Bet on real outcomes, trade with limit orders, and beat the crowd.
        </p>
      </div>

      {/* Top bar: Trending movers + News ticker side by side */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        {/* Trending movers */}
        <div className="lg:col-span-1 rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Trending Markets
          </h3>
          <div className="space-y-3">
            {movers.map(({ market: m, change }) => (
              <a
                key={m.id}
                href={`/market/${m.id}`}
                className="flex items-center justify-between rounded-md p-2 text-xs transition-colors hover:bg-secondary/50"
              >
                <span className="truncate text-foreground font-medium max-w-[200px]">
                  {m.question.length > 40 ? m.question.slice(0, 40) + "..." : m.question}
                </span>
                <span
                  className={cn(
                    "ml-2 shrink-0 font-mono text-[11px] font-semibold",
                    change >= 0 ? "text-cyan-400" : "text-pink-400"
                  )}
                >
                  {change >= 0 ? "+" : ""}{change}%
                </span>
              </a>
            ))}
          </div>
        </div>

        {/* News panel */}
        <div className="lg:col-span-2 rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Football Headlines
          </h3>
          <div className="space-y-2.5">
            {FOOTBALL_NEWS.map((news) => (
              <div
                key={news.id}
                className="flex items-start gap-3 rounded-md p-2 transition-colors hover:bg-secondary/30"
              >
                <span className="mt-0.5 rounded bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-400 uppercase shrink-0">
                  {news.tag}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground leading-snug">
                    {news.headline}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {news.source} &middot; {news.time}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Category tabs + search */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setCategory(cat.key)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                category === cat.key
                  ? "bg-cyan-500/15 text-cyan-400"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
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
            placeholder="Search markets..."
            className="h-8 w-56 rounded-lg border border-border bg-card px-3 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      {/* Card grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <MarketCardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <MarketsEmptyState />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((m) => (
            <MarketCard
              key={m.id}
              market={m}
              participants={MOCK_PARTICIPANTS[m.id] ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
