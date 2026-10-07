import { getCompetitionById } from "../config/competitions";
import {
  sameClub,
  getClubFormSnapshot,
  type ClubScorer,
  type ResultMark,
} from "./club-form";
import { DEFAULT_HOME_ADVANTAGE_ELO, eloToLambdas } from "./dixon-coles";
import { getResolvedActiveScoreModel } from "./active-score-model";
import { EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN } from "./epl-goal-calibration-artifact";
import {
  ELO_CHAMPION,
  ELO_CHAMPION_CONFIG,
  PUNDIT_FUNDAMENTAL_MODEL_ID,
  PUNDIT_FUNDAMENTAL_MODEL_VERSION,
} from "./model-contributors";
import type { ModelFixture } from "./model-data";

export type MatchTableContext = {
  position: number | null;
  points: number | null;
  goalDifference: number | null;
  playedGames: number | null;
};

export type MatchContext = {
  homeElo: number;
  awayElo: number;
  lambdaHome: number;
  lambdaAway: number;
  totalXg: number;
  homeForm: ResultMark[];
  awayForm: ResultMark[];
  homeTable: MatchTableContext;
  awayTable: MatchTableContext;
  homeScorers: ClubScorer[];
  awayScorers: ClubScorer[];
};

function homeAdvantageEloFor(fixture: ModelFixture): number {
  if (fixture.forecastProvenance?.homeAdvantageElo != null) {
    return fixture.forecastProvenance.homeAdvantageElo;
  }
  const competition = getCompetitionById(fixture.competitionId);
  return competition?.homeFieldAdvantage ? DEFAULT_HOME_ADVANTAGE_ELO : 0;
}

function tableFromRow(row: {
  position: number | null;
  points: number | null;
  goalDifference: number | null;
  playedGames: number | null;
} | undefined): MatchTableContext {
  return {
    position: row?.position ?? null,
    points: row?.points ?? null,
    goalDifference: row?.goalDifference ?? null,
    playedGames: row?.playedGames ?? null,
  };
}

function teamRow(snapshot: ReturnType<typeof getClubFormSnapshot>, team: string) {
  return snapshot.teams.find((row) => sameClub(row.team, team));
}

function exactForecastInputs(fixture: ModelFixture): [number, number, number] {
  const inputs = fixture.forecastInputs;
  // Compatibility for historical rows and hand-authored fixtures only. Newly
  // built production rows always carry their original full-precision inputs.
  if (inputs === undefined) {
    const requiresCalibration = fixture.competitionId === "eng.1"
      && homeAdvantageEloFor(fixture) === DEFAULT_HOME_ADVANTAGE_ELO
      && Date.parse(fixture.utcDate) >= Date.parse(EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN);
    if (fixture.goalCalibration || (requiresCalibration
      && (fixture.forecastProvenance !== undefined || fixture.scoreGrid !== undefined))) {
      throw new Error("Calibrated forecast requires its exact carried inputs and artifact identity");
    }
    return [fixture.homeElo, fixture.awayElo, homeAdvantageEloFor(fixture)];
  }
  if (inputs === null || typeof inputs !== "object") {
    throw new Error("Cached forecast inputs do not match fixture provenance");
  }
  const provenance = fixture.forecastProvenance;
  const calibration = fixture.goalCalibration;
  const valid = provenance != null
    && [inputs.homeStrength, inputs.awayStrength, inputs.homeAdvantageElo].every(Number.isFinite)
    && Number.isFinite(provenance.homeAdvantageElo)
    && inputs.homeAdvantageElo === provenance.homeAdvantageElo
    && provenance.modelId === PUNDIT_FUNDAMENTAL_MODEL_ID
    && provenance.modelVersion === PUNDIT_FUNDAMENTAL_MODEL_VERSION
    && provenance.contributorId === (calibration ? "clubelo-calibrated-goals" : ELO_CHAMPION.id)
    && provenance.contributorVersion === (calibration?.artifactSha256 ?? ELO_CHAMPION.version)
    && provenance.methodId === (calibration?.methodId ?? ELO_CHAMPION.methodId)
    && provenance.ratingProfile === getCompetitionById(fixture.competitionId)?.ratingProfile
    && provenance.config != null
    && (Object.keys(ELO_CHAMPION_CONFIG) as Array<keyof typeof ELO_CHAMPION_CONFIG>)
      .every((key) => provenance.config[key] === ELO_CHAMPION_CONFIG[key])
    && inputs.fixtureId === fixture.fixtureId
    && inputs.competitionId === fixture.competitionId
    && inputs.utcDate === fixture.utcDate
    && inputs.home === fixture.home && inputs.away === fixture.away
    && Math.round(inputs.homeStrength * 10) / 10 === fixture.homeElo
    && Math.round(inputs.awayStrength * 10) / 10 === fixture.awayElo
    && inputs.ratingArtifactId === (provenance.ratingArtifactId ?? null)
    && inputs.ratingArtifactSha256 === (provenance.ratingArtifactSha256 ?? null)
    && inputs.ratingSnapshotAt === provenance.ratingSnapshotAt
    && (inputs.goalCalibrationArtifactSha256 ?? null) === (calibration?.artifactSha256 ?? null)
    && (provenance.goalCalibrationArtifactSha256 ?? null) === (calibration?.artifactSha256 ?? null);
  if (!valid) throw new Error("Cached forecast inputs do not match fixture provenance");
  const model = getResolvedActiveScoreModel({
    competitionId: fixture.competitionId, home: fixture.home, away: fixture.away, kickoff: fixture.utcDate,
    homeStrength: inputs.homeStrength, awayStrength: inputs.awayStrength, homeAdvantageElo: inputs.homeAdvantageElo,
  });
  if ((model.artifactSha256 ?? null) !== (calibration?.artifactSha256 ?? null)
    || (calibration && (calibration.artifactId !== model.artifactId || calibration.methodId !== model.methodId))) {
    throw new Error("Cached forecast calibration does not match the reviewed artifact");
  }
  const probabilities = ["pHome", "pDraw", "pAway", "pOver2_5", "pUnder2_5", "pBttsYes", "pBttsNo"] as const;
  const matches = probabilities.every((key) => Number.isFinite(fixture[key])
      && Math.round(model[key] * 10_000) / 10_000 === fixture[key])
    && (["topScores", "scorelines"] as const).every((key) => {
      const rows = fixture[key];
      return Array.isArray(rows) && rows.length === model[key].length
        && rows.every((row, index) => {
          const [[home, away], probability] = model[key][index];
          return row?.score === `${home}-${away}`
            && Math.round(probability * 10_000) / 10_000 === row.probability;
        });
    });
  if (!matches) throw new Error("Cached forecast inputs do not reproduce fixture probabilities");
  if (fixture.scoreGrid !== undefined || calibration) {
    const grid = fixture.scoreGrid;
    if (!Array.isArray(grid) || grid.length !== model.matrix.length
      || grid.some((row, home) => !Array.isArray(row) || row.length !== model.matrix[home].length
        || row.some((p, away) => !Number.isFinite(p) || Math.abs(p - model.matrix[home][away]) > 1e-12))
      || !Number.isFinite(fixture.expectedHomeGoals) || !Number.isFinite(fixture.expectedAwayGoals)
      || Math.abs(fixture.expectedHomeGoals! - model.expectedHomeGoals) > 1e-10
      || Math.abs(fixture.expectedAwayGoals! - model.expectedAwayGoals) > 1e-10) {
      throw new Error("Cached forecast grid or expected goals do not reproduce the reviewed distribution");
    }
  }
  return [inputs.homeStrength, inputs.awayStrength, inputs.homeAdvantageElo];
}

