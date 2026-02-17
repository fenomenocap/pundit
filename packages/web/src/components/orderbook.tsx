"use client";

import { useMemo } from "react";
import type { MarketResponse } from "@/lib/api";

interface OrderbookProps {
  market: MarketResponse;
  outcome: number;
}

interface OrderLevel {
  price: number;
  quantity: number;
  total: number;
}

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

  const bids: OrderLevel[] = [];
  let cumBid = 0;
  for (let i = 0; i < 8; i++) {
    const price = Math.max(1, mid - spread - i);
    if (price <= 0 || price >= 100) continue;
    const qty = Math.round(50 + Math.random() * 200 * (1 / (i + 1)));
    cumBid += qty;
    bids.push({ price, quantity: qty, total: cumBid });
  }

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

  // Depth bars (combined into orderbook)
  const bidBars = [...bids].reverse();
  const askBars = [...asks].reverse();

  return (
    <div className="flex flex-col text-[11px]">
      {/* Depth chart at top */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex gap-0.5 items-end h-16">
          {bidBars.map((level, i) => (
            <div
              key={`dbid-${i}`}
              className="flex-1 bg-cyan-500/20 rounded-t transition-all hover:bg-cyan-500/40"
              style={{ height: `${(level.total / maxTotal) * 100}%` }}
              title={`${level.price}\u00A2 \u2014 ${level.total} contracts`}
            />
          ))}
          <div className="w-px bg-border self-stretch opacity-50" />
          {askBars.map((level, i) => (
            <div
              key={`dask-${i}`}
              className="flex-1 bg-pink-500/20 rounded-t transition-all hover:bg-pink-500/40"
              style={{ height: `${(level.total / maxTotal) * 100}%` }}
              title={`${level.price}\u00A2 \u2014 ${level.total} contracts`}
            />
          ))}
        </div>
        <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
          <span className="text-cyan-400">Bids</span>
          <span className="text-pink-400">Asks</span>
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center justify-between border-y border-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        <span>Price</span>
        <span>Qty</span>
        <span>Total</span>
      </div>

      {/* Asks (sells) */}
      <div className="flex flex-col">
        {asks.map((level, i) => (
          <div key={`ask-${i}`} className="relative flex items-center justify-between px-3 py-1">
            <div
              className="absolute inset-y-0 right-0 bg-pink-500/8"
              style={{ width: `${(level.total / maxTotal) * 100}%` }}
            />
            <span className="relative z-10 font-mono text-pink-400">{level.price}&cent;</span>
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

      {/* Bids (buys) */}
      <div className="flex flex-col">
        {bids.map((level, i) => (
          <div key={`bid-${i}`} className="relative flex items-center justify-between px-3 py-1">
            <div
              className="absolute inset-y-0 right-0 bg-cyan-500/8"
              style={{ width: `${(level.total / maxTotal) * 100}%` }}
            />
            <span className="relative z-10 font-mono text-cyan-400">{level.price}&cent;</span>
            <span className="relative z-10 font-mono text-muted-foreground">{level.quantity}</span>
            <span className="relative z-10 font-mono text-muted-foreground">{level.total}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
