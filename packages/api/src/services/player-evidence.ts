/**
 * Request-local player evidence. Chat 1 consumes web-search snippets through
 * this adapter; Chat 2 can swap the extractor without changing compose or
 * routing. Observations are never Pundit-owned probabilities.
 */

export type PlayerEvidenceType =
  | "roster"
  | "expected-lineup"
  | "confirmed-lineup"
  | "availability"
  | "recent-minutes"
  | "attacking-stat"
  | "player-market";

export type PlayerMarketKind = "anytime-scorer" | "first-scorer";

export interface PlayerEvidenceSource {
  id: string;
  title: string;
  url: string;
  date: string;
  snippet: string;
}

export interface PlayerFixtureRef {
  fixtureId: string;
  home: string;
  away: string;
  kickoff: string;
}

export interface PlayerEvidence {
  playerId: string;
  playerName: string;
  teamId: string;
  fixtureId: string;
  evidenceType: PlayerEvidenceType;
  value: string | number;
  sourceId: string;
  observedAt: string | null;
  effectiveAt: string | null;
}

export interface PlayerMarketObservation {
  fixtureId: string;
  playerId: string;
  playerName: string;
  teamId: string;
  market: PlayerMarketKind;
  decimalOdds: number;
  impliedProbability: number;
  sourceId: string;
  observedAt: string;
}

export interface PlayerEvidenceBundle {
  observations: PlayerEvidence[];
  markets: PlayerMarketObservation[];
}

const STOPWORDS = new Set([
  "the", "and", "odds", "anytime", "first", "scorer", "goalscorer", "market",
  "premier", "league", "home", "away", "team", "news", "injury", "predicted",
  "lineup", "confirmed", "starting", "available", "doubtful", "suspended",
  "player", "props", "decimal", "price", "prices", "versus", "with", "from",
  "this", "that", "their", "they", "will", "most", "likely", "score",
]);

const NAME = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g;
const DECIMAL_ODDS = /\b([1-9]\d?\.\d{2})\b/;
const MARKET_CUE = /\b(?:anytime(?:\s+scorer)?|first(?:\s+scorer)?|goalscorer|to score|player prop)\b/i;
const STARTS_CUE = /\b(?:expected to start|confirmed to start|starts|in the (?:starting )?xi|named in the xi)\b/i;
const OUT_CUE = /\b(?:ruled out|doubtful|injured|suspended|misses? out|unavailable|out of the (?:side|xi))\b/i;

const MAX_PRE_KICKOFF_AGE_MS = 21 * 24 * 60 * 60 * 1000;

export const PLAYER_SCORER_ABSTENTION =
  "I don’t have player-level projections or a verified scorer market for this fixture, "
  + "so I can’t name a most likely scorer without inventing one.";

function slug(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueTeamIn(text: string, fixture: PlayerFixtureRef): string | null {
  const lower = text.toLocaleLowerCase();
  const home = lower.includes(fixture.home.toLocaleLowerCase());
  const away = lower.includes(fixture.away.toLocaleLowerCase());
  if (home && !away) return fixture.home;
  if (away && !home) return fixture.away;
  return null;
}

function affiliatedTeam(text: string, fixture: PlayerFixtureRef): string | null {
  const home = escapeRegExp(fixture.home);
  const away = escapeRegExp(fixture.away);
  const pattern = new RegExp(
    `\\b(?:for|of)\\s+(${home}|${away})\\b|\\b(${home}|${away})'s\\b|\\((${home}|${away})\\)`,
    "i"
  );
  const match = text.match(pattern);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!raw) return null;
  return raw.toLocaleLowerCase() === fixture.home.toLocaleLowerCase() ? fixture.home : fixture.away;
}

function teamForPlayer(
  snippet: string,
  blob: string,
  playerName: string,
  fixture: PlayerFixtureRef
): string | null {
  const affiliated = affiliatedTeam(snippet, fixture) ?? affiliatedTeam(blob, fixture);
  if (affiliated) return affiliated;
  const unique = uniqueTeamIn(snippet, fixture) ?? uniqueTeamIn(blob, fixture);
  if (unique) return unique;
  const lower = blob.toLocaleLowerCase();
  if (!lower.includes(fixture.home.toLocaleLowerCase()) && !lower.includes(fixture.away.toLocaleLowerCase())) {
    return null;
  }
  // Both clubs appear (typical title) and there is no affiliation. Bind from
  // the nearest unique-team window around later mentions of the player, not
  // the "Home vs Away" title.
  const name = playerName.toLocaleLowerCase();
  let from = 0;
  while (from < lower.length) {
    const playerAt = lower.indexOf(name, from);
    if (playerAt < 0) break;
    const window = blob.slice(playerAt, playerAt + playerName.length + 48);
    const nearby = uniqueTeamIn(window, fixture);
    if (nearby) return nearby;
    from = playerAt + name.length;
  }
  return null;
}

