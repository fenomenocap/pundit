import { describe, expect, it } from "vitest";
import type { DossierEvidenceItem, MatchDossier } from "../match-dossier/types";
import { buildMatchPricing } from "../response-correctness";
import { sampleMatchContextFields } from "../match-context";
import { sampleAgentFreshness } from "../../config/freshness-policy";
import type { Grounding } from "../ask";
import { build1x2SupportingPoints, buildContradictingPointsShared } from "./take-plan-helpers";
import { renderTakeProseDeterministic } from "./take-prose";
import { buildPunditTakePlan } from "./take-plan";
import { takeEligibleDossierEvidence } from "./take-dossier-evidence";

function evidenceItem(overrides: Partial<DossierEvidenceItem> & Pick<DossierEvidenceItem, "id" | "claim" | "direction">): DossierEvidenceItem {
  return {
    sourceUrl: "https://example.com/news",
    publisher: "example.com",
    publishedAt: "2026-10-18T08:00:00.000Z",
    retrievedAt: "2026-10-18T09:00:00.000Z",
    trustTier: "news",
    verification: "page-verified",
    relatedFactor: "injuries",
    category: "injuries",
    origin: "scheduled",
    fixtureMatchVerified: true,
    freshnessVerified: true,
    ...overrides,
  };
}

function minimalGrounding(): Grounding {
  const pHome = 0.599;
  const pDraw = 0.244;
  const pAway = 0.157;
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
      pricedAt: "2026-10-18T09:00:00.000Z",
      pHome,
      pDraw,
      pAway,
      markets: [],
    }),
    freshness: sampleAgentFreshness(),
    ...sampleMatchContextFields(),
  };
}

function dossierWithEvidence(items: DossierEvidenceItem[]): MatchDossier {
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
      home: { value: { position: null, points: null, goalDifference: null }, provenance: prov },
      away: { value: { position: null, points: null, goalDifference: null }, provenance: prov },
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
    evidence: items,
    dropped: [],
    featureCandidates: [],
  };
}

describe("takeEligibleDossierEvidence", () => {
  it("requires page-verified verification and explicit fixture/freshness gates", () => {
    const base = evidenceItem({ id: "ok", claim: "Verified claim.", direction: "supports-home" });
    expect(takeEligibleDossierEvidence(base)).toBe(true);
    expect(takeEligibleDossierEvidence({ ...base, verification: "cited" })).toBe(false);
    expect(takeEligibleDossierEvidence({ ...base, fixtureMatchVerified: undefined })).toBe(false);
    expect(takeEligibleDossierEvidence({ ...base, freshnessVerified: false })).toBe(false);
  });

  it("drops stale or wrong-fixture dossier claims from take plan prose", () => {
    const grounding = minimalGrounding();
    const staleWrong = evidenceItem({
      id: "stale-wrong",
      claim: "Stale wrong-fixture evidence must never appear in take prose.",
      direction: "supports-home",
      freshnessVerified: false,
      fixtureMatchVerified: false,
    });
    const citedOnly = evidenceItem({
      id: "cited-only",
      claim: "Cited-only capture must not reach prose either.",
      direction: "supports-home",
      verification: "cited",
      fixtureMatchVerified: true,
      freshnessVerified: true,
    });
    const good = evidenceItem({
      id: "good",
      claim: "Eligible verified supporting note for the home side.",
      direction: "supports-home",
    });
    const dossier = dossierWithEvidence([staleWrong, citedOnly, good]);

    const supporting = build1x2SupportingPoints(grounding, dossier, "home", "Spurs", "Coventry");
    expect(supporting.some((p) => p.text.includes("Stale wrong-fixture"))).toBe(false);
    expect(supporting.some((p) => p.text.includes("Cited-only capture"))).toBe(false);
    expect(supporting.some((p) => p.text.includes("Eligible verified supporting"))).toBe(true);

    const contradicting = buildContradictingPointsShared(
      grounding,
      dossierWithEvidence([
        evidenceItem({
          id: "bad-contradict",
          claim: "Wrong-fixture contradict claim.",
          direction: "contradicts-model",
          fixtureMatchVerified: false,
        }),
      ]),
      "home",
      "Spurs",
    );
    expect(contradicting.some((p) => p.text.includes("Wrong-fixture contradict"))).toBe(false);

    const plan = buildPunditTakePlan(grounding, dossier, { marketKind: "1x2" });
    const prose = renderTakeProseDeterministic(plan);
    expect(prose).not.toMatch(/Stale wrong-fixture|Cited-only capture|Wrong-fixture contradict/);
    expect(prose).toMatch(/Eligible verified supporting/);
  });
});
