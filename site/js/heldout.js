// The held-out schedules' costs, evaluated with the same formulas as experiments/families.py, from
// the parameters site/tools/build_reference.py exports. Time in units of sigma^2 / mu^2.

const WIDTH = 0.05; // the logistic edge of steps, as in the experiments
const logistic = (x) => 1 / (1 + Math.exp(-x));

export function costFor({ family, p }) {
  switch (family) {
    case "smooth":
      return (t) => p.c0 * Math.exp(p.a.reduce((acc, a, j) => acc + a * Math.sin(p.om[j] * t + p.ph[j]), 0));
    case "step":
      return (t) => p.c0 + (p.c1 - p.c0) * logistic((t - p.t0) / WIDTH);
    case "deadline":
      return (t) => (t <= p.T + 1e-12 ? p.c0 : Infinity);
    case "pulse":
      return (t) => p.c0 * Math.exp(p.amp * Math.exp(-0.5 * ((t - p.t0) / p.width) ** 2));
    case "ramp":
      return (t) => p.c0 * Math.exp(p.total * Math.min(Math.max(t / p.t1, 0), 1));
    case "multi-step":
      return (t) => p.c0 * Math.exp(p.jumps.reduce((acc, j, k) => acc + j * logistic((t - p.times[k]) / WIDTH), 0));
    case "piecewise":
      return (t) => Math.exp(p.cuts.reduce((acc, tc, j) => acc + (p.levels[j + 1] - p.levels[j]) * logistic((t - tc) / WIDTH), p.levels[0]));
    default:
      throw new Error(`unknown family ${family}`);
  }
}
