# Whole-request completion

The authoritative register is [full-request-completion.json](full-request-completion.json). Its final closure is tied to separately reviewed implementation, testing, deployment and product acceptance for all twelve original requirements. Historical calibration is accepted through a distinct numerical receipt and independently reviewed live forecasts; a passing release report alone cannot close it. Earlier unsuccessful candidates, interrupted certifications and before-closure register snapshots remain preserved.

Run `pnpm completion:status` to inspect outstanding work. Run `pnpm verify:completion` before claiming the full request is complete: exit zero requires every original and added item accepted, every applicable phase passed, intact evidence and matching target-release bindings. `ONGOING` exits one under the strict command. Invalid/missing evidence always exits one, including in status mode. CI runs `pnpm test:completion` to exercise the policy without production requests; ordinary CI can pass while user work remains ongoing.

Each requirement owns four independent phase records: implementation, testing, deployment and product acceptance. Each passed phase needs a concrete reason and repository-relative evidence path with SHA-256. Deployment and product acceptance bind the target API source, web source and Railway deployment ID. When changing the target release, revalidate relevant behavior and record fresh acceptance; the gate rejects stale phase bindings. Only local completion-governance deployment is inapplicable, because the tool changes no production behavior. Missing ignored evidence in a fresh checkout requires restoration from the archived evidence packet; it never becomes an automatic PASS.

`releaseEvidence` must reference the immutable, finalized Schema-17 production report with PASS and the exact API/web/deployment triple. Relabelling old phase bindings cannot substitute for fresh release proof. This is a prerequisite for completion, not proof that all request items are done.

The fixed original IDs in the verifier prevent deleting calibration or another request to get green. Add new requests as additional rows. Explicit user scope changes require both register and verifier review. Previous reports are historical evidence: never rewrite them, replace their failure outcomes, or silently bind an old PASS to a new release.

Unfinished work has an owner and next action. A concrete external blocker records `kind` (`user_input`, `external_access`, `external_state`), `condition` (`permission`, `credential`, `service_unavailable`, `required_input`), reason, owner, `missingInput`, nonempty `attemptedActions`, evidence and unblock action. Research uncertainty, a worse candidate, optional live-state absence and waiting for future outcomes remain ongoing. The five safe optional production cases stay explicitly unavailable in the old report; controlled runtime coverage does not claim those live states occurred.

## Predictive calibration acceptance

Acceptance needs a separately hashed JSON receipt referenced as `calibrationReceipt`, with the following fields. The verifier checks the evidence contract; independent reviewers must inspect the actual data, analysis, decisions and delivered behavior. Boolean attestations and hashes alone cannot prove statistical quality.

| Field | Required evidence/meaning |
|---|---|
| `kind`, `schemaVersion` | `historical_predictive_calibration`, `1`; a repair-release PASS is insufficient |
| `release`, `candidateSourceSha` | Actual target release triple; accepted candidate commit must equal deployed API source |
| `chronologicalSplit`, `preKickoffInputs`, `selectionIsolatedFromHoldout` | True only after leakage-safe training/selection/held-out review |
| `fullShippedDistributionComparison`, `finiteCoherentGrid` | Compare to the shipped full score distribution; verify coherent finite grid |
| `reproducibleRuns`, `reviewedMarkets` | At least two reproducible historical runs; `1x2`, `totals`, `btts`, `scorelines` reviewed |
| `primaryMetric` | Named proper scoring rule, `predeclared: true`, `properScoringRule: true`; predeclare split, metric, uncertainty and regression policy before selection |
| `historicalEvaluationEvidence`, `uncertaintyEvidence` | Nonempty hashed evidence arrays; uncertainty must inform the decision |
| `independentReview` | Named independent reviewer, `verdict: "PASS"`, hashed evidence |
| `decision` | `outcome: "promoted"` requires `heldOutImprovement: true`, `noMaterialOtherMarketRegression: true`, hashed decision evidence; or `outcome: "explicit_product_boundary"` requires `approvedBy`, concrete `boundary`, hashed decision evidence and `userDecisionReceipt` |
| `liveOutputEvidence` | Source-specific reviewed deployment/output proof for the accepted candidate or boundary |

