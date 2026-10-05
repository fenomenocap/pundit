import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { expect, it } from "vitest";
import { ELO_CHAMPION, ELO_CHAMPION_CONFIG } from "./model-contributors";
import { candidateDigest } from "./prospective-model-seals";
import { buildClubStrengthArtifact } from "./club-strength-artifact";

it("captures the real public response shapes locally with missing-row coverage and immutable reruns", async () => {
  const root = path.resolve(__dirname, "../../../..");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-prospective-cli-"));
  const out = path.join(directory, "seals"), candidateFile = path.join(directory, "candidate.json");
  const now = Date.now(), kickoff = new Date(now + 60 * 60_000).toISOString();
  const raw = ELO_CHAMPION.forecast({ homeStrength: 1500.049, awayStrength: 1500.051, homeAdvantageElo: 42 });
  const uefa = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`Club ${i}`, 1500 + i]));
  const artifact = buildClubStrengthArtifact({ snapshotAt: new Date(now - 86_400_000).toISOString(),
    byProfile: { world: {}, "eng-clubs": { ...Object.fromEntries(Object.entries(uefa).slice(0, 20)), Arsenal: 1500.049, Leeds: 1500.051 },
      "uefa-clubs": { ...uefa, Arsenal: 1500.049, Leeds: 1500.051 } } });
  const ratings = path.join(directory, "ratings"); fs.mkdirSync(ratings);
  const artifactFile = path.join(ratings, `${artifact.payloadSha256}.json`);
  fs.writeFileSync(artifactFile, JSON.stringify(artifact));
  const publicProbabilities = Object.fromEntries(["pHome", "pDraw", "pAway", "pOver2_5", "pUnder2_5", "pBttsYes", "pBttsNo"].map((field) =>
    [field, Math.round(raw[field as keyof typeof raw] as number * 10000) / 10000]));
  const model = { fixtureId: 401879268, competitionId: "eng.1", utcDate: kickoff, home: "Arsenal", away: "Leeds",
    homeElo: 1500, awayElo: 1500.1, ...publicProbabilities, forecastProvenance: { modelId: "pundit-fundamental", modelVersion: "2",
      contributorId: ELO_CHAMPION.id, contributorVersion: ELO_CHAMPION.version, methodId: ELO_CHAMPION.methodId,
      ratingProfile: "eng-clubs", ratingSourceState: "artifact", ratingArtifactId: artifact.artifactId, ratingArtifactSha256: artifact.payloadSha256,
      ratingSnapshotAt: new Date(now - 86_400_000).toISOString(), forecastAt: new Date(now).toISOString(),
      homeAdvantageElo: 42, config: ELO_CHAMPION_CONFIG } };
  const registered = { fixtureId: "espn:eng.1:401879268", primarySourceFixtureId: "401879268", primarySource: "espn",
    recognition: "authoritative", competition: { id: "eng.1" }, homeTeam: { name: "Arsenal" }, awayTeam: { name: "Leeds United" },
    kickoff, status: "scheduled", neutralVenue: false };
  const withheld = { ...registered, fixtureId: "espn:eng.1:401879269", primarySourceFixtureId: "401879269", neutralVenue: null };
  const sourceFiles = ["packages/api/src/services/dixon-coles-mle.ts", "packages/api/src/services/dixon-coles.ts",
    "packages/api/src/services/prospective-model-seals.ts", "packages/api/src/lib/team-names.ts",
    "packages/api/src/services/club-strength-artifact.ts",
    "packages/api/src/services/model-contributors.ts", "packages/api/scripts/capture-prospective-model.ts"];
  const candidate = { schemaVersion: 1, methodId: "globally-feasible-fitted-dixon-coles-v1",
    frozenAt: new Date(now - 3600_000).toISOString(), trainingThrough: new Date(now - 7 * 86_400_000).toISOString(),
    trainingResultAvailableAt: new Date(now - 2 * 3600_000).toISOString(),
    trainingDataSha256: "b".repeat(64), sourceHashes: Object.fromEntries(sourceFiles.map((file) =>
      [file, candidateDigest(fs.readFileSync(path.join(root, file), "utf8"))])), meanElo: 1800,
    fit: { converged: true, gradientNorm: 1e-7, stopReason: "gradient-converged" },
    params: { intercept: 0.2, homeAdvantage: 0.1, rho: -0.05, timeDecayXi: 0.0065, clubEloPriorStrength: 8,
      attack: { Arsenal: 0.3, Leeds: -0.1 }, defence: { Arsenal: -0.2, Leeds: 0.2 } } };
  fs.writeFileSync(candidateFile, JSON.stringify(candidate));
  const paths: string[] = [];
  const server = http.createServer((request, response) => {
    paths.push(request.url ?? "");
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/model/active?competition=eng.1") response.end(JSON.stringify({ fixtures: [model], error: null }));
    else if (request.url === "/api/fixtures/recognized") response.end(JSON.stringify({ fixtures: [{ fixture: registered }, { fixture: withheld }] }));
    else if (request.url === "/api/matches/recent?competition=eng.1") response.end(JSON.stringify({ matches: [], error: null }));
    else { response.statusCode = 404; response.end("{}"); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;
  const run = async (capture: boolean, destination = out, ratingDirectory = ratings) => new Promise<{ exit: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "packages/api/node_modules/tsx/dist/cli.mjs"),
      path.join(root, "packages/api/scripts/capture-prospective-model.ts"), "--candidate", candidateFile, "--out", destination, "--ratings-dir", ratingDirectory,
      "--api", `http://127.0.0.1:${port}`, ...(capture ? ["--capture"] : [])], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += String(data); });
    child.stderr.on("data", (data) => { stderr += String(data); });
    child.once("error", reject);
    child.once("close", (exit) => resolve({ exit, stdout, stderr }));
  });
  try {
    const dry = await run(false);
    expect(dry.stderr).toBe(""); expect(dry.exit).toBe(0);
    expect(JSON.parse(dry.stdout)).toMatchObject({ mode: "dry-run", checkpointCount: 2, failedCandidateCount: 1, newSeals: 0 });
    expect(fs.existsSync(out)).toBe(false);
    const captured = await run(true);
    expect(captured.stderr).toBe(""); expect(captured.exit).toBe(0);
    expect(JSON.parse(captured.stdout)).toMatchObject({ checkpointCount: 2, failedCandidateCount: 1, newSeals: 2 });
    const files = fs.readdirSync(out).sort();
    const original = files.map((file) => fs.readFileSync(path.join(out, file), "utf8"));
    expect(JSON.parse(original[1]).failure).toBe("unsupported-or-unknown-neutral-venue");
    expect(JSON.parse(original[0])).toMatchObject({ failure: null, inputs: { homeElo: 1500, awayElo: 1500.1,
      recoveredHomeElo: 1500.049, recoveredAwayElo: 1500.051, ratingArtifactId: artifact.artifactId } });
    const repeated = await run(true);
    expect(repeated.exit).toBe(0); expect(JSON.parse(repeated.stdout).newSeals).toBe(0);
    expect(files.map((file) => fs.readFileSync(path.join(out, file), "utf8"))).toEqual(original);
    expect(paths).toHaveLength(9);
    candidate.sourceHashes["packages/api/src/services/model-contributors.ts"] = "c".repeat(64);
    fs.writeFileSync(candidateFile, JSON.stringify(candidate));
    const drift = await run(true);
    expect(drift.exit).toBe(1); expect(drift.stderr).toContain("Frozen candidate source changed");
    expect(paths).toHaveLength(9); // Source drift fails before any network or write.
    candidate.sourceHashes["packages/api/src/services/model-contributors.ts"] = candidateDigest(
      fs.readFileSync(path.join(root, "packages/api/src/services/model-contributors.ts"), "utf8"));
    const restored = JSON.stringify(candidate);
    fs.writeFileSync(candidateFile, restored);
    const storedFile = path.join(out, files[0]);
    for (const fault of ["same-round-rating", "common-rating-offset", "embedded-payload", "missing-artifact"]) {
      const changedSeal = JSON.parse(original[0]);
      if (fault === "same-round-rating" || fault === "common-rating-offset") changedSeal.inputs.recoveredHomeElo += 1e-5;
      if (fault === "common-rating-offset") changedSeal.inputs.recoveredAwayElo += 1e-5;
      if (fault === "embedded-payload") changedSeal.ratingArtifact.payload.byProfile["eng-clubs"].Arsenal += 1e-5;
      if (fault === "missing-artifact") changedSeal.ratingArtifact = null;
      fs.writeFileSync(storedFile, JSON.stringify(changedSeal));
      const rejected = await run(false);
      expect(rejected.exit, fault).toBe(1);
      expect(rejected.stderr, fault).toContain("corrupt prospective seal");
      expect(fs.readFileSync(storedFile, "utf8")).toBe(JSON.stringify(changedSeal));
    }
    fs.writeFileSync(storedFile, original[0]);
    const oldHeader = path.join(out, `${candidateDigest(restored)}-eng.1-999.json`);
    fs.writeFileSync(oldHeader, JSON.stringify({ fixtureId: 999 }));
    const corruption = await run(false);
    expect(corruption.exit).toBe(1); expect(corruption.stderr).toContain("corrupt prospective seal");
    fs.unlinkSync(oldHeader);
    const empty = path.join(directory, "missing-ratings"); fs.mkdirSync(empty);
    const historical = await run(false, out, empty);
    expect(historical.exit).toBe(0); // Embedded verified inputs survive a retired local pin.
    expect(files.map((file) => fs.readFileSync(path.join(out, file), "utf8"))).toEqual(original);
    const missingOut = path.join(directory, "missing-seals");
    const missing = await run(true, missingOut, empty);
    expect(missing.exit).toBe(0); expect(JSON.parse(missing.stdout).failedCandidateCount).toBe(2);
    const missingSeal = fs.readdirSync(missingOut).find((file) => file.endsWith("-401879268.json"))!;
    const savedFailure = fs.readFileSync(path.join(missingOut, missingSeal), "utf8");
    expect(JSON.parse(savedFailure).failure).toBe("missing-rating-artifact");
    const repairedInput = await run(true, missingOut);
    expect(repairedInput.exit).toBe(0); expect(JSON.parse(repairedInput.stdout).newSeals).toBe(0);
    expect(fs.readFileSync(path.join(missingOut, missingSeal), "utf8")).toBe(savedFailure);
    const changed = structuredClone(artifact); changed.payload.byProfile["eng-clubs"].Arsenal += 1;
    fs.writeFileSync(artifactFile, JSON.stringify(changed));
    const tamperedOut = path.join(directory, "tampered-seals");
    const tampered = await run(true, tamperedOut);
    expect(tampered.exit).toBe(0); expect(JSON.parse(tampered.stdout).failedCandidateCount).toBe(2);
    const tamperedSeal = fs.readdirSync(tamperedOut).find((file) => file.endsWith("-401879268.json"))!;
    expect(JSON.parse(fs.readFileSync(path.join(tamperedOut, tamperedSeal), "utf8")).failure).toBe("invalid-rating-artifact");
    fs.writeFileSync(artifactFile, "{malformed");
    const malformedOut = path.join(directory, "malformed-seals");
    const malformed = await run(true, malformedOut);
    expect(malformed.exit).toBe(0); expect(JSON.parse(malformed.stdout).failedCandidateCount).toBe(2);
    const malformedSeal = fs.readdirSync(malformedOut).find((file) => file.endsWith("-401879268.json"))!;
    expect(JSON.parse(fs.readFileSync(path.join(malformedOut, malformedSeal), "utf8")).failure).toBe("invalid-rating-artifact");
    const renamed = path.join(out, `${candidateDigest(restored)}-eng.1-999.json`);
    fs.writeFileSync(renamed, original[0]);
    const wrongIdentity = await run(false);
    expect(wrongIdentity.exit).toBe(1); expect(wrongIdentity.stderr).toContain("identity differs");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}, 20_000);
