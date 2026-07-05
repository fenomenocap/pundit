import Link from "next/link";
import { getTeamFlag } from "@/lib/team-logos";
import { normalizeTeamName } from "@/lib/team-status";
import type { MarketResponse, ModelTeamProbability } from "@/lib/api";

// Dense sportsbook-style futures board — for binary "will TEAM win it all"
// outright markets. A big card grid reads as repetitive noise at 40+ nearly
// identical items; a compact odds-board list reads as a normal futures table.

function pricesFor(
  market: MarketResponse,
  modelByTeam: Map<string, ModelTeamProbability>
): { yes: number; no: number; source: "pool" | "polymarket" | "model" | "none" } {
  const yesRes = BigInt(market.poolYes);
  const noRes = BigInt(market.poolNo);
  const total = yesRes + noRes;

  if (total > 0n) {
    return {
      yes: Number((yesRes * 10000n) / total) / 100,
      no: Number((noRes * 10000n) / total) / 100,
      source: "pool",
    };
  }
  if (market.polymarketOdds) {
    return {
      yes: Math.round((market.polymarketOdds.prices[0] ?? 0) * 1000) / 10,
      no: Math.round((market.polymarketOdds.prices[1] ?? 0) * 1000) / 10,
      source: "polymarket",
    };
  }
  const model = market.teamA ? modelByTeam.get(normalizeTeamName(market.teamA)) : undefined;
  if (model) {
    const yes = Math.round(model.winProb * 1000) / 10;
    return { yes, no: Math.round((100 - yes) * 10) / 10, source: "model" };
  }
  return { yes: 50, no: 50, source: "none" };
}

function OutrightRow({ market, modelByTeam }: { market: MarketResponse; modelByTeam: Map<string, ModelTeamProbability> }) {
  const { yes, no, source } = pricesFor(market, modelByTeam);
  const flag = getTeamFlag(market.teamA);

  return (
    <Link
      href={`/market/${market.id}`}
      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-secondary/50"
    >
      <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-foreground">
        {flag && <span className="shrink-0 text-base">{flag}</span>}
        <span className="truncate">{market.teamA}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="rounded-md bg-cyan-500/15 px-2 py-0.5 text-[11px] font-black text-cyan-400">
          {Math.round(yes)}&cent;
        </span>
        <span className="rounded-md bg-pink-500/15 px-2 py-0.5 text-[11px] font-black text-pink-400">
          {Math.round(no)}&cent;
        </span>
        {source === "model" && (
          <span className="text-[9px] text-muted-foreground" title="Elo/Poisson model estimate — no trades or reference odds yet">
            est.
          </span>
        )}
      </span>
    </Link>
  );
}

export function OutrightsBoard({
  markets,
  title,
  modelProbabilities = [],
}: {
  markets: MarketResponse[];
  title: string;
  modelProbabilities?: ModelTeamProbability[];
}) {
  if (markets.length === 0) return null;

  const modelByTeam = new Map(modelProbabilities.map((t) => [normalizeTeamName(t.team), t]));
  const sorted = [...markets].sort((a, b) => pricesFor(b, modelByTeam).yes - pricesFor(a, modelByTeam).yes);

  return (
    <div className="mb-8 rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">{title}</h2>
      </div>
      <div className="grid gap-x-2 p-2 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((m) => (
          <OutrightRow key={m.id} market={m} modelByTeam={modelByTeam} />
        ))}
      </div>
    </div>
  );
}
