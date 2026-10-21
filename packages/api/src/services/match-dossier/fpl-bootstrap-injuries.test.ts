import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { fixture } from "../__fixtures__/model-fixture";
import {
  buildFplInjuryEvidenceForFixture,
  getDossierFplStatus,
  loadFplBootstrap841Recorded,
  loadFplBootstrapFromRecordedFixture,
  prefetchFplBootstrapForBuildPass,
  resetFplBootstrapCacheForTests,
  setFplBootstrapCacheForTests,
} from "./fpl-bootstrap-injuries";
import { dossierCronStatus } from "./schedule";
import {
  isFplBootstrapInjuryItem,
  isTakeV2DossierEvidence,
  publicMatchDossierView,
} from "./types";
import { clubLabelForFplTeam } from "./fpl-bootstrap-injuries";
import { buildMatchDossierForFixture, buildMatchDossierForFixtureAsync } from "./builder";
import * as dossierEvidence from "./dossier-evidence";
import * as dossierEvidenceCapture from "./dossier-evidence-capture";

const ENV_KEYS = [
  "MATCH_DOSSIER_FPL_ENABLED",
  "MATCH_DOSSIER_EVIDENCE_ENABLED",
  "MATCH_DOSSIER_EVIDENCE_VERIFY",
] as const;

