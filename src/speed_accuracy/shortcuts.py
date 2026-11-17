"""Cheap approximations to the exact policy when the cost of time changes over time.

Each takes a cost schedule c(t) and returns a belief bound at each time, built from the
closed-form bound for a constant cost (`ddm.optimal_bound`), so none of them needs a dynamic
program.

- per_moment: at each time, the bound that would be optimal if the cost stayed at its current
  value forever. This is the approach used in the 2025 capstone for time-varying costs.
- look_ahead: the per-moment bound for the cost a little later, at t + frac * T(t), where T(t) is
  the mean decision time the per-moment bound would give from a fresh start.
- average_ahead: the per-moment bound for the average cost over [t, t + T(t)].
- weighted_ahead: the per-moment bound for the future cost averaged with the boundary kernel
  (below), the correction that is exact to first order in small cost changes.
- weighted_bound: the per-moment bounds themselves averaged over the future with the boundary
  kernel, computed self-consistently. It also handles deadlines.

Under monitoring every dt rather than continuously, the best constant bound sits about
0.5826 * sigma * sqrt(dt) inside the continuous one; `discrete` applies that shift.
"""
from __future__ import annotations

from typing import Callable

import numpy as np

from .ddm import belief, mean_decision_time, optimal_bound

OVERSHOOT = 0.5826  # -zeta(1/2) / sqrt(2 pi)

_LOGC = np.linspace(np.log(1e-5), np.log(1e4), 2001)
_TABLE: dict[float, tuple[np.ndarray, np.ndarray]] = {}


def _table(s2: float):
    if s2 not in _TABLE:
        xs = np.array([optimal_bound(float(np.exp(lc)), s2) for lc in _LOGC])
        _TABLE[s2] = (xs, mean_decision_time(xs, s2))
    return _TABLE[s2]


def bound_for_cost(c, s2: float = 1.0) -> np.ndarray:
    """Closed-form evidence bound for each constant cost in c (vectorized, by interpolation in
    log c). Infinite cost gives 0; costs below 1e-5 are treated as 1e-5."""
    c = np.asarray(c, dtype=float)
    xs, _ = _table(s2)
    out = np.interp(np.log(np.clip(c, 1e-5, 1e4)), _LOGC, xs)
    return np.where(np.isinf(c), 0.0, out)


def time_for_cost(c, s2: float = 1.0) -> np.ndarray:
    """Mean decision time from a fresh start under the closed-form bound for constant cost c."""
    c = np.asarray(c, dtype=float)
    _, ts = _table(s2)
    out = np.interp(np.log(np.clip(c, 1e-5, 1e4)), _LOGC, ts)
    return np.where(np.isinf(c), 0.0, out)


def discrete(x, dt: float, s2: float = 1.0) -> np.ndarray:
    """Shift a continuous-monitoring evidence bound for monitoring every dt."""
    return np.maximum(np.asarray(x, float) - OVERSHOOT * np.sqrt(s2 * dt), 0.0)


def _c(cost, ts):
    return np.broadcast_to(np.asarray(cost(ts), dtype=float), np.shape(ts))


def per_moment(cost: Callable[[np.ndarray], np.ndarray], ts: np.ndarray, s2: float = 1.0) -> np.ndarray:
    """Belief bound at each time from the constant-cost answer for that time's cost."""
    return belief(bound_for_cost(_c(cost, ts), s2), s2)


def look_ahead(cost, ts: np.ndarray, s2: float = 1.0, frac: float = 1.0) -> np.ndarray:
    """Per-moment bound for the cost at t + frac * T(t)."""
    ts = np.asarray(ts, float)
    lead = frac * time_for_cost(_c(cost, ts), s2)
    return belief(bound_for_cost(_c(cost, ts + lead), s2), s2)


def average_ahead(cost, ts: np.ndarray, s2: float = 1.0, points: int = 41) -> np.ndarray:
    """Per-moment bound for the mean cost over [t, t + T(t)]."""
    ts = np.asarray(ts, float)
    lead = time_for_cost(_c(cost, ts), s2)
    grid = ts[:, None] + lead[:, None] * np.linspace(0.0, 1.0, points)[None, :]
    cbar = np.asarray(cost(grid), dtype=float).mean(axis=1)
    return belief(bound_for_cost(cbar, s2), s2)


# ---------------------------------------------------------------------------------------------
# Weighted look-ahead: the first-order correction.
#
# Perturb a constant cost c by a small change dc(t + s) over the future. To first order the
# optimal bound moves as if the cost had changed by a constant amount, the average of dc(t + s)
# with weights w(s) = -d/dx P(still deciding after s | start at x), taken at the bound x = b.
# (Smooth pasting fixes the bound by the slope of the value at b, and the change in value from x
# is -integral of dc(t + s) P(still deciding after s | x) ds.) The survival probability is under
# the decision maker's own beliefs: drift +1 with probability g(b) and -1 otherwise. For Brownian
# motion between absorbing bounds at +-b it has an eigenfunction series, which gives w in closed
# form:
#   w_mu(s) = sum_n k_n^2 / (b (a^2 + k_n^2)) * (1 - (-1)^n e^(-2 a b)) * e^(-s2 (k_n^2 + a^2) s / 2)
# with k_n = n pi / (2 b) and a = mu / s2.
# ---------------------------------------------------------------------------------------------

