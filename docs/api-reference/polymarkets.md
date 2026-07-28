# Polymarket Reference Odds

**Legacy — World Cup 2026 reference only.** These endpoints are retained for historical API completeness. The club-season product uses Stake, Kalshi, and Polymarket **fixture-level** 1X2 prices via the active market-odds cache instead. See [Data Sources](../how-it-works/data-sources.md).

Live World Cup consensus odds pulled from Polymarket's public Gamma API. **Reference only** — these are not markets you can trade inside Pundit.

### `GET /api/polymarkets/wc`

Tournament outright-winner markets (World Cup 2026).

### `GET /api/polymarkets/groups`

Group-winner markets (Groups A–L).

Both endpoints return the same shape:

```json
{
  "markets": [
    {
      "id": "0x1234",
      "question": "Will France win the 2026 FIFA World Cup?",
      "outcomes": ["Yes", "No"],
      "outcomePrices": ["0.18", "0.82"],
      "liquidity": "142500.32",
      "volume": "982340.11",
      "endDate": "2026-07-19T00:00:00Z",
      "resolved": false,
      "active": true,
      "type": "wc-outright",
      "group": null
    }
  ],
  "lastUpdated": "2026-06-12T10:00:00.000Z",
  "error": null
}
```

`group` is populated (e.g. `"A"`) on `/groups` results and `null` on `/wc` results.
