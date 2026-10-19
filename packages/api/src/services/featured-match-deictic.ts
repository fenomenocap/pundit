import { normalizeTeamText } from "../lib/team-names";

const NON_FIXTURE_VS_RIGHT = /^(?:the\s+)?(?:market|book|books|bookmaker|bookmakers|sportsbook|sportsbooks|odds|line|lines)(?:\s|$)/i;

/** "edge vs the market" and similar — not a second fixture leg. */
export function isNonFixtureVersusTarget(rightSide: string): boolean {
  const normalized = rightSide.trim().toLowerCase().replace(/\s+/g, " ");
  return NON_FIXTURE_VS_RIGHT.test(normalized);
}

/** Desk/homepage wording that means the lead featured priced fixture, not an unconfirmed matchup. */
export function referencesFeaturedMatchDeictic(question: string): boolean {
  const q = question.toLowerCase();
  if (/\b(?:today'?s?|tonight'?s?)\s+featured\s+match\b/.test(q)) return true;
  if (/\b(?:today'?s?|tonight'?s?)\s+game\b/.test(q)) return true;
  if (/\b(?:this|the)\s+featured\s+match\b/.test(q)) return true;
  if (/\bthe\s+featured\s+game\b/.test(q)) return true;
  if (/\bthis\s+match\b/.test(q) && /\b(?:fair|price|odds|market|featured|card|slate|desk|homepage)\b/.test(q)) {
    return true;
  }
  if (/\bfeatured\s+match\b/.test(q) && /\b(?:today|tonight|homepage|on the (?:card|slate|desk))\b/.test(q)) return true;
  if (/\b(?:the\s+)?match\s+on\s+the\s+(?:featured\s+)?(?:card|slate)\b/.test(q)) return true;
  if (/\b(?:today'?s?|tonight'?s?)\s+match\s+on\s+the\s+(?:card|slate|desk)\b/.test(q)) return true;
  return false;
}
