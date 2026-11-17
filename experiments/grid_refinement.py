"""Discretization check: losses on eight development schedules at four grid resolutions, and how
far the weighted rule's 30 damped updates are from a fixed point.

Grids (time step, evidence step): (0.004, 0.007), (0.002, 0.005) as in the paper, (0.001,
0.0035), and (0.0005, 0.0025). The exact policy is recomputed on each grid. Writes
experiments/results/grid_refinement.json.
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import families  # noqa: E402
from speed_accuracy import ddm, evaluate, known, shortcuts  # noqa: E402

GRIDS = ((0.004, 0.007), (0.002, 0.005), (0.001, 0.0035), (0.0005, 0.0025))
dev = families.development_set()
PICK = {"smooth 1": dev[1], "smooth 4": dev[4], "smooth 9": dev[9], "step 1": dev[31],
        "step 10": dev[40], "step 17": dev[47], "deadline 5": dev[65], "deadline 12": dev[72]}


def losses(s, dt, h, iterations=30):
    ts, xb, _ = known.backward_induction_x(lambda t: np.minimum(s(t), 1e9), s.horizon, dt=dt, h=h)
    ex = evaluate.known_reward(xb, ts, s, h=h).reward
    gw = shortcuts.weighted_bound(s, ts, iterations=iterations)
    out = {}
    for name, g in (("per_moment", shortcuts.per_moment(s, ts)), ("weighted", gw)):
        x = shortcuts.discrete(ddm.evidence(np.clip(g, 0.5, 1 - 1e-12)), dt)
        out[name] = 100 * (ex - evaluate.known_reward(x, ts, s, h=h).reward)
    return ex, out, ts, ddm.evidence(np.clip(gw, 0.5, 1 - 1e-12))


rows = []
for name, s in PICK.items():
    row = dict(name=name, schedule=s.name, grids=[])
    for dt, h in GRIDS:
        ex, o, _, _ = losses(s, dt, h)
        row["grids"].append(dict(dt=dt, h=h, exact=ex, **o))
    _, o30, ts, b30 = losses(s, 0.002, 0.005, 30)
    _, _, _, b31 = losses(s, 0.002, 0.005, 31)
    _, o300, _, b300 = losses(s, 0.002, 0.005, 300)
    early = ts < min(s.horizon, 6)
    row.update(residual=float(2 * np.max(np.abs(b31 - b30)[early])),
               move_300=float(np.max(np.abs(b300 - b30)[early])),
               weighted_300=o300["weighted"], weighted_30=o30["weighted"])
    rows.append(row)
    print(row, flush=True)
(Path(__file__).parent / "results" / "grid_refinement.json").write_text(json.dumps(rows, indent=1))
