import { describe, expect, it } from "vitest";
import type { EvidenceBundle } from "./ask";
import {
  partitionClaimsForAgentTrust,
  trustedDecisionForBodyFetchedClaim,
} from "./agent-fetched-claim-trust";
import type { RetrievedEvidencePage } from "./evidence-page-retrieval";
import type { VerifiableClaim } from "./response-correctness";

const bundle: EvidenceBundle = { queries: ["q"], results: [{
  id: "S1",
  title: "Club site",
  url: "https://www.arsenal.com/news/injury-update",
  date: "2026-10-10",
  snippet: "snippet",
  tier: "official",
}], providerCalls: 1 };

function page(text: string): RetrievedEvidencePage {
  return {
    id: "S1",
    url: bundle.results[0].url,
    title: "Club site",
    date: "2026-10-10",
    authority: "official",
    finalUrl: bundle.results[0].url,
    text,
    retrievedAt: new Date().toISOString(),
  };
}

function claim(text: string, id = "c1"): VerifiableClaim {
  return { id, text };
}

describe("agent-fetched-claim-trust", () => {
  it("keeps a claim without LLM verify when cited body was fetched and supports the claim", () => {
    const body = "Arsenal confirm Bukayo Saka remains sidelined with hamstring issue on 10 October 2026.";
    const text = "Saka is out with hamstring (10 October 2026). [[S1]]";
    const fetched = new Set(["S1"]);
    const decision = trustedDecisionForBodyFetchedClaim(claim(text), fetched, [page(body)], bundle);
    expect(decision?.outcome).toBe("supported");
    const partitioned = partitionClaimsForAgentTrust([claim(text)], fetched, [page(body)], bundle);
    expect(partitioned.verify).toHaveLength(0);
    expect(partitioned.trusted).toHaveLength(1);
  });

  it("routes cited-but-not-fetched claims to normal verification", () => {
    const body = "Arsenal confirm Bukayo Saka remains sidelined.";
    const text = "Saka is out. [[S1]]";
    const fetched = new Set<string>();
    const decision = trustedDecisionForBodyFetchedClaim(claim(text), fetched, [page(body)], bundle);
    expect(decision).toBeNull();
    const partitioned = partitionClaimsForAgentTrust([claim(text)], fetched, [page(body)], bundle);
    expect(partitioned.trusted).toHaveLength(0);
    expect(partitioned.verify).toHaveLength(1);
  });

  it("routes fetched-but-unsupported text to normal verification", () => {
    const body = "Tottenham Hotspur publish unrelated transfer rumour only.";
    const text = "Saka is out with hamstring (10 October 2026). [[S1]]";
    const fetched = new Set(["S1"]);
    const decision = trustedDecisionForBodyFetchedClaim(claim(text), fetched, [page(body)], bundle);
    expect(decision).toBeNull();
    const partitioned = partitionClaimsForAgentTrust([claim(text)], fetched, [page(body)], bundle);
    expect(partitioned.verify).toHaveLength(1);
  });
});
