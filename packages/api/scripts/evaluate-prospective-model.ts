import fs from "node:fs";
import path from "node:path";
import { candidateDigest, verifyCandidateSources, type FrozenProspectiveCandidate } from "../src/services/prospective-model-seals";
import { evaluateProspectiveEvidence, validateProspectiveResultTransitions } from "../src/services/prospective-model-evaluation";

/** Read-only private evidence report. Never calls a provider or changes a model/ledger. */
function main(): void {
  const args = process.argv.slice(2), options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index], value = args[++index];
    if (!["--candidate", "--cohort", "--as-of"].includes(arg) || !value || value.startsWith("--"))
      throw new Error("Use --candidate <SHA-named manifest> --cohort <private cohort directory> [--as-of <ISO cutoff>]");
    options[arg.slice(2)] = value;
  }
  if (!options.candidate || !options.cohort) throw new Error("--candidate and --cohort are required");
  const body = fs.readFileSync(options.candidate, "utf8"), digest = candidateDigest(body);
  if (path.basename(options.candidate) !== `${digest}.json` || path.basename(path.resolve(options.cohort)) !== digest)
    throw new Error("Candidate or cohort filename differs from candidate digest");
  const candidate = JSON.parse(body) as FrozenProspectiveCandidate;
  verifyCandidateSources(candidate, path.resolve(__dirname, "../../.."));
  for (const file of ["packages/api/src/services/prospective-model-evaluation.ts", "packages/api/scripts/evaluate-prospective-model.ts"])
    if (!candidate.sourceHashes[file]) throw new Error("Missing frozen evaluation source binding");
  const cohort = JSON.parse(fs.readFileSync(path.join(options.cohort, "cohort.json"), "utf8"));
  if (cohort.schemaVersion !== 1) throw new Error("Invalid private cohort schema");
  const read = (section: string, limit: number) => {
    const directory = path.join(options.cohort, section);
    const files = fs.existsSync(directory) ? fs.readdirSync(directory).filter((file) => file.endsWith(".json")).sort() : [];
    if (files.length > limit) throw new Error("Prospective evidence limit exceeded");
    return files.map((file) => ({ file, body: fs.readFileSync(path.join(directory, file), "utf8") }));
  };
  const seals = read("seals", 1000), results = read("results", 4000), seen = read("seen", 1000), missed = read("missed", 1000);
  validateProspectiveResultTransitions(read("result-claims", 4000), results);
  for (const row of seals) if (row.file !== `${digest}-eng.1-${JSON.parse(row.body).fixtureId}.json`
    || Date.parse(JSON.parse(row.body).observedAt) > Date.now())
    throw new Error("Renamed private seal");
  for (const row of results) if (row.file !== `${candidateDigest(row.body)}.json`
    || Date.parse(JSON.parse(row.body).observedAt) > Date.now()) throw new Error("Renamed, changed or future private result");
  for (const row of [...seen, ...missed]) {
    const value = JSON.parse(row.body);
    if (!Number.isInteger(value.fixtureId) || value.fixtureId < 1 || !Number.isFinite(Date.parse(value.kickoff))
      || !Number.isFinite(Date.parse(value.firstObservedAt)) || Date.parse(value.firstObservedAt) < Date.parse(cohort.activatedAt)
      || Date.parse(value.firstObservedAt) > Date.now()
      || Date.parse(value.firstObservedAt) >= Date.parse(value.kickoff)
      || row.file !== `${value.fixtureId}-${candidateDigest(value.kickoff)}.json`) throw new Error("Invalid private coverage evidence");
  }
  for (const row of missed) {
    const value = JSON.parse(row.body), original = seen.find((record) => record.file === row.file);
    if (!original || value.reason !== "checkpoint-not-sealed" || !Number.isFinite(Date.parse(value.detectedAt))
      || Date.parse(value.detectedAt) < Date.parse(value.kickoff)
      || Date.parse(value.detectedAt) > Date.now()
      || value.firstObservedAt !== JSON.parse(original.body).firstObservedAt) throw new Error("Invalid private missed checkpoint");
  }
  const cutoff = options["as-of"] ? new Date(options["as-of"]) : new Date();
  if (cutoff.getTime() > Date.now()) throw new Error("Evaluation cutoff cannot be in the future");
  const report = evaluateProspectiveEvidence({ candidate, candidateSha256: digest, cohort,
    seals: seals.map((row) => row.body), results: results.map((row) => row.body),
    observedFixtures: seen.filter((row) => Date.parse(JSON.parse(row.body).firstObservedAt) <= cutoff.getTime()).length,
    missedCheckpoints: missed.filter((row) => Date.parse(JSON.parse(row.body).detectedAt) <= cutoff.getTime()).length,
    asOf: cutoff });
  console.log(JSON.stringify(report, null, 2));
}

try { main(); } catch (error) {
  console.error(error instanceof Error ? error.message : "Prospective evaluation failed"); process.exitCode = 1;
}
