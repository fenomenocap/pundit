"""Optional ClubElo dated CSV via live API or Wayback (best-effort)."""

from __future__ import annotations

import io
from datetime import timedelta

import pandas as pd
import requests


def fetch_clubelo_csv(ranking_date: str, timeout: int = 30) -> pd.DataFrame | None:
    """Return Club|Country|Elo|From|To CSV for one ranking date, or None."""
    urls = [
        f"http://api.clubelo.com/{ranking_date}",
        f"https://api.clubelo.com/{ranking_date}",
        f"https://web.archive.org/web/{ranking_date.replace('-', '')}000000id_/http://api.clubelo.com/{ranking_date}",
    ]
    for url in urls:
        try:
            r = requests.get(url, timeout=timeout, headers={"User-Agent": "PunditBacktest/1.0"})
            if r.status_code != 200 or len(r.content) < 100:
                continue
            df = pd.read_csv(io.StringIO(r.text))
            if "Club" in df.columns and "Elo" in df.columns:
                return df
        except (requests.RequestException, pd.errors.ParserError):
            continue
    return None


def probe_clubelo_reachability(sample_dates: list[str] | None = None) -> dict:
    sample_dates = sample_dates or ["2021-08-13", "2022-01-01", "2024-08-16"]
    out = {}
    for d in sample_dates:
        df = fetch_clubelo_csv(d)
        out[d] = "ok" if df is not None else "unreachable"
    return {
        "status": "ok" if any(v == "ok" for v in out.values()) else "unreachable",
        "dates": out,
        "note": "Production backtest keeps results-built Elo proxy when ClubElo CSVs are unavailable.",
    }
