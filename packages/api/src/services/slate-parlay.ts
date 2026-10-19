import { getTeamNameAliases, normalizeTeamName, normalizeTeamText } from "../lib/team-names";
import { MODEL_EDGE_CLAIMS_ALLOWED } from "../config/backtest-gate";
import { PUNDIT_FUNDAMENTAL_MODEL_VERSION } from "./model-contributors";
import type { ModelFixture } from "./model-data";
import { getCachedModelData } from "./model-data";
import { getCachedFixtureMarketOdds } from "./model-market-odds";

const NON_FIXTURE_VS_RIGHT = /^(?:the\s+)?(?:market|book|books|bookmaker|bookmakers|sportsbook|sportsbooks|odds|line|lines)(?:\s|$)/i;

export function isNonFixtureVersusTarget(rightSide: string): boolean {
  const normalized = rightSide.trim().toLowerCase().replace(/\s+/g, " ");
  return NON_FIXTURE_VS_RIGHT.test(normalized);
}

export function referencesFeaturedMatchDeictic(question: string): boolean {
  const q = question.toLowerCase();
  if (/\b(?:today'?s?|tonight'?s?)\s+featured\s+match\b/.test(q)) return true;
  if (/\bfeatured\s+match\b/.test(q) && /\b(?:today|tonight|homepage|on the (?:card|slate|desk))\b/.test(q)) return true;
  if (/\b(?:the\s+)?match\s+on\s+the\s+(?:featured\s+)?(?:card|slate)\b/.test(q)) return true;
  if (/\b(?:today'?s?|tonight'?s?)\s+match\s+on\s+the\s+(?:card|slate|desk)\b/.test(q)) return true;
  return false;
}

export function isSlateParlayRequest(question: string): boolean {
  if (/\bin general\b/i.test(question)) return false;
  const bettingShape = /\b(?:parlay|acca|accumulator)\b/i.test(question)
    || /\b\d+[\s-]*fold\b/i.test(question)
    || /\b(?:five|four|three|two)[\s-]*fold\b/i.test(question);
  if (!bettingShape) return false;
  return /\b(?:today|tonight|slate|card|desk|kick[\s-]?offs?|matches?|fixtures?|combined|price|prices|odds|\d+\s*pm)\b/i.test(question);
}

function teamSearchTerms(fixtures: ModelFixture[]): Array<[string, string]> {
  const teams = new Set<string>();
  for (const fixture of fixtures) {
    teams.add(fixture.home);
    teams.add(fixture.away);
  }
  const searchTerms = new Map<string, string>();
  for (const team of teams) {
    const canonical = normalizeTeamName(team);
    searchTerms.set(normalizeTeamText(team), team);
    searchTerms.set(canonical, team);
    for (const [alias, aliasCanonical] of getTeamNameAliases()) {
      if (normalizeTeamName(aliasCanonical) === canonical) {
        searchTerms.set(normalizeTeamText(alias), team);
      }
    }
  }
  return [...searchTerms.entries()].sort(([a], [b]) => b.length - a.length);
}

function mentionedTeams(question: string, fixtures: ModelFixture[]): string[] {
  const normalizedQuestion = normalizeTeamText(question);
  const teamPositions = new Map<string, number>();
  for (const [term, team] of teamSearchTerms(fixtures)) {
    const position = normalizedQuestion.indexOf(term);
    if (position === -1) continue;
    const previous = teamPositions.get(team);
    if (previous === undefined || position < previous) teamPositions.set(team, position);
  }
  return [...teamPositions.entries()]
    .sort(([, a], [, b]) => a - b)
    .map(([team]) => team);
}

function findPricedFixture(teamA: string, teamB: string, fixtures: ModelFixture[]): ModelFixture | undefined {
  const a = normalizeTeamName(teamA);
  const b = normalizeTeamName(teamB);
  return fixtures.find((fixture) => {
    const home = normalizeTeamName(fixture.home);
    const away = normalizeTeamName(fixture.away);
    return (home === a && away === b) || (home === b && away === a);
  });
}

