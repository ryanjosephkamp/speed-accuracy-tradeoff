// The solar field recorder, as the paper's model on the decision machine's lattice (lanes.js). At
// first light a recorder hears a flycatcher it must log as one of two species, the alder or the
// willow flycatcher, which look alike and are told apart by song. Every row (0.01 of a time unit;
// one time unit is ten minutes in the story, so a row is six seconds) it hears one song that sounds
// like the right species with probability p = 0.55. Listening runs the recorder on its battery
// until the sun clears the ridge and its panel takes over, so a moment of doubt costs less and less
// as the sun comes up:
//   c(t) = lo + (hi - lo) (1 - s(t)),   hi = 0.5, lo = 0.05,
// s rising smoothly (a smoothstep) from 0 at t = 0.1 to 1 at t = 0.6. The bird stops singing at
// T = 3, and a recorder still in doubt must log whichever species its songs favor.
// site/tools/build_scenes.py solves the same schedule with the paper's package for the print.
//
// Pure functions, no DOM: recorder.js draws them and site/tools/check_site.mjs checks them.
import { DT, rowCosts } from "./lattice.js";
import { laneModel } from "./lanes.js";

export const RECORDER = { hi: 0.5, lo: 0.05, dawn: [0.1, 0.6], stop: 3, minutes: 10 };
export const ROWS = Math.round(RECORDER.stop / DT);

const smoothstep = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
/** How far the sun has come up at time t: 0 in the dark, 1 with the panel in full sun. */
export const sunUp = (t) => smoothstep((t - RECORDER.dawn[0]) / (RECORDER.dawn[1] - RECORDER.dawn[0]));

/** What a moment of doubt costs at time t, in points per time unit (ten minutes). */
export function recorderCost(t) {
  const { hi, lo, stop } = RECORDER;
  return t > stop + 1e-12 ? Infinity : lo + (hi - lo) * (1 - sunUp(t));
}

/** The three wall sets for the recorder, and each one's exact expected score. */
export const recorderModel = (mu = 1) => laneModel(rowCosts(recorderCost, ROWS), mu);

/** The share of a rule's recorders that have named the bird by time t. */
export function namedBy(m, key, t) {
  let s = 0;
  for (let n = 0; n < Math.min(Math.round(t / DT), m.rows); n++) s += m.exact[key].when[n];
  return s;
}

/** Every number the recorder's text states, from the model (recorder.js writes them into the page
 * and site/tools/check_site.mjs compares them with what the page says). */
export function recorderNumbers(m) {
  const { hi, lo, dawn, minutes } = RECORDER, half = (dawn[0] + dawn[1]) / 2;
  const loss = (k) => m.exact.ex.points - m.exact[k].points;
  return {
    lossPm: loss("pm").toFixed(2),
    lossWb: loss("wb").toFixed(2),
    forcedPm: String(Math.round(100 * m.exact.pm.forced)),
    waitEx: (minutes * m.exact.ex.rt).toFixed(1),
    waitPm: (minutes * m.exact.pm.rt).toFixed(1),
    earlyPm: String(Math.round(100 * namedBy(m, "pm", half))),
    earlyEx: String(Math.round(100 * namedBy(m, "ex", half))),
    rightPm: String(Math.round(100 * m.exact.pm.p)),
    rightEx: String(Math.round(100 * m.exact.ex.p)),
    costHigh: String(hi), costLow: String(lo),
    dawnFrom: String(minutes * dawn[0]), dawnTo: String(minutes * dawn[1]),
    halfUp: String(minutes * half),
  };
}
