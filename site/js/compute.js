// Everything the cost lab shows for one schedule: the exact policy, both rules, and the reward
// each rule gives up, scored exactly. Runs in a worker when the browser allows module workers,
// and on the page otherwise. A schedule arrives as a plain description (a preset, a held-out
// schedule, or a cost the reader drew), since functions can't be sent to a worker.
import { presetById } from "./schedules.js";
import { costFor } from "./heldout.js";
import { exactPolicy, perMoment, weightedBound, score, toDiscrete, OVERSHOOT } from "./model.js";

export const DT = 0.01;

/** A drawn cost: log c linear between knots [t, log c], flat after the last one. */
export function drawnCost(knots) {
  const n = knots.length;
  return (t) => {
    if (t <= knots[0][0]) return Math.exp(knots[0][1]);
    if (t >= knots[n - 1][0]) return Math.exp(knots[n - 1][1]);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (knots[mid][0] <= t) lo = mid; else hi = mid; }
    const [t0, l0] = knots[lo], [t1, l1] = knots[hi];
    return Math.exp(l0 + ((l1 - l0) * (t - t0)) / (t1 - t0));
  };
}

export function describe(spec) {
  if (spec.kind === "preset") {
    const preset = presetById(spec.id);
    return { cost: preset.cost(spec.params), horizon: preset.horizon(spec.params), view: preset.view(spec.params),
      deadline: spec.id === "deadline" ? spec.params.at : null };
  }
  if (spec.kind === "heldout") {
    const deadline = spec.family === "deadline" ? spec.p.T : null;
    return { cost: costFor(spec), horizon: spec.horizon, view: deadline ?? 4, deadline };
  }
  if (spec.kind === "drawn") {
    return { cost: drawnCost(spec.knots), horizon: spec.horizon, view: spec.view, deadline: null };
  }
  throw new Error(`unknown schedule ${spec.kind}`);
}

export function computeSchedule(spec) {
  const { cost, horizon, view, deadline } = describe(spec);
  const t0 = performance.now();
  const ex = exactPolicy(cost, horizon, DT);
  const t1 = performance.now();
  const pm = perMoment(cost, ex.ts);
  const wb = weightedBound(cost, ex.ts);
  const t2 = performance.now();
  const disc = (arr) => Float64Array.from(arr, (b) => toDiscrete(b, DT));
  const rEx = score(ex.bounds, ex.ts, cost).reward;
  const rPm = score(disc(pm), ex.ts, cost).reward;
  const rWb = score(disc(wb), ex.ts, cost).reward;
  const t3 = performance.now();
  // the continuous-monitoring equivalent of the exact bound, for drawing beside the two rules
  const shift = OVERSHOOT * Math.sqrt(DT);
  const out = { t: [], cost: [], exact: [], pm: [], wb: [] };
  for (let k = 0; k < ex.ts.length; k++) {
    const t = ex.ts[k];
    if (t > view + 1e-9) break;
    const e = ex.bounds[k];
    out.t.push(+t.toFixed(3));
    out.cost.push(cost(t));
    out.exact.push(e === 0 ? 0 : e === Infinity ? null : e + shift);
    out.pm.push(pm[k]);
    out.wb.push(wb[k]);
  }
  return {
    ...out, view, deadline,
    loss: { pm: 100 * (rEx - rPm), wb: 100 * (rEx - rWb) },
    ms: { exact: t1 - t0, rules: t2 - t1, scoring: t3 - t2 },
    steps: ex.ts.length - 1,
  };
}