The accepted evaluation pins its protocol, proper-score metric, paired week-bootstrap uncertainty and cross-market regression thresholds before the primary cohort labels were examined. See the separately hashed calibration receipt and historical evaluation evidence; do not change the frozen criteria to fit results. A product boundary must be an explicit reviewed product decision, not a renamed unsuccessful experiment or an automatic scope waiver. An uncertain or worse candidate stays ongoing. Future matches provide additional monitoring and are not mandatory for retrospective improvement. Finite historical results cannot establish "highest possible performance".

No product-boundary approval has been given for this work. A future `userDecisionReceipt` must be a hashed record with `kind: "user_scope_decision"`, `authorRole: "user"`, `source: "user_message"`, matching `requestId` and `requirementId: "predictive-calibration"`, `decision: "approve_explicit_product_boundary"`, the exact `boundary`, the human `author` matching `approvedBy`, the actual `messageId` and `quotedAuthorization`. Review the original human message; an agent-authored decision or deployment permission cannot authorize reducing predictive scope.

## Accepted calibration and its limits

The EPL release replaces its fixed 2.70 total-goals assumption with a pinned historical team-goals fit and one coherent score distribution. It preserves the existing 1X2 probabilities, while totals, BTTS, scorelines and simulated goals derive from the same calibrated grid. Other competition and neutral-venue branches retain their explicitly bounded baseline behavior. Artifact integrity and freshness fail closed.

Two identical chronological historical replays cover 1,770 evaluable matches in five complete 2009–2014 seasons, across 182 weekly origins. Score-distribution log loss improves from 2.97534 to 2.96116 (paired 95% interval for the change −0.02427 to −0.00389); BTTS Brier improves from 0.25320 to 0.24788. Totals Brier moves from 0.24959 to 0.24889 and meets the frozen noninferiority policy; its interval crosses zero, so this is not a statistically established totals improvement. 1X2 is preserved, with no claimed improvement.

The earlier 353-match 2017–18 reserve failed and remains in the record. The later five-season cohort was fixed before its labels were opened, but it followed that earlier failure: its intervals are cohort-specific and unadjusted for sequential research. Historical input availability uses source-calendar dates plus a 24-hour result exclusion, rather than original publication seals; historical feeds may have revisions. Current-season results enter training and are not described as blind validation. Finite historical evidence does not establish highest possible performance. Future outcomes provide monitoring, not a prerequisite for the retrospective upgrade.

Source-specific live acceptance recomputes all thirty delivered EPL grids twice, checks coherent probabilities and fair prices, validates calibrated totals/BTTS/scorelines, and verifies the pinned artifact and disabled old prospective candidate. The old source-bound prospective files are preserved; no private volume export or deletion is needed to accept the public retirement controls.

Optional live fixtures absent from the observed slate remain explicitly INCONCLUSIVE in the production report. Their controlled capability tests are identified separately and do not claim those live states occurred. A publisher absolute-timestamp capture that was blocked remains a source-audit limitation, rather than a fabricated confirmation; primary article content and delivered citation metadata have separate review evidence.

## Restoring private acceptance evidence

The local packet is `artifacts/historical-calibration-2026-10-07/production/private-completion-evidence-1670-v4.tar.gz`, SHA-256 `0f47e4ce6de843cf92150967acf4714c4fe0f1fcd70fe938a89d5b9982e3380a`. Its manifest preserves all 91 direct completion-gate dependencies and supplementary independent reviews, source provenance, rendered captures and failed-run history. The packet is private and was not uploaded; it excludes the bulk raw provider corpus, production volume, credentials and environment files.

If acceptance evidence is missing in another checkout, verify the packet hash and restore the missing `artifacts/` files at their recorded repository-relative paths. Keep Git-managed files on the reviewed source instead of overwriting a newer checkout. The pinned numerical artifact is already committed with the release. Run `pnpm verify:completion` again after restoration; a missing packet or mismatched evidence remains a failure, never an automatic acceptance.
