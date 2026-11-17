// The walkthrough's sentences, built from one ball's own path: how many readings pointed each
// way, how sure that makes the car, where its wall is at that row, and what it scored. Pure
// functions, so site/tools/check_site.mjs can hold every number in them to the board's math.
import { DT, posterior, pUp, effectiveWall } from "./lattice.js";

/** Readings so far for a ball at row n, k steps right of center. */
export const readings = (n, k) => ({ right: (n + k) / 2, left: (n - k) / 2 });
/** How sure the car is of the side it leans to (0.5 at the middle). */
export const sureOf = (k, mu = 1) => posterior(Math.abs(k), mu);
export const pctText = (g) => `${Math.round(100 * g)}%`;
/** Points a decision at row n has paid for its time: the cost of each row it kept looking. */
export function spentBy(costs, n) {
  let s = 0;
  for (let i = 0; i < n && i < costs.length; i++) s += Math.min(costs[i], 1e9) * DT;
  return s;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const side = (k) => (k > 0 ? "right" : "left");
const pts = (v) => v.toFixed(3);

export function sayReadings({ n, k, mu = 1 }) {
  if (n === 0) return "The car starts with no idea which side is clear: 50% each way. Press Play, or One reading to take a single reading.";
  const { right, left } = readings(n, k);
  const lean = k === 0 ? "it's back to even, 50% each way" : `it's ${pctText(sureOf(k, mu))} sure the ${side(k)} side is clear`;
  return `Row ${n}, ${(n * DT).toFixed(2)} time units in. This car has had ${plural(n, "reading")}: ${right} pointed right and ${left} left, so ${lean}.`;
}

/** `wall` is the wall the board draws at this row; `decides` is the machine's own stopping test
 * there (they agree except where the walls step); `deadline` says whether time runs out. */
export function sayWall({ k, wall, mu = 1, decides, deadline = false }) {
  if (wall <= 0) return deadline
    ? "Its bound here is at the middle: time is up, so it must choose now, whichever side the readings favor."
    : "Its bound here is at the middle: time now costs so much that the best move is to choose now, whichever side the readings favor.";
  const at = `Its bound here is ${plural(wall, "peg")} out: it swerves once it's ${pctText(posterior(wall, mu))} sure.`;
  if (decides ?? Math.abs(k) >= wall) return `${at} It's there, so it decides.`;
  return `${at} ${k === 0 ? "The readings are even" : `The ball is ${plural(Math.abs(k), "peg")} out`}, so it keeps looking.`;
}

/** `forced` is why a car chose without reaching a wall: "deadline" (time ran out), "cost"
 * (waiting cost more than a reading could be worth), or "limit" (the board's last row). */
export function sayOutcome({ n, k, mu = 1, correct, forced, spent, below = false }) {
  const { left } = readings(n, k);
  const tail = below ? " It decided below the bottom of the board." : "";
  if (forced) {
    const even = k === 0 ? ", with the readings even: a coin flip" : "";
    const went = correct ? "right, to the clear side: 1 point" : "left, into the obstacle: no points";
    const why = forced === "cost" ? `At row ${n} waiting cost more than another reading could be worth, so it chose then`
      : forced === "limit" ? `It reached the board's last row, ${n}, and had to choose then`
      : `It ran out of time at row ${n} and had to choose then`;
    return `${why}${even}. It swerved ${went}, minus ${pts(spent)} for the time.${tail}`;
  }
  if (correct) return `It reached the right bound at row ${n}, ${pctText(sureOf(k, mu))} sure, and swerved right. Right was clear: 1 point, minus ${pts(spent)} for the time it took.${tail}`;
  return `This one reached the left bound at row ${n}. Noise fooled it: ${left} of its ${n} readings pointed left. It swerved into the obstacle: no points, minus ${pts(spent)} for the time.${tail}`;
}

/** The share of readings that point to the clear side, as the walkthrough says it. */
export const clearShare = (mu = 1) => pctText(pUp(mu));

/** Where the best walls run furthest inside the 2025 rule's while the cost is still within 1% of
 * where it started and at least a tenth of a time unit before the change at row `change` (the
 * rise, or the deadline): the row and the gap in pegs ({ d: 0 } if they never part that early). */
export function earlyLead(ex, pm, costs, limit = Infinity, change = Infinity) {
  const c0 = costs[0], end = Math.min(limit, change - Math.round(0.1 / DT) + 1, costs.length, ex.length - 2, pm.length - 2);
  let best = { d: 0, n: 0 };
  for (let n = 0; n < end; n++) {
    if (!(costs[n] <= 1.01 * c0)) break;
    const d = effectiveWall(pm, n) - effectiveWall(ex, n);
    if (d > best.d) best = { d, n };
  }
  return best;
}