export function buildMatchContext(fixture: ModelFixture): MatchContext {
  const inputs = exactForecastInputs(fixture);
  const [lambdaHome, lambdaAway] = fixture.goalCalibration
    ? [fixture.expectedHomeGoals!, fixture.expectedAwayGoals!]
    : eloToLambdas(...inputs);
  const snapshot = getClubFormSnapshot(fixture.competitionId);
  const homeRow = teamRow(snapshot, fixture.home);
  const awayRow = teamRow(snapshot, fixture.away);

  return {
    homeElo: fixture.homeElo,
    awayElo: fixture.awayElo,
    lambdaHome,
    lambdaAway,
    totalXg: lambdaHome + lambdaAway,
    homeForm: homeRow?.form ?? [],
    awayForm: awayRow?.form ?? [],
    homeTable: tableFromRow(homeRow),
    awayTable: tableFromRow(awayRow),
    homeScorers: homeRow?.scorers ?? [],
    awayScorers: awayRow?.scorers ?? [],
  };
}

export function formatFormMarks(form: ResultMark[]): string {
  return form.length > 0 ? form.join("") : "—";
}

export function formatTableLine(team: string, table: MatchTableContext): string {
  if (table.position == null && table.points == null) {
    return `${team}: no table row`;
  }
  const parts = [
    table.position != null ? `${table.position}${ordinalSuffix(table.position)}` : null,
    table.points != null ? `${table.points} pts` : null,
    table.goalDifference != null ? `${table.goalDifference >= 0 ? "+" : ""}${table.goalDifference} GD` : null,
    table.playedGames != null ? `${table.playedGames} played` : null,
  ].filter(Boolean);
  return `${team}: ${parts.join(", ")}`;
}

export function formatScorersLine(team: string, scorers: ClubScorer[]): string {
  if (scorers.length === 0) return `${team} scorers: none on record`;
  const names = scorers.map((scorer) => `${scorer.name} (${scorer.goals})`).join(", ");
  return `${team} scorers: ${names}`;
}

export function emptyMatchTableContext(): MatchTableContext {
  return {
    position: null,
    points: null,
    goalDifference: null,
    playedGames: null,
  };
}

/** Minimal match-context fields for hand-built Grounding literals in tests. */
export function sampleMatchContextFields(
  overrides: Partial<MatchContext> = {}
): MatchContext {
  return {
    homeElo: 1800,
    awayElo: 1700,
    lambdaHome: 1.35,
    lambdaAway: 1.35,
    totalXg: 2.7,
    homeForm: [],
    awayForm: [],
    homeTable: emptyMatchTableContext(),
    awayTable: emptyMatchTableContext(),
    homeScorers: [],
    awayScorers: [],
    ...overrides,
  };
}

function ordinalSuffix(position: number): string {
  const mod100 = position % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (position % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}
