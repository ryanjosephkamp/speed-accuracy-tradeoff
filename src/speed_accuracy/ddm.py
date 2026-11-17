"""Drift-diffusion model with known evidence reliability: closed-form results.

Evidence accumulates as dX = z dt + sigma dW, where the hidden state z is +1 or -1 with equal
prior probability and sigma^2 is the noise variance per unit time. With symmetric bounds at +-x,
the decision maker stops at the first crossing and picks the side it crossed.
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import brentq


def belief(x, s2: float = 1.0):
    """Posterior probability that z = +1 after accumulating evidence x."""
    return 1.0 / (1.0 + np.exp(-2.0 * np.asarray(x, dtype=float) / s2))


def evidence(g, s2: float = 1.0):
    """Accumulated evidence that gives belief g (the inverse of `belief`)."""
    g = np.asarray(g, dtype=float)
    return 0.5 * s2 * np.log(g / (1.0 - g))


def p_correct(x, s2: float = 1.0):
    """Probability of a correct choice with bounds at +-x. Equals the belief at the bound."""
    return belief(x, s2)


def mean_decision_time(x, s2: float = 1.0):
    """Mean decision time across trials with bounds at +-x: x * tanh(x / s2)."""
    x = np.asarray(x, dtype=float)
    return x * np.tanh(x / s2)


def expected_reward(x, c: float, s2: float = 1.0):
    """Expected reward per trial: P(correct) minus the cost c per unit of time spent deciding."""
    return p_correct(x, s2) - c * mean_decision_time(x, s2)


def _d_reward(x, c, s2):
    # derivative of expected_reward with respect to x
    g = belief(x, s2)
    dp = (2.0 / s2) * g * (1.0 - g)
    th = np.tanh(x / s2)
    dt = th + (x / s2) * (1.0 - th * th)
    return dp - c * dt


def optimal_bound(c: float, s2: float = 1.0) -> float:
    """Evidence bound x that maximizes expected reward for a constant cost c > 0.

    The reward's slope is positive at x = 0 and negative for large x; the root between them is
    found by bracketing. Returns inf when c <= 0 (with no cost of time, waiting always pays).
    """
    if c <= 0:
        return float("inf")
    hi = 1.0
    while _d_reward(hi, c, s2) > 0:
        hi *= 2.0
    return float(brentq(_d_reward, 1e-12, hi, args=(c, s2), xtol=1e-13, rtol=1e-12))


def optimal_belief_bound(c: float, s2: float = 1.0) -> float:
    """The optimal bound expressed as a belief, g_H = belief(optimal_bound(c, s2))."""
    x = optimal_bound(c, s2)
    return 1.0 if np.isinf(x) else float(belief(x, s2))
