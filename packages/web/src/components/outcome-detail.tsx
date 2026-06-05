"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Orderbook } from "./orderbook";
import type { MarketResponse, TradeResponse } from "@/lib/api";

type OutcomeIndex = 0 | 1 | 2;

interface OutcomeDetailProps {
  market: MarketResponse;
  outcome: OutcomeIndex;
  trades: TradeResponse[];
  onClose?: () => void;
  /** When true, renders as a full-height panel (terminal mode) */
  embedded?: boolean;
}

function getOutcomeName(market: MarketResponse, idx: OutcomeIndex): string {
  if (idx === 0) return market.outcomeA;
  if (idx === 1) return market.outcomeB;
  return market.outcomeC || "Draw";
}

function getOutcomeColor(idx: OutcomeIndex): string {
  if (idx === 0) return "text-cyan-400";
  if (idx === 1) return "text-pink-400";
  return "text-amber-400";
}

/** Parimutuel implied probability: pool[outcome] / totalPool */
function getParimutuelPrice(market: MarketResponse, outcome: OutcomeIndex): number {
  const yesRes = Number(BigInt(market.poolYes));
  const noRes  = Number(BigInt(market.poolNo));
  const drawRes = market.poolDraw ? Number(BigInt(market.poolDraw)) : 0;
  const total = yesRes + noRes + drawRes;
  if (total === 0) return market.outcomeC ? 33 : 50;
  const pool = outcome === 0 ? yesRes : outcome === 1 ? noRes : drawRes;
  return (pool / total) * 100;
}

export function OutcomeDetail({ market, outcome, trades, onClose, embedded }: OutcomeDetailProps) {
  const [tab, setTab] = useState<"orderbook" | "trades">("orderbook");

  const name = getOutcomeName(market, outcome);
  const color = getOutcomeColor(outcome);
  const price = getParimutuelPrice(market, outcome);

  const outcomeTrades = useMemo(
    () => trades.filter((t) => t.outcome === outcome),
    [trades, outcome]
  );

  const displayTrades = useMemo(() => {
    if (outcomeTrades.length > 0) return outcomeTrades;

    const now = Date.now();
    const mock: TradeResponse[] = [];
    for (let i = 0; i < 12; i++) {
      const grossAmount = Math.round((10 + Math.random() * 200) * 1_000_000);
      // netShares = grossAmount after 2% fee
      const netShares = Math.round(grossAmount * 0.98);
      mock.push({
        id: `mock-${outcome}-${i}`,
        marketId: market.id,
        userAddress: `0x${Math.random().toString(16).slice(2, 10)}${"0".repeat(32)}`.slice(0, 42),
        outcome,
        grossAmount: String(grossAmount),
        netShares: String(netShares),
        txHash: `0x${Math.random().toString(16).slice(2)}`,
        blockNumber: 1000000 + i,
        timestamp: new Date(now - i * 300_000 - Math.random() * 600_000).toISOString(),
      });
    }
    return mock;
  }, [outcomeTrades, outcome, market.id, price]);

  // Full-height embedded mode for the terminal layout
  if (embedded) {
    return (
      <div className="flex h-full flex-col bg-card">
        {/* Compact header showing selected outcome */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className={cn("text-[11px] font-semibold", color)}>{name}</span>
          <span className="font-mono text-[11px] text-foreground">{Math.round(price)}&cent;</span>
          <span className="text-[9px] text-muted-foreground">{Math.round(price)}%</span>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {(["orderbook", "trades"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 py-1.5 text-[10px] font-semibold transition-all text-center capitalize",
                tab === t
                  ? "text-foreground border-b-2 border-cyan-400"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "orderbook" ? "Order Book" : "Trades"}
            </button>
          ))}
        </div>

        {/* Content fills remaining space */}
        <div className="flex-1 overflow-auto">
          {tab === "orderbook" && (
            <Orderbook market={market} outcome={outcome} />
          )}

          {tab === "trades" && (
            <div className="text-[11px]">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-3 py-1.5 text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
                <span>Side</span>
                <span>Price</span>
                <span>Qty</span>
                <span>Total</span>
                <span>Time</span>
              </div>
              {displayTrades.length === 0 ? (
                <div className="px-4 py-8 text-center text-muted-foreground text-xs">
                  No trades yet
                </div>
              ) : (
                displayTrades.map((trade) => {
                  const amount = Number(BigInt(trade.grossAmount)) / 1_000_000;
                  const shares = Number(BigInt(trade.netShares)) / 1_000_000;
                  const tradePrice = shares > 0 ? (amount / shares) * 100 : 0;
                  const time = new Date(trade.timestamp);
                  return (
                    <div
                      key={trade.id}
                      className="flex items-center justify-between border-b border-border/50 px-3 py-1 hover:bg-secondary/30"
                    >
                      <span className="font-medium text-cyan-400 text-[10px]">BUY</span>
                      <span className="font-mono text-foreground">{Math.round(tradePrice)}&cent;</span>
                      <span className="font-mono text-muted-foreground">{shares.toFixed(0)}</span>
                      <span className="font-mono text-foreground">${amount.toFixed(0)}</span>
                      <span className="text-muted-foreground text-[10px]">
                        {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Original card mode (fallback)
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <span className={cn("text-sm font-semibold", color)}>{name}</span>
          <span className="font-mono text-sm text-foreground">{Math.round(price)}&cent;</span>
          <span className="text-[10px] text-muted-foreground">
            {Math.round(price)}% chance
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18" /><path d="M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border">
        {(["orderbook", "trades"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 py-2 text-[11px] font-semibold transition-all text-center capitalize",
              tab === t
                ? "text-foreground border-b-2 border-cyan-400"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "orderbook" ? "Order Book" : "Trades"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="max-h-[420px] overflow-auto">
        {tab === "orderbook" && (
          <Orderbook market={market} outcome={outcome} />
        )}

        {tab === "trades" && (
          <div className="text-[11px]">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              <span>Side</span>
              <span>Price</span>
              <span>Contracts</span>
              <span>Total</span>
              <span>Time</span>
            </div>

            {displayTrades.length === 0 ? (
              <div className="px-4 py-8 text-center text-muted-foreground text-xs">
                No trades yet for this outcome
              </div>
            ) : (
              displayTrades.map((trade) => {
                const amount = Number(BigInt(trade.grossAmount)) / 1_000_000;
                const shares = Number(BigInt(trade.netShares)) / 1_000_000;
                const tradePrice = shares > 0 ? (amount / shares) * 100 : 0;
                const time = new Date(trade.timestamp);
                return (
                  <div
                    key={trade.id}
                    className="flex items-center justify-between border-b border-border/50 px-3 py-1.5 hover:bg-secondary/30"
                  >
                    <span className="font-medium text-cyan-400">
                      BUY
                    </span>
                    <span className="font-mono text-foreground">
                      {Math.round(tradePrice)}&cent;
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {shares.toFixed(0)}
                    </span>
                    <span className="font-mono text-foreground">
                      ${amount.toFixed(0)}
                    </span>
                    <span className="text-muted-foreground">
                      {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
