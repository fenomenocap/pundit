import { describe, expect, it } from "vitest";
import { buildPunditTakePlan } from "./take-plan";
import {
  applyV2ProseHygiene,
  isProtectedTakeSentence,
  sentenceMakesVenuePerformanceClaim,
} from "./take-v2-prose-hygiene";
import { spursCoventryGrounding } from "./test-fixtures/spurs-coventry-grounding";

describe("Take v2 flip / venue LLM hygiene", () => {
  const plan = buildPunditTakePlan(spursCoventryGrounding(), null);

  it("drops Ipswich v Forest venue-performance LLM sentence (sweep 9 prod slip)", () => {
    const slip =
      "But Forest\u2019s win probability edges ahead because Ipswich have conceded freely at home, and Forest have shown they can grind results on the road.";
    expect(sentenceMakesVenuePerformanceClaim(slip)).toBe(true);
    expect(applyV2ProseHygiene(slip, plan)).toBe("");
    expect(applyV2ProseHygiene(slip, plan)).not.toMatch(/win probability|at home|on the road/i);
  });

  it("keeps headline and flip while dropping venue-performance body", () => {
    const headline = `${plan.fixtureLabel} — Forest at 46%.`;
    const slip =
      "But Forest\u2019s win probability edges ahead because Ipswich have conceded freely at home, and Forest have shown they can grind results on the road.";
    const flip = "I'd shift if Ipswich tighten up at the back over their last 5 league games.";
    const raw = `${headline} ${slip} ${flip}`;
    expect(isProtectedTakeSentence(headline, plan)).toBe(true);
    expect(isProtectedTakeSentence(flip, plan)).toBe(true);
    const out = applyV2ProseHygiene(raw, plan);
    expect(out).toContain(headline);
    expect(out).toContain(flip);
    expect(out).not.toMatch(/conceded freely at home|grind results on the road|win probability/i);
  });

  it("does not drop neutral home advantage phrasing", () => {
    const line = "Chelsea get a small home advantage in the rating, but the gap stays tight.";
    expect(sentenceMakesVenuePerformanceClaim(line)).toBe(false);
    expect(applyV2ProseHygiene(line, plan)).toMatch(/home advantage/i);
  });

  it("rewrites win probability when the sentence is otherwise kept", () => {
    const line = "Forest's win probability edges ahead on the table and recent goals.";
    expect(sentenceMakesVenuePerformanceClaim(line)).toBe(false);
    expect(applyV2ProseHygiene(line, plan)).toMatch(/win chance/i);
    expect(applyV2ProseHygiene(line, plan)).not.toMatch(/win probability/i);
  });
});
