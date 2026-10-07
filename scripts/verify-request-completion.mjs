import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Removing a row from the register must never silently shrink the user's request.
export const REQUIRED_IDS = Object.freeze([
  'functional-qa', 'probability-and-odds', 'predictive-calibration', 'output-contracts',
  'epl-branding', 'current-news', 'citations-and-dates', 'dependency-security',
  'scenario-and-repeat-testing', 'merge-and-deploy', 'open-work-closure', 'completion-governance',
]);
const PHASES = ['implementation', 'testing', 'deployment', 'productAcceptance'];
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const sameRelease = (a, b) => a && b && ['sourceSha', 'webSourceSha', 'deploymentId'].every(key => a[key] === b[key]);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function verifyRequestCompletion(register, { root = rootDir } = {}) {
  const errors = [];
  const outstanding = [];
  const fail = message => errors.push(message);
  const evidence = (ref, label) => {
    if (!ref || !nonempty(ref.path) || !SHA.test(ref.sha256 ?? '')) {
      fail(`${label}: evidence requires a relative path and SHA-256`);
      return null;
    }
    try {
      const base = realpathSync(root);
      const target = realpathSync(resolve(base, ref.path));
      const rel = relative(base, target);
      if (isAbsolute(ref.path) || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new Error('evidence escapes repository');
      }
      const bytes = readFileSync(target);
      if (createHash('sha256').update(bytes).digest('hex') !== ref.sha256) throw new Error('evidence hash mismatch');
      return bytes;
    } catch (error) { fail(`${label}: ${error.message}`); return null; }
  };
  const refs = (items, label) => {
    if (!Array.isArray(items) || items.length === 0) { fail(`${label}: evidence is missing`); return; }
    items.forEach((ref, index) => evidence(ref, `${label}[${index}]`));
  };
  if (!register || register.schemaVersion !== 1 || register.requestId !== 'pundit-finish-everything-2026-10') {
    fail('Invalid authoritative request register');
  }
  const release = register?.targetRelease;
  if (!COMMIT.test(release?.sourceSha ?? '') || !COMMIT.test(release?.webSourceSha ?? '') || !nonempty(release?.deploymentId)) {
    fail('Target release requires exact API/web source commits and deployment identity');
  }
  const releaseBytes = evidence(register?.releaseEvidence, 'releaseEvidence');
  if (releaseBytes) {
    try {
      const report = JSON.parse(releaseBytes.toString('utf8'));
      if (report.schemaVersion !== 17 || report.overall !== 'PASS' || !nonempty(report.completedAt) || !nonempty(report.finalizedAt) ||
          !sameRelease({ sourceSha: report.deployment?.apiSha, webSourceSha: report.deployment?.webSha, deploymentId: report.deployment?.id }, release)) {
        throw new Error('finalized source-bound production PASS required');
      }
    } catch (error) { fail(`releaseEvidence: ${error.message}`); }
  }
  if (!Array.isArray(register?.requirements)) return { overall: 'FAIL', complete: false, errors: [...errors, 'Requirements missing'], outstanding };
  if (register.historicalEvidence) refs(register.historicalEvidence, 'historicalEvidence');
  const ids = register.requirements.map(row => row?.id);
  if (new Set(ids).size !== ids.length) fail('Duplicate requirement IDs');
  for (const id of REQUIRED_IDS) if (!ids.includes(id)) fail(`Required original scope missing: ${id}`);
  for (const row of register.requirements) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) { fail('Invalid requirement record'); continue; }
    const label = row?.id ?? 'unnamed requirement';
    if (!nonempty(row?.id) || !nonempty(row?.request) || !nonempty(row?.owner) ||
        !Array.isArray(row?.acceptanceCriteria) || !row.acceptanceCriteria.length || !row.acceptanceCriteria.every(nonempty)) {
      fail(`${label}: request, owner and concrete acceptance criteria required`);
    }
    if (!['ongoing', 'accepted', 'blocked'].includes(row?.state)) fail(`${label}: invalid requirement state`);
    if (row.state !== 'accepted') {
      outstanding.push({ id: row.id, state: row.state, nextAction: row.nextAction, blocker: row.blocker ?? null });
      if (!nonempty(row.nextAction)) fail(`${label}: unfinished work requires a next action`);
    }
    if (row.state === 'blocked') {
      const blocker = row.blocker;
      if (!['user_input', 'external_access', 'external_state'].includes(blocker?.kind) ||
          !['permission', 'credential', 'service_unavailable', 'required_input'].includes(blocker?.condition) ||
          !['reason', 'owner', 'missingInput', 'unblockAction'].every(key => nonempty(blocker?.[key])) ||
          !Array.isArray(blocker?.attemptedActions) || !blocker.attemptedActions.length || !blocker.attemptedActions.every(nonempty)) {
        fail(`${label}: blocker requires a concrete external condition, missing input, attempted actions, owner and unblock action`);
      }
      refs(blocker?.evidence, `${label}.blocker`);
    } else if (row.blocker != null) fail(`${label}: only externally blocked work can carry a blocker`);
    if (row.historicalEvidence) refs(row.historicalEvidence, `${label}.historicalEvidence`);
    for (const phase of PHASES) {
      const entry = row.phases?.[phase];
      if (!entry || !['pending', 'passed', 'not_required'].includes(entry.status) || !nonempty(entry.reason)) {
        fail(`${label}.${phase}: independent phase status and reason required`);
        continue;
      }
      // Local process tooling has no production behavior; other original items do.
      if (entry.status === 'not_required' && !(row.id === 'completion-governance' && phase === 'deployment')) {
        fail(`${label}.${phase}: production/product acceptance cannot be waived`);
      }
      if (entry.status === 'passed') {
        refs(entry.evidence, `${label}.${phase}`);
        if (phase === 'deployment' || phase === 'productAcceptance') {
          if (!sameRelease(entry.release, release)) fail(`${label}.${phase}: stale or absent target release binding`);
        }
      }
      if (row.state === 'accepted' && entry.status === 'pending') fail(`${label}.${phase}: accepted work still pending`);
    }
    if (row.id === 'predictive-calibration' && row.state === 'accepted') {
      const bytes = evidence(row.calibrationReceipt, `${label}.calibrationReceipt`);
      if (bytes) {
        try {
          const receipt = JSON.parse(bytes.toString('utf8'));
          if (receipt.kind !== 'historical_predictive_calibration' || receipt.schemaVersion !== 1) throw new Error('historical calibration receipt required; release PASS is insufficient');
          if (!sameRelease(receipt.release, release)) throw new Error('calibration not bound to target release');
          if (!COMMIT.test(receipt.candidateSourceSha ?? '') || receipt.candidateSourceSha !== release.sourceSha) throw new Error('accepted candidate source must match the deployed API commit');
          for (const key of ['chronologicalSplit', 'preKickoffInputs', 'selectionIsolatedFromHoldout', 'fullShippedDistributionComparison', 'finiteCoherentGrid']) {
            if (receipt[key] !== true) throw new Error(`unproved calibration prerequisite: ${key}`);
          }
          if (!Number.isInteger(receipt.reproducibleRuns) || receipt.reproducibleRuns < 2) throw new Error('two reproducible historical runs required');
          if (!['1x2', 'totals', 'btts', 'scorelines'].every(market => receipt.reviewedMarkets?.includes(market))) throw new Error('all delivered markets require review');
          if (!nonempty(receipt.primaryMetric?.name) || receipt.primaryMetric.predeclared !== true || receipt.primaryMetric.properScoringRule !== true) throw new Error('predeclared primary proper scoring metric required');
          refs(receipt.historicalEvaluationEvidence, `${label}.historicalEvaluation`);
          refs(receipt.uncertaintyEvidence, `${label}.uncertainty`);
          if (!nonempty(receipt.independentReview?.reviewer) || receipt.independentReview?.reviewer === row.owner || receipt.independentReview?.verdict !== 'PASS') throw new Error('independent numerical/product review required');
          refs(receipt.independentReview.evidence, `${label}.independentReview`);
          const decision = receipt.decision;
          if (decision?.outcome === 'promoted') {
            if (decision.heldOutImprovement !== true || decision.noMaterialOtherMarketRegression !== true) throw new Error('promotion requires improvement and no material cross-market regression');
          } else if (decision?.outcome === 'explicit_product_boundary') {
            if (!nonempty(decision.approvedBy) || !nonempty(decision.boundary)) throw new Error('explicit product decision and approver required');
            const approvalBytes = evidence(decision.userDecisionReceipt, `${label}.userDecisionReceipt`);
            if (!approvalBytes) throw new Error('explicit human product-boundary authorization required');
            const approval = JSON.parse(approvalBytes.toString('utf8'));
            if (approval.kind !== 'user_scope_decision' || approval.authorRole !== 'user' || approval.source !== 'user_message' ||
                approval.requestId !== register.requestId || approval.requirementId !== row.id ||
                approval.decision !== 'approve_explicit_product_boundary' || approval.boundary !== decision.boundary ||
                approval.author !== decision.approvedBy || !nonempty(approval.messageId) || !nonempty(approval.quotedAuthorization)) {
              throw new Error('product boundary requires a matching explicit user scope decision; agent self-approval is insufficient');
            }
          } else throw new Error('uncertain or worse candidate remains ongoing');
          refs(decision.evidence, `${label}.decision`);
          refs(receipt.liveOutputEvidence, `${label}.liveOutput`);
        } catch (error) { fail(`${label}: ${error.message}`); }
      }
    }
  }
  return { overall: errors.length ? 'FAIL' : outstanding.length ? 'ONGOING' : 'PASS', complete: !errors.length && !outstanding.length, errors, outstanding };
}

export function runCompletionCli(args = process.argv.slice(2)) {
  const statusOnly = args.includes('--status');
  const paths = args.filter(arg => arg !== '--status');
  if (paths.length > 1 || paths.some(arg => arg.startsWith('-'))) {
    console.error('Usage: verify-request-completion.mjs [--status] [register.json]');
    return 1;
  }
  try {
    const register = JSON.parse(readFileSync(resolve(rootDir, paths[0] ?? 'docs/ops/full-request-completion.json'), 'utf8'));
    const result = verifyRequestCompletion(register);
    console.log(JSON.stringify(result, null, 2));
    return result.complete || (statusOnly && result.overall === 'ONGOING') ? 0 : 1;
  } catch (error) { console.error(`Completion verification failed: ${error.message}`); return 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCompletionCli();
