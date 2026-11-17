"""Identities for the first-order kernel w(s) used in the paper.

With mu = sigma = 1 and b0 = B(c0), the kernel is the survival flux at the bound,
n(s) = -d/dx P_x(tau > s) at x = b0, normalized. The paper uses three facts about it:
- two series for n agree (the drift mixture in `shortcuts`, and a positive cosine series);
- its mass is tanh b0 + b0 sech^2 b0 = 1 / (2 c0 cosh^2 b0);
- it is the exit-time law from a start drawn with density 4 c0 cosh^2 y on [0, b0], so its mean is
  c0 [sinh(2 b0)/2 - b0 + 2 b0^2 tanh b0];
and its Laplace transform is 2 c0 cosh^2 b0 [r tanh(r b0) - tanh b0] / lam with r = sqrt(2 lam + 1).
"""
import numpy as np
import pytest
from scipy.integrate import quad

from speed_accuracy.ddm import optimal_bound

COSTS = [0.02, 0.1, 0.3]


def mixture_flux(b, s, terms=6000):
    g = 1 / (1 + np.exp(-2 * b))
    n = np.arange(1, terms + 1)
    k = n * np.pi / (2 * b)
    out = np.zeros_like(s)
    for a, p in ((1.0, g), (-1.0, 1 - g)):
        amp = k * k / (b * (a * a + k * k)) * (1 - (-1.0) ** n * np.exp(-2 * a * b))
        out += p * (np.exp(-np.outer(s, 0.5 * (k * k + a * a))) @ amp)
    return out


def cosine_series(b, terms=6000):
    kap = (np.arange(terms) + 0.5) * np.pi / b
    return (2 / b) * kap ** 2 / (1 + kap ** 2), 0.5 * (1 + kap ** 2)  # amplitudes, rates


@pytest.mark.parametrize("c0", COSTS)
def test_two_series_agree(c0):
    b = optimal_bound(c0)
    s = np.array([0.01, 0.1, 0.5, 1.0, 3.0])
    amp, rate = cosine_series(b)
    positive = np.exp(-np.outer(s, rate)) @ amp
    assert np.allclose(mixture_flux(b, s), positive, rtol=1e-10)


@pytest.mark.parametrize("c0", COSTS)
def test_mass(c0):
    b = optimal_bound(c0)
    amp, rate = cosine_series(b, terms=200000)
    mass = np.sum(amp / rate)
    assert mass == pytest.approx(np.tanh(b) + b / np.cosh(b) ** 2, rel=1e-5)
    assert mass == pytest.approx(1 / (2 * c0 * np.cosh(b) ** 2), rel=1e-5)


@pytest.mark.parametrize("c0", COSTS)
def test_mean_is_exit_time_from_cosh_squared_start(c0):
    b = optimal_bound(c0)
    from_start = quad(lambda y: 4 * c0 * np.cosh(y) ** 2 * (b * np.tanh(b) - y * np.tanh(y)), 0, b)[0]
    closed = c0 * (np.sinh(2 * b) / 2 - b + 2 * b * b * np.tanh(b))
    amp, rate = cosine_series(b, terms=200000)
    from_series = np.sum(amp / rate ** 2) / np.sum(amp / rate)
    assert from_start == pytest.approx(closed, rel=1e-10)
    assert from_series == pytest.approx(closed, rel=1e-5)


@pytest.mark.parametrize("c0", COSTS)
@pytest.mark.parametrize("lam", [0.3, 1.0, 4.0, -0.2])
def test_laplace_transform(c0, lam):
    b = optimal_bound(c0)
    amp, rate = cosine_series(b, terms=200000)
    series = np.sum(amp / (rate + lam)) / np.sum(amp / rate)
    r = np.sqrt(2 * lam + 1)
    closed = 2 * c0 * np.cosh(b) ** 2 * (r * np.tanh(r * b) - np.tanh(b)) / lam
    assert series == pytest.approx(closed, rel=1e-4)
