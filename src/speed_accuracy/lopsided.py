"""Lopsided stakes: the two choices pay different rewards.

A correct "+" choice earns r_plus, a correct "-" choice earns r_minus, and an error earns
nothing. The prior is even and sigma^2 = 1. With unequal rewards the bounds are no longer mirror
images: the decision maker waits while lo(t) < x < hi(t), and that interval always contains
x_star, the evidence at which both choices are worth the same.

The module mirrors the symmetric code:

- `constant_bounds`: closed-form bounds for a constant cost (smooth fit and value matching at
  both ends).
- `boundary_kernels`: the first-order kernel at each bound, the survival flux of the decision
  time there.
- `per_moment` and `weighted_bound`: the two cheap rules.
- `backward_induction`: the exact policy on an evidence grid.
- `reward`: exact scoring by moving the evidence density forward.
"""
from __future__ import annotations

from typing import Callable

import numpy as np
from scipy.optimize import brentq

from .ddm import belief
from .evaluate import Outcome
from .shortcuts import OVERSHOOT


def x_star(r_plus: float, r_minus: float) -> float:
    """Evidence at which choosing + and choosing - have the same expected reward."""
    return 0.5 * np.log(r_minus / r_plus)


def _S(x):
    # 2 * integral of cosh^2 from 0 to x
    return x + 0.5 * np.sinh(2.0 * x)


def _S_inv(v: float) -> float:
    hi = 1.0
    while _S(hi) < abs(v):
        hi *= 2.0
    root = brentq(lambda x: _S(x) - abs(v), 0.0, hi, xtol=1e-14)
    return float(np.copysign(root, v))


def _A(x, c, K):
    # an antiderivative of V'(x) = (c S(x) + K) / cosh^2 x
    return c * (_S(x) * np.tanh(x) - 0.5 * np.cosh(2.0 * x)) + K * np.tanh(x)


def constant_bounds(c: float, r_plus: float = 1.0, r_minus: float = 1.0) -> tuple[float, float]:
    """(lo, hi) evidence bounds for a constant cost c > 0.

    In the waiting region the value solves V''/2 + tanh(x) V' = c, so
    V'(x) = (c S(x) + K) / cosh^2 x with S(x) = x + sinh(2x)/2. Smooth fit at hi and lo gives
    c S(hi) + K = r_plus/2 and c S(lo) + K = -r_minus/2. Value matching across the region leaves
    one equation in hi.
    """
    if not np.isfinite(c):
        xs = x_star(r_plus, r_minus)
        return xs, xs
    gap = (r_plus + r_minus) / (2.0 * c)
    xs = x_star(r_plus, r_minus)

    def parts(hi):
        lo = _S_inv(_S(hi) - gap)
        K = 0.5 * r_plus - c * _S(hi)
        lhs = _A(hi, c, K) - _A(lo, c, K)
        rhs = r_plus * belief(hi) - r_minus * (1.0 - belief(lo))
        return lo, float(lhs - rhs)

    # hi lies above x_star; scan outward for a sign change, then refine
    grid = xs + np.geomspace(1e-6, 30.0, 400)
    vals = [parts(h)[1] for h in grid]
    for a, b, fa, fb in zip(grid[:-1], grid[1:], vals[:-1], vals[1:]):
        if fa == 0.0:
            return parts(a)[0], float(a)
        if fa * fb < 0:
            hi = brentq(lambda h: parts(h)[1], a, b, xtol=1e-13, rtol=1e-13)
            return parts(hi)[0], float(hi)
    raise RuntimeError(f"no bounds found for c={c}, rewards {r_plus}, {r_minus}")


_LOGC = np.linspace(np.log(1e-5), np.log(1e4), 1201)
_TABLES: dict[tuple[float, float], tuple[np.ndarray, np.ndarray]] = {}


def _table(r_plus, r_minus):
    key = (r_plus, r_minus)
    if key not in _TABLES:
        pairs = np.array([constant_bounds(float(np.exp(lc)), r_plus, r_minus) for lc in _LOGC])
        _TABLES[key] = (pairs[:, 0], pairs[:, 1])
    return _TABLES[key]


