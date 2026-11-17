"""The held-out evaluation: seven families of random schedules (see `families.py`), scored once.

For each schedule this scores the exact policy and seven cheap ones:
- per_moment: the constant-cost bound for the current cost;
- weighted: the weighted look-ahead rule as in the paper (30 damped self-consistent updates);
- weighted_one_pass: the same average with the kernel for the per-moment bound, no iteration;
- averaged_cost: the per-moment bound for the kernel-weighted average of the future cost;
- shift_mean: the per-moment bound for the cost at t + m(c(t)), m the closed-form mean look-ahead;
- shift_half: the per-moment bound for the cost at t + 0.5;
- best_constant: the best single bound for the schedule, tuned with the scorer itself (an
  oracle, not a usable rule).
Each gets its loss in points per 100 trials, its accuracy, its mean decision time, and its
largest bound error before t = 4 (or the deadline). Writes experiments/results/held_out.json
after every schedule. An optional argument limits the number of schedules per family.
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
from scipy.optimize import brentq

sys.path.insert(0, str(Path(__file__).parent))
import common  # noqa: E402
import families  # noqa: E402
from speed_accuracy import shortcuts  # noqa: E402

N = int(sys.argv[1]) if len(sys.argv) > 1 else families.PER_FAMILY
OUT = Path(__file__).parent / "results" / "held_out.json"


def _bound(c):
    return brentq(lambda b: np.sinh(2 * b) + 2 * b - 1 / c, 1e-12, 60)


_LC = np.linspace(np.log(1e-5), np.log(1e4), 600)
_M = np.array([(lambda c, b: c * (np.sinh(2 * b) / 2 - b + 2 * b * b * np.tanh(b)))(np.exp(l), _bound(np.exp(l)))
               for l in _LC])


def mean_look_ahead(c):
    """Closed-form mean look-ahead m(c); 0 where the cost is infinite (past a deadline)."""
    c = np.asarray(c, float)
    return np.where(np.isinf(c), 0.0, np.interp(np.log(np.clip(c, 1e-5, 1e4)), _LC, _M))


def cheap_policies(s, ts):
    c = s(ts)
    return {
        "per_moment": shortcuts.per_moment(s, ts),
        "weighted": shortcuts.weighted_bound(s, ts),
        "weighted_one_pass": shortcuts.weighted_bound(s, ts, self_consistent=False),
        "averaged_cost": shortcuts.weighted_ahead(s, ts),
        "shift_mean": shortcuts.per_moment(s, ts + mean_look_ahead(c)),
        "shift_half": shortcuts.per_moment(s, ts + 0.5),
    }


def outcome(x, x_ex, ts, s, ex):
    o = common.score(x, ts, s)
    early = ts < min(s.horizon, 4)
    return dict(loss=100 * (ex.reward - o.reward), p=o.p_correct, rt=o.mean_rt,
                max_dx=float(np.max(np.abs(np.minimum(x, 4) - np.minimum(x_ex, 4))[early])))


rows = []
t_start = time.time()
schedules = [s for k, (fam, _) in enumerate(families.HELD_OUT_FAMILIES)
             for s in families.held_out_set()[k * families.PER_FAMILY:k * families.PER_FAMILY + N]]
for s in schedules:
    t0 = time.time()
    ts, x_ex = common.exact_policy(s)
    ex = common.score(x_ex, ts, s)
    row = dict(family=s.family, name=s.name, params=s.params,
               exact=dict(reward=ex.reward, p=ex.p_correct, rt=ex.mean_rt))
    for k, g in cheap_policies(s, ts).items():
        row[k] = outcome(common.to_x(g, ts), x_ex, ts, s, ex)
    xb, o = common.best_fixed(ts, s)
    row["best_constant"] = outcome(np.full(len(ts), xb), x_ex, ts, s, ex) | dict(x=xb)
    rows.append(row)
    OUT.write_text(json.dumps(rows, indent=1))
    print(f"{s.name[:46]:46s} per-moment {row['per_moment']['loss']:7.3f}  weighted {row['weighted']['loss']:7.4f}  "
          f"({time.time() - t0:.0f}s)", flush=True)
print(f"total {time.time() - t_start:.0f}s")
