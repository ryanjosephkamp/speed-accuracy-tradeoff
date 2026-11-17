// The lab test of the paper's prediction: moving dots at 6.4% coherence, and a penalty for time
// that changes at a cue. Two schedules, both the paper's showcase examples with their bounds stored in
// site-data.json from experiments/results/showcase.json: "A rush at a known time" (the cost of time
// rises 16-fold around t = 0.5), and "The pressure lifts" (it falls from 0.4 to 0.05 around t = 0.3). Time converts to milliseconds through the
// moving-dot observer of Palmer, Huk, and Shadlen (2005): drift mu = 21 x coherence per second, so
// one model time unit, sigma^2/mu^2 with sigma = 1, is 1/mu^2 seconds.
//
// Pure functions, no DOM: labtest.js draws them and site/tools/check_site.mjs checks them.
import { boundForCost } from "./model.js";
import { K_DRIFT, DT_PAPER } from "./stimulus.js";
import { valueAt } from "./print-read.js";

export { valueAt };

export const COHERENCE = 0.064;
/** Drift per second at this coherence. */
export const MU = K_DRIFT * COHERENCE;
/** One model time unit, in milliseconds. */
export const UNIT_MS = 1000 / (MU * MU);
export const KEYS = ["exact", "pm", "wb"];

/** Urgency: the inverse of the bound, relative to the 2025 rule's when the dots appear. */
export const urgency = (r, key, t) => r.pm[0] / valueAt(r, key, t);
/** The confidence a bound b asks for (model units, drift 1). */
export const confidence = (b) => 1 / (1 + Math.exp(-2 * b));
/** Points lost per second for a cost per model time unit. */
export const perSecond = (c) => (c * 1000) / UNIT_MS;

export const firstTime = (pred, t1 = 2.5, dt = 0.0005) => { for (let t = 0; t <= t1; t += dt) if (pred(t)) return t; return null; };
/** The paper's mean look-ahead at bound b (Corollary 2(b)): how far ahead a slow change is led. */
export const meanLookAhead = (b) => 0.5 + (2 * b * (b * Math.tanh(b) - 1)) / (Math.sinh(2 * b) + 2 * b);
/** The numbers the lab test's text states, from the stored curves and the paper's closed forms. */
export function labNumbers(r) {
  const cue = 0.5;
  const reach = (key) => firstTime((t) => urgency(r, key, t) >= 2);
  const best2 = reach("exact"), pm2 = reach("pm");
  return {
    unitMs: Math.round(UNIT_MS),
    cueMs: Math.round(cue * UNIT_MS),
    startBest: Math.round(100 * confidence(r.exact[0])),
    startPm: Math.round(100 * confidence(r.pm[0])),
    best2Ms: Math.round(best2 * UNIT_MS),
    pm2Ms: Math.round(pm2 * UNIT_MS),
    // a slow change at this task's starting cost would be led by the mean look-ahead there
    slowMs: Math.round(meanLookAhead(boundForCost(r.cost[0])) * UNIT_MS),
  };
}

/**
 * One trial: evidence dX = z dt + dW in model units, checked every DT_PAPER against the stored
 * bound for the observer's rule. The stored bounds are already the ones for monitoring every
 * DT_PAPER (the scorer's grid), so no further shift is applied. The evidence in the dots' units
 * (per second of drift mu) is X / mu.
 */
export class LabTrial {
  constructor({ r, key, rng, z }) {
    this.r = r; this.key = key; this.rng = rng;
    this.z = z ?? (rng.next() < 0.5 ? 1 : -1);
    this.dt = DT_PAPER;
    this.X = 0; this.t = 0; this.done = false; this.choice = 0;
  }
  /** Run to model time `until`, or to the decision. */
  advance(until) {
    const sd = Math.sqrt(this.dt), last = this.r.t[this.r.t.length - 1];
    while (!this.done && this.t + this.dt <= until + 1e-12) {
      this.X += this.z * this.dt + sd * this.rng.gauss();
      this.t += this.dt;
      const b = Math.max(valueAt(this.r, this.key, Math.min(this.t, last)), 0);
      if (Math.abs(this.X) >= b || this.t >= last) { this.done = true; this.choice = this.X > 0 ? 1 : this.X < 0 ? -1 : (this.rng.next() < 0.5 ? 1 : -1); }
    }
    return this;
  }
  get x() { return this.X / MU; }
  get correct() { return this.choice === this.z; }
}

/** The numbers the lab test with the lifting penalty states (the second showcase example): what each
 * rule asks for when the dots appear, and when each rule's urgency has fallen to half the 2025
 * rule's starting urgency, against the penalty's own midpoint (its cue). */
export function liftNumbers(r, cue = 0.3) {
  const half = (key) => firstTime((t) => urgency(r, key, t) <= 0.5);
  return {
    unitMs: Math.round(UNIT_MS),
    cueMs: Math.round(cue * UNIT_MS),
    startBest: Math.round(100 * confidence(r.exact[0])),
    startPm: Math.round(100 * confidence(r.pm[0])),
    startRatio: urgency(r, "exact", 0).toFixed(2),
    bestHalfMs: Math.round(half("exact") * UNIT_MS),
    pmHalfMs: Math.round(half("pm") * UNIT_MS),
    penaltyHigh: perSecond(r.cost[0]).toFixed(2),
    penaltyLow: perSecond(r.cost[r.cost.length - 1]).toFixed(2),
  };
}
