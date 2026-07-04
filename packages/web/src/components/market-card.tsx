"use client";

import Link from "next/link";
import { memo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getTeamLogo, getTeamColor } from "@/lib/team-logos";
import type { MarketResponse } from "@/lib/api";

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  WORLD_CUP:        { label: "World Cup",        color: "bg-amber-500/15 text-amber-400 border-amber-500/25" },
  PREMIER_LEAGUE:   { label: "Premier League",   color: "bg-purple-500/15 text-purple-400 border-purple-500/25" },
  CHAMPIONS_LEAGUE: { label: "Champions League", color: "bg-blue-500/15 text-blue-400 border-blue-500/25" },
  EUROPA_LEAGUE:    { label: "Europa League",    color: "bg-orange-500/15 text-orange-400 border-orange-500/25" },
  LA_LIGA:          { label: "La Liga",          color: "bg-pink-500/15 text-pink-400 border-pink-500/25" },
  BUNDESLIGA:       { label: "Bundesliga",       color: "bg-red-500/15 text-red-400 border-red-500/25" },
  SERIE_A:          { label: "Serie A",          color: "bg-sky-500/15 text-sky-400 border-sky-500/25" },
  LIGUE_1:          { label: "Ligue 1",          color: "bg-indigo-500/15 text-indigo-400 border-indigo-500/25" },
  OTHER:            { label: "Other",            color: "bg-muted text-muted-foreground border-border" },
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

  // Parimutuel pricing: P(outcome) = pool[outcome] / totalPool
  const yesRes  = BigInt(market.poolYes);
  const noRes   = BigInt(market.poolNo);
  const drawRes = market.poolDraw ? BigInt(market.poolDraw) : 0n;
  const total   = yesRes + noRes + drawRes;
  const hasDraw = !!market.outcomeC;

  // When pools are empty, fall back to Polymarket reference odds if linked
  const po = total === 0n ? market.polymarketOdds : null;
  const showingRefOdds = !!po;

  let pctYes: number, pctNo: number, pctDraw: number;
  if (total > 0n) {
    pctYes  = Number(yesRes  * 10000n / total) / 100;
    pctNo   = Number(noRes   * 10000n / total) / 100;
    pctDraw = hasDraw ? Number(drawRes * 10000n / total) / 100 : 0;
  } else if (po) {
    pctYes  = Math.round((po.prices[0] ?? 0) * 1000) / 10;
    pctNo   = Math.round((po.prices[1] ?? 0) * 1000) / 10;
    pctDraw = hasDraw ? Math.round((po.prices[2] ?? 0) * 1000) / 10 : 0;
  } else {
    pctYes  = hasDraw ? 33 : 50;
    pctNo   = hasDraw ? 33 : 50;
    pctDraw = hasDraw ? 34 : 0;
  }

  // Multiplier: payout ratio for the most underbacked outcome
  let maxMultiplier: number | null = null;
  if (total > 0n) {
    const pools = hasDraw ? [yesRes, noRes, drawRes] : [yesRes, noRes];
    const nonZero = pools.filter((p) => p > 0n);
    if (nonZero.length > 0) {
      const smallest = nonZero.reduce((a, b) => (a < b ? a : b));
      maxMultiplier = Number((total * 100n) / smallest) / 100;
    }
  }

  const cat = CATEGORY_CONFIG[market.category] || {
    label: market.category,
    color: "bg-muted text-muted-foreground border-border",
  };

  const accentColor = getTeamColor(market.teamA) !== "#64748B" ? getTeamColor(market.teamA) : null;

  return (
    <Link href={`/market/${market.id}`} className="group block">
      <div
        className="relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card p-4 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-cyan-500/40 group-hover:bg-secondary group-hover:shadow-[0_0_24px_-8px_rgba(34,211,238,0.35)]"
      >
        {/* Team-color accent bar */}
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: accentColor ?? "linear-gradient(90deg, #22d3ee, #ec4899)" }}
        />

        {/* Multiplier badge */}
        {maxMultiplier !== null && maxMultiplier >= 1.5 && (
          <span className="absolute right-3 top-4 rounded-full bg-cyan-500/15 px-2.5 py-1 text-[10px] font-black text-cyan-400">
            UP TO {maxMultiplier.toFixed(1)}x
          </span>
        )}

        {/* Category badge */}
        <span
          className={cn(
            "mb-3 mt-1 inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
            cat.color
          )}
        >
          {cat.label}
        </span>

        {/* Team logos */}
        {(market.teamA || market.teamB) && (
          <div className="mb-2 flex items-center gap-2.5 text-2xl">
            {market.teamA && getTeamLogo(market.teamA) && (
              <span title={market.teamA}>{getTeamLogo(market.teamA)}</span>
            )}
            {market.teamB && getTeamLogo(market.teamB) && (
              <>
                <span className="text-[10px] font-bold uppercase text-muted-foreground">vs</span>
                <span title={market.teamB}>{getTeamLogo(market.teamB)}</span>
              </>
            )}
          </div>
        )}

        {/* Question */}
        <h3 className="mb-4 line-clamp-2 font-heading text-sm font-bold leading-snug text-foreground group-hover:text-cyan-400">
          {market.question}
        </h3>

        <div className="mt-auto" />

        {/* Outcome rows with prices */}
        <div className="mb-3 space-y-1.5">
          {hasDraw ? (
            <div className="flex items-center justify-between gap-1.5 text-xs">
              <span className="rounded-lg bg-cyan-500/15 px-2.5 py-1 text-xs font-black text-cyan-400 truncate">
                {market.outcomeA} {Math.round(pctYes)}&cent;
              </span>
              <span className="rounded-lg bg-amber-500/15 px-2.5 py-1 text-xs font-black text-amber-400 truncate">
                {market.outcomeC} {Math.round(pctDraw)}&cent;
              </span>
              <span className="rounded-lg bg-pink-500/15 px-2.5 py-1 text-xs font-black text-pink-400 truncate">
                {market.outcomeB} {Math.round(pctNo)}&cent;
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground">{market.outcomeA}</span>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "rounded-lg px-3 py-1 text-xs font-black",
                  showingRefOdds
                    ? "bg-purple-500/15 text-purple-400"
                    : "bg-cyan-500/15 text-cyan-400"
                )}>
                  Yes {Math.round(pctYes)}&cent;
                </span>
                <span className="rounded-lg bg-pink-500/15 px-3 py-1 text-xs font-black text-pink-400">
                  No {Math.round(pctNo)}&cent;
                </span>
              </div>
            </div>
          )}
          {showingRefOdds && (
            <p className="text-[9px] text-purple-400/70 text-right">
              Polymarket consensus · no trades yet
            </p>
          )}
        </div>

        {/* Odds bar */}
        <div className="mb-3">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="bg-cyan-500 transition-all duration-500"
              style={{ width: `${pctYes}%` }}
            />
            {hasDraw && (
              <div
                className="bg-amber-500 transition-all duration-500"
                style={{ width: `${pctDraw}%` }}
              />
            )}
            <div
              className="bg-pink-500 transition-all duration-500"
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
