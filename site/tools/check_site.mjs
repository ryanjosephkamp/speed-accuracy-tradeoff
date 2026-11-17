// Checks every number the page computes in the browser against the Python package, each within a
// stated tolerance, and fails (exit code 1) if any is outside it. Run from the repository root:
//   node site/tools/check_site.mjs           (everything, a few minutes)
//   node site/tools/check_site.mjs --quick   (every seventh held-out schedule)
//   node site/tools/check_site.mjs --write   (also writes site/data/checks.json, which the page shows)
// The Python side comes from experiments/results/*.json and from site/tools/reference.json,
// which site/tools/build_reference.py writes from src/speed_accuracy.
import { readFileSync, writeFileSync } from "node:fs";
import * as M from "../js/model.js";
import { Rng, dotSeed } from "../js/rng.js";
import { Trial, DotField, dotsPerUnit, driftFor, boundFromLogOdds, expected, COHERENCES, DT_PAPER } from "../js/stimulus.js";
import { costFor } from "../js/heldout.js";
import { computeSchedule, describe, drawnCost } from "../js/compute.js";
import * as Lt from "../js/lattice.js";
import * as Wc from "../js/walkcopy.js";
import * as Tn from "../js/tones.js";
import * as Car from "../js/car-model.js";
import * as Gk from "../js/keeper-model.js";
import * as Rb from "../js/robot-model.js";
import * as Rc from "../js/recorder-model.js";
import * as Ld from "../js/lander-model.js";
import * as So from "../js/sorter-model.js";
import * as Game from "../js/game-model.js";
import * as Ln from "../js/lanes.js";
import * as Runs from "../js/runs.js";
import * as Lab from "../js/lab-model.js";
import { readout, valueAt } from "../js/print-read.js";

const quick = process.argv.includes("--quick");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const ref = json("site/tools/reference.json");
const show = json("experiments/results/showcase.json");
const site = json("site/data/site-data.json");
const held = json("site/data/heldout.json");
const scenes = json("site/data/scenes.json");
// the prints' stored curves, in the order the page has them: the paper's four showcase schedules
// (every fifth sample, of which the page keeps every other), then the working examples' own
// schedules from site/tools/build_scenes.py (every tenth, all kept)
const stored = [
  ...show.schedules.map((r) => ({ t: r.t, cost: r.cost, exact: r.exact, pm: r.per_moment, wb: r.weighted, loss: { pm: r.loss.per_moment, wb: r.loss.weighted }, stride: 2 })),
  { ...scenes.keeper, stride: 1 },
  { ...scenes.robot, stride: 1 },
  { ...scenes.recorder, stride: 1 },
];

const rows = [], record = [];
let failed = 0;
function check(name, worst, tol, unit = "") {
  const ok = worst <= tol;
  if (!ok) failed++;
  rows.push([ok ? "pass" : "FAIL", name, `${fmt(worst)}${unit}`, `${fmt(tol)}${unit}`]);
  record.push({ name, worst: fmt(worst), tol: fmt(tol), unit, pass: ok });
}
const fmt = (v) => (v === 0 ? "0" : Math.abs(v) < 1e-3 || Math.abs(v) >= 1e4 ? v.toExponential(2) : v.toPrecision(3));
const maxOf = (arr, f) => arr.reduce((m, x) => Math.max(m, f(x)), 0);

// 0. The numbers typed in the page's text match the paper's generated numbers.
{
  const html = readFileSync("site/index.html", "utf8");
  const spans = [...html.matchAll(/data-n="(\w+)">([^<]*)</g)];
  const off = spans.filter(([, k, v]) => site.numbers[k] !== v);
  for (const [, k, v] of off) console.log(`  ${k}: page says ${v}, data says ${site.numbers[k]}`);
  check(`text numbers equal the page's data file (${spans.length})`, off.length, 0);
  // and the data file equals the paper's generated macros and the stored results it is built from
  const tex = readFileSync("paper/generated/numbers.tex", "utf8");
  const macros = Object.fromEntries([...tex.matchAll(/\\newcommand\{\\(\w+)\}\{([^}]*)\}/g)].map((m) => [m[1], m[2]]));
  const badMacro = Object.entries(site.numbers).filter(([k, v]) => macros[k] !== v).length;
  check(`data file numbers equal the paper's generated macros (${Object.keys(site.numbers).length})`, badMacro, 0);
  const heldPy = json("experiments/results/held_out.json");
  const badHeld = site.held.filter((r, i) => r[2] !== heldPy[i].name || r[3] !== +heldPy[i].per_moment.loss.toFixed(5) || r[4] !== +heldPy[i].weighted.loss.toFixed(6)).length;
  const unkPy = json("experiments/results/unknown_reliability.json");
  const badUnk = site.unknown.filter((r, i) => ["frozen_time", "weighted", "plug_in", "best_fixed"].some((k, j) => Math.abs(r[j + 1] - unkPy[i][k]) > 0.0005)).length;
  const badFo = site.firstOrder.filter((r, i) => {
    const py = show.first_order[i], pm = py.per_moment;
    const rel = (fit) => [fit[0] / pm[0], ((fit[1] - pm[1] + 180) % 360 + 360) % 360 - 180];
    return r.omega !== py.omega || ["exact", "weighted"].some((k) => Math.abs(r[k][0] - rel(py[k])[0]) > 5e-5 || Math.abs(r[k][1] - rel(py[k])[1]) > 0.005);
  }).length;
  check("data file tables equal the stored results (held-out, unknown strength, first order)", badHeld + badUnk + badFo, 0);
}

// 1. Constant cost: the closed-form bound, accuracy, and mean time.
check("bound table vs Python table (paper units)", maxOf(ref.closed, (r) => Math.abs(M.boundForCost(r.c) - r.table)), 1e-6);
check("bound table vs exact root (paper units)", maxOf(ref.closed, (r) => Math.abs(M.boundForCost(r.c) - r.bound)), 2e-4);
const MU = driftFor(0.064);
check("best bound in seconds units vs Python, rescaled", maxOf(ref.closed, (r) => Math.abs(M.bestBound(MU, r.c * MU * MU) * MU - r.bound) / r.bound), 1e-9, " (relative)");
check("accuracy at the bound vs Python", maxOf(ref.closed, (r) => Math.abs(M.belief(r.bound) - r.p)), 1e-12);
check("mean decision time vs Python", maxOf(ref.closed, (r) => Math.abs(M.meanTime(r.bound) - r.rt) / Math.max(r.rt, 1e-9)), 1e-9, " (relative)");

// 2. The boundary kernel and the look-ahead.
const kStats = (b) => {
  const { s, w } = M.boundaryKernel(b);
  let mean = 0, acc = 0, median = NaN;
  for (let j = 0; j < s.length; j++) { mean += w[j] * s[j]; if (Number.isNaN(median) && acc + w[j] >= 0.5) median = s[j]; acc += w[j]; }
  return { mean, median };
};
check("kernel mean vs Python", maxOf(ref.kernels, (r) => Math.abs(kStats(r.b).mean - r.mean)), 1e-6);
check("kernel median bin vs Python", maxOf(ref.kernels, (r) => Math.abs(kStats(r.b).median - r.median)), 1e-6);
check("kernel median, interpolated in its bin, vs Python", maxOf(ref.kernels, (r) => Math.abs(M.kernelMedian(M.boundaryKernel(r.b)) - r.medianInterp)), 1e-6);
check("mean look-ahead (page's cached kernel) vs closed form", maxOf(ref.lookAhead, (r) => Math.abs(M.kernelSummary(M.boundForCost(r.c)).mean - r.closed)), 0.002);

// 3. The first-order transfer function: against its closed form and the dynamic program's fits.
check("transfer gain vs closed form", maxOf(ref.transfer, (r) => Math.abs(M.transfer(r.c0, r.omega).gain - r.gain) / r.gain), 0.002, " (relative)");
check("transfer lead vs closed form", maxOf(ref.transfer, (r) => Math.abs(M.transfer(r.c0, r.omega).lead - r.lead)), 0.2, "°");
check("transfer gain vs dynamic program fits", maxOf(site.firstOrder, (r) => Math.abs(M.transfer(0.1, r.omega).gain - r.exact[0])), 0.002);
check("transfer lead vs dynamic program fits", maxOf(site.firstOrder, (r) => Math.abs(M.transfer(0.1, r.omega).lead - r.exact[1])), 0.3, "°");

// 4. The four showcase schedules (as the earlier check_model.mjs): bounds and losses.
{
  const step = (c0, c1, t0, w = 0.05) => (t) => c0 + (c1 - c0) / (1 + Math.exp(-(t - t0) / w));
  const cases = [
    { cost: step(0.1, 1.6, 0.5), horizon: 10 },
    { cost: step(0.4, 0.05, 0.3), horizon: 10 },
    { cost: (t) => 0.1 + 0.8 * Math.max(t - 0.5, 0), horizon: 10 },
    { cost: (t) => (t <= 1 + 1e-12 ? 0.1 : Infinity), horizon: 1 },
  ];
  const shiftPy = M.OVERSHOOT * Math.sqrt(0.002);
  let dPm = 0, dWb = 0, dEx = 0, dLoss = 0;
  cases.forEach((cs, k) => {
    const r = show.schedules[k], ts = Float64Array.from(r.t);
    const pm = M.perMoment(cs.cost, ts), wb = M.weightedBound(cs.cost, ts), ex = M.exactPolicy(cs.cost, cs.horizon);
    const exAt = (t) => { const b = ex.bounds[Math.round(t / ex.dt)]; return b === 0 ? 0 : Math.min(b + M.OVERSHOOT * Math.sqrt(ex.dt), 4); };
    r.t.forEach((t, i) => {
      dPm = Math.max(dPm, Math.abs(Math.min(Math.max(pm[i] - shiftPy, 0), 4) - r.per_moment[i]));
      dWb = Math.max(dWb, Math.abs(Math.min(Math.max(wb[i] - shiftPy, 0), 4) - r.weighted[i]));
      if (t < cs.horizon - 0.05) dEx = Math.max(dEx, Math.abs(exAt(t) - (r.exact[i] === 0 ? 0 : Math.min(r.exact[i] + shiftPy, 4))));
    });
    const disc = (arr) => Float64Array.from(arr, (b) => M.toDiscrete(b, ex.dt));
    const all = M.weightedBound(cs.cost, ex.ts);
    const rEx = M.score(ex.bounds, ex.ts, cs.cost).reward;
    const rPm = M.score(disc(Float64Array.from(ex.ts, (t) => M.boundForCost(cs.cost(t)))), ex.ts, cs.cost).reward;
    const rWb = M.score(disc(all), ex.ts, cs.cost).reward;
    dLoss = Math.max(dLoss, Math.abs(100 * (rEx - rPm) - r.loss.per_moment), Math.abs(100 * (rEx - rWb) - r.loss.weighted));
  });
  check("showcase: per-moment bound vs Python", dPm, 1e-4);
  check("showcase: weighted bound vs Python", dWb, 1e-4);
  check("showcase: exact bound vs Python (coarser grid)", dEx, 0.006);
  check("showcase: losses vs Python", dLoss, 0.04, " points per 100");
}

