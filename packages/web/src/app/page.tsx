"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchMarkets, fetchPolymarketMarkets, MOCK_PARTICIPANTS } from "@/lib/mock-data";
import { MarketCard, MarketCardSkeleton, MarketsEmptyState } from "@/components/market-card";
import { PolymarketCard, PolymarketCardSkeleton } from "@/components/polymarket-card";
import type { PolymarketMarket } from "@/lib/api";
import type { MarketResponse } from "@/lib/api";

// ─── Hook: fetch Polymarket WC markets (mock or live depending on USE_MOCK) ──
function usePolymarketData() {
  const [markets, setMarkets] = useState<PolymarketMarket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchPolymarketMarkets()
      .then((data) => { if (!cancelled) setMarkets(data); })
      .catch(() => { if (!cancelled) setMarkets([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { markets, loading };
}

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
  { key: "ALL",       label: "All" },
  { key: "WORLD_CUP", label: "🏆 World Cup" },
] as const;

// World Cup 2026 news — tournament opens June 11
const FOOTBALL_NEWS = [
  {
    id: 1,
    headline: "Brazil arrive in Los Angeles as heavy favourites to lift the trophy",
    source: "The Athletic",
    time: "1h ago",
    tag: "World Cup",
  },
  {
    id: 2,
    headline: "USA vs Mexico: everything you need to know about Group A's opening clash",
    source: "ESPN",
    time: "3h ago",
    tag: "World Cup",
  },
  {
    id: 3,
    headline: "Mbappé named France captain — can Les Bleus go all the way?",
    source: "L'Équipe",
    time: "5h ago",
    tag: "World Cup",
  },
  {
    id: 4,
    headline: "England vs France tipped as group stage match of the tournament",
    source: "BBC Sport",
    time: "7h ago",
    tag: "World Cup",
  },
  {
    id: 5,
    headline: "Argentina defending champions: can Messi's men retain the trophy?",
    source: "Marca",
    time: "10h ago",
    tag: "World Cup",
  },
];

// Mock trending markets / movers
function getMovers(markets: MarketResponse[]): { market: MarketResponse; change: number }[] {
  return markets.slice(0, 3).map((m) => ({
    market: m,
    change: Math.round((Math.random() - 0.3) * 10),
  }));
}

function useWCCountdown() {
  const target = new Date("2026-06-11T00:00:00Z").getTime();
  const [timeLeft, setTimeLeft] = useState(() => target - Date.now());

  useEffect(() => {
    const id = setInterval(() => setTimeLeft(target - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (timeLeft <= 0) return null;
  return {
    days:  Math.floor(timeLeft / 86_400_000),
    hours: Math.floor((timeLeft % 86_400_000) / 3_600_000),
    mins:  Math.floor((timeLeft % 3_600_000) / 60_000),
    secs:  Math.floor((timeLeft % 60_000) / 1000),
  };
}

export default function MarketsPage() {
  const [markets, setMarkets] = useState<MarketResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("WORLD_CUP");
  const [search, setSearch] = useState("");
  const { markets: polymarkets, loading: polyLoading } = usePolymarketData();

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
  const countdown = useWCCountdown();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* WC 2026 Countdown Banner */}
      {countdown && (
        <div className="mb-6 overflow-hidden rounded-xl border border-amber-500/20 bg-gradient-to-r from-amber-950/40 via-amber-900/20 to-amber-950/40 px-6 py-4">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-500">
                FIFA World Cup 2026
              </p>
              <h2 className="font-heading text-lg font-bold text-white sm:text-xl">
                Trade every match. Beat the crowd.
              </h2>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {[
                { value: countdown.days,  label: "days"  },
                { value: countdown.hours, label: "hours" },
                { value: countdown.mins,  label: "mins"  },
                { value: countdown.secs,  label: "secs"  },
              ].map(({ value, label }) => (
                <div key={label} className="flex flex-col items-center">
                  <span className="font-heading text-2xl font-bold tabular-nums text-white sm:text-3xl">
                    {String(value).padStart(2, "0")}
                  </span>
                  <span className="text-[9px] font-medium uppercase tracking-wider text-amber-500/70">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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

      {/* ── Live Polymarket WC Markets section ── */}
      {(polyLoading || polymarkets.length > 0) && (
        <div className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Live WC Markets</h2>
            <span className="inline-flex items-center gap-1 rounded bg-purple-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase text-purple-400">
              <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
              Polymarket
            </span>
            <span className="text-[10px] text-muted-foreground">Reference consensus · not tradeable here</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {polyLoading
              ? Array.from({ length: 4 }).map((_, i) => <PolymarketCardSkeleton key={i} />)
              : polymarkets.slice(0, 8).map((m) => (
                  <PolymarketCard key={m.id} market={m} />
                ))}
          </div>
        </div>
      )}

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
