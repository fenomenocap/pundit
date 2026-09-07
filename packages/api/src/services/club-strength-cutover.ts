import fs from "node:fs";
import path from "node:path";
import { getCompetitionById } from "../config/competitions";
import { canonicalClubName } from "../lib/team-names";
import { ELO_CHAMPION } from "./model-contributors";
import { DEFAULT_HOME_ADVANTAGE_ELO } from "./dixon-coles";
import {
  readClubStrengthArtifact,
  ValidatedClubStrengthArtifact,
} from "./club-strength-artifact";

export const CLUB_STRENGTH_GOLDEN_FILE = "model-artifacts/clubelo/golden-cutover-v1.json";
export const CLUB_STRENGTH_CUTOVER_ARTIFACT_FILE =
  "model-artifacts/clubelo/2da1616b28750ddbba93bb107ee4f1c5b450ef6fe1c92bda6914b6e3fb8ba6cf.json";

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

export function readClubStrengthCutoverArtifact(repoDataDir: string): ValidatedClubStrengthArtifact {
  const filePath = path.join(repoDataDir, CLUB_STRENGTH_CUTOVER_ARTIFACT_FILE);
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as { payload?: { snapshotAt?: string } };
  const snapshotAt = parsed.payload?.snapshotAt;
  if (!snapshotAt) throw new Error("Cutover ClubElo artifact is missing snapshotAt.");
  return readClubStrengthArtifact(filePath, new Date(snapshotAt));
}

export function writeClubStrengthGolden(
  repoDataDir: string,
  golden: ClubStrengthGoldenFixture[]
): void {
  const filePath = path.join(repoDataDir, CLUB_STRENGTH_GOLDEN_FILE);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(golden, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

export function forecastGoldenFixture(
  identity: Pick<ClubStrengthGoldenFixture, "competitionId" | "fixtureId" | "home" | "away">,
  homeElo: number,
  awayElo: number
): ClubStrengthGoldenFixture {
  const competition = getCompetitionById(identity.competitionId);
  if (!competition) throw new Error(`Unknown golden competition ${identity.competitionId}.`);
  const model = ELO_CHAMPION.forecast({
    homeStrength: homeElo,
    awayStrength: awayElo,
    homeAdvantageElo: competition.homeFieldAdvantage ? DEFAULT_HOME_ADVANTAGE_ELO : 0,
  });
  return {
    competitionId: identity.competitionId,
    fixtureId: identity.fixtureId,
    home: identity.home,
    away: identity.away,
    homeElo: rounded(homeElo, 1),
    awayElo: rounded(awayElo, 1),
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
}

export function reconstructGoldenFixture(
  artifact: ValidatedClubStrengthArtifact,
  identity: Pick<ClubStrengthGoldenFixture, "competitionId" | "fixtureId" | "home" | "away">
): ClubStrengthGoldenFixture {
  const competition = getCompetitionById(identity.competitionId);
  if (!competition) throw new Error(`Unknown golden competition ${identity.competitionId}.`);
  const ratings = artifact.byProfile[competition.ratingProfile];
  const home = ratings.get(canonicalClubName(identity.home));
  const away = ratings.get(canonicalClubName(identity.away));
  if (home === undefined || away === undefined) {
    throw new Error(`Golden fixture ${identity.fixtureId} is missing a rating input.`);
  }
  return forecastGoldenFixture(identity, home, away);
}

export function rebuildClubStrengthGolden(
  artifact: ValidatedClubStrengthArtifact,
  identities: Array<Pick<ClubStrengthGoldenFixture, "competitionId" | "fixtureId" | "home" | "away">>
): ClubStrengthGoldenFixture[] {
  assertGoldenIdentities(identities);
  return identities.map((identity) => reconstructGoldenFixture(artifact, identity));
}

function assertGoldenIdentities(
  identities: Array<Pick<ClubStrengthGoldenFixture, "fixtureId">>
): void {
  if (identities.length !== 18 || new Set(identities.map((row) => row.fixtureId)).size !== 18) {
    throw new Error("Club-strength cutover golden must contain 18 unique fixtures.");
  }
}

/**
 * Mapping lock for the 18 cutover fixtures. Pass the frozen cutover artifact,
 * not the current production selector, so a reviewed freshness refresh can
 * change live ratings without rewriting this baseline.
 */
export function verifyClubStrengthCutover(
  artifact: ValidatedClubStrengthArtifact,
  golden: ClubStrengthGoldenFixture[]
): void {
  assertGoldenIdentities(golden);
  for (const expected of golden) {
    const actual = reconstructGoldenFixture(artifact, expected);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Club-strength cutover changed fixture ${expected.fixtureId}.`);
    }
  }
}