def bounds_for_cost(c, r_plus: float = 1.0, r_minus: float = 1.0):
    """Vectorized constant-cost bounds (lo, hi), by interpolation in log c. Infinite cost gives
    x_star for both; costs below 1e-5 are treated as 1e-5."""
    c = np.asarray(c, dtype=float)
    lo_t, hi_t = _table(r_plus, r_minus)
    lc = np.log(np.clip(c, 1e-5, 1e4))
    xs = x_star(r_plus, r_minus)
    lo = np.where(np.isinf(c), xs, np.interp(lc, _LOGC, lo_t))
    hi = np.where(np.isinf(c), xs, np.interp(lc, _LOGC, hi_t))
    return lo, hi


def exit_transforms(lam, lo: float, hi: float):
    """Laplace transforms of the survival flux at each bound, (n_hi(lam), n_lo(lam)).

    With r = sqrt(2 lam + 1), E_x exp(-lam tau) = (A cosh(r x) + B sinh(r x)) / cosh x, equal to
    1 at both bounds. The flux at hi is -d/dx P_x(tau > s) there, whose transform is
    u'(hi) / lam; at lo it is u'(lo) / lam with the sign flipped.
    """
    lam = np.asarray(lam, dtype=complex)
    r = np.sqrt(2.0 * lam + 1.0)
    det = np.cosh(r * lo) * np.sinh(r * hi) - np.sinh(r * lo) * np.cosh(r * hi)
    A = (np.cosh(lo) * np.sinh(r * hi) - np.cosh(hi) * np.sinh(r * lo)) / det
    B = (np.cosh(r * lo) * np.cosh(hi) - np.cosh(r * hi) * np.cosh(lo)) / det

    def du(x):
        f = A * np.cosh(r * x) + B * np.sinh(r * x)
        fp = r * (A * np.sinh(r * x) + B * np.cosh(r * x))
        return (fp * np.cosh(x) - f * np.sinh(x)) / np.cosh(x) ** 2

    return du(hi) / lam, -du(lo) / lam


def flux_totals(lo: float, hi: float) -> tuple[float, float]:
    """Total survival flux at each bound, (-dE_x tau/dx at hi, dE_x tau/dx at lo), from the mean
    exit time m(x), which solves m''/2 + tanh(x) m' = -1 with m = 0 at both bounds."""
    def anti(x):  # antiderivative of S(x) / cosh^2 x
        return _S(x) * np.tanh(x) - 0.5 * np.cosh(2.0 * x)

    C = (anti(hi) - anti(lo)) / (np.tanh(hi) - np.tanh(lo))
    return float((_S(hi) - C) / np.cosh(hi) ** 2), float((C - _S(lo)) / np.cosh(lo) ** 2)


def transfer(lam, lo: float, hi: float):
    """Normalized kernel transforms (w_hi(lam), w_lo(lam)), equal to 1 at lam = 0."""
    n_hi, n_lo = exit_transforms(lam, lo, hi)
    t_hi, t_lo = flux_totals(lo, hi)
    return n_hi / t_hi, n_lo / t_lo


def boundary_kernels(lo: float, hi: float, terms: int = 4000, bins: int = 240):
    """Weights of future times for each bound: (bin midpoints s, w_hi, w_lo), each summing to 1.

    For Brownian motion with drift a killed outside (lo, hi), of width L, the flux at the upper
    bound is (2/L) sum_n k_n^2/(a^2 + k_n^2) (1 - (-1)^n e^(-a L)) e^(-(k_n^2 + a^2) s / 2), with
    k_n = n pi / L; at the lower bound the sign of a flips. The decision maker's own beliefs
    weight drift +1 by the posterior at that bound.
    """
    L = hi - lo
    n = np.arange(1, terms + 1)
    k = n * np.pi / L
    lam_slow = 0.5 * ((np.pi / L) ** 2 + 1.0)
    edges = np.concatenate([[0.0], np.geomspace(1e-5, 14.0 / lam_slow, bins)])
    out = []
    for x_b, side in ((hi, +1.0), (lo, -1.0)):
        g = float(belief(x_b))
        w = np.zeros(bins)
        for mu, pw in ((1.0, g), (-1.0, 1.0 - g)):
            a = side * mu
            amp = (2.0 / L) * k * k / (a * a + k * k) * (1.0 - (-1.0) ** n * np.exp(-a * L))
            rate = 0.5 * (k * k + a * a)
            e = np.exp(-np.outer(rate, edges))
            w += pw * (amp / rate) @ (e[:, :-1] - e[:, 1:])
        out.append(w / w.sum())
    mid = 0.5 * (edges[:-1] + edges[1:])
    return mid, out[0], out[1]


