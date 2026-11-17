# The site

A one-page post with live simulations. It opens on a decision machine: a Galton board where each
ball is one decision, each row of pegs one glimpse of evidence, and the bounds are the best ones
for the board, solved exactly; decisions pile up beside the bounds by when they were made. Readers
can tilt the board to change the evidence's strength, pour thousands of decisions at once, draw
their own bounds, and turn on a look-ahead light that shows, from one moment on the best bound, how
much each later moment's cost counts. Then the reader drives the car: a game on the machine's three
schedules, where the evidence is a stalled truck's hazard lights glinting through fog, against the three rules on the same readings. A section on what the result could be good for follows,
grouped by what happens to the cost of time, with eight working examples (a driverless car, a goalkeeper, a
walking robot, a solar field recorder, and a lander in 3D; a recycling sorter on flat chutes; and a lab test
with moving dots, with the penalty climbing at a cue and lifting at one), four of the paper's solved examples, and the goalkeeper's, the robot's, and the recorder's schedules solved the same way. Below that, one decision at a time with moving dots whose net motion in each frame is the evidence the trace
adds, then a lab where the browser solves the exact policy for a cost schedule you pick or draw,
and the paper's measurements, including any of the 210 held-out schedules rerun in the browser.
It's static HTML, CSS, and JavaScript modules with no framework.

