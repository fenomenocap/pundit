"use client";

import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { baseSepolia } from "wagmi/chains";

const TARGET_CHAIN = baseSepolia;

export function NetworkGuard({ children }: { children: React.ReactNode }) {
  const chainId = useChainId();
  const { isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected || chainId === TARGET_CHAIN.id) {
    return <>{children}</>;
  }

  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <div className="mb-4 flex justify-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
          <svg
            className="h-8 w-8 text-amber-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>
      </div>
      <h2 className="mb-2 font-heading text-xl font-bold text-white">
        Wrong Network
      </h2>
      <p className="mb-6 text-sm text-slate-400">
        Please switch to {TARGET_CHAIN.name} to use Sports Predict.
        You are currently connected to chain ID {chainId}.
      </p>
      <button
        onClick={() => switchChain({ chainId: TARGET_CHAIN.id })}
        disabled={isPending}
        className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? "Switching..." : `Switch to ${TARGET_CHAIN.name}`}
      </button>
    </div>
  );
}
