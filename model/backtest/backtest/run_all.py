"""Run all phases and emit comparison summary."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from backtest.data import epl_evaluation_frame, load_match_rows
from backtest.elo_proxy import anchor_proxy_to_clubelo, build_point_in_time_elo, load_clubelo_eng_anchor
from backtest.ensemble import walk_forward_stack
from backtest.gate import evaluate_edge_gate, write_gate_artifact
from backtest.harness import repo_root
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
from backtest.phase1 import walk_forward_phase1
from backtest.phase2 import walk_forward_phase2
from backtest.phase3 import walk_forward_phase3


def _prepare(root: Path, seasons: list[str] | None):
    df = load_match_rows(root, seasons=seasons)
    df = build_point_in_time_elo(df)
    clubelo = load_clubelo_eng_anchor(repo_root())
    df, corr = anchor_proxy_to_clubelo(df, clubelo)
    df = attach_market_probs(df)
    criteria = load_promotion_criteria(root)
    eval_from = criteria["holdout"]["evaluationSeasonsFrom"]
    e = epl_evaluation_frame(df, from_season=eval_from)
    y = outcomes_one_hot(e.FTR)
    seasons_sorted = sorted(e.Season.unique())
    return df, e, y, seasons_sorted, corr, criteria


def run_all_phases(root: Path, seasons: list[str] | None = None) -> dict:
    df, e, y, seasons_sorted, corr, criteria = _prepare(root, seasons)
    season_arr = e.Season.values
    elo_h, elo_a = e.eloH.values, e.eloA.values

    champion = batch_pundit_1x2(elo_h, elo_a)
    market = e[["qH", "qD", "qA"]].values

    phase1, p1_params = walk_forward_phase1(season_arr, seasons_sorted, elo_h, elo_a, y)
    # fill seasons that still zero in phase1
    unset = (phase1.sum(axis=1) == 0)
    phase1[unset] = champion[unset]

    phase2 = walk_forward_phase2(e, seasons_sorted)
    unset2 = phase2.sum(axis=1) == 0
    phase2[unset2] = champion[unset2]

    phase3, p3_meta = walk_forward_phase3(e, df, seasons_sorted, baseline_probs=phase1)
    unset3 = phase3.sum(axis=1) == 0
    phase3[unset3] = phase1[unset3]

    ensemble, ens_w = walk_forward_stack(
        {"phase1": phase1, "phase2": phase2, "phase3": phase3},
        y,
        season_arr,
        seasons_sorted,
    )

    models = {
        "champion_baseline": champion,
        "phase1_refit": phase1,
        "phase2_dc_mle": phase2,
        "phase3_context_xg": phase3,
        "ensemble_fundamental": ensemble,
        "market_close_novig": market,
    }
    m_season = metrics_by_season(e, "Season", models, y)
    cal_parts = [calibration_table(p, y, name) for name, p in models.items() if name != "market_close_novig"]
    cal_parts.append(calibration_table(market, y, "market_close_novig"))
    cal = pd.concat(cal_parts, ignore_index=True)
    div = divergence_buckets(champion, market, y)

    art = root / "artifacts" / "latest"
    art.mkdir(parents=True, exist_ok=True)
    m_season.to_csv(art / "metrics_by_season.csv", index=False)
    cal.to_csv(art / "calibration.csv", index=False)
    div.to_csv(art / "divergence_buckets.csv", index=False)

    # pick best fundamental by log loss
    candidates = {
        "champion_baseline": champion,
        "phase1_refit": phase1,
        "phase2_dc_mle": phase2,
        "phase3_context_xg": phase3,
        "ensemble_fundamental": ensemble,
    }
    ll_scores = {k: log_loss(v, y) for k, v in candidates.items()}
    best_name = min(ll_scores, key=ll_scores.get)
    best_p = candidates[best_name]
    promoted_vs_champion = ll_scores[best_name] < log_loss(champion, y)
    beat_close = bootstrap_log_loss_delta(
        best_p,
        market,
        y,
        n=criteria["bootstrap"]["n"],
        seed=criteria["bootstrap"]["seed"],
    )

    gate = evaluate_edge_gate(
        best_p,
        market,
        y,
        criteria["edgeGate"]["divergenceThresholds"],
        criteria,
    )
    # Production default stays champion until BACKTEST_PROMOTED_MODEL_ENABLED=true.
    gate["promotedModel"] = best_name if promoted_vs_champion else "champion_baseline"
    gate["challengerBeatsChampion"] = promoted_vs_champion
    gate["challengerBeatsCloseCi"] = beat_close["beats_close_ci_excludes_zero"]
    gate["phaseMetrics"] = {
        name: {
            "logloss": round(log_loss(p, y), 4),
            "vs_champion_delta": round(log_loss(p, y) - log_loss(champion, y), 4),
            "vs_close_delta": round(log_loss(p, y) - log_loss(market, y), 4),
        }
        for name, p in candidates.items()
    }
    gate["clubelo_anchor_corr"] = corr
    gate["phase3_meta"] = p3_meta
    gate["ensemble_weights"] = ens_w
    write_gate_artifact(gate, root)

    summary = {
        "n": int(len(e)),
        "logloss": ll_scores,
        "market_logloss": round(log_loss(market, y), 4),
        "best_fundamental": best_name,
        "promoted_for_production": gate["promotedModel"],
        "challenger_beats_champion": promoted_vs_champion,
        "beats_close_ci": beat_close,
        "edgeValidationActive": gate["edgeValidationActive"],
    }
    (art / "summary.json").write_text(json.dumps(summary, indent=2))
    return summary


def run_single_phase(root: Path, phase: str, seasons: list[str] | None = None) -> dict:
    df, e, y, seasons_sorted, corr, criteria = _prepare(root, seasons)
    season_arr = e.Season.values
    elo_h, elo_a = e.eloH.values, e.eloA.values
    champion = batch_pundit_1x2(elo_h, elo_a)
    market = e[["qH", "qD", "qA"]].values
    if phase == "1":
        p, params = walk_forward_phase1(season_arr, seasons_sorted, elo_h, elo_a, y)
        name = "phase1_refit"
    elif phase == "2":
        p = walk_forward_phase2(e, seasons_sorted)
        p[p.sum(axis=1) == 0] = champion[p.sum(axis=1) == 0]
        name = "phase2_dc_mle"
    elif phase == "3":
        p, _ = walk_forward_phase3(e, df, seasons_sorted, baseline_probs=champion)
        name = "phase3_context_xg"
    elif phase == "ensemble":
        p1, _ = walk_forward_phase1(season_arr, seasons_sorted, elo_h, elo_a, y)
        p2 = walk_forward_phase2(e, seasons_sorted)
        p2[p2.sum(axis=1) == 0] = champion[p2.sum(axis=1) == 0]
        p3, _ = walk_forward_phase3(e, df, seasons_sorted, baseline_probs=p1)
        p, _ = walk_forward_stack({"phase1": p1, "phase2": p2, "phase3": p3}, y, season_arr, seasons_sorted)
        name = "ensemble_fundamental"
    else:
        raise ValueError(phase)
    return {
        "phase": name,
        "logloss": round(log_loss(p, y), 4),
        "champion_logloss": round(log_loss(champion, y), 4),
        "market_logloss": round(log_loss(market, y), 4),
        "clubelo_anchor_corr": corr,
    }
