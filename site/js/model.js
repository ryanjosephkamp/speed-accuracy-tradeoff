// The model behind the site's demos, in the paper's units: evidence dX = z dt + dW with the hidden
// state z = +1 or -1 (equal prior), a reward of 1 for a correct choice, and a cost c(t) per unit of
// time spent deciding. Everything here mirrors the Python package (src/speed_accuracy), on coarser
// grids so it runs in a browser; site/tools/check_model.mjs compares the two.

export const OVERSHOOT = 0.5826; // -zeta(1/2) / sqrt(2 pi): the shift for monitoring every dt

// ---------------------------------------------------------------------------------------------
// Constant cost: the bound b solves sinh(2b) + 2b = 1/c.
// ---------------------------------------------------------------------------------------------

function solveBound(rhs) {
  // sinh(2b) + 2b = rhs, increasing in b; bisection then Newton.
  if (!(rhs > 0)) return 0;
  let lo = 0, hi = 1;
  while (Math.sinh(2 * hi) + 2 * hi < rhs) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (Math.sinh(2 * mid) + 2 * mid < rhs) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

const LOGC_MIN = Math.log(1e-5), LOGC_MAX = Math.log(1e4), TABLE_N = 2001;
const TABLE = new Float64Array(TABLE_N);
for (let i = 0; i < TABLE_N; i++) {
  const lc = LOGC_MIN + (i * (LOGC_MAX - LOGC_MIN)) / (TABLE_N - 1);
  TABLE[i] = solveBound(Math.exp(-lc));
}

/** Closed-form evidence bound for a constant cost c (as the Python table: costs are clamped to
 * [1e-5, 1e4] and interpolated in log c). An infinite cost gives 0. */
export function boundForCost(c) {
  if (c === Infinity) return 0;
  const lc = Math.log(Math.min(Math.max(c, 1e-5), 1e4));
  const f = ((lc - LOGC_MIN) / (LOGC_MAX - LOGC_MIN)) * (TABLE_N - 1);
  const i = Math.min(Math.floor(f), TABLE_N - 2);
  const u = f - i;
  return TABLE[i] * (1 - u) + TABLE[i + 1] * u;
}

/** The exact bound for drift mu and cost c, in evidence units: mu * b solves
 * sinh(2 mu b) + 2 mu b = mu^2 / c. */
export function bestBound(mu, c) {
  return solveBound((mu * mu) / c) / mu;
}

export const belief = (x, mu = 1) => 1 / (1 + Math.exp(-2 * mu * x));
/** Mean decision time with bounds at +-b and drift mu: (b / mu) tanh(mu b). */
export const meanTime = (b, mu = 1) => (b / mu) * Math.tanh(mu * b);
/** Expected reward per decision with bounds at +-b: P(correct) - c * mean time. */
export const reward = (b, mu, c) => belief(b, mu) - c * meanTime(b, mu);

// ---------------------------------------------------------------------------------------------
// The boundary kernel w(s): how much each future moment counts for the bound at +-b. It is the
// exit-time law of a decision that starts from the decision maker's own beliefs, with an
// eigenfunction series (shortcuts.boundary_kernel):
//   w(s) = sum over mu = +-1 of P(mu) sum_n k_n^2 / (b (a^2 + k_n^2)) (1 - (-1)^n e^(-2 a b))
//          e^(-(k_n^2 + a^2) s / 2),   k_n = n pi / (2 b), a = mu.
// Returned as bin midpoints s and the weight in each bin, summing to 1.
// ---------------------------------------------------------------------------------------------

export const KERNEL_BINS = 240;

export function boundaryKernel(b, terms = 4000, bins = KERNEL_BINS) {
  const g = belief(b);
  const lamSlow = 0.5 * ((Math.PI / (2 * b)) ** 2 + 1);
  const edges = new Float64Array(bins + 1);
  const top = 14 / lamSlow, first = 1e-5;
  for (let i = 1; i <= bins; i++) edges[i] = first * Math.pow(top / first, (i - 1) / (bins - 1));
  const w = new Float64Array(bins);
  for (const [mu, pw] of [[1, g], [-1, 1 - g]]) {
    const e2ab = Math.exp(-2 * mu * b);
    for (let n = 1; n <= terms; n++) {
      const k = (n * Math.PI) / (2 * b);
      const amp = ((k * k) / (b * (mu * mu + k * k))) * (1 - (n % 2 ? -1 : 1) * e2ab);
      const rate = 0.5 * (k * k + mu * mu);
      const c = (pw * amp) / rate;
      // bins past the point where e^(-rate s) has vanished get nothing from this term
      let prev = 1; // e^(-rate * edges[0]) with edges[0] = 0
      for (let i = 0; i < bins; i++) {
        const x = rate * edges[i + 1];
        const next = x > 60 ? 0 : Math.exp(-x);
        w[i] += c * (prev - next);
        if (next === 0) break;
        prev = next;
      }
    }
  }
  let total = 0;
  for (let i = 0; i < bins; i++) total += w[i];
  const s = new Float64Array(bins);
  for (let i = 0; i < bins; i++) { s[i] = 0.5 * (edges[i] + edges[i + 1]); w[i] /= total; }
  return { s, w, edges };
}

const KERNELS = new Map();
/** Kernel for a bound, cached on bounds rounded to 0.001 with a floor of 0.01 (as in Python). */
export function kernelForBound(b) {
  const key = Math.round(Math.max(b, 0.01) * 1000);
  let k = KERNELS.get(key);
  if (!k) { k = boundaryKernel(key / 1000); KERNELS.set(key, k); }
  return k;
}

// ---------------------------------------------------------------------------------------------
// The two shortcuts, as continuous-monitoring evidence bounds over the times ts.
// ---------------------------------------------------------------------------------------------

export function perMoment(cost, ts) {
  return Float64Array.from(ts, (t) => boundForCost(cost(t)));
}

/** The weighted look-ahead: b(t) = sum_j w_j B(c(t + s_j)), with the kernel for the bound itself,
 * found by 30 half-damped updates from the per-moment bound (shortcuts.weighted_bound). */
export function weightedBound(cost, ts, iterations = 30) {
  const n = ts.length;
  let ref = perMoment(cost, ts);
  // B(c(t + s)) depends only on t + s: cache it per kernel so the updates reuse it
  const futures = new Map();
  const out = new Float64Array(n);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const key = Math.round(Math.max(ref[i], 0.01) * 1000);
      const { s, w } = kernelForBound(key / 1000);
      let fut = futures.get(key);
      if (!fut) { fut = new Map(); futures.set(key, fut); }
      let row = fut.get(i);
      if (!row) {
        row = new Float64Array(s.length);
        for (let j = 0; j < s.length; j++) row[j] = boundForCost(cost(ts[i] + s[j]));
        fut.set(i, row);
      }
      let acc = 0;
      for (let j = 0; j < s.length; j++) acc += w[j] * row[j];
      out[i] = acc;
    }
    for (let i = 0; i < n; i++) ref[i] = 0.5 * (ref[i] + out[i]);
  }
  return ref;
}

