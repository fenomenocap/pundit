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
export const PUNDIT_FUNDAMENTAL_MODEL_VERSION = "1";

export const ELO_CHAMPION_CONFIG = {
  eloScale: ELO_SCALE,
  baseGoals: BASE_GOALS,
  lambdaCap: LAMBDA_CAP,
  dixonColesRho: RHO,
  maxGoals: MAX_GOALS,
  defaultHomeAdvantageElo: DEFAULT_HOME_ADVANTAGE_ELO,
} as const;

/**
 * Intentionally empty. Registration is not activation, and no placeholder
 * challenger should imply that a fitted independent model exists.
 */
export const REGISTERED_CHALLENGERS: readonly ForecastContributor[] = [];
