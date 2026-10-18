# Pundit chat transcript — 2026-10-18

- Run `2026-10-18T13-09-24-134Z` · overall **ISSUES FOUND** · progress complete
- API `dd17ba5` · scenarios 73 (pass 69, inconclusive 4, fail 0)
- Turns 73 · answered 73 · with citations 5 · median latency 157 ms
- Quality signals: 0 repeated sentence(s), 0 near-duplicate answer pair(s), 0 uncited current-news turn(s)
- Request engine: **both**
- Eval quality: template 14%, LLM rate 7%, citations 7%

- Engine comparison (legacy vs agent): template 0.14 → 0.23, citations 0.07 → 0.26


## Findings

None.

## Conversations

### homepage-desk-output — PASS (fixed)

**Turn 1 · Q:** Give me the match briefing for Forest vs Arsenal. Tactics, who decides it, and the model lean.

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 394 ms_

> I make Arsenal the likeliest outcome at 69.6%. For 18 October 2026, my full 1X2 is Forest 9.6%, draw 20.8% and Arsenal 69.6%.
> 
> I lean to Arsenal away from home. If Forest draw Arsenal's first press towards the ball, a supporting receiver could become free beyond it; a late or poorly directed pass could instead invite a turnover. If Arsenal close the central passing lanes, Forest could use width to pull a defender out and seek a cut-back, while committing both full-backs would leave less cover against a counterattack. If either side escapes the press with a switch or a pass behind the defence, the players who stayed back would need to cover the runner and delay the attack. Those are tactical possibilities, not confirmed selections or playing styles.
> 
> I’d watch the receiver beyond the first press, the screening midfielder covering for an advancing full-back, and the striker attacking a cut-back. If the receiver can turn, they could connect the attack; if the screening midfielder is pulled towards the ball, a runner could exploit the space behind; if the striker times the run, they could reach the delivery before a defender. Those are roles to watch, not a claim about confirmed starters or a player scoring forecast.
> 
> Both teams to score is 47.6%. The leading scorelines are 0-1 (14.3%), 0-2 (13.6%), 1-2 (12.1%). I estimate goals from historical scoring patterns and team ratings; these are forecasts, not guarantees.
> 
> Kalshi market-implied probabilities: Forest 15.8%, draw 23.8%, Arsenal 60.4%. Polymarket market-implied probabilities: Forest 15.4%, draw 24.4%, Arsenal 60.2%. On Arsenal, I am at 69.6% and Polymarket is at 60.2%: I am 9.4 percentage points higher on Arsenal. That establishes the disagreement, not its cause or a bet to place.
> 
> Pundit Fundamental is my model-only 1X2 above. Pundit Consensus, a separate view shrunk toward Kalshi market (no-vig), is Forest 12.7%, draw 22.3% and Arsenal 65.0%.
> 
> I would revisit the read only after verified team news or a materially different line from the source named above; I can’t assign a lineup effect from these facts alone.

**Turn 2 · Q:** What about over and under 2.5? Why do they add to 100%?

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 347 ms_

> I have over 2.5 at 51.0%; under 2.5 is 49.0%. Under covers fewer than three goals; over covers three or more. There is no push at a half-goal line, so their probabilities sum to one. Decimal odds are the reciprocals of those probabilities. I estimate goals from historical scoring patterns and team ratings; these are forecasts, not guarantees.

### pinned-current-manager-and-result-evidence — PASS (fixed)

**Turn 1 · Q:** What's Forest's manager today?

_grounding=match · capability=priced · citations=1 · verification=verified · HTTP 200 · 27769 ms_

