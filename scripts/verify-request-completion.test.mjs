import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REQUIRED_IDS, verifyRequestCompletion } from './verify-request-completion.mjs';

const release = { sourceSha: 'a'.repeat(40), webSourceSha: 'b'.repeat(40), deploymentId: 'synthetic-test-deployment' };
function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'pundit-completion-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const save = (name, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    writeFileSync(resolve(root, name), bytes);
    return { path: name, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const proof = save('proof.json', { kind: 'synthetic-local-proof', overall: 'PASS' });
  const calibration = {
    kind: 'historical_predictive_calibration', schemaVersion: 1, release,
    candidateSourceSha: release.sourceSha, chronologicalSplit: true, preKickoffInputs: true,
    selectionIsolatedFromHoldout: true, fullShippedDistributionComparison: true, finiteCoherentGrid: true,
    reproducibleRuns: 2, reviewedMarkets: ['1x2', 'totals', 'btts', 'scorelines'],
    primaryMetric: { name: 'joint-score log loss', predeclared: true, properScoringRule: true },
    historicalEvaluationEvidence: [proof], uncertaintyEvidence: [proof],
    independentReview: { reviewer: 'independent synthetic reviewer', verdict: 'PASS', evidence: [proof] },
    decision: { outcome: 'promoted', heldOutImprovement: true, noMaterialOtherMarketRegression: true, evidence: [proof] },
    liveOutputEvidence: [proof],
  };
  const releaseEvidence = save('release-report.json', { schemaVersion: 17, overall: 'PASS', completedAt: '2026-10-06T00:00:00Z', finalizedAt: '2026-10-06T00:10:00Z', deployment: { apiSha: release.sourceSha, webSha: release.webSourceSha, id: release.deploymentId } });
  const register = { schemaVersion: 1, requestId: 'pundit-finish-everything-2026-10', targetRelease: release, releaseEvidence,
    requirements: REQUIRED_IDS.map(id => ({ id, request: `Test ${id}`, owner: 'implementer', state: 'accepted',
      acceptanceCriteria: ['Explicit synthetic criterion'],
      phases: Object.fromEntries(['implementation', 'testing', 'deployment', 'productAcceptance'].map(phase => [phase,
        { status: 'passed', reason: `Independent ${phase} synthetic proof`, evidence: [proof], release }])),
      ...(id === 'predictive-calibration' ? { calibrationReceipt: save('calibration.json', calibration) } : {}),
    })) };
  const row = id => register.requirements.find(item => item.id === id);
  const verify = () => verifyRequestCompletion(register, { root });
  const updateCalibration = () => { row('predictive-calibration').calibrationReceipt = save('calibration.json', calibration); };
  return { root, register, calibration, proof, save, row, verify, updateCalibration };
}

