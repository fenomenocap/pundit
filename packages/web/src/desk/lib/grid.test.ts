import { test } from "node:test";
import assert from "node:assert/strict";
import { independentGoalsGrid, projectedScore } from "./grid.ts";

test("projected score is deterministic and agrees with the favoured result and goals line", () => {
  // Strong home side, over 2.5 favoured: never a 1-0 or 2-0 headline.
  const fixture = { xg: [2.12, 0.56] as [number, number], scoreGrid: independentGoalsGrid([2.3, 0.7]) };
  const first = projectedScore(fixture)!;
  for (let i = 0; i < 5; i++) assert.deepEqual(projectedScore(fixture), first);
  assert.equal(first.outcome, "home");
  assert.equal(first.totals, "over");
  assert.ok(first.score.home > first.score.away);
  assert.ok(first.score.home + first.score.away > 2);
});

test("projected score stays under 2.5 when the under is favoured", () => {
  const p = projectedScore({ xg: [1.1, 0.6] })!;
  assert.equal(p.totals, "under");
  assert.ok(p.score.home + p.score.away <= 2);
  assert.ok(p.score.home > p.score.away);
});

test("modal score is the single likeliest cell", () => {
  const grid = independentGoalsGrid([2.12, 0.56]);
  const p = projectedScore({ xg: null, scoreGrid: grid })!;
  const max = Math.max(...grid.flat());
  assert.equal(p.modal.probability, max);
});

test("no forecast means no projected score", () => {
  assert.equal(projectedScore({ xg: null }), null);
});

test("published probabilities pick the favoured result and goals line", () => {
  const p = projectedScore({ xg: [1.4, 1.3], model: { home: 0.3, draw: 0.25, away: 0.45, over25: 0.6 } })!;
  assert.equal(p.outcome, "away");
  assert.equal(p.totals, "over");
  assert.ok(p.score.away > p.score.home && p.score.home + p.score.away > 2);
  assert.equal(p.pOutcome, 0.45);
});
