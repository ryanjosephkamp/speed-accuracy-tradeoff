// The decision machine's own model: the paper's evidence on a lattice, as in a Galton board.
// Each row is one moment, dt = delta^2 time units; at each row a ball steps one peg right or
// left, by delta in evidence, stepping toward the true side with probability
// p = (1 + mu delta) / 2, where mu is the strength of the evidence (1 is the paper's standard,
// where the time unit is sigma^2/mu^2). So the evidence drifts by mu dt per row and spreads by
// about dt per row, as in the paper's model, and the walk tends to it as delta shrinks. The truth
// is "right" for every ball (the problem is symmetric), so the right wall collects correct choices.
//
// Everything here is exact for the lattice walk itself, with no sampling: the posterior after a
// net of k steps right, the optimal walls by dynamic programming, the per-moment walls (the best
// constant walls for the cost at each moment), and each policy's expected reward by forward
// propagation. site/tools/check_site.mjs compares these with the gambler's-ruin formulas and with
// the paper's continuous results.

export const DELTA = 0.1;
export const DT = DELTA * DELTA;
/** Probability of a step toward the truth, for evidence strength mu. */
export const pUp = (mu = 1) => (1 + mu * DELTA) / 2;
export const P_UP = pUp(1);
/** The walls never need to be wider than this many steps; past it a ball always decides. */
const KCAP = 90;
const NEVER = KCAP + 1;

/** Probability that the truth is "right" after a net of k steps right. */
export function posterior(k, mu = 1) {
  const p = pUp(mu), lr = Math.log(p / (1 - p));
  return 1 / (1 + Math.exp(-lr * k));
}

/** Probability of choosing right and mean number of steps for constant walls at +-K
 * (gambler's ruin from 0, stepping up with probability p). */
export function constantWalls(K, mu = 1) {
  if (K <= 0) return { p: 0.5, steps: 0 };
  const P = pUp(mu), r = (1 - P) / P, rK = r ** K, r2K = rK * rK;
  const p = 1 / (1 + rK);
  // expected duration from the middle of [0, 2K]: (K - 2K (1 - r^K) / (1 - r^2K)) / (q - p)
  const steps = (K - (2 * K * (1 - rK)) / (1 - r2K)) / ((1 - P) - P);
  return { p, steps };
}

/** The best constant walls for a constant cost c per unit time: maximize P(correct) - c t. */
export function bestConstantK(c, mu = 1, kMax = 80) {
  if (!Number.isFinite(c)) return 0;
  let best = 0, bestR = 0.5;
  for (let K = 1; K <= kMax; K++) {
    const { p, steps } = constantWalls(K, mu);
    const r = p - c * steps * DT;
    if (r > bestR) { best = K; bestR = r; }
  }
  return best;
}

/** Rows' costs for a schedule over `rows` rows; row n covers [n dt, (n + 1) dt). */
export function rowCosts(cost, rows) {
  return Float64Array.from({ length: rows }, (_, n) => cost(n * DT));
}

/**
 * Optimal walls for the lattice walk by backward induction over rows 0..rows, with the choice
 * forced at the last row. Returns K[n]: at row n, a ball at |k| >= K[n] decides (K[n] = 0 means
 * decide now). The value of waiting one row is the expected value next row minus c_n dt.
 */
export function exactWalls(costs, mu = 1) {
  const rows = costs.length, P = pUp(mu);
  const off = KCAP + 1, size = 2 * off + 1;
  const decide = new Float64Array(size), up = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const g = posterior(i - off, mu);
    decide[i] = Math.max(g, 1 - g);
    up[i] = g * P + (1 - g) * (1 - P);
  }
  let v = Float64Array.from(decide), next = new Float64Array(size);
  const K = new Int32Array(rows + 1);
  K[rows] = 0;
  for (let n = rows - 1; n >= 0; n--) {
    const c = Math.min(costs[n], 1e9) * DT;
    let kb = -1;
    for (let i = 1; i < size - 1; i++) {
      const wait = up[i] * v[i + 1] + (1 - up[i]) * v[i - 1] - c;
      next[i] = Math.max(decide[i], wait);
      const k = i - off;
      // walls only matter at k with the parity of n
      if (k >= 0 && kb < 0 && decide[i] >= wait && ((k - n) % 2 === 0)) kb = k;
    }
    next[0] = decide[0]; next[size - 1] = decide[size - 1];
    [v, next] = [next, v];
    K[n] = kb < 0 ? NEVER : kb;
  }
  K.value = v[off]; // the expected reward of the best walls, from the start
  return K;
}

