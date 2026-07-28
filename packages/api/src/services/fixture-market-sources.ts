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
    kalshi: { seriesTicker: null },
  },
  "uefa-champions-league": {
    stake: {
      category: "international-clubs",
      tournament: "uefa-champions-league",
      referer: "https://stake.bet/sports/soccer/international-clubs/uefa-champions-league",
    },
    kalshi: { seriesTicker: null },
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

function teamSearchTerms(team: string): string[] {
  const canonical = normalizeTeamName(team);
  return [team, ...getTeamNameAliases()
    .filter(([, target]) => normalizeTeamName(target) === canonical)
    .map(([alias]) => alias)]
    .map(normalizeTeamText);
}

function eventMatchesFixture(event: UnknownRecord, fixture: ModelFixture): boolean {
  const text = normalizeTeamText(["title", "subtitle", "sub_title", "slug"]
    .map((key) => String(event[key] ?? ""))
    .join(" "));
  return [fixture.home, fixture.away].every((team) =>
    teamSearchTerms(team).some((term) => text.includes(term))
  );
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
      const key = selection(String(market.groupItemTitle ?? ""), fixture)
        ?? selection(String(market.yes_sub_title ?? ""), fixture);
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

function kalshiSelection(label: string, fixture: ModelFixture): "home" | "draw" | "away" | null {
  const direct = selection(label, fixture);
  if (direct) return direct;
  const text = normalizeTeamText(label);
  const matches: Array<"home" | "draw" | "away"> = [];
  if (teamSearchTerms(fixture.home).some((term) => text.includes(term))) matches.push("home");
  if (teamSearchTerms(fixture.away).some((term) => text.includes(term))) matches.push("away");
  if (/\b(tie|draw)\b/.test(text)) matches.push("draw");
  return matches.length === 1 ? matches[0] : null;
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
    const key = kalshiSelection(String(market.yes_sub_title ?? market.subtitle ?? ""), fixture);
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

export async function fetchPolymarketOdds(fixtures: ModelFixture[]): Promise<Map<string, ThreeWayOdds>> {
  const result = new Map<string, ThreeWayOdds>();
  let firstError: unknown = null;
  for (const fixture of fixtures) {
    try {
      const query = encodeURIComponent(`${fixture.home} ${fixture.away}`);
      const payload = record(await jsonFetch(`${POLYMARKET_SEARCH_URL}?q=${query}`, {
        headers: { Accept: "application/json" },
      }));
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

export async function fetchAllMarketOdds(
  fixtures: ModelFixture[]
): Promise<Record<"stake" | "polymarket" | "kalshi", Map<string, ThreeWayOdds>>> {
  const grouped = fixturesByMarketProfile(fixtures);
  const stakeResults = await Promise.allSettled(
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
  const polymarket = await fetchPolymarketOdds(fixtures);
  return { stake, polymarket, kalshi };
}

// Legacy key helper kept for tests.
export function legacyMarketOddsFixtureKey(date: string, home: string, away: string): string {
  return modelFixtureKey("legacy", date, home, away);
}
