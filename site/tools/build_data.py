"""Writes site/data/site-data.json from the stored results and the paper's generated numbers, so
every number on the site comes from the same place as the paper's.

Run from the repository root after the experiments and paper/make_figures.py:
    python site/tools/build_data.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "experiments" / "results"
NUMBERS = ROOT / "paper" / "generated" / "numbers.tex"
OUT = ROOT / "site" / "data" / "site-data.json"

GROUP = {"smooth": "smooth", "pulse": "smooth", "ramp": "smooth",
         "step": "jump", "multi-step": "jump", "piecewise": "jump", "deadline": "deadline"}


def load(name):
    return json.loads((RESULTS / f"{name}.json").read_text())


def numbers():
    """The paper's macros whose names start with the given prefixes."""
    keep = ("Held", "Sweep", "Palmer", "Unknown", "ClosedForm")
    out = {}
    for name, value in re.findall(r"\\newcommand\{\\(\w+)\}\{([^}]*)\}", NUMBERS.read_text()):
        if name.startswith(keep):
            out[name] = value
    return out


def held_out():
    rows = []
    for r in load("held_out"):
        rows.append([r["family"], GROUP[r["family"]], r["name"], round(r["per_moment"]["loss"], 5),
                     round(r["weighted"]["loss"], 6)])
    return rows


def first_order():
    """Swing (relative to the per-moment swing) and lead in degrees for the exact bound and the
    weighted rule, from the sinusoid fits (the per-moment fit sits at a phase of 180 degrees)."""
    rows = []
    for r in load("showcase")["first_order"]:
        pm_amp, pm_phase = r["per_moment"]
        def rel(fit):
            lead = (fit[1] - pm_phase + 180) % 360 - 180
            return [round(fit[0] / pm_amp, 4), round(lead, 2)]
        rows.append({"omega": r["omega"], "exact": rel(r["exact"]), "weighted": rel(r["weighted"])})
    return rows


def unknown():
    rows = []
    for u in load("unknown_reliability"):
        name = u["name"]
        m = re.match(r"constant ([\d.]+)$", name)
        if m:
            text = f"Constant cost {m.group(1)}"
        elif name.startswith("flat"):
            m = re.match(r"flat ([\d.]+), rising ([\d.]+)/s after ([\d.]+) s$", name)
            text = f"{m.group(1)}, then rising {m.group(2)} per unit time after t = {m.group(3)}"
        else:
            m = re.match(r"deadline ([\d.]+) s at cost ([\d.]+)$", name)
            text = f"Cost {m.group(2)}, deadline at t = {m.group(1)}"
        rows.append([text] + [round(u[k], 3) for k in ("frozen_time", "weighted", "plug_in", "best_fixed")])
    return rows


def showcase():
    """The four showcase schedules, every other sample: time, cost, and the three bounds (exact,
    per-moment, weighted look-ahead) in the paper's units, with each rule's loss."""
    out = []
    for r in load("showcase")["schedules"]:
        pick = lambda xs: [None if x is None or x != x or x == float("inf") else round(x, 4) for x in xs[::2]]
        out.append({"title": r["title"], "t": pick(r["t"]), "cost": pick(r["cost"]), "exact": pick(r["exact"]),
                    "pm": pick(r["per_moment"]), "wb": pick(r["weighted"]),
                    "loss": {"pm": r["loss"]["per_moment"], "wb": r["loss"]["weighted"]}})
    return out


def scenes():
    """The working examples' own schedules (site/tools/build_scenes.py writes them with the paper's
    package), in the showcase's shape, after the four showcase schedules."""
    data = json.loads((ROOT / "site" / "data" / "scenes.json").read_text())
    return [{"title": r["title"], "t": r["t"], "cost": r["cost"], "exact": r["exact"], "pm": r["pm"], "wb": r["wb"],
             "loss": r["loss"]} for r in data.values()]


def main():
    data = {"numbers": numbers(), "held": held_out(), "firstOrder": first_order(), "unknown": unknown(),
            "showcase": showcase() + scenes()}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
