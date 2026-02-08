"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchMarketDetail } from "@/lib/mock-data";
import type { MarketDetailResponse } from "@/lib/api";
import type { ChartDataPoint } from "@/lib/mock-data";
import { MarketInfo } from "@/components/market-info";
import { PriceChart } from "@/components/price-chart";
import { TradePanel } from "@/components/trade-panel";
import { RecentTrades } from "@/components/recent-trades";

interface MarketData extends MarketDetailResponse {
  chartData: ChartDataPoint[];
}

export default function MarketDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [data, setData] = useState<MarketData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMarketDetail(params.id)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [params.id]);

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-center py-20">
          <h2 className="font-heading text-2xl font-bold text-slate-200">
            Market Not Found
          </h2>
          <p className="mt-2 text-sm text-slate-400">{error}</p>
          <Link
            href="/"
            className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            Back to Markets
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return <MarketDetailSkeleton />;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Back link */}
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-slate-200"
      >
        <ChevronLeftIcon />
        All Markets
      </Link>

      {/* Two-column layout on desktop */}
      <div className="lg:flex lg:gap-6">
        {/* Left column (60%) */}
        <div className="flex-1 space-y-6 lg:max-w-[60%]">
          <MarketInfo market={data} participantCount={data.participantCount} />
          <PriceChart
            data={data.chartData}
            outcomeA={data.outcomeA}
            outcomeB={data.outcomeB}
          />
          <RecentTrades
            trades={data.recentTrades}
            outcomeA={data.outcomeA}
            outcomeB={data.outcomeB}
          />
        </div>

        {/* Right column (40%) — desktop sticky, mobile bottom sheet */}
        <div className="mt-6 lg:mt-0 lg:w-[40%]">
          {/* Desktop: sticky sidebar */}
          <div className="hidden lg:block">
            <div className="sticky top-20">
              <TradePanel market={data} />
            </div>
          </div>

          {/* Mobile: sticky bottom sheet */}
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-950/95 p-4 backdrop-blur-md lg:hidden">
            <MobileTradeSheet market={data} />
          </div>
          {/* Spacer for mobile bottom sheet */}
          <div className="h-20 lg:hidden" />
        </div>
      </div>
    </div>
  );
}

// ─── Mobile trade bottom sheet ──────────────────────────────────────────────

function MobileTradeSheet({ market }: { market: MarketDetailResponse }) {
  const [expanded, setExpanded] = useState(false);

  const poolYes = BigInt(market.poolYes);
  const poolNo = BigInt(market.poolNo);
  const total = poolYes + poolNo;
  const pctYes = total > 0n ? Number((poolYes * 10000n) / total) / 100 : 50;
  const pctNo = 100 - pctYes;

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex w-full items-center justify-between rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
      >
        <span>Trade this market</span>
        <span className="flex items-center gap-3 text-xs font-normal opacity-80">
          <span className="text-emerald-300">{market.outcomeA} {pctYes.toFixed(1)}%</span>
          <span className="text-rose-300">{market.outcomeB} {pctNo.toFixed(1)}%</span>
        </span>
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(false)}
        className="mb-3 flex w-full items-center justify-center text-sm text-slate-400"
      >
        <ChevronDownIcon />
        <span className="ml-1">Collapse</span>
      </button>
      <TradePanel market={market} />
    </div>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────────────────

function MarketDetailSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 h-4 w-24 animate-pulse rounded bg-slate-800" />
      <div className="lg:flex lg:gap-6">
        <div className="flex-1 space-y-6 lg:max-w-[60%]">
          {/* Header */}
          <div>
            <div className="mb-3 flex gap-2">
              <div className="h-5 w-20 animate-pulse rounded-full bg-slate-800" />
              <div className="h-5 w-14 animate-pulse rounded-full bg-slate-800" />
            </div>
            <div className="h-8 w-3/4 animate-pulse rounded bg-slate-800" />
            <div className="mt-2 h-8 w-1/2 animate-pulse rounded bg-slate-800" />
          </div>
          {/* Odds bar */}
          <div className="h-3 animate-pulse rounded-full bg-slate-800" />
          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-800" />
            ))}
          </div>
          {/* Chart */}
          <div className="h-72 animate-pulse rounded-xl bg-slate-800" />
          {/* Trades */}
          <div className="h-48 animate-pulse rounded-xl bg-slate-800" />
        </div>
        <div className="mt-6 lg:mt-0 lg:w-[40%]">
          <div className="h-80 animate-pulse rounded-xl bg-slate-800" />
        </div>
      </div>
    </div>
  );
}

// ─── Icons ──────────────────────────────────────────────────────────────────

function ChevronLeftIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}