| File | What it does |
|---|---|
| `js/lattice.js` | The decision machine's model: the paper's evidence on a lattice at any evidence strength, with exact optimal bounds, the 2025 rule's bounds, scoring, the flow of balls through each peg, and the look-ahead (the board's version of the paper's kernel) |
| `js/machine.js` | The decision machine: the board, balls, piles, the exact-flow view, the cost handle, tilt, pour, pause, your own bounds, the look-ahead light, and the walkthrough, which drops one car at a time and explains it from its own path |
| `js/walkcopy.js` | The walkthrough's sentences, built from a ball's path and the bounds in use, kept pure so the checks can hold them to the board's math |
| `js/appearance.js` | The two themes (light, as ink on silver paper; dark, as light on a black print), following the system unless the reader picks one, and the dial that turns every color that carries meaning together while each keeps its contrast; a choice is kept in the browser and set before the first paint |
| `js/tones.js` | The dial's color math, with no DOM: each color turns by the same angle, keeps its OKLCH lightness and chroma where sRGB allows, and moves only in lightness to reach 4.5:1 on its theme's surfaces; the checks hold every position to that and keep colors that appear together apart |
| `js/sound.js` | One sound switch for the whole page, off until the reader turns it on |
| `js/scenarios.js`, `js/print-read.js` | The solved examples in "What it could be good for", drawn from the stored showcase results and the goalkeeper's schedule, and what each print says at any moment |
| `js/lanes.js` | Three deciders side by side on the lattice, one per rule (best, 2025 rule, look-ahead rule), reading the same evidence: their bounds, exact scores, and one run at a time; the car, the goalkeeper, the robot, the recorder, and the lander are built on it |
| `js/lanes-scene.js` | What the 3D scenes share: the story clock, the controls, the gauges over the lanes, colors from the page, and loading Three.js as a scene nears the screen, with a flat drawing without WebGL |
| `js/runs.js` | The runs beside the 3D scenes: when each rule's decider committed, as a strip per rule (exact as a line, the runs so far filled in, the forced choices past the deadline), what each earned per 100 runs (successes less doubt), and a sentence on what the runs show, with the sampling error of each gap |
| `js/car-model.js`, `js/car.js` | The driverless car: a steady cost and a last moment to swerve, three cars with the same readings, and the 3D scene |
| `js/keeper-model.js`, `js/keeper.js` | The goalkeeper: a cost of doubt that climbs toward the kick, three keepers reading the same cues, and the 3D scene with the cost along its bottom |
| `js/sorter-model.js`, `js/sorter.js` | The recycling sorter: flakes at four speeds, each with its own deadline at the jets and a steady cost, mixed equally; three flat chutes carrying the same flakes, the bounds each rule sets for each speed, and the runs over the mix |
| `js/game-model.js`, `js/game.js`, `js/play-scene.js` | Your turn: the reader drives the car on the machine's three schedules (the cost jumps 16-fold, a deadline, a steady cost) in real time. A stalled truck blocks one side at the end of each road, hidden in fog, and each reading is a glint of its hazard lights, on its side with the readings' own probability. Then the fog lifts and the three rules drive the same road with the same glints; the round's readings with each rule's bounds, and points and fair points over nine rounds. The 3D road is the car scene's look, with four lanes |
| `js/lander-model.js`, `js/lander.js` | The lander: hovering that costs more once the fuel reaches its reserve (the paper's "flat, then rising" schedule, whose print it shares), three landers taking the same lidar scans, and the 3D scene with each lander's fuel |
| `js/recorder-model.js`, `js/recorder.js` | The solar field recorder: a cost of listening that falls as the sun comes up, three recorders hearing the same songs, and the 3D scene at first light with the battery each recorder's doubt has used |
| `js/robot-model.js`, `js/robot.js` | The walking robot: a cost of doubt that peaks at each footfall (or, at the switch, stays steady), three robots reading the same sensor, and the 3D scene with legs set by inverse kinematics and the cost along its bottom |
| `js/lab-model.js`, `js/labtest.js` | The lab test: moving dots at 6.4% coherence, a penalty that climbs at a cue (or, in the second copy, lifts at one), and the urgency each rule implies, in milliseconds |
| `js/vendor/three.min.js` | Three.js 0.186.1 (MIT license, `three-LICENSE.txt` beside it): a minified bundle of the parts the 3D scenes use, loaded only when one comes near the screen |
| `js/model.js` | The model in the browser: the closed-form bound, the boundary kernel, both rules, dynamic programming, and exact scoring, on coarser grids than the Python package |
| `js/stimulus.js`, `js/rng.js` | The decisions in the first print, in seconds, and the dots drawn from their evidence; a seeded generator so a run can be repeated |
| `js/race.js` | The first print: the dots, the evidence strip, the bound, and the tally |
| `js/lab.js`, `js/compute.js`, `js/worker.js`, `js/solver.js`, `js/schedules.js` | The cost lab: schedules, drawn costs, and the solver in a worker |
| `js/heldout.js` | The held-out schedules' cost formulas, as in `experiments/families.py` |
| `js/figures.js`, `js/svg.js` | The look-ahead weight, the held-out schedules, the first-order lead, and the tables |
| `data/site-data.json` | The paper's numbers and stored results, including the showcase schedules' bounds and the goalkeeper's, written by `tools/build_data.py` |
| `data/scenes.json` | The goalkeeper's, the robot's, and the recorder's schedules solved with the paper's package (bounds and losses), written by `tools/build_scenes.py` |
| `data/heldout.json` | The held-out schedules' parameters and losses, written by `tools/build_reference.py` |
| `data/checks.json` | The last full run of `tools/check_site.mjs`, shown on the page |
| `fonts/` | Archivo and Source Serif 4 (Latin subsets), under the SIL Open Font License |

## Update the data

After the experiments and `paper/make_figures.py`:

```bash
uv run python site/tools/build_scenes.py
uv run python site/tools/build_data.py
uv run python site/tools/build_reference.py
```

## Check the browser against the Python results

```bash
node site/tools/check_site.mjs --write
```

It compares everything the page computes with the Python package, each within a stated tolerance,
and exits with an error if any is outside it: the closed-form bound, accuracy, and mean time; the
boundary kernel; the transfer function against its closed form and the dynamic program's fits; the
four showcase schedules, the goalkeeper's, the robot's, and the recorder's; all 210 held-out schedules' losses; the decision machine's scoring
against the gambler's-ruin formulas, its bounds against the best constant bounds, its 2025 rule's
losses against the paper's, its dropped balls against its exact expectations, and its look-ahead
against the paper's formula for the mean look-ahead and its series for the kernel; that the
scenario prints and the losses in their text equal the stored results; that every number in the walkthrough's sentences matches its ball's path; that the theme dial keeps every color readable and apart at all 360 positions; that the dots' running net motion
equals the rounded evidence at every frame; and that the trials' accuracy and mean time match the
closed form. It checks the working examples too: for the car, the goalkeeper, the robot (its cost
peaking at each footfall and steady), the recorder, and the lander, the three sets of bounds against the lattice, the exact scores, that the three see the same readings,
the simulated scores against the exact ones, the board's losses against the paper's model, each
rule's exact commit times against its exact score, and the runs' strip and table against their exact values; the
game's three roads against the lattice, its rounds against the exact scores in points and fair points, a player who stops where a rule stops against that rule, its glints against the readings' probability, and the numbers and claims in its text; the
keeper's, the robot's, the recorder's, the lander's, and the sorter's numbers and claims in their text, including the robot's bound's lead over a step; the sorter's four speeds and their mix; the lab test's unit and every number in its text, with the penalty climbing and lifting, its
trials against the closed form, and its dots against its evidence; and that every print's readout
says the stored values. It also checks that every number in the text equals the paper's generated number.
`--quick` reruns every seventh held-out schedule instead of all of them.

## Three.js for the 3D scenes

`js/vendor/three.min.js` is built from three 0.186.1 with esbuild, from `tools/three-entry.js`,
which lists the parts the scene uses: run `npm pack three@0.186.1`, unpack it as
`node_modules/three` beside a copy of that file, and run
`esbuild three-entry.js --bundle --format=esm --minify --legal-comments=none`, then put the
one-line license comment back on top. It is about 112 KB compressed with Brotli (135 KB with gzip).

## Preview and build

```bash
python3 -m http.server 8000 --directory site
node site/tools/build.mjs <out-dir>
```

The build copies the page and `_headers`, which keeps a preview out of search engines.
