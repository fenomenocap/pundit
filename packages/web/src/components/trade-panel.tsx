"use client";

import { useMemo, useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { cn } from "@/lib/utils";
import { useUSDCBalance, useBuyShares, useClaimWinnings, useUserPosition, useMintTestUSDC } from "@/hooks/use-contracts";
import { TransactionToast } from "./transaction-toast";
import type { MarketResponse } from "@/lib/api";

const FEE_BPS = 200;
const BPS = 10000;

// ─── Outcome type: 0=Yes/Home, 1=No/Away, 2=Draw ────────────────────────────
type OutcomeIndex = 0 | 1 | 2;

interface TradePanelProps {
  market: MarketResponse;
  onOutcomeClick?: (outcome: OutcomeIndex) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getOutcomeNames(market: MarketResponse): string[] {
  const names = [market.outcomeA, market.outcomeB];
  if (market.outcomeC) names.push(market.outcomeC);
  return names;
}

function getOutcomeColor(idx: OutcomeIndex): { text: string; bg: string; border: string } {
  if (idx === 0) return { text: "text-cyan-400",  bg: "bg-cyan-500/10",  border: "border-cyan-500/40"  };
  if (idx === 1) return { text: "text-pink-400",  bg: "bg-pink-500/10",  border: "border-pink-500/40"  };
  return            { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/40" };
}

/** Parimutuel implied probability: P(i) = pool[i] / totalPool */
function getParimutuelPrice(market: MarketResponse, outcome: OutcomeIndex): number {
  const yes  = Number(BigInt(market.poolYes));
  const no   = Number(BigInt(market.poolNo));
  const draw = market.poolDraw ? Number(BigInt(market.poolDraw)) : 0;
  const total = yes + no + draw;
  if (total === 0) return market.outcomeC ? 33.33 : 50;
  const pool = outcome === 0 ? yes : outcome === 1 ? no : draw;
  return (pool / total) * 100;
}

function formatCents(pct: number): string {
  const cents = Math.round(pct);
  if (cents >= 100) return "$1.00";
  if (cents <= 0) return "1¢";
  return `${cents}¢`;
}

function formatUsd(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1000) return `$${(val / 1000).toFixed(val >= 10000 ? 0 : 1)}K`;
  return `$${val.toFixed(2)}`;
}

export function TradePanel({ market, onOutcomeClick }: TradePanelProps) {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  const [outcome, setOutcome] = useState<OutcomeIndex>(0);
  const [amount, setAmount] = useState("");

  const outcomeNames = getOutcomeNames(market);
  const hasDraw = !!market.outcomeC;

  const { balance: usdcBalance, formatted: usdcFmt, refetch: refetchBalance } = useUSDCBalance();
  const { mint: mintUSDC, state: mintState, reset: resetMint } = useMintTestUSDC();
  const { buyShares, state: buyState, txHash: buyTx, error: buyErr, reset: resetBuy } = useBuyShares();
  const { claimWinnings, state: claimState, txHash: claimTx, error: claimErr, reset: resetClaim } = useClaimWinnings();
  const pos = useUserPosition(market.onchainId);

  const isResolved  = market.status === "RESOLVED";
  const isCancelled = market.status === "CANCELLED";
  const isBuying    = buyState !== "idle" && buyState !== "confirmed" && buyState !== "error";

  // Pool sizes (BigInt)
  const yesPool  = BigInt(market.poolYes);
  const noPool   = BigInt(market.poolNo);
  const drawPool = market.poolDraw ? BigInt(market.poolDraw) : 0n;
  const totalPool = yesPool + noPool + drawPool;

  // Prices for all outcomes
  const prices = outcomeNames.map((_, i) => getParimutuelPrice(market, i as OutcomeIndex));

  // ─── Buy calculation (parimutuel) ──────────────────────────────────────────
  // Shares = netAmount = grossAmount - fee
  // If winner: payout = shares * totalPool / outcomePool  (pool after this trade)
  const buyCalc = useMemo(() => {
    const raw = parseFloat(amount || "0");
    if (raw <= 0 || isNaN(raw)) return null;

    const amtUsdc = BigInt(Math.floor(raw * 1_000_000));
    // fee = ceil(amount * feeBps / bps)
    const fee      = (amtUsdc * BigInt(FEE_BPS) + BigInt(BPS) - 1n) / BigInt(BPS);
    const netShares = amtUsdc - fee;

    // Updated pool after purchase
    const newOutcomePool = (outcome === 0 ? yesPool : outcome === 1 ? noPool : drawPool) + netShares;
    const newTotalPool   = totalPool + netShares;

    // Estimated payout if this outcome wins
    const payout = newOutcomePool > 0n
      ? Number((netShares * newTotalPool) / newOutcomePool) / 1_000_000
      : 0;

    const costF   = Number(amtUsdc) / 1_000_000;
    const sharesF = Number(netShares) / 1_000_000;
    const profit  = payout - costF;

    return { amtUsdc, netShares, sharesF, costF, payout, profit };
  }, [amount, outcome, yesPool, noPool, drawPool, totalPool]);

  // Clear amount on confirmed trade
  useEffect(() => {
    if (buyState === "confirmed") setAmount("");
  }, [buyState]);

  const handleBuy = async () => {
    if (!isConnected) { openConnectModal?.(); return; }
    if (!buyCalc || buyCalc.amtUsdc <= 0n) return;
    await buyShares(market.onchainId, outcome, buyCalc.amtUsdc);
  };

  const handleClaim = async () => {
    if (!isConnected) { openConnectModal?.(); return; }
    await claimWinnings(market.onchainId);
  };

  const insuf = buyCalc ? buyCalc.amtUsdc > usdcBalance : false;
  const hasPos = pos.sharesYes > 0n || pos.sharesNo > 0n || pos.sharesDraw > 0n;
  const hasValidInput = buyCalc !== null && parseFloat(amount) > 0;

  // ─── Resolved / Cancelled ────────────────────────────────────────────────
  if (isResolved || isCancelled) {
    const resolvedIdx = market.resolvedOutcome ?? 0;
    const winnerName =
      resolvedIdx === 0 ? market.outcomeA :
      resolvedIdx === 1 ? market.outcomeB :
      (market.outcomeC || "Draw");

    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {isResolved ? "Resolved" : "Cancelled"}
        </div>

        {isResolved && (
          <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2.5 text-center">
            <div className="text-[10px] text-cyan-400">Winner</div>
            <div className="text-sm font-semibold text-cyan-300">{winnerName}</div>
          </div>
        )}

        {hasPos && (
          <div className="space-y-1.5 text-[11px]">
            {pos.sharesYes > 0n && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{market.outcomeA}</span>
                <span className="font-mono">{(Number(pos.sharesYes) / 1e6).toFixed(2)} shares</span>
              </div>
            )}
            {pos.sharesNo > 0n && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{market.outcomeB}</span>
                <span className="font-mono">{(Number(pos.sharesNo) / 1e6).toFixed(2)} shares</span>
              </div>
            )}
            {pos.sharesDraw > 0n && market.outcomeC && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{market.outcomeC}</span>
                <span className="font-mono">{(Number(pos.sharesDraw) / 1e6).toFixed(2)} shares</span>
              </div>
            )}
          </div>
        )}

        {hasPos && !pos.hasClaimed && (
          <>
            <button
              onClick={handleClaim}
              disabled={claimState !== "idle" && claimState !== "confirmed" && claimState !== "error"}
              className="w-full rounded-lg bg-cyan-500 py-2.5 text-xs font-semibold text-black transition-colors hover:bg-cyan-400 disabled:opacity-50"
            >
              {claimState === "claiming" || claimState === "awaiting-confirmation"
                ? "Claiming..."
                : isResolved ? "Claim Winnings" : "Claim Refund"}
            </button>
            <TransactionToast
              state={claimState}
              txHash={claimTx}
              error={claimErr}
              onReset={resetClaim}
              successMessage={isResolved ? "Winnings claimed!" : "Refund claimed!"}
            />
          </>
        )}

        {pos.hasClaimed && (
          <div className="text-center text-[11px] text-muted-foreground">Already claimed</div>
        )}
      </div>
    );
  }

  // ─── Active Trading Panel ─────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-0 rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <span className="text-sm font-semibold text-foreground">Buy Shares</span>
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* Outcome selector with parimutuel prices */}
        <div>
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Outcome
          </div>
          <div className={cn("grid gap-2", hasDraw ? "grid-cols-3" : "grid-cols-2")}>
            {outcomeNames.map((name, idx) => {
              const colors     = getOutcomeColor(idx as OutcomeIndex);
              const price      = prices[idx];
              const isSelected = outcome === idx;
              return (
                <button
                  key={idx}
                  onClick={() => {
                    setOutcome(idx as OutcomeIndex);
                    setAmount("");
                    onOutcomeClick?.(idx as OutcomeIndex);
                  }}
                  disabled={isBuying}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-lg border py-2.5 px-2 text-xs font-semibold transition-all",
                    isSelected
                      ? `${colors.border} ${colors.bg} ${colors.text}`
                      : "border-border bg-secondary text-muted-foreground hover:border-border/80 hover:text-foreground"
                  )}
                >
                  <span className="truncate max-w-full">{name}</span>
                  <span className={cn("text-[11px] font-mono", isSelected ? colors.text : "text-muted-foreground")}>
                    {formatCents(price)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Testnet faucet — shown when wallet connected and USDC balance is zero */}
        {isConnected && usdcBalance === 0n && process.env.NEXT_PUBLIC_CHAIN_ID === "84532" && (
          <div className="flex items-center justify-between rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
            <span className="text-[11px] text-cyan-300">You need USDC to trade</span>
            <button
              onClick={async () => {
                await mintUSDC();
                refetchBalance();
                resetMint();
              }}
              disabled={mintState === "minting" || mintState === "awaiting-confirmation"}
              className="rounded bg-cyan-500 px-3 py-1 text-[11px] font-semibold text-black hover:bg-cyan-400 disabled:opacity-50 transition-colors"
            >
              {mintState === "minting" || mintState === "awaiting-confirmation"
                ? "Getting..."
                : "Get 100 USDC"}
            </button>
          </div>
        )}

        {/* Amount input */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Amount (USDC)</span>
            {isConnected && (
              <span className="text-muted-foreground">
                Balance: <span className="font-mono text-foreground">${usdcFmt}</span>
              </span>
            )}
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
              disabled={isBuying}
              className="h-10 w-full rounded-lg border border-border bg-secondary pl-7 pr-16 font-mono text-sm text-foreground placeholder-muted-foreground outline-none focus:border-cyan-500/50 disabled:opacity-50"
            />
            <button
              onClick={() => {
                const m = Number(usdcBalance) / 1e6;
                setAmount(m > 0 ? m.toFixed(2) : "0");
              }}
              disabled={isBuying}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-muted px-2.5 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              MAX
            </button>
          </div>

          {/* Quick amount buttons */}
          <div className="mt-2 flex gap-1.5">
            {[5, 10, 25, 50, 100].map((v) => (
              <button
                key={v}
                onClick={() => setAmount(String(v))}
                disabled={isBuying}
                className="flex-1 rounded border border-border bg-secondary/50 py-1 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
              >
                ${v}
              </button>
            ))}
          </div>
        </div>

        {/* Trade summary */}
        {buyCalc && (
          <div className="space-y-2 rounded-lg border border-border bg-secondary/30 p-3 text-[12px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Shares received</span>
              <span className="font-mono text-foreground">{buyCalc.sharesF.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fee (2%)</span>
              <span className="font-mono text-muted-foreground">
                -{formatUsd((buyCalc.costF - buyCalc.sharesF))}
              </span>
            </div>
            <div className="my-1 border-t border-border/50" />
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Payout if {outcomeNames[outcome]} wins
              </span>
              <span className="font-mono text-foreground">
                {formatUsd(buyCalc.payout)}
                {buyCalc.profit > 0 && (
                  <span className="ml-1 text-cyan-400">(+{formatUsd(buyCalc.profit)})</span>
                )}
              </span>
            </div>
          </div>
        )}

        {/* Position display */}
        {isConnected && hasPos && (
          <div className="space-y-1.5 rounded-lg border border-border bg-secondary/50 p-3 text-[11px]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Your Position
            </div>
            {pos.sharesYes > 0n && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{market.outcomeA}</span>
                <span className="font-mono text-cyan-400">
                  {(Number(pos.sharesYes) / 1e6).toFixed(2)} shares
                </span>
              </div>
            )}
            {pos.sharesNo > 0n && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{market.outcomeB}</span>
                <span className="font-mono text-pink-400">
                  {(Number(pos.sharesNo) / 1e6).toFixed(2)} shares
                </span>
              </div>
            )}
            {pos.sharesDraw > 0n && market.outcomeC && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{market.outcomeC}</span>
                <span className="font-mono text-amber-400">
                  {(Number(pos.sharesDraw) / 1e6).toFixed(2)} shares
                </span>
              </div>
            )}
          </div>
        )}

        {/* Action button */}
        <button
          onClick={handleBuy}
          disabled={isBuying || (isConnected && (!hasValidInput || insuf))}
          className={cn(
            "w-full rounded-lg py-3 text-sm font-semibold transition-colors",
            !isConnected
              ? "bg-cyan-500 text-black hover:bg-cyan-400"
              : isBuying
              ? "cursor-wait bg-cyan-500/50 text-cyan-200"
              : insuf
              ? "cursor-not-allowed bg-pink-500/20 text-pink-400 border border-pink-500/30"
              : hasValidInput
              ? "bg-cyan-500 text-black hover:bg-cyan-400"
              : "cursor-not-allowed bg-secondary text-muted-foreground"
          )}
        >
          {!isConnected
            ? "Connect Wallet"
            : isBuying
            ? buyState === "approving" || buyState === "awaiting-approval"
              ? "Approving USDC..."
              : "Placing Trade..."
            : insuf
            ? "Insufficient Balance"
            : !hasValidInput
            ? "Enter Amount"
            : `Buy ${outcomeNames[outcome]}`}
        </button>

        <TransactionToast
          state={buyState}
          txHash={buyTx}
          error={buyErr}
          onReset={resetBuy}
          successMessage="Trade confirmed!"
        />

        <div className="text-center text-[10px] text-muted-foreground">
          2% protocol fee · Parimutuel pool · Winners share the pot
        </div>
      </div>
    </div>
  );
}
