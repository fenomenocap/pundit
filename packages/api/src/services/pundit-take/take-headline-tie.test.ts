import { describe, expect, it } from "vitest";
import { chelseaTottenhamGrounding } from "./test-fixtures/chelsea-tottenham-grounding";
import { buildPunditTakePlan } from "./take-plan";
import { format1x2V2Headline, pickHigherGridSide } from "./take-headline";
import { renderTakeProseDeterministic } from "./take-prose";
import { planResponse } from "../response-plan";
import { composePunditTakeDelivery } from "./compose";
import { withPunditTakeRequestScope } from "./flags";

describe("1x2 level headlines", () => {
  it("Pal–New real tied pct does not name a side", () => {
    const grounding = {
      ...chelseaTottenhamGrounding(),
      home: "Crystal Palace",
      away: "Newcastle",
      pHome: 0.3587,
      pDraw: 0.28,
      pAway: 0.3587,
    };
    const headline = format1x2V2Headline("Crystal Palace v Newcastle", grounding, "full");
    expect(headline).toMatch(/level at 36% each/i);
    expect(headline).toMatch(/no side/i);
    expect(headline).not.toMatch(/Crystal Palace at/i);
    const plan = buildPunditTakePlan(grounding, null);
    const prose = renderTakeProseDeterministic(plan, "full", grounding, { appendFlip: false });
    expect(prose).toMatch(/level at 36% each/i);
    expect(prose).not.toMatch(/Crystal Palace at 36%/i);
  });

  it("does not append I'd shift when the 1X2 is level", () => {
    const grounding = {
      ...chelseaTottenhamGrounding(),
      home: "Crystal Palace",
      away: "Newcastle",
      pHome: 0.3587,
      pDraw: 0.28,
      pAway: 0.3587,
    };
    const question = "Crystal Palace v Newcastle — who wins?";
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
    const delivery = withPunditTakeRequestScope("v2", () =>
      composePunditTakeDelivery(question, grounding, plan)!);
    expect(delivery.answer).toMatch(/no side/i);
    expect(delivery.answer).not.toMatch(/I'd shift if/i);
  });

  it("grid markets under 2 pt gap use level wording", () => {
    const lead = pickHigherGridSide([
      { sideKey: "over", label: "Over 2.5", p: 0.5 },
      { sideKey: "under", label: "Under 2.5", p: 0.49 },
    ]);
    expect(lead.coinFlip).toBe(true);
  });
});
