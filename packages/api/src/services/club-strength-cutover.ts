import fs from "node:fs";
import path from "node:path";
import { getCompetitionById } from "../config/competitions";
import { canonicalClubName } from "../lib/team-names";
import { ELO_CHAMPION } from "./model-contributors";
import { DEFAULT_HOME_ADVANTAGE_ELO } from "./dixon-coles";
import { ValidatedClubStrengthArtifact } from "./club-strength-artifact";

export const CLUB_STRENGTH_GOLDEN_FILE = "model-artifacts/clubelo/golden-cutover-v1.json";

export interface ClubStrengthGoldenFixture {
  competitionId: string;
  fixtureId: number;
  home: string;
  away: string;
  homeElo: number;
  awayElo: number;
  pHome: number;
  pDraw: number;
  pAway: number;
  pOver2_5: number;
  pUnder2_5: number;
  pBttsYes: number;
  pBttsNo: number;
  topScores: Array<{ score: string; probability: number }>;
}

function rounded(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function readClubStrengthGolden(repoDataDir: string): ClubStrengthGoldenFixture[] {
  return JSON.parse(
    fs.readFileSync(path.join(repoDataDir, CLUB_STRENGTH_GOLDEN_FILE), "utf8")
  ) as ClubStrengthGoldenFixture[];
}

/** Exact pre-cutover payload gate for every fixture that was already priced. */
export function verifyClubStrengthCutover(
  artifact: ValidatedClubStrengthArtifact,
  golden: ClubStrengthGoldenFixture[]
): void {
  if (golden.length !== 18 || new Set(golden.map((row) => row.fixtureId)).size !== 18) {
    throw new Error("Club-strength cutover golden must contain 18 unique fixtures.");
  }
  for (const expected of golden) {
    const competition = getCompetitionById(expected.competitionId);
    if (!competition) throw new Error(`Unknown golden competition ${expected.competitionId}.`);
    const ratings = artifact.byProfile[competition.ratingProfile];
    const home = ratings.get(canonicalClubName(expected.home));
    const away = ratings.get(canonicalClubName(expected.away));
    if (home === undefined || away === undefined) {
      throw new Error(`Golden fixture ${expected.fixtureId} is missing a rating input.`);
    }
    const model = ELO_CHAMPION.forecast({
      homeStrength: home,
      awayStrength: away,
      homeAdvantageElo: competition.homeFieldAdvantage ? DEFAULT_HOME_ADVANTAGE_ELO : 0,
    });
    const actual: ClubStrengthGoldenFixture = {
      competitionId: expected.competitionId,
      fixtureId: expected.fixtureId,
      home: expected.home,
      away: expected.away,
      homeElo: rounded(home, 1),
      awayElo: rounded(away, 1),
      pHome: rounded(model.pHome),
      pDraw: rounded(model.pDraw),
      pAway: rounded(model.pAway),
      pOver2_5: rounded(model.pOver2_5),
      pUnder2_5: rounded(model.pUnder2_5),
      pBttsYes: rounded(model.pBttsYes),
      pBttsNo: rounded(model.pBttsNo),
      topScores: model.topScores.map(([[homeGoals, awayGoals], probability]) => ({
        score: `${homeGoals}-${awayGoals}`,
        probability: rounded(probability),
      })),
    };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Club-strength cutover changed fixture ${expected.fixtureId}.`);
    }
  }
}
