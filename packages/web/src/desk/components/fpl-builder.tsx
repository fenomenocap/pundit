"use client";

import { DeskPageHeader } from "@/components/desk-page";
import { ClubCrest } from "@/desk/components/kit";
import { formalTeamName } from "@/desk/lib/data/teams";
import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import {
  BUDGET,
  POSITIONS,
  SQUAD_QUOTA,
  SQUAD_SIZE,
  XI_SIZE,
  addBlocker,
  addPlayer,
  countByPos,
  lookupFrom,
  reconcileSquad,
  removePlayer,
  setCaptain,
  setVice,
  squadSpend,
  toggleStarter,
  validateSquad,
  type Pos,
} from "@/desk/lib/fpl-squad";
import { STATUS_LABEL, type FplPayload, type FplPlayerRow } from "@/desk/lib/fpl-data";
import { useFplSquad } from "@/desk/lib/fpl-store";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: FplPayload };

const POS_LABEL: Record<Pos, string> = { GK: "Goalkeepers", DEF: "Defenders", MID: "Midfielders", FWD: "Forwards" };
type SortKey = "price" | "points" | "name";

function fmtPrice(p: number | null) {
  return p === null ? "Not available" : `£${p.toFixed(1)}m`;
}

function flagged(p: FplPlayerRow) {
  return (p.status !== null && p.status !== "a") || (p.chanceNextRound !== null && p.chanceNextRound < 75);
}

export function FplBuilder() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/fpl")
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok || !body || !Array.isArray(body.players)) {
          throw new Error(body?.error ?? "Player data is unavailable.");
        }
        return body as FplPayload;
      })
      .then((data) => !cancelled && setLoad({ state: "ready", data }))
      .catch((e: unknown) => !cancelled && setLoad({ state: "error", message: e instanceof Error ? e.message : "Player data is unavailable." }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div data-testid="fpl-builder-page">
      <DeskPageHeader
        eyebrow="Fantasy Premier League · simulator"
        title="FPL team builder"
        subtitle={<>
          Pick a {SQUAD_SIZE}-player squad (2 goalkeepers, 5 defenders, 5 midfielders, 3 forwards) within a £{BUDGET.toFixed(1)}m budget,
          with no more than 3 players from one club. Then choose your starting XI, captain and vice-captain.
          Your squad is saved in this browser.
          <span data-testid="fpl-data-attribution" className="mt-1 block text-2xs text-subtle">
            Simulator only. Player data from Fantasy Premier League (public). Not affiliated with the Premier League.
          </span>
        </>}
      />
      <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6">
      {load.state === "loading" ? <p className="text-sm text-quiet">Loading players…</p> : null}
      {load.state === "error" ? (
        <p role="alert" className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-quiet">
          Player data could not be loaded ({load.message}). Your saved squad is kept and will show again when the data is back.
        </p>
      ) : null}
      {load.state === "ready" ? <Builder data={load.data} /> : null}
      </div>
    </div>
  );
}

