# Pundit — Shared Goal Contract

**For:** Grok sessions and ChatGPT Codex `/goal`  
**Repo:** `fenomenocap/pundit`  
**North star:** `pundit-product-vision.md`  
**Thesis source:** `sire-agent-five-posts-synthesis.md`  
**Standing repo law:** `AGENTS.md` then `CLAUDE.md`  
**Date:** 31 August 2026

Codex `/goal` text is capped at **4,000 characters**. Do not paste this whole file into `/goal`.

**Canonical paste is §8 “Durable goal”.** Slice-specific blocks below it are optional accelerators. If a slice is already merged, the durable goal still works: the agent must detect the next unfinished slice from this file and from the tree, not from memory of an old prompt.

---

## 1. One-sentence objective

Take SIRE as inspiration for the job — a human can ask a price, bring their own line, and leave with a number they can check — then build that job in Pundit’s existing product, not as a SIRE clone.

Copy the instinct: model p versus a named line, signed EV, pass/play, no stake without bankroll. Do not copy SIRE’s voice, chips, agent names, token gate, Pro tier, vault, kingdom copy, green-check marketing, multi-league claim, or UI chrome.

Grow the current Pundit match card and deterministic fact slots. Current product stays a read-only analysis app until the object exists and is reconstructable with a pocket calculator.

---

## 2. How two LLMs use this without colliding

| Who | Default lane | Allowed paths | Forbidden while the other lane is open |
|---|---|---|---|
| **Codex** | Lane A — typed math and grounding payload | `packages/api/src/services/response-correctness.ts` (+ its tests), `packages/api/src/services/response-facts.ts`, `packages/api/src/services/response-composer.ts`, grounding types that already feed `/api/ask` | Do not restyle `home-chat.tsx`. Do not rewrite `ask.ts`. |
| **Grok** | Lane B — card + chips + copy | `packages/web/src/components/home-chat.tsx`, `packages/web/src/lib/fixture-presentation.ts`, `packages/web/src/lib/api.ts` (types only), `packages/web/src/components/disclaimer.tsx` | Do not invent a second EV formula. Consume Lane A field names exactly. |
| **Either, later** | Lane C — pull mode | `packages/api/src/routes/ask.ts` (request validation only), `packages/api/src/services/ask.ts` *only* to thread a new optional `userLine` into existing fact slots | No drive-by refactors inside `ask.ts`. |

Rules of engagement:

1. Read `AGENTS.md`, `pundit-product-vision.md` §§7–11, and this file before editing.
2. Implement the schema in §3 exactly. Do not rename fields.
3. One slice per session. Stop when that slice’s verification command is green.
4. Leave a short receipt at the bottom of your PR or session: files touched, command run, what is still missing.
5. If a type is not on the wire yet, Lane B renders `null` / omit. Do not compute EV in the browser.
6. Do not start Lane C until Lane A tests exist.

---

## 3. Locked schema (do not freelance)

Add these to the **server-owned match grounding / fact slots**. Generated prose may *refer* to them. It may not author them.

```ts
type EdgeBand = "noise" | "thin" | "real" | "fat-and-fragile";
type RiskBand = "low" | "medium" | "high";
type OneXTwoOutcome = "home" | "draw" | "away";

interface PricingLeg {
  outcome: OneXTwoOutcome;
  modelP: number;            // 0–1, already on MatchGrounding
  fairOdds: number;          // 1 / modelP
  decimalOdds: number | null;
  impliedP: number | null;   // 1 / decimalOdds when decimal exists
  evPct: number | null;      // modelP * decimalOdds - 1, else null
}

interface MarketPricingRow {
  source: string;            // "stake" | "kalshi" | "polymarket" | later book ids
  observedAt: string;
  legs: Record<OneXTwoOutcome, PricingLeg>;
  edgeBand: EdgeBand | null; // from the fattest printable |evPct| on this row
}

interface PricingObject {
  fixtureId: string;
  home: string;
  away: string;
  kickoff: string;
  modelVersion: string;      // rating artifact id + sha prefix already on /ready
  pricedAt: string;
  model: Record<OneXTwoOutcome, { p: number; fairOdds: number }>;
  markets: MarketPricingRow[];
  userLine: {
    outcome: OneXTwoOutcome;
    decimalOdds: number;
    evPct: number;
    edgeBand: EdgeBand;
    passPrice: number;
    playPrice: number;
    riskBand: RiskBand;
  } | null;
  stakeFrac: null;           // always null until bankroll + risk exist
}
```

