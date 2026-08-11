import { MarketProfile } from "../config/competitions";
import {
  getTeamNameAliases,
  modelFixtureKey,
  normalizeTeamName,
  normalizeTeamText,
  normalizedTeamPairKey,
} from "../lib/team-names";
import { getModelFixtureKey, ModelFixture } from "./model-data";
import type { ThreeWayOdds } from "./model-market-odds";

const STAKE_URL = "https://stake.bet/_api/graphql";
const POLYMARKET_URL = "https://gamma-api.polymarket.com/events";
const POLYMARKET_SEARCH_URL = "https://gamma-api.polymarket.com/public-search";
const KALSHI_URL = "https://api.elections.kalshi.com/trade-api/v2/events";
const TIMEOUT_MS = 10_000;

const STAKE_QUERY = `
query SlugTournament(
  $sport: String!, $category: String!, $tournament: String!,
  $type: SportSearchEnum!, $groups: [String!]!, $limit: Int = 200, $offset: Int = 0
) {
  slugTournament(sport: $sport, category: $category, tournament: $tournament) {
    fixtureList(type: $type, limit: $limit, offset: $offset) {
      data { __typename ... on SportFixtureDataMatch { competitors { name } } }
      groups(groups: $groups, status: [active, suspended, deactivated]) {
        templates(limit: 10, includeEmpty: true) {
          name
          markets(limit: 20) { name status outcomes { active odds name } }
        }
      }
    }
  }
}`;

interface StakeProfile {
  category: string;
  tournament: string;
  referer: string;
}

interface KalshiProfile {
  seriesTicker: string | null;
}

interface MarketSourceProfile {
  stake: StakeProfile;
  kalshi: KalshiProfile;
}

const MARKET_SOURCE_PROFILES: Record<MarketProfile, MarketSourceProfile> = {
  "premier-league": {
    stake: {
      category: "england",
      tournament: "premier-league",
      referer: "https://stake.bet/sports/soccer/england/premier-league",
    },
    kalshi: { seriesTicker: "KXEPLGAME" },
  },
  "uefa-champions-league": {
    // Covers uefa.champions_qual as well as the main competition. Stake was
    // checked during a live qualifying round and publishes no separate
    // qualifier tournament: this slug is the whole competition, so a qualifier
    // tie that goes unmatched here is a fixture-matching or access problem
    // rather than a missing slug. Check verify:prod coverage before changing
    // anything on this line.
    stake: {
      category: "international-clubs",
      tournament: "uefa-champions-league",
      referer: "https://stake.bet/sports/soccer/international-clubs/uefa-champions-league",
    },
    // KXUCLGAME carries qualifying ties too, contrary to what this comment used
    // to claim: a live third-round check returned all ten fixtures as open
    // events under this ticker. Unmatched qualifiers here are a name-matching
    // problem, not a missing series.
    kalshi: { seriesTicker: "KXUCLGAME" },
  },
  "world-cup": {
    stake: {
      category: "international",
      tournament: "world-cup",
      referer: "https://stake.bet/sports/soccer/international/world-cup",
    },
    kalshi: { seriesTicker: "KXWCGAME" },
  },
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function probability(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : null;
}

function decimal(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) && parsed > 1 ? parsed : null;
}

export function normalizeThreeWay(values: {
  home: number;
  draw: number;
  away: number;
}): ThreeWayOdds | null {
  const total = values.home + values.draw + values.away;
  if (![values.home, values.draw, values.away, total].every(Number.isFinite) || total <= 0) {
    return null;
  }
  return {
    pHome: values.home / total,
    pDraw: values.draw / total,
    pAway: values.away / total,
  };
}

export function noVigFromDecimal(
  home: unknown,
  draw: unknown,
  away: unknown
): ThreeWayOdds | null {
  const homeDecimal = decimal(home);
  const drawDecimal = decimal(draw);
  const awayDecimal = decimal(away);
  if (homeDecimal === null || drawDecimal === null || awayDecimal === null) return null;
  return normalizeThreeWay({
    home: 1 / homeDecimal,
    draw: 1 / drawDecimal,
    away: 1 / awayDecimal,
  });
}

