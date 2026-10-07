# Whole-request completion

The authoritative register is [full-request-completion.json](full-request-completion.json). The prior production receipt proves a repaired release, while predictive calibration is still ongoing. Its fixed 2.70 totals limitation and historical failures remain preserved in the original receipt. A private prospective collector does not improve the public model.

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

Exact numerical promotion thresholds remain pending the shipped-model/data audit and must be predeclared in the evaluation evidence. Do not invent thresholds to close this process task. A product boundary must be an explicit reviewed product decision, not a renamed unsuccessful experiment or an automatic scope waiver. An uncertain or worse candidate stays ongoing. Future matches provide additional monitoring and are not mandatory for retrospective improvement. Finite historical results cannot establish "highest possible performance".

No product-boundary approval has been given for this work. A future `userDecisionReceipt` must be a hashed record with `kind: "user_scope_decision"`, `authorRole: "user"`, `source: "user_message"`, matching `requestId` and `requirementId: "predictive-calibration"`, `decision: "approve_explicit_product_boundary"`, the exact `boundary`, the human `author` matching `approvedBy`, the actual `messageId` and `quotedAuthorization`. Review the original human message; an agent-authored decision or deployment permission cannot authorize reducing predictive scope.
