"use client";

import { useMemo, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  MARKET_LABEL,
  getFixture,
  gw3Record,
  modelProbFor,
  selectionLabel,
  type MarketKey,
} from "@/desk/lib/data/fixtures";
import { TEAMS } from "@/desk/lib/data/teams";
import { accaPrice, fmtEdge, fmtKickoff, fmtMoney, fmtOdds, fmtPct, signedClass } from "@/desk/lib/format";
import { bestEdge, useDesk } from "@/desk/lib/store";
import { cn } from "@/lib/utils";
import { FormDots } from "./form-dots";
import { KitPip, TeamMark } from "./kit";
import { OddsBtn } from "./odds-btn";
import { ProbBar } from "./prob-bar";
import { Ticker } from "./ticker";
import { Button } from "./ui/button";
import { useLiveSlate } from "./use-live-slate";

const ONE_X_TWO: { key: MarketKey; label: string }[] = [
  { key: "home", label: "1" },
  { key: "draw", label: "X" },
  { key: "away", label: "2" },
];
const ALT: { key: MarketKey; label: string }[] = [
  { key: "over25", label: "O2.5" },
  { key: "under25", label: "U2.5" },
  { key: "bttsY", label: "BTTS" },
  { key: "bttsN", label: "BTTS N" },
];

export function BoardView() {
  return (
    <div className="flex flex-col min-h-0">
      <Ticker />
      <PaperStrip />
      <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.95fr)_minmax(280px,0.85fr)] min-h-0">
        <MarketList />
        <TicketPanel />
        <SlipRail />
      </div>
    </div>
  );
}