/** Named multi-match acca, e.g. "Spurs to beat Coventry and Arsenal to beat Everton". */
export function isCrossGameParlayRequest(question: string, slate: ModelFixture[] = getDeskPricedSlate()): boolean {
  if (/\bin general\b/i.test(question)) return false;
  const segments = question.split(/\band\b/i).filter((part) => /\bto\s+(?:beat|win)\b/i.test(part));
  if (segments.length >= 2) return true;
  if (/\b(?:parlay|acca|accumulator)\b/i.test(question) && mentionedTeams(question, slate).length >= 4) {
    return true;
  }
  return false;
}

export function isDeskParlayRequest(question: string): boolean {
  return isSlateParlayRequest(question) || isCrossGameParlayRequest(question);
}

interface ParsedCrossLeg {
  pick: string;
  opponent: string;
}

export function resolveClubNameOnSlate(raw: string, slate: ModelFixture[]): string | null {
  const normalized = normalizeTeamText(raw.trim());
  for (const [term, team] of teamSearchTerms(slate)) {
    if (term === normalized) return team;
  }
  let best: string | null = null;
  let bestLen = 0;
  for (const [term, team] of teamSearchTerms(slate)) {
    if (normalized.includes(term) && term.length > bestLen) {
      best = team;
      bestLen = term.length;
    }
  }
  return best;
}

function parseCrossGameLegs(question: string): ParsedCrossLeg[] {
  const legs: ParsedCrossLeg[] = [];
  const segmentPattern = /^(.*?)\s+to\s+(?:beat|win(?:\s+against)?)\s+(.+)$/i;
  for (const segment of question.split(/\band\b/i)) {
    const match = segmentPattern.exec(segment.trim());
    if (match) {
      legs.push({ pick: match[1].trim(), opponent: match[2].trim().replace(/[?.!,]+$/g, "") });
    }
  }
  return legs;
}

export function londonCalendarDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(date);
}

export function kickoffHourLondon(utcDate: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    hour12: false,
    timeZone: "Europe/London",
  }).format(new Date(utcDate)));
}

export function formatKickoffUk(utcDate: string): string {
  const date = new Date(utcDate);
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  }).format(date);
  return `${day}, ${time} UK`;
}

export function formatObservedUk(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  }).format(date);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function fairDecimal(probability: number): string {
  return (1 / probability).toFixed(2);
}

export function parseParlayLegCount(question: string): number {
  const fold = /\b(\d+)[\s-]*fold\b/i.exec(question)?.[1]
    ?? (/\bfive[\s-]*fold\b/i.test(question) ? "5" : null)
    ?? (/\bfour[\s-]*fold\b/i.test(question) ? "4" : null)
    ?? (/\bthree[\s-]*fold\b/i.test(question) ? "3" : null)
    ?? (/\btwo[\s-]*fold\b/i.test(question) ? "2" : null);
  if (fold) return Math.min(Math.max(Number.parseInt(fold, 10), 2), 6);
  const explicit = /\b(\d+)[\s-]*leg\b/i.exec(question)?.[1];
  if (explicit) return Math.min(Math.max(Number.parseInt(explicit, 10), 2), 6);
  if (/\b(?:two|2)[\s-]*leg\b/i.test(question)) return 2;
  if (/\bthree[\s-]*leg\b/i.test(question) || /\b3[\s-]*leg\b/i.test(question)) return 3;
  return 2;
}

function requestedKickoffHourLondon(question: string): number | null {
  if (/\b3\s*pm\b/i.test(question)) return 15;
  const clock = /\b(\d{1,2}):00\b/.exec(question);
  if (clock) return Number.parseInt(clock[1], 10);
  return null;
}

function isPricedFixture(row: ModelFixture): boolean {
  return Number.isFinite(row.pHome) && Number.isFinite(row.pDraw) && Number.isFinite(row.pAway);
}

/** Full desk slate: every priced active model row, soonest kickoff first. */
export function getDeskPricedSlate(): ModelFixture[] {
  const { fixtures } = getCachedModelData();
  return fixtures
    .filter(isPricedFixture)
    .sort((left, right) => new Date(left.utcDate).getTime() - new Date(right.utcDate).getTime());
}

type OutcomeKey = "home" | "draw" | "away";

function favouriteOutcome(fixture: ModelFixture): {
  label: string;
  p: number;
  outcome: OutcomeKey;
} {
  const legs = [
    { label: fixture.home, p: fixture.pHome, outcome: "home" as const },
    { label: "the draw", p: fixture.pDraw, outcome: "draw" as const },
    { label: fixture.away, p: fixture.pAway, outcome: "away" as const },
  ];
  const best = legs.sort((left, right) => right.p - left.p)[0];
  return best;
}

