"use client";

import { useMemo, useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { cn } from "@/lib/utils";
import { useUSDCBalance, useBuyShares, useClaimWinnings, useUserPosition } from "@/hooks/use-contracts";
import { TransactionToast } from "./transaction-toast";
import type { MarketResponse } from "@/lib/api";

const FEE_BPS = 200;
const BPS = 10000;

interface TradePanelProps {
  market: MarketResponse;
}

export function TradePanel({ market }: TradePanelProps) {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  const [outcome, setOutcome] = useState<0 | 1>(0);
  const [amount, setAmount] = useState("");

  const { balance: usdcBalance, formatted: usdcFmt } = useUSDCBalance();
  const { buyShares, state: buyState, txHash: buyTx, error: buyErr, reset: resetBuy } = useBuyShares();
  const { claimWinnings, state: claimState, txHash: claimTx, error: claimErr, reset: resetClaim } = useClaimWinnings();
  const pos = useUserPosition(market.onchainId);

  const isResolved = market.status === "RESOLVED";
  const isCancelled = market.status === "CANCELLED";
  const isBuying = buyState !== "idle" && buyState !== "confirmed" && buyState !== "error";

  const poolY = BigInt(market.poolYes);
  const poolN = BigInt(market.poolNo);
  const total = poolY + poolN;

  const calc = useMemo(() => {
    const raw = parseFloat(amount || "0");
    if (raw <= 0 || isNaN(raw)) return null;
    const amt = BigInt(Math.floor(raw * 1_000_000));
    const newPoolY = outcome === 0 ? poolY + amt : poolY;
    const newPoolN = outcome === 1 ? poolN + amt : poolN;
    const newTotal = newPoolY + newPoolN;
    const winPool = outcome === 0 ? newPoolY : newPoolN;
    const fee = (newTotal * BigInt(FEE_BPS) + BigInt(BPS) - 1n) / BigInt(BPS);
    const net = newTotal - fee;
    const payout = winPool > 0n ? (amt * net) / winPool : 0n;
    return {
      amt,
      payout: Number(payout) / 1_000_000,
      profit: Number(payout - amt) / 1_000_000,
      mult: amt > 0n ? Number(payout) / Number(amt) : 0,
    };
  }, [amount, outcome, poolY, poolN]);

  useEffect(() => { if (buyState === "confirmed") setAmount(""); }, [buyState]);

  const handleBuy = async () => {
    if (!isConnected) { openConnectModal?.(); return; }
    if (!calc || calc.amt <= 0n) return;
    await buyShares(market.onchainId, outcome, calc.amt);
  };

  const handleClaim = async () => {
    if (!isConnected) { openConnectModal?.(); return; }
    await claimWinnings(market.onchainId);
  };

  const insuf = calc ? calc.amt > usdcBalance : false;
  const hasPos = pos.sharesYes > 0n || pos.sharesNo > 0n;
  const pctY = total > 0n ? Number((poolY * 10000n) / total) / 100 : 50;

  // Resolved / cancelled state
  if (isResolved || isCancelled) {
    const winner = market.resolvedOutcome === 0 ? market.outcomeA : market.outcomeB;
    return (
      <div className="flex flex-col gap-3 p-4">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {isResolved ? "Resolved" : "Cancelled"}
        </div>
        {isResolved && (
          <div className="rounded border border-teal-500/30 bg-teal-500/5 px-3 py-2 text-center">
            <div className="text-[10px] text-teal-400">Winner</div>
            <div className="text-sm font-semibold text-teal-300">{winner}</div>
          </div>
        )}
        {hasPos && (
          <div className="space-y-1 text-[11px]">
            {pos.sharesYes > 0n && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{market.outcomeA}</span>
                <span className="font-mono text-foreground">{(Number(pos.sharesYes) / 1e6).toFixed(2)}</span>
              </div>
            )}
            {pos.sharesNo > 0n && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{market.outcomeB}</span>
                <span className="font-mono text-foreground">{(Number(pos.sharesNo) / 1e6).toFixed(2)}</span>
              </div>
            )}
          </div>
        )}
        {hasPos && !pos.hasClaimed && (
          <>
            <button
              onClick={handleClaim}
              disabled={claimState !== "idle" && claimState !== "confirmed" && claimState !== "error"}
              className="w-full rounded bg-teal-500 py-2 text-xs font-semibold text-black transition-colors hover:bg-teal-400 disabled:opacity-50"
            >
              {claimState === "claiming" || claimState === "awaiting-confirmation" ? "Claiming..." : isResolved ? "Claim Winnings" : "Claim Refund"}
            </button>
            <TransactionToast state={claimState} txHash={claimTx} error={claimErr} onReset={resetClaim} successMessage={isResolved ? "Winnings claimed!" : "Refund claimed!"} />
          </>
        )}
        {pos.hasClaimed && <div className="text-center text-[11px] text-muted-foreground">Already claimed</div>}
      </div>
    );
  }

  // Trading state
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Place Trade
      </div>

      {/* Outcome buttons */}
      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={() => setOutcome(0)}
          disabled={isBuying}
          className={cn(
            "rounded py-2 text-xs font-semibold transition-all",
            outcome === 0
              ? "bg-teal-500 text-black"
              : "bg-secondary text-muted-foreground hover:text-foreground"
          )}
        >
          {market.outcomeA}
          <span className="ml-1 text-[10px] opacity-70">{pctY.toFixed(1)}%</span>
        </button>
        <button
          onClick={() => setOutcome(1)}
          disabled={isBuying}
          className={cn(
            "rounded py-2 text-xs font-semibold transition-all",
            outcome === 1
              ? "bg-rose-500 text-white"
              : "bg-secondary text-muted-foreground hover:text-foreground"
          )}
        >
          {market.outcomeB}
          <span className="ml-1 text-[10px] opacity-70">{(100 - pctY).toFixed(1)}%</span>
        </button>
      </div>

      {/* Amount */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Amount (USDC)</span>
          {isConnected && <span>Bal: <span className="font-mono">${usdcFmt}</span></span>}
        </div>
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            min="0"
            step="0.01"
            disabled={isBuying}
            className="h-9 w-full rounded border border-border bg-secondary px-2 pr-14 font-mono text-xs text-foreground placeholder-muted-foreground outline-none focus:border-teal-500 disabled:opacity-50"
          />
          <button
            onClick={() => { const m = Number(usdcBalance) / 1e6; setAmount(m > 0 ? m.toFixed(2) : "0"); }}
            disabled={isBuying}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
          >
            MAX
          </button>
        </div>
      </div>

      {/* Calculations */}
      {calc && (
        <div className="space-y-1.5 rounded border border-border bg-card p-2.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Payout</span>
            <span className="font-mono text-foreground">${calc.payout.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Profit</span>
            <span className={cn("font-mono", calc.profit > 0 ? "text-teal-400" : "text-muted-foreground")}>
              {calc.profit > 0 ? "+" : ""}${calc.profit.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Multiplier</span>
            <span className="font-mono text-foreground">{calc.mult.toFixed(2)}x</span>
          </div>
        </div>
      )}

      {/* Position */}
      {isConnected && hasPos && (
        <div className="space-y-1 rounded border border-border bg-card p-2.5 text-[11px]">
          <div className="text-[10px] font-medium text-muted-foreground">Your Position</div>
          {pos.sharesYes > 0n && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{market.outcomeA}</span>
              <span className="font-mono text-teal-400">{(Number(pos.sharesYes) / 1e6).toFixed(2)}</span>
            </div>
          )}
          {pos.sharesNo > 0n && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{market.outcomeB}</span>
              <span className="font-mono text-rose-400">{(Number(pos.sharesNo) / 1e6).toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {/* Buy button */}
      <button
        onClick={handleBuy}
        disabled={isBuying || (isConnected && (!calc || parseFloat(amount) <= 0 || insuf))}
        className={cn(
          "w-full rounded py-2.5 text-xs font-semibold transition-colors",
          !isConnected ? "bg-teal-500 text-black hover:bg-teal-400"
            : isBuying ? "cursor-wait bg-teal-500/50 text-teal-200"
            : insuf ? "cursor-not-allowed bg-rose-500/30 text-rose-300"
            : calc && parseFloat(amount) > 0 ? "bg-teal-500 text-black hover:bg-teal-400"
            : "cursor-not-allowed bg-secondary text-muted-foreground"
        )}
      >
        {!isConnected ? "Connect Wallet"
          : isBuying ? (buyState === "approving" || buyState === "awaiting-approval" ? "Approving..." : "Buying...")
          : insuf ? "Insufficient Balance"
          : !calc || parseFloat(amount) <= 0 ? "Enter Amount"
          : `Buy ${outcome === 0 ? "Yes" : "No"}`}
      </button>

      <TransactionToast state={buyState} txHash={buyTx} error={buyErr} onReset={resetBuy} successMessage="Trade confirmed!" />

      <div className="text-center text-[10px] text-muted-foreground">2% fee at resolution</div>
    </div>
  );
}
