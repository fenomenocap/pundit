"use client";

import { useState, useCallback, useMemo } from "react";
import { useReadContract, useReadContracts, useWriteContract, useAccount, usePublicClient } from "wagmi";
import { CONTRACTS, parimutuelEngineAbi, marketFactoryAbi, erc20Abi } from "@/lib/contracts";

// ─── Human-readable error mapping ───────────────────────────────────────────

function parseContractError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes("User rejected") || msg.includes("user rejected") || msg.includes("ACTION_REJECTED"))
    return "Transaction rejected";
  if (msg.includes("disconnected") || msg.includes("Connector not connected"))
    return "Wallet disconnected — please reconnect and try again";
  if (msg.includes("insufficient funds for gas"))
    return "Insufficient ETH for gas fees";
  if (msg.includes("MarketNotOpen"))    return "Market is no longer open for trading";
  if (msg.includes("MarketNotSettled")) return "Settlement period hasn't passed yet (30 min after resolution)";
  if (msg.includes("AlreadyClaimed"))   return "Already claimed";
  if (msg.includes("NothingToClaim"))   return "No winnings to claim";
  if (msg.includes("ZeroAmount"))       return "Amount must be greater than zero";
  if (msg.includes("InvalidOutcome"))   return "Invalid outcome selection";
  if (msg.includes("MarketNotClaimable")) return "Market is not claimable yet";
  if (msg.includes("transfer amount exceeds balance") || msg.includes("insufficient balance"))
    return "Insufficient USDC balance";
  if (msg.includes("allowance") || msg.includes("InsufficientAllowance"))
    return "USDC approval required — please try again";

  return msg.length > 120 ? msg.slice(0, 120) + "…" : msg;
}

// ─── useMarketData ────────────────────────────────────────────────────────────
// Reads parimutuel pool sizes and market metadata. Refreshes every 15 s.

export interface OnchainMarketData {
  yesPool:    bigint;  // net shares on outcome 0
  noPool:     bigint;  // net shares on outcome 1
  drawPool:   bigint;  // net shares on outcome 2
  totalPool:  bigint;
  yesPrice:   number;  // 0–100 (percent, implied from pool proportions)
  noPrice:    number;
  drawPrice:  number;
  question:   string;
  outcomes:   readonly [string, string];
  resolutionTimestamp: bigint;
  status:     number;
  resolvedOutcome: number;
  resolvedAt: bigint;
  createdAt:  bigint;
  isLoading:  boolean;
  refetch:    () => void;
}

export function useMarketData(marketId: number | undefined): OnchainMarketData {
  const enabled = marketId !== undefined;

  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      {
        address: CONTRACTS.engine,
        abi: parimutuelEngineAbi,
        functionName: "totalSharesByOutcome",
        args: enabled ? [BigInt(marketId), 0] : undefined,
      },
      {
        address: CONTRACTS.engine,
        abi: parimutuelEngineAbi,
        functionName: "totalSharesByOutcome",
        args: enabled ? [BigInt(marketId), 1] : undefined,
      },
      {
        address: CONTRACTS.engine,
        abi: parimutuelEngineAbi,
        functionName: "totalSharesByOutcome",
        args: enabled ? [BigInt(marketId), 2] : undefined,
      },
      {
        address: CONTRACTS.engine,
        abi: parimutuelEngineAbi,
        functionName: "totalPool",
        args: enabled ? [BigInt(marketId)] : undefined,
      },
      {
        address: CONTRACTS.factory,
        abi: marketFactoryAbi,
        functionName: "getMarket",
        args: enabled ? [BigInt(marketId)] : undefined,
      },
    ],
    query: { enabled, refetchInterval: 15_000 },
  });

  return useMemo(() => {
    const yesPool   = (data?.[0]?.result as bigint) ?? 0n;
    const noPool    = (data?.[1]?.result as bigint) ?? 0n;
    const drawPool  = (data?.[2]?.result as bigint) ?? 0n;
    const totalPool = (data?.[3]?.result as bigint) ?? 0n;

    const marketData = data?.[4]?.result as {
      question: string;
      outcomes: readonly [string, string];
      resolutionTimestamp: bigint;
      status: number;
      resolvedOutcome: number;
      resolvedAt: bigint;
      createdAt: bigint;
    } | undefined;

    // Implied probability = pool share of each outcome (parimutuel pricing)
    const yesPrice  = totalPool > 0n ? Number((yesPool  * 10000n) / totalPool) / 100 : 50;
    const noPrice   = totalPool > 0n ? Number((noPool   * 10000n) / totalPool) / 100 : 50;
    const drawPrice = totalPool > 0n ? Number((drawPool * 10000n) / totalPool) / 100 : 0;

    return {
      yesPool, noPool, drawPool, totalPool,
      yesPrice, noPrice, drawPrice,
      question:            marketData?.question ?? "",
      outcomes:            marketData?.outcomes ?? ["Yes", "No"],
      resolutionTimestamp: marketData?.resolutionTimestamp ?? 0n,
      status:              marketData?.status ?? 0,
      resolvedOutcome:     marketData?.resolvedOutcome ?? 0,
      resolvedAt:          marketData?.resolvedAt ?? 0n,
      createdAt:           marketData?.createdAt ?? 0n,
      isLoading,
      refetch,
    };
  }, [data, isLoading, refetch]);
}

