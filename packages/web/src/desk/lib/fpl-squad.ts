/**
 * FPL squad rules (Fantasy Premier League defaults):
 * 15 players: 2 GK, 5 DEF, 5 MID, 3 FWD; budget 100.0m; at most 3 from one club.
 * Starting XI: 11 players with 1 GK, 3-5 DEF, 2-5 MID, 1-3 FWD.
 * One captain and one vice-captain, both in the XI and different players.
 * Prices are taken as given from the data source. A missing price is never
 * guessed: the budget is then reported as unverified.
 */

export type Pos = "GK" | "DEF" | "MID" | "FWD";
export const POSITIONS: Pos[] = ["GK", "DEF", "MID", "FWD"];

export const SQUAD_SIZE = 15;
export const XI_SIZE = 11;
export const BUDGET = 100;
export const MAX_PER_CLUB = 3;
export const SQUAD_QUOTA: Record<Pos, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
export const XI_LIMITS: Record<Pos, { min: number; max: number }> = {
  GK: { min: 1, max: 1 },
  DEF: { min: 3, max: 5 },
  MID: { min: 2, max: 5 },
  FWD: { min: 1, max: 3 },
};

export type FplPlayer = {
  id: number;
  name: string;
  club: string;
  pos: Pos;
  /** Price in millions, or null when the source has none. */
  price: number | null;
};

export type Squad = {
  picks: number[];
  starters: number[];
  captain: number | null;
  vice: number | null;
};

export const EMPTY_SQUAD: Squad = { picks: [], starters: [], captain: null, vice: null };

type Lookup = (id: number) => FplPlayer | undefined;

export function lookupFrom(players: readonly FplPlayer[]): Lookup {
  const map = new Map(players.map((p) => [p.id, p]));
  return (id) => map.get(id);
}

export function countByPos(ids: readonly number[], get: Lookup): Record<Pos, number> {
  const c: Record<Pos, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const id of ids) {
    const p = get(id);
    if (p) c[p.pos] += 1;
  }
  return c;
}

export function countByClub(ids: readonly number[], get: Lookup): Record<string, number> {
  const c: Record<string, number> = {};
  for (const id of ids) {
    const p = get(id);
    if (p) c[p.club] = (c[p.club] ?? 0) + 1;
  }
  return c;
}

export type Spend = { spent: number; remaining: number; unpriced: number };

/** Sum of known prices, rounded to 0.1m. Unpriced players are counted, not valued. */
export function squadSpend(ids: readonly number[], get: Lookup): Spend {
  let tenths = 0;
  let unpriced = 0;
  for (const id of ids) {
    const p = get(id);
    if (!p) continue;
    if (p.price === null) unpriced += 1;
    else tenths += Math.round(p.price * 10);
  }
  return { spent: tenths / 10, remaining: (BUDGET * 10 - tenths) / 10, unpriced };
}

/** Why a player cannot be added, or null when the add is allowed. */
export function addBlocker(squad: Squad, player: FplPlayer, get: Lookup): string | null {
  if (squad.picks.includes(player.id)) return `${player.name} is already in your squad.`;
  if (squad.picks.length >= SQUAD_SIZE) return `Your squad already has ${SQUAD_SIZE} players.`;
  const pos = countByPos(squad.picks, get);
  if (pos[player.pos] >= SQUAD_QUOTA[player.pos]) {
    return `You already have ${SQUAD_QUOTA[player.pos]} ${posName(player.pos, SQUAD_QUOTA[player.pos])}.`;
  }
  const clubs = countByClub(squad.picks, get);
  if ((clubs[player.club] ?? 0) >= MAX_PER_CLUB) {
    return `You already have ${MAX_PER_CLUB} players from ${player.club}.`;
  }
  if (player.price !== null) {
    const spend = squadSpend(squad.picks, get);
    if (Math.round(player.price * 10) > Math.round(spend.remaining * 10)) {
      return `${player.name} costs £${player.price.toFixed(1)}m; you have £${spend.remaining.toFixed(1)}m left.`;
    }
  }
  return null;
}

export function posName(pos: Pos, n: number) {
  const one = { GK: "goalkeeper", DEF: "defender", MID: "midfielder", FWD: "forward" }[pos];
  return n === 1 ? one : `${one}s`;
}

export function addPlayer(squad: Squad, player: FplPlayer, get: Lookup): Squad {
  if (addBlocker(squad, player, get)) return squad;
  const picks = [...squad.picks, player.id];
  const starters = [...squad.starters];
  // Fill the XI automatically while it is short and the formation allows it.
  if (starters.length < XI_SIZE && canStart(starters, player, get)) starters.push(player.id);
  return { ...squad, picks, starters };
}

export function removePlayer(squad: Squad, id: number): Squad {
  return {
    picks: squad.picks.filter((p) => p !== id),
    starters: squad.starters.filter((p) => p !== id),
    captain: squad.captain === id ? null : squad.captain,
    vice: squad.vice === id ? null : squad.vice,
  };
}

