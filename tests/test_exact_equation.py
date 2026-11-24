"""The exact equation for the bound, checked on bounds computed by the dynamic program.

With mu = sigma = 1, the optimal bound b(t) for any continuous cost bounded between two positive
constants satisfies

    integral_0^b(t) cosh^2 y  E_y[c(t + tau*)] dy = 1/4,

where tau* is the optimal decision time from evidence y at time t. Here the bound comes from
`known.backward_induction_x`, and E_y[c(t + tau*)] comes from running that same policy backward on
the same evidence grid. The grid checks the bound once per step, so its bound sits about
0.5826 sqrt(dt) inside the continuous one; the integral runs to the grid bound plus that shift.
The per-moment version of the left side, c(t) (b/2 + sinh(2b)/4), is shown to miss by far more,
so the check can tell the two apart.
"""
import numpy as np
import pytest

from speed_accuracy.known import backward_induction_x
from speed_accuracy.shortcuts import OVERSHOOT

DT = 0.002
H = 0.005
CAP = 8.0


def expected_cost_at_decision(cost, ts, bounds, s2=1.0, h=H, cap=CAP):
    """u[k] on the evidence grid x: E_x[c(ts[k] + tau)] for the policy that stops once |x| reaches
    bounds[k], with the same grid, steps, and belief-weighted drift as `backward_induction_x`."""
    dt = ts[1] - ts[0]
    c = np.broadcast_to(np.asarray(cost(ts), float), ts.shape)
    half = cap + 8 * np.sqrt(s2 * dt) + 1.0
    m = int(np.ceil(half / h))
    n = 1 << int(np.ceil(np.log2(2 * m + 1)))
    x = (np.arange(n) - n // 2) * h
    g = 1.0 / (1.0 + np.exp(-2.0 * x / s2))
    k_hat = []
    for mu in (1.0, -1.0):
        kern = np.exp(-((x + mu * dt) ** 2) / (2 * s2 * dt))
        kern /= kern.sum()
        k_hat.append(np.fft.rfft(np.fft.ifftshift(kern)))
    u = np.full(n, c[-1])  # the choice is forced at the horizon
    out = {len(ts) - 1: u.copy()}
    for i in range(len(ts) - 2, -1, -1):
        uh = np.fft.rfft(u)
        cont = g * np.fft.irfft(uh * k_hat[0], n=n) + (1 - g) * np.fft.irfft(uh * k_hat[1], n=n)
        u = np.where(np.abs(x) >= bounds[i], c[i], cont)
        out[i] = u.copy()
    return x, out


def left_side(x, u, b):
    sel = (x >= 0) & (x < b)
    xs = np.append(x[sel], b)
    us = np.append(u[sel], np.interp(b, x, u))
    return np.trapezoid(np.cosh(xs) ** 2 * us, xs)


SCHEDULES = {
    "constant": lambda t: np.full_like(np.asarray(t, float), 0.1),
    "sinusoid": lambda t: 0.1 * (1 + 0.5 * np.sin(2 * np.asarray(t, float))),
    "smooth step": lambda t: 0.1 + 0.3 / (1 + np.exp(-(np.asarray(t, float) - 1.5) / 0.05)),
}


@pytest.mark.parametrize("name", list(SCHEDULES))
def test_exact_equation_holds_on_the_computed_bound(name):
    cost = SCHEDULES[name]
    ts, b, _ = backward_induction_x(cost, 10.0, dt=DT, h=H, cap=CAP)
    x, u = expected_cost_at_decision(cost, ts, b)
    worst_exact, worst_per_moment = 0.0, 0.0
    for t in (0.0, 0.5, 1.0, 1.4, 2.0, 3.0):
        k = int(round(t / DT))
        bc = b[k] + OVERSHOOT * np.sqrt(DT)
        worst_exact = max(worst_exact, abs(left_side(x, u[k], bc) - 0.25))
        per_moment = cost(ts[k]) * (0.5 * bc + 0.25 * np.sinh(2 * bc))
        worst_per_moment = max(worst_per_moment, abs(per_moment - 0.25))
    assert worst_exact < 1.5e-3  # about 0.6% of 1/4; measured at most 6e-4
    if name != "constant":
        assert worst_per_moment > 0.03  # the cost now, in place of the cost at decision, misses