function selection(name: string, fixture: ModelFixture): "home" | "draw" | "away" | null {
  const normalized = normalizeTeamName(name);
  if (normalized === normalizeTeamName(fixture.home)) return "home";
  if (normalized === normalizeTeamName(fixture.away)) return "away";
  const text = normalizeTeamText(name);
  if (["draw", "x", "tie"].includes(text)) return "draw";
  if (/^(draw|tie)\b/.test(text)) return "draw";
  return null;
}

/**
 * Which side of the fixture a market label refers to, tolerating the longer
 * club names venues actually print.
 *
 * `selection` alone demands exact equality, which no sportsbook owes us:
 * Polymarket labels its legs "SK Puntigamer Sturm Graz" and "Fenerbahce SK"
 * against our "Sturm Graz" and "Fenerbahce", so a complete and open three-way
 * market resolved only its draw leg and the whole event was discarded.
 *
 * Containment needs the ambiguity guard, because a draw label names both clubs
 * ("Draw (A vs. B)") and would otherwise read as the home side. Trying
 * `selection` first is what keeps that safe -- it settles draws on the leading
 * "draw" before containment ever sees two team matches.
 */
function marketSelection(label: string, fixture: ModelFixture): "home" | "draw" | "away" | null {
  const direct = selection(label, fixture);
  if (direct) return direct;
  const text = normalizeTeamText(label);
  const matches: Array<"home" | "draw" | "away"> = [];
  if (teamSearchTerms(fixture.home).some((term) => text.includes(term))) matches.push("home");
  if (teamSearchTerms(fixture.away).some((term) => text.includes(term))) matches.push("away");
  if (/\b(tie|draw)\b/.test(text)) matches.push("draw");
  return matches.length === 1 ? matches[0] : null;
}

function teamSearchTerms(team: string): string[] {
  const canonical = normalizeTeamName(team);
  return [team, ...getTeamNameAliases()
    .filter(([, target]) => normalizeTeamName(target) === canonical)
    .map(([alias]) => alias)]
    .map(normalizeTeamText);
}

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

const FULL_MONTHS = [
  "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december",
];

// Only a word that *is* a month names a date. Matching a month-prefixed prefix
// instead read club names as dates -- "Marseille 1 - Lyon 0" parsed as Mar 1,
// "Septemvri 1 Levski 0" as Sep 1, "Novara 3 Como 1" as Nov 3 -- and every one
// of those phantom dates could only disagree with the real kick-off, so the
// event was rejected and its market coverage silently lost.
const MONTH_WORDS = new Map<string, number>([
  ...MONTHS.map((name, index): [string, number] => [name, index + 1]),
  ...FULL_MONTHS.map((name, index): [string, number] => [name, index + 1]),
  // The one abbreviation that is neither the three-letter stem nor the full
  // name, and common enough in published event text to be worth listing.
  ["sept", 9],
]);

/**
 * Month/day pairs a venue put in its event text, in any of the shapes the two
 * sources actually publish: an ISO date in a Polymarket slug or question
 * ("2026-08-11"), a Kalshi ticker stem ("26AUG11"), or a Kalshi sub-title
 * ("ALM vs LEV (Aug 11)").
 */
export function extractEventDates(text: string): Array<{ month: number; day: number }> {
  const found: Array<{ month: number; day: number }> = [];
  for (const [, month, day] of text.matchAll(/\d{4}-(\d{2})-(\d{2})/g)) {
    found.push({ month: Number(month), day: Number(day) });
  }
  for (const [, name, day] of text.matchAll(/\d{2}([a-z]{3})(\d{2})/g)) {
    const month = MONTHS.indexOf(name) + 1;
    if (month > 0) found.push({ month, day: Number(day) });
  }
  for (const [, name, day] of text.matchAll(/\b([a-z]{3,9})\.?\s+(\d{1,2})\b/g)) {
    const month = MONTH_WORDS.get(name);
    if (month !== undefined) found.push({ month, day: Number(day) });
  }
  return found;
}

