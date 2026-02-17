"use client";

import type { TradeResponse } from "@/lib/api";

interface RecentTradesProps {
  trades: TradeResponse[];
  outcomeA: string;
  outcomeB: string;
}

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatUsdc(raw: string): string {
  const n = Number(BigInt(raw)) / 1_000_000;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function RecentTrades({ trades, outcomeA, outcomeB }: RecentTradesProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="mb-4 font-heading text-sm font-semibold text-slate-200">
        Recent Trades
      </h3>

      {trades.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          No trades yet
        </p>
      ) : (
        <div className="space-y-0">
          {trades.map((trade) => (
            <div
              key={trade.id}
              className="flex items-center justify-between border-b border-slate-800/50 py-2.5 last:border-0"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={
                    trade.outcome === 0
                      ? "h-2 w-2 rounded-full bg-cyan-500"
                      : "h-2 w-2 rounded-full bg-pink-500"
                  }
                />
                <div>
                  <span className="text-xs font-medium text-slate-300">
                    {shortenAddress(trade.userAddress)}
                  </span>
                  <span className="ml-1.5 text-xs text-slate-500">
                    bought{" "}
                    <span
                      className={
                        trade.outcome === 0
                          ? "text-cyan-400"
                          : "text-pink-400"
                      }
                    >
                      {trade.outcome === 0 ? outcomeA : outcomeB}
                    </span>
                  </span>
                </div>
              </div>
              <div className="text-right">
                <span className="block font-mono text-xs text-slate-200">
                  ${formatUsdc(trade.amount)}
                </span>
                <span className="block text-xs text-slate-500">
                  {timeAgo(trade.timestamp)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
