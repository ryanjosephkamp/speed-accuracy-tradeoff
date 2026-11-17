// The cost lab: pick a schedule or draw one, and the browser solves the exact policy by dynamic
// programming, computes both rules, and scores all three exactly (compute.js, in a worker). The
// accent line marks one moment; the shadow ahead of it is the look-ahead weight w(s) for the
// weighted rule's bound at that moment, fading as the weight still to come runs out.
// Time in units of sigma^2 / mu^2; bounds drawn in evidence units, labeled as confidence.
import { PRESETS, presetById } from "./schedules.js";
import { boundForCost, belief, kernelForBound, kernelMedian } from "./model.js";
import { describe, drawnCost } from "./compute.js";
import { solve } from "./solver.js";
import { el, text, clear, size, lin, logScale, line, timeScale } from "./svg.js";
import { colorWord } from "./appearance.js";

const $ = (id) => document.getElementById(id);
const CONF = [0.6, 0.7, 0.8, 0.9, 0.95, 0.99, 0.999];
const bFor = (p) => 0.5 * Math.log(p / (1 - p));
export const pctConf = (b) => (b === null || b === undefined ? "–" : b === 0 ? "decide now" : `${(100 * belief(b)).toFixed(1)}%`);
const fmtCost = (c) => (!Number.isFinite(c) ? "∞" : c >= 1 ? c.toFixed(2) : c >= 0.1 ? c.toFixed(3) : c.toPrecision(2));
export const fmtLoss = (v) => (v < 1e-5 ? "under 10⁻⁵" : v < 1e-3 ? v.toExponential(1).replace(/e(-?\d+)/, (_, e) => `×10${toSup(e)}`) : v.toPrecision(3));
/** A loss computed here, to the precision the browser's coarser grid supports. */
export const fmtHere = (v) => (v < 0.005 ? "under 0.01" : v.toFixed(2));
const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const toSup = (s) => [...s].map((ch) => SUP[ch] ?? ch).join("");

const DRAW_VIEW = 2.5, DRAW_HORIZON = 8, KNOTS = 101, C_LO = 0.01, C_HI = 4;

/** Draws a schedule's lanes: the cost on a log scale, the three bounds, and the timing scale. */
export function drawLanes(svg, data, opts = {}) {
  clear(svg);
  const { w, h } = size(svg);
  const padL = 46, padR = 12, scaleH = 22;
  const costTop = 20, costBottom = Math.round(costTop + (h - scaleH) * 0.27);
  const bTop = costBottom + 30, bBottom = h - scaleH - 6;
  const X = lin(0, data.view, padL, w - padR);
  const finite = data.cost.filter(Number.isFinite);
  const cLo = opts.drawable ? C_LO : Math.max(Math.min(...finite) / 1.8, 0.002);
  const cHi = opts.drawable ? C_HI : Math.min(Math.max(...finite) * 1.8, 80);
  const CY = logScale(cLo, cHi, costBottom, costTop);
  const curves = [data.exact, data.pm, data.wb].flat().filter((v) => v !== null && Number.isFinite(v));
  const bHi = Math.max(Math.min(Math.max(...curves) * 1.12, 4), 0.8);
  const BY = lin(0, bHi, bBottom, bTop);
  const g = el("g", {}, svg);

  // lane labels and grids
  text(g, padL, 11, "COST OF TIME, LOG SCALE", { class: "t-key" });
  text(g, padL, bTop - 10, "BOUNDS, AS THE CONFIDENCE THEY ASK FOR", { class: "t-key" });
  for (const c of logTicks(cLo, cHi)) {
    el("line", { class: "grid", x1: padL, x2: w - padR, y1: CY(c), y2: CY(c) }, g);
    text(g, padL - 6, CY(c) + 4, String(c), { "text-anchor": "end" });
  }
  let lastY = Infinity;
  for (const p of CONF) {
    const y = BY(bFor(p));
    if (y < bTop || lastY - y < 16) continue;
    lastY = y;
    el("line", { class: "grid", x1: padL, x2: w - padR, y1: y, y2: y }, g);
    text(g, padL - 6, y + 4, `${+(p * 100).toFixed(1)}%`, { "text-anchor": "end" });
  }
  el("line", { class: "grid", x1: padL, x2: w - padR, y1: BY(0), y2: BY(0) }, g);
  text(g, padL - 6, BY(0) + 4, "50%", { "text-anchor": "end" });

  const shadow = el("g", {}, g); // the look-ahead shadow sits under the curves
  // the cost
  el("path", { class: `c-cost${opts.drawable ? " drawable" : ""}`, d: line(data.t, data.cost, X, CY, [cLo, cHi]) }, g);
  if (data.deadline !== null && data.deadline !== undefined && data.deadline <= data.view) {
    const x = X(data.deadline);
    el("line", { class: "tick", x1: x, x2: x, y1: costTop, y2: bBottom, "stroke-dasharray": "3 3" }, g);
    text(g, x - 4, costTop + 10, "DEADLINE", { class: "t-key", "text-anchor": "end" });
  }
  if (opts.drawable) text(g, w - padR, costTop + 4, "DRAW HERE", { class: "draw-hint t-key", "text-anchor": "end" });
  // the bounds: per-moment, weighted, exact
  const dim = opts.pending ? " dim" : "";
  el("path", { class: "c-pm", d: line(data.t, data.pm, X, BY, [0, bHi]) }, g);
  el("path", { class: `c-wb${dim}`, d: line(data.t, data.wb ?? [], X, BY, [0, bHi]) }, g);
  el("path", { class: `c-ex${dim}`, d: line(data.t, data.exact ?? [], X, BY, [0, bHi]) }, g);
  timeScale(g, X, 0, data.view, h - scaleH, scaleH, w);
  return { g, shadow, X, CY, BY, costTop, costBottom, bTop, bBottom, padL, padR, w, h, scaleH, cLo, cHi };
}