function Builder({ data }: { data: FplPayload }) {
  const squad = useFplSquad((s) => s.squad);
  const setSquad = useFplSquad((s) => s.setSquad);
  const reset = useFplSquad((s) => s.reset);
  const get = useMemo(() => lookupFrom(data.players), [data.players]);
  const byId = useMemo(() => new Map(data.players.map((p) => [p.id, p])), [data.players]);
  const [pos, setPos] = useState<Pos | "ALL">("ALL");
  const [club, setClub] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [maxPrice, setMaxPrice] = useState<string>("");
  const [sort, setSort] = useState<SortKey>("price");
  const [message, setMessage] = useState<string | null>(null);

  // Drop saved players the current data no longer lists.
  useEffect(() => {
    const next = reconcileSquad(squad, get);
    if (next.picks.length !== squad.picks.length || next.captain !== squad.captain || next.vice !== squad.vice) setSquad(next);
  }, [get, squad, setSquad]);

  const unpricedInSource = data.players.filter((p) => p.price === null).length;
  const spend = squadSpend(squad.picks, get);
  const checks = validateSquad(squad, get);
  const complete = checks.every((c) => c.ok);
  const posCount = countByPos(squad.picks, get);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cap = maxPrice === "" ? null : Number(maxPrice);
    const rows = data.players.filter(
      (p) =>
        (pos === "ALL" || p.pos === pos) &&
        (club === "ALL" || p.club === club) &&
        (!q || p.name.toLowerCase().includes(q)) &&
        (cap === null || (p.price !== null && p.price <= cap)),
    );
    rows.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "points") return (b.totalPoints ?? -1) - (a.totalPoints ?? -1);
      return (b.price ?? -1) - (a.price ?? -1);
    });
    return rows.slice(0, 200);
  }, [data.players, pos, club, query, maxPrice, sort]);

  const add = (p: FplPlayerRow) => {
    const why = addBlocker(squad, p, get);
    if (why) {
      setMessage(why);
      return;
    }
    setMessage(null);
    setSquad(addPlayer(squad, p, get));
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,1fr)]">
      <section className="min-w-0 rounded-md border border-border bg-surface" aria-label="Player list">
        <header className="flex flex-wrap items-end gap-2 px-4 py-3 border-b border-border">
          <label className="flex flex-col text-2xs uppercase tracking-wider text-quiet">
            Position
            <select aria-label="Position" value={pos} onChange={(e) => setPos(e.target.value as Pos | "ALL")} className="mt-1 h-9 rounded-sm border border-border bg-elevated px-2 text-sm normal-case tracking-normal text-fg">
              <option value="ALL">All</option>
              {POSITIONS.map((p) => <option key={p} value={p}>{POS_LABEL[p]}</option>)}
            </select>
          </label>
          <label className="flex flex-col text-2xs uppercase tracking-wider text-quiet">
            Club
            <select aria-label="Club" value={club} onChange={(e) => setClub(e.target.value)} className="mt-1 h-9 rounded-sm border border-border bg-elevated px-2 text-sm normal-case tracking-normal text-fg">
              <option value="ALL">All clubs</option>
              {[...data.clubs].sort((a, b) => formalTeamName(a.name).localeCompare(formalTeamName(b.name))).map((c) => <option key={c.code} value={c.code}>{formalTeamName(c.name)}</option>)}
            </select>
          </label>
          <label className="flex flex-col text-2xs uppercase tracking-wider text-quiet">
            Max price (£m)
            <input aria-label="Max price" inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value.replace(/[^\d.]/g, ""))} className="mt-1 h-9 w-24 rounded-sm border border-border bg-elevated px-2 text-sm tabular-nums text-fg" />
          </label>
          <label className="flex flex-col text-2xs uppercase tracking-wider text-quiet">
            Sort
            <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="mt-1 h-9 rounded-sm border border-border bg-elevated px-2 text-sm normal-case tracking-normal text-fg">
              <option value="price">Price</option>
              <option value="points">Total points</option>
              <option value="name">Name</option>
            </select>
          </label>
          <label className="flex flex-col flex-1 min-w-[8rem] text-2xs uppercase tracking-wider text-quiet">
            Search
            <input aria-label="Search players" value={query} onChange={(e) => setQuery(e.target.value)} className="mt-1 h-9 rounded-sm border border-border bg-elevated px-2 text-sm text-fg" />
          </label>
        </header>
        {message ? <p role="alert" className="px-4 py-2 text-xs text-down border-b border-border" data-testid="fpl-add-message">{message}</p> : null}
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-2xs uppercase tracking-wider text-quiet">
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-left font-medium">Player</th>
                <th className="px-2 py-2 text-left font-medium">Pos</th>
                <th className="px-2 py-2 text-right font-medium">Price</th>
                <th className="px-2 py-2 text-right font-medium">Points</th>
                <th className="px-4 py-2 text-right font-medium"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const inSquad = squad.picks.includes(p.id);
                const blocked = !inSquad && addBlocker(squad, p, get) !== null;
                return (
                  <tr key={p.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2">
                      <div className="font-medium">{p.name}</div>
                      <div className="flex items-center gap-1.5 text-2xs text-quiet">
                        <ClubCrest name={p.clubName} size="sm" />
                        {formalTeamName(p.clubName)}
                        {flagged(p) ? (
                          <span className="ml-1.5 text-down">
                            · {p.status ? STATUS_LABEL[p.status] ?? p.status : "Flagged"}
                            {p.chanceNextRound !== null ? ` (${p.chanceNextRound}% chance next round)` : ""}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-quiet">{p.pos}</td>
                    <td className={cn("px-2 py-2 text-right tabular-nums", p.price === null && "text-quiet text-xs")}>{fmtPrice(p.price)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{p.totalPoints ?? "—"}</td>
                    <td className="px-4 py-2 text-right">
                      {inSquad ? (
                        <Button size="sm" variant="ghost" aria-label={`Remove ${p.name}`} onClick={() => setSquad(removePlayer(squad, p.id))}>Remove</Button>
                      ) : (
                        <Button size="sm" variant="subtle" aria-label={`Add ${p.name}`} title={blocked ? addBlocker(squad, p, get) ?? undefined : undefined} className={cn(blocked && "opacity-40")} onClick={() => add(p)}>Add</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-4 text-sm text-quiet">No players match these filters.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="min-w-0 space-y-4 self-start" aria-label="Your squad">
        <section className="rounded-md border border-border bg-bg">
          <header className="flex items-center justify-between px-4 py-2 border-b border-border">
            <h2 className="eyebrow">Your squad</h2>
            <span className="text-2xs text-subtle tabular-nums" data-testid="fpl-squad-count">{squad.picks.length} / {SQUAD_SIZE}</span>
          </header>
          <dl className="grid grid-cols-3 gap-2 px-4 py-3 text-sm">
            <div><dt className="text-2xs uppercase tracking-wider text-quiet">Spent</dt><dd className="tabular-nums" data-testid="fpl-spent">£{spend.spent.toFixed(1)}m</dd></div>
            <div><dt className="text-2xs uppercase tracking-wider text-quiet">In the bank</dt><dd className={cn("tabular-nums", spend.remaining < 0 && "text-down")} data-testid="fpl-bank">£{spend.remaining.toFixed(1)}m</dd></div>
            <div><dt className="text-2xs uppercase tracking-wider text-quiet">Starting XI</dt><dd className="tabular-nums">{squad.starters.length} / {XI_SIZE}</dd></div>
          </dl>
          {POSITIONS.map((p) => {
            const ids = squad.picks.filter((id) => byId.get(id)?.pos === p);
            return (
              <div key={p} className="border-t border-border px-4 py-2">
                <div className="flex justify-between text-2xs uppercase tracking-wider text-quiet">
                  <span>{POS_LABEL[p]}</span>
                  <span className="tabular-nums">{posCount[p]} / {SQUAD_QUOTA[p]}</span>
                </div>
                <ul className="mt-1 space-y-1">
                  {ids.map((id) => {
                    const pl = byId.get(id)!;
                    const starting = squad.starters.includes(id);
                    return (
                      <li key={id} className="flex items-center gap-2 text-sm" data-testid="fpl-squad-player">
                        <ClubCrest name={pl.clubName} size="sm" />
                        <span className={cn("min-w-0 flex-1 truncate", !starting && "text-quiet")}>
                          {pl.name}
                          {squad.captain === id ? <span className="ml-1 text-2xs font-semibold text-accent">(C)</span> : null}
                          {squad.vice === id ? <span className="ml-1 text-2xs font-semibold text-quiet">(V)</span> : null}
                          <span className="ml-1 text-2xs text-subtle">{pl.club}</span>
                        </span>
                        <span className="tabular-nums text-xs text-quiet">{pl.price === null ? "n/a" : pl.price.toFixed(1)}</span>
                        <button
                          type="button"
                          aria-pressed={starting}
                          aria-label={`${starting ? "Bench" : "Start"} ${pl.name}`}
                          onClick={() => {
                            const r = toggleStarter(squad, id, get);
                            setMessage(r.message);
                            setSquad(r.squad);
                          }}
                          className={cn("rounded-xs border px-1.5 py-0.5 text-2xs", starting ? "border-accent text-fg" : "border-border text-quiet")}
                        >
                          {starting ? "Starting" : "Bench"}
                        </button>
                        <button type="button" aria-label={`Make ${pl.name} captain`} disabled={!starting} onClick={() => setSquad(setCaptain(squad, id))} className={cn("rounded-xs border px-1.5 py-0.5 text-2xs disabled:opacity-30", squad.captain === id ? "border-accent text-accent" : "border-border text-quiet")}>C</button>
                        <button type="button" aria-label={`Make ${pl.name} vice-captain`} disabled={!starting} onClick={() => setSquad(setVice(squad, id))} className={cn("rounded-xs border px-1.5 py-0.5 text-2xs disabled:opacity-30", squad.vice === id ? "border-fg text-fg" : "border-border text-quiet")}>V</button>
                        <button type="button" aria-label={`Remove ${pl.name} from squad`} onClick={() => setSquad(removePlayer(squad, id))} className="p-0.5 text-quiet hover:text-fg"><X className="size-3.5" /></button>
                      </li>
                    );
                  })}
                  {ids.length === 0 ? <li className="text-xs text-subtle">None selected</li> : null}
                </ul>
              </div>
            );
          })}
          <div className="border-t border-border px-4 py-3 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => { reset(); setMessage(null); }} disabled={squad.picks.length === 0}>Clear squad</Button>
          </div>
        </section>

        <section className="rounded-md border border-border bg-bg" aria-label="Squad checks">
          <header className="flex items-center justify-between px-4 py-2 border-b border-border">
            <h2 className="eyebrow">Squad checks</h2>
            <span className={cn("text-2xs font-semibold uppercase tracking-wider", complete ? "text-up" : "text-quiet")} data-testid="fpl-status">
              {complete ? "Squad valid" : "Incomplete"}
            </span>
          </header>
          <ul className="px-4 py-3 space-y-1.5 text-sm" data-testid="fpl-checks">
            {checks.map((c) => (
              <li key={c.message} className="flex items-start gap-2">
                {c.ok ? <Check className="mt-0.5 size-3.5 text-up shrink-0" aria-label="Met" /> : <X className="mt-0.5 size-3.5 text-down shrink-0" aria-label="Not met" />}
                <span className={c.ok ? "text-fg" : "text-quiet"}>{c.message}</span>
              </li>
            ))}
          </ul>
        </section>

        <details className="rounded-md border border-border bg-bg px-4 py-3 text-xs text-quiet">
          <summary className="cursor-pointer select-none text-2xs uppercase tracking-wider">Sources and method</summary>
          <div className="mt-2 space-y-2 leading-relaxed">
            <p>
              Players, clubs, positions, prices, availability and points come from the public Fantasy Premier League
              game data, refreshed at most hourly. Last loaded {new Date(data.fetchedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
              {data.gameweek !== null ? `, for gameweek ${data.gameweek}` : ""}.
            </p>
            <p>
              Prices are shown exactly as published. Where a price is missing it is shown as &quot;Not available&quot; and is never estimated;
              {unpricedInSource > 0 ? ` ${unpricedInSource} player${unpricedInSource === 1 ? " is" : "s are"} currently unpriced.` : " every listed player currently has a price."}
            </p>
            <p>
              Rules: {SQUAD_SIZE} players (2 GK, 5 DEF, 5 MID, 3 FWD), £{BUDGET.toFixed(1)}m budget, at most 3 per club; starting XI of 11 with
              1 goalkeeper, 3–5 defenders, 2–5 midfielders and 1–3 forwards; captain and vice-captain from the XI.
              This builder is independent and not affiliated with the Premier League or Fantasy Premier League.
            </p>
          </div>
        </details>
      </aside>
    </div>
  );
}
