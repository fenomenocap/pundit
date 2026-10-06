import { aggregateScorers, lastLeagueMatches, sameClub } from "./club-form";
import type { FootballMatch } from "./football-data";
import { evidenceAuthority } from "./evidence-authority";

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
  observedAt: string | null;
}

export interface PlayerEvidenceBundle {
  observations: PlayerEvidence[];
  markets: PlayerMarketObservation[];
  recentScorers?: RecentScorerContext[];
}

export interface RecentScorerContext {
  team: string;
  players: string[];
  matchCount: number;
  throughDate: string;
  source: "ESPN";
}

export interface PlayerCapabilities {
  playerProjections: "unavailable";
  recentScorers: "available" | "unavailable";
  teamNews: "verified" | "unavailable";
  scorerMarket: "verified" | "unavailable";
}

export function playerCapabilities(bundle: PlayerEvidenceBundle | null): PlayerCapabilities {
  return {
    playerProjections: "unavailable",
    recentScorers: bundle?.recentScorers?.length ? "available" : "unavailable",
    teamNews: bundle && hasTeamNewsEvidence(bundle) ? "verified" : "unavailable",
    scorerMarket: bundle?.markets.length ? "verified" : "unavailable",
  };
}

export function recentScorerContext(fixtures: readonly FootballMatch[], fixture: PlayerFixtureRef): RecentScorerContext[] {
  const cutoff = Math.min(Date.now(), Date.parse(fixture.kickoff));
  const past = fixtures.filter((match) => Date.parse(match.utcDate) < cutoff
    && cutoff - Date.parse(match.utcDate) <= 60 * 24 * 60 * 60 * 1000);
  return [fixture.home, fixture.away].flatMap((team) => {
    const matches = lastLeagueMatches(team, past);
    const players = [...aggregateScorers(matches).values()].flat()
      .filter((player) => sameClub(player.team, team)).map((player) => player.name);
    return players.length ? [{ team, players, matchCount: matches.length,
      throughDate: matches[matches.length - 1].utcDate.slice(0, 10), source: "ESPN" as const }] : [];
  });
}

const STOPWORDS = new Set([
  "the", "and", "odds", "anytime", "first", "scorer", "goalscorer", "market",
  "premier", "league", "home", "away", "team", "news", "injury", "predicted",
  "lineup", "confirmed", "starting", "available", "doubtful", "suspended",
  "player", "props", "decimal", "price", "prices", "versus", "with", "from",
  "this", "that", "their", "they", "will", "most", "likely", "score",
  "sports", "sky", "bbc", "betting", "preview", "football", "soccer", "latest",
  "update", "updates", "best", "tips", "accumulator", "acca", "live", "blog",
  "see", "all", "more", "click", "here", "nil", "chance", "double", "winner",
  "compare", "filter", "share", "sort", "oddschecker", "betfair", "select",
  "reset", "apply", "cookies", "privacy", "newsletter",
  "back", "return", "returns", "returning", "date", "dates", "status", "fitness",
  "injuries", "absence", "absences", "expected", "potential", "possible", "unknown",
  "defender", "midfielder", "goalkeeper", "striker", "captain", "manager", "coach",
  "match", "kick", "tickets",
  "if", "when", "unless", "whether", "unavailable", "injured",
]);

