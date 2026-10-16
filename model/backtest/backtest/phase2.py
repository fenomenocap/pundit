"""Phase 2: time-decayed Dixon–Coles attack/defence MLE (fundamental only)."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import gammaln

XI = 0.0065
RHO_INIT = -0.1


def _log_poisson(goals: np.ndarray, lam: np.ndarray) -> np.ndarray:
    return goals * np.log(lam + 1e-12) - lam - gammaln(goals + 1)


def _dc_tau(h: int, a: int, lh: float, la: float, rho: float) -> float:
    if h == 0 and a == 0:
        return 1 - lh * la * rho
    if h == 0 and a == 1:
        return 1 + lh * rho
    if h == 1 and a == 0:
        return 1 + la * rho
    if h == 1 and a == 1:
        return 1 - rho
    return 1.0


@dataclass
class MatchRow:
    home: str
    away: str
    hg: int
    ag: int
    weight: float
    t_index: int


def _match_loglik(
    params: np.ndarray,
    teams: list[str],
    rows: list[MatchRow],
    max_goals: int = 5,
) -> float:
    n = len(teams)
    idx = {t: i for i, t in enumerate(teams)}
    intercept, hfa, rho = params[0], params[1], params[2]
    att = params[3 : 3 + n]
    deff = params[3 + n : 3 + 2 * n]
    ll = 0.0
    for row in rows:
        i, j = idx[row.home], idx[row.away]
        lh = np.exp(intercept + hfa + att[i] - deff[j])
        la = np.exp(intercept + att[j] - deff[i])
        lh = min(float(lh), 8.0)
        la = min(float(la), 8.0)
        h, a = row.hg, row.ag
        lp = _log_poisson(np.array([h]), np.array([lh]))[0]
        lp += _log_poisson(np.array([a]), np.array([la]))[0]
        lp += np.log(max(_dc_tau(h, a, lh, la, rho), 1e-9))
        ll += row.weight * lp
    return -ll


def _prob_1x2_from_rates(lh: float, la: float, rho: float, max_goals: int = 10) -> np.ndarray:
    ph = np.exp(-lh) * lh ** np.arange(max_goals + 1) / np.array(
        [float(math.factorial(k)) for k in range(max_goals + 1)]
    )
    pa = np.exp(-la) * la ** np.arange(max_goals + 1) / np.array(
        [float(math.factorial(k)) for k in range(max_goals + 1)]
    )
    m = np.outer(ph, pa)
    for h in range(2):
        for a in range(2):
            m[h, a] *= _dc_tau(h, a, lh, la, rho)
    m /= m.sum()
    return np.array([np.tril(m, -1).sum(), np.trace(m), np.triu(m, 1).sum()])


def fit_dc_mle(train_rows: list[MatchRow]) -> tuple[dict, list[str]]:
    teams = sorted({r.home for r in train_rows} | {r.away for r in train_rows})
    n = len(teams)
    x0 = np.zeros(3 + 2 * n)
    x0[0] = np.log(1.35)
    x0[1] = 0.25
    x0[2] = RHO_INIT
    bounds = [(-2, 1), (-1, 1.5), (-0.3, 0.1)] + [(-2, 2)] * (2 * n)
    res = minimize(_match_loglik, x0, args=(teams, train_rows), method="L-BFGS-B", bounds=bounds)
    p = res.x
    params = {
        "intercept": float(p[0]),
        "home_adv": float(p[1]),
        "rho": float(p[2]),
        "attack": {t: float(p[3 + i]) for i, t in enumerate(teams)},
        "defence": {t: float(p[3 + n + i]) for i, t in enumerate(teams)},
    }
    return params, teams


def predict_dc(params: dict, home: str, away: str) -> np.ndarray:
    att, deff = params["attack"], params["defence"]
    if home not in att or away not in att:
        return np.array([1 / 3, 1 / 3, 1 / 3])
    lh = np.exp(params["intercept"] + params["home_adv"] + att[home] - deff[away])
    la = np.exp(params["intercept"] + att[away] - deff[home])
    return _prob_1x2_from_rates(min(lh, 8), min(la, 8), params["rho"])


def build_weighted_rows(
    df_train,
    origin_index: int,
) -> list[MatchRow]:
    rows = []
    for k, (_, r) in enumerate(df_train.iterrows()):
        w = float(np.exp(-XI * (origin_index - k)))
        rows.append(
            MatchRow(
                home=r.HomeTeam,
                away=r.AwayTeam,
                hg=int(r.FTHG),
                ag=int(r.FTAG),
                weight=w,
                t_index=k,
            )
        )
    return rows


def walk_forward_phase2(
    e: pd.DataFrame,
    seasons_sorted: list[str],
    min_train: int = 300,
) -> np.ndarray:
    probs = np.zeros((len(e), 3))
    season_arr = e.Season.values
    for s in seasons_sorted:
        tr = (season_arr < s)
        te = season_arr == s
        if tr.sum() < min_train:
            continue
        train_df = e.loc[tr].reset_index(drop=True)
        rows = build_weighted_rows(train_df, len(train_df) - 1)
        params, _ = fit_dc_mle(rows)
        for idx in np.where(te)[0]:
            row = e.iloc[idx]
            probs[idx] = predict_dc(params, row.HomeTeam, row.AwayTeam)
    return probs
