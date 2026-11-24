import numpy as np
import pytest

from speed_accuracy import ddm, evaluate, known, simulate
from speed_accuracy.shortcuts import OVERSHOOT


def test_constant_bound_matches_the_closed_form_with_the_overshoot():
    dt = 0.001
    ts = np.arange(0, 10 + dt / 2, dt)
    x = 1.1
    o = evaluate.known_reward(np.full(len(ts), x), ts, 0.1)
    x_eff = x + OVERSHOOT * np.sqrt(dt)  # discrete monitoring stops a little past the bound
    assert o.p_correct == pytest.approx(ddm.p_correct(x_eff), abs=1e-3)
    assert o.mean_rt == pytest.approx(ddm.mean_decision_time(x_eff), abs=5e-3)


def test_dynamic_program_beats_every_constant_bound():
    ts, gb = known.backward_induction(lambda t: 0.1 + 0 * t, 8.0, dt=0.002)
    best = evaluate.known_reward(ddm.evidence(np.clip(gb, 0.5, 1 - 1e-12)), ts, 0.1).reward
    for x in (0.8, 1.2, 1.3, 1.4, 1.8):
        assert evaluate.known_reward(np.full(len(ts), x), ts, 0.1).reward <= best + 1e-4


def test_matches_monte_carlo_for_a_bound_that_changes():
    ts = np.arange(0, 4 + 1e-9, 0.002)
    xb = 1.5 * np.exp(-ts / 1.5)
    cost = lambda t: 0.05 + 0.1 * t
    o = evaluate.known_reward(xb, ts, cost)
    r = simulate.run_known(xb, ts, cost, trials=40_000, seed=4)
    se = r.reward.std() / np.sqrt(r.reward.size)
    assert r.reward.mean() == pytest.approx(o.reward, abs=3.5 * se)


def test_unknown_reliability_matches_monte_carlo():
    dt = 0.005
    ts = np.arange(0, 4 + dt / 2, dt)
    xb = 1.2 + 0 * ts
    o = evaluate.unknown_reward(xb, ts, 0.1)
    rng = np.random.default_rng(11)
    n = 40_000
    mu = rng.standard_normal(n)
    x = np.zeros(n)
    alive = np.ones(n, bool)
    correct = np.zeros(n, bool)
    rt = np.full(n, ts[-1])
    for k in range(1, len(ts)):
        idx = np.flatnonzero(alive)
        x[idx] += mu[idx] * dt + np.sqrt(dt) * rng.standard_normal(idx.size)
        hit = np.abs(x[idx]) >= xb[k]
        h = idx[hit]
        correct[h] = np.sign(x[h]) == np.sign(mu[h])
        rt[h] = ts[k]
        alive[h] = False
    idx = np.flatnonzero(alive)
    correct[idx] = np.sign(x[idx]) == np.sign(mu[idx])
    assert correct.mean() == pytest.approx(o.p_correct, abs=0.01)
    assert rt.mean() == pytest.approx(o.mean_rt, abs=0.02)


@pytest.mark.parametrize("shape", ["flat", "collapsing"])
def test_decision_times_are_a_distribution_consistent_with_the_scorer(shape):
    # The decision-time law behind the loss-formula check: it sums to one (undecided trials count
    # at the last time), and its mean time and mean cost are the scorer's.
    dt = 0.002
    ts = np.arange(0.0, 6.0 + dt / 2, dt)
    bound = np.full(len(ts), 1.1) if shape == "flat" else 1.5 * np.exp(-ts / 1.5)
    cost = lambda t: 0.05 + 0.1 * np.asarray(t, float)
    f = evaluate.known_decision_times(bound, ts)
    out = evaluate.known_reward(bound, ts, cost)
    assert np.all(f >= 0)
    assert f.sum() == pytest.approx(1.0, abs=1e-9)
    assert f @ ts == pytest.approx(out.mean_rt, abs=1e-9)
    paid = np.concatenate([[0.0], np.cumsum(cost(ts[:-1]) * dt)])  # cost paid before deciding at ts[k]
    assert f @ paid == pytest.approx(out.mean_cost, abs=1e-9)