### Math (pure functions, test first)

Put these in `response-correctness.ts`. No I/O. No MiniMax.

```
fairOdds(p)              = 1 / p                         if 0 < p < 1 else null
impliedP(decimal)        = 1 / decimal                   if decimal > 1 else null
evPct(modelP, decimal)   = modelP * decimal - 1          if both valid else null
```

Do **not** recover a fake decimal from a no-vig probability. Current Stake/Kalshi/Polymarket rows on the card are probabilities. EV% is printable only when a real decimal exists (`ValidatedOneXTwoMarket.decimalOdds`). If only no-vig p exists, print the probability grid as today and leave `evPct: null`.

### Edge band (temporary constants, named so they can move)

Classify by absolute EV when `evPct` is not null:

| \|evPct\| | band |
|---|---|
| < 0.01 | `noise` |
| < 0.03 | `thin` |
| < 0.08 | `real` |
| ≥ 0.08 | `fat-and-fragile` |

A +0.34% BTTS-style print is `noise`. That is the May SIRE lesson. Encode it in a test.

### Pass / play (temporary constants)

On a user line or a row with decimal odds:

- `playPrice` = `fairOdds * (1 + 0.03)`
- `passPrice` = `fairOdds * (1 + 0.01)`
- Play if `decimal >= playPrice`. Pass if `decimal < passPrice`. Else abstain. Do not say “lock”.

### Risk band

- `low` if `modelP >= 0.50` and band is `noise` or `thin`
- `high` if `modelP < 0.25` or band is `fat-and-fragile`
- else `medium`

### Stake

`stakeFrac` stays `null`. If the user asks how much to stake and no bankroll is in context, return the existing deterministic match payload plus this exact sentence (server-composed, not generated):

> I can print the price. I will not size a stake without a bankroll and a risk band.

Do not let MiniMax invent a unit.

---

## 4. Standing constraints (from the repo, non-negotiable)

Copied from `AGENTS.md` / vision. Violation = slice failed even if tests pass.

- Complete server-owned answers stay deterministic. MiniMax does not restate capability reasons as guessed lineups, venues, ratings, or policy.
- `ANALYST_RESPONSE_V2`: generated prose cannot author probabilities, fair odds, gaps, source IDs, betting recommendations, or lineup effects.
- Search cannot promote a discovery candidate into a priced fixture.
- Capability reason strings stay verbatim.
- `/evaluation/wc-2026` stays frozen.
- `/model` stays on `/api/model/*`. No second model path.
- Do not reintroduce Prisma, Postgres, wagmi, Solidity, token gates, or vault UI.
- Do not rewrite `packages/api/src/services/ask.ts` except to thread a new typed field through existing fact slots.
- Keep the public disclaimer: analysis, not a wager, nothing to buy — until a human decides the sentence should change. Adding EV% to a card is not permission to add tout copy.
- No new npm dependencies for slices 1–3.

---

## 5. Slices (one `/goal` per slice)

### Slice 1 — typed EV math (Lane A, start here)

**Outcome:** Pure functions + tests for `fairOdds`, `impliedP`, `evPct`, `edgeBand`, `riskBand`, `passPrice`, `playPrice`. No UI required.

**Touch:** `packages/api/src/services/response-correctness.ts` and `response-correctness.test.ts` (create the test file if needed; prefer extending an existing correctness suite).

**Verify:**

```bash
pnpm --filter api exec vitest run src/services/response-correctness.ts src/services/response-correctness.test.ts
```

If the test file lives next to another suite, run that file. Typecheck `packages/api`.

**Done when:**

- +0.34% classifies as `noise`
- `evPct(0.20, 7.00)` is `0.40`
- `evPct` is `null` when decimal is missing
- no decimal is invented from no-vig p
- existing API tests still pass

### Slice 2 — grounding payload (Lane A)

**Outcome:** Match grounding returned by `/api/ask` includes `pricing: PricingObject` with `markets[].legs.*.evPct` filled only where decimals exist. Prose still cannot author those numbers.

**Touch:** fact-slot / grounding types already consumed by `packages/web/src/lib/api.ts`. Thread through composer. Smallest possible `ask.ts` touch.