// 4i. The working examples' own schedules (site/data/scenes.json, from the paper's package by
// site/tools/build_scenes.py), the goalkeeper's, the walking robot's, and the field recorder's,
// against the browser's own model, as the showcase schedules above.
for (const [name, r, cost, horizon] of [
  ["keeper", scenes.keeper, Gk.keeperCost, Gk.KEEPER.kick],
  ["robot", scenes.robot, (t) => Rb.robotCost(t), Rb.ROBOT.rock],
  ["recorder", scenes.recorder, Rc.recorderCost, Rc.RECORDER.stop],
]) {
  const ts = Float64Array.from(r.t);
  const shiftPy = M.OVERSHOOT * Math.sqrt(0.002);
  const pm = M.perMoment(cost, ts), wb = M.weightedBound(cost, ts), ex = M.exactPolicy(cost, horizon);
  const exAt = (t) => { const b = ex.bounds[Math.round(t / ex.dt)]; return b === 0 ? 0 : Math.min(b + M.OVERSHOOT * Math.sqrt(ex.dt), 4); };
  let dPm = 0, dWb = 0, dEx = 0;
  r.t.forEach((t, i) => {
    dPm = Math.max(dPm, Math.abs(Math.min(Math.max(pm[i] - shiftPy, 0), 4) - r.pm[i]));
    dWb = Math.max(dWb, Math.abs(Math.min(Math.max(wb[i] - shiftPy, 0), 4) - r.wb[i]));
    if (t < horizon - 0.05) dEx = Math.max(dEx, Math.abs(exAt(t) - (r.exact[i] === 0 ? 0 : Math.min(r.exact[i] + shiftPy, 4))));
  });
  const disc = (arr) => Float64Array.from(arr, (b) => M.toDiscrete(b, ex.dt));
  const rEx = M.score(ex.bounds, ex.ts, cost).reward;
  const rPm = M.score(disc(Float64Array.from(ex.ts, (t) => M.boundForCost(cost(t)))), ex.ts, cost).reward;
  const rWb = M.score(disc(M.weightedBound(cost, ex.ts)), ex.ts, cost).reward;
  // the browser's grid is coarser than the paper's, so a large loss can differ by a little more
  // than a small one: within 0.04 points or 1% of the loss, whichever is larger
  const over = (mine, py) => Math.max(Math.abs(mine - py) - Math.max(0.04, 0.01 * py), 0);
  const dLoss = Math.max(over(100 * (rEx - rPm), r.loss.pm), over(100 * (rEx - rWb), r.loss.wb));
  check(`${name}'s schedule: 2025 and look-ahead bounds vs Python`, Math.max(dPm, dWb), 1e-4);
  check(`${name}'s schedule: exact bound vs Python (coarser grid)`, dEx, 0.006);
  check(`${name}'s schedule: losses vs Python, beyond 0.04 points or 1% of the loss`, dLoss, 0, " points per 100");
}

// 4b. The cost lab's own path: its presets, solved by compute.js, against the same showcase schedules,
// and a drawn cost's interpolation (linear in log cost between the points drawn).
{
  const step = (c0, c1, t0, w = 0.05) => (t) => c0 + (c1 - c0) / (1 + Math.exp(-(t - t0) / w));
  const pairs = [
    [{ id: "jump", params: { at: 0.5, factor: 16 } }, step(0.1, 1.6, 0.5), 0],
    [{ id: "fall", params: { at: 0.3, factor: 8 } }, step(0.4, 0.05, 0.3), 1],
    [{ id: "rising", params: { at: 0.5, rate: 0.8 } }, (t) => 0.1 + 0.8 * Math.max(t - 0.5, 0), 2],
    [{ id: "deadline", params: { at: 1, c: 0.1 } }, (t) => (t <= 1 + 1e-12 ? 0.1 : Infinity), 3],
  ];
  let dCost = 0, dLoss = 0;
  for (const [preset, ref, k] of pairs) {
    const spec = { kind: "preset", ...preset }, { cost } = describe(spec);
    for (let t = 0; t <= 3; t += 0.013) { const a = cost(t), b = ref(t); dCost = Math.max(dCost, a === b ? 0 : Math.abs(a - b) / b); }
    const r = computeSchedule(spec), py = show.schedules[k].loss;
    dLoss = Math.max(dLoss, Math.abs(r.loss.pm - py.per_moment), Math.abs(r.loss.wb - py.weighted));
  }
  check("cost lab: presets equal the showcase schedules", dCost, 1e-12, " (relative)");
  check("cost lab: preset losses vs Python", dLoss, 0.04, " points per 100");
  const knots = [[0, Math.log(0.1)], [0.5, Math.log(0.1)], [1, Math.log(1.6)], [2.5, Math.log(0.4)]];
  const f = drawnCost(knots);
  const lin = (t) => { for (let i = 1; i < knots.length; i++) if (t <= knots[i][0]) { const [t0, l0] = knots[i - 1], [t1, l1] = knots[i]; return Math.exp(l0 + ((l1 - l0) * (t - t0)) / (t1 - t0)); } return Math.exp(knots[knots.length - 1][1]); };
  let dDraw = 0;
  for (let t = 0; t <= 4; t += 0.0117) dDraw = Math.max(dDraw, Math.abs(f(t) - lin(t)) / lin(t));
  check("cost lab: a drawn cost is linear in log cost between its points", dDraw, 1e-12, " (relative)");
}

// 4c. The decision machine: the paper's model on a lattice. Its scoring against the gambler's-ruin
// formulas, its optimal walls against the best constant walls, its losses against the paper's,
// and dropped balls against its exact expectations.
{
  let dRuin = 0;
  for (let K = 1; K <= 40; K++) {
    const rows = 12000, costs = new Float64Array(rows).fill(0);
    const sc = Lt.scoreWalls(new Int32Array(rows + 1).fill(K), costs), cw = Lt.constantWalls(K);
    dRuin = Math.max(dRuin, Math.abs(sc.p - cw.p), Math.abs(sc.rt - cw.steps * Lt.DT) / (cw.steps * Lt.DT));
  }
  check("machine: exact scoring vs gambler's-ruin formulas, bounds 1 to 40", dRuin, 1e-9);
  let off = 0;
  for (const c of [0.05, 0.1, 0.19, 0.4, 1]) {
    const costs = Lt.rowCosts(() => c, 1000), K = Lt.exactWalls(costs), kb = Lt.bestConstantK(c);
    for (let n = 0; n < 300; n++) if (Lt.effectiveWall(K, n) !== kb) off++;
  }
  check("machine: optimal bounds for a constant cost = best constant bounds (5 costs, 300 rows)", off, 0);
  let dVal = 0;
  for (const f of [() => 0.1, (t) => 0.1 + 1.5 / (1 + Math.exp(-(t - 0.6) / 0.015)), (t) => (t <= 1 ? 0.05 : Infinity), (t) => 0.4 + (0.05 - 0.4) / (1 + Math.exp(-(t - 0.3) / 0.05))]) {
    const costs = Lt.rowCosts(f, f(1.5) === Infinity ? 100 : 1500), K = Lt.exactWalls(costs);
    dVal = Math.max(dVal, Math.abs(K.value - Lt.scoreWalls(K, costs).reward));
  }
  check("machine: the dynamic program's value = the forward-scored reward of its bounds (4 schedules)", dVal, 1e-9);
  // the board also runs at other evidence strengths (tilting the board)
  let dMu = 0, offMu = 0;
  for (const mu of [0.4, 0.7, 1.6, 2.5]) {
    for (const K of [3, 8, 15]) {
      const rows = 6000, sc = Lt.scoreWalls(new Int32Array(rows + 1).fill(K), new Float64Array(rows), mu), cw = Lt.constantWalls(K, mu);
      dMu = Math.max(dMu, Math.abs(sc.p - cw.p), Math.abs(sc.rt - cw.steps * Lt.DT) / (cw.steps * Lt.DT));
    }
    const costs = Lt.rowCosts(() => 0.1, 1500), Kx = Lt.exactWalls(costs, mu), kb = Lt.bestConstantK(0.1, mu);
    for (let n = 0; n < 200; n++) if (Lt.effectiveWall(Kx, n) !== kb) offMu++;
    dMu = Math.max(dMu, Math.abs(Kx.value - Lt.scoreWalls(Kx, costs, mu).reward));
  }
  check("machine at other strengths (0.4 to 2.5): scoring vs gambler's ruin, and DP value vs forward score", dMu, 1e-9);
  check("machine at other strengths: optimal bounds for a steady cost = best constant bounds", offMu, 0);
  const step = (c0, c1, t0, w = 0.05) => (t) => c0 + (c1 - c0) / (1 + Math.exp(-(t - t0) / w));
  const sched = [step(0.1, 1.6, 0.5), step(0.4, 0.05, 0.3), (t) => 0.1 + 0.8 * Math.max(t - 0.5, 0)];
  sched.push((t) => (t <= 1 + 1e-12 ? 0.1 : Infinity));
  let dLoss = 0;
  sched.forEach((f, i) => {
    const costs = Lt.rowCosts(f, i === 3 ? 100 : 1000);
    const e = Lt.scoreWalls(Lt.exactWalls(costs), costs), pmw = Lt.scoreWalls(Lt.perMomentWalls(costs), costs);
    const py = show.schedules[i].loss.per_moment;
    dLoss = Math.max(dLoss, Math.abs(100 * (e.reward - pmw.reward) - py) / py);
  });
  // The board's steps are coarse (0.1), so its losses run a few percent under the paper's, all in
  // the same direction; the gap shrinks with the step (under 4% at 0.05).
  check("machine: per-moment loss on the board vs the paper's (4 showcase schedules)", dLoss, 0.12, " (relative)");
  const costs = Lt.rowCosts(step(0.1, 1.6, 0.5), 1000), K = Lt.exactWalls(costs), ex = Lt.scoreWalls(K, costs);
  const rb = new Rng(4242), N = quick ? 20000 : 100000;
  let ok = 0, tt = 0, t2 = 0;
  for (let i = 0; i < N; i++) { const b = Lt.dropBall(K, 1000, rb); if (b.k > 0 || (b.k === 0 && rb.next() < 0.5)) ok++; const t = b.n * Lt.DT; tt += t; t2 += t * t; }
  const sdT = Math.sqrt(t2 / N - (tt / N) ** 2);
  check("machine: dropped balls' accuracy vs exact", Math.abs(ok / N - ex.p) / Math.sqrt((ex.p * (1 - ex.p)) / N), 4, " standard errors");
  check("machine: dropped balls' mean time vs exact", Math.abs(tt / N - ex.rt) / (sdT / Math.sqrt(N)), 4, " standard errors");
}

