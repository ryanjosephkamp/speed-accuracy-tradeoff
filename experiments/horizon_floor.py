"""The finite-horizon floor: what the forced choice at t = 10 costs a rule that ignores it.

Schedules without a deadline end with a forced choice at t = 10, which the rules don't know about.
At a constant cost the per-moment and weighted rules both give the constant-cost bound, so their
loss against the exact policy for that horizon is a floor that comes from the horizon alone.
Writes experiments/results/horizon_floor.json.
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import common  # noqa: E402
from speed_accuracy import evaluate, shortcuts  # noqa: E402

rows = []
for c in (0.02, 0.05, 0.1):
    s = common.Schedule(f"constant {c}", lambda t, c=c: c + 0 * np.asarray(t, float))
    ts, x_ex = common.exact_policy(s)
    ex = common.score(x_ex, ts, s).reward
    row = dict(cost=c, horizon=float(ts[-1]))
    for label, g in (("per_moment", shortcuts.per_moment(s, ts)),
                     ("weighted", shortcuts.weighted_bound(s, ts))):
        x = common.to_x(g, ts)
        f = evaluate.known_decision_times(x, ts)
        row[label] = dict(loss=100 * (ex - common.score(x, ts, s).reward), undecided=float(f[-1]))
    rows.append(row)
    print(f"cost {c}: loss {row['per_moment']['loss']:.4f} (per-moment), "
          f"{row['weighted']['loss']:.4f} (weighted); undecided at t = {ts[-1]:g}: "
          f"{row['per_moment']['undecided']:.5f}", flush=True)

(Path(__file__).parent / "results" / "horizon_floor.json").write_text(json.dumps(rows, indent=1))
