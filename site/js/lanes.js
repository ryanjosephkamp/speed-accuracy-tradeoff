// Three deciders side by side, on the decision machine's lattice (lattice.js), for the working
// examples (the car, the goalkeeper, the walking robot). Each takes one noisy reading a row (0.01 of a time unit)
// that points to the true side with probability p = (1 + delta mu) / 2; its evidence is the net
// count of readings pointing right. The rows' costs say what each moment of doubt costs; at the
// last row the choice is forced toward whichever side the readings favor.
//
// Three rules set the walls (how sure a decider must be before it commits): the best walls,
// solved exactly by dynamic programming; the 2025 per-moment rule, the best constant walls for
// the cost at each moment; and the paper's weighted look-ahead rule, the per-moment walls
// averaged under the look-ahead weights (lattice.js lookAheadRule), with a decider committing
// once its readings reach that level. All three get the same readings, so they differ only in
// their walls.
//
// Pure functions, no DOM: the scenes draw them and site/tools/check_site.mjs checks them.
import { DT, pUp, posterior, exactWalls, perMomentWalls, lookAheadRule, effectiveWall, scoreWalls } from "./lattice.js";

export const RULES = [
  { key: "ex", name: "Best bounds", short: "BEST" },
  { key: "pm", name: "2025 rule", short: "2025 RULE" },
  { key: "wb", name: "Look-ahead rule", short: "LOOK-AHEAD" },
];

/** The look-ahead rule's level at each row (real), solved from the per-moment walls. */
export function lookAheadLevels(pm, rows, mu = 1) {
  const x = new Float64Array(rows);
  let start = effectiveWall(pm, 0);
  for (let n = 0; n < rows; n++) { x[n] = lookAheadRule(pm, n, rows, mu, start); start = x[n]; }
  return x;
}

/**
 * The three wall sets for the rows' costs, and each one's exact expected score: its share right,
 * what it pays for doubt, its mean time, and when it commits. `spent[n]` is what a decider that
 * commits at row n has paid for its doubt.
 */
export function laneModel(costs, mu = 1) {
  const rows = costs.length;
  const ex = exactWalls(costs, mu), pm = perMomentWalls(costs, mu);
  const levels = lookAheadLevels(pm, rows, mu);
  const wb = new Int32Array(rows + 1);
  for (let n = 0; n < rows; n++) wb[n] = Math.ceil(levels[n] - 1e-9);
  wb[rows] = 0;
  const walls = { ex, pm, wb };
  const exact = {};
  for (const r of RULES) {
    const s = scoreWalls(walls[r.key], costs, mu);
    // when[n]: the share of runs that commit at row n (row `rows` is the forced choice)
    const when = s.right.map((v, n) => v + s.left[n]);
    exact[r.key] = { points: 100 * s.reward, p: s.p, paid: s.paid, rt: s.rt, forced: when[rows], when };
  }
  const spent = new Float64Array(rows + 1);
  for (let n = 0; n < rows; n++) spent[n + 1] = spent[n] + Math.min(costs[n], 1e9) * DT;
  return { costs, rows, walls, levels, exact, mu, spent };
}

/** The confidence a wall at k pegs asks for. */
export const confidenceAt = (k, mu = 1) => posterior(Math.max(k, 0), mu);

/**
 * One run: which side is true (z = +1 right, -1 left), the readings (+1 right, -1 left), and
 * where each rule's decider commits. Every run uses rows + 1 uniforms from rng in the same order
 * (the side, then one per reading), plus one for a tie at the last row, so all three rules see
 * the same readings. path[n] is the net count of right-pointing readings after n readings.
 */
export function runLanes(model, rng) {
  const P = pUp(model.mu), rows = model.rows;
  const z = rng.next() < 0.5 ? 1 : -1;
  const reads = new Int8Array(rows), path = new Int32Array(rows + 1);
  for (let n = 0; n < rows; n++) {
    const toward = rng.next() < P ? 1 : -1;
    reads[n] = toward * z;
    path[n + 1] = path[n] + reads[n];
  }
  const tie = rng.next() < 0.5 ? 1 : -1;
  const out = {};
  for (const r of RULES) {
    const K = model.walls[r.key];
    let n = 0;
    while (n < rows && Math.abs(path[n]) < K[n]) n++;
    const k = path[n], choice = k > 0 ? 1 : k < 0 ? -1 : tie;
    const correct = choice === z;
    out[r.key] = { n, k, choice, correct, forced: n === rows, points: (correct ? 1 : 0) - model.spent[n] };
  }
  return { z, reads, path, tie, decide: out };
}
