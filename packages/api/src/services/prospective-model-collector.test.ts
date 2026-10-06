import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProspectiveCollector, mergeProspectiveResults, freshProspectiveRecentResults } from "./prospective-model-collector";
import { candidateDigest, type FrozenProspectiveCandidate } from "./prospective-model-seals";
import { ELO_CHAMPION, ELO_CHAMPION_CONFIG } from "./model-contributors";
import { buildClubStrengthArtifact } from "./club-strength-artifact";
import type { ModelFixture } from "./model-data";
import type { RecognizedFixture } from "./fixture-registry";
import type { FootballMatch } from "./football-data";
import { evaluateProspectiveEvidence, validateProspectiveResultTransitions } from "./prospective-model-evaluation";

const root = path.resolve(__dirname, "../../../..");
const directories: string[] = [];
afterEach(() => { for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true }); });

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-runtime-cohort-")); directories.push(directory);
  let now = new Date("2026-10-10T10:00:00.000Z");
  const sources = ["packages/api/src/services/dixon-coles-mle.ts", "packages/api/src/services/dixon-coles.ts",
    "packages/api/src/services/prospective-model-seals.ts", "packages/api/src/lib/team-names.ts",
    "packages/api/src/services/club-strength-artifact.ts", "packages/api/src/services/model-contributors.ts",
    "packages/api/scripts/capture-prospective-model.ts", "packages/api/src/services/prospective-model-collector.ts",
    "packages/api/src/services/prospective-model-evaluation.ts"];
  const candidate: FrozenProspectiveCandidate = { schemaVersion: 1, methodId: "globally-feasible-fitted-dixon-coles-v1",
    frozenAt: "2026-10-05T00:00:00.000Z", trainingThrough: "2026-05-24T00:00:00.000Z",
    trainingResultAvailableAt: "2026-10-04T00:00:00.000Z", trainingDataSha256: "a".repeat(64),
    sourceHashes: Object.fromEntries(sources.map((file) => [file, candidateDigest(fs.readFileSync(path.join(root, file), "utf8"))])),
    meanElo: 1800, fit: { converged: true, gradientNorm: 1e-7, stopReason: "gradient-converged" },
    params: { intercept: 0.2, homeAdvantage: 0.1, rho: -0.05, timeDecayXi: 0.0065, clubEloPriorStrength: 8,
      attack: { Arsenal: 0.3, Leeds: -0.1 }, defence: { Arsenal: -0.2, Leeds: 0.2 } } };
  const body = `${JSON.stringify(candidate, null, 2)}\n`, digest = candidateDigest(body);
  const candidateFile = path.join(directory, `${digest}.json`); fs.writeFileSync(candidateFile, body);
  const uefa = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`Club ${i}`, 1500 + i]));
  const artifact = buildClubStrengthArtifact({ snapshotAt: "2026-10-04T00:00:00.000Z",
    byProfile: { world: {}, "eng-clubs": { ...Object.fromEntries(Object.entries(uefa).slice(0, 20)), Arsenal: 2040, Leeds: 1817 },
      "uefa-clubs": { ...uefa, Arsenal: 2040, Leeds: 1817 } } });
  const kickoff = "2026-10-10T11:30:00.000Z";
  const model: ModelFixture = { competitionId: "eng.1", competition: "Premier League", fixtureId: 401879268,
    utcDate: kickoff, date: "2026-10-10", group: null, stage: "match", home: "Arsenal", away: "Leeds",
    homeElo: 2040, awayElo: 1817, ...ELO_CHAMPION.forecast({ homeStrength: 2040, awayStrength: 1817, homeAdvantageElo: 42 }),
    topScores: [], scorelines: [], stakePHome: null, stakePDraw: null, stakePAway: null, result: null,
    forecastProvenance: { modelId: "pundit-fundamental", modelVersion: "2", contributorId: "clubelo", contributorVersion: "1",
      methodId: "clubelo-elo-to-goals-dixon-coles", forecastAt: now.toISOString(), ratingProfile: "eng-clubs",
      ratingSnapshotAt: artifact.payload.snapshotAt, ratingAgeMinutes: 8640, ratingSourceState: "artifact",
      ratingArtifactId: artifact.artifactId, ratingArtifactSha256: artifact.payloadSha256,
      homeAdvantageElo: 42, config: ELO_CHAMPION_CONFIG } };
  const registered: RecognizedFixture = { fixtureId: "espn:eng.1:401879268", primarySource: "espn", primarySourceFixtureId: "401879268",
    homeTeam: { id: "arsenal", name: "Arsenal" }, awayTeam: { id: "leeds", name: "Leeds United" }, kickoff,
    venue: "Emirates", neutralVenue: false, competition: { id: "eng.1", name: "Premier League", category: "domestic-league" },
    status: "scheduled", recognition: "authoritative", observedSources: [], observationHistory: [] };
  let observation = { models: [model], registry: [registered], recent: [] as FootballMatch[],
    ratingArtifacts: new Map<string, unknown>([[artifact.payloadSha256, artifact]]) };
  const options = { candidateFile, repoRoot: root, directory: path.join(directory, "evidence"),
    observe: () => observation, now: () => now, releaseSha: "b".repeat(40) };
  const collector = createProspectiveCollector(options);
  return { collector, options, directory, candidate, candidateFile, digest, model, registered,
    get observation() { return observation; }, set observation(value) { observation = value; },
    setNow(value: string) { now = new Date(value); },
    cohort: path.join(options.directory, digest),
    result: { id: model.fixtureId, competitionId: "eng.1", utcDate: kickoff, homeTeam: "Arsenal", awayTeam: "Leeds",
      status: "FINISHED", score: { home: 2, away: 1 } } as FootballMatch };
}

