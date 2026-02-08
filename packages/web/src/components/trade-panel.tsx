"use client";

import { useMemo, useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { cn } from "@/lib/utils";
import { useUSDCBalance, useBuyShares, useClaimWinnings, useUserPosition } from "@/hooks/use-contracts";
import { TransactionToast } from "./transaction-toast";
import type { MarketResponse } from "@/lib/api";

interface TradePanelProps {
  market: MarketResponse;
}

const PLATFORM_FEE_BPS = 200;
const BPS = 10000;

export function TradePanel({ market }: TradePanelProps) {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  const [selectedOutcome, setSelectedOutcome] = useState<0 | 1>(0);
  const [amount, setAmount] = useState("");

  const { balance: usdcBalance, formatted: usdcFormatted } = useUSDCBalance();
  const { buyShares, state: buyState, txHash: buyTxHash, error: buyError, reset: resetBuy } = useBuyShares();
  const { claimWinnings, state: claimState, txHash: claimTxHash, error: claimError, reset: resetClaim } = useClaimWinnings();
  const position = useUserPosition(market.onchainId);

  const isResolved = market.status === "RESOLVED";
  const isCancelled = market.status === "CANCELLED";
  const isDisabled = isResolved || isCancelled;
  const isBuying = buyState !== "idle" && buyState !== "confirmed" && buyState !== "error";

  const poolYes = BigInt(market.poolYes);
  const poolNo = BigInt(market.poolNo);
  const totalPool = poolYes + poolNo;

  // Live calculations
  const calc = useMemo(() => {
    const raw = parseFloat(amount || "0");
    if (raw <= 0 || isNaN(raw)) return null;

    const amountUsdc = BigInt(Math.floor(raw * 1_000_000));
    const shares = amountUsdc; // 1:1

    // Calculate new pool after this trade
    const newPoolYes = selectedOutcome === 0 ? poolYes + amountUsdc : poolYes;
    const newPoolNo = selectedOutcome === 1 ? poolNo + amountUsdc : poolNo;
    const newTotal = newPoolYes + newPoolNo;
    const winningPool = selectedOutcome === 0 ? newPoolYes : newPoolNo;

    // Fee rounds up
    const fee = (newTotal * BigInt(PLATFORM_FEE_BPS) + BigInt(BPS) - 1n) / BigInt(BPS);
    const netPool = newTotal - fee;

    // Potential payout (if this outcome wins)
    const payout = winningPool > 0n ? (shares * netPool) / winningPool : 0n;

    // Implied probability after trade
    const impliedPct = newTotal > 0n
      ? Number((winningPool * 10000n) / newTotal) / 100
      : 50;

    return {
      amountUsdc,
      shares: Number(shares) / 1_000_000,
      payout: Number(payout) / 1_000_000,
      profit: Number(payout - amountUsdc) / 1_000_000,
      impliedPct,
      multiplier: amountUsdc > 0n ? Number(payout) / Number(amountUsdc) : 0,
    };
  }, [amount, selectedOutcome, poolYes, poolNo]);

  // Reset buy state after success so user can trade again
  useEffect(() => {
    if (buyState === "confirmed") {
      setAmount("");
    }
  }, [buyState]);

  const handleBuy = async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    if (!calc || calc.amountUsdc <= 0n) return;

    await buyShares(market.onchainId, selectedOutcome, calc.amountUsdc);
  };

  const handleClaim = async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    await claimWinnings(market.onchainId);
  };

  const handleMax = () => {
    const maxUsdc = Number(usdcBalance) / 1_000_000;
    setAmount(maxUsdc > 0 ? maxUsdc.toFixed(2) : "0");
  };

  // Check insufficient balance
  const insufficientBalance = calc ? calc.amountUsdc > usdcBalance : false;

  // Current implied odds
  const currentPctA = totalPool > 0n ? Number((poolYes * 10000n) / totalPool) / 100 : 50;
  const currentPctB = 100 - currentPctA;

  // User position display
  const hasPosition = position.sharesYes > 0n || position.sharesNo > 0n;

  // ── Resolved state ────────────────────────────────────────────────────────
  if (isResolved) {
    const winnerIdx = market.resolvedOutcome;
    const winnerName = winnerIdx === 0 ? market.outcomeA : market.outcomeB;

    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="mb-4 font-heading text-lg font-semibold text-slate-100">
          Market Resolved
        </h3>

        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
          <p className="text-xs text-emerald-400">Winning Outcome</p>
          <p className="mt-1 font-heading text-xl font-bold text-emerald-300">
            {winnerName}
          </p>
        </div>

        {/* User position info */}
        {hasPosition && (
          <div className="mb-4 space-y-1.5 rounded-lg bg-slate-800/50 p-3 text-xs">
            {position.sharesYes > 0n && (
              <div className="flex justify-between">
                <span className="text-slate-400">{market.outcomeA} shares</span>
                <span className="font-mono text-slate-200">
                  {(Number(position.sharesYes) / 1_000_000).toFixed(2)}
                </span>
              </div>
            )}
            {position.sharesNo > 0n && (
              <div className="flex justify-between">
                <span className="text-slate-400">{market.outcomeB} shares</span>
                <span className="font-mono text-slate-200">
                  {(Number(position.sharesNo) / 1_000_000).toFixed(2)}
                </span>
              </div>
            )}
            {position.hasClaimed && (
              <p className="text-center text-emerald-400">Already claimed</p>
            )}
          </div>
        )}

        {!position.hasClaimed && hasPosition && (
          <>
            <button
              onClick={handleClaim}
              disabled={claimState !== "idle" && claimState !== "confirmed" && claimState !== "error"}
              className="w-full rounded-lg bg-emerald-600 py-3 font-heading text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {claimState === "claiming" || claimState === "awaiting-confirmation"
                ? "Claiming..."
                : "Claim Winnings"}
            </button>
            <TransactionToast
              state={claimState}
              txHash={claimTxHash}
              error={claimError}
              onReset={resetClaim}
              successMessage="Winnings claimed!"
            />
          </>
        )}
      </div>
    );
  }

  if (isCancelled) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="mb-4 font-heading text-lg font-semibold text-slate-100">
          Market Cancelled
        </h3>
        <p className="mb-4 text-sm text-slate-400">
          This market has been cancelled. All participants can claim a full refund.
        </p>

        {hasPosition && !position.hasClaimed && (
          <>
            <button
              onClick={handleClaim}
              disabled={claimState !== "idle" && claimState !== "confirmed" && claimState !== "error"}
              className="w-full rounded-lg bg-slate-700 py-3 font-heading text-sm font-semibold text-white transition-colors hover:bg-slate-600 disabled:opacity-50"
            >
              {claimState === "claiming" || claimState === "awaiting-confirmation"
                ? "Claiming..."
                : "Claim Refund"}
            </button>
            <TransactionToast
              state={claimState}
              txHash={claimTxHash}
              error={claimError}
              onReset={resetClaim}
              successMessage="Refund claimed!"
            />
          </>
        )}
      </div>
    );
  }

  // ── Trading state ─────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <h3 className="mb-4 font-heading text-lg font-semibold text-slate-100">
        Trade
      </h3>

      {/* Outcome selector */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => setSelectedOutcome(0)}
          disabled={isBuying}
          className={cn(
            "rounded-lg border-2 py-3 text-center text-sm font-semibold transition-all",
            selectedOutcome === 0
              ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
              : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"
          )}
        >
          <span className="block text-xs font-normal opacity-70">
            {currentPctA.toFixed(1)}%
          </span>
          {market.outcomeA}
        </button>
        <button
          onClick={() => setSelectedOutcome(1)}
          disabled={isBuying}
          className={cn(
            "rounded-lg border-2 py-3 text-center text-sm font-semibold transition-all",
            selectedOutcome === 1
              ? "border-rose-500 bg-rose-500/10 text-rose-400"
              : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"
          )}
        >
          <span className="block text-xs font-normal opacity-70">
            {currentPctB.toFixed(1)}%
          </span>
          {market.outcomeB}
        </button>
      </div>

      {/* Amount input */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-medium text-slate-400">
            Amount (USDC)
          </label>
          {isConnected && (
            <span className="text-xs text-slate-500">
              Balance: <span className="font-mono text-slate-400">${usdcFormatted}</span>
            </span>
          )}
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
            $
          </span>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            min="0"
            step="0.01"
            disabled={isDisabled || isBuying}
            className="h-11 w-full rounded-lg border border-slate-700 bg-slate-800/50 pl-7 pr-16 font-mono text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            onClick={handleMax}
            disabled={isBuying}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-600"
          >
            MAX
          </button>
        </div>
      </div>

      {/* Live calculations */}
      {calc && (
        <div className="mb-4 space-y-2 rounded-lg bg-slate-800/50 p-3 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-400">Shares received</span>
            <span className="font-mono text-slate-200">
              {calc.shares.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Potential payout</span>
            <span className="font-mono text-emerald-400">
              ${calc.payout.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Potential profit</span>
            <span className={cn("font-mono", calc.profit > 0 ? "text-emerald-400" : "text-slate-400")}>
              {calc.profit > 0 ? "+" : ""}${calc.profit.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Multiplier</span>
            <span className="font-mono text-slate-200">
              {calc.multiplier.toFixed(2)}x
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">New implied prob.</span>
            <span className="font-mono text-slate-200">
              {calc.impliedPct.toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      {/* User position (if any) */}
      {isConnected && hasPosition && (
        <div className="mb-4 space-y-1.5 rounded-lg border border-slate-700/50 bg-slate-800/30 p-3 text-xs">
          <p className="font-medium text-slate-300">Your Position</p>
          {position.sharesYes > 0n && (
            <div className="flex justify-between">
              <span className="text-slate-400">{market.outcomeA} shares</span>
              <span className="font-mono text-emerald-400">
                {(Number(position.sharesYes) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
          {position.sharesNo > 0n && (
            <div className="flex justify-between">
              <span className="text-slate-400">{market.outcomeB} shares</span>
              <span className="font-mono text-rose-400">
                {(Number(position.sharesNo) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Buy button */}
      <button
        onClick={handleBuy}
        disabled={isDisabled || isBuying || (isConnected && (!calc || parseFloat(amount) <= 0 || insufficientBalance))}
        className={cn(
          "w-full rounded-lg py-3 font-heading text-sm font-semibold transition-colors",
          !isConnected
            ? "bg-blue-600 text-white hover:bg-blue-500"
            : isBuying
              ? "cursor-wait bg-blue-600/50 text-blue-200"
              : insufficientBalance
                ? "cursor-not-allowed bg-rose-600/50 text-rose-200"
                : calc && parseFloat(amount) > 0
                  ? "bg-blue-600 text-white hover:bg-blue-500"
                  : "cursor-not-allowed bg-slate-700 text-slate-500"
        )}
      >
        {!isConnected
          ? "Connect Wallet"
          : isBuying
            ? buyState === "approving" || buyState === "awaiting-approval"
              ? "Approving USDC..."
              : "Buying..."
            : insufficientBalance
              ? "Insufficient Balance"
              : !calc || parseFloat(amount) <= 0
                ? "Enter Amount"
                : `Buy ${calc.shares.toLocaleString(undefined, { maximumFractionDigits: 2 })} Shares`}
      </button>

      {/* Transaction status */}
      <TransactionToast
        state={buyState}
        txHash={buyTxHash}
        error={buyError}
        onReset={resetBuy}
        successMessage="Trade confirmed!"
      />

      {/* Fee note */}
      <p className="mt-3 text-center text-xs text-slate-500">
        2% fee applied at resolution
      </p>
    </div>
  );
}
