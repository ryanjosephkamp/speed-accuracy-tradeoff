"""Writes the held-out schedules for the page and the Python reference values for the checks.

- site/data/heldout.json: the 210 held-out schedules as their family's formula and parameters
  (regenerated from experiments/families.py with the held-out seed), with the losses the paper
  reports for each. The page redraws any of them and recomputes its losses in the browser.
- site/tools/reference.json: values from the Python package (src/speed_accuracy) that
  site/tools/check_site.mjs compares the browser code against: the closed-form bound, accuracy,
  and mean time; the boundary kernel's mean and median; the kernel's transfer function in closed
  form; and the cost of each held-out schedule at a few probe times.

Run from the repository root:
    uv run python site/tools/build_reference.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "experiments"))
import families  # noqa: E402
from speed_accuracy import ddm, shortcuts  # noqa: E402

RESULTS = ROOT / "experiments" / "results"
OUT_DATA = ROOT / "site" / "data" / "heldout.json"
OUT_REF = ROOT / "site" / "tools" / "reference.json"
PROBES = [0.0, 0.137, 0.5, 0.91, 1.5, 2.333, 3.7, 6.0, 9.5]


def closure(fn):
    """The variables a schedule's cost function closes over, by name."""
    return {name: cell.cell_contents for name, cell in zip(fn.__code__.co_freevars, fn.__closure__ or ())}


def as_list(v):
    return [float(x) for x in np.asarray(v, float).ravel()]


def params(s):
    """The exact parameters of a held-out schedule, in the form site/js/heldout.js evaluates."""
    fam = s.family
    if fam == "smooth":
        v = closure(s.fn)
        return {"c0": float(v["c0"]), "a": as_list(v["a"]), "om": as_list(v["om"]), "ph": as_list(v["ph"])}
    if fam == "step":
        return {"c0": s.params["c0"], "c1": s.params["c1"], "t0": s.params["t0"]}
    if fam == "deadline":
        return {"c0": s.params["c0"], "T": s.params["T"]}
    if fam in ("pulse", "ramp"):
        return {k: float(v) for k, v in s.params.items()}
    if fam == "multi-step":
        v = closure(s.fn)
        return {"c0": float(v["c0"]), "times": as_list(v["times"]), "jumps": as_list(v["jumps"])}
    if fam == "piecewise":
        v = closure(s.fn)
        return {"levels": as_list(v["levels"]), "cuts": as_list(v["cuts"])}
    raise ValueError(fam)


def held_out():
    stored = json.loads((RESULTS / "held_out.json").read_text())
    scheds = families.held_out_set()
    assert len(scheds) == len(stored) == 210
    rows, probes = [], []
    for s, r in zip(scheds, stored):
        assert s.name == r["name"], (s.name, r["name"])
        rows.append({"family": s.family, "name": s.name, "p": params(s), "horizon": s.horizon,
                     "loss": [r["per_moment"]["loss"], r["weighted"]["loss"]]})
        ts = np.array([t for t in PROBES if t <= s.horizon])
        probes.append([[float(t), float(c)] for t, c in zip(ts, s(ts))])
    return rows, probes


def transfer_closed_form(c0, omega):
    """The kernel's transform at s = -i omega, from the paper's closed form
    w(s) = 2 c0 cosh^2(b0) [q tanh(q b0) - tanh(b0)] / s, q = sqrt(2 s + 1)."""
    b0 = float(shortcuts.bound_for_cost(c0))
    s = -1j * omega
    q = np.sqrt(2 * s + 1)
    W = 2 * c0 * np.cosh(b0) ** 2 * (q * np.tanh(q * b0) - np.tanh(b0)) / s
    return float(abs(W)), float(np.degrees(np.angle(W)))


def reference(probes):
    costs = [1e-4, 0.003, 0.02, 0.05, 0.1, 0.19, 0.3, 0.6, 1.0, 2.5, 10.0]
    closed = []
    for c in costs:
        x = ddm.optimal_bound(c)
        closed.append({"c": c, "bound": x, "table": float(shortcuts.bound_for_cost(c)),
                       "p": float(ddm.p_correct(x)), "rt": float(ddm.mean_decision_time(x))})
    kernels = []
    for b in [0.05, 0.2, 0.5, 0.95, 1.4, 2.0, 3.0]:
        s, w = shortcuts.boundary_kernel(b)
        cdf = np.cumsum(w)
        j = int(np.searchsorted(cdf, 0.5))
        # the bin edges boundary_kernel uses, to interpolate the median within its bin
        lam_slow = 0.5 * ((np.pi / (2 * b)) ** 2 + 1)
        edges = np.concatenate([[0.0], np.geomspace(1e-5, 14.0 / lam_slow, len(w))])
        before = cdf[j - 1] if j else 0.0
        median = edges[j] + (0.5 - before) / w[j] * (edges[j + 1] - edges[j])
        kernels.append({"b": b, "mean": float(w @ s), "median": float(s[j]), "medianInterp": float(median),
                        "c": float(1 / (np.sinh(2 * b) + 2 * b))})
    look = []
    for c in [0.02, 0.05, 0.1, 0.19, 0.4]:
        b = float(shortcuts.bound_for_cost(c))
        look.append({"c": c, "closed": c * (np.sinh(2 * b) / 2 - b + 2 * b * b * np.tanh(b)),
                     "kernel": shortcuts.look_ahead_time(c)})
    transfer = [{"c0": 0.1, "omega": om, "gain": g, "lead": ld}
                for om in [0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0]
                for g, ld in [transfer_closed_form(0.1, om)]]
    return {"closed": closed, "kernels": kernels, "lookAhead": look, "transfer": transfer, "probes": probes}


def main():
    rows, probes = held_out()
    OUT_DATA.write_text(json.dumps(rows, separators=(",", ":")) + "\n")
    OUT_REF.write_text(json.dumps(reference(probes), indent=1) + "\n")
    for p in (OUT_DATA, OUT_REF):
        print(f"wrote {p.relative_to(ROOT)} ({p.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