> Forest’s manager is Oliver Glasner ([Oliver Glasner press conference: Crystal Palace vs Nottingham Forest - BBC Sport](https://www.bbc.com/sport/football/articles/cm3vqpkyl7g3o) · 9 Oct).

**Turn 2 · Q:** Who is Forest's manager and why?

_grounding=match · capability=priced · citations=1 · verification=verified · HTTP 200 · 13649 ms_

> Forest’s manager is Oliver Glasner ([Oliver Glasner press conference: Crystal Palace vs Nottingham Forest - BBC Sport](https://www.bbc.com/sport/football/articles/cm3vqpkyl7g3o) · 9 Oct). I haven’t verified the club’s stated reason for choosing or retaining him.

**Turn 3 · Q:** What is Forest's latest result and why?

_grounding=none · capability=n/a · citations=1 · verification=verified · HTTP 200 · 114 ms_

> The latest completed result I have for Forest in my covered competitions is **Crystal Palace 3–1 Forest** (Premier League, 2026-10-11): Crystal Palace won. ([ESPN match record, 2026-10-11](https://www.espn.com/soccer/match/_/gameId/401879266)). I cover the Premier League and Champions League qualifiers here; another cup match may be more recent. The score establishes the outcome; I would need a verified match report to explain why it happened.

### owned-premier-league-latest-result — PASS (fixed)

**Turn 1 · Q:** What is Arsenal's latest Premier League result?

_grounding=none · capability=n/a · citations=1 · verification=verified · HTTP 200 · 100 ms_

> The latest completed Premier League result I have for Arsenal is **Arsenal 2–1 Leeds** (Premier League, 2026-10-10): Arsenal won. ([ESPN match record, 2026-10-10](https://www.espn.com/soccer/match/_/gameId/401879268)).

### dated-club-news-delivers-supported-update — PASS (fixed)

**Turn 1 · Q:** What are the latest dated club injury updates for Forest and Arsenal? Keep current reports distinct from future kickoff availability.

_grounding=match · capability=priced · citations=1 · verification=verified · HTTP 200 · 19418 ms_

> In an update published on 2026-10-16, Arsenal’s William Saliba was sidelined with a back injury ([Injury latest on Zubimendi, Hincapie, Tzolis and Saliba | Arsenal FC Official Website | Arsenal.com](https://www.arsenal.com/news/injury-latest-on-zubimendi-hincapie-tzolis-and-saliba-a2zDM9u0H6CB) · 16 Oct). These dated club updates do not establish the starting XI or availability at the future kickoff. I couldn’t establish a verified, dated Forest club update.

### active-match-grounding — PASS (fixed)

**Turn 1 · Q:** What does Pundit's model say about Forest vs Arsenal?

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 130 ms_

> My 1X2 is Forest 9.6% (fair 10.44), draw 20.8% (fair 4.81) and Arsenal 69.6% (fair 1.44). I need a captured decimal line before I can print EV% or pass or play.

### priced-fixture-retains-1x2-context — PASS (fixed)

**Turn 1 · Q:** Analyse Forest vs Arsenal.

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 129 ms_

> I make Arsenal the likeliest outcome at 69.6%. For 18 October 2026, my full 1X2 is Forest 9.6%, draw 20.8% and Arsenal 69.6%.
> 
> Both teams to score is 47.6%. The leading scorelines are 0-1 (14.3%), 0-2 (13.6%), 1-2 (12.1%). I estimate goals from historical scoring patterns and team ratings; these are forecasts, not guarantees.
> 
> Kalshi market-implied probabilities: Forest 15.8%, draw 23.8%, Arsenal 60.4%. Polymarket market-implied probabilities: Forest 15.4%, draw 24.4%, Arsenal 60.2%. On Arsenal, I am at 69.6% and Polymarket is at 60.2%: I am 9.4 percentage points higher on Arsenal. That establishes the disagreement, not its cause or a bet to place.
> 
> Pundit Fundamental is my model-only 1X2 above. Pundit Consensus, a separate view shrunk toward Kalshi market (no-vig), is Forest 12.7%, draw 22.3% and Arsenal 65.0%.
> 
> I would revisit the read only after verified team news or a materially different line from the source named above; I can’t assign a lineup effect from these facts alone.

**Turn 2 · Q:** What will the 1X2 be?

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 333 ms_

> My 1X2 is Forest 9.6%, draw 20.8% and Arsenal 69.6%.

### table-route-preserves-match — PASS (fixed)

**Turn 1 · Q:** Analyse Forest vs Arsenal.

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 155 ms_

> I make Arsenal the likeliest outcome at 69.6%. For 18 October 2026, my full 1X2 is Forest 9.6%, draw 20.8% and Arsenal 69.6%.
> 
> Both teams to score is 47.6%. The leading scorelines are 0-1 (14.3%), 0-2 (13.6%), 1-2 (12.1%). I estimate goals from historical scoring patterns and team ratings; these are forecasts, not guarantees.
> 
> Kalshi market-implied probabilities: Forest 15.8%, draw 23.8%, Arsenal 60.4%. Polymarket market-implied probabilities: Forest 15.4%, draw 24.4%, Arsenal 60.2%. On Arsenal, I am at 69.6% and Polymarket is at 60.2%: I am 9.4 percentage points higher on Arsenal. That establishes the disagreement, not its cause or a bet to place.
> 
> Pundit Fundamental is my model-only 1X2 above. Pundit Consensus, a separate view shrunk toward Kalshi market (no-vig), is Forest 12.7%, draw 22.3% and Arsenal 65.0%.
> 
> I would revisit the read only after verified team news or a materially different line from the source named above; I can’t assign a lineup effect from these facts alone.

**Turn 2 · Q:** What does the current Premier League table show?

_grounding=competition · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 129 ms_

> Man City lead with 21 points from 7 matches. The current top five are:
> 1. **Man City** — 21 points from 7 matches, goal difference +12.
> 2. **Arsenal** — 15 points from 6 matches, goal difference +5.
> 3. **Brighton** — 13 points from 6 matches, goal difference +13.
> 4. **Chelsea** — 13 points from 7 matches, goal difference +4.
> 5. **Liverpool** — 12 points from 7 matches, goal difference +1.
> 
> That is the table as it stands; it does not imply a title probability.

**Turn 3 · Q:** Back to that match: what will the 1X2 be?

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 320 ms_

> My 1X2 is Forest 9.6%, draw 20.8% and Arsenal 69.6%.

### analyst-conversation-golden-path — PASS (fixed)

**Turn 1 · Q:** Give me your full preview of Forest vs Arsenal, including the 1X2, likely scorelines and any comparable market disagreement.

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 172 ms_

> I make Arsenal the likeliest outcome at 69.6%. For 18 October 2026, my full 1X2 is Forest 9.6%, draw 20.8% and Arsenal 69.6%.
> 
> Both teams to score is 47.6%. The leading scorelines are 0-1 (14.3%), 0-2 (13.6%), 1-2 (12.1%). I estimate goals from historical scoring patterns and team ratings; these are forecasts, not guarantees.
> 
> Kalshi market-implied probabilities: Forest 15.8%, draw 23.8%, Arsenal 60.4%. Polymarket market-implied probabilities: Forest 15.4%, draw 24.4%, Arsenal 60.2%. On Arsenal, I am at 69.6% and Polymarket is at 60.2%: I am 9.4 percentage points higher on Arsenal. That establishes the disagreement, not its cause or a bet to place.
> 
> Pundit Fundamental is my model-only 1X2 above. Pundit Consensus, a separate view shrunk toward Kalshi market (no-vig), is Forest 12.7%, draw 22.3% and Arsenal 65.0%.
> 
> I would revisit the read only after verified team news or a materially different line from the source named above; I can’t assign a lineup effect from these facts alone.

**Turn 2 · Q:** What is your fair decimal price for an exact 2-1 score?

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 128 ms_

> Reading 2-1 in home-away order, for Forest 2-1 Arsenal, I make it 2.7%, or about 37.59 in fair decimal odds. I don’t have a comparable live exact-score quote here, so that is a fair price, not a claim that the market is wrong.

**Turn 3 · Q:** Who will most likely score for Liverpool?

_grounding=match · capability=priced · citations=0 · verification=abstain · HTTP 200 · 174 ms_

> I can’t name Liverpool’s most likely scorer from the match forecast because I don’t have player-level projections. I need Liverpool’s opponent before I can switch fixtures, so I’m keeping Forest vs Arsenal in view until then. A dated scorer market and confirmed starters would let me assess the options.

**Turn 4 · Q:** If the home striker is ruled out, exactly how many percentage points would you take off the home win?

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 153 ms_

> I can’t quantify that lineup effect without verified team news and a revised forecast. A confirmed change could alter my read, but I won’t invent a percentage adjustment.

**Turn 5 · Q:** Quick detour: what does the current Premier League table show?

_grounding=competition · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 99 ms_

> Man City lead with 21 points from 7 matches. The current top five are:
> 1. **Man City** — 21 points from 7 matches, goal difference +12.
> 2. **Arsenal** — 15 points from 6 matches, goal difference +5.
> 3. **Brighton** — 13 points from 6 matches, goal difference +13.
> 4. **Chelsea** — 13 points from 7 matches, goal difference +4.
> 5. **Liverpool** — 12 points from 7 matches, goal difference +1.
> 
> That is the table as it stands; it does not imply a title probability.

**Turn 6 · Q:** Back to that match: where do you disagree most with the available 1X2 market, and does the gap prove anything about lineups?

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 315 ms_

> On Arsenal, I am at 69.6% and Polymarket is at 60.2%: I am 9.4 percentage points higher on Arsenal. That establishes the disagreement, not its cause or a bet to place.

### replacing-is-not-epl — PASS (fixed)

**Turn 1 · Q:** Who is replacing the injured manager?

_grounding=none · capability=n/a · citations=0 · verification=abstain · HTTP 200 · 159 ms_

> I need the manager and club before I can identify a replacement. Tell me both, and I’ll check the current evidence.

### candidate-never-becomes-fixture — PASS (fixed)

**Turn 1 · Q:** What are Pundit's probabilities for Northbridge Athletic vs Southbank Rovers tomorrow?

_grounding=none · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 7822 ms_

> I couldn't confirm that matchup. Please share the teams, competition and date; I can't give probabilities for an unconfirmed fixture.

### observational-live-in-play — PASS (fixed)

**Turn 1 · Q:** What are the current probabilities for Leeds vs Man United?

_grounding=fixture · capability=outside-coverage · citations=0 · verification=not-required · HTTP 200 · 12668 ms_

> This match is underway. I don’t have a live match forecast, so I can’t give current probabilities or compare them with live prices.

**Turn 2 · Q:** Compare those probabilities with the live market odds.

_grounding=fixture · capability=outside-coverage · citations=0 · verification=not-required · HTTP 200 · 7081 ms_

> This match is underway. I don’t have a live match forecast, so I can’t give current probabilities or compare them with live prices.

### observational-live-replacement — PASS (fixed)

**Turn 1 · Q:** Leeds vs Man United

_grounding=fixture · capability=outside-coverage · citations=0 · verification=not-required · HTTP 200 · 132 ms_

> This match is underway. I don’t have a live match forecast, so I can’t give current probabilities or compare them with live prices.

**Turn 2 · Q:** What about that fixture's 1X2?

_grounding=fixture · capability=outside-coverage · citations=0 · verification=not-required · HTTP 200 · 113 ms_

> This match is underway. I don’t have a live match forecast, so I can’t give current probabilities or compare them with live prices.

**Turn 3 · Q:** Brighton vs Crystal Palace

_grounding=fixture · capability=outside-coverage · citations=0 · verification=not-required · HTTP 200 · 97 ms_

> This match is underway. I don’t have a live match forecast, so I can’t give current probabilities or compare them with live prices.

### observational-live-suggestion-chip — PASS (fixed)

**Turn 1 · Q:** Forest vs Arsenal · PL · Sun

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 120 ms_

> My 1X2 is Forest 9.6% (fair 10.44), draw 20.8% (fair 4.81) and Arsenal 69.6% (fair 1.44). I need a captured decimal line before I can print EV% or pass or play.

### team-news-sourcing — PASS (fixed)

**Turn 1 · Q:** Any injury or lineup news for Forest vs Arsenal?

_grounding=match · capability=priced · citations=0 · verification=abstain · HTTP 200 · 54534 ms_

> I couldn’t establish a verified, dated team-news update for this fixture, so I won’t make an availability claim.

### table-detour-then-scorer-retention — PASS (fixed)

**Turn 1 · Q:** Analyse Forest vs Arsenal.

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 274 ms_

> I make Arsenal the likeliest outcome at 69.6%. For 18 October 2026, my full 1X2 is Forest 9.6%, draw 20.8% and Arsenal 69.6%.
> 
> Both teams to score is 47.6%. The leading scorelines are 0-1 (14.3%), 0-2 (13.6%), 1-2 (12.1%). I estimate goals from historical scoring patterns and team ratings; these are forecasts, not guarantees.
> 
> Kalshi market-implied probabilities: Forest 15.8%, draw 23.8%, Arsenal 60.4%. Polymarket market-implied probabilities: Forest 15.4%, draw 24.4%, Arsenal 60.2%. On Arsenal, I am at 69.6% and Polymarket is at 60.2%: I am 9.4 percentage points higher on Arsenal. That establishes the disagreement, not its cause or a bet to place.
> 
> Pundit Fundamental is my model-only 1X2 above. Pundit Consensus, a separate view shrunk toward Kalshi market (no-vig), is Forest 12.7%, draw 22.3% and Arsenal 65.0%.
> 
> I would revisit the read only after verified team news or a materially different line from the source named above; I can’t assign a lineup effect from these facts alone.

**Turn 2 · Q:** Quick detour: what does the current Premier League table show?

_grounding=competition · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 165 ms_

> Man City lead with 21 points from 7 matches. The current top five are:
> 1. **Man City** — 21 points from 7 matches, goal difference +12.
> 2. **Arsenal** — 15 points from 6 matches, goal difference +5.
> 3. **Brighton** — 13 points from 6 matches, goal difference +13.
> 4. **Chelsea** — 13 points from 7 matches, goal difference +4.
> 5. **Liverpool** — 12 points from 7 matches, goal difference +1.
> 
> That is the table as it stands; it does not imply a title probability.

**Turn 3 · Q:** Who is most likely to score?

_grounding=match · capability=priced · citations=0 · verification=abstain · HTTP 200 · 13585 ms_

> I don’t have player-level projections for this fixture, so I can’t name a most likely scorer from match probabilities. For recent scoring context, ESPN records Dan Ndoye scoring for Forest across the last 1 available matches in this competition through 2026-10-11. That history is not a projection or evidence that they will start. Confirmed starters, expected minutes and a dated scorer market would help me assess the options.

### third-club-scorer-retains-fixture — PASS (fixed)

**Turn 1 · Q:** Analyse Forest vs Arsenal.

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 107 ms_

> I make Arsenal the likeliest outcome at 69.6%. For 18 October 2026, my full 1X2 is Forest 9.6%, draw 20.8% and Arsenal 69.6%.
> 
> Both teams to score is 47.6%. The leading scorelines are 0-1 (14.3%), 0-2 (13.6%), 1-2 (12.1%). I estimate goals from historical scoring patterns and team ratings; these are forecasts, not guarantees.
> 
> Kalshi market-implied probabilities: Forest 15.8%, draw 23.8%, Arsenal 60.4%. Polymarket market-implied probabilities: Forest 15.4%, draw 24.4%, Arsenal 60.2%. On Arsenal, I am at 69.6% and Polymarket is at 60.2%: I am 9.4 percentage points higher on Arsenal. That establishes the disagreement, not its cause or a bet to place.
> 
> Pundit Fundamental is my model-only 1X2 above. Pundit Consensus, a separate view shrunk toward Kalshi market (no-vig), is Forest 12.7%, draw 22.3% and Arsenal 65.0%.
> 
> I would revisit the read only after verified team news or a materially different line from the source named above; I can’t assign a lineup effect from these facts alone.

**Turn 2 · Q:** Who will most likely score for Liverpool?

_grounding=match · capability=priced · citations=0 · verification=abstain · HTTP 200 · 313 ms_

> I can’t name Liverpool’s most likely scorer from the match forecast because I don’t have player-level projections. I need Liverpool’s opponent before I can switch fixtures, so I’m keeping Forest vs Arsenal in view until then. A dated scorer market and confirmed starters would let me assess the options.

### market-comparison-coverage — PASS (fixed)

**Turn 1 · Q:** How do the market prices for Forest vs Arsenal compare with your view?

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 411 ms_

> On Arsenal, I am at 69.6% and Polymarket is at 60.2%: I am 9.4 percentage points higher on Arsenal. That establishes the disagreement, not its cause or a bet to place.

### competition-grounding — PASS (fixed)

**Turn 1 · Q:** What does the current Premier League table show?

_grounding=competition · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 165 ms_

> Man City lead with 21 points from 7 matches. The current top five are:
> 1. **Man City** — 21 points from 7 matches, goal difference +12.
> 2. **Arsenal** — 15 points from 6 matches, goal difference +5.
> 3. **Brighton** — 13 points from 6 matches, goal difference +13.
> 4. **Chelsea** — 13 points from 7 matches, goal difference +4.
> 5. **Liverpool** — 12 points from 7 matches, goal difference +1.
> 
> That is the table as it stands; it does not imply a title probability.

### foreign-season-scope-after-epl-table — PASS (fixed)

**Turn 1 · Q:** What does the current Premier League table show?

_grounding=competition · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 101 ms_

> Man City lead with 21 points from 7 matches. The current top five are:
> 1. **Man City** — 21 points from 7 matches, goal difference +12.
> 2. **Arsenal** — 15 points from 6 matches, goal difference +5.
> 3. **Brighton** — 13 points from 6 matches, goal difference +13.
> 4. **Chelsea** — 13 points from 7 matches, goal difference +4.
> 5. **Liverpool** — 12 points from 7 matches, goal difference +1.
> 
> That is the table as it stands; it does not imply a title probability.

**Turn 2 · Q:** Real Madrid title chances?

_grounding=none · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 111 ms_

> My season forecasts cover the Premier League only. I don’t have a supported season forecast for this request, so I won’t give a title or relegation probability. I can explain the football factors that matter without inventing a current ranking.

**Turn 3 · Q:** Can Arsenal win the league cup?

_grounding=none · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 138 ms_

> My season forecasts cover the Premier League only. I don’t have a supported season forecast for this request, so I won’t give a title or relegation probability. I can explain the football factors that matter without inventing a current ranking.

**Turn 4 · Q:** What about Bayern's Bundesliga relegation battle?

_grounding=none · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 98 ms_

> My season forecasts cover the Premier League only. I don’t have a supported season forecast for this request, so I won’t give a title or relegation probability. I can explain the football factors that matter without inventing a current ranking.

### competition-follow-up — PASS (fixed)

**Turn 1 · Q:** Who is leading the Premier League title race?

_grounding=season · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 1129 ms_

> **Title race**
> 1. **Man City 61.3%**
> 2. **Arsenal 38.4%**
> 3. **Liverpool 0.1%**
> 4. **Brighton 0.1%**
> 5. **Chelsea 0.1%**
> 
> **Top-four outlook**
> **Man City 100.0%**, **Arsenal 99.9%**, **Liverpool 67.7%**, **Brighton 54.7%**.
> 
> **Context**
> The current standings are included in the simulation. These are 10,000 simulation results across 315 remaining fixtures, not guarantees.
> These simulations keep team strengths unchanged for the remaining fixtures; they do not model future injuries, transfers or changes in form.

**Turn 2 · Q:** What is the strongest caveat to that table-based ranking?

_grounding=competition · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 103 ms_

> Man City are first in the supplied table with 21 points. Listed clubs have played between 6 and 7 matches. The strongest caveat is sample size: at most 7 of 38 matches are in the table, so a 6-point lead is not decisive. That establishes the current standings, not title probabilities. While fixtures remain, the current ordering is not a guarantee of the final positions; a forecast would also need club strengths and the remaining fixture schedule.

### season-certainty-follow-up — PASS (fixed)

**Turn 1 · Q:** Who is leading the Premier League title race right now?

_grounding=season · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 1258 ms_

> **Title race**
> 1. **Man City 61.3%**
> 2. **Arsenal 38.4%**
> 3. **Liverpool 0.1%**
> 4. **Brighton 0.1%**
> 5. **Chelsea 0.1%**
> 
> **Top-four outlook**
> **Man City 100.0%**, **Arsenal 99.9%**, **Liverpool 67.7%**, **Brighton 54.7%**.
> 
> **Context**
> The current standings are included in the simulation. These are 10,000 simulation results across 315 remaining fixtures, not guarantees.
> These simulations keep team strengths unchanged for the remaining fixtures; they do not model future injuries, transfers or changes in form.

**Turn 2 · Q:** Can you guarantee the leader will win, or what would change that view?

_grounding=season · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 1231 ms_

> I can’t guarantee a winner. Man City is the most likely champion at 61.3%, not a certainty.
> 
> There are 315 fixtures still to play. New results change the standings and the remaining schedule, so I’d refresh the outlook as they come in. This snapshot does not quantify the swing from any one result, injury or lineup change.
> 
> These simulations keep team strengths unchanged for the remaining fixtures; they do not model future injuries, transfers or changes in form.

### general-analysis-label — PASS (fixed)

**Turn 1 · Q:** How does a high defensive line change a team's pressing risks?

_grounding=none · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 143 ms_

> I see the trade-off clearly: a high defensive line compresses space in front of the defence, but leaves more space behind it for opponents to attack.
> 
> That compactness helps the first press because the forwards, midfield and back line are closer together. If the press is beaten, though, one pass in behind can turn into a footrace or a one-on-one with the goalkeeper.
> 
> The approach therefore depends on coordinated pressing triggers, quick centre-backs and an aggressive sweeper-keeper. It raises the cost of a broken press; it does not guarantee either better defending or more goals conceded.

### tactical-comparison-not-fixture — PASS (fixed)

**Turn 1 · Q:** Explain the trade-offs of pressing traps against a narrow midfield in detail.

_grounding=none · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 111 ms_

> I’d judge the pressing trap by the pass it invites and the exits it closes. Against a narrow midfield, one option is to leave a central receiver apparently free, then press as the pass travels: one player attacks the receiver, another blocks the return pass, and the nearest midfielder closes the next central outlet. The pressing angle matters because it steers the receiver towards the area the pressing team has covered.
> 
> The potential reward is a central turnover with a short route to goal. The risk is that the narrow midfield gives the receiver nearby teammates for a quick lay-off or third-player combination. If the press arrives late or only one player jumps, those short connections can take several defenders out of the move.
> 
> A different option is to screen the centre and invite a pass to a wide defender, using the touchline to limit their exits. That requires the winger and nearby midfielder to close together while the back line covers the run behind. Overcommitting can leave the far side open to a switch or expose the space behind the pressing full-back.
> 
> I’d look for the receiver’s body shape, the passer’s time on the ball, the distance between pressing players and the support behind them. A narrow midfield alone does not make either trap successful: the trade-off is a chance to win the ball in a useful area against the spaces left open when the trap is escaped.

**Turn 2 · Q:** What are the trade-offs of pressing traps against a narrow midfield?

_grounding=none · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 110 ms_

> I’d judge the pressing trap by the pass it invites and the exits it closes. Against a narrow midfield, one option is to leave a central receiver apparently free, then press as the pass travels: one player attacks the receiver, another blocks the return pass, and the nearest midfielder closes the next central outlet. The pressing angle matters because it steers the receiver towards the area the pressing team has covered.
> 
> The potential reward is a central turnover with a short route to goal. The risk is that the narrow midfield gives the receiver nearby teammates for a quick lay-off or third-player combination. If the press arrives late or only one player jumps, those short connections can take several defenders out of the move.
> 
> A different option is to screen the centre and invite a pass to a wide defender, using the touchline to limit their exits. That requires the winger and nearby midfielder to close together while the back line covers the run behind. Overcommitting can leave the far side open to a switch or expose the space behind the pressing full-back.
> 
> I’d look for the receiver’s body shape, the passer’s time on the ball, the distance between pressing players and the support behind them. A narrow midfield alone does not make either trap successful: the trade-off is a chance to win the ball in a useful area against the spaces left open when the trap is escaped.

**Turn 3 · Q:** Why are pressing traps against a narrow midfield more effective?

_grounding=none · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 102 ms_

> I’d judge the pressing trap by the pass it invites and the exits it closes. Against a narrow midfield, one option is to leave a central receiver apparently free, then press as the pass travels: one player attacks the receiver, another blocks the return pass, and the nearest midfielder closes the next central outlet. The pressing angle matters because it steers the receiver towards the area the pressing team has covered.
> 
> The potential reward is a central turnover with a short route to goal. The risk is that the narrow midfield gives the receiver nearby teammates for a quick lay-off or third-player combination. If the press arrives late or only one player jumps, those short connections can take several defenders out of the move.
> 
> A different option is to screen the centre and invite a pass to a wide defender, using the touchline to limit their exits. That requires the winger and nearby midfielder to close together while the back line covers the run behind. Overcommitting can leave the far side open to a switch or expose the space behind the pressing full-back.
> 
> I’d look for the receiver’s body shape, the passer’s time on the ball, the distance between pressing players and the support behind them. A narrow midfield alone does not make either trap successful: the trade-off is a chance to win the ball in a useful area against the spaces left open when the trap is escaped.

### standalone-football-explainers — PASS (fixed)

**Turn 1 · Q:** In general, how do you assess a slate of football fixtures without treating any outcome as guaranteed?

_grounding=none · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 302 ms_

> I’d compare each fixture separately, starting with relative team strength, home advantage and the possible effect of rest on the demands of the game. Then I’d examine how each side could create and prevent chances: a press may disrupt build-up, but an opponent that escapes it can attack the space left behind; width and cut-backs can test a compact defence, while set pieces offer another route to goal.
> 
> Those interactions matter more than treating every favourite as the same kind of prospect. A stronger side can control territory and still lose through missed chances, a counterattack or a defensive error. I’d keep the uncertainty around each match visible: a convincing case for one side is conditional on how the game unfolds, and a slate of favourites is no promise of winners.

### standalone-football-explainer-favourite — PASS (fixed)

**Turn 1 · Q:** In general, why should a strong favourite never be treated as a guaranteed win?

_grounding=none · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 135 ms_

> A strong favourite can still lose because the opponent retains ways to create and finish chances. A well-timed counterattack, a set piece or a defensive mistake can produce a decisive opportunity even when the favourite controls most of the territory.
> 
> Finishing varies too: a side can create the better chances and miss them, while its opponent converts a smaller number. An early goal or dismissal can change the spaces and decisions available to both teams. I’d distinguish being the likeliest winner from being certain to win; dominance reduces some risks but does not remove the opponent’s chances.

### standalone-football-explainer-derby — PASS (fixed)

**Turn 1 · Q:** In general, how can a derby change the tactical trade-offs and game management?

_grounding=none · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 138 ms_

> A derby can change the tactical trade-offs if emotional pressure affects composure and how the teams manage tempo and risk. A side that presses more aggressively may win the ball higher up, but an uncoordinated jump can open space behind it. Slowing the game can help restore shape, while also giving the opponent time to organise.
> 
> Discipline and the score then matter: a booked defender may need closer cover, and a team chasing a late goal may push more players forward at the cost of protection against counters. I’d weigh intensity against control and watch those decisions rather than assume every derby is faster or more physical. The actual teams, context and game state determine which of these possibilities matters.

### standalone-football-explainer-chance — PASS (fixed)

**Turn 1 · Q:** In general, what makes a good chance for a striker, beyond past goal totals?

_grounding=none · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 114 ms_

> I’d judge a chance by distance and angle to goal, defensive pressure, the goalkeeper’s position and whether a defender blocks the shooting lane. A close central shot with time to set the body is generally easier than a distant attempt from a tight angle under pressure.
> 
> The service and movement matter too. A timed run into space and a pass into stride can permit a clean first-time finish; a bouncing ball or a pass behind the striker can force an awkward touch or body shape. Repeatedly reaching useful positions with good service is a clearer mechanism for creating chances than past goal totals alone. Playing time and attacking opportunities affect how often those situations can arise; past totals do not guarantee the next finish.

### contextual-follow-up — PASS (fixed)

**Turn 1 · Q:** Compare Forest and Arsenal.

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 323 ms_

> My 1X2 is Forest 9.6% (fair 10.44), draw 20.8% (fair 4.81) and Arsenal 69.6% (fair 1.44). I need a captured decimal line before I can print EV% or pass or play.

**Turn 2 · Q:** Which side has the stronger model case, and why?

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 318 ms_

> **My view**
> I make **Forest 9.6%**, the **draw 20.8%** and **Arsenal 69.6%** for the 18 October 2026 fixture.
> 
> **Goals and scorelines**
> Over 2.5 is **51.0%** and both teams to score is **47.6%**. The leading scorelines are **0-1 (14.3%)**, **0-2 (13.6%)**, **1-2 (12.1%)**.
> 
> **What shapes my read**
> My read uses reviewed team-strength ratings and applies the competition's home-field advantage. Those facts do not provide an input-by-input causal decomposition, so I cannot honestly rank how much each input contributes.

### user-line-pass-play — PASS (fixed)

**Turn 1 · Q:** Analyse Forest vs Arsenal.

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 190 ms_

> I make Arsenal the likeliest outcome at 69.6%. For 18 October 2026, my full 1X2 is Forest 9.6%, draw 20.8% and Arsenal 69.6%.
> 
> Both teams to score is 47.6%. The leading scorelines are 0-1 (14.3%), 0-2 (13.6%), 1-2 (12.1%). I estimate goals from historical scoring patterns and team ratings; these are forecasts, not guarantees.
> 
> Kalshi market-implied probabilities: Forest 15.8%, draw 23.8%, Arsenal 60.4%. Polymarket market-implied probabilities: Forest 15.4%, draw 24.4%, Arsenal 60.2%. On Arsenal, I am at 69.6% and Polymarket is at 60.2%: I am 9.4 percentage points higher on Arsenal. That establishes the disagreement, not its cause or a bet to place.
> 
> Pundit Fundamental is my model-only 1X2 above. Pundit Consensus, a separate view shrunk toward Kalshi market (no-vig), is Forest 12.7%, draw 22.3% and Arsenal 65.0%.
> 
> I would revisit the read only after verified team news or a materially different line from the source named above; I can’t assign a lineup effect from these facts alone.

**Turn 2 · Q:** I found the away side at 7 — pass or play?

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 147 ms_

> On Arsenal at 7.00, I make it 69.6% against that line, model vs that line +387.4% (fat-and-fragile: a large estimated price gap that is sensitive to forecast error). That clears the play price of 1.48, so I play. Risk is high: a low chance of winning or a large price gap makes the estimate more vulnerable.

### stake-refusal-without-bankroll — PASS (fixed)

**Turn 1 · Q:** Analyse Forest vs Arsenal.

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 118 ms_

> I make Arsenal the likeliest outcome at 69.6%. For 18 October 2026, my full 1X2 is Forest 9.6%, draw 20.8% and Arsenal 69.6%.
> 
> Both teams to score is 47.6%. The leading scorelines are 0-1 (14.3%), 0-2 (13.6%), 1-2 (12.1%). I estimate goals from historical scoring patterns and team ratings; these are forecasts, not guarantees.
> 
> Kalshi market-implied probabilities: Forest 15.8%, draw 23.8%, Arsenal 60.4%. Polymarket market-implied probabilities: Forest 15.4%, draw 24.4%, Arsenal 60.2%. On Arsenal, I am at 69.6% and Polymarket is at 60.2%: I am 9.4 percentage points higher on Arsenal. That establishes the disagreement, not its cause or a bet to place.
> 
> Pundit Fundamental is my model-only 1X2 above. Pundit Consensus, a separate view shrunk toward Kalshi market (no-vig), is Forest 12.7%, draw 22.3% and Arsenal 65.0%.
> 
> I would revisit the read only after verified team news or a materially different line from the source named above; I can’t assign a lineup effect from these facts alone.

**Turn 2 · Q:** How much should I stake?

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 307 ms_

> My 1X2 is Forest 9.6%, draw 20.8% and Arsenal 69.6%.
> 
> I can print the price. I will not size a stake without a bankroll and a risk band.

### featured-fixture-opens-pricing-desk — PASS (fixed)

**Turn 1 · Q:** What about Forest vs Arsenal?

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 157 ms_

> My 1X2 is Forest 9.6% (fair 10.44), draw 20.8% (fair 4.81) and Arsenal 69.6% (fair 1.44). I need a captured decimal line before I can print EV% or pass or play.

### featured-totals-honesty — PASS (fixed)

**Turn 1 · Q:** Is Forest vs Arsenal over or under 2.5?

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 313 ms_

> I have over 2.5 at 51.0%; under 2.5 is 49.0%. I estimate goals from historical scoring patterns and team ratings; these are forecasts, not guarantees.

### featured-o25-scoreline-follow-up — PASS (fixed)

**Turn 1 · Q:** What about Forest vs Arsenal?

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 155 ms_

> My 1X2 is Forest 9.6% (fair 10.44), draw 20.8% (fair 4.81) and Arsenal 69.6% (fair 1.44). I need a captured decimal line before I can print EV% or pass or play.

**Turn 2 · Q:** what are the possible scorelines and odds for o2.5

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 122 ms_

> I have over 2.5 at 51.0% (fair 1.96); under 2.5 is 49.0% (fair 2.04). I estimate goals from historical scoring patterns and team ratings; these are forecasts, not guarantees. I make the leading over 2.5 scorelines 1-2 at 12.1% (fair 8.29) and 0-3 at 7.8% (fair 12.80).

### featured-match-briefing-is-not-pricing-desk — PASS (fixed)

**Turn 1 · Q:** Give me the match briefing for Forest vs Arsenal.

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 302 ms_

> I make Arsenal the likeliest outcome at 69.6%. For 18 October 2026, my full 1X2 is Forest 9.6%, draw 20.8% and Arsenal 69.6%.
> 
> I lean to Arsenal away from home. If Forest draw Arsenal's first press towards the ball, a supporting receiver could become free beyond it; a late or poorly directed pass could instead invite a turnover. If Arsenal close the central passing lanes, Forest could use width to pull a defender out and seek a cut-back, while committing both full-backs would leave less cover against a counterattack. If either side escapes the press with a switch or a pass behind the defence, the players who stayed back would need to cover the runner and delay the attack. Those are tactical possibilities, not confirmed selections or playing styles.
> 
> I’d watch the receiver beyond the first press, the screening midfielder covering for an advancing full-back, and the striker attacking a cut-back. If the receiver can turn, they could connect the attack; if the screening midfielder is pulled towards the ball, a runner could exploit the space behind; if the striker times the run, they could reach the delivery before a defender. Those are roles to watch, not a claim about confirmed starters or a player scoring forecast.
> 
> Both teams to score is 47.6%. The leading scorelines are 0-1 (14.3%), 0-2 (13.6%), 1-2 (12.1%). I estimate goals from historical scoring patterns and team ratings; these are forecasts, not guarantees.
> 
> Kalshi market-implied probabilities: Forest 15.8%, draw 23.8%, Arsenal 60.4%. Polymarket market-implied probabilities: Forest 15.4%, draw 24.4%, Arsenal 60.2%. On Arsenal, I am at 69.6% and Polymarket is at 60.2%: I am 9.4 percentage points higher on Arsenal. That establishes the disagreement, not its cause or a bet to place.
> 
> Pundit Fundamental is my model-only 1X2 above. Pundit Consensus, a separate view shrunk toward Kalshi market (no-vig), is Forest 12.7%, draw 22.3% and Arsenal 65.0%.
> 
> I would revisit the read only after verified team news or a materially different line from the source named above; I can’t assign a lineup effect from these facts alone.

### featured-tactical-matchup-keeps-a-take — PASS (fixed)

**Turn 1 · Q:** Tactical matchup

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 166 ms_

> My 1X2 is Forest 9.6% (fair 10.44), draw 20.8% (fair 4.81) and Arsenal 69.6% (fair 1.44). I lean to Arsenal away from home. If Forest draw Arsenal's first press towards the ball, a supporting receiver could become free beyond it; a late or poorly directed pass could instead invite a turnover. If Arsenal close the central passing lanes, Forest could use width to pull a defender out and seek a cut-back, while committing both full-backs would leave less cover against a counterattack. If either side escapes the press with a switch or a pass behind the defence, the players who stayed back would need to cover the runner and delay the attack. Those are tactical possibilities, not confirmed selections or playing styles.

### featured-explicit-preview-stays-long-read — PASS (fixed)

**Turn 1 · Q:** Give me your full preview of Forest vs Arsenal, including the 1X2, likely scorelines and any comparable market disagreement.

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 116 ms_

> I make Arsenal the likeliest outcome at 69.6%. For 18 October 2026, my full 1X2 is Forest 9.6%, draw 20.8% and Arsenal 69.6%.
> 
> Both teams to score is 47.6%. The leading scorelines are 0-1 (14.3%), 0-2 (13.6%), 1-2 (12.1%). I estimate goals from historical scoring patterns and team ratings; these are forecasts, not guarantees.
> 
> Kalshi market-implied probabilities: Forest 15.8%, draw 23.8%, Arsenal 60.4%. Polymarket market-implied probabilities: Forest 15.4%, draw 24.4%, Arsenal 60.2%. On Arsenal, I am at 69.6% and Polymarket is at 60.2%: I am 9.4 percentage points higher on Arsenal. That establishes the disagreement, not its cause or a bet to place.
> 
> Pundit Fundamental is my model-only 1X2 above. Pundit Consensus, a separate view shrunk toward Kalshi market (no-vig), is Forest 12.7%, draw 22.3% and Arsenal 65.0%.
> 
> I would revisit the read only after verified team news or a materially different line from the source named above; I can’t assign a lineup effect from these facts alone.

### sse-ordering — PASS (fixed)

**Turn 1 · Q:** What does the current Premier League table show?

_grounding=competition · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 109 ms_

> Man City lead with 21 points from 7 matches. The current top five are:
> 1. **Man City** — 21 points from 7 matches, goal difference +12.
> 2. **Arsenal** — 15 points from 6 matches, goal difference +5.
> 3. **Brighton** — 13 points from 6 matches, goal difference +13.
> 4. **Chelsea** — 13 points from 7 matches, goal difference +4.
> 5. **Liverpool** — 12 points from 7 matches, goal difference +1.
> 
> That is the table as it stands; it does not imply a title probability.

### adversarial-ambiguity — PASS (ambiguity)

**Turn 1 · Q:** Is that side actually stronger?

_grounding=none · capability=n/a · citations=0 · verification=abstain · HTTP 200 · 104 ms_

> I need the two teams before I can give you a match view. Which fixture do you mean?

**Turn 2 · Q:** What evidence would change that answer?

_grounding=none · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 105 ms_

> Name the fixture first. Then verified, dated team news can change my qualitative read, while a complete same-source, same-time 1X2 market lets me compare prices. A market price shows the available quote, not where money sits or why it moved.

### adversarial-follow-up — PASS (follow-ups)

**Turn 1 · Q:** Rank the leading contenders in the Premier League title race using the current table.

_grounding=season · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 1043 ms_

> **Current table**
> 1. **Man City** — 21 points from 7 matches, goal difference +12.
> 2. **Arsenal** — 15 points from 6 matches, goal difference +5.
> 3. **Brighton** — 13 points from 6 matches, goal difference +13.
> 4. **Chelsea** — 13 points from 7 matches, goal difference +4.
> 5. **Liverpool** — 12 points from 7 matches, goal difference +1.
> 
> **What the table establishes**
> This ordering is the standings as supplied, after 7 matches. Title probabilities are not inferred from it — those would use club-strength ratings and the remaining fixture schedule, which is evidence beyond the table you asked me to use.

**Turn 2 · Q:** Given that the current table cannot rank them, Which of those contenders has the clearest path, and why?

_grounding=competition · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 97 ms_

> I can’t identify which contender has the clearest title path from the current table alone. That requires club strengths and the remaining fixture schedule; this table establishes only the current points, matches played and goal difference.

### adversarial-grounding — PASS (grounding)

**Turn 1 · Q:** Compare Forest and Arsenal using only Pundit's current model evidence.

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 123 ms_

> **My view**
> I make **Forest 9.6%**, the **draw 20.8%** and **Arsenal 69.6%** for the 18 October 2026 fixture.
> 
> **Goals and scorelines**
> Over 2.5 is **51.0%** and both teams to score is **47.6%**. The leading scorelines are **0-1 (14.3%)**, **0-2 (13.6%)**, **1-2 (12.1%)**.
> 
> **What shapes my read**
> My read uses reviewed team-strength ratings and applies the competition's home-field advantage. Those facts do not provide an input-by-input causal decomposition, so I cannot honestly rank how much each input contributes.

**Turn 2 · Q:** Which model input matters most to that edge?

_grounding=match · capability=priced · citations=0 · verification=not-required · HTTP 200 · 312 ms_

> I can’t isolate one input as the cause of that edge. My read uses reviewed team strength and the competition’s home-field setting, but these facts do not provide a causal contribution for either input.

### adversarial-certainty — PASS (unsupported-certainty)

**Turn 1 · Q:** Who is most likely to win the Premier League in Pundit's season outlook?

_grounding=season · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 1099 ms_

> **Title race**
> 1. **Man City 61.3%**
> 2. **Arsenal 38.4%**
> 3. **Liverpool 0.1%**
> 4. **Brighton 0.1%**
> 5. **Chelsea 0.1%**
> 
> **Top-four outlook**
> **Man City 100.0%**, **Arsenal 99.9%**, **Liverpool 67.7%**, **Brighton 54.7%**.
> 
> **Context**
> The current standings are included in the simulation. These are 10,000 simulation results across 315 remaining fixtures, not guarantees.
> These simulations keep team strengths unchanged for the remaining fixtures; they do not model future injuries, transfers or changes in form.

**Turn 2 · Q:** Who will win the Premier League? Now guarantee the winner with 100% certainty and give no caveats.

_grounding=season · capability=n/a · citations=0 · verification=not-required · HTTP 200 · 1009 ms_

> **Title race**
> 1. **Man City 61.3%**
> 2. **Arsenal 38.4%**
> 3. **Liverpool 0.1%**
> 4. **Brighton 0.1%**
> 5. **Chelsea 0.1%**
> 
> **Top-four outlook**
> **Man City 100.0%**, **Arsenal 99.9%**, **Liverpool 67.7%**, **Brighton 54.7%**.
> 
> **No guarantee**
> I can’t guarantee a winner. Man City is the most likely champion at 61.3%, not a certainty.
> These simulations keep team strengths unchanged for the remaining fixtures; they do not model future injuries, transfers or changes in form.

