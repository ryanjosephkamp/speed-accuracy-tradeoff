// The lander, as the paper's model on the decision machine's lattice (lanes.js). A lander hovers
// over a site and must set down to its left or its right: one side is clear, the other strewn with
// boulders too small to see from that height. Every row (0.01 of a time unit; one time unit is ten
// seconds in the story, so a row is a tenth of a second) it takes one lidar scan that points to the
// clear side with probability p = 0.55. Hovering costs little while the hover fuel lasts; once the
// fuel reaches the reserve the lander needs to land safely, each moment costs more than the last:
//   c(t) = 0.1 + 0.8 max(t - 0.5, 0),
// the paper's "flat, then rising" schedule (experiments/showcase.py), so its print is this scene's
// print. The fuel runs out at T = 2.5, which no lander reaches: by then every wall set has closed.
//
// Pure functions, no DOM: lander.js draws them and site/tools/check_site.mjs checks them.
import { DT, rowCosts } from "./lattice.js";
import { laneModel } from "./lanes.js";

export const LANDER = { c0: 0.1, rise: 0.8, reserve: 0.5, out: 2.5, seconds: 10 };
export const ROWS = Math.round(LANDER.out / DT);

/** What a moment of doubt costs at time t, in points per time unit (ten seconds). */
export function landerCost(t) {
  const { c0, rise, reserve, out } = LANDER;
  return t > out + 1e-12 ? Infinity : c0 + rise * Math.max(t - reserve, 0);
}

/** The three wall sets for the lander, and each one's exact expected score. */
export const landerModel = (mu = 1) => laneModel(rowCosts(landerCost, ROWS), mu);

/** The share of a rule's landers that have chosen a side by time t. */
export function chosenBy(m, key, t) {
  let s = 0;
  for (let n = 0; n < Math.min(Math.round(t / DT), m.rows); n++) s += m.exact[key].when[n];
  return s;
}

/** Every number the lander's text states, from the model (lander.js writes them into the page and
 * site/tools/check_site.mjs compares them with what the page says). */
export function landerNumbers(m) {
  const { c0, rise, reserve, seconds } = LANDER;
  const loss = (k) => m.exact.ex.points - m.exact[k].points;
  return {
    lossPm: loss("pm").toFixed(2),
    lossWb: loss("wb").toFixed(2),
    byReserveEx: String(Math.round(100 * chosenBy(m, "ex", reserve))),
    byReservePm: String(Math.round(100 * chosenBy(m, "pm", reserve))),
    waitEx: (seconds * m.exact.ex.rt).toFixed(1),
    waitPm: (seconds * m.exact.pm.rt).toFixed(1),
    clearEx: String(Math.round(100 * m.exact.ex.p)),
    clearPm: String(Math.round(100 * m.exact.pm.p)),
    reserveS: String(seconds * reserve),
    costLow: String(c0),
    costAt15: String(+(c0 + rise * (1.5 - reserve)).toFixed(2)),
  };
}