/** Shift a continuous-monitoring bound for monitoring every dt. */
export const toDiscrete = (x, dt) => Math.max(x - OVERSHOOT * Math.sqrt(dt), 0);

// ---------------------------------------------------------------------------------------------
// Dynamic programming and exact scoring on an evidence grid (known.backward_induction_x and
// evaluate.known_reward), with direct convolution instead of FFTs.
// ---------------------------------------------------------------------------------------------

function grid(dt, h, cap) {
  const half = cap + 8 * Math.sqrt(dt) + 1;
  const m = Math.ceil(half / h);
  const n = 2 * m + 1;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = (i - m) * h;
  const r = Math.ceil((6 * Math.sqrt(dt)) / h); // kernel half-width in cells
  const kernel = (mu) => {
    const k = new Float64Array(2 * r + 1);
    let sum = 0;
    for (let j = -r; j <= r; j++) {
      const v = Math.exp(-((j * h - mu * dt) ** 2) / (2 * dt));
      k[j + r] = v; sum += v;
    }
    for (let j = 0; j < k.length; j++) k[j] /= sum;
    return k;
  };
  return { x, m, n, r, kUp: kernel(1), kDown: kernel(-1) };
}

/** Exact policy for the cost schedule over [0, horizon]: the evidence bound at each time under
 * monitoring every dt, and the times. Past the horizon the choice is forced. */
export function exactPolicy(cost, horizon, dt = 0.01, h = 0.02, cap = 5) {
  const steps = Math.round(horizon / dt);
  const ts = Float64Array.from({ length: steps + 1 }, (_, k) => k * dt);
  const { x, m, n, r, kUp, kDown } = grid(dt, h, cap);
  const g = Float64Array.from(x, (xi) => belief(xi));
  const decide = Float64Array.from(g, (gi) => Math.max(gi, 1 - gi));
  let v = Float64Array.from(decide);
  const wait = new Float64Array(n);
  const bounds = new Float64Array(steps + 1);
  bounds[steps] = 0;
  for (let k = steps - 1; k >= 0; k--) {
    const ck = Math.min(cost(ts[k]), 1e9) * dt;
    // E[v(x')] for x' = x + mu dt + noise, mu = +1 with probability g(x); outside the grid the
    // value is the value of deciding, which is 1 to machine precision there
    for (let i = 0; i < n; i++) {
      let up = 0, down = 0;
      for (let j = -r; j <= r; j++) {
        const idx = i + j;
        const vj = idx < 0 || idx >= n ? decide[idx < 0 ? 0 : n - 1] : v[idx];
        up += kUp[j + r] * vj;
        down += kDown[j + r] * vj;
      }
      wait[i] = g[i] * up + (1 - g[i]) * down - ck;
    }
    // the bound: the first x > 0 where deciding beats waiting
    let b = Infinity;
    for (let i = m + 1; i < n; i++) {
      const d = decide[i] - wait[i];
      if (d > 0) {
        if (i === m + 1) { b = 0; break; }
        const dp = decide[i - 1] - wait[i - 1];
        b = x[i - 1] - (dp * (x[i] - x[i - 1])) / (d - dp);
        break;
      }
    }
    bounds[k] = b > cap ? Infinity : b;
    for (let i = 0; i < n; i++) v[i] = Math.max(decide[i], wait[i]);
  }
  return { ts, bounds, dt };
}

