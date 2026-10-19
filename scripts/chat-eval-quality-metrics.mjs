/**
 * Quality metrics for chat eval runs (template share, near-duplicates, LLM rate, etc.).
 */

import { JUDGE_SKIPPED_NO_KEY_NOTE, JUDGE_SKIPPED_UNAVAILABLE_NOTE } from "./chat-eval-llm-judge.mjs";

function normalize(text) {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function jaccard(a, b) {
  const left = new Set(normalize(a).split(" ").filter(Boolean));
  const right = new Set(normalize(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let inter = 0;
  for (const token of left) if (right.has(token)) inter += 1;
  return inter / (left.size + right.size - inter);
}

const CANNED_PROSE_TEMPLATE_MARKERS = [
  "no bet",
  "gamble responsibly",
  "18+",
];

const LEGACY_TEMPLATE_MARKERS = [
  "model vs market",
  "my 1x2 is",
  "fair decimal",
  ...CANNED_PROSE_TEMPLATE_MARKERS,
];

function templateMarkersForTurn(turn, { metricsVersion = 2 } = {}) {
  if (metricsVersion === 1) {
    if (turn.engine === "agent") {
      return ["model vs market", "my 1x2 is", "fair decimal"];
    }
    return LEGACY_TEMPLATE_MARKERS;
  }
  return CANNED_PROSE_TEMPLATE_MARKERS;
}

function isWholeReplyAbstain(turn) {
  const answer = String(turn.answer ?? "").trim();
  const hasNumbers = /\d/.test(answer);
  if (turn.verification?.status === "abstain" && !hasNumbers) return true;
  if (/could not verify/i.test(answer) && !hasNumbers) return true;
  return false;
}

function isPartialDropTurn(turn) {
  const answer = String(turn.answer ?? "");
  if (!/\d/.test(answer)) return false;
  return (Number(turn.verification?.removedClaimCount) > 0)
    || /left those claims out/i.test(answer);
}

export function computeTurnQualityMetrics(turns, options = {}) {
  const metricsVersion = options.metricsVersion ?? 2;
  const successful = turns.filter((turn) => turn.httpStatus === 200 && turn.answer);
  const llmTurns = successful.filter((turn) => turn.engine === "agent" || turn.usedLlm === true);
  const templateTurns = successful.filter((turn) =>
    templateMarkersForTurn(turn, { metricsVersion }).some((marker) => normalize(turn.answer).includes(marker)));
  const citationTurns = successful.filter((turn) => /\]\(https?:\/\//.test(turn.answer ?? ""));
  const abstainTurns = metricsVersion === 1
    ? successful.filter((turn) =>
      turn.verification?.status === "abstain"
      || /could not verify|left those claims out/i.test(turn.answer ?? ""))
    : successful.filter((turn) => isWholeReplyAbstain(turn));
  const partialDropTurns = metricsVersion === 1
    ? []
    : successful.filter((turn) => isPartialDropTurn(turn));

  let nearDuplicatePairs = 0;
  for (let i = 0; i < successful.length; i += 1) {
    for (let j = i + 1; j < successful.length; j += 1) {
      if (jaccard(successful[i].answer, successful[j].answer) >= 0.85) nearDuplicatePairs += 1;
    }
  }

  const n = successful.length || 1;
  return {
    templateShare: templateTurns.length / n,
    nearDuplicateRate: nearDuplicatePairs / Math.max(1, (successful.length * (successful.length - 1)) / 2),
    llmCallRate: llmTurns.length / n,
    abstainRate: abstainTurns.length / n,
    partialDropRate: partialDropTurns.length / n,
    citationCoverage: citationTurns.length / n,
  };
}

/**
 * Side-by-side quality summary for legacy vs agent engine runs.
 */
export function compareEngineQuality(legacyTurns, agentTurns, options = {}) {
  return {
    legacy: computeTurnQualityMetrics(legacyTurns, options),
    agent: computeTurnQualityMetrics(agentTurns, options),
  };
}

/**
 * Summarize LLM-judge output on a report (see chat-eval-llm-judge.mjs).
 */
export function summarizeLlmJudge(report) {
  const judge = report?.llmJudge;
  if (!judge) {
    const criticPass = report?.criticReview?.overallVerdict === "PASS";
    return {
      score: criticPass ? 1 : 0,
      note: "LLM judge skipped; critic PASS coverage only.",
    };
  }
  if (judge.status === "skipped_no_key") {
    return {
      score: null,
      status: "skipped_no_key",
      note: JUDGE_SKIPPED_NO_KEY_NOTE,
      judgedTurns: 0,
      scoredTurns: 0,
      skippedTurns: judge.skippedTurns ?? judge.turns?.length ?? 0,
    };
  }
  if (judge.status === "skipped_unavailable") {
    return {
      score: null,
      status: "skipped_unavailable",
      note: JUDGE_SKIPPED_UNAVAILABLE_NOTE,
      judgedTurns: 0,
      scoredTurns: 0,
      skippedTurns: judge.skippedTurns ?? judge.turns?.length ?? 0,
    };
  }
  if (!judge?.averages) {
    return { score: null, note: judge?.turns?.[0]?.reason ?? "LLM judge not run." };
  }
  return {
    score: judge.averages.overall,
    averages: judge.averages,
    judgedTurns: judge.judgedTurns,
    scoredTurns: judge.scoredTurns,
    skippedTurns: judge.skippedTurns ?? 0,
  };
}