function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 3]) { const v = m * 10 ** e; if (v >= lo && v <= hi) out.push(+v.toPrecision(2)); }
  }
  return out.length > 4 ? out.filter((_, i) => i % 2 === 0) : out;
}

export function initLab() {
  const svg = $("lab-svg");
  if (!svg) return;
  const st = { id: "jump", params: {}, mode: "preset", data: null, hair: 0.35, knots: null, busy: false, seq: 0 };
  for (const p of PRESETS) st.params[p.id] = Object.fromEntries(p.params.map((q) => [q.id, q.value]));

  // schedule chips
  const seg = $("presets");
  const row = document.createElement("div");
  row.className = "seg-row";
  for (const p of [...PRESETS, { id: "draw", label: "Draw your own" }]) {
    const lab = document.createElement("label");
    lab.innerHTML = `<input type="radio" name="preset" value="${p.id}"${p.id === st.id ? " checked" : ""}><span>${p.label}</span>`;
    row.append(lab);
  }
  seg.append(row);
  seg.addEventListener("change", (e) => {
    const id = e.target.value;
    if (id === "draw") { st.mode = "draw"; if (!st.knots) st.knots = flatKnots(); }
    else { st.mode = "preset"; st.id = id; st.hair = defaultHair(); }
    dials(); run();
  });

  function dials() {
    svg.style.touchAction = st.mode === "draw" ? "none" : "";
    const box = $("preset-dials");
    box.innerHTML = "";
    if (st.mode === "draw") {
      box.innerHTML = `<p class="help">Drag across the cost lane to draw how the cost of time changes; it stays at its last value after ${DRAW_VIEW} time units. Then slide the ${colorWord("accent")} line.</p><div class="actions"><button type="button" class="btn" id="draw-reset">Start over</button></div>`;
      $("draw-reset").addEventListener("click", () => { st.knots = flatKnots(); run(); });
      return;
    }
    const preset = presetById(st.id);
    for (const q of preset.params) {
      const lab = document.createElement("label");
      lab.className = "dial";
      lab.innerHTML = `<span class="dial-key">${q.label}</span><output></output><input type="range" min="${q.min}" max="${q.max}" step="${q.step}" value="${st.params[st.id][q.id]}">`;
      const input = lab.querySelector("input"), out = lab.querySelector("output");
      const show = () => { out.textContent = fmtParam(q, +input.value); };
      show();
      let timer = 0;
      input.addEventListener("input", () => {
        st.params[st.id][q.id] = +input.value; show();
        clearTimeout(timer); timer = setTimeout(run, 140);
      });
      box.append(lab);
    }
  }
  const fmtParam = (q, v) => {
    if (q.unit === "×") return `${v}×`;
    if (q.unit === "%") return `${Math.round(v * 100)}%`;
    if (q.id === "omega") return `ω = ${v.toFixed(1)}`;
    if (q.id === "rate") return `${v.toFixed(2)} per unit time`;
    if (q.id === "c") return v.toFixed(2);
    return `t = ${v.toFixed(2)}`;
  };
  function defaultHair() {
    const p = st.params[st.id];
    return st.id === "wave" ? 1.2 : Math.max(0.05, (p.at ?? 0.5) - 0.15);
  }
  const flatKnots = () => Array.from({ length: KNOTS }, (_, i) => [(i * DRAW_VIEW) / (KNOTS - 1), Math.log(0.1)]);
  const spec = () => (st.mode === "draw"
    ? { kind: "drawn", knots: st.knots.map(([t, l]) => [t, l]), horizon: DRAW_HORIZON, view: DRAW_VIEW }
    : { kind: "preset", id: st.id, params: { ...st.params[st.id] } });

  // a quick picture first (cost and per-moment rule), then the full solution from the worker
  function sketch() {
    const { cost, view, deadline } = describe(spec());
    const t = [], c = [], pm = [];
    for (let k = 0; k * 0.01 <= view + 1e-9; k++) { const tk = +(k * 0.01).toFixed(3); t.push(tk); c.push(cost(tk)); pm.push(boundForCost(cost(tk))); }
    return { t, cost: c, pm, exact: st.data?.exact ?? [], wb: st.data?.wb ?? [], view, deadline };
  }
  let geo = null;
  function render(pending) {
    const data = pending ? sketch() : st.data;
    if (!data) return;
    if (pending && st.data && st.data.t.length === data.t.length) { data.exact = st.data.exact; data.wb = st.data.wb; }
    else if (pending) { data.exact = []; data.wb = []; }
    geo = drawLanes(svg, data, { drawable: st.mode === "draw", pending });
    geo.data = data;
    hairline(pending);
  }
  function run() {
    const id = ++st.seq;
    $("lab-busy").hidden = false;
    render(true);
    readLosses(null);
    solve(spec()).then((res) => {
      if (id !== st.seq) return;
      st.data = res;
      $("lab-busy").hidden = true;
      render(false);
      readLosses(res);
    }).catch((err) => {
      if (id !== st.seq) return;
      $("lab-busy").textContent = `Couldn’t solve this one: ${err.message}`;
    });
  }
  function readLosses(res) {
    if (!res) { for (const id of ["loss-pm", "loss-wb", "loss-rec"]) $(id).textContent = "…"; $("lab-ms").textContent = ""; return; }
    const { pm, wb } = res.loss;
    $("loss-pm").textContent = fmtHere(pm);
    $("loss-wb").textContent = fmtHere(wb);
    $("loss-rec").textContent = pm >= 0.2 ? `${Math.round(100 * (1 - Math.max(wb, 0) / pm))}%` : "–";
    const ms = res.ms.exact + res.ms.rules + res.ms.scoring;
    $("lab-ms").textContent = `Solved here in ${Math.round(ms).toLocaleString("en-US")} ms: ${res.steps.toLocaleString("en-US")} steps of dynamic programming.`;
  }

  // ------------------------------------------------------------ the line and its shadow
  let hairG = null;
  function hairline(pending) {
    if (!geo) return;
    hairG?.remove();
    const { X, CY, costTop, bBottom, h, scaleH, data } = geo;
    const t = Math.min(Math.max(st.hair, 0), data.view);
    const k = Math.min(Math.round(t / 0.01), data.t.length - 1);
    const x = X(t);
    // the shadow: w(s) for the weighted bound here, fading as the weight still to come runs out
    geo.shadow.replaceChildren();
    const b = data.wb?.[k];
    let median = null;
    if (!pending && b !== undefined && b !== null && b > 0) {
      const kern = kernelForBound(b), { s, w } = kern;
      median = kernelMedian(kern);
      let acc = 0;
      const id = "lab-shadow";
      const span = Math.max(X(data.view) - x, 1);
      const grad = el("linearGradient", { id, gradientUnits: "userSpaceOnUse", x1: x, x2: X(data.view), y1: 0, y2: 0 }, geo.shadow);
      el("stop", { offset: 0, style: "stop-color: var(--print-ink)", "stop-opacity": 0.3 }, grad);
      for (let j = 0; j < s.length; j++) {
        acc += w[j];
        const off = (X(t + s[j]) - x) / span;
        if (off > 1) break;
        if (j % 4 === 0 || acc > 0.98) el("stop", { offset: off.toFixed(4), style: "stop-color: var(--print-ink)", "stop-opacity": (0.3 * (1 - acc)).toFixed(3) }, grad);
      }
      el("rect", { x, y: costTop - 6, width: span, height: bBottom - costTop + 6, fill: `url(#${id})`, class: "shadow" }, geo.shadow);
      if (median !== null && t + median <= data.view) {
        const xm = X(t + median);
        el("line", { class: "tick", x1: xm, x2: xm, y1: costTop - 6, y2: geo.costBottom }, geo.shadow);
        text(geo.shadow, xm + 4, geo.costBottom - 4, "HALF ITS WEIGHT", { class: "t-key" });
      }
    }
    hairG = el("g", { class: "hair-g" }, svg);
    el("line", { class: "hair", x1: x, x2: x, y1: costTop - 6, y2: h - scaleH }, hairG);
    const label = `t = ${t.toFixed(2)}`;
    const tw = label.length * 6.2 + 10;
    const bx = Math.min(Math.max(x - tw / 2, 0), geo.w - tw);
    // the reading sits just above the timing scale, so the scale's numerals stay visible
    el("rect", { class: "hair-tab", x: bx, y: h - scaleH - 19, width: tw, height: 17 }, hairG);
    text(hairG, bx + tw / 2, h - scaleH - 6.5, label, { class: "hair-tab-t", "text-anchor": "middle" });
    el("line", { class: "hair-hit", x1: x, x2: x, y1: costTop - 6, y2: h }, hairG);
    // readout
    $("al-t").textContent = t.toFixed(2);
    $("al-c").textContent = fmtCost(data.cost[k]);
    $("al-ex").textContent = pending ? "…" : pctConf(data.exact?.[k]);
    $("al-pm").textContent = pctConf(data.pm[k]);
    $("al-wb").textContent = pending ? "…" : pctConf(data.wb?.[k]);
    svg.setAttribute("aria-valuetext", `t = ${t.toFixed(2)}`);
  }

  // ------------------------------------------------------------ pointer: move the line, or draw
  let mode = null, prev = null;
  const local = (e) => { const r = svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  svg.addEventListener("pointerdown", (e) => {
    if (!geo) return;
    const [px, py] = local(e);
    if (st.mode === "draw" && py >= geo.costTop - 8 && py <= geo.costBottom + 8) {
      mode = "draw"; prev = null; paint(px, py);
    } else {
      mode = "hair"; st.hair = geo.X.inv(px); hairline(false);
    }
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  svg.addEventListener("pointermove", (e) => {
    if (!mode) return;
    const [px, py] = local(e);
    if (mode === "draw") paint(px, py);
    else { st.hair = geo.X.inv(px); hairline(!st.data || $("lab-busy").hidden === false); }
  });
  const up = () => { if (mode === "draw") run(); mode = null; prev = null; };
  svg.addEventListener("pointerup", up);
  svg.addEventListener("pointercancel", up);
  function paint(px, py) {
    const t = Math.min(Math.max(geo.X.inv(px), 0), DRAW_VIEW);
    const l = Math.log(Math.min(Math.max(geo.CY.inv(py), C_LO), C_HI));
    const i1 = Math.round((t / DRAW_VIEW) * (KNOTS - 1));
    if (prev) {
      const [i0, l0] = prev, n = Math.abs(i1 - i0);
      for (let j = 0; j <= n; j++) { const i = i0 + Math.sign(i1 - i0) * j; st.knots[i][1] = n ? l0 + ((l - l0) * j) / n : l; }
    } else st.knots[i1][1] = l;
    prev = [i1, l];
    st.seq++; // a solve in flight is now stale
    render(true);
  }
  // keyboard: the print is a slider for the line's time
  svg.setAttribute("tabindex", "0");
  svg.setAttribute("role", "slider");
  svg.setAttribute("aria-label", "Moment marked by the line, in units of σ²/μ²");
  svg.addEventListener("keydown", (e) => {
    if (!geo) return;
    const step = geo.data.view / 100;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") st.hair += step;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") st.hair -= step;
    else if (e.key === "Home") st.hair = 0;
    else if (e.key === "End") st.hair = geo.data.view;
    else return;
    e.preventDefault();
    st.hair = Math.min(Math.max(st.hair, 0), geo.data.view);
    hairline(false);
  });

  new ResizeObserver(() => { if (geo) render(!st.data); }).observe(svg);
  st.hair = defaultHair();
  dials();
  // solve once the lab is near the screen
  let started = false;
  const first = () => { if (!started) { started = true; io.disconnect(); run(); } };
  const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) first(); }, { rootMargin: "600px 0px" });
  io.observe(svg);
  setTimeout(first, 2500); // the worker solves it off the main thread, so it can start unseen
  render(true);
}
