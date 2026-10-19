"""Load football-data.co.uk CSVs (download or fixtures)."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import requests

DEFAULT_SEASONS = [
    "1516",
    "1617",
    "1718",
    "1819",
    "1920",
    "2021",
    "2122",
    "2223",
    "2324",
    "2425",
    "2526",
    "2627",
]
DIVISIONS = ("E0", "E1")
BASE_URL = "https://www.football-data.co.uk/mmz4281/{season}/{div}.csv"


def raw_dir(root: Path) -> Path:
    d = root / "data" / "raw"
    d.mkdir(parents=True, exist_ok=True)
    return d


def download_season_div(season: str, div: str, dest: Path, timeout: int = 60) -> bool:
    url = BASE_URL.format(season=season, div=div)
    try:
        r = requests.get(url, timeout=timeout)
        if r.status_code != 200:
            return False
        dest.write_bytes(r.content)
        return True
    except requests.RequestException:
        return False


def download_all(root: Path, seasons: list[str] | None = None) -> dict:
    seasons = seasons or DEFAULT_SEASONS
    out = {"ok": [], "missing": []}
    dest_root = raw_dir(root)
    for season in seasons:
        for div in DIVISIONS:
            dest = dest_root / f"{div}_{season}.csv"
            if download_season_div(season, div, dest):
                out["ok"].append(f"{div}_{season}")
            else:
                out["missing"].append(f"{div}_{season}")
    return out


def load_match_rows(root: Path, seasons: list[str] | None = None) -> pd.DataFrame:
    seasons = seasons or DEFAULT_SEASONS
    rows = []
    dest_root = raw_dir(root)
    for season in seasons:
        for div in DIVISIONS:
            path = dest_root / f"{div}_{season}.csv"
            if not path.exists():
                continue
            d = pd.read_csv(path, encoding="latin1", on_bad_lines="skip")
            d = d.dropna(subset=["HomeTeam", "FTHG"])
            d["Div"] = div
            d["Season"] = season
            rows.append(d)
    if not rows:
        raise FileNotFoundError(
            f"No CSV rows under {dest_root}. Run: python -m backtest.cli download-data"
        )
    df = pd.concat(rows, ignore_index=True)
    df["Date"] = pd.to_datetime(df["Date"], dayfirst=True, format="mixed")
    return df.sort_values("Date").reset_index(drop=True)


def epl_evaluation_frame(df: pd.DataFrame, from_season: str = "2122") -> pd.DataFrame:
    e = df[(df.Div == "E0") & (df.Season >= from_season)].copy()
    return e.dropna(subset=["qH"])
