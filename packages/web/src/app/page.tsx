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
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-bold text-foreground">Markets</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Trade on sports outcomes with USDC on Base Sepolia.
        </p>
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
                  ? "bg-teal-500/15 text-teal-400"
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
            className="h-8 w-56 rounded-lg border border-border bg-card px-3 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-teal-500"
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
