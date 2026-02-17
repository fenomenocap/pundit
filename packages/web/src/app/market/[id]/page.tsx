"use client";

import { useEffect, useState, lazy, Suspense, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { fetchMarketDetail, MOCK_PARTICIPANTS } from "@/lib/mock-data";
import { TradePanel } from "@/components/trade-panel";
import { OutcomeDetail } from "@/components/outcome-detail";
import { CONTRACTS, EXPLORER_BASE } from "@/lib/contracts";
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
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function MarketPage() {
  const { id } = useParams<{ id: string }>();
  const [market, setMarket] = useState<(MarketDetailResponse & { chartData: ChartDataPoint[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<OutcomeIndex | null>(0);

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
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
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
    // 3-way pricing: inverse-proportional from reserves
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
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link href="/" className="text-xs text-muted-foreground hover:text-cyan-400">
          Markets
        </Link>
        <span className="mx-2 text-xs text-muted-foreground">/</span>
        <span className="text-xs text-foreground">{market.category.replace(/_/g, " ")}</span>
      </div>

      {/* Two-column layout: content left, trade panel right */}
      <div className="flex gap-6">
        {/* Left: main content (scrollable) */}
        <div className="min-w-0 flex-1">
          {/* Market header */}
          <div className="mb-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className={cn("rounded border px-2 py-0.5 text-[10px] font-medium", cat.color)}>
                {cat.label}
              </span>
              <span className={cn("rounded px-2 py-0.5 text-[10px] font-medium", status.color)}>
                {status.label}
              </span>
            </div>
            <h1 className="text-xl font-bold text-foreground sm:text-2xl">
              {market.question}
            </h1>
          </div>

          {/* Odds bar */}
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between text-sm">
              <button
                onClick={() => setSelectedOutcome(0)}
                className="font-medium text-cyan-400 hover:underline cursor-pointer"
              >
                {market.outcomeA}
                <span className="ml-2 font-mono text-base">{Math.round(pctYes)}&cent;</span>
              </button>
              {hasDraw && (
                <button
                  onClick={() => setSelectedOutcome(2)}
                  className="font-medium text-amber-400 hover:underline cursor-pointer"
                >
                  {market.outcomeC}
                  <span className="ml-2 font-mono text-base">{Math.round(pctDraw)}&cent;</span>
                </button>
              )}
              <button
                onClick={() => setSelectedOutcome(1)}
                className="font-medium text-pink-400 hover:underline cursor-pointer"
              >
                <span className="mr-2 font-mono text-base">{Math.round(pctNo)}&cent;</span>
                {market.outcomeB}
              </button>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
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
            <div className="mt-1.5 text-[10px] text-muted-foreground">
              Click an outcome to view order book &amp; trades
            </div>
          </div>

          {/* Stats row */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Volume" value={formatUsdc(market.totalVolume)} />
            <StatCard label="Liquidity" value={formatUsdc(String(total))} />
            <StatCard label="Time Left" value={getTimeLeft(market.resolutionTimestamp)} />
            <StatCard label="Traders" value={String(participants)} />
          </div>

          {/* Chart */}
          <div className="mb-6 rounded-lg border border-border bg-card p-4">
            <Suspense fallback={<div className="flex h-[300px] items-center justify-center text-xs text-muted-foreground">Loading chart...</div>}>
              <PriceChart data={market.chartData} outcomeA={market.outcomeA} outcomeB={market.outcomeB} />
            </Suspense>
          </div>

          {/* Outcome detail panel (trades + orderbook) */}
          {selectedOutcome !== null && (
            <div className="mb-6">
              <OutcomeDetail
                market={market}
                outcome={selectedOutcome}
                trades={market.recentTrades}
                onClose={() => setSelectedOutcome(null)}
              />
            </div>
          )}

          {/* Recent trades */}
          <div className="mb-6 rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-xs font-semibold text-foreground">Recent Trades</h3>
            </div>
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Side</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-right font-medium">Trader</th>
                    <th className="px-3 py-2 text-right font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {market.recentTrades.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                        No trades yet
                      </td>
                    </tr>
                  ) : (
                    market.recentTrades.slice(0, 15).map((t) => (
                      <tr key={t.id} className="border-b border-border hover:bg-secondary/50">
                        <td className={cn(
                          "px-4 py-2 font-medium",
                          t.outcome === 0 ? "text-cyan-400" : t.outcome === 2 ? "text-amber-400" : "text-pink-400"
                        )}>
                          {t.outcome === 0 ? market.outcomeA : t.outcome === 2 ? (market.outcomeC || "DRAW") : market.outcomeB}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-foreground">
                          ${(Number(BigInt(t.amount)) / 1_000_000).toFixed(0)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                          {t.userAddress.slice(0, 6)}...{t.userAddress.slice(-4)}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          {new Date(t.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Market details */}
          <div className="mb-6 rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-xs font-semibold text-foreground">Market Details</h3>
            <dl className="space-y-2.5 text-xs">
              <DetailRow label="Resolution Date" value={new Date(market.resolutionTimestamp).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} />
              <DetailRow label="Source" value="Official league/tournament results" />
              <DetailRow label="Resolution Rules" value={
                hasDraw
                  ? "Market resolves to the winning outcome, or Draw if the match ends level. Resolved by admin oracle."
                  : "Market resolves YES if the specified outcome occurs. Otherwise resolves NO. Resolved by admin oracle."
              } />
              {market.resolvedAt && (
                <DetailRow label="Resolved At" value={new Date(market.resolvedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} />
              )}
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">Contract</dt>
                <dd>
                  <a
                    href={`${EXPLORER_BASE}/address/${CONTRACTS.engine}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-cyan-400 hover:underline"
                  >
                    {CONTRACTS.engine.slice(0, 10)}...{CONTRACTS.engine.slice(-8)}
                  </a>
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Right: sticky trade panel */}
        <div className="hidden w-[360px] shrink-0 lg:block">
          <div className="sticky top-16">
            <TradePanel market={market} onOutcomeClick={handleOutcomeClick} />
          </div>
        </div>
      </div>

      {/* Mobile trade panel (below content on small screens) */}
      <div className="mt-6 lg:hidden">
        <TradePanel market={market} onOutcomeClick={handleOutcomeClick} />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  );
}
