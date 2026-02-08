"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/toast";
import { fetchPortfolio, fetchTradeHistory, MOCK_MARKETS } from "@/lib/mock-data";
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
  // For active positions, estimate current value from implied odds
  const market = MOCK_MARKETS.find((m) => m.id === position.marketId);
  if (!market) return BigInt(position.invested);

  const poolYes = BigInt(market.poolYes);
  const poolNo = BigInt(market.poolNo);
  const total = poolYes + poolNo;
  if (total === 0n) return BigInt(position.invested);

  const shares = BigInt(position.shares);
  const winningPool = position.outcome === 0 ? poolYes : poolNo;
  if (winningPool === 0n) return 0n;

  // Fee: ceil(total * 200 / 10000)
  const fee = (total * 200n + 9999n) / 10000n;
  const netPool = total - fee;

  // Estimated payout = floor(shares * netPool / winningPool)
  return (shares * netPool) / winningPool;
}

function getPnL(position: PositionResponse): bigint {
  if (position.status === "claimable") {
    return BigInt(position.claimable) - BigInt(position.invested);
  }
  const currentValue = getCurrentValue(position);
  return currentValue - BigInt(position.invested);
}

function getPnLPercent(position: PositionResponse): number {
  const invested = BigInt(position.invested);
  if (invested === 0n) return 0;
  const pnl = getPnL(position);
  return Number((pnl * 10000n) / invested) / 100;
}

// ─── Not Connected State ────────────────────────────────────────────────────

function NotConnectedState() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-slate-800/80">
        <WalletIcon />
      </div>
      <h2 className="mb-2 font-heading text-2xl font-bold text-slate-100">
        Connect Your Wallet
      </h2>
      <p className="mb-6 max-w-sm text-center text-sm text-slate-400">
        Connect your wallet to view your positions, track P&L, and claim
        winnings from resolved markets.
      </p>
      <ConnectButton />
    </div>
  );
}

// ─── Summary Bar ────────────────────────────────────────────────────────────

function SummaryBar({
  portfolio,
  activeCount,
  totalPnL,
}: {
  portfolio: PortfolioResponse;
  activeCount: number;
  totalPnL: bigint;
}) {
  const claimable = BigInt(portfolio.summary.totalClaimable);
  const hasClaim = claimable > 0n;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
          Total Invested
        </p>
        <p className="mt-1 font-heading text-xl font-bold text-slate-100">
          {formatUsdc(portfolio.summary.totalInvested)}
        </p>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
          Unrealized P&L
        </p>
        <p
          className={cn(
            "mt-1 font-heading text-xl font-bold",
            totalPnL > 0n
              ? "text-emerald-400"
              : totalPnL < 0n
                ? "text-rose-400"
                : "text-slate-100"
          )}
        >
          {formatUsdcSigned(totalPnL.toString())}
        </p>
      </div>
      <div
        className={cn(
          "rounded-xl border p-4",
          hasClaim
            ? "border-amber-500/40 bg-amber-950/30"
            : "border-slate-800 bg-slate-900/60"
        )}
      >
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
          Claimable
        </p>
        <div className="mt-1 flex items-center gap-2">
          <p
            className={cn(
              "font-heading text-xl font-bold",
              hasClaim ? "text-amber-400" : "text-slate-100"
            )}
          >
            {formatUsdc(portfolio.summary.totalClaimable)}
          </p>
          {hasClaim && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
            </span>
          )}
        </div>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
          Active Positions
        </p>
        <p className="mt-1 font-heading text-xl font-bold text-slate-100">
          {activeCount}
        </p>
      </div>
    </div>
  );
}

// ─── Claimable Section ──────────────────────────────────────────────────────

