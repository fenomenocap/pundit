import { describe, expect, it } from "vitest";
import { composeMatchResponse, composePlayerScorerAnswer, composeTeamNewsAnswer } from "./response-composer";
import { planResponse } from "./response-plan";
import {
  PLAYER_SCORER_ABSTENTION,
  TEAM_NEWS_COMPOSE_ABSTENTION,
  extractPlayerEvidence,
  hasTeamNewsEvidence,
  hasTrustworthyPlayerEvidence,
  leadingScorerCandidate,
  type PlayerEvidenceSource,
  type PlayerFixtureRef,
} from "./player-evidence";

const fixture: PlayerFixtureRef = {
  fixtureId: "eng.1:1",
  home: "Arsenal",
  away: "Chelsea",
  kickoff: "2026-09-12T14:00:00Z",
};

const source = (over: Partial<PlayerEvidenceSource> = {}): PlayerEvidenceSource => ({
  id: "S1",
  title: "Chelsea vs Arsenal anytime scorer odds",
  url: "https://example.com/scorers",
  date: "2026-09-11T08:00:00Z",
  snippet: "Cole Palmer anytime 2.10 for Chelsea, Cole Palmer expected to start for Chelsea.",
  ...over,
});

describe("player evidence adapter", () => {
  it("extracts a dated player-market quote bound to the fixture", () => {
    const bundle = extractPlayerEvidence([source()], fixture);
    expect(hasTrustworthyPlayerEvidence(bundle)).toBe(true);
    const lead = leadingScorerCandidate(bundle);
    expect(lead?.playerName).toBe("Cole Palmer");
    expect(lead?.teamId).toBe("Chelsea");
    expect(lead?.decimalOdds).toBe(2.1);
    expect(lead?.impliedProbability).toBeCloseTo(1 / 2.1);
    expect(lead?.sourceId).toBe("S1");
  });

  it("drops stale, unidentified, and off-fixture names", () => {
    expect(hasTrustworthyPlayerEvidence(extractPlayerEvidence([source({
      date: "2026-08-01T00:00:00Z",
    })], fixture))).toBe(false);
    expect(hasTrustworthyPlayerEvidence(extractPlayerEvidence([source({
      title: "Premier League odds",
      snippet: "Anytime 2.10",
    })], fixture))).toBe(false);
    expect(hasTrustworthyPlayerEvidence(extractPlayerEvidence([source({
      snippet: "Zlatan Ibrahimovic anytime 1.50 for AC Milan",
      title: "Serie A scorers",
    })], fixture))).toBe(false);
  });

  it("keeps a fixture-bound undated market quote and labels it undated", () => {
    const bundle = extractPlayerEvidence([source({ date: "" })], fixture);
    expect(hasTrustworthyPlayerEvidence(bundle)).toBe(true);
    expect(leadingScorerCandidate(bundle)?.observedAt).toBeNull();
  });

  it("extracts fractional list quotes only when each player is locally bound to a side", () => {
    const bundle = extractPlayerEvidence([{
      id: "S1",
      title: "Sky Sports Bournemouth vs Brentford scorer odds",
      url: "https://example.com/scorers",
      date: "2026-09-11T08:00:00Z",
      snippet: "Semenyo 11/4 anytime for Bournemouth, Wissa 2.1 to score for Brentford",
    }], {
      fixtureId: "eng.1:bournemouth-brentford",
      home: "Bournemouth",
      away: "Brentford",
      kickoff: "2026-09-12T14:00:00Z",
    });
    expect(hasTrustworthyPlayerEvidence(bundle)).toBe(true);
    const lead = leadingScorerCandidate(bundle);
    expect(lead?.playerName).toBe("Wissa");
    expect(lead?.decimalOdds).toBe(2.1);
    expect(bundle.markets.some((row) => row.playerName === "Semenyo" && row.decimalOdds === 3.75)).toBe(true);
  });

  it("does not carry a later player's club affiliation across a comma", () => {
    const bundle = extractPlayerEvidence([{
      id: "S1",
      title: "Bournemouth vs Brentford scorer odds",
      url: "https://example.com/scorers",
      date: "2026-09-11T08:00:00Z",
      snippet: "Anytime scorers: Semenyo 11/4, Wissa 2.10 for Brentford.",
    }], {
      fixtureId: "eng.1:bournemouth-brentford",
      home: "Bournemouth",
      away: "Brentford",
      kickoff: "2026-09-12T14:00:00Z",
    });
    expect(bundle.markets.map((row) => ({
      playerName: row.playerName,
      teamId: row.teamId,
      decimalOdds: row.decimalOdds,
    }))).toEqual([{
      playerName: "Wissa",
      teamId: "Brentford",
      decimalOdds: 2.1,
    }]);
  });

  it("does not carry a later player's price into an earlier local claim", () => {
    const bundle = extractPlayerEvidence([{
      id: "S1",
      title: "Bournemouth vs Brentford scorer odds",
      url: "https://example.com/scorers",
      date: "2026-09-11T08:00:00Z",
      snippet: "Anytime scorers: Semenyo for Bournemouth, Wissa 2.10 for Brentford.",
    }], {
      fixtureId: "eng.1:bournemouth-brentford",
      home: "Bournemouth",
      away: "Brentford",
      kickoff: "2026-09-12T14:00:00Z",
    });
    expect(bundle.markets.map((row) => row.playerName)).toEqual(["Wissa"]);
    expect(bundle.markets[0]?.decimalOdds).toBe(2.1);
  });

  it("strips Oddschecker See All Odds chrome and keeps the real anytime price", () => {
    const bundle = extractPlayerEvidence([{
      id: "S4",
      title: "Bournemouth vs Brentford Betting Odds",
      url: "https://www.oddschecker.com/football/english/premier-league/bournemouth-v-brentford/anytime-goalscorer",
      date: "",
      snippet: "Anytime Goalscorer. Igor Thiago See All Odds (1). 5/4 for Brentford. Evanilson See All Odds ... To Score 2 Or More Goals for Bournemouth.",
    }], {
      fixtureId: "eng.1:bournemouth-brentford",
      home: "Bournemouth",
      away: "Brentford",
      kickoff: "2026-09-12T14:00:00Z",
    });
    expect(hasTrustworthyPlayerEvidence(bundle)).toBe(true);
    expect(leadingScorerCandidate(bundle)?.playerName).toBe("Igor Thiago");
    expect(leadingScorerCandidate(bundle)?.decimalOdds).toBe(2.25);
    expect(bundle.markets.some((row) => /see/i.test(row.playerName))).toBe(false);
  });

  it("drops contradictory lineup status for the same player", () => {
    const bundle = extractPlayerEvidence([
      source({
        id: "S1",
        snippet: "Cole Palmer anytime 2.10, Cole Palmer expected to start for Chelsea.",
        title: "Chelsea lineup",
      }),
      source({
        id: "S2",
        title: "Chelsea injury news",
        snippet: "Cole Palmer ruled out for Chelsea.",
        date: "2026-09-11T12:00:00Z",
      }),
    ], fixture);
    expect(bundle.observations).toEqual([]);
    expect(bundle.markets).toEqual([]);
  });

  it("composes a labelled market observation in first-person analyst voice", () => {
    const evidence = extractPlayerEvidence([source()], fixture);
    const answer = composePlayerScorerAnswer({
      kind: "match",
      fixtureId: fixture.fixtureId,
      home: fixture.home,
      away: fixture.away,
      date: fixture.kickoff,
    } as never, evidence);
    expect(answer).toMatch(/Cole Palmer/);
    expect(answer).toMatch(/2\.10 decimal \[\[S1\]\]/);
    expect(answer).toMatch(/market price, not my probability/i);
    expect(answer).toMatch(/not my player ranking/i);
    expect(answer).not.toMatch(/a Pundit (?:probability|ranking)/i);
    expect(answer).not.toMatch(/I make Cole Palmer \d/);
    expect(answer).not.toMatch(/My short answer is/);
  });

  it("abstains when evidence is missing or unusable", () => {
    expect(composePlayerScorerAnswer({
      kind: "match",
      fixtureId: fixture.fixtureId,
      home: fixture.home,
      away: fixture.away,
      date: fixture.kickoff,
    } as never, extractPlayerEvidence([], fixture))).toBe(PLAYER_SCORER_ABSTENTION);
    expect(composeMatchResponse(
      "Who scores?",
      { kind: "match", fixtureId: fixture.fixtureId, home: fixture.home, away: fixture.away, date: fixture.kickoff } as never,
      planResponse("Who scores?", { groundingKind: "match", hasHistory: true })
    )).toBe(PLAYER_SCORER_ABSTENTION);
  });

  it("composes sourced availability and abstains when team news is empty", () => {
    const evidence = extractPlayerEvidence([{
      id: "S1",
      title: "Arsenal vs Chelsea team news",
      url: "https://example.com/news",
      date: "2026-09-11T08:00:00Z",
      snippet: "Cole Palmer ruled out for Chelsea.",
    }], fixture);
    expect(hasTeamNewsEvidence(evidence)).toBe(true);
    const answer = composeTeamNewsAnswer({
      kind: "match",
      fixtureId: fixture.fixtureId,
      home: fixture.home,
      away: fixture.away,
      date: fixture.kickoff,
    } as never, evidence);
    expect(answer).toMatch(/Cole Palmer/);
    expect(answer).toMatch(/unavailable/);
    expect(answer).toMatch(/not a revised match forecast/i);
    expect(composeTeamNewsAnswer({
      kind: "match",
      fixtureId: fixture.fixtureId,
      home: fixture.home,
      away: fixture.away,
      date: fixture.kickoff,
    } as never, extractPlayerEvidence([], fixture))).toBe(TEAM_NEWS_COMPOSE_ABSTENTION);
    expect(hasTeamNewsEvidence(extractPlayerEvidence([{
      id: "S1",
      title: "Arsenal vs Chelsea team news",
      url: "https://example.com/news",
      date: "",
      snippet: "Cole Palmer ruled out for Chelsea.",
    }], fixture))).toBe(false);
  });

  it("extracts availability from a dated page body even when chrome names come first", () => {
    const bournemouth = {
      fixtureId: "eng.1:bournemouth-brentford",
      home: "Bournemouth",
      away: "Brentford",
      kickoff: "2026-09-12T14:00:00Z",
    };
    const evidence = extractPlayerEvidence([{
      id: "S3",
      title: "Bournemouth vs Brentford team news",
      url: "https://example.com/news",
      date: "2026-09-11T08:00:00Z",
      snippet: "Match preview. Kick-off is 15:00. Manager quotes follow. Evanilson is ruled out for Bournemouth. Tickets remain on sale.",
    }], bournemouth);
    expect(hasTeamNewsEvidence(evidence)).toBe(true);
    expect(evidence.observations.some((row) => row.playerName === "Evanilson")).toBe(true);
    expect(evidence.observations.some((row) => row.playerName === "Match")).toBe(false);

    const unpunctuated = extractPlayerEvidence([{
      id: "S4",
      title: "Bournemouth vs Brentford team news",
      url: "https://example.com/news",
      date: "2026-09-11T08:00:00Z",
      snippet: "Match preview Kick-off is 15:00 Manager quotes follow Evanilson is ruled out for Bournemouth Tickets remain on sale",
    }], bournemouth);
    expect(hasTeamNewsEvidence(unpunctuated)).toBe(true);
    expect(unpunctuated.observations.some((row) => row.playerName === "Evanilson")).toBe(true);

    const mixed = extractPlayerEvidence([{
      id: "S5",
      title: "Bournemouth vs Brentford team news",
      url: "https://example.com/news",
      date: "2026-09-11T08:00:00Z",
      snippet: "Evanilson is ruled out for Bournemouth; Kluivert is expected to start for Bournemouth.",
    }], bournemouth);
    expect(mixed.observations.find((row) => row.playerName === "Evanilson")?.value).toBe("out");
    expect(mixed.observations.find((row) => row.playerName === "Kluivert")?.value).toBe("start");
  });

  it("rejects unrelated player cards and never assigns them from a page-wide fixture mention", () => {
    const evidence = extractPlayerEvidence([{
      id: "S6",
      title: "Leeds vs Newcastle prediction, team news, lineups",
      url: "https://example.com/leeds-newcastle",
      date: "2026-09-12T08:00:00Z",
      snippet: "Leeds vs Newcastle preview. Related: Arsenal expected to start Gyokeres and Dowman. Later coverage is available for Leeds.",
    }], {
      fixtureId: "eng.1:leeds-newcastle",
      home: "Leeds",
      away: "Newcastle",
      kickoff: "2026-09-14T14:00:00Z",
    });
    expect(evidence.observations).toEqual([]);
    expect(evidence.markets).toEqual([]);
    expect(hasTeamNewsEvidence(evidence)).toBe(false);
  });

  it("requires both fixture teams before accepting a player claim", () => {
    const evidence = extractPlayerEvidence([{
      id: "S7",
      title: "Chelsea team news",
      url: "https://example.com/chelsea",
      date: "2026-09-11T08:00:00Z",
      snippet: "Cole Palmer is ruled out for Chelsea.",
    }], fixture);
    expect(evidence.observations).toEqual([]);
    expect(evidence.markets).toEqual([]);
  });

  it("requires the two fixture teams to identify the same bounded fixture context", () => {
    const evidence = extractPlayerEvidence([{
      id: "S8",
      title: "Chelsea team news",
      url: "https://example.com/chelsea",
      date: "2026-09-11T08:00:00Z",
      snippet: `${"Unrelated coverage. ".repeat(12)}Arsenal results. Cole Palmer is ruled out for Chelsea.`,
    }], fixture);
    expect(evidence.observations).toEqual([]);
    expect(evidence.markets).toEqual([]);
  });

  it("does not treat a dash between unrelated page sections as a fixture", () => {
    const evidence = extractPlayerEvidence([{
      id: "S9",
      title: "Arsenal injuries — Chelsea transfer news",
      url: "https://example.com/news-roundup",
      date: "2026-09-11T08:00:00Z",
      snippet: "Cole Palmer is ruled out for Chelsea.",
    }], fixture);
    expect(evidence.observations).toEqual([]);
    expect(evidence.markets).toEqual([]);
  });

  it("does not treat a 1X2 winner page number next to a player as scorer odds", () => {
    const bundle = extractPlayerEvidence([{
      id: "S2",
      title: "Bournemouth vs Brentford Betting Odds | Oddschecker",
      url: "https://www.oddschecker.com/football/english/premier-league/bournemouth-v-brentford/winner",
      date: "",
      snippet: "Match Winner. Callum Wilson 35.46. Anytime Goalscorer. Igor Thiago 5/4.",
    }], {
      fixtureId: "eng.1:bournemouth-brentford",
      home: "Bournemouth",
      away: "Brentford",
      kickoff: "2026-09-12T14:00:00Z",
    });
    expect(bundle.markets.some((row) => row.playerName === "Callum Wilson")).toBe(false);
  });

  it("keeps a team-news claim once a fetched publication date is written back", () => {
    const undated: PlayerEvidenceSource = {
      id: "S1",
      title: "Arsenal vs Chelsea team news",
      url: "https://example.com/news",
      date: "",
      snippet: "Cole Palmer ruled out for Chelsea.",
    };
    expect(hasTeamNewsEvidence(extractPlayerEvidence([undated], fixture))).toBe(false);
    const dated = { ...undated, date: "2026-09-11T08:00:00Z" };
    const evidence = extractPlayerEvidence([dated], fixture);
    expect(hasTeamNewsEvidence(evidence)).toBe(true);
    expect(composeTeamNewsAnswer({
      kind: "match",
      fixtureId: fixture.fixtureId,
      home: fixture.home,
      away: fixture.away,
      date: fixture.kickoff,
    } as never, evidence)).toMatch(/Cole Palmer/);
  });

  it("does not treat Oddschecker Compare chrome as the leading scorer", () => {
    const bundle = extractPlayerEvidence([{
      id: "S1",
      title: "Arsenal vs Chelsea Betting Odds",
      url: "https://www.oddschecker.com/football/english/premier-league/arsenal-v-chelsea/anytime-goalscorer",
      date: "2026-09-11T08:00:00Z",
      snippet: "Anytime Goalscorer. Compare 43.49. Filter Share Sort. Cole Palmer anytime 2.10 for Chelsea.",
    }], fixture);
    expect(bundle.markets.some((row) => /compare/i.test(row.playerName))).toBe(false);
    expect(leadingScorerCandidate(bundle)?.playerName).toBe("Cole Palmer");
    expect(leadingScorerCandidate(extractPlayerEvidence([{
      id: "S1",
      title: "Arsenal vs Chelsea anytime scorers",
      url: "https://www.oddschecker.com/football",
      date: "2026-09-11T08:00:00Z",
      snippet: "Anytime Goalscorer. Compare 43.49.",
    }], fixture))).toBeNull();
  });
});
