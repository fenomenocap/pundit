"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { MarketCard, MarketCardSkeleton, MarketsEmptyState } from "@/components/market-card";
import { fetchMarkets, MOCK_PARTICIPANTS } from "@/lib/mock-data";
import type { MarketResponse } from "@/lib/api";

// ─── Category tabs ──────────────────────────────────────────────────────────

const CATEGORIES = [
  { key: "ALL", label: "All" },
  { key: "GROUP_STAGE", label: "Group Stage" },
  { key: "QUARTER_FINAL", label: "Quarter-Final" },
  { key: "SEMI_FINAL", label: "Semi-Final" },
  { key: "FINAL", label: "Final" },
  { key: "TOURNAMENT", label: "Tournament" },
] as const;

const SORT_OPTIONS = [
  { key: "newest", label: "Newest" },
  { key: "volume", label: "Highest Volume" },
  { key: "closing_soon", label: "Closing Soon" },
] as const;

// ─── Featured market IDs (top volume) ───────────────────────────────────────

const FEATURED_IDS = new Set(["market-7", "market-3", "market-1", "market-4"]);

// ─── Page ───────────────────────────────────────────────────────────────────

export default function MarketsPage() {
  const [markets, setMarkets] = useState<MarketResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("ALL");
  const [sort, setSort] = useState<"newest" | "volume" | "closing_soon">("newest");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    fetchMarkets({
      category: category === "ALL" ? undefined : category,
      sort,
    })
      .then((res) => setMarkets(res.markets))
      .finally(() => setLoading(false));
  }, [category, sort]);

  // Client-side search filter
  const filtered = useMemo(() => {
    if (!search.trim()) return markets;
    const q = search.toLowerCase();
    return markets.filter((m) => m.question.toLowerCase().includes(q));
  }, [markets, search]);

  // Featured markets (always from full set)
  const [allMarkets, setAllMarkets] = useState<MarketResponse[]>([]);
  useEffect(() => {
    fetchMarkets({ sort: "volume" }).then((res) => setAllMarkets(res.markets));
  }, []);

  const featured = useMemo(
    () => allMarkets.filter((m) => FEATURED_IDS.has(m.id)),
    [allMarkets]
  );

  return (
    <div className="min-h-screen">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-slate-800 bg-gradient-to-b from-slate-900 via-slate-950 to-background">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(59,130,246,0.15),transparent)]" />
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
          <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Predict the
            <br />
            <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              World Cup
            </span>
          </h1>
          <p className="mt-4 max-w-lg text-lg text-slate-400">
            Trade on FIFA World Cup 2026 outcomes with USDC on Base.
            Parimutuel markets powered by smart contracts.
          </p>
          <div className="mt-6 flex items-center gap-6 text-sm text-slate-400">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {allMarkets.length} active markets
            </span>
            <span className="font-mono">
              {formatTotalVolume(allMarkets)} total volume
            </span>
          </div>
        </div>
      </section>

      {/* ── Featured Markets ──────────────────────────────────────────────── */}
      {featured.length > 0 && (
        <section className="border-b border-slate-800 bg-slate-950/50">
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <h2 className="mb-4 font-heading text-lg font-semibold tracking-tight text-slate-200">
              Featured Markets
            </h2>
            <div className="flex gap-4 overflow-x-auto pb-2">
              {featured.map((m) => (
                <div key={m.id} className="w-[320px] flex-shrink-0">
                  <MarketCard
                    market={m}
                    participants={MOCK_PARTICIPANTS[m.id] ?? 0}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── All Markets ───────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Toolbar */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Category tabs */}
          <div className="flex gap-1 overflow-x-auto">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setCategory(cat.key)}
                className={cn(
                  "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  category === cat.key
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Search + Sort */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search markets..."
                className="h-9 w-52 rounded-lg border border-slate-700 bg-slate-800/50 pl-9 pr-3 text-sm text-slate-200 placeholder-slate-500 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <select
              value={sort}
              onChange={(e) =>
                setSort(e.target.value as "newest" | "volume" | "closing_soon")
              }
              className="h-9 rounded-lg border border-slate-700 bg-slate-800/50 px-3 text-sm text-slate-200 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <MarketCardSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <MarketsEmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((m) => (
              <MarketCard
                key={m.id}
                market={m}
                participants={MOCK_PARTICIPANTS[m.id] ?? 0}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTotalVolume(markets: MarketResponse[]): string {
  const total = markets.reduce(
    (sum, m) => sum + Number(BigInt(m.totalVolume)) / 1_000_000,
    0
  );
  if (total >= 1_000_000) return `$${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 1_000) return `$${(total / 1_000).toFixed(1)}K`;
  return `$${total.toFixed(0)}`;
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  );
}
