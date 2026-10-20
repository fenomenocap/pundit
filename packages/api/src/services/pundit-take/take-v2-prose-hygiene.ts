import { parseGapToken } from "./take-number-check";
import { repairIncompleteEvenClause } from "./take-prose-polish";
import type { PunditTakePlan, TakePlanNumericFacts } from "./types";

type TableSnapshot = TakePlanNumericFacts["table"] & {
  homePosition: number;
  awayPosition: number;
  homePoints: number;
  awayPoints: number;
  pointsClear: number;
  positionsApart: number;
};

/** Last-five league points needed to back vague positive form copy. */
export const VAGUE_POSITIVE_FORM_MIN_LAST5_POINTS = 7;
/** Last-five league points at or below which vague negative form copy is allowed. */
export const VAGUE_NEGATIVE_FORM_MAX_LAST5_POINTS = 4;

const RECENT_FORM_COMPARE =
  /\b(?:(?:better|stronger|worse|weaker|poorer)\s+(?:recent\s+)?form|(?:recent\s+)?form\s+is\s+with|in\s+(?:better|stronger|worse|weaker)\s+form)\b/i;

/** Club-form windows in the dossier are all-venues; no home/away split in current data. */
export function formDataHasVenueSplit(_plan: PunditTakePlan): boolean {
  return false;
}

const VENUE_FORM_CLAIM =
  /\b(?:away from home|on the road|(?:^|\s)at home(?:\s|$)|home form|away form)\b/i;
const FORM_STAT_CLAIM =
  /\b(?:last\s+(?:five|5|\d+)\b|\d+\s+goals?\b|managed\s+\d+\s+goals?)/i;

const LAST_N_VENUE_PHRASE =
  /\bin their last (five|5|\d+) (?:away from home|on the road|at home)\b/gi;
const OVER_LAST_N_VENUE =
  /\bover their last (five|5|\d+) (?:away from home|on the road|at home)\b/gi;
const MANAGED_GOALS_AWAY =
  /\b(managed\s+\d+\s+goals?\s+in their last (?:five|5|\d+)) (?:away from home|on the road|at home)\b/gi;

const VENUE_PERFORMANCE_PLACE =
  /\b(?:at home|away from home|on the road|on their travels|home form|away form)\b/i;

const VENUE_PERFORMANCE_ACTION =
  /\b(?:conceded|conceding|scored|scoring|won|wins|winning|lost|losing|grind|grinding|struggled|struggling|struggle)\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Headline and structured flip — never drop in hygiene passes. */
export function isProtectedTakeSentence(sentence: string, plan: PunditTakePlan): boolean {
  const t = sentence.trim();
  if (/^I'd shift if\b/i.test(t)) return true;
  if (new RegExp(`^${escapeRegExp(plan.fixtureLabel)}\\s*[—-]`).test(t)) return true;
  if (new RegExp(`^On ${escapeRegExp(plan.fixtureLabel)}, I have`).test(t)) return true;
  return false;
}

export function rewriteWinProbabilityPhrase(text: string): string {
  return text
    .replace(/\bwin probabilities\b/gi, "win chances")
    .replace(/\bwin probability\b/gi, "win chance");
}

/** Venue-tied performance narrative without split data (not neutral home-advantage copy). */
function fixtureSides(plan: PunditTakePlan): { home: string; away: string } | null {
  const parts = plan.fixtureLabel.split(/\s+v\s+/i);
  if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) return null;
  return { home: parts[0].trim(), away: parts[1].trim() };
}

export function sentenceComparesRecentForm(sentence: string): boolean {
  if (/\bgap in form\b/i.test(sentence)) return false;
  return RECENT_FORM_COMPARE.test(sentence);
}

