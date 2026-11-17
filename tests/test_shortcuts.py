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