test('complete synthetic request requires every scope row and independent phase', t => {
  const f = fixture(t);
  assert.deepEqual(f.verify(), { overall: 'PASS', complete: true, errors: [], outstanding: [] });
});
test('passing repair release cannot close ongoing predictive calibration', t => {
  const f = fixture(t);
  const row = f.row('predictive-calibration');
  row.state = 'ongoing'; row.nextAction = 'Continue held-out historical evaluation';
  row.phases.productAcceptance = { status: 'pending', reason: 'Historical acceptance not achieved' };
  const result = f.verify();
  assert.equal(result.overall, 'ONGOING'); assert.equal(result.complete, false);
  assert.equal(result.outstanding[0].id, 'predictive-calibration');
});
test('dropping calibration or any original request fails closed', t => {
  const f = fixture(t);
  for (const id of REQUIRED_IDS) {
    const copy = structuredClone(f.register);
    copy.requirements = copy.requirements.filter(row => row.id !== id);
    assert.equal(verifyRequestCompletion(copy, { root: f.root }).overall, 'FAIL', id);
  }
});
test('accepted row cannot hide a pending implementation, test, deploy or acceptance', t => {
  const f = fixture(t);
  for (const phase of ['implementation', 'testing', 'deployment', 'productAcceptance']) {
    const copy = structuredClone(f.register);
    copy.requirements[0].phases[phase].status = 'pending';
    assert.equal(verifyRequestCompletion(copy, { root: f.root }).complete, false, phase);
  }
});
test('missing and altered proof is rejected', t => {
  const f = fixture(t);
  writeFileSync(resolve(f.root, f.proof.path), '{}');
  assert.match(f.verify().errors.join('\n'), /hash mismatch/);
  rmSync(resolve(f.root, f.proof.path));
  assert.equal(f.verify().overall, 'FAIL');
});
test('symlink/absolute/traversal evidence cannot escape repository', t => {
  const f = fixture(t);
  const external = mkdtempSync(resolve(tmpdir(), 'pundit-completion-external-'));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  writeFileSync(resolve(external, 'outside'), 'external');
  symlinkSync(resolve(external, 'outside'), resolve(f.root, 'link'));
  for (const path of ['link', resolve(external, 'outside'), '../outside']) {
    f.row('functional-qa').phases.implementation.evidence = [{ path, sha256: 'd'.repeat(64) }];
    assert.equal(f.verify().overall, 'FAIL', path);
  }
});
test('old target release evidence cannot be silently rebound', t => {
  const f = fixture(t);
  f.register.targetRelease = { ...release, sourceSha: 'd'.repeat(40) };
  assert.match(f.verify().errors.join('\n'), /stale|bound to target/);
  for (const row of f.register.requirements) {
    row.phases.deployment.release = f.register.targetRelease;
    row.phases.productAcceptance.release = f.register.targetRelease;
  }
  f.calibration.release = f.register.targetRelease; f.updateCalibration();
  assert.match(f.verify().errors.join('\n'), /finalized source-bound production PASS required/);
});
test('incomplete or failed release report never proves deployment acceptance', t => {
  const f = fixture(t);
  for (const report of [
    { schemaVersion: 17, overall: 'PASS' },
    { schemaVersion: 17, overall: 'FAIL', completedAt: 'now', finalizedAt: 'now', deployment: { apiSha: release.sourceSha, webSha: release.webSourceSha, id: release.deploymentId } },
  ]) {
    f.register.releaseEvidence = f.save('bad-release-report.json', report);
    assert.equal(f.verify().overall, 'FAIL');
  }
});
test('new unresolved work also prevents completion', t => {
  const f = fixture(t);
  f.register.requirements.push({ ...structuredClone(f.row('functional-qa')), id: 'new-request', state: 'ongoing', nextAction: 'Implement new request' });
  assert.equal(f.verify().overall, 'ONGOING');
});
test('duplicate rows and malformed statuses fail closed', t => {
  const f = fixture(t);
  f.register.requirements.push(structuredClone(f.row('functional-qa')));
  f.row('current-news').state = 'COMPLETE';
  f.register.requirements.push(null);
  assert.equal(f.verify().overall, 'FAIL');
});
test('concrete external blockers remain incomplete and require evidence and unblock action', t => {
  const f = fixture(t);
  const row = f.row('predictive-calibration');
  row.state = 'blocked'; row.nextAction = 'Restore required historical dataset access';
  row.blocker = { kind: 'external_access', condition: 'credential', reason: 'Required dataset denies access', owner: 'dataset administrator', missingInput: 'Historical dataset access permission', attemptedActions: ['Retried authenticated dataset fetch; access denied'], unblockAction: 'Restore dataset permission', evidence: [f.proof] };
  assert.equal(f.verify().overall, 'ONGOING');
  for (const key of ['unblockAction', 'missingInput', 'attemptedActions']) {
    const copy = structuredClone(f.register);
    delete copy.requirements.find(item => item.id === row.id).blocker[key];
    assert.equal(verifyRequestCompletion(copy, { root: f.root }).overall, 'FAIL', key);
  }
});
test('uncertainty, worse candidates or waiting for prospective sample cannot be blockers', t => {
  const f = fixture(t);
  const row = f.row('predictive-calibration');
  row.state = 'blocked'; row.nextAction = 'Continue historical research';
  for (const condition of ['uncertainty', 'candidate_worse', 'future_sample']) {
    row.blocker = { kind: 'external_state', condition, reason: condition, owner: 'researcher', missingInput: 'More future results', attemptedActions: ['Research'], unblockAction: 'Wait', evidence: [f.proof] };
    assert.equal(f.verify().overall, 'FAIL', condition);
  }
});
test('production requirement phases cannot be waived; local governance deployment can', t => {
  const f = fixture(t);
  f.row('completion-governance').phases.deployment = { status: 'not_required', reason: 'Local tool; no production behavior' };
  assert.equal(f.verify().overall, 'PASS');
  f.row('predictive-calibration').phases.deployment = { status: 'not_required', reason: 'Candidate uncertain' };
  assert.equal(f.verify().overall, 'FAIL');
});
test('repair PASS receipt cannot stand in for historical predictive evaluation', t => {
  const f = fixture(t);
  f.row('predictive-calibration').calibrationReceipt = f.save('release.json', { repairRelease: 'COMPLETE', certification: 'PASS' });
  assert.match(f.verify().errors.join('\n'), /historical calibration receipt required/);
});
for (const key of ['chronologicalSplit', 'preKickoffInputs', 'selectionIsolatedFromHoldout', 'fullShippedDistributionComparison', 'finiteCoherentGrid']) {
  test(`calibration requires ${key}`, t => {
    const f = fixture(t); f.calibration[key] = false; f.updateCalibration();
    assert.equal(f.verify().overall, 'FAIL');
  });
}
test('all markets, repeated runs, predeclared proper metric, uncertainty and independent review are required', t => {
  for (const mutation of [
    c => { c.reviewedMarkets = ['1x2']; }, c => { c.reproducibleRuns = 1; },
    c => { c.primaryMetric.predeclared = false; }, c => { c.primaryMetric.properScoringRule = false; },
    c => { c.uncertaintyEvidence = []; }, c => { c.independentReview.verdict = 'ONGOING'; },
  ]) {
    const f = fixture(t); mutation(f.calibration); f.updateCalibration();
    assert.equal(f.verify().overall, 'FAIL');
  }
});
test('uncertain/worse promotion is incomplete; product boundary needs explicit human scope-decision proof', t => {
  const f = fixture(t);
  f.calibration.decision.heldOutImprovement = false; f.updateCalibration();
  assert.equal(f.verify().overall, 'FAIL');
  f.calibration.decision = { outcome: 'uncertain', evidence: [f.proof] }; f.updateCalibration();
  assert.equal(f.verify().overall, 'FAIL');
  f.calibration.decision = { outcome: 'explicit_product_boundary', approvedBy: 'Xavi', boundary: 'Explicitly reviewed delivered scope and limitations', evidence: [f.proof] }; f.updateCalibration();
  assert.equal(f.verify().overall, 'FAIL');
  const approval = { kind: 'user_scope_decision', authorRole: 'user', source: 'user_message', author: 'Xavi', requestId: f.register.requestId, requirementId: 'predictive-calibration', decision: 'approve_explicit_product_boundary', boundary: f.calibration.decision.boundary, messageId: 'synthetic-user-message', quotedAuthorization: 'Synthetic test authorization for this exact product boundary' };
  f.calibration.decision.userDecisionReceipt = f.save('user-decision.json', approval); f.updateCalibration();
  assert.equal(f.verify().overall, 'PASS');
  for (const mutate of [
    a => { a.authorRole = 'agent'; a.author = 'root'; },
    a => { a.requirementId = 'merge-and-deploy'; },
    a => { a.requestId = 'other-user-task'; },
    a => { a.boundary = 'different boundary'; },
    a => { a.quotedAuthorization = ''; },
    a => { a.source = 'release_PASS'; },
  ]) {
    const invalid = structuredClone(approval); mutate(invalid);
    f.calibration.decision.userDecisionReceipt = f.save('user-decision.json', invalid); f.updateCalibration();
    assert.equal(f.verify().overall, 'FAIL');
  }
  f.calibration.decision.userDecisionReceipt = f.save('user-decision.json', approval);
  delete f.calibration.decision.approvedBy; f.updateCalibration();
  assert.equal(f.verify().overall, 'FAIL');
});
test('accepted candidate must be the actual deployed API source', t => {
  const f = fixture(t);
  f.calibration.candidateSourceSha = 'c'.repeat(40); f.updateCalibration();
  assert.match(f.verify().errors.join('\n'), /candidate source must match/);
});
test('CLI strict exit is nonzero for ongoing scope; status inspection does not claim complete', t => {
  const f = fixture(t);
  for (const row of f.register.requirements) {
    row.state = 'ongoing'; row.nextAction = 'Finish this requirement';
    for (const phase of Object.keys(row.phases)) row.phases[phase] = { status: 'pending', reason: 'Not yet accepted' };
  }
  // CLI validates paths inside the real repo; use its actual archived release proof.
  f.register.targetRelease = JSON.parse(readFileSync(resolve('docs/ops/full-request-completion.json'), 'utf8')).targetRelease;
  f.register.releaseEvidence = JSON.parse(readFileSync(resolve('docs/ops/full-request-completion.json'), 'utf8')).releaseEvidence;
  writeFileSync(resolve(f.root, 'register.json'), JSON.stringify(f.register));
  const script = resolve('scripts/verify-request-completion.mjs');
  const strict = spawnSync(process.execPath, [script, resolve(f.root, 'register.json')], { encoding: 'utf8' });
  const result = JSON.parse(strict.stdout);
  assert.equal(strict.status, 1);
  assert.equal(result.complete, false);
  assert.equal(result.outstanding.some(row => row.id === 'predictive-calibration'), true);
  const status = spawnSync(process.execPath, [script, '--status', resolve(f.root, 'register.json')], { encoding: 'utf8' });
  // A clean checkout without ignored release evidence also fails closed.
  assert.equal(status.status, result.overall === 'ONGOING' ? 0 : 1);
  assert.equal(JSON.parse(status.stdout).complete, false);
});
test('tracked register explicitly preserves original scope, historical release and independent calibration criteria', () => {
  const register = JSON.parse(readFileSync(resolve('docs/ops/full-request-completion.json'), 'utf8'));
  assert.deepEqual(REQUIRED_IDS.filter(id => !register.requirements.some(row => row.id === id)), []);
  assert.ok(register.requirements.find(row => row.id === 'predictive-calibration').acceptanceCriteria.length >= 4);
  assert.ok(register.historicalEvidence.length);
});
