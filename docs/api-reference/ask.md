# Ask

### `POST /api/ask`

Claude-powered conversational football analysis. **Rate limit:** 10 requests/minute per client.

```json
{
  "question": "Arsenal vs Coventry",
  "history": [
    { "role": "user", "content": "Arsenal vs Coventry" },
    { "role": "assistant", "content": "Arsenal are strong favourites at home..." }
  ],
  "teamContext": ["Arsenal", "Coventry City"],
  "stream": false
}
```

`question` is required and limited to 500 characters. `history` is optional, must contain complete user/assistant exchanges, and is limited to 12 turns and 12,000 characters total. `teamContext` enables follow-ups that do not repeat both team names.

Set `"stream": true` to receive **Server-Sent Events** instead of a single JSON body:

| Event | Payload | When |
|---|---|---|
| `grounding` | `{ grounding }` | As soon as tier routing completes |
| `delta` | `{ text }` | Incremental answer text |
| `done` | `{ answer, grounding }` | Final complete response |
| `error` | `{ error, status, code? }` | Failure after headers were sent |

SSE includes `: ping` comment heartbeats every 15 seconds during long web-search turns.

### Response shape (non-streaming)

```json
{
  "answer": "**Verdict**\n\nArsenal are strong favourites...",
  "grounding": { "kind": "match", "...": "..." }
}
```

`grounding` is one of:

* **`kind: "match"`** — an active fixture in the 14-day window with model 1X2, O/U 2.5, BTTS, top scorelines, and available active market prices
* **`kind: "competition"`** — ESPN standings for an enabled competition
* **`kind: "season"`** — Premier League standings plus Monte Carlo title/top-four outlook
* **`null`** — clearly labelled general football analysis with no model-grounding claim

Match grounding includes `pHome`, `pDraw`, `pAway`, `pOver2_5`, `pUnder2_5`, `pBttsYes`, `pBttsNo`, `topScores`, `homeFieldAdvantage`, nullable Stake columns, and sparse Kalshi/Polymarket `oddsSources`.

Season grounding adds `seasonOutlook` with per-team `titleProb` and `topFourProb`.

### Timeouts and limits

* **90 seconds** per Anthropic upstream call (with up to 5 continuations)
* **240 seconds** overall deadline per request
* Requires `ANTHROPIC_API_KEY` on the API server
* No server-side conversation session — the client supplies history

The API rejects empty or truncated Claude output. Validation errors before streaming starts return normal JSON error bodies with appropriate HTTP status codes.
