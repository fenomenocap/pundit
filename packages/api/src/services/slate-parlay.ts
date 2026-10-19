import type { ModelFixture } from "./model-data";
import { getFeaturedModelFixtures } from "./featured-fixtures";

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

export function kickoffHourLondon(utcDate: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    hour12: false,
    timeZone: "Europe/London",
  }).format(new Date(utcDate)));
}

function favouriteOutcome(fixture: ModelFixture): {
  label: string;
  p: number;
} {
  const legs = [
    { label: fixture.home, p: fixture.pHome },
    { label: "the draw", p: fixture.pDraw },
    { label: fixture.away, p: fixture.pAway },
  ];
  return legs.sort((left, right) => right.p - left.p)[0];
}

function oneLineReason(fixture: ModelFixture, favourite: { label: string; p: number }): string {
  const gap = Math.abs(fixture.homeElo - fixture.awayElo);
  const stronger = fixture.homeElo >= fixture.awayElo ? fixture.home : fixture.away;
  if (favourite.label === "the draw" || gap < 15) {
    return "the strength ratings keep this 1X2 tight";
  }
  const degree = gap < 50 ? "slightly" : gap < 120 ? "clearly" : "well";
  if (favourite.label === fixture.home && fixture.homeElo >= fixture.awayElo) {
    return `${stronger} are ${degree} ahead on ratings with home advantage`;
  }
  if (favourite.label === fixture.away && fixture.awayElo > fixture.homeElo) {
    return `${stronger} are ${degree} ahead on ratings despite the away trip`;
  }
  return `${favourite.label} lead the 1X2 on reviewed team strength`;
}

export function composeSlateParlayAnswer(
  question: string,
  slate: ModelFixture[] = getFeaturedModelFixtures()
): string | null {
  if (!isSlateParlayRequest(question)) return null;
  const priced = slate.filter((row) =>
    Number.isFinite(row.pHome) && Number.isFinite(row.pDraw) && Number.isFinite(row.pAway)
  );
  const requestedLegs = parseParlayLegCount(question);
  const kickoffHour = requestedKickoffHourLondon(question);
  let pool = priced;
  let kickoffNotice = "";
  if (kickoffHour != null) {
    const atKickoff = priced.filter((row) => kickoffHourLondon(row.utcDate) === kickoffHour);
    if (atKickoff.length === 0) {
      const label = kickoffHour === 15 ? "3pm" : `${kickoffHour}:00`;
      kickoffNotice = `There are no ${label} kick-offs on today's desk slate; this uses today's priced fixtures instead.\n\n`;
      pool = priced;
    } else {
      pool = atKickoff;
    }
  }
  const legCount = Math.min(requestedLegs, pool.length);
  if (legCount < 2) return null;

  const legs = pool.slice(0, legCount);
  const shortfall = requestedLegs > legCount
    ? ` (only ${legCount} priced legs available on the slate)`
    : "";
  const framing = legCount === 2
    ? `Here is a two-leg model read from today's priced desk slate${shortfall} — fair prices from my 1X2, not a bookmaker ticket.`
    : `Here is a ${legCount}-leg model read from today's priced desk slate${shortfall} — fair prices from my 1X2, not a bookmaker ticket.`;

  const lines = legs.map((fixture) => {
    const fav = favouriteOutcome(fixture);
    return `${fixture.home} v ${fixture.away}: ${fav.label} at ${pct(fav.p)} (fair ${fairDecimal(fav.p)}) — ${oneLineReason(fixture, fav)}.`;
  });

  const combined = legs.reduce((product, fixture) => product * favouriteOutcome(fixture).p, 1);
  const tail = [
    `Combined model probability ${pct(combined)} (fair combined decimal about ${fairDecimal(combined)}).`,
    "These legs are not independent; shared league context and same-day scheduling mean correlation is material and not priced in this product.",
  ];

  return [kickoffNotice + framing, ...lines, ...tail].filter(Boolean).join("\n");
}

export function slateParlayFailClosedAnswer(): string {
  return "I don't have enough priced fixtures on today's desk slate to build that parlay without inventing legs.";
}
