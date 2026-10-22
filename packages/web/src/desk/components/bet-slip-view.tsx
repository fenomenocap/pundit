"use client";

import { useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { MARKET_LABEL, getFixture, type Fixture, type MarketKey } from "@/desk/lib/data/fixtures";
import { TEAMS } from "@/desk/lib/data/teams";
import { fmtKickoff, fmtMoney, fmtOdds } from "@/desk/lib/format";
import { useDesk } from "@/desk/lib/store";
import { useBetSlip, type BetSelection } from "@/desk/lib/bet-slip-store";
import {
  accumulatorName,
  accumulatorReturns,
  parseStake,
  singlesReturns,
} from "@/desk/lib/bet-slip";
import { cn } from "@/lib/utils";
import { KitPip } from "./kit";
import { OddsBtn } from "./odds-btn";
import { Button } from "./ui/button";
import { useLiveSlate } from "./use-live-slate";

const MARKETS: { key: MarketKey; label: string }[] = [
  { key: "home", label: "1" },
  { key: "draw", label: "X" },
  { key: "away", label: "2" },
  { key: "over25", label: "Over 2.5" },
  { key: "under25", label: "Under 2.5" },
  { key: "bttsY", label: "BTTS Yes" },
  { key: "bttsN", label: "BTTS No" },
];

function priceOf(f: Fixture | undefined, market: MarketKey): number | null {
  const p = f?.odds?.[market];
  return typeof p === "number" && Number.isFinite(p) && p > 1 ? p : null;
}

export function selectionName(f: Fixture, market: MarketKey) {
  const home = TEAMS[f.home].name;
  const away = TEAMS[f.away].name;
  if (market === "home") return `${home} to win`;
  if (market === "away") return `${away} to win`;
  if (market === "draw") return "Draw";
  return MARKET_LABEL[market];
}

export function BetSlipView() {
  return (
    <div data-testid="bet-slip-page" className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-6">
      <header className="mb-5">
        <p className="eyebrow">Bet slip</p>
        <h1 className="font-display text-4xl uppercase tracking-wide mt-1">Bet slip calculator</h1>
        <p className="mt-2 max-w-2xl text-sm text-quiet leading-relaxed">
          Add selections from the current Premier League fixtures to see combined odds and potential returns.
          This is a calculator only: no bets are placed and no money is held.
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)]">
        <FixtureMarkets />
        <Slip />
      </div>
    </div>
  );
}

