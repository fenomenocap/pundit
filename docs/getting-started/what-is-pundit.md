# What is Pundit

Pundit is a chat-first prediction-analysis app for the 2026 FIFA World Cup. You ask a question about a matchup in plain English, and Pundit answers with a grounded, model-backed read — headline win/draw/win odds, an over/under 2.5 goals view, the most likely scorelines, and a note on what would need to happen for the underdog to cover.

It is **not** a betting or trading product. Pundit doesn't take positions, doesn't hold funds, and doesn't offer any way to place a wager. It surfaces model output and public market prices for informational purposes only — see the [Disclaimer](../support/disclaimer.md).

### What makes an answer

Every answer in the chat is grounded in three things, computed before the model ever talks to you:

1. **Model probabilities** for that specific fixture — win/draw/win and expected-goals-derived outcomes, from a Dixon-Coles Poisson model calibrated on live Elo ratings
2. **Market prices** for the same fixture, where available — no-vig implied probabilities pulled from Stake's live 1X2 odds, so you can see how the model's read compares to what the market thinks
3. **Live web search**, used only when current injury, squad, or form news would materially change the read — the model won't invent news it doesn't have

All World Cup 2026 matches are played at neutral venues, so "home" and "away" in Pundit's data are positional labels only — they don't imply a home-field advantage.

### What you can do today

* Ask the chat about any confirmed fixture ("France vs Morocco")
* Browse the full [fixtures, results, and group standings](how-to-use.md#fixtures--standings)
* Browse the underlying model's own site, embedded directly in Pundit, for the full slate of team and fixture probabilities