function ClaimableSection({
  positions,
  onClaim,
  onClaimAll,
}: {
  positions: PositionResponse[];
  onClaim: (marketId: string) => void;
  onClaimAll: () => void;
}) {
  if (positions.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-gradient-to-b from-amber-950/20 to-transparent p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrophyIcon />
          <h3 className="font-heading text-lg font-bold text-amber-200">
            Claimable Winnings
          </h3>
        </div>
        {positions.length > 1 && (
          <button
            onClick={onClaimAll}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-400"
          >
            Claim All
          </button>
        )}
      </div>
      <div className="space-y-3">
        {positions.map((pos) => {
          const profit = BigInt(pos.claimable) - BigInt(pos.invested);
          return (
            <div
              key={pos.marketId}
              className="flex flex-col gap-3 rounded-lg border border-amber-500/20 bg-slate-900/60 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/market/${pos.marketId}`}
                  className="block truncate font-medium text-slate-100 hover:text-amber-200"
                >
                  {pos.marketQuestion}
                </Link>
                <p className="mt-1 text-sm text-slate-400">
                  Won with{" "}
                  <span className="font-medium text-emerald-400">
                    {pos.outcome === 0 ? "Yes" : "No"}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="font-heading text-lg font-bold text-amber-300">
                    {formatUsdc(pos.claimable)}
                  </p>
                  <p className="text-xs text-emerald-400">
                    +{formatUsdc(profit.toString())} profit
                  </p>
                </div>
                <button
                  onClick={() => onClaim(pos.marketId)}
                  className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-500/20"
                >
                  Claim
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Active Positions ───────────────────────────────────────────────────────

function ActivePositions({ positions }: { positions: PositionResponse[] }) {
  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 py-12">
        <ChartIcon />
        <h3 className="mt-3 font-heading text-lg font-semibold text-slate-200">
          No active positions
        </h3>
        <p className="mt-1 text-sm text-slate-400">
          Start trading on open markets to build your portfolio.
        </p>
        <Link
          href="/"
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
        >
          Browse Markets
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-4 font-heading text-lg font-bold text-slate-100">
        Active Positions
      </h3>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-800 lg:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/80">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                Market
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                Outcome
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">
                Shares
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">
                Avg Price
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">
                Current Value
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">
                P&L
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">
                P&L %
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {positions.map((pos) => {
              const pnl = getPnL(pos);
              const pnlPct = getPnLPercent(pos);
              const currentValue = getCurrentValue(pos);
              const invested = BigInt(pos.invested);
              const shares = BigInt(pos.shares);
              // avg price = invested / shares (in USDC terms)
              const avgPrice =
                shares > 0n
                  ? Number((invested * 1_000_000n) / shares) / 1_000_000
                  : 0;

              return (
                <tr
                  key={pos.marketId}
                  className="transition-colors hover:bg-slate-800/30"
                >
                  <td className="max-w-[280px] px-4 py-3">
                    <Link
                      href={`/market/${pos.marketId}`}
                      className="block truncate text-sm font-medium text-slate-200 hover:text-blue-400"
                    >
                      {pos.marketQuestion}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                        pos.outcome === 0
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-rose-500/15 text-rose-400"
                      )}
                    >
                      {pos.outcome === 0 ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-slate-200">
                    {formatUsdc(pos.shares)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-slate-300">
                    ${avgPrice.toFixed(4)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-slate-200">
                    {formatUsdc(currentValue.toString())}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={cn(
                        "font-mono text-sm font-medium",
                        pnl > 0n
                          ? "text-emerald-400"
                          : pnl < 0n
                            ? "text-rose-400"
                            : "text-slate-400"
                      )}
                    >
                      {formatUsdcSigned(pnl.toString())}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={cn(
                        "font-mono text-sm font-medium",
                        pnlPct > 0
                          ? "text-emerald-400"
                          : pnlPct < 0
                            ? "text-rose-400"
                            : "text-slate-400"
                      )}
                    >
                      {pnlPct >= 0 ? "+" : ""}
                      {pnlPct.toFixed(2)}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile card layout */}
      <div className="space-y-3 lg:hidden">
        {positions.map((pos) => {
          const pnl = getPnL(pos);
          const pnlPct = getPnLPercent(pos);
          const currentValue = getCurrentValue(pos);

          return (
            <Link
              key={pos.marketId}
              href={`/market/${pos.marketId}`}
              className="block rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-colors hover:border-slate-600"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <p className="line-clamp-2 text-sm font-medium text-slate-200">
                  {pos.marketQuestion}
                </p>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
                    pos.outcome === 0
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-rose-500/15 text-rose-400"
                  )}
                >
                  {pos.outcome === 0 ? "Yes" : "No"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 border-t border-slate-800 pt-3 text-xs">
                <div>
                  <p className="text-slate-500">Invested</p>
                  <p className="font-mono font-medium text-slate-300">
                    {formatUsdc(pos.invested)}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Value</p>
                  <p className="font-mono font-medium text-slate-300">
                    {formatUsdc(currentValue.toString())}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500">P&L</p>
                  <p
                    className={cn(
                      "font-mono font-medium",
                      pnl > 0n
                        ? "text-emerald-400"
                        : pnl < 0n
                          ? "text-rose-400"
                          : "text-slate-400"
                    )}
                  >
                    {formatUsdcSigned(pnl.toString())}{" "}
                    <span className="text-[10px]">
                      ({pnlPct >= 0 ? "+" : ""}
                      {pnlPct.toFixed(1)}%)
                    </span>
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
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
    fetchTradeHistory({ page, limit: 5 }).then((data) => {
      setTrades(data.trades);
      setPagination(data.pagination);
      setLoading(false);
    });
  }, [page]);

  return (
    <div>
      <h3 className="mb-4 font-heading text-lg font-bold text-slate-100">
        Trade History
      </h3>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg bg-slate-800/50"
            />
          ))}
        </div>
      ) : trades.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 py-10 text-center">
          <p className="text-sm text-slate-400">No trades yet.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-xl border border-slate-800 md:block">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/80">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    Market
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    Action
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    Outcome
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">
                    Shares
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">
                    Tx Hash
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {trades.map((trade) => (
                  <tr
                    key={trade.id}
                    className="transition-colors hover:bg-slate-800/30"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-400">
                      {timeAgo(trade.timestamp)}
                    </td>
                    <td className="max-w-[250px] px-4 py-3">
                      <Link
                        href={`/market/${trade.marketId}`}
                        className="block truncate text-sm text-slate-200 hover:text-blue-400"
                      >
                        {trade.marketQuestion}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-medium text-blue-400">
                        Buy
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "text-sm font-medium",
                          trade.outcome === 0
                            ? "text-emerald-400"
                            : "text-rose-400"
                        )}
                      >
                        {trade.outcomeName}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-slate-200">
                      {formatUsdc(trade.amount)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-slate-300">
                      {formatUsdc(trade.shares)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={`https://sepolia.basescan.org/tx/${trade.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-blue-400 hover:text-blue-300"
                      >
                        {shortenTxHash(trade.txHash)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {trades.map((trade) => (
              <div
                key={trade.id}
                className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <Link
                    href={`/market/${trade.marketId}`}
                    className="line-clamp-2 text-sm font-medium text-slate-200 hover:text-blue-400"
                  >
                    {trade.marketQuestion}
                  </Link>
                  <span className="shrink-0 text-xs text-slate-500">
                    {timeAgo(trade.timestamp)}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3 border-t border-slate-800 pt-3 text-xs">
                  <div>
                    <p className="text-slate-500">Outcome</p>
                    <p
                      className={cn(
                        "font-medium",
                        trade.outcome === 0
                          ? "text-emerald-400"
                          : "text-rose-400"
                      )}
                    >
                      {trade.outcomeName}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Amount</p>
                    <p className="font-mono font-medium text-slate-300">
                      {formatUsdc(trade.amount)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-500">Tx</p>
                    <a
                      href={`https://sepolia.basescan.org/tx/${trade.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-blue-400 hover:text-blue-300"
                    >
                      {shortenTxHash(trade.txHash)}
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-slate-400">
                Showing {(pagination.page - 1) * pagination.limit + 1}-
                {Math.min(pagination.page * pagination.limit, pagination.total)}{" "}
                of {pagination.total} trades
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    page === 1
                      ? "cursor-not-allowed border-slate-800 text-slate-600"
                      : "border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white"
                  )}
                >
                  Previous
                </button>
                {Array.from({ length: pagination.totalPages }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i + 1)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                      page === i + 1
                        ? "border-blue-500 bg-blue-500/10 text-blue-400"
                        : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white"
                    )}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  onClick={() =>
                    setPage((p) => Math.min(pagination.totalPages, p + 1))
                  }
                  disabled={page === pagination.totalPages}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    page === pagination.totalPages
                      ? "cursor-not-allowed border-slate-800 text-slate-600"
                      : "border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white"
                  )}
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

// ─── Loading Skeleton ───────────────────────────────────────────────────────

function PortfolioSkeleton() {
  return (
    <div className="space-y-8">
      {/* Summary bar skeleton */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
          >
            <div className="mb-2 h-3 w-20 animate-pulse rounded bg-slate-800" />
            <div className="h-6 w-24 animate-pulse rounded bg-slate-800" />
          </div>
        ))}
      </div>
      {/* Position rows skeleton */}
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-xl bg-slate-800/40"
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const { isConnected } = useAccount();
  const { toast } = useToast();
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isConnected) {
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchPortfolio().then((data) => {
      setPortfolio(data);
      setLoading(false);
    });
  }, [isConnected]);

  const handleClaim = (marketId: string) => {
    toast(`Claiming winnings for ${marketId}... (contract call coming in Phase 12)`, "info");
  };

  const handleClaimAll = () => {
    toast(
      "Claiming all winnings... (contract call coming in Phase 12)",
      "info"
    );
  };

  // Compute derived data
  const activePositions =
    portfolio?.positions.filter((p) => p.status === "active") || [];
  const claimablePositions =
    portfolio?.positions.filter((p) => p.status === "claimable") || [];

  const totalPnL = activePositions.reduce(
    (sum, pos) => sum + getPnL(pos),
    0n
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-white">
          Portfolio
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Track your positions, P&L, and claim winnings from resolved markets.
        </p>
      </div>

      {!isConnected ? (
        <NotConnectedState />
      ) : loading ? (
        <PortfolioSkeleton />
      ) : portfolio ? (
        <div className="space-y-8">
          <SummaryBar
            portfolio={portfolio}
            activeCount={activePositions.length}
            totalPnL={totalPnL}
          />
          <ClaimableSection
            positions={claimablePositions}
            onClaim={handleClaim}
            onClaimAll={handleClaimAll}
          />
          <ActivePositions positions={activePositions} />
          <TradeHistory />
        </div>
      ) : null}
    </div>
  );
}

// ─── Inline Icons ───────────────────────────────────────────────────────────

function WalletIcon() {
  return (
    <svg
      className="h-10 w-10 text-slate-500"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3"
      />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg
      className="h-5 w-5 text-amber-400"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0 1 16.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 0 1-2.52.857m0 0a6.098 6.098 0 0 1-2.497 0m0 0a6.023 6.023 0 0 1-2.522-.857"
      />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg
      className="h-8 w-8 text-slate-500"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
      />
    </svg>
  );
}
