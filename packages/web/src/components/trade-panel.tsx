"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { cn } from "@/lib/utils";
import { useToast } from "./toast";
import type { MarketResponse } from "@/lib/api";

interface TradePanelProps {
  market: MarketResponse;
}

const PLATFORM_FEE_BPS = 200;
const BPS = 10000;

export function TradePanel({ market }: TradePanelProps) {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { toast } = useToast();

  const [selectedOutcome, setSelectedOutcome] = useState<0 | 1>(0);
  const [amount, setAmount] = useState("");

  const isResolved = market.status === "RESOLVED";
  const isCancelled = market.status === "CANCELLED";
  const isDisabled = isResolved || isCancelled;

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
      shares: Number(shares) / 1_000_000,
      payout: Number(payout) / 1_000_000,
      profit: Number(payout - amountUsdc) / 1_000_000,
      impliedPct,
      multiplier: amountUsdc > 0n ? Number(payout) / Number(amountUsdc) : 0,
    };
  }, [amount, selectedOutcome, poolYes, poolNo]);

  const handleBuy = () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    toast(
      `Order placed: ${calc?.shares.toFixed(2)} ${selectedOutcome === 0 ? market.outcomeA : market.outcomeB} shares for $${parseFloat(amount).toFixed(2)} USDC`,
      "success"
    );
    setAmount("");
  };

  const handleClaim = () => {
    toast("Claim transaction submitted — contract calls coming in Phase 12", "info");
  };

  const handleMax = () => {
    // Mock balance
    setAmount("10000");
  };

  // Current implied odds
  const currentPctA = totalPool > 0n ? Number((poolYes * 10000n) / totalPool) / 100 : 50;
  const currentPctB = 100 - currentPctA;

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

        <button
          onClick={handleClaim}
          className="w-full rounded-lg bg-emerald-600 py-3 font-heading text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
        >
          Claim Winnings
        </button>
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
        <button
          onClick={handleClaim}
          className="w-full rounded-lg bg-slate-700 py-3 font-heading text-sm font-semibold text-white transition-colors hover:bg-slate-600"
        >
          Claim Refund
        </button>
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
        <label className="mb-1.5 block text-xs font-medium text-slate-400">
          Amount (USDC)
        </label>
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
            disabled={isDisabled}
            className="h-11 w-full rounded-lg border border-slate-700 bg-slate-800/50 pl-7 pr-16 font-mono text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            onClick={handleMax}
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

      {/* Buy button */}
      <button
        onClick={handleBuy}
        disabled={isDisabled || (isConnected && (!calc || parseFloat(amount) <= 0))}
        className={cn(
          "w-full rounded-lg py-3 font-heading text-sm font-semibold transition-colors",
          !isConnected
            ? "bg-blue-600 text-white hover:bg-blue-500"
            : calc && parseFloat(amount) > 0
              ? "bg-blue-600 text-white hover:bg-blue-500"
              : "cursor-not-allowed bg-slate-700 text-slate-500"
        )}
      >
        {!isConnected
          ? "Connect Wallet"
          : !calc || parseFloat(amount) <= 0
            ? "Enter Amount"
            : `Buy ${calc.shares.toLocaleString(undefined, { maximumFractionDigits: 2 })} Shares`}
      </button>

      {/* Fee note */}
      <p className="mt-3 text-center text-xs text-slate-500">
        2% fee applied at resolution
      </p>
    </div>
  );
}