/**
 * Both legs of a two-legged tie carry the same two club names, so names alone
 * cannot tell them apart -- a fixture could be priced off the other leg's
 * market. Today the settled leg is usually skipped for being closed, but that
 * is incidental: while both legs are open at once, nothing else separates them.
 *
 * A day either side is allowed because these labels are published in local time
 * and a late kick-off crosses the UTC date we hold. Text with no date we can
 * read is accepted rather than rejected -- absence of a date is not evidence of
 * the wrong match, and rejecting on it would silently cost coverage from any
 * venue that omits one.
 */
function eventDateMatches(text: string, fixture: ModelFixture): boolean {
  const dates = extractEventDates(text);
  if (dates.length === 0) return true;
  const kickoff = new Date(`${fixture.date}T00:00:00Z`);
  if (Number.isNaN(kickoff.getTime())) return true;
  return dates.some(({ month, day }) => {
    for (const offset of [-1, 0, 1]) {
      const candidate = new Date(kickoff);
      candidate.setUTCDate(candidate.getUTCDate() + offset);
      if (candidate.getUTCMonth() + 1 === month && candidate.getUTCDate() === day) return true;
    }
    return false;
  });
}

function eventMatchesFixture(event: UnknownRecord, fixture: ModelFixture): boolean {
  const text = normalizeTeamText(["title", "subtitle", "sub_title", "slug", "event_ticker"]
    .map((key) => String(event[key] ?? ""))
    .join(" "));
  const namesMatch = [fixture.home, fixture.away].every((team) =>
    teamSearchTerms(team).some((term) => text.includes(term))
  );
  return namesMatch && eventDateMatches(text, fixture);
}

export function parseStakeFixture(raw: unknown, fixtures: ModelFixture[]) {
  const fixture = record(raw);
  const data = record(fixture?.data);
  if (!fixture || data?.__typename !== "SportFixtureDataMatch") return null;
  const competitors = array(data.competitors).map(record).filter(Boolean) as UnknownRecord[];
  if (competitors.length < 2) return null;
  const homeName = String(competitors[0].name ?? "");
  const awayName = String(competitors[1].name ?? "");
  const model = fixtures.find((candidate) =>
    normalizedTeamPairKey(candidate.home, candidate.away)
      === normalizedTeamPairKey(homeName, awayName)
  );
  if (!model) return null;

  for (const groupValue of array(fixture.groups)) {
    const group = record(groupValue);
    for (const templateValue of array(group?.templates)) {
      const template = record(templateValue);
      for (const marketValue of array(template?.markets)) {
        const market = record(marketValue);
        if (!market || market.status !== "active") continue;
        const odds: Partial<Record<"home" | "draw" | "away", unknown>> = {};
        for (const outcomeValue of array(market.outcomes)) {
          const outcome = record(outcomeValue);
          if (!outcome?.active) continue;
          const key = selection(String(outcome.name ?? ""), model);
          if (key) odds[key] = outcome.odds;
        }
        const normalized = noVigFromDecimal(odds.home, odds.draw, odds.away);
        if (normalized) return { fixture: model, odds: normalized };
      }
    }
  }
  return null;
}

export function parsePolymarketEvent(raw: unknown, fixture: ModelFixture): ThreeWayOdds | null {
  const event = record(raw);
  if (!event || !eventMatchesFixture(event, fixture)) return null;
  const prices: Partial<Record<"home" | "draw" | "away", number>> = {};

  for (const marketValue of array(event.markets)) {
    const market = record(marketValue);
    if (!market || market.closed === true || market.active === false) continue;
    const outcomes = jsonArray(market.outcomes).map(String);
    const outcomePrices = jsonArray(market.outcomePrices);
    for (let index = 0; index < outcomes.length; index += 1) {
      const key = selection(outcomes[index], fixture);
      const price = probability(outcomePrices[index]);
      if (key && price !== null) prices[key] = price;
    }
    const yesIndex = outcomes.findIndex((outcome) => outcome.toLowerCase() === "yes");
    const yesPrice = yesIndex >= 0 ? probability(outcomePrices[yesIndex]) : null;
    if (yesPrice !== null) {
      const key = marketSelection(String(market.groupItemTitle ?? ""), fixture)
        ?? marketSelection(String(market.yes_sub_title ?? ""), fixture);
      const marketType = String(market.sportsMarketType ?? "").toLowerCase();
      if (key && ["moneyline", "match result", "1x2"].includes(marketType)) prices[key] = yesPrice;
    }
  }

  return prices.home && prices.draw && prices.away
    ? normalizeThreeWay({ home: prices.home, draw: prices.draw, away: prices.away })
    : null;
}

