import type { Grounding } from "../ask";
import type { ResultMark } from "../club-form";
import type { FormWindow, MatchDossier } from "../match-dossier/types";
import { allowedNumbersFromPlan, sentenceUsesDisallowedNumber } from "./take-allowed-numbers";
import type {
  PunditTakePlan,
  TakePlanGridCall,
  TakePlanLast5FormRecord,
  TakePlanNumericFacts,
  TakePlanRow,
} from "./types";
import { isExactDeterministicPassPlayOpener } from "./take-pass-play-opener";

const GAP_INT_TO_WORD = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
] as const;

export function gapCountWord(n: number): string {
  if (n >= 0 && n < GAP_INT_TO_WORD.length) return GAP_INT_TO_WORD[n]!;
  return String(n);
}

const GAP_WORD_TO_INT: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const TOSS_UP_PATTERN = /\b(?:toss-up|coin-flip|coin flip|too close to call)\b/i;
const POINTS_CLEAR_PATTERN = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+clear\b/i;
const POINTS_BEHIND_PATTERN = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+points?\s+behind\b/i;

export function parseGapToken(token: string): number | null {
  const lower = token.toLowerCase();
  if (GAP_WORD_TO_INT[lower] != null) return GAP_WORD_TO_INT[lower]!;
  const n = Number(token);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function leaguePointsFromResultMarks(marks: ResultMark[]): number {
  return marks.reduce((sum, mark) => sum + (mark === "W" ? 3 : mark === "D" ? 1 : 0), 0);
}

export function last5LeaguePointsFromFormWindow(form: FormWindow | null | undefined): number | null {
  if (!form || form.played < 3 || form.results.length < 3) return null;
  return leaguePointsFromResultMarks(form.results.slice(0, 5));
}

export function last5LeaguePointsFromGroundingForm(marks: ResultMark[]): number | null {
  if (marks.length < 3) return null;
  return leaguePointsFromResultMarks(marks.slice(-5));
}

export function buildLast5FormRecord(marks: ResultMark[]): TakePlanLast5FormRecord | null {
  const results = marks.slice(-5);
  if (results.length < 3) return null;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  for (const mark of results) {
    if (mark === "W") wins += 1;
    else if (mark === "D") draws += 1;
    else losses += 1;
  }
  let unbeatenRun = 0;
  for (let i = results.length - 1; i >= 0; i -= 1) {
    if (results[i] === "L") break;
    unbeatenRun += 1;
  }
  let winlessRun = 0;
  for (let i = results.length - 1; i >= 0; i -= 1) {
    if (results[i] === "W") break;
    winlessRun += 1;
  }
  return { played: results.length, wins, draws, losses, unbeatenRun, winlessRun };
}

function last5FormRecordFromWindow(form: FormWindow | null | undefined): TakePlanLast5FormRecord | null {
  if (!form || form.played < 3 || form.results.length < 3) return null;
  return buildLast5FormRecord(form.results.slice(0, 5));
}

export function buildFormLast5Snapshot(
  grounding: Grounding,
  dossier: MatchDossier | null,
): TakePlanNumericFacts["formLast5"] {
  const homePoints = last5LeaguePointsFromFormWindow(dossier?.form.homeLast5.value)
    ?? last5LeaguePointsFromGroundingForm(grounding.homeForm);
  const awayPoints = last5LeaguePointsFromFormWindow(dossier?.form.awayLast5.value)
    ?? last5LeaguePointsFromGroundingForm(grounding.awayForm);
  const home = last5FormRecordFromWindow(dossier?.form.homeLast5.value)
    ?? buildLast5FormRecord(grounding.homeForm);
  const away = last5FormRecordFromWindow(dossier?.form.awayLast5.value)
    ?? buildLast5FormRecord(grounding.awayForm);
  return { homePoints, awayPoints, home, away };
}

export function topTwoOutcomeGapPoints(
  rows: TakePlanRow[],
  gridCall: TakePlanGridCall | null,
  gridRows: PunditTakePlan["gridRows"],
): number {
  if (gridCall && gridRows.length >= 2) {
    const pcts = gridRows.map((r) => r.modelPctInt).sort((a, b) => b - a);
    return pcts.length >= 2 ? pcts[0]! - pcts[1]! : 100;
  }
  const pcts = rows.map((r) => r.modelPctInt).sort((a, b) => b - a);
  return pcts.length >= 2 ? pcts[0]! - pcts[1]! : 100;
}

export function buildTakeNumericFacts(
  grounding: Grounding,
  dossier: MatchDossier | null,
  rows: TakePlanRow[],
  gridCall: TakePlanGridCall | null,
  gridRows: PunditTakePlan["gridRows"],
): TakePlanNumericFacts {
  const homePosition = grounding.homeTable.position ?? dossier?.table.home.value.position ?? null;
  const awayPosition = grounding.awayTable.position ?? dossier?.table.away.value.position ?? null;
  const homePoints = grounding.homeTable.points ?? dossier?.table.home.value.points ?? null;
  const awayPoints = grounding.awayTable.points ?? dossier?.table.away.value.points ?? null;
  const pointsClear = homePoints != null && awayPoints != null
    ? Math.abs(homePoints - awayPoints)
    : null;
  const positionsApart = homePosition != null && awayPosition != null
    ? Math.abs(homePosition - awayPosition)
    : null;
  const topTwoGapPoints = topTwoOutcomeGapPoints(rows, gridCall, gridRows);
  const coinFlip = gridCall?.coinFlip ?? topTwoGapPoints < 2;
  const formLast5 = buildFormLast5Snapshot(grounding, dossier);
  return {
    table: {
      homePosition,
      awayPosition,
      homePoints,
      awayPoints,
      pointsClear,
      positionsApart,
    },
    topTwoGapPoints,
    coinFlip,
    formLast5,
  };
}

export function collectAllowedNumbers(plan: PunditTakePlan): Set<string> {
  const allowed = allowedNumbersFromPlan(plan);
  const facts = plan.numericFacts;
  if (!facts) return allowed;
  const ingest = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return;
    allowed.add(String(n));
    allowed.add(String(Math.round(n)));
  };
  ingest(facts.table.homePosition);
  ingest(facts.table.awayPosition);
  ingest(facts.table.homePoints);
  ingest(facts.table.awayPoints);
  ingest(facts.table.pointsClear);
  ingest(facts.table.positionsApart);
  ingest(facts.topTwoGapPoints);
  return allowed;
}

