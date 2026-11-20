# Waiting, weighted

**Working draft.** This study is still in development, and its paper isn't public yet. The code,
the experiments, and the site are here as they stand, and they may change.

Code and interactive site for a study of optimal decision bounds when the cost of time changes
(Ryan Kamp, 2026).

A drift-diffusion decision maker gathers noisy evidence until the running total reaches a bound,
then decides. When every moment of waiting costs the same, the best bound is flat and has a closed
form. When the cost of time changes during the decision, the best bound moves, and the usual way to
find it is dynamic programming. The draft's main result is that, to first order, the optimal bound at each
moment is the constant-cost bound at a weighted average of the cost over the near future. It gives
those weights in closed form and shows that, on average, they reach at most about 0.62 σ²/μ² ahead,
whatever the cost. A rule built on the result, the weighted look-ahead, is tested against the exact
policy on 210 held-out cost schedules.

- **Paper:** *Waiting, weighted: optimal decision bounds when the cost of time changes*, in
  development and not public yet. `paper/` holds the figures, tables, and numbers it quotes, all
  generated from `experiments/results/`.
- **Site:** the decision machine, an interactive explainer with live versions of the paper's
  results, at https://speed-accuracy.rk-folio-5f2dc2.pages.dev. Its source is in `site/`.

This project revisits my 2025 undergraduate research capstone at the University of Cincinnati,
[perceptual-decision-making-capstone](https://github.com/ryanjosephkamp/perceptual-decision-making-capstone),
which implemented Jan Drugowitsch's notes on normative solutions to the speed-accuracy trade-off
from the FENS-Hertie 2015 Winter School. That repository stays as it was. This one is a new
implementation with tests, and the site lists what was wrong in the 2025 code and what changed.

## What's here

| Folder | What it holds |
|---|---|
| `src/speed_accuracy/` | The Python package (below) |
| `tests/` | Tests for the package, run with pytest |
| `experiments/` | Every measurement in the study, with its stored results; see its README |
| `paper/` | The figures, generated tables, and numbers for the paper (the paper itself isn't public yet) |
| `site/` | The site: static HTML, CSS, and JavaScript, with checks against the Python results; see its README |

| Module | What it computes |
|---|---|
| `ddm.py` | Belief from evidence, accuracy, mean decision time, expected reward, and the optimal bound for a constant cost |
| `known.py` | The belief transition matrix, value iteration for a constant cost, and backward induction for a cost that changes over time |
| `unknown.py` | The same for unknown reliability, where the drift is drawn once per trial and the bounds collapse |
| `shortcuts.py` | Rules that need no dynamic program: the per-moment rule, look-ahead variants, and the weighted look-ahead with its kernel |
| `info_time.py` | Unknown reliability as a constant process with a rising cost: the closed-form frozen-time bound and the weighted bound |
| `evaluate.py` | The exact expected reward of any bound over time, by moving the evidence density forward on a grid, and the distribution of decision times |
| `lopsided.py` | Unequal rewards for the two choices: closed-form bounds for a constant cost, the first-order kernel at each bound, the per-moment and weighted rules, the exact policy, and exact scoring |
| `simulate.py` | Monte Carlo trials for any bound over time, with paired noise for comparing policies |

## Run it

With Python 3.11 or later and [uv](https://docs.astral.sh/uv/):

```bash
uv run --group dev pytest
uv run python experiments/held_out.py
```

The figures, tables, and quoted numbers are generated from `experiments/results/`:

```bash
uv run --group paper python paper/make_figures.py
```

The site needs no build to preview:

```bash
python3 -m http.server 8000 --directory site
```

## License

The code is under the MIT License (`LICENSE`). The figures and tables in `paper/` are under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The fonts in `site/fonts/` are under the
SIL Open Font License, and Three.js in `site/js/vendor/` under its MIT License; each license file
sits beside them.

## Cite

The paper isn't public yet. To cite the code, use `CITATION.cff`.