const NAME = /(?<![\p{L}\p{M}'’\-])(\p{Lu}[\p{L}\p{M}]*(?:['’\-][\p{L}\p{M}]+)*(?:\s+\p{Lu}[\p{L}\p{M}]*(?:['’\-][\p{L}\p{M}]+)*){0,3})(?![\p{L}\p{M}'’\-])/gu;
const MARKET_CUE = /\b(?:anytime(?:\s+scorer)?|first(?:\s+(?:goal\s+)?scorer)?|goal\s*scorers?|to score(?:\s+anytime)?|player props?|scorer odds|scorers?)\b/i;
const STARTS_CUE = /\b(?:expected to start|confirmed to start|starts|in the (?:starting )?xi|named in the xi)\b/i;
const OUT_CUE = /\b(?:ruled out|doubtful|injured|suspended|misses? out|unavailable|out of the (?:side|xi))\b/i;

const MAX_PRE_KICKOFF_AGE_MS = 21 * 24 * 60 * 60 * 1000;

export const PLAYER_SCORER_ABSTENTION =
  "I don’t have player-level projections or a verified scorer market for this fixture, "
  + "so I can’t name a most likely scorer without inventing one. Confirmed starters, expected minutes and a dated scorer market would help me assess the options.";

export const TEAM_NEWS_COMPOSE_ABSTENTION =
  "I couldn’t establish a verified, dated team-news update for this fixture, so I won’t make an availability claim.";

function slug(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionsFixture(text: string, fixture: PlayerFixtureRef): boolean {
  // A source must identify this matchup, not merely mention both clubs in
  // unrelated cards. This is deliberately narrower than page-wide team
  // presence because accepted claims become fixture-scoped typed evidence.
  const home = escapeRegExp(fixture.home);
  const away = escapeRegExp(fixture.away);
  const connector = "(?:v(?:s\\.?)?|versus|against|at|@|host(?:s|ing)?|face(?:s|ing)?|travel(?:s|ling)?\\s+to)";
  return new RegExp(`\\b${home}\\b\\s*.{0,24}?\\s*${connector}\\s*.{0,24}?\\b${away}\\b|\\b${away}\\b\\s*.{0,24}?\\s*${connector}\\s*.{0,24}?\\b${home}\\b`, "i")
    .test(text);
}

function affiliatedTeam(text: string, fixture: PlayerFixtureRef): string | null {
  const home = escapeRegExp(fixture.home);
  const away = escapeRegExp(fixture.away);
  const pattern = new RegExp(
    `\\b(?:for|of)\\s+(${home}|${away})\\b|\\b(${home}|${away})'s\\b|\\((${home}|${away})\\)`
    + `|(${home}|${away})\\s*[:\\-]`,
    "i"
  );
  const match = text.match(pattern);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3] ?? match?.[4];
  if (!raw) return null;
  return raw.toLocaleLowerCase() === fixture.home.toLocaleLowerCase() ? fixture.home : fixture.away;
}

function teamForPlayer(
  snippet: string,
  fixture: PlayerFixtureRef
): string | null {
  // Team attribution is claim-local. Falling back to the first "for Leeds" (or
  // equivalent) anywhere in an 8k page body assigned unrelated navigation and
  // recommendation-card names to that club.
  const affiliated = affiliatedTeam(snippet, fixture);
  return affiliated;
}

function teamForNamedPlayer(window: string, playerName: string, fixture: PlayerFixtureRef): string | null {
  const at = window.toLocaleLowerCase().indexOf(playerName.toLocaleLowerCase());
  if (at < 0) return null;
  const following = teamForPlayer(window.slice(at), fixture);
  if (following) return following;
  const preceding = new RegExp(`\\b(${escapeRegExp(fixture.home)}|${escapeRegExp(fixture.away)})['’]s\\s*$`, "i")
    .exec(window.slice(0, at));
  return preceding?.[1].toLocaleLowerCase() === fixture.home.toLocaleLowerCase() ? fixture.home
    : preceding ? fixture.away : null;
}

function stripMarketChrome(text: string): string {
  return text.replace(/\bsee all odds\b/gi, " ");
}

/** 1X2 winner pages are not scorer markets. Player names there are chrome. */
function isOneXTwoMarketUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (/(?:anytime|first).*(?:scorer|goalscorer)|goalscorer|player-props|\/scorers?(?:\/|$)/.test(path)) {
      return false;
    }
    return /\/winner(?:\/|$)/.test(path) || /\/1x2(?:\/|$)/.test(path);
  } catch {
    return false;
  }
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
  const parts = lower.split(/\s+/);
  return parts.every((part, index) => !STOPWORDS.has(part)
    || (index === 0 && part === "will" && parts.length > 1));
}

function parseObservedAt(date: string, kickoff: string): { ok: boolean; at: string | null } {
  if (!date.trim()) return { ok: true, at: null };
  const observed = Date.parse(date);
  const kick = Date.parse(kickoff);
  if (!Number.isFinite(observed) || !Number.isFinite(kick)) return { ok: false, at: null };
  if (observed > kick) return { ok: false, at: null };
  if (kick - observed > MAX_PRE_KICKOFF_AGE_MS) return { ok: false, at: null };
  return { ok: true, at: new Date(observed).toISOString() };
}

