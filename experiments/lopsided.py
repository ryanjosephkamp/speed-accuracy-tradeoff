"""Lopsided stakes: one choice pays less than the other (r_plus = 1, r_minus < 1).

Two checks:
- first order: a sinusoidal cost c0 + eps sin(omega t). The exact policy's two bounds are fit with
  sinusoids and compared with the per-moment rule and with the first-order kernel at each bound.
- random schedules: smooth, step, and deadline costs (the same three kinds as
  `random_schedules.py`), scored exactly, for the per-moment rule and the weighted look-ahead.
Writes experiments/results/lopsided.json.

Usage: python experiments/lopsided.py [schedules per kind] [r_minus ...]
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

from speed_accuracy import lopsided as L

DT = 0.002
HORIZON = 10.0
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
N = int(ARGS[0]) if ARGS else 10
R_MINUS = [float(a) for a in ARGS[1:]] or [0.5, 0.25]
out = {"first_order": [], "random": []}


def fit(d, ts, om):
    A = np.c_[np.sin(om * ts), np.cos(om * ts), np.ones(len(ts))]
    a, b, _ = np.linalg.lstsq(A, d, rcond=None)[0]
    return float(np.hypot(a, b)), float(np.degrees(np.arctan2(b, a)))


# --- first order ---------------------------------------------------------------------------
c0, eps = 0.1, 0.01
for rm in R_MINUS:
    flat = lambda t: c0 + 0 * np.asarray(t)
    lo_c, hi_c = L.constant_bounds(c0, 1.0, rm)
    hs = 1e-5
    (lo_p, hi_p), (lo_m, hi_m) = L.constant_bounds(c0 + hs, 1.0, rm), L.constant_bounds(c0 - hs, 1.0, rm)
    d_lo, d_hi = (lo_p - lo_m) / (2 * hs), (hi_p - hi_m) / (2 * hs)
    for om in (0.5, 1.0, 2.0, 4.0, 8.0):
        # Whole periods from t = 2: at least two and at least 6 time units, 6 to spare.
        period = 2 * np.pi / om
        length = period * max(2, int(np.ceil(6 / period)))
        horizon = 2.0 + length + 6.0
        ts, lo0, hi0, _ = L.backward_induction(flat, horizon, 1.0, rm, dt=DT, h=0.0025)
        wavy = lambda t, om=om: c0 + eps * np.sin(om * np.asarray(t))
        _, lo1, hi1, _ = L.backward_induction(wavy, horizon, 1.0, rm, dt=DT, h=0.0025)
        sel = (ts > 2) & (ts < 2 + length)
        w_hi, w_lo = L.transfer(-1j * om, lo_c, hi_c)
        row = dict(r_minus=rm, omega=om)
        for side, ex, dB, w in (("hi", hi1 - hi0, d_hi, w_hi), ("lo", lo1 - lo0, d_lo, w_lo)):
            row[side] = dict(exact=fit(ex[sel], ts[sel], om),
                             per_moment=(abs(dB) * eps, 0.0 if dB > 0 else 180.0),
                             first_order=(float(abs(dB * w) * eps),
                                          float(np.degrees(np.angle(dB * w)))))
        out["first_order"].append(row)
        print(f"r-={rm} om={om}: hi exact {row['hi']['exact']} first-order {row['hi']['first_order']} | "
              f"lo exact {row['lo']['exact']} first-order {row['lo']['first_order']}", flush=True)


# --- random schedules ------------------------------------------------------------------------
class Sched:
    def __init__(self, fn, deadline=None):
        self.fn, self.deadline = fn, deadline

    def __call__(self, t):
        t = np.asarray(t, float)
        c = np.broadcast_to(np.asarray(self.fn(t), dtype=float), t.shape)
        return c if self.deadline is None else np.where(t <= self.deadline + 1e-12, c, np.inf)

    @property
    def horizon(self):
        return HORIZON if self.deadline is None else self.deadline


rng = np.random.default_rng(2027)


def smooth():
    c0 = float(np.exp(rng.uniform(np.log(0.02), np.log(0.5))))
    a, om, ph = rng.uniform(-1, 1, 3) / 1.5, rng.uniform(0.3, 6.0, 3), rng.uniform(0, 2 * np.pi, 3)
    return Sched(lambda t: c0 * np.exp(sum(a[j] * np.sin(om[j] * t + ph[j]) for j in range(3)))), dict(c0=c0)


def step():
    c0 = float(np.exp(rng.uniform(np.log(0.02), np.log(1.0))))
    r = float(np.exp(rng.uniform(-np.log(16), np.log(16))))
    t0 = float(rng.uniform(0.1, 2.0))
    return Sched(lambda t: c0 + (c0 * r - c0) / (1 + np.exp(-(t - t0) / 0.05))), dict(c0=c0, c1=c0 * r, t0=t0)


def deadline():
    c0 = float(np.exp(rng.uniform(np.log(0.01), np.log(0.5))))
    T = float(rng.uniform(0.3, 3.0))
    return Sched(lambda t: c0 + 0 * t, deadline=T), dict(c0=c0, T=T)


t_start = time.time()
if "--first-order-only" in sys.argv:  # keep the stored random-schedule results
    out["random"] = json.loads((Path(__file__).parent / "results" / "lopsided.json").read_text())["random"]
for rm in (() if "--first-order-only" in sys.argv else R_MINUS):
    for kind, make in (("smooth", smooth), ("step", step), ("deadline", deadline)):
        for i in range(N):
            s, params = make()
            cost = lambda t, s=s: np.minimum(s(t), 1e9)
            ts, lo_x, hi_x, _ = L.backward_induction(cost, s.horizon, 1.0, rm, dt=DT)
            ex = L.reward(lo_x, hi_x, ts, s, 1.0, rm).reward
            row = dict(r_minus=rm, kind=kind, **params, exact_reward=ex)
            for label, (lo, hi) in (("per_moment", L.per_moment(s, ts, 1.0, rm)),
                                    ("weighted", L.weighted_bound(s, ts, 1.0, rm))):
                lo, hi = L.discrete(lo, hi, DT)
                row[label] = 100 * (ex - L.reward(lo, hi, ts, s, 1.0, rm).reward)
            out["random"].append(row)
            print(f"r-={rm} {kind} {i}: per-moment {row['per_moment']:6.3f} weighted {row['weighted']:6.3f} "
                  f"({time.time() - t_start:.0f}s)", flush=True)

(Path(__file__).parent / "results" / "lopsided.json").write_text(json.dumps(out, indent=1))
for rm in R_MINUS:
    for kind in ("smooth", "step", "deadline"):
        rs = [r for r in out["random"] if r["r_minus"] == rm and r["kind"] == kind]
        pm = np.array([r["per_moment"] for r in rs])
        wb = np.array([r["weighted"] for r in rs])
        print(f"r-={rm} {kind:8s} per-moment median {np.median(pm):.3f} max {pm.max():.3f} | "
              f"weighted median {np.median(wb):.4f} max {wb.max():.3f} | "
              f"recovered {1 - wb.sum() / pm.sum():.3f}")
