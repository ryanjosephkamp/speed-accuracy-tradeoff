// The walking robot, as the paper's model on the decision machine's lattice (lanes.js). A robot
// walks toward a rock and must step around it on the left or the right: the ground is firm on one
// side and loose scree on the other. Every row (0.01 of a time unit, one second in the story) it
// takes one sensor reading that points to the firm side with probability p = 0.55. Doubt costs
// most as each foot comes down, since a foot planted before the robot has chosen a side must land
// short and square; while the leg swings, waiting costs little:
//   c(t) = c0 (1 + a cos(2 pi (t - t1) / P)),   c0 = 0.2, a = 0.8, P = 0.5, t1 = 0.25,
// a step every half second, the first footfall a quarter second in. At the rock (T = 3) a robot
// still in doubt must go with what its readings say. The switch "Steady" keeps c0 at every moment:
// the cost my 2025 rule assumes, where its walls are the best walls. site/tools/build_scenes.py
// solves the rhythmic schedule with the paper's package for the print.
//
// Pure functions, no DOM: robot.js draws them and site/tools/check_site.mjs checks them.
import { DT, rowCosts, effectiveWall } from "./lattice.js";
import { laneModel } from "./lanes.js";

export const ROBOT = { c0: 0.2, swing: 0.8, step: 0.5, first: 0.25, rock: 3, speed: 1.2 };
export const ROWS = Math.round(ROBOT.rock / DT);

/** What a moment of doubt costs at time t, in points per second: with each step, or steady. */
export function robotCost(t, steady = false) {
  const { c0, swing, step, first, rock } = ROBOT;
  if (t > rock + 1e-12) return Infinity;
  return steady ? c0 : c0 * (1 + swing * Math.cos((2 * Math.PI * (t - first)) / step));
}

/** The three wall sets for the robot, and each one's exact expected score. */
export const robotModel = (steady = false, mu = 1) => laneModel(rowCosts((t) => robotCost(t, steady), ROWS), mu);

/** The footfalls up to time t: first at t1, then every step. */
export const footfalls = (t) => {
  const out = [];
  for (let f = ROBOT.first; f <= t + 1e-9; f += ROBOT.step) out.push(f);
  return out;
};

/** The share of a rule's choices made in the last `w` seconds before a footfall (up to it). */
export function beforeFootfall(m, key, w = 0.1) {
  const { first, step } = ROBOT;
  let share = 0;
  for (let n = 0; n < m.rows; n++) {
    const ph = ((((n * DT - first) % step) + step) % step);
    if (ph >= step - w - 1e-9 || ph < 1e-9) share += m.exact[key].when[n];
  }
  return share;
}

/** The share of runs still choosing when the three wall sets first part (the best walls'). */
export function stillChoosing(m) {
  let first = m.rows;
  for (let n = 0; n < m.rows; n++) if (["pm", "wb"].some((k) => effectiveWall(m.walls[k], n) !== effectiveWall(m.walls.ex, n))) { first = n; break; }
  let alive = 0;
  for (let n = first; n <= m.rows; n++) alive += m.exact.ex.when[n];
  return alive;
}

/** Every number the robot's text states, from the two models (robot.js writes them into the page
 * and site/tools/check_site.mjs compares them with what the page says). */
export function robotNumbers(m, flat) {
  const { c0, swing, step } = ROBOT;
  const loss = (x, k) => x.exact.ex.points - x.exact[k].points;
  // how far each rule's walls swing over the steps in the middle of the approach (rows 50 to 200),
  // where a decider actually stops (effectiveWall)
  const span = (K) => { let lo = Infinity, hi = -Infinity; for (let n = 50; n < 200; n++) { const k = effectiveWall(K, n); lo = Math.min(lo, k); hi = Math.max(hi, k); } return hi - lo; };
  return {
    lossPm: loss(m, "pm").toFixed(2),
    lossWb: loss(m, "wb").toFixed(2),
    waitEx: m.exact.ex.rt.toFixed(2),
    waitPm: m.exact.pm.rt.toFixed(2),
    flatPm: loss(flat, "pm").toFixed(2),
    flatWb: loss(flat, "wb").toFixed(2),
    // with a steady cost the three wall sets agree until the rock is near; every robot that has
    // chosen by then chose alike, so this many in 100 at least
    flatSame: String(Math.floor(100 * (1 - stillChoosing(flat)))),
    costLow: (c0 * (1 - swing)).toFixed(2),
    costHigh: (c0 * (1 + swing)).toFixed(2),
    costMean: String(c0),
    perStep: String(step),
    swingEx: span(m.walls.ex), swingPm: span(m.walls.pm),
    nearPm: beforeFootfall(m, "pm"), nearEx: beforeFootfall(m, "ex"),
  };
}
