import { describe, expect, it } from "vitest";
import type { Grounding } from "../ask";
import { buildMatchPricing } from "../response-correctness";
import { sampleMatchContextFields } from "../match-context";
import { sampleAgentFreshness } from "../../config/freshness-policy";
import { buildPunditTakePlan } from "./take-plan";
import { applyV2ProseHygiene, isProtectedTakeSentence } from "./take-v2-prose-hygiene";

function minimalGrounding(
  home: string,
  away: string,
  homeForm: Array<"W" | "D" | "L">,
  awayForm: Array<"W" | "D" | "L">,
): Grounding {
  const pHome = 0.4;
  const pDraw = 0.28;
  const pAway = 0.32;
  const observedAt = "2026-10-20T09:00:00.000Z";
  return {
    kind: "match",
    fixtureId: "espn:eng.1:test",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-10-20T15:00:00.000Z",
    stage: "Regular Season",
    home,
    away,
    pHome,
    pDraw,
    pAway,
    pOver2_5: 0.5,
    pUnder2_5: 0.5,
    pBttsYes: 0.5,
    pBttsNo: 0.5,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [],
    marketDivergence: [],
    pricing: buildMatchPricing({
      fixtureId: "eng.1:test",
      home,
      away,
      kickoff: "2026-10-20T15:00:00.000Z",
      modelVersion: "clubelo@1:test",
      pricedAt: observedAt,
      pHome,
      pDraw,
      pAway,
      markets: [],
    }),
    freshness: sampleAgentFreshness({ modelLastUpdated: observedAt }),
    ...sampleMatchContextFields({ homeForm, awayForm }),
  };
}

describe("Take v2 recent-form comparison hygiene", () => {
  it("drops Ipswich v Forest false form claim (prod flips slip)", () => {
    const grounding = minimalGrounding(
      "Ipswich",
      "Forest",
      ["L", "W", "L", "W", "L"],
      ["D", "W", "L", "L", "L"],
    );
    const plan = buildPunditTakePlan(grounding, null);
    expect(plan.numericFacts?.formLast5).toEqual({ homePoints: 6, awayPoints: 4 });
    const slip =
      "but Forest have the better recent form and I expect them to edge this.";
    expect(applyV2ProseHygiene(slip, plan)).toBe("");
  });

  it("keeps visitors form claim when Brentford lead Hull on last-five points", () => {
    const grounding = minimalGrounding(
      "Hull",
      "Brentford",
      ["W", "L", "L", "L", "L"],
      ["W", "W", "L", "L", "L"],
    );
    const plan = buildPunditTakePlan(grounding, null);
    expect(plan.numericFacts?.formLast5).toEqual({ homePoints: 3, awayPoints: 6 });
    const line = "the visitors have the stronger recent form";
    expect(applyV2ProseHygiene(line, plan)).toBe(line);
  });

  it("never drops headline or flip when form sentence is removed", () => {
    const grounding = minimalGrounding(
      "Ipswich",
      "Forest",
      ["L", "W", "L", "W", "L"],
      ["D", "W", "L", "L", "L"],
    );
    const plan = buildPunditTakePlan(grounding, null);
    const headline = `${plan.fixtureLabel} — Forest at 46%.`;
    const slip =
      "but Forest have the better recent form and I expect them to edge this.";
    const flip = "I'd shift if Ipswich tighten up at the back over their last 5 league games.";
    const raw = `${headline} ${slip} ${flip}`;
    expect(isProtectedTakeSentence(headline, plan)).toBe(true);
    expect(isProtectedTakeSentence(flip, plan)).toBe(true);
    const out = applyV2ProseHygiene(raw, plan);
    expect(out).toContain(headline);
    expect(out).toContain(flip);
    expect(out).not.toMatch(/better recent form/i);
  });
});
