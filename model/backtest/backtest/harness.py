"""Orchestrate walk-forward backtest and write artifacts."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from backtest.data import epl_evaluation_frame, load_match_rows
from backtest.elo_proxy import anchor_proxy_to_clubelo, build_point_in_time_elo, load_clubelo_eng_anchor
from backtest.mapping import batch_pundit_1x2
from backtest.market import attach_market_probs
from backtest.metrics import (
    bootstrap_log_loss_delta,
    calibration_table,
    divergence_buckets,
    load_promotion_criteria,
    log_loss,
    metrics_by_season,
    outcomes_one_hot,
)


def package_root() -> Path:
    return Path(__file__).resolve().parent.parent


def repo_root() -> Path:
    return package_root().parent.parent


def run_baseline_harness(
    root: Path | None = None,
    seasons: list[str] | None = None,
    eval_from_season: str = "2122",
) -> dict:
    root = root or package_root()
    criteria = load_promotion_criteria(root)
    eval_from = criteria["holdout"].get("evaluationSeasonsFrom", eval_from_season)

    df = load_match_rows(root, seasons=seasons)
    df = build_point_in_time_elo(df)
    clubelo = load_clubelo_eng_anchor(repo_root())
    df, corr = anchor_proxy_to_clubelo(df, clubelo)
    df = attach_market_probs(df)
    e = epl_evaluation_frame(df, from_season=eval_from)
    y = outcomes_one_hot(e.FTR)
    pm = batch_pundit_1x2(e.eloH.values, e.eloA.values)
    pq = e[["qH", "qD", "qA"]].values

    models = {
        "champion_baseline": pm,
        "market_close_novig": pq,
    }
    m_season = metrics_by_season(e, "Season", models, y)
    cal = pd.concat(
        [
            calibration_table(pm, y, "champion_baseline"),
            calibration_table(pq, y, "market_close_novig"),
        ],
        ignore_index=True,
    )
    div = divergence_buckets(pm, pq, y, "champion_baseline", "market_close_novig")
    boot = bootstrap_log_loss_delta(
        pm,
        pq,
        y,
        n=criteria["bootstrap"]["n"],
        seed=criteria["bootstrap"]["seed"],
    )

    art = root / "artifacts" / "latest"
    art.mkdir(parents=True, exist_ok=True)
    m_season.to_csv(art / "metrics_by_season.csv", index=False)
    cal.to_csv(art / "calibration.csv", index=False)
    div.to_csv(art / "divergence_buckets.csv", index=False)
    e.assign(mH=pm[:, 0], mD=pm[:, 1], mA=pm[:, 2]).to_csv(art / "backtest_rows.csv", index=False)

    summary = {
        "phase": "baseline",
        "n": int(len(e)),
        "clubelo_anchor_corr": corr,
        "champion_logloss": log_loss(pm, y),
        "market_logloss": log_loss(pq, y),
        "bootstrap_vs_close": boot,
        "beats_close": boot["beats_close_ci_excludes_zero"],
    }
    (art / "summary.json").write_text(json.dumps(summary, indent=2))
    return summary
