"use client";

import { useState } from "react";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { VAULTS, type Vault, type VaultId } from "@/desk/lib/data/vaults";
import { fmtEdge, fmtMoney, fmtPct } from "@/desk/lib/format";
import { useDesk } from "@/desk/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export function VaultView() {
  const alloc = useDesk((s) => s.vaultAlloc);
  const cash = useDesk((s) => s.cash);
  const total = alloc.alpha + alloc.neutral + alloc.yield;
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
      <p className="eyebrow">Paper lab · not a fund</p>
      <h1 className="font-display text-5xl sm:text-6xl tracking-wide uppercase mt-2">
        Model books
      </h1>
      <p className="mt-3 max-w-xl text-quiet leading-relaxed">
        Three ways the model reads a gameweek. Paper-track them against the GW4 slate. Same engine
        as the desk. Not a deposit, not a bookmaker.
      </p>
      <div className="mt-6 flex flex-wrap gap-6 text-sm">
        <Stat k="Free credit" v={fmtMoney(cash)} />
        <Stat k="In vaults" v={fmtMoney(total)} />
        <Stat k="Paper book" v="Sim" />
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {VAULTS.map((v) => (
          <VaultCard key={v.id} vault={v} allocated={alloc[v.id]} />
        ))}
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-quiet">{k}</div>
      <div className="font-mono text-lg tabular-nums mt-0.5">{v}</div>
    </div>
  );
}

function VaultCard({ vault, allocated }: { vault: Vault; allocated: number }) {
  const allocate = useDesk((s) => s.allocate);
  const withdraw = useDesk((s) => s.withdrawVault);
  const cash = useDesk((s) => s.cash);
  const [amt, setAmt] = useState(vault.min);
  const [err, setErr] = useState<string | null>(null);
  const data = vault.nav.map((n, i) => ({ i, n }));
  const up = vault.ytd >= 0;

  return (
    <article className="rounded-lg border border-border bg-surface p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-quiet">
            {vault.code} · {vault.tag}
          </div>
          <h2 className="font-display text-3xl tracking-tight mt-1">{vault.name}</h2>
        </div>
        <div className={cn("font-mono text-sm tabular-nums", up ? "text-up" : "text-down")}>
          {up ? "+" : ""}
          {fmtPct(vault.ytd, 1)}
        </div>
      </div>
      <p className="mt-2 text-sm text-quiet leading-relaxed flex-1">{vault.blurb}</p>
      <div className="h-16 mt-3 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
            <Line type="monotone" dataKey="n" stroke="var(--color-accent)" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <dt className="text-quiet uppercase tracking-wider">Vol</dt>
          <dd className="font-mono tabular-nums">{fmtPct(vault.vol)}</dd>
        </div>
        <div>
          <dt className="text-quiet uppercase tracking-wider">Max DD</dt>
          <dd className="font-mono tabular-nums">{fmtPct(vault.maxdd)}</dd>
        </div>
        <div>
          <dt className="text-quiet uppercase tracking-wider">Sharpe</dt>
          <dd className="font-mono tabular-nums">{vault.sharpe.toFixed(2)}</dd>
        </div>
      </dl>
      <ul className="mt-3 space-y-1.5">
        {vault.holdings.map((h) => (
          <li key={h.label} className="flex items-center gap-2 text-xs">
            <span className="truncate text-quiet">{h.label}</span>
            <span className="ml-auto font-mono tabular-nums text-subtle">{Math.round(h.weight * 100)}%</span>
            <span className="font-mono tabular-nums text-up w-14 text-right">{fmtEdge(h.edge)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 pt-3 border-t border-border">
        <div className="flex justify-between text-xs">
          <span className="text-quiet">Your allocation</span>
          <span className="font-mono tabular-nums">{fmtMoney(allocated)}</span>
        </div>
        <div className="mt-2 flex gap-2">
          <input
            type="number"
            min={vault.min}
            max={cash}
            value={amt}
            onChange={(e) => setAmt(Number(e.target.value))}
            className="h-10 w-24 rounded-md border border-border bg-elevated px-2 font-mono text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
          <Button
            size="md"
            variant="primary"
            className="flex-1"
            onClick={() => setErr(allocate(vault.id as VaultId, amt))}
          >
            Allocate
          </Button>
        </div>
        {allocated > 0 ? (
          <Button size="sm" variant="ghost" className="w-full mt-2" onClick={() => withdraw(vault.id)}>
            Withdraw
          </Button>
        ) : null}
        {err ? <p className="mt-2 text-xs text-down">{err}</p> : null}
      </div>
    </article>
  );
}
