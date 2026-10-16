"""Log loss, Brier, calibration, divergence buckets, bootstrap CIs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

RNG = np.random.default_rng(0)


def outcomes_one_hot(ftr: pd.Series) -> np.ndarray:
    return np.stack(
        [(ftr == "H"), (ftr == "D"), (ftr == "A")],
        axis=1,
    ).astype(float)


def log_loss(probs: np.ndarray, y: np.ndarray) -> float:
    p = np.clip((probs * y).sum(axis=1), 1e-15, 1.0)
    return float(-np.mean(np.log(p)))


def brier(probs: np.ndarray, y: np.ndarray) -> float:
    return float(np.mean(((probs - y) ** 2).sum(axis=1)))


def metrics_row(name: str, probs: np.ndarray, y: np.ndarray, mask: np.ndarray) -> dict:
    p = probs[mask]
    yy = y[mask]
    return {
        "model": name,
        "n": int(mask.sum()),
        "brier": round(brier(p, yy), 4),
        "logloss": round(log_loss(p, yy), 4),
    }


def metrics_by_season(
    df: pd.DataFrame,
    season_col: str,
    models: dict[str, np.ndarray],
    y: np.ndarray,
) -> pd.DataFrame:
    rows = []
    seasons = ["ALL"] + sorted(df[season_col].unique())
    for s in seasons:
        mask = np.ones(len(df), bool) if s == "ALL" else (df[season_col] == s).values
        for name, probs in models.items():
            row = metrics_row(name, probs, y, mask)
            row["season"] = s
            rows.append(row)
    return pd.DataFrame(rows)


def calibration_table(
    probs: np.ndarray,
    y: np.ndarray,
    model_name: str,
    bins: Iterable[float] | None = None,
) -> pd.DataFrame:
    bins = np.arange(0, 1.01, 0.1) if bins is None else np.array(list(bins))
    pf = probs.ravel()
    yf = y.ravel()
    rows = []
    for lo in bins[:-1]:
        hi = lo + 0.1
        k = (pf >= lo) & (pf < hi)
        if k.sum():
            rows.append(
                {
                    "model": model_name,
                    "bin": f"{lo:.1f}-{hi:.1f}",
                    "n": int(k.sum()),
                    "mean_pred": round(float(pf[k].mean()), 3),
                    "actual": round(float(yf[k].mean()), 3),
                }
            )
    return pd.DataFrame(rows)


def divergence_buckets(
    model_p: np.ndarray,
    market_p: np.ndarray,
    y: np.ndarray,
    model_name: str = "model",
    market_name: str = "market",
) -> pd.DataFrame:
    dv = np.abs(model_p - market_p).max(axis=1)
    edges = [(0, 0.05), (0.05, 0.10), (0.10, 0.15), (0.15, 1.0)]
    rows = []
    for lo, hi in edges:
        k = (dv >= lo) & (dv < hi)
        rows.append(
            {
                "div_bucket": f"{lo:.2f}-{hi:.2f}",
                "n": int(k.sum()),
                f"{model_name}_ll": round(log_loss(model_p[k], y[k]), 4) if k.sum() else None,
                f"{market_name}_ll": round(log_loss(market_p[k], y[k]), 4) if k.sum() else None,
                f"{model_name}_brier": round(brier(model_p[k], y[k]), 4) if k.sum() else None,
                f"{market_name}_brier": round(brier(market_p[k], y[k]), 4) if k.sum() else None,
            }
        )
    return pd.DataFrame(rows)


def bootstrap_log_loss_delta(
    model_p: np.ndarray,
    market_p: np.ndarray,
    y: np.ndarray,
    n: int = 2000,
    seed: int = 0,
) -> dict:
    rng = np.random.default_rng(seed)
    n_rows = len(y)
    deltas = []
    for _ in range(n):
        idx = rng.integers(0, n_rows, n_rows)
        deltas.append(log_loss(model_p[idx], y[idx]) - log_loss(market_p[idx], y[idx]))
    arr = np.array(deltas)
    return {
        "delta_mean": round(float(arr.mean()), 4),
        "ci_low": round(float(np.percentile(arr, 2.5)), 4),
        "ci_high": round(float(np.percentile(arr, 97.5)), 4),
        "beats_close_point_estimate": bool(arr.mean() < 0),
        "beats_close_ci_excludes_zero": bool(np.percentile(arr, 97.5) < 0),
    }


def load_promotion_criteria(package_dir: Path) -> dict:
    return json.loads((package_dir / "backtest/promotion_criteria.json").read_text())
