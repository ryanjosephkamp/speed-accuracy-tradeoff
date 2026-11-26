# Experiments

These scripts compare simple decision rules with the exact optimal policy. Every score is an
expected reward computed exactly on a grid by `speed_accuracy.evaluate`, so two policies can be
compared without Monte Carlo noise.

Losses are in points per 100 trials:

    100 × (reward of the exact policy − reward of the rule)

The exact reference for known reliability is `known.backward_induction_x`. It runs on the
scorer's own evidence grid, so no policy does better there, up to the interpolation of bounds
between grid points. For unknown reliability, the reference is `unknown.backward_induction`,
which doesn't change at 300, 600, or 900 grid points.

| Script | What it does |
|---|---|
| `random_schedules.py` | Runs the 90 development schedules (smooth, steps, and hard deadlines; seed 2026) and records the losses of the per-moment rule and the weighted look-ahead. |
| `held_out.py` | Runs the 210 held-out schedules from `families.py` (seed 20261111; seven families, four not used in development) and scores seven policies: per-moment, weighted, weighted in one pass, averaged cost, two shifted per-moment rules, and the best constant bound. |
| `first_order_sweep.py` | Tests the first-order theorem at three costs, two frequencies, and four perturbation sizes. |
| `grid_refinement.py` | Rescores eight development schedules on four grids, and measures how far 30 updates of the weighted rule are from a fixed point. |
| `horizon_floor.py` | At constant costs, measures what the forced choice at t = 10 costs the constant-cost bound, which every rule that ignores the horizon shares. |
| `unknown_reliability.py` | For a drift drawn once per trial, compares the frozen-time, weighted, plug-in, and best fixed-bound policies. |
| `braking.py` | A toy braking decision. The cost of time is the rise in the deceleration needed to stop, with a hard deadline when stopping becomes impossible. |
| `qr_frames.py` | QR codes in poor light. Compares decoding each frame alone with accumulating evidence across frames. |
| `showcase.py` | Writes the bound curves for the figures and the first-order (small sinusoidal cost) check. |
| `lopsided.py` | Unequal rewards for the two choices. Checks the first-order kernel at each bound against a small sinusoidal cost, then runs random schedules for the per-moment and weighted rules. |
| `loss_formula.py` | Checks that a policy whose bound misses the optimum by η(t) loses about E[c(τ) η(τ)²], at the decision time τ. The forced choice at the horizon is left out of the sum. |
| `loss_scaling.py` | Scales one smooth cost shape in log c at five amplitudes and records how the per-moment and weighted rules' losses grow: second order for the per-moment rule, close to fourth order for the weighted rule (an effective order of 3.7 to 3.9 over amplitudes 0.2 to 0.8, on two grids, for one shape; a measurement, not a proof). |

Run any of them from the repository root:

```bash
uv run python experiments/random_schedules.py
```

The QR experiment needs the encoder and decoder:

```bash
uv run --group experiments python experiments/qr_frames.py
```

Results are written to `experiments/results/` as JSON.
