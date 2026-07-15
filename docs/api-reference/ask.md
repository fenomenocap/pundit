# Ask

### `POST /api/ask`

Claude-powered conversational football analysis. **Rate limit:** 10 requests/minute per client.

```json
{
  "question": "England vs Argentina",
  "history": [
    { "role": "user", "content": "England vs Argentina" },
    { "role": "assistant", "content": "Argentina have the stronger model probability..." }
  ],
  "teamContext": ["England", "Argentina"]
}
```

`question` is required and limited to 500 characters. `history` is optional, must contain complete user/assistant exchanges, and is limited to 12 turns and 12,000 characters. `teamContext` enables follow-ups that do not repeat both team names.

The response is `{ answer, grounding }`, where grounding is one of:

* `kind: "match"` — an ESPN-active semifinal/final with model 1X2, O/U 2.5, BTTS, top scorelines, and available active market prices
* `kind: "tournament"` — sorted team title probabilities
* `null` — clearly labelled general football analysis that makes no model-grounding claim

Match responses include `pHome`, `pDraw`, `pAway`, `pOver2_5`, `pUnder2_5`, `pBttsYes`, `pBttsNo`, `topScores`, nullable Stake columns, and sparse Kalshi/Polymarket `oddsSources`.

The API rejects empty/truncated Claude output, uses a 45-second upstream timeout, and may invoke web search for current news. It stores no server-side conversation session.
