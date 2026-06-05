"use client";

import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import type { PolymarketMarket } from "@/lib/api";

export type { PolymarketMarket };

interface PolymarketCardProps {
  market: PolymarketMarket;
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// Modal shown when clicking a card that isn't yet linked to our on-chain market
function ComingSoonModal({ question, onClose }: { question: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 max-w-sm rounded-xl border border-border bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-purple-400">
            Polymarket
          </span>
          <span className="text-[10px] text-muted-foreground">Reference market</span>
        </div>
        <p className="mb-4 text-sm font-semibold text-foreground leading-snug">{question}</p>
        <p className="mb-5 text-xs text-muted-foreground">
          This market is live on Polymarket. We&rsquo;re launching our own parimutuel pool for this
          question soon — stay tuned.
        </p>
        <button
          onClick={onClose}
          className="w-full rounded-lg bg-secondary px-4 py-2 text-xs font-medium text-foreground hover:bg-secondary/70 transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

export const PolymarketCard = memo(function PolymarketCard({ market }: PolymarketCardProps) {
  const [showModal, setShowModal] = useState(false);

  const isLive = market.active && !market.resolved;

  // Build outcome bar segments — up to 4 outcomes
  const prices = market.outcomePrices.slice(0, 4);
  const outcomes = market.outcomes.slice(0, 4);

  // Bar colours cycle: purple → pink → amber → cyan
  const barColors = ["bg-purple-500", "bg-pink-500", "bg-amber-500", "bg-cyan-500"];
  const labelColors = [
    "bg-purple-500/15 text-purple-400",
    "bg-pink-500/15 text-pink-400",
    "bg-amber-500/15 text-amber-400",
    "bg-cyan-500/15 text-cyan-400",
  ];

  function handleClick() {
    if (market.onchainMarketId) {
      window.location.href = `/market/${market.onchainMarketId}`;
    } else {
      setShowModal(true);
    }
  }

  return (
    <>
      <div
        className="group relative flex h-full cursor-pointer flex-col rounded-lg border border-purple-500/20 bg-card p-4 transition-all duration-200 hover:border-purple-500/40 hover:bg-secondary"
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && handleClick()}
      >
        {/* Header badges */}
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded border border-purple-500/25 bg-purple-500/10 px-2 py-0.5 text-[10px] font-medium text-purple-400">
            Polymarket
          </span>
          {isLive && (
            <span className="inline-flex items-center gap-1 rounded bg-green-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-green-400">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
              LIVE
            </span>
          )}
          {market.resolved && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
              Resolved
            </span>
          )}
        </div>

        {/* Question */}
        <h3 className="mb-4 line-clamp-2 text-sm font-semibold leading-snug text-foreground group-hover:text-purple-300">
          {market.question}
        </h3>

        <div className="mt-auto" />

        {/* Outcome price pills */}
        <div className="mb-3">
          {outcomes.length === 2 ? (
            // Binary — inline row
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground">{outcomes[0]}</span>
              <div className="flex items-center gap-2">
                <span className={cn("rounded px-2.5 py-0.5 text-[11px] font-semibold", labelColors[0])}>
                  {Math.round((prices[0] ?? 0) * 100)}%
                </span>
                <span className={cn("rounded px-2.5 py-0.5 text-[11px] font-semibold", labelColors[1])}>
                  {outcomes[1]} {Math.round((prices[1] ?? 0) * 100)}%
                </span>
              </div>
            </div>
          ) : (
            // Multi-way — compact chips
            <div className="flex flex-wrap gap-1.5">
              {outcomes.map((name, i) => (
                <span
                  key={i}
                  className={cn("rounded px-2 py-0.5 text-[10px] font-semibold truncate max-w-[120px]", labelColors[i % labelColors.length])}
                >
                  {name} {Math.round((prices[i] ?? 0) * 100)}%
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Odds bar */}
        <div className="mb-3">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-secondary">
            {prices.map((p, i) => (
              <div
                key={i}
                className={cn("transition-all duration-500", barColors[i % barColors.length])}
                style={{ width: `${p * 100}%` }}
              />
            ))}
          </div>
        </div>

        {/* Bottom row */}
        <div className="flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted-foreground">
          <span className="font-mono font-medium">Vol. {formatUsd(market.volume)}</span>
          <span className="font-mono">Liq. {formatUsd(market.liquidity)}</span>
        </div>

        {/* "Link to our pool" indicator */}
        {market.onchainMarketId && (
          <div className="mt-2 flex items-center gap-1 text-[9px] text-cyan-400/70">
            <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
            </svg>
            Trade on Pundit
          </div>
        )}
      </div>

      {showModal && (
        <ComingSoonModal question={market.question} onClose={() => setShowModal(false)} />
      )}
    </>
  );
});

export function PolymarketCardSkeleton() {
  return (
    <div className="flex h-full flex-col rounded-lg border border-purple-500/20 bg-card p-4">
      <div className="mb-3 flex gap-2">
        <div className="h-4 w-20 animate-pulse rounded bg-secondary" />
        <div className="h-4 w-10 animate-pulse rounded bg-secondary" />
      </div>
      <div className="mb-2 h-4 w-full animate-pulse rounded bg-secondary" />
      <div className="mb-4 h-4 w-3/4 animate-pulse rounded bg-secondary" />
      <div className="mt-auto" />
      <div className="mb-1.5 flex justify-between gap-2">
        <div className="h-5 w-24 animate-pulse rounded bg-secondary" />
        <div className="h-5 w-20 animate-pulse rounded bg-secondary" />
      </div>
      <div className="mb-3 h-1.5 animate-pulse rounded-full bg-secondary" />
      <div className="flex items-center justify-between border-t border-border pt-3">
        <div className="h-3 w-20 animate-pulse rounded bg-secondary" />
        <div className="h-3 w-16 animate-pulse rounded bg-secondary" />
      </div>
    </div>
  );
}
