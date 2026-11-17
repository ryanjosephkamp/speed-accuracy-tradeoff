// The other prints: the look-ahead weight, the held-out schedules (each rerun in the browser on a
// tap), the first-order lead on a wiggling cost, and the stored tables.
import { boundForCost, kernelForBound, kernelMedian, meanTime, transfer } from "./model.js";
import { solve } from "./solver.js";
import { drawLanes, fmtLoss, fmtHere } from "./lab.js";
import { el, text, clear, size, lin, logScale, line, timeScale } from "./svg.js";

const $ = (id) => document.getElementById(id);
const onResize = (node, fn) => new ResizeObserver(() => fn()).observe(node);

// ------------------------------------------------------------------ how far ahead to look
export function initKernel(numbers) {
  const svg = $("kernel-svg"), input = $("k-cost");
  if (!svg) return;
  const T = numbers?.PalmerT ? +numbers.PalmerT : null; // ms per unit of time for the observer in the first print
  const ms = (v) => (T ? ` · ${Math.round(v * T)} ms` : "");
  function draw() {
    const c = 0.01 * 100 ** (+input.value / 100);
    $("k-cost-out").textContent = `${c.toFixed(c < 0.1 ? 3 : 2)}${T ? ` (${(c / (T / 1000)).toFixed(2)} per second for that observer)` : ""}`;
    const b = boundForCost(c);
    const kern = kernelForBound(b), { s, w } = kern, median = kernelMedian(kern);
    let acc = 0, mean = 0;
    const cdf = [];
    for (let j = 0; j < s.length; j++) { acc += w[j]; mean += w[j] * s[j]; cdf.push(acc); }
    const rt = meanTime(b);
    clear(svg);
    const { w: W, h: H } = size(svg);
    const padL = 40, padR = 12, top = 22, scaleH = 22, bottom = H - scaleH - 4;
    const smax = Math.max(1.25 * rt, 3 * mean, 0.5);
    const X = lin(0, smax, padL, W - padR), Y = lin(0, 1, bottom, top);
    const g = el("g", {}, svg);
    text(g, padL, 11, "SHARE OF THE WEIGHT WITHIN {s}", { class: "t-key" });
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      el("line", { class: "grid", x1: padL, x2: W - padR, y1: Y(v), y2: Y(v) }, g);
      text(g, padL - 6, Y(v) + 4, `${v * 100}%`, { "text-anchor": "end" });
    }
    const xs = [0], ys = [0];
    for (let j = 0; j < s.length && s[j] <= smax; j++) { xs.push(s[j]); ys.push(cdf[j]); }
    el("path", { class: "c-wb", d: line(xs, ys, X, Y) + `L${X(smax)},${Y(ys[ys.length - 1])}` }, g);
    const mk = (v, label, dy, dash) => {
      if (v > smax) return;
      el("line", { class: "tick", x1: X(v), x2: X(v), y1: top, y2: bottom, "stroke-dasharray": dash }, g);
      const flip = X(v) > W - padR - label.length * 7.2;
      text(g, X(v) + (flip ? -4 : 4), bottom - dy, label, { class: "t-key", "text-anchor": flip ? "end" : "start" });
    };
    mk(median, "HALF", 10, null);
    mk(mean, "MEAN LOOK-AHEAD", 24, "3 3");
    mk(rt, "MEAN DECISION TIME", 38, "1 3");
    timeScale(g, X, 0, smax, H - scaleH, scaleH, W);
    $("k-median").textContent = `${median.toFixed(2)}${ms(median)}`;
    $("k-mean").textContent = `${mean.toFixed(2)}${ms(mean)}`;
    $("k-rt").textContent = `${rt.toFixed(2)}${ms(rt)}`;
  }
  input.addEventListener("input", draw);
  onResize(svg, draw);
  draw();
}

// ------------------------------------------------------------------ the held-out schedules
const SHAPE = {
  smooth: (g, x, y, r) => el("circle", { cx: x, cy: y, r }, g),
  jump: (g, x, y, r) => el("rect", { x: x - r * 0.9, y: y - r * 0.9, width: 1.8 * r, height: 1.8 * r }, g),
  deadline: (g, x, y, r) => el("path", { d: `M${x},${y - r * 1.1}L${x + r},${y + r * 0.8}L${x - r},${y + r * 0.8}Z` }, g),
};
const GROUP_LABEL = { smooth: "Smooth, pulse, ramp", jump: "Step, several steps, piecewise", deadline: "Deadline" };

