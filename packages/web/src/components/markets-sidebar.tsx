"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { fetchMarkets } from "@/lib/mock-data";
import type { MarketResponse } from "@/lib/api";

const CATEGORY_COLORS: Record<string, string> = {
  WORLD_CUP: "bg-amber-500",
  EPL: "bg-purple-500",
  LA_LIGA: "bg-pink-500",
};

function getAmmPriceSimple(market: MarketResponse): number {
  const yesRes = Number(BigInt(market.poolYes));
  const noRes = Number(BigInt(market.poolNo));
  const total = yesRes + noRes;
  if (total === 0) return 50;
  return Math.round((noRes / total) * 100);
}

function getTimeLeftShort(ts: string): string {
  const diff = new Date(ts).getTime() - Date.now();
  if (diff <= 0) return "Ended";
  const d = Math.floor(diff / 86_400_000);
  if (d > 0) return `${d}d`;
  const h = Math.floor(diff / 3_600_000);
  return `${h}h`;
}

export function MarketsSidebar() {
  const { id } = useParams<{ id: string }>();
  const [markets, setMarkets] = useState<MarketResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMarkets({ sort: "volume" })
      .then((res) => setMarkets(res.markets))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-full flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Markets
        </span>
        <span className="text-[10px] text-muted-foreground">
          {markets.length}
        </span>
      </div>

      {/* Market list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded bg-secondary/50" />
            ))}
          </div>
        ) : (
          <div className="space-y-px p-1">
            {markets.map((m) => {
              const isActive = m.id === id;
              const price = getAmmPriceSimple(m);
              const catColor = CATEGORY_COLORS[m.category] || "bg-muted";
              const timeLeft = getTimeLeftShort(m.resolutionTimestamp);

              return (
                <Link
                  key={m.id}
                  href={`/market/${m.id}`}
                  className={cn(
                    "flex flex-col gap-1 rounded-md px-2.5 py-2 transition-colors",
                    isActive
                      ? "bg-cyan-500/10 border border-cyan-500/30"
                      : "hover:bg-secondary/50 border border-transparent"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", catColor)} />
                    <span
                      className={cn(
                        "text-[11px] font-medium leading-tight line-clamp-2",
                        isActive ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {m.question.length > 50 ? m.question.slice(0, 50) + "..." : m.question}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pl-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-semibold text-cyan-400">
                        {price}&cent;
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        {m.outcomeA}
                      </span>
                    </div>
                    <span className="text-[9px] text-muted-foreground">
                      {timeLeft}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
