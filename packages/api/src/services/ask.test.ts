import { describe, expect, it } from "vitest";
import { AppError } from "../middleware";
import { ModelFixture } from "./model-data";
import { fixture } from "./__fixtures__/model-fixture";
import {
  espnFixtureIdentity,
  recognizeEspnFixture,
  type RecognizedFixture,
} from "./fixture-registry";
import {
  MATCH_ANSWER_GUARDS,
  MATCH_QUESTION_SCOPE,
  buildCompetitionGrounding,
  buildGrounding,
  findFixture,
  isCompetitionQuestion,
  resolveAskContext,
  resolveCompetitionContext,
  resolveQuestionTeams,
  resolveTeams,
  shouldUseCompetitionGrounding,
  shouldUseMatchGrounding,
  deterministicSearchQuery,
  evidenceAuthority,
  failClosedEmptyCurrentVerification,
  dropMisbucketedTotalsScorelines,
  renderEvidenceCitations,
  sanitizeFixtureCoverageAnswer,
  sanitizeFootballGeometry,
  sanitizeGroundedMatchNarrative,
  sanitizeContradictoryRationales,
  sanitizeManagerEraClaims,
  sanitizeMatchAnswer,
  sanitizeRuntimeResponseCorrectness,
  sanitizeUnrecognizedCandidateAnswer,
  seasonOrCompetitionGrounding,
  prepareAsk,
  verifiableCurrentClaims,
  verifyCurrentClaims,
  type FixtureGrounding,
  shouldHoldCoverageDeltas,
  stripUnvalidatedExternalMarketClaims,
  dropOrphanedSectionLabels,
  MATCH_ANALYSIS_PRIORITIES,
  MATCH_CAPABILITY_BOUNDS,
  sanitizeDeliveredAnswer,
  computeMarketDivergence,
  composeMarketDivergenceSentence,
  statesMarketDivergence,
  type Grounding,
  type MarketDivergence,
} from "./ask";
import {
  premierLeagueSeasonWindow,
  replaceFootballDataForTests,
  replaceSeasonScheduleForTests,
  type FootballMatch,
} from "./football-data";
import { refreshClubRatings } from "./club-ratings";

/**
 * Fills in the precomputed model-versus-market field from the payload's own
 * odds, so a hand-built grounding cannot silently carry a divergence that
 * disagrees with its own `oddsSources`.
 */
function withDivergence(
  grounding: Omit<Grounding, "marketDivergence"> & { marketDivergence?: MarketDivergence[] }
): Grounding {
  return {
    ...grounding,
    marketDivergence: grounding.marketDivergence
      ?? computeMarketDivergence(grounding, grounding.oddsSources),
  };
}

