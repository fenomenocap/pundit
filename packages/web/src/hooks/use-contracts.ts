"use client";

import { useState, useCallback, useMemo } from "react";
import { useReadContract, useReadContracts, useWriteContract, useAccount } from "wagmi";
import { CONTRACTS, predictionMarketAmmAbi, marketFactoryAbi, erc20Abi } from "@/lib/contracts";

// ─── Human-readable error mapping ───────────────────────────────────────────

function parseContractError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  // User rejection
  if (msg.includes("User rejected") || msg.includes("user rejected") || msg.includes("ACTION_REJECTED")) {
    return "Transaction rejected by user";
  }
  // Wallet disconnected mid-tx
  if (msg.includes("disconnected") || msg.includes("Connector not connected") || msg.includes("No connector")) {
    return "Wallet disconnected. Please reconnect and try again.";
  }
  // Insufficient funds (gas)
  if (msg.includes("insufficient funds for gas")) {
    return "Insufficient ETH for gas fees";
  }
  // AMM-specific contract reverts
  if (msg.includes("MarketDoesNotExist")) return "Market does not exist";
  if (msg.includes("MarketNotOpen")) return "Market is no longer open for trading";
  if (msg.includes("PoolNotInitialized")) return "Pool has not been initialized yet";
  if (msg.includes("PoolAlreadyInitialized")) return "Pool is already initialized";
  if (msg.includes("SlippageExceeded")) return "Price moved too much — try again with higher slippage";
  if (msg.includes("InsufficientShares")) return "You don't have enough shares to sell";
  if (msg.includes("MarketNotSettled")) return "Settlement period has not passed yet (30 min after resolution)";
  if (msg.includes("AlreadyClaimed")) return "Winnings already claimed";
  if (msg.includes("NothingToClaim")) return "No winnings to claim for this market";
  if (msg.includes("ZeroAmount")) return "Amount must be greater than zero";
  if (msg.includes("InvalidOutcome")) return "Invalid outcome selection";
  if (msg.includes("InsufficientBalance") || msg.includes("insufficient balance") || msg.includes("transfer amount exceeds balance")) {
    return "Insufficient USDC balance";
  }
  if (msg.includes("InsufficientAllowance") || msg.includes("allowance")) {
    return "USDC approval required. Please try again.";
  }

  // Truncate generic errors
  return msg.length > 120 ? msg.slice(0, 120) + "..." : msg;
}

// ─── useMarketData ───────────────────────────────────────────────────────────
// Reads AMM reserves, prices, and market info from contracts. Refreshes every 15s.

export interface OnchainMarketData {
  yesReserve: bigint;
  noReserve: bigint;
  yesPrice: number;    // 0–100 (percent)
  noPrice: number;     // 0–100 (percent)
  poolInitialized: boolean;
  question: string;
  outcomes: readonly [string, string];
  resolutionTimestamp: bigint;
  status: number;
  resolvedOutcome: number;
  resolvedAt: bigint;
  createdAt: bigint;
  isLoading: boolean;
  refetch: () => void;
}

export function useMarketData(marketId: number | undefined): OnchainMarketData {
  const enabled = marketId !== undefined;

  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      {
        address: CONTRACTS.engine,
        abi: predictionMarketAmmAbi,
        functionName: "getReserves",
        args: enabled ? [BigInt(marketId)] : undefined,
      },
      {
        address: CONTRACTS.engine,
        abi: predictionMarketAmmAbi,
        functionName: "isPoolInitialized",
        args: enabled ? [BigInt(marketId)] : undefined,
      },
      {
        address: CONTRACTS.factory,
        abi: marketFactoryAbi,
        functionName: "getMarket",
        args: enabled ? [BigInt(marketId)] : undefined,
      },
    ],
    query: {
      enabled,
      refetchInterval: 15_000,
    },
  });

  return useMemo(() => {
    const reserves = data?.[0]?.result as [bigint, bigint] | undefined;
    const yesReserve = reserves?.[0] ?? 0n;
    const noReserve = reserves?.[1] ?? 0n;
    const poolInitialized = (data?.[1]?.result as boolean) ?? false;
    const marketData = data?.[2]?.result as
      | {
          question: string;
          outcomes: readonly [string, string];
          resolutionTimestamp: bigint;
          status: number;
          resolvedOutcome: number;
          resolvedAt: bigint;
          createdAt: bigint;
        }
      | undefined;

    const total = yesReserve + noReserve;
    const yesPrice = total > 0n ? Number((noReserve * 10000n) / total) / 100 : 50;
    const noPrice = total > 0n ? Number((yesReserve * 10000n) / total) / 100 : 50;

    return {
      yesReserve,
      noReserve,
      yesPrice,
      noPrice,
      poolInitialized,
      question: marketData?.question ?? "",
      outcomes: marketData?.outcomes ?? ["Yes", "No"],
      resolutionTimestamp: marketData?.resolutionTimestamp ?? 0n,
      status: marketData?.status ?? 0,
      resolvedOutcome: marketData?.resolvedOutcome ?? 0,
      resolvedAt: marketData?.resolvedAt ?? 0n,
      createdAt: marketData?.createdAt ?? 0n,
      isLoading,
      refetch,
    };
  }, [data, isLoading, refetch]);
}

