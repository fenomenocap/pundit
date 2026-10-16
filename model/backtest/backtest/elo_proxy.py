"""Point-in-time Elo proxy (ClubElo-style) from match results; scaled to production pin."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Dict, Tuple

import numpy as np
import pandas as pd

K = 20
HFA_FIT = 65  # only for proxy rating updates (not production HFA)
INIT = {"E0": 1850.0, "E1": 1650.0}

TEAM_ALIASES_TO_CLUBELO = {
    "Nott'm Forest": "Forest",
    "Man United": "Man United",
    "Man City": "Man City",
    "Tottenham": "Tottenham",
    "Brighton": "Brighton",
    "Wolves": "Wolves",
    "West Ham": "West Ham",
    "Leicester": "Leicester",
    "Newcastle": "Newcastle",
}


def _goal_diff_multiplier(gd: int) -> float:
    return math.sqrt(abs(gd)) if abs(gd) > 1 else 1.0


def build_point_in_time_elo(df: pd.DataFrame) -> pd.DataFrame:
    """Add eloH_raw, eloA_raw frozen before each match day."""
    df = df.sort_values("Date").reset_index(drop=True)
    elo: Dict[str, float] = {}
    pre_h: list = []
    pre_a: list = []
    for date, group in df.groupby("Date", sort=True):
        snap = dict(elo)
        updates = []
        for _, row in group.iterrows():
            h, a = row.HomeTeam, row.AwayTeam
            div = row.Div
            for team in (h, a):
                if team not in elo:
                    elo[team] = INIT.get(div, 1700.0)
                    snap[team] = elo[team]
            pre_h.append((row.name, snap[h]))
            pre_a.append((row.name, snap[a]))
            dr = snap[h] + HFA_FIT - snap[a]
            we = 1 / (1 + 10 ** (-dr / 400))
            gd = int(row.FTHG) - int(row.FTAG)
            w = 1.0 if gd > 0 else (0.5 if gd == 0 else 0.0)
            mult = _goal_diff_multiplier(gd)
            updates.append((h, a, K * mult * (w - we)))
        for h, a, delta in updates:
            elo[h] += delta
            elo[a] -= delta
    df.loc[[i for i, _ in pre_h], "eloH_raw"] = [v for _, v in pre_h]
    df.loc[[i for i, _ in pre_a], "eloA_raw"] = [v for _, v in pre_a]
    return df


def load_clubelo_eng_anchor(repo_root: Path) -> Dict[str, float]:
    """Read eng-clubs ratings from pinned production ClubElo artifact."""
    artifact_dir = repo_root / "packages/api/data/model-artifacts/clubelo"
    selector = json.loads((artifact_dir / "production.json").read_text())
    payload_path = artifact_dir / Path(selector["artifactPath"]).name
    if not payload_path.exists():
        payload_path = artifact_dir / f"{selector['payloadSha256']}.json"
    data = json.loads(payload_path.read_text())
    return dict(data["payload"]["byProfile"]["eng-clubs"])


def anchor_proxy_to_clubelo(
    df: pd.DataFrame, clubelo_eng: Dict[str, float], season: str = "2627"
) -> Tuple[pd.DataFrame, float]:
    """Linear map raw proxy → ClubElo scale using current-season EPL overlap."""
    cur = df[(df.Div == "E0") & (df.Season == season)]
    if cur.empty:
        df["eloH"] = df.eloH_raw
        df["eloA"] = df.eloA_raw
        return df, float("nan")
    raw_by_team: Dict[str, float] = {}
    for _, row in cur.iterrows():
        raw_by_team.setdefault(row.HomeTeam, float(row.eloH_raw))
        raw_by_team.setdefault(row.AwayTeam, float(row.eloA_raw))
    pairs = []
    for t, raw in raw_by_team.items():
        ce_name = TEAM_ALIASES_TO_CLUBELO.get(t, t)
        if ce_name in clubelo_eng:
            pairs.append((raw, clubelo_eng[ce_name]))
    if len(pairs) < 5:
        df["eloH"] = df.eloH_raw
        df["eloA"] = df.eloA_raw
        return df, float("nan")
    x = np.array(pairs)
    a, b = np.polyfit(x[:, 0], x[:, 1], 1)
    corr = float(np.corrcoef(x[:, 0], x[:, 1])[0, 1])
    df["eloH"] = a * df.eloH_raw + b
    df["eloA"] = a * df.eloA_raw + b
    return df, corr
