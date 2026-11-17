import numpy as np
import pytest

from speed_accuracy import ddm, simulate


def test_constant_bound_reproduces_the_closed_form():
    ts = np.arange(0, 10 + 1e-9, 0.001)
    x_b = 0.9
    r = simulate.run_known(np.full(len(ts), x_b), ts, lambda t: 0.1 + 0 * t, trials=20_000, seed=1)
    assert r.correct.mean() == pytest.approx(ddm.p_correct(x_b), abs=0.01)
    assert r.rt.mean() == pytest.approx(ddm.mean_decision_time(x_b), abs=0.04)


def test_same_seed_gives_paired_noise():
    ts = np.arange(0, 3 + 1e-9, 0.002)
    a = simulate.run_known(np.full(len(ts), 0.7), ts, lambda t: 0.1 + 0 * t, trials=500, seed=9)
    b = simulate.run_known(np.full(len(ts), 0.7), ts, lambda t: 0.1 + 0 * t, trials=500, seed=9)
    assert np.array_equal(a.rt, b.rt) and np.array_equal(a.correct, b.correct)
