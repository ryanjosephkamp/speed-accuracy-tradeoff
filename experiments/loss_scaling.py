"""How each rule's loss scales with the size of a smooth cost change.

One fixed smooth shape, scaled in log c around c0 = 0.2 (short decisions, so the forced choice at
t = 10 hardly matters): c(t) = c0 exp(a f(t)) for amplitudes a from 0.05 to 0.8. The per-moment
rule misses the optimal bound by order a, so it should lose order a^2. The weighted rule misses by
order a^2 for a smooth change, so it should lose much less, and its loss should fall much faster
as a shrinks. The losses are scored on the paper's grid and again on one twice as fine in time and
space, so the table can show which of the weighted rule's small losses the grid resolves. The
constant-cost loss is recorded as the floor that comes from the grid and the horizon alone.
Writes experiments/results/loss_scaling.json.
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import common  # noqa: E402
from speed_accuracy import ddm, evaluate, known, shortcuts  # noqa: E402

C0 = 0.2


def shape(t):
    t = np.asarray(t, float)
    return 0.6 * np.sin(1.3 * t + 0.4) + 0.5 * np.sin(3.1 * t + 2.0) + 0.4 * np.sin(5.2 * t + 4.0)


GRIDS = {"paper": (common.DT, 0.005), "fine": (common.DT / 2, 0.0025)}


def losses(s, dt, h):
    """Each rule's loss against the exact policy, both scored on the evidence grid (dt, h)."""
    cost = lambda t: np.minimum(s(t), 1e9)  # noqa: E731
    ts, x_ex, _ = known.backward_induction_x(cost, s.horizon, dt=dt, h=h)
    ex = evaluate.known_reward(x_ex, ts, s, h=h).reward
    out = {}
    for label, g in (("per_moment", shortcuts.per_moment(s, ts)),
                     ("weighted", shortcuts.weighted_bound(s, ts))):
        x = shortcuts.discrete(ddm.evidence(np.clip(g, 0.5, 1 - 1e-12)), dt)
        out[label] = 100 * (ex - evaluate.known_reward(x, ts, s, h=h).reward)
    return out


def both(s):
    return {grid: losses(s, dt, h) for grid, (dt, h) in GRIDS.items()}


floor = both(common.Schedule("constant", lambda t: C0 + 0 * np.asarray(t, float)))
rows = []
for a in (0.05, 0.1, 0.2, 0.4, 0.8):
    row = dict(amplitude=a, **both(common.Schedule(f"a={a}", lambda t, a=a: C0 * np.exp(a * shape(t)))))
    rows.append(row)
    print(f"a = {a:4.2f}: per-moment {row['paper']['per_moment']:.6f} / {row['fine']['per_moment']:.6f}, "
          f"weighted {row['paper']['weighted']:.3e} / {row['fine']['weighted']:.3e}", flush=True)

out = dict(cost=C0, grids={k: dict(dt=v[0], h=v[1]) for k, v in GRIDS.items()}, shape="0.6 sin(1.3t + 0.4) + 0.5 sin(3.1t + 2.0) + 0.4 sin(5.2t + 4.0)",
           floor=floor, rows=rows)
(Path(__file__).parent / "results" / "loss_scaling.json").write_text(json.dumps(out, indent=1))