_KERNELS: dict[tuple[float, float], tuple[np.ndarray, np.ndarray]] = {}


def boundary_kernel(b: float, s2: float = 1.0, terms: int = 4000, bins: int = 240):
    """Weights of future times for the bound at +-b: (bin midpoints s, weight per bin), with the
    weights summing to 1."""
    n = np.arange(1, terms + 1)
    k = n * np.pi / (2 * b)
    g = float(belief(b, s2))
    lam_slow = 0.5 * s2 * ((np.pi / (2 * b)) ** 2 + 1 / s2 ** 2)
    edges = np.concatenate([[0.0], np.geomspace(1e-5, 14.0 / lam_slow, bins)])
    w = np.zeros(bins)
    for mu, pw in ((1.0, g), (-1.0, 1 - g)):
        a = mu / s2
        amp = k * k / (b * (a * a + k * k)) * (1 - (-1.0) ** n * np.exp(-2 * a * b))
        rate = 0.5 * s2 * (k * k + a * a)
        e = np.exp(-np.outer(rate, edges))  # terms x edges
        w += pw * (amp / rate) @ (e[:, :-1] - e[:, 1:])
    mid = 0.5 * (edges[:-1] + edges[1:])
    return mid, w / w.sum()


def _kernel_for_cost(c: float, s2: float):
    key = (round(float(np.log(max(c, 1e-5))), 2), s2)  # cache on a grid of log c
    if key not in _KERNELS:
        b = float(bound_for_cost(np.exp(key[0]), s2))
        _KERNELS[key] = boundary_kernel(max(b, 1e-3), s2)
    return _KERNELS[key]


def weighted_ahead(cost, ts: np.ndarray, s2: float = 1.0) -> np.ndarray:
    """First-order correction: the per-moment bound for the boundary-weighted average of the
    future cost, with the kernel for the current cost c(t). Exact to first order in small cost
    changes; for large ones use `weighted_bound`."""
    ts = np.asarray(ts, float)
    c_now = _c(cost, ts)
    c_eff = np.full(len(ts), np.inf)
    fin = np.flatnonzero(np.isfinite(c_now))
    keys = np.round(np.log(np.clip(c_now[fin], 1e-5, 1e4)), 2)
    for key in np.unique(keys):
        sel = fin[keys == key]
        s, w = _kernel_for_cost(float(np.exp(key)), s2)
        c_eff[sel] = np.asarray(cost(ts[sel, None] + s[None, :]), dtype=float) @ w
    return belief(bound_for_cost(c_eff, s2), s2)


def look_ahead_time(c: float, s2: float = 1.0) -> float:
    """Mean of the boundary kernel: the look-ahead that the first-order correction gives for a
    cost rising linearly."""
    s, w = _kernel_for_cost(c, s2)
    return float(w @ s)


_BKERNELS: dict[tuple[float, float], tuple[np.ndarray, np.ndarray]] = {}


def _kernel_for_bound(b: float, s2: float):
    key = (round(max(b, 0.01), 3), s2)
    if key not in _BKERNELS:
        _BKERNELS[key] = boundary_kernel(key[0], s2)
    return _BKERNELS[key]


def weighted_bound(cost, ts: np.ndarray, s2: float = 1.0, self_consistent: bool = True,
                   iterations: int = 30) -> np.ndarray:
    """Average the per-moment evidence bound over the future with the boundary kernel.

    To first order this is the same correction as `weighted_ahead`; for large changes it saturates
    the way the bound does (a cost spike can only pull the bound to 0). Past a deadline the cost is
    infinite and the per-moment bound is 0, so deadlines need no special case. The kernel is the
    one for the per-moment bound now, or, with self_consistent=True, for the averaged bound itself.
    Returns belief bounds.
    """
    ts = np.asarray(ts, float)
    b_now = bound_for_cost(_c(cost, ts), s2)
    b_ref = b_now.copy()
    for _ in range(iterations if self_consistent else 1):
        out = np.empty(len(ts))
        keys = np.round(np.maximum(b_ref, 0.01), 3)
        for key in np.unique(keys):
            sel = np.flatnonzero(keys == key)
            s, w = _kernel_for_bound(float(key), s2)
            fut = np.asarray(cost(ts[sel, None] + s[None, :]), dtype=float)
            out[sel] = bound_for_cost(fut, s2) @ w
        b_ref = out if not self_consistent else 0.5 * (b_ref + out)
    return belief(b_ref, s2)
