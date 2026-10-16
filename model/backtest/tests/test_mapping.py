import numpy as np

from backtest.mapping import score_matrix_1x2


def test_hull_style_mismatch_sane_total():
    # Man United ~1915, Hull ~1533 + HFA 42 → heavy away favourite, not 4+ total xG blowout grid
    h, d, a = score_matrix_1x2(1532.88, 1915.32, hfa=42)
    assert abs(h + d + a - 1.0) < 1e-6
    assert a > h
    assert a < 0.95  # fixed-total mapping: away fav but not 91% Hull example
