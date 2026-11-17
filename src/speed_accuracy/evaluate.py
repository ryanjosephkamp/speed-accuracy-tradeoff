"""Exact expected reward of a policy, found by moving the evidence density forward in time.

A policy is an evidence bound over time, +-x_bound[k] at time ts[k]. The bound is checked once
per step of dt, as in the dynamic program and the Monte Carlo trials, so all three agree on what
a policy earns. The density lives on an evidence grid of spacing h; each step convolves it with
the Gaussian step of the evidence and removes the mass that has crossed a bound. Trials still
undecided at the last time choose by the sign of the evidence.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np
from scipy.stats import norm


@dataclass
class Outcome:
    p_correct: float
    mean_rt: float
    mean_cost: float

    @property
    def reward(self) -> float:
        return self.p_correct - self.mean_cost


def _forward(x_bound, ts, cost, drifts, weights, s2, h, cap, decided=None):
    ts = np.asarray(ts, float)
    dt = ts[1] - ts[0]
    c = np.broadcast_to(np.asarray(cost(ts) if callable(cost) else cost, dtype=float), ts.shape)
    b = np.minimum(np.asarray(x_bound, float), cap)
    if b[0] <= 0:  # deciding at once is a coin flip
        return Outcome(0.5, 0.0, 0.0)
    half = cap + 8 * np.sqrt(s2 * dt) + 1.0
    m = int(np.ceil(half / h))
    n = 1 << int(np.ceil(np.log2(2 * m + 1)))  # FFT length; bounds keep mass away from the wrap
    x = (np.arange(n) - n // 2) * h
    drifts = np.asarray(drifts, float)[:, None]
    w = np.asarray(weights, float)
    w = w / w.sum()
    # one Gaussian step per drift, centered on index 0 for circular convolution
    off = (np.arange(n) - n // 2) * h
    kern = np.exp(-((off[None, :] - drifts * dt) ** 2) / (2 * s2 * dt))
    kern /= kern.sum(axis=1, keepdims=True)
    k_hat = np.fft.rfft(np.fft.ifftshift(kern, axes=1), axis=1)
    p = np.zeros((len(drifts), n))
    p[:, n // 2] = 1.0
    sign = np.sign(drifts[:, 0])
    correct = np.zeros(len(drifts))
    rt = np.zeros(len(drifts))
    paid = np.zeros(len(drifts))
    alive = np.ones(len(drifts))
    for k in range(1, len(ts)):
        paid += alive * c[k - 1] * dt
        p = np.fft.irfft(np.fft.rfft(p, axis=1) * k_hat, n=n, axis=1)
        np.maximum(p, 0.0, out=p)
        up = np.clip((x + h / 2 - b[k]) / h, 0.0, 1.0)
        lo = np.clip((-b[k] - (x - h / 2)) / h, 0.0, 1.0)
        m_up = p @ up
        m_lo = p @ lo
        p *= 1.0 - up - lo
        correct += np.where(sign > 0, m_up, m_lo)
        rt += (m_up + m_lo) * ts[k]
        alive = p.sum(axis=1)
        if decided is not None:
            decided[k] = w @ (m_up + m_lo)
    # undecided at the horizon: choose by sign
    pos = (x > 0).astype(float) + 0.5 * (x == 0)
    neg = (x < 0).astype(float) + 0.5 * (x == 0)
    correct += np.where(sign > 0, p @ pos, p @ neg)
    rt += alive * ts[-1]
    if decided is not None:
        decided[-1] += w @ alive
    return Outcome(float(w @ correct), float(w @ rt), float(w @ paid))


def known_reward(x_bound, ts, cost, s2: float = 1.0, h: float = 0.005,
                 cap: float = 8.0) -> Outcome:
    """Known reliability, drift +1 (the problem is symmetric). Bounds above cap are treated as cap."""
    return _forward(x_bound, ts, cost, [1.0], [1.0], s2, h, cap)


def known_decision_times(x_bound, ts, s2: float = 1.0, h: float = 0.005,
                         cap: float = 8.0) -> np.ndarray:
    """Probability of deciding at each time ts[k] under the bound x_bound (known reliability).
    Trials still undecided at the last time are counted there."""
    out = np.zeros(len(ts))
    _forward(x_bound, ts, 0.0, [1.0], [1.0], s2, h, cap, decided=out)
    return out


def unknown_reward(x_bound, ts, cost, prior_var: float = 1.0, h: float = 0.005,
                   cap: float = 12.0, nodes: int = 48) -> Outcome:
    """Unknown reliability: the drift mu ~ N(0, prior_var) is drawn once per trial, noise
    variance 1. By symmetry only mu > 0 is needed; Gauss-Legendre nodes on (0, 6 sd) weighted by
    the half-normal density cover it."""
    sd = np.sqrt(prior_var)
    u, wq = np.polynomial.legendre.leggauss(nodes)
    mu = 3 * sd * (u + 1)
    wts = wq * norm.pdf(mu, scale=sd)
    return _forward(x_bound, ts, cost, mu, wts, 1.0, h, cap)
