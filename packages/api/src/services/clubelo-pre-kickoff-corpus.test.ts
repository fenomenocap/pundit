import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildClubEloProfileMaps,
  iterateUtcDates,
  joinFixturesWithFromToElo,
  joinFixturesWithPreKickoffElo,
  parseClubEloCsv,
  preKickoffCoverageBySeason,
  rankingDateForKickoff,
  selectRankingDate,
  uniqueRankingDatesForFixtures,
  validatePreKickoffCorpus,
  ClubEloDailyRanking,
  PreKickoffEloFixtureInput,
} from "./clubelo-pre-kickoff-corpus";

function ranking(
  rankingDate: string,
  clubs: Record<string, { country: string; elo: number }>
): ClubEloDailyRanking {
  const rows = Object.entries(clubs).map(([club, value]) => ({
    club,
    country: value.country,
    elo: value.elo,
  }));
  return {
    rankingDate,
    retrievedAt: `${rankingDate}T12:00:00.000Z`,
    sourceUrl: `http://api.clubelo.com/${rankingDate}`,
    sourceSha256: "test",
    byProfile: buildClubEloProfileMaps(rows),
  };
}

function fixture(
  id: string,
  kickoff: string,
  home = "Hull",
  away = "Man United",
  competitionId = "eng.1"
): PreKickoffEloFixtureInput {
  return {
    sourceEventId: id,
    competitionId,
    seasonId: "2024-25",
    kickoff,
    homeCanonicalName: home,
    awayCanonicalName: away,
    trainingEligible: true,
  };
}

