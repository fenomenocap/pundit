# Ask

### `POST /api/ask`

Conversational football analysis over server-owned grounding with a bounded MiniMax M3 language layer. Every no-search response with complete match, non-priced fixture, competition, or season grounding bypasses MiniMax. The word “current” alone is exempt from external search when it modifies an owned table, model, or season-outlook fact; manager, injury, lineup, transfer, odds and similar cues still require bounded search. Non-priced capability and identity-not-established candidate notices are always deterministic; search cannot alter capability or promote a discovery into fixture identity. If a grounded market search verifies no external claim, the generated answer is discarded and the API returns only complete structured market rows already present in match grounding, with no citations and the original `abstain` or `unavailable` verification status. MiniMax is limited to supported evidence-required prose plus general/ungrounded open-ended analysis. **Rate limit:** 10 requests/minute across the declared deployment, divided between `API_REPLICAS` process-wide buckets. Production currently declares one replica.

```json
{
  "question": "Arsenal vs Coventry",
  "history": [
    { "role": "user", "content": "Arsenal vs Coventry" },
    { "role": "assistant", "content": "Arsenal are strong favourites at home..." }
  ],
  "fixtureContext": { "fixtureId": "espn:eng.1:401879301" },
  "teamContext": ["Arsenal", "Coventry City"],
  "stream": false
}
```

`question` is required and limited to 500 characters. `history` is optional, must contain complete user/assistant exchanges, and is limited to 12 turns and 12,000 characters total. `fixtureContext` retains the server-owned recognized identity across follow-ups and wins when the temporary compatibility field `teamContext` is also present.

`current table` and `current standings` are explicit competition follow-up cues.
They retain the most recent competition explicitly named in prior user turns.
With no competition in view, they resolve to the Premier League because it is
the only enabled league-style table; arbitrary pronouns do not inherit a
competition.

Set `"stream": true` to receive **Server-Sent Events** instead of a single JSON body:

| Event | Payload | When |
|---|---|---|
| `grounding` | `{ grounding }` | As soon as tier routing completes |
| `delta` | `{ text }` | One whole-answer-validated text payload after deterministic and evidence guards complete |
| `done` | `{ answer, grounding, citations?, verification }` | Authoritative complete response with optional server-owned citation metadata and claim-verification verdict |
| `error` | `{ error, status, code? }` | Failure after headers were sent |

SSE includes `: ping` comment heartbeats every 15 seconds during long web-search turns.

All generated answers are held until whole-answer deterministic guards complete, then released as one safe `delta` followed by authoritative `done`. This prevents a later sentence from invalidating an earlier streamed rationale or market claim. A deterministic closed answer skips generation and emits the same server-owned text as its `delta` and `done.answer`. Grounding is still sent first, and heartbeats keep long search/generation turns alive. Search-backed answers never stream tool drafts: the server binds evidence markers to exact links and dates before releasing text. Clients should render the `delta` and always treat `done.answer` as authoritative.

### Response shape (non-streaming)

```json
{
  "answer": "**Model vs market**\n\nPundit's model makes Arsenal 56.3%, about 6 percentage points above the priced probability...",
  "grounding": { "kind": "match", "...": "..." },
  "citations": [
    { "id": "S1", "title": "Club update", "url": "https://example.com/update", "date": "2026-08-12" }
  ],
  "verification": { "status": "verified", "supportedClaimCount": 1, "removedClaimCount": 0 }
}
```

`verification.status` describes the extracted current factual claims, not a
blanket certification of every sentence. `verified` means at least one such
claim was supported; `not-required` means the turn contained no claim in the
verification cue classes; `conflict` reports incompatible supported sources;
`abstain` means no extracted claim survived; and `unavailable` means retrieval
or verification could not establish support. `supportedClaimCount` counts
retained extracted claims and `removedClaimCount` counts claims removed or
withheld by the server.

`grounding` is one of:

* **`kind: "match"`** — an active fixture in the 14-day window with model 1X2, O/U 2.5, BTTS, top scorelines, and available active market prices
* **`kind: "fixture"`** — an authoritative/corroborated recognized fixture plus a non-priced capability; it contains no Pundit probabilities
* **`kind: "competition"`** — ESPN standings for an enabled competition
* **`kind: "season"`** — Premier League standings plus Monte Carlo title/top-four outlook, when the complete persisted season schedule and all required ratings are available
* **`null`** — clearly labelled general football analysis with no model-grounding claim

Match grounding includes `pHome`, `pDraw`, `pAway`, `pOver2_5`, `pUnder2_5`, `pBttsYes`, `pBttsNo`, `topScores`, `homeFieldAdvantage`, nullable Stake columns, and sparse Kalshi/Polymarket `oddsSources`.

Fixture grounding includes the stable recognized identity and one typed capability. The response preserves both its exact status and reason: `temporarily-unpriced` (`model-initializing` or `ratings-refreshing`), `outside-coverage` (`friendly-policy-disabled`, `unsupported-competition`, or `model-policy-disabled`), or `insufficient-model-input` (`ratings-unavailable`, `neutral-venue-unknown`, or `required-context-missing`). The deterministic capability notice does not replace that reason with generated squad, lineup, venue, rating, or policy speculation. Discovery-only fixture candidates return no fixture grounding or badge. A new explicit recognized matchup replaces retained context; a competition/table detour does not delete it. Match/1X2 intent keeps fixture routing priority, and competition aliases use token boundaries.

Season grounding adds `seasonOutlook` with per-team `titleProb` and `topFourProb`.
If those complete inputs are unavailable, a season-shaped question degrades to
`kind: "competition"` with current standings instead of returning HTTP 503. It
does not invent or partially simulate season probabilities.

When the standings are all tied at zero and the question explicitly limits its
evidence to the current table, the answer states that the table establishes no
ranking or champion and omits the season probabilities. Those probabilities also
use club-strength ratings and the remaining fixture schedule, which are outside a
table-only request.

### Timeouts and limits

* **90 seconds** shared request deadline across MiniMax inference, search, streaming, and disconnect cancellation
* At most 2 generations, 2 deduplicated search queries, and 3 provider calls for the bounded fallback path
* Search calls are capped at 10 seconds; MiniMax's output budget is capped at 4,096 tokens, including provider reasoning tokens
* Requires `MINIMAX_API_KEY` on the API server
* No server-side conversation session — the client supplies history

The API rejects empty output and provider-reported `max_tokens` truncation. Because MiniMax can also label a visibly incomplete response `end_turn`, the settled delivery path removes hard structural tail fragments before applying its grounding fallback or failing closed. The Schema-17 production evaluator independently checks delivered endings, raw search directives, scoped scoreline arithmetic/rank claims, request and table-source fidelity, abstained probability counterfactuals, supplied-history acknowledgement, product scope, team-news sourcing across the full answer, high-line geometry across bounded Markdown boundaries, and clause-scoped certainty without mistaking an explicit refusal for a guarantee. It preserves post-run readiness plus a run-level pre/post web-search counter delta for diagnostics, without treating the deployment-wide delta as per-turn attribution. Its cancellation probe reads through the SSE grounding event before aborting and requires the next body read to fail promptly with `AbortError`. Production certification additionally gates the observed monotonic spacing between request starts at 13,000 ms or more; configured pacing alone is not evidence. Validation errors before streaming starts return normal JSON error bodies with appropriate HTTP status codes.