interface MarketThreeWay {
  source: string;
  observedAt: string;
  pHome: number;
  pDraw: number;
  pAway: number;
}

interface MarketLegQuote {
  source: string;
  observedAt: string;
  p: number;
  decimal: number;
}

function completeThreeWay(
  source: string,
  observedAt: string,
  pHome: number | null | undefined,
  pDraw: number | null | undefined,
  pAway: number | null | undefined
): MarketThreeWay | null {
  if (![pHome, pDraw, pAway].every((value) => Number.isFinite(value) && value! > 0 && value! < 1)) {
    return null;
  }
  return { source, observedAt, pHome: pHome!, pDraw: pDraw!, pAway: pAway! };
}

function marketQuoteForFavourite(fixture: ModelFixture, outcome: OutcomeKey): MarketLegQuote | null {
  const cached = getCachedFixtureMarketOdds(fixture);
  const candidates: Array<MarketThreeWay | null> = [];
  if (cached?.stake) {
    candidates.push(completeThreeWay("Stake", cached.observedAt, cached.stake.pHome, cached.stake.pDraw, cached.stake.pAway));
  }
  if (cached?.kalshi) {
    candidates.push(completeThreeWay("Kalshi", cached.observedAt, cached.kalshi.pHome, cached.kalshi.pDraw, cached.kalshi.pAway));
  }
  if (cached?.polymarket) {
    candidates.push(completeThreeWay("Polymarket", cached.observedAt, cached.polymarket.pHome, cached.polymarket.pDraw, cached.polymarket.pAway));
  }
  if (fixture.stakePHome != null && fixture.stakePDraw != null && fixture.stakePAway != null) {
    const observedAt = cached?.observedAt ?? fixture.forecastProvenance?.forecastAt ?? fixture.utcDate;
    candidates.push(completeThreeWay("Stake", observedAt, fixture.stakePHome, fixture.stakePDraw, fixture.stakePAway));
  }
  const row = candidates.find((entry) => entry != null) ?? null;
  if (!row) return null;
  const p = outcome === "home" ? row.pHome : outcome === "draw" ? row.pDraw : row.pAway;
  if (!Number.isFinite(p)) return null;
  return {
    source: row.source,
    observedAt: row.observedAt,
    p,
    decimal: 1 / p,
  };
}

function outcomeForPick(
  fixture: ModelFixture,
  pick: string
): { label: string; p: number; outcome: OutcomeKey } | null {
  const pickKey = normalizeTeamName(pick);
  if (pickKey === normalizeTeamName(fixture.home)) {
    return { label: fixture.home, p: fixture.pHome, outcome: "home" };
  }
  if (pickKey === normalizeTeamName(fixture.away)) {
    return { label: fixture.away, p: fixture.pAway, outcome: "away" };
  }
  return null;
}

function fixtureHasAnyMarketQuote(fixture: ModelFixture): boolean {
  if (marketQuoteForFavourite(fixture, "home")
    || marketQuoteForFavourite(fixture, "draw")
    || marketQuoteForFavourite(fixture, "away")) {
    return true;
  }
  const cached = getCachedFixtureMarketOdds(fixture);
  return Boolean(cached?.stake || cached?.kalshi || cached?.polymarket);
}

function oneLineReason(fixture: ModelFixture, favourite: { label: string; p: number }): string {
  const gap = Math.abs(fixture.homeElo - fixture.awayElo);
  const stronger = fixture.homeElo >= fixture.awayElo ? fixture.home : fixture.away;
  if (favourite.label === "the draw" || gap < 15) {
    return "ratings keep the 1X2 tight";
  }
  const degree = gap < 50 ? "slightly" : gap < 120 ? "clearly" : "well";
  if (favourite.label === fixture.home && fixture.homeElo >= fixture.awayElo) {
    return `${stronger} ${degree} ahead on ratings at home`;
  }
  if (favourite.label === fixture.away && fixture.awayElo > fixture.homeElo) {
    return `${stronger} ${degree} ahead on ratings away`;
  }
  return `${favourite.label} lead on team strength`;
}

export interface SlateLegSelection {
  legs: ModelFixture[];
  fillNotice: string | null;
  kickoffHourNotice: string | null;
}