describe("chronological ClubElo pre-kickoff corpus", () => {
  it("uses the UTC calendar day before kickoff as the policy ranking date", () => {
    expect(rankingDateForKickoff("2024-08-17T14:00:00Z")).toBe("2024-08-16");
    expect(rankingDateForKickoff("2024-08-17T00:30:00Z")).toBe("2024-08-16");
    expect(rankingDateForKickoff("not-a-date")).toBeNull();
  });

  it("selects the latest captured ranking that is still strictly before kickoff", () => {
    expect(selectRankingDate("2024-08-17T14:00:00Z", ["2024-08-14", "2024-08-16", "2024-08-17"]))
      .toBe("2024-08-16");
    expect(selectRankingDate("2024-08-17T14:00:00Z", ["2024-08-17", "2024-08-18"]))
      .toBeNull();
  });

  it("joins fixture kickoff to captured ratings without inventing Elo", () => {
    const rankings = new Map([
      ["2024-08-16", ranking("2024-08-16", {
        Hull: { country: "ENG", elo: 1532.88 },
        "Man United": { country: "ENG", elo: 1915.316 },
      })],
    ]);
    const { rows, missing } = joinFixturesWithPreKickoffElo([
      fixture("401879322", "2024-08-17T14:00:00Z"),
      fixture("missing-club", "2024-08-17T14:00:00Z", "Hull", "Unknown FC"),
    ], rankings);
    expect(missing).toHaveLength(1);
    expect(missing[0].reason).toBe("missing-away-elo");
    expect(rows).toEqual([expect.objectContaining({
      sourceEventId: "401879322",
      rankingDate: "2024-08-16",
      homeElo: 1532.88,
      awayElo: 1915.316,
      ratingProfile: "eng-clubs",
    })]);
  });

  it("parses ClubElo CSV rows and maps ENG clubs onto both profiles", () => {
    const parsed = parseClubEloCsv([
      "Rank,Club,Country,Level,Elo,From,To",
      "1,Man United,ENG,1,1915.316,2024-08-16,2024-08-17",
      "2,Bayern,GER,1,2001.5,2024-08-16,2024-08-17",
    ].join("\n"));
    const profiles = buildClubEloProfileMaps(parsed);
    expect(profiles["eng-clubs"]["Man United"]).toBe(1915.316);
    expect(profiles["eng-clubs"].Bayern).toBeUndefined();
    expect(profiles["uefa-clubs"].Bayern).toBe(2001.5);
  });

  it("passes a complete Premier League required set", () => {
    const fixtures = [fixture("1", "2024-08-17T14:00:00Z")];
    const { rows, missing } = joinFixturesWithPreKickoffElo(fixtures, new Map([
      ["2024-08-16", ranking("2024-08-16", {
        Hull: { country: "ENG", elo: 1532.88 },
        "Man United": { country: "ENG", elo: 1915.316 },
      })],
    ]));
    const validation = validatePreKickoffCorpus(rows, fixtures, missing);
    expect(validation.status).toBe("pass");
    expect(validation.inventedRatingCount).toBe(0);
    expect(validation.errors).toEqual([]);
  });

  it("fails closed on missing required coverage and look-ahead rankings", () => {
    const uncovered = [fixture("1", "2024-08-17T14:00:00Z")];
    const { rows, missing } = joinFixturesWithPreKickoffElo(uncovered, new Map());
    const missingValidation = validatePreKickoffCorpus(rows, uncovered, missing);
    expect(missingValidation.status).toBe("fail");
    expect(missingValidation.requiredMissingCount).toBe(1);
    expect(missingValidation.inventedRatingCount).toBe(0);

    const lookAhead = validatePreKickoffCorpus([{
      sourceEventId: "2",
      competitionId: "eng.1",
      seasonId: "2024-25",
      kickoff: "2024-08-17T14:00:00Z",
      homeCanonicalName: "Hull",
      awayCanonicalName: "Man United",
      ratingProfile: "eng-clubs",
      rankingDate: "2024-08-17",
      homeElo: 1532.88,
      awayElo: 1915.316,
    }], [fixture("2", "2024-08-17T14:00:00Z")]);
    expect(lookAhead.status).toBe("fail");
    expect(lookAhead.lookAheadViolations).toEqual(["2"]);
  });

  it("keeps UCL holes from blocking Premier League training eligibility", () => {
    const fixtures = [
      fixture("pl", "2024-08-17T14:00:00Z"),
      fixture("ucl", "2024-07-15T18:00:00Z", "Bayern", "Inter", "uefa.champions_qual"),
    ];
    const { rows, missing } = joinFixturesWithPreKickoffElo(fixtures, new Map([
      ["2024-08-16", ranking("2024-08-16", {
        Hull: { country: "ENG", elo: 1532.88 },
        "Man United": { country: "ENG", elo: 1915.316 },
      })],
    ]));
    const validation = validatePreKickoffCorpus(rows, fixtures, missing, ["eng.1"]);
    expect(validation.requiredMissingCount).toBe(0);
    expect(validation.status).toBe("inconclusive");
    expect(validation.warnings.some((warning) => warning.includes("non-required"))).toBe(true);
  });

  it("enumerates capture dates without inventing ratings", () => {
    expect(iterateUtcDates("2024-08-16", "2024-08-18")).toEqual([
      "2024-08-16",
      "2024-08-17",
      "2024-08-18",
    ]);
    expect(uniqueRankingDatesForFixtures([
      fixture("1", "2024-08-17T14:00:00Z"),
      fixture("2", "2024-08-17T16:00:00Z"),
    ])).toEqual(["2024-08-16"]);
  });

  it("joins From/To windows without look-ahead, interpolation, or carrying past To", () => {
    const windows = [
      { club: "Hull", country: "ENG", elo: 1532.88, from: "2024-08-10", to: "2024-08-24", scrapeDate: "2024-08-15" },
      { club: "Man United", country: "ENG", elo: 1915.316, from: "2024-08-10", to: "2024-08-24", scrapeDate: "2024-08-15" },
      { club: "Hull", country: "ENG", elo: 1633.12, from: "2024-08-16", to: "2024-08-31", scrapeDate: "2024-08-25" },
      { club: "Man United", country: "ENG", elo: 1884.0, from: "2026-08-01", to: "2026-08-12", scrapeDate: "2026-08-12" },
      { club: "Hull", country: "ENG", elo: 1530.0, from: "2024-12-15", to: "2024-12-21", scrapeDate: "2024-12-19" },
      { club: "Man United", country: "ENG", elo: 1799.3, from: "2024-12-15", to: "2024-12-21", scrapeDate: "2024-12-19" },
    ];
    const fixtures = [
      fixture("look-ahead", "2024-08-24T14:00:00Z"),
      fixture("scrape-gap", "2024-12-21T15:00:00Z"),
      fixture("past-to", "2024-12-23T15:00:00Z"),
    ];
    const { rows, missing } = joinFixturesWithFromToElo(fixtures, windows);
    expect(rows).toEqual([
      expect.objectContaining({
        sourceEventId: "look-ahead",
        rankingDate: "2024-08-23",
        homeElo: 1532.88,
        awayElo: 1915.316,
      }),
      expect.objectContaining({
        sourceEventId: "scrape-gap",
        rankingDate: "2024-12-20",
        homeElo: 1530.0,
        awayElo: 1799.3,
      }),
    ]);
    expect(missing).toEqual([expect.objectContaining({
      sourceEventId: "past-to",
      rankingDate: "2024-12-22",
      reason: "missing-home-elo",
    })]);
    const validation = validatePreKickoffCorpus(rows, fixtures, missing);
    expect(validation.lookAheadViolations).toEqual([]);
    expect(validation.inventedRatingCount).toBe(0);
    expect(preKickoffCoverageBySeason(fixtures, rows)["2024-25"]).toEqual({ n: 3, covered: 2 });
  });

  it("keeps runtime model modules from importing ClubElo capture scripts", () => {
    const runtimeFiles = [
      "model-data.ts",
      "club-ratings.ts",
      "club-strength-artifact.ts",
      "model-contributors.ts",
      "ask.ts",
    ];
    for (const file of runtimeFiles) {
      const source = fs.readFileSync(path.join(__dirname, file), "utf8");
      expect(source).not.toMatch(/capture-clubelo/);
      expect(source).not.toMatch(/clubelo-pre-kickoff-corpus/);
    }
  });
});
