import type { MarketResponse } from "@/lib/api";

// Parimutuel markets have no real order book (no limit orders, no matching
// engine — see CLAUDE.md). This shows the actual pool composition instead of
// a fabricated bid/ask ladder: real pool sizes and the real payout multiplier
// each outcome would pay at today's pool split.

interface PoolBreakdownProps {
  market: MarketResponse;
}

function formatUsdc(raw: string): string {
  const n = Number(BigInt(raw)) / 1_000_000;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function PoolBreakdown({ market }: PoolBreakdownProps) {
  const yesRes = BigInt(market.poolYes);
  const noRes = BigInt(market.poolNo);
  const drawRes = market.poolDraw ? BigInt(market.poolDraw) : 0n;
  const total = yesRes + noRes + drawRes;
  const hasDraw = !!market.outcomeC;

  const rows = [
    { name: market.outcomeA, pool: yesRes, color: "cyan" as const },
    ...(hasDraw ? [{ name: market.outcomeC!, pool: drawRes, color: "amber" as const }] : []),
    { name: market.outcomeB, pool: noRes, color: "pink" as const },
  ];

  const colorClasses: Record<string, { text: string; bar: string }> = {
    cyan: { text: "text-cyan-400", bar: "bg-cyan-500" },
    amber: { text: "text-amber-400", bar: "bg-amber-500" },
    pink: { text: "text-pink-400", bar: "bg-pink-500" },
  };

  if (total === 0n) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
        <p className="text-xs font-semibold text-foreground">No pool yet</p>
        <p className="text-[11px] text-muted-foreground">Be the first to buy shares in this market.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {rows.map((r) => {
        const pct = total > 0n ? Number((r.pool * 10000n) / total) / 100 : 0;
        const multiplier = r.pool > 0n ? Number((total * 100n) / r.pool) / 100 : null;
        const c = colorClasses[r.color];
        return (
          <div key={r.name}>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className={`font-semibold ${c.text}`}>{r.name}</span>
              <span className="font-mono text-muted-foreground">
                {formatUsdc(String(r.pool))} &middot; {pct.toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className={`h-full ${c.bar} transition-all duration-500`} style={{ width: `${pct}%` }} />
            </div>
            {multiplier !== null && multiplier >= 1.01 && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Pays <span className="font-mono font-semibold text-foreground">{multiplier.toFixed(2)}x</span> per
                share if this wins
              </p>
            )}
          </div>
        );
      })}
      <div className="mt-1 border-t border-border pt-2 text-[10px] text-muted-foreground">
        Total pool: <span className="font-mono font-semibold text-foreground">{formatUsdc(String(total))}</span>
      </div>
    </div>
  );
}
