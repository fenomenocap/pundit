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
  if (!/\b(?:parlay|acca|accumulator)\b/i.test(question)) return false;
  return /\b(?:today|tonight|slate|card|desk|matches?|fixtures?|combined|price|prices|odds)\b/i.test(question);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function fairDecimal(probability: number): string {
  return (1 / probability).toFixed(2);
}

function parseParlayLegCount(question: string): number {
  const explicit = /\b(\d+)[\s-]*leg\b/i.exec(question)?.[1];
  if (explicit) return Math.min(Math.max(Number.parseInt(explicit, 10), 2), 6);
  if (/\b(?:two|2)[\s-]*leg\b/i.test(question)) return 2;
  if (/\bthree[\s-]*leg\b/i.test(question) || /\b3[\s-]*leg\b/i.test(question)) return 3;
  return 2;
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
  const legCount = parseParlayLegCount(question);
  if (priced.length < legCount) return null;

  const legs = priced.slice(0, legCount);
  const framing = legCount === 2
    ? "Here is a two-leg model read from today’s priced desk slate — fair prices from my 1X2, not a bookmaker ticket."
    : `Here is a ${legCount}-leg model read from today’s priced desk slate — fair prices from my 1X2, not a bookmaker ticket.`;

  const lines = legs.map((fixture) => {
    const fav = favouriteOutcome(fixture);
    return `${fixture.home} v ${fixture.away}: ${fav.label} at ${pct(fav.p)} (fair ${fairDecimal(fav.p)}) — ${oneLineReason(fixture, fav)}.`;
  });

  const combined = legs.reduce((product, fixture) => product * favouriteOutcome(fixture).p, 1);
  const tail = [
    `Combined model probability ${pct(combined)} (fair combined decimal about ${fairDecimal(combined)}).`,
    "These legs are not independent; shared league context and same-day scheduling mean correlation is material and not priced in this product.",
  ];

  return [framing, ...lines, ...tail].join("\n");
}
