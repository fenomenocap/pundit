"use client";

import { useMemo, useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { cn } from "@/lib/utils";
import { useUSDCBalance, useBuyOutcome, useSellOutcome, useClaimWinnings, useUserPosition } from "@/hooks/use-contracts";
import { TransactionToast } from "./transaction-toast";
import type { MarketResponse } from "@/lib/api";

const FEE_BPS = 200;
const BPS = 10000;

interface TradePanelProps {
  market: MarketResponse;
}

// ─── AMM price helpers ──────────────────────────────────────────────────────

function getAmmPrice(market: MarketResponse, outcome: 0 | 1): number {
  const yesRes = Number(BigInt(market.poolYes));
  const noRes = Number(BigInt(market.poolNo));
  const total = yesRes + noRes;
  if (total === 0) return 50;
  if (outcome === 0) return (noRes / total) * 100;
  return (yesRes / total) * 100;
}

function formatCents(pct: number): string {
  const cents = Math.round(pct);
  if (cents >= 100) return "$1.00";
  return `${cents}\u00A2`; // ¢ symbol
}

function formatUsd(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1000) return `$${(val / 1000).toFixed(val >= 10000 ? 0 : 1)}K`;
  if (val >= 1) return `$${val.toFixed(2)}`;
  return `$${val.toFixed(2)}`;
}