_KERNELS: dict[tuple[float, float], tuple[np.ndarray, np.ndarray, np.ndarray]] = {}


def _kernels_for(lo: float, hi: float):
    lo_k, hi_k = round(lo, 3), round(max(hi, lo + 0.02), 3)
    key = (lo_k, hi_k)
    if key not in _KERNELS:
        _KERNELS[key] = boundary_kernels(lo_k, hi_k)
    return _KERNELS[key]


def _c(cost, ts):
    return np.broadcast_to(np.asarray(cost(ts), dtype=float), np.shape(ts))


def per_moment(cost: Callable, ts: np.ndarray, r_plus: float = 1.0, r_minus: float = 1.0):
    """(lo, hi) at each time from the constant-cost answer for that time's cost."""
    return bounds_for_cost(_c(cost, np.asarray(ts, float)), r_plus, r_minus)


def weighted_bound(cost: Callable, ts: np.ndarray, r_plus: float = 1.0, r_minus: float = 1.0,
                   iterations: int = 30):
    """Average each bound's per-moment value over the future with that bound's own kernel,
    computed self-consistently (the kernel is the one for the averaged bounds). Kernels are
    cached on a 0.01 grid of (lo, hi); the kernel's shape only matters at second order. Returns
    (lo, hi)."""
    ts = np.asarray(ts, float)
    lo_ref, hi_ref = per_moment(cost, ts, r_plus, r_minus)
    for _ in range(iterations):
        out_lo, out_hi = np.empty(len(ts)), np.empty(len(ts))
        keys = np.c_[np.round(lo_ref, 2), np.round(np.maximum(hi_ref, lo_ref + 0.02), 2)]
        uniq, inv = np.unique(keys, axis=0, return_inverse=True)
        for j, (lk, hk) in enumerate(uniq):
            sel = np.flatnonzero(inv.ravel() == j)
            s, w_hi, w_lo = _kernels_for(float(lk), float(hk))
            f_lo, f_hi = bounds_for_cost(np.asarray(cost(ts[sel, None] + s[None, :]), dtype=float),
                                         r_plus, r_minus)
            out_lo[sel] = f_lo @ w_lo
            out_hi[sel] = f_hi @ w_hi
        lo_ref, hi_ref = 0.5 * (lo_ref + out_lo), 0.5 * (hi_ref + out_hi)
    return lo_ref, hi_ref


def discrete(lo, hi, dt: float):
    """Move both bounds inward for monitoring every dt (the same overshoot as the symmetric case)."""
    d = OVERSHOOT * np.sqrt(dt)
    lo2, hi2 = np.asarray(lo, float) + d, np.asarray(hi, float) - d
    mid = 0.5 * (lo2 + hi2)
    return np.minimum(lo2, mid), np.maximum(hi2, mid)


