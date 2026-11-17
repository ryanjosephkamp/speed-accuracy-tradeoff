// What it could be good for: four of the paper's solved examples, each a small print of the cost
// of time and the three bounds (best, the 2025 per-moment rule, the weighted look-ahead rule), as
// stored in experiments/results/showcase.json, and the goalkeeper's, the walking robot's, and the
// field recorder's schedules solved the same way (site/data/scenes.json), plus the working examples
// beside them (car.js, keeper.js, sorter.js, robot.js, recorder.js, lander.js, and labtest.js
// twice). Bounds are in evidence units, labeled as the confidence they require; cost on a log
// scale. Each plot is drawn at its own pixel size, so its labels stay the same size on a phone and
// on a wide screen.
//
// Every print can be read at any moment: hover with a mouse, drag along it with a finger, or focus
// it and use the arrow keys. A tap (or Enter) on a working example's print sends that moment to the
// example: the cars, the keepers, the robots, the recorders, or the landers move there, and each lab
// test marks it on its urgency plot.
import { UNIT_MS } from "./lab-model.js";
import { valueAt, readout } from "./print-read.js";
import { initCar } from "./car.js";
import { initKeeper } from "./keeper.js";
import { initRobot } from "./robot.js";
import { initRecorder } from "./recorder.js";
import { initLander } from "./lander.js";
import { initSorter } from "./sorter.js";
import { initLabTest, LAB } from "./labtest.js";

const NS = "http://www.w3.org/2000/svg";
const el = (name, attrs, parent) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
};
const conf = (p) => 0.5 * Math.log(p / (1 - p)); // bound for a required confidence p
const HINT = "Hover over the print, or drag along it, to read it at any moment.";

export function initScenarios(show) {
  if (!show) return;
  for (const card of document.querySelectorAll(".scn")) {
    const r = show[+card.dataset.scn], svg = card.querySelector(".scn-plot");
    if (!r) continue;
    const read = card.querySelector(".scn-read"), unit = card.dataset.unit || "", pilot = card.dataset.pilot || "";
    read.textContent = HINT;
    let width = 0, geo = null, at = null;
    const paint = () => {
      const w = Math.round(svg.getBoundingClientRect().width);
      if (!w || w === width) return;
      width = w;
      geo = draw(svg, r, +card.dataset.at, w, +card.dataset.every || 0);
      if (at != null) mark(at);
    };
    new ResizeObserver(paint).observe(svg);
    paint();

    // ---- reading the print at one moment
    const tMax = r.t[r.t.length - 1], step = r.t[1] - r.t[0];
    function mark(t) {
      at = Math.min(Math.max(t, 0), tMax);
      const g = geo;
      if (!g) return;
      g.hover.removeAttribute("visibility");
      const x = g.X(at);
      g.rule.setAttribute("x1", x); g.rule.setAttribute("x2", x);
      for (const key of ["wb", "pm", "exact"]) {
        const b = valueAt(r, key, at), dot = g.dots[key];
        if (b == null || !Number.isFinite(b)) { dot.setAttribute("visibility", "hidden"); continue; }
        dot.removeAttribute("visibility");
        dot.setAttribute("cx", x); dot.setAttribute("cy", g.Y(Math.max(b, 0)));
      }
      read.textContent = readout(r, at, unit, UNIT_MS, +card.dataset.per || 1);
      read.classList.add("on");
    }
    function clearMark() {
      if (document.activeElement === svg) return;
      at = null;
      if (geo) geo.hover.setAttribute("visibility", "hidden");
      read.classList.remove("on");
      read.textContent = HINT;
    }
    const tFrom = (e) => { const b = svg.getBoundingClientRect(); return geo ? geo.Xinv(e.clientX - b.left) : 0; };
    const send = (t) => { if (pilot) document.dispatchEvent(new CustomEvent("scn:seek", { detail: { pilot, t } })); };
    svg.setAttribute("tabindex", "0");
    svg.classList.add("live");
    if (pilot) svg.classList.add("seeks");
    let down = null;
    svg.addEventListener("pointermove", (e) => { mark(tFrom(e)); });
    svg.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; mark(tFrom(e)); });
    svg.addEventListener("pointerup", (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12) send(tFrom(e));
      down = null;
    });
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") clearMark(); });
    svg.addEventListener("focus", () => mark(at ?? +card.dataset.at * 0.8));
    svg.addEventListener("blur", () => { at = null; clearMark(); });
    svg.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (d) { e.preventDefault(); mark((at ?? 0) + d * step * (e.shiftKey ? 5 : 1)); }
      else if ((e.key === "Enter" || e.key === " ") && at != null) { e.preventDefault(); send(at); }
    });
  }
  // each scene on its own, so one that fails leaves the others running (and says why)
  for (const start of [initCar, initKeeper, initSorter, initRobot, initRecorder, initLander, () => initLabTest(show, LAB.rise), () => initLabTest(show, LAB.lift)]) {
    try { start(); } catch (e) { console.error(e); }
  }
}

