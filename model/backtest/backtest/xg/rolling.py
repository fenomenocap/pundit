"""Time-decayed pre-match rolling xG for/against (no leakage)."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from backtest.xg.calibration import apply_calibration, load_calibration
from backtest.xg.team_names import to_understat
from backtest.xg.understat_fetch import load_understat_matches

XI = 0.0065


@dataclass
class TeamXgState:
    attack: float = 1.35
    defence: float = 1.35
    weight: float = 0.0


@dataclass
class RollingXgTracker:
    teams: dict[str, TeamXgState] = field(default_factory=dict)

    def snapshot(self, team: str) -> TeamXgState:
        return self.teams.get(team, TeamXgState())

    def observe(self, team: str, xg_for: float, xg_against: float, w: float) -> None:
        st = self.teams.setdefault(team, TeamXgState())
        if st.weight <= 0:
            st.attack = xg_for
            st.defence = xg_against
            st.weight = w
            return
        alpha = w / (st.weight + w)
        st.attack = (1 - alpha) * st.attack + alpha * xg_for
        st.defence = (1 - alpha) * st.defence + alpha * xg_against
        st.weight += w


def _observation_stream(root, cal: dict) -> list[tuple[pd.Timestamp, str, str, float, float]]:
    obs = []
    for m in load_understat_matches(root):
        dt = pd.to_datetime(m["datetime"])
        hx, ax = apply_calibration(float(m["home_xg"]), float(m["away_xg"]), cal)
        obs.append((dt, m["home"], m["away"], hx, ax))
    return sorted(obs, key=lambda x: x[0])


def attach_prematch_xg_rates(e: pd.DataFrame, root, cal: dict | None = None) -> pd.DataFrame:
    """Rolling xG attack/defence rates strictly before calendar kickoff date."""
    cal = cal or load_calibration(root)
    stream = _observation_stream(root, cal)
    tracker = RollingXgTracker()
    idx = 0
    h_att, h_def, a_att, a_def = [], [], [], []
    for _, row in e.sort_values("Date").iterrows():
        kick = pd.Timestamp(row.Date).normalize()
        while idx < len(stream) and stream[idx][0].normalize() < kick:
            _, mh, ma, hx, ax = stream[idx]
            days = max(0, (kick - stream[idx][0].normalize()).days)
            w = float(np.exp(-XI * days))
            tracker.observe(mh, hx, ax, w)
            tracker.observe(ma, ax, hx, w)
            idx += 1
        hs = tracker.snapshot(to_understat(row.HomeTeam))
        as_ = tracker.snapshot(to_understat(row.AwayTeam))
        h_att.append(hs.attack)
        h_def.append(hs.defence)
        a_att.append(as_.attack)
        a_def.append(as_.defence)
    out = e.copy()
    out["xg_home_attack"] = h_att
    out["xg_home_defence"] = h_def
    out["xg_away_attack"] = a_att
    out["xg_away_defence"] = a_def
    return out


def lambdas_from_xg_rates(
    h_att: float,
    h_def: float,
    a_att: float,
    a_def: float,
    *,
    home_adv: float = 1.08,
    base: float = 1.35,
) -> tuple[float, float]:
    lh = max(0.05, home_adv * h_att * a_def / base)
    la = max(0.05, a_att * h_def / base)
    total = lh + la
    scale = (2 * base) / total if total > 0 else 1.0
    return lh * scale, la * scale