describe("FPL bootstrap-static injuries (interim)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    resetFplBootstrapCacheForTests();
    process.env.MATCH_DOSSIER_FPL_ENABLED = "true";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetFplBootstrapCacheForTests();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("emits structured FPL contract fields for fixture clubs", () => {
    const snapshot = loadFplBootstrap841Recorded();
    const row = fixture("Arsenal", "Everton", { utcDate: "2026-10-24T14:00:00.000Z" });
    const items = buildFplInjuryEvidenceForFixture(row, "2026-10-19T12:00:00.000Z", snapshot);
    expect(items.length).toBeGreaterThan(0);
    const saliba = items.find((i) => i.player === "Saliba")!;
    expect(isFplBootstrapInjuryItem(saliba)).toBe(true);
    expect(saliba).toMatchObject({
      source: "fpl-bootstrap-static",
      tier: "interim",
      internalOnly: true,
      player: "Saliba",
      club: "Arsenal",
      status: "i",
      chanceOfPlaying: 0,
      newsAddedAt: "2026-07-23T12:01:23.289376Z",
      newsText: "Back injury - Unknown return date",
    });
    expect(items.every((i) => !isTakeV2DossierEvidence(i))).toBe(true);
  });

  it("maps bootstrap team names to fixture home/away labels", () => {
    const snapshot = loadFplBootstrap841Recorded();
    const row = fixture("Arsenal", "Everton", { utcDate: "2026-10-24T14:00:00.000Z" });
    const arsenal = snapshot.teams.find((t) => t.name === "Arsenal")!;
    expect(clubLabelForFplTeam(row, arsenal)).toBe("Arsenal");
  });

  it("builds FPL injuries when evidence flags are off and FPL is on (no web search)", async () => {
    process.env.MATCH_DOSSIER_EVIDENCE_ENABLED = "false";
    process.env.MATCH_DOSSIER_EVIDENCE_VERIFY = "false";
    process.env.MATCH_DOSSIER_FPL_ENABLED = "true";
    const verifiedSpy = vi.spyOn(dossierEvidenceCapture, "collectVerifiedDossierEvidence");
    const replaySpy = vi.spyOn(dossierEvidence, "collectDossierEvidence");
    const snapshot = loadFplBootstrapFromRecordedFixture();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const row = fixture("Arsenal", "Everton", { utcDate: "2026-10-24T14:00:00.000Z" });
    await prefetchFplBootstrapForBuildPass(fetchFn as typeof fetch);
    const dossier = await buildMatchDossierForFixtureAsync(row, { now: asOfDate() });
    expect(verifiedSpy).not.toHaveBeenCalled();
    expect(replaySpy).not.toHaveBeenCalled();
    expect(dossier.injuries.value.items.some((i) => i.source === "fpl-bootstrap-static")).toBe(true);
    expect(dossier.evidence.some((i) => i.source === "fpl-bootstrap-static")).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await buildMatchDossierForFixtureAsync(row, { now: asOfDate() });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("produces no FPL items when MATCH_DOSSIER_FPL_ENABLED is false", () => {
    process.env.MATCH_DOSSIER_FPL_ENABLED = "false";
    setFplBootstrapCacheForTests(loadFplBootstrapFromRecordedFixture());
    const row = fixture("Arsenal", "Everton", { utcDate: "2026-10-24T14:00:00.000Z" });
    const dossier = buildMatchDossierForFixture(row, { now: asOfDate() });
    expect(dossier.injuries.value.items.some((i) => i.source === "fpl-bootstrap-static")).toBe(false);
    expect(dossier.evidence.some((i) => i.source === "fpl-bootstrap-static")).toBe(false);
  });

  it("surfaces failed fetch on dossier status fplStatus", async () => {
    const fetchFn = vi.fn(async () => new Response("blocked", { status: 503 }));
    await prefetchFplBootstrapForBuildPass(fetchFn as typeof fetch);
    expect(getDossierFplStatus()).toMatchObject({
      ok: false,
      status: 503,
      error: "http_503",
      fetchedAt: null,
    });
    process.env.MATCH_DOSSIER_ENABLED = "true";
    expect(dossierCronStatus().fplStatus).toMatchObject({
      ok: false,
      status: 503,
      error: "http_503",
    });
  });

  it("builds Coventry and Hull injury rows via FPL team id map", () => {
    const snapshot = loadFplBootstrapFromRecordedFixture();
    const coventryHull = fixture("Coventry", "Hull", { utcDate: "2026-10-24T15:00:00.000Z" });
    const items = buildFplInjuryEvidenceForFixture(coventryHull, "2026-10-19T12:00:00.000Z", snapshot);
    expect(items.some((i) => i.player === "Woolfenden" && i.club === "Coventry")).toBe(true);
    expect(items.some((i) => i.player === "Butland" && i.club === "Hull")).toBe(true);
  });

  it("failed fetch logs each attempt and fails closed with no injuries", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line) => {
      logs.push(String(line));
    });
    let calls = 0;
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      calls += 1;
      expect(init?.headers).toMatchObject({
        Accept: "application/json",
        "User-Agent": expect.stringContaining("Mozilla/5.0"),
      });
      expect(init?.signal).toBeTruthy();
      return new Response("blocked", { status: 403 });
    });
    const snapshot = await prefetchFplBootstrapForBuildPass(fetchFn as typeof fetch);
    expect(snapshot).toBeNull();
    expect(calls).toBe(2);
    const fplLogs = logs.filter((l) => l.includes("dossier_fpl_fetch")).map((l) => JSON.parse(l));
    expect(fplLogs).toHaveLength(2);
    expect(fplLogs.every((row) => row.status === 403 && row.players === null && row.error)).toBe(true);

    const row = fixture("Arsenal", "Everton", { utcDate: "2026-10-24T14:00:00.000Z" });
    const dossier = buildMatchDossierForFixture(row, { now: asOfDate() });
    expect(dossier.injuries.value.items.some((i) => i.source === "fpl-bootstrap-static")).toBe(false);
  });

  it("merges into dossier injuries when cache warm; public view strips internalOnly", () => {
    setFplBootstrapCacheForTests(loadFplBootstrap841Recorded());
    const row = fixture("Arsenal", "Everton", { utcDate: "2026-10-24T14:00:00.000Z" });
    const dossier = buildMatchDossierForFixture(row, { now: asOfDate() });
    expect(dossier.injuries.value.items.some((i) => i.source === "fpl-bootstrap-static")).toBe(true);
    const pub = publicMatchDossierView(dossier);
    expect(pub.injuries.value.items.some((i) => i.source === "fpl-bootstrap-static")).toBe(false);
  });
});

function asOfDate(): Date {
  return new Date("2026-10-19T12:00:00.000Z");
}
