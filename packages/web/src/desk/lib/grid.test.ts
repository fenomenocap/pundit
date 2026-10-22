import { test } from "node:test";
import assert from "node:assert/strict";
import { independentGoalsGrid, projectedScore } from "./grid.ts";

test("projected score is deterministic and is the likeliest score inside the most likely result", () => {
  // Strong home side: the headline is the best home-win cell (2-0 here), not forced over 2.5.
  const grid = independentGoalsGrid([2.3, 0.7]);
  const fixture = { xg: [2.12, 0.56] as [number, number], scoreGrid: grid };
  const first = projectedScore(fixture)!;
  for (let i = 0; i < 5; i++) assert.deepEqual(projectedScore(fixture), first);
  assert.equal(first.outcome, "home");
  assert.ok(first.score.home > first.score.away);
  const bestHomeWin = Math.max(...grid.flatMap((row, h) => row.filter((_, a) => h > a)));
  assert.equal(first.score.probability, bestHomeWin);
  assert.deepEqual([first.score.home, first.score.away], [2, 0]);
});

test("a near 50/50 goals line does not change the headline score", () => {
  const p = projectedScore({ xg: [1.1, 0.6] })!;
  assert.ok(p.score.home > p.score.away);
  assert.deepEqual([p.score.home, p.score.away], [1, 0]);
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

test("published probabilities pick the most likely result", () => {
  const p = projectedScore({ xg: [1.4, 1.3], model: { home: 0.3, draw: 0.25, away: 0.45 } })!;
  assert.equal(p.outcome, "away");
  assert.ok(p.score.away > p.score.home);
  assert.equal(p.pOutcome, 0.45);
});
