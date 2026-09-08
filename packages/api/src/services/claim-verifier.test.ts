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
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await verifyClaimsOnce(client, claims, pages)).toMatchObject({ status: "unavailable" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("claim_verifier_unavailable"));
    warn.mockRestore();
  });

  it("on timeout keeps a cited claim that a dated page directly supports", async () => {
    const timeout = Object.assign(new Error("Request timed out"), { name: "TimeoutError" });
    const create = vi.fn().mockRejectedValue(timeout);
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dated: RetrievedEvidencePage = {
      ...pages[0],
      date: "2026-09-07",
      retrievedAt: "2026-09-08T12:00:00Z",
      text: "Bryan Mbeumo has 2 goals in 3 appearances and 180 minutes this season.",
    };
    const result = await verifyClaimsOnce(
      client,
      [{ id: "C1", text: "Mbeumo has 2 goals in 3 starts and 180 minutes [[S1]]." }],
      [dated]
    );
    expect(result.status).toBe("verified");
    expect(result.decisions[0]).toEqual({
      claimId: "C1",
      outcome: "supported",
      evidenceIds: ["S1"],
    });
    const invented = await verifyClaimsOnce(
      client,
      [{ id: "C1", text: "Mbeumo has 40 goals this season [[S1]]." }],
      [dated]
    );
    expect(invented.status).toBe("unavailable");
    expect(invented.decisions[0]?.outcome).toBe("unsupported");
    const undated = await verifyClaimsOnce(
      client,
      [{ id: "C1", text: "Mbeumo has 2 goals in 3 starts [[S1]]." }],
      [{ ...dated, date: "" }]
    );
    expect(undated.decisions[0]?.outcome).toBe("unsupported");
    const rebound = await verifyClaimsOnce(
      client,
      [{ id: "C1", text: "Mbeumo has 2 goals in 3 starts and 180 minutes [[S2]]." }],
      [
        dated,
        { ...dated, id: "S2", date: "", text: "Profile page with no season line." },
      ]
    );
    expect(rebound.status).toBe("verified");
    expect(rebound.decisions[0]).toEqual({
      claimId: "C1",
      outcome: "supported",
      evidenceIds: ["S1"],
    });
    warn.mockRestore();
  });

  it("keeps a dated overlapping claim when the model abstains", async () => {
    const dated: RetrievedEvidencePage = {
      ...pages[0],
      date: "2026-09-07",
      retrievedAt: "2026-09-08T12:00:00Z",
      text: "Bryan Mbeumo has 2 goals in 3 appearances and 180 minutes this season.",
    };
    const { client } = clientReturning(JSON.stringify({
      decisions: [{ claimId: "C1", outcome: "unsupported", evidenceIds: [] }],
      summary: "Not supported.",
    }));
    const result = await verifyClaimsOnce(
      client,
      [{ id: "C1", text: "Mbeumo has 2 goals in 3 starts and 180 minutes [[S1]]." }],
      [dated]
    );
    expect(result.status).toBe("verified");
    expect(result.decisions[0]).toEqual({
      claimId: "C1",
      outcome: "supported",
      evidenceIds: ["S1"],
    });
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

  it("keeps a cited unfetched snippet in the verifier slice when three other pages were fetched", async () => {
    const fetched = [1, 2, 3].map((n) => ({
      ...pages[0],
      id: `S${n}`,
      url: `https://club.example/${n}`,
      finalUrl: `https://club.example/${n}`,
      text: `Fetched page ${n} with no form claims.`,
    }));
    const snippet: RetrievedEvidencePage = {
      ...pages[0],
      id: "S4",
      url: "https://news.example/spurs",
      finalUrl: "https://news.example/spurs",
      date: "2026-09-06",
      retrievedAt: "2026-09-08T12:00:00Z",
      text: "Tottenham Hotspur going winless across their opening three league games.",
    };
    const { client, create } = clientReturning(JSON.stringify({
      decisions: [
        { claimId: "C1", outcome: "supported", evidenceIds: ["S4"] },
        { claimId: "C2", outcome: "unsupported", evidenceIds: [] },
      ],
      summary: "Checked.",
    }));
    const result = await verifyClaimsOnce(
      client,
      [{ id: "C1", text: "Tottenham are winless in three [[S4]]." }, claims[1]],
      [...fetched, snippet]
    );
    const payload = String(create.mock.calls[0][0].messages[0].content);
    expect(payload).toContain('"id":"S4"');
    expect(payload).toContain("winless across their opening three");
    expect(result.decisions[0]).toEqual({
      claimId: "C1",
      outcome: "supported",
      evidenceIds: ["S4"],
    });
  });
});
