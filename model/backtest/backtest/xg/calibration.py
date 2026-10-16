"""Calibrate Understat xG to StatsBomb open-data (2015/16 PL)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from backtest.xg.statsbomb_fetch import load_statsbomb_calibration
from backtest.xg.team_names import to_statsbomb, to_understat
from backtest.xg.understat_fetch import load_understat_matches


def _norm_key(home: str, away: str, date: str) -> tuple:
    return (date[:10], to_statsbomb(home).lower(), to_statsbomb(away).lower())


def fit_understat_to_statsbomb(root: Path) -> dict:
    sb = load_statsbomb_calibration(root)
    us = [m for m in load_understat_matches(root) if str(m.get("datetime", "")).startswith("2015")]
    sb_idx = {_norm_key(r["home"], r["away"], r["date"]): r for r in sb}
    pairs_h, pairs_a = [], []
    for m in us:
        key = _norm_key(m["home"], m["away"], m["datetime"])
        r = sb_idx.get(key)
        if not r:
            continue
        pairs_h.append((m["home_xg"], r["home_xg_sb"]))
        pairs_a.append((m["away_xg"], r["away_xg_sb"]))
    if len(pairs_h) < 50:
        return {"status": "insufficient_overlap", "n": len(pairs_h), "scale_h": 1.0, "scale_a": 1.0, "bias_h": 0.0, "bias_a": 0.0}
    xh, yh = np.array(pairs_h).T
    xa, ya = np.array(pairs_a).T
    scale_h, bias_h = np.polyfit(xh, yh, 1)
    scale_a, bias_a = np.polyfit(xa, ya, 1)
    artifact = {
        "status": "fitted",
        "n": int(len(pairs_h)),
        "scale_h": float(scale_h),
        "bias_h": float(bias_h),
        "scale_a": float(scale_a),
        "bias_a": float(bias_a),
        "reference": "statsbomb/open-data PL 2015/16 vs understat 2015",
    }
    out = root / "data" / "xg" / "calibration_v1.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(artifact, indent=2))
    return artifact


def load_calibration(root: Path) -> dict:
    for rel in ("data/xg/calibration_v1.json", "data/xg/fixtures/calibration_v1.json"):
        path = root / rel
        if path.exists():
            return json.loads(path.read_text())
    return {"status": "missing", "scale_h": 1.0, "scale_a": 1.0, "bias_h": 0.0, "bias_a": 0.0}


def apply_calibration(hx: float, ax: float, cal: dict) -> tuple[float, float]:
    return (
        max(0.01, cal.get("scale_h", 1.0) * hx + cal.get("bias_h", 0.0)),
        max(0.01, cal.get("scale_a", 1.0) * ax + cal.get("bias_a", 0.0)),
    )
