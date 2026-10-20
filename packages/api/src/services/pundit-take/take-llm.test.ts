import { describe, expect, it } from "vitest";
import type { PunditTakePlan } from "./types";
import { postCheckTakeProseWithReport } from "./take-validate";

const samplePlan: PunditTakePlan = {
  schemaVersion: 1,
  marketKind: "1x2",
  fixtureLabel: "Spurs v Coventry",
  call: { outcome: "home", sideLabel: "Spurs", headlineLabel: "Spurs" },
  gridCall: null,
  gridRows: [],
  supporting: [{
    id: "fact-table",
    role: "support",
    text: "Spurs are 20th on 3 points; Coventry are 16th on 6.",
    fieldPath: "table",
  }],
  contradicting: [{
    id: "fact-market",
    role: "contradict",
    text: "The market is more confident in Spurs than I am (63% v 60%).",
    fieldPath: "marketDivergence",
  }],
  flipCondition: null,
  valueLeg: {
    outcome: "draw",
    label: "Draw",
    modelPctInt: 24,
    fairDecimal: "4.10",
    bestMarketDecimal: "4.81",
    gapPoints: 3.6,
  },
  hasCompleteMarket: true,
  rows: [{
    outcome: "home",
    label: "Spurs",
    modelPctInt: 60,
    fairDecimal: "1.67",
    sourceDecimals: { kalshi: "1.60" },
    bestDecimal: "1.60",
  }],
  marketColumns: [{ sourceKey: "kalshi", shortLabel: "Kalshi", observedAt: "2026-10-18T09:30:00.000Z" }],
};

describe("take LLM post-check", () => {
  it("records drops when LLM adds an unmapped sentence or banned vendor name", () => {
    const llmDraft = [
      "Spurs v Coventry — Spurs at 60%.",
      "Spurs are 20th on 3 points; Coventry are 16th on 6, and the market is more confident in Spurs than I am (63% v 60%).",
      "Tottenham always win these ties at home.",
      "The value is Draw at 4.81 against our fair 4.10.",
    ].join(" ");

    const { prose, dropped } = postCheckTakeProseWithReport(llmDraft, samplePlan);
    expect(dropped.some((d) => d.startsWith("unmapped-sentence:"))).toBe(true);
    expect(prose).not.toMatch(/always win these ties/);
    expect(prose).toMatch(/value is Draw/);

    const withVendor = `${llmDraft} Kalshi loves the draw here.`;
    const vendorCheck = postCheckTakeProseWithReport(withVendor, samplePlan);
    expect(vendorCheck.dropped).toContain("banned-token");
  });
});
