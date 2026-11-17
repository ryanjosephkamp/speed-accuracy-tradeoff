// The runs beside a scene of three deciders (the car, the goalkeeper, the robot; lanes.js). Every run that
// ends, one at a time or a thousand at once, goes into a tally that shows two things: when each
// rule's decider committed, as a strip per rule (the exact share for this model as a line, the
// runs so far filled in under it, and the choices forced at the deadline as a bar of their own),
// and what each earned per 100 runs, its successes less what its doubt cost, beside the exact
// values. A sentence under them says what the runs show, with the sampling error of each gap. The
// three read the same cues, so the gaps between them are steadier than the scores themselves.
import { RULES } from "./lanes.js";
import { DT } from "./lattice.js";
import { el, text, clear, size, lin, timeScale } from "./svg.js";

/** Rows per bar of the strip (0.04 of a time unit). A fixed wall is reached only on odd rows or
 * only on even ones, so a bar must hold as many of each (an odd width would comb); and each step
 * of a wall releases a small burst, which four rows smooth more than two. */
export const BIN = 4;
// (the checks import this file in Node, where there is no matchMedia)
const reduced = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: true };
const count = (n, w) => `${n.toLocaleString("en-US")} ${n === 1 ? w.one : w.many}`;

/** The exact share of runs that commit in each bar of the strip, and at the deadline. */
export function exactBins(model, key) {
  const when = model.exact[key].when, rows = model.rows, bins = new Float64Array(Math.ceil(rows / BIN));
  for (let n = 0; n < rows; n++) bins[Math.floor(n / BIN)] += when[n];
  return { bins, forced: when[rows] };
}

/** A tally of runs: per rule, successes, doubt paid, rows waited, choices forced, and bars of the
 * strip; and per rule against the best walls, the sum and sum of squares of the gap in points. */
export function newTally(model) {
  const nBins = Math.ceil(model.rows / BIN);
  const t = { n: 0, rule: {}, gap: {} };
  for (const r of RULES) {
    t.rule[r.key] = { right: 0, paid: 0, rows: 0, forced: 0, bins: new Float64Array(nBins) };
    t.gap[r.key] = [0, 0];
  }
  return t;
}
export function addRun(t, model, run) {
  t.n++;
  for (const r of RULES) {
    const d = run.decide[r.key], a = t.rule[r.key];
    a.right += d.correct ? 1 : 0;
    a.paid += model.spent[d.n];
    a.rows += d.n;
    if (d.forced) a.forced++; else a.bins[Math.floor(d.n / BIN)]++;
    const g = run.decide.ex.points - d.points;
    t.gap[r.key][0] += g; t.gap[r.key][1] += g * g;
  }
}
/** Per 100 runs: successes, doubt, points (their difference), mean wait in time units, share
 * forced; and the gap behind the best walls with its sampling error. */
export function summary(t, key) {
  const a = t.rule[key], n = t.n, [g1, g2] = t.gap[key];
  const gap = g1 / n, se = n > 1 ? Math.sqrt(Math.max(g2 / n - gap * gap, 0) / (n - 1)) : NaN;
  return {
    saves: (100 * a.right) / n, doubt: (100 * a.paid) / n, points: (100 * (a.right - a.paid)) / n,
    wait: (a.rows / n) * DT, forced: a.forced / n, gap: 100 * gap, se: 100 * se,
  };
}

/**
 * root: the scene (.pilot-lanes); it holds the .pilot-runs box (the strip and the table) and the
 * .runs-say sentence. w: the scene's words, e.g. for the keeper
 *   { one: "kick", many: "kicks", who: "keeper", did: "saved", at: "At the kick" },
 * and, where one time unit is not a second, its story's unit: per (story units in a time unit) and
 * unit, e.g. { per: 10, unit: "min" } for the recorder.
 */
