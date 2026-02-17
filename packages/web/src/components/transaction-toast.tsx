"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { EXPLORER_BASE } from "@/lib/contracts";
import type { BuyState, SellState, ClaimState } from "@/hooks/use-contracts";

// ─── TransactionToast ────────────────────────────────────────────────────────
// Shows transaction status with tx hash linking to BaseScan.
// Renders inline (not via toast context) so it can show state transitions.

interface TransactionToastProps {
  state: BuyState | SellState | ClaimState;
  txHash: `0x${string}` | undefined;
  error: string | undefined;
  onReset: () => void;
  successMessage?: string;
}

export function TransactionToast({
  state,
  txHash,
  error,
  onReset,
  successMessage = "Transaction confirmed!",
}: TransactionToastProps) {
  // Auto-dismiss after confirmed
  useEffect(() => {
    if (state === "confirmed") {
      const t = setTimeout(onReset, 5000);
      return () => clearTimeout(t);
    }
  }, [state, onReset]);

  if (state === "idle") return null;

  const isProcessing = [
    "checking-allowance",
    "approving",
    "awaiting-approval",
    "buying",
    "claiming",
    "awaiting-confirmation",
  ].includes(state);

  const stateLabel: Record<string, string> = {
    "checking-allowance": "Checking allowance...",
    approving: "Approving USDC...",
    "awaiting-approval": "Waiting for approval...",
    buying: "Submitting trade...",
    selling: "Submitting sale...",
    claiming: "Submitting claim...",
    "awaiting-confirmation": "Awaiting confirmation...",
    confirmed: successMessage,
    error: error ?? "Transaction failed",
  };

  return (
    <div
      className={cn(
        "mt-3 rounded-lg border p-3 text-sm",
        isProcessing && "border-blue-500/30 bg-blue-950/30",
        state === "confirmed" && "border-emerald-500/30 bg-emerald-950/30",
        state === "error" && "border-pink-500/30 bg-pink-950/30"
      )}
    >
      <div className="flex items-center gap-2">
        {/* Status icon */}
        {isProcessing && <Spinner />}
        {state === "confirmed" && <CheckIcon />}
        {state === "error" && <XIcon />}

        <span
          className={cn(
            "flex-1 text-xs font-medium",
            isProcessing && "text-blue-300",
            state === "confirmed" && "text-emerald-300",
            state === "error" && "text-pink-300"
          )}
        >
          {stateLabel[state]}
        </span>

        {/* Dismiss */}
        {(state === "confirmed" || state === "error") && (
          <button
            onClick={onReset}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            Dismiss
          </button>
        )}
      </div>

      {/* Tx hash link */}
      {txHash && (
        <a
          href={`${EXPLORER_BASE}/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 block font-mono text-[11px] text-blue-400 hover:text-blue-300"
        >
          {txHash.slice(0, 10)}...{txHash.slice(-6)} ↗
        </a>
      )}
    </div>
  );
}

// ─── Inline icons ────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-blue-400"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-4 w-4 text-emerald-400"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m4.5 12.75 6 6 9-13.5"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="h-4 w-4 text-pink-400"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18 18 6M6 6l12 12"
      />
    </svg>
  );
}
