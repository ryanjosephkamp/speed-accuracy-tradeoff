"""Known evidence reliability: the optimal policy by dynamic programming over beliefs.

The state is the belief g = P(z = +1 | evidence). Deciding now earns max(g, 1 - g), the
probability of being right. Waiting one step of length dt costs c dt and moves the belief to g'.
Value iteration (constant cost) or backward induction over time (a cost that changes, c(t))
gives the value of each belief; the bound is the belief where deciding starts to beat waiting.
"""
from __future__ import annotations

from typing import Callable

import numpy as np


def belief_grid(n: int) -> np.ndarray:
    """n beliefs at the midpoints of n equal bins on (0, 1)."""
    return (np.arange(n) + 0.5) / n


def transition_matrix(g: np.ndarray, dt: float, s2: float = 1.0) -> np.ndarray:
    """P[i, j] = probability of moving from belief g[i] to belief g[j] in one step of dt.

    Each row is normalized over the next belief. The density comes from the mixture of the two
    evidence distributions, weighted by the current belief, and the change of variables from
    evidence to belief.
    """
    x = 0.5 * s2 * np.log(g / (1.0 - g))
    d = x[None, :] - x[:, None]  # evidence step from row i to column j
    mix = g[:, None] * np.exp(d / s2) + (1.0 - g[:, None]) * np.exp(-d / s2)
    p = mix * np.exp(-(d * d) / (2.0 * s2 * dt)) / (g * (1.0 - g))[None, :]
    return p / p.sum(axis=1, keepdims=True)


def bound_from_values(g: np.ndarray, v_decide: np.ndarray, v_wait: np.ndarray) -> float:
    """Upper belief bound: the first belief above 1/2 where deciding is worth more than waiting.

    Interpolates linearly between grid points. Returns 1.0 if waiting is better everywhere on the
    grid and 0.5 if deciding is better everywhere.
    """
    up = g > 0.5
    diff = (v_decide - v_wait)[up]
    gg = g[up]
    if not (diff > 0).any():
        return 1.0
    i = int(np.argmax(diff > 0))
    if i == 0:
        return 0.5
    return float(gg[i - 1] - diff[i - 1] * (gg[i] - gg[i - 1]) / (diff[i] - diff[i - 1]))


def value_iteration(c: float, s2: float = 1.0, n: int = 400, dt: float = 0.002,
                    tol: float | None = None, max_iter: int = 1_000_000):
    """Stationary policy for a constant cost c.

    Iterates V <- max(decide, P V - c dt) until the largest change is below tol. Each iteration is
    one time step, so values move by about c dt per step; the default tol is 1e-3 * dt for that
    reason. Returns (bound, values, iterations).
    """
    if tol is None:
        tol = 1e-3 * dt
    g = belief_grid(n)
    P = transition_matrix(g, dt, s2)
    v_decide = np.maximum(g, 1.0 - g)
    v = v_decide.copy()
    for it in range(1, max_iter + 1):
        v_wait = P @ v - c * dt
        v_new = np.maximum(v_decide, v_wait)
        if np.max(np.abs(v_new - v)) < tol:
            return bound_from_values(g, v_decide, v_wait), v_new, it
        v = v_new
    raise RuntimeError(f"value iteration did not converge in {max_iter} iterations")


def backward_induction(cost: Callable[[np.ndarray], np.ndarray], horizon: float,
                       s2: float = 1.0, n: int = 400, dt: float = 0.002):
    """Exact policy for a cost per unit time that changes over time, c(t).

    Starts at the horizon, where the decision maker must decide, and steps back to t = 0.
    Returns (times, upper belief bound at each time).
    """
    g = belief_grid(n)
    P = transition_matrix(g, dt, s2)
    v_decide = np.maximum(g, 1.0 - g)
    ts = np.arange(0.0, horizon + dt / 2, dt)
    c = np.broadcast_to(np.asarray(cost(ts), dtype=float), ts.shape)
    v = v_decide.copy()
    bounds = np.empty(len(ts))
    bounds[-1] = 0.5  # the choice is forced at the horizon
    for i in range(len(ts) - 2, -1, -1):
        v_wait = P @ v - c[i] * dt
        bounds[i] = bound_from_values(g, v_decide, v_wait)
        v = np.maximum(v_decide, v_wait)
    return ts, bounds


def backward_induction_x(cost: Callable[[np.ndarray], np.ndarray], horizon: float,
                         s2: float = 1.0, dt: float = 0.002, h: float = 0.005, cap: float = 8.0):
    """The same policy computed on an evidence grid instead of a belief grid.

    Evidence moves by a Gaussian step whose mean is +dt or -dt, so the expected value of waiting
    is a mix of two convolutions, weighted by the current belief. This uses the same grid and
    monitoring as `evaluate.known_reward`, so the policy it returns is the best one that scorer
    can see, which makes it the reference for small differences between policies. Returns
    (times, evidence bound at each time, value of starting at x = 0).
    """
    ts = np.arange(0.0, horizon + dt / 2, dt)
    c = np.broadcast_to(np.asarray(cost(ts), dtype=float), ts.shape)
    half = cap + 8 * np.sqrt(s2 * dt) + 1.0
    m = int(np.ceil(half / h))
    n = 1 << int(np.ceil(np.log2(2 * m + 1)))
    x = (np.arange(n) - n // 2) * h
    g = 1.0 / (1.0 + np.exp(-2.0 * x / s2))
    decide = np.maximum(g, 1.0 - g)
    off = (np.arange(n) - n // 2) * h
    k_hat = []
    for mu in (1.0, -1.0):
        # value at x' averaged over x' = x + mu dt + noise: correlate with the step density
        kern = np.exp(-((off + mu * dt) ** 2) / (2 * s2 * dt))
        kern /= kern.sum()
        k_hat.append(np.fft.rfft(np.fft.ifftshift(kern)))
    v = decide.copy()
    bounds = np.empty(len(ts))
    bounds[-1] = 0.0  # the choice is forced at the horizon
    pos = x > 0
    v0 = None
    for i in range(len(ts) - 2, -1, -1):
        vh = np.fft.rfft(v)
        wait = g * np.fft.irfft(vh * k_hat[0], n=n) + (1 - g) * np.fft.irfft(vh * k_hat[1], n=n) - c[i] * dt
        d = (decide - wait)[pos]
        xp = x[pos]
        j = int(np.argmax(d > 0)) if (d > 0).any() else None
        if j is None or xp[j] > cap:
            bounds[i] = np.inf
        elif j == 0:
            bounds[i] = 0.0
        else:
            bounds[i] = xp[j - 1] - d[j - 1] * (xp[j] - xp[j - 1]) / (d[j] - d[j - 1])
        v = np.maximum(decide, wait)
        if i == 0:
            v0 = float(np.interp(0.0, x, v))
    if v0 is None:  # a horizon shorter than one step
        v0 = float(np.interp(0.0, x, v))
    return ts, bounds, v0
