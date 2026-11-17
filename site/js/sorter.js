// The recycling sorter, drawn flat: three chutes, one per rule, carry the same stream of flakes past
// the sensor to the jets (sorter-model.js). A flake is a circle if it is PET and a square if it is
// HDPE; the reader can see which, the sorter can't. It is drawn hollow while its rule is still
// reading it, and filled in the color of the bin it chose once it has chosen; at the jets it is
// pushed into that bin, and one still hollow there goes where its readings lean. Flakes slide at
// four speeds, so each has its own deadline: the best walls close by it, and so do the look-ahead
// rule's, while my 2025 rule's are the same for every flake, so on its chute the fast flakes reach
// the jets still hollow. Beside the chutes, the walls each rule sets for each speed; below them, the
// runs (runs.js), every flake that reaches its bin counted.
import { sorterModels, sorterMix, sorterNumbers, confidenceAtRow, SORTER } from "./sorter-model.js";
import { RULES, runLanes } from "./lanes.js";
import { DT } from "./lattice.js";
import { Rng, freshSeed } from "./rng.js";
import { audio } from "./sound.js";
import { createRuns } from "./runs.js";

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const RATE = 0.2;            // time units per real second
const EVERY = 0.13;          // time units between flakes entering
const INTO = 0.18;           // time units from the jets into a bin
const NAME = { [-1]: "PET", 1: "HDPE" };
const $ = (root, sel) => root.querySelector(sel);

