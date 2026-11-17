// What the 3D scenes of three deciders (lanes.js) share: the car, the goalkeeper, and the walking
// robot. One run at a time on a story clock; each new reading flashes on its side in every lane
// still deciding, and a soft chime sounds as each decider commits. The controls: play and pause,
// one reading, the next run, and a thousand runs into the tally beside the scene (runs.js); the
// space bar while the scene has focus; a tap on the scene's print moves the run to that moment.
// Colors come from the page's tokens and are read again when the theme or its dial changes. The
// drawing loop stops off screen and in a hidden tab. Over each lane, a gauge shows how far the
// readings lean and where that rule's walls are now. The 3D scene loads only as it nears the
// screen; without WebGL the same run is drawn from above on a plain canvas.
//
// Each scene supplies its story (see laneScene's options): where its deciders are at any moment,
// what its gauges and status say, its 3D scene, its flat drawing, and what else its HUD shows.
import { RULES, runLanes, confidenceAt } from "./lanes.js";
import { DT, effectiveWall } from "./lattice.js";
import { Rng, freshSeed } from "./rng.js";
import { audio } from "./sound.js";
import { createRuns } from "./runs.js";

export const reduced = matchMedia("(prefers-reduced-motion: reduce)");
/** World x per unit to the right on screen (the cameras look down +z). */
export const R = -1;
export const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
export const clamp01 = (u) => Math.min(Math.max(u, 0), 1);
const HOLD = 1300; // ms between runs while playing

/** Colors mixed as the page mixes them, in sRGB, so a tint on the night print stays as faint as it
 * is on paper (Three.js would mix in linear light, which lifts dark mixes). */
export function colorKit(T) {
  const col = (s) => new T.Color(s || "#888888");
  const hex = (s) => `#${col(s).getHexString()}`;
  const mixed = (a, b, t) => {
    const x = hex(a), y = hex(b), ch = (h, i) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
    return col(`rgb(${[0, 1, 2].map((i) => Math.round(ch(x, i) + (ch(y, i) - ch(x, i)) * t)).join(",")})`);
  };
  return { col, mixed };
}

/**
 * root: the scene (.pilot-lanes), holding the stage (.lanes-stage with a canvas for WebGL and one
 * for the HUD over it), the buttons [data-<key>=play|step|next|many], the status line, and the runs.
 * o, the scene's story:
 *   key        the pilot named by its print's taps, and the buttons' data attribute unless `data` is given
 *   model      the three wall sets and exact scores (lanes.js laneModel)
 *   salt       mixed into the page's seed, so each scene has its own stream of runs
 *   words      the runs' words (runs.js), e.g. { one: "car", many: "cars", ... }
 *   end        story time at which one run is over, or endOf(run) to set it for each run
 *   reading(t) true while readings still matter (the clock runs slow and steps a reading at a time)
 *   rate       story seconds per real second: { reading, after }; ease (seconds) smooths the change
 *   kmax       the gauges' half width, in readings
 *   at(key, t) where that rule's decider is at story time t: at least { decided, d } (d its decision)
 *   status(run, t, n)            the status line
 *   gaugeAt(i, s)                the world point a lane's gauge sits over, [x, y, z]
 *   gaugeLine(s, pct, small)     the gauge's second line: the confidence its walls ask for now (pct),
 *                                or what the decider did
 *   flat: { project(w, h), draw(ctx, w, h, P) }   the drawing from above without WebGL
 *   build3(T, api) -> { paint(), render(w, h), project(x, y, z), moving?(), onRun?(run) }
 *   under(ctx, g), over(ctx, g)  more HUD under and over the gauges; g = { w, h, project, font, small, row }
 *   onRun(run)                   a new run has started
 *   onSeek()                     a tap on the print is about to move the run
 */