/** Expected reward of a policy (evidence bounds xb at times ts, checked every dt), with drift +1
 * (the problem is symmetric): P(correct), mean decision time, and the mean cost paid. */
export function score(xb, ts, cost, h = 0.02, cap = 5) {
  const dt = ts[1] - ts[0];
  if (!(Math.min(xb[0], cap) > 0)) return { p: 0.5, rt: 0, paid: 0, reward: 0.5 };
  const { x, m, n, r, kUp } = grid(dt, h, cap);
  let p = new Float64Array(n), q = new Float64Array(n);
  p[m] = 1;
  let correct = 0, rt = 0, paid = 0, alive = 1;
  let lo = m, hi = m; // support of p
  for (let k = 1; k < ts.length; k++) {
    paid += alive * Math.min(cost(ts[k - 1]), 1e9) * dt;
    const b = Math.min(xb[k], cap);
    const nlo = Math.max(lo - r, 0), nhi = Math.min(hi + r, n - 1);
    q.fill(0, nlo, nhi + 1);
    for (let i = lo; i <= hi; i++) {
      const pi = p[i];
      if (pi === 0) continue;
      for (let j = -r; j <= r; j++) q[i + j] += pi * kUp[j + r];
    }
    let mUp = 0, mLo = 0, total = 0, newLo = n, newHi = -1;
    for (let i = nlo; i <= nhi; i++) {
      const qi = q[i];
      if (qi <= 0) { q[i] = 0; continue; }
      const up = Math.min(Math.max((x[i] + h / 2 - b) / h, 0), 1);
      const dn = Math.min(Math.max((-b - (x[i] - h / 2)) / h, 0), 1);
      mUp += qi * up; mLo += qi * dn;
      const keep = qi * (1 - up - dn);
      q[i] = keep;
      if (keep > 1e-300) { total += keep; if (i < newLo) newLo = i; newHi = i; }
    }
    p.fill(0, lo, hi + 1);
    [p, q] = [q, p];
    correct += mUp;
    rt += (mUp + mLo) * ts[k];
    alive = total;
    if (newHi < 0) { lo = m; hi = m; alive = 0; break; }
    lo = newLo; hi = newHi;
  }
  if (alive > 0) {
    for (let i = lo; i <= hi; i++) correct += x[i] > 0 ? p[i] : x[i] === 0 ? 0.5 * p[i] : 0;
    rt += alive * ts[ts.length - 1];
  }
  return { p: correct, rt, paid, reward: correct - paid };
}

// ---------------------------------------------------------------------------------------------
// The first-order response: for c(t) = c0 + eps sin(omega t), the bound moves by
// eps B'(c0) |W| sin(omega t + arg W), with W the kernel's transform at -i omega.
// ---------------------------------------------------------------------------------------------

export function transfer(c0, omega) {
  const { s, w } = kernelForBound(boundForCost(c0));
  let re = 0, im = 0;
  for (let j = 0; j < s.length; j++) { re += w[j] * Math.cos(omega * s[j]); im += w[j] * Math.sin(omega * s[j]); }
  return { gain: Math.hypot(re, im), lead: (Math.atan2(im, re) * 180) / Math.PI };
}

/** The time by which half of a kernel's weight has passed, interpolating within its bin. */
export function kernelMedian({ w, edges }) {
  let acc = 0;
  for (let j = 0; j < w.length; j++) {
    if (acc + w[j] >= 0.5) return edges[j] + ((0.5 - acc) / w[j]) * (edges[j + 1] - edges[j]);
    acc += w[j];
  }
  return edges[edges.length - 1];
}

/** Share of the kernel's weight that falls within s, and its mean. */
export function kernelSummary(b) {
  const { s, w } = kernelForBound(b);
  let mean = 0, acc = 0, median = NaN;
  for (let j = 0; j < s.length; j++) {
    mean += w[j] * s[j];
    if (Number.isNaN(median) && acc + w[j] >= 0.5) median = s[j];
    acc += w[j];
  }
  return { mean, median };
}
