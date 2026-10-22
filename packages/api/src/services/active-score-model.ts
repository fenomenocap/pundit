import { getCompetitionById } from "../config/competitions";
import { canonicalClubName, normalizeTeamName } from "../lib/team-names";
import { DEFAULT_HOME_ADVANTAGE_ELO, eloToLambdas, matrixTo1x2, matrixToBtts,
  matrixToCorrectScores, matrixToScorelines, matrixToTotals, scoreMatrix } from "./dixon-coles";
import { assertValidatedEplGoalCalibrationArtifact, EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN, EPL_GOAL_CALIBRATION_PINS,
  type EplGoalCalibrationPin,
  goalCalibrationClubNameIsValid, goalCalibrationUtcInstant, loadEplGoalCalibrationArtifact,
  type ValidatedEplGoalCalibrationArtifact } from "./epl-goal-calibration-artifact";
import { historicalGoalLambdas } from "./historical-goal-calibration";
import { anchorScoreGridTo1x2 } from "./outcome-anchored-score-grid";
import {
  ONE_X_TWO_TEMPERATURE,
  oneXTwoTemperatureEnabled,
  scaleOneXTwoProbabilities,
} from "./one-x-two-temperature";

export interface ActiveScoreModelInput {
  home: string;
  away: string;
  competitionId: string;
  homeStrength: number;
  awayStrength: number;
  homeAdvantageElo: number;
  kickoff: string;
}

export interface ActiveScoreModelOptions {
  /** Defaults to the ONE_X_TWO_TEMPERATURE_ENABLED env flag (OFF unless exactly "true"). */
  oneXTwoTemperature?: boolean;
  /** Activation origin of the pin the artifact belongs to. Defaults to the current pin. */
  activationOrigin?: string;
}

export function resolveActiveScoreModel(
  input: ActiveScoreModelInput, artifact: ValidatedEplGoalCalibrationArtifact | null, now = new Date(),
  options: ActiveScoreModelOptions = {}
) {
  const competition = getCompetitionById(input.competitionId);
  const home = typeof input.home === "string" ? canonicalClubName(input.home) : "";
  const away = typeof input.away === "string" ? canonicalClubName(input.away) : "";
  if (!Number.isFinite(now.getTime()) || !competition?.enabled || !goalCalibrationClubNameIsValid(home) || !goalCalibrationClubNameIsValid(away)
    || input.home !== input.home.trim() || input.away !== input.away.trim()
    || normalizeTeamName(home) === normalizeTeamName(away)
    || ![input.homeStrength, input.awayStrength].every(value => Number.isFinite(value) && value >= 500 && value <= 3000)
    || ![0, DEFAULT_HOME_ADVANTAGE_ELO].includes(input.homeAdvantageElo)) {
    throw new Error("Invalid active score model fixture, ratings or home advantage");
  }
  const kickoff = goalCalibrationUtcInstant(input.kickoff);
  const baseline = scoreMatrix(...eloToLambdas(input.homeStrength, input.awayStrength, input.homeAdvantageElo));
  let matrix = baseline;
  const tempered = input.competitionId === "eng.1" && (options.oneXTwoTemperature ?? oneXTwoTemperatureEnabled());
  const target1x2 = tempered
    ? scaleOneXTwoProbabilities(matrixTo1x2(baseline), ONE_X_TWO_TEMPERATURE) : matrixTo1x2(baseline);
  let method: "baseline" | "calibrated" = "baseline";
  let methodId = "clubelo-elo-to-goals-dixon-coles";
  let calibrationStatus = input.competitionId !== "eng.1" ? "baseline-competition"
    : input.homeAdvantageElo === 0 ? "baseline-neutral" : "baseline-before-calibration-origin";
  let artifactId: string | null = null;
  let artifactSha256: string | null = null;
  let unknownTeamEffects: string[] = [];
  if (input.competitionId === "eng.1" && input.homeAdvantageElo === DEFAULT_HOME_ADVANTAGE_ELO
    && kickoff >= Date.parse(options.activationOrigin ?? EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN)) {
    if (!artifact) throw new Error("Current EPL scoring requires reviewed goal calibration; baseline fallback is disabled");
    assertValidatedEplGoalCalibrationArtifact(artifact, now);
    const fit = artifact.artifact.fit;
    if (kickoff < goalCalibrationUtcInstant(fit.origin)) throw new Error("Calibration parameters cannot precede their target fixture");
    unknownTeamEffects = [home, away].filter(name => !Object.hasOwn(fit.teamEffects, name));
    const [lambdaHome, lambdaAway] = historicalGoalLambdas(fit, { homeCanonicalName: home, awayCanonicalName: away,
      homeElo: input.homeStrength, awayElo: input.awayStrength });
    matrix = anchorScoreGridTo1x2(scoreMatrix(lambdaHome, lambdaAway, fit.rho), target1x2).matrix;
    method = "calibrated";
    methodId = artifact.artifact.methodId;
    calibrationStatus = "calibrated";
    artifactId = artifact.artifactId;
    artifactSha256 = artifact.artifactSha256;
  }
  // Tempered baseline rows are re-anchored too, so every market comes from one coherent grid.
  if (tempered && method === "baseline") matrix = anchorScoreGridTo1x2(baseline, target1x2).matrix;
  const [pHome, pDraw, pAway] = matrixTo1x2(matrix);
  const [pOver2_5, pUnder2_5] = matrixToTotals(matrix, 2.5);
  const [pBttsYes, pBttsNo] = matrixToBtts(matrix);
  let expectedHomeGoals = 0, expectedAwayGoals = 0;
  matrix.forEach((row, homeGoals) => row.forEach((probability, awayGoals) => {
    expectedHomeGoals += homeGoals * probability;
    expectedAwayGoals += awayGoals * probability;
  }));
  return { method, methodId, calibrationStatus, artifactId, artifactSha256, unknownTeamEffects,
    matrix, expectedHomeGoals, expectedAwayGoals, pHome, pDraw, pAway, pOver2_5, pUnder2_5,
    pBttsYes, pBttsNo, topScores: matrixToCorrectScores(matrix, 5), scorelines: matrixToScorelines(matrix) };
}