function kalshiPrice(market: UnknownRecord): number | null {
  for (const field of ["yes_ask_dollars", "last_price_dollars", "yes_bid_dollars"]) {
    const price = probability(market[field]);
    if (price !== null) return price;
  }
  return null;
}


export function parseKalshiEvent(raw: unknown, fixture: ModelFixture): ThreeWayOdds | null {
  const event = record(raw);
  if (!event || !eventMatchesFixture(event, fixture)) return null;
  const prices: Partial<Record<"home" | "draw" | "away", number>> = {};
  for (const marketValue of array(event.markets)) {
    const market = record(marketValue);
    if (!market || !["open", "active"].includes(String(market.status ?? "open"))) continue;
    const label = [event.title, event.sub_title, market.title, market.subtitle]
      .map((value) => String(value ?? "").toLowerCase()).join(" ");
    if (!/(moneyline|match result|winner|to win|regulation time)/.test(label)) continue;
    const key = marketSelection(String(market.yes_sub_title ?? market.subtitle ?? ""), fixture);
    const price = kalshiPrice(market);
    if (key && price !== null) prices[key] = price;
  }
  return prices.home && prices.draw && prices.away
    ? normalizeThreeWay({ home: prices.home, draw: prices.draw, away: prices.away })
    : null;
}