export function createRuns(root, model, w) {
  const box = root.querySelector(".pilot-runs"), svg = box.querySelector(".runs-strip");
  const say = root.querySelector(".runs-say"), nEl = box.querySelector(".runs-n");
  const per = w.per || 1, unit = w.unit || "s", inUnit = (v) => `${(per * v).toFixed(per >= 10 ? 1 : 2)} ${unit}`;
  let exact, top, t, busy = false, gen = 0;
  function setModel(m) {
    model = m;
    exact = Object.fromEntries(RULES.map((r) => [r.key, exactBins(model, r.key)]));
    // one height for every rule's bars, so the strips compare; the forced bar has its own (all runs)
    top = 1.08 * Math.max(...RULES.map((r) => Math.max(...exact[r.key].bins)));
    t = newTally(model);
    for (const r of RULES) {
      const e = model.exact[r.key];
      cell(r.key, "saves", "small").textContent = (100 * e.p).toFixed(2);
      cell(r.key, "doubt", "small").textContent = (100 * e.paid).toFixed(2);
      cell(r.key, "points", "small").textContent = e.points.toFixed(2);
    }
  }
  function cell(key, col, part) { return box.querySelector(`[data-runs="${key}.${col}"] ${part}`); }
  setModel(model);

  function render() {
    const n = t.n;
    for (const r of RULES) {
      const s = n ? summary(t, r.key) : null;
      for (const col of ["saves", "doubt", "points"]) cell(r.key, col, "b").textContent = s ? s[col].toFixed(1) : "–";
    }
    box.classList.toggle("has-runs", n > 0);
    nEl.textContent = count(n, w);
    strip();
    sentence();
  }

  function strip() {
    const { w: W } = size(svg);
    clear(svg);
    if (W < 40) return;
    const L = 78, R = 46, ROW = 26, GAP = 12, TOP = 16;
    const X = lin(0, model.rows * DT, L, W - R), xF = X(model.rows * DT) + 9;
    const g = el("g", {}, svg);
    const axisY = TOP + 3 * ROW + 2 * GAP + 7;
    // the axis in the story's own unit
    timeScale(g, lin(0, per * model.rows * DT, L, W - R), 0, per * model.rows * DT, axisY, 22, W, unit);
    text(g, W, 10, w.at, { class: "t-key", "text-anchor": "end" });
    el("line", { class: "runs-dead", x1: X(model.rows * DT), x2: X(model.rows * DT), y1: TOP - 3, y2: axisY }, g);
    RULES.forEach((r, i) => {
      const base = TOP + i * (ROW + GAP) + ROW, ex = exact[r.key], a = t.rule[r.key];
      const Y = (share) => base - ROW * Math.min(share / top, 1);
      el("line", { class: "runs-base", x1: L, x2: X(model.rows * DT), y1: base + 0.5, y2: base + 0.5 }, g);
      text(g, 0, base - ROW / 2 + 4, r.short, { class: `t-key runs-k-${r.key}` });
      // the runs so far, filled in, then the exact share as a line over them
      const step = (share) => {
        let d = `M${X(0).toFixed(1)},${base}`;
        share.forEach((v, j) => {
          const y = Y(v).toFixed(1);
          d += `L${X(j * BIN * DT).toFixed(1)},${y}L${X(Math.min((j + 1) * BIN, model.rows) * DT).toFixed(1)},${y}`;
        });
        return `${d}L${X(model.rows * DT).toFixed(1)},${base}`;
      };
      if (t.n) el("path", { class: `runs-fill f-${r.key}`, d: `${step(Array.from(a.bins, (c) => c / t.n))}Z` }, g);
      el("path", { class: `runs-line c-${r.key}`, d: step(ex.bins) }, g);
      // the choices forced at the deadline, on the bars' scale: a spike just past the line, cut
      // short (and marked so) when it would reach the row above; its share is written beside it
      const fRun = t.n ? a.forced / t.n : 0;
      if (ex.forced > 5e-4 || fRun > 0) {
        const cap = ROW + GAP - 4, hF = (s) => Math.min((ROW * s) / top, cap);
        if (t.n) el("rect", { class: `runs-fill f-${r.key}`, x: xF - 4, y: base - hF(fRun), width: 8, height: hF(fRun) }, g);
        el("rect", { class: `runs-line c-${r.key}`, x: xF - 4, y: base - hF(ex.forced), width: 8, height: hF(ex.forced) }, g);
        if ((ROW * Math.max(fRun, ex.forced)) / top > cap) el("line", { class: "runs-cut", x1: xF - 6, x2: xF + 6, y1: base - cap + 9, y2: base - cap + 5 }, g);
        const pct = 100 * (t.n ? fRun : ex.forced);
        text(g, xF + 8, base - 2, `${pct > 0 && pct < 0.5 ? "<1" : Math.round(pct)}%`, { class: "lbl" });
      }
    });
  }

  function sentence() {
    if (!say) return;
    say.hidden = t.n === 0;
    if (!t.n) return;
    if (t.n < 100) { say.textContent = ` After ${count(t.n, w)} the gaps are still lost in sampling error.`; return; }
    const ex = summary(t, "ex"), pm = summary(t, "pm"), wb = summary(t, "wb");
    // a difference in words, to the tenth shown: "1.3 more", "0.4 fewer", or `same` when it rounds to nothing
    const more = (v, up, down, same) => (Math.abs(v) < 0.05 ? same : `${Math.abs(v).toFixed(1)} ${v > 0 ? up : down}`);
    const err = (se) => `±${se.toFixed(se < 0.1 ? 2 : 1)}`;
    const dS = pm.saves - ex.saves, dD = pm.doubt - ex.doubt;
    // The look-ahead rule and the best walls part on few runs: the look-ahead decider commits a
    // little sooner (a small saving, often) and now and then on the wrong side (a whole point,
    // rarely). Where its exact gap is a few hundredths, a few thousand runs miss most of the rare
    // ones, so their sampling error says too little, and the sentence points to the exact gap
    // instead; where the gap is a tenth or more (the robot's rhythm), it is stated like the 2025 rule's.
    const wbExact = model.exact.ex.points - model.exact.wb.points;
    const wbSay = wbExact >= 0.1
      ? `The look-ahead rule is ${more(wb.gap, "points behind", "points ahead of", "level with")} the best bounds (sampling error ${err(wb.se)}).`
      : `The look-ahead rule’s exact gap is too small to show in this many ${w.many}: so far it is ${more(wb.gap, "points behind", "points ahead of", "level with")} the best bounds.`;
    say.textContent = ` After ${count(t.n, w)}, the 2025 rule’s ${w.who} waited ${inUnit(pm.wait)} on average against ${inUnit(ex.wait)} for the best bounds; it ${w.did} ${more(dS, `more ${w.many}`, `fewer ${w.many}`, `as many ${w.many}`)} in 100 and paid ${more(dD, "more", "less", "the same")} for its doubt, so it is ${more(pm.gap, "points behind", "points ahead", "level with them")} (sampling error ${err(pm.se)}). ${wbSay}`;
  }

  /** Adds runs one by one (a scene's own, as each ends). */
  function add(run) { addRun(t, model, run); render(); }
  /** Adds `n` new runs from `make`, a few frames' worth at a time so the strip fills as they come
   * in (all at once when the reader prefers less motion); `done` runs after the last. */
  function batch(n, make, done) {
    if (busy) return;
    busy = true;
    const frames = reduced.matches ? 1 : 14, mine = gen;
    let left = n, f = 0;
    const tick = () => {
      if (mine !== gen) return; // the model changed under it: drop the rest
      const k = Math.ceil(left / (frames - f));
      for (let i = 0; i < k; i++) addRun(t, model, make());
      left -= k; f++;
      render();
      if (left > 0) requestAnimationFrame(tick);
      else { busy = false; done?.(); }
    };
    tick();
  }
  new ResizeObserver(() => strip()).observe(svg);
  render();
  /** Another model (the robot's cost switch): a fresh tally beside its exact values. */
  function reset(m) { gen++; busy = false; setModel(m); render(); }
  return { add, batch, setModel: reset, get n() { return t.n; } };
}
