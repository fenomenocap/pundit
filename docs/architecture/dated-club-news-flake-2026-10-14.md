# Dated club news eval flake — diagnosis (main `455cb55`)

Scope: `dated-club-news-delivers-supported-update` on Everton vs Chelsea (`espn:eng.1:401878771`). Eval gates unchanged.

## Run comparison (chat-eval-data artifacts)

| | Pass — workflow `38483264537` (2026-10-13T23:17Z) | Fail — workflow `38543384316` (2026-10-14T09:35Z) |
|---|---|---|
| Scenario | **PASS** | **REGRESSION** |
| Answer | Three `In an update published on YYYY-MM-DD, Chelsea's …` lines + Everton gap notice | Full abstention: no verified dated team-news update |
| Verification | `verified`, `supportedClaimCount: 3` | `abstain`, `supportedClaimCount: 0` |
| Citations | Football London `S7`, `S10` (2026-10-13, 2026-10-09) | none |
| Same request | Identical `POST /api/ask` body (eval scenario) | same |

### What differed

1. **Search merge, not verifier or gates.** Pass run's merged bundle included allowlisted Football London injury pages with search-supplied publication dates. Fail run's bundle had no row that survived `selectTeamNewsSources` (drops `authority: other`) and `datedClubNewsSources` / `extractDatedClubAvailability` — so settlement never reached verified composed dated lines.

2. **Planning vs execution cap.** Injury-only team-news plans **eight** federated queries (#278/#279: official club + BBC + Sky + Football London per side). `buildEvidenceBundle` still executes only **`MAX_EVIDENCE_QUERIES` (6)**, so **`site:football.london` queries are planned but never run** on the first pass. The pass run got Football London URLs from variance in the first six queries' merged hits; the fail run did not.

3. **Fetch / extraction on pass path.** Pass citations map to `extractDatedClubAvailability` + `composeDatedClubAvailabilityAnswer` (deterministic dated records), not generative desk prose. No evidence of fetch failure on the pass path for those URLs.

4. **Fail path.** `team_news_evidence_selected` would show `proseCandidates: []` and abstention before verification; harness fails `positiveDatedNewsDelivered` / `positiveNewsVerification`.

## Fix (smallest)

When injury-only team-news retrieval has **no dated candidates and no allowlisted club-injury pages** in the first pass, **retry allowlisted `site:` beats in order** (`football.london` → BBC → Sky), respecting `PROVIDER_CALL_BUDGET`, without loosening authority, verifier, or eval assertions.

Implementation: `team-news-evidence-retrieval.ts` + hook in `buildEvidenceBundle` (`ask.ts`).
