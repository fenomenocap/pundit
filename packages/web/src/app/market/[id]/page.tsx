"use client";

import { useEffect, useState, lazy, Suspense } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { fetchMarketDetail } from "@/lib/mock-data";
import { TradePanel } from "@/components/trade-panel";
import type { MarketDetailResponse } from "@/lib/api";
import type { ChartDataPoint } from "@/lib/mock-data";

const PriceChart = lazy(() =>
  import("@/components/price-chart").then((m) => ({ default: m.PriceChart }))
);

function formatUsdc(raw: string): string {
  const n = Number(BigInt(raw)) / 1_000_000;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
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
    if (market) document.title = `${market.question} | Sports Predict`;
    return () => { document.title = "Sports Predict"; };
  }, [market]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-teal-400 border-t-transparent" />
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">{error || "Market not found"}</p>
        <Link href="/" className="text-xs text-teal-400 hover:underline">Back to Markets</Link>
      </div>
    );
  }

  const poolYes = BigInt(market.poolYes);
  const poolNo = BigInt(market.poolNo);
  const total = poolYes + poolNo;
  const pctYes = total > 0n ? Number((poolYes * 10000n) / total) / 100 : 50;
  const pctNo = 100 - pctYes;

  return (
    <div className="flex flex-1 flex-col">
      {/* Top bar: market title + stats */}
      <div className="border-b border-border px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-muted-foreground hover:text-foreground">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </Link>
          <h1 className="text-sm font-semibold text-foreground">{market.question}</h1>
          <span className={cn(
            "ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium",
            market.status === "OPEN" ? "bg-teal-500/10 text-teal-400"
              : market.status === "RESOLVED" ? "bg-blue-500/10 text-blue-400"
              : "bg-muted text-muted-foreground"
          )}>
            {market.status}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-6 text-[11px] text-muted-foreground">
          <span>
            Yes <span className="font-mono text-teal-400">{pctYes.toFixed(1)}%</span>
          </span>
          <span>
            No <span className="font-mono text-rose-400">{pctNo.toFixed(1)}%</span>
          </span>
          <span>Volume <span className="font-mono text-foreground">${formatUsdc(market.totalVolume)}</span></span>
          <span>Closes <span className="text-foreground">{getTimeLeft(market.resolutionTimestamp)}</span></span>
          <span>ID <span className="font-mono text-foreground">#{market.onchainId}</span></span>
        </div>
      </div>

      {/* Main content: chart + trade panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Chart + recent trades */}
        <div className="flex flex-1 flex-col border-r border-border">
          {/* Chart */}
          <div className="flex-1 p-4">
            <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading chart...</div>}>
              <PriceChart data={market.chartData} outcomeA={market.outcomeA} outcomeB={market.outcomeB} />
            </Suspense>
          </div>

          {/* Recent trades table */}
          <div className="border-t border-border">
            <div className="px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Recent Trades
            </div>
            <div className="max-h-36 overflow-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border text-[10px] text-muted-foreground">
                    <th className="px-4 py-1 text-left font-medium">Side</th>
                    <th className="px-3 py-1 text-right font-medium">Amount</th>
                    <th className="px-3 py-1 text-right font-medium">Trader</th>
                    <th className="px-3 py-1 text-right font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {market.recentTrades.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-center text-muted-foreground">
                        No trades yet
                      </td>
                    </tr>
                  ) : (
                    market.recentTrades.slice(0, 10).map((t) => (
                      <tr key={t.id} className="border-b border-border">
                        <td className={cn("px-4 py-1.5 font-medium", t.outcome === 0 ? "text-teal-400" : "text-rose-400")}>
                          {t.outcome === 0 ? "YES" : "NO"}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-foreground">
                          ${(Number(BigInt(t.amount)) / 1_000_000).toFixed(0)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                          {t.userAddress.slice(0, 6)}...{t.userAddress.slice(-4)}
                        </td>
                        <td className="px-3 py-1.5 text-right text-muted-foreground">
                          {new Date(t.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right: Trade panel */}
        <div className="w-72 shrink-0 overflow-auto lg:w-80">
          <TradePanel market={market} />
        </div>
      </div>
    </div>
  );
}
