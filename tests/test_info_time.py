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


def test_frozen_bound_solves_its_equation_and_the_table_matches():
    # integral_0^U exp(v^2 / 2) dv = 1 / (2 sqrt(2 pi) kappa), the stationary bound in u
    from scipy.integrate import quad

    kappas = np.geomspace(1e-3, 1e3, 25)
    exact = np.array([info_time.frozen_bound(k) for k in kappas])
    for U, k in zip(exact, kappas):
        lhs = quad(lambda v: np.exp(v * v / 2), 0, U)[0]
        assert lhs * 2 * np.sqrt(2 * np.pi) * k == pytest.approx(1.0, abs=1e-8)
    assert np.allclose(info_time.frozen_bounds(kappas), exact, rtol=1e-6)
    assert info_time.frozen_bounds(np.inf) == 0.0


def test_weighted_rule_equals_frozen_time_when_the_information_time_cost_is_constant():
    # c(t) = kappa0 / (t + a) makes the cost per unit of information time constant, so looking
    # ahead changes nothing: the kernel averages a constant.
    ts = np.arange(0.0, 3.0, 0.01)
    cost = lambda t: 0.1 / (np.asarray(t, float) + 1.0)
    assert np.allclose(info_time.weighted_bound(cost, ts), info_time.frozen_time(cost, ts), atol=1e-9)


def test_weighted_rule_sits_below_frozen_time_for_a_constant_cost():
    # A constant cost c is a cost c (t + a) per unit of information time, which rises, so the bound
    # that looks ahead sits lower than the one that freezes the cost now.
    ts = np.arange(0.0, 2.0, 0.02)
    weighted = info_time.weighted_bound(lambda t: np.full_like(np.asarray(t, float), 0.05), ts)
    frozen = info_time.frozen_time(0.05, ts)
    assert np.all(weighted > 0)
    assert np.all(weighted < frozen - 0.1)


def test_discrete_shift_and_evidence_bound():
    x = np.array([0.0, 0.01, 0.5, 2.0])
    assert np.allclose(info_time.discrete(x, 0.005), np.maximum(x - shortcuts.OVERSHOOT * np.sqrt(0.005), 0))
    # belief bound g at time t is the evidence X with Phi(X / sqrt(t + a)) = g, here a = 1
    g = np.linspace(0.5, 0.999, 9)
    ts = np.linspace(0.0, 3.0, 9)
    X = unknown.evidence_bound(g, ts)
    assert np.allclose(norm.cdf(X / np.sqrt(ts + 1.0)), g, atol=1e-12)
    assert X[0] == 0.0