// 4d. The machine's look-ahead light: the board's kernel for walls held at a level, against the
// paper's closed forms at the same bound b = level * step (mean look-ahead, Corollary 2(b), and the
// whole shape from the series of Lemma 1(a)), and at the board's best walls for cost 0.1 against
// the paper's stated look-ahead.
{
  const meanAt = (b) => 0.5 + (2 * b * (b * Math.tanh(b) - 1)) / (Math.sinh(2 * b) + 2 * b);
  const cdfAt = (b, s) => {
    let tot = 0, part = 0;
    for (let j = 0; j < 4000; j++) {
      const k = ((j + 0.5) * Math.PI) / b, a = ((2 / b) * k * k) / (1 + k * k), al = (1 + k * k) / 2;
      tot += a / al; part += (a / al) * (1 - Math.exp(-al * s));
    }
    return part / tot;
  };
  const gaps = (levels) => {
    let dMean = 0, dShape = 0;
    for (const L of levels) {
      const r = Lt.lookAhead(L), b = L * Lt.DELTA;
      dMean = Math.max(dMean, Math.abs(r.mean / meanAt(b) - 1));
      const tot = r.alive.reduce((a, v) => a + v, 0);
      let acc = 0;
      r.alive.forEach((a, s) => { acc += a; dShape = Math.max(dShape, Math.abs(acc / tot - cdfAt(b, (s + 1) * Lt.DT))); });
    }
    return [dMean, dShape];
  };
  // the board's coarse step shows most at the narrowest walls, so they get their own limits
  const [mWide, sWide] = gaps([6, 10, 13, 19, 25, 40]), [mNarrow, sNarrow] = gaps([3]);
  check("machine: look-ahead's mean reach vs the paper's formula (bounds 0.6 to 4.0)", mWide, 0.015, " (relative)");
  check("machine: look-ahead's shape vs the paper's series, largest gap in cumulative weight (bounds 0.6 to 4.0)", sWide, 0.025);
  check("machine: the same for the narrowest bounds, 0.3 (mean, relative; shape)", Math.max(mNarrow / 0.04, sNarrow / 0.05), 1, " of the limits 4% and 0.05");
  const tex = readFileSync("paper/generated/numbers.tex", "utf8");
  const tenth = +tex.match(/\\newcommand\{\\LookAheadTenth\}\{([^}]*)\}/)[1];
  const r = Lt.lookAhead(Lt.bestConstantK(0.1));
  check(`machine: look-ahead at cost 0.1 on the board vs the paper's ${tenth}`, Math.abs(r.mean / tenth - 1), 0.04, " (relative)");
  // the look-ahead rule on the board (the 2025 walls averaged under the weights, at its own level)
  // against the best walls, over the first 1.5 time units of four schedules like the showcase's
  const step = (c0, c1, t0, w) => (t) => c0 + (c1 - c0) / (1 + Math.exp(-(t - t0) / w));
  let ruleMean = 0, pmMean = 0, ruleMax = 0;
  for (const [f, rows] of [[step(0.1, 1.6, 0.6, 0.015), 1500], [step(0.4, 0.05, 0.3, 0.05), 1500], [(t) => 0.1 + 0.8 * Math.max(t - 0.5, 0), 1500], [(t) => (t <= 1 + 1e-12 ? 0.1 : Infinity), 100]]) {
    const costs = Lt.rowCosts(f, rows), ex = Lt.exactWalls(costs), pm = Lt.perMomentWalls(costs), N = Math.min(rows, 150);
    let sr = 0, sp = 0;
    for (let n = 0; n < N; n++) {
      const best = Lt.effectiveWall(ex, n), d = Math.abs(Lt.lookAheadRule(pm, n, rows, 1, best) - best);
      sr += d; sp += Math.abs(Lt.effectiveWall(pm, n) - best);
      if (rows - n > 5) ruleMax = Math.max(ruleMax, d);
    }
    ruleMean = Math.max(ruleMean, sr / N); pmMean = Math.max(pmMean, sp / N);
  }
  check(`machine: look-ahead rule vs the best bounds, mean gap per schedule (the 2025 rule's: up to ${pmMean.toFixed(1)})`, ruleMean, 1, " pegs");
  check("machine: look-ahead rule vs the best bounds, largest gap (away from the last 0.05 before a deadline)", ruleMax, 1.5, " pegs");
}

// 4e. What it could be good for: the scenario prints' curves and the losses typed in their text
// equal the stored results; "one correct answer in 780" follows from the median loss.
{
  const html = readFileSync("site/index.html", "utf8");
  const typed = [...html.matchAll(/data-s="(\d)\.(pm|wb)">([^<]*)</g)];
  const bad = typed.filter(([, i, k, v]) => v !== stored[+i].loss[k].toFixed(k === "pm" ? 2 : 3)).length;
  check(`scenarios: losses in the text equal the stored results (${typed.length})`, bad + (typed.length === 22 ? 0 : 1) + (site.showcase.length === stored.length ? 0 : 1), 0);
  let dCurve = 0;
  site.showcase.forEach((r, i) => {
    const py = stored[i];
    for (const k of ["t", "cost", "exact", "pm", "wb"]) {
      r[k].forEach((v, j) => {
        const p = py[k][py.stride * j];
        if (v == null) { if (p != null && Number.isFinite(p)) dCurve = Infinity; return; }
        dCurve = Math.max(dCurve, Math.abs(v - p));
      });
    }
  });
  check("scenarios: the prints' curves equal the stored results", dCurve, 5e-5);
  const losses = site.held.map((r) => r[3]).sort((a, b) => a - b), mid = losses.length / 2;
  const median = losses.length % 2 ? losses[Math.floor(mid)] : (losses[mid - 1] + losses[mid]) / 2;
  const per = 100 / median, said = +html.match(/one correct answer in (\d+) decisions/)[1];
  check("scenarios: decisions per correct answer's worth, from the unrounded median loss", Math.abs(Math.round(per / 10) * 10 - said), 0);
}