// ─── useUserPosition ─────────────────────────────────────────────────────────
// Reads share balances per outcome for the connected user.

export interface UserPosition {
  sharesYes: bigint;
  sharesNo: bigint;
  hasClaimed: boolean;
  isLoading: boolean;
  refetch: () => void;
}

export function useUserPosition(marketId: number | undefined): UserPosition {
  const { address } = useAccount();
  const enabled = marketId !== undefined && !!address;

  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      {
        address: CONTRACTS.engine,
        abi: predictionMarketAmmAbi,
        functionName: "getUserShares",
        args: enabled ? [BigInt(marketId), address!, 0] : undefined,
      },
      {
        address: CONTRACTS.engine,
        abi: predictionMarketAmmAbi,
        functionName: "getUserShares",
        args: enabled ? [BigInt(marketId), address!, 1] : undefined,
      },
      {
        address: CONTRACTS.engine,
        abi: predictionMarketAmmAbi,
        functionName: "claimed",
        args: enabled ? [BigInt(marketId), address!] : undefined,
      },
    ],
    query: {
      enabled,
      refetchInterval: 15_000,
    },
  });

  return useMemo(
    () => ({
      sharesYes: (data?.[0]?.result as bigint) ?? 0n,
      sharesNo: (data?.[1]?.result as bigint) ?? 0n,
      hasClaimed: (data?.[2]?.result as boolean) ?? false,
      isLoading,
      refetch,
    }),
    [data, isLoading, refetch]
  );
}

// ─── useUSDCBalance ──────────────────────────────────────────────────────────

export interface USDCBalance {
  balance: bigint;
  formatted: string;
  isLoading: boolean;
  refetch: () => void;
}

export function useUSDCBalance(): USDCBalance {
  const { address } = useAccount();
  const enabled = !!address;

  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACTS.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: enabled ? [address!] : undefined,
    query: {
      enabled,
      refetchInterval: 15_000,
    },
  });

  return useMemo(() => {
    const balance = (data as bigint) ?? 0n;
    const formatted = (Number(balance) / 1_000_000).toFixed(2);
    return { balance, formatted, isLoading, refetch };
  }, [data, isLoading, refetch]);
}

// ─── useBuyOutcome ──────────────────────────────────────────────────────────
// Handles: check USDC allowance → approve vault if needed → buyOutcome on AMM.

export type BuyState =
  | "idle"
  | "checking-allowance"
  | "approving"
  | "awaiting-approval"
  | "buying"
  | "awaiting-confirmation"
  | "confirmed"
  | "error";

export interface BuyOutcomeHook {
  buyOutcome: (marketId: number, outcome: 0 | 1, amount: bigint, minSharesOut?: bigint) => Promise<void>;
  state: BuyState;
  txHash: `0x${string}` | undefined;
  error: string | undefined;
  reset: () => void;
}

export function useBuyOutcome(): BuyOutcomeHook {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const { refetch: refetchAllowance } = useReadContract({
    address: CONTRACTS.usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, CONTRACTS.vault] : undefined,
    query: { enabled: !!address },
  });

  const [buyState, setBuyState] = useState<BuyState>("idle");
  const [buyTxHash, setBuyTxHash] = useState<`0x${string}` | undefined>(undefined);
  const [buyError, setBuyError] = useState<string | undefined>(undefined);

  const reset = useCallback(() => {
    setBuyState("idle");
    setBuyTxHash(undefined);
    setBuyError(undefined);
  }, []);

  const buyOutcome = useCallback(
    async (marketId: number, outcome: 0 | 1, amount: bigint, minSharesOut?: bigint) => {
      if (!address) return;
      setBuyError(undefined);

      try {
        // Step 1: Check allowance
        setBuyState("checking-allowance");
        const freshAllowance = await refetchAllowance();
        const currentAllowance = (freshAllowance.data as bigint) ?? 0n;

        // Step 2: Approve if needed
        if (currentAllowance < amount) {
          setBuyState("approving");
          const approveTx = await writeContractAsync({
            address: CONTRACTS.usdc,
            abi: erc20Abi,
            functionName: "approve",
            args: [CONTRACTS.vault, amount],
          });
          setBuyTxHash(approveTx);
          setBuyState("awaiting-approval");
          await new Promise((r) => setTimeout(r, 2000));
        }

        // Step 3: Buy outcome tokens
        setBuyState("buying");
        const tx = await writeContractAsync({
          address: CONTRACTS.engine,
          abi: predictionMarketAmmAbi,
          functionName: "buyOutcome",
          args: [BigInt(marketId), outcome, amount, minSharesOut ?? 0n],
        });
        setBuyTxHash(tx);
        setBuyState("awaiting-confirmation");

        await new Promise((r) => setTimeout(r, 2000));
        setBuyState("confirmed");
      } catch (err: unknown) {
        setBuyError(parseContractError(err));
        setBuyState("error");
      }
    },
    [address, refetchAllowance, writeContractAsync]
  );

  return { buyOutcome, state: buyState, txHash: buyTxHash, error: buyError, reset };
}

