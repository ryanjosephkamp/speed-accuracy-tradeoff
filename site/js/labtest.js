// The lab test, drawn: moving dots at 6.4% coherence whose net motion is the trial's evidence
// (stimulus.js DotField, as in the first print), a penalty meter that follows the penalty through
// the cue, and the urgency signal each rule implies (the inverse of its bound), in milliseconds. One
// trial at a time, played at a third of real speed; the observer follows the best bound or my 2025
// rule. Two copies on the page: the penalty climbing at the cue (group B) and lifting at it (group
// C), each set up by a LAB entry below. Numbers and trials come from lab-model.js; the curves are the
// paper's stored results.
import { LabTrial, labNumbers, liftNumbers, urgency, valueAt, perSecond, UNIT_MS } from "./lab-model.js";
import { DotField, dotsPerUnit } from "./stimulus.js";
import { Rng, freshSeed, dotSeed } from "./rng.js";
import { audio } from "./sound.js";

const SLOW = 3;            // a third of real speed on a 60 Hz screen (one step per frame)
const T_SHOW = 1.3;        // model time shown on the urgency plot (about 720 ms)
const PAUSE = 1100;        // ms between trials while playing
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const $ = (root, sel) => root.querySelector(sel);

/** The two copies: which stored schedule, the cue (the penalty's midpoint), the attribute its text's
 * numbers carry, the print that sends it a moment, and its urgency scale. */
export const LAB = {
  rise: { id: "labtest", index: 0, cue: 0.5, attr: "lab", numbers: labNumbers, pilot: "lab", salt: 0x3c6ef372, cueLabel: "PENALTY HALFWAY UP", scale: [0.8, 12], ticks: [1, 2, 5, 10] },
  lift: { id: "labtest-lift", index: 1, cue: 0.3, attr: "lift", numbers: liftNumbers, pilot: "lab-lift", salt: 0x0b5ad4ce, cueLabel: "PENALTY HALFWAY DOWN", scale: [0.24, 1.35], ticks: [0.25, 0.5, 1] },
};

