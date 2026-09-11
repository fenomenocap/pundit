import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deskNumbersFromModelRow, impliedLambdas } from "./grid.ts";

describe("impliedLambdas", () => {
  it("uses the production fixed-total split, not mild inflation", () => {
    assert.deepEqual(impliedLambdas(1800, 1800, { hfa: 0 }), [1.35, 1.35]);
    const [home, away] = impliedLambdas(1532.9, 1915.3, { hfa: 42 });
    assert.ok(Math.abs(home + away - 2.7) < 1e-12);
    assert.ok(home < 0.4);
    assert.ok(away > 2.3);
  });

  it("honours provenance constants from the live model row", () => {
    const [home, away] = impliedLambdas(1800, 1800, {
      hfa: 0,
      baseGoals: 1.4,
      eloScale: 400,
    });
    assert.equal(home, 1.4);
    assert.equal(away, 1.4);
  });
});

describe("deskNumbersFromModelRow", () => {
  it("copies server over 2.5 and reconstructs production λ, not a second totals engine", () => {
    const [lh, la] = impliedLambdas(1532.9, 1915.3, { hfa: 42 });
    const numbers = deskNumbersFromModelRow({
      homeElo: 1532.9,
      awayElo: 1915.3,
      pOver2_5: 0.5064,
      forecastProvenance: {
        homeAdvantageElo: 42,
        config: { baseGoals: 1.35, eloScale: 400, lambdaCap: 5 },
      },
    });
    assert.equal(numbers.over25, 0.5064);
    assert.deepEqual(numbers.xg, [Math.round(lh * 100) / 100, Math.round(la * 100) / 100]);
    assert.ok(Math.abs(lh + la - 2.7) < 1e-12);
  });

  it("does not recompute over 2.5 from inflated lambdas", () => {
    const numbers = deskNumbersFromModelRow({
      homeElo: 1532.9,
      awayElo: 1915.3,
      pOver2_5: 0.41,
    });
    assert.equal(numbers.over25, 0.41);
  });
});
