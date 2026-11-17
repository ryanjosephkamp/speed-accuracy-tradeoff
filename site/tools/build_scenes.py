"""Writes site/data/scenes.json: the bound curves and losses for the page's own working examples
whose cost schedules are not among the paper's showcase schedules, computed with the paper's
package exactly as experiments/showcase.py computes those.

- keeper: a penalty kick. Every moment of doubt costs more as the kick nears (a later dive must be
  faster), c(t) = kappa * Ts / (T - t + Ts)^2 with kappa = 0.2, Ts = 0.2, and no dive reaches
  the corner once the ball is struck, so the choice is forced at T = 1.
- recorder: a solar field recorder names a bird by its song at first light. Listening costs less as
  the sun clears the ridge, c(t) = lo + (hi - lo) (1 - s(t)) with hi = 0.5, lo = 0.05, s a smoothstep
  from 0 at t = 0.1 to 1 at t = 0.6, and the choice is forced when the bird stops singing (T = 3).
- robot: a walking robot picks a side of a rock. Doubt costs most as each foot comes down,
  c(t) = c0 (1 + a cos(2 pi (t - t1) / P)) with c0 = 0.2, a = 0.8, P = 0.5, t1 = 0.25, and at the
  rock (T = 3) the choice is forced.

Run from the repository root:
    uv run python site/tools/build_scenes.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "experiments"))
import common  # noqa: E402
from speed_accuracy import shortcuts  # noqa: E402

KEEPER = {"kappa": 0.2, "ts": 0.2, "T": 1.0}
ROBOT = {"c0": 0.2, "a": 0.8, "P": 0.5, "t1": 0.25, "T": 3.0}
RECORDER = {"hi": 0.5, "lo": 0.05, "t0": 0.1, "t1": 0.6, "T": 3.0}


def keeper_schedule():
    k, ts, T = KEEPER["kappa"], KEEPER["ts"], KEEPER["T"]
    return common.Schedule("keeper", lambda t: k * ts / (T - np.minimum(t, T) + ts) ** 2, deadline=T,
                           family="keeper", **KEEPER)


def robot_schedule():
    c0, a, P, t1, T = (ROBOT[k] for k in ("c0", "a", "P", "t1", "T"))
    return common.Schedule("robot", lambda t: c0 * (1 + a * np.cos(2 * np.pi * (np.minimum(t, T) - t1) / P)),
                           deadline=T, family="robot", **ROBOT)


def recorder_schedule():
    hi, lo, t0, t1, T = (RECORDER[k] for k in ("hi", "lo", "t0", "t1", "T"))

    def cost(t):
        u = np.clip((np.minimum(t, T) - t0) / (t1 - t0), 0, 1)
        return lo + (hi - lo) * (1 - u * u * (3 - 2 * u))
    return common.Schedule("recorder", cost, deadline=T, family="recorder", **RECORDER)


def curves(title, s, until=2.5):
    ts, x_ex = common.exact_policy(s)
    pols = {"pm": common.to_x(shortcuts.per_moment(s, ts), ts),
            "wb": common.to_x(shortcuts.weighted_bound(s, ts), ts)}
    ex = common.score(x_ex, ts, s)
    idx = np.flatnonzero(ts <= min(s.horizon, until) + 1e-9)[::10]
    clip = lambda a: [round(float(v), 4) for v in np.minimum(a[idx], 4)]
    out = {"title": title, "t": [round(float(t), 3) for t in ts[idx]],
           "cost": [round(float(c), 4) for c in np.minimum(s(ts[idx]), 99)],
           "exact": clip(x_ex), "pm": clip(pols["pm"]), "wb": clip(pols["wb"]),
           "loss": {k: round(100 * (ex.reward - common.score(v, ts, s).reward), 3) for k, v in pols.items()},
           "reward": round(100 * ex.reward, 3), "params": s.params}
    print(title, out["loss"], "exact reward", out["reward"], flush=True)
    return out


def main():
    data = {"keeper": curves("A dive gets harder as the kick nears", keeper_schedule()),
            "robot": curves("Doubt peaks at each footfall", robot_schedule(), until=3.0),
            "recorder": curves("Listening gets cheaper at sunrise", recorder_schedule(), until=3.0)}
    path = ROOT / "site" / "data" / "scenes.json"
    path.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
