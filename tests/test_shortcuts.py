import numpy as np
import pytest

from speed_accuracy import ddm, evaluate, known, shortcuts


def test_per_moment_is_the_closed_form_for_a_constant_cost():
    ts = np.linspace(0, 2, 5)
    g = shortcuts.per_moment(lambda t: 0.1 + 0 * t, ts)
    assert np.allclose(g, ddm.optimal_belief_bound(0.1), atol=1e-4)


def test_boundary_kernel_is_a_distribution():
    s, w = shortcuts.boundary_kernel(1.34)
    assert w.min() >= 0 and w.sum() == pytest.approx(1.0)
    assert np.all(np.diff(s) > 0)


def _response(d, ts, om):
    A = np.c_[np.sin(om * ts), np.cos(om * ts), np.ones(len(ts))]
    a, b, _ = np.linalg.lstsq(A, d, rcond=None)[0]
    return np.hypot(a, b), np.arctan2(b, a)


def test_weighted_ahead_is_exact_to_first_order():
    c0, eps, om = 0.1, 0.01, 4.0
    flat = lambda t: c0 + 0 * t
    wavy = lambda t: c0 + eps * np.sin(om * np.asarray(t))
    ts, g0 = known.backward_induction(flat, 8.0, n=600)
    _, g1 = known.backward_induction(wavy, 8.0, n=600)
    sel = (ts > 1.5) & (ts < 5.5)
    base = ddm.evidence(shortcuts.per_moment(flat, ts[sel]))
    amp_ex, ph_ex = _response(ddm.evidence(g1[sel]) - ddm.evidence(g0[sel]), ts[sel], om)
    amp_w, ph_w = _response(ddm.evidence(shortcuts.weighted_ahead(wavy, ts[sel])) - base, ts[sel], om)
    amp_pm, _ = _response(ddm.evidence(shortcuts.per_moment(wavy, ts[sel])) - base, ts[sel], om)
    assert amp_w == pytest.approx(amp_ex, rel=0.05)
    assert ph_w == pytest.approx(ph_ex, abs=np.radians(3))
    assert amp_pm > 1.5 * amp_ex  # the per-moment bound overreacts


@pytest.mark.parametrize("cost, horizon", [
    (lambda t: 0.1 + 0.8 * np.maximum(np.asarray(t) - 0.5, 0), 10.0),             # flat, then rising
    (lambda t: np.where(np.asarray(t) <= 1.0 + 1e-12, 0.1, np.inf), 1.0),          # hard deadline at 1 s
])
def test_weighted_bound_nearly_matches_the_exact_policy(cost, horizon):
    dt = 0.002
    ts, gb = known.backward_induction(lambda t: np.minimum(cost(t), 1e6), horizon, dt=dt)
    exact = evaluate.known_reward(ddm.evidence(np.clip(gb, 0.5, 1 - 1e-12)), ts, cost).reward

    def loss(g):
        x = shortcuts.discrete(ddm.evidence(np.clip(g, 0.5, 1 - 1e-12)), dt)
        return 100 * (exact - evaluate.known_reward(x, ts, cost).reward)

    assert loss(shortcuts.weighted_bound(cost, ts)) < 0.1
    assert loss(shortcuts.per_moment(cost, ts)) > 0.5


@pytest.mark.parametrize("c0", [0.02, 0.1, 0.3])
def test_boundary_kernel_matches_the_closed_form_transform_and_mean(c0):
    # The binned kernel the rule uses, against 2 c0 cosh^2 b0 [r tanh(r b0) - tanh b0] / lam and the
    # mean look-ahead c0 [sinh(2 b0)/2 - b0 + 2 b0^2 tanh b0]. Bin midpoints cost a little accuracy.
    b0 = ddm.optimal_bound(c0)
    s, w = shortcuts.boundary_kernel(b0)
    for lam in (0.3, 1.0, 5.0):
        r = np.sqrt(2 * lam + 1)
        closed = 2 * c0 * np.cosh(b0) ** 2 * (r * np.tanh(r * b0) - np.tanh(b0)) / lam
        assert w @ np.exp(-lam * s) == pytest.approx(closed, abs=1e-3)
    mean = c0 * (np.sinh(2 * b0) / 2 - b0 + 2 * b0 ** 2 * np.tanh(b0))
    assert w @ s == pytest.approx(mean, rel=2e-3)


def test_one_pass_is_per_moment_at_a_constant_cost_and_close_to_the_full_rule_for_small_changes():
    # The one-pass rule (kernel for the per-moment bound, no iteration), from the held-out table.
    ts = np.arange(0.0, 4.0, 0.005)
    flat = lambda t: np.full_like(np.asarray(t, float), 0.1)
    one = shortcuts.weighted_bound(flat, ts, self_consistent=False)
    assert np.allclose(one, shortcuts.per_moment(flat, ts), atol=1e-12)
    small = lambda t: 0.1 + 0.01 * np.sin(4 * np.asarray(t, float))
    ev = lambda g: ddm.evidence(g, 1.0)
    one = ev(shortcuts.weighted_bound(small, ts, self_consistent=False))
    full = ev(shortcuts.weighted_bound(small, ts))
    pm = ev(shortcuts.per_moment(small, ts))
    # both are first-order exact, so they differ at second order, far less than the per-moment rule
    assert np.max(np.abs(one - full)) < 0.02 * np.max(np.abs(pm - full))
