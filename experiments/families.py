"""Random cost schedules: the development set and the held-out set.

The development set is the 90 schedules of `random_schedules.py` (seed 2026), on which the
weighted look-ahead rule was designed. `development_set()` draws them again in the same order.

The held-out set uses a new seed and seven families, four of them not used in development. Its
specification was fixed before it was first run:
- smooth, step, deadline: the development generators, drawn with the new seed;
- pulse: a bump in log c, up to 8-fold either way, of random width and time;
- ramp: log c rising or falling by up to 16-fold over a random time, then flat;
- multi-step: two to four smoothed steps, each up to 4-fold either way;
- piecewise: log c piecewise constant on random intervals, smoothed at the joins.
"""
from __future__ import annotations

import numpy as np

import common

HELD_OUT_SEED = 20261111
PER_FAMILY = 30


def _smooth(rng, i):
    c0 = float(np.exp(rng.uniform(np.log(0.02), np.log(0.5))))
    a = rng.uniform(-1, 1, 3) / 1.5
    om = rng.uniform(0.3, 6.0, 3)
    ph = rng.uniform(0, 2 * np.pi, 3)
    f = lambda t: c0 * np.exp(sum(a[j] * np.sin(om[j] * t + ph[j]) for j in range(3)))
    return common.Schedule(f"smooth {i}", f, family="smooth", c0=c0)


def _step(rng, i):
    c0 = float(np.exp(rng.uniform(np.log(0.02), np.log(1.0))))
    r = float(np.exp(rng.uniform(-np.log(16), np.log(16))))
    t0 = float(rng.uniform(0.1, 2.0))
    s = common.step(c0, c0 * r, t0)
    s.name = f"step {i}: {c0:.3f} to {c0 * r:.3f} at {t0:.2f} s"
    return s


def _deadline(rng, i):
    c0 = float(np.exp(rng.uniform(np.log(0.01), np.log(0.5))))
    T = float(rng.uniform(0.3, 3.0))
    return common.deadline(c0, T)


def _pulse(rng, i):
    c0 = float(np.exp(rng.uniform(np.log(0.02), np.log(0.5))))
    amp = float(rng.uniform(-np.log(8), np.log(8)))
    t0 = float(rng.uniform(0.2, 2.5))
    width = float(rng.uniform(0.05, 0.6))
    f = lambda t: c0 * np.exp(amp * np.exp(-0.5 * ((np.asarray(t) - t0) / width) ** 2))
    return common.Schedule(f"pulse {i}: {c0:.3f} times {np.exp(amp):.2f} at {t0:.2f} s, width {width:.2f}",
                           f, family="pulse", c0=c0, amp=amp, t0=t0, width=width)


def _ramp(rng, i):
    c0 = float(np.exp(rng.uniform(np.log(0.02), np.log(0.5))))
    total = float(rng.uniform(-np.log(16), np.log(16)))
    t1 = float(rng.uniform(0.5, 4.0))
    f = lambda t: c0 * np.exp(total * np.clip(np.asarray(t) / t1, 0.0, 1.0))
    return common.Schedule(f"ramp {i}: {c0:.3f} to {c0 * np.exp(total):.3f} over {t1:.2f} s",
                           f, family="ramp", c0=c0, total=total, t1=t1)


def _multi_step(rng, i, width=0.05):
    c0 = float(np.exp(rng.uniform(np.log(0.02), np.log(0.5))))
    k = int(rng.integers(2, 5))
    times = np.sort(rng.uniform(0.1, 3.0, k))
    jumps = rng.uniform(-np.log(4), np.log(4), k)

    def f(t):
        t = np.asarray(t, float)
        return c0 * np.exp(sum(jumps[j] / (1 + np.exp(-(t - times[j]) / width)) for j in range(k)))
    return common.Schedule(f"multi-step {i}: {k} steps from {c0:.3f}", f, family="multi-step", c0=c0,
                           times=times.round(3).tolist(), factors=np.exp(jumps).round(3).tolist())


def _piecewise(rng, i, width=0.05):
    edges = [0.0]
    while edges[-1] < common.HORIZON:
        edges.append(edges[-1] + float(rng.exponential(0.4)) + 0.05)
    levels = rng.uniform(np.log(0.02), np.log(1.0), len(edges))
    cuts = np.array(edges[1:])

    def f(t):
        t = np.asarray(t, float)
        out = np.full(t.shape, levels[0])
        for j, tc in enumerate(cuts):
            out = out + (levels[j + 1] - levels[j]) / (1 + np.exp(-(t - tc) / width))
        return np.exp(out)
    return common.Schedule(f"piecewise {i}: {len(cuts)} pieces", f, family="piecewise",
                           c0=float(np.exp(levels[0])), pieces=len(cuts))


def development_set(n: int = PER_FAMILY):
    """The 90 schedules of random_schedules.py, in its order (one generator, seed 2026)."""
    rng = np.random.default_rng(2026)
    out = []
    for make in (_smooth, _step, _deadline):
        out += [make(rng, i) for i in range(n)]
    return out


HELD_OUT_FAMILIES = (("smooth", _smooth), ("step", _step), ("deadline", _deadline), ("pulse", _pulse),
                     ("ramp", _ramp), ("multi-step", _multi_step), ("piecewise", _piecewise))


def held_out_set(n: int = PER_FAMILY):
    """The held-out schedules: each family drawn from its own stream of the held-out seed, so a
    family's schedules don't depend on how many the others have."""
    out = []
    for j, (_, make) in enumerate(HELD_OUT_FAMILIES):
        rng = np.random.default_rng([HELD_OUT_SEED, j])
        out += [make(rng, i) for i in range(n)]
    return out