function PaperStrip() {
  const rec = gw3Record();
  const simulateAll = useDesk((s) => s.simulateAll);
  const resetBook = useDesk((s) => s.resetBook);
  const open = useDesk((s) => s.tickets.filter((t) => t.status === "open").length);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-3 sm:px-4 py-2 text-xs">
      <span className="rounded-xs bg-accent/15 px-1.5 py-0.5 font-display text-2xs uppercase tracking-wider text-accent">
        Paper lab
      </span>
      <span className="font-display tabular-nums text-fg">
        {rec.hits}/{rec.n} <span className="text-quiet">model 1X2</span> {fmtPct(rec.pct)}
      </span>
      <span className="hidden sm:inline text-quiet">
        Simulated prices. Pundit is not a bookmaker.
      </span>
      <div className="ml-auto flex items-center gap-2">
        {open > 0 ? (
          <Button size="sm" variant="accent" onClick={simulateAll}>
            Run the weekend
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={resetBook}>
          <RotateCcw className="size-3.5" />
          Reset
        </Button>
      </div>
    </div>
  );
}

function MarketList() {
  const selectedId = useDesk((s) => s.selectedId);
  const select = useDesk((s) => s.selectFixture);
  const scores = useDesk((s) => s.scores);
  const addLeg = useDesk((s) => s.addLeg);
  const slip = useDesk((s) => s.slip);
  const { open, settled } = useLiveSlate();

  return (
    <section className="border-b lg:border-b-0 lg:border-r border-border min-w-0">
      <header className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-border">
        <h2 className="eyebrow">Open · GW4</h2>
        <span className="text-2xs text-subtle tabular-nums">{open.length} listed</span>
      </header>
      <ul>
        {open.map((f) => {
          const active = f.id === selectedId;
          const score = scores[f.id];
          const edgeHome = modelProbFor(f, "home") - 1 / f.odds.home;
          const onSlip = slip.find((l) => l.fixtureId === f.id);
          return (
            <li key={f.id}>
              <div
                onClick={() => select(f.id)}
                className={cn(
                  "w-full text-left px-3 sm:px-4 py-3 border-b border-border transition-colors cursor-pointer",
                  active ? "bg-panel" : "hover:bg-elevated",
                )}
              >
                <div className="flex items-center gap-2 text-2xs uppercase tracking-wide text-quiet">
                  <span>{fmtKickoff(f.kickoff)}</span>
                  <FormDots team={f.home} size="sm" />
                  <FormDots team={f.away} size="sm" />
                  <span className="ml-auto tabular-nums">
                    xG {f.xg[0].toFixed(2)}–{f.xg[1].toFixed(2)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <KitPip team={f.home} />
                      <span className="font-medium truncate">{TEAMS[f.home].name}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <KitPip team={f.away} />
                      <span className="font-medium truncate">{TEAMS[f.away].name}</span>
                    </div>
                  </div>
                  {score ? (
                    <div className="font-display text-2xl tabular-nums px-2">
                      {score[0]}–{score[1]}
                    </div>
                  ) : (
                    <div
                      className="grid grid-cols-3 gap-1 w-[168px] shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {ONE_X_TWO.map(({ key, label }) => (
                        <OddsBtn
                          key={key}
                          label={label}
                          price={f.odds[key]}
                          edge={modelProbFor(f, key) - 1 / f.odds[key]}
                          active={onSlip?.market === key}
                          onClick={() => {
                            addLeg({ fixtureId: f.id, market: key, price: f.odds[key] });
                            select(f.id);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2 text-2xs">
                  <span className={cn("tabular-nums", signedClass(edgeHome))}>
                    H {fmtEdge(edgeHome)}
                  </span>
                  <span className="text-quiet">lean {selectionLabel(f, f.modelPick)}</span>
                  {onSlip ? <span className="ml-auto text-accent">on slip</span> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <header className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-border mt-2">
        <h2 className="eyebrow">GW3 settled</h2>
      </header>
      <ul>
        {settled.map((f) => (
          <li
            key={f.id}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-border text-sm"
          >
            <TeamMark team={f.home} withName={false} size="sm" />
            <span className="font-display tabular-nums text-quiet w-10 text-center">
              {f.score?.[0]}–{f.score?.[1]}
            </span>
            <TeamMark team={f.away} withName={false} size="sm" />
            <span className="truncate text-quiet text-xs ml-1">
              {TEAMS[f.home].short}–{TEAMS[f.away].short}
            </span>
            <span
              className={cn(
                "ml-auto text-2xs uppercase tracking-wider font-semibold",
                f.modelHit ? "text-up" : "text-down",
              )}
            >
              {f.modelHit ? "HIT" : "MISS"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TicketPanel() {
  const selectedId = useDesk((s) => s.selectedId);
  const f = getFixture(selectedId);
  const addLeg = useDesk((s) => s.addLeg);
  const slip = useDesk((s) => s.slip);
  const scores = useDesk((s) => s.scores);
  const simulate = useDesk((s) => s.simulate);
  const queueAsk = useDesk((s) => s.queueAsk);
  const router = useRouter();

  if (!f) return null;
  const score = scores[f.id] ?? f.score;
  const onSlip = slip.find((l) => l.fixtureId === f.id);
  const edge = bestEdge(f.id);

  return (
    <section className="border-b lg:border-b-0 lg:border-r border-border min-w-0 bg-surface">
      <div className="px-4 py-4 sm:px-5">
        <div className="flex items-center gap-2 text-2xs uppercase tracking-wider text-quiet">
          <span>{f.venue}</span>
          <span className="text-border-strong">·</span>
          <span>{fmtKickoff(f.kickoff)}</span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <KitPip team={f.home} size="lg" />
              <h2 className="font-display text-4xl uppercase tracking-wide leading-none">
                {TEAMS[f.home].short}
              </h2>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <KitPip team={f.away} size="lg" />
              <h2 className="font-display text-4xl uppercase tracking-wide leading-none text-quiet">
                {TEAMS[f.away].short}
              </h2>
            </div>
          </div>
          {score ? (
            <div className="font-display text-4xl tabular-nums">
              {score[0]}–{score[1]}
            </div>
          ) : (
            <Button size="sm" variant="subtle" onClick={() => simulate(f.id)}>
              Project score
            </Button>
          )}
        </div>

        <div className="mt-5">
          <ProbBar home={f.model.home} draw={f.model.draw} away={f.model.away} />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-1.5">
          {ONE_X_TWO.map(({ key, label }) => (
            <OddsBtn
              key={key}
              label={`${label} · ${key === "home" ? TEAMS[f.home].short : key === "away" ? TEAMS[f.away].short : "Draw"}`}
              price={f.odds[key]}
              edge={modelProbFor(f, key) - 1 / f.odds[key]}
              active={onSlip?.market === key}
              dim={!!score}
              onClick={() => addLeg({ fixtureId: f.id, market: key, price: f.odds[key] })}
            />
          ))}
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          {ALT.map(({ key, label }) => (
            <OddsBtn
              key={key}
              label={label}
              price={f.odds[key]}
              edge={modelProbFor(f, key) - 1 / f.odds[key]}
              active={onSlip?.market === key}
              dim={!!score}
              onClick={() => addLeg({ fixtureId: f.id, market: key, price: f.odds[key] })}
            />
          ))}
        </div>

        {edge ? (
          <p className="mt-4 text-sm text-quiet leading-relaxed">
            Widest gap vs the board is{" "}
            <span className="text-fg">{selectionLabel(f, edge.key)}</span> at {fmtOdds(edge.price)},{" "}
            <span className={signedClass(edge.edge)}>{fmtEdge(edge.edge)}</span> model vs implied.
          </p>
        ) : null}

        <Button
          className="mt-4 w-full"
          variant="ghost"
          onClick={() => {
            queueAsk(
              `Talk me through ${TEAMS[f.home].short} vs ${TEAMS[f.away].short} as football, not as a ticket.`,
            );
            router.push("/");
          }}
        >
          Ask Pundit about this match
        </Button>
      </div>
    </section>
  );
}

function SlipRail() {
  const slip = useDesk((s) => s.slip);
  const stake = useDesk((s) => s.slipStake);
  const setStake = useDesk((s) => s.setStake);
  const cash = useDesk((s) => s.cash);
  const place = useDesk((s) => s.placeSlip);
  const clear = useDesk((s) => s.clearSlip);
  const remove = useDesk((s) => s.removeLeg);
  const tickets = useDesk((s) => s.tickets);
  const [err, setErr] = useState<string | null>(null);

  const price = useMemo(() => accaPrice(slip.map((l) => l.price)), [slip]);
  const ret = stake * price;

  return (
    <aside id="slip" className="min-w-0 bg-bg">
      <header className="px-4 py-2 border-b border-border flex items-center justify-between">
        <h2 className="eyebrow">Paper slip</h2>
        {slip.length > 1 ? (
          <span className="font-display text-2xs text-accent">{slip.length}-fold</span>
        ) : null}
      </header>
      <div className="px-4 py-3">
        {slip.length === 0 ? (
          <p className="text-sm text-quiet">
            Tap a price to build a simulated ticket. Paper credit only — no real money, no payouts.
          </p>
        ) : (
          <ul className="space-y-2">
            {slip.map((l) => {
              const f = getFixture(l.fixtureId);
              if (!f) return null;
              return (
                <li
                  key={`${l.fixtureId}-${l.market}`}
                  className="flex items-start gap-2 rounded-sm border border-border bg-elevated p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{selectionLabel(f, l.market)}</div>
                    <div className="text-2xs text-quiet">
                      {TEAMS[f.home].short} vs {TEAMS[f.away].short} · {MARKET_LABEL[l.market]}
                    </div>
                  </div>
                  <span className="tabular-nums text-sm">{fmtOdds(l.price)}</span>
                  <button
                    type="button"
                    className="text-quiet hover:text-fg p-1"
                    onClick={() => remove(l.fixtureId, l.market)}
                    aria-label="Remove"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <label className="mt-4 block">
          <span className="text-2xs uppercase tracking-wider text-quiet">Stake (paper)</span>
          <input
            type="number"
            min={10}
            max={cash}
            value={stake}
            onChange={(e) => setStake(Number(e.target.value))}
            className="mt-1 h-10 w-full rounded-sm border border-border bg-elevated px-3 tabular-nums text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </label>
        <div className="mt-2 flex justify-between text-sm">
          <span className="text-quiet">To return</span>
          <span className="tabular-nums">{slip.length ? fmtMoney(ret) : "—"}</span>
        </div>
        {err ? <p className="mt-2 text-xs text-down">{err}</p> : null}
        <div className="mt-3 flex gap-2">
          <Button
            className="flex-1"
            variant="primary"
            disabled={slip.length === 0}
            onClick={() => setErr(place())}
          >
            Place paper ticket
          </Button>
          <Button variant="ghost" onClick={clear} disabled={slip.length === 0}>
            Clear
          </Button>
        </div>
      </div>

      <header className="px-4 py-2 border-y border-border flex items-center justify-between mt-2">
        <h2 className="eyebrow">Positions</h2>
        <span className="text-2xs text-subtle tabular-nums">{tickets.length}</span>
      </header>
      <ul className="max-h-80 overflow-auto">
        {tickets.length === 0 ? (
          <li className="px-4 py-3 text-sm text-quiet">No paper tickets yet.</li>
        ) : (
          tickets.map((t) => (
            <li key={t.id} className="px-4 py-2.5 border-b border-border text-sm">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-2xs uppercase tracking-wider",
                    t.status === "open" ? "text-accent" : t.status === "won" ? "text-up" : "text-down",
                  )}
                >
                  {t.status}
                </span>
                <span className="tabular-nums ml-auto">
                  {t.legs.length > 1 ? `${t.legs.length}× ` : ""}
                  {fmtOdds(t.price)}
                </span>
              </div>
              <div className="text-quiet text-xs truncate mt-0.5">
                {t.legs
                  .map((l) => {
                    const f = getFixture(l.fixtureId);
                    return f ? selectionLabel(f, l.market) : l.market;
                  })
                  .join(" · ")}
              </div>
              <div className="flex justify-between mt-1 tabular-nums text-xs">
                <span className="text-subtle">stk {fmtMoney(t.stake)}</span>
                <span className={t.status === "open" ? "text-quiet" : t.pnl >= 0 ? "text-up" : "text-down"}>
                  {t.status === "open"
                    ? `to ${fmtMoney(t.stake * t.price)}`
                    : `${t.pnl >= 0 ? "+" : ""}${fmtMoney(t.pnl)}`}
                </span>
              </div>
            </li>
          ))
        )}
      </ul>
      <p className="px-4 py-3 text-2xs text-subtle leading-relaxed">
        Simulated book. No real money, no payouts. Prices are a model desk, not a sportsbook.
      </p>
    </aside>
  );
}