export function selectSlateLegsForParlay(
  question: string,
  slate: ModelFixture[],
  now: Date = new Date()
): SlateLegSelection | null {
  const requestedLegs = parseParlayLegCount(question);
  const fullPool = slate.filter(isPricedFixture).sort(
    (left, right) => new Date(left.utcDate).getTime() - new Date(right.utcDate).getTime()
  );
  let pool = fullPool;
  let kickoffHourNotice: string | null = null;
  const kickoffHour = requestedKickoffHourLondon(question);
  if (kickoffHour != null) {
    const label = kickoffHour === 15 ? "3pm" : `${kickoffHour}:00`;
    const atKickoff = fullPool.filter((row) => kickoffHourLondon(row.utcDate) === kickoffHour);
    if (atKickoff.length === 0) {
      kickoffHourNotice = `There are no ${label} kick-offs on the desk; legs use the next priced fixtures instead.`;
    } else if (atKickoff.length < requestedLegs) {
      const seen = new Set(atKickoff.map((row) => row.fixtureId));
      const extra = fullPool.filter((row) => !seen.has(row.fixtureId));
      pool = [...atKickoff, ...extra];
      kickoffHourNotice = `Only ${atKickoff.length} ${label} kick-off${atKickoff.length === 1 ? "" : "s"}; legs ${atKickoff.length + 1}–${requestedLegs} are from the next fixtures.`;
    } else {
      pool = atKickoff;
    }
  }

  const wantsToday = /\b(?:today|tonight)\b/i.test(question);
  const todayKey = londonCalendarDate(now);
  let fillNotice: string | null = kickoffHourNotice;
  let legs: ModelFixture[] = [];

  if (wantsToday) {
    const todayMatches = pool.filter((row) => londonCalendarDate(row.utcDate) === todayKey);
    const later = pool.filter((row) => londonCalendarDate(row.utcDate) !== todayKey);
    legs = [...todayMatches];
    for (const row of later) {
      if (legs.length >= requestedLegs) break;
      legs.push(row);
    }
    legs = legs.slice(0, requestedLegs);
    if (todayMatches.length > 0 && legs.length > todayMatches.length) {
      fillNotice = [
        fillNotice,
        `Only ${todayMatches.length} match${todayMatches.length === 1 ? "" : "es"} today; legs ${todayMatches.length + 1}–${legs.length} are from the next fixtures.`,
      ].filter(Boolean).join(" ");
    } else if (todayMatches.length === 0 && legs.length > 0) {
      fillNotice = [
        fillNotice,
        "No matches kick off today; all legs are from the next fixtures on the desk.",
      ].filter(Boolean).join(" ");
    }
  } else {
    legs = pool.slice(0, requestedLegs);
  }

  if (legs.length < 2) return null;
  return { legs, fillNotice, kickoffHourNotice };
}

function pricedAtLabel(fixture: ModelFixture): string {
  return fixture.forecastProvenance?.forecastAt ?? fixture.utcDate;
}

export function composeSlateParlayAnswer(
  question: string,
  slate: ModelFixture[] = getDeskPricedSlate(),
  now: Date = new Date()
): string | null {
  if (!isSlateParlayRequest(question)) return null;
  const selection = selectSlateLegsForParlay(question, slate, now);
  if (!selection) return null;
  const { legs, fillNotice } = selection;
  const legOutcomes = legs.map((fixture) => ({ fixture, fav: favouriteOutcome(fixture) }));
  const foldLabel = legs.length === 2 ? "two-leg" : `${legs.length}-fold`;
  return composeParlayAnswerBody(question, legs, legOutcomes, fillNotice, foldLabel);
}

