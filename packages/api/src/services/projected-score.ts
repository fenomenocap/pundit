/**
 * One projected-score rule for every surface (chat, home summary, desk card, /fixtures).
 *
 * Lead: the likeliest scoreline inside the most likely 1X2 result.
 * Second line: the single likeliest scoreline on the whole grid (often 1-1, because
 * draw mass sits in few cells while win mass is spread over 1-0, 2-0, 2-1, 3-1...).
 * No over/under constraint: a coin-flip goals line must not change the headline score.
 */
export type ScorelineRow = { score: string; probability: number };
export type ProjectedOutcome = "home" | "draw" | "away";

export interface ProjectedScore {
  score: string;
  probability: number;
  outcome: ProjectedOutcome;
  pOutcome: number;
  modal: ScorelineRow;
}

function parse(score: string): [number, number] | null {
  const match = /^(\d+)-(\d+)$/.exec(score.trim());
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** Ties keep home, then draw, then away, so the result is stable. */
export function mostLikelyOutcome(pHome: number, pDraw: number, pAway: number): { outcome: ProjectedOutcome; p: number } {
  const rows: Array<{ outcome: ProjectedOutcome; p: number }> = [
    { outcome: "home", p: pHome },
    { outcome: "draw", p: pDraw },
    { outcome: "away", p: pAway },
  ];
  return rows.reduce((best, row) => (row.p > best.p + 1e-12 ? row : best));
}

export function projectedScoreFromScorelines(
  rows: readonly ScorelineRow[] | null | undefined,
  oneXTwo: { pHome: number; pDraw: number; pAway: number },
): ProjectedScore | null {
  if (!rows?.length || ![oneXTwo.pHome, oneXTwo.pDraw, oneXTwo.pAway].every(Number.isFinite)) return null;
  const { outcome, p } = mostLikelyOutcome(oneXTwo.pHome, oneXTwo.pDraw, oneXTwo.pAway);
  let modal: ScorelineRow | null = null;
  let lead: ScorelineRow | null = null;
  for (const row of rows) {
    const goals = parse(row.score);
    if (!goals || !Number.isFinite(row.probability)) continue;
    if (!modal || row.probability > modal.probability + 1e-15) modal = row;
    const [home, away] = goals;
    const inOutcome = outcome === "home" ? home > away : outcome === "away" ? away > home : home === away;
    if (inOutcome && (!lead || row.probability > lead.probability + 1e-15)) lead = row;
  }
  if (!modal) return null;
  const chosen = lead ?? modal;
  return { score: chosen.score, probability: chosen.probability, outcome, pOutcome: p, modal };
}
