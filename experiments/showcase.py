"""Bound curves for a few schedules, and the first-order check, for the write-up's figures.
Writes experiments/results/showcase.json."""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import common  # noqa: E402
from speed_accuracy import ddm, known, shortcuts  # noqa: E402

out = {"schedules": [], "first_order": []}
cases = [
    ("Cost jumps 16x at 0.5 s", common.step(0.1, 1.6, 0.5)),
    ("Cost falls from 0.4 to 0.05 at 0.3 s", common.step(0.4, 0.05, 0.3)),
    ("Flat, then rising after 0.5 s", common.Schedule("flat then rising", lambda t: 0.1 + 0.8 * np.maximum(np.asarray(t) - 0.5, 0))),
    ("Hard deadline at 1 s", common.deadline(0.1, 1.0)),
]
for title, s in cases:
    ts, x_ex = common.exact_policy(s)
    pols = {"per_moment": common.to_x(shortcuts.per_moment(s, ts), ts),
            "weighted": common.to_x(shortcuts.weighted_bound(s, ts), ts)}
    ex = common.score(x_ex, ts, s).reward
    sel = (ts <= min(s.horizon, 2.5) + 1e-9)
    idx = np.flatnonzero(sel)[::5]
    out["schedules"].append(dict(
        title=title, t=ts[idx].round(3).tolist(), cost=np.minimum(s(ts[idx]), 99).round(4).tolist(),
        exact=np.minimum(x_ex[idx], 4).round(4).tolist(),
        **{k: np.minimum(v[idx], 4).round(4).tolist() for k, v in pols.items()},
        loss={k: round(100 * (ex - common.score(v, ts, s).reward), 3) for k, v in pols.items()},
    ))
    print(title, out["schedules"][-1]["loss"], flush=True)

c0, eps = 0.1, 0.01
flat = lambda t: c0 + 0 * np.asarray(t)
for om in (0.5, 1.0, 2.0, 4.0, 8.0):
    # Fit over whole periods: at least two, and at least 6 time units, starting at t = 2, with 6
    # time units to spare before the horizon.
    period = 2 * np.pi / om
    length = period * max(2, int(np.ceil(6 / period)))
    horizon = 2.0 + length + 6.0
    ts0, g0 = known.backward_induction(flat, horizon, n=800)
    f = lambda t, om=om: c0 + eps * np.sin(om * np.asarray(t))
    ts, g1 = known.backward_induction(f, horizon, n=800)
    sel = (ts > 2) & (ts < 2 + length)
    base = ddm.evidence(shortcuts.per_moment(flat, ts[sel]))

    def fit(d):
        A = np.c_[np.sin(om * ts[sel]), np.cos(om * ts[sel]), np.ones(sel.sum())]
        a, b, _ = np.linalg.lstsq(A, d, rcond=None)[0]
        return float(np.hypot(a, b)), float(np.degrees(np.arctan2(b, a)))

    row = dict(omega=om, window=[2.0, 2.0 + length],
               exact=fit(ddm.evidence(g1[sel]) - ddm.evidence(g0[sel])),
               per_moment=fit(ddm.evidence(shortcuts.per_moment(f, ts[sel])) - base),
               weighted=fit(ddm.evidence(shortcuts.weighted_bound(f, ts)[sel]) - base),
               averaged_cost=fit(ddm.evidence(shortcuts.weighted_ahead(f, ts[sel])) - base))
    out["first_order"].append(row)
    print(row, flush=True)
(Path(__file__).parent / "results" / "showcase.json").write_text(json.dumps(out))