describe("season grounding degradation", () => {
  it("uses explicit competition grounding instead of failing when outlook inputs are unavailable", () => {
    const competition = buildCompetitionGrounding("eng.1", [], new Date("2026-08-13T00:00:00Z"));
    expect(seasonOrCompetitionGrounding(null, competition)).toEqual(competition);
    expect(seasonOrCompetitionGrounding(null, competition).kind).toBe("competition");
  });

  it("prepares the same explicit competition fallback for JSON and SSE transports", () => {
    const originalKey = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "test-only";
    const table = [standing()];
    replaceFootballDataForTests({
      standings: table,
      upcoming: [],
      recent: [],
      lastUpdated: new Date("2026-08-13T00:00:00Z"),
      error: null,
    });
    replaceSeasonScheduleForTests({
      competitionId: "eng.1",
      seasonId: "unknown",
      fixtures: [],
      lastUpdated: null,
      error: "unavailable",
      servingLastGood: false,
    });
    try {
      const jsonPrepared = prepareAsk("Who wins the Premier League?", []);
      const ssePrepared = prepareAsk("Who wins the Premier League?", []);
      expect(jsonPrepared.grounding).toMatchObject({ kind: "competition", competitionId: "eng.1" });
      expect(ssePrepared.grounding).toEqual(jsonPrepared.grounding);
      expect(jsonPrepared.tier).toBe("competition");
      expect(ssePrepared.tier).toBe("competition");
    } finally {
      if (originalKey === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = originalKey;
      replaceFootballDataForTests({ standings: [], upcoming: [], recent: [], lastUpdated: null, error: null });
      replaceSeasonScheduleForTests({
        competitionId: "eng.1", seasonId: "unknown", fixtures: [], lastUpdated: null,
        error: null, servingLastGood: false,
      });
    }
  });

  it("never emits season probabilities from a complete stale or erroring last-good schedule", async () => {
    const originalKey = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "test-only";
    const now = new Date();
    const standings = PREMIER_LEAGUE_TEST_TEAMS.map((team, index) => ({
      ...standing("eng.1", team),
      position: index + 1,
    }));
    const schedule = completePremierLeagueSchedule();
    replaceFootballDataForTests({ standings, upcoming: [], recent: [], lastUpdated: now, error: null });
    await refreshClubRatings(now);
    try {
      for (const unavailable of [
        { seasonId: premierLeagueSeasonWindow(now).seasonId, lastUpdated: now, error: "upstream timeout", servingLastGood: true },
        { seasonId: premierLeagueSeasonWindow(now).seasonId, lastUpdated: new Date(now.getTime() - 7 * 60 * 60 * 1000), error: null, servingLastGood: true },
        { seasonId: "2025-26", lastUpdated: now, error: null, servingLastGood: true },
      ]) {
        replaceSeasonScheduleForTests({
          competitionId: "eng.1",
          fixtures: schedule,
          ...unavailable,
        });
        const prepared = prepareAsk("Who wins the Premier League?", []);
        expect(prepared.tier).toBe("competition");
        expect(prepared.grounding).toMatchObject({ kind: "competition", competitionId: "eng.1" });
        expect(prepared.grounding).not.toHaveProperty("seasonOutlook");
      }

      replaceSeasonScheduleForTests({
        competitionId: "eng.1",
        seasonId: premierLeagueSeasonWindow(now).seasonId,
        fixtures: schedule,
        lastUpdated: now,
        error: null,
        servingLastGood: false,
      });
      const fresh = prepareAsk("Who wins the Premier League?", []);
      expect(fresh.tier).toBe("season");
      expect(fresh.grounding).toMatchObject({ kind: "season", competitionId: "eng.1" });
      expect(fresh.grounding).toHaveProperty("seasonOutlook.titleProbabilities");
    } finally {
      if (originalKey === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = originalKey;
      replaceFootballDataForTests({ standings: [], upcoming: [], recent: [], lastUpdated: null, error: null });
      replaceSeasonScheduleForTests({
        competitionId: "eng.1", seasonId: "unknown", fixtures: [], lastUpdated: null,
        error: null, servingLastGood: false,
      });
    }
  }, 20_000);
});

describe("expired rating artifact routing", () => {
  it("does not treat a retained cached model row as priced", () => {
    const fixture = {
      competitionId: "eng.1",
      competition: "Premier League",
      fixtureId: 1,
      utcDate: "2026-08-15T14:00:00.000Z",
      date: "2026-08-15",
      group: null,
      stage: "match",
      home: "Arsenal",
      away: "Liverpool",
      homeElo: 1850,
      awayElo: 1840,
      pHome: 0.42,
      pDraw: 0.28,
      pAway: 0.3,
      pOver2_5: 0.55,
      pUnder2_5: 0.45,
      pBttsYes: 0.58,
      pBttsNo: 0.42,
      topScores: [],
      scorelines: [],
      stakePHome: null,
      stakePDraw: null,
      stakePAway: null,
      result: null,
    } satisfies ModelFixture;
    const recognized = recognizeEspnFixture({
      id: 1,
      competitionId: "eng.1",
      competition: "Premier League",
      homeTeam: "Arsenal",
      awayTeam: "Liverpool",
      utcDate: fixture.utcDate,
      status: "SCHEDULED",
      stage: null,
      matchday: null,
      group: null,
      score: null,
      neutralVenue: false,
    });
    expect(resolveAskContext(
      "Arsenal vs Liverpool 1X2",
      [],
      undefined,
      [fixture],
      [],
      [],
      {
        recognizedFixtures: [recognized],
        modelInitialized: true,
        ratingsAvailable: false,
      }
    )).toMatchObject({
      tier: "fixture",
      capability: { status: "insufficient-model-input", reason: "ratings-unavailable" },
    });
  });
});

describe("current-news evidence hardening", () => {
  it("deterministically pre-searches clearly current questions", () => {
    for (const question of [
      "Latest Arsenal injuries?",
      "Is Saka available today?",
      "Recent form and current manager?",
      "Any transfer or lineup news?",
      "What are the current odds?",
      "You're wrong about the manager — check again",
    ]) {
      expect(deterministicSearchQuery(question)).toContain("football latest");
    }
    expect(deterministicSearchQuery("Explain the offside rule")).toBeNull();
    expect(deterministicSearchQuery("Actually that manager is wrong", "Arsenal Pat Doe"))
      .toContain("Arsenal Pat Doe");
  });

  it("does not promote unknown search domains to reputable evidence", () => {
    expect(evidenceAuthority("https://www.uefa.com/story")).toBe("official");
    expect(evidenceAuthority("https://www.arsenal.com/news/team-update")).toBe("official");
    expect(evidenceAuthority("https://www.reuters.com/story")).toBe("reputable");
    expect(evidenceAuthority("https://football-rumours.example/story")).toBe("other");
  });

  it("fails closed on generated bookmaker numbers that lack a complete server-owned market", () => {
    const answer = [
      "The official fixture is scheduled for Saturday.",
      "Stake market: home 2.10, draw 3.40, away 3.60 (48.0%, 29.7%, 22.3%).",
    ].join("\n\n");
    const sanitized = stripUnvalidatedExternalMarketClaims(answer);
    expect(sanitized).toContain("official fixture is scheduled");
    expect(sanitized).toContain("complete same-source, same-time bookmaker 1X2 market");
    expect(sanitized).not.toContain("2.10");
    expect(sanitized).not.toContain("48.0%");
    expect(sanitizeMatchAnswer("Kalshi market-implied home 48.0%, draw 28.0%, away 24.0%."))
      .toContain("omitted those numbers");
  });

  it("renders only a complete same-source, same-time market with third-party attribution", () => {
    const legs = [
      { outcome: "home" as const, decimalOdds: 2, source: "Stake", observedAt: "2026-08-13T12:00:00Z" },
      { outcome: "draw" as const, decimalOdds: 4, source: "Stake", observedAt: "2026-08-13T12:00:00Z" },
      { outcome: "away" as const, decimalOdds: 4, source: "Stake", observedAt: "2026-08-13T12:00:00Z" },
    ];
    const sanitized = stripUnvalidatedExternalMarketClaims(
      "Stake market: home 99%, draw 0.5%, away 0.5%.",
      [legs]
    );
    expect(sanitized).toContain("Stake market-implied probabilities (third-party data, not a Pundit forecast)");
    expect(sanitized).toContain("home 50.0%, draw 25.0%, away 25.0%");
    expect(sanitized).not.toContain("99%");

    expect(stripUnvalidatedExternalMarketClaims(
      "Stake market: home 50%, draw 25%, away 25%.",
      [legs.slice(0, 2)]
    )).toContain("omitted those numbers");
    expect(stripUnvalidatedExternalMarketClaims([
      "Stake market:",
      "home: 2.00",
      "draw: 4.00",
      "away: 4.00",
      "Safe unrelated sentence.",
    ].join("\n"))).toBe(
      "Safe unrelated sentence.\n\nI could not establish a complete same-source, same-time bookmaker 1X2 market from server-owned evidence, so I have omitted those numbers."
    );
  });

  it("keeps the model's own numbers and the prompt-mandated no-market sentence", () => {
    // MATCH_SYSTEM_PROMPT tells the model to say plainly when no market source
    // is present. That sentence used to trigger the market guard, which then
    // deleted up to four following numeric lines -- the whole answer body.
    const reported = [
      "**Verdict**",
      "No Kalshi market is available.",
      "Man United win **77.6%**, draw **14.2%**, Hull **8.2%**.",
      "Over 2.5 sits at **77.6%**.",
      "BTTS No at **61.0%**.",
    ].join("\n");
    expect(stripUnvalidatedExternalMarketClaims(reported)).toBe(reported);
    expect(sanitizeMatchAnswer(reported)).toContain("77.6%");
    expect(sanitizeMatchAnswer(reported)).not.toContain("omitted those numbers");

    for (const survivor of [
      "No Kalshi or Polymarket line is available for this fixture.\nThe model has the home side at **48.0%**.",
      "Neither bookmaker line is available, so the model's **55.0%** stands alone.",
      // "stake" is also an ordinary English noun.
      "Three points are at stake for both sides.\nLiverpool win **55.5%**, draw **24.0%**, Everton **20.5%**.",
      // A model line under a market heading is not a market quote.
      "**Market**\nNo market source is present.\n\n**Verdict**\nMan City win **70.1%**, draw **18.2%**, Burnley **11.7%**.",
    ]) expect(stripUnvalidatedExternalMarketClaims(survivor)).toBe(survivor);
  });

  it("still removes an asserted external market price, including bare decimal quotes", () => {
    for (const priced of [
      "Kalshi has Arsenal at 62%, so the model is a touch higher.",
      "The bookmakers price the draw at 3.40 and the away win at 3.60.",
      "Polymarket prices the home win at 58.0%.",
      "Kalshi market-implied home 48.0%, draw 28.0%, away 24.0%.",
      "Stake market: home 2.10, draw 3.40, away 3.60.",
    ]) {
      const sanitized = stripUnvalidatedExternalMarketClaims(priced);
      expect(sanitized).toContain("omitted those numbers");
      expect(sanitized).not.toMatch(/\d+(?:\.\d+)?%|\b\d+\.\d\d\b/);
    }
    // Only the priced clause goes; neighbouring model prose survives intact.
    const mixed = stripUnvalidatedExternalMarketClaims([
      "Polymarket prices the home win at 58.0%.",
      "The model has the home win at **77.6%**.",
      "Over 2.5 sits at **54.0%**.",
    ].join("\n"));
    expect(mixed).not.toContain("58.0%");
    expect(mixed).toContain("**77.6%**");
    expect(mixed).toContain("**54.0%**");
  });

  it("drops a section label the guards emptied and keeps one whose body follows a blank line", () => {
    expect(dropOrphanedSectionLabels(
      "**Verdict**\n\nI could not establish a complete same-source, same-time bookmaker 1X2 market."
    )).toBe("**Verdict**\n\nI could not establish a complete same-source, same-time bookmaker 1X2 market.");
    expect(dropOrphanedSectionLabels("**Verdict**")).toBe("");
    expect(dropOrphanedSectionLabels(
      "**Verdict**\n\n**Read on the underdog**\nAshcombe need a low-scoring game."
    )).toBe("**Read on the underdog**\nAshcombe need a low-scoring game.");
    const intact = "**Verdict**\nArsenal win **61.0%**.\n\n**Likely scorelines**\n**2-1 (11.4%)** leads.";
    expect(dropOrphanedSectionLabels(intact)).toBe(intact);

    // End to end: the guard removes a real market quote and its heading goes too.
    expect(dropOrphanedSectionLabels(sanitizeMatchAnswer([
      "**Verdict**",
      "Stake market: home 2.10, draw 3.40, away 3.60.",
      "",
      "**Read on the underdog**",
      "Ashcombe need the game to stay low-scoring.",
    ].join("\n")))).toBe([
      "**Read on the underdog**",
      "Ashcombe need the game to stay low-scoring.",
      "",
      "I could not establish a complete same-source, same-time bookmaker 1X2 market from server-owned evidence, so I have omitted those numbers.",
    ].join("\n"));
  });

  it("fails manager-era assertions closed unless the dated tenure record supports them", () => {
    const claim = "The win came during Mikel Arteta's tenure.";
    expect(sanitizeManagerEraClaims(claim)).toContain("could not be tied to a structured tenure record");
    expect(sanitizeManagerEraClaims(claim)).not.toContain("The win came");

    const context = {
      eventAt: "2024-02-01T00:00:00Z",
      tenures: [
        { manager: "Mikel Arteta", startedAt: "2019-12-22T00:00:00Z" },
      ],
    };
    expect(sanitizeManagerEraClaims(claim, context)).toBe(claim);
    expect(sanitizeManagerEraClaims("The win came under manager Unai Emery.", context))
      .toContain("attributes that date to Mikel Arteta");
    for (const normalProse of [
      "Arsenal struggled under sustained pressure.",
      "The match occurred during Premier League fixtures.",
      "They played under Arsenal floodlights.",
    ]) expect(sanitizeManagerEraClaims(normalProse)).toBe(normalProse);
  });

  it("removes both sides of a recognizable contradictory rationale", () => {
    const answer = [
      "The home side's midfield gives it an edge.",
      "The away side's midfield gives it an advantage.",
      "The fixture remains close.",
    ].join("\n");
    const sanitized = sanitizeContradictoryRationales(answer);
    expect(sanitized).not.toContain("home side's midfield");
    expect(sanitized).not.toContain("away side's midfield");
    expect(sanitized).toContain("Conflicting midfield rationales were omitted");
    expect(sanitized).toContain("fixture remains close");
    expect(sanitizeRuntimeResponseCorrectness(answer)).toBe(sanitized);
    const sameParagraph = "The home side's midfield gives it an edge. The away side's midfield gives it an advantage. The fixture remains close.";
    expect(sanitizeContradictoryRationales(sameParagraph)).not.toMatch(/home side|away side/);
    expect(sanitizeContradictoryRationales(sameParagraph)).toContain("fixture remains close");
  });

  it("extracts only server-marked external claims for the verifier", () => {
    expect(verifiableCurrentClaims(
      "Pundit's model has Arsenal at 45%. The manager is Pat Doe [[S1]]. Unverified aside."
    )).toEqual([{ id: "C1", text: "The manager is Pat Doe [[S1]]." }]);
  });

  it("binds accepted claims to the verifier-selected server evidence ID", async () => {
    const bundle = {
      queries: ["current manager"],
      providerCalls: 0,
      results: [
        { id: "S1", title: "Official", url: "https://uefa.com/one", date: "2026-08-13", snippet: "Pat Doe is manager." },
        { id: "S2", title: "Other", url: "https://news.example/two", date: "2026-08-13", snippet: "Unrelated." },
      ],
    };
    const checked = await verifyCurrentClaims(
      "Pat Doe is the current manager [[S2]].",
      bundle,
      {} as Parameters<typeof verifyCurrentClaims>[2],
      undefined,
      false,
      {
        retrieve: async (candidates) => candidates.slice(0, 1).map((candidate) => ({
          ...candidate,
          finalUrl: candidate.url,
          text: "Pat Doe is manager.",
          retrievedAt: "2026-08-13T00:00:00.000Z",
        })),
        verify: async () => ({
          status: "verified",
          decisions: [{ claimId: "C1", outcome: "supported", evidenceIds: ["S1"] }],
          summary: "supported",
        }),
      }
    );
    expect(checked.answer).toContain("[[S1]]");
    expect(checked.answer).not.toContain("[[S2]]");
    expect(checked.verification).toEqual({
      status: "verified",
      supportedClaimCount: 1,
      removedClaimCount: 0,
    });
    expect(bundle.providerCalls).toBe(1);
  });

  it("preserves server-authored outside-coverage safety text while filtering factual claims", async () => {
    const bundle = {
      queries: ["fixture date"],
      providerCalls: 0,
      results: [{
        id: "S1",
        title: "Official",
        url: "https://uefa.com/fixture",
        date: "2026-08-13",
        snippet: "The fixture is Thursday.",
      }],
    };
    const checked = await verifyCurrentClaims(
      "This recognized fixture is outside Pundit's model coverage, so no Pundit probabilities or scoreline estimates are available.\n\n"
        + "The fixture is Thursday [[S1]]. An unsupported lineup is confirmed [[S1]].",
      bundle,
      {} as Parameters<typeof verifyCurrentClaims>[2],
      undefined,
      false,
      {
        retrieve: async (candidates) => candidates.map((candidate) => ({
          ...candidate,
          finalUrl: candidate.url,
          text: "The fixture is Thursday.",
          retrievedAt: "2026-08-13T00:00:00.000Z",
        })),
        verify: async () => ({
          status: "verified",
          decisions: [
            { claimId: "C1", outcome: "supported", evidenceIds: ["S1"] },
            { claimId: "C2", outcome: "unsupported", evidenceIds: [] },
          ],
          summary: "checked",
        }),
      }
    );
    expect(checked.answer).toMatch(/outside Pundit's model coverage/i);
    expect(checked.answer).toContain("The fixture is Thursday [[S1]].");
    expect(checked.answer).not.toContain("unsupported lineup");
  });

  it("does not let uncited generated bookmaker percentages use the structured-market exception", async () => {
    const generated = "Stake market: Arsenal 52%, draw 25%, away 23%. No verified injury update was established.";
    const checked = await verifyCurrentClaims(
      generated,
      { queries: ["current odds"], providerCalls: 2, results: [] },
      {} as Parameters<typeof verifyCurrentClaims>[2],
      undefined,
      true
    );
    expect(checked.verification.status).toBe("abstain");
    // Deliberate change of ownership, not of outcome. `verifyCurrentClaims`
    // used to enforce this by replacing the entire answer with an abstention,
    // which is also how it deleted every model-derived verdict that happened
    // to carry no citation marker. Market prose belongs to the market guard,
    // which runs immediately downstream with the grounding in hand and is the
    // only thing able to tell a quotable server-owned market from an invented
    // one. The guarantee asserted here is the pipeline's, and it is unchanged:
    // an unattributable bookmaker price never reaches the user.
    const delivered = sanitizeRuntimeResponseCorrectness(
      failClosedEmptyCurrentVerification(checked.answer, checked.verification, true)
    );
    expect(delivered).not.toMatch(/52%|25%|23%/);
    expect(delivered).toContain("omitted those numbers");
  });

  it("removes artifact-shaped positive team news when verification supported nothing", () => {
    const candidateNotice = "I could not establish an authoritative structured fixture identity for that matchup; no verified fixture identity was established, so it remains a discovery candidate and has no Pundit fixture badge or probabilities.";
    const unsafe = `${candidateNotice}\n\nLyon: Jason Denayer is out with a knock. Paulo Fonseca expects key Fenerbahce attackers to be unavailable.`;
    const safe = failClosedEmptyCurrentVerification(unsafe, {
      status: "abstain",
      supportedClaimCount: 0,
      removedClaimCount: 0,
    }, true);
    expect(safe).toContain(candidateNotice);
    // Deliberate wording change: the abstention now names what was missing --
    // a dated team-news update -- instead of declaring the whole question
    // unanswerable. The removal it stands for is unchanged, and is asserted on
    // the next line exactly as before.
    expect(safe).toContain("No verified, dated team-news update was established");
    expect(safe).not.toMatch(/Jason Denayer|is out|attackers to be unavailable/);
    expect(failClosedEmptyCurrentVerification(unsafe, {
      status: "not-required",
      supportedClaimCount: 0,
      removedClaimCount: 0,
    }, false)).toBe(unsafe);
  });

  it("drops deterministic model and market interpretations that contradict grounding", () => {
    const grounding = {
      kind: "match",
      home: "Fenerbahce",
      away: "Lyon",
      pHome: 0.2997,
      pDraw: 0.279,
      pAway: 0.4213,
      oddsSources: [
        { source: "kalshi", observedAt: "2026-08-13T05:12:27Z", pHome: 0.4653, pDraw: 0.2475, pAway: 0.2872 },
        { source: "polymarket", observedAt: "2026-08-13T05:12:27Z", pHome: 0.4581, pDraw: 0.2562, pAway: 0.2857 },
      ],
    } as unknown as Grounding;
    const sanitized = sanitizeGroundedMatchNarrative([
      "Lyon are the model underdogs here.",
      "**Read on the underdog**\nFor Lyon to overturn the model, they must counter well.",
      "The draw contributes to Fenerbahce's win probability.",
      "The market favours Lyon.",
      "Kalshi gives Lyon the edge.",
      "Pundit's model favours Lyon.",
      "Kalshi favours Fenerbahce.",
    ].join("\n"), grounding);
    expect(sanitized).not.toMatch(/model underdogs|Lyon to overturn|draw contributes|market favours Lyon|Kalshi gives Lyon/);
    expect(sanitized).toContain("Pundit's model favours Lyon.");
    expect(sanitized).toContain("Kalshi favours Fenerbahce.");
    // Deliberate change: this used to assert that the "**Read on the
    // underdog**" label was blanked here. It was blanked by a rule that
    // deleted any line mentioning "underdog" whose next non-blank line named
    // the model's favourite -- which is what a read-on-the-underdog section is
    // for, and which also blanked the label in answers whose body survived.
    // The label is now dropped only once its body has genuinely gone, by the
    // settled-answer sweep the delivery chain already runs.
    expect(sanitized).toContain("**Read on the underdog**");
    expect(dropOrphanedSectionLabels(sanitizeGroundedMatchNarrative(
      "**Read on the underdog**\nFor Lyon to overturn the model, they must counter well.",
      grounding
    ))).not.toContain("Read on the underdog");
  });

  it("corrects backwards high-line geometry without deleting correct tactical prose", () => {
    const withMidfield = sanitizeFootballGeometry(
      "A higher defensive line shrinks the space behind the defenders. It can compress midfield space."
    );
    expect(withMidfield).toContain("leaves more space behind it");
    expect(withMidfield).toContain("It can compress midfield space.");
    expect(sanitizeFootballGeometry(
      "A higher line shrinks space behind defenders. Keep the rest."
    )).toContain("Keep the rest.");
    expect(sanitizeFootballGeometry(
      "A higher defensive line can leave more space behind the defenders."
    )).toBe("A higher defensive line can leave more space behind the defenders.");
    expect(sanitizeFootballGeometry(
      "A high line shrinks the space between defence and goalkeeper, so runners have less room."
    )).toBe(
      "A high defensive line compresses space in front of the defence but leaves more space behind it for the goalkeeper to cover."
    );
    expect(sanitizeFootballGeometry(
      "A high line reduces space between the back line and the keeper while compressing midfield space."
    )).toBe(
      "A high defensive line compresses space in front of the defence but leaves more space behind it for the goalkeeper to cover. It can also compress midfield space."
    );
    expect(sanitizeFootballGeometry(
      "A high line compresses midfield space and leaves room behind the defence."
    )).toBe("A high line compresses midfield space and leaves room behind the defence.");
    for (const backwards of [
      "A high line compresses space behind the defence.",
      "A high defensive line closes the space between the back line and the keeper.",
      "A higher line limits space between the defense and goalkeeper.",
      "A high line minimizes space behind defenders.",
      "A high line reduced the gap between defence and goalkeeper.",
      "A higher defensive line is reducing the gap behind the back line.",
    ]) expect(sanitizeFootballGeometry(backwards)).toContain("leaves more space behind it");
    for (const correct of [
      "A high line compresses space in front of the defence.",
      "A high line compresses the space between defence and midfield.",
      "A high line limits midfield space while leaving space behind.",
      "A high defensive line compresses midfield space but leaves more space behind the defence.",
    ]) expect(sanitizeFootballGeometry(correct)).toBe(correct);
    const repeated = sanitizeFootballGeometry(
      "A high line shrinks space behind defenders. A higher line reduces space between defence and goalkeeper."
    );
    expect(repeated.match(/A high defensive line/g)).toHaveLength(1);
  });

  it("reconciles plain scoreline arithmetic even without a probability suffix", () => {
    expect(dropMisbucketedTotalsScorelines("A 1-1 result lands over 2.5 goals."))
      .toBe("A 1-1 scoreline has 2 total goals, so it is under 2.5.");
    expect(dropMisbucketedTotalsScorelines("Under 2.5 examples include 2-1 and 1-1."))
      .not.toContain("2-1");
  });

  it("deterministically strips public probabilities and scorelines from non-priced fixtures", () => {
    const fixture = recognizeEspnFixture({
      id: 900,
      competitionId: "club.friendly",
      competition: "Club Friendly",
      homeTeam: "Arsenal",
      awayTeam: "AC Milan",
      utcDate: "2026-08-20T12:00:00.000Z",
      status: "SCHEDULED",
      stage: null,
      matchday: null,
      group: null,
      score: null,
    });
    fixture.competition.category = "club-friendly";
    const grounding: FixtureGrounding = {
      kind: "fixture",
      fixture,
      capability: { status: "outside-coverage", reason: "friendly-policy-disabled" },
    };
    const safe = sanitizeFixtureCoverageAnswer(
      "Arsenal 48%, draw 25%, Milan 27%. Likely score 2-1. The fixture is on Thursday [[S1]].",
      grounding
    );
    expect(safe).toMatch(/outside Pundit's model coverage/i);
    expect(safe).not.toMatch(/48%|2-1/);
  });

  it("keeps an unrecognized matchup candidate ungrounded and strips invented output", () => {
    expect(resolveAskContext(
      "Northbridge Athletic vs Southbank Rovers tomorrow",
      [],
      undefined,
      [],
      []
    )).toEqual({ tier: "candidate" });
    const safe = sanitizeUnrecognizedCandidateAnswer(
      "Pundit's probabilities are 50%, 25%, 25%. Likely score 2-1."
    );
    expect(safe).toMatch(/could not establish an authoritative structured fixture identity/i);
    expect(safe).not.toMatch(/50%|2-1/);
  });

  it("holds all candidate and non-priced fixture SSE deltas until sanitization", () => {
    const fixture = recognizeEspnFixture({
      id: 900,
      competitionId: "club.friendly",
      competition: "Club Friendly",
      homeTeam: "Arsenal",
      awayTeam: "Liverpool",
      utcDate: "2026-08-18T19:00:00.000Z",
      status: "SCHEDULED",
      stage: null,
      matchday: null,
      group: null,
      score: null,
    });
    fixture.competition.category = "club-friendly";
    expect(shouldHoldCoverageDeltas({
      kind: "fixture",
      fixture,
      capability: { status: "outside-coverage", reason: "friendly-policy-disabled" },
    }, false)).toBe(true);
    expect(shouldHoldCoverageDeltas(null, true)).toBe(true);
    expect(shouldHoldCoverageDeltas(null, false)).toBe(false);
  });

  it("renders exact server evidence and removes invented or unsupported claims", () => {
    const bundle = {
      queries: ["arsenal injury"],
      results: [{
        id: "S1",
        title: "Club update",
        url: "https://example.com/team-news",
        date: "2026-08-12",
        snippet: "A player returned to training.",
      }],
    };
    const rendered = renderEvidenceCitations(
      "The player is available. [[S1]]\nAnother player is injured. [[S99]]",
      bundle,
      true
    );
    expect(rendered.answer).toContain("[Club update](https://example.com/team-news)");
    expect(rendered.answer).not.toContain("Another player");
    expect(rendered.citations).toEqual([expect.objectContaining({ id: "S1" })]);
  });

  it("abstains when a positive current claim has no provenance marker", () => {
    const rendered = renderEvidenceCitations(
      "The player is ruled out for Sunday.",
      { queries: ["query"], results: [] },
      true
    );
    expect(rendered.answer).toMatch(/No verified, dated team-news update was established/i);
  });

  it("requires a dated marker in each sentence, not merely elsewhere on the line", () => {
    const bundle = {
      queries: ["query"],
      results: [{
        id: "S1",
        title: "Club update",
        url: "https://example.com/update",
        date: "2026-08-12",
        snippet: "One player is available.",
      }],
    };
    const rendered = renderEvidenceCitations(
      "One player is available [[S1]]. Another player is ruled out.",
      bundle,
      true
    );
    expect(rendered.answer).toContain("One player");
    expect(rendered.answer).not.toContain("Another player");
  });

  it("does not render undated evidence for positive current-news claims", () => {
    const rendered = renderEvidenceCitations(
      "The player is available [[S1]].",
      { queries: ["query"], results: [{
        id: "S1",
        title: "Undated result",
        url: "https://example.com/undated",
        date: "",
        snippet: "Available",
      }] },
      true
    );
    expect(rendered.answer).toMatch(/No verified, dated team-news update was established/i);
    expect(rendered.citations).toEqual([]);
  });
});

describe("MATCH_ANSWER_GUARDS", () => {
  it("blocks unsupported aggregate, scoreline-tail, and causal claims", () => {
    expect(MATCH_ANSWER_GUARDS).toContain("aggregate advancement is outside this model payload");
    expect(MATCH_ANSWER_GUARDS).toContain("omitted from your prose");
    expect(MATCH_ANSWER_GUARDS).toContain("never say it entirely causes the edge");
  });
});

describe("MATCH_QUESTION_SCOPE", () => {
  it("tells the model to answer the question actually asked", () => {
    expect(MATCH_QUESTION_SCOPE).toContain("Answer the question the user actually\nasked.");
    expect(MATCH_QUESTION_SCOPE).toContain("leave the fixture data out instead of steering back to the matchup");
  });

  it("keeps oblique follow-ups answered from the grounding", () => {
    expect(MATCH_QUESTION_SCOPE).toContain("however short or indirect");
    expect(MATCH_QUESTION_SCOPE).toContain("answer them in full from the grounding");
    expect(MATCH_QUESTION_SCOPE)
      .toContain("never tell the user you have no model data for this matchup");
    expect(MATCH_QUESTION_SCOPE).toContain("treat\nit as a question about the fixture");
  });
});

const fixtures = [
  fixture("Arsenal", "Coventry City"),
  fixture("Liverpool", "Manchester United"),
  fixture("Brighton & Hove Albion", "Tottenham Hotspur"),
];

function standing(competitionId = "eng.1", team = "Arsenal") {
  return {
    competitionId,
    position: 1,
    team,
    playedGames: 0,
    won: 0,
    draw: 0,
    lost: 0,
    points: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    group: null,
    advanced: false,
  };
}

const PREMIER_LEAGUE_TEST_TEAMS = [
  "Arsenal", "Manchester City", "Aston Villa", "Manchester United", "Liverpool",
  "Bournemouth", "Brighton & Hove Albion", "Newcastle United", "Brentford", "Chelsea",
  "Nottingham Forest", "Fulham", "Crystal Palace", "Everton", "Leeds United",
  "Tottenham Hotspur", "West Ham United", "Sunderland", "Wolverhampton Wanderers", "Burnley",
];

function completePremierLeagueSchedule(): FootballMatch[] {
  let id = 50_000;
  return PREMIER_LEAGUE_TEST_TEAMS.flatMap((homeTeam) =>
    PREMIER_LEAGUE_TEST_TEAMS
      .filter((awayTeam) => awayTeam !== homeTeam)
      .map((awayTeam) => ({
        id: id++,
        competitionId: "eng.1",
        competition: "Premier League",
        homeTeam,
        awayTeam,
        utcDate: "2027-05-01T14:00:00.000Z",
        status: "SCHEDULED",
        stage: null,
        matchday: null,
        group: null,
        score: null,
      }))
  );
}

describe("resolveTeams", () => {
  it("extracts aliases as canonical fixture names", () => {
    expect(resolveTeams("How does Manchester United vs Liverpool look?", fixtures))
      .toEqual(["Manchester United", "Liverpool"]);
    expect(resolveTeams("Brighton against Tottenham", fixtures))
      .toEqual(["Brighton & Hove Albion", "Tottenham Hotspur"]);
  });

  it("rejects questions naming more than one matchup", () => {
    expect(() => resolveTeams("Arsenal vs Liverpool, then Brighton", fixtures))
      .toThrowError(AppError);
  });

  // Grounding models exactly one match, so several matchups cannot be answered
  // in one turn -- but the limit is only useful if the error says which match
  // to ask about. The code is what carries the message past the frontend's
  // generic 400 copy.
  it("names the real fixtures when the question holds more than one matchup", () => {
    const multiFixtures = [
      fixture("Arsenal", "Liverpool"),
      fixture("Coventry City", "Tottenham Hotspur", { fixtureId: 2 }),
    ];
    try {
      resolveTeams("Compare Arsenal vs Liverpool and Coventry City vs Tottenham", multiFixtures);
      throw new Error("expected resolveTeams to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appError = err as AppError;
      expect(appError.statusCode).toBe(400);
      expect(appError.code).toBe("MULTIPLE_FIXTURES");
      expect(appError.message).toContain("Arsenal vs Liverpool");
      expect(appError.message).toContain("Coventry City vs Tottenham Hotspur");
    }
  });

  it("falls back to the generic message when the teams form no fixture", () => {
    try {
      resolveTeams("Arsenal, Liverpool and Brighton", fixtures);
      throw new Error("expected resolveTeams to throw");
    } catch (err) {
      const appError = err as AppError;
      expect(appError.code).toBe("MULTIPLE_TEAMS");
      expect(appError.message).toContain("exactly one matchup");
    }
  });
});

describe("resolveQuestionTeams", () => {
  it("resolves a plain matchup", () => {
    expect(resolveQuestionTeams("Arsenal vs Coventry City", fixtures))
      .toEqual(["Arsenal", "Coventry City"]);
  });

  it("returns undefined when no teams are named", () => {
    expect(resolveQuestionTeams("Who wins tonight?", fixtures)).toBeUndefined();
  });

  it("lets a multi-team competition question through ungrounded", () => {
    expect(resolveQuestionTeams(
      "Will Chelsea, Tottenham or Newcastle win the Premier League?",
      fixtures
    )).toBeUndefined();
  });
});

describe("findFixture", () => {
  it("finds a fixture regardless of requested team order", () => {
    expect(findFixture("Coventry City", "Arsenal", fixtures)).toEqual(fixtures[0]);
  });
});

describe("buildGrounding", () => {
  it("includes competition metadata and totals", () => {
    expect(buildGrounding(fixtures[0])).toMatchObject({
      kind: "match",
      competitionId: "eng.1",
      competition: "Premier League",
      homeFieldAdvantage: true,
      pOver2_5: 0.55,
      pUnder2_5: 0.45,
      pBttsYes: 0.52,
      pBttsNo: 0.48,
      topScores: [{ score: "1-1", probability: 0.12 }],
    });
  });
});

describe("buildCompetitionGrounding", () => {
  it("returns standings rows for the requested competition", () => {
    expect(buildCompetitionGrounding("eng.1", [
      {
        competitionId: "eng.1",
        position: 1,
        team: "Arsenal",
        playedGames: 0,
        won: 0,
        draw: 0,
        lost: 0,
        points: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        group: null,
        advanced: false,
      },
      {
        competitionId: "uefa.champions_qual",
        position: 1,
        team: "Riga FC",
        playedGames: 0,
        won: 0,
        draw: 0,
        lost: 0,
        points: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        group: null,
        advanced: false,
      },
    ], new Date("2026-07-27T09:00:00.000Z"))).toEqual({
      kind: "competition",
      competitionId: "eng.1",
      competition: "Premier League",
      updatedAt: "2026-07-27T09:00:00.000Z",
      standings: [{
        position: 1,
        team: "Arsenal",
        playedGames: 0,
        points: 0,
        goalDifference: 0,
      }],
    });
  });
});

describe("isCompetitionQuestion", () => {
  it.each([
    "Who wins the Premier League?",
    "Who is leading the title race?",
    "What does the top of the table look like?",
  ])("recognizes %s", (question) => {
    expect(isCompetitionQuestion(question)).toBe(true);
  });

  it("does not classify an ordinary matchup question", () => {
    expect(isCompetitionQuestion("Arsenal vs Coventry City")).toBe(false);
  });
});

describe("shouldUseCompetitionGrounding", () => {
  const competitionHistory = [
    { role: "user" as const, content: "Who wins the Premier League?" },
    { role: "assistant" as const, content: "Arsenal leads the table." },
  ];

  it("keeps referential competition follow-ups grounded", () => {
    expect(shouldUseCompetitionGrounding(
      "What about that table ranking?",
      competitionHistory
    )).toBe(true);
  });

  it("does not carry competition grounding into an unrelated new topic", () => {
    expect(shouldUseCompetitionGrounding(
      "How does a high defensive line change pressing risk?",
      competitionHistory
    )).toBe(false);
  });

  it("preserves the exact competition across multiple referential turns", () => {
    const history = [
      { role: "user" as const, content: "How does UCL qualifying look?" },
      { role: "assistant" as const, content: "The qualifying picture is still developing." },
      { role: "user" as const, content: "What about that ranking?" },
      { role: "assistant" as const, content: "There is no league-style table." },
      { role: "user" as const, content: "And what does that table mean?" },
      { role: "assistant" as const, content: "It would describe the current order." },
    ];

    expect(resolveCompetitionContext("What changed in those standings?", history))
      .toBe("uefa.champions_qual");
  });
});

describe("shouldUseMatchGrounding", () => {
  it("recognizes a match-specific follow-up", () => {
    expect(shouldUseMatchGrounding("What about the draw chance?")).toBe(true);
    expect(shouldUseMatchGrounding("Which side has the stronger model case, and why?"))
      .toBe(true);
    expect(shouldUseMatchGrounding("Which model input matters most to that edge?"))
      .toBe(true);
  });

  it("does not classify an unrelated tactical question", () => {
    expect(shouldUseMatchGrounding("Explain how a high defensive line works.")).toBe(false);
  });
});

describe("resolveAskContext", () => {
  function recognizedFriendly(
    id: number,
    home: string,
    away: string
  ): RecognizedFixture {
    const recognized = recognizeEspnFixture({
      id,
      competitionId: "club.friendly",
      competition: "Club Friendly",
      homeTeam: home,
      awayTeam: away,
      utcDate: "2026-08-18T19:00:00.000Z",
      status: "SCHEDULED",
      stage: null,
      matchday: null,
      group: null,
      score: null,
    });
    return {
      ...recognized,
      competition: { ...recognized.competition, category: "club-friendly" },
      neutralVenue: true,
    };
  }

  it("recognizes an authoritative friendly as outside coverage and retains fixture identity", () => {
    const friendly = recognizedFriendly(800, "Arsenal", "Liverpool");
    const explicit = resolveAskContext(
      "Arsenal vs Liverpool friendly",
      [],
      undefined,
      [],
      [],
      [],
      { recognizedFixtures: [friendly] }
    );
    expect(explicit).toMatchObject({
      tier: "fixture",
      fixture: { fixtureId: friendly.fixtureId },
      capability: { status: "outside-coverage", reason: "friendly-policy-disabled" },
    });
    expect(resolveAskContext(
      "What will the 1X2 be?",
      [],
      ["Chelsea", "Manchester City"],
      [],
      [],
      [],
      {
        recognizedFixtures: [friendly],
        fixtureContext: { fixtureId: friendly.fixtureId },
      }
    )).toMatchObject({ tier: "fixture", fixture: { fixtureId: friendly.fixtureId } });
  });

  it("lets a new recognized matchup replace retained fixture context", () => {
    const oldFixture = recognizedFriendly(800, "Arsenal", "Liverpool");
    const newFixture = recognizedFriendly(801, "Chelsea", "Manchester City");
    expect(resolveAskContext(
      "Chelsea vs Manchester City",
      [],
      undefined,
      [],
      [],
      [],
      {
        recognizedFixtures: [oldFixture, newFixture],
        fixtureContext: { fixtureId: oldFixture.fixtureId },
      }
    )).toMatchObject({ tier: "fixture", fixture: { fixtureId: newFixture.fixtureId } });
  });

  it("routes table questions temporarily without deleting retained fixture context", () => {
    const friendly = recognizedFriendly(800, "Arsenal", "Liverpool");
    expect(resolveAskContext(
      "How does the Premier League table look?",
      [],
      undefined,
      [],
      [standing()],
      [],
      {
        recognizedFixtures: [friendly],
        fixtureContext: { fixtureId: friendly.fixtureId },
      }
    )).toEqual({ tier: "competition", competitionId: "eng.1" });
    expect(resolveAskContext(
      "What about that match?",
      [],
      undefined,
      [],
      [],
      [],
      {
        recognizedFixtures: [friendly],
        fixtureContext: { fixtureId: friendly.fixtureId },
      }
    )).toMatchObject({ tier: "fixture", fixture: { fixtureId: friendly.fixtureId } });
  });

  it("does not let an EPL token override explicit 1X2 intent for the retained fixture", () => {
    const friendly = recognizedFriendly(800, "Arsenal", "Liverpool");
    expect(resolveAskContext(
      "What will the 1X2 be for that EPL match?",
      [],
      undefined,
      [],
      [standing()],
      [],
      {
        recognizedFixtures: [friendly],
        fixtureContext: { fixtureId: friendly.fixtureId },
      }
    )).toMatchObject({ tier: "fixture", fixture: { fixtureId: friendly.fixtureId } });
  });

  it("does not match the epl token inside replacing", () => {
    expect(isCompetitionQuestion("Who is replacing the injured manager?")).toBe(false);
  });

  it("does not route a stale priced row after authoritative cancellation", () => {
    const cancelled = recognizeEspnFixture({
      id: fixtures[0].fixtureId,
      competitionId: fixtures[0].competitionId,
      competition: fixtures[0].competition,
      homeTeam: fixtures[0].home,
      awayTeam: fixtures[0].away,
      utcDate: fixtures[0].utcDate,
      status: "CANCELLED",
      stage: null,
      matchday: null,
      group: null,
      score: null,
    });
    expect(resolveAskContext(
      "Arsenal vs Coventry City",
      [],
      undefined,
      fixtures,
      [],
      [],
      { recognizedFixtures: [cancelled] }
    )).toMatchObject({
      tier: "fixture",
      capability: { status: "outside-coverage", reason: "model-policy-disabled" },
    });
  });

  it("fails closed on two current recognized fixtures for the same teams", () => {
    const first = recognizedFriendly(800, "Arsenal", "Liverpool");
    const second = recognizedFriendly(801, "Arsenal", "Liverpool");
    expect(resolveAskContext(
      "Arsenal vs Liverpool",
      [],
      undefined,
      [],
      [],
      [],
      { recognizedFixtures: [first, second] }
    )).toEqual({ tier: "candidate" });
  });

  it("uses stable fixtureContext to disambiguate repeated priced legs while a different matchup replaces it", () => {
    const firstLeg = fixture("Fenerbahce", "Lyon", {
      competitionId: "uefa.champions_qual",
      competition: "UEFA Champions League Qualifying",
      fixtureId: 9101,
      utcDate: "2026-08-18T19:00:00.000Z",
      date: "2026-08-18",
    });
    const secondLeg = fixture("Lyon", "Fenerbahce", {
      competitionId: "uefa.champions_qual",
      competition: "UEFA Champions League Qualifying",
      fixtureId: 9102,
      utcDate: "2026-08-25T19:00:00.000Z",
      date: "2026-08-25",
    });
    const arsenalFixture = fixture("Arsenal", "Coventry City", { fixtureId: 9103 });
    const recognizeModelFixture = (model: ModelFixture) => recognizeEspnFixture({
      id: model.fixtureId,
      competitionId: model.competitionId,
      competition: model.competition,
      homeTeam: model.home,
      awayTeam: model.away,
      utcDate: model.utcDate,
      status: "SCHEDULED",
      stage: model.stage,
      matchday: null,
      group: model.group,
      score: null,
      neutralVenue: false,
    });
    const recognized = [firstLeg, secondLeg, arsenalFixture].map(recognizeModelFixture);

    expect(resolveAskContext(
      "Fenerbahce vs Lyon — what are the 1X2 probabilities?",
      [],
      undefined,
      [firstLeg, secondLeg, arsenalFixture],
      [],
      [],
      {
        recognizedFixtures: recognized,
        fixtureContext: { fixtureId: recognized[1].fixtureId },
      }
    )).toEqual({ tier: "match", fixture: secondLeg });

    expect(resolveAskContext(
      "Arsenal vs Coventry City — what are the 1X2 probabilities?",
      [],
      undefined,
      [firstLeg, secondLeg, arsenalFixture],
      [],
      [],
      {
        recognizedFixtures: recognized,
        fixtureContext: { fixtureId: recognized[1].fixtureId },
      }
    )).toEqual({ tier: "match", fixture: arsenalFixture });
  });

  // BUG: every two-legged tie was unreachable. Both legs carry the same two
  // clubs, so "X vs Y" matched two recognized fixtures and bailed to the
  // discovery-candidate tier -- "no authoritative structured fixture identity"
  // and no probabilities for a fixture Pundit had priced. Seven of the active
  // club pairs are two-legged and the date-sorted qualifiers lead the list, so
  // all three homepage suggestion chips landed on that dead end.
  describe("two-legged ties", () => {
    const firstLeg = fixture("Dinamo Zagreb", "Viking", {
      competitionId: "uefa.champions_qual",
      competition: "UEFA Champions League Qualifying",
      fixtureId: 9201,
      utcDate: "2026-08-18T19:00:00.000Z",
      date: "2026-08-18",
    });
    const secondLeg = fixture("Viking", "Dinamo Zagreb", {
      competitionId: "uefa.champions_qual",
      competition: "UEFA Champions League Qualifying",
      fixtureId: 9202,
      utcDate: "2026-08-26T19:00:00.000Z",
      date: "2026-08-26",
    });
    const legs = [firstLeg, secondLeg];

    function recognize(model: ModelFixture, status = "SCHEDULED") {
      return recognizeEspnFixture({
        id: model.fixtureId,
        competitionId: model.competitionId,
        competition: model.competition,
        homeTeam: model.home,
        awayTeam: model.away,
        utcDate: model.utcDate,
        status,
        stage: model.stage,
        matchday: null,
        group: model.group,
        score: null,
        neutralVenue: false,
      });
    }

    function resolve(question: string, recognized = legs.map((leg) => recognize(leg))) {
      return resolveAskContext(
        question,
        [],
        undefined,
        legs,
        [],
        [],
        { recognizedFixtures: recognized }
      );
    }

    it("resolves a bare matchup to the next unplayed leg", () => {
      expect(resolve("Dinamo Zagreb vs Viking")).toEqual({ tier: "match", fixture: firstLeg });
      expect(resolve("What are the 1X2 probabilities for Dinamo Zagreb vs Viking?"))
        .toEqual({ tier: "match", fixture: firstLeg });
    });

    it("never falls back to the discovery-candidate dead end for a priced tie", () => {
      for (const question of [
        "Dinamo Zagreb vs Viking",
        "Viking against Dinamo Zagreb",
        "How does the Dinamo Zagreb vs Viking match look?",
        "Will Dinamo Zagreb beat Viking?",
      ]) {
        expect(resolve(question)).not.toEqual({ tier: "candidate" });
      }
    });

    it("honours an explicit leg cue", () => {
      expect(resolve("Dinamo Zagreb vs Viking first leg"))
        .toEqual({ tier: "match", fixture: firstLeg });
      expect(resolve("Dinamo Zagreb vs Viking second leg"))
        .toEqual({ tier: "match", fixture: secondLeg });
      expect(resolve("What about the return leg of Dinamo Zagreb vs Viking?"))
        .toEqual({ tier: "match", fixture: secondLeg });
    });

    it("honours a date cue that identifies exactly one leg", () => {
      for (const question of [
        "Dinamo Zagreb vs Viking on the 26th",
        "Dinamo Zagreb vs Viking on 2026-08-26",
        "Dinamo Zagreb vs Viking on August 26",
        "Dinamo Zagreb vs Viking on Wednesday",
      ]) {
        expect(resolve(question)).toEqual({ tier: "match", fixture: secondLeg });
      }
      // Tuesday is the first leg, and a totals cue must not read as a date.
      expect(resolve("Dinamo Zagreb vs Viking on Tuesday"))
        .toEqual({ tier: "match", fixture: firstLeg });
      expect(resolve("Dinamo Zagreb vs Viking over 2.5 goals"))
        .toEqual({ tier: "match", fixture: firstLeg });
    });

    // recognizedFixtureMatchesByTeams drops completed legs while one is still
    // to be played, so ambiguity only survives once the whole tie is done --
    // and then the question is about the last thing that happened.
    it("uses the most recent leg once the tie is complete", () => {
      const played = legs.map((leg) => recognize(leg, "FINISHED"));
      expect(resolve("Dinamo Zagreb vs Viking", played))
        .toMatchObject({ tier: "match", fixture: secondLeg });
    });

    it("still fails closed when two fixtures for the same clubs are indistinguishable", () => {
      const clash = fixture("Viking", "Dinamo Zagreb", {
        competitionId: "uefa.champions_qual",
        competition: "UEFA Champions League Qualifying",
        fixtureId: 9203,
        utcDate: firstLeg.utcDate,
        date: firstLeg.date,
      });
      expect(resolve("Dinamo Zagreb vs Viking", [firstLeg, clash].map((leg) => recognize(leg))))
        .toEqual({ tier: "candidate" });
    });

    it("leaves single-leg resolution untouched", () => {
      expect(resolveAskContext(
        "Arsenal vs Coventry City",
        [],
        undefined,
        fixtures,
        [],
        [],
        { recognizedFixtures: [recognize(fixtures[0])] }
      )).toEqual({ tier: "match", fixture: fixtures[0] });
    });

    // A suggestion chip sends the fixture identity alongside its text, so the
    // click lands on the leg that was rendered rather than on a leg rule.
    it("resolves a suggestion chip to its own leg through fixtureContext", () => {
      const recognized = legs.map((leg) => recognize(leg));
      for (const [index, leg] of legs.entries()) {
        expect(resolveAskContext(
          `${leg.home} vs ${leg.away} · UCL · Tue`,
          [],
          undefined,
          legs,
          [],
          [],
          {
            recognizedFixtures: recognized,
            fixtureContext: { fixtureId: recognized[index].fixtureId },
          }
        )).toEqual({ tier: "match", fixture: leg });
      }
    });

    // The registry can be cold or a step behind the priced rows; a chip still
    // has to land on the fixture it rendered, so the identity also addresses
    // the model row directly.
    it("resolves a chip identity against the model rows with an empty registry", () => {
      expect(resolveAskContext(
        "Viking vs Dinamo Zagreb · UCL · Wed",
        [],
        undefined,
        legs,
        [],
        [],
        { recognizedFixtures: [], fixtureContext: { fixtureId: espnFixtureIdentity(secondLeg) } }
      )).toEqual({ tier: "match", fixture: secondLeg });
    });

    // The chip sets fixtureContext, so the conversational follow-ups that
    // regressed once before now travel that path instead of teamContext.
    it.each([
      "Why?",
      "Tell me more",
      "Is that a good bet?",
      "How confident are you?",
      "What about BTTS?",
    ])("keeps %s on the leg the chip opened", (question) => {
      const recognized = legs.map((leg) => recognize(leg));
      expect(resolveAskContext(
        question,
        [],
        undefined,
        legs,
        [standing()],
        [],
        {
          recognizedFixtures: recognized,
          fixtureContext: { fixtureId: recognized[1].fixtureId },
        }
      )).toEqual({ tier: "match", fixture: secondLeg });
    });

    it.each([
      "How's the table looking?",
      "Who's top right now?",
    ])("lets %s reach competition grounding from a chip-opened leg", (question) => {
      const recognized = legs.map((leg) => recognize(leg));
      expect(resolveAskContext(
        question,
        [],
        undefined,
        legs,
        [standing()],
        [],
        {
          recognizedFixtures: recognized,
          fixtureContext: { fixtureId: recognized[1].fixtureId },
        }
      )).toEqual({ tier: "competition", competitionId: "eng.1" });
    });

    // Two legs of the SAME pair are one tie and resolve; two DIFFERENT pairs
    // are two matches and must keep asking which one is meant.
    it("still refuses two different fixtures with MULTIPLE_FIXTURES", () => {
      const multi = [
        fixture("Arsenal", "Liverpool", { fixtureId: 9301 }),
        fixture("Coventry City", "Tottenham Hotspur", { fixtureId: 9302 }),
      ];
      try {
        resolveAskContext(
          "Compare Arsenal vs Liverpool and Coventry City vs Tottenham",
          [],
          undefined,
          multi,
          [],
          [],
          { recognizedFixtures: multi.map((leg) => recognize(leg)) }
        );
        throw new Error("expected resolveAskContext to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const appError = err as AppError;
        expect(appError.code).toBe("MULTIPLE_FIXTURES");
        expect(appError.message).toContain("Arsenal vs Liverpool");
        expect(appError.message).toContain("Coventry City vs Tottenham Hotspur");
      }
    });
  });

  it("keeps general chat available while the active model is empty or unready", () => {
    expect(resolveAskContext(
      "Explain how a high defensive line works.",
      [],
      undefined,
      [],
      []
    )).toEqual({ tier: "general" });
  });

  it("uses Premier League season outlook for title questions without active model fixtures", () => {
    expect(resolveAskContext(
      "Who wins the Premier League?",
      [],
      undefined,
      [],
      [standing()],
      [{ home: "Arsenal", away: "Coventry City" }]
    )).toEqual({ tier: "season", competitionId: "eng.1" });
  });

  it("reports an active matchup whose model row is unavailable", () => {
    expect(resolveAskContext(
      "Arsenal vs Coventry City",
      [],
      undefined,
      [],
      [],
      [{ home: "Arsenal", away: "Coventry City" }]
    )).toEqual({
      tier: "model-unavailable",
      teams: ["Arsenal", "Coventry City"],
    });
  });

  it("routes a two-team title question to season grounding", () => {
    expect(resolveAskContext(
      "Will Arsenal or Coventry City win the Premier League?",
      [],
      undefined,
      fixtures,
      [standing()]
    )).toEqual({ tier: "season", competitionId: "eng.1" });
  });

  it("routes a clear named matchup to match grounding even when the competition is named", () => {
    expect(resolveAskContext(
      "Arsenal vs Coventry City in the Premier League",
      [],
      undefined,
      fixtures,
      [standing()]
    )).toMatchObject({ tier: "match", fixture: fixtures[0] });
  });

  it("preserves UCL qualifier context on a standings follow-up", () => {
    const history = [
      { role: "user" as const, content: "How does UCL qualifying look?" },
      { role: "assistant" as const, content: "Here is the current picture." },
    ];

    expect(resolveAskContext(
      "What about those standings?",
      history,
      undefined,
      fixtures,
      [standing("uefa.champions_qual", "Riga FC")]
    )).toEqual({
      tier: "competition",
      competitionId: "uefa.champions_qual",
    });
  });

  it("falls back to general analysis when the requested standings are unavailable", () => {
    expect(resolveAskContext(
      "How does UCL qualifying look?",
      [],
      undefined,
      fixtures,
      []
    )).toEqual({ tier: "general" });
  });

  it("reuses match context only for a relevant follow-up", () => {
    const history = [
      { role: "user" as const, content: "Arsenal vs Coventry City" },
      { role: "assistant" as const, content: "Arsenal is favoured." },
    ];
    const teamContext: [string, string] = ["Arsenal", "Coventry City"];

    expect(resolveAskContext(
      "What about the draw chance?",
      history,
      teamContext,
      fixtures,
      []
    )).toMatchObject({ tier: "match", fixture: fixtures[0] });
    expect(resolveAskContext(
      "Explain how a high defensive line works.",
      history,
      teamContext,
      fixtures,
      []
    )).toEqual({ tier: "general" });
    expect(resolveAskContext(
      "Which side has the stronger model case, and why?",
      history,
      teamContext,
      fixtures,
      []
    )).toMatchObject({ tier: "match", fixture: fixtures[0] });
    expect(resolveAskContext(
      "Which model input matters most to that edge?",
      history,
      teamContext,
      fixtures,
      []
    )).toMatchObject({ tier: "match", fixture: fixtures[0] });
  });

  it("retains match grounding for conversational follow-ups without an explicit cue", () => {
    const teamContext: [string, string] = ["Arsenal", "Coventry City"];
    for (const question of [
      "Why?",
      "Tell me more",
      "Is that a good bet?",
      "How confident are you?",
      "What's the value there?",
      "And the second half?",
    ]) {
      expect(resolveAskContext(question, [], teamContext, fixtures, []))
        .toMatchObject({ tier: "match", fixture: fixtures[0] });
    }
  });

  // Two phrasings of the relegation/title question used to split across tiers.
  it.each([
    "Who gets relegated?",
    "Which teams go down?",
    "Who is going to finish first?",
  ])("routes %s to the season outlook", (question) => {
    expect(resolveAskContext(question, [], undefined, fixtures, [standing()]))
      .toEqual({ tier: "season", competitionId: "eng.1" });
  });

  // Match grounding carries no standings, so a table question asked mid-match
  // could not be answered from the payload it was being held in.
  it.each([
    "How's the table looking?",
    "Who's top right now?",
    "Where do they sit in the standings?",
    "What does the Premier League table show?",
  ])("lets %s reach competition grounding while a match is in context", (question) => {
    expect(resolveAskContext(
      question,
      [],
      ["Arsenal", "Coventry City"],
      fixtures,
      [standing()]
    )).toEqual({ tier: "competition", competitionId: "eng.1" });
  });

  // The guard on the above: retention exists because "Why?" and "Tell me more"
  // once fell through to the disclaiming general tier. Broadening the table
  // cues must not reopen that.
  it.each([
    "Why?",
    "Tell me more",
    "Is that a good bet?",
    "How confident are you?",
    "What about BTTS?",
    "What about goals?",
  ])("keeps %s on the followed match", (question) => {
    expect(resolveAskContext(
      question,
      [],
      ["Arsenal", "Coventry City"],
      fixtures,
      [standing()]
    )).toMatchObject({ tier: "match", fixture: fixtures[0] });
  });

  it("prefers the competition already in view over the league-table fallback", () => {
    const history = [
      { role: "user" as const, content: "How does UCL qualifying look?" },
      { role: "assistant" as const, content: "Here is the current picture." },
    ];

    expect(resolveAskContext(
      "How's the table looking?",
      history,
      undefined,
      fixtures,
      [standing("uefa.champions_qual", "Riga FC")]
    )).toEqual({ tier: "competition", competitionId: "uefa.champions_qual" });
  });

  // Routing keeps grounding on these rather than risking a cue list that drops a
  // genuine follow-up; MATCH_QUESTION_SCOPE is what stops the answer being bent
  // back to the fixture.
  it("still retains match grounding for questions with no match intent", () => {
    const teamContext: [string, string] = ["Arsenal", "Coventry City"];
    for (const question of [
      "What's the weather like?",
      "Who won the 1966 World Cup?",
      "Tell me about VAR",
    ]) {
      expect(resolveAskContext(question, [], teamContext, fixtures, []))
        .toMatchObject({ tier: "match", fixture: fixtures[0] });
    }
  });

  it("releases match grounding once the question names another team", () => {
    const teamContext: [string, string] = ["Arsenal", "Coventry City"];
    expect(resolveAskContext(
      "How is Tottenham Hotspur doing?",
      [],
      teamContext,
      fixtures,
      []
    )).toEqual({ tier: "general" });
  });

  it("does not silently generalize a match follow-up while its model row is unavailable", () => {
    expect(resolveAskContext(
      "What about the draw chance?",
      [
        { role: "user", content: "Arsenal vs Coventry City" },
        { role: "assistant", content: "The model was previously available." },
      ],
      ["Arsenal", "Coventry City"],
      [],
      [],
      [{ home: "Arsenal", away: "Coventry City" }]
    )).toEqual({
      tier: "model-unavailable",
      teams: ["Arsenal", "Coventry City"],
    });
  });
});

/**
 * The policy these guards now implement: model-derived content always
 * survives, evidence guards govern only claims that actually came from search,
 * and missing team news abstains in its own section rather than taking the
 * answer with it.
 *
 * Each guard below has already shipped a delete-correct-content bug once. The
 * mirror failure is loosening one until a real hallucination gets through, so
 * every case proving that content survives is paired with one proving the
 * original hallucination is still blocked.
 */
describe("evidence guards leave model-derived answers intact", () => {
  const modelAnswer = [
    "**Verdict**",
    "Pundit's model gives Arsenal **56.3%**, the draw **23.4%** and Chelsea **20.3%**.",
    "",
    "**Goals**",
    "Over 2.5 lands at **54.0%**, BTTS yes at **52.1%**.",
    "",
    "**Team news**",
    "No verified update was established.",
  ].join("\n");

  const groundedMatch = (overrides: Partial<Grounding> = {}): Grounding => withDivergence({
    kind: "match",
    fixtureId: "espn:eng.1:1",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-08-22T14:00:00Z",
    stage: "Regular Season",
    home: "Arsenal",
    away: "Chelsea",
    pHome: 0.563,
    pDraw: 0.234,
    pAway: 0.203,
    pOver2_5: 0.54,
    pUnder2_5: 0.46,
    pBttsYes: 0.521,
    pBttsNo: 0.479,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [{
      source: "kalshi",
      observedAt: new Date().toISOString(),
      pHome: 0.5,
      pDraw: 0.25,
      pAway: 0.25,
    }],
    ...overrides,
  });

  it("keeps the whole answer when it made no externally sourced claim", async () => {
    // An answer with no citation markers has no verifiable claims, and there
    // is nothing to verify in a claim that was never made. All three guards
    // used to replace the entire answer -- probabilities and all -- with an
    // abstention, which was the single largest source of destroyed answers.
    const checked = await verifyCurrentClaims(
      modelAnswer,
      { queries: ["q"], results: [] },
      {} as Parameters<typeof verifyCurrentClaims>[2]
    );
    expect(checked.answer).toBe(modelAnswer);
    expect(checked.verification.status).toBe("abstain");

    expect(failClosedEmptyCurrentVerification(modelAnswer, {
      status: "abstain",
      supportedClaimCount: 0,
      removedClaimCount: 0,
    }, true)).toBe(modelAnswer);

    expect(renderEvidenceCitations(
      modelAnswer,
      { queries: ["q"], results: [] },
      true
    ).answer).toBe(modelAnswer);
  });

  it("still removes an uncited squad claim, including inside a Verdict section", async () => {
    // The hole that excise-not-rebuild could have opened, closed by the
    // sentence-level team-news rule: a squad claim smuggled into a verdict
    // paragraph is still a claim about the outside world.
    const smuggled = "**Verdict**\nArsenal are at **56.3%**. Saka is ruled out with a knee injury.";
    const checked = await verifyCurrentClaims(
      smuggled,
      { queries: ["q"], results: [] },
      {} as Parameters<typeof verifyCurrentClaims>[2]
    );
    expect(checked.answer).toContain("**56.3%**");
    expect(checked.answer).not.toMatch(/Saka|ruled out|knee injury/);
    expect(checked.answer).toContain("No verified, dated team-news update was established");

    for (const guarded of [
      failClosedEmptyCurrentVerification(smuggled, {
        status: "abstain",
        supportedClaimCount: 0,
        removedClaimCount: 0,
      }, true),
      renderEvidenceCitations(smuggled, { queries: ["q"], results: [] }, true).answer,
    ]) {
      expect(guarded).toContain("**56.3%**");
      expect(guarded).not.toMatch(/Saka|ruled out|knee injury/);
      expect(guarded).toMatch(/No verified, dated team-news update was established/i);
    }
  });

  it("resolves a marker the generator wrote without its S prefix", () => {
    // "[[1]]" matched no marker pattern, so it was neither resolved into a
    // source nor stripped: the sentence counted as uncited and was deleted,
    // and the literal bracket text was what reached the chat bubble.
    const bundle = {
      queries: ["q"],
      results: [{
        id: "S1",
        title: "Saka trains",
        url: "https://bbc.co.uk/x",
        date: "2026-08-18",
        snippet: "Saka trained.",
      }],
    };
    const rendered = renderEvidenceCitations("Saka is back in training [[1]].", bundle, true);
    expect(rendered.answer).toBe(
      "Saka is back in training ([Saka trains](https://bbc.co.uk/x), 2026-08-18)."
    );
    expect(rendered.citations).toEqual([expect.objectContaining({ id: "S1" })]);

    // A marker naming an id the bundle does not contain is still removed, in
    // every bracket shape, and no bracket form survives to the browser.
    for (const invented of ["[[99]]", "[[S99]]", "[[ S99 ]]"]) {
      const guarded = renderEvidenceCitations(
        `Arsenal are at **56.3%**.\nSaka is fit again ${invented}.`,
        bundle,
        true
      ).answer;
      expect(guarded).toContain("**56.3%**");
      expect(guarded).not.toMatch(/Saka|fit again/);
      expect(guarded).not.toContain("[[");
    }
  });

  it("quotes a market the grounding actually observed, and only that one", () => {
    const grounding = groundedMatch();
    // The escape hatch used to be dead code -- declared, read once, never
    // populated -- so this was wiped to the notice even though Pundit had
    // fetched the price itself and put it in the grounding.
    //
    // DELIBERATE CHANGE OF CONTRACT. This used to assert that the hatch
    // *replaced* the sentence with the rendered recital. Verified-and-kept is
    // now the correct outcome: 50.0% is exactly what the grounding observed
    // from Kalshi, so the sentence presents no unvalidated price and its
    // comparison against the model is the thing the match prompt asked for.
    // The recital is asserted below, where it belongs -- on figures that
    // cannot be reconciled.
    const quoted = sanitizeRuntimeResponseCorrectness(
      "Kalshi has Arsenal at 50.0%, so the model is a touch higher.",
      grounding
    );
    expect(quoted).toBe("Kalshi has Arsenal at 50.0%, so the model is a touch higher.");
    expect(quoted).not.toContain("omitted those numbers");

    // The same sentence with a figure Kalshi never showed is still removed,
    // and the recital is what stands in its place.
    const misquoted = sanitizeRuntimeResponseCorrectness(
      "Kalshi has Arsenal at 62.0%, so the model is a touch higher.",
      grounding
    );
    expect(misquoted).toContain("Kalshi market-implied probabilities (third-party data, not a Pundit forecast)");
    expect(misquoted).toContain("home 50.0%, draw 25.0%, away 25.0%");
    expect(misquoted).not.toContain("62.0%");

    // A price attributed to a source the grounding does not carry is still
    // removed, and the model's own numbers on neighbouring lines survive.
    const unattributable = sanitizeRuntimeResponseCorrectness(
      "Polymarket prices the home win at 58.0%.\nThe model has the home win at **77.6%**.",
      grounding
    );
    expect(unattributable).not.toContain("58.0%");
    expect(unattributable).toContain("**77.6%**");
    expect(unattributable).toContain("omitted those numbers");

    // Six hours is many missed 30-minute cycles; a stale observation is not
    // quotable even though it is complete and same-source.
    expect(sanitizeRuntimeResponseCorrectness(
      "Kalshi has Arsenal at 50.0%.",
      groundedMatch({
        oddsSources: [{
          source: "kalshi",
          observedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
          pHome: 0.5,
          pDraw: 0.25,
          pAway: 0.25,
        }],
      })
    )).toContain("omitted those numbers");
  });

  it("keeps an underdog section, the at-stake idiom, and prices split across a decimal point", () => {
    const grounding = groundedMatch({
      oddsSources: [{
        source: "kalshi",
        observedAt: new Date().toISOString(),
        pHome: 0.3,
        pDraw: 0.4,
        pAway: 0.3,
      }],
    });

    // A read-on-the-underdog section is supposed to discuss what the favourite
    // does well; the label used to be blanked for exactly that.
    const underdog = sanitizeGroundedMatchNarrative([
      "**Read on the underdog**",
      "Chelsea need Arsenal to be sloppy at the back.",
      "Arsenal are the model favourite at 56.3%.",
    ].join("\n"), grounding);
    expect(underdog).toContain("**Read on the underdog**");
    expect(underdog).toContain("Chelsea need Arsenal to be sloppy at the back.");
    // The naive splitter cut "56.3%" at the point, leaving "3% ..." behind.
    expect(underdog).toContain("Arsenal are the model favourite at 56.3%.");

    // A draw-favouring market says nothing about which of the two teams it
    // leans to, and "at stake" is an idiom rather than a bookmaker.
    expect(sanitizeGroundedMatchNarrative(
      "The market favours Arsenal on the Kalshi line.",
      grounding
    )).toBe("The market favours Arsenal on the Kalshi line.");
    const atStake = "Arsenal are the favourite at 56.3% in the model. Three points are at stake for Arsenal, and the market backs them.";
    expect(sanitizeGroundedMatchNarrative(atStake, grounding)).toBe(atStake);

    // Sources that disagree cannot establish a single market view for the
    // sentence to be wrong about, so it stands.
    const split = groundedMatch({
      oddsSources: [
        { source: "kalshi", observedAt: new Date().toISOString(), pHome: 0.55, pDraw: 0.25, pAway: 0.2 },
        { source: "polymarket", observedAt: new Date().toISOString(), pHome: 0.2, pDraw: 0.25, pAway: 0.55 },
      ],
    });
    expect(sanitizeGroundedMatchNarrative("The market backs Arsenal here.", split))
      .toBe("The market backs Arsenal here.");
  });

  it("still removes a claim that contradicts the model's own favourite", () => {
    const contradiction = sanitizeGroundedMatchNarrative(
      "Arsenal are the underdogs here.\nOver 2.5 lands at **54.0%**.",
      groundedMatch()
    );
    expect(contradiction).not.toContain("underdogs");
    expect(contradiction).toContain("**54.0%**");

    // And a market claim that a single agreed market plainly contradicts.
    expect(sanitizeGroundedMatchNarrative(
      "Kalshi favours Chelsea.",
      groundedMatch({
        oddsSources: [{
          source: "kalshi",
          observedAt: new Date().toISOString(),
          pHome: 0.62,
          pDraw: 0.2,
          pAway: 0.18,
        }],
      })
    )).toContain("unsupported interpretation was omitted");
  });

  /**
   * The other way to reach "nothing survived", and the one that was serving
   * users a 91-character reply to a live match question.
   *
   * When the tool-markup and narration guards upstream strip a leaked turn to
   * nothing, this guard is handed "" -- it has removed nothing and has no
   * opinion about anything. It nevertheless answered with its own fail-closed
   * notice, and because that notice is plausible prose it passed
   * `hasMeaningfulProse` and suppressed the grounded fallback in
   * `deliverAnswer`, which is precisely the thing that could have answered the
   * question from Pundit's own numbers.
   */
  it("does not invent a notice for an answer that was already empty", () => {
    for (const empty of ["", "   ", "\n\n"]) {
      expect(sanitizeGroundedMatchNarrative(empty, groundedMatch())).toBe(empty);
    }
    // And an answer it leaves entirely alone is returned untouched, not
    // re-issued through the notice branch.
    const intact = "**Verdict**\nOver 2.5 lands at **54.0%**.";
    expect(sanitizeGroundedMatchNarrative(intact, groundedMatch())).toBe(intact);
  });
});

/**
 * The market guard verifies a quote instead of replacing it.
 *
 * It used to substitute `renderValidatedOneXTwoMarket` for the model's whole
 * line whenever a market was named. `MATCH_SYSTEM_PROMPT` asks the model to
 * compare its probability against the market and state the edge, and
 * `MATCH_EXAMPLE` demonstrates exactly that -- so the substitution deleted the
 * reasoning the prompt had just requested. A production answer had Celtic at
 * 66.9% against Kalshi's 55.4%, an eleven-point divergence and the single most
 * decision-relevant fact available, and the delivered text never mentioned it:
 * it was three bare percentages with `observed 2026-08-19T09:33:30.001Z` on
 * the end.
 *
 * The protection the guard exists for is unchanged and is re-asserted here
 * from every angle that could have been weakened by the change: a price with
 * no validated record behind it, one attributed to a source the grounding does
 * not carry, one that is plausible but simply absent, and one that contradicts
 * the record all still go.
 */
describe("the market guard verifies rather than replaces", () => {
  const observedAt = "2026-08-19T09:33:30.001Z";
  const kalshiLegs = (probabilities: [number, number, number] = [0.554, 0.238, 0.208]) =>
    (["home", "draw", "away"] as const).map((outcome, index) => ({
      outcome,
      decimalOdds: 1 / probabilities[index],
      source: "Kalshi",
      observedAt,
    }));

  it("keeps the model's edge analysis when the quoted figures reconcile", () => {
    // The production sentence, in the shape MATCH_EXAMPLE demonstrates.
    const analysis = "The model gives Celtic **66.9%**, while Kalshi is tighter at 55.4% / 23.8% / 20.8%, so the model sees about **11 points** more edge on the home win.";
    expect(stripUnvalidatedExternalMarketClaims(analysis, [kalshiLegs()])).toBe(analysis);

    for (const survivor of [
      // Labelled legs, the other order, and a lower precision than the record.
      "Kalshi has the home side at 55.4%, the draw at 23.8% and the away side at 20.8%.",
      "At 55.4% / 23.8% / 20.8%, Kalshi is well below the model's 66.9% on Celtic.",
      "Kalshi market-implied: home 55%, draw 24%, away 21%.",
      // The model's own figures share the sentence and are not held against
      // the market record.
      "Kalshi puts the home win at 55.4%, whereas the model has it at 66.9% and over 2.5 at 54.0%.",
    ]) {
      expect(stripUnvalidatedExternalMarketClaims(survivor, [kalshiLegs()])).toBe(survivor);
    }
  });

  it("keeps the fused quote-and-interpretation sentence the prompt produces", () => {
    // Source quote and interpretation in ONE sentence. The prompt has a rule
    // asking the model to split them, added only to dodge the replace
    // behaviour; this assertion is what makes that rule belt-and-braces rather
    // than load-bearing on MiniMax's compliance.
    const fused = "Kalshi has Celtic at 55.4%, some 11.5 points below the model, the largest disagreement on the card.";
    expect(stripUnvalidatedExternalMarketClaims(fused, [kalshiLegs()])).toBe(fused);

    // The edge magnitude is a unit, not a price, in each form it is written.
    for (const survivor of [
      "Kalshi has Celtic at 55.4%, some **11.5 points** below the model.",
      "Kalshi has Celtic at 55.4%, 11.5 percentage points below the model.",
    ]) {
      expect(stripUnvalidatedExternalMarketClaims(survivor, [kalshiLegs()])).toBe(survivor);
    }
  });

  /**
   * A gap is not a price, wherever in the sentence it sits.
   *
   * The guard used to exempt a gap magnitude only inside the clause the source
   * name opened, which made word order decide the outcome: "Kalshi has Celtic
   * at 55.4%, some 11.5 points below the model" survived, while "the model is
   * 11.5 percentage points higher than Kalshi" -- the same claim, and exactly
   * what MATCH_SYSTEM_PROMPT asks for -- was deleted as an unattributable
   * price. It quotes no price at all. A difference between two probabilities
   * was never published by any market and so cannot be a fabricated quote.
   */
  it("keeps a sentence that names a source but quotes only a gap", () => {
    for (const survivor of [
      // The gap before the source name, and the source name before the gap.
      "The model is 11.5 percentage points higher than Kalshi on Celtic.",
      "Kalshi is 11.5 percentage points below the model on Celtic.",
      "11.5 percentage points separate the model from Kalshi on Celtic.",
      "On Celtic, the gap to Kalshi is 11.5 percentage points.",
      "Pundit's model sits 11.5 points clear of Kalshi here.",
      "The model's edge over the betting markets is 11.5 points.",
      // A bare magnitude against a comparative, unit left implicit.
      "The model is 11.5 higher than Kalshi on Celtic.",
      // An attributive verb does not make a gap into a quote.
      "Kalshi prices Celtic some 11.5 points under the model.",
    ]) {
      expect(stripUnvalidatedExternalMarketClaims(survivor, [kalshiLegs()])).toBe(survivor);
      // The gap is not a price whether or not a record exists, so a sentence
      // quoting none cannot be owed the fail-closed notice either.
      expect(stripUnvalidatedExternalMarketClaims(survivor)).toBe(survivor);
    }
  });

  /**
   * The exemption is for magnitudes, not for comparatives. A percent sign means
   * a percentage, and a percentage beside a market source is a price until the
   * record says otherwise -- otherwise "Kalshi has Arsenal at 62.0% above the
   * model" would wave an invented quote straight through on the strength of the
   * word "above".
   */
  it("does not let a comparative excuse a percentage from being checked", () => {
    for (const priced of [
      "Kalshi has Arsenal at 62.0% above the model's read.",
      "Kalshi has Arsenal at 62.0% higher than the model.",
      "Kalshi has Arsenal at 57.0%, well above the model.",
    ]) {
      const sanitized = stripUnvalidatedExternalMarketClaims(priced, [kalshiLegs()]);
      expect(sanitized).not.toBe(priced);
      expect(sanitized).toContain("home 55.4%, draw 23.8%, away 20.8%");
    }
  });

  /**
   * Every protection the guard exists for, asserted in the reversed word order
   * too. The fix is positional, so anything that only held in one direction
   * would be a hole in the other.
   */
  it("still removes an unvalidated price written either way round", () => {
    // No record at all.
    for (const priced of [
      "Kalshi has Arsenal at 62%, so the model is a touch higher.",
      "At 62%, Kalshi has Arsenal, so the model is a touch higher.",
    ]) expect(stripUnvalidatedExternalMarketClaims(priced)).toContain("omitted those numbers");

    // A source the grounding does not carry.
    for (const priced of [
      "Polymarket prices the home win at 58.0%.",
      "At 58.0% on the home win, Polymarket is below the model.",
    ]) {
      const sanitized = stripUnvalidatedExternalMarketClaims(priced, [kalshiLegs()]);
      expect(sanitized).not.toContain("58.0%");
      expect(sanitized).toContain("omitted those numbers");
    }

    // Plausible but simply absent from the record.
    for (const absent of [
      "Kalshi has Arsenal at 57.0%.",
      "At 57.0%, Kalshi has Arsenal.",
    ]) {
      expect(stripUnvalidatedExternalMarketClaims(absent, [kalshiLegs()]))
        .toContain("home 55.4%, draw 23.8%, away 20.8%");
    }

    // Contradicting the record wholesale.
    for (const contradicting of [
      "Kalshi market: home 99%, draw 0.5%, away 0.5%.",
      "Home 99%, draw 0.5%, away 0.5% is the Kalshi market.",
    ]) {
      const sanitized = stripUnvalidatedExternalMarketClaims(contradicting, [kalshiLegs()]);
      expect(sanitized).not.toContain("99%");
      expect(sanitized).toContain("home 55.4%, draw 23.8%, away 20.8%");
    }

    // A stale or incomplete record is no record, in either order.
    for (const priced of [
      "Kalshi has home 55.4%, draw 23.8% and away 20.8%.",
      "Home 55.4%, draw 23.8% and away 20.8% is what Kalshi shows.",
    ]) {
      expect(stripUnvalidatedExternalMarketClaims(priced, [kalshiLegs().slice(0, 2)]))
        .toContain("omitted those numbers");
    }
  });

  it("lets two named sources in one sentence each answer for their own figures", () => {
    const polymarketLegs = (["home", "draw", "away"] as const).map((outcome, index) => ({
      outcome,
      decimalOdds: 1 / [0.57, 0.23, 0.2][index],
      source: "Polymarket",
      observedAt,
    }));
    const both = "Kalshi has the home win at 55.4% and Polymarket at 57.0%, either way below the model.";
    expect(stripUnvalidatedExternalMarketClaims(both, [kalshiLegs(), polymarketLegs]))
      .toBe(both);

    // One record cannot vouch for the other's price: with only Kalshi
    // validated, the Polymarket figure is unattributable and the sentence goes.
    expect(stripUnvalidatedExternalMarketClaims(both, [kalshiLegs()])).not.toContain("57.0%");
    // Nor can the sentence pass by quoting one source correctly and the other
    // with a number that source never showed.
    expect(stripUnvalidatedExternalMarketClaims(
      "Kalshi has the home win at 55.4% and Polymarket at 61.0%.",
      [kalshiLegs(), polymarketLegs]
    )).not.toContain("61.0%");
  });

  it("corrects a single slipped figure in place and keeps the sentence", () => {
    // A repair leaves no unvalidated price standing: the wrong figure is
    // replaced by the record's own, at the precision the model wrote.
    expect(stripUnvalidatedExternalMarketClaims(
      "Kalshi has home 55.4%, draw 23.9% and away 20.8%, so the model is 11 points higher.",
      [kalshiLegs()]
    )).toBe("Kalshi has home 55.4%, draw 23.8% and away 20.8%, so the model is 11 points higher.");
    expect(stripUnvalidatedExternalMarketClaims(
      "Kalshi has home 55.4%, draw 23.8% and away 25.0%, a wider book than the model's.",
      [kalshiLegs()]
    )).toBe("Kalshi has home 55.4%, draw 23.8% and away 20.8%, a wider book than the model's.");
  });

  it("never emits a raw ISO timestamp when it does fall back to a recital", () => {
    const recited = stripUnvalidatedExternalMarketClaims(
      "Kalshi has home 10.0%, draw 80.0% and away 10.0%.",
      [kalshiLegs()]
    );
    expect(recited).not.toContain(observedAt);
    expect(recited).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(recited).toContain("observed 19 August 2026 at 09:33 UTC");
    expect(recited).toContain("home 55.4%, draw 23.8%, away 20.8%");
  });

  it("still removes a price that cannot be attributed to a validated record", () => {
    // No record at all -- the long-standing default, unchanged.
    for (const priced of [
      "Kalshi has Arsenal at 62%, so the model is a touch higher.",
      "The bookmakers price the draw at 3.40 and the away win at 3.60.",
      "Kalshi market-implied home 48.0%, draw 28.0%, away 24.0%.",
    ]) {
      expect(stripUnvalidatedExternalMarketClaims(priced)).toContain("omitted those numbers");
    }

    // A record exists, but not for the source the sentence names. Kalshi's
    // record cannot vouch for a Polymarket price, and the guard does not
    // silently re-attribute one source's numbers to another's sentence.
    const otherSource = stripUnvalidatedExternalMarketClaims(
      "Polymarket prices the home win at 58.0%.",
      [kalshiLegs()]
    );
    expect(otherSource).not.toContain("58.0%");
    expect(otherSource).not.toContain("Kalshi");
    expect(otherSource).toContain("omitted those numbers");

    // Plausible, well-formed, correctly attributed -- and simply not a figure
    // the record contains. Nearness is not validation.
    for (const absent of [
      "Kalshi has Arsenal at 57.0%.",
      "Kalshi is at 55.9% on the home win.",
      // More than one leg out of step is a different book, not a slip.
      "Kalshi has home 55.4%, draw 30.0% and away 25.0%, a wider book than the model's.",
    ]) {
      const sanitized = stripUnvalidatedExternalMarketClaims(absent, [kalshiLegs()]);
      expect(sanitized).not.toBe(absent);
      expect(sanitized).toContain("Kalshi market-implied probabilities");
      expect(sanitized).toContain("home 55.4%, draw 23.8%, away 20.8%");
    }

    // Figures that contradict the record wholesale are replaced, not repaired:
    // rewriting every leg would be authoring the quote rather than checking it.
    const contradicting = stripUnvalidatedExternalMarketClaims(
      "Kalshi market: home 99%, draw 0.5%, away 0.5%.",
      [kalshiLegs()]
    );
    expect(contradicting).not.toContain("99%");
    expect(contradicting).toContain("home 55.4%, draw 23.8%, away 20.8%");

    // An incomplete record is no record: the hatch never opens on two legs.
    expect(stripUnvalidatedExternalMarketClaims(
      "Kalshi has home 55.4%, draw 23.8% and away 20.8%.",
      [kalshiLegs().slice(0, 2)]
    )).toContain("omitted those numbers");
  });
});

/**
 * The qualifier points rewrite fires on a points *return*, not on the word.
 *
 * A knockout tie pays no league points, so describing a draw as "one point" is
 * wrong on a qualifier and the rewrite is legitimate. It was written as an
 * unconditional `/\b(?:one|1) point\b/` though, which mangled every other use
 * of the word -- including "Celtic lead the group by one point", ordinary
 * standings prose that makes no claim about this tie at all and shipped as
 * "lead the group by a draw" on every qualifier fixture.
 *
 * The new prompt makes this worse rather than rarer: it asks for the edge in
 * points ("the model is one point higher"), which is a unit of measurement and
 * the exact phrase the old rewrite destroyed.
 */
describe("the qualifier points rewrite", () => {
  const qualifier = {
    kind: "match",
    competitionId: "uefa.champions_qual",
    home: "Celtic",
    away: "LASK",
    scorelines: [],
  } as unknown as Grounding;

  it("leaves a point used as a unit of measurement alone", () => {
    for (const prose of [
      "The model is one point higher on the draw than the market.",
      "Celtic lead the group by one point.",
      "The model is 1 point higher on the home win.",
      "The model is about 11 percentage points higher on the home win.",
      "A one point swing would not change the read.",
    ]) {
      expect(sanitizeMatchAnswer(prose, qualifier)).toBe(prose);
    }
  });

  /**
   * Firing is only half the job. Swapping the noun phrase "one point" for the
   * noun phrase "a draw" produced "A draw is worth a draw to Celtic." -- the
   * claim was correctly identified as false and the reader still got broken
   * English. Every rule here is asserted on its whole output sentence, not on
   * the presence or absence of a token, because a token assertion is exactly
   * what let the gibberish through.
   */
  it("rewrites a points return into prose that reads", () => {
    for (const [claimed, expected] of [
      // The reported defect.
      ["A draw is worth one point to Celtic.", "A draw is worth no league points to Celtic."],
      ["A 1-1 is worth one point.", "A 1-1 is worth no league points."],
      ["A draw is only worth one point.", "A draw is worth no league points."],
      // A noun phrase keeps its object, and a sentence-initial rewrite keeps
      // its capital -- the words carrying it are the ones removed.
      ["One point from the tie keeps LASK alive.", "A draw in the tie keeps LASK alive."],
      ["A share of the points would suit LASK.", "A draw would suit LASK."],
      // A verb is rewritten as a verb, in the tense it was written in.
      ["LASK would take one point from a 1-1.", "LASK would draw from a 1-1."],
      ["LASK could earn a point here.", "LASK could draw here."],
      ["Celtic will settle for one point.", "Celtic will draw."],
      ["Celtic settled for one point in the first leg.", "Celtic drew in the first leg."],
      ["Celtic share the points at 1-1.", "Celtic draw at 1-1."],
      ["Celtic shared the points in the first leg.", "Celtic drew in the first leg."],
      ["Celtic claimed three points in the first leg.", "Celtic won in the first leg."],
      ["Celtic are taking three points from this.", "Celtic are winning from this."],
      // No article to rewrite, so the idiom is kept and the points claim goes.
      ["Kuopio's share of the points came at 1-1.", "Kuopio's share of the spoils came at 1-1."],
      // The pre-existing rewrites still land, and still read.
      ["A 1-1 gives Celtic a share of the points.", "A 1-1 gives Celtic a draw."],
      ["Celtic take all three points with a 2-0.", "Celtic win with a 2-0."],
      ["Sabah's route to three points is a 1-0.", "Sabah's route to victory is a 1-0."],
    ]) {
      expect(sanitizeMatchAnswer(claimed, qualifier)).toBe(expected);
    }

    // No rewrite may leave a league-points claim behind it, and none may leave
    // the doubled noun phrase that prompted this fix.
    for (const claimed of [
      "A draw is worth one point to Celtic.",
      "One point from the tie keeps LASK alive.",
      "Celtic take all three points with a 2-0.",
      "A 1-1 gives Celtic a share of the points.",
    ]) {
      const rewritten = sanitizeMatchAnswer(claimed, qualifier);
      expect(rewritten).not.toMatch(/\bone point\b|\bthree points\b/i);
      expect(rewritten).not.toMatch(/\ba draw is worth a draw\b|\ba draw a draw\b/i);
    }
  });

  it("does not touch league prose outside a qualifier", () => {
    const league = { ...qualifier, competitionId: "eng.1" } as Grounding;
    const prose = "Arsenal would take one point from a 1-1 and lead by one point.";
    expect(sanitizeMatchAnswer(prose, league)).toBe(prose);
  });
});

/**
 * The match answer's job is to reason from the grounding, not to read it out.
 *
 * The live failure these tests stand for: an answer to Celtic vs LASK that
 * quoted the model at 66.9% and Kalshi at 55.4% in adjacent clauses, and never
 * said that they disagree by eleven and a half points -- the one fact on the
 * card that could have changed a decision.
 *
 * Two things have to hold for the fix to be real, and only one of them is a
 * prompt edit. The prompt has to ask for divergence, conditionality and honest
 * abstention; and the answer shape it asks for has to survive the guard chain,
 * which has a long history of deleting exactly the sentences a prompt just
 * asked for. The second half is what the sanitizer cases below check, using the
 * real Celtic vs LASK numbers.
 */
describe("match-tier analytical priorities", () => {
  const celticLask = (overrides: Partial<Grounding> = {}): Grounding => withDivergence({
    kind: "match",
    fixtureId: "espn:uefa.champions_qual:1",
    competitionId: "uefa.champions_qual",
    competition: "UEFA Champions League Qualifying",
    homeFieldAdvantage: true,
    date: "2026-08-19T19:00:00Z",
    stage: "Playoff Round - First Leg",
    home: "Celtic",
    away: "LASK",
    pHome: 0.669,
    pDraw: 0.208,
    pAway: 0.124,
    pOver2_5: 0.579,
    pUnder2_5: 0.421,
    pBttsYes: 0.513,
    pBttsNo: 0.487,
    topScores: [
      { score: "2-0", probability: 0.116 },
      { score: "1-1", probability: 0.099 },
      { score: "1-0", probability: 0.098 },
    ],
    scorelines: [
      { score: "2-0", probability: 0.116 },
      { score: "1-1", probability: 0.099 },
      { score: "1-0", probability: 0.098 },
      { score: "1-2", probability: 0.038 },
      { score: "0-1", probability: 0.033 },
    ],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [
      { source: "kalshi", observedAt: new Date().toISOString(), pHome: 0.554, pDraw: 0.238, pAway: 0.208 },
      { source: "polymarket", observedAt: new Date().toISOString(), pHome: 0.565, pDraw: 0.235, pAway: 0.2 },
    ],
    ...overrides,
  });

  it("asks for quantified divergence, honest agreement and a conditional read", () => {
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("Reason from the numbers rather than reciting them");
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("Lead with model-versus-market disagreement");
    expect(MATCH_ANALYSIS_PRIORITIES)
      .toContain("how many percentage points it is, and which way it runs");
    // Agreement has to be reportable as a conclusion, or the prompt has just
    // taught the model to invent an edge on every efficiently priced fixture.
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("Agreement is a conclusion, not a hole to fill");
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("no meaningful disagreement here");
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("Never manufacture an edge");
    // The verdict half. The band is named so the prompt and the deterministic
    // floor cannot contradict each other in front of the reader, and the
    // no-edge verdict is stated as a result worth giving rather than a
    // fallback -- "the moneyline is efficiently priced" is the answer more
    // often than an edge is.
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("Say where the value is and where it is not");
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("inside about two points either");
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("efficiently priced -- skip it");
    // The close half, stated as a completeness rule rather than a preference.
    expect(MATCH_ANALYSIS_PRIORITIES)
      .toContain("Close on what would change the read, and make it conditional");
    expect(MATCH_ANALYSIS_PRIORITIES)
      .toContain("what would move it is incomplete, however correct its numbers");
    // The recital is replaced, not the numbers: no correctness regression.
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("Keep every grounded number you would have reported");
  });

  it("names the capabilities Pundit does not have so ambition cannot license invention", () => {
    for (const missing of [
      "no bookmaker odds",
      "no betting splits",
      "handle or money percentages",
      "no opening lines or line-movement history",
      "player-level data of any kind",
    ]) expect(MATCH_CAPABILITY_BOUNDS).toContain(missing);
    expect(MATCH_CAPABILITY_BOUNDS)
      .toContain("never quote a price in decimal, fractional or American form");
    expect(MATCH_CAPABILITY_BOUNDS).toContain("say Pundit cannot see it");
  });

  it("keeps market quoting and interpretation in separate sentences, as the guards require", () => {
    // Not a style rule. `stripUnvalidatedExternalMarketClaims` replaces any
    // sentence naming a market source with Pundit's own rendering of that
    // market, so reasoning written inside such a sentence is deleted along with
    // the quote. The prompt has to say so; the sanitizer cases below are why.
    expect(MATCH_CAPABILITY_BOUNDS).toContain("Quote market probabilities one source per sentence");
    expect(MATCH_CAPABILITY_BOUNDS)
      .toContain("put your interpretation of the gap in a separate sentence");
    expect(MATCH_CAPABILITY_BOUNDS).toContain("percentage points");
  });

  it("delivers a divergence-led answer through the real guard chain intact", () => {
    const answer = [
      "**Model vs market**",
      "Pundit's model makes **Celtic 66.9%**, the **draw 20.8%** and **LASK 12.4%** for the"
      + " 19 August playoff first leg. Kalshi: home 55.4%, draw 23.8%, away 20.8%. The"
      + " disagreement is concentrated on the home win, where the model is about"
      + " **11 percentage points** higher than the priced probability; the draw is within three"
      + " points and LASK within eight, so the value such as it is sits on Celtic and nowhere else.",
      "",
      "**Goals**",
      "**Over 2.5 at 57.9%** and **both teams to score at 51.3%** point to an open game.",
      "",
      "**Likely scorelines**",
      "**2-0 (11.6%)**, **1-1 (9.9%)** and **1-0 (9.8%)** lead the table.",
      "",
      "**What would change this**",
      "No dated team-news source was found for either side, and the model's edge assumes a normal"
      + " Celtic XI. If the first-choice back line starts, the gap on the home win stands; if two"
      + " of them are missing, that gap is the first thing to shrink and the draw becomes the"
      + " better-priced outcome.",
    ].join("\n");
    // One instance, because the market observation timestamp is rendered into
    // the answer and a second `celticLask()` would move it.
    const grounding = celticLask();
    const delivered = sanitizeDeliveredAnswer(answer, "match", grounding);
    // The interpretation is the whole point of the rewrite, so it is the thing
    // asserted to survive -- alongside every number the old recital got right.
    expect(delivered).toContain("the model is about **11 percentage points** higher");
    expect(delivered).toContain("so the value such as it is sits on Celtic and nowhere else");
    expect(delivered).toContain("that gap is the first thing to shrink");
    for (const figure of ["66.9%", "20.8%", "12.4%", "57.9%", "51.3%", "11.6%", "9.9%", "9.8%"]) {
      expect(delivered).toContain(figure);
    }
    // Pundit re-renders the quoted market from its own record; the figures are
    // the grounding's own, so nothing is lost by that substitution.
    expect(delivered).toMatch(/Kalshi[^\n]*home 55\.4%, draw 23\.8%, away 20\.8%/);
    expect(delivered).toContain("**What would change this**");
    // Idempotent: the delivery chain runs more than once on a settled answer.
    expect(sanitizeDeliveredAnswer(delivered, "match", grounding)).toBe(delivered);
  });

  it("carries an agreement finding and an actionable abstention through the guards", () => {
    const agreed = celticLask({
      oddsSources: [{
        source: "kalshi",
        observedAt: new Date().toISOString(),
        pHome: 0.664,
        pDraw: 0.214,
        pAway: 0.122,
      }],
    });
    const answer = [
      "**Model vs market**",
      "Pundit's model makes **Celtic 66.9%**, the **draw 20.8%** and **LASK 12.4%** on 19 August."
      + " Kalshi: home 66.4%, draw 21.4%, away 12.2%. There is no meaningful disagreement here:"
      + " every outcome sits within a point of the priced probability, so the fixture looks"
      + " efficiently priced and there is no edge to take on the result.",
      "",
      "**What would change this**",
      "No dated team-news source was found. If a first-choice striker is ruled out before kickoff,"
      + " the under and the draw are where that shows up first; check a lineup report an hour"
      + " before kickoff.",
    ].join("\n");
    const delivered = sanitizeDeliveredAnswer(answer, "match", agreed);
    expect(delivered).toContain("There is no meaningful disagreement here");
    expect(delivered).toContain("there is no edge to take on the result");
    expect(delivered).toContain("check a lineup report an hour before kickoff");
    expect(delivered).not.toContain("omitted those numbers");
  });

  it("keeps the fused shape, and still deletes the market-favours shape", () => {
    // The fused shape USED to lose its reasoning, which is why the prompt has a
    // rule asking the model to split the quote from the interpretation. The
    // market guard now verifies a quote instead of replacing the line, so a
    // fused sentence whose figures reconcile survives whole -- the prompt rule
    // is belt-and-braces rather than load-bearing. Pinned here so a regression
    // in the guard shows up as the reasoning disappearing again.
    const fused = sanitizeDeliveredAnswer(
      "**Model vs market**\nKalshi has Celtic at 55.4%, some 11.5 points below Pundit's model at"
      + " 66.9%, which is the largest disagreement on the card.",
      "match",
      celticLask()
    );
    expect(fused).toContain("largest disagreement on the card");
    expect(fused).toContain("55.4%");

    const favours = sanitizeDeliveredAnswer(
      "**Model vs market**\nThe market gives LASK more of an edge than the model does.\n"
      + "The market prices LASK about 8 points higher than the model does.",
      "match",
      celticLask()
    );
    expect(favours).not.toContain("gives LASK more of an edge");
    expect(favours).toContain("The market prices LASK about 8 points higher than the model does.");
  });
});

/**
 * The precomputed divergence and the sentence the delivery guarantee composes
 * from it.
 *
 * Both halves of this feature exist because MiniMax followed a prompt
 * instruction roughly half the time, and neither half can be checked against
 * MiniMax from here. What *can* be checked is that the arithmetic is right,
 * that the composed sentence survives the guard chain that has historically
 * deleted market prose, and that a model which already stated the gap is not
 * made to state it twice.
 */
describe("model-versus-market divergence", () => {
  // The live market cache is empty in tests, so the built grounding's own
  // divergence is empty; dropping it lets `withDivergence` recompute against
  // the sources this suite supplies.
  const { marketDivergence: _unpriced, ...celticBase } = buildGrounding(
    fixture("Celtic", "LASK", {
      competitionId: "uefa.champions_qual",
      competition: "UEFA Champions League Qualifying",
      pHome: 0.669,
      pDraw: 0.208,
      pAway: 0.124,
    })
  );

  /** The real Celtic vs LASK payload: model 66.9/20.8/12.4 against two books. */
  const celtic = withDivergence({
    ...celticBase,
    oddsSources: [
      { source: "kalshi", observedAt: new Date().toISOString(), pHome: 0.554, pDraw: 0.238, pAway: 0.208 },
      { source: "polymarket", observedAt: new Date().toISOString(), pHome: 0.565, pDraw: 0.235, pAway: 0.2 },
    ],
  });

  const kalshi = celtic.marketDivergence[0];

  it("differences every leg of every complete source", () => {
    expect(celtic.marketDivergence.map((entry) => entry.source))
      .toEqual(["kalshi", "polymarket"]);
    expect(kalshi.legs).toEqual([
      { outcome: "home", label: "Celtic", modelPercent: 66.9, marketPercent: 55.4, gapPoints: 11.5 },
      { outcome: "draw", label: "the draw", modelPercent: 20.8, marketPercent: 23.8, gapPoints: -3 },
      { outcome: "away", label: "LASK", modelPercent: 12.4, marketPercent: 20.8, gapPoints: -8.4 },
    ]);
    // The headline is the widest absolute gap, not the widest positive one.
    expect(kalshi.largest.outcome).toBe("home");
    expect(celtic.marketDivergence[1].largest)
      .toMatchObject({ outcome: "home", marketPercent: 56.5, gapPoints: 10.4 });
  });

  /**
   * The gap is the difference of the two percentages the sentence quotes, so a
   * reader can check it on the page. Differencing the raw probabilities gives
   * 11.4 here, which would read as an arithmetic error next to 66.9% and 55.4%.
   */
  it("differences the quoted percentages rather than the raw probabilities", () => {
    expect(kalshi.largest.gapPoints)
      .toBeCloseTo(kalshi.largest.modelPercent - kalshi.largest.marketPercent, 6);
    expect(kalshi.largest.gapPoints).toBe(11.5);
    // Unrounded inputs are where the two conventions part company: 0.66879 and
    // 0.55437 display as 66.9% and 55.4%, but their raw difference is 11.4.
    // Reporting that would put "66.9%", "55.4%" and "11.4 percentage points" in
    // one sentence and invite the reader to call it an error.
    const unrounded = computeMarketDivergence(
      { home: "Celtic", away: "LASK", pHome: 0.66879, pDraw: 0.208, pAway: 0.124 },
      [{ source: "kalshi", observedAt: new Date().toISOString(), pHome: 0.55437, pDraw: 0.238, pAway: 0.208 }]
    )[0].legs[0];
    expect([unrounded.modelPercent, unrounded.marketPercent]).toEqual([66.9, 55.4]);
    expect((0.66879 - 0.55437) * 100).toBeCloseTo(11.44, 2);
    expect(unrounded.gapPoints).toBe(11.5);
  });

  it("produces nothing for an absent or incomplete market", () => {
    expect(computeMarketDivergence(celtic, [])).toEqual([]);
    expect(computeMarketDivergence(celtic, [
      { source: "kalshi", observedAt: new Date().toISOString(), pHome: 0.554, pDraw: null, pAway: 0.208 },
    ])).toEqual([]);
    // A certainty is not a price, and the market guard would refuse to vouch
    // for one, so no divergence may be built from it either.
    expect(computeMarketDivergence(celtic, [
      { source: "kalshi", observedAt: new Date().toISOString(), pHome: 1, pDraw: 0, pAway: 0 },
    ])).toEqual([]);
  });

  /**
   * The whole point of composing the sentence server-side is that the guard
   * chain cannot delete it. `stripUnvalidatedExternalMarketClaims` removes any
   * market claim it cannot reconcile against the validated record, and this
   * sentence is built from that record, so the chain must be a no-op on it --
   * on a `uefa.champions_qual` fixture, where the qualifier points rewrites
   * also run over the word "points".
   */
  it("composes a sentence the guard chain returns unchanged", () => {
    const answer = "**Model vs market**\nPundit's model makes **Celtic 66.9%**, the"
      + " **draw 20.8%** and **LASK 12.4%**. "
      + composeMarketDivergenceSentence(kalshi, kalshi.largest);
    expect(answer).toContain(
      "Against Kalshi, which prices Celtic at 55.4%, Pundit's model at 66.9% is"
      + " 11.5 percentage points higher"
    );
    expect(sanitizeDeliveredAnswer(answer, "match", celtic)).toBe(answer);
  });

  it("survives the chain for a draw and an away headline too", () => {
    for (const leg of kalshi.legs) {
      const answer = `**Model vs market**\n${composeMarketDivergenceSentence(kalshi, leg)}`;
      expect(sanitizeDeliveredAnswer(answer, "match", celtic)).toBe(answer);
      expect(answer).toContain(`${leg.marketPercent.toFixed(1)}%`);
    }
  });

  it("reports a level market as agreement rather than as an edge", () => {
    const level = computeMarketDivergence(celtic, [
      { source: "kalshi", observedAt: new Date().toISOString(), pHome: 0.669, pDraw: 0.208, pAway: 0.123 },
    ])[0];
    const sentence = composeMarketDivergenceSentence(level, level.legs[0]);
    expect(sentence).toContain("lands on the same number");
    expect(sentence).not.toContain("percentage points");
  });

  /**
   * Detection has to be robust to phrasing, or the guarantee prints the model's
   * own point twice. These are the same claim written four ways, and none of
   * them may be read as a missing divergence.
   */
  it("recognises a divergence however the model phrased it", () => {
    const stated = [
      "The model is 11.5 percentage points higher than Kalshi on the home win.",
      "About 11 points above the market on Celtic, which is where the edge sits.",
      "Pundit is 11.4 higher, in points, than the books here.",
      "That leaves the model 8.4 pts under the market on LASK.",
      "**Model vs market**\nKalshi has Celtic at 55.4%, some 11.5 points below"
        + " Pundit's model at 66.9%.",
    ];
    for (const answer of stated) {
      expect(statesMarketDivergence(answer, celtic.marketDivergence)).toBe(true);
    }
  });

  it("does not mistake other prose for a stated divergence", () => {
    const silent = [
      "Pundit's model makes Celtic 66.9%, the draw 20.8% and LASK 12.4%.",
      // A points figure with nothing to do with the market comparison.
      "Celtic lead the group by one point.",
      // The market named, but no gap given -- the exact half-compliance shape
      // this feature exists to catch.
      "Kalshi prices Celtic at 55.4%, so the market is a little tighter.",
      // A gap in points that matches no leg of this payload.
      "The model is 30 percentage points clear of the market on the draw.",
    ];
    for (const answer of silent) {
      expect(statesMarketDivergence(answer, celtic.marketDivergence)).toBe(false);
    }
    // And with no market at all there is nothing to have stated.
    expect(statesMarketDivergence(
      "The model is 11.5 percentage points higher than the market.",
      []
    )).toBe(false);
  });
});
