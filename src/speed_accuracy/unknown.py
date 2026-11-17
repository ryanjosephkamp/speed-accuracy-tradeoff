"""Unknown evidence reliability: the drift is drawn once per trial and never revealed.

Evidence accumulates as dX = mu dt + dW, with mu ~ N(0, prior_var) drawn once per trial. The
choice is right when it matches the sign of mu. After time t, mu | X ~ N(X / (t + a), 1 / (t + a))
with a = 1 / prior_var, so the belief that mu > 0 is g = Phi(X / sqrt(t + a)). In the variable
u = Phi^-1(g), one step of dt moves u to N(u * sqrt(1 + e), e) with e = dt / (t + a). The step
depends on t, so the policy needs backward induction over time, and the bounds collapse.
"""
from __future__ import annotations

from typing import Callable

import numpy as np
from scipy.stats import norm

from .known import belief_grid, bound_from_values


def transition_matrix(g: np.ndarray, dt_eff: float) -> np.ndarray:
    """P[i, j] = probability of moving from belief g[i] to g[j] when the effective step is dt_eff."""
    u = norm.ppf(g)
    d = u[None, :] - np.sqrt(1.0 + dt_eff) * u[:, None]
    p = np.exp(0.5 * u[None, :] ** 2 - d * d / (2.0 * dt_eff))  # includes the 1/phi(u') Jacobian
    return p / p.sum(axis=1, keepdims=True)


def backward_induction(cost: Callable[[np.ndarray], np.ndarray] | float, horizon: float,
                       prior_var: float = 1.0, n: int = 300, dt: float = 0.005):
    """Exact policy. Returns (times, upper belief bound at each time)."""
    g = belief_grid(n)
    v_decide = np.maximum(g, 1.0 - g)
    ts = np.arange(0.0, horizon + dt / 2, dt)
    c = np.broadcast_to(np.asarray(cost(ts) if callable(cost) else cost, dtype=float), ts.shape)
    a = 1.0 / prior_var
    v = v_decide.copy()
    bounds = np.empty(len(ts))
    bounds[-1] = 0.5  # the choice is forced at the horizon
    for i in range(len(ts) - 2, -1, -1):
        P = transition_matrix(g, dt / (ts[i] + a))
        v_wait = P @ v - c[i] * dt
        bounds[i] = bound_from_values(g, v_decide, v_wait)
        v = np.maximum(v_decide, v_wait)
    return ts, bounds


def evidence_bound(g_bound: np.ndarray, ts: np.ndarray, prior_var: float = 1.0) -> np.ndarray:
    """Convert belief bounds at times ts into evidence bounds X(t)."""
    return norm.ppf(np.clip(g_bound, 0.5, 1 - 1e-12)) * np.sqrt(ts + 1.0 / prior_var)
