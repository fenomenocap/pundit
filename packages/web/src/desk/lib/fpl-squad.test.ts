import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPTY_SQUAD,
  addBlocker,
  addPlayer,
  canStart,
  isSquadComplete,
  lookupFrom,
  reconcileSquad,
  removePlayer,
  setCaptain,
  setVice,
  squadSpend,
  toggleStarter,
  validateSquad,
  type FplPlayer,
  type Pos,
  type Squad,
} from "./fpl-squad.ts";

// Synthetic test players. Prices are test inputs only.
let nextId = 1;
function mk(pos: Pos, club: string, price: number | null = 5): FplPlayer {
  const id = nextId++;
  return { id, name: `P${id}`, club, pos, price };
}
const clubs = ["A", "B", "C", "D", "E", "F", "G", "H"];
const pool: FplPlayer[] = [];
const byPos = (pos: Pos, n: number, price = 5) => {
  for (let i = 0; i < n; i++) pool.push(mk(pos, clubs[pool.length % clubs.length], price));
};
byPos("GK", 3, 4.5);
byPos("DEF", 7, 5);
byPos("MID", 7, 7);
byPos("FWD", 4, 7.5);
const get = lookupFrom(pool);
const of = (pos: Pos) => pool.filter((p) => p.pos === pos);

function fullSquad(): Squad {
  let s: Squad = EMPTY_SQUAD;
  for (const p of [...of("GK").slice(0, 2), ...of("DEF").slice(0, 5), ...of("MID").slice(0, 5), ...of("FWD").slice(0, 3)]) {
    s = addPlayer(s, p, get);
  }
  return s;
}

