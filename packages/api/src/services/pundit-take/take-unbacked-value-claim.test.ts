import { describe, expect, it } from "vitest";
import { chelseaTottenhamGrounding } from "./test-fixtures/chelsea-tottenham-grounding";
import { buildPunditTakePlan } from "./take-plan";
import { renderTakeProseDeterministic } from "./take-prose";
import { applyV2TakeProseGuards, sentenceMakesUnbackedValueClaim } from "./take-number-check";
import { postCheckTakeProse } from "./take-validate";
import { planResponse } from "../response-plan";
import { composePunditTakeDelivery } from "./compose";
import { withPunditTakeRequestScope } from "./flags";
import type { PunditTakePlan } from "./types";

/** Arsenal v Everton ou25 on prod 9b2e731 (sweep prod-9b2e731-20261022-2104): Over 50.42% / Under 49.58%, no totals market. */
function totalsGrounding() {
  return {
    ...chelseaTottenhamGrounding(),
    home: "Arsenal",
    away: "Everton",
    pOver2_5: 0.5042,
    pUnder2_5: 0.4958,
    pBttsYes: 0.48,
    pBttsNo: 0.52,
  };
}

/** Fixture market rows are observed 18 Oct 09:30Z; plan at 10:00Z so they count as live. */
const NOW = new Date("2026-10-18T10:00:00.000Z");

/** Non-level totals (56% / 44%, fair 1.79 / 2.27) for the end-to-end delivery check. */
function clearOverGrounding() {
  return { ...totalsGrounding(), pOver2_5: 0.56, pUnder2_5: 0.44 };
}

/** The exact LLM line from prod: our Over fair (1.98) "against" our Under fair (2.02). */
const INVENTED_TOTALS_VALUE = "The value is Over 2.5 at 1.98 against our fair 2.02.";

function withGridMarket(plan: PunditTakePlan, sideKey: string, decimal: string): PunditTakePlan {
  return {
    ...plan,
    gridRows: plan.gridRows.map((row) => row.sideKey === sideKey
      ? { ...row, sourceDecimals: { kalshi: decimal }, bestDecimal: decimal }
      : row),
  };
}

describe("value / edge lines need a real market price", () => {
  it("totals with no market price: the prod value line is dropped; headline % and fair price stay", () => {
    const grounding = totalsGrounding();
    const plan = buildPunditTakePlan(grounding, null, { marketKind: "totals", now: NOW });
    expect(plan.gridRows.every((row) => row.bestDecimal == null)).toBe(true);
    expect(sentenceMakesUnbackedValueClaim(INVENTED_TOTALS_VALUE, plan)).toBe(true);
    const llmLike = `Arsenal v Everton — Over 2.5 at 50%. I expect close to three goals in this one. ${INVENTED_TOTALS_VALUE} I'd shift if the first hour stays goalless.`;
    for (const out of [applyV2TakeProseGuards(llmLike, plan), postCheckTakeProse(llmLike, plan)]) {
      expect(out).toMatch(/^Arsenal v Everton — Over 2\.5 at 50%\./);
      expect(out).not.toMatch(/\bvalue\b|against our fair/i);
    }
    expect(plan.gridRows.find((r) => r.sideKey === "over")!.fairDecimal).toBe("1.98");
    expect(plan.gridRows.find((r) => r.sideKey === "under")!.fairDecimal).toBe("2.02");
  });

  it("BTTS with no market price: a value / edge line is dropped too", () => {
    const grounding = totalsGrounding();
    const plan = buildPunditTakePlan(grounding, null, { marketKind: "btts", now: NOW });
    const llmLike = "Arsenal v Everton — BTTS no at 52%. Both sides have been tight lately. The value is BTTS no at 1.92 against our fair 2.08. There's a small edge on BTTS no.";
    const out = postCheckTakeProse(llmLike, plan);
    expect(out).toMatch(/^Arsenal v Everton — BTTS no at 52%\./);
    expect(out).not.toMatch(/\bvalue\b|\bedge\b|against our fair/i);
  });

  it("1X2 market prices never back a totals/BTTS value claim", () => {
    const plan = buildPunditTakePlan(totalsGrounding(), null, { marketKind: "totals", now: NOW });
    const oneX2Price = plan.rows.find((r) => r.bestDecimal)?.bestDecimal;
    expect(oneX2Price).toBeTruthy();
    expect(sentenceMakesUnbackedValueClaim(`The value is Over 2.5 at ${oneX2Price} against our fair 1.98.`, plan)).toBe(true);
  });

  it("totals with a real market price: the value line quoting that price is kept", () => {
    const plan = withGridMarket(buildPunditTakePlan(totalsGrounding(), null, { marketKind: "totals", now: NOW }), "over", "2.10");
    const line = "The value is Over 2.5 at 2.10 against our fair 1.98.";
    expect(sentenceMakesUnbackedValueClaim(line, plan)).toBe(false);
    expect(applyV2TakeProseGuards(`Arsenal v Everton — Over 2.5 at 50%. ${line}`, plan)).toContain(line);
    // fair-v-fair is still invented even when some market exists
    expect(sentenceMakesUnbackedValueClaim(INVENTED_TOTALS_VALUE, plan)).toBe(true);
  });

  it("1X2 with a real market: the deterministic value line survives the guards", () => {
    const grounding = chelseaTottenhamGrounding();
    const plan = buildPunditTakePlan(grounding, null, { now: NOW });
    expect(plan.valueLeg?.bestMarketDecimal).toBeTruthy();
    const prose = renderTakeProseDeterministic(plan, "full", grounding);
    const valueLine = prose.split(/(?<=[.!?])\s+|\n+/).find((s) => /^(?:The value is|Separately,)/.test(s.trim()));
    expect(valueLine).toBeTruthy();
    expect(valueLine).toContain(`at ${plan.valueLeg!.bestMarketDecimal}`);
    expect(applyV2TakeProseGuards(prose, plan)).toContain(valueLine!.trim());
  });

  it("'to edge it' is a pick verb, not a price claim", () => {
    const plan = buildPunditTakePlan(totalsGrounding(), null, { marketKind: "totals", now: NOW });
    expect(sentenceMakesUnbackedValueClaim("Arsenal to edge it.", plan)).toBe(false);
  });

  it("default totals delivery with no market price has no value line and keeps Over/Under % and fair", () => {
    const grounding = clearOverGrounding();
    const question = "Over/under 2.5 in Arsenal v Everton?";
    const answer = withPunditTakeRequestScope(null, () => {
      const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
      return composePunditTakeDelivery(question, grounding, plan)!.answer;
    });
    expect(answer).toMatch(/^Arsenal v Everton — Over 2\.5 at 56(?:\.0)?%\./);
    expect(answer).toMatch(/\| Over 2\.5 \| 56% \/ 1\.79 \|/);
    expect(answer).toMatch(/\| Under 2\.5 \| 44% \/ 2\.27 \|/);
    expect(answer.split("\n\n|")[0]).not.toMatch(/\bvalue\b|against our fair/i);
  });
});
