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

// ─── Outcome type: 0=Yes, 1=No, 2=Draw ─────────────────────────────────────
type OutcomeIndex = 0 | 1 | 2;

interface TradePanelProps {
  market: MarketResponse;
  onOutcomeClick?: (outcome: OutcomeIndex) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getOutcomeNames(market: MarketResponse): string[] {
  const names = [market.outcomeA, market.outcomeB];
  if (market.outcomeC) names.push(market.outcomeC);
  return names;
}

function getOutcomeColor(idx: OutcomeIndex): { text: string; bg: string; border: string; ring: string } {
  if (idx === 0) return { text: "text-teal-400", bg: "bg-teal-500/10", border: "border-teal-500/40", ring: "ring-teal-500/30" };
  if (idx === 1) return { text: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/40", ring: "ring-rose-500/30" };
  return { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/40", ring: "ring-amber-500/30" };
}

function getAmmPrice(market: MarketResponse, outcome: OutcomeIndex): number {
  const yesRes = Number(BigInt(market.poolYes));
  const noRes = Number(BigInt(market.poolNo));
  const drawRes = market.poolDraw ? Number(BigInt(market.poolDraw)) : 0;
  const total = yesRes + noRes + drawRes;
  if (total === 0) return market.outcomeC ? 33 : 50;

  // In a multi-outcome AMM, price of outcome i = product of all OTHER reserves / sum(product of all other reserves)
  // For 2-outcome: P(Yes) = noRes / total, P(No) = yesRes / total
  // For 3-outcome: simplified proportional pricing
  if (!market.outcomeC) {
    if (outcome === 0) return (noRes / total) * 100;
    return (yesRes / total) * 100;
  }

  // 3-way market: inverse proportional (lower reserve = higher price)
  const reserves = [yesRes, noRes, drawRes];
  const others = reserves.filter((_, i) => i !== outcome);
  const othersProduct = others.reduce((a, b) => a * b, 1);
  const allProducts = reserves.map((_, i) => {
    const o = reserves.filter((_, j) => j !== i);
    return o.reduce((a, b) => a * b, 1);
  });
  const sumProducts = allProducts.reduce((a, b) => a + b, 0);
  return sumProducts > 0 ? (othersProduct / sumProducts) * 100 : 33;
}

function formatCents(pct: number): string {
  const cents = Math.round(pct);
  if (cents >= 100) return "$1.00";
  if (cents <= 0) return "1\u00A2";
  return `${cents}\u00A2`;
}

function formatUsd(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1000) return `$${(val / 1000).toFixed(val >= 10000 ? 0 : 1)}K`;
  return `$${val.toFixed(2)}`;
}

export function TradePanel({ market, onOutcomeClick }: TradePanelProps) {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [inputMode, setInputMode] = useState<"dollars" | "shares">("dollars");
  const [outcome, setOutcome] = useState<OutcomeIndex>(0);
  const [amount, setAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState(""); // cents (1-99)

  const outcomeNames = getOutcomeNames(market);
  const hasDraw = !!market.outcomeC;

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

  // AMM reserves
  const yesRes = BigInt(market.poolYes);
  const noRes = BigInt(market.poolNo);

  // Prices
  const prices = outcomeNames.map((_, i) => getAmmPrice(market, i as OutcomeIndex));

  // ─── Buy calculation (CPMM) ─────────────────────────────────────────────
  const buyCalc = useMemo(() => {
    if (mode !== "buy") return null;
    const raw = parseFloat(amount || "0");
    if (raw <= 0 || isNaN(raw)) return null;

    let amtUsdc: bigint;
    let sharesOut: bigint;

    if (inputMode === "dollars") {
      // Input is dollar amount
      amtUsdc = BigInt(Math.floor(raw * 1_000_000));
      const fee = (amtUsdc * BigInt(FEE_BPS) + BigInt(BPS) - 1n) / BigInt(BPS);
      const net = amtUsdc - fee;

      if (outcome === 0) {
        sharesOut = noRes + net > 0n ? (yesRes * net) / (noRes + net) : 0n;
      } else if (outcome === 1) {
        sharesOut = yesRes + net > 0n ? (noRes * net) / (yesRes + net) : 0n;
      } else {
        // Draw - approximate using price
        const drawPrice = prices[2] / 100;
        sharesOut = drawPrice > 0 ? BigInt(Math.floor((raw * 0.98) / drawPrice * 1_000_000)) : 0n;
        amtUsdc = BigInt(Math.floor(raw * 1_000_000));
      }
    } else {
      // Input is number of shares (contracts)
      const targetShares = BigInt(Math.floor(raw * 1_000_000));
      const price = prices[outcome] / 100;
      const estimatedCost = raw * price * 1.02; // include ~2% fee estimate
      amtUsdc = BigInt(Math.floor(estimatedCost * 1_000_000));
      sharesOut = targetShares;
    }

    const sharesF = Number(sharesOut) / 1_000_000;
    const costF = Number(amtUsdc) / 1_000_000;
    const avgPrice = sharesF > 0 ? costF / sharesF : 0;
    const payout = sharesF;
    const profit = payout - costF;

    return { amtUsdc, sharesOut, sharesF, costF, avgPrice, payout, profit };
  }, [amount, outcome, mode, inputMode, yesRes, noRes, prices]);

  // ─── Sell calculation ──────────────────────────────────────────────────
  const sellCalc = useMemo(() => {
    if (mode !== "sell") return null;
    const raw = parseFloat(amount || "0");
    if (raw <= 0 || isNaN(raw)) return null;

    let shares: bigint;
    let netOut: bigint;

    if (inputMode === "shares") {
      shares = BigInt(Math.floor(raw * 1_000_000));

      let grossOut: bigint;
      if (outcome === 0) {
        grossOut = yesRes + shares > 0n ? (noRes * shares) / (yesRes + shares) : 0n;
      } else if (outcome === 1) {
        grossOut = noRes + shares > 0n ? (yesRes * shares) / (noRes + shares) : 0n;
      } else {
        const drawPrice = prices[2] / 100;
        grossOut = BigInt(Math.floor(raw * drawPrice * 1_000_000));
      }

      const fee = (grossOut * BigInt(FEE_BPS) + BigInt(BPS) - 1n) / BigInt(BPS);
      netOut = grossOut - fee;
    } else {
      // Input is dollars - calculate how many shares to sell
      const targetUsd = raw;
      const price = prices[outcome] / 100;
      const estimatedShares = price > 0 ? targetUsd / (price * 0.98) : 0;
      shares = BigInt(Math.floor(estimatedShares * 1_000_000));
      netOut = BigInt(Math.floor(targetUsd * 1_000_000));
    }

    const usdcOutF = Number(netOut) / 1_000_000;
    const sharesF = Number(shares) / 1_000_000;
    const avgPrice = sharesF > 0 ? usdcOutF / sharesF : 0;

    return { shares, netOut, usdcOutF, sharesF, avgPrice };
  }, [amount, outcome, mode, inputMode, yesRes, noRes, prices]);

  // ─── Limit order calculation ──────────────────────────────────────────
  const limitCalc = useMemo(() => {
    if (orderType !== "limit") return null;
    const raw = parseFloat(amount || "0");
    const price = parseFloat(limitPrice || "0");
    if (raw <= 0 || price <= 0 || price >= 100) return null;

    const priceDecimal = price / 100;

    if (inputMode === "dollars") {
      const contracts = raw / priceDecimal;
      const payout = contracts;
      const profit = payout - raw;
      return { contracts, cost: raw, price: priceDecimal, payout, profit };
    } else {
      const cost = raw * priceDecimal;
      const payout = raw;
      const profit = payout - cost;
      return { contracts: raw, cost, price: priceDecimal, payout, profit };
    }
  }, [amount, limitPrice, orderType, inputMode]);

  // Clear amount on confirmed trade
  useEffect(() => {
    if (buyState === "confirmed" || sellState === "confirmed") setAmount("");
  }, [buyState, sellState]);

  const handleBuy = async () => {
    if (!isConnected) { openConnectModal?.(); return; }
    if (orderType === "limit") {
      // Limit orders are queued (UI-only for now)
      alert("Limit order placed! (Order book matching coming soon)");
      setAmount("");
      setLimitPrice("");
      return;
    }
    if (!buyCalc || buyCalc.amtUsdc <= 0n) return;
    await buyOutcome(market.onchainId, outcome as 0 | 1, buyCalc.amtUsdc);
  };

  const handleSell = async () => {
    if (!isConnected) { openConnectModal?.(); return; }
    if (orderType === "limit") {
      alert("Limit order placed! (Order book matching coming soon)");
      setAmount("");
      setLimitPrice("");
      return;
    }
    if (!sellCalc || sellCalc.shares <= 0n) return;
    await sellOutcome(market.onchainId, outcome as 0 | 1, sellCalc.shares);
  };

  const handleClaim = async () => {
    if (!isConnected) { openConnectModal?.(); return; }
    await claimWinnings(market.onchainId);
  };

  const insuf = mode === "buy" && buyCalc ? buyCalc.amtUsdc > usdcBalance : false;
  const hasPos = pos.sharesYes > 0n || pos.sharesNo > 0n;
  const sellableShares = outcome === 0 ? pos.sharesYes : pos.sharesNo;
  const sellInsuf = mode === "sell" && sellCalc ? sellCalc.shares > sellableShares : false;

  const hasValidInput = orderType === "limit"
    ? limitCalc !== null
    : (mode === "buy" ? buyCalc !== null && parseFloat(amount) > 0 : sellCalc !== null && parseFloat(amount) > 0);

  // ─── Resolved / Cancelled ───────────────────────────────────────────────
  if (isResolved || isCancelled) {
    const resolvedIdx = market.resolvedOutcome ?? 0;
    const winner = resolvedIdx === 0 ? market.outcomeA : resolvedIdx === 1 ? market.outcomeB : (market.outcomeC || "Draw");
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

  // ─── Active Trading Panel (Kalshi-style) ──────────────────────────────
  return (
    <div className="flex flex-col gap-0 rounded-xl border border-border bg-card overflow-hidden">
      {/* Buy / Sell toggle header */}
      <div className="flex border-b border-border">
        <button
          onClick={() => { setMode("buy"); setAmount(""); }}
          disabled={isTrading}
          className={cn(
            "flex-1 py-3 text-sm font-semibold transition-all text-center",
            mode === "buy"
              ? "bg-teal-500/10 text-teal-400 border-b-2 border-teal-400"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Buy
        </button>
        <button
          onClick={() => { setMode("sell"); setAmount(""); }}
          disabled={isTrading}
          className={cn(
            "flex-1 py-3 text-sm font-semibold transition-all text-center",
            mode === "sell"
              ? "bg-rose-500/10 text-rose-400 border-b-2 border-rose-400"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Sell
        </button>
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* Outcome selector with prices */}
        <div>
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Outcome
          </div>
          <div className={cn("grid gap-2", hasDraw ? "grid-cols-3" : "grid-cols-2")}>
            {outcomeNames.map((name, idx) => {
              const colors = getOutcomeColor(idx as OutcomeIndex);
              const price = prices[idx];
              const isSelected = outcome === idx;
              return (
                <button
                  key={idx}
                  onClick={() => {
                    setOutcome(idx as OutcomeIndex);
                    setAmount("");
                    onOutcomeClick?.(idx as OutcomeIndex);
                  }}
                  disabled={isTrading}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-lg border py-2.5 px-2 text-xs font-semibold transition-all",
                    isSelected
                      ? `${colors.border} ${colors.bg} ${colors.text}`
                      : "border-border bg-secondary text-muted-foreground hover:border-border/80 hover:text-foreground"
                  )}
                >
                  <span className="truncate max-w-full">{name}</span>
                  <span className={cn(
                    "text-[11px] font-mono",
                    isSelected ? colors.text : "text-muted-foreground"
                  )}>
                    {formatCents(price)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Market / Limit order type toggle */}
        <div>
          <div className="flex rounded-lg border border-border bg-secondary/50 p-0.5">
            <button
              onClick={() => { setOrderType("market"); setLimitPrice(""); }}
              disabled={isTrading}
              className={cn(
                "flex-1 rounded-md py-1.5 text-[11px] font-semibold transition-all",
                orderType === "market"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Market
            </button>
            <button
              onClick={() => setOrderType("limit")}
              disabled={isTrading}
              className={cn(
                "flex-1 rounded-md py-1.5 text-[11px] font-semibold transition-all",
                orderType === "limit"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Limit
            </button>
          </div>
        </div>

        {/* Limit price input (only for limit orders) */}
        {orderType === "limit" && (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Limit Price</span>
              <span className="font-mono text-foreground">
                Current: {formatCents(prices[outcome])}
              </span>
            </div>
            <div className="relative">
              <input
                type="number"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder={Math.round(prices[outcome]).toString()}
                min="1"
                max="99"
                step="1"
                disabled={isTrading}
                className="h-10 w-full rounded-lg border border-border bg-secondary pl-3 pr-10 font-mono text-sm text-foreground placeholder-muted-foreground outline-none focus:border-teal-500/50 disabled:opacity-50"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                &cent;
              </span>
            </div>
          </div>
        )}

        {/* Dollar / Shares toggle + Amount input */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Amount</span>
              <div className="flex rounded border border-border bg-secondary/50 p-0.5">
                <button
                  onClick={() => { setInputMode("dollars"); setAmount(""); }}
                  className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-semibold transition-all",
                    inputMode === "dollars"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Dollars
                </button>
                <button
                  onClick={() => { setInputMode("shares"); setAmount(""); }}
                  className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-semibold transition-all",
                    inputMode === "shares"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Shares
                </button>
              </div>
            </div>
            {isConnected && mode === "buy" && (
              <span className="text-muted-foreground">
                Balance: <span className="font-mono text-foreground">${usdcFmt}</span>
              </span>
            )}
            {isConnected && mode === "sell" && (
              <span className="text-muted-foreground">
                Available: <span className="font-mono text-foreground">
                  {(Number(sellableShares) / 1e6).toFixed(2)}
                </span>
              </span>
            )}
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              {inputMode === "dollars" ? "$" : "#"}
            </span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step={inputMode === "dollars" ? "0.01" : "1"}
              disabled={isTrading}
              className="h-10 w-full rounded-lg border border-border bg-secondary pl-7 pr-16 font-mono text-sm text-foreground placeholder-muted-foreground outline-none focus:border-teal-500/50 disabled:opacity-50"
            />
            <button
              onClick={() => {
                if (mode === "buy" && inputMode === "dollars") {
                  const m = Number(usdcBalance) / 1e6;
                  setAmount(m > 0 ? m.toFixed(2) : "0");
                } else if (mode === "sell") {
                  const s = Number(sellableShares) / 1e6;
                  if (inputMode === "shares") {
                    setAmount(s > 0 ? s.toFixed(2) : "0");
                  } else {
                    const price = prices[outcome] / 100;
                    const dollarValue = s * price * 0.98;
                    setAmount(dollarValue > 0 ? dollarValue.toFixed(2) : "0");
                  }
                }
              }}
              disabled={isTrading}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-muted px-2.5 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              MAX
            </button>
          </div>

          {/* Quick amount buttons */}
          {inputMode === "dollars" && mode === "buy" && (
            <div className="mt-2 flex gap-1.5">
              {[5, 10, 25, 50, 100].map((v) => (
                <button
                  key={v}
                  onClick={() => setAmount(String(v))}
                  disabled={isTrading}
                  className="flex-1 rounded border border-border bg-secondary/50 py-1 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
                >
                  ${v}
                </button>
              ))}
            </div>
          )}
          {inputMode === "shares" && mode === "buy" && (
            <div className="mt-2 flex gap-1.5">
              {[10, 25, 50, 100, 250].map((v) => (
                <button
                  key={v}
                  onClick={() => setAmount(String(v))}
                  disabled={isTrading}
                  className="flex-1 rounded border border-border bg-secondary/50 py-1 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
                >
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Trade details — Market order, Buy */}
        {orderType === "market" && mode === "buy" && buyCalc && (
          <div className="space-y-2 rounded-lg border border-border bg-secondary/30 p-3 text-[12px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Avg price</span>
              <span className="font-mono text-foreground">{formatCents(buyCalc.avgPrice * 100)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {inputMode === "dollars" ? "Contracts" : "Est. cost"}
              </span>
              <span className="font-mono text-foreground">
                {inputMode === "dollars" ? buyCalc.sharesF.toFixed(2) : formatUsd(buyCalc.costF)}
              </span>
            </div>
            <div className="my-1 border-t border-border/50" />
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Payout if {outcomeNames[outcome]}
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

        {/* Trade details — Market order, Sell */}
        {orderType === "market" && mode === "sell" && sellCalc && (
          <div className="space-y-2 rounded-lg border border-border bg-secondary/30 p-3 text-[12px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Avg price</span>
              <span className="font-mono text-foreground">{formatCents(sellCalc.avgPrice * 100)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {inputMode === "dollars" ? "Contracts to sell" : "You receive"}
              </span>
              <span className="font-mono text-teal-400">
                {inputMode === "dollars" ? sellCalc.sharesF.toFixed(2) : formatUsd(sellCalc.usdcOutF)}
              </span>
            </div>
          </div>
        )}

        {/* Trade details — Limit order */}
        {orderType === "limit" && limitCalc && (
          <div className="space-y-2 rounded-lg border border-border bg-secondary/30 p-3 text-[12px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Limit price</span>
              <span className="font-mono text-foreground">{formatCents(limitCalc.price * 100)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {inputMode === "dollars" ? "Contracts" : "Total cost"}
              </span>
              <span className="font-mono text-foreground">
                {inputMode === "dollars" ? limitCalc.contracts.toFixed(2) : formatUsd(limitCalc.cost)}
              </span>
            </div>
            <div className="my-1 border-t border-border/50" />
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Payout if {outcomeNames[outcome]}
              </span>
              <span className="font-mono text-foreground">
                {formatUsd(limitCalc.payout)}
                {limitCalc.profit > 0 && (
                  <span className="ml-1 text-teal-400">(+{formatUsd(limitCalc.profit)})</span>
                )}
              </span>
            </div>
            <div className="mt-1 rounded bg-amber-500/10 border border-amber-500/20 px-2 py-1.5 text-[10px] text-amber-400">
              Limit orders execute when market price reaches your limit price
            </div>
          </div>
        )}

        {/* Position display */}
        {isConnected && hasPos && (
          <div className="space-y-1.5 rounded-lg border border-border bg-secondary/50 p-3 text-[11px]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your Position</div>
            {pos.sharesYes > 0n && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{market.outcomeA}</span>
                <div className="text-right">
                  <span className="font-mono text-teal-400">{(Number(pos.sharesYes) / 1e6).toFixed(2)}</span>
                  <span className="ml-1 text-muted-foreground">contracts</span>
                  <span className="ml-1.5 text-muted-foreground">
                    ({formatUsd(Number(pos.sharesYes) / 1e6 * prices[0] / 100)})
                  </span>
                </div>
              </div>
            )}
            {pos.sharesNo > 0n && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{market.outcomeB}</span>
                <div className="text-right">
                  <span className="font-mono text-rose-400">{(Number(pos.sharesNo) / 1e6).toFixed(2)}</span>
                  <span className="ml-1 text-muted-foreground">contracts</span>
                  <span className="ml-1.5 text-muted-foreground">
                    ({formatUsd(Number(pos.sharesNo) / 1e6 * prices[1] / 100)})
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
            disabled={isBuying || (isConnected && (!hasValidInput || insuf))}
            className={cn(
              "w-full rounded-lg py-3 text-sm font-semibold transition-colors",
              !isConnected ? "bg-teal-500 text-black hover:bg-teal-400"
                : isBuying ? "cursor-wait bg-teal-500/50 text-teal-200"
                : insuf ? "cursor-not-allowed bg-rose-500/20 text-rose-400 border border-rose-500/30"
                : hasValidInput
                  ? "bg-teal-500 text-black hover:bg-teal-400"
                  : "cursor-not-allowed bg-secondary text-muted-foreground"
            )}
          >
            {!isConnected ? "Connect Wallet"
              : isBuying ? (buyState === "approving" || buyState === "awaiting-approval" ? "Approving USDC..." : "Placing Trade...")
              : insuf ? "Insufficient Balance"
              : !hasValidInput ? "Enter Amount"
              : orderType === "limit" ? `Place Limit Order · Buy ${outcomeNames[outcome]}`
              : `Buy ${outcomeNames[outcome]}`}
          </button>
        ) : (
          <button
            onClick={handleSell}
            disabled={isSelling || (isConnected && (!hasValidInput || sellInsuf))}
            className={cn(
              "w-full rounded-lg py-3 text-sm font-semibold transition-colors",
              !isConnected ? "bg-rose-500 text-white hover:bg-rose-400"
                : isSelling ? "cursor-wait bg-rose-500/50 text-rose-200"
                : sellInsuf ? "cursor-not-allowed bg-rose-500/20 text-rose-400 border border-rose-500/30"
                : hasValidInput
                  ? "bg-rose-500 text-white hover:bg-rose-400"
                  : "cursor-not-allowed bg-secondary text-muted-foreground"
            )}
          >
            {!isConnected ? "Connect Wallet"
              : isSelling ? "Selling..."
              : sellInsuf ? "Insufficient Shares"
              : !hasValidInput ? "Enter Amount"
              : orderType === "limit" ? `Place Limit Order · Sell ${outcomeNames[outcome]}`
              : `Sell ${outcomeNames[outcome]}`}
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
          {orderType === "market" ? "2% fee · Market order" : "2% fee · Limit order"} · Each contract pays $1 if correct
        </div>
      </div>
    </div>
  );
}