function draw(svg, r, at, W, every) {
  const H = Math.round(Math.min(Math.max(W * 0.5, 176), 250));
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("height", H);
  svg.replaceChildren();
  const x0 = 38, x1 = W - 6, yTop = 22, cBot = H - 26, cTop = cBot - Math.round((H - 48) * 0.2), yBot = cTop - 12;
  const tMax = r.t[r.t.length - 1];
  const X = (t) => x0 + ((x1 - x0) * t) / tMax;
  const Xinv = (x) => Math.min(Math.max(((x - x0) / (x1 - x0)) * tMax, 0), tMax);
  const fin = (a) => a.filter((v) => v != null && Number.isFinite(v));
  const bMax = Math.max(...fin(r.exact), ...fin(r.pm), ...fin(r.wb)) * 1.06;
  const Y = (b) => yBot - ((yBot - yTop) * b) / bMax;
  el("text", { x: 0, y: 10 }, svg).textContent = "CONFIDENCE REQUIRED";
  // confidence scale
  for (const p of [0.5, 0.75, 0.9, 0.97]) {
    const b = conf(p);
    if (b > bMax) continue;
    el("line", { class: "grid", x1: x0, x2: x1, y1: Y(b), y2: Y(b), opacity: p === 0.5 ? 1 : 0.5 }, svg);
    el("text", { x: x0 - 6, y: Y(b) + 3.5, "text-anchor": "end" }, svg).textContent = `${Math.round(p * 100)}%`;
  }
  // the time scale: major and minor ticks, the unit on the first label
  const major = tMax <= 1.2 ? 0.5 : 1, minor = tMax <= 1.2 ? 0.1 : 0.25;
  for (let i = 0; i * minor <= tMax + 1e-9; i++) {
    const t = i * minor, isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    el("line", { class: "grid", x1: X(t), x2: X(t), y1: cBot, y2: cBot + (isMajor ? 5 : 3) }, svg);
    if (isMajor) el("text", { x: X(t), y: cBot + 17, "text-anchor": t === 0 ? "start" : "middle" }, svg).textContent = t === 0 ? "0 σ²/μ²" : String(+t.toFixed(1));
  }
  // the cost of time, as a band whose height follows its log
  const costs = fin(r.cost), lo = Math.log(Math.min(...costs)), hi = Math.log(Math.max(...costs));
  const h = (c) => (c == null || !Number.isFinite(c) ? 1 : hi - lo < 1e-9 ? 0.35 : 0.15 + (0.85 * (Math.log(c) - lo)) / (hi - lo));
  let d = `M${X(r.t[0])},${cBot}`;
  r.t.forEach((t, i) => { d += `L${X(t).toFixed(1)},${(cBot - (cBot - cTop) * h(r.cost[i])).toFixed(1)}`; });
  d += `L${X(r.t[r.t.length - 1])},${cBot}Z`;
  el("path", { class: "cost", d }, svg);
  el("text", { x: x0 - 6, y: cBot - 3, "text-anchor": "end" }, svg).textContent = "COST";
  // when the cost changes (or, for a rhythm, each time it peaks)
  for (let t = at; Number.isFinite(t) && t <= tMax + 1e-9; t += every || Infinity) el("line", { class: "ev", x1: X(t), x2: X(t), y1: yTop, y2: cBot }, svg);
  // the three bounds: the look-ahead rule as a wide sleeve under the best bound, so where they
  // agree the best bound shows inside it
  const line = (arr, cls) => {
    let path = "", pen = false;
    arr.forEach((b, i) => {
      if (b == null || !Number.isFinite(b)) { pen = false; return; }
      path += `${pen ? "L" : "M"}${X(r.t[i]).toFixed(1)},${Y(Math.max(b, 0)).toFixed(1)}`;
      pen = true;
    });
    el("path", { class: cls, d: path }, svg);
  };
  line(r.wb, "wb");
  line(r.pm, "pm");
  line(r.exact, "ex");
  // the reading at one moment: a rule and a dot on each bound, hidden until used
  const hover = el("g", { class: "hover", visibility: "hidden" }, svg);
  const rule = el("line", { class: "hover-rule", x1: 0, x2: 0, y1: yTop, y2: cBot }, hover);
  const dots = { wb: el("circle", { class: "hd-wb", r: 4.5 }, hover), pm: el("circle", { class: "hd-pm", r: 3.4 }, hover), exact: el("circle", { class: "hd-ex", r: 3.4 }, hover) };
  // a wide transparent target, so the whole plot answers the pointer
  el("rect", { class: "hit", x: x0, y: 0, width: x1 - x0, height: H }, svg);
  return { X, Xinv, Y, hover, rule, dots };
}