/** A held-out schedule's name with time in plain units and numbers to three figures. */
const display = (name) => name.replace(/(\d+\.\d+)/g, (m) => String(+(+m).toPrecision(3))).replace(/(\d) s\b/g, "$1");

export function initHeld(rows) {
  const svg = $("held-svg");
  if (!svg) return;
  let chosen = null, params = null, lastRes = null;
  const legend = $("held-legend");
  legend.innerHTML = "";
  for (const k of Object.keys(SHAPE)) {
    const li = document.createElement("li");
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 14 14");
    s.setAttribute("aria-hidden", "true");
    SHAPE[k](el("g", { fill: "none", stroke: "currentColor", "stroke-width": 1.4 }, s), 7, 7, 4.5);
    li.append(s, GROUP_LABEL[k]);
    legend.append(li);
  }
  for (const [dash, label] of [["4 4", "Same loss"], ["1 4", "100× less"]]) {
    const li = document.createElement("li");
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 22 14");
    s.setAttribute("aria-hidden", "true");
    s.style.width = "22px";
    el("line", { x1: 1, x2: 21, y1: 7, y2: 7, stroke: "currentColor", "stroke-width": 1.4, "stroke-dasharray": dash }, s);
    li.append(s, label);
    legend.append(li);
  }
  const FLOOR = 1e-5;
  function draw() {
    clear(svg);
    const { w, h } = size(svg);
    const padL = 46, padR = 14, top = 26, padB = 40;
    const X = logScale(FLOOR, 10, padL, w - padR), Y = logScale(FLOOR, 10, h - padB, top);
    const g = el("g", {}, svg);
    const narrow = w < 520;
    for (let e = -5; e <= 1; e++) {
      const v = 10 ** e, lab = e === 0 ? "1" : e === 1 ? "10" : e === -1 ? "0.1" : `10${["⁻⁵", "⁻⁴", "⁻³", "⁻²"][e + 5]}`;
      el("line", { class: "grid", x1: X(v), x2: X(v), y1: top, y2: h - padB }, g);
      el("line", { class: "grid", x1: padL, x2: w - padR, y1: Y(v), y2: Y(v) }, g);
      if (narrow && e % 2 === 0 && e !== 0) continue;
      text(g, X(v), h - padB + 15, lab, { "text-anchor": "middle" });
      text(g, padL - 6, Y(v) + 4, lab, { "text-anchor": "end" });
    }
    text(g, (padL + w - padR) / 2, h - 6, "MY 2025 RULE GIVES UP", { class: "t-key", "text-anchor": "middle" });
    text(g, padL, 12, "LOOK-AHEAD RULE GIVES UP", { class: "t-key" });
    for (const [f, lab] of [[1, "SAME LOSS"], [0.01, "100× LESS"]]) {
      el("line", { class: "tick", x1: X(FLOOR / f), x2: X(10), y1: Y(FLOOR), y2: Y(10 * f), "stroke-dasharray": f === 1 ? "4 4" : "1 4" }, g);
    }

    const marks = el("g", { fill: "none", stroke: "var(--print-ink)", "stroke-width": 1.2 }, svg);
    rows.forEach((r, i) => {
      const [, group, name, pm, wb] = r;
      const x = X(Math.max(pm, FLOOR)), y = Y(Math.max(wb, FLOOR));
      const m = SHAPE[group](marks, x, y, 3.4);
      m.setAttribute("opacity", chosen === null || chosen === i ? 0.85 : 0.45);
      if (chosen === i) { m.setAttribute("stroke", "var(--accent-print)"); m.setAttribute("stroke-width", 2.4); }
      const hit = el("circle", { class: "mark-hit mark", cx: x, cy: y, r: 9, tabindex: chosen === i || (chosen === null && i === 0) ? 0 : -1, role: "button", "aria-label": `${name}: my 2025 rule gives up ${pm.toPrecision(2)}, weighted ${wb.toPrecision(2)} points per 100` }, marks);
      hit.addEventListener("click", () => pick(i));
      hit.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(i); }
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); pick((i + (e.key === "ArrowRight" ? 1 : rows.length - 1)) % rows.length, true); }
      });
    });
    if (chosen !== null && focusNext) { svg.querySelectorAll(".mark-hit")[chosen]?.focus(); focusNext = false; }
  }
  let focusNext = false;
  async function pick(i, focus = false) {
    chosen = i; focusNext = focus;
    draw();
    const [, , raw, pm, wb] = rows[i], name = display(raw);
    $("held-name").textContent = `${name} (${i + 1} of ${rows.length}), solving…`;
    $("hd-pm-paper").textContent = fmtLoss(pm);
    $("hd-wb-paper").textContent = fmtLoss(wb);
    $("hd-pm-here").textContent = "…";
    $("hd-wb-here").textContent = "…";
    if (!params) params = await fetch(new URL("../data/heldout.json", import.meta.url)).then((r) => r.json());
    const h = params[i];
    const res = await solve({ kind: "heldout", family: h.family, p: h.p, horizon: h.horizon });
    if (chosen !== i) return;
    $("held-name").textContent = `${name} (${i + 1} of ${rows.length})`;
    $("hd-pm-here").textContent = fmtHere(res.loss.pm);
    $("hd-wb-here").textContent = fmtHere(res.loss.wb);
    lastRes = res;
    drawLanes($("held-lanes"), res);
  }
  onResize(svg, draw);
  onResize($("held-lanes"), () => { if (lastRes) drawLanes($("held-lanes"), lastRes); });
  draw();
  // start with the schedule where the per-moment rule loses the most
  let worst = 0;
  rows.forEach((r, i) => { if (r[3] > rows[worst][3]) worst = i; });
  let started = false;
  const first = () => { if (!started) { started = true; io.disconnect(); if (chosen === null) pick(worst); } };
  const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) first(); }, { rootMargin: "300px 0px" });
  io.observe(svg);
  setTimeout(first, 4000);
}

