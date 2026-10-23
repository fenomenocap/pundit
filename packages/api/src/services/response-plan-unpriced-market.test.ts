import { describe, expect, it } from "vitest";
import { planResponse } from "./response-plan";

describe("unpriced market questions on a fresh match turn", () => {
  it.each([
    "Chelsea v Spurs first goal?",
    "Chelsea v Spurs, any good draw no bet?",
    "Chelsea v Spurs corners",
  ])("routes %s to the unpriced-market answer, not the pricing desk", (q) => {
    expect(planResponse(q, { groundingKind: "match" }).mode).toBe("match-follow-up");
  });

  it("keeps priced grid markets on their own modes", () => {
    expect(planResponse("Chelsea v Spurs BTTS", { groundingKind: "match" }).mode).toBe("btts");
  });
});
