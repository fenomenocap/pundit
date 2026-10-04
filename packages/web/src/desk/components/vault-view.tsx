"use client";

import { useState } from "react";
import { VAULTS, type Vault } from "@/desk/lib/data/vaults";
import { fmtMoney } from "@/desk/lib/format";
import { useDesk } from "@/desk/lib/store";
import { Button } from "./ui/button";

export function VaultView() {
  const alloc = useDesk((s) => s.vaultAlloc);
  const cash = useDesk((s) => s.cash);
  const total = alloc.alpha + alloc.neutral + alloc.yield;
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
      <p className="eyebrow">Local practice · illustrative books</p>
      <h1 className="font-display text-5xl sm:text-6xl tracking-wide uppercase mt-2">
        Model books
      </h1>
      <p className="mt-3 max-w-xl text-quiet leading-relaxed">
        Reserve practice credits in three illustrative buckets. These books do not place positions,
        track the live slate or earn returns. Credits and reservations stay in this browser.
      </p>
      <div className="mt-6 flex flex-wrap gap-6 text-sm">
        <Stat k="Free credit" v={fmtMoney(cash)} />
        <Stat k="Reserved credit" v={fmtMoney(total)} />
        <Stat k="Performance" v="Not tracked" />
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

  return (
    <article className="rounded-lg border border-border bg-surface p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-quiet">
            {vault.code} · {vault.tag}
          </div>
          <h2 className="font-display text-3xl tracking-tight mt-1">{vault.name}</h2>
        </div>
      </div>
      <p className="mt-2 text-sm text-quiet leading-relaxed flex-1">{vault.blurb}</p>
      <p className="mt-4 rounded-md border border-border p-3 text-xs text-quiet">
        No measured performance or holdings. Reserved credits retain their nominal value.
      </p>
      <div className="mt-4 pt-3 border-t border-border">
        <div className="flex justify-between text-xs">
          <span className="text-quiet">Your reserved credits</span>
          <span className="font-mono tabular-nums">{fmtMoney(allocated)}</span>
        </div>
        <div className="mt-2 flex gap-2">
          <input
            aria-label={`${vault.name} practice credits`}
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
            onClick={() => setErr(allocate(vault.id, amt))}
          >
            Reserve credits
          </Button>
        </div>
        {allocated > 0 ? (
          <Button size="sm" variant="ghost" className="w-full mt-2" onClick={() => withdraw(vault.id)}>
            Return credits
          </Button>
        ) : null}
        {err ? <p className="mt-2 text-xs text-down">{err}</p> : null}
      </div>
    </article>
  );
}
