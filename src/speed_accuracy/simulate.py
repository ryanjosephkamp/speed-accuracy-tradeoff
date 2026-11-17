"""Monte Carlo trials for a policy given as an evidence bound over time.

Noise is drawn step by step from a seeded generator, so two policies run with the same seed see
the same evidence (paired comparison) without storing the whole noise array.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np


@dataclass
class Result:
    correct: np.ndarray   # bool per trial
    rt: np.ndarray        # decision time per trial
    cost: np.ndarray      # accumulated cost of time per trial

    @property
    def reward(self) -> np.ndarray:
        return self.correct.astype(float) - self.cost


def run_known(x_bound: np.ndarray, ts: np.ndarray, cost: Callable[[np.ndarray], np.ndarray],
              trials: int, s2: float = 1.0, seed: int = 0) -> Result:
    """Known reliability, drift +1 (the problem is symmetric). Trials still undecided at the last
    time choose by the sign of the evidence."""
    dt = ts[1] - ts[0]
    c = np.broadcast_to(np.asarray(cost(ts), dtype=float), ts.shape)
    ccum = np.concatenate([[0.0], np.cumsum(c[:-1] * dt)])
    x = np.zeros(trials)
    alive = np.ones(trials, bool)
    correct = np.zeros(trials, bool)
    rt = np.full(trials, ts[-1])
    sd = np.sqrt(s2 * dt)
    for k in range(1, len(ts)):
        noise = np.random.default_rng([seed, k]).standard_normal(trials)
        idx = np.flatnonzero(alive)
        if idx.size == 0:
            break
        x[idx] += dt + sd * noise[idx]
        up = x[idx] >= x_bound[k]
        lo = x[idx] <= -x_bound[k]
        hit = up | lo
        h = idx[hit]
        correct[h] = up[hit]
        rt[h] = ts[k]
        alive[h] = False
    idx = np.flatnonzero(alive)
    correct[idx] = x[idx] > 0
    return Result(correct, rt, np.interp(rt, ts, ccum))