export function TradePanel({ market }: TradePanelProps) {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [outcome, setOutcome] = useState<0 | 1>(0);
  const [amount, setAmount] = useState("");

  const { balance: usdcBalance, formatted: usdcFmt } = useUSDCBalance();
  const { buyOutcome, state: buyState, txHash: buyTx, error: buyErr, reset: resetBuy } = useBuyOutcome();
  const { sellOutcome, state: sellState, txHash: sellTx, error: sellErr, reset: resetSell } = useSellOutcome();
  const { claimWinnings, state: claimState, txHash: claimTx, error: claimErr, reset: resetClaim } = useClaimWinnings();
  const pos = useUserPosition(market.onchainId);

  const isResolved = market.status === "RESOLVED";
  const isCancelled = market.status === "CANCELLED";
  const isBuying = buyState !== "idle" && buyState !== "confirmed" && buyState !== "error";
  const isSelling = sellState !== "idle" && sellState !== "confirmed" && sellState !== "error";
  const isTrading = isBuying || isSelling;

  const yesPrice = getAmmPrice(market, 0);
  const noPrice = getAmmPrice(market, 1);

  // AMM reserves (in raw units)
  const yesRes = BigInt(market.poolYes);
  const noRes = BigInt(market.poolNo);

  // ─── Buy calculation (CPMM) ─────────────────────────────────────────────
  const buyCalc = useMemo(() => {
    if (mode !== "buy") return null;
    const raw = parseFloat(amount || "0");
    if (raw <= 0 || isNaN(raw)) return null;

    const amtUsdc = BigInt(Math.floor(raw * 1_000_000));
    const fee = (amtUsdc * BigInt(FEE_BPS) + BigInt(BPS) - 1n) / BigInt(BPS);
    const net = amtUsdc - fee;

    // CPMM: sharesOut = targetReserve * net / (oppositeReserve + net)
    let sharesOut: bigint;
    if (outcome === 0) {
      sharesOut = noRes + net > 0n ? (yesRes * net) / (noRes + net) : 0n;
    } else {
      sharesOut = yesRes + net > 0n ? (noRes * net) / (yesRes + net) : 0n;
    }

    const sharesF = Number(sharesOut) / 1_000_000;
    const costF = raw;
    const avgPrice = sharesF > 0 ? costF / sharesF : 0;
    const payout = sharesF; // each share = $1 if outcome wins
    const profit = payout - costF;

    return { amtUsdc, sharesOut, sharesF, costF, avgPrice, payout, profit };
  }, [amount, outcome, mode, yesRes, noRes]);

  // ─── Sell calculation (CPMM reverse) ────────────────────────────────────
  const sellCalc = useMemo(() => {
    if (mode !== "sell") return null;
    const raw = parseFloat(amount || "0");
    if (raw <= 0 || isNaN(raw)) return null;

    const shares = BigInt(Math.floor(raw * 1_000_000));

    // CPMM reverse: usdcOut = oppositeReserve * shares / (targetReserve + shares)
    let grossOut: bigint;
    if (outcome === 0) {
      grossOut = yesRes + shares > 0n ? (noRes * shares) / (yesRes + shares) : 0n;
    } else {
      grossOut = noRes + shares > 0n ? (yesRes * shares) / (noRes + shares) : 0n;
    }

    const fee = (grossOut * BigInt(FEE_BPS) + BigInt(BPS) - 1n) / BigInt(BPS);
    const netOut = grossOut - fee;
    const usdcOutF = Number(netOut) / 1_000_000;
    const avgPrice = raw > 0 ? usdcOutF / raw : 0;

    return { shares, netOut, usdcOutF, avgPrice };
  }, [amount, outcome, mode, yesRes, noRes]);

  // Clear amount on confirmed trade
  useEffect(() => {
    if (buyState === "confirmed" || sellState === "confirmed") setAmount("");
  }, [buyState, sellState]);

  const handleBuy = async () => {
    if (!isConnected) { openConnectModal?.(); return; }
    if (!buyCalc || buyCalc.amtUsdc <= 0n) return;
    await buyOutcome(market.onchainId, outcome, buyCalc.amtUsdc);
  };

  const handleSell = async () => {
    if (!isConnected) { openConnectModal?.(); return; }
    if (!sellCalc || sellCalc.shares <= 0n) return;
    await sellOutcome(market.onchainId, outcome, sellCalc.shares);
  };

  const handleClaim = async () => {
    if (!isConnected) { openConnectModal?.(); return; }
    await claimWinnings(market.onchainId);
  };

  const insuf = mode === "buy" && buyCalc ? buyCalc.amtUsdc > usdcBalance : false;
  const hasPos = pos.sharesYes > 0n || pos.sharesNo > 0n;
  const sellableShares = outcome === 0 ? pos.sharesYes : pos.sharesNo;
  const sellInsuf = mode === "sell" && sellCalc ? sellCalc.shares > sellableShares : false;

  // ─── Resolved / Cancelled ───────────────────────────────────────────────
  if (isResolved || isCancelled) {
    const winner = market.resolvedOutcome === 0 ? market.outcomeA : market.outcomeB;
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {isResolved ? "Resolved" : "Cancelled"}
        </div>
        {isResolved && (
          <div className="rounded-lg border border-teal-500/30 bg-teal-500/5 px-3 py-2.5 text-center">
            <div className="text-[10px] text-teal-400">Winner</div>
            <div className="text-sm font-semibold text-teal-300">{winner}</div>
          </div>
        )}
        {hasPos && (
          <div className="space-y-1.5 text-[11px]">
            {pos.sharesYes > 0n && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{market.outcomeA} shares</span>
                <span className="font-mono text-foreground">{(Number(pos.sharesYes) / 1e6).toFixed(2)}</span>
              </div>
            )}
            {pos.sharesNo > 0n && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{market.outcomeB} shares</span>
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
              className="w-full rounded-lg bg-teal-500 py-2.5 text-xs font-semibold text-black transition-colors hover:bg-teal-400 disabled:opacity-50"
            >
              {claimState === "claiming" || claimState === "awaiting-confirmation"
                ? "Claiming..."
                : isResolved ? "Claim Winnings" : "Claim Refund"}
            </button>
            <TransactionToast state={claimState} txHash={claimTx} error={claimErr} onReset={resetClaim} successMessage={isResolved ? "Winnings claimed!" : "Refund claimed!"} />
          </>
        )}
        {pos.hasClaimed && <div className="text-center text-[11px] text-muted-foreground">Already claimed</div>}
      </div>
    );
  }

  // ─── Active Trading Panel ───────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      {/* Outcome + action label */}
      <div>
        <div className="text-[11px] text-muted-foreground">{market.question}</div>
        <div className="mt-0.5 text-sm font-semibold">
          <span className={outcome === 0 ? "text-teal-400" : "text-rose-400"}>
            {mode === "buy" ? "Buy" : "Sell"} {outcome === 0 ? "Yes" : "No"}
          </span>
          <span className="text-muted-foreground"> · {market.teamA || market.outcomeA}</span>
        </div>
      </div>

      {/* Buy / Sell tabs */}
      <div className="flex gap-1">
        <button
          onClick={() => { setMode("buy"); setAmount(""); }}
          disabled={isTrading}
          className={cn(
            "rounded-md px-4 py-1.5 text-xs font-semibold transition-all",
            mode === "buy"
              ? "bg-teal-500/15 text-teal-400 border border-teal-500/30"
              : "bg-secondary text-muted-foreground hover:text-foreground border border-transparent"
          )}
        >
          Buy
        </button>
        <button
          onClick={() => { setMode("sell"); setAmount(""); }}
          disabled={isTrading || !hasPos}
          className={cn(
            "rounded-md px-4 py-1.5 text-xs font-semibold transition-all",
            mode === "sell"
              ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
              : "bg-secondary text-muted-foreground hover:text-foreground border border-transparent",
            !hasPos && "opacity-40 cursor-not-allowed"
          )}
        >
          Sell
        </button>
      </div>

      {/* Outcome selector with prices */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => { setOutcome(0); setAmount(""); }}
          disabled={isTrading}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-sm font-semibold transition-all",
            outcome === 0
              ? "border-teal-500/40 bg-teal-500/10 text-teal-400"
              : "border-border bg-secondary text-muted-foreground hover:border-border/80 hover:text-foreground"
          )}
        >
          {market.outcomeA}
          <span className={cn("text-xs font-medium", outcome === 0 ? "text-teal-300" : "text-muted-foreground")}>
            {formatCents(yesPrice)}
          </span>
        </button>
        <button
          onClick={() => { setOutcome(1); setAmount(""); }}
          disabled={isTrading}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-sm font-semibold transition-all",
            outcome === 1
              ? "border-rose-500/40 bg-rose-500/10 text-rose-400"
              : "border-border bg-secondary text-muted-foreground hover:border-border/80 hover:text-foreground"
          )}
        >
          {market.outcomeB}
          <span className={cn("text-xs font-medium", outcome === 1 ? "text-rose-300" : "text-muted-foreground")}>
            {formatCents(noPrice)}
          </span>
        </button>
      </div>

      {/* Amount input */}
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{mode === "buy" ? "Amount" : "Shares to sell"}</span>
          {isConnected && mode === "buy" && (
            <span>Balance: <span className="font-mono text-foreground">${usdcFmt}</span></span>
          )}
          {isConnected && mode === "sell" && (
            <span>
              Available: <span className="font-mono text-foreground">
                {(Number(sellableShares) / 1e6).toFixed(2)}
              </span>
            </span>
          )}
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {mode === "buy" ? "$" : "#"}
          </span>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            min="0"
            step="0.01"
            disabled={isTrading}
            className="h-10 w-full rounded-lg border border-border bg-secondary pl-7 pr-16 font-mono text-sm text-foreground placeholder-muted-foreground outline-none focus:border-teal-500/50 disabled:opacity-50"
          />
          <button
            onClick={() => {
              if (mode === "buy") {
                const m = Number(usdcBalance) / 1e6;
                setAmount(m > 0 ? m.toFixed(2) : "0");
              } else {
                const s = Number(sellableShares) / 1e6;
                setAmount(s > 0 ? s.toFixed(2) : "0");
              }
            }}
            disabled={isTrading}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-muted px-2.5 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            MAX
          </button>
        </div>
      </div>

      {/* Trade details — Buy mode */}
      {mode === "buy" && buyCalc && (
        <div className="space-y-2 text-[12px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Average price</span>
            <span className="font-mono text-foreground">{formatCents(buyCalc.avgPrice * 100)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Shares</span>
            <span className="font-mono text-foreground">{buyCalc.sharesF.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Estimated cost</span>
            <span className="font-mono text-foreground">{formatUsd(buyCalc.costF)}</span>
          </div>
          <div className="my-1 border-t border-border/50" />
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Payout if {outcome === 0 ? market.outcomeA : market.outcomeB}
            </span>
            <span className="font-mono text-foreground">
              {formatUsd(buyCalc.payout)}
              {buyCalc.profit > 0 && (
                <span className="ml-1 text-teal-400">(+{formatUsd(buyCalc.profit)})</span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Trade details — Sell mode */}
      {mode === "sell" && sellCalc && (
        <div className="space-y-2 text-[12px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Average price</span>
            <span className="font-mono text-foreground">{formatCents(sellCalc.avgPrice * 100)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">You receive</span>
            <span className="font-mono text-teal-400">{formatUsd(sellCalc.usdcOutF)}</span>
          </div>
        </div>
      )}

      {/* Position display */}
      {isConnected && hasPos && (
        <div className="space-y-1.5 rounded-lg border border-border bg-secondary/50 p-3 text-[11px]">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your Position</div>
          {pos.sharesYes > 0n && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{market.outcomeA} shares</span>
              <div className="text-right">
                <span className="font-mono text-teal-400">{(Number(pos.sharesYes) / 1e6).toFixed(2)}</span>
                <span className="ml-1.5 text-muted-foreground">
                  ({formatUsd(Number(pos.sharesYes) / 1e6 * yesPrice / 100)})
                </span>
              </div>
            </div>
          )}
          {pos.sharesNo > 0n && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{market.outcomeB} shares</span>
              <div className="text-right">
                <span className="font-mono text-rose-400">{(Number(pos.sharesNo) / 1e6).toFixed(2)}</span>
                <span className="ml-1.5 text-muted-foreground">
                  ({formatUsd(Number(pos.sharesNo) / 1e6 * noPrice / 100)})
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action button */}
      {mode === "buy" ? (
        <button
          onClick={handleBuy}
          disabled={isBuying || (isConnected && (!buyCalc || parseFloat(amount) <= 0 || insuf))}
          className={cn(
            "w-full rounded-lg py-3 text-sm font-semibold transition-colors",
            !isConnected ? "bg-teal-500 text-black hover:bg-teal-400"
              : isBuying ? "cursor-wait bg-teal-500/50 text-teal-200"
              : insuf ? "cursor-not-allowed bg-rose-500/20 text-rose-400 border border-rose-500/30"
              : buyCalc && parseFloat(amount) > 0
                ? "bg-teal-500 text-black hover:bg-teal-400"
                : "cursor-not-allowed bg-secondary text-muted-foreground"
          )}
        >
          {!isConnected ? "Connect Wallet"
            : isBuying ? (buyState === "approving" || buyState === "awaiting-approval" ? "Approving USDC..." : "Placing Trade...")
            : insuf ? "Insufficient Balance"
            : !buyCalc || parseFloat(amount) <= 0 ? "Enter Amount"
            : `Buy ${outcome === 0 ? "Yes" : "No"}`}
        </button>
      ) : (
        <button
          onClick={handleSell}
          disabled={isSelling || (isConnected && (!sellCalc || parseFloat(amount) <= 0 || sellInsuf))}
          className={cn(
            "w-full rounded-lg py-3 text-sm font-semibold transition-colors",
            !isConnected ? "bg-rose-500 text-white hover:bg-rose-400"
              : isSelling ? "cursor-wait bg-rose-500/50 text-rose-200"
              : sellInsuf ? "cursor-not-allowed bg-rose-500/20 text-rose-400 border border-rose-500/30"
              : sellCalc && parseFloat(amount) > 0
                ? "bg-rose-500 text-white hover:bg-rose-400"
                : "cursor-not-allowed bg-secondary text-muted-foreground"
          )}
        >
          {!isConnected ? "Connect Wallet"
            : isSelling ? "Selling..."
            : sellInsuf ? "Insufficient Shares"
            : !sellCalc || parseFloat(amount) <= 0 ? "Enter Amount"
            : `Sell ${outcome === 0 ? "Yes" : "No"}`}
        </button>
      )}

      {/* Transaction toast */}
      {mode === "buy" && (
        <TransactionToast state={buyState} txHash={buyTx} error={buyErr} onReset={resetBuy} successMessage="Trade confirmed!" />
      )}
      {mode === "sell" && (
        <TransactionToast state={sellState} txHash={sellTx} error={sellErr} onReset={resetSell} successMessage="Shares sold!" />
      )}

      <div className="text-center text-[10px] text-muted-foreground">
        2% fee per trade · AMM powered
      </div>
    </div>
  );
}
