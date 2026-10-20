import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DossierEvidenceItem, MatchDossier } from "../match-dossier/types";
import { buildMatchPricing } from "../response-correctness";
import { sampleMatchContextFields } from "../match-context";
import { sampleAgentFreshness } from "../../config/freshness-policy";
import type { Grounding } from "../ask";
import { composePunditTakeDelivery } from "./compose";
import { withConfiguredPunditTakeV2Scope, withPunditTakeRequestScope } from "./flags";
import { planResponse } from "../response-plan";
import { buildPunditTakePlan } from "./take-plan";
import { renderTakeProseDeterministic } from "./take-prose";
import { postCheckTakeProse } from "./take-validate";

function spursGrounding(): Grounding {
  const pHome = 0.599;
  const pDraw = 0.244;
  const pAway = 0.157;
  const observedAt = "2026-10-18T09:30:00.000Z";
  return {
    kind: "match",
    fixtureId: "eng.1:401879257",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-10-18T15:00:00.000Z",
    stage: "Regular Season",
    home: "Tottenham",
    away: "Coventry",
    pHome,
    pDraw,
    pAway,
    pOver2_5: 0.55,
    pUnder2_5: 0.45,
    pBttsYes: 0.52,
    pBttsNo: 0.48,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [],
    marketDivergence: [],
    pricing: buildMatchPricing({
      fixtureId: "eng.1:401879257",
      home: "Tottenham",
      away: "Coventry",
      kickoff: "2026-10-18T15:00:00.000Z",
      pricedAt: observedAt,
      pHome,
      pDraw,
      pAway,
      markets: [],
    }),
    freshness: sampleAgentFreshness(),
    ...sampleMatchContextFields(),
  };
}

function fplInjury(overrides: Partial<DossierEvidenceItem>): DossierEvidenceItem {
  return {
    id: "fpl-test-row",
    claim: "B. Saka (Arsenal)",
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
    player: "B. Saka",
    club: "Arsenal",
    status: "d",
    chanceOfPlaying: 50,
    newsAddedAt: "2026-10-18T08:00:00.000Z",
    newsText: "Knock - Saka missed training and is a major doubt for the weekend.",
    ...overrides,
  };
}

