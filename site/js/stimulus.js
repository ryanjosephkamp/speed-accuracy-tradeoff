// The decision the page runs, in seconds: evidence dX = mu z dt + dW, with the hidden direction
// z = +1 (right) or -1 (left), drift mu = 21 per second per unit of motion coherence (the average
// observer in Palmer, Huk, and Shadlen 2005), and noise of variance 1 per second. The evidence is
// checked every dt against bounds at +-b, shifted inward for monitoring every dt rather than
// continuously, so the closed forms for accuracy and mean time hold (as in the paper).
//
// The dots are drawn from the same evidence: in each frame, the number of dots stepping right
// minus the number stepping left is the change in the evidence, in whole dots. So what the reader
// watches is the evidence the trace adds up, not a separate animation. (In a lab, part of this
// noise would be in the observer, not on the screen.)
//
// site/tools/check_site.mjs checks both claims: the dots' running total equals the rounded
// evidence at every frame, and the trials' accuracy and mean time match the model.
import { OVERSHOOT, belief, meanTime, bestBound } from "./model.js";

export const K_DRIFT = 21;
export const COHERENCES = [0.032, 0.064, 0.128, 0.256, 0.512];
/** Model step in units of sigma^2 / mu^2, as in the Python experiments. */
export const DT_PAPER = 0.002;

export const driftFor = (coherence) => K_DRIFT * coherence;
/** Evidence bound for a bound in log odds L: the log odds of "right" after evidence x is 2 mu x. */
export const boundFromLogOdds = (L, mu) => L / (2 * mu);
export const logOddsFromBound = (b, mu) => 2 * mu * b;

/** Closed-form accuracy, mean decision time (seconds), and points per 100 decisions for bounds
 * at +-b, drift mu, and a cost of c per second. */
export function expected(b, mu, c) {
  const p = belief(b, mu), t = meanTime(b, mu);
  return { p, t, points: 100 * (p - c * t) };
}
/** The best evidence bound for drift mu and cost c per second. */
export const bestFor = (mu, c) => bestBound(mu, c);

export class Trial {
  constructor({ mu, b, rng, z }) {
    this.mu = mu;
    this.z = z ?? (rng.next() < 0.5 ? 1 : -1);
    this.dt = DT_PAPER / (mu * mu);
    this.b = b;
    this.bd = Math.max(b - OVERSHOOT * Math.sqrt(this.dt), 0);
    this.rng = rng;
    this.x = 0;
    this.t = 0;
    this.done = false;
    this.choice = 0;
  }
  /** Run the evidence forward to time `until` (seconds) or to the crossing. */
  advance(until) {
    const drift = this.mu * this.z * this.dt, sd = Math.sqrt(this.dt), rng = this.rng;
    while (!this.done && this.t + this.dt <= until + 1e-12) {
      this.x += drift + sd * rng.gauss();
      this.t += this.dt;
      if (Math.abs(this.x) >= this.bd) {
        this.done = true;
        this.choice = this.x > 0 ? 1 : -1;
      }
    }
    return this;
  }
  /** Run to the decision. */
  finish(limit = 600) {
    return this.advance(limit);
  }
  get correct() { return this.choice === this.z; }
}

/** Dots per standard deviation of one frame's evidence change. */
export const DOTS_PER_SD = 9;
/** Dots per unit of evidence when each frame covers frameDt seconds of model time. */
export const dotsPerUnit = (frameDt) => DOTS_PER_SD / Math.sqrt(frameDt);

/**
 * A field of n dots in a unit disk. Each frame, frame(x) is given the trial's evidence so far;
 * the dots stepping right minus those stepping left equal round(kappa x) minus what earlier frames
 * already showed, so the running total of the dots' net steps is always round(kappa x). A share of
 * the other dots also steps each way, in equal numbers, so the field looks like a noisy motion
 * display rather than a block shifting; dots that stepped one way keep stepping that way when
 * they can, which makes short streaks. The rest stand still and are replotted now and then.
 */
export class DotField {
  constructor({ n = 140, rng, step = 0.03, base = 0.16 }) {
    this.n = n;
    this.rng = rng;
    this.step = step;
    this.base = Math.round(base * n);
    this.kappa = 1;
    this.shown = 0;
    this.dots = Array.from({ length: n }, () => ({ ...this.place(), d: 0 }));
  }
  place() {
    const r = Math.sqrt(this.rng.next()), a = 2 * Math.PI * this.rng.next();
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  }
  reset(kappa) {
    this.kappa = kappa;
    this.shown = 0;
  }
  /** Movers for a frame whose net motion is `net` dots to the right: R - L = net exactly. */
  movers(net) {
    const n = this.n, a = Math.abs(net);
    let lo = Math.max(0, this.base - Math.floor(a / 2));
    if (2 * lo + a > n) lo = Math.max(0, Math.floor((n - a) / 2));
    return net >= 0 ? { R: lo + a, L: lo } : { R: lo, L: lo + a };
  }
  frame(x) {
    const target = Math.round(this.kappa * x);
    const net = Math.max(-this.n, Math.min(this.n, target - this.shown));
    this.shown += net;
    const { R, L } = this.movers(net);
    // give the steps to dots that stepped the same way last frame first
    const order = this.dots.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const next = new Int8Array(this.n);
    let r = R, l = L;
    for (const pass of [1, 0, -1]) {
      for (const i of order) {
        if (next[i] !== 0) continue;
        const d = this.dots[i].d;
        if (r > 0 && d === pass) { next[i] = 1; r--; }
        else if (l > 0 && d === -pass) { next[i] = -1; l--; }
      }
    }
    for (let i = 0; i < this.n; i++) {
      const dot = this.dots[i];
      dot.d = next[i];
      if (dot.d !== 0) {
        dot.x += dot.d * this.step;
        if (dot.x * dot.x + dot.y * dot.y > 1) dot.x = -dot.x + dot.d * this.step;
      } else if (this.rng.next() < 1 / 3) {
        Object.assign(dot, this.place());
      }
    }
    return { net, R, L, lag: target - this.shown };
  }
}