export function initLabTest(show, cfg = LAB.rise) {
  const root = document.getElementById(cfg.id);
  if (!root || !show) return;
  const r = show[cfg.index];
  const dotsCv = $(root, ".lt-dots"), plot = $(root, ".lt-plot");
  const ui = { play: $(root, "[data-lt=play]"), step: $(root, "[data-lt=step]"), next: $(root, "[data-lt=next]"), obs: $(root, ".lt-observer"), status: $(root, ".lt-status") };
  const nums = cfg.numbers(r, cfg.cue);
  for (const el of root.querySelectorAll(`[data-${cfg.attr}]`)) {
    const v = nums[el.getAttribute(`data-${cfg.attr}`)];
    if (v != null) el.textContent = typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : String(v);
  }
  const seed = Number.parseInt(new URLSearchParams(location.search).get("seed"), 10) >>> 0 || freshSeed();
  const rng = new Rng(seed ^ cfg.salt);
  const field = new DotField({ rng: new Rng(dotSeed(seed ^ cfg.salt)) });
  const st = { key: "exact", trial: null, n: 0, correct: 0, time: 0, playing: !reduced.matches, visible: false, last: 0, wait: 0, mark: null, frameDt: 1 / 60 / SLOW, trace: [] };

  function newTrial() {
    st.trial = new LabTrial({ r, key: st.key, rng });
    // each screen frame covers a sixtieth of a second, slowed down: that much of the trial
    field.reset(dotsPerUnit(st.frameDt));
    st.trace = [];
    st.counted = false;
    status();
  }
  function stepFrame() {
    const tr = st.trial;
    if (tr.done) return;
    tr.advance(tr.t + (st.frameDt * 1000) / UNIT_MS);
    field.frame(tr.x);
    st.trace.push([tr.t, tr.X]);
    if (tr.done) finish();
  }
  function finish() {
    const tr = st.trial;
    if (st.counted) return;
    st.counted = true;
    st.n++; if (tr.correct) st.correct++; st.time += tr.t * UNIT_MS;
    const a = audio();
    if (a) {
      const now = a.ctx.currentTime, o = a.ctx.createOscillator(), g = a.ctx.createGain();
      o.type = tr.correct ? "sine" : "triangle"; o.frequency.value = tr.correct ? 880 : 240;
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.07, now + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      o.connect(g); g.connect(a.out); o.start(now); o.stop(now + 0.3);
    }
    status();
  }
  const ms = (t) => `${Math.round(t * UNIT_MS)} ms`;
  function status() {
    const tr = st.trial;
    const tally = st.n ? ` So far ${st.n} ${st.n === 1 ? "trial" : "trials"}, ${Math.round((100 * st.correct) / st.n)}% correct, ${Math.round(st.time / st.n)} ms on average.` : "";
    ui.status.textContent = tr.done
      ? `Trial ${st.n}: chose ${tr.choice > 0 ? "right" : "left"} at ${ms(tr.t)}, ${tr.correct ? "correct" : "wrong"}.${tally}`
      : `Trial ${st.n + 1}: ${ms(tr.t)}, deciding. The dots drift ${tr.z > 0 ? "right" : "left"}.${tally}`;
  }

  // ------------------------------------------------------------ controls
  const setPlaying = (on) => { st.playing = on; ui.play.setAttribute("aria-pressed", String(on)); ui.play.textContent = on ? "Pause" : "Play"; wake(); };
  ui.play.addEventListener("click", () => { if (st.trial.done && !st.playing) newTrial(); setPlaying(!st.playing); });
  ui.step.addEventListener("click", () => { setPlaying(false); if (st.trial.done) newTrial(); else stepFrame(); status(); draw(); });
  ui.next.addEventListener("click", () => { newTrial(); if (reduced.matches) { while (!st.trial.done) stepFrame(); } draw(); wake(); });
  ui.obs.addEventListener("change", (e) => { st.key = e.target.value; newTrial(); draw(); wake(); });
  root.addEventListener("keydown", (e) => { if (e.key === " " && e.target === root) { e.preventDefault(); ui.play.click(); } });
  document.addEventListener("scn:seek", (e) => { if (e.detail.pilot === cfg.pilot) { st.mark = Math.min(e.detail.t, T_SHOW); draw(); } });

  // ------------------------------------------------------------ colors
  let colors = {};
  const readColors = () => {
    const cs = getComputedStyle(root.closest(".print") || root);
    for (const k of ["print", "print-2", "print-line", "print-ink", "print-dim", "accent-print", "pm", "wb", "ex", "right", "left", "hot"]) colors[k] = cs.getPropertyValue(`--${k}`).trim();
  };
  readColors();
  document.addEventListener("appearance:change", () => { readColors(); draw(); });

  // ------------------------------------------------------------ drawing
  function fit(cv) {
    const dpr = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }
  const font = () => getComputedStyle(root).fontFamily;
  function drawDots() {
    const { ctx, w, h } = fit(dotsCv), c = colors, tr = st.trial;
    ctx.clearRect(0, 0, w, h);
    const meterW = 10, R = Math.min(w - meterW - 28, h - 34) / 2, cx = (w - meterW - 16) / 2, cy = h / 2 + 4;
    ctx.strokeStyle = c["print-line"]; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R + 6, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillStyle = c["print-ink"];
    const d = Math.max(1.8, R / 70);
    for (const dot of field.dots) ctx.fillRect(cx + dot.x * R - d / 2, cy + dot.y * R - d / 2, d, d);
    // the fixation point: ringed once the penalty has gone past halfway (in log) to its new level
    const cNow = valueAt(r, "cost", tr.t), from = Math.log(r.cost[0]), to = Math.log(r.cost[r.cost.length - 1]);
    const moved = Math.min(Math.max((Math.log(cNow) - from) / (to - from), 0), 1);
    // and how high the penalty is between its lower level and its higher one
    const share = to > from ? moved : 1 - moved;
    ctx.fillStyle = c["print-ink"]; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 2 * Math.PI); ctx.fill();
    if (moved > 0.5) { ctx.strokeStyle = c["accent-print"]; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, 2 * Math.PI); ctx.stroke(); }
    // the penalty meter, on a log scale from the lower penalty to the higher one
    const mx = w - meterW - 4, my0 = 22, my1 = h - 12;
    ctx.strokeStyle = c["print-line"]; ctx.strokeRect(mx + 0.5, my0 + 0.5, meterW, my1 - my0);
    ctx.fillStyle = c["accent-print"]; ctx.globalAlpha = 0.85;
    const fh = (my1 - my0) * (0.08 + 0.92 * share);
    ctx.fillRect(mx + 1, my1 - fh, meterW - 1, fh);
    ctx.globalAlpha = 1;
    // the meter and the number it stands for, named together
    ctx.font = `600 10px ${font()}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = c["print-ink"];
    ctx.fillText(`PENALTY ${perSecond(cNow).toFixed(2)} POINTS A SECOND`, 2, 12);
    ctx.fillStyle = c["print-dim"];
    ctx.fillText(`${Math.round(tr.t * UNIT_MS)} MS`, 2, h - 2);
  }
  function drawPlot() {
    const { ctx, w, h } = fit(plot), c = colors, tr = st.trial;
    ctx.clearRect(0, 0, w, h);
    const left = 34, right = w - 8, top = 20, bottom = h - 40, band = h - 26;
    const X = (t) => left + ((right - left) * t) / T_SHOW;
    const yLo = Math.log(cfg.scale[0]), yHi = Math.log(cfg.scale[1]);
    const Y = (u) => bottom - ((bottom - top) * (Math.log(u) - yLo)) / (yHi - yLo);
    ctx.font = `600 10px ${font()}`; ctx.textBaseline = "middle";
    // the urgency scale, relative to the 2025 rule's when the dots appear
    for (const u of cfg.ticks) {
      ctx.strokeStyle = c["print-line"]; ctx.globalAlpha = u === 1 ? 1 : 0.6;
      ctx.beginPath(); ctx.moveTo(left, Y(u)); ctx.lineTo(right, Y(u)); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = c["print-dim"]; ctx.textAlign = "right"; ctx.fillText(`${u}×`, left - 6, Y(u));
    }
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText("URGENCY", 0, 10);
    // the time scale in milliseconds, and the penalty as a band on a log scale
    ctx.textAlign = "center";
    for (let m = 0; m <= T_SHOW * UNIT_MS + 1; m += 100) {
      const x = X(m / UNIT_MS), major = m % 200 === 0;
      ctx.strokeStyle = c["print-line"]; ctx.beginPath(); ctx.moveTo(x, band + 10); ctx.lineTo(x, band + (major ? 15 : 13)); ctx.stroke();
      if (major) { ctx.fillStyle = c["print-dim"]; ctx.fillText(m === 0 ? "0 ms" : String(m), x, h - 2); }
    }
    const lo = Math.log(Math.min(r.cost[0], r.cost[r.cost.length - 1])), hi = Math.log(Math.max(r.cost[0], r.cost[r.cost.length - 1]));
    ctx.fillStyle = c["accent-print"]; ctx.globalAlpha = 0.45;
    ctx.beginPath(); ctx.moveTo(X(0), band + 10);
    for (let t = 0; t <= T_SHOW + 1e-9; t += 0.01) ctx.lineTo(X(t), band + 10 - 10 * (0.15 + (0.85 * (Math.log(valueAt(r, "cost", t)) - lo)) / (hi - lo)));
    ctx.lineTo(X(T_SHOW), band + 10); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    // the cue: the penalty's midpoint
    const xc = X(cfg.cue);
    ctx.strokeStyle = c["accent-print"]; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(xc, top); ctx.lineTo(xc, band + 10); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = c["accent-print"]; ctx.textAlign = xc > right - 90 ? "right" : "left";
    ctx.fillText(cfg.cueLabel, xc + (xc > right - 90 ? -5 : 5), top + 8);
    // the three urgency curves: the look-ahead rule as a sleeve under the best, then the 2025 rule
    const curve = (key, color, width, dash, alpha) => {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.globalAlpha = alpha; ctx.lineJoin = "round";
      ctx.beginPath();
      for (let t = 0; t <= T_SHOW + 1e-9; t += 0.005) { const y = Y(Math.min(urgency(r, key, t), 12)); if (t === 0) ctx.moveTo(X(t), y); else ctx.lineTo(X(t), y); }
      ctx.stroke(); ctx.restore();
    };
    curve("wb", c.wb, 6, [], 0.4);
    curve("pm", c.pm, 2, [6, 5], 1);
    curve("exact", c.ex, 1.8, [], 1);
    // name the lines where they start: the best and the look-ahead band above, the 2025 rule on its own
    {
      ctx.font = `700 10px ${font()}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      const t0 = 0.03, x0 = X(t0), gap = 10;
      const label = (txt, color, x, y) => {
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = c.print; ctx.globalAlpha = 0.8; ctx.fillRect(x - 2, y - 9, tw + 4, 12); ctx.globalAlpha = 1;
        ctx.fillStyle = color; ctx.fillText(txt, x, y);
        return tw;
      };
      const wBest = ctx.measureText("BEST").width, wLook = ctx.measureText("LOOK-AHEAD").width;
      // side by side where the plot is wide; stacked where it is narrow, so they stay by the line
      const stack = (wBest + gap + wLook) / (right - left) > 0.16;
      const t1 = t0 + ((stack ? Math.max(wBest, wLook) : wBest + gap + wLook) * T_SHOW) / (right - left);
      // above the best and the look-ahead lines where they start over the 2025 rule's, below them
      // where they start under it (the lifting penalty), and the 2025 rule's on its other side
      const under = urgency(r, "exact", t0) < urgency(r, "pm", t0);
      let uMax = 0, uMin = Infinity;
      for (let tt = t0; tt <= t1 + 1e-9; tt += 0.005) for (const k of ["exact", "wb"]) { const u = urgency(r, k, tt); uMax = Math.max(uMax, u); uMin = Math.min(uMin, u); }
      const yb = under ? Y(uMin) + 16 : Y(uMax) - 8, step = under ? 13 : -13;
      label("BEST", c.ex, x0, yb);
      if (stack) label("LOOK-AHEAD", c.wb, x0, yb + step);
      else label("LOOK-AHEAD", c.wb, x0 + wBest + gap, yb);
      label("2025 RULE", c.pm, x0, Y(urgency(r, "pm", t0)) - 7);
      ctx.font = `600 10px ${font()}`;
    }
    // where this trial is, and where it decided
    const t = Math.min(tr.t, T_SHOW), xt = X(t), u = urgency(r, st.key, t);
    ctx.strokeStyle = c["print-dim"]; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.moveTo(xt, top); ctx.lineTo(xt, bottom); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = st.key === "pm" ? c.pm : c.ex;
    ctx.beginPath(); ctx.arc(xt, Y(u), tr.done ? 4.5 : 3.2, 0, 2 * Math.PI); ctx.fill();
    if (tr.done) {
      ctx.textAlign = xt > right - 110 ? "right" : "left"; ctx.fillStyle = c["print-ink"];
      // above the dot, or below it near the top, clear of the cue's label
      ctx.fillText(`DECIDED, ${Math.round(tr.t * UNIT_MS)} MS`, xt + (xt > right - 110 ? -8 : 8), Y(u) < top + 34 ? Y(u) + 16 : Y(u) - 8);
    }
    // a time marked from the print above
    if (st.mark != null) {
      const xm = X(st.mark);
      ctx.strokeStyle = c["print-ink"]; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(xm, top); ctx.lineTo(xm, bottom); ctx.stroke(); ctx.setLineDash([]);
      const txt = `${Math.round(st.mark * UNIT_MS)} MS: BEST ${urgency(r, "exact", st.mark).toFixed(1)}×, 2025 RULE ${urgency(r, "pm", st.mark).toFixed(1)}×`;
      ctx.font = `600 10px ${font()}`; ctx.textAlign = xm > (left + right) / 2 ? "right" : "left";
      const tw = ctx.measureText(txt).width, x0 = xm > (left + right) / 2 ? xm - 6 - tw : xm + 6;
      ctx.fillStyle = c.print; ctx.globalAlpha = 0.85; ctx.fillRect(x0 - 3, bottom - 22, tw + 6, 15); ctx.globalAlpha = 1;
      ctx.fillStyle = c["print-ink"]; ctx.fillText(txt, xm + (xm > (left + right) / 2 ? -6 : 6), bottom - 11);
    }
  }
  function draw() { if (st.trial) { drawDots(); drawPlot(); } }

  let loop = 0;
  function frame(now) {
    loop = 0;
    if (!st.visible || document.hidden) { st.last = 0; return; }
    st.last = now;
    if (st.playing) {
      if (st.trial.done) {
        if (!st.wait) st.wait = now + PAUSE;
        else if (now >= st.wait) { st.wait = 0; newTrial(); }
      } else { stepFrame(); status(); }
    }
    draw();
    if (st.playing) loop = requestAnimationFrame(frame);
  }
  const wake = () => { if (!loop && st.visible) loop = requestAnimationFrame(frame); };

  newTrial();
  if (reduced.matches) { st.playing = false; while (!st.trial.done) stepFrame(); }
  setPlaying(st.playing);
  new IntersectionObserver((es) => { st.visible = es[0].isIntersecting; if (st.visible) { draw(); wake(); } }, { threshold: 0.05 }).observe(root);
  document.addEventListener("visibilitychange", wake);
  new ResizeObserver(() => draw()).observe(root);
}