export function initSorter() {
  const root = document.getElementById("sorter");
  if (!root) return;
  const models = sorterModels(), mix = sorterMix(models), K = models.length;
  const nums = sorterNumbers(models);
  for (const el of root.querySelectorAll("[data-so-n]")) if (typeof nums[el.dataset.soN] === "string") el.textContent = nums[el.dataset.soN];
  const cv = $(root, ".so-chutes"), wallsSvg = $(root, ".so-walls");
  const ui = { play: $(root, "[data-so=play]"), step: $(root, "[data-so=step]"), many: $(root, "[data-so=many]"), status: $(root, ".so-status") };
  const seed = Number.parseInt(new URLSearchParams(location.search).get("seed"), 10) >>> 0 || freshSeed();
  const rng = new Rng(seed ^ 0x9b05688c);
  const runs = createRuns(root, mix, { one: "flake", many: "flakes", who: "sorter", did: "binned right", at: "At the jets", per: SORTER.ms, unit: "ms" });
  // a flake: when it entered, its speed (which deadline), and its run (the same for all three chutes)
  const newFlake = (t0) => { const k = Math.floor(rng.next() * K); return { t0, k, T: SORTER.deadlines[k], run: runLanes(models[k], rng), counted: false }; };
  const st = { t: 0, next: 0, flakes: [], sorted: 0, prefill: false, bins: RULES.map(() => ({ right: 0, all: 0, forced: 0 })), playing: !reduced.matches, visible: false, last: 0, colors: {} };

  // ------------------------------------------------------------ the stream
  function setT(t) {
    const prev = st.t;
    st.t = t;
    while (st.next <= st.t) { st.flakes.push(newFlake(st.next)); st.next += EVERY; }
    for (const f of st.flakes) {
      const age = st.t - f.t0;
      for (const r of RULES) { const td = f.run.decide[r.key].n * DT; if (prev - f.t0 < td && age >= td) chime(r.key); }
      if (!f.counted && age >= f.T + INTO) {
        f.counted = true;
        if (st.prefill) continue; // the flakes already through when the scene starts are not counted
        st.sorted++;
        runs.add(f.run);
        RULES.forEach((r, i) => { const d = f.run.decide[r.key]; st.bins[i].all++; if (d.correct) st.bins[i].right++; if (d.forced) st.bins[i].forced++; });
      }
    }
    st.flakes = st.flakes.filter((f) => st.t - f.t0 < f.T + INTO + 0.05);
    status();
  }
  function chime(key) {
    const a = audio();
    if (!a) return;
    const now = a.ctx.currentTime, o = a.ctx.createOscillator(), g = a.ctx.createGain();
    o.type = "sine"; o.frequency.value = { ex: 1320, pm: 1047, wb: 1568 }[key];
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.03, now + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    o.connect(g); g.connect(a.out); o.start(now); o.stop(now + 0.15);
  }
  const msOf = (t) => Math.round(t * SORTER.ms);
  function status() {
    const on = st.flakes.filter((f) => st.t - f.t0 < f.T).length;
    ui.status.textContent = `${msOf(st.t).toLocaleString("en-US")} ms: ${on} ${on === 1 ? "flake" : "flakes"} on each chute, ${st.sorted.toLocaleString("en-US")} sorted so far.`;
  }

  // ------------------------------------------------------------ controls
  const setPlaying = (on) => { st.playing = on; ui.play.setAttribute("aria-pressed", String(on)); ui.play.textContent = on ? "Pause" : "Play"; wake(); };
  ui.play.addEventListener("click", () => setPlaying(!st.playing));
  ui.step.addEventListener("click", () => { setPlaying(false); setT(st.t + DT); draw(); });
  ui.many.addEventListener("click", () => {
    // a thousand more flakes into the tally, each at a random speed, as if they had all passed
    runs.batch(1000, () => { const k = Math.floor(rng.next() * K); return runLanes(models[k], rng); }, () => { draw(); });
  });
  root.addEventListener("keydown", (e) => { if (e.key === " " && e.target === root) { e.preventDefault(); ui.play.click(); } });

  // ------------------------------------------------------------ colors
  const readColors = () => {
    const cs = getComputedStyle(root.closest(".print") || root);
    for (const k of ["print", "print-2", "print-line", "print-ink", "print-dim", "accent-print", "pm", "wb", "ex", "right", "left"]) st.colors[k] = cs.getPropertyValue(`--${k}`).trim();
  };
  readColors();
  document.addEventListener("appearance:change", () => { readColors(); drawWalls(); draw(); });

  // ------------------------------------------------------------ the chutes
  const font = () => getComputedStyle(root).fontFamily;
  function draw() {
    const dpr = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext("2d"), c = st.colors, small = w < 520;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const left = small ? 8 : 92, binW = small ? 54 : 64, x0 = left + 4, xJ = w - binW - 14;
    const laneH = (h - 24) / 3, R = Math.max(Math.min(laneH * 0.16, 9), 5);
    ctx.font = `700 ${small ? 9.5 : 10.5}px ${font()}`; ctx.textBaseline = "middle";
    RULES.forEach((r, i) => {
      const yT = 6 + i * laneH, yM = yT + laneH / 2, chuteH = laneH * 0.46;
      // the chute, the stretch the sensor reads, and the jets at its end
      ctx.fillStyle = c["print-2"]; ctx.fillRect(x0, yM - chuteH / 2, xJ - x0, chuteH);
      ctx.strokeStyle = c["print-line"]; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, yM - chuteH / 2 + 0.5, xJ - x0, chuteH);
      ctx.strokeStyle = c["accent-print"]; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(xJ, yM - chuteH / 2 - 3); ctx.lineTo(xJ, yM + chuteH / 2 + 3); ctx.stroke();
      // the bins: PET above, HDPE below, each with how many it holds and how many of those are right
      const bx = xJ + 10, b = st.bins[i];
      for (const [side, yb] of [[-1, yT + 2], [1, yM + 2]]) {
        ctx.fillStyle = side < 0 ? c.left : c.right; ctx.globalAlpha = 0.18; ctx.fillRect(bx, yb, binW, laneH / 2 - 6); ctx.globalAlpha = 1;
        ctx.strokeStyle = side < 0 ? c.left : c.right; ctx.lineWidth = 1.2; ctx.strokeRect(bx + 0.5, yb + 0.5, binW - 1, laneH / 2 - 7);
        ctx.fillStyle = c["print-ink"]; ctx.textAlign = "right"; ctx.font = `700 ${small ? 8.5 : 9.5}px ${font()}`;
        ctx.fillText(NAME[side], bx + binW - 5, yb + (laneH / 2 - 6) / 2);
      }
      // its name, and its share binned right so far
      ctx.textAlign = "left"; ctx.font = `700 ${small ? 9.5 : 10.5}px ${font()}`;
      ctx.fillStyle = c[r.key];
      if (small) ctx.fillText(r.short, x0 + 4, yT + 7);
      else { ctx.fillText(r.short, 0, yM - 7); ctx.fillStyle = c["print-dim"]; ctx.font = `600 9.5px ${font()}`; ctx.fillText(b.all ? `${Math.round((100 * b.right) / b.all)}% RIGHT` : "–", 0, yM + 8); }
      // the flakes
      for (const f of st.flakes) {
        const age = st.t - f.t0, d = f.run.decide[r.key], td = d.n * DT, decided = age >= td - 1e-9;
        let x, y = yM;
        if (age <= f.T) x = x0 + R + ((xJ - x0 - 2 * R) * age) / f.T;
        else {
          // through the jets, off toward its bin
          const u = Math.min((age - f.T) / INTO, 1);
          x = xJ + (bx + R + 4 - xJ) * u; y = yM + d.choice * (laneH / 4) * u;
        }
        // spread the flakes across the chute a little, the same on every chute
        y += (((f.t0 * 7.31) % 1) - 0.5) * chuteH * 0.6 * (age <= f.T ? 1 : 0);
        ctx.beginPath();
        if (f.run.z < 0) ctx.arc(x, y, R, 0, 2 * Math.PI); else ctx.rect(x - R * 0.88, y - R * 0.88, R * 1.76, R * 1.76);
        if (decided) { ctx.fillStyle = d.choice < 0 ? c.left : c.right; ctx.fill(); }
        ctx.strokeStyle = c["print-ink"]; ctx.lineWidth = decided ? 1 : 1.6; ctx.stroke();
        // a choice forced at the jets is ringed as it goes through
        if (d.forced && age > f.T - 0.02 && age < f.T + INTO) { ctx.strokeStyle = c["accent-print"]; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, R + 4, 0, 2 * Math.PI); ctx.stroke(); }
      }
    });
    ctx.fillStyle = c["accent-print"]; ctx.textAlign = "right"; ctx.font = `700 ${small ? 9 : 10}px ${font()}`; ctx.textBaseline = "alphabetic";
    ctx.fillText("JETS", xJ - 4, h - 4);
    ctx.fillStyle = c["print-dim"]; ctx.textAlign = "left";
    ctx.fillText(small ? "SENSOR" : "THE SENSOR READS EACH FLAKE ALL THE WAY TO THE JETS", x0, h - 4);
  }

  // ------------------------------------------------------------ the walls for each speed
  function drawWalls() {
    const svg = wallsSvg, c = st.colors, NS = "http://www.w3.org/2000/svg";
    const W = Math.round(svg.getBoundingClientRect().width) || 320, H = 190;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("height", H);
    svg.replaceChildren();
    const el = (name, attrs, text) => { const e = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; svg.append(e); return e; };
    const L = 36, Rt = W - 44, top = 22, bot = H - 26, Tmax = SORTER.deadlines[K - 1];
    const X = (t) => L + ((Rt - L) * t) / Tmax, pLo = 0.5, pHi = 0.95, Y = (p) => bot - ((bot - top) * (Math.min(p, pHi) - pLo)) / (pHi - pLo);
    el("text", { x: 0, y: 11, class: "t-key" }, "CONFIDENCE ASKED FOR, BY HOW LONG A FLAKE HAS");
    for (const p of [0.5, 0.75, 0.9]) {
      el("line", { x1: L, x2: Rt, y1: Y(p), y2: Y(p), stroke: c["print-line"], "stroke-width": 1, opacity: p === 0.5 ? 1 : 0.6 });
      el("text", { x: L - 5, y: Y(p) + 3.5, "text-anchor": "end", class: "lbl" }, `${Math.round(100 * p)}%`);
    }
    for (let m = 0; m <= Tmax * SORTER.ms + 1e-9; m += 10) { const x = X(m / SORTER.ms); el("line", { x1: x, x2: x, y1: bot, y2: bot + 4, stroke: c["print-line"] }); if (m % 20 === 0) el("text", { x, y: bot + 16, "text-anchor": "middle", class: "lbl" }, m === 0 ? "0 ms" : String(m)); }
    const path = (m, key) => {
      let d = "";
      for (let n = 0; n < m.rows; n++) { const x = X(n * DT), y = Y(confidenceAtRow(m, key, n)); d += `${n ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }
      return d + `L${X(m.rows * DT).toFixed(1)},${Y(0.5).toFixed(1)}`;
    };
    models.forEach((m, i) => {
      el("path", { d: path(m, "wb"), fill: "none", stroke: c.wb, "stroke-width": 5, opacity: 0.35, "stroke-linejoin": "round" });
      el("path", { d: path(m, "ex"), fill: "none", stroke: c.ex, "stroke-width": 1.6, "stroke-linejoin": "round" });
      el("text", { x: X(m.rows * DT) + 3, y: Y(0.5) - 4 - (i % 2) * 10, class: "lbl" }, `${Math.round(SORTER.deadlines[i] * SORTER.ms)} ms`);
    });
    // the 2025 rule's walls: the same for every flake, until its deadline forces the choice
    const longest = models[K - 1];
    el("path", { d: path(longest, "pm").replace(/L[^L]*$/, ""), fill: "none", stroke: c.pm, "stroke-width": 2, "stroke-dasharray": "6 5" });
    el("text", { x: Rt + 3, y: Y(confidenceAtRow(longest, "pm", 10)) + 3.5, class: "lbl", fill: c.pm }, "2025");
  }

  // ------------------------------------------------------------ the loop
  let loop = 0;
  function frame(now) {
    loop = 0;
    if (!st.visible || document.hidden) { st.last = 0; return; }
    const dt = st.last ? Math.min((now - st.last) / 1000, 0.05) : 1 / 60;
    st.last = now;
    if (st.playing) setT(st.t + dt * RATE);
    draw();
    if (st.playing) loop = requestAnimationFrame(frame);
  }
  const wake = () => { if (!loop && st.visible) loop = requestAnimationFrame(frame); };

  // start with the chutes already full, so the first frame shows flakes at every stage
  st.prefill = true; setT(1.6); st.prefill = false;
  if (reduced.matches) st.playing = false;
  setPlaying(st.playing);
  new IntersectionObserver((es) => { st.visible = es[0].isIntersecting; if (st.visible) { draw(); wake(); } }, { threshold: 0.05 }).observe(cv);
  document.addEventListener("visibilitychange", wake);
  new ResizeObserver(() => { draw(); drawWalls(); }).observe(root);
  drawWalls();
}
