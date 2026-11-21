"""The first-order prediction against the exact policy at three costs, two frequencies, and four perturbation sizes.

For c(t) = c0 + eps sin(omega t), the first-order analysis predicts the bound's response:
delta b(t) = eps B'(c0) Im(w~(-i omega) e^{i omega t}), with w~ the kernel's Laplace transform.
This fits a sinusoid (plus a constant) to the difference between the exact evidence bounds with
and without the perturbation, over whole periods well away from t = 0 and the horizon, and
reports the fitted swing over the predicted swing and the phase error. A correct first-order term
leaves a relative swing error that shrinks like (eps / c0)^2.
Writes experiments/results/first_order_sweep.json.
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import brentq

sys.path.insert(0, str(Path(__file__).parent))
from speed_accuracy import known  # noqa: E402

H, T_END, WINDOW = 0.0025, 14.0, (2.0, 2.0 + 2 * np.pi)  # one period at omega = 1, four at 4


def bound(c):
    return brentq(lambda b: np.sinh(2 * b) + 2 * b - 1 / c, 1e-12, 50)


def transfer(c0, om):
    b0 = bound(c0)
    r = np.sqrt(2 * (-1j * om) + 1)
    return 2 * c0 * np.cosh(b0) ** 2 * (r * np.tanh(r * b0) - np.tanh(b0)) / (-1j * om)


def fit(d, ts, om):
    A = np.c_[np.sin(om * ts), np.cos(om * ts), np.ones(len(ts))]
    a, b, _ = np.linalg.lstsq(A, d, rcond=None)[0]
    return a + 1j * b


rows = []
for c0 in (0.03, 0.1, 0.3):
    b0 = bound(c0)
    slope = -1 / (4 * c0 ** 2 * np.cosh(b0) ** 2)  # B'(c0)
    ts, x0, _ = known.backward_induction_x(lambda t: c0 + 0 * np.asarray(t), T_END, h=H)
    sel = (ts > WINDOW[0]) & (ts < WINDOW[1])
    for om in (1.0, 4.0):
        w = transfer(c0, om)
        for rel in (0.05, 0.1, 0.3, 0.6):
            eps = rel * c0
            _, x1, _ = known.backward_induction_x(lambda t: c0 + eps * np.sin(om * np.asarray(t)), T_END, h=H)
            z = fit((x1 - x0)[sel], ts[sel], om)
            theory = eps * slope * w  # coefficient of sin is Re, of cos is Im
            rows.append(dict(c0=c0, omega=om, rel=rel, swing_ratio=float(abs(z) / abs(theory)),
                             phase_error=float(np.degrees(np.angle(z / theory)))))
            print(rows[-1], flush=True)
(Path(__file__).parent / "results" / "first_order_sweep.json").write_text(json.dumps(rows, indent=1))
