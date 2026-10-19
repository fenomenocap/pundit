"""Phase 3 (xG): calibrated Understat rolling rates → Poisson / DC 1X2."""

from __future__ import annotations

import itertools

import numpy as np

from backtest.mapping import batch_lambdas_to_1x2
from backtest.xg.calibration import fit_understat_to_statsbomb, load_calibration
from backtest.xg.rolling import attach_prematch_xg_rates, lambdas_from_xg_rates


def walk_forward_xg_poisson(
    e,
    root,
    seasons_sorted: list[str],
    min_train: int = 300,
) -> tuple[np.ndarray, dict]:
    cal = load_calibration(root)
    if cal.get("status") in ("missing", "insufficient_overlap"):
        cal = fit_understat_to_statsbomb(root)
    e_x = attach_prematch_xg_rates(e, root, cal)
    y = np.stack([(e_x.FTR == "H"), (e_x.FTR == "D"), (e_x.FTR == "A")], axis=1).astype(float)
    season = e_x.Season.values
    probs = np.zeros((len(e_x), 3))
    meta = {
        "calibration": cal,
        "coverage": float(
            np.mean((e_x.xg_home_attack != 1.35) | (e_x.xg_away_attack != 1.35))
        ),
        "model": "xg_poisson_dc",
    }
    for s in seasons_sorted:
        tr = season < s
        te = season == s
        if tr.sum() < min_train:
            continue
        best = (1.08, -0.1)
        best_ll = float("inf")
        for ha, rho in itertools.product([1.0, 1.05, 1.08, 1.12, 1.18], [-0.12, -0.08, -0.04]):
            lh, la = _lambda_arrays(e_x.loc[tr], ha)
            p = batch_lambdas_to_1x2(np.array(lh), np.array(la), rho=rho)
            ll = float(-np.mean(np.log(np.clip((p * y[tr]).sum(1), 1e-15, 1))))
            if ll < best_ll:
                best_ll = ll
                best = (ha, rho)
        ha, rho = best
        lh, la = _lambda_arrays(e_x.loc[te], ha)
        probs[te] = batch_lambdas_to_1x2(np.array(lh), np.array(la), rho=rho)
    return probs, meta


def _lambda_arrays(frame, home_adv: float) -> tuple[list[float], list[float]]:
    lh, la = [], []
    for _, r in frame.iterrows():
        l1, l2 = lambdas_from_xg_rates(
            r.xg_home_attack,
            r.xg_home_defence,
            r.xg_away_attack,
            r.xg_away_defence,
            home_adv=home_adv,
        )
        lh.append(l1)
        la.append(l2)
    return lh, la