describe("private runtime prospective collector", () => {
  it("does not let a successful UCL refresh make retained failed PL results fresh", () => {
    const test = setup(), now = new Date("2026-10-10T13:30:00Z");
    const state = { recent: [test.result], lastUpdated: now, error: null,
      competitionErrors: {} as Record<string, string>, byCompetition: { "eng.1": { error: null as string | null } } };
    expect(freshProspectiveRecentResults(state, now)).toEqual([test.result]);
    expect(freshProspectiveRecentResults({ ...state, competitionErrors: { "eng.1": "ESPN failed" } }, now)).toEqual([]);
    expect(freshProspectiveRecentResults({ ...state, byCompetition: { "eng.1": { error: "ESPN failed" } } }, now)).toEqual([]);
    expect(freshProspectiveRecentResults({ ...state, lastUpdated: new Date(now.getTime() - 3600_000) }, now)).toEqual([]);
    expect(freshProspectiveRecentResults({ ...state, lastUpdated: new Date(now.getTime() + 1) }, now)).toEqual([]);
  });
  it("recovers completed results from the complete season cache and rejects conflicting cache outcomes", () => {
    const test = setup();
    expect(mergeProspectiveResults([], [test.result])).toEqual([test.result]);
    expect(mergeProspectiveResults([test.result], [{ ...test.result, awayTeam: "Leeds United" }])).toHaveLength(1);
    for (const conflicting of [{ ...test.result, score: { home: 0, away: 2 } },
      { ...test.result, utcDate: "2026-10-11T11:30:00Z" }, { ...test.result, homeTeam: "Chelsea" }])
      expect(() => mergeProspectiveResults([test.result], [conflicting])).toThrow("Conflicting completed");
    expect(mergeProspectiveResults([{ ...test.result, status: "SCHEDULED" }], [test.result])).toHaveLength(1);
  });
  it("seals before kickoff, survives restart, captures results once and retains corrections without public mutations", () => {
    const test = setup(), original = JSON.stringify(test.observation);
    test.collector.tick();
    expect(test.collector.status()).toMatchObject({ active: true, observedFixtures: 1, sealedFixtures: 1,
      failedSeals: 0, resultObservations: 0, activatedAt: "2026-10-10T10:00:00.000Z", error: null,
      publicForecastsChanged: false, promotionApproved: false });
    expect(JSON.stringify(test.observation)).toBe(original);
    const file = path.join(test.cohort, "seals", fs.readdirSync(path.join(test.cohort, "seals"))[0]);
    const seal = fs.readFileSync(file, "utf8");
    test.setNow("2026-10-10T10:05:00.000Z");
    const restarted = createProspectiveCollector(test.options); restarted.tick();
    expect(restarted.status().activatedAt).toBe("2026-10-10T10:00:00.000Z");
    expect(fs.readFileSync(file, "utf8")).toBe(seal);
    test.setNow("2026-10-10T13:30:00.000Z");
    test.observation = { ...test.observation, models: [], registry: [], recent: [test.result] };
    restarted.tick();
    expect(restarted.status()).toMatchObject({ active: true, resultObservations: 1, sealedFixtures: 1 });
    test.setNow("2026-10-10T13:35:00.000Z"); restarted.tick();
    expect(restarted.status().resultObservations).toBe(1);
    test.observation.recent[0] = { ...test.result, score: { home: 2, away: 2 } }; restarted.tick();
    expect(restarted.status().resultObservations).toBe(2);
    expect(fs.readFileSync(file, "utf8")).toBe(seal);
  });

  it("records withheld rows and a missed checkpoint when the process never observed the 90-minute window", () => {
    const test = setup();
    test.setNow("2026-10-10T09:00:00.000Z"); test.collector.tick();
    expect(test.collector.status()).toMatchObject({ observedFixtures: 1, sealedFixtures: 0 });
    test.setNow("2026-10-10T13:30:00.000Z"); test.collector.tick();
    expect(test.collector.status()).toMatchObject({ active: true, missedCheckpoints: 1, sealedFixtures: 0,
      largestPollGapMs: 4.5 * 3600_000 });
    const missing = setup(); missing.observation.models = []; missing.collector.tick();
    expect(missing.collector.status()).toMatchObject({ sealedFixtures: 1, failedSeals: 1 });
    const seal = JSON.parse(fs.readFileSync(path.join(missing.cohort, "seals",
      fs.readdirSync(path.join(missing.cohort, "seals"))[0]), "utf8"));
    expect(seal.failure).toBe("public-model-unavailable");
  });

  it("never backfills completed fixtures, refuses future freezes, source drift and renamed manifests before evidence writes", () => {
    const test = setup(); test.setNow("2026-10-10T13:30:00.000Z");
    test.observation.recent = [test.result]; test.collector.tick();
    expect(test.collector.status()).toMatchObject({ sealedFixtures: 0, resultObservations: 0 });
    for (const fault of ["source", "future", "name"]) {
      const broken = setup(), candidate = structuredClone(broken.candidate);
      if (fault === "source") candidate.sourceHashes["packages/api/src/services/dixon-coles.ts"] = "f".repeat(64);
      if (fault === "future") candidate.frozenAt = "2026-10-11T00:00:00.000Z";
      const body = `${JSON.stringify(candidate, null, 2)}\n`;
      const file = path.join(broken.directory, `${fault === "name" ? "f".repeat(64) : candidateDigest(body)}.json`);
      fs.writeFileSync(file, body);
      const collector = createProspectiveCollector({ ...broken.options, candidateFile: file }); collector.tick();
      expect(collector.status().active, fault).toBe(false);
      expect(collector.status().error, fault).not.toBeNull();
      expect(fs.existsSync(broken.options.directory), fault).toBe(false);
    }
  });

  it("fails closed on corrupt stored seals, results, coverage or cohort and does not overwrite them", () => {
    for (const fault of ["seal", "result", "claim", "seen", "cohort"]) {
      const test = setup(); test.collector.tick();
      test.setNow("2026-10-10T13:30:00.000Z");
      test.observation = { ...test.observation, models: [], registry: [], recent: [test.result] };
      test.collector.tick();
      const section = fault === "seal" ? "seals" : fault === "result" ? "results" : fault === "claim" ? "result-claims" : "seen";
      const file = fault === "cohort" ? path.join(test.cohort, "cohort.json")
        : path.join(test.cohort, section, fs.readdirSync(path.join(test.cohort, section))[0]);
      fs.writeFileSync(file, "{}"); test.collector.tick();
      expect(test.collector.status().active, fault).toBe(false);
      expect(test.collector.status().error, fault).not.toBeNull();
      expect(fs.readFileSync(file, "utf8"), fault).toBe("{}");
    }
  });

  it("stops at the predeclared season boundary and refuses rescheduling under a previously sealed identity", () => {
    const test = setup(); test.collector.tick();
    test.registered.kickoff = "2026-10-10T11:35:00.000Z"; test.model.utcDate = test.registered.kickoff;
    test.collector.tick(); expect(test.collector.status().error).toContain("rescheduled");
    const expired = setup(); expired.setNow("2027-07-01T00:00:00.000Z"); expired.collector.tick();
    expect(expired.collector.status()).toMatchObject({ active: false, error: "Prospective cohort window ended" });
    expect(fs.existsSync(expired.options.directory)).toBe(false);
  });
  it("treats equivalent ISO kickoff formats as one identity without false missed coverage", () => {
    const test = setup(); test.model.utcDate = "2026-10-10T11:30Z";
    test.collector.tick();
    test.registered.kickoff = "2026-10-10T11:30:00Z"; test.collector.tick();
    test.setNow("2026-10-10T13:30:00.000Z"); test.observation.models = []; test.observation.registry = [];
    test.collector.tick();
    expect(test.collector.status()).toMatchObject({ active: true, observedFixtures: 1, sealedFixtures: 1,
      missedCheckpoints: 0, error: null });
  });
  it("scores collection end to end with seven losses, correction cutoff and an explicit insufficient-evidence gate", () => {
    const test = setup(); test.collector.tick();
    const read = (section: string) => {
      const directory = path.join(test.cohort, section);
      return fs.existsSync(directory) ? fs.readdirSync(directory).map((file) => fs.readFileSync(path.join(directory, file), "utf8")) : [];
    };
    const evaluate = (cutoff: string) => evaluateProspectiveEvidence({ candidate: test.candidate,
      candidateSha256: test.digest, cohort: JSON.parse(fs.readFileSync(path.join(test.cohort, "cohort.json"), "utf8")),
      seals: read("seals"), results: read("results"), observedFixtures: 1, missedCheckpoints: 0, asOf: new Date(cutoff) });
    expect(evaluate("2026-10-10T10:00:00Z")).toMatchObject({ status: "INSUFFICIENT_EVIDENCE",
      champion: { n: 0, brier: null }, uncertainty: { brier: null }, decision: { recommendPromotion: false } });
    test.setNow("2026-10-10T13:30:00.000Z"); test.observation.recent = [test.result]; test.collector.tick();
    const report = evaluate("2026-10-10T13:30:00Z"), seal = JSON.parse(read("seals")[0]);
    expect(report.coverage).toMatchObject({ pairedCompletedFixtures: 1, correctedFixtures: 0, utcWeeks: 1 });
    expect(report.champion.brier).toBeCloseTo((seal.champion.pHome - 1) ** 2 + seal.champion.pDraw ** 2 + seal.champion.pAway ** 2, 14);
    expect(report.champion.over25Brier).toBeCloseTo((seal.champion.pOver2_5 - 1) ** 2, 14);
    expect(report.champion.bttsBrier).toBeCloseTo((seal.champion.pBttsYes - 1) ** 2, 14);
    expect(report.champion.scoreLogLoss).toBeCloseTo(-Math.log(seal.championGrid[2][1]), 14);
    expect(Object.keys(report.uncertainty)).toHaveLength(7);
    test.setNow("2026-10-10T13:35:00.000Z"); test.observation.recent[0] = { ...test.result, score: { home: 2, away: 2 } }; test.collector.tick();
    expect(evaluate("2026-10-10T13:30:00Z").champion).toEqual(report.champion);
    const corrected = evaluate("2026-10-10T13:35:00Z");
    expect(corrected.coverage.correctedFixtures).toBe(1);
    expect(corrected.champion.logLoss).toBeCloseTo(-Math.log(seal.champion.pDraw), 14);
    expect(corrected.decision).toMatchObject({ minimumIndependentEvidence: false, recommendPromotion: false,
      activateProduction: false, changeShippedConstants: false });
    const later = structuredClone(test.model); later.fixtureId += 1; later.utcDate = "2026-10-11T11:30:00.000Z";
    later.forecastProvenance!.forecastAt = "2026-10-11T10:00:00.000Z";
    test.observation.models = [later]; test.observation.registry = [{ ...test.registered,
      fixtureId: `espn:eng.1:${later.fixtureId}`, primarySourceFixtureId: String(later.fixtureId), kickoff: later.utcDate }];
    test.setNow("2026-10-11T10:00:00.000Z"); test.collector.tick();
    expect(test.collector.status().sealedFixtures).toBe(2);
    const replay = evaluate("2026-10-10T13:30:00Z");
    expect(replay.coverage.sealedFixtures).toBe(1);
    expect(replay.champion).toEqual(report.champion);
  });
  it("rejects a valid candidate grid copied from a different parameter freeze", () => {
    const test = setup(); test.collector.tick();
    const directory = path.join(test.cohort, "seals"), file = path.join(directory, fs.readdirSync(directory)[0]);
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    stored.candidate = stored.champion; stored.candidateGrid = stored.championGrid;
    fs.writeFileSync(file, JSON.stringify(stored)); test.collector.tick();
    expect(test.collector.status()).toMatchObject({ active: false, error: "Seal forecast differs from frozen candidate parameters" });
  });
  it("retains A to B to A corrections, deduplicates stable polls and replays each cutoff", () => {
    const test = setup(); test.collector.tick();
    for (const [time, score] of [["13:30", { home: 2, away: 1 }], ["13:35", { home: 2, away: 2 }],
      ["13:40", { home: 2, away: 1 }]] as const) {
      test.setNow(`2026-10-10T${time}:00.000Z`);
      test.observation.recent = [{ ...test.result, score }]; test.collector.tick();
      expect(test.collector.status().error).toBeNull();
    }
    const read = (section: string) => fs.readdirSync(path.join(test.cohort, section))
      .map((file) => fs.readFileSync(path.join(test.cohort, section, file), "utf8"));
    const evaluate = (time: string) => evaluateProspectiveEvidence({ candidate: test.candidate,
      candidateSha256: test.digest, cohort: JSON.parse(fs.readFileSync(path.join(test.cohort, "cohort.json"), "utf8")),
      seals: read("seals"), results: read("results"), observedFixtures: 1, missedCheckpoints: 0,
      asOf: new Date(`2026-10-10T${time}:00.000Z`) });
    expect(read("results")).toHaveLength(3); expect(read("result-claims")).toHaveLength(3);
    const entries = (section: string) => fs.readdirSync(path.join(test.cohort, section))
      .map((file) => ({ file, body: fs.readFileSync(path.join(test.cohort, section, file), "utf8") }));
    expect(() => validateProspectiveResultTransitions(entries("result-claims"), entries("results"))).not.toThrow();
    expect(() => validateProspectiveResultTransitions([], entries("results"))).toThrow("Unclaimed");
    expect(evaluate("13:40").champion).toEqual(evaluate("13:30").champion);
    expect(evaluate("13:35").champion.logLoss).not.toBe(evaluate("13:40").champion.logLoss);
    test.setNow("2026-10-10T13:45:00.000Z");
    const restarted = createProspectiveCollector(test.options); restarted.tick();
    expect(restarted.status()).toMatchObject({ active: true, resultObservations: 3, error: null });
    // Simulate an interrupted publication: the durable claim restores its exact result.
    const resultDirectory = path.join(test.cohort, "results");
    const newest = fs.readdirSync(resultDirectory).find((file) => JSON.parse(fs.readFileSync(path.join(resultDirectory, file), "utf8")).observedAt.endsWith("13:40:00.000Z"))!;
    const bytes = fs.readFileSync(path.join(resultDirectory, newest), "utf8"); fs.unlinkSync(path.join(resultDirectory, newest));
    restarted.tick(); expect(fs.readFileSync(path.join(resultDirectory, newest), "utf8")).toBe(bytes);
    expect(restarted.status().resultObservations).toBe(3);
  });
  it("rejects a stored capture dated after the actual collector clock", () => {
    const test = setup(); test.collector.tick();
    const directory = path.join(test.cohort, "seals"), file = path.join(directory, fs.readdirSync(directory)[0]);
    const stored = JSON.parse(fs.readFileSync(file, "utf8")); stored.observedAt = "2026-10-10T10:05:00.000Z";
    fs.writeFileSync(file, JSON.stringify(stored)); test.collector.tick();
    expect(test.collector.status()).toMatchObject({ active: false, error: "Stored seal conflicts with prospective cohort" });
  });
});
