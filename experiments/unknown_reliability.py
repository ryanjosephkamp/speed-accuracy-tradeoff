"""Unknown reliability: how much each cheap policy loses against the exact policy.

The drift mu ~ N(0, 1) is drawn once per trial. Policies:
- frozen_time: each moment's stationary answer (the 2025 approach, done right). In information
  time this is the per-moment shortcut; `info_time` has the closed form.
- weighted: the boundary-kernel average of the frozen-time bounds over future information time.
- plug_in: treat the drift magnitude as known and equal to its current estimate |X| / (t + 1),
  and use the known-reliability bound for that drift.
- best_fixed: the best constant evidence bound.
Writes experiments/results/unknown_reliability.json.
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
from scipy.optimize import brentq, minimize_scalar

from speed_accuracy import ddm, evaluate, info_time, unknown

DT = 0.005
HORIZON = 10.0
A = 1.0  # 1 / prior variance


def exact(cost, horizon, n):
    ts, gb = unknown.backward_induction(cost, horizon, prior_var=1 / A, n=n, dt=DT)
    return ts, unknown.evidence_bound(gb, ts, prior_var=1 / A)


def plug_in(cost, ts):
    """Smallest |X| at which the plug-in rule stops: t + a = B(c, (t + a)^2 / X^2), where B is the
    known-reliability bound for drift 1 and noise variance s2 (from X / m with m = |X| / (t + a))."""
    c = np.broadcast_to(np.asarray(cost(ts), float), ts.shape)
    out = np.empty(len(ts))
    for i, (t, ci) in enumerate(zip(ts, c)):
        if not np.isfinite(ci):
            out[i] = 0.0
            continue
        T = t + A
        f = lambda x: T - ddm.optimal_bound(ci, T * T / (x * x))
        lo, hi = 1e-6, 1.0
        while f(hi) < 0 and hi < 1e3:
            hi *= 2
        out[i] = brentq(f, lo, hi) if f(lo) < 0 < f(hi) else (0.0 if f(lo) >= 0 else hi)
    return out


def score(x, ts, cost):
    return evaluate.unknown_reward(x, ts, cost, prior_var=1 / A, cap=7.5, nodes=32)


def run(name, cost, horizon=HORIZON, n=300, fixed=True):
    t0 = time.time()
    ts, x_ex = exact(cost, horizon, n)
    ex = score(x_ex, ts, cost).reward
    row = dict(name=name, exact_reward=ex)
    pol = {
        "frozen_time": info_time.discrete(info_time.frozen_time(cost, ts, 1 / A), DT),
        "weighted": info_time.discrete(info_time.weighted_bound(cost, ts, 1 / A), DT),
        "plug_in": info_time.discrete(plug_in(cost, ts), DT),
    }
    for k, x in pol.items():
        o = score(x, ts, cost)
        row[k] = 100 * (ex - o.reward)
    if fixed:
        res = minimize_scalar(lambda xb: -score(np.full(len(ts), xb), ts, cost).reward,
                              bounds=(0.05, 4.0), method="bounded", options={"xatol": 0.005})
        row["best_fixed"] = 100 * (ex - score(np.full(len(ts), res.x), ts, cost).reward)
    sel = slice(None, None, 20)
    row["curves"] = {"t": ts[sel].round(3).tolist(), "exact": np.minimum(x_ex[sel], 10).round(4).tolist(),
                     **{k: np.minimum(v[sel], 10).round(4).tolist() for k, v in pol.items()}}
    print(f"{name:34s} " + "  ".join(f"{k} {row[k]:6.2f}" for k in ("frozen_time", "weighted", "plug_in", "best_fixed") if k in row)
          + f"   ({time.time() - t0:.0f}s)", flush=True)
    return row


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "grid":
        # how much the exact reference moves with the belief grid
        for n in (300, 600, 900):
            ts, x_ex = exact(lambda t: 0.1 + 0 * t, HORIZON, n)
            print(n, round(score(x_ex, ts, lambda t: 0.1 + 0 * t).reward, 5), np.round(x_ex[[0, 100, 200, 400]], 4))
        sys.exit()
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 300
    rows = []
    for c in (0.02, 0.05, 0.1, 0.2, 0.4):
        rows.append(run(f"constant {c:g}", lambda t, c=c: c + 0 * np.asarray(t), n=n))
    rows.append(run("flat 0.1, rising 0.8/s after 0.5 s", lambda t: 0.1 + 0.8 * np.maximum(np.asarray(t) - 0.5, 0), n=n))
    rows.append(run("deadline 1 s at cost 0.05", lambda t: np.where(np.asarray(t) <= 1.0 + 1e-12, 0.05, np.inf), horizon=1.0, n=n))
    rows.append(run("deadline 2 s at cost 0.02", lambda t: np.where(np.asarray(t) <= 2.0 + 1e-12, 0.02, np.inf), horizon=2.0, n=n))
    out = Path(__file__).parent / "results" / "unknown_reliability.json"
    out.write_text(json.dumps(rows, indent=1))
