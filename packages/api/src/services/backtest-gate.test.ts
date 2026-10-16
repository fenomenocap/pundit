import { describe, expect, it } from "vitest";
import { edgeAllowedAtDivergence, loadBacktestGateArtifact } from "./backtest-gate";

describe("backtest-gate", () => {
  it("loads default when artifact missing fields", () => {
    const g = loadBacktestGateArtifact();
    expect(g.promotedModel).toBeDefined();
    expect(g.edgeValidationActive).toBe(false);
  });

  it("edgeAllowedAtDivergence is false when inactive", () => {
    expect(
      edgeAllowedAtDivergence(0.12, {
        schemaVersion: 1,
        edgeValidationActive: false,
        promotedModel: "champion_baseline",
        gates: [{ divergenceMin: 0.1, n: 100, status: "pass", edgeAllowed: true }],
        disclaimer: "",
      })
    ).toBe(false);
  });
});
