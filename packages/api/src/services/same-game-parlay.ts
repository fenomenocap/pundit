import type { ScoreMatrix } from "./dixon-coles";
import {
  DEFAULT_HOME_ADVANTAGE_ELO,
  matrixToBtts,
  matrixToTotals,
  scoreMatrix,
  eloToLambdas,
} from "./dixon-coles";
import type { Grounding } from "./ask";
import { normalizeTeamName, normalizeTeamText, getTeamNameAliases } from "../lib/team-names";
import type { ModelFixture } from "./model-data";
import { getDeskPricedSlate, resolveClubNameOnSlate } from "./slate-parlay";
import { asksBttsQuestion, asksTotalsQuestion } from "./response-plan";

export type SameGameParlaySide = "home" | "away";

export interface SameGameParlayLegs {
  side: SameGameParlaySide;
  over25: boolean;
  btts: boolean;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function fairDecimal(probability: number): string {
  return (1 / probability).toFixed(2);
}

/** Same-fixture compound with at least two priced leg types (result, totals, BTTS). */
export function isSameGameParlayQuestion(question: string): boolean {
  const q = question.trim();
  const explicitCombo = /\b(?:parlay|acca|accumulator|sgp|same[\s-]*game)\b/i.test(q)
    || /\+/.test(q);
  if (!explicitCombo) return false;
  const hasResult = /\b(?:to\s+)?(?:win|beat)\b/i.test(q)
    || /\b(?:home|away)\s+win\b/i.test(q)
    || /\b[A-Za-z][A-Za-z.'’\- ]{1,30}\s+win\b/i.test(q);
  const totals = asksTotalsQuestion(q);
  const btts = asksBttsQuestion(q);
  const kinds = [hasResult, totals, btts].filter(Boolean).length;
  return kinds >= 2 && (totals || btts);
}

export function resolveSameGameParlayLegs(
  question: string,
  home: string,
  away: string
): SameGameParlayLegs | null {
  if (!isSameGameParlayQuestion(question)) return null;
  const q = question;
  let side: SameGameParlaySide = "home";
  const homeKey = normalizeTeamName(home);
  const awayKey = normalizeTeamName(away);
  const mentionsHome = new RegExp(`\\b${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(q)
    || /\bhome\s+win\b/i.test(q);
  const mentionsAway = new RegExp(`\\b${away.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(q)
    || /\baway\s+win\b/i.test(q);
  if (mentionsAway && !mentionsHome) side = "away";
  else if (mentionsHome && !mentionsAway) side = "home";
  else if (/\bto\s+(?:beat|win)\b/i.test(q)) {
    const beat = /\b([A-Za-z][A-Za-z.'’\- ]{1,40}?)\s+to\s+(?:beat|win)\b/i.exec(q);
    if (beat) {
      const pick = normalizeTeamName(beat[1].trim());
      if (pick === awayKey) side = "away";
      else if (pick === homeKey) side = "home";
    }
  }
  const over25 = /\bover\s*2\.5\b|\bo\s*2\.5\b/i.test(q) && !/\bunder\s*2\.5\b/i.test(q);
  const btts = asksBttsQuestion(q);
  if (!over25 && !btts) return null;
  const hasWinCue = /\b(?:to\s+)?(?:win|beat)\b/i.test(q)
    || /\b[A-Za-z][A-Za-z.'’\- ]{1,30}\s+win\b/i.test(q);
  if (!hasWinCue && !mentionsHome && !mentionsAway) {
    return null;
  }
  return { side, over25, btts };
}

function cellMatches(
  homeGoals: number,
  awayGoals: number,
  legs: SameGameParlayLegs
): boolean {
  if (legs.side === "home" && homeGoals <= awayGoals) return false;
  if (legs.side === "away" && awayGoals <= homeGoals) return false;
  if (legs.over25 && homeGoals + awayGoals < 3) return false;
  if (legs.btts && (homeGoals < 1 || awayGoals < 1)) return false;
  return true;
}

export function jointProbabilityFromScoreGrid(
  matrix: ScoreMatrix,
  legs: SameGameParlayLegs
): number {
  let sum = 0;
  for (let i = 0; i < matrix.length; i += 1) {
    for (let j = 0; j < matrix[i].length; j += 1) {
      if (cellMatches(i, j, legs)) sum += matrix[i][j];
    }
  }
  return sum;
}

function marginalProbability(
  matrix: ScoreMatrix,
  legs: SameGameParlayLegs
): number {
  let p = 1;
  if (legs.side === "home") {
    let homeWin = 0;
    for (let i = 0; i < matrix.length; i += 1) {
      for (let j = 0; j < matrix[i].length; j += 1) {
        if (i > j) homeWin += matrix[i][j];
      }
    }
    p *= homeWin;
  } else {
    let awayWin = 0;
    for (let i = 0; i < matrix.length; i += 1) {
      for (let j = 0; j < matrix[i].length; j += 1) {
        if (j > i) awayWin += matrix[i][j];
      }
    }
    p *= awayWin;
  }
  if (legs.over25) {
    const [over] = matrixToTotals(matrix, 2.5);
    p *= over;
  }
  if (legs.btts) {
    const [yes] = matrixToBtts(matrix);
    p *= yes;
  }
  return p;
}

function scoreGridForFixture(fixture: ModelFixture): ScoreMatrix {
  if (fixture.scoreGrid?.length) return fixture.scoreGrid;
  const hfa = fixture.homeFieldAdvantage ? DEFAULT_HOME_ADVANTAGE_ELO : 0;
  return scoreMatrix(...eloToLambdas(fixture.homeElo, fixture.awayElo, hfa));
}

function fixtureMentionedInQuestion(question: string, fixture: ModelFixture): boolean {
  const q = normalizeTeamText(question);
  for (const team of [fixture.home, fixture.away]) {
    if (q.includes(normalizeTeamText(team))) return true;
  }
  for (const [alias, canonical] of getTeamNameAliases()) {
    const canon = normalizeTeamName(canonical);
    if (canon !== normalizeTeamName(fixture.home) && canon !== normalizeTeamName(fixture.away)) continue;
    if (q.includes(normalizeTeamText(alias))) return true;
  }
  const resolved = resolveClubNameOnSlate(question, [fixture]);
  return resolved != null;
}

export function composeDeskSameGameParlayAnswer(
  question: string,
  slate: ModelFixture[] = getDeskPricedSlate()
): string | null {
  if (!isSameGameParlayQuestion(question)) return null;
  const fixture = slate.find((row) => fixtureMentionedInQuestion(question, row));
  if (!fixture) return null;
  const matrix = scoreGridForFixture(fixture);
  const legs = resolveSameGameParlayLegs(question, fixture.home, fixture.away);
  if (!legs) return null;
  const joint = jointProbabilityFromScoreGrid(matrix, legs);
  const naive = marginalProbability(matrix, legs);
  const winner = legs.side === "home" ? fixture.home : fixture.away;
  const legLabels = [
    `${winner} to win`,
    legs.over25 ? "over 2.5" : null,
    legs.btts ? "BTTS yes" : null,
  ].filter(Boolean).join(" + ");
  const gap = naive > 0 ? ((joint - naive) / naive) * 100 : 0;
  const correlation = Math.abs(gap) < 0.5
    ? "Treating these legs as independent would match the score grid here."
    : `Correlation: joint ${pct(joint)} from the score grid vs ${pct(naive)} if you multiplied the separate legs — goals and results move together.`;
  return `My same-game parlay (${legLabels}) on ${fixture.home} v ${fixture.away}: ${pct(joint)} combined (fair ${fairDecimal(joint)}). ${correlation}`;
}

export function composeSameGameParlayAnswer(
  question: string,
  grounding: Grounding
): string | null {
  const legs = resolveSameGameParlayLegs(question, grounding.home, grounding.away);
  if (!legs) return null;
  const matrix = grounding.scoreGrid?.length
    ? grounding.scoreGrid
    : scoreMatrix(
      ...eloToLambdas(grounding.homeElo, grounding.awayElo, grounding.homeFieldAdvantage ? DEFAULT_HOME_ADVANTAGE_ELO : 0)
    );
  const joint = jointProbabilityFromScoreGrid(matrix, legs);
  const naive = marginalProbability(matrix, legs);
  const winner = legs.side === "home" ? grounding.home : grounding.away;
  const legLabels = [
    `${winner} to win`,
    legs.over25 ? "over 2.5" : null,
    legs.btts ? "BTTS yes" : null,
  ].filter(Boolean).join(" + ");
  const gap = naive > 0 ? ((joint - naive) / naive) * 100 : 0;
  const correlation = Math.abs(gap) < 0.5
    ? "Treating these legs as independent would match the score grid here."
    : `Correlation: joint ${pct(joint)} from the score grid vs ${pct(naive)} if you multiplied the separate legs — goals and results move together.`;
  return `My same-game parlay (${legLabels}) on ${grounding.home} v ${grounding.away}: ${pct(joint)} combined (fair ${fairDecimal(joint)}). ${correlation}`;
}
