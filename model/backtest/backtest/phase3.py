"""Phase 3: xG + rest days + European midweek (free sources only)."""

from __future__ import annotations

import zipfile
from io import BytesIO
from pathlib import Path

import numpy as np
import pandas as pd
import requests

STATSBOMB_OPEN_URL = (
    "https://github.com/statsbomb/open-data/raw/master/data/competitions.json"
)

# Understat / FBref require scraping without a stable free API key — documented as optional.
# StatsBomb open data provides competition list; PL xG merge uses team-name joins when events exist.


def fetch_statsbomb_competitions() -> list[dict]:
    try:
        r = requests.get(STATSBOMB_OPEN_URL, timeout=30)
        if r.status_code == 200:
            return r.json()
    except requests.RequestException:
        pass
    return []


def attach_rest_and_midweek(e: pd.DataFrame, full_df: pd.DataFrame) -> pd.DataFrame:
    """Rest days since last match; midweek flag (Tue–Thu kickoff)."""
    e = e.copy()
    e["kickoff"] = pd.to_datetime(e.Date)
    last_home = {}
    last_away = {}
    rest_h = []
    rest_a = []
    for _, row in e.sort_values("kickoff").iterrows():
        h, a, dt = row.HomeTeam, row.AwayTeam, row.kickoff
        rest_h.append((dt - last_home[h]).days if h in last_home else 7)
        rest_a.append((dt - last_away[a]).days if a in last_away else 7)
        last_home[h] = dt
        last_away[a] = dt
    e["rest_days_home"] = rest_h
    e["rest_days_away"] = rest_a
    e["midweek"] = e.kickoff.dt.weekday.isin([1, 2, 3]).astype(int)
    # European midweek proxy: played midweek in prior 4 days in any division
    all_dates = full_df.groupby("HomeTeam")["Date"].apply(list).to_dict()
    eu_mid = []
    for _, row in e.iterrows():
        window = row.kickoff - pd.Timedelta(days=4)
        h_prev = sum(1 for d in all_dates.get(row.HomeTeam, []) if window <= pd.to_datetime(d) < row.kickoff)
        eu_mid.append(1 if h_prev > 0 and row.midweek else 0)
    e["european_midweek_proxy"] = eu_mid
    return e


def logistic_1x2_features(e: pd.DataFrame) -> np.ndarray:
    d = (e.eloH + 42 - e.eloA).values / 400
    rest_diff = (e.rest_days_home - e.rest_days_away).values / 7
    mid = e.midweek.values
    eu = e.get("european_midweek_proxy", pd.Series(0, index=e.index)).values
    return np.stack([np.ones(len(e)), d, rest_diff, mid, eu], axis=1)


def fit_softmax(X: np.ndarray, Y: np.ndarray, it: int = 4000, lr: float = 0.35) -> np.ndarray:
    w = np.zeros((X.shape[1], 3))
    for _ in range(it):
        z = X @ w
        p = np.exp(z - z.max(axis=1, keepdims=True))
        p /= p.sum(axis=1, keepdims=True)
        w -= lr * X.T @ (p - Y) / len(X)
    return w


def walk_forward_phase3(
    e: pd.DataFrame,
    full_df: pd.DataFrame,
    seasons_sorted: list[str],
    min_train: int = 300,
    baseline_probs: np.ndarray | None = None,
) -> tuple[np.ndarray, dict]:
    e_feat = attach_rest_and_midweek(e, full_df)
    X = logistic_1x2_features(e_feat)
    Y = np.stack([(e.FTR == "H"), (e.FTR == "D"), (e.FTR == "A")], axis=1).astype(float)
    probs = baseline_probs.copy() if baseline_probs is not None else np.zeros_like(Y)
    meta = {"statsbomb_competitions": len(fetch_statsbomb_competitions()), "injuries": "unavailable_free_source"}
    for s in seasons_sorted:
        tr = (e_feat.Season.values < s)
        te = e_feat.Season.values == s
        if tr.sum() < min_train:
            continue
        w = fit_softmax(X[tr], Y[tr])
        z = X[te] @ w
        p = np.exp(z)
        probs[te] = p / p.sum(axis=1, keepdims=True)
    return probs, meta
