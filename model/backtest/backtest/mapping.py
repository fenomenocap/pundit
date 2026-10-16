"""Production-aligned Elo → goals → Dixon–Coles 1X2 (no market inputs)."""

from __future__ import annotations

import math
from typing import Tuple

import numpy as np

ELO_SCALE = 400.0
BASE_GOALS = 1.35
DEFAULT_HFA = 42.0
RHO = -0.1
LAMBDA_CAP = 5.0
MAX_GOALS = 10


def elo_to_lambdas(
    elo_home: float,
    elo_away: float,
    home_advantage_elo: float = DEFAULT_HFA,
    base_goals: float = BASE_GOALS,
) -> Tuple[float, float]:
    d = elo_home + home_advantage_elo - elo_away
    r = 10 ** (d / ELO_SCALE)
    total_xg = 2 * base_goals
    lh = min(total_xg * r / (1 + r), LAMBDA_CAP)
    la = min(total_xg / (1 + r), LAMBDA_CAP)
    return lh, la


def _tau(i: int, j: int, lh: float, la: float, rho: float) -> float:
    if i == 0 and j == 0:
        return 1 - lh * la * rho
    if i == 0 and j == 1:
        return 1 + lh * rho
    if i == 1 and j == 0:
        return 1 + la * rho
    if i == 1 and j == 1:
        return 1 - rho
    return 1.0


def score_matrix_1x2(
    elo_home: float,
    elo_away: float,
    *,
    hfa: float = DEFAULT_HFA,
    base: float = BASE_GOALS,
    rho: float = RHO,
    max_goals: int = MAX_GOALS,
) -> Tuple[float, float, float]:
    lh, la = elo_to_lambdas(elo_home, elo_away, hfa, base)
    i = np.arange(max_goals + 1)
    fact = np.array([math.factorial(int(k)) for k in i], dtype=float)
    ph = np.exp(-lh) * lh**i / fact
    pa = np.exp(-la) * la**i / fact
    m = np.outer(ph, pa)
    for ii in range(min(2, max_goals + 1)):
        for jj in range(min(2, max_goals + 1)):
            m[ii, jj] *= _tau(ii, jj, lh, la, rho)
    m /= m.sum()
    home = float(np.tril(m, -1).sum())
    draw = float(np.trace(m))
    away = float(np.triu(m, 1).sum())
    return home, draw, away


def batch_pundit_1x2(
    elo_h: np.ndarray,
    elo_a: np.ndarray,
    hfa: float = DEFAULT_HFA,
    base: float = BASE_GOALS,
    rho: float = RHO,
) -> np.ndarray:
    out = np.zeros((len(elo_h), 3))
    for idx, (eh, ea) in enumerate(zip(elo_h, elo_a)):
        out[idx] = score_matrix_1x2(eh, ea, hfa=hfa, base=base, rho=rho)
    return out
