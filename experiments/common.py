"""Shared pieces for the shortcut experiments: cost schedules, policies, and scoring.

All scores come from `evaluate`, which computes expected reward exactly on a grid, so two
policies can be compared without Monte Carlo noise. Losses are in points per 100 trials:
100 * (reward of the exact policy - reward of the policy).
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import minimize_scalar

from speed_accuracy import ddm, evaluate, known, shortcuts

DT = 0.002
HORIZON = 10.0


class Schedule:
    """A cost of time c(t). With a deadline, the choice is forced at that time, and the
    shortcuts see the cost beyond it as infinite."""

    def __init__(self, name, fn, deadline=None, family="", **params):
        self.name, self.fn, self.deadline, self.family, self.params = name, fn, deadline, family, params

    def __call__(self, t):
        t = np.asarray(t, float)
        c = np.broadcast_to(np.asarray(self.fn(t), dtype=float), t.shape)
        if self.deadline is None:
            return c
        return np.where(t <= self.deadline + 1e-12, c, np.inf)

    @property
    def horizon(self):
        return HORIZON if self.deadline is None else self.deadline


def step(c0, c1, t0, width=0.05):
    return Schedule(f"step {c0:g} to {c1:g} at {t0:g} s",
                    lambda t: c0 + (c1 - c0) / (1 + np.exp(-(t - t0) / width)),
                    family="step", c0=c0, c1=c1, t0=t0)


def ramp(c0, k):
    return Schedule(f"ramp {c0:g} + {k:g} t", lambda t: c0 + k * t, family="ramp", c0=c0, k=k)


def deadline(c0, T):
    return Schedule(f"deadline {T:g} s at cost {c0:g}", lambda t: c0 + 0 * t, deadline=T,
                    family="deadline", c0=c0, T=T)


def exact_policy(sched):
    """Exact policy on the scorer's own evidence grid (`known.backward_induction_x`)."""
    ts, xb, _ = known.backward_induction_x(lambda t: np.minimum(sched(t), 1e9), sched.horizon, dt=DT)
    return ts, xb


def to_x(gb, ts):
    return shortcuts.discrete(ddm.evidence(np.clip(gb, 0.5, 1 - 1e-12)), DT)


def score(x, ts, sched):
    return evaluate.known_reward(x, ts, sched)


def best_fixed(ts, sched, lo=0.02, hi=4.0):
    res = minimize_scalar(lambda xb: -score(np.full(len(ts), xb), ts, sched).reward,
                          bounds=(lo, hi), method="bounded", options={"xatol": 0.005})
    return float(res.x), score(np.full(len(ts), res.x), ts, sched)


def policies(sched, ts):
    """The cheap policies, as evidence bounds over ts."""
    return {
        "per_moment": to_x(shortcuts.per_moment(sched, ts), ts),
        "look_ahead_half": to_x(shortcuts.look_ahead(sched, ts, frac=0.5), ts),
        "look_ahead": to_x(shortcuts.look_ahead(sched, ts, frac=1.0), ts),
        "average_ahead": to_x(shortcuts.average_ahead(sched, ts), ts),
    }


def run(sched, with_fixed=True, keep_curves=False):
    ts, x_ex = exact_policy(sched)
    ex = score(x_ex, ts, sched)
    row = dict(name=sched.name, family=sched.family, **sched.params,
               exact=dict(reward=ex.reward, p=ex.p_correct, rt=ex.mean_rt))
    curves = {"exact": x_ex}
    for k, x in policies(sched, ts).items():
        o = score(x, ts, sched)
        row[k] = dict(loss=100 * (ex.reward - o.reward), p=o.p_correct, rt=o.mean_rt)
        curves[k] = x
    if with_fixed:
        xb, o = best_fixed(ts, sched)
        row["best_fixed"] = dict(loss=100 * (ex.reward - o.reward), x=xb, p=o.p_correct, rt=o.mean_rt)
    if keep_curves:
        sel = slice(None, None, 25)
        row["curves"] = {"t": ts[sel].round(3).tolist(),
                         **{k: np.minimum(v[sel], 8).round(4).tolist() for k, v in curves.items()}}
    return row
