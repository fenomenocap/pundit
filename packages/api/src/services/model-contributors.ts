import {
  BASE_GOALS,
  DEFAULT_HOME_ADVANTAGE_ELO,
  ELO_SCALE,
  LAMBDA_CAP,
  MAX_GOALS,
  RHO,
  computeMatchModel,
  eloToLambdas,
  simulateMatch,
} from "./dixon-coles";
import {
  FITTED_DIXON_COLES_CONTRIBUTOR_ID,
  FITTED_DIXON_COLES_METHOD_ID,
} from "./dixon-coles-mle";

export type ContributorStatus = "champion" | "challenger";

export interface ContributorInput {
  homeStrength: number;
  awayStrength: number;
  homeAdvantageElo: number;
}

export interface ForecastContributor {
  readonly id: string;
  readonly version: string;
  readonly methodId: string;
  readonly status: ContributorStatus;
  forecast(input: ContributorInput): ReturnType<typeof computeMatchModel>;
  sampleScore(
    input: ContributorInput,
    random?: () => number
  ): [number, number];
}

/**
 * The production champion behind a replaceable boundary. Both methods delegate
 * directly to the pre-existing functions so this layer changes ownership, not
 * arithmetic or random-number consumption.
 */
export const ELO_CHAMPION: ForecastContributor = {
  id: "clubelo",
  version: "1",
  methodId: "clubelo-elo-to-goals-dixon-coles",
  status: "champion",
  forecast(input) {
    return computeMatchModel(
      input.homeStrength,
      input.awayStrength,
      input.homeAdvantageElo
    );
  },
  sampleScore(input, random = Math.random) {
    return simulateMatch(
      ...eloToLambdas(
        input.homeStrength,
        input.awayStrength,
        input.homeAdvantageElo
      ),
      false,
      random
    );
  },
};

export const PUNDIT_FUNDAMENTAL_MODEL_ID = "pundit-fundamental";
export const PUNDIT_FUNDAMENTAL_MODEL_VERSION = "2";

export const ELO_CHAMPION_CONFIG = {
  eloScale: ELO_SCALE,
  baseGoals: BASE_GOALS,
  lambdaCap: LAMBDA_CAP,
  dixonColesRho: RHO,
  maxGoals: MAX_GOALS,
  defaultHomeAdvantageElo: DEFAULT_HOME_ADVANTAGE_ELO,
} as const;

/** Reviewed partial-fit artifact (590/760 joined PL rows). Registration ≠ activation. */
export const DIXON_COLES_MLE_ARTIFACT_SHA256 =
  "15e20da1ed543d9a8e898524ec84ef904eeab2cba2b0a3a81d8bdef78bf17009";

export const DIXON_COLES_MLE_NOT_ACTIVATED =
  "dixon-coles-mle is registered for offline evaluation only; production forecasts use ELO_CHAMPION";

function dixonColesMleNotActivated(): never {
  throw new Error(DIXON_COLES_MLE_NOT_ACTIVATED);
}

/** ClubElo-prior fitted attack/defence Dixon–Coles; offline eval only. */
export const REGISTERED_DIXON_COLES_MLE: ForecastContributor = {
  id: FITTED_DIXON_COLES_CONTRIBUTOR_ID,
  version: DIXON_COLES_MLE_ARTIFACT_SHA256,
  methodId: FITTED_DIXON_COLES_METHOD_ID,
  status: "challenger",
  forecast: dixonColesMleNotActivated,
  sampleScore: dixonColesMleNotActivated,
};

/**
 * Reviewed challengers registered in source. Registration is not activation:
 * model-data.ts still uses ELO_CHAMPION only. Labelled Pundit Consensus is a
 * market-aware view on match grounding, not a registered engine.
 */
export const REGISTERED_CHALLENGERS: readonly ForecastContributor[] = [
  REGISTERED_DIXON_COLES_MLE,
];
