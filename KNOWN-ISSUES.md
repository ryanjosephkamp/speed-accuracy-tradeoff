# Known issues

This file lists known and potential problems in this project: a claim that may be stronger than its evidence, a
result that depends on a choice the text doesn't state, or something that can't yet be reproduced from this
repository. They were found in reviews after release. Each entry says what was observed, where, and its status.
An entry marked "potential" has not been rerun.

I'm working through them as time allows. A fixed entry stays here with the commit that fixed it.

If you find something else, please [open an issue](https://github.com/ryanjosephkamp/speed-accuracy-tradeoff/issues).

## Claims and wording

### KI-01. "Run once" leaves out a smoke test

- **Kind:** wording. **Status:** open, November 25, 2026.
- **Where:** the paper's held-out section ("specified a held-out set before running it, and ran it once"); the talk,
  slide 11 ("run once"); the poster's held-out note ("Specified before the run and run once").
- **Observed:** before the full run, a smoke test scored the first schedule of each of the seven families to check
  the code. Nothing in the rules, the scoring, or the specification changed after it. So 7 of the 210 schedules were
  scored twice, and "run once" is true of the full run only. The repository can't show the order, because the
  generator and the results were committed together.
- **Affects:** the words "run once". No number changes.
- **To check:** the full run is `experiments/held_out.py`; its optional count selects the first schedules of every
  family. The smoke test isn't recorded in this repository.

### KI-02. "Exactly" means optimal on the scorer's grid

- **Kind:** wording. **Status:** fixed, November 25, 2026, in `8fecbda`.
- **Where:** `pyproject.toml`, the description ("computed exactly and tested"); `experiments/README.md`, lines
  11–12 ("so no policy the scorer can see does better").
- **Observed:** the reference is the dynamic program's bound, interpolated between grid points and then scored the
  same way as the rules, so a rule can score marginally higher than it. Nine stored losses are negative, in three
  held-out rows: step 1 (five rules, down to −0.000025 points per 100 trials), pulse 16 (the weighted rule,
  −0.0000008), and pulse 20 (three rules, down to −0.0000074). The paper says this correctly ("nonnegative up to the
  interpolation of bounds"); these two texts didn't.
- **Affects:** the wording of those two lines. No number changes.
- **To check:** the negative `loss` values in `experiments/results/held_out.json`.

### KI-03. The experiments README gave the weighted rule's order without its range

- **Kind:** wording. **Status:** fixed, November 25, 2026, in `8fecbda`.
- **Where:** `experiments/README.md`, line 29, the `loss_scaling.py` row ("close to fourth order for the weighted
  rule").
- **Observed:** the effective order is 3.7 on the paper's grid and 3.9 on a grid twice as fine, measured from
  amplitude 0.2 to 0.8 for one cost shape. At 0.2 the two grids differ by 29%, and at the smallest amplitude, 0.05,
  the sign of the weighted loss differs between them. The paper states this range and calls it a measurement over a
  short range, not an asymptotic result; the README row didn't.
- **Affects:** the README row's wording.
- **To check:** `experiments/results/loss_scaling.json`.

## Methods and results

### KI-04. Part of the weighted rule's held-out loss comes from the t = 10 cutoff

- **Kind:** result. **Status:** open, November 25, 2026. Measured on 13 schedules; the full set hasn't been rescored.
- **Where:** `experiments/common.py` (`HORIZON = 10.0`), `experiments/held_out.py`,
  `experiments/results/held_out.json`, and `experiments/results/horizon_floor.json`; the paper's held-out section
  and its note on the horizon.
- **Observed:** schedules without a deadline are scored against a reference that must choose by t = 10, while the
  rules treat the horizon as infinite. `horizon_floor.json` measures what the cutoff alone costs at a constant cost:
  0.0018 points per 100 trials at c = 0.02, 0.0005 at 0.05, and 0.00003 at 0.1. On the 180 held-out schedules
  without a deadline, the weighted rule's median loss is 0.0017, and 94 of the 180 are below 0.0018. At t = 10, the
  cost is below 0.02 on 20 of these schedules and below 0.05 on 58. Rescoring the ten with the lowest cost at t = 10
  with a horizon of 20 lowered the weighted rule's loss on every one, by 0.0017 to 0.0033 points per 100 trials;
  their median went from 0.0031 to 0.0003. Three schedules with a high cost at t = 10 didn't change. The weighted
  rule had the lower loss on all 13 at both horizons.
- **Affects:** the weighted rule's held-out losses, which are overstated where the cost ends low, and so its
  recovery figures, which are understated there. The per-moment rule's losses (median 0.13) are far above the
  cutoff's size, so the comparison between the two rules doesn't change.
- **To check:** rescore the schedules with a low cost at t = 10 with `HORIZON = 20` in `experiments/common.py` and
  compare with `held_out.json`.

## Reproducibility

### KI-05. The held-out results don't store every schedule parameter

- **Kind:** reproducibility. **Status:** open, November 25, 2026.
- **Where:** `experiments/results/held_out.json` (each row's `params`) and `experiments/families.py`.
- **Observed:** smooth rows store only the base cost, not the three amplitudes, frequencies, and phases. Piecewise
  rows store the first level and the number of pieces, not the cut times or later levels. Multi-step times and
  factors are rounded to three decimals. The full schedules regenerate from `families.held_out_set()` (seed
  20261111): under the NumPy pinned in `uv.lock`, all 210 rows and every stored parameter match exactly.
  `pyproject.toml` allows NumPy 1.26 or newer, and regeneration under other versions hasn't been checked.
- **Affects:** reproducing a row without the generator. No reported number.
- **To check:** regenerate with `families.held_out_set()` and compare with the stored `params`.
  `tests/test_families.py` compares saved results only for the development set, and only its families and base
  costs.
