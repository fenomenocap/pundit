"use client";

import { useMemo } from "react";
import type { MarketResponse } from "@/lib/api";

interface OrderbookProps {
  market: MarketResponse;
  outcome: number;
}

interface OrderLevel {
  price: number; // cents (1-99)
  quantity: number; // number of contracts
  total: number; // cumulative
}

// Generate mock orderbook data based on AMM price
function generateMockOrderbook(
  market: MarketResponse,
  outcome: number
): { bids: OrderLevel[]; asks: OrderLevel[] } {
  const yesRes = Number(BigInt(market.poolYes));
  const noRes = Number(BigInt(market.poolNo));
  const total = yesRes + noRes;
  if (total === 0) return { bids: [], asks: [] };

  const midPrice = outcome === 0
    ? (noRes / total) * 100
    : (yesRes / total) * 100;

  const mid = Math.round(midPrice);
  const spread = 1;

  // Generate bid levels (below mid)
  const bids: OrderLevel[] = [];
  let cumBid = 0;
  for (let i = 0; i < 8; i++) {
    const price = Math.max(1, mid - spread - i);
    if (price <= 0 || price >= 100) continue;
    // More liquidity near the mid
    const qty = Math.round(50 + Math.random() * 200 * (1 / (i + 1)));
    cumBid += qty;
    bids.push({ price, quantity: qty, total: cumBid });
  }

  // Generate ask levels (above mid)
  const asks: OrderLevel[] = [];
  let cumAsk = 0;
  for (let i = 0; i < 8; i++) {
    const price = Math.min(99, mid + spread + i);
    if (price <= 0 || price >= 100) continue;
    const qty = Math.round(50 + Math.random() * 200 * (1 / (i + 1)));
    cumAsk += qty;
    asks.push({ price, quantity: qty, total: cumAsk });
  }

  return { bids, asks: asks.reverse() };
}

export function Orderbook({ market, outcome }: OrderbookProps) {
  const { bids, asks } = useMemo(
    () => generateMockOrderbook(market, outcome),
    [market, outcome]
  );

  const maxTotal = Math.max(
    bids.length > 0 ? bids[bids.length - 1].total : 0,
    asks.length > 0 ? asks[0].total : 0,
    1
  );

  const yesRes = Number(BigInt(market.poolYes));
  const noRes = Number(BigInt(market.poolNo));
  const total = yesRes + noRes;
  const midPrice = total > 0
    ? (outcome === 0 ? (noRes / total) * 100 : (yesRes / total) * 100)
    : 50;

  return (
    <div className="flex flex-col text-[11px]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        <span>Price</span>
        <span>Qty</span>
        <span>Total</span>
      </div>

      {/* Asks (sells) - red, shown in reverse so highest is at top */}
      <div className="flex flex-col">
        {asks.map((level, i) => (
          <div key={`ask-${i}`} className="relative flex items-center justify-between px-3 py-1">
            <div
              className="absolute inset-y-0 right-0 bg-rose-500/8"
              style={{ width: `${(level.total / maxTotal) * 100}%` }}
            />
            <span className="relative z-10 font-mono text-rose-400">{level.price}&cent;</span>
            <span className="relative z-10 font-mono text-muted-foreground">{level.quantity}</span>
            <span className="relative z-10 font-mono text-muted-foreground">{level.total}</span>
          </div>
        ))}
      </div>

      {/* Spread / mid price */}
      <div className="flex items-center justify-center border-y border-border bg-secondary/30 px-3 py-2">
        <span className="font-mono text-sm font-semibold text-foreground">
          {Math.round(midPrice)}&cent;
        </span>
        <span className="ml-2 text-[10px] text-muted-foreground">
          Spread: 2&cent;
        </span>
      </div>

      {/* Bids (buys) - green */}
      <div className="flex flex-col">
        {bids.map((level, i) => (
          <div key={`bid-${i}`} className="relative flex items-center justify-between px-3 py-1">
            <div
              className="absolute inset-y-0 right-0 bg-teal-500/8"
              style={{ width: `${(level.total / maxTotal) * 100}%` }}
            />
            <span className="relative z-10 font-mono text-teal-400">{level.price}&cent;</span>
            <span className="relative z-10 font-mono text-muted-foreground">{level.quantity}</span>
            <span className="relative z-10 font-mono text-muted-foreground">{level.total}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Depth Chart (visual bar chart) ──────────────────────────────────────────

export function DepthChart({ market, outcome }: OrderbookProps) {
  const { bids, asks } = useMemo(
    () => generateMockOrderbook(market, outcome),
    [market, outcome]
  );

  const maxTotal = Math.max(
    bids.length > 0 ? bids[bids.length - 1].total : 0,
    asks.length > 0 ? asks[0].total : 0,
    1
  );

  // Combine bids (reversed) and asks for visual
  const bidBars = [...bids].reverse();

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        Depth
      </div>
      <div className="flex gap-0.5 items-end h-24">
        {/* Bid side */}
        {bidBars.map((level, i) => (
          <div
            key={`bid-${i}`}
            className="flex-1 bg-teal-500/30 rounded-t transition-all hover:bg-teal-500/50"
            style={{ height: `${(level.total / maxTotal) * 100}%` }}
            title={`${level.price}¢ — ${level.total} contracts`}
          />
        ))}
        {/* Spread divider */}
        <div className="w-px bg-border self-stretch" />
        {/* Ask side */}
        {asks.reverse().map((level, i) => (
          <div
            key={`ask-${i}`}
            className="flex-1 bg-rose-500/30 rounded-t transition-all hover:bg-rose-500/50"
            style={{ height: `${(level.total / maxTotal) * 100}%` }}
            title={`${level.price}¢ — ${level.total} contracts`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span className="text-teal-400">Bids</span>
        <span className="text-rose-400">Asks</span>
      </div>
    </div>
  );
}
