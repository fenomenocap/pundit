# How to Use Pundit

Pundit has three surfaces, all reachable from the top nav.

### The chat

The homepage is a chat box. Type a question naming two teams — e.g. "France vs Morocco" or "who wins Argentina vs Brazil" — and Pundit looks up that fixture's model data and replies with a short, plain-language analysis: headline win/draw/win and over/under 2.5 odds, the 1–2 most likely scorelines, and a one-line note on what the underdog would need.

A few things worth knowing:

* Pundit can only answer for fixtures that already exist in the tournament data — if the two teams haven't been drawn against each other yet (e.g. an undetermined knockout matchup), it'll tell you to check back closer to kickoff instead of guessing.
* You need to name both teams for Pundit to identify the match. Vague questions ("who's going to win the World Cup") won't resolve to a specific fixture.
* Answers can take a few seconds — the chat calls out to a model and, when relevant, a live web search for injury/squad news.

### Fixtures & Standings

The [Fixtures](how-to-use.md#fixtures--standings) page shows the full tournament schedule and results, grouped by stage (group stage → round of 32 → round of 16 → quarterfinals → semifinals → third-place match → final), plus live group standings. This is a straight read of the tournament as it's actually being played — not model output.

### Model

The Model page embeds Pundit's underlying prediction model directly, showing the full slate of team-level (win / semifinal / quarterfinal probabilities) and fixture-level odds the chat draws on. It's clearly labeled reference-only — the numbers here aren't tradeable anywhere in Pundit.
