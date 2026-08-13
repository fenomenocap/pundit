# FAQ

**Can I bet or trade on Pundit?**
No. Pundit doesn't run markets, hold funds, or offer any way to place a wager. It's an analysis tool — see the [Disclaimer](disclaimer.md).

**Which questions receive model-grounded chat answers?**
Four tiers:

1. **Match** — recognized, policy-eligible fixtures in the 14-day active window (Premier League and UCL qualifiers) with the required model inputs
2. **Competition** — league table / standings questions for enabled competitions
3. **Season** — Premier League title race and top-four outlook (Monte Carlo over remaining fixtures)
4. **General** — everything else, clearly labelled as not grounded in Pundit's model

A recognized fixture can still be outside public model coverage, temporarily unavailable, or missing required inputs. In those cases Pundit retains the fixture for follow-ups and labels the reason, but emits no Pundit probabilities. User/search discoveries without an approved structured identity remain candidates and receive no fixture badge.

**What's the difference between model probabilities and market odds?**
Model probabilities are computed locally by Pundit's Dixon-Coles engine from ClubElo ratings — they are Pundit's independent estimate of match outcomes. Market comparison odds are reference prices from Stake, Kalshi, and Polymarket, normalized to no-vig 1X2 probabilities. When both appear in a match answer, they show where public markets agree or disagree with the model. Pundit does not execute trades on any platform.

**How current is the data?**
ESPN fixtures/standings and active market odds refresh every 30 minutes; ClubElo ratings and the active model refresh hourly. If a source is briefly unavailable, Pundit keeps the last-known-good data. The Fixtures page shows the ESPN cache timestamp and re-polls while matches are live.

**Does recognizing a fixture mean Pundit has priced it?**
No. Recognition establishes a structured identity; capability separately decides whether the public model can price it. Friendlies remain outside public model coverage, and missing ratings or venue context fail closed.

**Does "home"/"away" imply home-field advantage?**
For Premier League fixtures, yes — the model applies a configured home-field boost. For UCL qualifiers and neutral-site matches, home/away are positional labels from ESPN; advantage is applied only where configured.

**What are the evaluation pages?**
`/evaluation/club-season` shows rolling pre-kickoff calibration snapshots for finished club fixtures. `/evaluation/wc-2026` is a frozen World Cup 2026 backtest — historical only, not live forecasts.

**Is there an API?**
Yes, all data shown in the app is available read-only with no authentication (except chat, which requires `MINIMAX_API_KEY` on the server). See the [API Reference](../api-reference/overview.md).