function collectNames(text: string, fixture: PlayerFixtureRef): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(NAME)) {
    const affiliation = new RegExp(`^(?:${escapeRegExp(fixture.home)}|${escapeRegExp(fixture.away)})['’]s\\s+`, "i");
    const candidate = match[1]?.replace(affiliation, "");
    if (!candidate || !isPersonName(candidate, fixture)) continue;
    const id = slug(candidate);
    if (seen.has(id)) continue;
    seen.add(id);
    names.push(candidate);
  }
  return names;
}

/** Bounded clause around one player mention; never crosses a list, sentence or card boundary. */
function localClaimWindow(text: string, nameAt: number, nameLength: number): string {
  const afterStart = nameAt + nameLength;
  const boundaries = [...text.matchAll(/[!?;,|](?=\s|$)|\.(?=\s+[A-Z]|\s*$)|\n/g)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0);
  const priorBoundary = boundaries.filter((index) => index < nameAt).at(-1) ?? -1;
  const nextBoundary = boundaries.find((index) => index >= afterStart) ?? text.length;
  return text.slice(
    Math.max(priorBoundary + 1, nameAt - 72),
    Math.min(nextBoundary + 1, afterStart + 96)
  );
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

type BoundAvailabilityStatus = { kind: PlayerEvidenceType; value: "out" | "doubtful" | "injured" | "suspended" | "start" };

function boundAvailabilityStatus(window: string, playerName: string): BoundAvailabilityStatus | null {
  const nameAt = window.toLocaleLowerCase().indexOf(playerName.toLocaleLowerCase());
  if (nameAt < 0) return null;
  if (/\b(?:if|unless|whether|when|should|in case)\b[^.!?;,|\n]*$/i.test(window.slice(0, nameAt))) return null;
  // The named subject must carry its own status. A nearby cue can describe
  // another player or a return-date heading rather than this person.
  const afterName = window.slice(nameAt + playerName.length);
  const status = /^\s*(?:\([^()\n]{1,40}\)\s*)?(?:[:–—-]\s*)?(?:(?:is|was|remains|will be|has been)\s+)?(?:(?:currently|still|already)\s+)?(?:(?:listed|reported)\s+as\s+)?(confirmed to start|named in the xi|expected to start|starts|in the (?:starting )?xi|ruled out|doubtful|injured|suspended|misses? out|unavailable|out of the (?:side|xi))\b/i.exec(afterName);
  const kind = status ? availabilityType(status[1]) : null;
  if (!kind || !status) return null;
  const word = status[1].toLocaleLowerCase();
  return { kind, value: kind !== "availability" ? "start"
    : word === "doubtful" || word === "injured" || word === "suspended" ? word : "out" };
}

function parseDecimalOdds(text: string): number | null {
  if (/\bevens?\b/i.test(text)) return 2;
  const twoDp = /\b([1-9]\d?\.\d{2})\b/.exec(text);
  if (twoDp) {
    const odds = Number(twoDp[1]);
    return Number.isFinite(odds) ? odds : null;
  }
  const oneDp = /\b([1-9]\d?\.\d)\b/.exec(text);
  if (oneDp) {
    const odds = Number(oneDp[1]);
    return Number.isFinite(odds) ? odds : null;
  }
  if (/\d{1,2}\/\d{1,2}\/\d/.test(text)) return null;
  const fractional = /\b(\d{1,2})\/(\d{1,2})\b/.exec(text);
  if (fractional) {
    const num = Number(fractional[1]);
    const den = Number(fractional[2]);
    if (den > 0 && num >= 1 && num <= 50 && den <= 50) return 1 + num / den;
  }
  const american = /\b([+-]\d{3,4})\b/.exec(text);
  if (american) {
    const line = Number(american[1]);
    if (!Number.isFinite(line) || line === 0) return null;
    return line > 0 ? 1 + line / 100 : 1 + 100 / Math.abs(line);
  }
  return null;
}

function inRange(odds: number | null): odds is number {
  return odds != null && odds > 1.01 && odds < 51;
}

function nearestOdds(segment: string, playerName: string): number | null {
  const idx = segment.toLocaleLowerCase().indexOf(playerName.toLocaleLowerCase());
  if (idx < 0) return parseDecimalOdds(segment);
  const after = segment.slice(idx + playerName.length);
  const untilNext = after.split(/[,;|\n]/)[0] ?? after;
  return parseDecimalOdds(untilNext);
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
    const blob = stripMarketChrome(`${source.title} ${source.snippet}`);
    if (!mentionsFixture(blob, fixture)) continue;
    const observed = parseObservedAt(source.date, fixture.kickoff);
    if (!observed.ok) continue;
    const observedAt = observed.at;
    const snippet = stripMarketChrome(source.snippet);
    const segments = [snippet, ...snippet.split(/[,;|\n]/), blob];

    const seenMarket = new Set<string>();
    if (!isOneXTwoMarketUrl(source.url)) {
      for (const segment of segments) {
        if (!MARKET_CUE.test(segment)) continue;
        const names = collectNames(segment, fixture);
        for (const playerName of names) {
          const idx = segment.toLocaleLowerCase().indexOf(playerName.toLocaleLowerCase());
          const window = idx < 0
            ? segment
            : localClaimWindow(segment, idx, playerName.length);
          // Market pages often put "Anytime Goalscorer" in a heading just
          // before the player card. The player, price and team must remain in
          // the local window; only the market-type cue may come from the
          // enclosing segment.
          if (!MARKET_CUE.test(window) && !MARKET_CUE.test(segment)) continue;
          const odds = nearestOdds(window, playerName);
          if (!inRange(odds)) continue;
          const teamId = teamForNamedPlayer(window, playerName, fixture);
          if (!teamId) continue;
          const key = `${slug(playerName)}:${odds.toFixed(2)}:${source.id}`;
          if (seenMarket.has(key)) continue;
          seenMarket.add(key);
          markets.push({
            fixtureId: fixture.fixtureId,
            playerId: slug(playerName),
            playerName,
            teamId,
            market: marketKind(`${blob} ${segment}`),
            decimalOdds: Number(odds.toFixed(2)),
            impliedProbability: 1 / odds,
            sourceId: source.id,
            observedAt,
          });
        }
      }
    }

    // Cue and name must share a short window. Whole-blob `names[0]` picked
    // chrome; whole-sentence classification tagged every name in a mixed line.
    const haystack = `${source.title}\n${snippet}`;
    const seenAvailability = new Set<string>();
    for (const playerName of collectNames(haystack, fixture)) {
      const lower = haystack.toLocaleLowerCase();
      const needle = playerName.toLocaleLowerCase();
      let from = 0;
      let status: BoundAvailabilityStatus | null = null;
      let window = "";
      while (from < lower.length) {
        const idx = lower.indexOf(needle, from);
        if (idx < 0) break;
        window = localClaimWindow(haystack, idx, playerName.length);
        status = boundAvailabilityStatus(window, playerName);
        if (status) break;
        from = idx + needle.length;
      }
      if (!status) continue;
      const playerId = slug(playerName);
      const key = `${playerId}:${status.kind}:${status.value}:${source.id}`;
      if (seenAvailability.has(key)) continue;
      seenAvailability.add(key);
      const teamId = teamForNamedPlayer(window, playerName, fixture);
      if (!teamId) continue;
      const row: PlayerEvidence = {
        playerId,
        playerName,
        teamId,
        fixtureId: fixture.fixtureId,
        evidenceType: status.kind,
        value: status.value,
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
    const out = rows.some((row) => row.evidenceType === "availability" && (row.value === "out" || row.value === "suspended"));
    if (starts && out) conflicted.add(playerId);
  }

  return {
    observations: observations.filter((row) => !conflicted.has(row.playerId)),
    markets: markets.filter((row) => !conflicted.has(row.playerId)),
  };
}

/**
 * Current club reports need not name a fixture still weeks away. Keep these
 * separate from fixture lineups/markets: they establish only dated statuses,
 * never that a player will miss (or start) the future match.
 */
export function extractDatedClubAvailability(
  sources: PlayerEvidenceSource[],
  fixture: PlayerFixtureRef,
  now = Date.now()
): PlayerEvidenceBundle {
  const observations: PlayerEvidence[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const published = Date.parse(source.date);
    if (evidenceAuthority(source.url) === "other" || !Number.isFinite(published)
      || published > now || now - published > 7 * 24 * 60 * 60 * 1000) continue;
    const text = `${source.title}\n${source.snippet}`;
    for (const playerName of collectNames(text, fixture)) {
      // A surname, generic "Back", or heading is not a player identity.
      if (playerName.split(/\s+/).length < 2) continue;
      const lower = text.toLocaleLowerCase();
      const needle = playerName.toLocaleLowerCase();
      let from = 0;
      while (from < lower.length) {
        const at = lower.indexOf(needle, from);
        if (at < 0) break;
        from = at + needle.length;
        const window = localClaimWindow(text, at, playerName.length);
        const status = boundAvailabilityStatus(window, playerName);
        if (status?.kind !== "availability") continue;
        // Affiliation must be explicit in the same claim. Do not inherit it
        // from a whole-page headline, navigation, or a different player.
        const teamId = teamForNamedPlayer(window, playerName, fixture);
        if (!teamId) continue;
        const key = `${slug(playerName)}:${teamId}:${status.value}:${source.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        observations.push({ playerId: slug(playerName), playerName, teamId,
          fixtureId: fixture.fixtureId, evidenceType: "availability", value: status.value,
          sourceId: source.id, observedAt: new Date(published).toISOString(),
          effectiveAt: new Date(published).toISOString() });
      }
    }
  }
  // Contradictory dated statuses remain unresolved rather than selecting the
  // convenient source. The exact composed claims still owe verification.
  const conflicts = new Set(observations.filter((row) => observations.some((other) =>
    row.playerId === other.playerId && row.teamId === other.teamId && row.value !== other.value)).map((row) => `${row.teamId}:${row.playerId}`));
  return { observations: observations.filter((row) => !conflicts.has(`${row.teamId}:${row.playerId}`)), markets: [] };
}

/** Candidate prose only; every resulting claim still faces the verifier. */
export function datedClubNewsSources(
  sources: PlayerEvidenceSource[], fixture: PlayerFixtureRef, now = Date.now()
): PlayerEvidenceSource[] {
  return sources.filter((source) => {
    const published = Date.parse(source.date);
    if (evidenceAuthority(source.url) === "other" || !Number.isFinite(published)
      || published > now || now - published > 7 * 24 * 60 * 60 * 1000) return false;
    const title = source.title;
    if (!new RegExp(`\\b(?:${escapeRegExp(fixture.home)}|${escapeRegExp(fixture.away)})\\b`, "i").test(title)) return false;
    const text = `${title}\n${source.snippet}`;
    // A fixture report rejected by the strict extractor must not get a second
    // route around its identity/status guards.
    if (mentionsFixture(title, fixture)) return false;
    if (!/\b(?:injur\w*|sidelined|fitness|hamstring|muscle strain|suspension|ruled out)\b/i.test(text)) return false;
    return collectNames(text, fixture).some((name) => name.split(/\s+/).length >= 2);
  }).slice(0, 3);
}

export function hasTrustworthyPlayerEvidence(bundle: PlayerEvidenceBundle): boolean {
  return bundle.markets.length > 0 || bundle.observations.some((row) =>
    row.evidenceType === "expected-lineup" || row.evidenceType === "confirmed-lineup"
  );
}

export function hasTeamNewsEvidence(bundle: PlayerEvidenceBundle): boolean {
  return bundle.observations.some((row) =>
    Boolean(row.observedAt)
    && (
      row.evidenceType === "expected-lineup"
      || row.evidenceType === "confirmed-lineup"
      || row.evidenceType === "availability"
    )
  );
}

export function leadingScorerCandidate(bundle: PlayerEvidenceBundle): PlayerMarketObservation | null {
  if (!bundle.markets.length) return null;
  return [...bundle.markets].sort((a, b) => a.decimalOdds - b.decimalOdds)[0] ?? null;
}
