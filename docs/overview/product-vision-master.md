# Pundit — Product Vision Master

**Repo:** [fenomenocap/pundit](https://github.com/fenomenocap/pundit)  
**Live:** [thepundit.vercel.app](https://thepundit.vercel.app) · API [thepundit.up.railway.app](https://thepundit.up.railway.app)  
**Audited SHA:** `9c8d02b95459e526fbb964754699b2054a19b547` (`main`, public as of 31 Aug 2026)  
**Thesis source:** `sire-agent-five-posts-synthesis.md` (SIRE / DKING terminal arc, Feb–Sep 2025)  
**Status of this file:** canonical product vision for the repo. Not betting advice.  
**Date:** 31 August 2026

This file replaces the earlier access-blocked draft. Every “built / not built” cell below is pinned to a path in the public tree.

---

## 0. How to read this document

Two documents are being held at once. They are not the same product yet.

1. **The SIRE thesis you locked** — a bidirectional pricing terminal. One box. Model p versus a named line. EV%. Risk band. Pass price. Play price. Stake only after bankroll. A receipt after kickoff.
2. **The repo that exists** — a chat-first, read-only football analysis app for Premier League and UCL qualifiers. Dixon-Coles 1X2 against Stake / Kalshi / Polymarket no-vig probabilities. Deterministic grounding. Explicit “analysis only, nothing to buy.”

The gap between those two is the build list. Pundit already has the statistical spine and the conversation surface SIRE spent six months discovering. It has deliberately not shipped the desk object Brooks asked for on launch day.

Holding the thesis means: do not water the destination down to match today’s disclaimer. Also do not pretend the current product is already that destination. The honest sentence is:

> Pundit today is a grounded forecast-and-market comparison chat. The thesis is a pricing terminal that keeps the claim. Most of the math to get from one to the other already lives in the API. Most of the object does not.

---

## 1. The thesis we are holding

SIRE’s five official posts are not a token story. They are a six-month answer to one operator question, asked on launch day by @Brooksasaurus:

> At what price is this attractive, at what price do you pass, and how much do you bet if you don’t pass?

The product that survived that question is a **bidirectional pricing terminal**:

1. A human talks to one box.
2. A coordinator hides specialists (fixtures, form, news, odds, prediction, EV, stake).
3. The box returns a stable object: model probability, fair odds, book implied probability, EV%, risk band, optional stake.
4. The human can push (“price this slate”) or pull (“I found Barça at 3.00 — is that +EV?”).
5. Mobile is the real client. Personality is distribution. The number is the product.

Pundit holds that thesis.

Pundit is not “another tips account.”  
Pundit is not “an LLM that likes football.”  
Pundit is not SIRE’s token, vault, or SN44 computer-vision stack.  
Pundit is not the archived onchain parimutuel at `archive/onchain-trading-v1`.

Pundit is the **desk object SIRE demonstrated**, rebuilt as Fenomeno Cap infrastructure: inspectable, local-first where possible, honest about calibration, and named for the thing sports media still refuses to do — stand behind a claim after the match ends.

---

## 2. What Pundit is today (file-backed)

**One-line, current product:** A chat-first analysis layer over public football data. Ask about a recognized Premier League or UCL-qualifier fixture, the table, or the title race, and get a labelled answer grounded in a local Dixon-Coles model plus public market probabilities.

**Job the current app actually does:**

> A curious football reader opens thepundit.vercel.app, taps a priced fixture chip, and gets model 1X2, a market comparison row, and prose that is not allowed to invent numbers.

**What the current app refuses to do, in writing:**

- Take a position, hold funds, or offer a wager (`docs/support/disclaimer.md`).
- Treat Stake / Kalshi / Polymarket prices as executable lines.
- Let MiniMax author probabilities, fair odds, gaps, source IDs, betting recommendations, or lineup effects (`AGENTS.md`, `ANALYST_RESPONSE_V2`).
- Price friendlies, discovery candidates, or unsupported competitions.

**Primary user today:** someone who wants a grounded read, not a ticket.  
**Primary user in the thesis:** the person in Brooks’ reply. Bankroll, risk band, attractive price, pass price.

Both users share the same spine. They do not share the same output schema.

### 2.1 What is actually deployed

| Layer | What | Path / URL |
|---|---|---|
| Web | Next.js 14 App Router, chat homepage, fixtures, model, evaluation | `packages/web` · thepundit.vercel.app |
| API | Express, four-tier `/api/ask`, model, matches, evaluation | `packages/api` · thepundit.up.railway.app |
| Model | Dixon-Coles bivariate Poisson from pinned ClubElo artifact | `packages/api/src/services/dixon-coles.ts` |
| Football data | ESPN scoreboard / standings, 30-min cache | `packages/api/src/services/football-data.ts` |
| Markets | Stake / Kalshi / Polymarket, no-vig 1X2, 30-min cache | `packages/api/src/services/fixture-market-sources.ts`, `model-market-odds.ts` |
| Chat orchestration | 7,157-line four-tier ask + guards | `packages/api/src/services/ask.ts` |
| Chat UI | Single box, chips, New Chat, match card, SSE | `packages/web/src/components/home-chat.tsx` |
| Calibration | Rolling club-season snapshots + frozen WC 2026 backtest | `packages/api/src/services/club-season-snapshots.ts`, `wc-evaluation.ts` |
| Persistence | No database. Atomic JSON under `PUNDIT_DATA_DIR` | `packages/api/src/services/persistent-store.ts` |

Enabled competitions (`packages/api/src/config/competitions.ts`):

| id | Name | Live model |
|---|---|---|
| `eng.1` | Premier League | yes |
| `uefa.champions_qual` | UCL Qualifiers | yes |
| `fifa.world` | World Cup 2026 | retired; frozen eval only |

Repo history that matters for the thesis:

1. Onchain parimutuel prediction market — removed, tag `archive/onchain-trading-v1`.
2. Live WC 2026 pipeline — retired, credibility kept as `/evaluation/wc-2026`.
3. Club-season pivot + certification hardening — this is the current product.
4. Known next step *inside the repo’s own docs*: a paid unified odds API (The Odds API). Not Kelly. Not pass/play.

---

## 3. What Pundit is not

Holds for both the current app and the thesis destination.

- Not an automated on-chain vault. aVault / USDC deposit / 24/7 Polymarket execution is a later product, not this one.
- Not a personality token. $DKING / $SIRE mechanics are out of scope.
- Not a parlay factory. Accas stay labelled as a risk multiplier if they ever appear.
- Not a “best betting tips” feed. Push slates are allowed. They are not the identity.
- Not a black-box model cult. Model p without a version, a clock, and a later score is marketing.
- Not Score SN44. Computer vision can become an adapter. It is not the wedge.
- Not a reintroduction of Prisma, Postgres, wagmi, or Solidity. `PROJECT_OVERVIEW.md` §8 is explicit.

This is the same discipline as `onchain-monitor`: adapters speak normalized types; venue-specific shapes do not leak above the boundary.

---

## 4. The SIRE arc, translated into Pundit stages

| SIRE stage | What they proved | Pundit equivalent today | Ship rule for the thesis |
|---|---|---|---|
| Feb 2025 chat | A human will talk to it | Live multi-turn chat at `/` | No ship if it only banters. Already true: general tier is labelled. |
| Mar 2025 v0.1.0 | Friction drops when chips exist | Featured fixture chips + table/title fallbacks | Chips must write into the pricing object, not only open a fixture. Today they only open a fixture. |
| May 2025 mobile | Phone + EV math is the product | Responsive chat + `MatchFixtureCard` | Card must show model p, book p, **EV%**, risk band. Today: model p and market p only. |
| Jun 2025 swarm | One box, many agents | Implicit modules inside `ask.ts` | User never addresses agents by name. Keep that. Split the 7k-line file later. |
| Sep 2025 pull mode | User-sourced line adjudication | **Missing.** User text cannot become a line. | `I found X at Y, what’s the +EV?` is v1 of the thesis, not a later nice-to-have. |

Brooks’ three asks become first-class fields, not a later settings page:

| Ask | Field | In repo today |
|---|---|---|
| Attractive price | `play_price` | missing |
| Pass price | `pass_price` | missing |
| How much | `stake_frac` gated on `bankroll` + `risk_band` | missing. Search for Kelly / bankroll / stake_frac across the repo returns nothing. |

Default when bankroll is missing: **do not size.** Print EV and pass. SIRE’s September clip sized small when unspecified. Pundit is stricter. Missing bankroll → no stake number.

---

## 5. Capability map — thesis vs this tree

Legend:

- **Built** — exists on `main` at the audited SHA, with a path.
- **Partial** — spine exists, object does not.
- **Missing** — not in the tree.
- **Out of scope** — will not be copied from SIRE.

### 5.1 Coordinator and conversation

| Capability | Why the thesis needs it | Priority | Status | Path |
|---|---|---|---|---|
| Single input box | SIRE’s whole UX bet | v1 | **Built** | `packages/web/src/components/home-chat.tsx` |
| Auto-prompt on empty chat | Mar 2025 lesson | v1 | **Partial** — featured fixture chips, not H2H/form/prediction chips | `home-chat.tsx` `formatSuggestionChip`, `NO_FIXTURE_SUGGESTIONS` |
| Preset chips (H2H / home / away / prediction / +EV slate) | Reduce prompt tax | v1 | **Missing** as pricing chips. Fixture chips exist. | — |
| New-thread control | Mar 2025 lesson | v1 | **Built** | `startNewChat()` in `home-chat.tsx` |
| Multi-turn fixture context | Follow-ups stay on the match | v1 | **Built** | `teamContext` / `fixtureContext` in `home-chat.tsx` + `ask.ts` |
| Streaming + stop | Desk feel | v1 | **Built** | SSE in `packages/web/src/lib/api.ts`, Stop button |
| Voice input | May/Sep mobile clips | later | **Missing** | — |
| Personality that never overrides the number | Feb distribution, Sep discipline | v1 | **Partial** — `ANALYST_RESPONSE_V2` forbids the model from authoring numbers. No character layer. | `AGENTS.md` |
| Prompt pack as first-class fixtures | The five posts already wrote it | v1 | **Missing** | `evals/chat/scenarios.json` is an eval pack, not a user prompt pack |
| Grounding badges | User must know which tier answered | v1 | **Built** | `GroundingBadge` in `home-chat.tsx` |
| Status bar (`ready` / `partial` / `unpriced` / `no-fixtures` / `unavailable`) | Never advertise a 503 chip | v1 | **Built** | `FixtureState` in `home-chat.tsx` |
| Disclaimer on every card | Compliance | v1 | **Built** | `packages/web/src/components/disclaimer.tsx`, `docs/support/disclaimer.md` |

Canonical prompts the thesis requires. Current behaviour in parentheses.

```
What is the head to head for {home} vs {away}?
  → general or search-backed prose. No structured H2H object.

Home team form. Away team form.
  → evidence-required search. No form module.

Prediction for {match}.
  → match tier if recognized and priced. Closest thing that works today.

Probabilities to win or draw, and the odds at which each outcome is +EV, for: {slate}.
  → one fixture at a time. No slate. No +EV threshold field.

I found {selection} at {odds}. What’s the +EV? Pass or play?
  → user-supplied decimal is not an input type. Missing.

Stake this match. Bankroll {X}. Risk {low|medium|high}.
  → missing. Correct refusal would be the v1 behaviour.
```

### 5.2 Swarm behind the box

SIRE named the agents. Pundit should keep the names as internal modules, not user-facing characters. Today they are functions inside one file.

| Module | Job | Priority | Status | Path |
|---|---|---|---|---|
| Coordinator | Route, hold context, refuse to size without bankroll | v1 | **Partial** — four-tier router exists; no bankroll/profile | `packages/api/src/services/ask.ts` |
| Fixtures | Slate + kickoff + venue | v1 | **Built** (14-day active set, not an arbitrary slate) | `active-fixtures.ts`, `featured-fixtures.ts`, `fixture-registry.ts` |
| Standings | Table context | v1 | **Built** | `football-data.ts`, competition tier in `ask.ts` |
| Team insights | Form, injuries, lineup | v1 | **Partial** — search + citation, no form store | `web-search.ts`, `evidence-page-retrieval.ts`, `claim-verifier.ts` |
| Search / news | Breaking context with source + time | v1.5 | **Built** | `web-search.ts`, provider chain documented in `PROJECT_OVERVIEW.md` §4 |
| Odds | Named venue, decimal, timestamp | v1 | **Partial** — probabilities from Stake/Kalshi/Polymarket, not traditional book decimals | `fixture-market-sources.ts`, `model-market-odds.ts` |
| Prediction | `model_p` with version | v1 | **Built** — model p yes; public `model_version` field weak | `dixon-coles.ts`, `model-data.ts`, `club-strength-artifact.ts` |
| EV | fair, implied, EV%, edge band | v1 | **Partial** — fair odds and no-vig implied p exist as math. EV% and edge band are not typed outputs | `response-correctness.ts` (`decimalImpliedProbability`, `validateCompleteOneXTwoMarket`, `fairDecimalOdds`) |
| Stake allocator | Fractional Kelly after inputs exist | v1.5 | **Missing** | — |
| Resolver | After kickoff, write outcome onto the claim | v1.5 | **Partial** — club-season snapshots seal pre-kickoff forecasts; no public `claim_id` | `club-season-snapshots.ts` |
| Calibration | Brier + CLV by league / market / bucket | v1.5 | **Partial** — Brier / log-loss / winner accuracy / calibration buckets exist. CLV does not | `packages/api/data/evaluation/club-season.json` schema, `wc-evaluation.ts` |

Boundary that already exists and must be kept:

> Specialists only ever emit normalized types. Bookmaker JSON, OpticOdds payloads, LLM prose, and vision features do not leak into the UI layer.

The current UI already consumes `MatchGrounding` plus `oddsSources`. That is the right seam. Extend the type. Do not add a second path.

### 5.3 The pricing object

Thesis schema (non-negotiable when the desk ships):

```
selection
kickoff / venue
model_p
fair_odds
book / line / implied_p
ev_pct
edge_band          # noise | thin | real | fat-and-fragile
risk_band          # low | medium | high
pass_price
play_price
stake_frac         # only after bankroll + risk exist
disclaimer
model_version
priced_at
```

If a screen cannot print that object, it is not the thesis product. It is the current chat.

| Capability | Priority | Status | Evidence |
|---|---|---|---|
| `model_p` for 1X2 | v1 | **Built** | `MatchGrounding.pHome/pDraw/pAway`, `/api/model/active` |
| Fair odds = 1 / model_p | v1 | **Partial** — computed and guarded in prose (`fairDecimalOdds` in `response-correctness.ts`). Not a first-class card field | `response-correctness.ts`, `AGENTS.md` “settles exact-score/fair-price/market … from typed server facts” |
| Named venue + implied p + timestamp | v1 | **Built** for Stake/Kalshi/Polymarket probabilities | `fixture-presentation.ts` `marketRowsFromGrounding` |
| Named sportsbook decimal (bet365, Pinnacle, …) | v1 | **Missing** | Repo’s own next step is The Odds API |
| EV% printed with sign | v1 | **Missing** as a typed field. Side-by-side p is not EV | `MatchFixtureCard` shows percent rows, not edge |
| Edge band that treats +0.34% as noise | v1 | **Missing** | May SIRE clip taught this. Pundit does not encode it |
| Conservative vs high-risk split | v1 | **Missing** | Match prose may mention value; no band enum |
| Pass price and play price | v1 | **Missing** | — |
| Side markets: BTTS, totals | v1.5 | **Partial** — model computes them (`dixon-coles.ts`). Market comparison is 1X2 only | `the-model.md`, `model-market-odds.ts` |
| Correct score as speculative only | later | **Partial** — scorelines exist on the model, stripped from public model payload | `publicModelFixture` drops `scorelines` |
| Multi-book shop (“your 3.00 vs printed 2.65”) | v1 | **Missing** | Pull mode needs a user-line type |
| Value verdict + model-vs-market divergence in prose | v1 | **Partial** — `AGENTS.md` says a match read must state divergence and a value verdict, composed deterministically if omitted | composition lives in `ask.ts` / `response-composer.ts`, not in the card schema |

The May SIRE clip already taught the honesty rule: a +0.34% BTTS is “aligned but thin.” Pundit must never paint that green as if it were Napoli-at-5.00. Today it cannot paint it at all, because EV% is not a field.

### 5.4 Surfaces

| Surface | Priority | Status | Path |
|---|---|---|---|
| Chat homepage | v1 | **Built** | `packages/web/src/app/page.tsx` → `home-chat.tsx` |
| Match card | v1 | **Partial** — probabilities + market rows + prose. No EV / risk / pass / play | `MatchFixtureCard` in `home-chat.tsx` |
| Fixtures board | v1 | **Built** | `packages/web/src/app/fixtures/page.tsx` |
| Model reference | v1 | **Built** | `packages/web/src/app/model/page.tsx` |
| Club-season calibration page | v1.5 | **Built** (artifact often empty early season) | `packages/web/src/app/evaluation/club-season/page.tsx` |
| Frozen WC backtest page | later | **Built** | `packages/web/src/app/evaluation/wc-2026/page.tsx` |
| Mobile web | v1 | **Partial** — responsive chat, safe-area, snap chips. Not a dedicated mobile match-pricing card | `home-chat.tsx` layout |
| Desktop terminal chrome (wallet rail, live ticker) | — | **Out of scope** | Archived with onchain v1 |
| Voice | later | **Missing** | — |
| Wallet / token gate | — | **Out of scope** | Correctly removed |
| Pro tier that hides EV | — | **Do not copy** | — |
| On-chain vault UI | later | **Out of scope for this repo** | tag `archive/onchain-trading-v1` |

Token-gating the EV agent was a SIRE distribution choice. It is a product smell for Pundit. The number is the product. Hide the model if you must. Do not hide the schema.

### 5.5 Truth layer SIRE did not ship in the five posts

This is where Pundit is allowed to be more than a clone. The name of the repo is the brief.

| Capability | Why | Priority | Status | Path |
|---|---|---|---|---|
| Append-only pre-kickoff snapshot ledger | Same instinct as `onchain-monitor` events | v1.5 | **Partial** — immutable pre-kickoff snapshots + market comparison observations | `club-season-snapshots.ts`, `appendMarketComparisons` in `model-market-odds.ts` |
| Public `claim_id` at price time | User-facing receipt | v1.5 | **Missing** | snapshots are operator artifacts, not user claims |
| Resolve against official results | Without this, EV is theatre | v1.5 | **Partial** — ESPN results feed exists; evaluation joins later | `football-data.ts` recent results, evaluation pages |
| Brier by model version | Name of the repo | v1.5 | **Built** as eval metrics | `club-season.json` `metrics.brierScore`, WC artifact |
| Closing-line value, signed | The actual test of whether the printed edge was real | v1.5 | **Missing** | market snapshots exist; CLV is not computed |
| Calibration plot: model p vs hit rate | The thing SIRE marketing skipped | v1.5 | **Partial** — `metrics.calibration` array in the artifact; UI is a page not a plot product | `/evaluation/club-season` |
| Contributor / challenger seam | Grow off ClubElo | later | **Built as empty seam** | `model-contributors.ts` — `ELO_CHAMPION` live, `REGISTERED_CHALLENGERS` empty |
| Human pundit ingest | Optional sibling | later | **Missing** | — |

If the name is Pundit, the ledger is not optional forever. A pricing terminal that never gets scored becomes the thing it was built to replace. The snapshot machinery is the start of that ledger. It is not the product yet.

### 5.6 Data plane

| Source | Role | Priority | Status | Path |
|---|---|---|---|---|
| ESPN fixtures + results + standings | Spine | v1 | **Built** | `football-data.ts` |
| Pinned ClubElo artifact | Strength input | v1 | **Built** — runtime never contacts ClubElo | `club-strength-artifact.ts`, `packages/api/data/model-artifacts/clubelo/` |
| Stake / Kalshi / Polymarket | Reference 1X2 | v1 | **Built**, best-effort, fail isolated | `fixture-market-sources.ts` |
| Traditional sportsbooks | Thesis spine | v1 | **Missing** | documented candidate: The Odds API (`AGENTS.md` Future) |
| Stats / form / xG | Prediction input | v1 | **Missing** as a store. Form is search | — |
| News search | Context, cited | v1.5 | **Built** | `web-search.ts` |
| Prediction-market odds | Second book, not first identity | later | **Built early** — inverted vs thesis. PMs are the current book | `polymarket-data.ts` |
| Score / SN44 vision | Adapter, not wedge | later | **Missing** | — |

v1 of the thesis is sportsbooks + a model. Prediction markets are an odds adapter. The current repo did the opposite: PMs arrived first because they are keyless and public. That is a reasonable bootstrap. It is not the destination book set.

### 5.7 Risk, compliance, tone

| Rule | Status |
|---|---|
| Every card carries “probabilities, not tips” | **Built** — disclaimer component + docs |
| Accas allowed only as an explicit risk-multiplier path | **Missing**, and should stay missing until 1X2 pricing works |
| No stake number without bankroll + risk | **Vacuous today** — no stake path exists. Must be encoded when the path is added |
| Fat EV on a 15–31% shot labelled high-risk, not “lock” | **Missing** — no EV field to label |
| No claim of audited edge without CLV + settled sample | **Held** — eval pages already refuse to treat past Brier as future performance (`disclaimer.md`) |
| Brand must not collide with a major book’s trademark | Learned the hard way by DKING → SIRE. Current name is clear |
| Generated prose cannot author betting recommendations | **Built** — `ANALYST_RESPONSE_V2` | 
| Server-owned facts stay deterministic | **Built** — complete no-search answers bypass MiniMax |

The compliance posture of the current app is stricter than SIRE’s. Keep the strictness. Add the object. Do not add tout copy.

---

## 6. Architecture now, and what it should grow into

### 6.1 What is there

```
packages/web          Next.js 14 chat + reference pages
        │
        ▼
packages/api          Express
        │
        ├── ask.ts                 four-tier coordinator + guards (too large)
        ├── dixon-coles.ts         local model
        ├── football-data.ts       ESPN
        ├── fixture-registry.ts    identity gate
        ├── fixture-market-sources Stake / Kalshi / Polymarket
        ├── model-market-odds.ts   no-vig join
        ├── web-search.ts          search seam
        ├── club-season-snapshots  pre-kickoff ledger
        └── persistent-store.ts    atomic JSON, no DB
```

This is already closer to a desk than a chatbot. The failure mode is concentration: `ask.ts` is the coordinator, the composer, the guard catalogue, and the policy engine.

### 6.2 Target shape for the thesis

```
┌─────────────────────────────────────────────────────────────┐
│  surfaces/          mobile web + desktop terminal           │
│                     one box, chips, match card, claim page  │
├─────────────────────────────────────────────────────────────┤
│  coordinator/       routing, profile, refusal rules         │
│                     split out of ask.ts                     │
├─────────────────────────────────────────────────────────────┤
│  specialists/       fixtures, standings, team, news,        │
│                     odds, prediction, ev, stake, resolver   │
├─────────────────────────────────────────────────────────────┤
│  analytics/         EV, fair odds, Kelly/capped Kelly,      │
│                     Brier, CLV, calibration, edge bands     │
├─────────────────────────────────────────────────────────────┤
│  adapters/          books, stats, results, PM venues        │
│                     later: vision / SN44                    │
├─────────────────────────────────────────────────────────────┤
│  core/types         PricingObject, Claim, BookLine,         │
│                     StakeDecision, Resolution, UserLine     │
│  core/storage       append-only claims + daily snapshots    │
└─────────────────────────────────────────────────────────────┘
```

The boundary that matters:

**Adapters only ever speak `core/types`.**  
A Stake payload, a The Odds API payload, an LLM paragraph, and a vision embedding are not UI types.

`MatchGrounding` + `ValidatedOneXTwoMarket` + `TraceableMatchNumbers` are the embryo of `PricingObject`. Grow those types. Do not invent a parallel schema in the frontend.

---

## 7. What is not built yet (operating list)

This is the backlog against the SIRE thesis, after reading the tree. Items marked *spine exists* should start from the named file, not from a blank page.

### v1 — the desk object

1. **Pricing object as a typed schema**, with tests, independent of any LLM.  
   Start from `response-correctness.ts` (`ValidatedOneXTwoMarket`, `TraceableMatchNumbers`) and `MatchGrounding` in `packages/web/src/lib/api.ts`.

2. **EV math in analytics, not in the prompt.**  
   `ev_pct = model_p * decimal - 1`. Fair odds already conceptually present. Print the signed percent on `MatchFixtureCard`.

3. **Edge band enum** derived from |EV%| and from sample error, not from vibe.  
   Encode the May SIRE lesson: +0.34% is `noise` or `thin`.

4. **Pass price and play price** derived from a stated edge threshold.  
   Example: play if EV ≥ 3% after vig, pass below 1%, abstain in the band. Thresholds are product decisions; the fields are not.

5. **Risk band** from model_p and from market type.  
   A 15% away-win at fat EV is `high`. A 62% BTTS at 0.3% EV is `low` and probably `noise`.

6. **Pull mode / user line.**  
   New input type: `{ selection, decimal, source? }`. Compare against current `model_p`. This is September SIRE. Nothing in `ask.ts` accepts a user decimal today.

7. **Match card upgrade.**  
   Same `MatchFixtureCard`. Add EV%, edge band, risk band, pass/play. Do not build a second UI.

8. **Prompt pack in the empty state.**  
   H2H, home form, away form, prediction, “price this match”, “I found X at Y”. Fixture chips stay. Pricing chips get added.

9. **Refusal: no stake output without bankroll + risk.**  
   When someone asks “how much?”, refuse in deterministic copy. Do not let MiniMax invent a unit.

10. **Sportsbook adapter.**  
    Repo already named The Odds API as the candidate (`AGENTS.md` Future, `PROJECT_OVERVIEW.md` §11). Model stays local. Market comparison moves to a normalized feed with real decimals.

### v1.5 — the receipt

11. **Public claim ledger.**  
    Write a `claim_id` at price time. Reuse `club-season-snapshots.ts` rather than a database. The snapshot ledger is private-operator today.

12. **Result resolver after full time.**  
    ESPN recent results already flow. Join them to claims.

13. **Brier by market and by model version on a user-visible claim page.**  
    Metrics schema already exists. Wire claims into it.

14. **Closing line capture and signed CLV.**  
    `appendMarketComparisons` already stores timestamped market rows. CLV is a signed difference against the last pre-kickoff row. Not built.

15. **News specialist stays cited.**  
    Already built. Do not regress.

16. **Split `ask.ts`.**  
    7,157 lines is a certification artefact, not a target shape. Coordinator, composer, and guards should be modules. Behaviour stays.

### Later — do not start these before 1–10 work

17. Fractional Kelly allocator with drawdown cap.
18. Traditional-book multi-venue shopping beyond one normalized feed.
19. Side-market EV (BTTS, totals) against real book lines, not just model derivatives.
20. Slate pricing across three named matches in one turn.
21. Vision / live-event adapter.
22. Automated execution / vault (different repo, or the archived tag stays archived).
23. Token gate, points, tiers that hide the number.
24. Human-pundit ingest and leaderboard. Only after the model itself is on the same ledger.
25. More leagues. The competition registry is the cheap part. Calibration is the expensive part. Do not add La Liga until club-season Brier on EPL is a real sample.

### Explicitly do not build

- Personality-first kingdom copy.
- Pro tier that hides EV behind a token.
- Reintroduction of the onchain parimutuel.
- Reconnecting live WC pipelines to `/evaluation/wc-2026`.
- Letting search promote a discovery candidate into a priced fixture.
- Letting MiniMax author the pricing object.

---

## 8. What “done” looks like for thesis-v1

A Saturday operator can do this in under two minutes on a phone at thepundit.vercel.app:

1. Open Pundit.
2. Ask for +EV thresholds on a named Premier League match.
3. See model p, fair odds, at least one named venue, EV%, edge band, pass price, play price.
4. Paste a better number they found elsewhere.
5. Get a new EV% against the same `model_p`.
6. Ask for a stake. Get refused until they enter bankroll and risk.
7. After they enter both, get a small, capped fraction — not a heroic unit.
8. Leave with a `claim_id` even if resolution ships in v1.5.

If any of those eight steps requires a Discord role, a token balance, or a paragraph of kingdom copy, v1 is not done.

Today the operator can do steps 1 and a fragment of 3 (model p + venue p, no EV). That is the gap.

---

## 9. How Pundit should differ from SIRE on purpose

Copy the desk object. Do not copy the surrounding theatre.

| SIRE choice | Pundit choice |
|---|---|
| Personality-first launch | Number-first, voice second. Already the house style |
| Token gate + Pro tier on EV | Schema is public; model may be private |
| Green check on +56% EV screenshots | Edge band + risk band required beside every fat print |
| Vault / DeFAI story in parallel | Vault stays at `archive/onchain-trading-v1` |
| No settled ledger in the five posts | Ledger is the namesake. Snapshots are the start |
| Kingdom metaphors | Operator language. Fenomeno Cap already writes this way |
| “Flock of agents” as marketing | One box. Modules stay internal |
| All major leagues claimed in May | Two competitions, calibrated. Honesty over coverage |
| Computer vision as parent story | Adapter later. Dixon-Coles is the v0 model |

Pundit wins if a skeptical user can reconstruct the EV from `model_p` and the book decimal with a pocket calculator. If they cannot, the LLM is doing the math, and the product is lying. The current guard stack (`response-correctness.ts`, `answer-survival.test.ts`, schema-17 chat eval) is the right instinct. Point it at a pricing object.

---

## 10. Decision log

| Decision | Call |
|---|---|
| Thesis | SIRE five-post terminal arc, not the SIRE token or vault |
| Current product | Grounded analysis chat. Keep it working while the object is added |
| Wedge | Bidirectional +EV desk on football 1X2, mobile-first, EPL + UCL qualifiers |
| Name | Pundit means the claim gets scored, not that the UI is a TV analyst |
| Stake | Refused until bankroll + risk exist |
| Markets in thesis-v1 | 1X2. Totals / BTTS EV in v1.5. Accas never as default |
| Venues in thesis-v1 | Named books with decimals. Current PM venues remain adapters |
| Monetization | Out of scope for this vision file. Do not let it design the object |
| Compliance | Keep “analysis only” until the pricing object is honest enough to change the sentence. Changing the sentence is a product decision, not a copy tweak |
| Model | Local Dixon-Coles from pinned artifact. Challenger seam stays empty until a real second contributor exists |
| Repo audit | Completed against `9c8d02b` on 31 Aug 2026 |

---

## 11. Suggested first diffs (smallest path from this tree to the thesis)

Do these in order. Each one is visible on the existing match card.

1. Add `fairOdds` and `evPct` to the server grounding payload, computed from model p and each complete validated 1X2 market. Pure functions in `response-correctness.ts`. Tests only. No UI yet.
2. Render those fields on `MatchFixtureCard` next to the existing percent grid. One extra row per source: decimal, implied, EV%.
3. Add `edgeBand` with hardcoded thresholds and a unit test that classifies +0.34% as thin/noise.
4. Accept an optional `userLine: { outcome, decimal }` on `POST /api/ask`. Return EV against current `model_p`. This is pull mode.
5. Empty-state chip: “I found {home} at {odds} — pass or play?”
6. Deterministic refusal paragraph when the user asks for a stake and no bankroll is in context.
7. Only then: Odds API adapter behind the existing `fixture-market-sources.ts` seam.

Do not start a rewrite of `ask.ts` until 1–4 exist. The file is large because correctness was earned. Split it after the object is typed, so the split has a type to aim at.

---

## 12. Related files

| File | Role |
|---|---|
| `sire-agent-five-posts-synthesis.md` | Thesis source (this artifacts folder) |
| Repo `README.md` | Current product contract |
| Repo `PROJECT_OVERVIEW.md` | Exhaustive as-of 2026-08-25 snapshot |
| Repo `AGENTS.md` / `CLAUDE.md` | Standing constraints for agentic work |
| Repo `docs/overview/product-vision.md` | Short public vision — analysis-first, growth = more competitions / richer markets / deeper calibration |
| Repo `docs/support/disclaimer.md` | Legal posture |
| [fenomenocap/onchain-monitor](https://github.com/fenomenocap/onchain-monitor) | Sibling house style: adapters, honest gaps |

When this file is copied into the repo, put it at `docs/overview/product-vision-master.md` and keep `docs/overview/product-vision.md` as the short public page. Do not silently replace the public page with the SIRE desk language until the object exists. The public page should describe what ships. This file describes what we are building toward.
