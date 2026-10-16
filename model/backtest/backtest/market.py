"""De-margined closing 1X2 from football-data.co.uk columns (benchmark only)."""

from __future__ import annotations

import numpy as np
import pandas as pd

CLOSE_SOURCES = ("PSC", "BFEC", "AvgC")


def pick_close_odds(row: pd.Series) -> tuple[str | None, np.ndarray]:
    for prefix in CLOSE_SOURCES:
        o = [row.get(f"{prefix}H"), row.get(f"{prefix}D"), row.get(f"{prefix}A")]
        if all(pd.notna(v) and float(v) > 1 for v in o):
            return prefix, np.array(o, dtype=float)
    return None, np.array([np.nan, np.nan, np.nan])


def attach_market_probs(df: pd.DataFrame) -> pd.DataFrame:
    src = []
    odds = []
    for _, row in df.iterrows():
        p, o = pick_close_odds(row)
        src.append(p)
        odds.append(o)
    df = df.copy()
    df["mkt_src"] = src
    o_arr = np.array(odds, dtype=float)
    df[["oH", "oD", "oA"]] = o_arr
    imp = 1.0 / o_arr
    q = imp / imp.sum(axis=1, keepdims=True)
    df[["qH", "qD", "qA"]] = q
    return df