export function getResolvedActiveScoreModel(input: ActiveScoreModelInput, now = new Date()) {
  const requiresCalibration = input.competitionId === "eng.1" && input.homeAdvantageElo === DEFAULT_HOME_ADVANTAGE_ELO
    && goalCalibrationUtcInstant(input.kickoff) >= Date.parse(EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN);
  return resolveActiveScoreModel(input, requiresCalibration ? loadEplGoalCalibrationArtifact({ now }) : null, now);
}

function resolveWithPin(input: ActiveScoreModelInput, pin: EplGoalCalibrationPin, at: Date) {
  const requiresCalibration = input.competitionId === "eng.1" && input.homeAdvantageElo === DEFAULT_HOME_ADVANTAGE_ELO
    && goalCalibrationUtcInstant(input.kickoff) >= Date.parse(pin.activationOrigin);
  const artifact = requiresCalibration
    ? loadEplGoalCalibrationArtifact({ expectedSha256: pin.sha256, activationOrigin: pin.activationOrigin, now: at }) : null;
  return resolveActiveScoreModel(input, artifact, at, { activationOrigin: pin.activationOrigin });
}

export interface CarriedScoreModelOptions {
  /** Clock for the current pin. Defaults to now. */
  now?: Date;
  /** The row's own forecast time; a retired pin is judged fresh at this instant. */
  forecastAt?: Date;
  /** Reviewed pins, current first. Tests inject a re-pinned registry here. */
  pins?: readonly EplGoalCalibrationPin[];
}

/**
 * Replays a cached or stored forecast against the calibration it carries.
 * Rows built under the current pin (or none) take exactly the current path.
 * Rows built under a reviewed pin that a re-pin has since retired replay
 * against that pin at their own forecast time, instead of being compared with
 * today's pin and rejected. An artifact that was never pinned still throws.
 */
export function replayCarriedScoreModel(
  input: ActiveScoreModelInput, carriedArtifactSha256: string | null | undefined, options: CarriedScoreModelOptions = {}
) {
  const pins = options.pins ?? EPL_GOAL_CALIBRATION_PINS;
  const now = options.now ?? new Date();
  if (pins === EPL_GOAL_CALIBRATION_PINS && (!carriedArtifactSha256 || carriedArtifactSha256 === pins[0]?.sha256)) {
    return getResolvedActiveScoreModel(input, now);
  }
  const current = pins[0];
  if (!current) throw new Error("No reviewed EPL goal calibration pin");
  if (!carriedArtifactSha256 || carriedArtifactSha256 === current.sha256) return resolveWithPin(input, current, now);
  const retired = pins.slice(1).find((pin) => pin.sha256 === carriedArtifactSha256);
  if (!retired) throw new Error("Cached forecast carries a calibration artifact that was never pinned");
  const forecastAt = options.forecastAt;
  if (!forecastAt || !Number.isFinite(forecastAt.getTime())) {
    throw new Error("Replaying a retired calibration pin requires the row's forecast time");
  }
  return resolveWithPin(input, retired, forecastAt);
}
