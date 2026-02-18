"use client";

import { useEffect, useState, lazy, Suspense, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { fetchMarketDetail, MOCK_PARTICIPANTS } from "@/lib/mock-data";
import { TradePanel } from "@/components/trade-panel";
import { OutcomeDetail } from "@/components/outcome-detail";
import { MarketsSidebar } from "@/components/markets-sidebar";
import { OrdersPanel } from "@/components/orders-panel";
import type { MarketDetailResponse } from "@/lib/api";
import type { ChartDataPoint } from "@/lib/mock-data";

const PriceChart = lazy(() =>
  import("@/components/price-chart").then((m) => ({ default: m.PriceChart }))
);

type OutcomeIndex = 0 | 1 | 2;

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  WORLD_CUP: { label: "World Cup", color: "bg-amber-500/15 text-amber-400 border-amber-500/25" },
  EPL: { label: "Premier League", color: "bg-purple-500/15 text-purple-400 border-purple-500/25" },
  LA_LIGA: { label: "La Liga", color: "bg-pink-500/15 text-pink-400 border-pink-500/25" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  OPEN: { label: "Open", color: "bg-cyan-500/15 text-cyan-400" },
  LOCKED: { label: "Locked", color: "bg-amber-500/15 text-amber-400" },
  RESOLVED: { label: "Resolved", color: "bg-blue-500/15 text-blue-400" },
  CANCELLED: { label: "Cancelled", color: "bg-muted text-muted-foreground" },
};

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
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function MarketPage() {
  const { id } = useParams<{ id: string }>();
  const [market, setMarket] = useState<(MarketDetailResponse & { chartData: ChartDataPoint[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<OutcomeIndex>(0);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    fetchMarketDetail(id)
      .then(setMarket)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (market) document.title = `${market.question} | Pundit`;
    return () => { document.title = "Pundit"; };
  }, [market]);

  const handleOutcomeClick = useCallback((outcome: OutcomeIndex) => {
    setSelectedOutcome(outcome);
  }, []);

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-44px)] items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="flex h-[calc(100vh-44px)] flex-col items-center justify-center gap-3 bg-background">
        <p className="text-sm text-muted-foreground">{error || "Market not found"}</p>
        <Link href="/" className="text-xs text-cyan-400 hover:underline">Back to Markets</Link>
      </div>
    );
  }

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
    pctNo = 100 - pctYes;
    pctDraw = 0;
  }

  const cat = CATEGORY_CONFIG[market.category] || { label: market.category, color: "bg-muted text-muted-foreground border-border" };
  const status = STATUS_CONFIG[market.status] || { label: market.status, color: "bg-muted text-muted-foreground" };
  const participants = MOCK_PARTICIPANTS[market.id] ?? 0;

  return (
    <div className="flex h-[calc(100vh-44px)] overflow-hidden bg-background">
      {/* ──────────────────────────────────────────────────────────────── */}
      {/* Col 1: Markets Sidebar (far left)                              */}
      {/* ──────────────────────────────────────────────────────────────── */}
      <div className="hidden w-52 shrink-0 lg:block">
        <MarketsSidebar />
      </div>

      {/* ──────────────────────────────────────────────────────────────── */}
      {/* Col 2: Center — Chart (top) + Orders (bottom)                  */}
      {/* ──────────────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col border-l border-r border-border">
        {/* Market header bar */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-2">
          <div className="flex items-center gap-2">
            <span className={cn("rounded border px-1.5 py-0.5 text-[9px] font-medium", cat.color)}>
              {cat.label}
            </span>
            <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-medium", status.color)}>
              {status.label}
            </span>
          </div>
          <h1 className="min-w-0 truncate text-sm font-semibold text-foreground">
            {market.question}
          </h1>
          <div className="ml-auto flex items-center gap-4 shrink-0 text-[10px] text-muted-foreground">
            <span>Vol {formatUsdc(market.totalVolume)}</span>
            <span>Liq {formatUsdc(String(total))}</span>
            <span>{getTimeLeft(market.resolutionTimestamp)}</span>
            <span>{participants} traders</span>
          </div>
        </div>

        {/* Odds bar (compact) */}
        <div className="border-b border-border px-4 py-2">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <button
              onClick={() => setSelectedOutcome(0)}
              className={cn(
                "font-medium cursor-pointer hover:underline",
                selectedOutcome === 0 ? "text-cyan-400" : "text-muted-foreground"
              )}
            >
              {market.outcomeA}
              <span className="ml-1.5 font-mono">{Math.round(pctYes)}&cent;</span>
            </button>
            {hasDraw && (
              <button
                onClick={() => setSelectedOutcome(2)}
                className={cn(
                  "font-medium cursor-pointer hover:underline",
                  selectedOutcome === 2 ? "text-amber-400" : "text-muted-foreground"
                )}
              >
                {market.outcomeC}
                <span className="ml-1.5 font-mono">{Math.round(pctDraw)}&cent;</span>
              </button>
            )}
            <button
              onClick={() => setSelectedOutcome(1)}
              className={cn(
                "font-medium cursor-pointer hover:underline",
                selectedOutcome === 1 ? "text-pink-400" : "text-muted-foreground"
              )}
            >
              <span className="mr-1.5 font-mono">{Math.round(pctNo)}&cent;</span>
              {market.outcomeB}
            </button>
          </div>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-secondary">
            <div className="bg-cyan-500 transition-all duration-500" style={{ width: `${pctYes}%` }} />
            {hasDraw && <div className="bg-amber-500 transition-all duration-500" style={{ width: `${pctDraw}%` }} />}
            <div className="bg-pink-500 transition-all duration-500" style={{ width: `${pctNo}%` }} />
          </div>
        </div>

        {/* Chart area (top portion) */}
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="p-4">
            <Suspense fallback={<div className="flex h-[260px] items-center justify-center text-xs text-muted-foreground">Loading chart...</div>}>
              <PriceChart data={market.chartData} outcomeA={market.outcomeA} outcomeB={market.outcomeB} />
            </Suspense>
          </div>
        </div>

        {/* Orders panel (bottom portion) */}
        <div className="h-48 shrink-0">
          <OrdersPanel market={market} />
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────── */}
      {/* Col 3: Order Book / Depth / Trades (right of chart)            */}
      {/* ──────────────────────────────────────────────────────────────── */}
      <div className="hidden w-64 shrink-0 border-r border-border xl:block">
        <OutcomeDetail
          market={market}
          outcome={selectedOutcome}
          trades={market.recentTrades}
          embedded
        />
      </div>

      {/* ──────────────────────────────────────────────────────────────── */}
      {/* Col 4: Trade Panel (far right)                                 */}
      {/* ──────────────────────────────────────────────────────────────── */}
      <div className="hidden w-[340px] shrink-0 overflow-y-auto lg:block">
        <TradePanel market={market} onOutcomeClick={handleOutcomeClick} />
      </div>

      {/* ──────────────────────────────────────────────────────────────── */}
      {/* Mobile fallback: stacked layout                                */}
      {/* ──────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:hidden w-full overflow-y-auto">
        {/* Market info */}
        <div className="border-b border-border px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={cn("rounded border px-2 py-0.5 text-[10px] font-medium", cat.color)}>
              {cat.label}
            </span>
            <span className={cn("rounded px-2 py-0.5 text-[10px] font-medium", status.color)}>
              {status.label}
            </span>
          </div>
          <h1 className="text-lg font-bold text-foreground">{market.question}</h1>
        </div>

        {/* Odds bar */}
        <div className="border-b border-border px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-cyan-400">
              {market.outcomeA} <span className="font-mono">{Math.round(pctYes)}&cent;</span>
            </span>
            {hasDraw && (
              <span className="font-medium text-amber-400">
                {market.outcomeC} <span className="font-mono">{Math.round(pctDraw)}&cent;</span>
              </span>
            )}
            <span className="font-medium text-pink-400">
              <span className="font-mono">{Math.round(pctNo)}&cent;</span> {market.outcomeB}
            </span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
            <div className="bg-cyan-500 transition-all duration-500" style={{ width: `${pctYes}%` }} />
            {hasDraw && <div className="bg-amber-500 transition-all duration-500" style={{ width: `${pctDraw}%` }} />}
            <div className="bg-pink-500 transition-all duration-500" style={{ width: `${pctNo}%` }} />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-px border-b border-border bg-border">
          <StatCard label="Volume" value={formatUsdc(market.totalVolume)} />
          <StatCard label="Liquidity" value={formatUsdc(String(total))} />
          <StatCard label="Time Left" value={getTimeLeft(market.resolutionTimestamp)} />
          <StatCard label="Traders" value={String(participants)} />
        </div>

        {/* Chart */}
        <div className="border-b border-border p-4">
          <Suspense fallback={<div className="flex h-[250px] items-center justify-center text-xs text-muted-foreground">Loading chart...</div>}>
            <PriceChart data={market.chartData} outcomeA={market.outcomeA} outcomeB={market.outcomeB} />
          </Suspense>
        </div>

        {/* Trade panel */}
        <div className="p-4">
          <TradePanel market={market} onOutcomeClick={handleOutcomeClick} />
        </div>

        {/* Outcome detail */}
        <div className="border-t border-border">
          <OutcomeDetail
            market={market}
            outcome={selectedOutcome}
            trades={market.recentTrades}
          />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-3 py-2">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xs font-semibold text-foreground">{value}</p>
    </div>
  );
}