function recentFormComparisonDirection(sentence: string): "better" | "worse" | null {
  if (/\b(?:worse|weaker|poorer)\s+(?:recent\s+)?form\b/i.test(sentence)) return "worse";
  if (/\bin\s+(?:worse|weaker|poorer)\s+form\b/i.test(sentence)) return "worse";
  if (/\b(?:better|stronger)\s+(?:recent\s+)?form\b/i.test(sentence)) return "better";
  if (/\bin\s+(?:better|stronger)\s+form\b/i.test(sentence)) return "better";
  if (/\bform\s+is\s+with\b/i.test(sentence)) return "better";
  return null;
}

function sideMentionedInFormSentence(
  sentence: string,
  sides: { home: string; away: string },
): "home" | "away" | null {
  if (/\bthe visitors\b/i.test(sentence)) return "away";
  if (/\bthe hosts\b/i.test(sentence) || /\bhome side\b/i.test(sentence)) return "home";
  if (/\baway side\b/i.test(sentence)) return "away";
  const lower = sentence.toLowerCase();
  const home = sides.home.toLowerCase();
  const away = sides.away.toLowerCase();
  const homeHit = lower.includes(home);
  const awayHit = lower.includes(away);
  if (homeHit && !awayHit) return "home";
  if (awayHit && !homeHit) return "away";
  const withMatch = sentence.match(
    /\bform\s+is\s+with\s+(?:the\s+)?([A-Za-z][A-Za-z\s'-]{0,40}?)(?:\s+who|\s+here|[,.!?]|$)/i,
  );
  if (withMatch?.[1]) {
    const name = withMatch[1].trim().toLowerCase();
    if (name.includes(home) || home.includes(name)) return "home";
    if (name.includes(away) || away.includes(name)) return "away";
  }
  return null;
}

function parseOrdinalPosition(token: string): number | null {
  const match = token.match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

function tableSnapshotReady(table: TakePlanNumericFacts["table"] | undefined): table is TableSnapshot {
  return table != null
    && table.homePosition != null
    && table.awayPosition != null
    && table.homePoints != null
    && table.awayPoints != null
    && table.pointsClear != null
    && table.positionsApart != null;
}

function positionForSide(side: "home" | "away", table: {
  homePosition: number;
  awayPosition: number;
}): number {
  return side === "home" ? table.homePosition : table.awayPosition;
}

function pointsForSide(side: "home" | "away", table: {
  homePoints: number;
  awayPoints: number;
}): number {
  return side === "home" ? table.homePoints : table.awayPoints;
}

function teamSideFromMention(
  text: string,
  sides: { home: string; away: string },
): "home" | "away" | null {
  const lower = text.toLowerCase();
  const home = sides.home.toLowerCase();
  const away = sides.away.toLowerCase();
  const homeHit = lower.includes(home);
  const awayHit = lower.includes(away);
  if (homeHit && !awayHit) return "home";
  if (awayHit && !homeHit) return "away";
  return null;
}

/** Grammatical subject at the start of the sentence (e.g. "Fulham sit …"). */
function primarySubjectSide(
  sentence: string,
  sides: { home: string; away: string },
): "home" | "away" | null {
  const lead = sentence.match(/^\s*([A-Za-z][A-Za-z\s'-]+?)\s+(?:sit|are|have|remain|look|come)\b/i);
  if (!lead?.[1]) return null;
  return teamSideFromMention(lead[1], sides);
}

function lastTeamSideBefore(
  text: string,
  sides: { home: string; away: string },
): "home" | "away" | null {
  const lower = text.toLowerCase();
  const homeIdx = lower.lastIndexOf(sides.home.toLowerCase());
  const awayIdx = lower.lastIndexOf(sides.away.toLowerCase());
  if (homeIdx === -1 && awayIdx === -1) return null;
  if (homeIdx >= awayIdx) return "home";
  return "away";
}

function sideForTableOrdinalClaim(
  sentence: string,
  matchIndex: number,
  sides: { home: string; away: string },
): "home" | "away" | null {
  const before = sentence.slice(0, matchIndex);
  const possessive = before.match(/([A-Za-z][A-Za-z\s'-]+?)[''\u2019]s\s*$/);
  if (possessive?.[1]) {
    const side = teamSideFromMention(possessive[1], sides);
    if (side) return side;
  }
  const primary = primarySubjectSide(sentence, sides);
  if (primary && /\bdespite being\b/i.test(before)) return primary;
  const nearest = lastTeamSideBefore(before, sides);
  if (nearest) return nearest;
  return primary;
}

function pointsGapMatches(
  subject: "home" | "away",
  reference: "home" | "away",
  statedGap: number,
  relation: "below" | "above" | "behind" | "clear",
  table: { homePoints: number; awayPoints: number },
): boolean {
  const subPts = pointsForSide(subject, table);
  const refPts = pointsForSide(reference, table);
  if (relation === "below" || relation === "behind") {
    return refPts - subPts === statedGap;
  }
  return subPts - refPts === statedGap;
}

function rankAbove(subject: "home" | "away", table: { homePosition: number; awayPosition: number }): boolean {
  return positionForSide(subject, table) < positionForSide(subject === "home" ? "away" : "home", table);
}

export function sentenceStatesTableStandingClaim(sentence: string): boolean {
  if (/\blevel on points\b/i.test(sentence)) return true;
  if (/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+points?\s+(?:below|above|behind|clear)\b/i.test(sentence)) {
    return true;
  }
  if (/\b(?:just\s+)?(?:a\s+)?point\s+(?:below|above|behind|clear)\b/i.test(sentence)) return true;
  if (/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:spots?|places?)\s+and\s+(?:one|a|\d+)\s+points?\s+(?:above|below|ahead|behind)\b/i.test(sentence)) {
    return true;
  }
  if (/\b(?:a|one|\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:spots?|places?)\s+(?:above|below|ahead|behind)\b/i.test(sentence)) {
    return true;
  }
  if (/\b(?:a|one)\s+(?:spot|place)\s+(?:above|below|ahead|behind)\b/i.test(sentence)) return true;
  if (/\b\d+(?:st|nd|rd|th)\s+on\s+\d+\b(?:\s+points?)?/i.test(sentence)) return true;
  if (/\b[A-Za-z][A-Za-z\s'-]+?[''\u2019]s\s+\d+(?:st|nd|rd|th)\s+on\s+\d+\b/i.test(sentence)) return true;
  if (/\b\d+(?:st|nd|rd|th)[- ]placed\b/i.test(sentence)) return true;
  if (/\bwho have \d+\b/i.test(sentence) && /\b(?:spot|place|points?|\d+(?:st|nd|rd|th))/i.test(sentence)) {
    return true;
  }
  return false;
}

/** Drop when LLM table/points/places language disagrees with numericFacts.table. */
export function sentenceFailsTableStandingSnapshotCheck(sentence: string, plan: PunditTakePlan): boolean {
  if (!sentenceStatesTableStandingClaim(sentence)) return false;
  const table = plan.numericFacts?.table;
  if (!tableSnapshotReady(table)) return true;
  const sides = fixtureSides(plan);
  if (!sides) return true;

  if (/\blevel on points\b/i.test(sentence) && table.homePoints !== table.awayPoints) {
    return true;
  }

  const ordinalOnPoints = /\b(\d+(?:st|nd|rd|th))\s+on\s+(\d+)\b(?:\s+points?)?/gi;
  let ordinalMatch: RegExpExecArray | null;
  while ((ordinalMatch = ordinalOnPoints.exec(sentence)) !== null) {
    const statedPos = parseOrdinalPosition(ordinalMatch[1]!);
    const statedPts = Number(ordinalMatch[2]);
    const side = sideForTableOrdinalClaim(sentence, ordinalMatch.index, sides);
    if (!side || statedPos == null || !Number.isFinite(statedPts)) return true;
    if (positionForSide(side, table) !== statedPos || pointsForSide(side, table) !== statedPts) {
      return true;
    }
  }

  const placedClub = sentence.match(/\b(\d+(?:st|nd|rd|th))[- ]placed\s+([A-Za-z][A-Za-z\s'-]+?)(?:\s+on|\s+who|,|\.|$)/i);
  if (placedClub) {
    const statedPos = parseOrdinalPosition(placedClub[1]!);
    const side = teamSideFromMention(placedClub[2]!, sides);
    if (!side || statedPos == null) return true;
    if (positionForSide(side, table) !== statedPos) return true;
  }

  const whoHave = sentence.match(/\b([A-Za-z][A-Za-z\s'-]+?)\s+who have (\d+)\b/i);
  if (whoHave) {
    const side = teamSideFromMention(whoHave[1]!, sides);
    const statedPts = Number(whoHave[2]);
    if (!side || !Number.isFinite(statedPts)) return true;
    if (pointsForSide(side, table) !== statedPts) return true;
  }

  const combined = sentence.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:spots?|places?)\s+and\s+(?:(one|a)|(\d+))\s+points?\s+(above|below|ahead|behind)\b/i,
  );
  if (combined) {
    const statedSpots = parseGapToken(combined[1]!);
    const statedPts = combined[2] != null
      ? 1
      : parseGapToken(combined[3]!);
    const relation = combined[4]!.toLowerCase();
    if (statedSpots == null || statedPts == null) return true;
    const subject = teamSideFromMention(sentence, sides);
    if (subject == null) {
      return table.positionsApart !== statedSpots || table.pointsClear !== statedPts;
    }
    const other = subject === "home" ? "away" : "home";
    if (table.positionsApart !== statedSpots || table.pointsClear !== statedPts) return true;
    if (relation === "above" || relation === "ahead") {
      if (!rankAbove(subject, table) || pointsForSide(subject, table) <= pointsForSide(other, table)) {
        return true;
      }
    } else if (!rankAbove(other, table) || pointsForSide(other, table) <= pointsForSide(subject, table)) {
      return true;
    }
  }

  const spotsOnly = sentence.match(
    /\b(?:a|one|\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:spots?|places?)\s+(above|below|ahead|behind)\b/i,
  );
  if (spotsOnly && !combined) {
    const token = spotsOnly[0].match(/\b(a|one|\d+|two|three|four|five|six|seven|eight|nine|ten)\b/i)?.[1] ?? "one";
    const statedSpots = token.toLowerCase() === "a" ? 1 : parseGapToken(token);
    const relation = spotsOnly[1]!.toLowerCase();
    const subject = teamSideFromMention(sentence, sides);
    if (subject == null || statedSpots == null) return true;
    if (table.positionsApart !== statedSpots) return true;
    const other = subject === "home" ? "away" : "home";
    if (relation === "above" || relation === "ahead") {
      if (!rankAbove(subject, table)) return true;
    } else if (!rankAbove(other, table)) return true;
  }

  const singleSpot = sentence.match(/\b(?:a|one)\s+(?:spot|place)\s+(above|below|ahead|behind)\b/i);
  if (singleSpot && !spotsOnly && !combined) {
    const relation = singleSpot[1]!.toLowerCase();
    const subject = teamSideFromMention(sentence, sides);
    if (subject == null) return true;
    if (table.positionsApart !== 1) return true;
    const other = subject === "home" ? "away" : "home";
    if (relation === "above" || relation === "ahead") {
      if (!rankAbove(subject, table)) return true;
    } else if (!rankAbove(other, table)) return true;
  }

  const pointsGapPattern = /\b(?:(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+points?|(just\s+)?(?:a\s+)?point)\s+(below|above|behind|clear)\b(?:\s+of)?(?:\s+the\s+)?(?:\d+(?:st|nd|rd|th)[- ]placed\s+)?(?:\s+([A-Za-z][A-Za-z\s'-]+?))?(?=\s+in\b|\s+on\b|\s+who\b|,|\.|$)/gi;
  let gapMatch: RegExpExecArray | null;
  while ((gapMatch = pointsGapPattern.exec(sentence)) !== null) {
    const statedGap = gapMatch[1] != null
      ? parseGapToken(gapMatch[1])
      : 1;
    const relation = gapMatch[3]!.toLowerCase() as "below" | "above" | "behind" | "clear";
    if (statedGap == null) return true;
    const refName = gapMatch[4]?.trim();
    const prefix = sentence.slice(0, gapMatch.index);
    let subject = primarySubjectSide(sentence, sides) ?? teamSideFromMention(prefix, sides);
    let reference: "home" | "away" | null = refName ? teamSideFromMention(refName, sides) : null;
    if (refName && !reference) return true;
    if (!subject && reference) {
      subject = reference === "home" ? "away" : "home";
    }
    if (!subject || !reference) {
      if (table.pointsClear !== statedGap) return true;
      continue;
    }
    if (!pointsGapMatches(subject, reference, statedGap, relation, table)) return true;
  }

  return false;
}

const VAGUE_POSITIVE_FORM =
  /\b(?:competitive in most matches|in (?:good|decent|strong) form|on a good run|playing well lately|finding form)\b/i;
const VAGUE_NEGATIVE_FORM =
  /\b(?:struggling for(?: form| results)|in poor form|on a bad run|out of form|short of results|results have dried up)\b/i;

export function sentenceStatesVagueFormGenerality(sentence: string): boolean {
  if (/\bgap in form\b/i.test(sentence)) return false;
  return VAGUE_POSITIVE_FORM.test(sentence) || VAGUE_NEGATIVE_FORM.test(sentence);
}

export function sentenceStatesLast5FormRecordClaim(sentence: string): boolean {
  if (/\bgap in form\b/i.test(sentence)) return false;
  return /\b(?:won|winning|wins)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+of\s+(?:their\s+)?last\s+(?:five|5|\d+)\b/i.test(sentence)
    || /\bunbeaten\s+in\s+(?:their\s+)?last\s+(?:five|5|\d+)\b/i.test(sentence)
    || /\b(?:winless|without\s+a\s+win)\s+in\s+(?:their\s+)?last\s+(?:five|5|\d+)\b/i.test(sentence)
    || /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)[- ]game\s+unbeaten\b/i.test(sentence)
    || /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)[- ]game\s+winless\b/i.test(sentence);
}

/** Drop when stated W/D/L or streak claims contradict the last-five form snapshot. */
export function sentenceFailsLast5FormRecordCheck(sentence: string, plan: PunditTakePlan): boolean {
  if (!sentenceStatesLast5FormRecordClaim(sentence)) return false;
  const formLast5 = plan.numericFacts?.formLast5;
  const sides = fixtureSides(plan);
  if (!sides) return true;
  const subject = primarySubjectSide(sentence, sides)
    ?? sideMentionedInFormSentence(sentence, sides)
    ?? teamSideFromMention(sentence, sides);
  if (!subject) return true;
  const record = subject === "home" ? formLast5?.home : formLast5?.away;
  if (!record) return true;

  const winsOf = sentence.match(
    /\b(?:won|winning|wins)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+of\s+(?:their\s+)?last\s+(five|5|\d+)\b/i,
  );
  if (winsOf) {
    const statedWins = parseGapToken(winsOf[1]!);
    if (statedWins == null) return true;
    if (statedWins !== record.wins) return true;
  }

  const unbeatenIn = sentence.match(/\bunbeaten\s+in\s+(?:their\s+)?last\s+(five|5|\d+)\b/i);
  if (unbeatenIn) {
    const window = parseGapToken(unbeatenIn[1]!) ?? 5;
    const span = Math.min(window, record.played);
    if (record.unbeatenRun < span || record.losses > 0) return true;
  }

  const winlessIn = sentence.match(/\b(?:winless|without\s+a\s+win)\s+in\s+(?:their\s+)?last\s+(five|5|\d+)\b/i);
  if (winlessIn && record.wins > 0) return true;

  const unbeatenRun = sentence.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)[- ]game\s+unbeaten\b/i);
  if (unbeatenRun) {
    const stated = parseGapToken(unbeatenRun[1]!);
    if (stated == null || stated !== record.unbeatenRun) return true;
  }

  const winlessRun = sentence.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)[- ]game\s+winless\b/i);
  if (winlessRun) {
    const stated = parseGapToken(winlessRun[1]!);
    if (stated == null || stated !== record.winlessRun) return true;
  }

  return false;
}

const UPSET_FRAMING =
  /\b(?:(?:an?\s+)?upset\s+is\s+brewing|an upset brewing|spring an upset|an upset is (?:brewing|on the cards|possible)|underdog story)\b/i;

export function sentenceStatesUpsetFraming(sentence: string): boolean {
  if (UPSET_FRAMING.test(sentence)) return true;
  return /\b(?:league table|the table|standings)\b/i.test(sentence) && /\bupset\b/i.test(sentence);
}

/** Drop table-upset hype that does not honestly match the headline pick vs standings. */
export function sentenceFailsUpsetPickAlignmentCheck(sentence: string, plan: PunditTakePlan): boolean {
  if (!sentenceStatesUpsetFraming(sentence)) return false;
  const table = plan.numericFacts?.table;
  if (!tableSnapshotReady(table)) return true;
  const outcome = plan.call?.outcome;
  if (outcome !== "home" && outcome !== "away") return false;
  const pickPos = outcome === "home" ? table.homePosition : table.awayPosition;
  const oppPos = outcome === "home" ? table.awayPosition : table.homePosition;
  if (pickPos == null || oppPos == null) return true;
  if (pickPos === oppPos) return false;
  // Pick is either the table favourite or our underdog — generic "upset brewing" copy is misleading.
  return true;
}

/** Drop vague form praise/criticism when last-five points contradict the threshold. */
export function sentenceFailsVagueFormGeneralityCheck(sentence: string, plan: PunditTakePlan): boolean {
  if (!sentenceStatesVagueFormGenerality(sentence)) return false;
  const formLast5 = plan.numericFacts?.formLast5;
  const sides = fixtureSides(plan);
  if (!sides) return true;
  const subject = sideMentionedInFormSentence(sentence, sides) ?? teamSideFromMention(sentence, sides);
  if (!subject) return true;
  const pts = subject === "home" ? formLast5?.homePoints : formLast5?.awayPoints;
  if (pts == null) return true;
  if (VAGUE_POSITIVE_FORM.test(sentence) && pts < VAGUE_POSITIVE_FORM_MIN_LAST5_POINTS) return true;
  if (VAGUE_NEGATIVE_FORM.test(sentence) && pts > VAGUE_NEGATIVE_FORM_MAX_LAST5_POINTS) return true;
  return false;
}

/** Drop when LLM compares recent form against the last-five points snapshot. */
export function sentenceFailsFormComparisonCheck(sentence: string, plan: PunditTakePlan): boolean {
  if (!sentenceComparesRecentForm(sentence)) return false;
  const formLast5 = plan.numericFacts?.formLast5;
  const homePts = formLast5?.homePoints ?? null;
  const awayPts = formLast5?.awayPoints ?? null;
  if (homePts == null || awayPts == null) return true;
  if (homePts === awayPts) return true;
  const sides = fixtureSides(plan);
  if (!sides) return true;
  const subject = sideMentionedInFormSentence(sentence, sides);
  if (!subject) return true;
  const direction = recentFormComparisonDirection(sentence);
  if (!direction) return true;
  const subjectPts = subject === "home" ? homePts : awayPts;
  const otherPts = subject === "home" ? awayPts : homePts;
  if (direction === "better") return subjectPts <= otherPts;
  return subjectPts >= otherPts;
}

export function sentenceMakesVenuePerformanceClaim(sentence: string): boolean {
  if (/\bhome[- ]field advantage\b/i.test(sentence)) return false;
  const withoutAdvantage = sentence.replace(/\bhome advantage\b/gi, "");
  if (!VENUE_PERFORMANCE_PLACE.test(withoutAdvantage)) return false;
  if (/\bconceded\b[\w\s,'’-]{0,48}\bat home\b/i.test(sentence)) return true;
  if (/\bgrind(?:ing)?\s+results\b[\w\s,'’-]{0,24}\bon the road\b/i.test(sentence)) return true;
  if (/\bon the road\b/i.test(sentence) && VENUE_PERFORMANCE_ACTION.test(sentence)) return true;
  if (/\bat home\b/i.test(sentence) && VENUE_PERFORMANCE_ACTION.test(sentence)) return true;
  if (/\bon their travels\b/i.test(sentence) && VENUE_PERFORMANCE_ACTION.test(sentence)) return true;
  if (/\b(?:home|away) form\b/i.test(sentence) && VENUE_PERFORMANCE_ACTION.test(sentence)) return true;
  return false;
}

export function rewriteVenueInventedFormSentence(sentence: string, venueSplitAvailable: boolean): string | null {
  if (venueSplitAvailable || !VENUE_FORM_CLAIM.test(sentence) || !FORM_STAT_CLAIM.test(sentence)) {
    return sentence;
  }
  let out = sentence
    .replace(LAST_N_VENUE_PHRASE, "in their last $1 league games")
    .replace(OVER_LAST_N_VENUE, "over their last $1 league games")
    .replace(MANAGED_GOALS_AWAY, "$1 league games")
    .replace(/\b(?:away from home|on the road)\b/gi, "")
    .replace(/\bin their last (five|5|\d+) at home\b/gi, "in their last $1 league games")
    .replace(/\bhome form\b/gi, "recent league form")
    .replace(/\baway form\b/gi, "recent league form")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
  if (VENUE_FORM_CLAIM.test(out) && FORM_STAT_CLAIM.test(out)) {
    return null;
  }
  return out || null;
}

function sanitizeLlmTakeSentence(
  sentence: string,
  plan: PunditTakePlan,
  venueSplit: boolean,
): string | null {
  if (isProtectedTakeSentence(sentence, plan)) {
    return rewriteWinProbabilityPhrase(sentence);
  }
  let next = rewriteWinProbabilityPhrase(sentence);
  if (sentenceFailsTableStandingSnapshotCheck(next, plan)) {
    return null;
  }
  if (sentenceFailsVagueFormGeneralityCheck(next, plan)) {
    return null;
  }
  if (sentenceFailsLast5FormRecordCheck(next, plan)) {
    return null;
  }
  if (sentenceFailsFormComparisonCheck(next, plan)) {
    return null;
  }
  if (sentenceFailsUpsetPickAlignmentCheck(next, plan)) {
    return null;
  }
  if (!venueSplit && sentenceMakesVenuePerformanceClaim(next)) {
    return null;
  }
  return rewriteVenueInventedFormSentence(next, venueSplit);
}

const LEADING_CONTRAST_CONNECTIVE = /^(However|But|Yet|Still),?\s+/i;

/** After a guard drop, the next sentence may open with a dangling contrast word. */
export function stripLeadingContrastConnective(sentence: string): string {
  const trimmed = sentence.trim();
  const stripped = trimmed.replace(LEADING_CONTRAST_CONNECTIVE, "");
  if (!stripped || stripped === trimmed) return trimmed;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export function applyVenueFormHygiene(prose: string, plan: PunditTakePlan): string {
  const venueSplit = formDataHasVenueSplit(plan);
  const sentences = prose.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const kept: string[] = [];
  let droppedAny = false;
  for (const sentence of sentences) {
    const sanitized = sanitizeLlmTakeSentence(sentence, plan, venueSplit);
    if (!sanitized) {
      droppedAny = true;
      continue;
    }
    let next = sanitized;
    if (kept.length === 0 && droppedAny) {
      next = stripLeadingContrastConnective(next);
    }
    if (next) kept.push(next);
  }
  return kept.join(" ").trim();
}

export function dedupeVenueQualifiers(text: string): string {
  return text
    .replace(/\(\s*all venues\s*\)\s*at all venues/gi, "(all venues)")
    .replace(/\(\s*all venues\s*\)\s*\(\s*all venues\s*\)/gi, "(all venues)")
    .replace(/\bacross all venues\s+at all venues\b/gi, "across all venues")
    .replace(/\(\s*all venues\s*\)\s+across all venues\b/gi, "(all venues)")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Expand common contractions so policy dedupe catches won't / will not pairs. */
export function expandContractionsForDedupe(text: string): string {
  return text
    .replace(/\bI'm\b/gi, "I am")
    .replace(/\bI've\b/gi, "I have")
    .replace(/\bI'll\b/gi, "I will")
    .replace(/\bI'd\b/gi, "I would")
    .replace(/\bwon't\b/gi, "will not")
    .replace(/\bcan't\b/gi, "cannot")
    .replace(/\bdon't\b/gi, "do not")
    .replace(/\bdoesn't\b/gi, "does not")
    .replace(/\bdidn't\b/gi, "did not")
    .replace(/\bisn't\b/gi, "is not")
    .replace(/\baren't\b/gi, "are not")
    .replace(/\bwasn't\b/gi, "was not")
    .replace(/\bweren't\b/gi, "were not")
    .replace(/\bhasn't\b/gi, "has not")
    .replace(/\bhaven't\b/gi, "have not")
    .replace(/\bhadn't\b/gi, "had not")
    .replace(/\bwouldn't\b/gi, "would not")
    .replace(/\bshouldn't\b/gi, "should not")
    .replace(/\bcouldn't\b/gi, "could not")
    .replace(/\bmustn't\b/gi, "must not")
    .replace(/\bit's\b/gi, "it is")
    .replace(/\bthat's\b/gi, "that is")
    .replace(/\bwhat's\b/gi, "what is")
    .replace(/\bwho's\b/gi, "who is")
    .replace(/\blet's\b/gi, "let us");
}

function normalizeForDedupe(text: string): string {
  return expandContractionsForDedupe(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function blocksNearDuplicate(a: string, b: string): boolean {
  const na = normalizeForDedupe(a);
  const nb = normalizeForDedupe(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 40 && nb.includes(na)) return true;
  if (nb.length >= 40 && na.includes(nb)) return true;
  return false;
}

function dedupePolicySentences(sentences: string[], seenNormalized: string[]): string[] {
  const kept: string[] = [];
  for (const sentence of sentences) {
    const norm = normalizeForDedupe(sentence);
    if (!norm) continue;
    if (seenNormalized.some((prev) => blocksNearDuplicate(prev, norm))) continue;
    seenNormalized.push(norm);
    kept.push(sentence);
  }
  return kept;
}

/** Drop repeated paragraphs and near-duplicate sentences within each policy block. */
export function dedupePolicyProseBlocks(prose: string): string {
  const blocks = prose.split("\n\n").map((b) => b.trim()).filter(Boolean);
  const keptBlocks: string[] = [];
  for (const block of blocks) {
    const sentences = block.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    const seenInBlock: string[] = [];
    const keptSentences = dedupePolicySentences(sentences, seenInBlock);
    if (!keptSentences.length) continue;
    const joined = keptSentences.join(" ");
    if (keptBlocks.some((prev) => blocksNearDuplicate(prev, joined))) continue;
    keptBlocks.push(joined);
  }
  const merged = keptBlocks.join("\n\n");
  return dedupePolicyProseSentencesGlobally(merged.replace(/\n\n+/g, " "));
}

/** When policy prose is one block (desk flattening), dedupe sentences across the whole string. */
function dedupePolicyProseSentencesGlobally(prose: string): string {
  const sentences = prose.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const seen: string[] = [];
  return dedupePolicySentences(sentences, seen).join(" ");
}

export function applyV2ProseHygiene(prose: string, plan: PunditTakePlan): string {
  const venueFixed = applyVenueFormHygiene(repairIncompleteEvenClause(prose), plan);
  return dedupeVenueQualifiers(repairIncompleteEvenClause(venueFixed));
}
