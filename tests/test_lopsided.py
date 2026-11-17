import numpy as np
import pytest

from speed_accuracy import ddm, evaluate, lopsided as L


def test_equal_rewards_give_the_symmetric_bound():
    lo, hi = L.constant_bounds(0.1)
    assert hi == pytest.approx(ddm.optimal_bound(0.1), abs=1e-10)
    assert lo == pytest.approx(-hi, abs=1e-10)


def test_doubling_both_rewards_halves_the_cost():
    assert np.allclose(L.constant_bounds(0.1, 2.0, 2.0), L.constant_bounds(0.05), atol=1e-10)


@pytest.mark.parametrize("r_minus", [1.0, 0.5, 0.25])
def test_bounds_bracket_the_indifference_point(r_minus):
    lo, hi = L.constant_bounds(0.1, 1.0, r_minus)
    assert lo < L.x_star(1.0, r_minus) < hi


@pytest.mark.parametrize("r_minus", [1.0, 0.5, 0.25])
def test_bound_sensitivity_is_the_flux_over_twice_the_cost(r_minus):
    # the first-order theory at a constant cost change: dB/dc = -(total flux at the bound) / 2c
    c, h = 0.1, 1e-5
    lo, hi = L.constant_bounds(c, 1.0, r_minus)
    (lo1, hi1), (lo0, hi0) = L.constant_bounds(c + h, 1.0, r_minus), L.constant_bounds(c - h, 1.0, r_minus)
    t_hi, t_lo = L.flux_totals(lo, hi)
    assert (hi1 - hi0) / (2 * h) == pytest.approx(-t_hi / (2 * c), rel=1e-5)
    assert (lo1 - lo0) / (2 * h) == pytest.approx(t_lo / (2 * c), rel=1e-5)


def test_symmetric_transfer_matches_the_closed_form():
    c0, lam = 0.1, 0.3
    b = ddm.optimal_bound(c0)
    r = np.sqrt(2 * lam + 1)
    closed = 2 * c0 * np.cosh(b) ** 2 * (r * np.tanh(r * b) - np.tanh(b)) / lam
    w_hi, w_lo = L.transfer(lam, -b, b)
    assert complex(w_hi).real == pytest.approx(closed, rel=1e-10)
    assert complex(w_lo).real == pytest.approx(closed, rel=1e-10)


def test_kernel_series_matches_its_transform():
    lo, hi = L.constant_bounds(0.1, 1.0, 0.5)
    s, w_hi, w_lo = L.boundary_kernels(lo, hi)
    assert w_hi.sum() == pytest.approx(1.0) and w_lo.sum() == pytest.approx(1.0)
    for lam in (0.3, -1j, -4j):
        t_hi, t_lo = L.transfer(lam, lo, hi)
        assert abs(np.sum(w_hi * np.exp(-lam * s)) - t_hi) < 1e-3
        assert abs(np.sum(w_lo * np.exp(-lam * s)) - t_lo) < 1e-3


def test_dynamic_program_matches_the_closed_form_for_a_constant_cost():
    flat = lambda t: 0.1 + 0 * t
    ts, lo, hi, v0 = L.backward_induction(flat, 8.0, 1.0, 0.5)
    lo_c, hi_c = L.discrete(*L.constant_bounds(0.1, 1.0, 0.5), 0.002)
    early = ts < 2  # far from the forced choice at the horizon
    assert np.allclose(lo[early], lo_c, atol=0.003)
    assert np.allclose(hi[early], hi_c, atol=0.003)
    assert L.reward(lo, hi, ts, flat, 1.0, 0.5).reward == pytest.approx(v0, abs=1e-5)


def test_scorer_matches_the_symmetric_scorer():
    ts = np.arange(0, 4.0001, 0.002)
    x = np.full(len(ts), 1.2)
    flat = lambda t: 0.1 + 0 * t
    assert L.reward(-x, x, ts, flat).reward == pytest.approx(evaluate.known_reward(x, ts, flat).reward, abs=1e-9)


def test_weighted_bound_tracks_the_exact_policy_better_on_a_cost_jump():
    jump = lambda t: 0.1 + 1.5 / (1 + np.exp(-(np.asarray(t) - 0.5) / 0.05))
    ts, lo_x, hi_x, _ = L.backward_induction(jump, 3.0, 1.0, 0.5)
    ex = L.reward(lo_x, hi_x, ts, jump, 1.0, 0.5).reward
    pm = L.reward(*L.discrete(*L.per_moment(jump, ts, 1.0, 0.5), 0.002), ts, jump, 1.0, 0.5).reward
    wb = L.reward(*L.discrete(*L.weighted_bound(jump, ts, 1.0, 0.5), 0.002), ts, jump, 1.0, 0.5).reward
    assert ex >= wb > pm
    assert ex - wb < 0.25 * (ex - pm)


def test_unequal_grid_ends_do_not_leak_into_the_bounds():
    # cheap time and a long horizon: the value must not wrap from the r_plus end of the grid to
    # the r_minus end and spread inward
    flat = lambda t: 0.02 + 0 * t
    ts, lo, hi, v0 = L.backward_induction(flat, 10.0, 1.0, 0.5)
    lo_c, hi_c = L.discrete(*L.constant_bounds(0.02, 1.0, 0.5), 0.002)
    assert lo[0] == pytest.approx(lo_c, abs=0.005)
    assert hi[0] == pytest.approx(hi_c, abs=0.005)
