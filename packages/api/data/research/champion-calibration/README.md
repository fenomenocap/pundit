# Champion calibration (Phase 1b)

Offline fit of the **current champion**: pinned ClubElo + Phase 0 fixed-total Dixon–Coles grid (`BASE_GOALS`, HFA, `rho`, optional mild mismatch inflation). This is not a fitted attack/defence challenger, not a geometric-mean remapping, and not a MiniMax probability engine.

Production **does not auto-load** anything in this directory. `dixon-coles.ts` constants stay at 1.35 / 42 / −0.1 until a human copies a reviewed config.

## Ledger

Default input is the local club-season artifact:

```text
packages/api/data/evaluation/club-season.json
```

If `PUNDIT_DATA_DIR` is set, that path is used instead. **Production evidence lives on Railway at `PUNDIT_DATA_DIR=/data`** (`/data/evaluation/club-season.json`). As of 2026-09-09 that file has **52 sealed rows, 44 official `scheduled_window`** (30 Premier League, 14 UCL qualifying) and 8 legacy excluded. The in-repo seed is not truth and may be empty.

The calibrator never writes to `/data` or to `evaluation/club-season.json`.

## Command

```bash
pnpm --filter @sports-predict/api calibrate:champion -- [ledgerPath] [--out-dir dir] [--bootstrap 40]
```

If the chosen ledger has **0 official sealed fixtures with results**, the tool fits `sample-official-ledger.json` and prints that production **n=44** is the real target.

Official rows exclude `legacy_partial`, post-kickoff forecasts, and incomplete provenance — the same gate as club-season metrics.

## Outputs

Written under `reports/` (repo research dir, not `/data`):

- `champion-calibration-report.json`
- `champion-calibration-report.md`
- `<sha256>.json` — content-addressed constants with `productionAutoLoad: false`

## What is fitted

- `BASE_GOALS` on Premier League when PL sample exists; UCL stays frozen at 1.35 unless n≥20
- HFA in Elo points (neutral venues stay 0)
- Dixon–Coles `rho`
- Optional mild total-xG inflation `kappa * ((r-1)/(r+1))^2` — **not** raw `f+1/f`, **not** desk `INFLATE=0.3`

Shipping new constants requires n≥~40 PL, a clearly better 1X2 Brier, and a human decision. Golden-cutover is not rebuilt by this tool.

## Latest report (2026-09-09)

Fit on a read-only copy of production `GET /api/evaluation/club-season` (gitignored under `ledgers/`). Official n=44 (PL 30, UCL 14). UCL `BASE_GOALS` frozen. Fitted research constants **1.42 / 40 / 0** vs shipped **1.35 / 42 / −0.1**. 1X2 Brier did **not** improve (0.655 vs 0.646). Production unchanged. See `reports/champion-calibration-report.md`.
