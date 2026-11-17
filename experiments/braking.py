"""A toy braking decision: is the object ahead a real obstacle?

A car at speed v sees an ambiguous object at distance d and accumulates evidence (drift +-1,
noise variance 1 per second) about whether to brake. Deciding later means braking harder: the
deceleration needed to stop is v^2 / (2 (d - v t)). The cost of time is the rise in that
deceleration, as a fraction of the car's maximum, times kappa (what a full emergency stop costs
relative to a correct decision):
    c(t) = kappa * d/dt [a_needed(t) / a_max] = kappa * T_s / (T_max - t + T_s)^2,
with T_s = v / (2 a_max). At T_max = (d - v^2 / (2 a_max)) / v the car can no longer stop, so the
choice is forced there. Rewards are symmetric (1 for a correct choice), which is a simplification:
a missed obstacle is much worse than a needless stop.
Writes experiments/results/braking.json.
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import common  # noqa: E402
from speed_accuracy import shortcuts  # noqa: E402

A_MAX = 7.0  # m/s^2, hard braking on dry road


def scenario(v, d, kappa):
    t_s = v / (2 * A_MAX)
    t_max = (d - v * v / (2 * A_MAX)) / v
    s = common.Schedule(f"{v * 3.6:.0f} km/h, object at {d:.0f} m, kappa {kappa:g}",
                        lambda t: kappa * t_s / (t_max - np.minimum(t, t_max) + t_s) ** 2,
                        deadline=t_max, family="braking", v=v, d=d, kappa=kappa, t_max=t_max)
    return s


rows = []
for v in (15.0, 25.0, 33.0):
    for d in (40.0, 60.0, 90.0, 130.0):
        for kappa in (0.2, 0.5, 1.0):
            s = scenario(v, d, kappa)
            if s.params["t_max"] < 0.15:
                continue
            ts, x_ex = common.exact_policy(s)
            ex = common.score(x_ex, ts, s)
            row = dict(name=s.name, **s.params, exact_reward=ex.reward, exact_p=ex.p_correct, exact_rt=ex.mean_rt)
            for label, g in (("per_moment", shortcuts.per_moment(s, ts)),
                             ("weighted", shortcuts.weighted_bound(s, ts))):
                o = common.score(common.to_x(g, ts), ts, s)
                row[label] = 100 * (ex.reward - o.reward)
                row[label + "_p"] = o.p_correct
            xb, o = common.best_fixed(ts, s)
            row["best_fixed"] = 100 * (ex.reward - o.reward)
            rows.append(row)
            print(f"{s.name:40s} T_max {s.params['t_max']:4.2f}s  exact P {ex.p_correct:.3f} RT {ex.mean_rt:.2f}  "
                  f"per-moment {row['per_moment']:5.2f}  weighted {row['weighted']:5.2f}  best fixed {row['best_fixed']:5.2f}", flush=True)
(Path(__file__).parent / "results" / "braking.json").write_text(json.dumps(rows, indent=1))
