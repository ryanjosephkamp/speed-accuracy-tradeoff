import numpy as np
import pytest
from scipy.stats import norm

from speed_accuracy import info_time, shortcuts, unknown
from speed_accuracy.known import belief_grid, bound_from_values


@pytest.mark.parametrize("kappa", [0.15, 0.4])
def test_frozen_bound_matches_value_iteration(kappa):
    # value iteration with the frozen transition: step e in information time, cost kappa per unit
    e = 0.003
    g = belief_grid(400)
    decide = np.maximum(g, 1 - g)
    P = unknown.transition_matrix(g, e)
    v = decide.copy()
    for _ in range(100_000):
        wait = P @ v - kappa * e
        new = np.maximum(decide, wait)
        if np.max(np.abs(new - v)) < 1e-7 * e:
            break
        v = new
    u_vi = norm.ppf(bound_from_values(g, decide, wait))
    # discrete steps stop past the bound by the usual overshoot, here in u with step variance e
    assert info_time.frozen_bound(kappa) - shortcuts.OVERSHOOT * np.sqrt(e) == pytest.approx(u_vi, abs=0.004)


def test_numerical_kernel_matches_the_closed_form_one():
    # known reliability: the decision maker's own drift is tanh(x)
    s1, w1 = shortcuts.boundary_kernel(1.0)
    s2, w2 = info_time.survival_kernel(np.tanh, 1.0, points=400)
    assert w2 @ s2 == pytest.approx(w1 @ s1, rel=0.02)


def test_information_time_round_trip():
    t = np.array([0.0, 0.5, 3.0])
    assert np.allclose(info_time.t_of_tau(info_time.tau_of_t(t, 2.0), 2.0), t)
