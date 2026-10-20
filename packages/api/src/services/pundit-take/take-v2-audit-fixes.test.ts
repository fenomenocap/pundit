import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MARKET_STALE_MS } from "../external-market-consensus";
import { isLiveMarketObservedAt } from "./take-plan-live-markets";
import { formatTakeOddsTable } from "./take-table";
import type { DossierEvidenceItem, MatchDossier } from "../match-dossier/types";
import { attachUserLine, buildMatchPricing, inferUserLineFromQuestion } from "../response-correctness";
import { composeMatchResponse } from "../response-composer";
import { findNextPricedModelFixtureForClub, resolveAskContext } from "../ask";
import type { ModelFixture } from "../model-data";
import { planResponse } from "../response-plan";
import { composePunditTakeDelivery } from "./compose";
import { withPunditTakeRequestScope } from "./flags";
import { buildPunditTakePlan } from "./take-plan";
import { renderTakeProseDeterministic } from "./take-prose";
import { buildTakeSourcesFooter, formatTakeSourcesFooterBlock } from "./take-sources";
import { formatFplInjuryFact } from "./take-fpl-injuries";
import { spursCoventryGrounding } from "./test-fixtures/spurs-coventry-grounding";
import { chelseaTottenhamGrounding } from "./test-fixtures/chelsea-tottenham-grounding";

function fplRow(overrides: Partial<DossierEvidenceItem>): DossierEvidenceItem {
  return {
    id: "fpl-audit",
    claim: "Danso (Sunderland)",
    sourceUrl: "https://fantasy.premierleague.com/api/bootstrap-static/",
    publisher: "fantasy.premierleague.com",
    publishedAt: "2026-10-18T08:00:00.000Z",
    retrievedAt: "2026-10-18T09:00:00.000Z",
    trustTier: "interim",
    verification: "cited",
    direction: "neutral",
    relatedFactor: "injuries",
    category: "injuries",
    origin: "scheduled",
    source: "fpl-bootstrap-static",
    tier: "interim",
    internalOnly: true,
    player: "Danso",
    club: "Sunderland",
    status: "s",
    newsAddedAt: "2026-10-18T08:00:00.000Z",
    newsText: "Suspended for one match.",
    ...overrides,
  };
}

const AUDIT_NOW = new Date("2026-10-18T10:00:00.000Z");