describe("FPL squad rules", () => {
  it("builds a legal 15 with an auto-filled valid XI", () => {
    const s = fullSquad();
    assert.equal(s.picks.length, 15);
    assert.equal(s.starters.length, 11);
    // 2*4.5 + 5*5 + 5*7 + 3*7.5 = 91.5
    assert.deepEqual(squadSpend(s.picks, get), { spent: 91.5, remaining: 8.5, unpriced: 0 });
    const checks = validateSquad(s, get);
    assert.equal(checks.filter((c) => !c.ok).length, 2); // captain + vice
    let done = setCaptain(s, s.starters[5]);
    done = setVice(done, s.starters[6]);
    assert.equal(isSquadComplete(done, get), true);
  });

  it("enforces position quotas", () => {
    let s: Squad = EMPTY_SQUAD;
    s = addPlayer(s, of("GK")[0], get);
    s = addPlayer(s, of("GK")[1], get);
    assert.match(addBlocker(s, of("GK")[2], get)!, /already have 2 goalkeepers/);
    assert.equal(addPlayer(s, of("GK")[2], get).picks.length, 2);
  });

  it("enforces max three per club", () => {
    const local = [mk("MID", "X", 5), mk("MID", "X", 5), mk("FWD", "X", 5), mk("DEF", "X", 5)];
    const g = lookupFrom(local);
    let s: Squad = EMPTY_SQUAD;
    for (const p of local.slice(0, 3)) s = addPlayer(s, p, g);
    assert.match(addBlocker(s, local[3], g)!, /3 players from X/);
  });

  it("enforces the 100.0m budget with exact tenths", () => {
    const pricey = [mk("FWD", "P", 15), mk("FWD", "Q", 15), mk("MID", "R", 14.5), mk("MID", "S", 13), mk("MID", "T", 12.5), mk("DEF", "U", 15.1), mk("DEF", "V", 15)];
    const g = lookupFrom(pricey);
    let s: Squad = EMPTY_SQUAD;
    for (const p of pricey.slice(0, 5)) s = addPlayer(s, p, g);
    assert.deepEqual(squadSpend(s.picks, g), { spent: 70, remaining: 30, unpriced: 0 });
    s = addPlayer(s, pricey[6], g); // 15.0 -> 85.0
    assert.match(addBlocker(s, pricey[5], g)!, /costs £15.1m; you have £15.0m left/);
    const exact = mk("DEF", "W", 15);
    assert.equal(addBlocker(s, exact, lookupFrom([...pricey, exact])), null); // exactly 100.0m is allowed
  });

  it("never values a missing price and flags the budget as unverified", () => {
    const local = [mk("GK", "A", null), mk("GK", "B", 4)];
    const g = lookupFrom(local);
    let s: Squad = EMPTY_SQUAD;
    for (const p of local) s = addPlayer(s, p, g);
    assert.deepEqual(squadSpend(s.picks, g), { spent: 4, remaining: 96, unpriced: 1 });
    const budget = validateSquad(s, g).find((c) => c.message.startsWith("Budget"))!;
    assert.equal(budget.ok, false);
    assert.match(budget.message, /cannot be verified: 1 selected player has no price/);
  });

  it("blocks a 16th player and duplicates", () => {
    const s = fullSquad();
    assert.match(addBlocker(s, of("MID")[6], get)!, /already has 15/);
    assert.match(addBlocker(addPlayer(EMPTY_SQUAD, pool[0], get), pool[0], get)!, /already in your squad/);
  });

  it("keeps the XI formation legal", () => {
    const s = fullSquad();
    const xiGks = s.starters.filter((id) => get(id)!.pos === "GK");
    assert.equal(xiGks.length, 1);
    const benchGk = s.picks.find((id) => get(id)!.pos === "GK" && !s.starters.includes(id))!;
    const r = toggleStarter(s, benchGk, get);
    assert.match(r.message!, /XI is full/);
    // Bench a GK then start the other: allowed.
    const benched = toggleStarter(s, xiGks[0], get).squad;
    assert.equal(benched.starters.length, 10);
    assert.equal(toggleStarter(benched, benchGk, get).message, null);
    // Two GKs in an XI of 10 is never allowed.
    const twoGk = toggleStarter(toggleStarter(s, s.starters.find((id) => get(id)!.pos === "MID")!, get).squad, benchGk, get);
    assert.match(twoGk.message!, /formation limits/);
  });

  it("reserves room for formation minimums", () => {
    const ids = [...of("MID").slice(0, 5), ...of("FWD").slice(0, 3), ...of("DEF").slice(0, 2)].map((p) => p.id);
    assert.equal(ids.length, 10);
    // 10 starters with 2 DEF and no GK: one slot left, but both a GK and a 3rd DEF are still needed.
    assert.equal(canStart(ids, of("DEF")[2], get), false);
    assert.equal(canStart(ids, of("GK")[0], get), false);
    // With 3 DEF and no GK, only a GK may take the last slot.
    const nine = [...ids.slice(0, 4), ...ids.slice(5)]; // 4 MID, 3 FWD, 2 DEF
    const withDef = [...nine, of("DEF")[2].id]; // 10: 4 MID, 3 FWD, 3 DEF
    assert.equal(canStart(withDef, of("GK")[0], get), true);
    assert.equal(canStart(withDef, of("MID")[5], get), false);
  });

  it("captain and vice must be distinct starters", () => {
    const s = fullSquad();
    const bench = s.picks.find((id) => !s.starters.includes(id))!;
    assert.equal(setCaptain(s, bench).captain, null);
    let t = setCaptain(s, s.starters[0]);
    t = setVice(t, s.starters[0]);
    assert.equal(t.vice, s.starters[0]);
    assert.equal(t.captain, null);
    t = setCaptain(setVice(s, s.starters[1]), s.starters[1]);
    assert.equal(t.captain, s.starters[1]);
    assert.equal(t.vice, null);
  });

  it("removing a player clears captaincy and the XI slot", () => {
    let s = setCaptain(fullSquad(), fullSquad().starters[3]);
    const cap = s.captain!;
    s = removePlayer(s, cap);
    assert.equal(s.captain, null);
    assert.equal(s.picks.includes(cap), false);
    assert.equal(s.starters.includes(cap), false);
  });

  it("reconciles against a refreshed player list", () => {
    const s = setCaptain(fullSquad(), fullSquad().starters[0]);
    const gone = s.starters[0];
    const r = reconcileSquad(s, (id) => (id === gone ? undefined : get(id)));
    assert.equal(r.picks.length, 14);
    assert.equal(r.captain, null);
  });
});