export function laneScene(root, o) {
  const $ = (sel) => root.querySelector(sel);
  const stage = $(".lanes-stage"), glCv = $("canvas:not([role])"), hud = $("canvas[role]");
  const btn = (name) => $(`[data-${o.data || o.key}=${name}]`);
  const ui = { play: btn("play"), step: btn("step"), next: btn("next"), many: btn("many"), status: $(".pilot-status") };
  const seed = Number.parseInt(new URLSearchParams(location.search).get("seed"), 10) >>> 0 || freshSeed();
  const rng = new Rng(seed ^ o.salt);
  const st = { model: o.model, run: null, end: o.end, t: 0, n: 0, playing: !reduced.matches, visible: false, holdUntil: 0, counted: false, pulses: [[0, 0], [0, 0], [0, 0]], lastRow: 0, last: 0, rate: o.rate.reading, three: null, flat: false, colors: null };
  const runs = createRuns(root, st.model, o.words);
  const rowOf = (t) => Math.min(Math.floor(t / DT + 1e-9), st.model.rows);

  // ------------------------------------------------------------ one run at a time
  function newRun() {
    st.run = runLanes(st.model, rng);
    st.end = o.endOf ? o.endOf(st.run) : o.end;
    st.n++;
    st.t = 0; st.lastRow = 0; st.counted = false; st.rate = o.rate.reading;
    st.pulses.forEach((p) => p.fill(0));
    o.onRun?.(st.run);
    st.three?.onRun?.(st.run);
    status();
  }
  function count() {
    if (st.counted) return;
    st.counted = true;
    runs.add(st.run);
  }
  const status = () => { ui.status.textContent = o.status(st.run, st.t, st.n); };

  // ------------------------------------------------------------ time
  function advance(dt) {
    const want = o.reading(st.t) ? o.rate.reading : o.rate.after;
    st.rate = o.rate.ease ? st.rate + (want - st.rate) * (1 - Math.exp(-dt / o.rate.ease)) : want;
    setT(st.t + dt * st.rate);
  }
  function setT(t) {
    const prev = st.t, rows = st.model.rows;
    st.t = Math.min(Math.max(t, 0), st.end);
    const row = rowOf(st.t);
    // each new reading flashes on its side, in every lane whose decider is still deciding
    for (let n = st.lastRow; n < row && n < rows; n++) {
      const side = st.run.reads[n] > 0 ? 1 : 0;
      RULES.forEach((r, i) => { if (st.run.decide[r.key].n > n) st.pulses[i][side] = 1; });
    }
    if (row < st.lastRow) st.pulses.forEach((p) => p.fill(0));
    // a soft chime as each decider commits
    for (const r of RULES) { const td = st.run.decide[r.key].n * DT; if (prev < td && st.t >= td) chime(r.key); }
    st.lastRow = row;
    if (st.t >= st.end - 1e-9) count();
    status();
  }
  function chime(key) {
    const a = audio();
    if (!a) return;
    const now = a.ctx.currentTime, osc = a.ctx.createOscillator(), g = a.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = { ex: 660, pm: 523, wb: 784 }[key];
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.07, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc.connect(g); g.connect(a.out); osc.start(now); osc.stop(now + 0.4);
  }

  // ------------------------------------------------------------ controls
  const atEnd = () => st.t >= st.end - 1e-9;
  const setPlaying = (on) => {
    st.playing = on;
    ui.play.setAttribute("aria-pressed", String(on));
    ui.play.textContent = on ? "Pause" : "Play";
    wake();
  };
  ui.play.addEventListener("click", () => { if (atEnd() && !st.playing) newRun(); setPlaying(!st.playing); });
  ui.step.addEventListener("click", () => {
    setPlaying(false);
    if (atEnd()) newRun();
    else setT(o.reading(st.t) ? (Math.floor(st.t / DT + 1e-9) + 1) * DT : st.t + 0.1);
    draw();
  });
  ui.next.addEventListener("click", () => { count(); newRun(); if (reduced.matches) setT(st.end); draw(); wake(); });
  ui.many.addEventListener("click", () => {
    count();
    // a thousand more runs into the tally, then a fresh one in the scene
    const m = st.model;
    runs.batch(1000, () => runLanes(m, rng), () => { st.n += 1000; newRun(); draw(); });
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === " " && e.target === root) { e.preventDefault(); ui.play.click(); }
  });
  // a tap on the scene's print moves this run to that moment
  document.addEventListener("scn:seek", (e) => {
    if (e.detail.pilot !== o.key || !st.run) return;
    o.onSeek?.();
    setPlaying(false);
    st.lastRow = 0; st.pulses.forEach((p) => p.fill(0));
    setT(Math.min(e.detail.t, st.end));
    draw();
  });

  // ------------------------------------------------------------ colors from the page
  const readColors = () => {
    const cs = getComputedStyle(root.closest(".print") || root);
    const c = {};
    for (const k of ["print", "print-2", "print-line", "print-ink", "print-dim", "accent-print", "pm", "wb", "ex", "right", "left", "hot", "theme"]) c[k] = cs.getPropertyValue(`--${k}`).trim();
    c.dark = c.theme === "dark";
    st.colors = c;
  };
  readColors();
  document.addEventListener("appearance:change", () => { readColors(); st.three?.paint(); draw(); });

  // ------------------------------------------------------------ drawing
  let loop = 0;
  function frame(now) {
    loop = 0;
    if (!st.visible || document.hidden) { st.last = 0; return; }
    const dt = st.last ? Math.min((now - st.last) / 1000, 0.05) : 1 / 60;
    st.last = now;
    if (st.playing) {
      if (atEnd()) {
        if (!st.holdUntil) st.holdUntil = now + HOLD;
        else if (now >= st.holdUntil) { st.holdUntil = 0; newRun(); }
      } else advance(dt);
    }
    for (const p of st.pulses) { p[0] *= Math.exp(-dt / 0.11); p[1] *= Math.exp(-dt / 0.11); }
    draw();
    if (st.playing || st.pulses.some((p) => p[0] > 0.01 || p[1] > 0.01) || st.three?.moving?.()) loop = requestAnimationFrame(frame);
  }
  const wake = () => { if (!loop && st.visible) loop = requestAnimationFrame(frame); };
  function draw() {
    if (!st.run) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    st.three?.render(w, h);
    drawHud(w, h);
  }

  /** The gauges over the lanes, and the scene's own marks under and over them. */
  function drawHud(w, h) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (hud.width !== Math.round(w * dpr) || hud.height !== Math.round(h * dpr)) { hud.width = Math.round(w * dpr); hud.height = Math.round(h * dpr); }
    const ctx = hud.getContext("2d"), c = st.colors;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // until the scene has loaded, the stage stays a plain print; without WebGL it is drawn from above
    if (!st.three && !st.flat) return;
    const font = getComputedStyle(root).fontFamily, small = w < 560;
    const project = st.three ? st.three.project : o.flat.project(w, h);
    if (!st.three) o.flat.draw(ctx, w, h, project);
    const row = rowOf(st.t), g = { w, h, project, font, small, row };
    o.under?.(ctx, g);
    // the gauges sit in a band along the top, each over its own lane
    ctx.fillStyle = c.print; ctx.globalAlpha = 0.78; ctx.fillRect(0, 0, w, 64); ctx.globalAlpha = 1;
    ctx.strokeStyle = c["print-line"]; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 64.5); ctx.lineTo(w, 64.5); ctx.stroke();
    const rows = st.model.rows, kmax = o.kmax;
    RULES.forEach((r, i) => {
      const s = o.at(r.key, st.t), K = st.model.walls[r.key], color = c[r.key];
      const p = project(...o.gaugeAt(i, s));
      const gw = Math.max(Math.min(small ? w / 3.6 : 132, (w - 24) / 3 - 10), 70), half = gw / 2;
      const gx = Math.min(Math.max(p.x, half + 6), w - half - 6), gy = 36;
      const X = (k) => gx + (Math.max(Math.min(k, kmax), -kmax) / kmax) * half;
      const n = s.decided ? s.d.n : row;
      const wall = n >= rows ? 0 : effectiveWall(K, Math.min(n, rows - 1));
      const k = st.run.path[Math.min(n, rows)];
      // the track, the middle, and the walls now
      ctx.save();
      ctx.strokeStyle = c["print-line"]; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx - half, gy); ctx.lineTo(gx + half, gy); ctx.stroke();
      ctx.strokeStyle = c["print-dim"]; ctx.beginPath(); ctx.moveTo(gx, gy - 4); ctx.lineTo(gx, gy + 4); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 2.2;
      for (const sgn of [-1, 1]) { const x = X(sgn * wall); ctx.beginPath(); ctx.moveTo(x, gy - 7); ctx.lineTo(x, gy + 7); ctx.stroke(); }
      // how far the readings lean
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(X(k), gy, 3.6, 0, 2 * Math.PI); ctx.fill();
      // its name, and what it asks for or what it did
      ctx.font = `700 ${small ? 9.5 : 10.5}px ${font}`; ctx.textBaseline = "alphabetic"; ctx.textAlign = "center";
      ctx.fillText(r.short, gx, gy - 13);
      ctx.font = `600 ${small ? 9 : 10}px ${font}`; ctx.fillStyle = c["print-ink"];
      ctx.fillText(o.gaugeLine(s, Math.round(100 * confidenceAt(wall, st.model.mu)), small), gx, gy + 19);
      ctx.restore();
    });
    o.over?.(ctx, g);
  }

  // ------------------------------------------------------------ the 3D scene, once it is near
  async function build() {
    let T;
    try {
      const probe = document.createElement("canvas");
      if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) throw new Error("no WebGL");
      T = await import("./vendor/three.min.js");
    } catch {
      stage.classList.add("is-flat");
      glCv.hidden = true;
      st.flat = true;
      draw();
      return;
    }
    st.three = o.build3(T, { glCv, stage, st });
    st.three.onRun?.(st.run);
    stage.classList.add("is-ready");
    draw();
    wake();
  }

  /** A new model (the robot's cost switch): a fresh tally, and a fresh run on it. */
  function setModel(model) {
    st.model = model;
    runs.setModel(model);
    st.holdUntil = 0;
    newRun();
    if (reduced.matches) setT(st.end);
    draw(); wake();
  }

  function start() {
    newRun();
    setPlaying(st.playing);
    if (reduced.matches) setT(st.end);
    let started = false;
    new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting && !started) { started = true; build(); }
    }, { rootMargin: "700px 0px" }).observe(root);
    new IntersectionObserver((es) => { st.visible = es[0].isIntersecting; if (st.visible) wake(); }, { threshold: 0.05 }).observe(stage);
    document.addEventListener("visibilitychange", wake);
    new ResizeObserver(() => draw()).observe(stage);
  }

  return { st, start, draw, wake, setModel, setPlaying };
}
