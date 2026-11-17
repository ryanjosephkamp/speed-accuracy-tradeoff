import numpy as np
import pytest

from speed_accuracy import ddm, known


def test_transition_rows_are_distributions_and_symmetric():
    g = known.belief_grid(200)
    P = known.transition_matrix(g, 0.002)
    assert np.allclose(P.sum(axis=1), 1.0)
    # beliefs g and 1 - g are mirror images
    assert np.allclose(P[::-1, ::-1], P, atol=1e-12)


def test_belief_drifts_toward_the_likelier_answer_on_average():
    # E[g' | g] = g: the belief is a martingale (up to grid error)
    g = known.belief_grid(300)
    P = known.transition_matrix(g, 0.002)
    mid = slice(30, 270)
    assert np.allclose((P @ g)[mid], g[mid], atol=2e-3)


# Deciding only every dt overshoots a continuous bound by about 0.5826 * sigma * sqrt(dt) in
# evidence (the discrete-monitoring correction, with 0.5826 = -zeta(1/2) / sqrt(2 pi)). So the
# discrete-time optimal bound sits that far inside the continuous one.
OVERSHOOT = 0.5826


@pytest.mark.parametrize("c, s2", [(0.1, 1.0), (0.2, 1.0), (0.2, 2.0)])
def test_value_iteration_matches_the_closed_form(c, s2):
    dt = 0.002
    bound, _, iters = known.value_iteration(c, s2=s2, n=400, dt=dt)
    assert iters > 50  # a tolerance not scaled by dt would stop after a few steps
    x_dp = ddm.evidence(bound, s2) + OVERSHOOT * np.sqrt(s2 * dt)
    assert x_dp == pytest.approx(ddm.optimal_bound(c, s2), abs=0.006)


def test_backward_induction_with_constant_cost_is_stationary():
    stationary, _, _ = known.value_iteration(0.1, n=300, dt=0.002)
    ts, b = known.backward_induction(lambda t: 0.1 + 0 * t, horizon=8.0, n=300, dt=0.002)
    early = b[ts <= 2.0]
    assert np.allclose(early, stationary, atol=1e-3)


def test_rising_cost_lowers_the_bound_before_the_rise():
    ts, b = known.backward_induction(lambda t: 0.1 + 0.8 * np.maximum(t - 0.5, 0), horizon=8.0,
                                     n=300, dt=0.002)
    flat, _, _ = known.value_iteration(0.1, n=300, dt=0.002)
    assert b[0] < flat - 0.01          # the exact policy anticipates the rise
    assert np.all(np.diff(b[ts < 3]) <= 1e-9)