// ─── useSellOutcome ─────────────────────────────────────────────────────────
// Sells outcome tokens back to the AMM for USDC.

export type SellState =
  | "idle"
  | "selling"
  | "awaiting-confirmation"
  | "confirmed"
  | "error";

export interface SellOutcomeHook {
  sellOutcome: (marketId: number, outcome: 0 | 1, shares: bigint, minUsdcOut?: bigint) => Promise<void>;
  state: SellState;
  txHash: `0x${string}` | undefined;
  error: string | undefined;
  reset: () => void;
}

export function useSellOutcome(): SellOutcomeHook {
  const { writeContractAsync } = useWriteContract();

  const [sellState, setSellState] = useState<SellState>("idle");
  const [sellTxHash, setSellTxHash] = useState<`0x${string}` | undefined>(undefined);
  const [sellError, setSellError] = useState<string | undefined>(undefined);

  const reset = useCallback(() => {
    setSellState("idle");
    setSellTxHash(undefined);
    setSellError(undefined);
  }, []);

  const sellOutcome = useCallback(
    async (marketId: number, outcome: 0 | 1, shares: bigint, minUsdcOut?: bigint) => {
      setSellError(undefined);

      try {
        setSellState("selling");
        const tx = await writeContractAsync({
          address: CONTRACTS.engine,
          abi: predictionMarketAmmAbi,
          functionName: "sellOutcome",
          args: [BigInt(marketId), outcome, shares, minUsdcOut ?? 0n],
        });
        setSellTxHash(tx);
        setSellState("awaiting-confirmation");

        await new Promise((r) => setTimeout(r, 2000));
        setSellState("confirmed");
      } catch (err: unknown) {
        setSellError(parseContractError(err));
        setSellState("error");
      }
    },
    [writeContractAsync]
  );

  return { sellOutcome, state: sellState, txHash: sellTxHash, error: sellError, reset };
}

// ─── useClaimWinnings ────────────────────────────────────────────────────────

export type ClaimState = "idle" | "claiming" | "awaiting-confirmation" | "confirmed" | "error";

export interface ClaimWinningsHook {
  claimWinnings: (marketId: number) => Promise<void>;
  state: ClaimState;
  txHash: `0x${string}` | undefined;
  error: string | undefined;
  reset: () => void;
}

export function useClaimWinnings(): ClaimWinningsHook {
  const { writeContractAsync } = useWriteContract();

  const [claimState, setClaimState] = useState<ClaimState>("idle");
  const [claimTxHash, setClaimTxHash] = useState<`0x${string}` | undefined>(undefined);
  const [claimError, setClaimError] = useState<string | undefined>(undefined);

  const reset = useCallback(() => {
    setClaimState("idle");
    setClaimTxHash(undefined);
    setClaimError(undefined);
  }, []);

  const claimWinnings = useCallback(
    async (marketId: number) => {
      setClaimError(undefined);

      try {
        setClaimState("claiming");
        const tx = await writeContractAsync({
          address: CONTRACTS.engine,
          abi: predictionMarketAmmAbi,
          functionName: "claimWinnings",
          args: [BigInt(marketId)],
        });
        setClaimTxHash(tx);
        setClaimState("awaiting-confirmation");

        await new Promise((r) => setTimeout(r, 2000));
        setClaimState("confirmed");
      } catch (err: unknown) {
        setClaimError(parseContractError(err));
        setClaimState("error");
      }
    },
    [writeContractAsync]
  );

  return { claimWinnings, state: claimState, txHash: claimTxHash, error: claimError, reset };
}