describe("Take v2 prod audit fixes", () => {
  beforeEach(() => {
    vi.setSystemTime(AUDIT_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fair odds for Chelsea v Tottenham uses v2 fair-vs-best prose and table, not captured-line legacy", () => {
    const question = "Fair odds for Chelsea v Tottenham?";
    const grounding = chelseaTottenhamGrounding();
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
    const delivery = withPunditTakeRequestScope("v2", () =>
      composePunditTakeDelivery(question, grounding, plan)!);
    expect(delivery.answer).toMatch(/My fair prices:/);
    expect(delivery.answer).toMatch(/too short|value side|no value there/);
    expect(delivery.answer).toMatch(/\| Outcome \| Ours \|/);
    expect(delivery.answer).not.toMatch(/captured decimal line/i);
  });

  it("Chelsea at 1.70 pass or play returns maths and play/pass, not refusal", () => {
    const base = chelseaTottenhamGrounding();
    const grounding = {
      ...base,
      pricing: attachUserLine(base.pricing, { outcome: "home", decimalOdds: 1.7 }),
    };
    const question = "Chelsea at 1.70, play or pass?";
    expect(inferUserLineFromQuestion(question, grounding.home, grounding.away, { v2PlayPassResolver: true })).toEqual({
      outcome: "home",
      decimalOdds: 1.7,
    });
    const delivery = withPunditTakeRequestScope("v2", () => {
      const plan = planResponse(question, {
        groundingKind: "match",
        hasCompleteMarket1x2: true,
        hasUserLine: true,
        v2PlayPassResolver: true,
      });
      return composePunditTakeDelivery(question, grounding, plan)!;
    });
    expect(delivery.answer).toMatch(/implies/i);
    expect(delivery.answer).toMatch(/\b(I pass|I play)\b/i);
    expect(delivery.answer).not.toMatch(/won't size a stake|can't answer|I need a captured decimal/i);
  });

  it("Fulham at 2.10 pass or play resolves single-club fixture routing", () => {
    const fixtures: ModelFixture[] = [
      {
        competitionId: "eng.1",
        competition: "Premier League",
        fixtureId: 401879900,
        utcDate: "2026-10-25T15:00:00.000Z",
        date: "2026-10-25",
        group: null,
        stage: "Regular Season",
        home: "Fulham",
        away: "Everton",
        homeElo: 1700,
        awayElo: 1680,
        pHome: 0.45,
        pDraw: 0.28,
        pAway: 0.27,
        pOver2_5: 0.52,
        pUnder2_5: 0.48,
        pBttsYes: 0.5,
        pBttsNo: 0.5,
        topScores: [],
        scorelines: [],
        stakePHome: null,
        stakePDraw: null,
        stakePAway: null,
        result: null,
      },
    ];
    withPunditTakeRequestScope("v2", () => {
      const ctx = resolveAskContext(
        "Fulham at 2.10, play or pass?",
        [],
        undefined,
        fixtures,
        [],
        [],
        { now: Date.parse("2026-10-20T12:00:00.000Z") },
      );
      expect(ctx.tier).toBe("match");
      if (ctx.tier === "match") {
        expect([ctx.fixture.home, ctx.fixture.away]).toContain("Fulham");
      }
    });
    expect(findNextPricedModelFixtureForClub("Fulham", fixtures, Date.parse("2026-10-20T12:00:00.000Z"))?.home).toBe("Fulham");
  });

  it("totals headline picks higher side; coin flip when within 2 pts", () => {
    const grounding = {
      ...spursCoventryGrounding(),
      pOver2_5: 0.498,
      pUnder2_5: 0.502,
    };
    const plan = buildPunditTakePlan(grounding, null, { marketKind: "totals", now: AUDIT_NOW });
    expect(plan.gridCall?.headlineLabel).toBe("Under 2.5");
    expect(plan.gridCall?.coinFlip).toBe(true);
    expect(plan.gridCall?.modelPctDisplay).toBe("50.2%");
    const prose = renderTakeProseDeterministic(plan, "full", grounding);
    expect(prose).toMatch(/coin flip, lean Under 2\.5 at 50\.2%/);
    expect(prose).not.toMatch(/Over 2\.5 at 50%/);
  });

  it("does not keep toss-up language beside a 45% favourite", () => {
    const grounding = {
      ...spursCoventryGrounding(),
      pHome: 0.45,
      pDraw: 0.30,
      pAway: 0.25,
    };
    const dossier = minimalDossierWithContradict("essentially a toss-up given the table.");
    const plan = buildPunditTakePlan(grounding, dossier);
    const prose = renderTakeProseDeterministic(plan, "full", grounding);
    expect(prose).toMatch(/45%/);
    expect(prose).not.toMatch(/toss-up/i);
  });

  it("uses football-language combined goals, not per-team xG decimals", () => {
    const grounding = {
      ...spursCoventryGrounding(),
      goalCalibration: { methodId: "outcome-anchored-shrunk-goals-v2", artifactId: "test", artifactSha256: "abc" },
    };
    const plan = buildPunditTakePlan(grounding, null, { marketKind: "totals" });
    const prose = renderTakeProseDeterministic(plan, "full", grounding);
    expect(prose).toMatch(/I expect (about|close to|around)/i);
    expect(prose).not.toMatch(/score grid|1\.94|1\.00 xG/i);
  });

  it("fair odds take without dossier still closes with what flips it", () => {
    const question = "Fair odds for Chelsea v Tottenham?";
    const grounding = chelseaTottenhamGrounding();
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
    const delivery = withPunditTakeRequestScope("v2", () =>
      composePunditTakeDelivery(question, grounding, plan)!);
    expect(delivery.answer).toMatch(/I'd shift if/i);
  });

  it("odds table lists every live source, drops stale quotes, and footer matches live set", () => {
    const freshAt = "2026-10-18T09:30:00.000Z";
    const staleAt = new Date(AUDIT_NOW.getTime() - MARKET_STALE_MS - 60_000).toISOString();
    expect(isLiveMarketObservedAt(freshAt, AUDIT_NOW.getTime())).toBe(true);
    expect(isLiveMarketObservedAt(staleAt, AUDIT_NOW.getTime())).toBe(false);

    const base = chelseaTottenhamGrounding();
    const grounding = {
      ...base,
      pricing: {
        ...base.pricing,
        markets: base.pricing.markets.map((row) => (
          row.source === "polymarket"
            ? { ...row, observedAt: staleAt }
            : row
        )),
      },
    };
    const plan = buildPunditTakePlan(grounding, null, { now: AUDIT_NOW });
    expect(plan.marketColumns.map((c) => c.sourceKey)).toEqual(["kalshi"]);
    const table = formatTakeOddsTable(plan);
    expect(table).toMatch(/\| Kalshi \|/);
    expect(table).not.toMatch(/\| Poly \|/);
    expect(table).toMatch(/\| Best \|/);

    const footer = formatTakeSourcesFooterBlock(buildTakeSourcesFooter(grounding, null, AUDIT_NOW.getTime()));
    expect(footer).toMatch(/Kalshi as of/);
    expect(footer).not.toMatch(/Polymarket as of/);
  });

  it("ends with a grounded what flips it sentence", () => {
    const grounding = chelseaTottenhamGrounding();
    const dossier = minimalDossierWithLineupEvidence("Cole Palmer was named in Chelsea's travelling squad.");
    const plan = buildPunditTakePlan(grounding, dossier);
    const delivery = withPunditTakeRequestScope("v2", () =>
      composePunditTakeDelivery("Who wins Chelsea v Tottenham?", grounding, planResponse("Who wins Chelsea v Tottenham?", { groundingKind: "match", hasCompleteMarket1x2: true }), dossier)!);
    expect(delivery.answer).toMatch(/I'd shift if/i);
    expect(delivery.answer).not.toMatch(/travelling squad/i);
  });

  it("sources footer lists table, form, markets and model; FPL only when used", () => {
    const grounding = chelseaTottenhamGrounding();
    const withoutFpl = formatTakeSourcesFooterBlock(buildTakeSourcesFooter(grounding, null));
    expect(withoutFpl).toMatch(/Model /);
    expect(withoutFpl).toMatch(/ESPN standings/);
    expect(withoutFpl).toMatch(/Kalshi as of/);
    expect(withoutFpl).toMatch(/Polymarket as of/);
    expect(withoutFpl).not.toMatch(/FPL injury status/);

    const fact = formatFplInjuryFact(fplRow({}));
    expect(fact).toBe("Danso (Sunderland) is suspended.");
    expect(fact).not.toMatch(/Leeds|blunt/i);
  });

  it("legacy default path stays byte-identical without v2 header", () => {
    const question = "Fair odds for Chelsea v Tottenham?";
    const grounding = chelseaTottenhamGrounding();
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
    const prev = process.env.PUNDIT_TAKE_V2;
    delete process.env.PUNDIT_TAKE_V2;
    try {
      const legacy = composeMatchResponse(question, grounding, plan);
      const scoped = withPunditTakeRequestScope(null, () => composeMatchResponse(question, grounding, plan));
      expect(scoped).toBe(legacy);
      expect(legacy).toMatch(/captured decimal line/i);
    } finally {
      if (prev === undefined) delete process.env.PUNDIT_TAKE_V2;
      else process.env.PUNDIT_TAKE_V2 = prev;
    }
  });
});

function minimalDossierWithContradict(claim: string): MatchDossier {
  return minimalDossier([], claim);
}

function minimalDossierWithLineupEvidence(claim: string): MatchDossier {
  const item: DossierEvidenceItem = {
    id: "lineup-1",
    claim,
    sourceUrl: "https://example.com/lineups",
    publisher: "example.com",
    publishedAt: "2026-10-18T08:00:00.000Z",
    retrievedAt: "2026-10-18T09:00:00.000Z",
    trustTier: "news",
    verification: "page-verified",
    direction: "neutral",
    relatedFactor: "lineups",
    category: "rotation",
    origin: "scheduled",
    fixtureMatchVerified: true,
    freshnessVerified: true,
  };
  const prov = { sourceId: "t", label: "t", trustTier: "interim-spine" as const, asOf: "2026-10-18T09:00:00.000Z" };
  const emptyForm = { results: [], played: 0, goalsFor: 0, goalsAgainst: 0 };
  return {
    ...minimalDossier([item], ""),
    lineups: { value: { items: [item] }, provenance: prov },
    form: {
      homeLast5: { value: emptyForm, provenance: prov },
      awayLast5: { value: emptyForm, provenance: prov },
      homeLast10: { value: emptyForm, provenance: prov },
      awayLast10: { value: emptyForm, provenance: prov },
    },
  };
}

function minimalDossier(evidence: DossierEvidenceItem[], contradictClaim: string): MatchDossier {
  const prov = { sourceId: "t", label: "t", trustTier: "interim-spine" as const, asOf: "2026-10-18T09:00:00.000Z" };
  const emptyForm = { results: [], played: 0, goalsFor: 0, goalsAgainst: 0 };
  const contradict: DossierEvidenceItem[] = contradictClaim
    ? [{
        id: "c1",
        claim: contradictClaim,
        sourceUrl: "https://example.com",
        publisher: "example.com",
        publishedAt: null,
        retrievedAt: "2026-10-18T09:00:00.000Z",
        trustTier: "news",
        verification: "page-verified",
        direction: "contradicts-model",
        relatedFactor: "injuries",
        category: "injuries",
        origin: "scheduled",
        fixtureMatchVerified: true,
        freshnessVerified: true,
      }]
    : [];
  return {
    schemaVersion: 2,
    fixture: {
      fixtureId: "eng.1:1",
      espnEventId: 1,
      competitionId: "eng.1",
      competition: "Premier League",
      kickoffUtc: "2026-10-18T15:00:00.000Z",
      home: "Tottenham",
      away: "Coventry",
    },
    builtAt: "2026-10-18T09:00:00.000Z",
    builderVersion: "test",
    scheduleReason: "manual",
    table: {
      home: { value: { position: 10, points: 10, goalDifference: 0 }, provenance: prov },
      away: { value: { position: 11, points: 9, goalDifference: 0 }, provenance: prov },
    },
    form: {
      homeLast5: { value: emptyForm, provenance: prov },
      awayLast5: { value: emptyForm, provenance: prov },
      homeLast10: { value: emptyForm, provenance: prov },
      awayLast10: { value: emptyForm, provenance: prov },
    },
    splits: {
      home: { value: { home: emptyForm, away: emptyForm }, provenance: prov },
      away: { value: { home: emptyForm, away: emptyForm }, provenance: prov },
    },
    rest: { value: { restDaysHome: null, restDaysAway: null, homeMatchesLast14Days: 0, awayMatchesLast14Days: 0 }, provenance: prov },
    headToHead: { value: { meetings: [], homeWins: 0, draws: 0, awayWins: 0 }, provenance: prov },
    rollingXg: { value: null, provenance: prov },
    injuries: { value: { items: [] }, provenance: prov },
    lineups: { value: { items: [] }, provenance: prov },
    manager: { value: { home: { name: null, tenureNote: null }, away: { name: null, tenureNote: null } }, provenance: prov },
    model: {
      value: {
        pHome: 0.45,
        pDraw: 0.3,
        pAway: 0.25,
        pOver2_5: 0.5,
        pBttsYes: 0.5,
        factorBreakdown: {} as MatchDossier["model"]["value"]["factorBreakdown"],
      },
      provenance: prov,
    },
    market: { value: { rows: [] }, provenance: prov },
    evidence: [...evidence, ...contradict],
    dropped: [],
    featureCandidates: [],
  };
}
