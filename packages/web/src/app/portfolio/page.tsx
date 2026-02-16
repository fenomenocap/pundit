"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useClaimWinnings } from "@/hooks/use-contracts";
import { TransactionToast } from "@/components/transaction-toast";
import { fetchPortfolio, fetchTradeHistory } from "@/lib/mock-data";
import type {
  PositionResponse,
  PortfolioResponse,
  TradeWithMarketResponse,
  PaginationResponse,
} from "@/lib/api";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatUsdc(raw: string): string {
  const n = Number(BigInt(raw)) / 1_000_000;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function formatUsdcSigned(raw: string): string {
  const n = Number(BigInt(raw)) / 1_000_000;
  const sign = n >= 0 ? "+" : "";
  if (Math.abs(n) >= 1_000_000) return `${sign}$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${sign}$${(n / 1_000).toFixed(2)}K`;
  return `${sign}$${n.toFixed(2)}`;
}

function shortenTxHash(hash: string): string {
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getCurrentValue(position: PositionResponse): bigint {
  // For active positions, estimate current value as invested amount
  // (accurate P&L requires live pool data from contract reads)
  return BigInt(position.invested);
}

function getPnL(position: PositionResponse): bigint {
  if (position.status === "claimable") {
    return BigInt(position.claimable) - BigInt(position.invested);
  }
  return getCurrentValue(position) - BigInt(position.invested);
}

function getPnLPercent(position: PositionResponse): number {
  const invested = BigInt(position.invested);
  if (invested === 0n) return 0;
  return Number((getPnL(position) * 10000n) / invested) / 100;
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const { isConnected } = useAccount();
  const { claimWinnings, state: claimState, txHash: claimTxHash, error: claimError, reset: resetClaim } = useClaimWinnings();
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Portfolio | Sports Predict";
    return () => { document.title = "Sports Predict"; };
  }, []);

  useEffect(() => {
    if (!isConnected) { setLoading(false); return; }
    setLoading(true);
    fetchPortfolio().then((data) => { setPortfolio(data); setLoading(false); });
  }, [isConnected]);

  const handleClaim = (marketId: string) => {
    const onchainId = parseInt(marketId.replace("market-", "").replace("market-won-", ""), 10);
    if (!isNaN(onchainId)) claimWinnings(onchainId);
  };

  const handleClaimAll = () => {
    const first = portfolio?.positions.find((p) => p.status === "claimable");
    if (first) handleClaim(first.marketId);
  };

  const activePositions = portfolio?.positions.filter((p) => p.status === "active") || [];
  const claimablePositions = portfolio?.positions.filter((p) => p.status === "claimable") || [];
  const totalPnL = activePositions.reduce((sum, pos) => sum + getPnL(pos), 0n);

  if (!isConnected) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Connect your wallet to view your portfolio</p>
        <ConnectButton />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-teal-400 border-t-transparent" />
      </div>
    );
  }

  if (!portfolio) return null;

  const isClaiming = claimState !== "idle" && claimState !== "confirmed" && claimState !== "error";

  return (
    <div className="flex flex-1 flex-col">
      {/* Summary strip */}
      <div className="flex items-center gap-6 border-b border-border px-4 py-2 text-[11px]">
        <span className="text-muted-foreground">
          Invested <span className="font-mono text-foreground">{formatUsdc(portfolio.summary.totalInvested)}</span>
        </span>
        <span className="text-muted-foreground">
          P&L{" "}
          <span className={cn("font-mono", totalPnL > 0n ? "text-teal-400" : totalPnL < 0n ? "text-rose-400" : "text-foreground")}>
            {formatUsdcSigned(totalPnL.toString())}
          </span>
        </span>
        <span className="text-muted-foreground">
          Claimable{" "}
          <span className={cn("font-mono", BigInt(portfolio.summary.totalClaimable) > 0n ? "text-amber-400" : "text-foreground")}>
            {formatUsdc(portfolio.summary.totalClaimable)}
          </span>
        </span>
        <span className="text-muted-foreground">
          Positions <span className="font-mono text-foreground">{activePositions.length}</span>
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        {/* Claimable section */}
        {claimablePositions.length > 0 && (
          <div className="border-b border-border">
            <div className="flex items-center justify-between px-4 py-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-amber-400">
                Claimable Winnings
              </span>
              {claimablePositions.length > 1 && (
                <button
                  onClick={handleClaimAll}
                  disabled={isClaiming}
                  className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400 hover:bg-amber-500/25 disabled:opacity-50"
                >
                  {isClaiming ? "Claiming..." : "Claim All"}
                </button>
              )}
            </div>
            <table className="w-full text-xs">
              <tbody>
                {claimablePositions.map((pos) => {
                  const profit = BigInt(pos.claimable) - BigInt(pos.invested);
                  return (
                    <tr key={pos.marketId} className="border-b border-border last:border-0 hover:bg-secondary/50">
                      <td className="px-4 py-2">
                        <Link href={`/market/${pos.marketId}`} className="text-foreground hover:text-teal-400">
                          {pos.marketQuestion}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={cn("font-medium", pos.outcome === 0 ? "text-teal-400" : "text-rose-400")}>
                          {pos.outcome === 0 ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-amber-400">
                        {formatUsdc(pos.claimable)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-teal-400">
                        +{formatUsdc(profit.toString())}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => handleClaim(pos.marketId)}
                          disabled={isClaiming}
                          className="rounded bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
                        >
                          {isClaiming ? "..." : "Claim"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <TransactionToast state={claimState} txHash={claimTxHash} error={claimError} onReset={resetClaim} successMessage="Winnings claimed!" />
          </div>
        )}

        {/* Active positions table */}
        <div>
          <div className="px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Active Positions
          </div>
          {activePositions.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              No active positions.{" "}
              <Link href="/" className="text-teal-400 hover:underline">Browse markets</Link>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] text-muted-foreground">
                  <th className="px-4 py-1 text-left font-medium">Market</th>
                  <th className="px-3 py-1 text-left font-medium">Side</th>
                  <th className="px-3 py-1 text-right font-medium">Shares</th>
                  <th className="px-3 py-1 text-right font-medium">Avg Price</th>
                  <th className="px-3 py-1 text-right font-medium">Value</th>
                  <th className="px-3 py-1 text-right font-medium">P&L</th>
                  <th className="px-3 py-1 text-right font-medium">P&L %</th>
                </tr>
              </thead>
              <tbody>
                {activePositions.map((pos) => {
                  const pnl = getPnL(pos);
                  const pnlPct = getPnLPercent(pos);
                  const currentValue = getCurrentValue(pos);
                  const invested = BigInt(pos.invested);
                  const shares = BigInt(pos.shares);
                  const avgPrice = shares > 0n ? Number((invested * 1_000_000n) / shares) / 1_000_000 : 0;

                  return (
                    <tr key={pos.marketId} className="border-b border-border hover:bg-secondary/50">
                      <td className="max-w-[260px] truncate px-4 py-2">
                        <Link href={`/market/${pos.marketId}`} className="text-foreground hover:text-teal-400">
                          {pos.marketQuestion}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn("font-medium", pos.outcome === 0 ? "text-teal-400" : "text-rose-400")}>
                          {pos.outcome === 0 ? "YES" : "NO"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">
                        {formatUsdc(pos.shares)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                        ${avgPrice.toFixed(4)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">
                        {formatUsdc(currentValue.toString())}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={cn("font-mono", pnl > 0n ? "text-teal-400" : pnl < 0n ? "text-rose-400" : "text-muted-foreground")}>
                          {formatUsdcSigned(pnl.toString())}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={cn("font-mono", pnlPct > 0 ? "text-teal-400" : pnlPct < 0 ? "text-rose-400" : "text-muted-foreground")}>
                          {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Trade history */}
        <TradeHistory />
      </div>
    </div>
  );
}

// ─── Trade History ──────────────────────────────────────────────────────────

function TradeHistory() {
  const [trades, setTrades] = useState<TradeWithMarketResponse[]>([]);
  const [pagination, setPagination] = useState<PaginationResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchTradeHistory({ page, limit: 10 }).then((data) => {
      setTrades(data.trades);
      setPagination(data.pagination);
      setLoading(false);
    });
  }, [page]);

  return (
    <div className="border-t border-border">
      <div className="px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Trade History
      </div>

      {loading ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">Loading...</div>
      ) : trades.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">No trades yet</div>
      ) : (
        <>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] text-muted-foreground">
                <th className="px-4 py-1 text-left font-medium">Time</th>
                <th className="px-3 py-1 text-left font-medium">Market</th>
                <th className="px-3 py-1 text-left font-medium">Side</th>
                <th className="px-3 py-1 text-right font-medium">Amount</th>
                <th className="px-3 py-1 text-right font-medium">Shares</th>
                <th className="px-3 py-1 text-right font-medium">Tx</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr key={trade.id} className="border-b border-border hover:bg-secondary/50">
                  <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                    {timeAgo(trade.timestamp)}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2">
                    <Link href={`/market/${trade.marketId}`} className="text-foreground hover:text-teal-400">
                      {trade.marketQuestion}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn("font-medium", trade.outcome === 0 ? "text-teal-400" : "text-rose-400")}>
                      {trade.outcomeName}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-foreground">
                    {formatUsdc(trade.amount)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                    {formatUsdc(trade.shares)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <a
                      href={`https://sepolia.basescan.org/tx/${trade.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] text-teal-400 hover:text-teal-300"
                    >
                      {shortenTxHash(trade.txHash)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 text-[10px] text-muted-foreground">
              <span>
                {(pagination.page - 1) * pagination.limit + 1}-
                {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={page === pagination.totalPages}
                  className="rounded border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