function isPersonName(raw: string, fixture: PlayerFixtureRef): boolean {
  const name = raw.trim();
  if (name.length < 4) return false;
  const lower = name.toLocaleLowerCase();
  if (STOPWORDS.has(lower)) return false;
  if (lower === fixture.home.toLocaleLowerCase() || lower === fixture.away.toLocaleLowerCase()) {
    return false;
  }
  if (fixture.home.toLocaleLowerCase().includes(lower) || fixture.away.toLocaleLowerCase().includes(lower)) {
    return false;
  }
  return !STOPWORDS.has(lower.split(/\s+/)[0] ?? "");
}

function parseObservedAt(date: string, kickoff: string): string | null {
  const observed = Date.parse(date);
  const kick = Date.parse(kickoff);
  if (!Number.isFinite(observed) || !Number.isFinite(kick)) return null;
  if (observed > kick) return null;
  if (kick - observed > MAX_PRE_KICKOFF_AGE_MS) return null;
  return new Date(observed).toISOString();
}

function collectNames(text: string, fixture: PlayerFixtureRef): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(NAME)) {
    const candidate = match[1];
    if (!candidate || !isPersonName(candidate, fixture)) continue;
    const id = slug(candidate);
    if (seen.has(id)) continue;
    seen.add(id);
    names.push(candidate);
  }
  return names;
}

function marketKind(text: string): PlayerMarketKind {
  return /\bfirst\b/i.test(text) && !/\banytime\b/i.test(text) ? "first-scorer" : "anytime-scorer";
}

function availabilityType(text: string): PlayerEvidenceType | null {
  if (/\bconfirmed to start|named in the xi\b/i.test(text)) return "confirmed-lineup";
  if (STARTS_CUE.test(text)) return "expected-lineup";
  if (OUT_CUE.test(text)) return "availability";
  return null;
}

/**
 * Chat 2 seam: swap this extractor for a structured-stat adapter. Invariants
 * stay the same — identity, source, time, no market-as-Pundit-probability.
 */
export function extractPlayerEvidence(
  sources: PlayerEvidenceSource[],
  fixture: PlayerFixtureRef
): PlayerEvidenceBundle {
  const observations: PlayerEvidence[] = [];
  const markets: PlayerMarketObservation[] = [];
  const availabilityByPlayer = new Map<string, PlayerEvidence[]>();

  for (const source of sources) {
    const blob = `${source.title} ${source.snippet}`;
    const names = collectNames(blob, fixture);
    if (!names.length) continue;
    const playerName = names[0];
    const teamId = teamForPlayer(source.snippet, blob, playerName, fixture);
    if (!teamId) continue;
    const observedAt = parseObservedAt(source.date, fixture.kickoff);
    if (!observedAt) continue;

    const oddsMatch = DECIMAL_ODDS.exec(blob);
    const odds = oddsMatch ? Number(oddsMatch[1]) : NaN;
    if (MARKET_CUE.test(blob) && Number.isFinite(odds) && odds > 1.01 && odds < 51) {
      const playerName = names[0];
      markets.push({
        fixtureId: fixture.fixtureId,
        playerId: slug(playerName),
        playerName,
        teamId,
        market: marketKind(blob),
        decimalOdds: odds,
        impliedProbability: 1 / odds,
        sourceId: source.id,
        observedAt,
      });
    }

    const kind = availabilityType(blob);
    if (kind) {
      const playerName = names[0];
      const row: PlayerEvidence = {
        playerId: slug(playerName),
        playerName,
        teamId,
        fixtureId: fixture.fixtureId,
        evidenceType: kind,
        value: kind === "availability" ? "out" : "start",
        sourceId: source.id,
        observedAt,
        effectiveAt: observedAt,
      };
      observations.push(row);
      const bucket = availabilityByPlayer.get(row.playerId) ?? [];
      bucket.push(row);
      availabilityByPlayer.set(row.playerId, bucket);
    }
  }

  const conflicted = new Set<string>();
  for (const [playerId, rows] of availabilityByPlayer) {
    const starts = rows.some((row) => row.value === "start");
    const out = rows.some((row) => row.value === "out");
    if (starts && out) conflicted.add(playerId);
  }

  return {
    observations: observations.filter((row) => !conflicted.has(row.playerId)),
    markets: markets.filter((row) => !conflicted.has(row.playerId)),
  };
}

export function hasTrustworthyPlayerEvidence(bundle: PlayerEvidenceBundle): boolean {
  return bundle.markets.length > 0 || bundle.observations.some((row) =>
    row.evidenceType === "expected-lineup" || row.evidenceType === "confirmed-lineup"
  );
}

export function leadingScorerCandidate(bundle: PlayerEvidenceBundle): PlayerMarketObservation | null {
  if (!bundle.markets.length) return null;
  return [...bundle.markets].sort((a, b) => a.decimalOdds - b.decimalOdds)[0] ?? null;
}
