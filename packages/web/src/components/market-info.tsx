"use client";

import { cn } from "@/lib/utils";
import { CONTRACTS, EXPLORER_BASE } from "@/lib/contracts";
import type { MarketResponse } from "@/lib/api";

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  GROUP_STAGE: { label: "Group Stage", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  ROUND_OF_16: { label: "Round of 16", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
  QUARTER_FINAL: { label: "Quarter-Final", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  SEMI_FINAL: { label: "Semi-Final", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  FINAL: { label: "Final", color: "bg-rose-500/20 text-rose-400 border-rose-500/30" },
  TOURNAMENT: { label: "Tournament", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  OPEN: { label: "Open", color: "bg-emerald-500/20 text-emerald-400" },
  LOCKED: { label: "Locked", color: "bg-amber-500/20 text-amber-400" },
  RESOLVED: { label: "Resolved", color: "bg-blue-500/20 text-blue-400" },
  CANCELLED: { label: "Cancelled", color: "bg-slate-500/20 text-slate-400" },
};

interface MarketInfoProps {
  market: MarketResponse;
  participantCount: number;
}

function formatUsdcPool(raw: string): string {
  const n = Number(BigInt(raw)) / 1_000_000;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function getCountdown(target: string): string {
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function MarketInfo({ market, participantCount }: MarketInfoProps) {
  const cat = CATEGORY_CONFIG[market.category] || { label: market.category, color: "bg-slate-500/20 text-slate-400 border-slate-500/30" };
  const status = STATUS_CONFIG[market.status] || { label: market.status, color: "bg-slate-500/20 text-slate-400" };

  const poolYes = BigInt(market.poolYes);
  const poolNo = BigInt(market.poolNo);
  const total = poolYes + poolNo;
  const pctYes = total > 0n ? Number((poolYes * 10000n) / total) / 100 : 50;
  const pctNo = 100 - pctYes;

  const explorerBase = EXPLORER_BASE;
  const contractAddr = CONTRACTS.engine;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", cat.color)}>
            {cat.label}
          </span>
          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", status.color)}>
            {status.label}
          </span>
        </div>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-white sm:text-3xl">
          {market.question}
        </h1>
      </div>

      {/* Wide odds bar */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-emerald-400">
            {market.outcomeA}
            <span className="ml-2 font-mono text-lg">{pctYes.toFixed(1)}%</span>
          </span>
          <span className="text-sm font-semibold text-rose-400">
            <span className="mr-2 font-mono text-lg">{pctNo.toFixed(1)}%</span>
            {market.outcomeB}
          </span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-slate-800">
          <div
            className="rounded-l-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-700"
            style={{ width: `${pctYes}%` }}
          />
          <div
            className="rounded-r-full bg-gradient-to-l from-rose-600 to-rose-400 transition-all duration-700"
            style={{ width: `${pctNo}%` }}
          />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Pool" value={`$${formatUsdcPool(market.totalVolume)}`} />
        <StatCard label="Participants" value={String(participantCount)} />
        <StatCard label="Time Left" value={getCountdown(market.resolutionTimestamp)} />
        <StatCard label="Market ID" value={`#${market.onchainId}`} />
      </div>

      {/* Market details */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="mb-3 font-heading text-sm font-semibold text-slate-200">
          Market Details
        </h3>
        <dl className="space-y-2.5 text-sm">
          <DetailRow label="Resolution Date" value={new Date(market.resolutionTimestamp).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} />
          <DetailRow label="Source" value="FIFA Official / Oracle Committee" />
          <DetailRow label="Resolution Rules" value="Market resolves YES if the specified outcome occurs by the resolution date. Otherwise resolves NO." />
          {market.resolvedAt && (
            <DetailRow label="Resolved At" value={new Date(market.resolvedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} />
          )}
          <div className="flex items-start justify-between gap-4 pt-1">
            <dt className="text-slate-400">Contract</dt>
            <dd>
              <a
                href={`${explorerBase}/address/${contractAddr}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-blue-400 underline-offset-2 hover:underline"
              >
                {contractAddr.slice(0, 10)}...{contractAddr.slice(-8)}
              </a>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-0.5 font-heading text-sm font-semibold text-slate-100">
        {value}
      </p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-slate-400">{label}</dt>
      <dd className="text-right text-slate-200">{value}</dd>
    </div>
  );
}
