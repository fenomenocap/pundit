import { test, expect } from "@playwright/test";
import { runViewportChecks } from "../../../scripts/capture-chat-eval-browser.mjs";

const fixtureId = "espn:eng.1:1";
const now = "2026-09-15T00:00:00.000Z";
const fixture = {
  fixtureId: 1, competitionId: "eng.1", competition: "Premier League",
  home: "Arsenal", away: "Coventry City", utcDate: "2026-09-17T00:00:00.000Z",
  pHome: 0.72, pDraw: 0.18, pAway: 0.1, homeElo: 1850, awayElo: 1520,
  pOver2_5: 0.55, pBttsYes: 0.48, oddsSources: [],
};
const grounding = {
  ...fixture, fixtureId, kind: "match", homeFieldAdvantage: true,
  date: "2026-09-17", stage: "match", pUnder2_5: 0.45, pBttsNo: 0.52,
  topScores: [{ score: "2-0", probability: 0.14 }],
  scorelines: [{ score: "2-0", probability: 0.14 }],
  stakePHome: null, stakePDraw: null, stakePAway: null,
  pricing: {
    fixtureId, home: fixture.home, away: fixture.away, kickoff: fixture.utcDate,
    modelVersion: "mock-v1", pricedAt: now,
    model: {
      home: { p: 0.72, fairOdds: 1 / 0.72 },
      draw: { p: 0.18, fairOdds: 1 / 0.18 },
      away: { p: 0.1, fairOdds: 10 },
    },
    markets: [], userLine: null, stakeFrac: null,
  },
};

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`certification harness completes every check at ${viewport.width}px without live traffic`, async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.clock.setFixedTime(new Date(now));
    const unexpected = [];
    const asks = [];
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === baseURL) return route.continue();
      if (url.hostname === "fonts.googleapis.com") return route.fulfill({ contentType: "text/css", body: "" });
      let body;
      if (url.pathname === "/api/ask") {
        const request = route.request().postDataJSON();
        asks.push(request);
        // Keep the real loading UI observable without making a provider call.
        await new Promise((resolve) => setTimeout(resolve, 100));
        const candidate = request.question.includes("Northbridge Athletic");
        const table = request.question.includes("table show");
        body = {
          answer: candidate ? "I couldn't confirm that matchup. Please share the teams, competition and date."
            : table ? "Arsenal lead this table." : "I make Arsenal the likeliest outcome at 72%.",
          grounding: candidate ? { kind: "general" } : table
            ? { kind: "competition", competition: "Premier League", competitionId: "eng.1", standings: [] }
            : grounding,
        };
      } else if (url.pathname === "/api/model/active") body = { fixtures: [fixture] };
      else if (url.pathname === "/api/matches/active") body = { fixtures: [{
        id: 1, homeTeam: fixture.home, awayTeam: fixture.away,
        competitionId: "eng.1", utcDate: fixture.utcDate, status: "SCHEDULED",
      }] };
      else if (url.pathname === "/api/matches/recent") body = { matches: [], clubForm: { teams: [] } };
      else if (url.pathname === "/ready") body = { status: "ready", model: { ready: true }, marketOdds: { ready: true } };
      else {
        unexpected.push(url.pathname);
        return route.abort();
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    // This local-only pacer is injected into the shared checks. Production's
    // mandatory timing and deployment gates are unchanged.
    const pacer = { starts: [], beforeRequest: async () => { pacer.starts.push(Date.now()); } };
    const traffic = { apiAskRequestCount: 0, lastFixtureId: null };
    const progress = { phase: "local", checks: {}, collected: {} };
    const checks = await runViewportChecks(page, baseURL, viewport, pacer, { scenarios: [] }, {
      fixtureId, capability: "priced", competitionId: "eng.1", numericFixtureId: 1,
      home: fixture.home, away: fixture.away, probabilities: [0.72, 0.18, 0.1],
      reportMatches: true, ratingArtifactId: "mock-v1", modelVersion: "mock-v1", forecastAt: now,
    }, traffic, progress);
    expect(unexpected).toEqual([]);
    // The existing mock backtest deliberately has no fixtures. Exercise its
    // failure gate rather than inventing history or weakening certification.
    expect(checks.filter((check) => !check.passed).map((check) => check.id)).toEqual(["frozen-backtest-nonempty"]);
    expect(checks.find((check) => check.id === "frozen-backtest-nonempty").evidence)
      .toContain("0 finished fixtures and 0 calibration forecasts");
    expect(checks).toHaveLength(11);
    expect(asks).toHaveLength(10);
    expect(asks[0].fixtureContext).toEqual({ fixtureId });
    expect(asks.at(-1)).not.toHaveProperty("fixtureContext");
  });
}
