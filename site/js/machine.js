// The decision machine: a Galton board where each ball is one decision. Every row of pegs is one
// moment and every bounce one glimpse of evidence (lattice.js); a ball stops at a wall and
// chooses that side. The walls are the best possible for this board's cost of time, solved
// exactly, or the 2025 per-moment rule, or the reader's own. Decisions pile up along the walls
// by when they were made, so the piles are the decision-time distributions. Trails fade slowly,
// like a long exposure. Time runs down the board, in units of sigma^2/mu^2.
import { DELTA, DT, pUp, posterior, rowCosts, exactWalls, perMomentWalls, scoreWalls, effectiveWall, flow, lookAhead, lookAheadRule } from "./lattice.js";
import { Rng, freshSeed } from "./rng.js";
import { createGlow } from "./glow.js";
import { audio as sharedAudio } from "./sound.js";
import { colorWord, current as appearance } from "./appearance.js";
import { glowTint } from "./tones.js";
import { sayReadings, sayWall, sayOutcome, spentBy, sureOf, pctText, clearShare, earlyLead as earlyLeadOf } from "./walkcopy.js";

const ROWS = 1500;           // rows solved: 15 time units; past that the choice is forced
const MAX_SHOW = 400;        // at most 4 time units on the board
const ROWS_PER_SEC = 110;    // playback: one time unit in about 0.9 s
const SPAWN_PER_SEC = 55;
const BIN = 4;               // rows per pile bin
const TRAIL = 0.11, TRAIL_W = 2.4, TRAIL_FADE = 1.0; // light per step, line width, fade per second
const FLOW_GAIN = 16;        // light per unit share of balls, for the exact flow
// The board zooms to where decisions happen: it shows rows until 99.5% of balls have decided,
// and is wide enough for the walls with room for the piles.
let SHOW = 120, K_SPAN = 18;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const $ = (id) => document.getElementById(id);
const logistic = (x) => 1 / (1 + Math.exp(-x));

export const SCHEDULES = {
  rises: { label: "Cost rises", cost: (s) => (t) => s.c0 + (s.c0 * s.factor - s.c0) * logistic((t - s.at) / 0.015), handle: "at" },
  deadline: { label: "Deadline", cost: (s) => (t) => (t <= s.at + 1e-12 ? s.c0 : Infinity), handle: "at" },
  constant: { label: "Constant", cost: (s) => () => s.c0, handle: null },
};

