// The first print: one decision at a time, with the dots and the evidence on one clock. The dots
// are drawn from the trial's own evidence (see stimulus.js), the strip plots that evidence in log
// odds, and the bars under it show each frame's net dot motion. Units are seconds and log odds.
import { Rng, freshSeed, dotSeed } from "./rng.js";
import { Trial, DotField, dotsPerUnit, driftFor, boundFromLogOdds, logOddsFromBound, expected, bestFor, COHERENCES, DOTS_PER_SD } from "./stimulus.js";
import { meanTime, belief } from "./model.js";

const PLAY = 2.4;           // seconds of screen time for the strip's full width
const KEEP = 14;            // finished traces left on the strip
const KEEP_BATCH = 60;
const L_MIN = 0.2, L_MAX = 6.9;
const PAUSE = 900;          // ms between autoplayed trials
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const $ = (id) => document.getElementById(id);

const costFromSlider = (v) => 0.05 * 100 ** (v / 100);
const pct = (p, d = 1) => `${(100 * p).toFixed(d)}%`;
const secs = (t) => (t < 1 ? `${Math.round(t * 1000)} ms` : `${t.toFixed(2)} s`);

export function initRace() {
  const root = $("race");
  if (!root) return;
  const dotsCv = $("dots"), strip = $("strip");
  const ui = { bound: $("bound"), cost: $("cost"), one: $("run-one"), many: $("run-many"), best: $("use-best"), tint: $("tint") };
  const params = new URLSearchParams(location.search);
  const seed = Number.parseInt(params.get("seed"), 10) >>> 0 || freshSeed();
  const rng = new Rng(seed);
  $("race-seed").textContent = String(seed);

  const st = {
    ci: 1, mu: driftFor(COHERENCES[1]), c: costFromSlider(+ui.cost.value), L: 3, Lbest: 3, tmax: 1,
    frameDt: 0.01, traces: [], rts: [], live: null, bars: [], n: 0, correct: 0, time: 0,
    mode: "auto", batchLeft: 0, nextAt: 0, visible: false, tint: false, lastDone: null, handle: null,
  };
  const field = new DotField({ rng: new Rng(dotSeed(seed)) });

  // ------------------------------------------------------------ settings
  const seg = $("coh");
  const row = document.createElement("div");
  row.className = "seg-row";
  COHERENCES.forEach((C, i) => {
    const lab = document.createElement("label");
    lab.innerHTML = `<input type="radio" name="coh" value="${i}"${i === st.ci ? " checked" : ""}><span>${(C * 100).toFixed(1)}%</span>`;
    row.append(lab);
  });
  seg.append(row);

  function settings({ keepL = true } = {}) {
    st.mu = driftFor(COHERENCES[st.ci]);
    st.c = costFromSlider(+ui.cost.value);
    st.Lbest = logOddsFromBound(bestFor(st.mu, st.c), st.mu);
    if (!keepL) st.L = st.Lbest;
    st.L = Math.min(Math.max(st.L, L_MIN), L_MAX);
    ui.bound.value = Math.round(((st.L - L_MIN) / (L_MAX - L_MIN)) * 1000);
    st.tmax = Math.min(Math.max(2.5 * meanTime(boundFromLogOdds(st.Lbest, st.mu), st.mu), 0.1), 12);
    st.frameDt = st.tmax / (PLAY * 60);
    $("bound-out").textContent = `${pct(belief(boundFromLogOdds(st.L, st.mu), st.mu))} sure`;
    const speed = st.tmax / PLAY;
    $("race-speed").textContent = speed < 1 ? `${speed.toFixed(2)}× real speed, slowed down` : `${speed.toFixed(1)}× real speed, sped up`;
    $("cost-out").textContent = `${st.c.toFixed(st.c < 0.1 ? 3 : 2)} per second`;
  }
  function resetTally() {
    st.n = 0; st.correct = 0; st.time = 0; st.traces = []; st.rts = []; st.lastDone = null;
    tally();
  }
  function tally() {
    const b = boundFromLogOdds(st.L, st.mu), e = expected(b, st.mu, st.c), best = expected(boundFromLogOdds(st.Lbest, st.mu), st.mu, st.c);
    $("t-n").textContent = st.n.toLocaleString("en-US");
    $("t-p").textContent = st.n ? pct(st.correct / st.n) : "–";
    $("t-t").textContent = st.n ? secs(st.time / st.n) : "–";
    $("t-r").textContent = st.n ? (100 * (st.correct / st.n - (st.c * st.time) / st.n)).toFixed(1) : "–";
    $("t-pe").textContent = `expected ${pct(e.p)}`;
    $("t-te").textContent = `expected ${secs(e.t)}`;
    $("t-re").textContent = `expected ${e.points.toFixed(1)}, best ${best.points.toFixed(1)}`;
  }
  function userTurn() {
    if (st.mode === "auto") { st.mode = "idle"; st.live = null; st.bars = []; resetTally(); }
  }

  seg.addEventListener("change", (e) => {
    userTurn();
    st.ci = +e.target.value;
    settings({ keepL: false });
    resetTally(); draw();
  });
  ui.cost.addEventListener("input", () => { userTurn(); settings(); resetTally(); draw(); });
  ui.bound.addEventListener("input", () => {
    userTurn();
    st.L = L_MIN + (+ui.bound.value / 1000) * (L_MAX - L_MIN);
    settings(); resetTally(); draw();
  });
  ui.best.addEventListener("click", () => { userTurn(); settings({ keepL: false }); resetTally(); draw(); });
  ui.tint.addEventListener("click", () => {
    st.tint = !st.tint;
    ui.tint.setAttribute("aria-pressed", String(st.tint));
    paintDots();
  });
  ui.one.addEventListener("click", () => { userTurn(); st.mode = "one"; startTrial(); });
  ui.many.addEventListener("click", () => {
    userTurn();
    st.mode = "batch"; st.batchLeft = 200;
    if (!st.live) startTrial();
  });

  // ------------------------------------------------------------ trials
  function startTrial() {
    const b = boundFromLogOdds(st.L, st.mu);
    st.live = { tr: new Trial({ mu: st.mu, b, rng }), pts: [[0, 0]], bars: [] };
    field.reset(dotsPerUnit(st.frameDt));
    st.bars = st.live.bars;
    $("r-trial").textContent = String(st.n + 1);
    $("r-choice").textContent = "–";
  }
  /** One frame of the live trial: the evidence moves on, and the dots show the change. */
  function stepFrame() {
    const lv = st.live, tr = lv.tr;
    const t0 = tr.t;
    tr.advance(t0 + st.frameDt);
    const f = field.frame(tr.x);
    lv.bars.push([0.5 * (t0 + tr.t), f.net]);
    lv.pts.push([tr.t, logOddsFromBound(tr.x, st.mu)]);
    if (tr.done) finishTrial();
  }
  function finishTrial() {
    const tr = st.live.tr;
    st.n++; st.time += tr.t; if (tr.correct) st.correct++;
    st.rts.push([tr.t, tr.correct]);
    const done = { pts: st.live.pts, t: tr.t, choice: tr.choice, ok: tr.correct, L: st.L };
    st.traces.push(done);
    const keep = st.mode === "batch" ? KEEP_BATCH : KEEP;
    if (st.traces.length > keep) st.traces.splice(0, st.traces.length - keep);
    st.lastDone = done;
    st.live = null;
    const word = tr.choice > 0 ? "Right" : "Left";
    $("r-choice").innerHTML = `${word}${markSvg(tr.correct)}<span class="r-ok">${tr.correct ? "correct" : "wrong"}</span>`;
    tally();
  }
  const markSvg = (ok) => ok
    ? `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>`
    : `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>`;

  // frames advance with elapsed time, 60 to a second, whatever the display's refresh rate
  const FRAME_MS = 1000 / 60;
  let acc = 0, lastNow = 0;
  function tick(now) {
    raf = 0;
    if (!st.visible || document.hidden) { lastNow = 0; return; }
    acc += lastNow ? Math.min(now - lastNow, 100) : FRAME_MS;
    lastNow = now;
    const due = Math.floor(acc / FRAME_MS);
    acc -= due * FRAME_MS;
    if (st.live && due > 0) {
      if (st.mode === "batch") {
        // speed up as the batch goes: the first trials play at full length, later ones in a few frames
        const done = 200 - st.batchLeft;
        const frames = due * (done < 3 ? 1 : Math.min(48, Math.ceil(1.5 ** (done - 2))));
        for (let k = 0; k < frames && st.live; k++) stepFrame();
        if (!st.live) {
          st.batchLeft--;
          if (st.batchLeft > 0) startTrial(); else st.mode = "idle";
        }
      } else {
        for (let k = 0; k < Math.min(due, 4) && st.live; k++) stepFrame();
        if (!st.live && st.mode === "auto") st.nextAt = now + PAUSE;
        if (!st.live && st.mode === "one") st.mode = "idle";
      }
    } else if (st.mode === "auto" && now >= st.nextAt && !reduced.matches) {
      if (st.n >= 30) resetTally();
      startTrial();
    }
    if (st.live) $("r-clock").textContent = `${st.live.tr.t.toFixed(3)} s`;
    else if (st.lastDone) $("r-clock").textContent = `${st.lastDone.t.toFixed(3)} s`;
    if (st.live) {
      const p = belief(st.live.tr.x, st.mu);
      $("r-lean").textContent = p >= 0.5 ? `${pct(p, 0)} right` : `${pct(1 - p, 0)} left`;
    }
    draw();
    paintDots();
    if (st.live || st.mode === "auto") raf = requestAnimationFrame(tick); else lastNow = 0;
  }
  let raf = 0;
  const wake = () => { if (!raf && st.visible) raf = requestAnimationFrame(tick); };
  // reduced motion: a trial is decided at once, without playing it
  function runInstant() {
    while (st.live) stepFrame();
    if (st.mode === "batch") {
      while (--st.batchLeft > 0) { startTrial(); while (st.live) stepFrame(); }
      st.mode = "idle";
    }
    if (st.lastDone) $("r-clock").textContent = `${st.lastDone.t.toFixed(3)} s`;
    draw(); paintDots();
  }
  for (const b of [ui.one, ui.many]) b.addEventListener("click", () => (reduced.matches ? runInstant() : wake()));

  new IntersectionObserver((es) => {
    st.visible = es[0].isIntersecting;
    if (st.visible) wake();
  }, { threshold: 0.05 }).observe(root);
  document.addEventListener("visibilitychange", wake);

  // ------------------------------------------------------------ drawing
  let colors = {};
  const readColors = () => {
    const cs = getComputedStyle(root);
    for (const k of ["print", "print-2", "print-line", "print-ink", "print-dim", "accent-print", "right", "left"]) colors[k] = cs.getPropertyValue(`--${k}`).trim();
  };
  readColors();
  document.addEventListener("appearance:change", () => { readColors(); draw(); paintDots(); });

  function fit(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function paintDots() {
    const { ctx, w } = fit(dotsCv);
    const R = w / 2;
    ctx.clearRect(0, 0, w, w);
    ctx.fillStyle = colors["print-2"];
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = colors["print-line"]; ctx.lineWidth = 1; ctx.stroke();
    const r = Math.max(1.3, w / 120), inner = R - 6;
    const groups = st.tint
      ? [[0, colors["print-dim"], 0.55], [1, colors.right, 1], [-1, colors.left, 1]]
      : [[null, colors["print-ink"], 1]];
    for (const [d, color, alpha] of groups) {
      ctx.fillStyle = color; ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (const dot of field.dots) {
        if (d !== null && dot.d !== d) continue;
        const x = R + dot.x * inner, y = R + dot.y * inner;
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 2 * Math.PI);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  let geo = null;
  function draw() {
    const { ctx, w, h } = fit(strip);
    const padL = 34, padR = 12, padT = 22, scaleH = 22, barH = Math.min(38, h * 0.14), histH = Math.min(40, h * 0.14);
    const left = padL, right = w - padR, top = padT, bottom = h - scaleH;
    const histMid = bottom - 4 - histH / 2, barMid = histMid - histH / 2 - 18 - barH / 2;
    const mainBottom = barMid - barH / 2 - 22;
    const Ymax = Math.max(Math.ceil(1.22 * Math.max(st.L, st.Lbest)), 2);
    const X = (t) => left + (Math.min(t, st.tmax) / st.tmax) * (right - left);
    const Y = (L) => top + ((Ymax - L) / (2 * Ymax)) * (mainBottom - top);
    geo = { Y, Yinv: (y) => Ymax - ((y - top) / (mainBottom - top)) * 2 * Ymax, right };
    ctx.clearRect(0, 0, w, h);
    const fam = getComputedStyle(root).fontFamily, fs = w < 600 ? 11 : 10.5;
    ctx.font = `600 ${fs}px ${fam}`;
    ctx.textBaseline = "middle";
    // labels sit on a knockout of the print's black, so lines never cut through them
    const lab = (str, x, y) => { ctx.save(); ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.strokeStyle = colors.print; ctx.strokeText(str, x, y); ctx.restore(); ctx.fillText(str, x, y); };

    // grid in log odds
    const stepY = Ymax > 5 ? 2 : 1;
    ctx.lineWidth = 1;
    for (let v = -Ymax; v <= Ymax; v += stepY) {
      ctx.strokeStyle = v === 0 ? colors["print-dim"] : colors["print-line"];
      ctx.globalAlpha = v === 0 ? 0.6 : 0.7;
      ctx.beginPath(); ctx.moveTo(left, Y(v) + 0.5); ctx.lineTo(right, Y(v) + 0.5); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = colors["print-dim"]; ctx.textAlign = "right";
      lab(v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0", left - 6, Y(v));
    }
    ctx.textAlign = "left";
    ctx.fillStyle = colors["print-dim"];
    lab("EVIDENCE FOR RIGHT, LOG ODDS", left, 9);

    // best bound for this cost
    ctx.strokeStyle = colors["print-ink"]; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    for (const s of [1, -1]) { ctx.beginPath(); ctx.moveTo(left, Y(s * st.Lbest)); ctx.lineTo(right, Y(s * st.Lbest)); ctx.stroke(); }
    ctx.setLineDash([]);

    // old traces, then the live one
    const old = st.traces;
    ctx.lineJoin = "round";
    old.forEach((tr, i) => {
      ctx.strokeStyle = colors["print-ink"];
      ctx.globalAlpha = st.mode === "batch" || old.length > KEEP ? 0.14 : 0.12 + 0.3 * (i / old.length);
      ctx.lineWidth = 1.1;
      path(ctx, tr.pts, X, Y, Ymax);
    });
    ctx.globalAlpha = 1;
    for (const tr of old) if (tr.t <= st.tmax) mark(ctx, X(tr.t), Y(tr.choice * tr.L), tr.ok, tr === st.lastDone ? 1 : 0.45);
    if (st.live) {
      ctx.strokeStyle = colors["print-ink"]; ctx.lineWidth = 1.8;
      path(ctx, st.live.pts, X, Y, Ymax);
    }

    // your bound, in the accent, with its grip
    ctx.strokeStyle = colors["accent-print"]; ctx.lineWidth = 2;
    for (const s of [1, -1]) { ctx.beginPath(); ctx.moveTo(left, Y(s * st.L)); ctx.lineTo(right, Y(s * st.L)); ctx.stroke(); }
    ctx.fillStyle = colors["accent-print"];
    ctx.fillRect(right - 9, Y(st.L) - 9, 18, 18);
    ctx.fillRect(right - 9, Y(-st.L) - 9, 18, 18);
    ctx.textAlign = "right";
    lab("YOUR BOUNDS", right - 14, Y(st.L) - 10);
    ctx.fillStyle = colors["print-ink"];
    ctx.textAlign = "left";
    lab("BEST FOR THIS COST", left + 4, Y(st.Lbest) - 10);

    // the bars: each frame's net dot motion, right up and left down
    const bars = st.live ? st.live.bars : st.lastDone ? lastBars : [];
    if (st.live) lastBars = st.live.bars;
    const scale = (barH / 2 - 2) / (2.5 * DOTS_PER_SD);
    const bw = Math.max(1, ((right - left) * st.frameDt) / st.tmax - 0.5);
    for (const [t, net] of bars) {
      if (t > st.tmax || net === 0) continue;
      const hgt = Math.min(Math.abs(net) * scale, barH / 2 - 1);
      ctx.fillStyle = net > 0 ? colors.right : colors.left;
      ctx.fillRect(X(t) - bw / 2, net > 0 ? barMid - hgt : barMid, bw, hgt);
    }
    ctx.strokeStyle = colors["print-line"]; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(left, barMid + 0.5); ctx.lineTo(right, barMid + 0.5); ctx.stroke();
    ctx.fillStyle = colors["print-dim"]; ctx.textAlign = "left";
    lab("EACH FRAME: DOTS STEPPING RIGHT − LEFT", left, mainBottom + 13);

    // decision times so far: correct ones above the line, wrong ones below
    const NB = 36, up = new Array(NB).fill(0), dn = new Array(NB).fill(0);
    let later = 0;
    for (const [t, ok] of st.rts) { if (t > st.tmax) { later++; continue; } const k = Math.min(Math.floor((t / st.tmax) * NB), NB - 1); (ok ? up : dn)[k]++; }
    const top2 = Math.max(...up, ...dn, 1), hs = (histH / 2 - 2) / top2, colW = (right - left) / NB;
    ctx.fillStyle = colors["print-ink"];
    for (let k = 0; k < NB; k++) {
      if (up[k]) ctx.fillRect(left + k * colW + 0.5, histMid - up[k] * hs, colW - 1, up[k] * hs);
      if (dn[k]) ctx.fillRect(left + k * colW + 0.5, histMid, colW - 1, dn[k] * hs);
    }
    ctx.strokeStyle = colors["print-line"];
    ctx.beginPath(); ctx.moveTo(left, histMid + 0.5); ctx.lineTo(right, histMid + 0.5); ctx.stroke();
    ctx.fillStyle = colors["print-dim"]; ctx.textAlign = "left";
    const shown = st.rts.length - later;
    const count = st.rts.length ? ` (${shown}${later ? ` + ${later} LATER` : ""})` : "";
    lab(`DECISION TIMES${count}: ${w < 520 ? "CORRECT ↑ WRONG ↓" : "CORRECT ABOVE, WRONG BELOW"}`, left, histMid - histH / 2 - 7);

    // the timing scale
    ctx.fillStyle = colors["print-2"];
    ctx.fillRect(0, bottom, w, scaleH);
    const unit = niceStep(st.tmax / Math.max(3, Math.floor((right - left) / 70)));
    ctx.strokeStyle = colors["print-dim"]; ctx.fillStyle = colors["print-dim"]; ctx.textAlign = "center";
    for (let k = 0; k * unit / 5 <= st.tmax + 1e-9; k++) {
      const t = (k * unit) / 5, x = Math.round(X(t)) + 0.5, major = k % 5 === 0;
      ctx.beginPath(); ctx.moveTo(x, bottom); ctx.lineTo(x, bottom + (major ? 7 : 3)); ctx.stroke();
      if (major) ctx.fillText(k === 0 ? "0 s" : fmtT(t, unit), x + (k === 0 ? 8 : 0), bottom + 15);
    }

    // the reading: a hairline down from the last decision to its time on the scale
    const d = st.lastDone;
    if (d && d.t <= st.tmax) {
      ctx.save();
      if (st.live) ctx.globalAlpha = 0.4;
      const x = Math.round(X(d.t)) + 0.5;
      ctx.strokeStyle = colors["print-ink"]; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(d.choice * d.L)); ctx.lineTo(x, bottom); ctx.stroke();
      if (st.live) { ctx.restore(); return; } // while the next trial runs, keep only the faint line
      const label = `${d.t.toFixed(3)} s`;
      ctx.font = `700 ${fs + 0.5}px ${fam}`;
      const tw = ctx.measureText(label).width + 10;
      const bx = Math.min(Math.max(x - tw / 2, 2), w - tw - 2);
      ctx.fillStyle = colors["print-ink"]; ctx.fillRect(bx, bottom + 2, tw, scaleH - 4);
      ctx.fillStyle = colors.print; ctx.textAlign = "center"; ctx.fillText(label, bx + tw / 2, bottom + scaleH / 2);
      ctx.restore();
    }
  }
  let lastBars = [];
  function path(ctx, pts, X, Y, Ymax) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [t, L] = pts[i];
      const x = X(t), y = Y(Math.max(Math.min(L, Ymax), -Ymax));
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      if (t > st.tmax) break;
    }
    ctx.stroke();
  }
  function mark(ctx, x, y, ok, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha; ctx.strokeStyle = colors["print-ink"]; ctx.lineWidth = 2;
    ctx.beginPath();
    if (ok) { ctx.moveTo(x - 5, y - 1); ctx.lineTo(x - 1, y + 3); ctx.lineTo(x + 6, y - 6); }
    else { ctx.moveTo(x - 4.5, y - 4.5); ctx.lineTo(x + 4.5, y + 4.5); ctx.moveTo(x + 4.5, y - 4.5); ctx.lineTo(x - 4.5, y + 4.5); }
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------ dragging the bound on the strip
  let drag = null;
  const near = (e) => {
    if (!geo) return false;
    const r = strip.getBoundingClientRect(), y = e.clientY - r.top;
    return Math.min(Math.abs(y - geo.Y(st.L)), Math.abs(y - geo.Y(-st.L))) < (e.pointerType === "touch" ? 22 : 12);
  };
  strip.addEventListener("pointerdown", (e) => {
    if (!near(e)) return;
    e.preventDefault();
    drag = e.pointerId;
    strip.setPointerCapture(e.pointerId);
    strip.style.touchAction = "none";
    userTurn();
  });
  strip.addEventListener("pointermove", (e) => {
    if (drag === null) { strip.classList.toggle("grab", near(e)); return; }
    if (e.pointerId !== drag) return;
    const r = strip.getBoundingClientRect();
    st.L = Math.min(Math.max(Math.abs(geo.Yinv(e.clientY - r.top)), L_MIN), L_MAX);
    settings(); resetTally(); draw();
  });
  const end = (e) => { if (e.pointerId === drag) { drag = null; strip.style.touchAction = ""; } };
  strip.addEventListener("pointerup", end);
  strip.addEventListener("pointercancel", end);
  // on touch screens the strip scrolls the page; the grip at the bound's right end takes the drag
  strip.addEventListener("touchstart", (e) => { if (drag !== null) e.preventDefault(); }, { passive: false });

  new ResizeObserver(() => { draw(); paintDots(); }).observe(strip);
  settings({ keepL: false });
  tally();
  draw();
  paintDots();
  if (reduced.matches) st.mode = "idle";
}

function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x)), m = x / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
function fmtT(t, unit) {
  const d = unit >= 1 ? 0 : unit >= 0.1 ? 1 : unit >= 0.01 ? 2 : 3;
  return t.toFixed(d);
}
