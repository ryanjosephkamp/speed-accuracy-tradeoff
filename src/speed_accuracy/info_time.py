"""Unknown reliability seen as a constant process with a rising cost.

With mu ~ N(0, 1/a) and dX = mu dt + dW, the decision maker's own view of the evidence is
dX = X/(t + a) dt + dW. In the belief variable u = X / sqrt(t + a) = Phi^-1(g) and the
"information time" tau = log((t + a) / a), this becomes

    du = (u / 2) dtau + dW_tau,

the same process at every moment, while the cost of time per unit tau is c(t) (t + a), which
grows as information arrives more slowly. So the frozen-time policy (each moment's stationary
answer) is the per-moment shortcut in tau, and the boundary-kernel average applies unchanged.

For a constant cost kappa per unit tau, the stationary bound U solves
    integral_0^U exp(v^2 / 2) dv = 1 / (2 sqrt(2 pi) kappa),
from the value function's ODE (u/2) V' + V''/2 = kappa and smooth pasting V'(U) = phi(U).
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import brentq
from scipy.special import erfi

from .shortcuts import OVERSHOOT

_LOGK = np.linspace(np.log(1e-4), np.log(1e4), 1601)
_UTAB: np.ndarray | None = None


def frozen_bound(kappa: float) -> float:
    """Stationary bound in u for a constant cost kappa per unit of information time."""
    if kappa <= 0:
        return float("inf")
    target = 1.0 / (2.0 * np.pi * kappa)  # erfi(U / sqrt 2) = target
    hi = 1.0
    while erfi(hi / np.sqrt(2)) < target:
        hi *= 2.0
    return float(brentq(lambda u: erfi(u / np.sqrt(2)) - target, 0.0, hi, xtol=1e-12))


def frozen_bounds(kappa) -> np.ndarray:
    """Vectorized frozen_bound by interpolation in log kappa; infinite kappa gives 0."""
    global _UTAB
    if _UTAB is None:
        _UTAB = np.array([frozen_bound(float(np.exp(k))) for k in _LOGK])
    kappa = np.asarray(kappa, float)
    out = np.interp(np.log(np.clip(kappa, 1e-4, 1e4)), _LOGK, _UTAB)
    return np.where(np.isinf(kappa), 0.0, out)


def survival_kernel(drift, U: float, points: int = 400, bins: int = 240, t_max: float | None = None):
    """Boundary kernel for du = drift(u) dt + dW between absorbing bounds at +-U:
    w(s) = -d/du P(not absorbed by s | u) at u = U, normalized, on log-spaced bins of s.

    Uses a finite-difference generator on `points` interior nodes and its eigenvectors.
    Returns (bin midpoints, weights summing to 1).
    """
    h = 2 * U / (points + 1)
    u = -U + h * np.arange(1, points + 1)
    f = drift(u)
    L = np.zeros((points, points))
    i = np.arange(points)
    L[i, i] = -1.0 / h ** 2
    L[i[:-1], i[:-1] + 1] = 0.5 / h ** 2 + f[:-1] / (2 * h)
    L[i[1:], i[1:] - 1] = 0.5 / h ** 2 - f[1:] / (2 * h)
    lam, V = np.linalg.eig(L)
    lam, V = lam.real, V.real
    coef = np.linalg.solve(V, np.ones(points))
    amp = V[-1, :] * coef  # survival at the node next to +U, by mode
    slow = -lam.max()
    if t_max is None:
        t_max = 14.0 / slow
    edges = np.concatenate([[0.0], np.geomspace(1e-5 * t_max, t_max, bins)])
    rate = -lam
    e = np.exp(-np.outer(rate, edges))
    w = (amp / rate) @ (e[:, :-1] - e[:, 1:])
    w = np.maximum(w, 0.0)
    return 0.5 * (edges[:-1] + edges[1:]), w / w.sum()


_UK: dict[float, tuple[np.ndarray, np.ndarray]] = {}


def _kernel_u(U: float):
    key = round(max(U, 0.02), 2)
    if key not in _UK:
        _UK[key] = survival_kernel(lambda u: u / 2, key, points=240)
    return _UK[key]


def tau_of_t(t, a: float):
    return np.log((np.asarray(t, float) + a) / a)


def t_of_tau(tau, a: float):
    return a * np.exp(np.asarray(tau, float)) - a


def frozen_time(cost, ts: np.ndarray, prior_var: float = 1.0) -> np.ndarray:
    """Frozen-time policy (the 2025 approach, done right) as an evidence bound X(t)."""
    a = 1.0 / prior_var
    ts = np.asarray(ts, float)
    c = np.broadcast_to(np.asarray(cost(ts) if callable(cost) else cost, dtype=float), ts.shape)
    return frozen_bounds(c * (ts + a)) * np.sqrt(ts + a)


def weighted_bound(cost, ts: np.ndarray, prior_var: float = 1.0, iterations: int = 30) -> np.ndarray:
    """Boundary-kernel average of the frozen-time bounds over future information time,
    self-consistent, as an evidence bound X(t)."""
    a = 1.0 / prior_var
    ts = np.asarray(ts, float)
    cf = cost if callable(cost) else (lambda t: cost + 0 * np.asarray(t, float))
    kappa_at = lambda tau: np.asarray(cf(t_of_tau(tau, a)), float) * (t_of_tau(tau, a) + a)
    tau = tau_of_t(ts, a)
    u_ref = frozen_bounds(kappa_at(tau))
    for _ in range(iterations):
        out = np.empty(len(ts))
        keys = np.round(np.maximum(u_ref, 0.02), 2)
        for key in np.unique(keys):
            sel = np.flatnonzero(keys == key)
            s, w = _kernel_u(float(key))
            out[sel] = frozen_bounds(kappa_at(tau[sel, None] + s[None, :])) @ w
        u_ref = 0.5 * (u_ref + out)
    return u_ref * np.sqrt(ts + a)


def discrete(x, dt: float) -> np.ndarray:
    """Shift a continuous-monitoring evidence bound for monitoring every dt (noise variance 1)."""
    return np.maximum(np.asarray(x, float) - OVERSHOOT * np.sqrt(dt), 0.0)
