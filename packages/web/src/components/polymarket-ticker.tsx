import type { PolymarketMarket } from "@/lib/api";

interface PolymarketTickerProps {
  markets: PolymarketMarket[];
}

function TickerItem({ market }: { market: PolymarketMarket }) {
  const topIdx = market.outcomePrices.indexOf(Math.max(...market.outcomePrices));
  const label = market.outcomes[topIdx] ?? market.question;
  const price = Math.round((market.outcomePrices[topIdx] ?? 0) * 100);

  return (
    <span className="flex shrink-0 items-center gap-2 px-4 text-xs">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-purple-400" />
      <span className="truncate max-w-[220px] font-medium text-foreground">{market.question}</span>
      <span className="font-mono font-bold text-purple-300">{label} {price}%</span>
    </span>
  );
}

export function PolymarketTicker({ markets }: PolymarketTickerProps) {
  if (markets.length === 0) return null;

  // Duplicate the list so the marquee loops seamlessly.
  const items = [...markets, ...markets];

  return (
    <div className="mb-8 overflow-hidden rounded-lg border border-purple-500/20 bg-purple-950/10">
      <div className="flex items-center gap-2 border-b border-purple-500/10 px-3 py-1.5">
        <span className="inline-flex items-center gap-1 rounded bg-purple-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-purple-400">
          <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
          Polymarket
        </span>
        <span className="text-[10px] text-muted-foreground">Live consensus &middot; reference only, not tradeable here</span>
      </div>
      <div className="flex whitespace-nowrap py-2.5">
        <div className="flex animate-marquee">
          {items.map((m, i) => (
            <TickerItem key={`${m.id}-${i}`} market={m} />
          ))}
        </div>
      </div>
    </div>
  );
}
