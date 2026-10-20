import { describe, expect, it } from "vitest";
import { dedupePolicyProseBlocks } from "./take-v2-prose-hygiene";

describe("Take v2 stake refusal sentence dedupe", () => {
  it("drops won't vs will not near-duplicate refusal (prod b9dacf9 slip)", () => {
    const raw =
      "Chelsea v Spurs — I won't size a stake without a bankroll and a risk band. I can print the price. I will not size a stake without a bankroll and a risk band. Chelsea are 4th on 13 points; Spurs are 16th on 6.";
    const deduped = dedupePolicyProseBlocks(raw);
    expect(deduped).toContain("I can print the price");
    expect(deduped).toContain("Chelsea are 4th on 13 points");
    expect((deduped.match(/size a stake without a bankroll and a risk band/gi) ?? []).length).toBe(1);
    expect(deduped).not.toMatch(
      /will not size a stake without a bankroll and a risk band\.?\s*.*will not size a stake/i,
    );
  });
});