function dossierWithInjuries(items: DossierEvidenceItem[]): MatchDossier {
  const prov = {
    sourceId: "test",
    label: "test",
    trustTier: "interim-spine" as const,
    asOf: "2026-10-18T09:00:00.000Z",
  };
  const emptyForm = { results: [], played: 0, goalsFor: 0, goalsAgainst: 0 };
  return {
    schemaVersion: 2,
    fixture: {
      fixtureId: "eng.1:401879257",
      espnEventId: 401879257,
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
      home: { value: { position: 20, points: 3, goalDifference: -12 }, provenance: prov },
      away: { value: { position: 16, points: 6, goalDifference: -4 }, provenance: prov },
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
    injuries: { value: { items }, provenance: prov },
    lineups: { value: { items: [] }, provenance: prov },
    manager: { value: { home: { name: null, tenureNote: null }, away: { name: null, tenureNote: null } }, provenance: prov },
    model: {
      value: {
        pHome: 0.599,
        pDraw: 0.244,
        pAway: 0.157,
        pOver2_5: 0.55,
        pBttsYes: 0.52,
        factorBreakdown: {} as MatchDossier["model"]["value"]["factorBreakdown"],
      },
      provenance: prov,
    },
    market: { value: { rows: [] }, provenance: prov },
    evidence: [],
    dropped: [],
    featureCandidates: [],
  };
}

describe("FPL internal-only dossier injuries in take v2", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-18T12:00:00.000Z"));
  });
  afterEach(() => vi.restoreAllMocks());

  const question = "Who wins Tottenham v Coventry?";
  const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: false });

  it("renders deterministic facts and footer with x-pundit-take v2 header scope", () => {
    const grounding = spursGrounding();
    const dossier = dossierWithInjuries([
      fplInjury({ player: "B. Saka", club: "Tottenham", status: "d", chanceOfPlaying: 50 }),
    ]);
    const delivery = withPunditTakeRequestScope("v2", () =>
      composePunditTakeDelivery(question, grounding, plan, dossier)!);
    expect(delivery.answer).toMatch(/Saka is doubtful, 50% to play/);
    expect(delivery.answer).toMatch(/FPL injury status \(as of 18 Oct 16:00 SGT\)/);
    expect(delivery.answer).not.toMatch(/Knock - Saka|Hamstring - ruled out|missed training/i);
    expect(delivery.plan.contradicting.some((p) => p.fieldPath?.startsWith("injuries.fpl-bootstrap-static"))).toBe(true);
    const prose = postCheckTakeProse(renderTakeProseDeterministic(delivery.plan), delivery.plan);
    expect(prose).toMatch(/Saka is doubtful, 50% to play/);
  });

  it("omits FPL facts without header override and under env-default scope", () => {
    const grounding = spursGrounding();
    const dossier = dossierWithInjuries([
      fplInjury({ player: "B. Saka", club: "Tottenham", status: "d", chanceOfPlaying: 50 }),
    ]);
    const prev = process.env.PUNDIT_TAKE_V2;
    process.env.PUNDIT_TAKE_V2 = "true";
    try {
      const delivery = withConfiguredPunditTakeV2Scope(() =>
        composePunditTakeDelivery(question, grounding, plan, dossier)!);
      expect(delivery.answer).not.toMatch(/Saka is doubtful/);
      expect(delivery.answer).not.toMatch(/FPL injury status/);
      const planJson = buildPunditTakePlan(grounding, dossier, { marketKind: "1x2" });
      expect(planJson.contradicting.some((p) => p.id.startsWith("fpl-injury"))).toBe(false);
    } finally {
      process.env.PUNDIT_TAKE_V2 = prev;
    }
  });

  it("formats injured players as out without copying news text", () => {
    const grounding = spursGrounding();
    const dossier = dossierWithInjuries([
      fplInjury({ player: "P. Porro", club: "Tottenham", status: "i", newsText: "Hamstring - ruled out." }),
    ]);
    const delivery = withPunditTakeRequestScope("v2", () =>
      composePunditTakeDelivery(question, grounding, plan, dossier)!);
    expect(delivery.answer).toMatch(/Porro is out/);
    expect(delivery.answer).not.toMatch(/Hamstring|ruled out/i);
  });

  it("never renders FPL status u (unavailable — often loan or departed)", () => {
    const grounding = spursGrounding();
    const dossier = dossierWithInjuries([
      fplInjury({ player: "T. Chalobah", club: "Tottenham", status: "u", newsText: "On loan." }),
      fplInjury({ player: "B. Saka", club: "Tottenham", status: "d", chanceOfPlaying: 50 }),
    ]);
    const delivery = withPunditTakeRequestScope("v2", () =>
      composePunditTakeDelivery(question, grounding, plan, dossier)!);
    expect(delivery.answer).not.toMatch(/Chalobah|On loan/i);
    expect(delivery.answer).toMatch(/Saka is doubtful, 50% to play/);
  });

  it("drops wrong-club and stale FPL rows", () => {
    const grounding = spursGrounding();
    const dossier = dossierWithInjuries([
      fplInjury({ player: "B. Saka", club: "Arsenal", status: "d", chanceOfPlaying: 50 }),
      fplInjury({
        player: "P. Porro",
        club: "Tottenham",
        status: "u",
        newsAddedAt: "2026-09-01T08:00:00.000Z",
      }),
    ]);
    const delivery = withPunditTakeRequestScope("v2", () =>
      composePunditTakeDelivery(question, grounding, plan, dossier)!);
    expect(delivery.answer).not.toMatch(/Saka is doubtful/);
    expect(delivery.answer).not.toMatch(/Porro is out/);
    expect(delivery.sources.fplInjuryStatusAsOfSgt).toBeNull();
  });
});
