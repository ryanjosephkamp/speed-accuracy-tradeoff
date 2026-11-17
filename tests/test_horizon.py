"""The choice is forced at the horizon: every solver must stop there, not take one more step.

If a solver allowed a continuation step at the last time, its policy would solve a longer problem
than the scorer's, and the dynamic program's value would differ from the reward the scorer gives
its own policy.
"""
import numpy as np
import pytest

from speed_accuracy import evaluate, known, lopsided, unknown


@pytest.mark.parametrize("c, horizon", [(0.1, 0.02), (0.1, 0.1), (1.0, 0.1), (0.1, 1.0)])
def test_value_matches_score(c, horizon):
    cost = lambda t: c + 0 * np.asarray(t)
    ts, xb, v0 = known.backward_induction_x(cost, horizon)
    assert xb[-1] == 0.0
    assert v0 == pytest.approx(evaluate.known_reward(xb, ts, cost).reward, abs=1e-5)


def test_belief_and_unknown_solvers_stop_at_horizon():
    cost = lambda t: 0.1 + 0 * np.asarray(t)
    _, gb = known.backward_induction(cost, 0.1, n=200)
    assert gb[-1] == 0.5
    _, gu = unknown.backward_induction(cost, 0.1, n=100)
    assert gu[-1] == 0.5


def test_lopsided_solver_stops_at_horizon():
    cost = lambda t: 0.1 + 0 * np.asarray(t)
    ts, lo, hi, _ = lopsided.backward_induction(cost, 0.1, 1.0, 0.5)
    xs = lopsided.x_star(1.0, 0.5)
    assert lo[-1] == hi[-1] == xs
