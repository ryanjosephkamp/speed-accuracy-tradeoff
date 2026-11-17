// The recycling sorter, as the paper's model on the decision machine's lattice (lanes.js). Flakes of
// two plastics slide down a chute past a sensor, and an air jet a fixed distance on must push each
// into bin A or bin B; a flake still undecided when it reaches the jets goes where its readings
// lean. Flakes slide at different speeds, and the sorter measures each one's speed as it enters, so
// each flake has its own deadline, known in advance: the distance to the jets over its speed. Every
// row (0.01 of a time unit; one time unit is 50 ms in the story) the sensor takes one reading that
// points to the flake's plastic with probability p = 0.55. While a flake holds the sensor the next
// one waits, so every moment of doubt costs the same, c = 0.2 per time unit.
//
// So each speed is the car's problem with its own deadline: the best walls close by that deadline,
// and the look-ahead rule's with them, while my 2025 rule's walls are the same for every flake.
// The four speeds are equally common; the runs beside the scene mix them (sorterMix), with every
// choice forced at a flake's own deadline counted in the strip's last bar.
//
// Pure functions, no DOM: sorter.js draws them and site/tools/check_site.mjs checks them.
import { DT, rowCosts, effectiveWall } from "./lattice.js";
import { laneModel, RULES, confidenceAt } from "./lanes.js";

export const SORTER = { c: 0.2, deadlines: [0.4, 0.6, 0.9, 1.4], ms: 50, jetsCm: 6 };

/** One model per speed: the three wall sets for that flake's deadline, and their exact scores. */
export const sorterModels = (mu = 1) => SORTER.deadlines.map((T) => laneModel(rowCosts(() => SORTER.c, Math.round(T / DT)), mu));

/**
 * The four speeds mixed, as one model for the runs beside the scene (runs.js): rows up to the longest
 * deadline, each rule's exact scores averaged over the speeds, and its commit times summed over them
 * with weight a quarter each, where every choice forced at a flake's own deadline is counted at the
 * last row (the strip's forced bar) and the rest where they happen. spent[n] is the same for every
 * speed (a steady cost), so the longest deadline's serves them all.
 */
export function sorterMix(models) {
  const K = models.length, long = models[K - 1], rows = long.rows, exact = {};
  for (const r of RULES) {
    const when = new Float64Array(rows + 1);
    let p = 0, paid = 0, rt = 0, forced = 0, points = 0;
    for (const m of models) {
      const e = m.exact[r.key];
      for (let n = 0; n < m.rows; n++) when[n] += e.when[n] / K;
      when[rows] += e.when[m.rows] / K;
      p += e.p / K; paid += e.paid / K; rt += e.rt / K; forced += e.forced / K; points += e.points / K;
    }
    exact[r.key] = { p, paid, rt, forced, points, when };
  }
  return { rows, exact, spent: long.spent, mu: long.mu, models };
}

/** Every number the sorter's text states, from the models. */
export function sorterNumbers(models) {
  const mix = sorterMix(models), K = models.length, { deadlines, ms, jetsCm } = SORTER;
  const loss = (m, k) => m.exact.ex.points - m.exact[k].points;
  const pct = (v) => String(Math.round(100 * v));
  return {
    lossPm: loss(mix, "pm").toFixed(2),
    lossWb: loss(mix, "wb").toFixed(2),
    lossPmFast: loss(models[0], "pm").toFixed(2),
    lossPmSlow: loss(models[K - 1], "pm").toFixed(2),
    forcedPmFast: pct(models[0].exact.pm.forced),
    forcedPmSlow: pct(models[K - 1].exact.pm.forced),
    forcedPm: pct(mix.exact.pm.forced),
    msFast: String(Math.round(deadlines[0] * ms)),
    msSlow: String(Math.round(deadlines[K - 1] * ms)),
    speedFast: (jetsCm / 100 / (deadlines[0] * ms / 1000)).toFixed(1),
    speedSlow: (jetsCm / 100 / (deadlines[K - 1] * ms / 1000)).toFixed(1),
    // what the walls ask for halfway to the fastest flake's deadline: the best walls have started to
    // close for it, the 2025 rule's are where they always are
    halfEx: pct(confidenceAtRow(models[0], "ex", Math.round(models[0].rows / 2))),
    halfPm: pct(confidenceAtRow(models[0], "pm", Math.round(models[0].rows / 2))),
  };
}

/** The confidence a rule's walls ask for at row n (where a decider actually stops). */
export const confidenceAtRow = (m, key, n) => confidenceAt(effectiveWall(m.walls[key], Math.min(n, m.rows - 1)), m.mu);
