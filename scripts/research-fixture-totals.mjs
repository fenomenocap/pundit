#!/usr/bin/env node
/** Offline exposed-data development. Never writes a production selector or ledger. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = path.join(repo, 'packages/api');
require(path.join(api, 'node_modules/ts-node')).register({ transpileOnly: true, project: path.join(api, 'tsconfig.json') });
const mle = require(path.join(api, 'src/services/dixon-coles-mle.ts'));
const selection = require(path.join(api, 'src/services/fixture-totals-development.ts'));
const augmentation = require(path.join(api, 'src/services/exposed-seal-training.ts'));
const evaluator = require(path.join(api, 'src/services/challenger-eval.ts'));
const dc = require(path.join(api, 'src/services/dixon-coles.ts'));
const bootstrap = require(path.join(api, 'src/services/paired-bootstrap.ts'));
const argv = process.argv.slice(2), i = argv.indexOf('--base-source-sha'), baseSourceSha = argv[i + 1];
assert.ok(i >= 0 && /^[a-f0-9]{40}$/.test(baseSourceSha), 'Supply --base-source-sha; exact working-tree sources are independently hashed.');
const hash = (x) => crypto.createHash('sha256').update(x).digest('hex');
const jsonHash = (x) => hash(JSON.stringify(x));
const binding = (p) => ({ path: path.relative(repo, p), sha256: hash(fs.readFileSync(p)) });
const corpus = mle.loadOfflineTrainingCorpus(path.join(api, 'data')); assert.equal(corpus.ok, true);
const rows = mle.joinTrainingRows(corpus.corpus.fixtures, corpus.corpus.preKickoffRows);
assert.equal(rows.length, 760); const byId = new Map(rows.map(r => [r.sourceEventId, r])); assert.equal(byId.size, rows.length);
for (const r of rows) assert.ok(Date.parse(r.rankingDate) <= Date.parse(r.kickoff.slice(0, 10)) - 86400000);
const splits = evaluator.weeklyExpandingWindowSplits(rows, { minTrainN: 20, resultLagMs: 86400000 });
assert.equal(splits.length, 69); const ids = splits.flatMap(s => s.holdoutEventIds); assert.equal(ids.length, 730); assert.equal(new Set(ids).size, ids.length);
const sources = ['packages/api/src/services/dixon-coles-mle.ts', 'packages/api/src/services/fixture-totals-development.ts',
  'packages/api/src/services/challenger-eval.ts', 'packages/api/src/services/exposed-seal-training.ts',
  'packages/api/src/services/club-strength-artifact.ts', 'packages/api/src/services/dixon-coles.ts', 'packages/api/src/services/paired-bootstrap.ts',
  'docs/architecture/fixture-totals-development-contract-2026-10-05.md', 'scripts/research-fixture-totals.mjs'].map(p => binding(path.join(repo, p)));
const previousDir = path.join(repo, 'artifacts/model-qa/weekly-2026-10-05T02-10-33-652Z');
const previous = JSON.parse(fs.readFileSync(path.join(previousDir, 'weekly-report.json')));
const previousPairs = new Map(previous.pairedForecasts.map(p => [p.sourceEventId, p]));
const previousFits = JSON.parse(fs.readFileSync(path.join(previousDir, 'fits.json'))).fits;
const runId = 'fixture-totals-' + new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(repo, 'artifacts/model-qa', runId); fs.mkdirSync(dir, { recursive: false });
const write = (name, x) => fs.writeFileSync(path.join(dir, name), JSON.stringify(x, null, 2) + '\n');
const startedAt = new Date().toISOString();
const ledgerArg = argv.indexOf('--augment-ledger');
let augmented = null, ledgerBinding = null, ratingBindings = [];
if (ledgerArg >= 0) {
  const ledgerPath = path.resolve(argv[ledgerArg + 1]), ledgerBody = fs.readFileSync(ledgerPath), ledger = JSON.parse(ledgerBody);
  const artifacts = new Map();
  for (const sha of new Set(ledger.fixtures.filter(r => r.competitionId === 'eng.1').map(r => r.inputs?.ratingArtifactSha256))) {
    if (!/^[a-f0-9]{64}$/.test(sha ?? '')) continue;
    const artifactPath = path.join(api, 'data/model-artifacts/clubelo', sha + '.json');
    if (!fs.existsSync(artifactPath)) continue;
    artifacts.set(sha, JSON.parse(fs.readFileSync(artifactPath))); ratingBindings.push(binding(artifactPath));
  }
  augmented = augmentation.exposedSealsForTraining(ledger.fixtures, artifacts, startedAt);
  ledgerBinding = { path: path.relative(repo, ledgerPath), sha256: hash(ledgerBody), observedAt: startedAt,
    limitation: 'Prior inspected live ledger; incomplete current season. BuiltAt default is not a result timestamp. Used only for final exposed training refresh.' };
  write('exposed-ledger-training.json', { ...augmented, ledgerBinding, ratingBindings });
}

const manifest = { schemaVersion: 1, runId, startedAt, baseSourceSha, exactWorkingTreeSourceBindings: sources,
  runtime: 'Node22 actual TypeScript source via ts-node transpile-only', node: process.version,
  dataHashes: { history: corpus.corpus.clubHistoryDatasetSha256, datedElo: corpus.corpus.preKickoffEloDatasetSha256, joinedRows: jsonHash(rows) },
  splitManifestSha256: jsonHash(splits), configuration: { outerMinTrainN: 20, resultLagMs: 86400000,
    optionGrid: selection.FIXTURE_TOTALS_DEVELOPMENT_OPTIONS, maxIterations: 1000, gradientTolerance: 1e-6,
    bootstrapDraws: 2000, bootstrapSeed: 20260915 }, exposedDevelopment: true, independentBlindTest: false,
  productionEligible: false, promotionRecommended: false };
write('manifest.json', { ...manifest, status: 'running' }); write('splits.json', splits); write('joined-rows.json', rows);
const fits = [], pairs = [];
for (const split of splits) {
  const train = split.trainEventIds.map(id => byId.get(id));
  for (const r of train) assert.ok(Date.parse(r.kickoff) <= Date.parse(split.origin) - 86400000);
  const selected = selection.selectFixtureTotalsOptions(train, split.origin);
  const fit = mle.fitGloballyFeasibleDixonColes(train, { ...selected.options, maxIterations: 1000 });
  const fitSha256 = jsonHash(fit);
  // This rerun also proves that introducing the new candidate did not change the baseline.
  const oldFit = mle.fitTimeDecayedDixonColes(train, { timeDecayXi: 0.0065, clubEloPriorStrength: 8, maxIterations: 250 });
  const preservedFit = previousFits.find(f => f.origin === split.origin);
  assert.equal(jsonHash(oldFit.params), preservedFit.parametersSha256, 'Baseline params changed at ' + split.origin);
  fits.push({ origin: split.origin, trainN: train.length, through: train.at(-1).kickoff, selected, fit, fitSha256 });
  for (const id of split.holdoutEventIds) {
    const row = byId.get(id), old = previousPairs.get(id); assert.ok(old);
    const f = mle.forecastGloballyFeasibleDixonColes(fit, row.homeCanonicalName, row.awayCanonicalName,
      { meanElo: fit.meanElo, homeElo: row.homeElo, awayElo: row.awayElo });
    const matrix = f ? dc.scoreMatrix(f.lambdaHome, f.lambdaAway, fit.params.rho) : null;
    pairs.push({ sourceEventId: id, origin: split.origin, kickoff: row.kickoff, home: row.homeCanonicalName,
      away: row.awayCanonicalName, homeGoals: row.homeGoals, awayGoals: row.awayGoals, champion: old.champion,
      previousFitted: old.challenger, candidate: f ? { ...f, scoreProbability: matrix[row.homeGoals]?.[row.awayGoals] ?? 0 } : null,
      rejectionReason: f ? null : !fit.converged ? 'origin-fit-not-converged' : 'invalid-or-missing-forecast-input',
      priorOnly: f?.priorOnly ?? null, fitSha256 });
  }
  console.log(JSON.stringify({ origin: split.origin, train: train.length, holdout: split.holdoutEventIds.length,
    selected: selected.options, convergence: fit.diagnostics.stopReason, gradient: fit.diagnostics.gradientNorm }));
}
write('fits.json', fits); write('paired-forecasts.json', pairs);
const binaryLog = (p, y) => -Math.log(Math.max(1e-15, y ? p : 1 - p));
const losses = (pair, side) => { const f = pair[side]; const result = pair.homeGoals > pair.awayGoals ? 'home' : pair.homeGoals < pair.awayGoals ? 'away' : 'draw';
  return { brier: (f.pHome - Number(result === 'home')) ** 2 + (f.pDraw - Number(result === 'draw')) ** 2 + (f.pAway - Number(result === 'away')) ** 2,
    logLoss: -Math.log(Math.max(1e-15, result === 'home' ? f.pHome : result === 'draw' ? f.pDraw : f.pAway)),
    over25Brier: (f.pOver2_5 - Number(pair.homeGoals + pair.awayGoals > 2.5)) ** 2,
    over25LogLoss: binaryLog(f.pOver2_5, pair.homeGoals + pair.awayGoals > 2.5),
    bttsBrier: (f.pBttsYes - Number(pair.homeGoals > 0 && pair.awayGoals > 0)) ** 2,
    bttsLogLoss: binaryLog(f.pBttsYes, pair.homeGoals > 0 && pair.awayGoals > 0),
    scoreLogLoss: -Math.log(Math.max(1e-15, f.scoreProbability)) }; };
const fields = ['brier', 'logLoss', 'over25Brier', 'over25LogLoss', 'bttsBrier', 'bttsLogLoss', 'scoreLogLoss'];
function summary(xs, side) { if (!xs.length) return { n: 0 };
  return { n: xs.length, ...Object.fromEntries(fields.map(field => [field, xs.reduce((s, p) => s + losses(p, side)[field], 0) / xs.length])) }; }
const accepted = pairs.filter(p => p.candidate), common = accepted.filter(p => p.previousFitted);
const uncertainty = (xs, before, after) => Object.fromEntries(fields.map(field => [field, bootstrap.pairedBootstrap(xs.map(p => ({
  block: bootstrap.utcWeekStart(p.kickoff), champion: losses(p, before)[field], challenger: losses(p, after)[field] })), 2000, 20260915)]));
const reliability = (field, outcome) => Array.from({ length: 5 }, (_, i) => { const xs = accepted.filter(p => p.candidate[field] >= i / 5 && (i === 4 || p.candidate[field] < (i + 1) / 5));
  return { low: i / 5, high: (i + 1) / 5, n: xs.length, predicted: xs.length ? xs.reduce((s, p) => s + p.candidate[field], 0) / xs.length : null,
    actualRate: xs.length ? xs.reduce((s, p) => s + Number(outcome(p)), 0) / xs.length : null }; });
const bounds = [0, 2, 2.5, 3, 3.5, 4, Infinity];
const totalCalibration = bounds.slice(0, -1).map((low, i) => { const high = bounds[i + 1], xs = accepted.filter(p => p.candidate.totalXg >= low && p.candidate.totalXg < high);
  return { low, high: Number.isFinite(high) ? high : null, n: xs.length,
    meanPredicted: xs.length ? xs.reduce((s, p) => s + p.candidate.totalXg, 0) / xs.length : null,
    meanActual: xs.length ? xs.reduce((s, p) => s + p.homeGoals + p.awayGoals, 0) / xs.length : null }; });
const report = { schemaVersion: 1, runId, exposedDevelopment: true, independentBlindTest: false, promotionRecommended: false,
  attemptedOrigins: fits.length, convergedOrigins: fits.filter(f => f.fit.converged).length, attemptedFixtures: pairs.length,
  acceptedFixtures: accepted.length, rejectedFixtures: pairs.length - accepted.length,
  failures: fits.filter(f => !f.fit.converged).map(f => ({ origin: f.origin, diagnostics: f.fit.diagnostics })),
  acceptedComparison: { champion: summary(accepted, 'champion'), candidate: summary(accepted, 'candidate'), uncertainty: uncertainty(accepted, 'champion', 'candidate') },
  commonValidPreviousComparison: { previous: summary(common, 'previousFitted'), candidate: summary(common, 'candidate'), uncertainty: uncertainty(common, 'previousFitted', 'candidate') },
  totalXgRange: accepted.length ? { min: Math.min(...accepted.map(p => p.candidate.totalXg)), max: Math.max(...accepted.map(p => p.candidate.totalXg)) } : null,
  over25Reliability: reliability('pOver2_5', p => p.homeGoals + p.awayGoals > 2.5), bttsReliability: reliability('pBttsYes', p => p.homeGoals > 0 && p.awayGoals > 0), totalCalibration,
  bootstrapInterpretation: 'Paired UTC-week2000draws/seed20260915; p10–p90 is80% empirical interval, not95% or a new acceptance gate.',
  constraints: ['All old/exposed outcomes remain development data.', 'Nonconverged fits are withheld and retained in denominators.',
    'Selection occurs only on earlier inner results; all options/folds retained.', 'Global feasibility covers fitted clubs; prior-only forecasts still fail closed independently.',
    'Existing promotion gates and champion/constants/selectors/ledger unchanged; prospective unseen outcomes required.'] };
write('report.json', report);
const through = rows.at(-1).kickoff, availableAt = new Date(Date.parse(through) + 86400000).toISOString();
const finalSelection = selection.selectFixtureTotalsOptions(rows, availableAt);
const finalRows = [...rows, ...(augmented?.rows ?? [])].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
assert.equal(new Set(finalRows.map(r => r.sourceEventId)).size, finalRows.length);
write('final-training-rows.json', finalRows);
// Recent exposed results refresh parameters only: the hyperparameters remain
// the preceding historical training-only selection, never selected on these50.
const finalFit = mle.fitGloballyFeasibleDixonColes(finalRows, { ...finalSelection.options, maxIterations: 1000 });
const artifact = { schemaVersion: 1, methodId: mle.GLOBALLY_FEASIBLE_DIXON_COLES_METHOD_ID,
  baseSourceSha, exactWorkingTreeSourceBindings: sources, fit: finalFit,
  training: { through: finalRows.at(-1).kickoff, resultAvailableAt: augmented ? startedAt : availableAt,
    rowCount: finalRows.length, historicalRowCount: rows.length, exposedRecentRowCount: augmented?.rows.length ?? 0,
    ratingPrecisionPolicy: augmented?.ratingPrecisionPolicy ?? null,
    datasetHashes: { ...manifest.dataHashes, ...(ledgerBinding ? { exposedLedger: ledgerBinding.sha256 } : {}) },
    rowsSha256: jsonHash(finalRows), ledgerBinding, ratingBindings, completeCurrentSeasonCoverage: false },
  selection: { contractSha256: sources.find(x => x.path.includes('contract')).sha256, ...finalSelection }, productionEligible: false };
const body = JSON.stringify(artifact, null, 2) + '\n', artifactSha256 = hash(body); fs.writeFileSync(path.join(dir, artifactSha256 + '.json'), body);
for (const b of sources) assert.equal(binding(path.join(repo, b.path)).sha256, b.sha256, 'Source changed during run.');
write('manifest.json', { ...manifest, status: 'complete', completedAt: new Date().toISOString(), artifactSha256,
  artifactPath: path.join(dir, artifactSha256 + '.json'), reportSha256: hash(fs.readFileSync(path.join(dir, 'report.json'))),
  exposedLedgerBinding: ledgerBinding, ratingBindings, assertions: { baselineParameterHashesUnchanged: true, chronologicalSplits: true, noBlindTestClaim: true, exactSourcesUnchanged: true } });
console.log(JSON.stringify({ dir, artifactSha256, finalFitConverged: finalFit.converged, summary: report.acceptedComparison,
  origins: report.attemptedOrigins, converged: report.convergedOrigins, attempted: report.attemptedFixtures, accepted: report.acceptedFixtures }, null, 2));