export function initMachine() {
  const cv = $("machine");
  if (!cv) return;
  const root = cv.closest(".print");
  // light, if WebGL 2 is there; otherwise the trails are drawn on the canvas itself
  const glowCv = $("machine-glow");
  const glow = createGlow(glowCv);
  if (!glow) glowCv.hidden = true;
  let viewMix = 0, lastDraw = 0;
  const params = new URLSearchParams(location.search);
  const seed = Number.parseInt(params.get("seed"), 10) >>> 0 || freshSeed();
  const rng = new Rng(seed ^ 0x2c1b3c6d);
  $("machine-seed").textContent = String(seed);
  for (const el of document.querySelectorAll("[data-lattice]")) {
    el.textContent = { delta: DELTA.toFixed(1), dt: DT.toFixed(2), p: pUp(1).toFixed(2) }[el.dataset.lattice];
  }

  const st = {
    sched: "rises", s: { c0: 0.1, factor: 16, at: 0.6 }, mode: "exact", yourK: 13, yourWalls: null, view: "balls", mu: 1,
    walls: null, pm: null, ex: null, costs: null, score: {}, balls: [], spawnAcc: 0,
    piles: { right: new Float64Array(Math.ceil(MAX_SHOW / BIN) + 1), left: new Float64Array(Math.ceil(MAX_SHOW / BIN) + 1) },
    n: 0, correct: 0, time: 0, later: 0, visible: false, last: 0,
  };

  // ------------------------------------------------------------ policies and their exact scores
  function solve() {
    const sch = SCHEDULES[st.sched];
    const rows = st.sched === "deadline" ? Math.round(st.s.at / DT) : ROWS;
    st.rows = rows;
    st.costs = rowCosts(sch.cost(st.s), rows);
    st.ex = exactWalls(st.costs, st.mu);
    st.pm = perMomentWalls(st.costs, st.mu);
    if (st.mode === "yours" && !st.yourWalls && st.yourFromRule) st.yourWalls = Int32Array.from(st.pm);
    st.yours = yourWalls(rows);
    st.walls = st.mode === "exact" ? st.ex : st.mode === "pm" ? st.pm : st.yours;
    const sc = (K) => scoreWalls(K, st.costs, st.mu);
    st.score = { exact: sc(st.ex), pm: sc(st.pm), yours: st.mode === "yours" ? sc(st.yours) : null };
    // zoom: rows until 99.5% of the current policy's balls have decided, and the widest wall
    const cur = st.mode === "exact" ? st.score.exact : st.mode === "pm" ? st.score.pm : st.score.yours;
    // the zoom follows the walls in use; while you draw your own, it stays on the best walls' board
    const zoomBy = st.mode === "yours" && st.yourWalls ? st.score.exact : cur;
    let acc = 0, n99 = rows;
    for (let n = 0; n <= rows; n++) { acc += zoomBy.right[n] + zoomBy.left[n]; if (acc >= 0.995) { n99 = n; break; } }
    SHOW = Math.min(Math.max(Math.ceil((n99 * 1.1) / 10) * 10, 50), Math.min(MAX_SHOW, rows));
    let kMax = 1;
    for (const K of [st.ex, st.pm, st.walls]) for (let n = 0; n < SHOW; n++) kMax = Math.max(kMax, Math.min(effectiveWall(K, n), 40));
    K_SPAN = Math.min(Math.max(Math.ceil(kMax * 1.55), 6), 40);
    st.cur = cur;
    layout();
    readout();
    resetRun();
    paintBoard();
    paintFlow();
    if (reduced.matches && exposure) still();
    else if (paused) wake();
  }

  /** The reader's walls: drawn by hand, or straight at yourK. */
  function yourWalls(rows) {
    const K = new Int32Array(rows + 1);
    for (let n = 0; n < rows; n++) K[n] = st.yourWalls && n < st.yourWalls.length ? st.yourWalls[n] : st.yourK;
    K[rows] = 0;
    return K;
  }
  /** Rescore the reader's walls without moving the board, while they draw. */
  function rescoreYours() {
    st.yours = yourWalls(st.rows);
    if (st.mode === "yours") st.walls = st.yours;
    st.score.yours = scoreWalls(st.yours, st.costs, st.mu);
    st.cur = st.score.yours;
    readout();
  }

  /** Every path at once: the exact share of balls passing each peg, drawn as light. */
  let flowLayer = null;
  function paintFlow() {
    if (!geo || !board) return;
    if (!flowLayer || flowLayer.cv.width !== board.cv.width || flowLayer.cv.height !== board.cv.height) flowLayer = layer(geo.w, geo.h);
    const { ctx } = flowLayer, { X, Y } = geo;
    ctx.clearRect(0, 0, geo.w, geo.h);
    const span = K_SPAN, width = 2 * span + 1, f = flow(st.walls, st.rows, SHOW, span, st.mu), P = pUp(st.mu);
    if (glow) {
      // the share of balls along each step, as light: linear, so the river is bright where most
      // balls go and dim toward the walls
      const segs = [];
      for (let n = 0; n < SHOW; n++) {
        for (let j = 0; j < width; j++) {
          const m = f[n * width + j];
          if (m < 1e-6) continue;
          const k = j - span;
          segs.push(X(k), Y(n) + 2, X(k + 1), Y(n + 1) + 2, m * P * FLOW_GAIN);
          segs.push(X(k), Y(n) + 2, X(k - 1), Y(n + 1) + 2, m * (1 - P) * FLOW_GAIN);
        }
      }
      glow.clearFlow();
      glow.segments(segs, 3, "flow");
      return;
    }
    if (st.view !== "flow") return;
    // tone map: a peg's brightness follows the log of the share of balls through it
    const lo = Math.log(1e-4), hi = Math.log(0.5);
    ctx.save();
    ctx.globalCompositeOperation = colors.paper ? "multiply" : "lighter";
    ctx.lineCap = "round";
    for (let n = 0; n < SHOW; n++) {
      for (let j = 0; j < width; j++) {
        const m = f[n * width + j];
        if (m < 1e-5) continue;
        const k = j - span;
        for (const [dk, pr] of [[1, P], [-1, 1 - P]]) {
          const w = m * pr, a = Math.min(1, Math.max(0, (Math.log(w) - lo) / (hi - lo)));
          if (a <= 0) continue;
          ctx.strokeStyle = colors.paper ? `rgba(40, 42, 48, ${(0.12 + 0.88 * a * a).toFixed(3)})` : `rgba(255, ${Math.round(205 + 50 * a)}, ${Math.round(150 + 105 * a)}, ${(0.12 + 0.88 * a * a).toFixed(3)})`;
          ctx.lineWidth = 0.8 + 2.2 * a;
          ctx.beginPath(); ctx.moveTo(X(k), Y(n) + 2); ctx.lineTo(X(k + dk), Y(n + 1) + 2); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
  function resetRun() {
    st.balls = [];
    arriving = [];
    recent = []; complete = 0;
    st.piles.right.fill(0); st.piles.left.fill(0);
    st.n = 0; st.correct = 0; st.time = 0; st.later = 0;
    if (exposure) exposure.ctx.clearRect(0, 0, exposure.cv.width, exposure.cv.height);
    tally();
  }
  const pts = (r) => (100 * r).toFixed(1);
  function readout() {
    const { exact, pm, yours } = st.score;
    $("m-exact").textContent = pts(exact.reward);
    $("m-pm").textContent = pts(pm.reward);
    $("m-gap").textContent = (100 * (exact.reward - pm.reward)).toFixed(2);
    $("m-yours-row").hidden = !yours;
    if (yours) {
      $("m-yours").textContent = pts(yours.reward);
      const gy = 100 * (exact.reward - yours.reward), gp = 100 * (exact.reward - pm.reward);
      const d = gp - gy;
      $("m-yours-vs").textContent = Math.abs(d) < 0.005 ? "Level with the 2025 rule: draw them lower, and earlier" : d > 0 ? `You beat the 2025 rule by ${d.toFixed(2)}` : `${(-d).toFixed(2)} behind the 2025 rule`;
    }
    const cur = st.mode === "exact" ? exact : st.mode === "pm" ? pm : yours;
    $("m-p-exp").textContent = `expected ${(100 * cur.p).toFixed(1)}%`;
    $("m-t-exp").textContent = `expected ${cur.rt.toFixed(2)}`;
  }
  function tally() {
    // expected for the balls landed so far, given how long each has been falling
    const cur = st.cur;
    if (cur && st.n) {
      if (!cur.prefix) {
        const L = cur.right.length, tot = new Float64Array(L + 1), rt = new Float64Array(L + 1), nm = new Float64Array(L + 1);
        for (let n = 0; n < L; n++) { const m = cur.right[n] + cur.left[n]; tot[n + 1] = tot[n] + m; rt[n + 1] = rt[n] + cur.right[n]; nm[n + 1] = nm[n] + n * m; }
        cur.prefix = { tot, rt, nm };
      }
      const { tot, rt, nm } = cur.prefix, last = tot.length - 1;
      let M = complete * tot[last], R = complete * rt[last], T = complete * nm[last];
      for (const born of recent) { const a = Math.min(Math.floor(rowClock - born) + 1, last); M += tot[a]; R += rt[a]; T += nm[a]; }
      if (M > 0) {
        $("m-p-exp").textContent = `expected ${((100 * R) / M).toFixed(1)}%`;
        $("m-t-exp").textContent = `expected ${((T / M) * DT).toFixed(2)}`;
      }
    }
    $("m-n").textContent = st.n.toLocaleString("en-US");
    $("m-p").textContent = st.n ? `${((100 * st.correct) / st.n).toFixed(1)}%` : "–";
    $("m-t").textContent = st.n ? (st.time / st.n).toFixed(2) : "–";
  }

  // ------------------------------------------------------------ controls
  const modeSeg = $("m-mode"), schedSeg = $("m-sched");
  $("m-view").addEventListener("change", (e) => { st.view = e.target.value; if (!glow) paintFlow(); });
  modeSeg.addEventListener("change", (e) => {
    st.mode = e.target.value;
    $("m-yours-help").hidden = st.mode !== "yours";
    cv.style.touchAction = st.mode === "yours" || look.on ? "none" : "";
    if (st.mode === "yours") st.yourFromRule = true;
    solve();
  });
  schedSeg.addEventListener("change", (e) => {
    st.sched = e.target.value;
    if (st.sched === "deadline") st.s.at = Math.min(st.s.at, 2.8);
    syncDials(); solve();
  });
  const dAt = $("m-at"), dFactor = $("m-factor"), dCost = $("m-cost");
  function syncDials() {
    dAt.closest("label").hidden = st.sched === "constant";
    dFactor.closest("label").hidden = st.sched !== "rises";
    dAt.value = st.s.at; dFactor.value = Math.log2(st.s.factor); dCost.value = Math.log10(st.s.c0);
    $("m-at-out").textContent = `t = ${st.s.at.toFixed(2)}`;
    $("m-factor-out").textContent = `${Math.round(st.s.factor)}×`;
    $("m-cost-out").textContent = st.s.c0.toFixed(st.s.c0 < 0.1 ? 3 : 2);
    $("m-at-key").textContent = st.sched === "deadline" ? "Deadline" : "When the cost rises";
    placeHandle();
  }
  let pending = 0;
  const later = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; solve(); }); };
  dAt.addEventListener("input", () => { st.s.at = +dAt.value; syncDials(); later(); });
  dFactor.addEventListener("input", () => { st.s.factor = 2 ** +dFactor.value; syncDials(); later(); });
  dCost.addEventListener("input", () => { st.s.c0 = 10 ** +dCost.value; syncDials(); later(); });

  // the handle on the board: drag the moment the cost rises (or the deadline) up and down
  const handle = $("cost-handle");
  let geo = null;
  function placeHandle() {
    if (!geo) return;
    const sch = SCHEDULES[st.sched];
    handle.hidden = !sch.handle;
    handle.style.top = `${geo.Y(st.s.at / DT)}px`;
    $("cost-handle-label").textContent = st.sched === "deadline" ? "Deadline" : `Cost ×${Math.round(st.s.factor)}${geo.w < 520 ? "" : " here"}`;
  }
  let drag = null;
  handle.addEventListener("pointerdown", (e) => { drag = e.pointerId; try { handle.setPointerCapture(e.pointerId); } catch {} e.preventDefault(); });
  handle.addEventListener("pointermove", (e) => {
    if (drag !== e.pointerId || !geo) return;
    const r = cv.getBoundingClientRect();
    const row = geo.Yinv(e.clientY - r.top);
    st.s.at = Math.min(Math.max(row * DT, 0.1), 2.8);
    syncDials(); later();
  });
  const endDrag = (e) => { if (drag === e.pointerId) drag = null; };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  handle.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowUp" ? -0.05 : e.key === "ArrowDown" ? 0.05 : 0;
    if (!d) return;
    e.preventDefault();
    st.s.at = Math.min(Math.max(st.s.at + d, 0.1), 2.8);
    syncDials(); later();
  });

  // with a mouse or pen, the dashed cost line itself can be dragged up and down
  let lineDrag = null;
  cv.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || !geo || !SCHEDULES[st.sched].handle) return;
    if (Math.abs(e.offsetY - geo.Y(st.s.at / DT)) > 8) return;
    lineDrag = e.pointerId; try { cv.setPointerCapture(e.pointerId); } catch {} e.preventDefault();
  });
  cv.addEventListener("pointermove", (e) => {
    if (lineDrag !== e.pointerId) {
      if (geo && e.pointerType !== "touch" && SCHEDULES[st.sched].handle) {
        cv.style.cursor = Math.abs(e.offsetY - geo.Y(st.s.at / DT)) <= 8 ? "ns-resize" : st.mode === "yours" ? "crosshair" : "ew-resize";
      }
      return;
    }
    st.s.at = Math.min(Math.max(geo.Yinv(e.offsetY) * DT, 0.1), 2.8);
    syncDials(); later();
  });
  const endLine = (e) => { if (lineDrag === e.pointerId) lineDrag = null; };
  cv.addEventListener("pointerup", endLine);
  cv.addEventListener("pointercancel", endLine);

  // your walls: draw them with a finger or the mouse; each row's wall goes where you pass
  let pen = null;
  cv.addEventListener("pointerdown", (e) => {
    if (st.mode !== "yours" || !geo || lineDrag !== null || look.on) return;
    if (!st.yourWalls) st.yourWalls = Int32Array.from(st.yours);
    pen = { id: e.pointerId, row: null };
    try { cv.setPointerCapture(e.pointerId); } catch {} e.preventDefault();
    paintWall(e);
  });
  cv.addEventListener("pointermove", (e) => { if (pen && pen.id === e.pointerId) paintWall(e); });
  function paintWall(e) {
    const row = Math.round(geo.Yinv(e.offsetY)), k = Math.round(Math.abs(geo.Xinv(e.offsetX)) - 0.5);
    const K = Math.min(Math.max(k, 1), K_SPAN - 1);
    const n1 = Math.min(Math.max(row, 0), st.rows - 1);
    const n0 = pen.row === null ? n1 : pen.row, k0 = pen.k ?? K;
    const steps = Math.abs(n1 - n0);
    for (let j = 0; j <= steps; j++) {
      const n = n0 + Math.sign(n1 - n0) * j;
      st.yourWalls[n] = Math.round(steps ? k0 + ((K - k0) * j) / steps : K);
    }
    // rows below the deepest point drawn follow it
    pen.deepest = Math.max(pen.deepest ?? -1, n1);
    if (n1 === pen.deepest) for (let n = n1; n < st.rows; n++) st.yourWalls[n] = K;
    pen.row = n1; pen.k = K;
    rescoreYours();
  }
  const endDraw = (e) => {
    if (!pen || pen.id !== e.pointerId) return;
    pen = null;
    resetRun();
    paintFlow();
  };
  cv.addEventListener("pointerup", endDraw);
  cv.addEventListener("pointercancel", endDraw);
  $("m-straighten").addEventListener("click", () => { st.yourWalls = null; st.yourFromRule = true; solve(); });

  // the evidence's strength: tilt the phone, drag sideways on the board with a mouse, or use the
  // dial; the walls are solved again for each strength
  const dMu = $("m-mu");
  let deviceTilt = false;
  function setMu(mu, immediate) {
    st.mu = Math.min(Math.max(mu, 0.4), 2.5);
    dMu.value = Math.log2(st.mu);
    $("m-mu-out").textContent = `${st.mu.toFixed(2)}×`;
    const stage = cv.closest(".machine-stage");
    const deg = deviceTilt ? 0 : 7 * Math.log2(st.mu);
    stage.style.setProperty("--tilt", `${deg.toFixed(2)}deg`);
    stage.style.setProperty("--tilt-scale", (1 - 0.012 * Math.abs(deg)).toFixed(3));
    if (immediate) later(); else muSolve();
  }
  let muTimer = 0;
  const muSolve = () => { if (!muTimer) muTimer = setTimeout(() => { muTimer = 0; solve(); }, 120); };
  dMu.addEventListener("input", () => setMu(2 ** +dMu.value, true));
  let tiltDrag = null;
  cv.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || st.mode === "yours" || lineDrag !== null || !geo || look.on) return;
    tiltDrag = { id: e.pointerId, x: e.clientX, mu: st.mu };
    try { cv.setPointerCapture(e.pointerId); } catch {}
  });
  cv.addEventListener("pointermove", (e) => {
    if (!tiltDrag || tiltDrag.id !== e.pointerId) return;
    setMu(tiltDrag.mu * 2 ** ((e.clientX - tiltDrag.x) / 160));
  });
  const endTilt = (e) => { if (tiltDrag && tiltDrag.id === e.pointerId) tiltDrag = null; };
  cv.addEventListener("pointerup", endTilt);
  cv.addEventListener("pointercancel", endTilt);
  const tiltBtn = $("m-tilt");
  if (!("DeviceOrientationEvent" in window) || !matchMedia("(pointer: coarse)").matches) tiltBtn.hidden = true;
  tiltBtn.addEventListener("click", async () => {
    if (tiltBtn.getAttribute("aria-pressed") === "true") {
      window.removeEventListener("deviceorientation", onTilt);
      deviceTilt = false;
      tiltBtn.setAttribute("aria-pressed", "false");
      return;
    }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        const ok = await DeviceOrientationEvent.requestPermission();
        if (ok !== "granted") return;
      }
      window.addEventListener("deviceorientation", onTilt);
      deviceTilt = true; tiltZero = null;
      tiltBtn.setAttribute("aria-pressed", "true");
    } catch { tiltBtn.hidden = true; }
  });
  let tiltZero = null;
  function onTilt(e) {
    if (e.gamma === null) return;
    if (tiltZero === null) tiltZero = e.gamma;
    setMu(2 ** ((e.gamma - tiltZero) / 22));
  }

  // pour: drop thousands of balls at once, so the piles fill to what the math expects
  $("m-pour").addEventListener("click", () => { pourLeft = 5000; pourGlowUntil = performance.now() + 6000; wake(); });
  let pourLeft = 0, pourGlowUntil = 0;
  // the opening's payoff: once the stream has built up, one pour of 2,500
  let autoPoured = false, autoLooked = false, touched = false;
  for (const ev of ["pointerdown", "keydown", "input"]) root.addEventListener(ev, (e) => { if (e.isTrusted) touched = true; }, { capture: true });
  function pourStep() {
    if (!autoPoured && !reduced.matches && !walk.on && (performance.now() - rampFrom) / 1000 > 8) {
      autoPoured = true; pourLeft = 2500; pourGlowUntil = performance.now() + 6000;
    }
    if (autoPoured && !autoLooked && !touched && !look.on && !walk.on && st.sched === "rises" && st.mode === "exact" && (performance.now() - rampFrom) / 1000 > 15) {
      autoLooked = true;
      if ((performance.now() - rampFrom) / 1000 < 40) setLook(true, true, null, 4200);
    }
    if (!pourLeft) return;
    const batch = Math.min(pourLeft, 420), pStep = pUp(st.mu), segs = [], { X, Y } = geo;
    for (let i = 0; i < batch; i++) {
      let k = 0, n = 0;
      while (!(n >= st.rows || Math.abs(k) >= st.walls[n])) {
        const pk = k;
        k += rng.next() < pStep ? 1 : -1;
        if (glow && n < SHOW) segs.push(X(pk), Y(n) + 2, X(k), Y(n + 1) + 2, TRAIL * 0.22);
        n++;
      }
      const correct = k > 0 || (k === 0 && rng.next() < 0.5);
      st.n++; st.time += n * DT; if (correct) st.correct++;
      if (n < SHOW) (correct ? st.piles.right : st.piles.left)[Math.floor(n / BIN)]++;
      else st.later++;
      complete++;
      if (i % 60 === 0) { tick(n, correct); if (n < SHOW && flashes.length < 60) flashes.push({ k, n, t: performance.now() }); }
    }
    if (glow) glow.segments(segs, TRAIL_W);
    pourLeft -= batch;
    tallyDirty = true;
  }

  // the look-ahead: from one moment on the best wall, the future of a ball one step inside it, as
  // the decision maker sees it, with the wall held where it is (lattice.js lookAhead). To first
  // order the wall weighs the cost at each later moment by this light.
  const look = { on: false, row: 0, from: 0, target: 0, t0: 0, mix: 0, key: "", data: null, layer: null };
  const lookBtn = $("m-look"), lookHelp = $("m-look-help");
  function lookDefault() {
    const t = st.sched === "constant" ? SHOW * DT * 0.25 : Math.max(0, st.s.at - (st.sched === "deadline" ? 0.5 : 0.42));
    return Math.round(t / DT);
  }
  function setLook(on, sweep, at, dur = 1800) {
    look.on = on;
    look.dur = dur;
    lookBtn.setAttribute("aria-pressed", String(on));
    lookHelp.hidden = !on || walk.on;
    cv.closest(".machine-stage").classList.toggle("looking", on);
    cv.style.touchAction = on || st.mode === "yours" ? "none" : "";
    if (on) {
      look.target = at != null ? Math.round(at / DT) : lookDefault();
      look.from = sweep && !reduced.matches ? 0 : look.target;
      look.row = look.from; look.t0 = performance.now();
      look.key = "";
    }
    wake();
    if (reduced.matches) { look.mix = on ? 1 : 0; draw(); }
  }
  lookBtn.addEventListener("click", () => setLook(!look.on, true));
  lookBtn.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowUp" ? -5 : e.key === "ArrowDown" ? 5 : 0;
    if (!d || !look.on) return;
    e.preventDefault();
    look.target = look.row = look.from = Math.min(Math.max(look.row + d, 0), SHOW - 2);
    if (reduced.matches) draw();
  });
  let lookDrag = null;
  cv.addEventListener("pointerdown", (e) => {
    if (!look.on || lineDrag !== null || !geo) return;
    lookDrag = e.pointerId; try { cv.setPointerCapture(e.pointerId); } catch {} e.preventDefault();
    moveLook(e);
  });
  cv.addEventListener("pointermove", (e) => { if (lookDrag === e.pointerId) moveLook(e); });
  function moveLook(e) {
    look.target = look.row = look.from = Math.min(Math.max(Math.round(geo.Yinv(e.offsetY)), 0), SHOW - 2);
    if (reduced.matches) draw(); else if (paused) wake();
  }
  const endLook = (e) => { if (lookDrag === e.pointerId) lookDrag = null; };
  cv.addEventListener("pointerup", endLook);
  cv.addEventListener("pointercancel", endLook);
  /** Recompute and repaint the light when the moment, the walls, or the board change. */
  function paintLook() {
    const n0 = Math.min(Math.max(Math.round(look.row), 0), Math.max(SHOW - 2, 0));
    const level = Math.min(effectiveWall(st.ex, Math.min(n0, st.ex.length - 2)), 90);
    const key = `${n0}|${level}|${st.mu}|${SHOW}|${K_SPAN}|${geo.w}|${geo.h}|${st.sched}|${st.s.at}|${st.s.factor}|${st.s.c0}`;
    if (key === look.key) return;
    look.key = key;
    const ahead = SHOW - n0, span = K_SPAN, width = 2 * span + 1;
    const d = lookAhead(level, st.mu, ahead, span);
    look.data = { n0, level, ...d };
    if (!look.layer || look.layer.cv.width !== board.cv.width || look.layer.cv.height !== board.cv.height) { look.layer = layer(geo.w, geo.h); look.tmp = layer(geo.w, geo.h); }
    const { X, Y } = geo, P = pUp(st.mu);
    // the light along each step, brighter where more of the weight passes, then a soft glow
    {
      const ctx = look.tmp.ctx;
      ctx.clearRect(0, 0, geo.w, geo.h);
      ctx.save();
      ctx.globalCompositeOperation = colors.paper ? "multiply" : "lighter";
      ctx.lineCap = "round";
      // past the rise (or the deadline) the light burns hot: the time it reaches there is expensive
      const hotFrom = st.sched === "constant" ? Infinity : (st.sched === "deadline" ? st.rows : st.s.at / DT) - n0;
      for (let s = 0; s < ahead; s++) {
        ctx.strokeStyle = s >= hotFrom ? colors.hot : colors.wb;
        for (let j = 0; j < width; j++) {
          const m = d.share[s * width + j];
          if (!(m > 1e-4)) continue;
          const k = j - span, g = posterior(k, st.mu), u = g * P + (1 - g) * (1 - P);
          for (const [dk, pr] of [[1, u], [-1, 1 - u]]) {
            const a = Math.min(1, ((m * pr) / 0.05) ** 0.5);
            if (a <= 0.03) continue;
            ctx.globalAlpha = a;
            ctx.lineWidth = 0.7 + 1.9 * a;
            ctx.beginPath(); ctx.moveTo(X(k), Y(n0 + s) + 2); ctx.lineTo(X(k + dk), Y(n0 + s + 1) + 2); ctx.stroke();
          }
        }
      }
      ctx.restore();
    }
    const ctx = look.layer.ctx;
    ctx.clearRect(0, 0, geo.w, geo.h);
    ctx.save();
    ctx.globalCompositeOperation = colors.paper ? "multiply" : "lighter";
    if ("filter" in ctx) { ctx.filter = "blur(6px)"; ctx.globalAlpha = 0.9; ctx.drawImage(look.tmp.cv, 0, 0, geo.w, geo.h); ctx.filter = "none"; }
    ctx.globalAlpha = 1; ctx.drawImage(look.tmp.cv, 0, 0, geo.w, geo.h);
    ctx.restore();
    // the walls held where they are, fading as the light does
    const tot = d.alive.reduce((a, b) => a + b, 0);
    let left = tot;
    ctx.save();
    ctx.strokeStyle = colors.wb; ctx.lineWidth = 1.5; ctx.setLineDash([2, 4]);
    for (let s = 0; s < ahead && s < d.alive.length; s += 2) {
      ctx.globalAlpha = Math.max(left / tot, 0) ** 0.5;
      for (const side of [1, -1]) { ctx.beginPath(); ctx.moveTo(X(side * (level + 0.5)), Y(n0 + s) + 2); ctx.lineTo(X(side * (level + 0.5)), Y(n0 + s + 2) + 2); ctx.stroke(); }
      left -= d.alive[s] + (d.alive[s + 1] || 0);
    }
    ctx.restore();
    // the paper's look-ahead rule on this board: the 2025 rule's walls averaged under the light,
    // at the level the average itself sets
    const rule = lookAheadRule(st.pm, n0, st.rows, st.mu, level);
    look.data.rule = rule;
    const pmNow = effectiveWall(st.pm, Math.min(n0, st.pm.length - 2));
    const after = st.sched === "deadline" ? st.rows : st.s.at / DT;
    const share = Math.round((100 * d.alive.reduce((a, v, s) => a + (n0 + s >= after ? v : 0), 0)) / tot);
    look.data.share = st.sched === "constant" ? null : share;
    look.data.after = after;
    const t = (n0 * DT).toFixed(2);
    const held = st.sched === "constant" ? ""
      : `If the bounds stayed where they are, ${share}% of it would fall ${st.sched === "deadline" ? "past the deadline" : "after the cost rises"}. `;
    lookHelp.querySelector("p").textContent = `From t = ${t}, the ${colorWord("wb")} light shows how much each later moment counts for the bound here: the paper’s look-ahead weights, on this board. ${held}Average my 2025 rule’s bounds under the light, with the weights taken at the level that average gives, and you get ${rule.toFixed(1)} pegs from the middle (the ${colorWord("wb")} diamond): the paper’s look-ahead rule. The best bound here is at ${level}; the 2025 rule’s own, at ${pmNow}.`;
    if (walk.on && STOPS[walk.stop].id === "look") walkSay();
  }
  function drawLook(ctx) {
    const target = look.on ? 1 : 0;
    look.mix += (target - look.mix) * (reduced.matches ? 1 : 0.14);
    if (Math.abs(look.mix - target) < 0.01) look.mix = target;
    if (look.mix <= 0) return;
    if (look.on && look.row !== look.target) {
      const u = Math.min(1, (performance.now() - look.t0) / (look.dur || 1800)), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      look.row = look.from + (look.target - look.from) * e;
      if (u >= 1) look.row = look.target;
    }
    paintLook();
    const { X, Y } = geo, d = look.data;
    // dim the rest so the light reads
    ctx.save();
    ctx.globalAlpha = 0.55 * look.mix; ctx.fillStyle = colors.print; ctx.fillRect(0, 0, geo.w, geo.h);
    ctx.globalAlpha = look.mix;
    ctx.drawImage(look.layer.cv, 0, 0, geo.w, geo.h);
    // the moment it looks from, and how far the light reaches on average
    const y0 = Y(d.n0) + 2, y1 = Y(d.n0 + d.mean / DT) + 2, bx = geo.left + 6;
    ctx.strokeStyle = colors.wb; ctx.fillStyle = colors.wb; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X(d.k0), y0, 5, 0, 2 * Math.PI); ctx.stroke();
    // where the look-ahead rule puts the walls at this moment
    if (d.rule != null) {
      // an arrow from the 2025 rule's wall in to where averaging under the light puts it
      const xp = X(Math.min(effectiveWall(st.pm, Math.min(d.n0, st.pm.length - 2)), K_SPAN) + 0.5), xr = X(Math.min(d.rule, K_SPAN) + 0.5);
      if (Math.abs(xp - xr) > 14) {
        const dir = Math.sign(xr - xp);
        ctx.setLineDash([]); ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(xp, y0 - 12); ctx.lineTo(xr - dir * 9, y0 - 12); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(xr - dir * 9, y0 - 16); ctx.lineTo(xr - dir * 3, y0 - 12); ctx.lineTo(xr - dir * 9, y0 - 8); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(xp, y0 - 12, 2.2, 0, 2 * Math.PI); ctx.fill();
      }
    }
    if (d.rule != null) for (const side of [1, -1]) {
      const x = X(side * (Math.min(d.rule, K_SPAN) + 0.5));
      ctx.beginPath(); ctx.moveTo(x, y0 - 7); ctx.lineTo(x + 7, y0); ctx.lineTo(x, y0 + 7); ctx.lineTo(x - 7, y0); ctx.closePath();
      ctx.fillStyle = colors.wb; ctx.fill();
      ctx.strokeStyle = colors.print; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.strokeStyle = colors.wb; ctx.lineWidth = 1.5;
    }
    // the weight itself: how much each later moment counts, as a profile along the time scale;
    // the part on time after the cost rises in orange
    const ref = d.alive[Math.min(3, d.alive.length - 1)] || 1, rise = SCHEDULES[st.sched].handle ? st.s.at / DT : Infinity;
    for (const hot of [false, true]) {
      ctx.beginPath(); ctx.moveTo(bx, y0);
      let started = false;
      for (let s = 0; s < d.alive.length && d.n0 + s <= SHOW; s++) {
        const n = d.n0 + s;
        if ((n >= rise) !== hot) continue;
        const x = bx + 34 * Math.min(1, d.alive[s] / ref), y = Y0(n);
        if (!started) { ctx.moveTo(bx, y); started = true; }
        ctx.lineTo(x, y);
      }
      if (!started) continue;
      const last = Math.min(d.n0 + d.alive.length - 1, SHOW);
      ctx.lineTo(bx, Y0(hot ? last : Math.min(rise, last))); ctx.closePath();
      ctx.globalAlpha = 0.35 * look.mix; ctx.fillStyle = hot ? colors["accent-print"] : colors.wb; ctx.fill();
      ctx.globalAlpha = look.mix;
    }
    ctx.fillStyle = colors.wb;
    ctx.beginPath(); ctx.moveTo(bx, y0); ctx.lineTo(bx, Y0(Math.min(d.n0 + d.alive.length, SHOW))); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx - 3, y1); ctx.lineTo(bx + 12, y1); ctx.stroke();
    ctx.setLineDash([2, 3]); ctx.globalAlpha = 0.6 * look.mix;
    ctx.beginPath(); ctx.moveTo(bx, y0); ctx.lineTo(X(d.k0) - 6, y0); ctx.stroke();
    ctx.restore();
  }
  /** The look-ahead's label, drawn last so nothing covers it. */
  function drawLookLabel(ctx) {
    if (look.mix <= 0 || !look.data) return;
    const d = look.data, y0 = Y0(d.n0), y1 = Y0(d.n0 + d.mean / DT), bx = geo.left + 6;
    ctx.save();
    ctx.globalAlpha = look.mix;
    ctx.font = `700 ${geo.w < 600 ? 11 : 10.5}px ${getComputedStyle(root).fontFamily}`;
    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    const txt = `LOOKS ${d.mean.toFixed(2)} AHEAD`, tw = ctx.measureText(txt).width, ty = Math.max((y0 + y1) / 2, y0 + 10);
    ctx.fillStyle = colors.print; ctx.fillRect(bx + 6, ty - 8, tw + 6, 16);
    ctx.fillStyle = colors.wb; ctx.fillText(txt, bx + 9, ty);
    // how much of the light falls on the expensive time, on the cost line beside the light
    if (d.share != null && d.after < SHOW) {
      const { X } = geo;
      const hot = `${d.share}% ${st.sched === "deadline" ? "PAST THE DEADLINE" : "AFTER THE RISE"}`, hw = ctx.measureText(hot).width;
      const yc = Y0(d.after) + 12, xc = Math.min(Math.max(X(0) - hw / 2, geo.left + 4), geo.right - hw - 10);
      if (yc < geo.bottom - 4) {
        ctx.fillStyle = colors.print; ctx.fillRect(xc - 3, yc - 8, hw + 6, 16);
        ctx.fillStyle = colors.hot; ctx.fillText(hot, xc, yc);
      }
    }
    ctx.restore();
  }
  const Y0 = (row) => geo.Y(row) + 2;

  // ------------------------------------------------------------ drawing
  let colors = {};
  const readColors = () => {
    const cs = getComputedStyle(root);
    for (const k of ["print", "print-2", "print-line", "print-ink", "print-dim", "accent-print", "pm", "wb", "hot"]) colors[k] = cs.getPropertyValue(`--${k}`).trim();
    const paper = cs.getPropertyValue("--theme").trim() === "light";
    if (paper !== colors.paper) { colors.paper = paper; makeSprite(); }
    colors.tint = glowTint(appearance().hue);
  };
  document.addEventListener("appearance:change", () => { readColors(); paintBoard(); paintFlow(); look.key = ""; if (geo && board) draw(); });

  let board = null, exposure = null, dpr = 1;
  // a ball: a bright core with a soft halo, drawn once
  const sprite = document.createElement("canvas");
  function makeSprite() {
    sprite.width = sprite.height = 48;
    const c = sprite.getContext("2d");
    c.clearRect(0, 0, 48, 48);
    if (colors.paper) {
      const sh = c.createRadialGradient(25.5, 26.5, 4, 25.5, 26.5, 15);
      sh.addColorStop(0, "rgba(20,22,26,0.35)"); sh.addColorStop(1, "rgba(20,22,26,0)");
      c.fillStyle = sh; c.fillRect(0, 0, 48, 48);
      const g = c.createRadialGradient(21, 20, 0.5, 24, 24, 8.5);
      g.addColorStop(0, "#c9ced6"); g.addColorStop(0.25, "#6f757e"); g.addColorStop(0.75, "#22252a"); g.addColorStop(1, "#15171a");
      c.fillStyle = g; c.beginPath(); c.arc(24, 24, 8, 0, 2 * Math.PI); c.fill();
      return;
    }
    const g = c.createRadialGradient(24, 24, 0, 24, 24, 24);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.28, "rgba(255,255,255,0.95)");
    g.addColorStop(0.36, "rgba(255,240,225,0.35)"); g.addColorStop(1, "rgba(255,220,200,0)");
    c.fillStyle = g; c.fillRect(0, 0, 48, 48);
  }
  readColors();
  // a pin: a dark steel dot with a highlight and a soft shadow
  const pin = document.createElement("canvas");
  pin.width = pin.height = 24;
  {
    const c = pin.getContext("2d");
    const sh = c.createRadialGradient(13, 14, 2, 13, 14, 11);
    sh.addColorStop(0, "rgba(0,0,0,0.55)"); sh.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = sh; c.fillRect(0, 0, 24, 24);
    const g = c.createRadialGradient(10, 9, 0.5, 12, 12, 7.5);
    g.addColorStop(0, "#aab0b8"); g.addColorStop(0.3, "#5d636b"); g.addColorStop(0.8, "#2a2e33"); g.addColorStop(1, "rgba(30,33,37,0)");
    c.fillStyle = g; c.beginPath(); c.arc(12, 12, 7.5, 0, 2 * Math.PI); c.fill();
  }
  function layer(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { cv: c, ctx };
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    board = layer(w, h);
    exposure = layer(w, h);
    if (glow) glow.resize(w, h, dpr);
    layout();
    paintBoard();
    paintFlow();
  }
  function layout() {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    // on phones the board runs to the screen's edges, so its labels keep a margin of their own
    const edge = w < 520 ? 10 : 2;
    const top = 40, bottom = h - 14, left = 28 + edge, right = w - 6 - edge;
    const cx = (left + right) / 2, half = (right - left) / 2;
    const sx = half / (K_SPAN * DELTA), sy = (bottom - top) / SHOW;
    geo = {
      w, h, top, bottom, left, right, cx, sx, sy, edge,
      X: (k) => cx + k * DELTA * sx, Xinv: (x) => (x - cx) / (DELTA * sx),
      Y: (row) => top + row * sy, Yinv: (y) => (y - top) / sy,
    };
    if (exposure) exposure.ctx.clearRect(0, 0, w, h);
    if (glow) glow.clearTrails();
    placeHandle();
  }

  /** The board itself: pegs, the cost of time as a glow, the time scale, and the walls. */
  function paintBoard() {
    if (!geo || !board || !st.costs) return;
    const { ctx } = board, { w, h, top, bottom, left, right, X, Y } = geo;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = colors.print; ctx.fillRect(0, 0, w, h);
    // the cost of time, as a warm glow where it is high (log scale against the starting cost)
    const c0 = st.costs[0];
    for (let n = 0; n < SHOW; n += 2) {
      const c = n < st.costs.length ? st.costs[n] : Infinity;
      const a = !Number.isFinite(c) ? 0.2 : Math.min(Math.max(Math.log(c / c0) / Math.log(32), 0), 1) * 0.16;
      if (a <= 0.005) continue;
      ctx.fillStyle = colors["accent-print"]; ctx.globalAlpha = a;
      ctx.fillRect(left, Y(n), right - left, geo.sy * 2 + 0.5);
    }
    ctx.globalAlpha = 1;
    // pegs: small steel pins, lit from the upper left, on rows far enough apart to see
    const every = Math.max(2, Math.ceil(9 / geo.sy) + (Math.ceil(9 / geo.sy) % 2));
    const pr = Math.min(2.8, Math.max(1.1, geo.sy * 0.34));
    for (let n = 0; n < SHOW; n += every) {
      const reach = Math.max(...[st.ex, st.pm, st.walls].map((K) => Math.min(effectiveWall(K, Math.min(n, K.length - 2)), K_SPAN))) + 1;
      for (let k = -K_SPAN + ((n + K_SPAN) % 2); k <= K_SPAN; k += 2) {
        const out = Math.abs(k) - reach;
        if (out > 2) continue;
        ctx.globalAlpha = out <= 0 ? 1 : 0.35 / out;
        ctx.drawImage(pin, X(k) - pr * 1.6, Y(n) + 2 - pr * 1.6, pr * 3.2, pr * 3.2);
      }
    }
    ctx.globalAlpha = 1;
    // the time scale on the left
    ctx.font = `600 ${geo.w < 600 ? 11 : 10.5}px ${getComputedStyle(root).fontFamily}`;
    ctx.fillStyle = colors["print-dim"]; ctx.strokeStyle = colors["print-dim"]; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    const tick = SHOW * DT > 2 ? 0.25 : 0.1, lab = SHOW * DT > 2 ? 1 : SHOW * DT > 0.8 ? 0.5 : 0.2;
    for (let i = 0; i * tick <= SHOW * DT + 1e-9; i++) {
      const t = i * tick, y = Math.round(Y(t / DT)) + 0.5, major = Math.abs(t / lab - Math.round(t / lab)) < 1e-6;
      ctx.beginPath(); ctx.moveTo(left - (major ? 8 : 4), y); ctx.lineTo(left, y); ctx.stroke();
      if (major) ctx.fillText(lab >= 1 ? String(Math.round(t)) : t.toFixed(1), left - 10, y);
    }
    ctx.textAlign = "left";
    ctx.fillText("TIME", geo.edge, top - 14);
    // where the cost rises, or the deadline
    if (SCHEDULES[st.sched].handle) {
      const y = Math.round(Y(st.s.at / DT)) + 0.5;
      ctx.save(); ctx.strokeStyle = colors["accent-print"]; ctx.globalAlpha = 0.85; ctx.setLineDash([3, 4]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); ctx.restore();
    }
    // the hopper
    ctx.fillStyle = colors["print-ink"];
    ctx.beginPath(); ctx.moveTo(X(0) - 7, top - 12); ctx.lineTo(X(0) + 7, top - 12); ctx.lineTo(X(0), top - 3); ctx.closePath(); ctx.fill();
    // pile labels
    ctx.font = `600 ${geo.w < 600 ? 11 : 10.5}px ${getComputedStyle(root).fontFamily}`;
    ctx.fillStyle = colors["print-dim"]; ctx.textBaseline = "alphabetic";
    ctx.textAlign = "right"; ctx.fillText("CHOSE RIGHT, CORRECT →", right, 16);
    ctx.textAlign = "left"; ctx.fillText("← CHOSE LEFT, WRONG", left + 2, 16);
    if (glow) glow.setBoard(board.cv);
  }

  // the walls glide to new positions over a third of a second instead of jumping
  const shown = { exact: null, pm: null, cur: null };
  function wallLine(K) {
    const last = Math.min(SHOW, K.length - 2);
    const raw = Array.from({ length: last + 1 }, (_, n) => Math.min(effectiveWall(K, n), K_SPAN) + 0.5);
    // a ball only meets the wall at a peg, so the wall is drawn through the middle of each step
    return raw.map((v, n) => { let a = 0, m = 0; for (let j = -1; j <= 1; j++) { const i = n + j; if (i >= 0 && i <= last) { a += raw[i]; m++; } } return a / m; });
  }
  function glide(key, target, rate) {
    const cur = shown[key];
    if (!cur || cur.length !== target.length) { shown[key] = target.slice(); return false; }
    let moving = false;
    for (let i = 0; i < target.length; i++) {
      const d = target[i] - cur[i];
      if (Math.abs(d) > 0.01) { cur[i] += d * rate; moving = true; } else cur[i] = target[i];
    }
    return moving;
  }
  const born = performance.now();
  function drawWalls(ctx, rate) {
    const { X, Y } = geo;
    // on first view the walls draw themselves in from the top
    const reveal = reduced.matches ? 1 : Math.min(1, (performance.now() - born) / 1400);
    ctx.save();
    if (reveal < 1) { ctx.beginPath(); ctx.rect(0, 0, geo.w, geo.top + (geo.bottom - geo.top) * (1 - (1 - reveal) ** 3) + 4); ctx.clip(); }
    const line = (arr, color, width, dash, alpha) => {
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha; ctx.setLineDash(dash);
      for (const side of [1, -1]) {
        ctx.beginPath();
        arr.forEach((v, n) => { const x = X(side * v), y = Y(n) + 2; if (n) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.stroke();
      }
      ctx.restore();
    };
    glide("exact", wallLine(st.ex), rate);
    glide("pm", wallLine(st.pm), rate);
    glide("cur", wallLine(st.walls), rate);
    if (st.mode !== "pm") line(shown.pm, colors.pm, 1.5, [6, 5], 0.55);
    if (st.mode !== "exact") line(shown.exact, colors["print-ink"], 1.5, [], 0.35);
    const style = st.mode === "exact" ? [colors["print-ink"], 2.4, []] : st.mode === "pm" ? [colors.pm, 2.4, [6, 5]] : [colors["accent-print"], 2.6, []];
    line(shown.cur, ...style, 1);
    // name the curves where they are
    const r = Math.min(Math.max(3, Math.round(SHOW * 0.05)), shown.cur.length - 1);
    ctx.font = `700 ${geo.w < 600 ? 11 : 10.5}px ${getComputedStyle(root).fontFamily}`;
    ctx.textBaseline = "middle";
    // a name gives way to the walkthrough's ball tag where the two would overlap
    const bt = ballTag(ctx), btw = bt ? bt.tw : 0;
    const bx0 = bt ? (bt.align === "right" ? bt.tx - btw : bt.tx) - 4 : 0;
    const tag = (txt, x, y, color, align) => {
      ctx.textAlign = align;
      const tw = ctx.measureText(txt).width, x0 = align === "right" ? x - tw : x;
      if (bt && x0 - 3 < bx0 + btw + 8 && x0 + tw + 3 > bx0 && Math.abs(y - bt.ty) < 20) return;
      ctx.fillStyle = colors.print; ctx.fillRect(x0 - 3, y - 8, tw + 6, 16);
      ctx.fillStyle = color; ctx.fillText(txt, x, y);
    };
    const curName = st.mode === "exact" ? "BEST" : st.mode === "pm" ? "2025 RULE" : "YOURS";
    tag(curName, X(shown.cur[r]) - 8, Y(r) + 4, style[0], "right");
    if (look.mix > 0.5) { /* the look-ahead marks that side itself */ }
    else if (st.mode !== "pm" && shown.pm[r] !== undefined) tag("2025 RULE", X(-shown.pm[r]) - 8, Y(r) + 4, colors.pm, "right");
    else if (st.mode === "pm" && shown.exact[r] !== undefined) tag("BEST", X(-shown.exact[r]) - 8, Y(r) + 4, colors["print-ink"], "right");
    ctx.restore();
  }

  function frame(now) {
    raf = 0;
    if (!st.visible || document.hidden) { st.last = 0; return; }
    const dt = st.last ? Math.min((now - st.last) / 1000, 0.05) : 1 / 60;
    st.last = now;
    if (paused && !walk.on) {
      draw();
      // keep drawing only while the look-ahead ring is still gliding
      if (look.on && look.row !== look.target) raf = requestAnimationFrame(frame);
      return;
    }
    if (walk.on) walkStep(dt); else step(dt);
    pourStep();
    draw();
    raf = requestAnimationFrame(frame);
  }
  let raf = 0, paused = false;
  const pauseBtn = $("m-pause");
  function setPaused(on) {
    paused = on;
    pauseBtn.setAttribute("aria-pressed", String(on));
    pauseBtn.querySelector("span").textContent = on ? "Play" : "Pause";
    stage.classList.toggle("paused", on);
    st.last = 0;
    wake();
  }
  pauseBtn.addEventListener("click", () => setPaused(!paused));
  // the space bar pauses the machine (or plays the walkthrough's car) while focus is in it
  root.addEventListener("keydown", (e) => {
    if (e.key !== " " || e.target.closest("button, input, textarea, select, summary, a")) return;
    e.preventDefault();
    if (walk.on) { if (walk.ball && !walk.result) setPlaying(!walk.playing); } else setPaused(!paused);
  });
  const wake = () => { if (!raf && st.visible && !reduced.matches) raf = requestAnimationFrame(frame); };

  // the machine opens with one slow ball, so a single decision can be followed peg by peg, then
  // builds up to the full rate
  const SOLO = 2.8, BUILD = 3.5;
  let rampFrom = performance.now(), soloDropped = false, rowClock = 0;
  // ages, in rows, of balls dropped recently; older ones count as complete
  let recent = [], complete = 0;
  function restartRamp() { rampFrom = performance.now(); soloDropped = false; }
  function step(dt) {
    const pStep = pUp(st.mu);
    const age = (performance.now() - rampFrom) / 1000;
    const pace = age < SOLO ? 0.3 : Math.min(1, 0.3 + (0.7 * (age - SOLO)) / BUILD);
    if (age < SOLO) {
      if (!soloDropped) { soloDropped = true; st.balls.push({ k: 0, pk: 0, n: 0, f: 0, solo: true }); recent.push(rowClock); }
    } else {
      st.spawnAcc += dt * SPAWN_PER_SEC * Math.min(1, ((age - SOLO) / BUILD) ** 1.5);
      while (st.spawnAcc >= 1) { st.spawnAcc--; st.balls.push({ k: 0, pk: 0, n: 0, f: 0 }); recent.push(rowClock); }
    }
    rowClock += dt * ROWS_PER_SEC * pace;
    while (recent.length && rowClock - recent[0] > st.rows + 1) { recent.shift(); complete++; }
    const ectx = exposure.ctx, { X, Y } = geo;
    const segs = [];
    if (!glow) {
      // fade the exposure a little each frame, so trails linger like a long exposure
      ectx.save();
      ectx.globalCompositeOperation = "destination-out";
      ectx.fillStyle = `rgba(0,0,0,${Math.min(1, dt * 1.6)})`;
      ectx.fillRect(0, 0, geo.w, geo.h);
      ectx.restore();
      ectx.strokeStyle = colors["print-ink"]; ectx.lineWidth = 1.2; ectx.globalAlpha = 0.2; ectx.lineCap = "round";
      ectx.beginPath();
    }
    const keep = [];
    for (const b of st.balls) {
      b.f += dt * ROWS_PER_SEC * pace;
      let done = false;
      while (b.f >= 1 && !done) {
        b.f -= 1;
        // decide at this row?
        if (b.n >= st.rows || Math.abs(b.k) >= st.walls[b.n]) { done = true; break; }
        b.pk = b.k;
        b.k += rng.next() < pStep ? 1 : -1;
        if (b.n < SHOW) {
          if (glow) segs.push(X(b.pk), Y(b.n) + 2, X(b.k), Y(b.n + 1) + 2, b.solo ? TRAIL * 6 : TRAIL);
          else { ectx.moveTo(X(b.pk), Y(b.n) + 2); ectx.lineTo(X(b.k), Y(b.n + 1) + 2); }
        }
        b.n++;
        if (b.n >= st.rows || Math.abs(b.k) >= st.walls[b.n]) done = true;
      }
      if (done) land(b); else keep.push(b);
    }
    // after a pour the exposure lingers, so the river it leaves can be seen
    const linger = performance.now() < pourGlowUntil ? 0.18 : TRAIL_FADE;
    if (glow) { glow.fade(Math.exp(-dt * linger)); glow.segments(segs, TRAIL_W); }
    else { ectx.stroke(); ectx.globalAlpha = 1; }
    st.balls = keep;
  }
  // sound, if the reader turns it on: a soft tick for each decision, higher the sooner it came,
  // and a duller one for a mistake
  // sound comes from the page's one switch, in the top bar (sound.js)
  let ticks = 0, tickWindow = 0;
  function tick(row, correct) {
    const a = sharedAudio();
    if (!a) return;
    const audio = a.ctx, now = audio.currentTime;
    if (now - tickWindow > 0.1) { tickWindow = now; ticks = 0; }
    if (++ticks > 3) return; // at most about 30 a second
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = correct ? "sine" : "triangle";
    o.frequency.value = correct ? 1400 - 900 * Math.min(row / SHOW, 1) : 220;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(correct ? 0.12 : 0.09, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + (correct ? 0.09 : 0.14));
    o.connect(g); g.connect(a.out);
    o.start(now); o.stop(now + 0.16);
  }
  const flashes = [];
  let arriving = [];
  function land(b) {
    const correct = b.correct ?? (b.k > 0 || (b.k === 0 && rng.next() < 0.5));
    tick(b.n, correct);
    if (b.n < SHOW && flashes.length < 60) flashes.push({ k: b.k, n: b.n, t: performance.now() });
    st.n++; st.time += b.n * DT; if (correct) st.correct++;
    if (b.n < SHOW) {
      const side = correct ? 1 : -1;
      if (reduced.matches || arriving.length > 80) (side > 0 ? st.piles.right : st.piles.left)[Math.floor(b.n / BIN)]++;
      else arriving.push({ k: b.k, n: b.n, side, t: performance.now() });
    } else st.later++;
    tallyDirty = true;
  }
  let tallyDirty = false, tallyAt = 0;

  function draw() {
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { w, h, X, Y, sy } = geo;
    ctx.clearRect(0, 0, w, h);
    viewMix += ((st.view === "flow" ? 1 : 0) - viewMix) * (reduced.matches ? 1 : 1 - Math.exp(-Math.min((performance.now() - (lastDraw || performance.now())) / 1000, 0.1) * 7.5));
    const boost = Math.min(Math.max(geo.h / 560, 1), 1.9);
    // on paper the same exposure is printed denser, since ink reads less than light does on black
    if (glow) glow.render(viewMix, colors.paper ? boost * 2 : boost, boost * (colors.paper ? 1.4 : 0.9), colors.paper ? 0.32 : 1.3, colors.paper ? [0.28, 0.29, 0.33] : colors.tint, colors.paper ? 1 : 0);
    else {
      ctx.drawImage(board.cv, 0, 0, w, h);
      if (st.view === "flow" && flowLayer) ctx.drawImage(flowLayer.cv, 0, 0, w, h);
      else ctx.drawImage(exposure.cv, 0, 0, w, h);
    }
    const fdt = Math.min((performance.now() - (lastDraw || performance.now())) / 1000, 0.1);
    lastDraw = performance.now();
    drawLook(ctx);
    drawWalls(ctx, reduced.matches ? 1 : 1 - Math.exp(-fdt * 12));
    // the piles: each bead one decision, stacked outward from the wall at the row it was made;
    // once the biggest pile reaches the edge, all piles shrink together so their shapes compare
    const bead = Math.min(5.5, Math.max(2.6, sy * 0.9));
    const perBin = Math.max(1, Math.floor((BIN * sy) / bead));
    const bins = Math.ceil(SHOW / BIN);
    const wallAt = (g, side) => X(side * (Math.min(effectiveWall(st.walls, Math.min(g * BIN + BIN / 2, st.walls.length - 2)), K_SPAN) + 0.5));
    let scale = 1;
    for (let g = 0; g < bins; g++) {
      for (const [pile, side] of [[st.piles.right, 1], [st.piles.left, -1]]) {
        if (!pile[g]) continue;
        const wx = wallAt(g, side), space = side > 0 ? geo.right - wx - 6 : wx - geo.left - 6;
        const cap = Math.max(1, Math.floor(space / bead)) * perBin;
        scale = Math.min(scale, cap / pile[g]);
      }
    }
    const dimP = 1 - 0.65 * look.mix;
    for (const [pile, side, color, alpha] of [[st.piles.right, 1, colors["print-ink"], 0.95 * dimP], [st.piles.left, -1, colors["print-dim"], 0.95 * dimP]]) {
      ctx.fillStyle = color; ctx.globalAlpha = alpha;
      for (let g = 0; g < bins; g++) {
        const c = pile[g];
        if (!c) continue;
        const wx = wallAt(g, side), count = Math.round(c * scale);
        const y0 = Y(g * BIN) + 2 + (BIN * sy - perBin * bead) / 2;
        for (let i = 0; i < count; i++) {
          const col = Math.floor(i / perBin), row = i % perBin;
          const x = side > 0 ? wx + 4 + col * bead : wx - 4 - (col + 1) * bead;
          ctx.fillRect(x, y0 + row * bead, bead - 0.9, bead - 0.9);
        }
      }
    }
    ctx.globalAlpha = 1;
    // what the math expects each pile to hold by now, given how long each ball has been falling:
    // a ghost the beads fill toward
    if (st.n >= 30 && st.cur) {
      const prefix = (arr) => { const c = new Float64Array(arr.length + 1); for (let n = 0; n < arr.length; n++) c[n + 1] = c[n] + arr[n]; return c; };
      const P = { 1: prefix(st.cur.right), [-1]: prefix(st.cur.left) };
      ctx.save();
      ctx.fillStyle = colors["print-ink"]; ctx.globalAlpha = 0.13 * dimP;
      for (const side of [1, -1]) {
        const C = P[side], last = C.length - 1;
        for (let g = 0; g < bins; g++) {
          const a = g * BIN, b = Math.min((g + 1) * BIN, SHOW, last);
          if (b <= a) continue;
          let exp = complete * (C[b] - C[a]);
          for (const born of recent) { const age = Math.floor(rowClock - born); if (age >= a) exp += C[Math.min(b, age + 1, last)] - C[a]; }
          const len = ((exp * scale) / perBin) * bead;
          if (len < 0.5) continue;
          const wx = wallAt(g, side), y0 = Y(g * BIN) + 2 + (BIN * sy - perBin * bead) / 2;
          ctx.fillRect(side > 0 ? wx + 4 : wx - 4 - len, y0, len, perBin * bead - 0.9);
        }
      }
      ctx.restore();
    }
    // beads on their way from the wall into the pile; they count once they land
    {
      const t = performance.now();
      ctx.fillStyle = colors["print-ink"];
      for (let i = arriving.length - 1; i >= 0; i--) {
        const a = arriving[i], u = (t - a.t) / 260;
        const g = Math.floor(a.n / BIN), pile = a.side > 0 ? st.piles.right : st.piles.left;
        if (u >= 1) { pile[g]++; arriving.splice(i, 1); continue; }
        const wx = wallAt(g, a.side), count = Math.round(pile[g] * scale);
        const col = Math.floor(count / perBin), row = count % perBin;
        const tx = a.side > 0 ? wx + 4 + col * bead : wx - 4 - (col + 1) * bead;
        const ty = Y(g * BIN) + 2 + (BIN * sy - perBin * bead) / 2 + row * bead;
        const e = 1 - (1 - u) ** 3, x0 = X(a.k), y0 = Y(a.n) + 2;
        ctx.globalAlpha = 0.9 * (1 - viewMix);
        ctx.fillRect(x0 + (tx - x0) * e, y0 + (ty - y0) * e - Math.sin(Math.PI * u) * 6, bead - 0.9, bead - 0.9);
      }
      ctx.globalAlpha = 1;
    }
    // a brief flash where each ball meets its wall (not in the exact view, which has no balls)
    const nowMs = performance.now(), ballAlpha = 1 - viewMix;
    ctx.save();
    ctx.globalCompositeOperation = colors.paper ? "source-over" : "lighter";
    ctx.globalAlpha = ballAlpha;
    if (colors.paper) { ctx.strokeStyle = colors["print-ink"]; ctx.lineWidth = 1.2; }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i], age = (nowMs - f.t) / 380;
      if (age >= 1) { flashes.splice(i, 1); continue; }
      const rr = 4 + 10 * age;
      ctx.globalAlpha = (colors.paper ? 0.5 : 0.55) * (1 - age) * ballAlpha;
      // on paper a decision leaves a ripple of ink; on the night print, a flash of light
      if (colors.paper) { ctx.beginPath(); ctx.arc(X(f.k), Y(f.n) + 2, rr * 0.6, 0, 2 * Math.PI); ctx.stroke(); }
      else ctx.drawImage(sprite, X(f.k) - rr, Y(f.n) + 2 - rr, 2 * rr, 2 * rr);
    }
    ctx.restore();
    // the balls in flight, with a soft glow
    const r = Math.min(3.2, Math.max(1.8, sy * 0.42));
    ctx.save();
    ctx.globalCompositeOperation = colors.paper ? "source-over" : "lighter";
    ctx.globalAlpha = ballAlpha;
    for (const b of st.balls) {
      if (b.n >= SHOW) continue;
      const f = b.f, x = X(b.pk + (b.k - b.pk) * Math.min(1, f * 1.4)), y = Y(b.n + f) + 2 - Math.sin(Math.PI * f) * Math.min(3, sy * 0.6);
      const rb = b.solo ? r * 1.7 : r;
      ctx.drawImage(sprite, x - rb * 3, y - rb * 3, rb * 6, rb * 6);
    }
    ctx.restore();
    if (st.later) {
      ctx.font = `600 ${geo.w < 600 ? 11 : 10.5}px ${getComputedStyle(root).fontFamily}`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = colors["print-dim"]; ctx.globalAlpha = ballAlpha;
      ctx.fillText(`${st.later.toLocaleString("en-US")} DECIDED BELOW THE BOARD`, X(0), geo.bottom + 11);
      ctx.globalAlpha = 1;
    }
    drawWalk(ctx);
    drawLookLabel(ctx);
    if (tallyDirty && performance.now() - tallyAt > 200) { tally(); tallyDirty = false; tallyAt = performance.now(); }
  }

  // reduced motion: one still exposure of a few hundred decisions
  function still() {
    resetRun();
    const pStep = pUp(st.mu);
    const segs = [];
    for (let i = 0; i < 600; i++) {
      const b = { k: 0, pk: 0, n: 0, f: 0 };
      exposure.ctx.strokeStyle = colors["print-ink"]; exposure.ctx.globalAlpha = 0.05; exposure.ctx.beginPath();
      while (!(b.n >= st.rows || Math.abs(b.k) >= st.walls[b.n])) {
        b.pk = b.k; b.k += rng.next() < pStep ? 1 : -1;
        if (b.n < SHOW) {
          if (glow) segs.push(geo.X(b.pk), geo.Y(b.n) + 2, geo.X(b.k), geo.Y(b.n + 1) + 2, TRAIL * 0.3);
          else { exposure.ctx.moveTo(geo.X(b.pk), geo.Y(b.n)); exposure.ctx.lineTo(geo.X(b.k), geo.Y(b.n + 1)); }
        }
        b.n++;
      }
      exposure.ctx.stroke();
      land(b);
    }
    if (glow) glow.segments(segs, TRAIL_W);
    exposure.ctx.globalAlpha = 1;
    tally(); draw();
  }

  // save the board as it is now, as a picture
  $("m-save").addEventListener("click", () => {
    const out = document.createElement("canvas");
    out.width = cv.width; out.height = cv.height;
    const octx = out.getContext("2d");
    if (glow) octx.drawImage(glowCv, 0, 0); else { octx.fillStyle = colors.print; octx.fillRect(0, 0, out.width, out.height); }
    octx.drawImage(cv, 0, 0);
    out.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `decision-machine-${st.sched}-${st.mode}.png`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  });

  // ------------------------------------------------------------ the walkthrough
  // One car at a time, explained from the ball on screen: every number in a caption comes from
  // that ball's own path and the walls in use (walkcopy.js; site/tools/check_site.mjs holds the
  // sentences to the board's math). Terms on the board and below it explain themselves on a tap.
  const WALK_RATE = 7; // readings a second while playing
  const walk = { on: false, stop: 0, ball: null, result: null, playing: false, hits: [] };
  const walkEl = $("m-walk"), walkStart = $("m-walk-start"), walkSayEl = $("m-walk-say"), walkTerm = $("m-walk-term"), walkExtra = $("m-walk-extra");
  const walkPlay = $("m-walk-play"), walkOne = $("m-walk-step"), walkNext = $("m-walk-next"), walkBack = $("m-walk-back");
  const stage = cv.closest(".machine-stage");
  function apply(set) {
    if (set.sched) st.sched = set.sched;
    if (set.s) Object.assign(st.s, set.s);
    if (set.mode) st.mode = set.mode;
    if (set.view) st.view = set.view;
    for (const [seg, v] of [[modeSeg, st.mode], [schedSeg, st.sched], [$("m-view"), st.view]]) {
      const input = seg.querySelector(`input[value="${v}"]`);
      if (input) input.checked = true;
    }
    $("m-yours-help").hidden = st.mode !== "yours";
    cv.style.touchAction = st.mode === "yours" || look.on ? "none" : "";
    syncDials(); solve();
  }
  const riseRow = () => (st.sched === "rises" ? Math.round(st.s.at / DT) : st.sched === "deadline" ? st.rows : null);
  const earlyLead = () => earlyLeadOf(st.ex, st.pm, st.costs, SHOW, riseRow() ?? Infinity);
  /** The walkthrough's car now: the wall is the one the board draws at its row; whether it
   * decides there is the machine's own test. */
  const wallAt = (n) => (n >= st.rows ? 0 : effectiveWall(st.walls, Math.min(n, st.walls.length - 2)));
  const ballNow = () => walk.ball && {
    n: walk.ball.n, k: walk.ball.k, mu: st.mu, wall: wallAt(walk.ball.n), deadline: st.sched === "deadline",
    decides: walk.ball.n >= st.rows || Math.abs(walk.ball.k) >= st.walls[walk.ball.n],
  };
  const STOPS = [
    { id: "question", title: "Left or right, and when?", say: () =>
      "Each ball is a driverless car closing on something in the road. It must swerve left or right, and it must choose before it gets there. In this simulation, left is always wrong, and right is always right. But the car doesn't know that; it only has its sensors." },
    { id: "readings", title: "One reading at a time", ball: true, say: () => {
      const b = ballNow();
      const lead = `Each row of pegs is one moment, and each peg one noisy reading: ${clearShare(st.mu)} of readings point to the clear side, so the ball drifts right, slowly, through a lot of noise. `;
      return lead + sayReadings(b);
    } },
    { id: "walls", title: "The bounds", ball: true, say: () => {
      const b = ballNow();
      return `The bounds are the car's rule: it swerves as soon as its readings reach one. ${b.n ? `This is row ${b.n}. ` : ""}${sayWall(b)}`;
    } },
    { id: "decision", title: "The decision", ball: true, say: () => {
      if (!walk.result) return "This car hasn't decided yet. Press Play to watch it reach a bound.";
      return sayOutcome(walk.result) + " Another car gets new readings and may end differently.";
    } },
    { id: "cost", title: "What waiting costs", say: () => {
      const c0 = st.s.c0.toFixed(st.s.c0 < 0.1 ? 3 : 2);
      if (st.sched === "rises") return `Every moment spent looking costs points: ${c0} per time unit at first. Past the dashed line at t = ${st.s.at.toFixed(2)}, only a hard swerve still works, so each moment costs ${Math.round(st.s.factor)} times as much; the shading shows how high the cost is. Under Adjust the machine, Cost of time also has Deadline (a last moment to swerve at all) and Constant (every moment costs the same).`;
      if (st.sched === "deadline") return `Every moment spent looking costs ${c0} points per time unit, and at the dashed line, t = ${st.s.at.toFixed(2)}, time is up: past it a swerve can't clear the obstacle, so the car must have chosen. Rises and Constant are the other two costs of time, under Adjust the machine.`;
      return `Every moment spent looking costs the same, ${c0} points per time unit. Rises and Deadline, under Adjust the machine, make time more expensive later.`;
    } },
    { id: "early", title: "Why the best bounds close early", say: () => {
      const gap = (100 * (st.score.exact.reward - st.score.pm.reward)).toFixed(2);
      if (st.sched === "constant") {
        const exact = Math.abs(st.score.exact.reward - st.score.pm.reward) < 5e-5;
        return exact
          ? `With a steady cost, the best bounds are straight, and my 2025 rule, which sets each moment's bounds from that moment's cost, finds them exactly: it gives up ${gap} points per 100 decisions. Choose Rises to see them part.`
          : `With a steady cost, my 2025 rule, which sets each moment's bounds from that moment's cost, finds the best bounds almost exactly: it gives up ${gap} points per 100 decisions, only because this board forces a choice at 15 time units. Choose Rises to see them part.`;
      }
      const e = earlyLead(), when = st.sched === "deadline" ? "a tenth of a time unit or more before the deadline" : "while the cost is still within 1% of where it started";
      const lead = e.d > 0 ? ` By t = ${(e.n * DT).toFixed(2)}, ${when}, the best bounds are already ${e.d} peg${e.d === 1 ? "" : "s"} lower than the rule's.` : "";
      return `The best bounds are solved backward from the end, which takes into account that ${st.sched === "deadline" ? "time will run out" : "the cost will rise"}, so they start falling early.${lead} My 2025 rule (dashed) sets each moment's bounds from that moment's cost alone, so they stay level until the cost changes. Here it gives up ${gap} points per 100 decisions.`;
    } },
    { id: "yours", title: "Your own bounds", say: () =>
      "Choose Yours under Bounds and draw them: drag down the board, and each row's bound goes where your finger passes. The scores tell you, exactly, whether you beat my 2025 rule." },
    { id: "look", title: "How far ahead to look", enter: () => setLook(true, true, Math.max(0.1, (riseRow() ?? 40) * DT - 0.3), 2200), leave: () => setLook(false), say: () => {
      const d = look.data;
      if (!d) return "The light shows how much each later moment counts for the bound at the ring.";
      const w = colorWord("wb");
      return `The ${w} light starts at the ring, t = ${(d.n0 * DT).toFixed(2)}, and shows how much each later moment counts for the best bound there. On average it reaches ${d.mean.toFixed(2)} time units ahead. The ${w} diamond, ${d.rule.toFixed(1)} pegs out, is my 2025 rule's bounds averaged under that light, with the weights taken at the diamond's own level: the paper's look-ahead rule. The best bound is at ${d.level}. Drag on the board to move the ring.`;
    } },
    { id: "many", title: "Thousands at once", say: () =>
      `One car is a story; a score needs many. Pour sends 5,000 cars: each bead is one decision, stacked at the time it was made, and the faint ghosts are what the math expects by now. Every path, exactly, shows the share of all cars through each peg, computed rather than sampled. The scores are exact for this board: ${(100 * st.score.exact.reward).toFixed(1)} points per 100 decisions with the best bounds, ${(100 * st.score.pm.reward).toFixed(1)} with my 2025 rule.` },
  ];
  const TERMS = {
    walls: "How sure the car must be before it swerves. A ball that reaches a bound decides, for that side.",
    best: "The best bounds for this cost of time, solved exactly by working backward from the end.",
    pm: "My 2025 rule: at each moment, the best bound if the cost stayed what it is right then. It is exact when the cost never changes.",
    yours: "Bounds you draw: drag down the board, and each row's bound goes where you pass.",
    "score-best": "Points per 100 decisions with the best bounds, exact for this board.",
    "score-pm": "Points per 100 decisions with my 2025 rule's bounds, exact for this board.",
    gap: "How many points per 100 decisions my 2025 rule gives up against the best bounds.",
    points: "Each correct choice earns 1 point, and every moment spent looking costs the cost of time. The scores are worked out exactly, not counted from the balls.",
    pour: "Drops 5,000 cars at once, so the piles fill toward what the math expects.",
    look: "Shows, for one moment, how much each later moment counts for the bound there: the paper's look-ahead weights, on this board.",
    tilt: "Tilt the phone to make the evidence stronger or weaker; the bounds are solved again for each strength.",
    show: "Balls draws cars one at a time; Every path, exactly, draws where all of them go.",
    balls: "Cars one at a time, each with its own random readings: what a real run looks like.",
    flow: "The share of all cars through each peg, computed rather than sampled: what infinitely many balls would trace.",
    cost: "What each moment of looking costs, in points per time unit.",
    rises: "Past a known point only a hard swerve still works, so each moment of doubt costs more from then on.",
    deadline: "There is a last moment to swerve at all; past it, the car must already have chosen.",
    constant: "Every moment of doubt costs the same. With a steady cost, my 2025 rule is the best rule (on this board, up to its 15-unit limit).",
    at: "The moment the cost rises, or the deadline, in time units.",
    factor: "How many times more each moment costs after the rise.",
    mu: "How strong the evidence is: how much more often each reading points toward the truth than away from it. Tilting the board changes it too.",
    c0: "What a moment costs before any rise, in points per time unit.",
    n: "How many cars have decided so far.",
    correct: "The share of decided cars that chose the clear side, beside what the math expects for those cars.",
    time: "The mean time to decide, in time units.",
    "right-label": "Swerved right, to the clear side. On this board the right is always clear; the car doesn't know that.",
    "left-label": "Swerved left, into the obstacle: the readings' noise fooled it.",
    "time-scale": "Time runs down the board in units of σ²/μ², how long the evidence takes to stand out from its noise. Each row is 0.01.",
    "cost-line": "Where the cost of time rises, or the deadline. Drag it up or down; the shading shows how high the cost is.",
    "pile-right": "Each bead is one car that swerved right, stacked at the time it chose. The faint ghost is what the math expects by now.",
    "pile-left": "Each bead is one car that swerved into the obstacle, stacked at the time it chose. The faint ghost is what the math expects by now.",
    diamond: "The look-ahead rule's bound at this moment: my 2025 rule's bounds averaged under the light, with the weights taken at the diamond's own level.",
    light: "How much each later moment counts for the bound at the ring.",
    board: "Each row of pegs is one moment; at each peg the car takes one noisy reading, which nudges it left or right.",
  };
  const NAMES = { "score-best": "Best bounds", "score-pm": "2025 rule", gap: "The rule gives up", "right-label": "Chose right, correct", "left-label": "Chose left, wrong", "time-scale": "Time", "cost-line": "The dashed line", "pile-right": "The right pile", "pile-left": "The left pile", diamond: "The diamond", light: "The light", board: "A peg", points: "Points" };
  function showTerm(key, el) {
    if (!TERMS[key]) return;
    const name = NAMES[key] || (el && el.textContent.trim()) || key;
    walkTerm.textContent = `${name}: ${TERMS[key]}`;
    walkTerm.hidden = false;
  }
  root.addEventListener("click", (e) => {
    if (!walk.on) return;
    const el = e.target.closest("[data-term]");
    if (el && root.contains(el)) showTerm(el.dataset.term, el);
  });
  /** The term under a tap on the board, from what the board drew there. */
  function termAt(x, y) {
    for (const h of walk.hits) if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) return h.term;
    if (y < geo.top - 6) return x > geo.cx ? "right-label" : "left-label";
    if (x < geo.left) return "time-scale";
    if (SCHEDULES[st.sched].handle && Math.abs(y - geo.Y(st.s.at / DT)) < 9) return "cost-line";
    const row = Math.min(Math.max(Math.round(geo.Yinv(y)), 0), st.walls.length - 2), wx = Math.abs(geo.Xinv(x));
    if (wx > effectiveWall(st.walls, row) + 0.6) return x > geo.cx ? "pile-right" : "pile-left";
    return "board";
  }
  cv.addEventListener("pointerdown", (e) => {
    if (!walk.on || st.mode === "yours" || look.on || !geo) return;
    showTerm(termAt(e.offsetX, e.offsetY));
  });

  function newBall() {
    walk.ball = { k: 0, pk: 0, n: 0, f: 0, path: [0] };
    walk.result = null;
    setPlaying(false);
  }
  function walkAdvance() {
    const b = walk.ball;
    if (!b || walk.result) return;
    if (b.n >= st.rows || Math.abs(b.k) >= st.walls[b.n]) { walkFinish(); return; }
    b.pk = b.k;
    b.k += rng.next() < pUp(st.mu) ? 1 : -1;
    b.path.push(b.k);
    if (glow && b.n < SHOW) glow.segments([geo.X(b.pk), geo.Y(b.n) + 2, geo.X(b.k), geo.Y(b.n + 1) + 2, TRAIL * 6], TRAIL_W);
    b.n++;
    if (b.n >= st.rows || Math.abs(b.k) >= st.walls[b.n]) walkFinish();
    else walkSay();
  }
  function walkFinish() {
    const b = walk.ball;
    const forced = b.n >= st.rows ? (st.sched === "deadline" ? "deadline" : "limit") : st.walls[b.n] === 0 ? (st.sched === "deadline" ? "deadline" : "cost") : false;
    b.correct = b.k > 0 || (b.k === 0 && rng.next() < 0.5);
    walk.result = { n: b.n, k: b.k, mu: st.mu, correct: b.correct, forced, spent: spentBy(st.costs, b.n), below: b.n >= SHOW };
    land(b);
    setPlaying(false);
    if (STOPS[walk.stop].id === "readings" || STOPS[walk.stop].id === "walls") goStop(STOPS.findIndex((s) => s.id === "decision"));
    else walkSay();
  }
  function walkStep(dt) {
    if (glow) glow.fade(Math.exp(-dt * (performance.now() < pourGlowUntil ? 0.18 : TRAIL_FADE * 0.35)));
    const b = walk.ball;
    if (!b || walk.result || !walk.playing) return;
    b.f += dt * WALK_RATE;
    while (b.f >= 1 && !walk.result) { b.f -= 1; walkAdvance(); }
  }
  function setPlaying(on) {
    walk.playing = on && Boolean(walk.ball) && !walk.result;
    walkPlay.setAttribute("aria-pressed", String(walk.playing));
    walkPlay.textContent = walk.playing ? "Pause" : "Play";
    const ballStop = Boolean(STOPS[walk.stop] && STOPS[walk.stop].ball);
    // once this car has decided, only "Another car" is left to press
    walkPlay.hidden = walkOne.hidden = !ballStop || !walk.ball || Boolean(walk.result);
    walkOne.disabled = walk.playing;
    if (walk.playing && reduced.matches) { while (!walk.result) walkAdvance(); draw(); }
    wake();
  }
  function walkSay() {
    const s = STOPS[walk.stop];
    walkSayEl.textContent = s.say();
  }
  function goStop(i) {
    const prev = STOPS[walk.stop];
    if (prev && prev.leave && i !== walk.stop) prev.leave();
    walk.stop = Math.min(Math.max(i, 0), STOPS.length - 1);
    const s = STOPS[walk.stop];
    $("m-walk-count").textContent = `${walk.stop + 1} of ${STOPS.length}`;
    $("m-walk-title").textContent = s.title;
    walkTerm.hidden = true;
    walkBack.disabled = walk.stop === 0;
    walkNext.textContent = walk.stop === STOPS.length - 1 ? "Finish" : "Next";
    if (s.ball && (!walk.ball || (walk.result && s.id === "readings"))) newBall();
    else setPlaying(walk.playing);
    if (s.id === "readings" && walk.ball && !walk.result && walk.ball.n === 0 && !reduced.matches) setPlaying(true);
    if (s.enter) s.enter();
    extras(s.id);
    walkSay();
    draw();
  }
  function extras(id) {
    walkExtra.replaceChildren();
    const btn = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn btn-quiet"; b.textContent = label; b.addEventListener("click", fn); walkExtra.append(b); return b; };
    if (id === "readings" || id === "walls" || id === "decision") btn("Another car", () => { newBall(); if (id !== "decision") setPlaying(true); walkSay(); draw(); });
    if (id === "cost") for (const v of ["rises", "deadline", "constant"]) {
      const b = btn(v === "rises" ? "Rises" : v === "deadline" ? "Deadline" : "Constant", () => { apply({ sched: v }); walkSay(); for (const o of walkExtra.children) o.setAttribute("aria-pressed", String(o === b)); });
      b.setAttribute("aria-pressed", String(st.sched === v));
    }
    if (id === "early") btn(st.mode === "pm" ? "Show the best bounds" : "Show my 2025 rule", (e) => { apply({ mode: st.mode === "pm" ? "exact" : "pm" }); e.currentTarget.textContent = st.mode === "pm" ? "Show the best bounds" : "Show my 2025 rule"; walkSay(); });
    if (id === "many") {
      btn("Pour 5,000", () => { pourLeft = 5000; pourGlowUntil = performance.now() + 6000; wake(); });
      const f = btn("Every path, exactly", () => { apply({ view: st.view === "flow" ? "balls" : "flow" }); f.setAttribute("aria-pressed", String(st.view === "flow")); });
      f.setAttribute("aria-pressed", String(st.view === "flow"));
    }
  }
  function startWalk() {
    walk.on = true;
    if (paused) setPaused(false);
    stage.classList.add("walking");
    root.classList.add("walking");
    walkEl.hidden = false;
    walkStart.hidden = true;
    lookHelp.hidden = true;
    if (look.on) setLook(false);
    setMu(1, true);
    apply({ sched: "rises", s: { c0: 0.1, factor: 16, at: 0.6 }, mode: "exact", view: "balls" });
    walk.ball = null; walk.result = null;
    goStop(0);
    // on a phone the board shortens so it and the caption under it fit one screen; bring both up
    if (!matchMedia("(min-width: 900px)").matches) stage.scrollIntoView({ block: "start", behavior: reduced.matches ? "auto" : "smooth" });
  }
  function endWalk() {
    const s = STOPS[walk.stop];
    if (s && s.leave) s.leave();
    walk.on = false; walk.ball = null; walk.result = null; walk.playing = false;
    stage.classList.remove("walking");
    root.classList.remove("walking");
    walkEl.hidden = true;
    walkStart.hidden = false;
    resetRun();
    restartRamp();
    wake();
    walkStart.focus();
  }
  walkStart.addEventListener("click", startWalk);
  $("m-walk-done").addEventListener("click", endWalk);
  walkNext.addEventListener("click", () => { if (walk.stop === STOPS.length - 1) endWalk(); else goStop(walk.stop + 1); });
  walkBack.addEventListener("click", () => goStop(walk.stop - 1));
  walkPlay.addEventListener("click", () => setPlaying(!walk.playing));
  walkOne.addEventListener("click", () => { setPlaying(false); walkAdvance(); draw(); });
  walkEl.addEventListener("keydown", (e) => {
    if (e.target.closest("button, input, textarea")) return;
    if (e.key === "ArrowRight") { e.preventDefault(); walkNext.click(); }
    else if (e.key === "ArrowLeft" && walk.stop > 0) { e.preventDefault(); walkBack.click(); }
  });
  /** The walkthrough's marks on the board: the ball's path and readout, the wall it is up against. */
  /** Where the walkthrough's ball is drawn and how sure it is, beside it (null when no ball shows). */
  function ballTag(ctx) {
    const b = walk.ball;
    if (!walk.on || !b || b.n >= SHOW || !["readings", "walls", "decision"].includes(STOPS[walk.stop].id)) return null;
    const { X, Y } = geo, x = X(b.k);
    // partway to the next peg, in time with the play
    const y = (!walk.result && walk.playing ? Y(b.n + Math.min(b.f, 1)) : Y(b.n)) + 2;
    const txt = b.k === 0 ? "50%" : `${pctText(sureOf(b.k, st.mu))} ${b.k > 0 ? "RIGHT" : "LEFT"}`;
    // on the side it leans to, unless that would cross the wall drawn there: then on the inside
    const tw = ctx.measureText(txt).width, wall = shown.cur?.[Math.min(b.n, shown.cur.length - 1)];
    let right = b.k >= 0;
    if (wall !== undefined) {
      if (right && x + 12 + tw + 4 > X(wall) - 2 && x - 12 - tw - 4 > X(-wall) + 2) right = false;
      else if (!right && x - 12 - tw - 4 < X(-wall) + 2 && x + 12 + tw + 4 < X(wall) - 2) right = true;
    }
    return { txt, x, y, tw, tx: x + (right ? 12 : -12), ty: y - 14, align: right ? "left" : "right" };
  }
  function drawWalk(ctx) {
    walk.hits = [];
    if (!walk.on) return;
    const { X, Y } = geo, id = STOPS[walk.stop].id;
    ctx.save();
    ctx.font = `700 ${geo.w < 600 ? 11 : 10.5}px ${getComputedStyle(root).fontFamily}`;
    ctx.textBaseline = "middle";
    const tag = (txt, x, y, color, align, term) => {
      ctx.textAlign = align;
      const tw = ctx.measureText(txt).width, x0 = align === "right" ? x - tw : align === "center" ? x - tw / 2 : x;
      ctx.fillStyle = colors.print; ctx.globalAlpha = 0.92; ctx.fillRect(x0 - 4, y - 9, tw + 8, 18);
      ctx.globalAlpha = 1; ctx.fillStyle = color; ctx.fillText(txt, x, y);
      if (term) walk.hits.push({ x0: x0 - 4, x1: x0 + tw + 4, y0: y - 9, y1: y + 9, term });
    };
    if (id === "question") {
      // the two outcomes, underlined
      ctx.font = `600 ${geo.w < 600 ? 11 : 10.5}px ${getComputedStyle(root).fontFamily}`;
      const rw = ctx.measureText("CHOSE RIGHT, CORRECT →").width, lw = ctx.measureText("← CHOSE LEFT, WRONG").width;
      ctx.strokeStyle = colors["accent-print"]; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(geo.right - rw, 21); ctx.lineTo(geo.right, 21); ctx.moveTo(geo.left + 2, 21); ctx.lineTo(geo.left + 2 + lw, 21); ctx.stroke();
    }
    if (id === "cost" && SCHEDULES[st.sched].handle) {
      const y = Math.round(Y(st.s.at / DT)) + 0.5, a = reduced.matches ? 1 : 0.55 + 0.45 * Math.sin(performance.now() / 260);
      ctx.strokeStyle = colors["accent-print"]; ctx.lineWidth = 3; ctx.globalAlpha = a;
      ctx.beginPath(); ctx.moveTo(geo.left, y); ctx.lineTo(geo.right, y); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const b = walk.ball;
    if (b && (id === "readings" || id === "walls" || id === "decision")) {
      // the path so far, drawn plainly so it stays while the light fades
      ctx.strokeStyle = colors["print-ink"]; ctx.lineWidth = 1.8; ctx.lineJoin = "round"; ctx.globalAlpha = 0.95;
      ctx.beginPath();
      const last = Math.min(b.n, SHOW);
      for (let n = 0; n <= last; n++) { const x = X(b.path[n]), y = Y(n) + 2; if (n) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
      ctx.globalAlpha = 1;
      const t = ballTag(ctx);
      if (t) {
        const { x, y } = t, rb = Math.min(3.2, Math.max(1.8, geo.sy * 0.42)) * 2.1;
        ctx.globalCompositeOperation = colors.paper ? "source-over" : "lighter";
        ctx.drawImage(sprite, x - rb * 3, y - rb * 3, rb * 6, rb * 6);
        ctx.globalCompositeOperation = "source-over";
        // how sure it is, beside the ball
        tag(t.txt, t.tx, t.ty, colors["print-ink"], t.align);
        // the wall it's up against, at this row
        if (id === "walls" && !walk.result && b.n < st.walls.length) {
          const W = wallAt(b.n), s = b.k >= 0 ? 1 : -1, wx = X(s * (Math.min(W, K_SPAN) + 0.5));
          ctx.setLineDash([2, 3]); ctx.strokeStyle = colors["accent-print"]; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(x + s * 6, y); ctx.lineTo(wx, y); ctx.stroke(); ctx.setLineDash([]);
          if (W > 0) tag(`BOUND ${pctText(posterior(W, st.mu))}`, wx + s * 6, y + 14, colors["accent-print"], s > 0 ? "left" : "right", "walls");
        }
      }
    }
    if (id === "early") {
      const e = earlyLead();
      if (e.d > 0) {
        const y = Y(e.n) + 2, x0 = X(effectiveWall(st.ex, e.n) + 0.5), x1 = X(effectiveWall(st.pm, e.n) + 0.5);
        ctx.strokeStyle = colors["accent-print"]; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x0, y - 5); ctx.lineTo(x0, y + 5); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.moveTo(x1, y - 5); ctx.lineTo(x1, y + 5); ctx.stroke();
        tag(`${e.d} PEG${e.d === 1 ? "" : "S"} INSIDE`, (x0 + x1) / 2, y - 14, colors["accent-print"], "center", "best");
      }
    }
    ctx.restore();
  }

  new IntersectionObserver((es) => { st.visible = es[0].isIntersecting; if (st.visible) wake(); }, { threshold: 0.02 }).observe(cv);
  document.addEventListener("visibilitychange", wake);
  new ResizeObserver(() => { resize(); if (reduced.matches) still(); else draw(); }).observe(cv);
  syncDials();
  resize();
  solve();
}
