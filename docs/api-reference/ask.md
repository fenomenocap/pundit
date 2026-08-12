# Ask

### `POST /api/ask`

MiniMax M3-powered conversational football analysis. **Rate limit:** 10 requests/minute per client.

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
| `delta` | `{ text }` | Progressive validated answer text; search-backed turns may hold text until citations are bound |
| `done` | `{ answer, grounding, citations? }` | Authoritative complete response with optional server-owned citation metadata |
| `error` | `{ error, status, code? }` | Failure after headers were sent |

SSE includes `: ping` comment heartbeats every 15 seconds during long web-search turns.

Ordinary no-search answers stream progressively after deterministic line guards.
Search-backed answers never stream tool drafts: the server binds evidence markers
to exact links and dates before releasing text. Clients should render `delta` as
it comes and always treat `done.answer` as authoritative.

### Response shape (non-streaming)

```json
{
  "answer": "**Verdict**\n\nArsenal are strong favourites...",
  "grounding": { "kind": "match", "...": "..." },
  "citations": [
    { "id": "S1", "title": "Club update", "url": "https://example.com/update", "date": "2026-08-12" }
  ]
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

* **90 seconds** shared request deadline across MiniMax inference, search, streaming, and disconnect cancellation
* At most 2 generations, 2 deduplicated search queries, and 3 provider calls for the bounded fallback path
* Search calls are capped at 10 seconds; MiniMax output is capped at 1,536 tokens
* Requires `MINIMAX_API_KEY` on the API server
* No server-side conversation session — the client supplies history

The API rejects empty or truncated MiniMax output. Validation errors before streaming starts return normal JSON error bodies with appropriate HTTP status codes.
