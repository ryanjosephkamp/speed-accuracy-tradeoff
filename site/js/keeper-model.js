// The goalkeeper, as the paper's model on the decision machine's lattice (lanes.js). A keeper
// reads the kicker's run-up for one time unit (one second in the story), one cue a row, each
// pointing to the side the kick will go with probability p = 0.55. Every moment of doubt costs
// more as the kick nears, since a later dive must be faster to reach the corner:
//   c(t) = kappa * Ts / (T - t + Ts)^2,   kappa = 0.2, Ts = 0.2, T = 1,
// the shape of a braking cost (the rise in the effort still needed). Once the ball is struck at
// T no dive reaches the corner, so a keeper still in doubt must go with what its cues say. The
// three keepers, one per rule, read the same cues. site/tools/build_scenes.py solves the same
// schedule with the paper's package for the print.
//
// Pure functions, no DOM: keeper.js draws them and site/tools/check_site.mjs checks them.
import { DT, rowCosts } from "./lattice.js";
import { laneModel } from "./lanes.js";

export const KEEPER = { kappa: 0.2, ts: 0.2, kick: 1 };
export const ROWS = Math.round(KEEPER.kick / DT);

/** What a moment of doubt costs at time t, in points per second (time unit). */
export const keeperCost = (t) => {
  const { kappa, ts, kick } = KEEPER;
  return t <= kick + 1e-12 ? (kappa * ts) / (kick - t + ts) ** 2 : Infinity;
};

/** The three wall sets for the keeper, and each one's exact expected score. */
export const keeperModel = (mu = 1) => laneModel(rowCosts(keeperCost, ROWS), mu);

/** Every number the keeper's text states, from the model (keeper.js writes them into the page and
 * site/tools/check_site.mjs compares them with what the page says). */
export function keeperNumbers(m) {
  const { kappa, ts, kick } = KEEPER;
  return {
    forcedPm: String(Math.round(100 * m.exact.pm.forced)),
    lossPm: (m.exact.ex.points - m.exact.pm.points).toFixed(2),
    lossWb: (m.exact.ex.points - m.exact.wb.points).toFixed(2),
    costStart: keeperCost(0).toFixed(2),
    costKick: String(+keeperCost(kick).toFixed(2)),
    // what a keeper that waits for the kick has paid: the integral of the cost from 0 to the kick
    waitAll: (kappa * kick) / (kick + ts),
    rise: keeperCost(kick) / keeperCost(0),
  };
}
