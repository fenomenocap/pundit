"use client";

import Link from "next/link";
import { memo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { MarketResponse } from "@/lib/api";

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  WORLD_CUP: { label: "World Cup", color: "bg-amber-500/15 text-amber-400 border-amber-500/25" },
  EPL: { label: "Premier League", color: "bg-purple-500/15 text-purple-400 border-purple-500/25" },
  LA_LIGA: { label: "La Liga", color: "bg-rose-500/15 text-rose-400 border-rose-500/25" },
};

function formatUsdcPool(raw: string): string {
  const n = Number(BigInt(raw)) / 1_000_000;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function getCountdown(target: string): string {
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

interface MarketCardProps {
  market: MarketResponse;
  participants?: number;
}

export const MarketCard = memo(function MarketCard({ market }: MarketCardProps) {
  const [countdown, setCountdown] = useState(() =>
    getCountdown(market.resolutionTimestamp)
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(getCountdown(market.resolutionTimestamp));
    }, 60_000);
    return () => clearInterval(interval);
  }, [market.resolutionTimestamp]);

  // AMM pricing
  const yesRes = BigInt(market.poolYes);
  const noRes = BigInt(market.poolNo);
  const drawRes = market.poolDraw ? BigInt(market.poolDraw) : 0n;
  const total = yesRes + noRes + drawRes;
  const hasDraw = !!market.outcomeC;

  let pctYes: number, pctNo: number, pctDraw: number;

  if (hasDraw && total > 0n) {
    const reserves = [Number(yesRes), Number(noRes), Number(drawRes)];
    const products = reserves.map((_, i) => {
      const others = reserves.filter((__, j) => j !== i);
      return others.reduce((a, b) => a * b, 1);
    });
    const sumProducts = products.reduce((a, b) => a + b, 0);
    pctYes = sumProducts > 0 ? (products[0] / sumProducts) * 100 : 33;
    pctNo = sumProducts > 0 ? (products[1] / sumProducts) * 100 : 33;
    pctDraw = sumProducts > 0 ? (products[2] / sumProducts) * 100 : 34;
  } else {
    pctYes = total > 0n ? Number((noRes * 10000n) / total) / 100 : 50;
    pctNo = total > 0n ? 100 - pctYes : 50;
    pctDraw = 0;
  }

  const cat = CATEGORY_CONFIG[market.category] || {
    label: market.category,
    color: "bg-muted text-muted-foreground border-border",
  };

  return (
    <Link href={`/market/${market.id}`} className="group block">
      <div className="relative flex h-full flex-col rounded-lg border border-border bg-card p-4 transition-all duration-200 group-hover:border-teal-500/30 group-hover:bg-secondary">
        {/* Category badge */}
        <span
          className={cn(
            "mb-3 inline-flex w-fit items-center rounded border px-2 py-0.5 text-[10px] font-medium",
            cat.color
          )}
        >
          {cat.label}
        </span>

        {/* Question */}
        <h3 className="mb-4 line-clamp-2 text-sm font-semibold leading-snug text-foreground group-hover:text-teal-400">
          {market.question}
        </h3>

        <div className="mt-auto" />

        {/* Outcome rows with AMM prices */}
        <div className="mb-3 space-y-1.5">
          {hasDraw ? (
            <div className="flex items-center justify-between text-xs gap-1.5">
              <span className="rounded bg-teal-500/15 px-2 py-0.5 text-[11px] font-semibold text-teal-400 truncate">
                {market.outcomeA} {Math.round(pctYes)}&cent;
              </span>
              <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-400 truncate">
                {market.outcomeC} {Math.round(pctDraw)}&cent;
              </span>
              <span className="rounded bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-400 truncate">
                {market.outcomeB} {Math.round(pctNo)}&cent;
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground">{market.outcomeA}</span>
              <div className="flex items-center gap-2">
                <span className="rounded bg-teal-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-teal-400">
                  Yes {Math.round(pctYes)}&cent;
                </span>
                <span className="rounded bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-rose-400">
                  No {Math.round(pctNo)}&cent;
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Odds bar */}
        <div className="mb-3">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="bg-teal-500 transition-all duration-500"
              style={{ width: `${pctYes}%` }}
            />
            {hasDraw && (
              <div
                className="bg-amber-500 transition-all duration-500"
                style={{ width: `${pctDraw}%` }}
              />
            )}
            <div
              className="bg-rose-500 transition-all duration-500"
              style={{ width: `${pctNo}%` }}
            />
          </div>
        </div>

        {/* Bottom row */}
        <div className="flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted-foreground">
          <span className="font-mono font-medium">
            Vol. {formatUsdcPool(market.totalVolume)} USDC
          </span>
          <span className="flex items-center gap-1">
            <ClockIcon />
            {countdown}
          </span>
        </div>
      </div>
    </Link>
  );
});

export function MarketCardSkeleton() {
  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card p-4">
      <div className="mb-3 h-4 w-20 animate-pulse rounded bg-secondary" />
      <div className="mb-2 h-4 w-full animate-pulse rounded bg-secondary" />
      <div className="mb-4 h-4 w-3/4 animate-pulse rounded bg-secondary" />
      <div className="mt-auto" />
      <div className="mb-1.5 flex justify-between">
        <div className="h-3 w-24 animate-pulse rounded bg-secondary" />
        <div className="h-3 w-20 animate-pulse rounded bg-secondary" />
      </div>
      <div className="mb-1.5 flex justify-between">
        <div className="h-3 w-24 animate-pulse rounded bg-secondary" />
        <div className="h-3 w-20 animate-pulse rounded bg-secondary" />
      </div>
      <div className="mb-3 h-1.5 animate-pulse rounded-full bg-secondary" />
      <div className="flex items-center justify-between border-t border-border pt-3">
        <div className="h-3 w-20 animate-pulse rounded bg-secondary" />
        <div className="h-3 w-14 animate-pulse rounded bg-secondary" />
      </div>
    </div>
  );
}

export function MarketsEmptyState() {
  return (
    <div className="col-span-full flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16">
      <h3 className="text-sm font-semibold text-foreground">No markets found</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Try adjusting your filters or search query.
      </p>
    </div>
  );
}

function ClockIcon() {
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}
