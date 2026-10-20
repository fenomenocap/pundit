import { describe, expect, it } from "vitest";
import { stripUntraceableMatchPercentages } from "./response-correctness";

describe("stripUntraceableMatchPercentages rounding", () => {
  it("keeps a desk-rounded value that sits on a binary-float .x5 boundary", () => {
    // 0.0605 * 100 is 6.05; toFixed(1) gives "6.0" but the desk renders 6.1%.
    const line = "My 1X2 is Arsenal 76.3%, draw 17.7% and Everton 6.1%.";
    const out = stripUntraceableMatchPercentages(line, { probabilities: [0.7626, 0.1769, 0.0605] });
    expect(out).toBe(line);
  });

  it("still strips a percentage the server never produced", () => {
    const out = stripUntraceableMatchPercentages("Everton 9.9%.", { probabilities: [0.0605] });
    expect(out).toBe("");
  });
});
