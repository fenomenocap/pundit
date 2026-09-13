import { describe, expect, it } from "vitest";
import { BASE_GOALS, matrixTo1x2, matrixToBtts, matrixToTotals, scoreMatrix } from "./dixon-coles";
import { fixture } from "./__fixtures__/model-fixture";
import { buildGrounding } from "./ask";
import { ELO_CHAMPION, REGISTERED_CHALLENGERS } from "./model-contributors";
import { FITTED_DIXON_COLES_CONTRIBUTOR_ID } from "./dixon-coles-mle";
import {
  CONSENSUS_MARKET_WEIGHT,
  CONSENSUS_METHOD_ID,
  PUNDIT_CONSENSUS_LABEL,
  PUNDIT_FUNDAMENTAL_LABEL,
  buildPunditConsensus,
  firstCompleteNoVigMarket,
  isCompleteNoVig1x2,
  pricingConsensusFromBlock,
  refitLambdasToTarget1x2,
  shrinkOneXTwoTowardMarket,
} from "./pundit-consensus";
import { buildMatchPricing, hasValidProbabilityAttribution, probabilityAttributionLabel } from "./response-correctness";
import { composeMatchResponse } from "./response-composer";
import { buildResponseFacts } from "./response-facts";
import { planResponse } from "./response-plan";

const fundamental = { pHome: 0.436, pDraw: 0.277, pAway: 0.287 };
const kalshi = {
  source: "kalshi",
  observedAt: "2026-09-09T10:00:00.000Z",
  pHome: 0.501,
  pDraw: 0.296,
  pAway: 0.203,
};

