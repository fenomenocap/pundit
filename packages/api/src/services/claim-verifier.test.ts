import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { RetrievedEvidencePage } from "./evidence-page-retrieval";
import { verifyClaimsOnce } from "./claim-verifier";

const claims = [
  { id: "C1", text: "The manager was appointed on Monday." },
  { id: "C2", text: "The player is injured." },
];

const pages: RetrievedEvidencePage[] = [{
  id: "S1",
  url: "https://club.example/news",
  finalUrl: "https://club.example/news",
  title: "Club statement",
  date: "2026-08-10",
  authority: "official",
  retrievedAt: "2026-08-13T10:00:00Z",
  text: "The club appointed the manager on Monday.",
}];

function clientReturning(body: string) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: body, citations: [] }],
    stop_reason: "end_turn",
  });
  return { client: { messages: { create } } as unknown as Pick<Anthropic, "messages">, create };
}

describe("one-call claim verifier", () => {
  it("makes exactly one bounded call and validates server-owned IDs", async () => {
    const { client, create } = clientReturning(JSON.stringify({
      decisions: [
        { claimId: "C1", outcome: "supported", evidenceIds: ["S1", "S1"] },
        { claimId: "C2", outcome: "supported", evidenceIds: ["INVENTED"] },
      ],
      summary: "Checked.",
    }));
    const result = await verifyClaimsOnce(client, claims, pages);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ model: "MiniMax-M3", temperature: 0 });
    expect(create.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({
      status: "verified",
      decisions: [
        { claimId: "C1", outcome: "supported", evidenceIds: ["S1"] },
        { claimId: "C2", outcome: "unsupported", evidenceIds: [] },
      ],
      summary: "Checked.",
    });
  });

  it("preserves conflict outcomes rather than silently selecting a source", async () => {
    const { client } = clientReturning(JSON.stringify({
      decisions: [
        { claimId: "C1", outcome: "conflict", evidenceIds: ["S1"], explanation: "Dates differ." },
        { claimId: "C2", outcome: "unsupported", evidenceIds: [] },
      ],
      summary: "Sources conflict.",
    }));
    expect(await verifyClaimsOnce(client, claims, pages)).toMatchObject({ status: "conflict" });
  });

  it("fails closed when the verifier selects stale, undated, or future-dated evidence", async () => {
    const staleOrInvalid = [
      { ...pages[0], id: "S1", date: "2025-01-01" },
      { ...pages[0], id: "S2", date: "" },
      { ...pages[0], id: "S3", date: "2026-08-20" },
    ];
    const { client } = clientReturning(JSON.stringify({
      decisions: [
        { claimId: "C1", outcome: "supported", evidenceIds: ["S1", "S2", "S3"] },
        { claimId: "C2", outcome: "unsupported", evidenceIds: [] },
      ],
      summary: "Checked.",
    }));
    const result = await verifyClaimsOnce(client, claims, staleOrInvalid);
    expect(result.status).toBe("abstain");
    expect(result.decisions[0]).toEqual({
      claimId: "C1",
      outcome: "unsupported",
      evidenceIds: [],
    });
  });

  it("fails closed on invalid provider output or provider failure", async () => {
    const invalid = clientReturning("not json");
    const invalidResult = await verifyClaimsOnce(invalid.client, claims, pages);
    expect(invalidResult.status).toBe("unavailable");
    expect(invalidResult.decisions.every((decision) => decision.outcome === "unsupported")).toBe(true);

    const create = vi.fn().mockRejectedValue(new Error("provider down"));
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    expect(await verifyClaimsOnce(client, claims, pages)).toMatchObject({ status: "unavailable" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not call the provider when evidence is absent", async () => {
    const { client, create } = clientReturning("unused");
    expect(await verifyClaimsOnce(client, claims, [])).toMatchObject({ status: "abstain" });
    expect(create).not.toHaveBeenCalled();
  });

  it("propagates the shared request deadline abort", async () => {
    const controller = new AbortController();
    controller.abort(new Error("global deadline"));
    const { client, create } = clientReturning("unused");
    await expect(verifyClaimsOnce(client, claims, pages, controller.signal)).rejects.toThrow("global deadline");
    expect(create).not.toHaveBeenCalled();
  });
});
