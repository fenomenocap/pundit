import { getCompetitionById } from "../config/competitions";
import { canonicalClubName, normalizeTeamName } from "../lib/team-names";
import { DEFAULT_HOME_ADVANTAGE_ELO, eloToLambdas, matrixTo1x2, matrixToBtts,
  matrixToCorrectScores, matrixToScorelines, matrixToTotals, scoreMatrix } from "./dixon-coles";
import { assertValidatedEplGoalCalibrationArtifact, EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN,
  goalCalibrationClubNameIsValid, goalCalibrationUtcInstant, loadEplGoalCalibrationArtifact,
  type ValidatedEplGoalCalibrationArtifact } from "./epl-goal-calibration-artifact";
import { historicalGoalLambdas } from "./historical-goal-calibration";
import { anchorScoreGridTo1x2 } from "./outcome-anchored-score-grid";

export interface ActiveScoreModelInput {
  home: string;
  away: string;
  competitionId: string;
  homeStrength: number;
  awayStrength: number;
  homeAdvantageElo: number;
  kickoff: string;
}

export function resolveActiveScoreModel(
  input: ActiveScoreModelInput, artifact: ValidatedEplGoalCalibrationArtifact | null, now = new Date()
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
  let method: "baseline" | "calibrated" = "baseline";
  let methodId = "clubelo-elo-to-goals-dixon-coles";
  let calibrationStatus = input.competitionId !== "eng.1" ? "baseline-competition"
    : input.homeAdvantageElo === 0 ? "baseline-neutral" : "baseline-before-calibration-origin";
  let artifactId: string | null = null;
  let artifactSha256: string | null = null;
  let unknownTeamEffects: string[] = [];
  if (input.competitionId === "eng.1" && input.homeAdvantageElo === DEFAULT_HOME_ADVANTAGE_ELO
    && kickoff >= Date.parse(EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN)) {
    if (!artifact) throw new Error("Current EPL scoring requires reviewed goal calibration; baseline fallback is disabled");
    assertValidatedEplGoalCalibrationArtifact(artifact, now);
    const fit = artifact.artifact.fit;
    if (kickoff < goalCalibrationUtcInstant(fit.origin)) throw new Error("Calibration parameters cannot precede their target fixture");
    unknownTeamEffects = [home, away].filter(name => !Object.hasOwn(fit.teamEffects, name));
    const [lambdaHome, lambdaAway] = historicalGoalLambdas(fit, { homeCanonicalName: home, awayCanonicalName: away,
      homeElo: input.homeStrength, awayElo: input.awayStrength });
    matrix = anchorScoreGridTo1x2(scoreMatrix(lambdaHome, lambdaAway, fit.rho), matrixTo1x2(baseline)).matrix;
    method = "calibrated";
    methodId = artifact.artifact.methodId;
    calibrationStatus = "calibrated";
    artifactId = artifact.artifactId;
    artifactSha256 = artifact.artifactSha256;
  }
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
