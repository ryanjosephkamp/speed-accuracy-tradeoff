"""The schedule families: the development set must match the stored results, and the held-out set
must be fixed by its seed."""
import json
import sys
from pathlib import Path

import numpy as np

EXP = Path(__file__).resolve().parent.parent / "experiments"
sys.path.insert(0, str(EXP))
import families  # noqa: E402


def test_development_set_matches_stored_results():
    stored = json.loads((EXP / "results" / "random_schedules.json").read_text())
    dev = families.development_set()
    assert len(dev) == len(stored) == 90
    for s, r in zip(dev, stored):
        assert s.family == r["kind"]
        assert s.params["c0"] == r["c0"]


def test_held_out_set_is_fixed_and_well_formed():
    a, b = families.held_out_set(), families.held_out_set()
    assert len(a) == 7 * families.PER_FAMILY
    ts = np.linspace(0, 10, 2001)
    for s, t in zip(a, b):
        assert s.name == t.name
        assert np.array_equal(s(ts), t(ts))
        c = s(ts[ts <= s.horizon])
        assert np.all(np.isfinite(c)) and np.all(c > 0)


def test_held_out_families_do_not_depend_on_each_other():
    """Each family has its own random stream, so asking for fewer schedules keeps the first ones."""
    few, full = families.held_out_set(3), families.held_out_set()
    names = {s.name for s in full}
    assert all(s.name in names for s in few)
