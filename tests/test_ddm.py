import numpy as np
import pytest

from speed_accuracy import ddm


def test_belief_and_evidence_are_inverses():
    x = np.linspace(-3, 3, 13)
    for s2 in (0.5, 1.0, 4.0):
        assert np.allclose(ddm.evidence(ddm.belief(x, s2), s2), x)


@pytest.mark.parametrize("c, g_expected", [(0.1, 0.9363), (0.2, 0.8655)])
def test_optimal_bound_at_unit_noise(c, g_expected):
    assert ddm.optimal_belief_bound(c, 1.0) == pytest.approx(g_expected, abs=1e-4)


@pytest.mark.parametrize("c, s2", [(0.1, 1.0), (0.2, 2.0), (0.1, 4.0), (0.2, 5.0), (0.05, 50.0)])
def test_optimal_bound_beats_a_fine_grid(c, s2):
    x_star = ddm.optimal_bound(c, s2)
    xs = np.linspace(1e-4, 4 * x_star + 1, 200_001)
    best = ddm.expected_reward(xs, c, s2).max()
    assert ddm.expected_reward(x_star, c, s2) >= best - 1e-9


def test_no_cost_means_no_bound():
    assert ddm.optimal_bound(0.0) == float("inf")
    assert ddm.optimal_belief_bound(0.0) == 1.0


@pytest.mark.parametrize("s2", [1.0, 2.0])
def test_closed_form_matches_simulation(s2):
    # The mean decision time is x * tanh(x / s2); at s2 != 1 this separates it from x * tanh(x).
    rng = np.random.default_rng(3)
    x_b, dt, n = 0.8, 2e-4, 20_000
    x = np.zeros(n); t = np.zeros(n); alive = np.ones(n, bool); right = np.zeros(n, bool)
    while alive.any():
        i = np.flatnonzero(alive)
        x[i] += dt + np.sqrt(s2 * dt) * rng.standard_normal(i.size)
        t[i] += dt
        hit = np.abs(x[i]) >= x_b
        right[i[hit]] = x[i[hit]] > 0
        alive[i[hit]] = False
    se_t = t.std() / np.sqrt(n)
    assert t.mean() == pytest.approx(ddm.mean_decision_time(x_b, s2), abs=4 * se_t + 3 * np.sqrt(dt))
    assert right.mean() == pytest.approx(ddm.p_correct(x_b, s2), abs=0.012)