**Verify:** existing `ask.test.ts` still green for match-tier fixtures; add one assertion that `pricing.model.home.fairOdds === 1 / pHome` within float tolerance.

**Done when:** a priced fixture response contains `pricing` and a match answer emptied by guards still fails over to deterministic grounding including `pricing`.

### Slice 3 — card (Lane B)

**Outcome:** `MatchFixtureCard` shows, per market row that has a decimal: implied p, EV% with sign, edge band. Rows without decimal look as they do today.

**Touch:** `home-chat.tsx`, `fixture-presentation.ts`, `api.ts` types.

**Verify:**

```bash
pnpm --filter web test:e2e
```

Plus a unit-level presentation helper test if you add one. Do not compute EV in the browser.

**Done when:** the card can be reconstructed with a calculator from `modelP` and `decimalOdds` shown on screen.

### Slice 4 — pull mode (Lane A+B, after 1–3)

**Outcome:** `POST /api/ask` accepts optional `{ userLine: { outcome, decimalOdds } }`. Returns `pricing.userLine`. Empty-state chip copy only: “I found {home} at {odds} — pass or play?”

**Done when:** a test sends `userLine: { outcome: "away", decimalOdds: 7 }` and gets `evPct` from server math, plus pass/play/risk, and `stakeFrac: null`.

### Slice 5 — stake refusal (either lane, tiny)

**Outcome:** stake / “how much” questions receive the exact refusal sentence in §3. No Kelly yet.

### Later slices (do not start)

Sportsbook Odds API adapter, claim_id ledger, CLV, Kelly, more leagues, `ask.ts` split, vault, token gate. See vision §7.

---

## 6. Definition of done for thesis-v1 (all slices)

A Saturday operator on the chat homepage can:

1. Open a priced Premier League fixture chip.
2. See model p, fair odds, at least one named venue.
3. See EV% and edge band when a decimal exists; see no fake EV when it does not.
4. Paste / attach a found decimal and get EV against the same `modelP`.
5. Ask for a stake and be refused until bankroll + risk exist.
6. Reconstruct every printed EV with `modelP * decimal - 1`.

If any step requires a Discord role, a token, or kingdom copy, it is not done.

---

## 7. Blockers and receipts

A blocked item is not a stopped run. Park it with a receipt, keep partial work, and immediately continue the next in-scope slice that does not depend on the blocker. Never idle.

Park and continue when a slice is stuck on a missing key, flaky network, empty fixture window, a drifted test path, or a field the other lane has not shipped yet.

Do not treat a blocker as permission to:

- Rewrite `ask.ts` rather than thread a field
- Invent a decimal from no-vig p
- Add a dependency, database, or wallet
- Change club-strength artifact hash / freshness
- Drift from the §3 schema
- Start vision-§7 later work (Odds API, claim ledger, CLV, Kelly, more leagues, vault)

Only halt the run when slices 1–5 are all green, or every remaining in-scope item is parked on the same human decision GOAL.md / AGENTS.md cannot resolve. The final receipt must list parked items and the input that would unpark them.

Receipt format when you park, finish a slice, or finish the run:

```
slice: N
files: …
verify: <command> → pass/fail
still missing: …
schema drift: none | <field>
```

---

## 8. Paste-ready Codex `/goal` blocks

Enable goals if needed: `codex features enable goals` or `[features] goals = true` in `~/.codex/config.toml`.

Optional first move: `/plan` against this file, then `/goal` the durable block.

When this file or the vision changes, **do not rewrite the durable `/goal`**. Change the files. The goal is a pointer plus standing law.

### Durable goal (use this)

```
/goal Build Pundit thesis-v1 from pundit-GOAL.md and pundit-product-vision.md. SIRE is inspiration for the job only — a user can price a match or bring a line and leave with a reconstructable number — not a spec to clone. Do not copy SIRE voice, chips, agent names, token gate, Pro tier, vault, kingdom copy, green-check marketing, or UI. Build on Pundit’s existing match card and house style: server-owned model p, fair odds, named line, signed EV% = modelP × decimal − 1, edge band, pass/play, optional userLine, stakeFrac null until bankroll and risk exist, MiniMax must not author those numbers. Read AGENTS.md, CLAUDE.md, then GOAL.md §§3–7; if this prompt and GOAL.md disagree, GOAL.md wins. Work unfinished GOAL.md §5 slices (math → grounding payload → card → pull mode → stake refusal). If a slice hits an issue, do not stop: keep partial work, receipt the blocker, continue the next independent in-scope item; only halt when 1–5 are green or every remaining item is parked on a human decision. Do not rewrite ask.ts except to thread fact slots; do not compute EV in the browser; do not invent decimals from no-vig p; do not add dependencies, a database, a wallet, a vault, a token gate, tout copy, reopen wc-2026, or start vision-§7 later work as a workaround. After each slice run its verify command and leave a receipt.
```

