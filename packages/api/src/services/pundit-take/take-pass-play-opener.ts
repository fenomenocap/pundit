/** Exact deterministic pass/play opener lines (numeric guard exemption applies only to the full line). */

/** Fixture label and side names must not contain digits — only the user price may. */
export const DETERMINISTIC_PASS_PLAY_NO_CALL_OPENER =
  /^[^\d]+ — No call on [^\d]+ at \d+(?:\.\d+)?\.$/;

export const DETERMINISTIC_PASS_PLAY_PASS_OPENER =
  /^[^\d]+ — I pass on [^\d]+ at \d+(?:\.\d+)?\.$/;

export const DETERMINISTIC_PASS_PLAY_PLAY_OPENER =
  /^[^\d]+ — [^\d]+ at \d+(?:\.\d+)?, (?:small play|play|strong play) — I play\.$/;

/** Second sentence of the level-1X2 pass/play reply (after the level headline); only the user price is a digit. */
export const DETERMINISTIC_PASS_PLAY_LEVEL_PASS =
  /^I pass at \d+(?:\.\d+)?; with no side, I don't play a quoted price\.$/;

export function levelPassPlayPassSentence(decimalOdds: number): string {
  return `I pass at ${decimalOdds.toFixed(2)}; with no side, I don't play a quoted price.`;
}

export function isExactDeterministicPassPlayOpener(sentence: string): boolean {
  const trimmed = sentence.trim();
  return DETERMINISTIC_PASS_PLAY_NO_CALL_OPENER.test(trimmed)
    || DETERMINISTIC_PASS_PLAY_PASS_OPENER.test(trimmed)
    || DETERMINISTIC_PASS_PLAY_PLAY_OPENER.test(trimmed)
    || DETERMINISTIC_PASS_PLAY_LEVEL_PASS.test(trimmed);
}
