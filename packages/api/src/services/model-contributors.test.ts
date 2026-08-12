import { describe, expect, it } from "vitest";
import { computeMatchModel, eloToLambdas, simulateMatch } from "./dixon-coles";
import { ELO_CHAMPION, REGISTERED_CHALLENGERS } from "./model-contributors";

describe("model contributor boundary", () => {
  it("returns the exact champion forecast object produced by the legacy call path", () => {
    const input = { homeStrength: 1842.3, awayStrength: 1764.8, homeAdvantageElo: 42 };
    expect(ELO_CHAMPION.forecast(input)).toEqual(
      computeMatchModel(input.homeStrength, input.awayStrength, input.homeAdvantageElo)
    );
  });

  it("consumes randomness identically for season simulation", () => {
    const values = [0.4, 0.7, 0.2, 0.8, 0.3, 0.9];
    let oldIndex = 0;
    let contributorIndex = 0;
    const input = { homeStrength: 1842.3, awayStrength: 1764.8, homeAdvantageElo: 42 };
    const legacy = simulateMatch(
      ...eloToLambdas(input.homeStrength, input.awayStrength, input.homeAdvantageElo),
      false,
      () => values[oldIndex++ % values.length]
    );
    const throughBoundary = ELO_CHAMPION.sampleScore(
      input,
      () => values[contributorIndex++ % values.length]
    );
    expect(throughBoundary).toEqual(legacy);
    expect(contributorIndex).toBe(oldIndex);
  });

  it("registers no fake challenger", () => {
    expect(REGISTERED_CHALLENGERS).toEqual([]);
  });
});
