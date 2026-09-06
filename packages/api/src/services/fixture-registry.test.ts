import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FootballMatch } from "./football-data";
import {
  evaluateFixtureCapability,
  fixtureRegistryExpansionEnabled,
  getFixtureRegistryStatus,
  getRecognizedFixtureSnapshot,
  getRecognizedFixtures,
  isModelPolicyEligible,
  loadBundledApprovedFixtures,
  loadFixtureRegistry,
  recognizeEspnFixture,
  refreshFixtureRegistryFromEspn,
  refreshFixtureRegistryShadowSafely,
  recognizedFixtureMatchesByTeams,
  replaceFixtureRegistryForTests,
  type FixtureCandidate,
  type RecognizedFixture,
} from "./fixture-registry";

const originalDataDir = process.env.PUNDIT_DATA_DIR;
const originalEnabled = process.env.FIXTURE_REGISTRY_ENABLED;

function footballFixture(overrides: Partial<FootballMatch> = {}): FootballMatch {
  return {
    id: 401,
    competitionId: "eng.1",
    competition: "Premier League",
    homeTeam: "Arsenal",
    awayTeam: "Liverpool",
    utcDate: "2026-08-22T14:00:00.000Z",
    status: "SCHEDULED",
    stage: "regular-season",
    matchday: 2,
    group: null,
    score: null,
    neutralVenue: false,
    ...overrides,
  };
}

function friendly(): RecognizedFixture {
  return {
    ...recognizeEspnFixture(footballFixture({
      id: 991,
      competitionId: "club.friendly",
      competition: "Club Friendly",
    })),
    competition: {
      id: "club.friendly",
      name: "Club Friendly",
      category: "club-friendly",
    },
    neutralVenue: true,
  };
}

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.PUNDIT_DATA_DIR;
  else process.env.PUNDIT_DATA_DIR = originalDataDir;
  if (originalEnabled === undefined) delete process.env.FIXTURE_REGISTRY_ENABLED;
  else process.env.FIXTURE_REGISTRY_ENABLED = originalEnabled;
  replaceFixtureRegistryForTests([]);
});