/** Can this player join the given XI without breaking the formation maximums? */
export function canStart(starters: readonly number[], player: FplPlayer, get: Lookup) {
  if (starters.length >= XI_SIZE) return false;
  const c = countByPos(starters, get);
  if (c[player.pos] >= XI_LIMITS[player.pos].max) return false;
  // Keep room for the minimums of the other positions.
  const after = { ...c, [player.pos]: c[player.pos] + 1 };
  const minsStillNeeded = POSITIONS.reduce((a, p) => a + Math.max(0, XI_LIMITS[p].min - after[p]), 0);
  return starters.length + 1 + minsStillNeeded <= XI_SIZE;
}

/** Move a squad player into or out of the starting XI. */
export function toggleStarter(squad: Squad, id: number, get: Lookup): { squad: Squad; message: string | null } {
  const player = get(id);
  if (!player || !squad.picks.includes(id)) return { squad, message: null };
  if (squad.starters.includes(id)) {
    return {
      squad: {
        ...squad,
        starters: squad.starters.filter((s) => s !== id),
        captain: squad.captain === id ? null : squad.captain,
        vice: squad.vice === id ? null : squad.vice,
      },
      message: null,
    };
  }
  if (!canStart(squad.starters, player, get)) {
    return {
      squad,
      message:
        squad.starters.length >= XI_SIZE
          ? "Your starting XI is full. Bench a player first."
          : `That would break the formation limits (1 GK, 3-5 DEF, 2-5 MID, 1-3 FWD).`,
    };
  }
  return { squad: { ...squad, starters: [...squad.starters, id] }, message: null };
}

export function setCaptain(squad: Squad, id: number): Squad {
  if (!squad.starters.includes(id)) return squad;
  return { ...squad, captain: id, vice: squad.vice === id ? squad.captain : squad.vice };
}

export function setVice(squad: Squad, id: number): Squad {
  if (!squad.starters.includes(id)) return squad;
  return { ...squad, vice: id, captain: squad.captain === id ? squad.vice : squad.captain };
}

export type Check = { ok: boolean; message: string };

/** Every rule, in reading order, with a plain message. */
export function validateSquad(squad: Squad, get: Lookup): Check[] {
  const checks: Check[] = [];
  const pos = countByPos(squad.picks, get);
  checks.push({
    ok: squad.picks.length === SQUAD_SIZE,
    message: `Squad: ${squad.picks.length} of ${SQUAD_SIZE} players selected.`,
  });
  for (const p of POSITIONS) {
    const need = SQUAD_QUOTA[p];
    checks.push({ ok: pos[p] === need, message: `${posName(p, 2)[0].toUpperCase()}${posName(p, 2).slice(1)}: ${pos[p]} of ${need}.` });
  }
  const clubs = countByClub(squad.picks, get);
  const over = Object.entries(clubs).filter(([, n]) => n > MAX_PER_CLUB);
  checks.push({
    ok: over.length === 0,
    message: over.length === 0 ? `No more than ${MAX_PER_CLUB} players from any club.` : `Too many players from ${over.map(([c]) => c).join(", ")}.`,
  });
  const spend = squadSpend(squad.picks, get);
  if (spend.unpriced > 0) {
    checks.push({ ok: false, message: `Budget cannot be verified: ${spend.unpriced} selected player${spend.unpriced === 1 ? " has" : "s have"} no price in the source data.` });
  } else {
    checks.push({
      ok: spend.remaining >= 0,
      message: spend.remaining >= 0
        ? `Budget: £${spend.spent.toFixed(1)}m of £${BUDGET.toFixed(1)}m spent, £${spend.remaining.toFixed(1)}m left.`
        : `Over budget by £${(-spend.remaining).toFixed(1)}m.`,
    });
  }
  const xi = countByPos(squad.starters, get);
  const formationOk = squad.starters.length === XI_SIZE && POSITIONS.every((p) => xi[p] >= XI_LIMITS[p].min && xi[p] <= XI_LIMITS[p].max);
  checks.push({
    ok: formationOk,
    message: squad.starters.length !== XI_SIZE
      ? `Starting XI: ${squad.starters.length} of ${XI_SIZE} selected.`
      : formationOk
        ? `Starting XI formation ${xi.DEF}-${xi.MID}-${xi.FWD} is valid.`
        : "Starting XI needs 1 GK, 3-5 DEF, 2-5 MID and 1-3 FWD.",
  });
  checks.push({
    ok: squad.captain !== null && squad.starters.includes(squad.captain),
    message: squad.captain !== null ? "Captain chosen." : "Choose a captain from your starting XI.",
  });
  checks.push({
    ok: squad.vice !== null && squad.starters.includes(squad.vice) && squad.vice !== squad.captain,
    message: squad.vice !== null ? "Vice-captain chosen." : "Choose a vice-captain from your starting XI.",
  });
  return checks;
}

export function isSquadComplete(squad: Squad, get: Lookup) {
  return validateSquad(squad, get).every((c) => c.ok);
}

/** Drop ids the current player list no longer contains (e.g. a transfer out of the league). */
export function reconcileSquad(squad: Squad, get: Lookup): Squad {
  const picks = squad.picks.filter((id) => get(id));
  const starters = squad.starters.filter((id) => picks.includes(id));
  const keep = (id: number | null) => (id !== null && starters.includes(id) ? id : null);
  return { picks, starters, captain: keep(squad.captain), vice: keep(squad.vice) };
}