// ─── useUserPosition ──────────────────────────────────────────────────────────

export interface UserPosition {
  sharesYes:  bigint;
  sharesNo:   bigint;
  sharesDraw: bigint;
  hasClaimed: boolean;
  isLoading:  boolean;
  refetch:    () => void;
}

export function useUserPosition(marketId: number | undefined): UserPosition {
  const { address } = useAccount();
  const enabled = marketId !== undefined && !!address;

  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      {
        address: CONTRACTS.engine,
        abi: parimutuelEngineAbi,
        functionName: "getUserShares",
        args: enabled ? [BigInt(marketId), address!, 0] : undefined,
      },
      {
        address: CONTRACTS.engine,
        abi: parimutuelEngineAbi,
        functionName: "getUserShares",
        args: enabled ? [BigInt(marketId), address!, 1] : undefined,
      },
      {
        address: CONTRACTS.engine,
        abi: parimutuelEngineAbi,
        functionName: "getUserShares",
        args: enabled ? [BigInt(marketId), address!, 2] : undefined,
      },
      {
        address: CONTRACTS.engine,
        abi: parimutuelEngineAbi,
        functionName: "claimed",
        args: enabled ? [BigInt(marketId), address!] : undefined,
      },
    ],
    query: { enabled, refetchInterval: 15_000 },
  });

  return useMemo(() => ({
    sharesYes:  (data?.[0]?.result as bigint)  ?? 0n,
    sharesNo:   (data?.[1]?.result as bigint)  ?? 0n,
    sharesDraw: (data?.[2]?.result as bigint)  ?? 0n,
    hasClaimed: (data?.[3]?.result as boolean) ?? false,
    isLoading,
    refetch,
  }), [data, isLoading, refetch]);
}

// ─── useUSDCBalance ───────────────────────────────────────────────────────────

export interface USDCBalance {
  balance:   bigint;
  formatted: string;
  isLoading: boolean;
  refetch:   () => void;
}

export function useUSDCBalance(): USDCBalance {
  const { address } = useAccount();
  const enabled = !!address;

  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACTS.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: enabled ? [address!] : undefined,
    query: { enabled, refetchInterval: 15_000 },
  });

  return useMemo(() => {
    const balance   = (data as bigint) ?? 0n;
    const formatted = (Number(balance) / 1_000_000).toFixed(2);
    return { balance, formatted, isLoading, refetch };
  }, [data, isLoading, refetch]);
}

// ─── useBuyShares ─────────────────────────────────────────────────────────────
// Handles: check USDC allowance → approve vault if needed → buyShares on engine.
// Approval: if current allowance < amount, approves 10× the amount to reduce
// future approval prompts.

export type BuyState =
  | "idle"
  | "checking-allowance"
  | "approving"
  | "awaiting-approval"
  | "buying"
  | "awaiting-confirmation"
  | "confirmed"
  | "error";

export interface BuySharesHook {
  buyShares: (marketId: number, outcome: 0 | 1 | 2, amount: bigint) => Promise<void>;
  state:   BuyState;
  txHash:  `0x${string}` | undefined;
  error:   string | undefined;
  reset:   () => void;
}