// ------------------------------------------------------------------ the first-order lead
export function initWave(firstOrder) {
  const svg = $("wave-svg"), lead = $("lead-svg"), input = $("w-omega");
  if (!svg) return;
  const LO = 0.25, HI = 16;
  const omegaOf = (v) => LO * (HI / LO) ** (v / 1000);
  const vOf = (om) => Math.round((1000 * Math.log(om / LO)) / Math.log(HI / LO));
  input.value = vOf(2);
  const snap = () => {
    const om = omegaOf(+input.value);
    for (const r of firstOrder) if (Math.abs(Math.log(om / r.omega)) < 0.06) return r;
    return null;
  };
  function draw() {
    const dp = snap();
    const om = dp ? dp.omega : omegaOf(+input.value);
    const tr = transfer(0.1, om);
    $("w-out").textContent = om.toFixed(om < 1 ? 2 : 1);
    const rad = (tr.lead * Math.PI) / 180, dt = rad / om;
    $("w-lead").textContent = `${tr.lead.toFixed(1)}°, ${dt.toFixed(2)} time units`;
    $("w-gain").textContent = `${(100 * tr.gain).toFixed(1)}%`;
    // two cycles: the cost on top, the bounds' swings beneath, as shares of the per-moment swing
    clear(svg);
    const { w, h } = size(svg);
    const padL = 46, padR = 12, scaleH = 22, cTop = 22, cBottom = Math.round(h * 0.27), bTop = cBottom + 32, bBottom = h - scaleH - 8;
    const T = (4 * Math.PI) / om;
    const X = lin(0, T, padL, w - padR), CY = lin(-1.3, 1.3, cBottom, cTop), BY = lin(-1.25, 1.25, bBottom, bTop);
    const g = el("g", {}, svg);
    text(g, padL, 11, w < 520 ? "COST, 0.1 ± 10%" : "COST OF TIME, 0.1 WITH A 10% WIGGLE", { class: "t-key" });
    text(g, padL, bTop - 12, w < 520 ? "BOUNDS, AS A SHARE OF MY 2025 RULE’S SWING" : "HOW THE BOUNDS MOVE, AS A SHARE OF MY 2025 RULE’S SWING", { class: "t-key" });
    for (const v of [-1, 0, 1]) {
      el("line", { class: "grid", x1: padL, x2: w - padR, y1: BY(v), y2: BY(v) }, g);
      text(g, padL - 6, BY(v) + 4, v === 0 ? "0" : v > 0 ? "+1" : "−1", { "text-anchor": "end" });
    }
    el("line", { class: "grid", x1: padL, x2: w - padR, y1: CY(0), y2: CY(0) }, g);
    const ts = Array.from({ length: 241 }, (_, i) => (i * T) / 240);
    el("path", { class: "c-cost", d: line(ts, ts.map((t) => Math.sin(om * t)), X, CY) }, g);
    el("path", { class: "c-pm", d: line(ts, ts.map((t) => -Math.sin(om * t)), X, BY) }, g);
    el("path", { class: "c-wb", d: line(ts, ts.map((t) => -tr.gain * Math.sin(om * t + rad)), X, BY) }, g);
    if (dp) {
      const [gain, deg] = dp.exact, r2 = (deg * Math.PI) / 180;
      for (let i = 0; i <= 32; i++) { const t = (i * T) / 32; el("circle", { class: "dp-dot", cx: X(t), cy: BY(-gain * Math.sin(om * t + r2)), r: 3 }, g); }
    }
    // the finish reading: the cost's second peak, and the weighted bound's low point before it
    const tPeak = (Math.PI / 2 + 2 * Math.PI) / om, tLead = tPeak - dt;
    el("line", { class: "tick", x1: X(tPeak), x2: X(tPeak), y1: cTop, y2: bBottom }, g);
    el("line", { class: "tick", x1: X(tLead), x2: X(tLead), y1: bTop, y2: bBottom, "stroke-width": 2 }, g);
    const yb = BY(-1.12);
    el("path", { class: "tick", d: `M${X(tLead)},${yb}H${X(tPeak)}`, "stroke-width": 2 }, g);
    text(g, X(tLead) - 4, BY(-1.05) + 14, "BOUNDS’ LOW", { class: "t-key", "text-anchor": "end" });
    text(g, X(tPeak) + 6, cTop - 4, "COST PEAKS", { class: "t-key" });
    timeScale(g, X, 0, T, h - scaleH, scaleH, w);
    drawLead(om);
  }
  function drawLead(om) {
    clear(lead);
    const { w, h } = size(lead);
    const padL = 34, padR = 10, top = 18, padB = 30;
    const X = logScale(LO, HI, padL, w - padR), Y = lin(0, 50, h - padB, top);
    const g = el("g", {}, lead);
    text(g, padL, 10, "LEAD IN DEGREES, AGAINST {ω}", { class: "t-key" });
    for (const v of [0, 15, 30, 45]) {
      el("line", { class: "grid", x1: padL, x2: w - padR, y1: Y(v), y2: Y(v), "stroke-dasharray": v === 45 ? "4 4" : null }, g);
      text(g, padL - 5, Y(v) + 4, `${v}°`, { "text-anchor": "end" });
    }
    text(g, w - padR, Y(45) - 5, "AN EIGHTH OF A CYCLE", { class: "t-key", "text-anchor": "end" });
    for (const v of [0.25, 1, 4, 16]) text(g, X(v), h - padB + 15, String(v), { "text-anchor": "middle" });
    const oms = Array.from({ length: 80 }, (_, i) => LO * (HI / LO) ** (i / 79));
    el("path", { class: "c-wb", d: line(oms, oms.map((o) => transfer(0.1, o).lead), X, Y) }, g);
    el("path", { class: "c-pm", d: `M${X(LO)},${Y(0)}H${X(HI)}` }, g);
    for (const r of firstOrder) el("circle", { class: "dp-dot", cx: X(r.omega), cy: Y(r.exact[1]), r: 3.4 }, g);
    el("line", { class: "hair", x1: X(om), x2: X(om), y1: top, y2: h - padB }, g);
  }
  input.addEventListener("input", draw);
  onResize(svg, draw);
  onResize(lead, () => drawLead(snap()?.omega ?? omegaOf(+input.value)));
  draw();
}

// ------------------------------------------------------------------ tables
export function initUnknown(rows) {
  const body = document.querySelector("#unknown-table tbody");
  if (!body) return;
  body.innerHTML = rows.map(([name, ...v]) => `<tr><th scope="row">${name}</th>${v.map((x) => `<td>${x.toFixed(3)}</td>`).join("")}</tr>`).join("");
}

export function initChecks(checks) {
  const body = document.querySelector("#checks-table tbody");
  if (!body || !checks) return;
  const date = new Date(`${checks.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const passed = checks.rows.filter((r) => r.pass).length;
  $("checks-cap").textContent = `Browser against the Python reference: ${passed} of ${checks.rows.length} checks passed, ${date}`;
  const count = document.getElementById("checks-count");
  if (count) count.textContent = `${passed} of ${checks.rows.length} pass`;
  body.innerHTML = checks.rows.map((r) => `<tr><td>${r.pass ? '<span class="ok" aria-label="Passed"></span>' : "Failed: "}${r.name}</td><td data-tol="allowed ${r.tol}${r.unit}">${r.worst}${r.unit}</td><td>${r.tol}${r.unit}</td></tr>`).join("");
}
