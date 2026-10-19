import { describe, expect, it } from "vitest";
import type { AskGrounding, EvidenceBundle } from "./ask";
import { dropStructurallyIncompleteTail } from "./ask";
import {
  AGENT_DELIVERY_LAST_RESORT,
  agentDeliveryStructurallyComplete,
  capAgentAnswerForHistory,
  completeAgentAnswerEnding,
  repairAgentDeliveredProse,
} from "./chat-agent-package";
import { composeAgentEvidenceFallback } from "./chat-agent-fallback";
import type { ChatAgentCapHit } from "./chat-agent-limits";

const matchGrounding = {
  kind: "match",
  fixtureId: "401",
  competitionId: "eng.1",
  competition: "Premier League",
  homeFieldAdvantage: true,
  date: "2026-10-18",
  stage: "Regular Season",
  home: "Everton",
  away: "Chelsea",
  pHome: 0.22,
  pDraw: 0.24,
  pAway: 0.54,
  pOver2_5: 0.52,
  pUnder2_5: 0.48,
  pBttsYes: 0.55,
  pBttsNo: 0.45,
  topScores: [{ score: "1-1", probability: 0.11 }],
} as unknown as AskGrounding;

const bundle: EvidenceBundle = {
  queries: ["injuries"],
  providerCalls: 1,
  results: [{
    id: "S1",
    title: "Injury update",
    url: "https://www.bbc.co.uk/sport/football/injury",
    date: "2026-10-10",
    snippet: "Everton list two doubts ahead of the weekend.",
    tier: "official",
  }],
};

const recoverFromBundle = () => composeAgentEvidenceFallback("What does the model lean?", matchGrounding, bundle, false);

function repair(
  prose: string,
  capHit: ChatAgentCapHit = null,
  recover = recoverFromBundle,
  groundedFallback?: () => string,
): string {
  return repairAgentDeliveredProse(
    prose,
    { capHit, recover, groundedFallback },
    dropStructurallyIncompleteTail,
  ).text;
}

describe("agent cap delivery repair", () => {
  it.each<[ChatAgentCapHit, string]>([
    ["generation_budget", ""],
    ["tokens", ""],
    ["steps", ""],
    ["time", ""],
  ])("never returns empty after %s cap", (capHit, partial) => {
    const out = repair(partial, capHit);
    expect(out.trim().length).toBeGreaterThan(20);
    expect(agentDeliveryStructurallyComplete(out)).toBe(true);
    expect(out).not.toMatch(/what I already have on record/i);
  });

  it("trims a partial generation to the last complete sentence instead of fabricating a period", () => {
    const partial = "Lean Chelsea on the rating gap. Their press could swamp Everton's build-up in wide";
    const out = repair(partial, "generation_budget");
    expect(out).toBe("Lean Chelsea on the rating gap.");
    expect(agentDeliveryStructurallyComplete(out)).toBe(true);
  });

  it("drops a dangling model probability tail after token-cap truncation", () => {
    const partial = "My 1X2 is Everton 22.0%, draw 24.0% and Chelsea 54.0%. Lean Chelsea. Bournemouth at 63.";
    const out = repair(partial, "tokens");
    expect(out).not.toMatch(/Bournemouth at 63/);
    expect(agentDeliveryStructurallyComplete(out)).toBe(true);
  });

  it("uses evidence from the turn bundle when structural repair leaves nothing usable", () => {
    const out = repair("Chelsea carry the stronger band because their mid", "steps");
    expect(out).toMatch(/22\.0%|Everton|54\.0%|doubts ahead/);
    expect(out).not.toMatch(/\bbecause their mid\b/);
    expect(agentDeliveryStructurallyComplete(out)).toBe(true);
  });

  it("history cap keeps a structurally complete ending", () => {
    const sentence = "Complete sentence about the match shape and tempo.";
    const long = `${sentence} ${"Another full thought. ".repeat(500)}`;
    const capped = capAgentAnswerForHistory(long);
    expect(agentDeliveryStructurallyComplete(capped)).toBe(true);
    expect(capped.length).toBeLessThanOrEqual(4000);
  });
});

describe("completeAgentAnswerEnding", () => {
  it("does not append a fake period to a mid-sentence fragment", () => {
    expect(completeAgentAnswerEnding("They could overwhelm the press if")).toBe("");
    expect(repair("They could overwhelm the press if", "generation_budget")).not.toMatch(/press if\./);
  });
});

describe("repairAgentDeliveredProse empty_after_recovery marker", () => {
  it("prefers grounded fallback copy over the fixed last resort when grounding exists", () => {
    const grounded = "Everton 22.0%, draw 24.0%, Chelsea 54.0% on the model sheet.";
    const result = repairAgentDeliveredProse(
      "",
      {
        capHit: "generation_budget",
        recover: () => "",
        groundedFallback: () => grounded,
      },
      dropStructurallyIncompleteTail,
    );
    expect(result.text).toContain("22.0%");
    expect(result.emptyAfterRecovery).toBe(false);
  });

  it("sets emptyAfterRecovery when only the last-resort boilerplate remains", () => {
    const result = repairAgentDeliveredProse(
      "",
      {
        capHit: "tokens",
        recover: () => "",
        groundedFallback: () => "",
      },
      dropStructurallyIncompleteTail,
    );
    expect(result.text).toBe(AGENT_DELIVERY_LAST_RESORT);
    expect(result.emptyAfterRecovery).toBe(true);
  });
});
