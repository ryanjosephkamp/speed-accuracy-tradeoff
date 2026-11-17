"""Second-order loss: a policy whose bound misses the optimum by eta(t) loses about
E[c(tau) eta(tau)^2] of reward, where tau is its decision time. (Near the bound, the value
exceeds the reward for deciding by c (b - x)^2, and a bound set too wide wastes time in a band
of width eta, about eta^2.) This compares the prediction with the exact loss for the per-moment
and weighted rules, on smooth and step schedules of growing size.

The sum leaves out the last grid time. There the scorer forces every undecided trial to choose,
whatever either bound says, so a gap between the bounds at that time costs nothing. The term
it would add is stored as `forced` so the difference stays visible.
Writes experiments/results/loss_formula.json.
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import common  # noqa: E402
from speed_accuracy import evaluate, shortcuts  # noqa: E402

rng = np.random.default_rng(7)
rows = []


def check(kind, size, s):
    ts, x_ex = common.exact_policy(s)
    ex = common.score(x_ex, ts, s).reward
    row = dict(kind=kind, size=size)
    for label, g in (("per_moment", shortcuts.per_moment(s, ts)),
                     ("weighted", shortcuts.weighted_bound(s, ts))):
        x = common.to_x(g, ts)
        loss = 100 * (ex - common.score(x, ts, s).reward)
        f = evaluate.known_decision_times(x, ts)
        eta = np.minimum(x, 6) - np.minimum(x_ex, 6)
        term = 100 * f * np.minimum(s(ts), 1e3) * eta ** 2
        row[label] = dict(loss=loss, predicted=float(term[:-1].sum()), forced=float(term[-1]),
                          late=float(term[:-1][ts[:-1] > 8].sum()))
    rows.append(row)
    print(f"{kind:6s} size {size:5.2f}: per-moment loss {row['per_moment']['loss']:.4f} "
          f"pred {row['per_moment']['predicted']:.4f} | weighted loss {row['weighted']['loss']:.5f} "
          f"pred {row['weighted']['predicted']:.5f}", flush=True)


for size in (0.25, 0.5, 1.0):
    for i in range(6):
        c0 = float(np.exp(rng.uniform(np.log(0.03), np.log(0.3))))
        a, om, ph = size * rng.uniform(-1, 1, 3) / 1.5, rng.uniform(0.3, 6.0, 3), rng.uniform(0, 2 * np.pi, 3)
        check("smooth", size, common.Schedule("s", lambda t, c0=c0, a=a, om=om, ph=ph:
                                              c0 * np.exp(sum(a[j] * np.sin(om[j] * t + ph[j]) for j in range(3)))))
for ratio in (1.5, 3.0, 16.0):
    for i in range(6):
        c0 = float(np.exp(rng.uniform(np.log(0.03), np.log(0.3))))
        r = ratio if i % 2 == 0 else 1 / ratio
        check("step", ratio, common.step(c0, c0 * r, float(rng.uniform(0.2, 1.5))))
(Path(__file__).parent / "results" / "loss_formula.json").write_text(json.dumps(rows, indent=1))
for kind, sizes in (("smooth", (0.25, 0.5, 1.0)), ("step", (1.5, 3.0, 16.0))):
    for size in sizes:
        rs = [r for r in rows if r["kind"] == kind and r["size"] == size]
        for lab in ("per_moment", "weighted"):
            L = np.array([r[lab]["loss"] for r in rs]); P = np.array([r[lab]["predicted"] for r in rs])
            print(f"{kind} {size}: {lab:10s} total loss {L.sum():.4f} predicted {P.sum():.4f} ratio {P.sum() / L.sum():.3f}")
