import { describe, expect, it, vi } from "vitest";
import * as featuredFixtures from "./featured-fixtures";
import * as modelData from "./model-data";
import { fixture } from "./__fixtures__/model-fixture";
import { answerQuestion } from "./ask";
import { refreshClubRatingsForTest } from "./club-ratings";

describe("demo featured match and slate parlay", () => {
  it("grounds today's featured match and builds a two-leg parlay without provider calls", async () => {
    await refreshClubRatingsForTest(new Date());
    const kickoff = new Date(Date.now() + 86_400_000).toISOString();
    const spurs = fixture("Tottenham Hotspur", "Coventry City", {
      fixtureId: 1,
      utcDate: kickoff,
      date: kickoff.slice(0, 10),
      pHome: 0.62,
      pDraw: 0.22,
      pAway: 0.16,
      homeElo: 1850,
      awayElo: 1600,
    });
    const arsenal = fixture("Arsenal", "Crystal Palace", {
      fixtureId: 2,
      utcDate: kickoff,
      date: kickoff.slice(0, 10),
      pHome: 0.58,
      pDraw: 0.24,
      pAway: 0.18,
      homeElo: 1900,
      awayElo: 1650,
    });
    const cached = vi.spyOn(modelData, "getCachedModelData").mockReturnValue({
      fixtures: [spurs, arsenal],
      lastUpdated: new Date(),
      error: null,
    });
    const featured = vi.spyOn(featuredFixtures, "getFeaturedModelFixtures").mockReturnValue([spurs, arsenal]);
    try {
      const featuredTurn = await answerQuestion(
        "What's the fair price on today's featured match and is there any edge vs the market?",
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        "desk"
      );
      expect(featuredTurn.grounding?.kind).toBe("match");
      expect(featuredTurn.answer).not.toMatch(/couldn't confirm/i);
      expect(featuredTurn.answer).toMatch(/Tottenham Hotspur|Coventry/i);

      const parlayTurn = await answerQuestion(
        "Build me a 2-leg parlay from today's matches with the combined price",
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        "desk"
      );
      expect(parlayTurn.answer).toContain("Tottenham Hotspur v Coventry City");
      expect(parlayTurn.answer).toContain("Arsenal v Crystal Palace");
      expect(parlayTurn.answer).not.toMatch(/Brighton|Forest/i);
      expect(parlayTurn.answer).toMatch(/Combined model probability/i);
    } finally {
      cached.mockRestore();
      featured.mockRestore();
    }
  });
});