### Slice accelerators (optional)

### Slice 1 (start)

```
/goal Implement Pundit slice 1 from pundit-GOAL.md: pure pricing math in packages/api/src/services/response-correctness.ts with tests. Add fairOdds, impliedP, evPct (modelP * decimal - 1), edgeBand, riskBand, passPrice, playPrice using the exact field names and thresholds in pundit-GOAL.md §3. Do not invent decimals from no-vig probabilities. Do not touch ask.ts, home-chat.tsx, or add dependencies. Read AGENTS.md and pundit-product-vision.md §§7–11 first. Verify with the api vitest command in pundit-GOAL.md §5 slice 1 and keep existing api tests green. Stop when +0.34% is noise, evPct(0.20, 7.00) is 0.40, missing decimal returns null, and write the receipt format from §7.
```

### Slice 2

```
/goal Implement Pundit slice 2 from pundit-GOAL.md: attach a server-owned pricing object to match grounding on POST /api/ask using the §3 TypeScript names. Fill evPct only where ValidatedOneXTwoMarket.decimalOdds exists. ANALYST_RESPONSE_V2 still forbids MiniMax from authoring those numbers. Smallest possible ask.ts change — thread fact slots only, no rewrite. Do not change the web card. Read AGENTS.md first. Verify with existing ask tests plus one fairOdds = 1/pHome assertion. Keep wc-2026 frozen. Stop with the §7 receipt.
```

### Slice 3

```
/goal Implement Pundit slice 3 from pundit-GOAL.md: render pricing.markets on MatchFixtureCard via fixture-presentation.ts. Show signed EV% and edge band only when evPct is not null. Do not compute EV in the browser. Do not restyle the whole chat. Do not edit packages/api except web type imports. Read AGENTS.md and keep the analysis-only disclaimer. Verify with pnpm --filter web test:e2e. Stop with the §7 receipt.
```

### Slice 4

```
/goal Implement Pundit slice 4 from pundit-GOAL.md: optional userLine { outcome, decimalOdds } on POST /api/ask that returns pricing.userLine from server math in response-correctness.ts. stakeFrac stays null. Add the empty-state chip copy only. Do not implement Kelly. Do not rewrite ask.ts beyond request validation and fact-slot threading. Tests must prove evPct comes from modelP * decimal - 1. Read AGENTS.md. Stop with the §7 receipt.
```

### Slice 5

```
/goal Implement Pundit slice 5 from pundit-GOAL.md: when a match-tier user asks how much to stake and no bankroll is in context, append the exact refusal sentence in pundit-GOAL.md §3 using server composition, not MiniMax. stakeFrac stays null. No Kelly. No new pages. Tests cover the sentence. Read AGENTS.md. Stop with the §7 receipt.
```

---

## 9. Grok session opener (not a `/goal`)

Paste this as the first message in a Grok coding session when working Lane B or reviewing a Codex diff:

```
Hold pundit-GOAL.md and pundit-product-vision.md as the contract.
You are on Lane B unless I name another lane.
Schema in GOAL.md §3 is locked. Do not rename fields. Do not compute EV in the browser.
Read AGENTS.md before editing. One slice only. Stop with the §7 receipt.
```

---

## 10. What this file is not

- Not permission to ship tout copy or a vault.
- Not a rewrite plan for `ask.ts`.
- Not a change to the public `docs/overview/product-vision.md` page. That page describes what ships. This file describes the next verified slices toward the thesis.
- Not betting advice.

Drop `pundit-GOAL.md` and `pundit-product-vision.md` into the repo as:

- `docs/overview/product-vision-master.md`
- `docs/GOAL.md`

Keep `AGENTS.md` as the standing boundary file Codex already reads.