/** Forward propagation of the walk through walls K, truth "right": calls visit(n, k, mass) for
 * each peg still deciding, and decided(n, k, mass) for each decision. */
function propagate(K, rows, mu, last, visit, decided) {
  const P = pUp(mu), off = KCAP + 2;
  let p = new Float64Array(2 * off + 1), q = new Float64Array(2 * off + 1);
  p[off] = 1;
  let lo = off, hi = off;
  for (let n = 0; n <= last; n++) {
    let nlo = Infinity, nhi = -Infinity;
    for (let i = lo; i <= hi; i++) {
      const m = p[i];
      if (m === 0) continue;
      const k = i - off;
      if (n === rows || Math.abs(k) >= K[n]) { decided(n, k, m); p[i] = 0; }
      else { visit(n, k, m); if (i < nlo) nlo = i; nhi = i; }
    }
    if (n === rows || nhi < 0) break;
    q.fill(0, nlo - 1, nhi + 2);
    for (let i = nlo; i <= nhi; i++) {
      const m = p[i];
      if (m === 0) continue;
      q[i + 1] += m * P;
      q[i - 1] += m * (1 - P);
      p[i] = 0;
    }
    [p, q] = [q, p];
    lo = nlo - 1; hi = nhi + 1;
  }
}

/**
 * The exact flow of balls through the board: the share of balls still deciding at each peg
 * (row n, net steps k) for rows 0..show, truth "right". Row-major, k from -span..span. This is
 * what the board would look like after infinitely many balls.
 */
export function flow(K, rows, show, span, mu = 1) {
  const width = 2 * span + 1, out = new Float32Array((show + 1) * width);
  propagate(K, rows, mu, Math.min(show, rows), (n, k, m) => { if (Math.abs(k) <= span) out[n * width + k + span] = m; }, () => {});
  return out;
}

/** Where a ball actually stops at row n: walls only matter at k with the parity of n, so the
 * effective wall is the smaller of the thresholds for this row and the next. */
export const effectiveWall = (K, n) => Math.min(K[n], K[Math.min(n + 1, K.length - 1)]);

/** One ball, dropped with uniforms from rng: the row and net steps at which it decides. */
export function dropBall(K, rows, rng, mu = 1) {
  const P = pUp(mu);
  let k = 0;
  for (let n = 0; ; n++) {
    if (n === rows || Math.abs(k) >= K[n]) return { n, k };
    k += rng.next() < P ? 1 : -1;
  }
}

/**
 * The look-ahead of walls at +-level: a ball one step inside the right wall, followed forward as
 * the decision maker sees it (not knowing the truth, it steps right with probability
 * g p + (1 - g)(1 - p), g its belief that the truth is right), with the walls held where they
 * are. The paper's kernel w(s) is the slope, at the wall, of the chance of still deciding s later;
 * here that slope is taken from balls one and two steps inside (4 S1 - S2, over 3, a second-order
 * difference), so alive[s] is the board's w_b(s) for a wall at this level b, up to its
 * normalization: the weights the look-ahead rule uses (lookAheadRule). share holds the same weights at each
 * peg for s = 0..ahead, k from -span..span (negative ones dropped); mean is the kernel's mean, in
 * time units.
 */