export function useBuyShares(): BuySharesHook {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const { refetch: refetchAllowance } = useReadContract({
    address: CONTRACTS.usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, CONTRACTS.vault] : undefined,
    query: { enabled: !!address },
  });

  const [state,  setState]  = useState<BuyState>("idle");
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
  const [error,  setError]  = useState<string | undefined>(undefined);

  const reset = useCallback(() => {
    setState("idle");
    setTxHash(undefined);
    setError(undefined);
  }, []);

  const buyShares = useCallback(
    async (marketId: number, outcome: 0 | 1 | 2, amount: bigint) => {
      if (!address || !publicClient) return;
      setError(undefined);

      try {
        // 1. Check current allowance
        setState("checking-allowance");
        const { data: currentAllowance } = await refetchAllowance();
        const allowance = (currentAllowance as bigint) ?? 0n;

        // 2. Approve if needed — approve 10× to reduce future prompts
        if (allowance < amount) {
          setState("approving");
          const approveTx = await writeContractAsync({
            address: CONTRACTS.usdc,
            abi: erc20Abi,
            functionName: "approve",
            args: [CONTRACTS.vault, amount * 10n],
          });
          setTxHash(approveTx);
          setState("awaiting-approval");
          await publicClient.waitForTransactionReceipt({ hash: approveTx, confirmations: 1 });
        }

        // 3. Buy shares
        setState("buying");
        const tx = await writeContractAsync({
          address: CONTRACTS.engine,
          abi: parimutuelEngineAbi,
          functionName: "buyShares",
          args: [BigInt(marketId), outcome, amount],
        });
        setTxHash(tx);
        setState("awaiting-confirmation");

        const receipt = await publicClient.waitForTransactionReceipt({ hash: tx, confirmations: 1 });
        if (receipt.status === "reverted") throw new Error("Transaction reverted on-chain");

        setState("confirmed");
      } catch (err: unknown) {
        setError(parseContractError(err));
        setState("error");
      }
    },
    [address, publicClient, refetchAllowance, writeContractAsync]
  );

  return { buyShares, state, txHash, error, reset };
}

// ─── useMintTestUSDC ──────────────────────────────────────────────────────────
// Calls MockUSDC.mint(address, 100_000_000) — only available on Base Sepolia.

const MOCK_USDC_MINT_ABI = [
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to",     type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export type MintState = "idle" | "minting" | "awaiting-confirmation" | "confirmed" | "error";

export interface MintTestUSDCHook {
  mint:   () => Promise<void>;
  state:  MintState;
  txHash: `0x${string}` | undefined;
  error:  string | undefined;
  reset:  () => void;
}

export function useMintTestUSDC(): MintTestUSDCHook {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const isTestnet = process.env.NEXT_PUBLIC_CHAIN_ID === "84532";

  const [state,  setState]  = useState<MintState>("idle");
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
  const [error,  setError]  = useState<string | undefined>(undefined);

  const reset = useCallback(() => {
    setState("idle");
    setTxHash(undefined);
    setError(undefined);
  }, []);

  const mint = useCallback(async () => {
    if (!address || !publicClient || !isTestnet) return;
    setError(undefined);

    try {
      setState("minting");
      const tx = await writeContractAsync({
        address: CONTRACTS.usdc,
        abi: MOCK_USDC_MINT_ABI,
        functionName: "mint",
        args: [address, 100_000_000n],
      });
      setTxHash(tx);
      setState("awaiting-confirmation");

      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx, confirmations: 1 });
      if (receipt.status === "reverted") throw new Error("Transaction reverted on-chain");

      setState("confirmed");
    } catch (err: unknown) {
      setError(parseContractError(err));
      setState("error");
    }
  }, [address, publicClient, isTestnet, writeContractAsync]);

  return { mint, state, txHash, error, reset };
}

// ─── useClaimWinnings ─────────────────────────────────────────────────────────

export type ClaimState = "idle" | "claiming" | "awaiting-confirmation" | "confirmed" | "error";

export interface ClaimWinningsHook {
  claimWinnings: (marketId: number) => Promise<void>;
  state:   ClaimState;
  txHash:  `0x${string}` | undefined;
  error:   string | undefined;
  reset:   () => void;
}

export function useClaimWinnings(): ClaimWinningsHook {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [state,  setState]  = useState<ClaimState>("idle");
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
  const [error,  setError]  = useState<string | undefined>(undefined);

  const reset = useCallback(() => {
    setState("idle");
    setTxHash(undefined);
    setError(undefined);
  }, []);

  const claimWinnings = useCallback(
    async (marketId: number) => {
      if (!publicClient) return;
      setError(undefined);

      try {
        setState("claiming");
        const tx = await writeContractAsync({
          address: CONTRACTS.engine,
          abi: parimutuelEngineAbi,
          functionName: "claimWinnings",
          args: [BigInt(marketId)],
        });
        setTxHash(tx);
        setState("awaiting-confirmation");

        const receipt = await publicClient.waitForTransactionReceipt({ hash: tx, confirmations: 1 });
        if (receipt.status === "reverted") throw new Error("Transaction reverted on-chain");

        setState("confirmed");
      } catch (err: unknown) {
        setError(parseContractError(err));
        setState("error");
      }
    },
    [publicClient, writeContractAsync]
  );

  return { claimWinnings, state, txHash, error, reset };
}