export function sentenceFailsTableGapCheck(sentence: string, facts: TakePlanNumericFacts): boolean {
  const expectedClear = facts.table.pointsClear;
  const clearMatch = sentence.match(POINTS_CLEAR_PATTERN);
  if (clearMatch) {
    const stated = parseGapToken(clearMatch[1]!);
    if (stated != null && expectedClear != null && stated !== expectedClear) return true;
    if (stated != null && expectedClear === 0 && stated !== 0) return true;
  }
  const behindMatch = sentence.match(POINTS_BEHIND_PATTERN);
  if (behindMatch) {
    const stated = parseGapToken(behindMatch[1]!);
    if (stated != null && expectedClear != null && stated !== expectedClear) return true;
  }
  return false;
}

export function sentenceHasForbiddenTossUpLanguage(sentence: string, coinFlip: boolean): boolean {
  if (coinFlip) return false;
  return TOSS_UP_PATTERN.test(sentence);
}

/** Deterministic pricing/policy lines carry their own vetted numbers. */
function sentenceSkipsNumericAndGapGuard(sentence: string): boolean {
  if (isExactDeterministicPassPlayOpener(sentence)) return true;
  return /^That price implies /i.test(sentence)
    || /^Draw: our fair /i.test(sentence)
    || /fair 1X2 vs the best prices/i.test(sentence)
    || /^The value is /i.test(sentence)
    || /^What flips it:/i.test(sentence)
    || /^I'd shift if /i.test(sentence)
    || /^I'd revisit if /i.test(sentence)
    || /^Separately,/i.test(sentence)
    || /^On .+?, I have /i.test(sentence)
    || /^.+ — .+ at \d+(?:\.\d+)?%\.$/.test(sentence)
    || /^Nothing is guaranteed/i.test(sentence)
    || /18\+ only/i.test(sentence)
    || /^Gambling can be addictive/i.test(sentence)
    || /can't guarantee a winner/i.test(sentence)
    || /where the numbers come from/i.test(sentence);
}

function splitGuardSentences(prose: string): string[] {
  return prose
    .split(/\n\n+/)
    .flatMap((paragraph) => paragraph.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

export function applyV2TakeProseGuards(prose: string, plan: PunditTakePlan): string {
  const allowed = collectAllowedNumbers(plan);
  const sentences = splitGuardSentences(prose);
  const kept: string[] = [];
  for (const sentence of sentences) {
    const coinFlip = plan.numericFacts?.coinFlip ?? false;
    if (sentenceHasForbiddenTossUpLanguage(sentence, coinFlip)) continue;
    if (plan.numericFacts && sentenceFailsTableGapCheck(sentence, plan.numericFacts)) {
      continue;
    }
    if (!sentenceSkipsNumericAndGapGuard(sentence)) {
      if (sentenceUsesDisallowedNumber(sentence, allowed)) continue;
    }
    kept.push(sentence);
  }
  return kept.join(" ").trim();
}
