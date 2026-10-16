"""Phase 1: walk-forward per-season refit of HFA, base goals, rho."""

from __future__ import annotations

import itertools

import numpy as np

from backtest.mapping import batch_pundit_1x2

MIN_TRAIN = 300


def _grid_search_train(
    elo_h: np.ndarray,
    elo_a: np.ndarray,
    y: np.ndarray,
    train_mask: np.ndarray,
) -> tuple[float, float, float]:
    hfa_grid = [32, 38, 42, 48, 55]
    base_grid = [1.15, 1.25, 1.35, 1.45, 1.55]
    rho_grid = [-0.15, -0.1, -0.05, 0.0]
    best = (42.0, 1.35, -0.1)
    best_ll = float("inf")
    eh, ea, yy = elo_h[train_mask], elo_a[train_mask], y[train_mask]
    for hfa, base, rho in itertools.product(hfa_grid, base_grid, rho_grid):
        p = batch_pundit_1x2(eh, ea, hfa=hfa, base=base, rho=rho)
        ll = float(-np.mean(np.log(np.clip((p * yy).sum(1), 1e-15, 1))))
        if ll < best_ll:
            best_ll = ll
            best = (hfa, base, rho)
    return best


def walk_forward_phase1(
    df_season: np.ndarray,
    seasons_sorted: list[str],
    elo_h: np.ndarray,
    elo_a: np.ndarray,
    y: np.ndarray,
    min_train: int = MIN_TRAIN,
) -> np.ndarray:
    probs = np.zeros_like(y)
    params_by_season: dict[str, dict] = {}
    for s in seasons_sorted:
        tr = df_season < s
        te = df_season == s
        if tr.sum() < min_train:
            p = batch_pundit_1x2(elo_h[te], elo_a[te])
            probs[te] = p
            params_by_season[s] = {"hfa": 42, "base": 1.35, "rho": -0.1, "fallback": True}
            continue
        hfa, base, rho = _grid_search_train(elo_h, elo_a, y, tr)
        probs[te] = batch_pundit_1x2(elo_h[te], elo_a[te], hfa=hfa, base=base, rho=rho)
        params_by_season[s] = {"hfa": hfa, "base": base, "rho": rho, "fallback": False}
    return probs, params_by_season
