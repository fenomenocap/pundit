# How to Use Pundit

Pundit’s homepage is the **Desk**. Primary nav is Desk, Paper, Draft, and Vaults. Fixtures, Model, and Ledger live in the secondary nav. A previous chat-only homepage is kept at `/legacy`.

### The desk

The desk is a live slate of recognized, priced Premier League and UCL-qualifier fixtures plus an analyst pane on the same `/api/ask` contract as before.

Select a fixture from the rail or chips, or type a question. Follow-ups stay on that fixture until you pick another.

**Match questions** receive win/draw/win, over/under 2.5, BTTS, and likely scorelines from Pundit’s model, plus any available Stake, Kalshi, or Polymarket 1X2 prices. Shorthand such as `BTTS?`, `o2.5`, or “possible scorelines” is settled from those same numbers — not by restating the 1X2 favourite.

**Competition questions** (e.g. “Who leads the Premier League?”) are grounded in the current ESPN standings table.

**Season outlook questions** (e.g. “Who wins the title?” or “Top-four chances”) use a Monte Carlo simulation over remaining Premier League fixtures.

**General football questions** are clearly labelled as not grounded in Pundit’s statistical model.

Match grounding is not always available, and the desk says which case applies rather than failing silently:

* **No fixtures in the window** — between rounds, or before the league season starts.
* **Recognized but outside coverage** — identity is established, but competition or policy is outside the public model (including recognized friendlies). No Pundit probabilities.
* **Temporarily unavailable** — the model is initializing or refreshing.
* **Missing model input** — required ratings, venue state, or other context is unavailable. Fail closed, no probabilities.
* **Identity not established** — user text or search may suggest a matchup, but without an approved structured identity it remains a discovery candidate.

`current table` and `current standings` refer to the most recent competition you named; with none in view, Pundit uses the Premier League as its only league-style table. Other vague pronouns do not silently inherit a competition. **New Chat** in the analyst pane clears conversation. Up to twelve history turns (six exchanges) carry forward.

Every no-search response with complete match, non-priced fixture, competition, or season grounding is answered directly without a MiniMax call. Saying “current” does not by itself trigger external search when the requested fact is already in Pundit’s table, model, or season grounding. Clearly current injury, squad, manager, transfer, odds, and form questions still search first. Questions are capped at 500 characters; the API allows 10 requests per minute. You can paste a found decimal on a 1X2 outcome to get pass/play from `modelP × decimal − 1`. Pundit will not size a stake without a bankroll.

### Paper, Draft, and Vaults

These three routes are a **local paper lab** on the same live slate. They are not a bookmaker, not a deposit product, and not on-chain.

* **Paper** (`/board`) — walk the slate, attach paper legs, and settle against scores in the browser.
* **Draft** (`/draft`) — a draft-room layout over the same fixtures.
* **Vaults** (`/vault`) — paper “model books” with simulated credit. The page itself says it is not a fund.

Nothing you do here places a real wager or moves money off the device.

### Fixtures & Standings

The Fixtures page shows schedules and results across enabled competitions (Premier League and UCL qualifiers). Live matches show current scores. Each fixture can be opened on the desk. Standings appear below the schedule for league competitions.

### Predictions (Model)

The Model page is a read-only table of active fixture probabilities: 1X2, totals, BTTS, and top scorelines. Expand a row for full detail. This is the same cache that powers match-grounded desk answers — not a separate model path.

### Evaluation (Ledger)

* **`/evaluation/club-season`** — rolling pre-kickoff seals. The first eligible Fundamental forecast in the 90-minute window (`pre-kickoff-90m-v1`) is kept. Live volume is Railway `/data`, not the empty in-repo seed.
* **`/evaluation/wc-2026`** — frozen World Cup 2026 backtest. Historical only.

See [Evaluation API](../api-reference/evaluation.md) for the JSON endpoints.