describe("labelled Pundit Consensus", () => {
  it("is absent without a complete same-source no-vig 1X2", () => {
    expect(buildPunditConsensus({
      fundamental,
      market: { source: "kalshi", observedAt: kalshi.observedAt, pHome: 0.5, pDraw: null, pAway: 0.5 },
    })).toBeNull();
    expect(buildPunditConsensus({
      fundamental,
      market: { source: "kalshi", observedAt: "", pHome: 0.5, pDraw: 0.3, pAway: 0.2 },
    })).toBeNull();
    expect(buildPunditConsensus({
      fundamental,
      market: { source: "kalshi", observedAt: kalshi.observedAt, pHome: 0, pDraw: 0.5, pAway: 0.5 },
    })).toBeNull();
    expect(firstCompleteNoVigMarket([
      { source: "stake", observedAt: kalshi.observedAt, pHome: 0.6, pDraw: null, pAway: 0.4 },
      { source: "kalshi", observedAt: kalshi.observedAt, pHome: 0.5, pDraw: Number.NaN, pAway: 0.5 },
    ])).toBeNull();
    expect(isCompleteNoVig1x2({ pHome: 0.4, pDraw: 0.3, pAway: 0.3 })).toBe(true);
  });

  it("never overwrites Fundamental 1X2 and does not register as a challenger", () => {
    const priced = fixture("Hull City", "Manchester United", {
      pHome: fundamental.pHome,
      pDraw: fundamental.pDraw,
      pAway: fundamental.pAway,
      stakePHome: kalshi.pHome,
      stakePDraw: kalshi.pDraw,
      stakePAway: kalshi.pAway,
    });
    const grounding = buildGrounding(priced);
    expect(grounding.pHome).toBe(priced.pHome);
    expect(grounding.pDraw).toBe(priced.pDraw);
    expect(grounding.pAway).toBe(priced.pAway);
    expect(grounding.pricing.model.home.p).toBe(priced.pHome);
    expect(grounding.pricing.model.draw.p).toBe(priced.pDraw);
    expect(grounding.pricing.model.away.p).toBe(priced.pAway);
    expect(grounding.consensus).toBeDefined();
    expect(grounding.consensus?.pHome).not.toBe(grounding.pHome);
    expect(REGISTERED_CHALLENGERS).toHaveLength(1);
    expect(REGISTERED_CHALLENGERS[0]?.id).toBe(FITTED_DIXON_COLES_CONTRIBUTOR_ID);
    expect(REGISTERED_CHALLENGERS[0]?.status).toBe("challenger");
    expect(REGISTERED_CHALLENGERS[0]?.id).not.toBe(ELO_CHAMPION.id);
    expect(CONSENSUS_METHOD_ID).not.toBe("clubelo-elo-to-goals-dixon-coles");
  });

  it("omits Consensus from grounding when no complete market row exists", () => {
    const grounding = buildGrounding(fixture("Arsenal", "Coventry City"));
    expect(grounding.oddsSources).toEqual([]);
    expect(grounding.stakePHome).toBeNull();
    expect(grounding.consensus).toBeUndefined();
    expect(grounding.pricing.consensus).toBeUndefined();
    expect(grounding.pHome).toBe(0.4);
  });

  it("labels Fundamental, the named market, and Consensus as distinct sources", () => {
    const consensus = buildPunditConsensus({ fundamental, market: kalshi });
    expect(consensus).not.toBeNull();
    expect(consensus!.label).toBe(PUNDIT_CONSENSUS_LABEL);
    expect(consensus!.fundamentalLabel).toBe(PUNDIT_FUNDAMENTAL_LABEL);
    expect(consensus!.marketLabel).toBe("Kalshi market (no-vig)");
    expect(consensus!.marketSource).toBe("kalshi");
    expect(consensus!.observedAt).toBe(kalshi.observedAt);
    expect(consensus!.marketWeight).toBe(CONSENSUS_MARKET_WEIGHT);

    const fundamentalOrigin = { kind: "pundit-fundamental" as const };
    const consensusOrigin = {
      kind: "pundit-consensus" as const,
      marketSource: "Kalshi",
      observedAt: kalshi.observedAt,
    };
    const marketOrigin = {
      kind: "external-market" as const,
      source: "Kalshi",
      observedAt: kalshi.observedAt,
    };
    expect(probabilityAttributionLabel(fundamentalOrigin)).toBe(PUNDIT_FUNDAMENTAL_LABEL);
    expect(probabilityAttributionLabel(consensusOrigin)).toContain(PUNDIT_CONSENSUS_LABEL);
    expect(probabilityAttributionLabel(consensusOrigin)).toContain("Kalshi");
    expect(probabilityAttributionLabel(consensusOrigin)).not.toMatch(/sealed Pundit Fundamental/i);
    expect(probabilityAttributionLabel(marketOrigin)).toContain("not a Pundit");
    expect(hasValidProbabilityAttribution(probabilityAttributionLabel(fundamentalOrigin), fundamentalOrigin)).toBe(true);
    expect(hasValidProbabilityAttribution(probabilityAttributionLabel(consensusOrigin), consensusOrigin)).toBe(true);
    expect(hasValidProbabilityAttribution(PUNDIT_FUNDAMENTAL_LABEL, consensusOrigin)).toBe(false);
    expect(hasValidProbabilityAttribution("the model", consensusOrigin)).toBe(false);
  });

  it("refits Phase 0 lambdas so the grid 1X2 stays close to the shrink target", () => {
    const shrunk = shrinkOneXTwoTowardMarket(fundamental, kalshi);
    expect(shrunk).not.toBeNull();
    expect(shrunk!.pHome).toBeCloseTo((fundamental.pHome + kalshi.pHome) / 2, 8);
    const refit = refitLambdasToTarget1x2(shrunk!);
    expect(refit).not.toBeNull();
    expect(refit!.totalXg).toBeCloseTo(2 * BASE_GOALS, 12);
    const matrix = scoreMatrix(refit!.lambdaHome, refit!.lambdaAway);
    const [pHome, pDraw, pAway] = matrixTo1x2(matrix);
    expect(pHome).toBeCloseTo(refit!.pHome, 12);
    expect(pDraw).toBeCloseTo(refit!.pDraw, 12);
    expect(pAway).toBeCloseTo(refit!.pAway, 12);
    expect(matrixToTotals(matrix, 2.5)[0]).toBeCloseTo(refit!.pOver2_5, 12);
    expect(matrixToBtts(matrix)[0]).toBeCloseTo(refit!.pBttsYes, 12);
    expect(Math.abs(pHome - shrunk!.pHome) + Math.abs(pDraw - shrunk!.pDraw) + Math.abs(pAway - shrunk!.pAway))
      .toBeLessThan(0.04);

    const consensus = buildPunditConsensus({ fundamental, market: kalshi });
    expect(consensus!.shrunkTarget).toEqual(shrunk);
    expect(consensus!.lambdaHome + consensus!.lambdaAway).toBeCloseTo(2 * BASE_GOALS, 12);
    expect(Math.abs(consensus!.pHome - shrunk!.pHome)
      + Math.abs(consensus!.pDraw - shrunk!.pDraw)
      + Math.abs(consensus!.pAway - shrunk!.pAway)).toBeLessThan(0.04);
  });

  it("picks one complete source and never silently averages two markets", () => {
    const first = firstCompleteNoVigMarket([
      kalshi,
      { source: "polymarket", observedAt: kalshi.observedAt, pHome: 0.2, pDraw: 0.2, pAway: 0.6 },
    ]);
    expect(first?.source).toBe("kalshi");
    const consensus = buildPunditConsensus({
      fundamental,
      market: first!,
    });
    const towardSecond = buildPunditConsensus({
      fundamental,
      market: { source: "polymarket", observedAt: kalshi.observedAt, pHome: 0.2, pDraw: 0.2, pAway: 0.6 },
    });
    expect(consensus!.marketSource).toBe("kalshi");
    expect(towardSecond!.pAway).not.toBeCloseTo(consensus!.pAway, 3);
  });

  it("attaches a labelled pricing block without changing pricing.model", () => {
    const consensus = buildPunditConsensus({ fundamental, market: kalshi })!;
    const pricing = buildMatchPricing({
      fixtureId: "espn:eng.1:1",
      home: "Arsenal",
      away: "Coventry City",
      kickoff: "2026-09-09",
      pricedAt: kalshi.observedAt,
      pHome: fundamental.pHome,
      pDraw: fundamental.pDraw,
      pAway: fundamental.pAway,
      markets: [kalshi],
      consensus: pricingConsensusFromBlock(consensus),
    });
    expect(pricing.model.home.p).toBe(fundamental.pHome);
    expect(pricing.consensus?.label).toBe(PUNDIT_CONSENSUS_LABEL);
    expect(pricing.consensus?.marketLabel).toBe("Kalshi market (no-vig)");
    expect(pricing.consensus?.model.home.p).toBe(consensus.pHome);
    expect(pricing.consensus?.model.home.p).not.toBe(pricing.model.home.p);
  });

  it("exposes labelled Consensus facts that are not server-model Fundamental slots", () => {
    const grounding = buildGrounding(fixture("Arsenal", "Coventry City", {
      pHome: fundamental.pHome,
      pDraw: fundamental.pDraw,
      pAway: fundamental.pAway,
      stakePHome: kalshi.pHome,
      stakePDraw: kalshi.pDraw,
      stakePAway: kalshi.pAway,
    }));
    const facts = buildResponseFacts(grounding).facts;
    expect(facts.find((fact) => fact.id === "match.home")?.numeric?.value).toBe(fundamental.pHome);
    expect(facts.find((fact) => fact.id === "match.home")?.provenance).toBe("server-model");
    const consensusHome = facts.find((fact) => fact.id === "consensus.home");
    expect(consensusHome?.provenance).toBe("pundit-consensus");
    expect(consensusHome?.subject).toContain(PUNDIT_CONSENSUS_LABEL);
    expect(consensusHome?.numeric?.value).toBe(grounding.consensus?.pHome);
    expect(consensusHome?.prohibitedClaims).toContain("present-as-fundamental");
  });

  it("names Consensus in preview copy without replacing the Fundamental 1X2", () => {
    const grounding = buildGrounding(fixture("Arsenal", "Coventry City", {
      pHome: fundamental.pHome,
      pDraw: fundamental.pDraw,
      pAway: fundamental.pAway,
      stakePHome: kalshi.pHome,
      stakePDraw: kalshi.pDraw,
      stakePAway: kalshi.pAway,
    }));
    const question = "Give me your full preview of Arsenal vs Coventry City, including the 1X2, likely scorelines and any comparable market disagreement.";
    const preview = composeMatchResponse(
      question,
      grounding,
      planResponse(question, { groundingKind: "match" })
    );
    expect(preview).toContain(`${(fundamental.pHome * 100).toFixed(1)}%`);
    expect(preview).toContain(PUNDIT_CONSENSUS_LABEL);
    expect(preview).toContain(PUNDIT_FUNDAMENTAL_LABEL);
    expect(preview).toContain("Stake market (no-vig)");
    expect(preview).not.toMatch(/the model is \d/i);
  });
});