def _grid(cap, dt, h):
    half = cap + 8 * np.sqrt(dt) + 1.0
    m = int(np.ceil(half / h))
    n = 1 << int(np.ceil(np.log2(2 * m + 1)))
    return (np.arange(n) - n // 2) * h, n


def backward_induction(cost: Callable, horizon: float, r_plus: float = 1.0, r_minus: float = 1.0,
                       dt: float = 0.002, h: float = 0.005, cap: float = 8.0):
    """Exact policy on the evidence grid used by `reward`. Returns (ts, lo, hi, value at x = 0).

    The convolution is circular, and with unequal rewards the two ends of the grid hold different
    values, so the wrap would leak value from one end into the other and, step by step, inward.
    Beyond |x| = cap the value is reset to the reward for deciding, which is exact there as long
    as the bounds stay inside cap (bounds that would not are reported as infinite)."""
    ts = np.arange(0.0, horizon + dt / 2, dt)
    c = _c(cost, ts)
    x, n = _grid(cap, dt, h)
    g = belief(x)
    decide = np.maximum(r_plus * g, r_minus * (1.0 - g))
    k_hat = []
    for mu in (1.0, -1.0):
        kern = np.exp(-((x + mu * dt) ** 2) / (2 * dt))
        kern /= kern.sum()
        k_hat.append(np.fft.rfft(np.fft.ifftshift(kern)))
    xs = x_star(r_plus, r_minus)
    outer = np.abs(x) > cap
    up, dn = (x > xs) & ~outer, (x <= xs) & ~outer
    xu, xd = x[up], x[dn][::-1]  # outward from x_star in both directions, out to cap
    v = decide.copy()
    lo, hi = np.empty(len(ts)), np.empty(len(ts))
    v0 = None

    def edge(d, xx):
        j = int(np.argmax(d > 0)) if (d > 0).any() else None
        if j is None:
            return np.inf * np.sign(xx[-1] - xx[0])
        if j == 0:
            return xs
        return xx[j - 1] - d[j - 1] * (xx[j] - xx[j - 1]) / (d[j] - d[j - 1])

    lo[-1] = hi[-1] = xs  # the choice is forced at the horizon
    for i in range(len(ts) - 2, -1, -1):
        vh = np.fft.rfft(v)
        wait = g * np.fft.irfft(vh * k_hat[0], n=n) + (1 - g) * np.fft.irfft(vh * k_hat[1], n=n) - c[i] * dt
        d = decide - wait
        hi[i] = edge(d[up], xu)
        lo[i] = edge(d[dn][::-1], xd)
        v = np.maximum(decide, wait)
        v[outer] = decide[outer]
        if i == 0:
            v0 = float(np.interp(0.0, x, v))
    if v0 is None:  # a horizon shorter than one step
        v0 = float(np.interp(0.0, x, v))
    return ts, lo, hi, v0


def reward(lo, hi, ts, cost, r_plus: float = 1.0, r_minus: float = 1.0, h: float = 0.005,
           cap: float = 8.0) -> Outcome:
    """Exact expected reward of the policy (lo, hi), checked once per step as in the dynamic
    program. Trials undecided at the last time choose the option worth more at their evidence.
    `p_correct` is the expected reward from choices (not a probability when rewards differ)."""
    ts = np.asarray(ts, float)
    dt = ts[1] - ts[0]
    c = _c(cost, ts)
    lo = np.clip(np.asarray(lo, float), -cap, cap)
    hi = np.clip(np.asarray(hi, float), -cap, cap)
    hi = np.maximum(hi, lo)
    xs = x_star(r_plus, r_minus)
    if hi[0] <= 0.0 or lo[0] >= 0.0:  # decide at once on the prior
        return Outcome(0.5 * max(r_plus, r_minus), 0.0, 0.0)
    x, n = _grid(cap, dt, h)
    drifts = np.array([[1.0], [-1.0]])
    kern = np.exp(-((x[None, :] - drifts * dt) ** 2) / (2 * dt))
    kern /= kern.sum(axis=1, keepdims=True)
    k_hat = np.fft.rfft(np.fft.ifftshift(kern, axes=1), axis=1)
    p = np.zeros((2, n))
    p[:, n // 2] = 1.0
    pay = np.array([r_plus, r_minus])
    got = np.zeros(2)
    rt = np.zeros(2)
    paid = np.zeros(2)
    alive = np.ones(2)
    for k in range(1, len(ts)):
        paid += alive * c[k - 1] * dt
        p = np.fft.irfft(np.fft.rfft(p, axis=1) * k_hat, n=n, axis=1)
        np.maximum(p, 0.0, out=p)
        f_up = np.clip((x + h / 2 - hi[k]) / h, 0.0, 1.0)
        f_dn = np.clip((lo[k] - (x - h / 2)) / h, 0.0, 1.0)
        f_dn = np.minimum(f_dn, 1.0 - f_up)
        m_up, m_dn = p @ f_up, p @ f_dn
        p *= 1.0 - f_up - f_dn
        got += np.array([m_up[0], m_dn[1]]) * pay
        rt += (m_up + m_dn) * ts[k]
        alive = p.sum(axis=1)
    plus = (x > xs).astype(float)
    got += np.array([p[0] @ plus, p[1] @ (1.0 - plus)]) * pay
    rt += alive * ts[-1]
    return Outcome(float(got.mean()), float(rt.mean()), float(paid.mean()))