// 4f. The walkthrough: every number in its sentences comes from the ball's own path. Balls are
// dropped on five boards (the default rise, deadlines at 0.6 and 0.65, a steady cost, and a rise
// steep enough that the walls reach the middle), at three strengths on the default; at every row the
// sentence's readings, confidence, wall (the one the board draws), and time are read back and
// compared with the path and the lattice, and so is each outcome's row, side, reason, and cost
// of time. The "best walls close early" claim holds where it is made: the cost within 1% of its
// start and at least a tenth of a time unit before the change.
const num = (re, str) => { const m = re.exec(str); return m ? Number(m[1]) : NaN; };
{
  const logistic = (x) => 1 / (1 + Math.exp(-x));
  const riseOf = (c0, f, at) => (t) => c0 + (c0 * f - c0) * logistic((t - at) / 0.015);
  const boards = [
    { name: "rise", f: riseOf(0.1, 16, 0.6), rows: 1500, mus: [1, 0.6, 1.8] },
    { name: "deadline", f: (t) => (t <= 0.6 + 1e-12 ? 0.1 : Infinity), rows: 60, mus: [1], deadline: true },
    { name: "deadline, odd row", f: (t) => (t <= 0.65 + 1e-12 ? 0.1 : Infinity), rows: 65, mus: [1], deadline: true },
    { name: "steady", f: () => 0.1, rows: 1500, mus: [1] },
    { name: "steep rise", f: riseOf(0.3, 32, 0.6), rows: 1500, mus: [1] },
  ];
  let bad = 0, sentences = 0, outcomes = 0;
  const reasons = { deadline: 0, cost: 0 };
  const rw = new Rng(777);
  for (const bd of boards) for (const mu of bd.mus) {
    const costs = Lt.rowCosts(bd.f, bd.rows), K = Lt.exactWalls(costs, mu), R = bd.rows;
    const wallAt = (n) => (n >= R ? 0 : Lt.effectiveWall(K, Math.min(n, K.length - 2)));
    for (let i = 0; i < (quick ? 60 : 300); i++) {
      let k = 0, n = 0, right = 0;
      for (;;) {
        const decides = n >= R || Math.abs(k) >= K[n], W = wallAt(n);
        const say = Wc.sayReadings({ n, k, mu }), wall = Wc.sayWall({ k, wall: W, mu, decides, deadline: Boolean(bd.deadline) });
        sentences += 2;
        if (n > 0) {
          if (num(/Row (\d+),/, say) !== n || num(/: (\d+) pointed right/, say) !== right || num(/and (\d+) left/, say) !== n - right) bad++;
          if (Math.abs(num(/, ([\d.]+) time units in/, say) - n * Lt.DT) > 0.005 + 1e-9) bad++;
          const g = k === 0 ? 0.5 : Lt.posterior(Math.abs(k), mu), shown = k === 0 ? 50 : num(/it's (\d+)% sure/, say);
          if (Math.abs(shown - 100 * g) > 0.5 + 1e-9) bad++;
          if (k !== 0 && !say.includes(`the ${k > 0 ? "right" : "left"} side is clear`)) bad++;
        }
        if (W > 0) {
          if (num(/is (\d+) pegs? out/, wall) !== W || Math.abs(num(/once it's (\d+)% sure/, wall) - 100 * Lt.posterior(W, mu)) > 0.5 + 1e-9) bad++;
          if (wall.includes("keeps looking") === decides) bad++;
        } else if (wall.includes("time is up") !== Boolean(bd.deadline)) bad++;
        if (decides) break;
        const up = rw.next() < Lt.pUp(mu);
        k += up ? 1 : -1; if (up) right++; n++;
      }
      const why = n >= R ? (bd.deadline ? "deadline" : "limit") : K[n] === 0 ? (bd.deadline ? "deadline" : "cost") : false;
      const correct = k > 0 || (k === 0 && rw.next() < 0.5);
      let paid = 0; for (let j = 0; j < n; j++) paid += Math.min(costs[j], 1e9) * Lt.DT;
      const spent = Wc.spentBy(costs, n), out = Wc.sayOutcome({ n, k, mu, correct, forced: why, spent });
      outcomes++;
      if (why) reasons[why] = (reasons[why] || 0) + 1;
      if (Math.abs(spent - paid) > 1e-12 || Math.abs(num(/minus ([\d.]+) for/, out) - spent) > 0.0005 + 1e-12) bad++;
      if (!why && num(/bound at row (\d+)/, out) !== n) bad++;
      if (!why && correct && Math.abs(num(/row \d+, (\d+)% sure/, out) - 100 * Lt.posterior(Math.abs(k), mu)) > 0.5 + 1e-9) bad++;
      if (!why && !correct && num(/fooled it: (\d+) of its/, out) !== n - right) bad++;
      if (why === "deadline" && !/ran out of time at row (\d+)/.test(out)) bad++;
      if (why === "cost" && !/waiting cost more than another reading/.test(out)) bad++;
      if (out.includes("swerved right") !== correct) bad++;
    }
  }
  check(`walkthrough: readings, confidence, bounds, times, and outcomes in ${sentences + outcomes} sentences on 5 boards match the balls' paths`, bad, 0);
  // (on this lattice a steep cost never forces a choice: walls of one peg on alternate rows catch
  // every ball first; a deadline on an odd row does force some)
  check("walkthrough: cars forced by the deadline occur, and are said so", reasons.deadline > 0 ? 0 : 1, 0);
  let early = 0;
  for (const [f, rows, change] of [[riseOf(0.1, 16, 0.6), 1500, 60], [(t) => (t <= 0.6 + 1e-12 ? 0.1 : Infinity), 60, 60], [(t) => 0.1 + 0.8 * Math.max(t - 0.5, 0), 1500, 50]]) {
    const costs = Lt.rowCosts(f, rows), ex = Lt.exactWalls(costs), pm = Lt.perMomentWalls(costs);
    const e = Wc.earlyLead(ex, pm, costs, 400, change);
    if (!(e.d > 0) || !(costs[e.n] <= 1.01 * costs[0]) || e.n > change - 10 || Lt.effectiveWall(pm, e.n) - Lt.effectiveWall(ex, e.n) !== e.d) early++;
  }
  check("walkthrough: the best bounds run inside the 2025 rule's while the cost is within 1% of its start, a tenth of a unit or more before the change (3 schedules)", early, 0);
}

// 4g. The theme dial: at every one of its 360 positions, in both themes, every color it turns meets
// 4.5:1 on every surface of its theme, the colors that appear together stay apart (OKLab distance),
// and at rest the colors are the ones site.css prints.
{
  const css = readFileSync("site/css/site.css", "utf8");
  const PAIRS = [["right", "left"], ["right", "accent-print"], ["left", "accent-print"], ["accent-print", "wb"], ["accent-print", "pm"], ["wb", "pm"]];
  let low = 0, near = 9, nearAt = "";
  for (let h = 0; h < 360; h++) {
    const p = Tn.dialProperties(h);
    for (const theme of ["light", "dark"]) {
      for (const key of Object.keys(Tn.PRINTED[theme])) if (Math.min(...Tn.SURFACES[theme].map((sf) => Tn.contrast(p[`--dial-${theme}-${key}`], sf))) < 4.5 - 1e-9) low++;
      for (const [a, b] of PAIRS) { const d = Tn.oklabDistance(p[`--dial-${theme}-${a}`], p[`--dial-${theme}-${b}`]); if (d < near) { near = d; nearAt = `${theme}, ${a} and ${b}, ${h} degrees`; } }
    }
  }
  check("theme dial: every turned color reads at 4.5:1 or more on its theme's surfaces (360 positions, 2 themes)", low, 0);
  rows.push(["", `  theme dial: closest pair that appears together: ${near.toFixed(3)} (${nearAt})`, "", ""]);
  check("theme dial: colors that appear together stay at least 0.08 apart in OKLab at every position", Math.max(0.08 - near, 0), 0);
  let restOff = 0;
  for (const theme of ["light", "dark"]) for (const [key, hex] of Object.entries(Tn.PRINTED[theme])) if (!css.includes(`var(--dial-${theme}-${key}, ${hex})`)) restOff++;
  check("theme dial: at rest, the colors are the ones site.css prints", restOff, 0);
}

// 5. The held-out schedules: the page's cost formulas and its recomputed losses.
{
  let dCost = 0;
  held.forEach((h, i) => {
    const f = costFor(h);
    for (const [t, c] of ref.probes[i]) {
      const v = f(t);
      dCost = Math.max(dCost, c === null || !Number.isFinite(c) ? (Number.isFinite(v) ? Infinity : 0) : Math.abs(v - c) / c);
    }
  });
  check("held-out: cost formulas vs Python at probe times", dCost, 1e-9, " (relative)");
  const pick = held.map((h, i) => [h, i]).filter(([, i]) => !quick || i % 7 === 0);
  let dPm = 0, dWb = 0, rel = 0, relWb = 0, worstName = "";
  const t0 = Date.now();
  for (const [h] of pick) {
    const r = computeSchedule({ kind: "heldout", family: h.family, p: h.p, horizon: h.horizon });
    const ePm = Math.abs(r.loss.pm - h.loss[0]), eWb = Math.abs(r.loss.wb - h.loss[1]);
    if (ePm > dPm) { dPm = ePm; worstName = h.name; }
    dWb = Math.max(dWb, eWb);
    relWb = Math.max(relWb, (eWb - 0.002) / Math.max(h.loss[1], 1e-9));
    rel = Math.max(rel, (ePm - 0.02) / Math.max(h.loss[0], 1e-9));
  }
  check(`held-out (${pick.length}): per-moment loss vs Python, absolute`, dPm, 0.12, " points per 100");
  check(`held-out (${pick.length}): weighted loss vs Python, absolute`, dWb, 0.03, " points per 100");
  check(`held-out (${pick.length}): per-moment loss, beyond 0.02 points, relative`, Math.max(rel, 0), 0.05);
  check(`held-out (${pick.length}): weighted loss, beyond 0.002 points, relative`, Math.max(relWb, 0), 0.5);
  rows.push(["", `  worst per-moment schedule: ${worstName}; ${((Date.now() - t0) / 1000).toFixed(0)} s`, "", ""]);
}

// 6. The decisions on the page: the dots carry the evidence, and the trials match the model.
{
  const rng = new Rng(20261112);
  let lag = 0, mismatch = 0, crowd = 0, frames = 0;
  for (const C of COHERENCES) {
    const mu = driftFor(C), b = M.bestBound(mu, 0.19);
    const frameDt = (2.5 * M.meanTime(b, mu)) / (2.4 * 60);
    for (let k = 0; k < 120; k++) {
      const field = new DotField({ rng });
      field.reset(dotsPerUnit(frameDt));
      const tr = new Trial({ mu, b, rng });
      let shown = 0;
      while (!tr.done) {
        tr.advance(tr.t + frameDt);
        const f = field.frame(tr.x);
        shown += f.R - f.L;
        frames++;
        lag = Math.max(lag, Math.abs(f.lag));
        if (f.R - f.L !== f.net || shown !== Math.round(field.kappa * tr.x)) mismatch++;
        if (f.R + f.L > field.n) crowd++;
      }
    }
  }
  check(`dots: running net steps = rounded evidence, every frame (${frames} frames)`, mismatch + lag, 0);
  check("dots: never more steppers than dots", crowd, 0);

  // The page plays a trial frame by frame and draws the dots from their own random stream, so
  // its trials are the same, bit for bit, as trials run straight to the decision: check that on
  // 2,000 trials per case, then check accuracy and mean time on 100,000 straight runs per case.
  let zp = 0, zt = 0, rawP = 0, rawT = 0, differ = 0;
  for (const [C, cost] of [[0.032, 0.05], [0.064, 0.29], [0.128, 0.29], [0.512, 1.5]]) {
    const mu = driftFor(C), b = M.bestBound(mu, cost), N = quick ? 20000 : 100000;
    const frameDt = Math.min(Math.max(2.5 * M.meanTime(b, mu), 0.1), 12) / (2.4 * 60);
    const seed = Math.round(C * 1e4) + 7;
    const ra = new Rng(seed), rb = new Rng(seed), field = new DotField({ rng: new Rng(dotSeed(seed)) });
    for (let k = 0; k < 2000; k++) {
      const ta = new Trial({ mu, b, rng: ra });
      field.reset(dotsPerUnit(frameDt));
      while (!ta.done) { ta.advance(ta.t + frameDt); field.frame(ta.x); }
      const tb = new Trial({ mu, b, rng: rb }).finish();
      if (ta.t !== tb.t || ta.x !== tb.x || ta.choice !== tb.choice) differ++;
    }
    const r2 = new Rng(seed + 1);
    let correct = 0, s = 0, s2 = 0;
    for (let k = 0; k < N; k++) {
      const tr = new Trial({ mu, b, rng: r2 }).finish();
      if (tr.correct) correct++;
      s += tr.t; s2 += tr.t * tr.t;
    }
    const e = expected(b, mu, cost), p = correct / N, mt = s / N, sd = Math.sqrt(s2 / N - mt * mt);
    rawP = Math.max(rawP, Math.abs(p - e.p)); rawT = Math.max(rawT, Math.abs(mt - e.t) / e.t);
    // in standard errors, after allowing for the monitoring step (0.002 in paper units)
    zp = Math.max(zp, Math.max(Math.abs(p - e.p) - 0.002, 0) / Math.sqrt((e.p * (1 - e.p)) / N));
    zt = Math.max(zt, Math.max(Math.abs(mt - e.t) - 0.01 * e.t, 0) / (sd / Math.sqrt(N)));
  }
  check("trials: played frame by frame with dots = run straight (8,000 trials)", differ, 0);
  rows.push(["", `  trials: largest raw gaps, accuracy ${rawP.toFixed(4)}, mean time ${(100 * rawT).toFixed(2)}%`, "", ""]);
  check("trials: accuracy vs closed form, beyond 0.002", zp, 4, " standard errors");
  check("trials: mean time vs closed form, beyond 1%", zt, 4, " standard errors");
}

// 7. The working examples beside the prints. The car (car-model.js), the goalkeeper
// (keeper-model.js), the walking robot (robot-model.js, with its cost peaking at each footfall and
// steady), the field recorder (recorder-model.js), and the lander (lander-model.js), each three
// deciders (lanes.js): their three wall sets are the lattice's own, the look-ahead walls are the
// paper's rule on the board, the exact scores are the forward-scored rewards, the three see the same
// readings, simulated runs agree with the exact scores, and the runs beside each scene (runs.js)
// agree with the exact commit times, successes, doubt, and wait; the keeper's, the robot's, the
// recorder's, and the lander's numbers and claims in their text hold; the recycling sorter
// (sorter-model.js), four speeds each with its own deadline, mixed. The lab test (lab-model.js),
// with the penalty climbing and lifting: its unit, every number its text states, and its trials
// against the closed forms. And every print's readout says the stored values.
{
  const html = readFileSync("site/index.html", "utf8");
  // the same checks for each scene of three deciders (lanes.js): the car, the goalkeeper, the robot,
  // the recorder, and the lander
  function laneChecks({ name, many, per, m, costs, py, tolWb, forced, forcedSaid, at }) {
    const rowsN = costs.length;
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const ex = Lt.exactWalls(costs), pm = Lt.perMomentWalls(costs);
    let start = Lt.effectiveWall(pm, 0), offWb = 0;
    for (let n = 0; n < rowsN; n++) {
      const x = Lt.lookAheadRule(pm, n, rowsN, 1, start); start = x;
      if (m.walls.wb[n] !== Math.ceil(x - 1e-9)) offWb++;
    }
    // the root does not depend on where the search starts (from the best wall instead): the same to
    // a thousandth of a reading (40 halvings from a farther start can stop that short), and the same
    // wall once rounded up
    let offStart = 0;
    for (let n = 0; n < rowsN; n += 5) {
      const x = Lt.lookAheadRule(pm, n, rowsN, 1, Lt.effectiveWall(ex, n));
      if (Math.abs(x - m.levels[n]) > 1e-3 || Math.ceil(x - 1e-9) !== m.walls.wb[n]) offStart++;
    }
    check(`${name}: best and 2025 bounds equal the lattice's, look-ahead bounds equal the rule rounded up (${rowsN} rows)`, (same(m.walls.ex, ex) ? 0 : 1) + (same(m.walls.pm, pm) ? 0 : 1) + offWb, 0);
    check(`${name}: the look-ahead rule's level is the same from either start`, offStart, 0);
    // the best walls' score is the dynamic program's own value (two different computations), and no
    // rule beats it
    const dDp = Math.abs(m.exact.ex.points / 100 - ex.value), beaten = Ln.RULES.filter((r) => m.exact[r.key].points > m.exact.ex.points + 1e-9).length;
    let dSpent = 0, paid = 0;
    for (let n = 0; n <= rowsN; n++) { dSpent = Math.max(dSpent, Math.abs(m.spent[n] - paid)); if (n < rowsN) paid += Math.min(costs[n], 1e9) * Lt.DT; }
    check(`${name}: the best bounds' exact score equals the dynamic program's value, no rule beats it, and each run pays its rows' costs`, dDp + beaten + dSpent, 1e-9);
    const lossPm = m.exact.ex.points - m.exact.pm.points, lossWb = m.exact.ex.points - m.exact.wb.points;
    rows.push(["", `  ${name}: 2025 rule gives up ${lossPm.toFixed(3)}, look-ahead ${lossWb.toFixed(3)}${py ? ` (paper's model, continuous: ${py.pm}, ${py.wb})` : ""}`, "", ""]);
    if (py) {
      check(`${name}: the board's losses vs the paper's model for the same schedule (2025 rule, relative)`, Math.abs(lossPm - py.pm) / py.pm, 0.12);
      check(`${name}: the board's losses vs the paper's model for the same schedule (look-ahead, absolute)`, Math.abs(lossWb - py.wb), tolWb, " points per 100");
    }
    if (forcedSaid != null) check(`${name}: the 2025 rule's share forced at the ${at}, as the text says`, Math.abs(forcedSaid - Math.round(100 * m.exact.pm.forced)) + (forced ? 0 : 1), 0);
    // the same readings for all three: each rule's decider, run on its own from the same seed,
    // decides where it does in the shared run
    let differ = 0;
    for (let i = 0; i < 3000; i++) {
      const run = Ln.runLanes(m, new Rng(9000 + i));
      for (const r of Ln.RULES) {
        const rr = new Rng(9000 + i), z = rr.next() < 0.5 ? 1 : -1, P = Lt.pUp(1), K = m.walls[r.key];
        let k = 0, n = 0, path = [0];
        for (let j = 0; j < rowsN; j++) path.push(path[j] + (rr.next() < P ? 1 : -1) * z);
        while (n < rowsN && Math.abs(path[n]) < K[n]) n++;
        k = path[n];
        const tie = rr.next() < 0.5 ? 1 : -1, choice = k > 0 ? 1 : k < 0 ? -1 : tie, d = run.decide[r.key];
        if (d.n !== n || d.choice !== choice || d.correct !== (choice === z) || run.z !== z) differ++;
      }
    }
    check(`${name}: the three ${many} see the same readings (3,000 ${per}, each rule run alone)`, differ, 0);
    const rc = new Rng(20261113), N = quick ? 4000 : 20000, acc = Object.fromEntries(Ln.RULES.map((r) => [r.key, [0, 0]]));
    for (let i = 0; i < N; i++) { const run = Ln.runLanes(m, rc); for (const r of Ln.RULES) { const p = run.decide[r.key].points; acc[r.key][0] += p; acc[r.key][1] += p * p; } }
    let zRun = 0;
    for (const r of Ln.RULES) {
      const [s1, s2] = acc[r.key], mean = s1 / N, sd = Math.sqrt(s2 / N - mean * mean);
      zRun = Math.max(zRun, Math.abs(100 * mean - m.exact[r.key].points) / ((100 * sd) / Math.sqrt(N)));
    }
    check(`${name}: running scores after ${N.toLocaleString("en-US")} ${per} vs exact`, zRun, 4, " standard errors");

    // The runs beside the scene (runs.js). Each rule's exact commit times are a whole
    // distribution: they sum to one, their mean is the exact mean time, the last row is the
    // forced share, and what they pay for doubt is the exact doubt, which the successes less
    // equal the exact score.
    let offWhen = 0;
    for (const r of Ln.RULES) {
      const e = m.exact[r.key];
      let tot = 0, mean = 0, paidW = 0;
      e.when.forEach((v, n) => { tot += v; mean += v * n * Lt.DT; paidW += v * m.spent[n]; });
      offWhen = Math.max(offWhen, Math.abs(tot - 1), Math.abs(mean - e.rt), Math.abs(e.when[rowsN] - e.forced), Math.abs(paidW - e.paid), Math.abs(100 * (e.p - e.paid) - e.points) / 100);
    }
    check(`${name}: each rule's exact commit times sum to one and give its mean time, forced share, doubt paid, and score`, offWhen, 1e-9);
    // the tally the page keeps, over many runs: every bar of the strip, the forced bar, the
    // successes, the doubt, and the mean wait against their exact values, in standard errors (the
    // bars binomial); and its points are its successes less its doubt
    const tally = Runs.newTally(m), rs = new Rng(20261114), NR = quick ? 6000 : 30000;
    for (let i = 0; i < NR; i++) Runs.addRun(tally, m, Ln.runLanes(m, rs));
    let zBar = 0, zSum = 0, offSum = 0, bars = 0;
    for (const r of Ln.RULES) {
      const ex = Runs.exactBins(m, r.key), a = tally.rule[r.key], s = Runs.summary(tally, r.key), e = m.exact[r.key];
      // each bar's count against its expected count on the square-root scale (Freeman and Tukey),
      // which keeps the tail of a small count near normal; for a large count it is the usual score
      const zb = (count, p) => (p > 0 ? Math.abs(Math.sqrt(count) + Math.sqrt(count + 1) - Math.sqrt(4 * NR * p + 1)) : count > 0 ? Infinity : 0);
      // bars expected to hold fewer than 5 runs are pooled into one, where the normal reckoning holds
      const pool = [0, 0];
      [...Array.from(ex.bins, (p, j) => [a.bins[j], p]), [a.forced, ex.forced]].forEach(([c, p]) => {
        if (NR * p < 5) { pool[0] += c; pool[1] += p; } else { zBar = Math.max(zBar, zb(c, p)); bars++; }
      });
      if (pool[1] > 0 || pool[0] > 0) zBar = Math.max(zBar, zb(pool[0], pool[1]));
      // the successes are binomial; the doubt and the wait use their own spread over the runs
      let d2 = 0, w2 = 0;
      e.when.forEach((v, n) => { d2 += v * m.spent[n] ** 2; w2 += v * (n * Lt.DT) ** 2; });
      const sdD = Math.sqrt(Math.max(d2 - e.paid ** 2, 0)), sdW = Math.sqrt(Math.max(w2 - e.rt ** 2, 0));
      zSum = Math.max(zSum,
        Math.abs(s.saves / 100 - e.p) / Math.sqrt((e.p * (1 - e.p)) / NR),
        Math.abs(s.doubt / 100 - e.paid) / (sdD / Math.sqrt(NR)),
        Math.abs(s.wait - e.rt) / (sdW / Math.sqrt(NR)));
      offSum = Math.max(offSum, Math.abs(s.saves - s.doubt - s.points));
    }
    check(`${name}: the strip's bars and forced share after ${NR.toLocaleString("en-US")} ${per} vs exact (${bars} bars, the rarest pooled)`, zBar, 4.5, " standard errors");
    check(`${name}: the table's successes, doubt, and mean wait after ${NR.toLocaleString("en-US")} ${per} vs exact`, zSum, 4, " standard errors");
    // the 2025 rule's gap, which the sentence states with its sampling error (the three see the
    // same readings, so the error is the paired one)
    const gPm = Runs.summary(tally, "pm");
    check(`${name}: the table's points are successes less doubt, and the 2025 rule's gap is within its sampling error of exact`, offSum + (Math.abs(gPm.gap - lossPm) <= 4 * gPm.se ? 0 : 1), 1e-9);
    return { lossPm, lossWb };
  }
  const car = Car.carWalls();
  laneChecks({ name: "car", many: "cars", per: "cars", m: car, costs: Lt.rowCosts(() => Car.CAR.c0, Car.ROWS), py: { pm: show.schedules[3].loss.per_moment, wb: show.schedules[3].loss.weighted },
    tolWb: 0.02, forced: true, forcedSaid: +html.match(/data-car-n="forcedPm">(\d+)</)[1], at: "line" });
  // The goalkeeper. Its look-ahead walls are the rule rounded up to whole cues, up to a cue more
  // patient than the smooth rule; on this schedule the smooth rule is a little too eager, so the
  // rounding helps (the text says so), and the board's loss sits further from the smooth one's.
  const gk = Gk.keeperModel(), gkNums = Gk.keeperNumbers(gk);
  const gkLoss = laneChecks({ name: "keeper", many: "keepers", per: "kicks", m: gk, costs: Lt.rowCosts(Gk.keeperCost, Gk.ROWS), py: scenes.keeper.loss,
    tolWb: 0.05, forced: true, forcedSaid: +html.match(/data-gk-n="forcedPm">(\d+)</)[1], at: "kick" });
  check("keeper: rounding helps the look-ahead rule here, as the text says (board loss below the smooth model's)", gkLoss.lossWb < scenes.keeper.loss.wb ? 0 : 1, 0);
  const typedGk = [...html.matchAll(/data-gk-n="(\w+)">([^<]*)</g)];
  const badGk = typedGk.filter(([, k, v]) => gkNums[k] !== v).length;
  const kp = Gk.KEEPER, kpText = html.slice(html.indexOf('id="keeper"'), html.indexOf("</figure>", html.indexOf('id="keeper"')));
  const words = [
    // "a sixth of a save": the cost from the start of the run-up to the kick
    Math.abs(gkNums.waitAll - 1 / 6) < 1e-12 && kpText.includes("paid a sixth of a save"),
    // "climbs 36-fold" and its formula, c(t) = 0.04 / (1.2 − t)²
    Math.abs(gkNums.rise - 36) < 1e-9 && kpText.includes("climbs 36-fold"),
    Math.abs(kp.kappa * kp.ts - 0.04) < 1e-12 && Math.abs(kp.kick + kp.ts - 1.2) < 1e-12 && kpText.includes("c(t) = 0.04 / (1.2 − t)²"),
  ].filter((ok) => !ok).length;
  check(`keeper: numbers in its text equal the model's (${typedGk.length} computed, 3 typed)`, badGk + words + (typedGk.length === 5 ? 0 : 1), 0);
  // "stays above the best bound the whole way and is still open at the kick" (the stored curves)
  const sk = scenes.keeper;
  let below = 0;
  sk.t.forEach((t, j) => { if (t < kp.kick - 1e-9 && !(sk.pm[j] > sk.exact[j])) below++; });
  check("keeper: the 2025 rule's bound stays above the best bound until the kick and is still open there", below + (sk.pm[sk.t.length - 1] > 0 && sk.exact[sk.t.length - 1] === 0 ? 0 : 1), 0);

  // The walking robot, with the cost peaking at each footfall and with a steady cost. On the
  // rhythm the look-ahead rule's walls round to whole readings while they swing, so the board's
  // loss sits further from the smooth model's than the car's does.
  const rb = Rb.robotModel(false), rbFlat = Rb.robotModel(true), rbNums = Rb.robotNumbers(rb, rbFlat);
  laneChecks({ name: "robot", many: "robots", per: "rocks", m: rb, costs: Lt.rowCosts((t) => Rb.robotCost(t), Rb.ROWS), py: scenes.robot.loss, tolWb: 0.05, at: "rock" });
  const flatLoss = laneChecks({ name: "robot, steady cost", many: "robots", per: "rocks", m: rbFlat, costs: Lt.rowCosts((t) => Rb.robotCost(t, true), Rb.ROWS), py: null, at: "rock" });
  const typedRb = [...html.matchAll(/data-rb-n="(\w+)">([^<]*)</g)];
  const badRb = typedRb.filter(([, k, v]) => rbNums[k] !== v).length;
  check(`robot: numbers in its text equal the model's (${typedRb.length})`, badRb + (typedRb.length === 10 ? 0 : 1), 0);
  const rbText = html.slice(html.indexOf('id="scn-steady"'), html.indexOf("</figure>", html.indexOf('id="scn-steady"')));
  const R0 = Rb.ROBOT, sr = scenes.robot;
  // the bounds' swing and lead over a step, from the stored curves (the paper's package): a fitted
  // sinusoid at the steps' rate, from t = 0.5 to 2, away from the start and the forced choice
  const fitStep = (ys) => {
    const om = (2 * Math.PI) / R0.step, A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], y = [0, 0, 0];
    sr.t.forEach((t, j) => {
      if (t < 0.5 - 1e-9 || t > 2 + 1e-9) return;
      const f = [Math.sin(om * t), Math.cos(om * t), 1];
      for (let a = 0; a < 3; a++) { y[a] += f[a] * ys[j]; for (let b = 0; b < 3; b++) A[a][b] += f[a] * f[b]; }
    });
    for (let i = 0; i < 3; i++) for (let r2 = 0; r2 < 3; r2++) if (r2 !== i) { const f = A[r2][i] / A[i][i]; for (let c2 = 0; c2 < 3; c2++) A[r2][c2] -= f * A[i][c2]; y[r2] -= f * y[i]; }
    const [b1, b2] = [y[0] / A[0][0], y[1] / A[1][1]];
    return { amp: Math.hypot(b1, b2), phase: Math.atan2(b2, b1) };
  };
  const fEx = fitStep(sr.exact), fPm = fitStep(sr.pm);
  const lead = ((((fEx.phase - fPm.phase) * 180) / Math.PI + 540) % 360) - 180;
  rows.push(["", `  robot: the best bound leads the 2025 rule's by ${lead.toFixed(1)} degrees and swings ${(fEx.amp / fPm.amp).toFixed(3)} as far (lattice bounds: ${rbNums.swingEx} and ${rbNums.swingPm} readings)`, "", ""]);
  const saidLead = +rbText.match(/data-rb-print="lead">(\d+)</)[1];
  // "about 35°" from a fit to the stored curves, every 0.02 s (the paper's own grid, every 0.002 s,
  // gives 35.6°), and "a tenth of a step"
  check("robot: the best bound's lead over a step, as the print says (\"about\", within a degree; and a tenth of a step)", Math.max(Math.abs(lead - saidLead) - 1, 0) + (Math.abs(lead / 360 - 0.1) < 0.015 ? 0 : 1), 0, " degrees");
  check("robot: the 2025 rule's bounds swing more than three times as far as the best bounds (board and paper's model)", (rbNums.swingPm > 3 * rbNums.swingEx ? 0 : 1) + (fPm.amp > 3 * fEx.amp ? 0 : 1), 0);
  // "half its choices fall in the last tenth of a second before a footfall, against a third"
  check("robot: the 2025 rule's choices just before a footfall (a half) and the best bounds' (a third)", Math.max(Math.abs(rbNums.nearPm - 0.5), Math.abs(rbNums.nearEx - 1 / 3)), 0.05);
  // the steady cost: the three wall sets agree until the rock is near (the last second), and the
  // three robots choose alike on at least the share the text says (a bound the runs must meet)
  let part = rbFlat.rows;
  for (let n = 0; n < rbFlat.rows; n++) if (["pm", "wb"].some((k) => Lt.effectiveWall(rbFlat.walls[k], n) !== Lt.effectiveWall(rbFlat.walls.ex, n))) { part = n; break; }
  const rf = new Rng(31337), NF = quick ? 4000 : 20000;
  let alike = 0;
  for (let i = 0; i < NF; i++) { const d = Ln.runLanes(rbFlat, rf).decide; if (d.ex.n === d.pm.n && d.ex.n === d.wb.n && d.ex.choice === d.pm.choice && d.ex.choice === d.wb.choice) alike++; }
  check(`robot, steady cost: bounds agree until ${(part * Lt.DT).toFixed(2)} s, and ${NF.toLocaleString("en-US")} rocks chose alike at least as often as the text's bound`, (part * Lt.DT >= R0.rock - 1 ? 0 : 1) + (alike / NF >= +rbNums.flatSame / 100 ? 0 : 1) + (flatLoss.lossPm < 0.01 ? 0 : 1), 0);
  const ninefold = (R0.c0 * (1 + R0.swing)) / (R0.c0 * (1 - R0.swing));
  const rbWords = [
    Math.abs(ninefold - 9) < 1e-9 && rbText.includes("swings ninefold"),
    // c(t) = 0.2 (1 + 0.8 cos 4π(t − 0.25)): a step every half second is 4π a second
    R0.c0 === 0.2 && R0.swing === 0.8 && Math.abs((2 * Math.PI) / R0.step - 4 * Math.PI) < 1e-12 && R0.first === 0.25 && rbText.includes("c(t) = 0.2 (1 + 0.8 cos 4π(t − 0.25))"),
    R0.speed === 1.2 && rbText.includes("walk at 1.2 m/s"),
    R0.rock === 3 && rbText.includes("three seconds before their last step") && rbText.includes("forced choice at t = 3, here three seconds"),
    Math.abs(Lt.pUp(1) - 0.55) < 1e-12 && rbText.includes("points to the firm side 55% of the time"),
    rbText.includes("more than three times as far") && rbText.includes("less than a third as far"),
  ].filter((ok) => !ok).length;
  check("robot: the numbers typed in its text and print follow from the model (6 claims)", rbWords, 0);

  // The solar field recorder: the cost of listening falls as the sun comes up, and the choice is
  // forced when the bird stops singing.
  const rc = Rc.recorderModel(), rcNums = Rc.recorderNumbers(rc), R1 = Rc.RECORDER;
  laneChecks({ name: "recorder", many: "recorders", per: "birds", m: rc, costs: Lt.rowCosts(Rc.recorderCost, Rc.ROWS), py: scenes.recorder.loss, tolWb: 0.05,
    forced: true, forcedSaid: +html.match(/data-rc-n="forcedPm">(\d+)</)[1], at: "bird's last song" });
  const typedRc = [...html.matchAll(/data-rc-n="(\w+)">([^<]*)</g)];
  const badRc = typedRc.filter(([, k, v]) => rcNums[k] !== v).length;
  check(`recorder: numbers in its text equal the model's (${typedRc.length})`, badRc + (typedRc.length === 14 ? 0 : 1), 0);
  // the print: what the best bound and the 2025 rule's ask for in the dark (the stored curves at
  // t = 0), the best bound rising before the cost starts falling, and falling again before the end
  const sc = scenes.recorder, at = (k, t) => valueAt(sc, k, t), pct = (b) => String(Math.round(100 / (1 + Math.exp(-2 * b))));
  const rcText = html.slice(html.indexOf('id="recorder"'), html.indexOf("</article>", html.indexOf('data-scn="6"')));
  const saidRc = Object.fromEntries([...rcText.matchAll(/data-rc-print="(\w+)">([^<]*)</g)].map((m2) => [m2[1], m2[2]]));
  const rcPrint = [
    saidRc.startEx === pct(at("exact", 0)) && saidRc.startPm === pct(at("pm", 0)),
    at("exact", R1.dawn[0]) > at("exact", 0) && Math.abs(at("cost", R1.dawn[0]) - R1.hi) < 1e-3,
    at("exact", R1.stop - 0.1) < at("exact", 1) - 0.3,
  ].filter((ok) => !ok).length;
  check("recorder: the print's claims hold on the stored curves (what each asks for in the dark, rising early, falling before the end)", rcPrint, 0);
  const rcWords = [
    Math.abs(R1.hi / R1.lo - 10) < 1e-9 && rcText.includes("costs ten times less once the sun is up"),
    Math.abs(Lt.DT * R1.minutes * 60 - 6) < 1e-9 && rcText.includes("each song comes six seconds after the last"),
    Math.abs(Lt.pUp(1) - 0.55) < 1e-12 && rcText.includes("sounds like the right species 55% of the time"),
    R1.stop * R1.minutes === 30 && rcText.includes("The bird stops singing after 30 minutes"),
    R1.dawn[0] === 0.1 && R1.dawn[1] === 0.6 && rcText.includes("between t = 0.1 and 0.6, here one and six minutes after the first song") && rcText.includes("forced choice at t = 3"),
    rcText.includes('data-per="10"') && R1.minutes === 10,
  ].filter((ok) => !ok).length;
  check("recorder: the numbers typed in its text and print follow from the model (6 claims)", rcWords, 0);

  // The lander: hovering costs more once the fuel reaches its reserve, the paper's "flat, then
  // rising" schedule, whose print is its print; no lander reaches the end of its fuel.
  const ld = Ld.landerModel(), ldNums = Ld.landerNumbers(ld), L1 = Ld.LANDER;
  laneChecks({ name: "lander", many: "landers", per: "landings", m: ld, costs: Lt.rowCosts(Ld.landerCost, Ld.ROWS), py: { pm: show.schedules[2].loss.per_moment, wb: show.schedules[2].loss.weighted }, tolWb: 0.02, at: "fuel's end" });
  const typedLd = [...html.matchAll(/data-ld-n="(\w+)">([^<]*)</g)];
  const badLd = typedLd.filter(([, k, v]) => ldNums[k] !== v).length;
  check(`lander: numbers in its text equal the model's (${typedLd.length})`, badLd + (typedLd.length === 11 ? 0 : 1), 0);
  const ldText = html.slice(html.indexOf('id="lander"'), html.indexOf("</article>", html.indexOf('data-scn="2"')));
  // its cost is the stored schedule's at every stored sample (the print is the paper's)
  const p2 = site.showcase[2];
  const dCost = p2.t.reduce((mx, t, j) => Math.max(mx, Math.abs(Ld.landerCost(t) - p2.cost[j])), 0);
  const eL = ld.exact, effL = (n) => Lt.effectiveWall(ld.walls.ex, n), effP = (n) => Lt.effectiveWall(ld.walls.pm, n);
  const reserveRow = Math.round(L1.reserve / Lt.DT);
  const ldClaims = [
    // no lander reaches the end of its fuel
    Ln.RULES.every((r) => eL[r.key].forced === 0),
    // the best walls start falling before the reserve; the 2025 rule's hold until it
    effL(reserveRow - 2) < effL(0) && effP(reserveRow - 1) === effP(0),
    // the 2025 rule's landers set down clear more often, but pay more for the waiting than that earns
    eL.pm.p > eL.ex.p && eL.pm.paid - eL.ex.paid > eL.pm.p - eL.ex.p,
  ].filter((ok) => !ok).length;
  check(`lander: its cost is the print's schedule (largest gap ${dCost.toExponential(1)}), and the claims in its text hold (3)`, ldClaims + (dCost < 1e-4 ? 0 : 1), 0);
  const ldWords = [
    Math.abs(Lt.DT * L1.seconds - 0.1) < 1e-12 && ldText.includes("Each lidar scan, ten a second"),
    Math.abs(Lt.pUp(1) - 0.55) < 1e-12 && ldText.includes("points to the clear side 55% of the time"),
    L1.out * L1.seconds === 25 && ldText.includes("run out at 25 seconds"),
    L1.seconds === 10 && ldText.includes("one time unit is ten seconds") && ldText.includes("one time unit to ten seconds") && ldText.includes('data-per="10"'),
  ].filter((ok) => !ok).length;
  check("lander: the numbers typed in its text and print follow from the model (4 claims)", ldWords, 0);

  // The recycling sorter: four speeds, each the car's problem with its own deadline, mixed equally.
  // Each speed's three wall sets are the lattice's own and its best walls' score is the dynamic
  // program's value; the mix is the average of the four; the runs over mixed flakes agree with the
  // mix; and every number in its text equals the models'.
  const so = So.sorterModels(), soMix = So.sorterMix(so), soNums = So.sorterNumbers(so), S1 = So.SORTER;
  let soOff = 0;
  so.forEach((m, i) => {
    const costs = Lt.rowCosts(() => S1.c, Math.round(S1.deadlines[i] / Lt.DT));
    const ex = Lt.exactWalls(costs), pm = Lt.perMomentWalls(costs);
    if (!m.walls.ex.every((v, n) => v === ex[n]) || !m.walls.pm.every((v, n) => v === pm[n])) soOff++;
    for (let n = 0; n < m.rows; n++) if (m.walls.wb[n] !== Math.ceil(m.levels[n] - 1e-9)) soOff++;
    if (Math.abs(m.exact.ex.points / 100 - ex.value) > 1e-9 || Ln.RULES.some((r) => m.exact[r.key].points > m.exact.ex.points + 1e-9)) soOff++;
  });
  check(`sorter: at each of the ${so.length} speeds the bounds are the lattice's, the best score is the dynamic program's, and no rule beats it`, soOff, 0);
  let soMixOff = 0;
  for (const r of Ln.RULES) {
    const e = soMix.exact[r.key], avg = (f) => so.reduce((a, m) => a + f(m.exact[r.key]), 0) / so.length;
    soMixOff = Math.max(soMixOff, Math.abs(e.when.reduce((a, b) => a + b, 0) - 1), Math.abs(e.when[soMix.rows] - avg((x) => x.forced)), Math.abs(e.forced - avg((x) => x.forced)),
      Math.abs(e.p - avg((x) => x.p)), Math.abs(e.paid - avg((x) => x.paid)), Math.abs(e.rt - avg((x) => x.rt)), Math.abs(e.points - avg((x) => x.points)) / 100,
      Math.abs(100 * (e.p - e.paid) - e.points) / 100);
  }
  check("sorter: the mixed speeds' commit times sum to one, their last bar is the forced share, and their scores are the four speeds' averages", soMixOff, 1e-9);
  // the tally over mixed flakes, as the page keeps it: the strip's bars and the table against the mix
  const soT = Runs.newTally(soMix), rso = new Rng(20261115), NS = quick ? 6000 : 30000;
  for (let i = 0; i < NS; i++) { const k = Math.floor(rso.next() * so.length); Runs.addRun(soT, soMix, Ln.runLanes(so[k], rso)); }
  let zSo = 0, zSoSum = 0, soBars = 0;
  for (const r of Ln.RULES) {
    const ex = Runs.exactBins(soMix, r.key), a = soT.rule[r.key], s2 = Runs.summary(soT, r.key), e = soMix.exact[r.key];
    const zb = (count, p) => (p > 0 ? Math.abs(Math.sqrt(count) + Math.sqrt(count + 1) - Math.sqrt(4 * NS * p + 1)) : count > 0 ? Infinity : 0);
    const pool = [0, 0];
    [...Array.from(ex.bins, (p, j) => [a.bins[j], p]), [a.forced, ex.forced]].forEach(([c, p]) => { if (NS * p < 5) { pool[0] += c; pool[1] += p; } else { zSo = Math.max(zSo, zb(c, p)); soBars++; } });
    if (pool[1] > 0 || pool[0] > 0) zSo = Math.max(zSo, zb(pool[0], pool[1]));
    let d2 = 0;
    so.forEach((m) => m.exact[r.key].when.forEach((v, n) => { d2 += (v * m.spent[n] ** 2) / so.length; }));
    const sdD = Math.sqrt(Math.max(d2 - e.paid ** 2, 0));
    zSoSum = Math.max(zSoSum, Math.abs(s2.saves / 100 - e.p) / Math.sqrt((e.p * (1 - e.p)) / NS), Math.abs(s2.doubt / 100 - e.paid) / (sdD / Math.sqrt(NS)));
  }
  check(`sorter: the strip's bars and forced share after ${NS.toLocaleString("en-US")} mixed flakes vs the mix (${soBars} bars, the rarest pooled)`, zSo, 4.5, " standard errors");
  check(`sorter: the table's right share and doubt after ${NS.toLocaleString("en-US")} mixed flakes vs the mix`, zSoSum, 4, " standard errors");
  const typedSo = [...html.matchAll(/data-so-n="(\w+)">([^<]*)</g)];
  const badSo = typedSo.filter(([, k, v]) => soNums[k] !== v).length;
  check(`sorter: numbers in its text equal the models' (${typedSo.length})`, badSo + (typedSo.length === 13 ? 0 : 1), 0);
  const soText = html.slice(html.indexOf('id="sorter"'), html.indexOf('<p class="scn-key"', html.indexOf('id="sorter"')));
  const soWords = [
    Math.abs(Lt.DT * S1.ms - 0.5) < 1e-12 && soText.includes("a reading comes every half millisecond"),
    Math.abs(Lt.pUp(1) - 0.55) < 1e-12 && soText.includes("points to the flake’s plastic 55% of the time"),
    S1.jetsCm === 6 && soText.includes("The jets sit 6 cm past"),
    S1.deadlines.length === 4 && soText.includes("flakes slide at four speeds") && soText.includes("over all four speeds"),
    Math.abs(S1.c - 0.2) < 1e-12 && soText.includes("costs a fifth of a point"),
    // "the same my 2025 rule asks of every flake": its walls are the same at every speed, up to
    // each flake's deadline
    so.every((m) => { for (let n = 0; n < m.rows; n++) if (m.walls.pm[n] !== so[0].walls.pm[0]) return false; return true; }),
    // "the best walls close by each flake's deadline": lower at its last row than at its first
    so.every((m) => Lt.effectiveWall(m.walls.ex, m.rows - 1) < Lt.effectiveWall(m.walls.ex, 0)),
  ].filter((ok) => !ok).length;
  check("sorter: the numbers typed in its text follow from the model, and its bounds do what the text says (7 claims)", soWords, 0);


  // Your turn (game-model.js): the reader drives the car on the machine's three schedules against
  // the three rules on the same readings. Each schedule's walls are the lattice's and its best score
  // the dynamic program's; rounds played many times average to each rule's exact score, in points
  // and in fair points; a player who stops where a rule stops gets that rule's result, and one who
  // runs out of time goes with the readings; and the numbers and claims in its text hold.
  const gm = Game.gameModels(), gNums = Game.gameNumbers(gm), G = Game.GAME;
  let gOff = 0;
  for (const [k, kind] of Object.entries(Game.KINDS)) {
    const m = gm[k], costs = Lt.rowCosts(kind.cost, kind.rows);
    const ex = Lt.exactWalls(costs), pm = Lt.perMomentWalls(costs);
    if (m.rows !== kind.rows || !m.walls.ex.every((v, n) => v === ex[n]) || !m.walls.pm.every((v, n) => v === pm[n])) gOff++;
    for (let n = 0; n < m.rows; n++) if (m.walls.wb[n] !== Math.ceil(m.levels[n] - 1e-9)) gOff++;
    if (Math.abs(m.exact.ex.points / 100 - ex.value) > 1e-9 || Ln.RULES.some((r) => m.exact[r.key].points > m.exact.ex.points + 1e-9)) gOff++;
  }
  check("game: on each of its 3 roads the bounds are the lattice's, the best score is the dynamic program's, and no rule beats it", gOff, 0);
  const NG = quick ? 4000 : 20000, rg = new Rng(20261116);
  let zG = 0, copyOff = 0;
  for (const k of Object.keys(Game.KINDS)) {
    const m = gm[k], acc = {};
    for (const r of Ln.RULES) acc[r.key] = { s: 0, s2: 0, f: 0, f2: 0 };
    for (let i = 0; i < NG; i++) {
      const run = Game.playRound(m, rg);
      for (const r of Ln.RULES) {
        const d = run.decide[r.key], a = acc[r.key];
        a.s += d.points; a.s2 += d.points ** 2; a.f += d.fair; a.f2 += d.fair ** 2;
        if (i < 400) {
          const y = Game.yourResult(m, run, d.n, d.choice);
          if (y.points !== d.points || y.correct !== d.correct || Math.abs(y.fair - d.fair) > 1e-12 || y.forced !== d.forced) copyOff++;
        }
      }
      if (i < 400) {
        const y = Game.yourResult(m, run, m.rows + 3, 1), kk = run.path[m.rows];
        if (!y.forced || y.choice !== (kk > 0 ? 1 : kk < 0 ? -1 : run.tie) || y.n !== m.rows) copyOff++;
      }
    }
    for (const r of Ln.RULES) {
      const a = acc[r.key], e = m.exact[r.key].points / 100;
      const se = (sum, sum2) => Math.sqrt(Math.max(sum2 / NG - (sum / NG) ** 2, 1e-12) / NG);
      zG = Math.max(zG, Math.abs(a.s / NG - e) / se(a.s, a.s2), Math.abs(a.f / NG - e) / se(a.f, a.f2));
    }
  }
  check(`game: ${NG.toLocaleString("en-US")} rounds on each road average to each rule's exact score, in points and in fair points`, zG, 4, " standard errors");
  check("game: stopping where a rule stops gives that rule's result, and running out of time goes with the readings (3,600 rounds)", copyOff, 0);
  // the glints: each reading shows as a glint opposite the side it points to, so a glint is on the
  // truck's side with the readings' own probability
  let onTruck = 0, glints = 0, glintOff = 0;
  const rgl = new Rng(20261117);
  for (let i = 0; i < (quick ? 600 : 3000); i++) {
    const m = gm.constant, run = Game.playRound(m, rgl);
    for (let n = 0; n < m.rows; n++) {
      const g = Game.glintSide(run.reads[n]);
      if (g !== -run.reads[n] || Math.abs(g) !== 1) glintOff++;
      glints++; if (g === -run.z) onTruck++;
    }
  }
  const pT = Lt.pUp(1), zGl = Math.abs(onTruck / glints - pT) / Math.sqrt((pT * (1 - pT)) / glints);
  check(`game: glints show opposite the side their reading points to (${glints.toLocaleString("en-US")}), on the truck's side ${(100 * onTruck / glints).toFixed(1)}% of the time against ${Math.round(100 * pT)}%`, glintOff + (zGl > 4 ? 1 : 0), 0);
  const typedG = [...html.matchAll(/data-game-n="(\w+)">([^<]*)</g)];
  const badG = typedG.filter(([, k, v]) => gNums[k] !== v).length;
  check(`game: numbers in its text equal the models' (${typedG.length})`, badG + (typedG.length === 6 ? 0 : 1), 0);
  const gText = html.slice(html.indexOf('id="play"'), html.indexOf('id="why"'));
  const wallAt = (m, key, n) => Lt.effectiveWall(m.walls[key], n);
  const rise = Math.round(G.rise / Lt.DT), dl = gm.deadline.rows;
  const gWords = [
    G.rounds === 9 && gText.includes("Nine rounds") && gText.includes("over nine rounds"),
    G.secondsPerUnit === 6 && gText.includes("A time unit is 6 seconds of play"),
    Math.round(1 / (Lt.DT * G.secondsPerUnit)) === 17 && gText.includes("the glints come about 17 a second"),
    Game.KINDS.constant.secondsPerUnit * 2 === G.secondsPerUnit && gText.includes("the steady road, where decisions take longest, plays twice as fast")
      && Game.KINDS.constant.story.includes("this road plays twice as fast"),
    // the best walls close in before the cost jumps and before the deadline; the 2025 rule's don't
    // a tenth of a time unit before the jump (its edge is smoothed, so the 2025 rule starts to move
    // a few rows before the line itself)
    wallAt(gm.rises, "ex", rise - 10) < wallAt(gm.rises, "ex", 0) && wallAt(gm.rises, "pm", rise - 10) === wallAt(gm.rises, "pm", 0),
    wallAt(gm.deadline, "ex", dl - 10) < wallAt(gm.deadline, "ex", 0) && wallAt(gm.deadline, "pm", dl - 2) === wallAt(gm.deadline, "pm", 0),
    gText.includes("the best bounds fall before the cost jumps or the deadline comes, and the 2025 rule’s stay level until it does"),
  ].filter((ok) => !ok).length;
  check("game: the numbers typed in its text follow from the model, and the bounds do what its text says (7 claims)", gWords, 0);

  const lab = Lab.labNumbers(site.showcase[0]);
  check("lab test: one model time unit, rounded, equals the paper's PalmerT", Math.abs(lab.unitMs - +site.numbers.PalmerT), 0);
  const typedLab = [...html.matchAll(/data-lab="(\w+)">([^<]*)</g)];
  const badLab = typedLab.filter(([, k, v]) => String(lab[k]) !== v).length;
  check(`lab test: numbers in the text equal those computed from the stored curves (${typedLab.length})`, badLab + (typedLab.length >= 6 ? 0 : 1), 0);
  // the lab test with the lifting penalty (the second showcase schedule): every number in its text,
  // the claims around them (an eightfold fall; the best's urgency halves before the penalty's
  // midpoint and the 2025 rule's after it), and its cue at that midpoint
  const lift = Lab.liftNumbers(site.showcase[1], 0.3), r1 = site.showcase[1];
  const typedLift = [...html.matchAll(/data-lift="(\w+)">([^<]*)</g)];
  const badLift = typedLift.filter(([, k, v]) => String(lift[k]) !== v).length;
  const liftText = html.slice(html.indexOf('id="labtest-lift"'), html.indexOf("</div>\n", html.indexOf('class="pilot-fit"', html.indexOf('id="labtest-lift"'))));
  const fall = r1.cost[0] / r1.cost[r1.cost.length - 1], mid = (r1.cost[0] + r1.cost[r1.cost.length - 1]) / 2;
  const liftClaims = [
    Math.round(fall) === 8 && liftText.includes("falls eightfold at a cue"),
    lift.bestHalfMs < lift.cueMs && lift.pmHalfMs > lift.cueMs,
    Math.abs(valueAt(r1, "cost", 0.3) - mid) < 0.01 * mid,
    lift.startBest > lift.startPm && +lift.startRatio < 1,
  ].filter((ok) => !ok).length;
  check(`lab test, lifting: numbers in its text equal those computed from the stored curves (${typedLift.length}), and its claims hold (4)`, badLift + (typedLift.length === 9 ? 0 : 1) + liftClaims, 0);
  // the trials in model units against the closed forms, at a constant bound
  // the stored curves are bounds for monitoring every DT_PAPER, already moved in by the overshoot;
  // so the trials get such a bound, and must match the closed forms at the continuous one
  const bConst = M.boundForCost(0.1), bStored = bConst - M.OVERSHOOT * Math.sqrt(DT_PAPER), flat = { t: Array.from({ length: 1001 }, (_, j) => j * 0.02) };
  for (const k of ["exact", "pm", "wb"]) flat[k] = flat.t.map(() => bStored);
  flat.cost = flat.t.map(() => 0.1);
  const rl = new Rng(77), NL = quick ? 20000 : 60000;
  let okL = 0, sL = 0, s2L = 0, late = 0;
  for (let i = 0; i < NL; i++) {
    const tr = new Lab.LabTrial({ r: flat, key: "exact", rng: rl }).advance(20);
    if (tr.t >= 20 - 1e-9) late++;
    if (tr.correct) okL++;
    sL += tr.t; s2L += tr.t * tr.t;
  }
  const eP = M.belief(bConst), eT = M.meanTime(bConst), pL = okL / NL, mL = sL / NL, sdL = Math.sqrt(s2L / NL - mL * mL);
  check("lab test: trials at a steady bound vs closed-form accuracy, beyond 0.002", Math.max(Math.abs(pL - eP) - 0.002, 0) / Math.sqrt((eP * (1 - eP)) / NL), 4, " standard errors");
  check("lab test: the same, mean decision time, beyond 1% (and none cut off)", Math.max(Math.abs(mL - eT) - 0.01 * eT, 0) / (sdL / Math.sqrt(NL)) + (late > NL * 1e-4 ? 99 : 0), 4, " standard errors");
  // the dots carry the lab trial's evidence, frame by frame
  let lagL = 0, misL = 0, framesL = 0;
  const rd = new Rng(4040), frameS = 1 / 60 / 3;
  for (let i = 0; i < 300; i++) {
    const field = new DotField({ rng: rd });
    field.reset(dotsPerUnit(frameS));
    const tr = new Lab.LabTrial({ r: site.showcase[0], key: i % 2 ? "pm" : "exact", rng: rd });
    let shown = 0;
    while (!tr.done) {
      tr.advance(tr.t + (frameS * 1000) / Lab.UNIT_MS);
      const f = field.frame(tr.x);
      shown += f.R - f.L; framesL++;
      lagL = Math.max(lagL, Math.abs(f.lag));
      if (shown !== Math.round(field.kappa * tr.x)) misL++;
    }
  }
  check(`lab test: the dots' running net steps = rounded evidence (${framesL} frames)`, misL + lagL, 0);

  // every print's readout, at every stored sample, says the stored values
  let badRead = 0, reads = 0;
  site.showcase.forEach((r, i) => {
    const py = stored[i];
    r.t.forEach((t, j) => {
      const text = readout(r, t, "", Lab.UNIT_MS);
      const said = Object.fromEntries([...text.matchAll(/(best|2025 rule|look-ahead) (\d+)%/g)].map((x) => [x[1], +x[2]]));
      const nums = ["best", "2025 rule", "look-ahead"].map((k) => said[k]);
      const want = [r.exact[j], r.pm[j], r.wb[j]].map((b) => Math.round(100 / (1 + Math.exp(-2 * b))));
      const okB = ["exact", "pm", "wb"].every((k, q) => {
        const b = [py.exact, py.pm, py.wb][q][py.stride * j];
        return b > 0 ? nums[q] === want[q] && Math.abs(valueAt(r, k, t) - b) < 5e-5 : /decide now/.test(text);
      });
      reads++;
      if (!okB) badRead++;
    });
  });
  check(`scenarios: print readouts at every stored sample say the stored confidence (${reads})`, badRead, 0);
  let badUnit = 0;
  for (const t of [0, 0.25, 0.5, 0.77, 1]) {
    const ms = readout(site.showcase[0], t, "ms", Lab.UNIT_MS);
    if (num(/\((\d+) ms\)/, ms) !== Math.round((t * 1000) / (Lab.MU * Lab.MU))) badUnit++;
    for (const i of [3, 4, 5]) if (Math.abs(num(/\(([\d.]+) s\)/, readout(site.showcase[i], t, "s", Lab.UNIT_MS)) - t) > 0.005 + 1e-12) badUnit++;
  }
  const units = Object.fromEntries([...html.matchAll(/data-scn="(\d)"[^>]*data-unit="(\w*)"/g)].map((m) => [m[1], m[2]]));
  for (const t of [0, 0.35, 1, 2.5]) if (num(/\(([\d.]+) min\)/, readout(site.showcase[6], t, "min", Lab.UNIT_MS, Rc.RECORDER.minutes)) !== +(t * 10).toFixed(1)) badUnit++;
  for (const t of [0, 0.5, 1.25, 2.5]) if (num(/\(([\d.]+) s\)/, readout(site.showcase[2], t, "s", Lab.UNIT_MS, Ld.LANDER.seconds)) !== +(t * 10).toFixed(1)) badUnit++;
  if (units[0] !== "ms" || units[2] !== "s" || units[3] !== "s" || units[4] !== "s" || units[5] !== "s" || units[6] !== "min") badUnit++;
  check("scenarios: readouts in milliseconds (lab, 1/mu^2 s per unit), seconds (car, keeper, and robot, 1 s per unit; lander, 10 s), and minutes (recorder, 10 min per unit)", badUnit, 0);
}

const w = [6, Math.max(...rows.map((r) => r[1].length)), 14, 14];
for (const r of rows) console.log(r.map((c, i) => String(c).padEnd(w[i])).join("  "));
console.log(failed ? `\n${failed} check(s) failed` : `\nall ${rows.filter((r) => r[0]).length} checks passed`);
if (process.argv.includes("--write")) {
  if (quick) throw new Error("--write needs the full run");
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync("site/data/checks.json", JSON.stringify({ date, rows: record }, null, 1) + "\n");
  console.log("wrote site/data/checks.json");
}
process.exit(failed ? 1 : 0);
