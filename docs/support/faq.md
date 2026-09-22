# FAQ

**Can I bet or trade on Pundit?**
No. Pundit doesn't run markets, hold funds, or offer any way to place a wager. It's an analysis tool — see the [Disclaimer](disclaimer.md).

**Which questions receive model-grounded answers?**
Four tiers:

1. **Match** — recognized, policy-eligible fixtures in the 21-day active window (Premier League and UCL qualifiers) with the required model inputs
2. **Competition** — league table / standings questions for enabled competitions
3. **Season** — Premier League title race and top-four outlook (Monte Carlo over remaining fixtures)
4. **General** — everything else, clearly labelled as not grounded in Pundit's model

A recognized fixture can still be outside public model coverage, temporarily unavailable, or missing required inputs. In those cases Pundit retains the fixture for follow-ups and labels the reason, but emits no Pundit probabilities. User/search discoveries without an approved structured identity remain candidates and receive no fixture badge.

**What's the difference between model probabilities and market odds?**
Model probabilities are computed locally by Pundit's Dixon-Coles engine from ClubElo ratings — they are Pundit's independent estimate of match outcomes. Market comparison odds are reference prices from Stake, Kalshi, and Polymarket, normalized to no-vig 1X2 probabilities. When both appear in a match answer, they show where public markets agree or disagree with the model. Pundit does not execute trades on any platform.

**How current is the data?**
Refresh speeds up when a match is on. With nothing in play and no kickoff inside 24 hours, ESPN fixtures and standings refresh every 30 minutes, market odds every 30 minutes, and the active model every hour. On a match day those become 10 minutes, 10 minutes, and 30 minutes. While a match is in play they become 2 minutes, 5 minutes, and 15 minutes. Club strengths are loaded from a reviewed content-addressed release artifact, so ClubElo availability cannot affect startup or a running deployment. Hash, coverage and 30-day freshness checks fail closed. The Fixtures page shows the ESPN cache timestamp and re-polls about once a minute while a match is in play.

**Does recognizing a fixture mean Pundit has priced it?**
No. Recognition establishes a structured identity; capability separately decides whether the public model can price it. Friendlies remain outside public model coverage, and missing ratings or venue context fail closed.

**Does "home"/"away" imply home-field advantage?**
For Premier League and UCL-qualifier fixtures, yes when the venue is not marked neutral — the model applies a configured home-field boost. Neutral-site matches get 0. Home/away labels still come from ESPN.

**Can I ask BTTS or over 2.5 without getting the 1X2 favourite again?**
Yes. Those markets are already on the score grid. The desk settles `BTTS`, `o2.5` / `U2.5`, and likely scorelines from the same fixture facts. A market Pundit does not price (player, Asian, corners) is refused rather than answered with the favourite.

**Are Paper, Draft, and Vaults real bets?**
No. They are a local paper lab on the live slate. Nothing is a deposit, a bookmaker ticket, or an on-chain vault.

**What are the evaluation pages?**
`/evaluation/club-season` (Ledger in the nav) shows rolling 90-minute pre-kickoff seals for club fixtures. Live volume is on Railway `/data`. `/evaluation/wc-2026` is a frozen World Cup 2026 backtest — historical only, not live forecasts.

**Is there an API?**
Yes, all data shown in the app is available read-only with no authentication (except chat, which requires `MINIMAX_API_KEY` on the server). See the [API Reference](../api-reference/overview.md).
