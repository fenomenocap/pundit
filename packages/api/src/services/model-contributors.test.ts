import { describe, expect, it } from "vitest";
import { computeMatchModel, eloToLambdas, simulateMatch } from "./dixon-coles";
import {
  DIXON_COLES_MLE_ARTIFACT_SHA256,
  DIXON_COLES_MLE_NOT_ACTIVATED,
  ELO_CHAMPION,
  PUNDIT_FUNDAMENTAL_MODEL_VERSION,
  REGISTERED_CHALLENGERS,
  REGISTERED_DIXON_COLES_MLE,
} from "./model-contributors";
import {
  FITTED_DIXON_COLES_CONTRIBUTOR_ID,
  FITTED_DIXON_COLES_METHOD_ID,
} from "./dixon-coles-mle";

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

  it("registers the reviewed partial-fit challenger without activating production", () => {
    expect(REGISTERED_CHALLENGERS).toHaveLength(1);
    expect(REGISTERED_CHALLENGERS[0]).toBe(REGISTERED_DIXON_COLES_MLE);
    expect(REGISTERED_CHALLENGERS[0]?.id).toBe(FITTED_DIXON_COLES_CONTRIBUTOR_ID);
    expect(REGISTERED_CHALLENGERS[0]?.version).toBe(DIXON_COLES_MLE_ARTIFACT_SHA256);
    expect(REGISTERED_CHALLENGERS[0]?.methodId).toBe(FITTED_DIXON_COLES_METHOD_ID);
    expect(REGISTERED_CHALLENGERS[0]?.status).toBe("challenger");
    expect(REGISTERED_CHALLENGERS[0]?.id).not.toBe(ELO_CHAMPION.id);
    expect(() => REGISTERED_CHALLENGERS[0]?.forecast({
      homeStrength: 1800,
      awayStrength: 1750,
      homeAdvantageElo: 42,
    })).toThrow(DIXON_COLES_MLE_NOT_ACTIVATED);
  });

  it("versions the Phase-0 mapping as Fundamental 2", () => {
    expect(PUNDIT_FUNDAMENTAL_MODEL_VERSION).toBe("2");
  });
});
