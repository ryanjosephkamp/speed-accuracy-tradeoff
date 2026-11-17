"""Random cost schedules: how much reward each cheap policy loses against the exact policy.

Three kinds, 30 of each, from a fixed seed:
- smooth: log c(t) = log c0 + a sum of three random sinusoids (each up to a factor of e),
- steps: a jump up or down by up to 16x at a random time, smoothed over 0.05 s,
- deadlines: a constant cost and a hard deadline at a random time.
Writes experiments/results/random_schedules.json.
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import common  # noqa: E402
from speed_accuracy import shortcuts  # noqa: E402

rng = np.random.default_rng(2026)
N = int(sys.argv[1]) if len(sys.argv) > 1 else 30


def smooth(i):
    c0 = float(np.exp(rng.uniform(np.log(0.02), np.log(0.5))))
    a = rng.uniform(-1, 1, 3) / 1.5
    om = rng.uniform(0.3, 6.0, 3)
    ph = rng.uniform(0, 2 * np.pi, 3)
    f = lambda t: c0 * np.exp(sum(a[j] * np.sin(om[j] * t + ph[j]) for j in range(3)))
    return common.Schedule(f"smooth {i}", f, family="smooth", c0=c0)


def step_(i):
    c0 = float(np.exp(rng.uniform(np.log(0.02), np.log(1.0))))
    r = float(np.exp(rng.uniform(-np.log(16), np.log(16))))
    t0 = float(rng.uniform(0.1, 2.0))
    s = common.step(c0, c0 * r, t0)
    s.name = f"step {i}: {c0:.3f} to {c0 * r:.3f} at {t0:.2f} s"
    return s


def deadline_(i):
    c0 = float(np.exp(rng.uniform(np.log(0.01), np.log(0.5))))
    T = float(rng.uniform(0.3, 3.0))
    return common.deadline(c0, T)


rows = []
t_start = time.time()
for kind, make in (("smooth", smooth), ("step", step_), ("deadline", deadline_)):
    for i in range(N):
        s = make(i)
        ts, x_ex = common.exact_policy(s)
        ex = common.score(x_ex, ts, s).reward
        row = dict(kind=kind, name=s.name, exact_reward=ex, **s.params)
        for label, g in (("per_moment", shortcuts.per_moment(s, ts)),
                         ("weighted_bound", shortcuts.weighted_bound(s, ts, self_consistent=True))):
            x = common.to_x(g, ts)
            row[label] = 100 * (ex - common.score(x, ts, s).reward)
            row[label + "_max_dx"] = float(np.max(np.abs(np.minimum(x, 4) - np.minimum(x_ex, 4))[ts < min(s.horizon, 4)]))
        rows.append(row)
        print(f"{s.name[:44]:44s} per-moment {row['per_moment']:6.2f}  weighted {row['weighted_bound']:6.2f}", flush=True)
print(f"{time.time() - t_start:.0f}s")
out = Path(__file__).parent / "results" / "random_schedules.json"
out.write_text(json.dumps(rows, indent=1))
for kind in ("smooth", "step", "deadline"):
    pm = np.array([r["per_moment"] for r in rows if r["kind"] == kind])
    wb = np.array([r["weighted_bound"] for r in rows if r["kind"] == kind])
    print(f"{kind:9s} per-moment median {np.median(pm):.2f} max {pm.max():.2f} | weighted median {np.median(wb):.3f} max {wb.max():.2f} | "
          f"recovered (where per-moment lost >=0.5): {np.median(1 - wb[pm >= 0.5] / pm[pm >= 0.5]) if (pm >= 0.5).any() else float('nan'):.3f}")
