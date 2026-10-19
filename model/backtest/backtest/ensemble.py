"""Stack fundamental heads with walk-forward weight tuning (no market in stack)."""

from __future__ import annotations

import numpy as np

from backtest.metrics import log_loss


def walk_forward_stack(
    heads: dict[str, np.ndarray],
    y: np.ndarray,
    season_arr: np.ndarray,
    seasons_sorted: list[str],
    min_train: int = 300,
) -> tuple[np.ndarray, dict]:
    names = list(heads.keys())
    mats = [heads[n] for n in names]
    stacked = np.zeros_like(y)
    weights_by_season: dict = {}
    for s in seasons_sorted:
        tr = season_arr < s
        te = season_arr == s
        if tr.sum() < min_train:
            stacked[te] = mats[0][te]
            weights_by_season[s] = {names[0]: 1.0}
            continue
        best_w = None
        best_ll = float("inf")
        grid = np.linspace(0, 1, 11)
        if len(names) == 2:
            for w0 in grid:
                mix = w0 * mats[0] + (1 - w0) * mats[1]
                ll = log_loss(mix[tr], y[tr])
                if ll < best_ll:
                    best_ll = ll
                    best_w = {names[0]: float(w0), names[1]: float(1 - w0)}
            assert best_w is not None
            mix = best_w[names[0]] * mats[0] + best_w[names[1]] * mats[1]
            stacked[te] = mix[te]
            weights_by_season[s] = best_w
        else:
            # equal weight fallback for 3+ heads
            mix = sum(mats) / len(mats)
            stacked[te] = mix[te]
            weights_by_season[s] = {n: 1 / len(names) for n in names}
    return stacked, weights_by_season