function composeParlayAnswerBody(
  question: string,
  legs: ModelFixture[],
  legOutcomes: Array<{ fixture: ModelFixture; fav: { label: string; p: number; outcome: OutcomeKey } }>,
  fillNotice: string | null,
  foldLabel: string
): string {
  const combined = legOutcomes.reduce((product, row) => product * row.fav.p, 1);
  const marketRows = legOutcomes.map(({ fixture, fav }) => ({
    fixture,
    fav,
    market: marketQuoteForFavourite(fixture, fav.outcome),
  }));
  const withMarket = marketRows.filter((row) => row.market != null);
  const sharedMarket = withMarket.length === legs.length
    && withMarket.every((row) => row.market!.source === withMarket[0].market!.source
      && row.market!.observedAt === withMarket[0].market!.observedAt)
    ? withMarket[0].market!
    : null;

  const pricedAt = pricedAtLabel(legs[0]);
  const metaParts = [
    `Fundamental ${PUNDIT_FUNDAMENTAL_MODEL_VERSION}`,
    `priced ${pricedAt.slice(0, 16).replace("T", " ")} UTC`,
  ];
  if (sharedMarket) {
    metaParts.push(`${sharedMarket.source} as of ${formatObservedUk(sharedMarket.observedAt)} UK`);
  } else if (withMarket.length === 0 && !legs.some(fixtureHasAnyMarketQuote)) {
    metaParts.push("fair price only (no live market quote)");
  }

  const pickSummary = legOutcomes.map(({ fixture, fav }) =>
    `${fav.label} (${fixture.home} v ${fixture.away})`
  ).join(", ");
  const lead = `My ${foldLabel}: ${pickSummary}, combined fair ~${fairDecimal(combined)}. ${metaParts.join(" · ")}.`;

  const legLines = marketRows.map(({ fixture, fav, market }) => {
    const kickoff = formatKickoffUk(fixture.utcDate);
    const modelBit = `model ${pct(fav.p)} (fair ${fairDecimal(fav.p)})`;
    let marketBit = "";
    if (market) {
      if (!sharedMarket) {
        marketBit = ` · market ${pct(market.p)} (${market.decimal.toFixed(2)}) ${market.source} as of ${formatObservedUk(market.observedAt)} UK`;
      } else {
        marketBit = ` · market ${pct(market.p)} (${market.decimal.toFixed(2)})`;
      }
    }
    return `${kickoff} · ${fixture.home} v ${fixture.away}: ${fav.label} ${modelBit}${marketBit} — ${oneLineReason(fixture, fav)}.`;
  });

  let marketCombined: string | null = null;
  if (withMarket.length === legs.length) {
    const marketProduct = marketRows.reduce((product, row) => product * (row.market?.p ?? 1), 1);
    marketCombined = `Market combined ~${fairDecimal(marketProduct)} (${pct(marketProduct)}).`;
  }

  const tail = "Correlation: same-day and league context can move these legs together.";
  const blocks = [fillNotice, lead, ...legLines, marketCombined, tail].filter(Boolean);
  let answer = blocks.join("\n");
  if (!MODEL_EDGE_CLAIMS_ALLOWED && /\bedge\b/i.test(answer)) {
    answer = answer.replace(/\bedge\b/gi, "gap");
  }
  return answer;
}

export function composeCrossGameParlayAnswer(
  question: string,
  slate: ModelFixture[] = getDeskPricedSlate()
): string | null {
  if (!isCrossGameParlayRequest(question, slate)) return null;
  const parsed = parseCrossGameLegs(question);
  if (parsed.length < 2) return null;
  const legOutcomes: Array<{ fixture: ModelFixture; fav: { label: string; p: number; outcome: OutcomeKey } }> = [];
  for (const leg of parsed) {
    const pick = resolveClubNameOnSlate(leg.pick, slate) ?? leg.pick;
    const opponent = resolveClubNameOnSlate(leg.opponent, slate) ?? leg.opponent;
    const fixture = findPricedFixture(pick, opponent, slate)
      ?? findPricedFixture(opponent, pick, slate);
    if (!fixture) return null;
    const outcome = outcomeForPick(fixture, pick);
    if (!outcome) return null;
    legOutcomes.push({ fixture, fav: outcome });
  }
  const foldLabel = legOutcomes.length === 2 ? "two-leg" : `${legOutcomes.length}-fold`;
  return composeParlayAnswerBody(question, legOutcomes.map((row) => row.fixture), legOutcomes, null, foldLabel);
}

export function composeDeskParlayAnswer(
  question: string,
  slate: ModelFixture[] = getDeskPricedSlate(),
  now: Date = new Date()
): string | null {
  const cross = composeCrossGameParlayAnswer(question, slate);
  if (cross) return cross;
  return composeSlateParlayAnswer(question, slate, now);
}

export function slateParlayFailClosedAnswer(): string {
  return "I don't have enough priced fixtures on the desk to build that parlay without inventing legs.";
}