async function jsonFetch(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status}: ${text.slice(0, 160)}`);
  }
  return response.json();
}

function fixturesByMarketProfile(fixtures: ModelFixture[]): Map<MarketProfile, ModelFixture[]> {
  const grouped = new Map<MarketProfile, ModelFixture[]>();
  for (const fixture of fixtures) {
    const competition = fixture.competitionId;
    let profile: MarketProfile;
    if (competition === "eng.1") profile = "premier-league";
    else if (competition.startsWith("uefa.")) profile = "uefa-champions-league";
    else continue;
    const bucket = grouped.get(profile) ?? [];
    bucket.push(fixture);
    grouped.set(profile, bucket);
  }
  return grouped;
}

export async function fetchStakeOdds(
  fixtures: ModelFixture[],
  profile: MarketProfile
): Promise<Map<string, ThreeWayOdds>> {
  const config = MARKET_SOURCE_PROFILES[profile];
  const payload = await jsonFetch(STAKE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Origin: "https://stake.bet",
      Referer: config.stake.referer,
    },
    body: JSON.stringify({
      query: STAKE_QUERY,
      variables: {
        type: "popular",
        tournament: config.stake.tournament,
        category: config.stake.category,
        sport: "soccer",
        groups: ["main"],
        limit: 200,
        offset: 0,
      },
    }),
  });
  const root = record(payload);
  const data = record(root?.data);
  const tournament = record(data?.slugTournament);
  const result = new Map<string, ThreeWayOdds>();
  for (const raw of array(tournament?.fixtureList)) {
    const parsed = parseStakeFixture(raw, fixtures);
    if (parsed) {
      result.set(getModelFixtureKey(parsed.fixture), parsed.odds);
    }
  }
  return result;
}

async function fetchPolymarketOddsBySlug(slug: string, fixture: ModelFixture): Promise<ThreeWayOdds | null> {
  const payload = await jsonFetch(`${POLYMARKET_URL}?slug=${encodeURIComponent(slug)}`, {
    headers: { Accept: "application/json" },
  });
  for (const event of array(payload)) {
    const odds = parsePolymarketEvent(event, fixture);
    if (odds) return odds;
  }
  return null;
}

/** Longest first: the fuller name is the more distinctive search term. */
function searchNameCandidates(team: string): string[] {
  const canonical = normalizeTeamName(team);
  const aliases = getTeamNameAliases()
    .filter(([, target]) => normalizeTeamName(target) === canonical)
    .map(([alias]) => alias)
    .sort((a, b) => b.length - a.length);
  return [...new Set([team, ...aliases])];
}

const POLYMARKET_QUERIES_PER_FIXTURE = 2;

/**
 * Search strings to try for one fixture, most promising first.
 *
 * The model carries ClubElo's abbreviated names ("St Gillis", "Bodoe Glimt"),
 * which are the weakest possible query against a venue that titles its events
 * with full club names. The alias table already holds the longer forms the rest
 * of football uses, so the second attempt is built from those. Capped, because
 * this is one request per attempt per fixture.
 */
export function polymarketSearchQueries(fixture: ModelFixture): string[] {
  const homes = searchNameCandidates(fixture.home);
  const aways = searchNameCandidates(fixture.away);
  const queries: string[] = [];
  for (let index = 0; index < Math.max(homes.length, aways.length); index += 1) {
    queries.push(`${homes[Math.min(index, homes.length - 1)]} `
      + `${aways[Math.min(index, aways.length - 1)]}`);
  }
  return [...new Set(queries)].slice(0, POLYMARKET_QUERIES_PER_FIXTURE);
}

export async function fetchPolymarketOdds(fixtures: ModelFixture[]): Promise<Map<string, ThreeWayOdds>> {
  const result = new Map<string, ThreeWayOdds>();
  let firstError: unknown = null;
  for (const fixture of fixtures) {
    try {
      for (const search of polymarketSearchQueries(fixture)) {
        const payload = record(await jsonFetch(
          `${POLYMARKET_SEARCH_URL}?q=${encodeURIComponent(search)}`,
          { headers: { Accept: "application/json" } }
        ));
        for (const raw of array(payload?.events)) {
          const event = record(raw);
          if (!event || !eventMatchesFixture(event, fixture)) continue;
          let odds = parsePolymarketEvent(event, fixture);
          if (!odds && typeof event.slug === "string" && event.slug) {
            odds = await fetchPolymarketOddsBySlug(event.slug, fixture).catch(() => null);
          }
          if (odds) {
            result.set(getModelFixtureKey(fixture), odds);
            break;
          }
        }
        if (result.has(getModelFixtureKey(fixture))) break;
      }
    } catch (error) {
      firstError = firstError ?? error;
    }
  }
  if (result.size === 0 && firstError !== null) throw firstError;
  return result;
}

const KALSHI_MAX_PAGES = 3;

export async function fetchKalshiOdds(
  fixtures: ModelFixture[],
  profile: MarketProfile
): Promise<Map<string, ThreeWayOdds>> {
  const seriesTicker = MARKET_SOURCE_PROFILES[profile].kalshi.seriesTicker;
  const result = new Map<string, ThreeWayOdds>();
  if (!seriesTicker) return result;

  let cursor = "";
  let pages = 0;
  do {
    const params = new URLSearchParams({
      series_ticker: seriesTicker,
      status: "open",
      with_nested_markets: "true",
      limit: "200",
    });
    if (cursor) params.set("cursor", cursor);
    const payload = record(await jsonFetch(`${KALSHI_URL}?${params}`, {
      headers: { Accept: "application/json" },
    }));
    for (const event of array(payload?.events)) {
      for (const fixture of fixtures) {
        const odds = parseKalshiEvent(event, fixture);
        if (odds) result.set(getModelFixtureKey(fixture), odds);
      }
    }
    cursor = typeof payload?.cursor === "string" ? payload.cursor : "";
    pages += 1;
  } while (cursor && pages < KALSHI_MAX_PAGES);
  return result;
}

export type MarketSourceName = "stake" | "polymarket" | "kalshi";

/**
 * Sources switched off, and why. A disabled source is not queried at all, so it
 * stops spending a request per refresh on a call that cannot succeed, and its
 * empty coverage is reported as deliberate rather than as a failure to chase.
 *
 * Stake answers the GraphQL endpoint with a Cloudflare interstitial (HTTP 403,
 * "Just a moment..."), for every fixture, regardless of tournament slug. Getting
 * around that is bot-detection circumvention, so the source stays off until
 * there is a supported way in. Removing the key here re-enables it.
 */
export const DISABLED_SOURCES: Partial<Record<MarketSourceName, string>> = {
  stake: "Stake serves a Cloudflare challenge (HTTP 403) instead of the odds API",
};

export function disabledSourceReason(source: MarketSourceName): string | null {
  return DISABLED_SOURCES[source] ?? null;
}

export interface MarketOddsFetch {
  odds: Record<MarketSourceName, Map<string, ThreeWayOdds>>;
  /**
   * Why a source came back empty, when the cause was the request rather than
   * the matching. A blocked or failing source and one that answered fine and
   * matched nothing are indistinguishable in a coverage count, and reporting
   * the first as the second sends whoever reads it hunting a matching bug for a
   * request that never succeeded -- Stake's Cloudflare 403 did exactly that.
   */
  errors: Record<MarketSourceName, string | null>;
}

function firstRejection(results: PromiseSettledResult<unknown>[]): string | null {
  for (const result of results) {
    if (result.status === "rejected") {
      const reason = result.reason;
      return reason instanceof Error ? reason.message : String(reason);
    }
  }
  return null;
}

export async function fetchAllMarketOdds(
  fixtures: ModelFixture[]
): Promise<MarketOddsFetch> {
  const grouped = fixturesByMarketProfile(fixtures);
  const stakeResults = disabledSourceReason("stake")
    ? []
    : await Promise.allSettled(
      [...grouped.entries()].map(([profile, profileFixtures]) =>
        fetchStakeOdds(profileFixtures, profile))
    );
  const kalshiResults = await Promise.allSettled(
    [...grouped.entries()].map(([profile, profileFixtures]) =>
      fetchKalshiOdds(profileFixtures, profile))
  );
  const stake = new Map<string, ThreeWayOdds>();
  const kalshi = new Map<string, ThreeWayOdds>();
  for (const result of stakeResults) {
    if (result.status === "fulfilled") {
      for (const [key, odds] of result.value) stake.set(key, odds);
    }
  }
  for (const result of kalshiResults) {
    if (result.status === "fulfilled") {
      for (const [key, odds] of result.value) kalshi.set(key, odds);
    }
  }
  // Settled like the others. Awaited bare, a Polymarket failure propagated out
  // of here and aborted the whole refresh, discarding the Stake and Kalshi
  // results already in hand -- one source's outage cost all three.
  const [polymarketResult] = await Promise.allSettled([fetchPolymarketOdds(fixtures)]);
  const polymarket = polymarketResult.status === "fulfilled"
    ? polymarketResult.value
    : new Map<string, ThreeWayOdds>();

  return {
    odds: { stake, polymarket, kalshi },
    errors: {
      stake: stake.size > 0 ? null : firstRejection(stakeResults),
      kalshi: kalshi.size > 0 ? null : firstRejection(kalshiResults),
      polymarket: polymarket.size > 0 ? null : firstRejection([polymarketResult]),
    },
  };
}

/**
 * Whether a source is configured to be queried at all for a competition
 * profile. Kalshi needs a series ticker; all three profiles now carry one, so
 * this only bites a profile added without one, for which `fetchKalshiOdds`
 * returns an empty map without issuing a request. Reported separately from a
 * query that ran and matched
 * nothing: the two look identical in a coverage count but mean opposite things,
 * and conflating them sends whoever reads it debugging a request that was never
 * made.
 */
export function isSourceConfiguredForProfile(
  source: MarketSourceName,
  profile: MarketProfile
): boolean {
  if (source === "kalshi") {
    return MARKET_SOURCE_PROFILES[profile].kalshi.seriesTicker !== null;
  }
  return true;
}

/** Competition profiles represented in an active fixture set. */
export function marketProfilesForFixtures(fixtures: ModelFixture[]): MarketProfile[] {
  return [...fixturesByMarketProfile(fixtures).keys()];
}

// Legacy key helper kept for tests.
export function legacyMarketOddsFixtureKey(date: string, home: string, away: string): string {
  return modelFixtureKey("legacy", date, home, away);
}