function FixtureMarkets() {
  const { open, source, epoch } = useLiveSlate();
  const selectedId = useDesk((s) => s.selectedId);
  const select = useDesk((s) => s.selectFixture);
  const selections = useBetSlip((s) => s.selections);
  const toggle = useBetSlip((s) => s.toggle);
  const reconcile = useBetSlip((s) => s.reconcile);

  // Re-price or drop saved selections whenever the live slate refreshes.
  useEffect(() => {
    if (source === "pending") return;
    reconcile((fixtureId, market) => {
      const f = getFixture(fixtureId);
      return f && f.status === "upcoming" ? priceOf(f, market as MarketKey) : null;
    });
  }, [epoch, source, reconcile]);

  return (
    <section className="min-w-0 rounded-md border border-border bg-surface">
      <header className="flex items-center justify-between px-4 py-2 border-b border-border">
        <h2 className="eyebrow">Current fixtures</h2>
        <span className="text-2xs text-subtle tabular-nums">{open.length} listed</span>
      </header>
      {source === "pending" ? <p className="px-4 py-4 text-sm text-quiet">Loading fixtures…</p> : null}
      {source === "unavailable" ? (
        <p className="px-4 py-4 text-sm text-quiet">Fixtures are unavailable right now. Please try again shortly.</p>
      ) : null}
      {source === "no-fixtures" ? (
        <p className="px-4 py-4 text-sm text-quiet">No priced fixtures are live right now.</p>
      ) : null}
      <ul>
        {open.map((f) => {
          const active = f.id === selectedId;
          const priced = MARKETS.filter((m) => priceOf(f, m.key) !== null);
          return (
            <li key={f.id} className={cn("border-b border-border last:border-b-0 px-4 py-3", active && "bg-panel")}>
              <div className="flex items-center gap-2 text-2xs uppercase tracking-wide text-quiet">
                <span>{fmtKickoff(f.kickoff)}</span>
                {f.xg ? (
                  <span className="ml-auto tabular-nums">
                    xG {f.xg[0].toFixed(2)}–{f.xg[1].toFixed(2)}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                aria-label={`Select ${TEAMS[f.home].name} vs ${TEAMS[f.away].name}`}
                aria-pressed={active}
                onClick={() => select(f.id)}
                className="mt-1.5 w-full text-left rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="flex items-center gap-2">
                  <KitPip team={f.home} />
                  <span className="font-medium truncate">{TEAMS[f.home].name}</span>
                  <span className="text-quiet text-xs">v</span>
                  <KitPip team={f.away} />
                  <span className="font-medium truncate">{TEAMS[f.away].name}</span>
                </span>
              </button>
              {priced.length > 0 ? (
                <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-1.5" data-testid="bet-slip-markets">
                  {priced.map(({ key, label }) => {
                    const price = priceOf(f, key)!;
                    const on = selections.some((s) => s.fixtureId === f.id && s.market === key);
                    return (
                      <OddsBtn
                        key={key}
                        label={label}
                        price={price}
                        active={on}
                        onClick={() => {
                          toggle({ fixtureId: f.id, market: key, price });
                          select(f.id);
                        }}
                      />
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 text-xs text-quiet">No comparison market</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Slip() {
  const selections = useBetSlip((s) => s.selections);
  const stakeText = useBetSlip((s) => s.stakeText);
  const setStakeText = useBetSlip((s) => s.setStakeText);
  const mode = useBetSlip((s) => s.mode);
  const setMode = useBetSlip((s) => s.setMode);
  const remove = useBetSlip((s) => s.remove);
  const clear = useBetSlip((s) => s.clear);
  useLiveSlate(); // re-render when the slate refreshes

  const stake = parseStake(stakeText);
  const singles = useMemo(
    () => (stake.ok ? singlesReturns(selections, stake.value) : null),
    [selections, stake.ok, stake.value],
  );
  const acca = useMemo(
    () => accumulatorReturns(selections, stake.ok ? stake.value : 0),
    [selections, stake.ok, stake.value],
  );
  const accaMode = mode === "accumulator";

  return (
    <aside id="slip" className="min-w-0 rounded-md border border-border bg-bg self-start lg:sticky lg:top-16" aria-label="Bet slip">
      <header className="flex items-center justify-between px-4 py-2 border-b border-border">
        <h2 className="eyebrow">Your slip</h2>
        <span className="text-2xs text-subtle tabular-nums" data-testid="bet-slip-count">
          {selections.length} selection{selections.length === 1 ? "" : "s"}
        </span>
      </header>
      <div className="px-4 py-3">
        <div role="tablist" aria-label="Bet type" className="grid grid-cols-2 gap-1 rounded-sm border border-border p-0.5">
          {(["singles", "accumulator"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "h-8 rounded-xs text-xs font-medium transition-colors",
                mode === m ? "bg-elevated text-fg" : "text-quiet hover:text-fg",
              )}
            >
              {m === "singles" ? "Singles" : "Accumulator"}
            </button>
          ))}
        </div>

        {selections.length === 0 ? (
          <p className="mt-3 text-sm text-quiet">Select a price to add it to your slip.</p>
        ) : (
          <ul className="mt-3 space-y-2" data-testid="bet-slip-selections">
            {selections.map((s) => (
              <SelectionRow
                key={`${s.fixtureId}-${s.market}`}
                selection={s}
                returns={!accaMode && singles ? singles.legs.find((l) => l.fixtureId === s.fixtureId && l.market === s.market)?.returns ?? null : null}
                onRemove={() => remove(s.fixtureId, s.market)}
              />
            ))}
          </ul>
        )}

        <label className="mt-4 block">
          <span className="text-2xs uppercase tracking-wider text-quiet">
            {accaMode ? "Stake" : "Stake per selection"}
          </span>
          <input
            type="text"
            inputMode="decimal"
            aria-label={accaMode ? "Stake" : "Stake per selection"}
            value={stakeText}
            onChange={(e) => setStakeText(e.target.value)}
            className="mt-1 h-10 w-full rounded-sm border border-border bg-elevated px-3 tabular-nums text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </label>
        {!stake.ok && stake.message ? (
          <p role="alert" data-testid="bet-slip-stake-error" className="mt-1.5 text-xs text-down">{stake.message}</p>
        ) : null}

        <dl className="mt-3 space-y-1.5 text-sm" data-testid="bet-slip-summary">
          {accaMode ? (
            acca.ok ? (
              <>
                <Row label="Bet type" value={accumulatorName(acca.legs)} />
                <Row label="Combined odds" value={fmtOdds(acca.odds)} testId="bet-slip-combined-odds" />
                <Row label="Total stake" value={stake.ok ? fmtMoney(acca.stake) : "—"} />
                <Row label="Potential return" value={stake.ok ? fmtMoney(acca.returns) : "—"} strong testId="bet-slip-return" />
                <Row label="Potential profit" value={stake.ok ? fmtMoney(acca.profit) : "—"} />
              </>
            ) : (
              <p className="text-xs text-quiet" data-testid="bet-slip-acca-note">{acca.reason}</p>
            )
          ) : (
            <>
              <Row label="Bets" value={`${selections.length} single${selections.length === 1 ? "" : "s"}`} />
              <Row label="Total stake" value={singles && selections.length ? fmtMoney(singles.totalStake) : "—"} />
              <Row
                label="Potential return (all win)"
                value={singles && selections.length ? fmtMoney(singles.maxReturn) : "—"}
                strong
                testId="bet-slip-return"
              />
              <Row label="Potential profit (all win)" value={singles && selections.length ? fmtMoney(singles.maxProfit) : "—"} />
            </>
          )}
        </dl>

        <div className="mt-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={clear} disabled={selections.length === 0}>
            Clear slip
          </Button>
        </div>
      </div>
      <details className="border-t border-border px-4 py-3 text-xs text-quiet group">
        <summary className="cursor-pointer select-none text-2xs uppercase tracking-wider">Sources and method</summary>
        <div className="mt-2 space-y-2 leading-relaxed">
          <p>
            Prices are the decimal reference prices shown on this site, taken from public prediction-market
            quotes with the margin removed. They are not bookmaker offers; your bookmaker&apos;s prices will differ.
          </p>
          <p>
            Return = stake × decimal price. An accumulator multiplies the prices of every selection and needs all of them
            to win. Selections from the same match cannot be combined, because their results are linked.
            Returns are rounded to two decimal places.
          </p>
          <p>Prices refresh with the fixture list. A selection is removed if its match or price is no longer listed.</p>
        </div>
      </details>
      <p className="border-t border-border px-4 py-3 text-2xs text-subtle leading-relaxed">
        For information only. Not betting advice. Gamble responsibly.
      </p>
    </aside>
  );
}

function SelectionRow({ selection, returns, onRemove }: { selection: BetSelection; returns: number | null; onRemove: () => void }) {
  const f = getFixture(selection.fixtureId);
  if (!f) return null;
  return (
    <li className="flex items-start gap-2 rounded-sm border border-border bg-elevated p-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{selectionName(f, selection.market)}</div>
        <div className="text-2xs text-quiet truncate">
          {TEAMS[f.home].name} v {TEAMS[f.away].name} · {MARKET_LABEL[selection.market]}
        </div>
        {returns !== null ? (
          <div className="text-2xs text-quiet tabular-nums mt-0.5">Returns {fmtMoney(returns)}</div>
        ) : null}
      </div>
      <span className="tabular-nums text-sm">{fmtOdds(selection.price)}</span>
      <button
        type="button"
        className="text-quiet hover:text-fg p-1"
        onClick={onRemove}
        aria-label={`Remove ${selectionName(f, selection.market)}`}
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}

function Row({ label, value, strong, testId }: { label: string; value: string; strong?: boolean; testId?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-quiet">{label}</dt>
      <dd data-testid={testId} className={cn("tabular-nums", strong && "font-semibold text-fg")}>{value}</dd>
    </div>
  );
}
