"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { MarketResponse } from "@/lib/api";

// ─── Category config ────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  GROUP_STAGE: { label: "Group Stage", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  ROUND_OF_16: { label: "Round of 16", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
  QUARTER_FINAL: { label: "Quarter-Final", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  SEMI_FINAL: { label: "Semi-Final", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  FINAL: { label: "Final", color: "bg-rose-500/20 text-rose-400 border-rose-500/30" },
  TOURNAMENT: { label: "Tournament", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── MarketCard ─────────────────────────────────────────────────────────────

interface MarketCardProps {
  market: MarketResponse;
  participants?: number;
}

export function MarketCard({ market, participants = 0 }: MarketCardProps) {
  const [countdown, setCountdown] = useState(() =>
    getCountdown(market.resolutionTimestamp)
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(getCountdown(market.resolutionTimestamp));
    }, 60_000);
    return () => clearInterval(interval);
  }, [market.resolutionTimestamp]);

  const poolYes = BigInt(market.poolYes);
  const poolNo = BigInt(market.poolNo);
  const total = poolYes + poolNo;
  const pctYes = total > 0n ? Number((poolYes * 10000n) / total) / 100 : 50;
  const pctNo = total > 0n ? 100 - pctYes : 50;

  const cat = CATEGORY_CONFIG[market.category] || {
    label: market.category,
    color: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  };

  return (
    <Link href={`/market/${market.id}`} className="group block">
      <div className="relative flex h-full flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-all duration-200 group-hover:border-slate-600 group-hover:bg-slate-900 group-hover:shadow-lg group-hover:shadow-blue-500/5">
        {/* Category badge */}
        <span
          className={cn(
            "mb-3 inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
            cat.color
          )}
        >
          {cat.label}
        </span>

        {/* Question */}
        <h3 className="mb-4 line-clamp-2 font-heading text-sm font-semibold leading-snug text-slate-100 group-hover:text-white">
          {market.question}
        </h3>

        {/* Spacer to push bottom content down */}
        <div className="mt-auto" />

        {/* Odds bar */}
        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-medium text-emerald-400">
              {market.outcomeA}{" "}
              <span className="font-mono">{pctYes.toFixed(1)}%</span>
            </span>
            <span className="font-medium text-rose-400">
              <span className="font-mono">{pctNo.toFixed(1)}%</span>{" "}
              {market.outcomeB}
            </span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="rounded-l-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${pctYes}%` }}
            />
            <div
              className="rounded-r-full bg-rose-500 transition-all duration-500"
              style={{ width: `${pctNo}%` }}
            />
          </div>
        </div>

        {/* Bottom row */}
        <div className="flex items-center justify-between border-t border-slate-800 pt-3 text-xs text-slate-400">
          <span className="font-mono font-medium">
            {formatUsdcPool(market.totalVolume)}
          </span>
          <span>{participants} traders</span>
          <span className="flex items-center gap-1">
            <ClockIcon />
            {countdown}
          </span>
        </div>
      </div>
    </Link>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────────────────

export function MarketCardSkeleton() {
  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      {/* Badge */}
      <div className="mb-3 h-5 w-20 animate-pulse rounded-full bg-slate-800" />
      {/* Question lines */}
      <div className="mb-2 h-4 w-full animate-pulse rounded bg-slate-800" />
      <div className="mb-4 h-4 w-3/4 animate-pulse rounded bg-slate-800" />

      <div className="mt-auto" />

      {/* Odds bar */}
      <div className="mb-1.5 flex justify-between">
        <div className="h-3 w-16 animate-pulse rounded bg-slate-800" />
        <div className="h-3 w-16 animate-pulse rounded bg-slate-800" />
      </div>
      <div className="mb-3 h-2 animate-pulse rounded-full bg-slate-800" />

      {/* Bottom row */}
      <div className="flex items-center justify-between border-t border-slate-800 pt-3">
        <div className="h-3 w-12 animate-pulse rounded bg-slate-800" />
        <div className="h-3 w-16 animate-pulse rounded bg-slate-800" />
        <div className="h-3 w-14 animate-pulse rounded bg-slate-800" />
      </div>
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────

export function MarketsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 py-16">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-800">
        <SearchIcon />
      </div>
      <h3 className="font-heading text-lg font-semibold text-slate-200">
        No markets found
      </h3>
      <p className="mt-1 text-sm text-slate-400">
        Try adjusting your filters or search query.
      </p>
    </div>
  );
}

// ─── Inline icons ───────────────────────────────────────────────────────────

function ClockIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      className="h-6 w-6 text-slate-500"
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