export function lookAhead(level, mu = 1, ahead = 0, span = 0, horizon = 4000) {
  const L = Math.min(Math.max(level, 1), KCAP), P = pUp(mu), lr = Math.log(P / (1 - P));
  const size = 2 * L + 1, up = new Float64Array(size);
  for (let i = 0; i < size; i++) { const g = 1 / (1 + Math.exp(-lr * (i - L))); up[i] = g * P + (1 - g) * (1 - P); }
  const width = 2 * span + 1, share = new Float32Array((ahead + 1) * width), alive = [];
  let p = new Float64Array(size), q = new Float64Array(size);
  p[2 * L - 1] = 4 / 3;
  if (L >= 2) p[2 * L - 2] = -1 / 3;
  for (let s = 0; s < horizon; s++) {
    let mass = 0;
    for (let i = 1; i < size - 1; i++) {
      const m = p[i];
      if (m === 0) continue;
      mass += m;
      const k = i - L;
      if (s <= ahead && Math.abs(k) <= span && m > 0) share[s * width + k + span] = m;
    }
    if (Math.abs(mass) < 1e-7) break;
    alive.push(mass);
    q.fill(0);
    for (let i = 1; i < size - 1; i++) { const m = p[i]; if (m) { q[i + 1] += m * up[i]; q[i - 1] += m * (1 - up[i]); } }
    q[0] = 0; q[size - 1] = 0;
    [p, q] = [q, p];
  }
  let tot = 0, first = 0;
  alive.forEach((a, s) => { tot += a; first += (s + 0.5) * a; });
  return { k0: L - 1, alive: Float64Array.from(alive), share, mean: tot ? (first / tot) * DT : 0 };
}

const kernels = new Map();
function kernelAt(level, mu) {
  const key = `${level}|${mu}`;
  if (!kernels.has(key)) {
    if (kernels.size > 300) kernels.clear();
    const a = lookAhead(level, mu).alive;
    let t = 0;
    for (const v of a) t += v;
    kernels.set(key, { a, t });
  }
  return kernels.get(key);
}
/**
 * The paper's weighted look-ahead rule on the board, at row n0: the level x that equals the
 * per-moment walls pm averaged under the look-ahead weights for walls at x (interpolated between
 * whole levels), found as in the paper by replacing x with the average of itself and the right
 * side, here 40 times, starting from `start`. Past the last row the per-moment wall is 0, as
 * B(infinity) = 0 past a deadline.
 */
export function lookAheadRule(pm, n0, rows, mu = 1, start = 1) {
  const avg = (L) => {
    const { a, t } = kernelAt(L, mu);
    let s = 0;
    for (let j = 0; j < a.length; j++) { const n = n0 + j; s += a[j] * (n >= rows ? 0 : effectiveWall(pm, n)); }
    return s / t;
  };
  let x = Math.max(start, 1);
  for (let i = 0; i < 40; i++) {
    const lo = Math.max(1, Math.floor(x)), f = Math.min(Math.max(x - lo, 0), 1);
    const v = (1 - f) * avg(lo) + (f ? f * avg(lo + 1) : 0);
    x = Math.max((x + v) / 2, 1e-9);
  }
  return x;
}

/** Per-moment walls: at each row, the best constant walls for that row's cost. */
export function perMomentWalls(costs, mu = 1) {
  const cache = new Map();
  const K = new Int32Array(costs.length + 1);
  costs.forEach((c, n) => {
    const key = Number.isFinite(c) ? c.toPrecision(12) : "inf";
    if (!cache.has(key)) cache.set(key, bestConstantK(c, mu));
    K[n] = cache.get(key);
  });
  K[costs.length] = 0;
  return K;
}

/**
 * Expected outcome of walls K over the rows, truth "right", by forward propagation: a ball at
 * row n with |k| >= K[n] decides (right if k > 0, a coin flip at k = 0); past the last row the
 * choice is forced. Returns P(correct), mean decision time, mean cost paid, and reward, plus
 * the share deciding at each row on each side.
 */
export function scoreWalls(K, costs, mu = 1) {
  const rows = costs.length;
  let correct = 0, time = 0, paid = 0;
  const right = new Float64Array(rows + 1), left = new Float64Array(rows + 1);
  let aliveRow = -1, alive = 0;
  const settle = () => { if (aliveRow >= 0) paid += alive * Math.min(costs[aliveRow], 1e9) * DT; };
  propagate(K, rows, mu, rows,
    (n, k, m) => { if (n !== aliveRow) { settle(); aliveRow = n; alive = 0; } alive += m; },
    (n, k, m) => {
      const r = k > 0 ? m : k === 0 ? m / 2 : 0;
      right[n] += r; left[n] += m - r;
      correct += r; time += m * n * DT;
    });
  settle();
  return { p: correct, rt: time, paid, reward: correct - paid, right, left };
}