describe("fixture registry", () => {
  it("imports a real stable-ID friendly only with official corroboration", () => {
    const fixtures = loadBundledApprovedFixtures();
    expect(fixtures).toContainEqual(expect.objectContaining({
      fixtureId: "espn:club.friendly:401867142",
      primarySourceFixtureId: "401867142",
      homeTeam: { id: "arsenal", name: "Arsenal" },
      awayTeam: { id: "betis", name: "Real Betis" },
      venue: "Aviva Stadium",
      neutralVenue: true,
      recognition: "corroborated",
      competition: expect.objectContaining({ category: "club-friendly" }),
    }));
    const approved = fixtures.find((fixture) => fixture.fixtureId === "espn:club.friendly:401867142")!;
    expect(approved.observedSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "espn", authority: "authoritative" }),
      expect.objectContaining({ source: "official-club", authority: "corroborating" }),
    ]));
    expect(evaluateFixtureCapability(approved, {
      modelInitialized: true,
      ratingsAvailable: true,
    })).toEqual({ status: "outside-coverage", reason: "friendly-policy-disabled" });
  });

  it("keeps discovery candidates structurally separate from recognized fixtures", () => {
    const candidate: FixtureCandidate = {
      candidateId: "search:arsenal-liverpool",
      homeTeam: "Arsenal",
      awayTeam: "Liverpool",
      discoveredBy: "search",
    };
    expect(candidate.discoveredBy).toBe("search");
    expect("fixtureId" in candidate).toBe(false);
    expect(getRecognizedFixtures()).toEqual([]);
  });

  it("normalizes a stable authoritative ESPN identity without changing teams or kickoff", () => {
    const fixture = recognizeEspnFixture(footballFixture());
    expect(fixture).toMatchObject({
      fixtureId: "espn:eng.1:401",
      primarySource: "espn",
      primarySourceFixtureId: "401",
      homeTeam: { name: "Arsenal" },
      awayTeam: { name: "Liverpool" },
      kickoff: "2026-08-22T14:00:00.000Z",
      status: "scheduled",
      recognition: "authoritative",
      competition: { category: "domestic-league" },
    });
    expect(isModelPolicyEligible(fixture)).toBe(true);
  });

  it("defaults expansion to disabled shadow mode", () => {
    delete process.env.FIXTURE_REGISTRY_ENABLED;
    expect(fixtureRegistryExpansionEnabled()).toBe(false);
    expect(getFixtureRegistryStatus().mode).toBe("shadow");
  });

  it("distinguishes priced, temporary, outside-coverage and missing-input states", () => {
    const recognized = recognizeEspnFixture(footballFixture());
    const modelFixture = {
      competitionId: "eng.1",
      fixtureId: 401,
    } as Parameters<typeof evaluateFixtureCapability>[1]["modelFixture"];
    expect(evaluateFixtureCapability(recognized, {
      modelFixture,
      modelInitialized: true,
      ratingsAvailable: true,
    })).toEqual({ status: "priced", modelFixtureId: "eng.1:401" });
    expect(evaluateFixtureCapability(recognized, {
      modelInitialized: false,
      ratingsAvailable: false,
    })).toEqual({ status: "temporarily-unpriced", reason: "model-initializing" });
    expect(evaluateFixtureCapability(recognized, {
      modelInitialized: true,
      modelRefreshing: true,
      ratingsAvailable: true,
    })).toEqual({ status: "temporarily-unpriced", reason: "ratings-refreshing" });
    expect(evaluateFixtureCapability(recognized, {
      modelInitialized: true,
      ratingsAvailable: false,
    })).toEqual({ status: "insufficient-model-input", reason: "ratings-unavailable" });
    expect(evaluateFixtureCapability(friendly(), {
      modelInitialized: true,
      ratingsAvailable: true,
    })).toEqual({ status: "outside-coverage", reason: "friendly-policy-disabled" });
  });

  it("lets authoritative cancellation policy beat a stale cached model row", () => {
    const cancelled = recognizeEspnFixture(footballFixture({ status: "CANCELLED" }));
    expect(evaluateFixtureCapability(cancelled, {
      modelFixture: { competitionId: "eng.1", fixtureId: 401 } as never,
      modelInitialized: true,
      ratingsAvailable: true,
    })).toEqual({ status: "outside-coverage", reason: "model-policy-disabled" });
  });

  it("identifies unknown neutral venue as the specific missing model input", () => {
    const unknownVenue = recognizeEspnFixture(footballFixture({ neutralVenue: null }));
    expect(evaluateFixtureCapability(unknownVenue, {
      modelFixture: { competitionId: "eng.1", fixtureId: 401 } as never,
      modelInitialized: true,
      ratingsAvailable: true,
    })).toEqual({ status: "insufficient-model-input", reason: "neutral-venue-unknown" });
  });

  it("fails closed when the same teams have multiple current recognized fixtures", () => {
    const first = recognizeEspnFixture(footballFixture({ id: 401 }));
    const second = recognizeEspnFixture(footballFixture({
      id: 402,
      utcDate: "2026-09-02T14:00:00.000Z",
    }));
    expect(recognizedFixtureMatchesByTeams("Arsenal", "Liverpool", [first, second]))
      .toHaveLength(2);
  });

  it("exposes only recognized identities with deterministic capabilities", () => {
    replaceFixtureRegistryForTests([friendly()]);
    const snapshot = getRecognizedFixtureSnapshot({
      modelFixtures: [],
      modelInitialized: true,
      ratingsAvailable: true,
    });
    expect(snapshot.fixtures).toHaveLength(1);
    expect(snapshot.fixtures[0]).toMatchObject({
      fixture: { fixtureId: "espn:club.friendly:991", recognition: "authoritative" },
      capability: { status: "outside-coverage", reason: "friendly-policy-disabled" },
    });
    expect(JSON.stringify(snapshot)).not.toContain("candidate");
    expect(JSON.stringify(snapshot)).not.toContain("search");
  });

  it("classifies per-fixture missing ratings as insufficient input, not refreshing", () => {
    replaceFixtureRegistryForTests([recognizeEspnFixture(footballFixture())]);
    const snapshot = getRecognizedFixtureSnapshot({
      modelFixtures: [],
      modelInitialized: true,
      modelRefreshing: false,
      ratingsAvailable: true,
      missingRatingTeamIds: new Set(["arsenal"]),
    });
    expect(snapshot.fixtures[0].capability)
      .toEqual({ status: "insufficient-model-input", reason: "ratings-unavailable" });
  });

  it("isolates shadow persistence failures instead of throwing into core bootstrap", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-registry-failure-"));
    const notDirectory = path.join(dir, "file");
    fs.writeFileSync(notDirectory, "not a directory", "utf8");
    process.env.PUNDIT_DATA_DIR = notDirectory;
    expect(() => refreshFixtureRegistryShadowSafely()).not.toThrow();
    expect(getFixtureRegistryStatus().error).toBeTruthy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loads the last-good snapshot when the primary artifact is corrupt", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-registry-"));
    process.env.PUNDIT_DATA_DIR = dir;
    refreshFixtureRegistryFromEspn([footballFixture()], new Date("2026-08-13T01:00:00.000Z"));
    const primary = path.join(dir, "fixture-registry", "recognized-fixtures-v1.json");
    fs.writeFileSync(primary, "{ corrupt", "utf8");

    replaceFixtureRegistryForTests([]);
    loadFixtureRegistry();

    expect(getRecognizedFixtures()).toHaveLength(1);
    expect(getFixtureRegistryStatus().loadedFrom).toBe("last-good");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects structurally invalid recognized identities and falls back to last-good", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-registry-invalid-"));
    process.env.PUNDIT_DATA_DIR = dir;
    refreshFixtureRegistryFromEspn([footballFixture()], new Date("2026-08-13T01:00:00.000Z"));
    const primary = path.join(dir, "fixture-registry", "recognized-fixtures-v1.json");
    const invalid = JSON.parse(fs.readFileSync(primary, "utf8"));
    invalid.fixtures[0].status = "rumoured";
    invalid.fixtures[0].observedSources[0].source = "search";
    fs.writeFileSync(primary, JSON.stringify(invalid), "utf8");

    replaceFixtureRegistryForTests([]);
    loadFixtureRegistry();

    expect(getRecognizedFixtures()).toHaveLength(1);
    expect(getRecognizedFixtures()[0].status).toBe("scheduled");
    expect(getFixtureRegistryStatus().loadedFrom).toBe("last-good");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails closed without overwriting when both registry copies are invalid", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-registry-unrecoverable-"));
    const registryDir = path.join(dir, "fixture-registry");
    fs.mkdirSync(registryDir, { recursive: true });
    const primary = path.join(registryDir, "recognized-fixtures-v1.json");
    const lastGood = path.join(registryDir, "recognized-fixtures-v1.last-good.json");
    fs.writeFileSync(primary, "{ broken primary", "utf8");
    fs.writeFileSync(lastGood, "{ broken fallback", "utf8");
    process.env.PUNDIT_DATA_DIR = dir;

    expect(() => loadFixtureRegistry()).toThrow(/persistence is blocked/i);
    expect(refreshFixtureRegistryShadowSafely()).toBe(false);
    expect(getFixtureRegistryStatus()).toMatchObject({ storageBlocked: true });
    expect(fs.readFileSync(primary, "utf8")).toBe("{ broken primary");
    expect(fs.readFileSync(lastGood, "utf8")).toBe("{ broken fallback");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps bundled approved friendlies after the ESPN routing past horizon", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-registry-approved-horizon-"));
    process.env.PUNDIT_DATA_DIR = dir;
    replaceFixtureRegistryForTests(loadBundledApprovedFixtures());
    refreshFixtureRegistryFromEspn(
      [footballFixture({ utcDate: "2026-09-06T14:00:00.000Z" })],
      new Date("2026-09-06T16:00:00.000Z")
    );
    expect(getRecognizedFixtures().some((fixture) =>
      fixture.fixtureId === "espn:club.friendly:401867142"
    )).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("retains bounded material observation history for kickoff and status changes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-registry-history-"));
    process.env.PUNDIT_DATA_DIR = dir;
    refreshFixtureRegistryFromEspn([
      footballFixture({ venue: "Emirates Stadium", neutralVenue: false }),
    ], new Date("2026-08-13T01:00:00.000Z"));
    refreshFixtureRegistryFromEspn([
      footballFixture({
        utcDate: "2026-08-22T15:00:00.000Z",
        status: "POSTPONED",
        venue: "Emirates Stadium",
        neutralVenue: false,
      }),
    ], new Date("2026-08-13T02:00:00.000Z"));
    const recognized = getRecognizedFixtures()[0];
    expect(recognized.observationHistory).toHaveLength(2);
    expect(recognized.observationHistory.map(({ kickoff, status }) => ({ kickoff, status })))
      .toEqual([
        { kickoff: "2026-08-22T14:00:00.000Z", status: "scheduled" },
        { kickoff: "2026-08-22T15:00:00.000Z", status: "postponed" },
      ]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
