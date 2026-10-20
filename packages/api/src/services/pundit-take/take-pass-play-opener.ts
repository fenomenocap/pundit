/** Exact deterministic pass/play opener lines (numeric guard exemption applies only to the full line). */

export const DETERMINISTIC_PASS_PLAY_NO_CALL_OPENER =
  /^.+\s+—\s+No call on .+ at \d+(?:\.\d+)?\.$/;

export const DETERMINISTIC_PASS_PLAY_PASS_OPENER =
  /^.+\s+—\s+I pass on .+ at \d+(?:\.\d+)?\.$/;

export const DETERMINISTIC_PASS_PLAY_PLAY_OPENER =
  /^.+\s+—\s+.+, (?:small play|play|strong play) — I play\.$/;

export function isExactDeterministicPassPlayOpener(sentence: string): boolean {
  const trimmed = sentence.trim();
  return DETERMINISTIC_PASS_PLAY_NO_CALL_OPENER.test(trimmed)
    || DETERMINISTIC_PASS_PLAY_PASS_OPENER.test(trimmed)
    || DETERMINISTIC_PASS_PLAY_PLAY_OPENER.test(trimmed);
}
