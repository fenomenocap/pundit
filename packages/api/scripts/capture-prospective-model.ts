import fs from "node:fs";
import path from "node:path";
import type { FootballMatch } from "../src/services/football-data";
import type { RecognizedFixture } from "../src/services/fixture-registry";
import type { ModelFixture } from "../src/services/model-data";
import {
  buildProspectiveBatch, buildProspectiveResult, candidateDigest, persistProspectiveResult,
  persistProspectiveSeal, validateProspectiveSeal, verifyCandidateSources, type FrozenProspectiveCandidate, type ProspectiveSeal,
} from "../src/services/prospective-model-seals";

/** Public GETs only. Dry-run by default; --capture writes private local research evidence. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = { candidate: "", out: "", api: "https://thepundit.up.railway.app", capture: false,
    "ratings-dir": path.resolve(__dirname, "../data/model-artifacts/clubelo") };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--capture") options.capture = true;
    else if (["--candidate", "--out", "--api", "--ratings-dir"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2) as "candidate" | "out" | "api" | "ratings-dir"] = value;
    } else throw new Error(`Unknown argument ${arg}`);
  }
  if (!options.candidate || !options.out) throw new Error("--candidate and --out are required");
  const origin = new URL(options.api);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/"
    || !(origin.protocol === "https:" || (origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)))) {
    throw new Error("Use an HTTPS API origin or localhost without credentials");
  }
  const body = fs.readFileSync(options.candidate, "utf8");
  const candidate = JSON.parse(body) as FrozenProspectiveCandidate;
  verifyCandidateSources(candidate, path.resolve(__dirname, "../../.."));
  const digest = candidateDigest(body);
  const get = async <T>(route: string): Promise<T> => {
    const response = await fetch(new URL(route, origin), { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`API ${route} returned ${response.status}`);
    return await response.json() as T;
  };
  const [model, registry, recent] = await Promise.all([
    get<{ fixtures: ModelFixture[]; error?: string | null }>("/api/model/active?competition=eng.1"),
    get<{ fixtures: Array<{ fixture: RecognizedFixture }> }>("/api/fixtures/recognized"),
    get<{ matches: FootballMatch[]; error?: string | null }>("/api/matches/recent?competition=eng.1"),
  ]);
  if (model.error || recent.error || !Array.isArray(model.fixtures) || !Array.isArray(registry.fixtures)
    || !Array.isArray(recent.matches)) throw new Error("Incomplete public observation");
  const now = new Date();
  // Recover only the exact content-addressed local artifacts requested by the
  // observed public rows. Missing or malformed files become failed attempts.
  const ratingArtifacts = new Map<string, unknown>();
  for (const sha of new Set(model.fixtures.map((row) => row.forecastProvenance?.ratingArtifactSha256))) {
    if (!/^[a-f0-9]{64}$/.test(sha ?? "")) continue;
    const file = path.join(path.resolve(options["ratings-dir"]), `${sha}.json`);
    if (!fs.existsSync(file)) continue;
    try { ratingArtifacts.set(sha!, JSON.parse(fs.readFileSync(file, "utf8"))); }
    catch { ratingArtifacts.set(sha!, null); }
  }
  const recognizedFixtures = registry.fixtures.map((row) => row.fixture);
  const seals = buildProspectiveBatch(candidate, digest, model.fixtures, recognizedFixtures, now, ratingArtifacts);
  const directory = path.resolve(options.out);
  const captureResults = options.capture ? seals.map((seal) => persistProspectiveSeal(directory, seal)) : [];
  let resultObservations = 0;
  if (fs.existsSync(directory)) for (const file of fs.readdirSync(directory)) {
    if (!file.startsWith(`${digest}-eng.1-`) || !file.endsWith(".json")) continue;
    const sealBody = fs.readFileSync(path.join(directory, file), "utf8");
    const seal = JSON.parse(sealBody) as ProspectiveSeal;
    validateProspectiveSeal(seal);
    if (seal.candidateSha256 !== digest || file !== `${digest}-eng.1-${seal.fixtureId}.json`) {
      throw new Error("Stored prospective seal identity differs from its filename");
    }
    const match = recent.matches.find((m) => m.id === seal.fixtureId && m.competitionId === "eng.1");
    if (!match) continue;
    const result = buildProspectiveResult(sealBody, match, now);
    if (result) {
      resultObservations += 1;
      if (options.capture) persistProspectiveResult(path.join(directory, "results"), result);
    }
  }
  console.log(JSON.stringify({ mode: options.capture ? "capture" : "dry-run", candidateSha256: digest,
    observedAt: now.toISOString(), checkpointCount: seals.length, failedCandidateCount: seals.filter((s) => s.failure).length,
    newSeals: captureResults.filter((r) => r.inserted).length, resultObservations,
    publicForecastsChanged: false, promotionApproved: false,
    limitation: "Manual bounded capture; run during the 90-minute checkpoint and before the seven-day results cache expires." }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Prospective capture failed");
  process.exitCode = 1;
});
