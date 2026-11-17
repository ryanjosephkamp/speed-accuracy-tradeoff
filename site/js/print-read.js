// Reading a scenario print at one moment: the stored curves (site-data.json "showcase", every other
// sample of experiments/results/showcase.json), interpolated in time, and the sentence the print
// shows. Pure functions, so site/tools/check_site.mjs can check what the page says.

/** A stored series ("exact", "pm", "wb", or "cost") at model time t, linearly interpolated; null
 * where the series has no value (past a deadline). */
export function valueAt(r, key, t) {
  const step = r.t[1] - r.t[0], last = r.t.length - 1;
  const x = Math.min(Math.max(t / step, 0), last), i = Math.min(Math.floor(x), last - 1), f = x - i;
  const a = r[key][i], b = r[key][i + 1];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.isFinite(a) ? a : Number.isFinite(b) ? b : null;
  return a * (1 - f) + b * f;
}
/** The confidence a bound asks for, as the print says it. */
export const sure = (b) => (b == null || !Number.isFinite(b) ? "–" : b <= 0 ? "decide now" : `${Math.round(100 / (1 + Math.exp(-2 * b)))}%`);
/**
 * The print's sentence at time t. `unitMs` converts model time to milliseconds for the lab task;
 * unit is "ms", "s" (the car's story, one unit a second; the lander's, `per` seconds a unit), "min"
 * (the recorder's, `per` minutes a unit), or "" (model units only).
 */
export function readout(r, t, unit, unitMs, per = 1) {
  const own = unit === "ms" ? ` (${Math.round(t * unitMs)} ms)` : unit === "s" ? ` (${(t * per).toFixed(per > 1 ? 1 : 2)} s)` : unit === "min" ? ` (${(t * per).toFixed(1)} min)` : "";
  const c = valueAt(r, "cost", t);
  const cost = c == null || !Number.isFinite(c) ? "past the deadline" : c.toFixed(c < 0.1 ? 3 : 2);
  return `t = ${t.toFixed(2)}${own}: best ${sure(valueAt(r, "exact", t))}, 2025 rule ${sure(valueAt(r, "pm", t))}, look-ahead ${sure(valueAt(r, "wb", t))} sure; cost ${cost}.`;
}
