"""The closed forms in `paper/make_figures.py`, checked against the paper's own statements.

The figures and every number quoted from the closed forms (the mean look-ahead, its maximum, the
transfer function, the worked example in physical units) come from five functions in
`make_figures.py`. That script draws everything when run, so this loads only those function
definitions from its source and checks them against independent forms:
- `bound` against `ddm.optimal_bound`;
- `kernel` against the positive cosine series for the survival flux;
- `transfer` against the Laplace transform of that series, term by term;
- `mean_look_ahead` against the series' mean and the paper's second form;
- the transfer function's signs and its high-frequency limit (gain like omega^-1/2, lead 45 degrees).
"""
import ast
from pathlib import Path

import numpy as np
import pytest
from scipy.optimize import brentq

from speed_accuracy import ddm

SOURCE = Path(__file__).resolve().parents[1] / "paper" / "make_figures.py"
WANTED = {"bound", "transfer", "mean_look_ahead", "mean_decision_time", "kernel"}
COSTS = [0.02, 0.1, 0.3]


def _load():
    tree = ast.parse(SOURCE.read_text())
    defs = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in WANTED]
    assert {d.name for d in defs} == WANTED
    namespace = {"np": np, "brentq": brentq}
    exec(compile(ast.Module(body=defs, type_ignores=[]), str(SOURCE), "exec"), namespace)
    return namespace


F = _load()


def cosine_series(b, terms):
    kap = (np.arange(terms) + 0.5) * np.pi / b
    mass = np.tanh(b) + b / np.cosh(b) ** 2
    return (2 / b) * kap ** 2 / (1 + kap ** 2) / mass, 0.5 * (1 + kap ** 2)  # amplitudes, rates


@pytest.mark.parametrize("c0", COSTS)
def test_bound_is_the_closed_form_root(c0):
    b = F["bound"](c0)
    assert abs(np.sinh(2 * b) + 2 * b - 1 / c0) < 1e-9 / c0
    assert abs(b - ddm.optimal_bound(c0)) < 1e-9
    assert F["mean_decision_time"](c0) == pytest.approx(b * np.tanh(b), rel=1e-12)


@pytest.mark.parametrize("c0", COSTS)
def test_kernel_is_the_normalized_survival_flux(c0):
    s = np.array([0.01, 0.1, 0.5, 1.0, 3.0])
    amp, rate = cosine_series(F["bound"](c0), 20_000)
    assert np.allclose(F["kernel"](c0, s), np.exp(-np.outer(s, rate)) @ amp, rtol=1e-9)


@pytest.mark.parametrize("c0", COSTS)
def test_transfer_and_mean_match_the_series(c0):
    amp, rate = cosine_series(F["bound"](c0), 2_000_000)
    for lam in (0.3, 1.0, 5.0):
        series = np.sum(amp / (lam + rate))  # the tail beyond the terms kept is below 1e-6
        assert F["transfer"](c0, lam).real == pytest.approx(series, rel=1e-5)
    assert F["transfer"](c0, 1e-8).real == pytest.approx(1.0, abs=1e-6)  # w integrates to one
    assert F["mean_look_ahead"](c0) == pytest.approx(np.sum(amp / rate ** 2), rel=1e-9)
    b = F["bound"](c0)
    second_form = 0.5 + 2 * b * (b * np.tanh(b) - 1) / (np.sinh(2 * b) + 2 * b)
    assert F["mean_look_ahead"](c0) == pytest.approx(second_form, rel=1e-9)


@pytest.mark.parametrize("c0", COSTS)
def test_transfer_function_signs_and_fast_limit(c0):
    for om in np.geomspace(0.05, 100, 25):
        z = F["transfer"](c0, -1j * om)
        assert abs(z) < 1  # the bound swings less than the per-moment rule
        assert 0 < np.degrees(np.angle(z)) < 90  # and leads it
    b = F["bound"](c0)
    om = 1e4
    z = F["transfer"](c0, -1j * om)
    assert abs(z) == pytest.approx(2 * c0 * np.cosh(b) ** 2 * np.sqrt(2 / om), rel=0.01)
    assert abs(np.degrees(np.angle(z)) - 45) < 0.5
