// "Your turn": the reader drives the car against the three rules on the same readings
// (game-model.js). A round plays in real time on a 3D road in the car scene's look (play-scene.js):
// the readings land beside the player's car, the gauge shows how far they lean, and the cost of
// waiting runs along the bottom. After the player swerves, the three rules' cars drive the same
// road with the same readings, and the round's readings are drawn again with each rule's walls.
//
// The page never scrolls on its own: everything a round needs sits in the stage and the row of
// buttons under it, and the round's details appear below without moving what's on screen.
import { DT, posterior, effectiveWall } from "./lattice.js";
import { RULES, confidenceAt } from "./lanes.js";
import { Rng, freshSeed } from "./rng.js";
import { GAME, KINDS, kindOfRound, gameModels, gameNumbers, yourResult, playRound, glintSide } from "./game-model.js";
import { SIDE, SPEED, TRUCK, laneX } from "./play-scene.js";

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const KEYS = ["you", ...RULES.map((r) => r.key)];
const NAMES = { you: "You", ex: "Best bounds", pm: "2025 rule", wb: "Look-ahead rule" };
const SHORT = { you: "YOU", ex: "BEST", pm: "2025 RULE", wb: "LOOK-AHEAD" };
const SWERVE = 0.3;        // time units to move across
const KMAX = 18;           // the gauges' half-width, in readings
const LIFE = 2;            // seconds a lingering glint stays
// The glints linger as specks (the address can ask for quick flashes instead), and the pace and the
// tally can be set from the address too, for comparing.
const Q = new URLSearchParams(location.search);
const STYLE = Q.get("glints") === "flash" ? "flash" : "linger";
const clampPace = (v, d) => Math.min(Math.max(Number(v) || d, 2), 8);
/** Seconds of play per time unit on a road: the game's own, or the steady road's faster one. */
const paceOf = (kind) => (kind === "constant" ? clampPace(Q.get("steadyPace"), KINDS.constant.secondsPerUnit) : clampPace(Q.get("pace"), GAME.secondsPerUnit));
// also for comparing: play one road every round, and move the steady road's truck (in time units)
const ONLY = Object.hasOwn(KINDS, Q.get("road") || "") ? Q.get("road") : null;
const STEADY = Math.min(Math.max(Number(Q.get("steady")) || 0, 0), 8);

export function initGame() {
  const root = document.getElementById("play-game");
  if (!root) return;
  // the walls take a few hundred milliseconds to solve, so they wait until the page is idle
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
  idle(() => { try { run(root); } catch (e) { console.error(e); } }, { timeout: 2500 });
}

function run(root) {
  const $ = (sel) => root.querySelector(sel);
  if (STEADY >= 2) { KINDS.constant.end = STEADY; KINDS.constant.rows = Math.round(STEADY / DT); }
  const models = gameModels();
  const nums = gameNumbers(models);
  for (const el of document.querySelectorAll("[data-game-n]")) if (nums[el.dataset.gameN] != null) el.textContent = nums[el.dataset.gameN];
  const seed = (Number.parseInt(new URLSearchParams(location.search).get("seed"), 10) >>> 0) || freshSeed();
  const rng = new Rng(seed ^ 0x2545f491);

  const stage = $(".play-stage"), glCv = $(".play-gl"), hud = $(".play-hud");
  const ui = {
    round: $("#play-round"), kind: $("#play-kind"), story: $("#play-story"), say: $(".play-say"),
    start: $('[data-play="start"]'), left: $('[data-play="left"]'), right: $('[data-play="right"]'), next: $('[data-play="next"]'),
    result: $(".play-result"), chart: $(".play-chart"), table: $(".play-table tbody"), board: $(".play-board tbody"), boardN: $(".play-board-n"),
    over: $(".play-over"), again: $('[data-play="again"]'), tally: $('[data-play="tally"]'),
  };

  const st = {
    round: 0, phase: "ready", t: 0, last: 0, run: null, kind: null, you: null, swerveFrom: 0, tEnd: 0, visible: false,
    glow: [0, 0], specks: [], fog: 1, tally: Q.get("gauge") === "1", camX: laneX(0) * 0.8, camZ: 0, wide: 0, chart: 0, rate: 1,
    totals: Object.fromEntries(KEYS.map((k) => [k, { points: 0, fair: 0 }])), rows: [], three: null, flat: false, colors: {},
  };
  const model = () => models[st.kind];
  const rowAt = (t) => Math.min(Math.floor(t / DT + 1e-9), model().rows);
  const secs = (n) => `${(n * DT * paceOf(st.kind)).toFixed(1)} s`;
  const truckZ = () => SPEED * KINDS[st.kind].end + TRUCK;
  const decision = (k) => (k === "you" ? st.you : st.run.decide[k]);

  // ------------------------------------------------------------ colors from the page
  function readColors() {
    const cs = getComputedStyle(root);
    const c = {};
    for (const k of ["print", "print-2", "print-line", "print-ink", "print-dim", "accent-print", "pm", "wb", "ex", "right", "left", "hot", "theme"]) c[k] = cs.getPropertyValue(`--${k}`).trim();
    c.dark = c.theme === "dark";
    c.you = c["accent-print"];
    c.font = getComputedStyle(document.body).getPropertyValue("--sans").trim() || "sans-serif";
    st.colors = c;
  }
  readColors();
  document.addEventListener("appearance:change", () => { readColors(); st.three?.paint(st.colors); draw(); });

  // ------------------------------------------------------------ the rounds
  function show(...names) {
    for (const k of ["start", "left", "right", "next"]) ui[k].hidden = !names.includes(k);
  }
  function setRound() {
    st.kind = ONLY || kindOfRound(st.round);
    const k = KINDS[st.kind];
    ui.round.textContent = `Round ${st.round + 1} of ${GAME.rounds}`;
    ui.kind.textContent = k.name;
    ui.story.textContent = k.story;
    st.phase = "ready"; st.t = 0; st.run = playRound(model(), rng); st.you = null;
    st.glow = [0, 0]; st.specks = []; st.fog = 1;
    ui.say.textContent = "Press Start round when you’re ready. The glints begin at once.";
    ui.result.hidden = true;
    show("start");
    draw(); wake();
  }
  function begin() {
    if (st.phase !== "ready") return;
    st.phase = "live"; st.last = 0;
    show("left", "right");
    ui.say.textContent = "";
    ui.left.focus({ preventScroll: true });
    wake();
  }
  function commit(side) {
    if (st.phase !== "live") return;
    st.you = yourResult(model(), st.run, rowAt(st.t), side);
    st.totals.you.points += st.you.points; st.totals.you.fair += st.you.fair;
    for (const r of RULES) { const d = st.run.decide[r.key]; st.totals[r.key].points += d.points; st.totals[r.key].fair += d.fair; }
    st.rows.push({ kind: st.kind });
    show();
    // the fog lifts and the player's car drives on until it passes or hits the truck, in about a
    // second; then all four cars replay the round, in under two
    st.phase = "swerve"; st.swerveFrom = st.t;
    st.swerveTo = Math.max(st.t + SWERVE, truckZ() / SPEED + 0.15);
    st.rate = Math.max(1.1, (st.swerveTo - st.t) / 0.9);
    st.tEnd = Math.max(...KEYS.map((k) => decision(k).n * DT + SWERVE), truckZ() / SPEED + 0.2);
    if (reduced.matches) finish();
    wake();
  }
  function finish() {
    st.phase = "done"; st.t = st.tEnd; st.chart = reduced.matches ? 1 : 0;
    const y = st.you, side = (s) => (s > 0 ? "right" : "left");
    const what = y.forced ? `You reached the line undecided after ${secs(y.n)} and went ${side(y.choice)}, your best guess` : `You swerved ${side(y.choice)} after ${secs(y.n)}`;
    ui.say.textContent = `${what}. The truck was on the ${side(-st.run.z)}: ${y.correct ? "you got past it, 1 point" : "you hit it, no points"}, less ${model().spent[y.n].toFixed(2)} for the waiting.`;
    const cells = (k) => {
      const d = decision(k);
      return `<tr class="k-${k}"><th scope="row">${NAMES[k]}</th><td>${secs(d.n)}${d.forced ? " (forced)" : ""}</td><td>${side(d.choice)} ${d.correct ? "✓" : "✗"}</td><td><b>${sign(d.points)}</b><small>${sign(d.fair)}</small></td></tr>`;
    };
    ui.table.innerHTML = KEYS.map(cells).join("");
    ui.result.hidden = false;
    paintBoard();
    if (st.round + 1 >= GAME.rounds) { ui.next.textContent = "See the final score"; } else ui.next.textContent = "Next round";
    show("next");
    ui.next.focus({ preventScroll: true });
    wake();
  }
  function next() {
    if (st.phase !== "done") return;
    st.round++;
    if (st.round >= GAME.rounds) return over();
    setRound();
    ui.start.focus({ preventScroll: true });
  }
  function over() {
    st.phase = "over";
    const t = st.totals, best = Math.max(...RULES.map((r) => t[r.key].fair));
    ui.over.querySelector("p").textContent = `Over ${GAME.rounds} rounds you scored ${sign(t.you.points)}; the best bounds ${sign(t.ex.points)}, my 2025 rule ${sign(t.pm.points)}, and the look-ahead rule ${sign(t.wb.points)}. Without the luck of the last coin flip, your decisions were worth ${sign(t.you.fair)}, against ${sign(best)} for the best of the rules.`;
    ui.over.hidden = false;
    show();
    ui.again.focus({ preventScroll: true });
  }
  function again() {
    st.round = 0; st.rows = [];
    for (const k of KEYS) st.totals[k] = { points: 0, fair: 0 };
    ui.over.hidden = true;
    paintBoard();
    setRound();
    ui.start.focus({ preventScroll: true });
  }
  function paintBoard() {
    const n = st.rows.length;
    const exp = (key) => st.rows.reduce((s, r) => s + models[r.kind].exact[key].points / 100, 0);
    ui.board.innerHTML = KEYS.map((k) => {
      const t = st.totals[k], e = k === "you" ? "" : `<small>expected ${exp(k).toFixed(2)}</small>`;
      return `<tr class="k-${k}"><th scope="row">${NAMES[k]}</th><td><b>${sign(t.points)}</b></td><td>${sign(t.fair)}${e}</td></tr>`;
    }).join("");
    ui.boardN.textContent = n ? `after ${n} ${n === 1 ? "round" : "rounds"}` : "";
  }
  const sign = (v) => (v < 0 ? "−" : "") + Math.abs(v).toFixed(2);

  // ------------------------------------------------------------ where each car is
  /** Lane k at time t: across by how much, how far along, its yaw, and whether it has decided. */
  function carAt(k, t) {
    const d = decision(k);
    if (!d) return { x: 0, z: SPEED * t, yaw: 0, decided: false };
    const tc = d.n * DT, decided = t >= tc - 1e-9;
    const u = decided ? smooth((t - tc) / SWERVE) : 0;
    const du = decided ? (smooth((t - tc + 0.01) / SWERVE) - smooth((t - tc - 0.01) / SWERVE)) / 0.02 : 0;
    let z = SPEED * t;
    const hit = truckZ() - 2.15;
    if (decided && !d.correct && z >= hit) z = hit - 0.35 * Math.sin(Math.PI * Math.min((z - hit) / 3, 1));
    return { x: d.choice * SIDE * u, z, yaw: 0.042 * du * d.choice, decided, d };
  }

  // ------------------------------------------------------------ the clock
  let raf = 0;
  function frame(now) {
    raf = 0;
    if (!st.visible || document.hidden) { st.last = 0; return; }
    const dt = st.last ? Math.min((now - st.last) / 1000, 0.05) : 1 / 60;
    st.last = now;
    const before = st.t;
    if (st.phase === "live") {
      st.t += dt / paceOf(st.kind);
      if (rowAt(st.t) >= model().rows) { st.t = model().rows * DT; flash(before, st.t); commit(0); }
    } else if (st.phase === "swerve") {
      st.t += dt * st.rate;
      if (st.t >= st.swerveTo) { st.phase = "replay"; st.t = 0; st.rate = Math.max(1.1, st.tEnd / 1.8); }
    } else if (st.phase === "replay") {
      st.t += dt * st.rate;
      if (st.t >= st.tEnd) finish();
    } else if (st.phase === "done" && st.chart < 1) {
      st.chart = Math.min(1, st.chart + dt / 1.4);
    }
    if (st.phase === "live") flash(before, st.t);
    st.glow[0] *= Math.exp(-dt / 0.09); st.glow[1] *= Math.exp(-dt / 0.09);
    for (const sp of st.specks) sp.age += dt;
    st.specks = st.specks.filter((sp) => sp.age < LIFE);
    const fogTo = ["ready", "live"].includes(st.phase) ? 1 : 0;
    st.fog += (fogTo - st.fog) * (reduced.matches ? 1 : 1 - Math.exp(-dt / 0.35));
    // the camera follows the player during a round and pulls back to all four lanes for the replay
    const wide = st.phase === "live" || st.phase === "ready" || st.phase === "swerve" ? 0 : 1;
    const ease = reduced.matches ? 1 : 1 - Math.exp(-dt / 0.25);
    st.wide += (wide - st.wide) * ease;
    st.camX += (laneX(0) * 0.8 * (1 - wide) - st.camX) * ease;
    const lead = Math.min(SPEED * st.t, truckZ() - 8);
    st.camZ = reduced.matches ? lead : st.camZ + (lead - st.camZ) * (1 - Math.exp(-dt / 0.12));
    draw();
    if (busy()) raf = requestAnimationFrame(frame);
  }
  const busy = () => ["live", "swerve", "replay"].includes(st.phase) || (st.phase === "done" && st.chart < 1) || Math.abs(st.wide - (st.phase === "ready" ? 0 : 1)) > 0.002 || st.glow.some((g) => g > 0.01) || st.specks.length > 0 || Math.abs(st.fog - (["ready", "live"].includes(st.phase) ? 1 : 0)) > 0.002;
  const wake = () => { if (!raf && st.visible) raf = requestAnimationFrame(frame); };
  /** Each reading between two moments is a glint of the hazard lights through the fog, on the side
   * opposite the one it points to (game-model.js glintSide). */
  function flash(t0, t1) {
    const a = rowAt(t0), b = rowAt(t1);
    for (let n = a; n < b; n++) {
      const side = glintSide(st.run.reads[n]);
      if (STYLE === "flash") st.glow[side > 0 ? 1 : 0] = 1;
      else { st.specks.push({ side, u: Math.random(), w: Math.random(), age: 0 }); if (st.specks.length > 160) st.specks.shift(); }
    }
  }

  // ------------------------------------------------------------ drawing
  function draw() {
    if (!st.run) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    const view = viewNow();
    st.three?.render(w, h, view);
    drawHud(w, h, view);
    if (st.phase === "done" || st.phase === "over") drawChart();
  }
  function viewNow() {
    const kind = KINDS[st.kind], all = st.phase === "replay" || st.phase === "done" || st.phase === "over";
    const lanes = KEYS.map((k, i) => {
      const visible = k === "you" || all;
      const s = carAt(k, st.t);
      return { visible, x: s.x, z: s.z, yaw: s.yaw, s };
    });
    return {
      lanes, endZ: SPEED * kind.end, costZ: st.kind === "rises" ? SPEED * kind.at : null,
      truck: { side: -st.run.z, shown: !["ready", "live"].includes(st.phase) },
      glow: st.glow, specks: st.specks.map((sp) => ({ side: sp.side, u: sp.u, w: sp.w, a: 0.9 * (1 - sp.age / LIFE) })),
      fog: st.fog, camX: st.camX, camZ: st.camZ, wide: st.wide,
    };
  }

  /** The gauges over the lanes, the line's label, and the cost of waiting along the bottom. */
  function drawHud(w, h, view) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (hud.width !== Math.round(w * dpr) || hud.height !== Math.round(h * dpr)) { hud.width = Math.round(w * dpr); hud.height = Math.round(h * dpr); }
    const ctx = hud.getContext("2d"), c = st.colors, small = w < 560;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!st.three && !st.flat) return;
    const project = st.three ? st.three.project : flatProject(w, h);
    if (!st.three) drawFlat(ctx, w, h, view, project);
    // the lines' labels, at the left edge where each line meets the road
    const label = (z, txt) => {
      // a far line's label would sit on the glints, so it shows once the line is near
      if (z - SPEED * st.t > 45 && st.phase === "live") return;
      const a = project(laneX(0) + 3.4, 0, z);
      if (!a.visible || a.y < 70 || a.y > h - 70) return;
      ctx.font = `700 ${small ? 9.5 : 10.5}px ${c.font}`; ctx.textBaseline = "bottom"; ctx.textAlign = "left";
      const x = Math.max(4, Math.min(a.x, w - ctx.measureText(txt).width - 6));
      ctx.fillStyle = c.print; ctx.globalAlpha = 0.82; ctx.fillRect(x - 3, a.y - 15, ctx.measureText(txt).width + 6, 14); ctx.globalAlpha = 1;
      ctx.fillStyle = c["accent-print"]; ctx.fillText(txt, x, a.y - 2);
    };
    label(view.endZ, "LAST MOMENT TO SWERVE");
    if (view.costZ != null) label(view.costZ, `COST ×${GAME.factor} FROM HERE`);
    // the gauges, in a band along the top: after the round always, during it only with the tally on
    const m = model(), row = rowAt(st.t), shown = view.lanes.map((l, i) => (l.visible ? i : -1)).filter((i) => i >= 0);
    const band = shown.length > 1 || st.tally;
    if (band) {
      ctx.fillStyle = c.print; ctx.globalAlpha = 0.8; ctx.fillRect(0, 0, w, 64); ctx.globalAlpha = 1;
      ctx.strokeStyle = c["print-line"]; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 64.5); ctx.lineTo(w, 64.5); ctx.stroke();
    }
    const gw = shown.length === 1 ? Math.min(w * 0.62, 300) : Math.max(Math.min(small ? (w - 16) / 4 - 6 : 150, (w - 16) / 4 - 6), 64);
    if (band) shown.forEach((i) => {
      const k = KEYS[i], l = view.lanes[i], s = l.s, color = c[k];
      const p = project(laneX(i), 0, l.z);
      const half = gw / 2, gx = shown.length === 1 ? w / 2 : Math.min(Math.max(p.x, half + 6), w - half - 6), gy = 36;
      const X = (v) => gx + (Math.max(Math.min(v, KMAX), -KMAX) / KMAX) * half;
      const n = s.decided ? s.d.n : row, kNow = st.run.path[Math.min(n, m.rows)];
      ctx.save();
      ctx.strokeStyle = c["print-line"]; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx - half, gy); ctx.lineTo(gx + half, gy); ctx.stroke();
      ctx.strokeStyle = c["print-dim"]; ctx.beginPath(); ctx.moveTo(gx, gy - 4); ctx.lineTo(gx, gy + 4); ctx.stroke();
      // a rule's walls now (the player has none: that's the point)
      if (k !== "you") {
        const wall = n >= m.rows ? 0 : effectiveWall(m.walls[k], Math.min(n, m.rows - 1));
        ctx.strokeStyle = color; ctx.lineWidth = 2.2;
        for (const sg of [-1, 1]) { const x = X(sg * wall); ctx.beginPath(); ctx.moveTo(x, gy - 7); ctx.lineTo(x, gy + 7); ctx.stroke(); }
      }
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(kNow), gy, shown.length === 1 ? 5 : 3.6, 0, 2 * Math.PI); ctx.fill();
      ctx.font = `700 ${small ? 9.5 : 10.5}px ${c.font}`; ctx.textBaseline = "alphabetic"; ctx.textAlign = "center";
      ctx.fillText(SHORT[k], gx, gy - 13);
      ctx.font = `600 ${small ? 9 : 10}px ${c.font}`; ctx.fillStyle = c["print-ink"];
      ctx.fillText(gaugeLine(k, s, kNow, n, shown.length === 1, small), gx, gy + 19);
      ctx.restore();
    });
    drawCost(ctx, w, h, c, small);
  }
  function gaugeLine(k, s, kNow, n, solo, small) {
    const m = model();
    if (s.decided && (st.phase !== "live" || k === "you")) {
      const d = s.d, way = d.choice > 0 ? "RIGHT" : "LEFT";
      if (st.phase === "swerve" || st.phase === "live") return `${d.forced ? "FORCED " : ""}${way}`;
      return `${way} ${d.correct ? "✓" : "✗"} ${sign(d.points)}`;
    }
    if (k === "you") {
      if (kNow === 0) return solo ? "EVEN ODDS SO FAR" : "EVEN";
      const p = Math.round(100 * posterior(Math.abs(kNow), m.mu));
      return solo ? `${p}% SURE IT’S ${kNow > 0 ? "RIGHT" : "LEFT"}` : `${p}% ${kNow > 0 ? "RIGHT" : "LEFT"}`;
    }
    const wall = n >= m.rows ? 0 : effectiveWall(m.walls[k], Math.min(n, m.rows - 1));
    return small ? `${Math.round(100 * confidenceAt(wall, m.mu))}% TO SWERVE` : `${Math.round(100 * confidenceAt(wall, m.mu))}% SURE TO SWERVE`;
  }
  /** The cost of waiting: the schedule ahead, what the player has paid, and now. */
  function drawCost(ctx, w, h, c, small) {
    const m = model(), kind = KINDS[st.kind], span = st.kind === "deadline" ? 1.2 : 1.6;
    const bandH = 52, y0 = h - bandH;
    ctx.fillStyle = c.print; ctx.globalAlpha = 0.94; ctx.fillRect(0, y0, w, bandH); ctx.globalAlpha = 1;
    ctx.strokeStyle = c["print-line"]; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y0 + 0.5); ctx.lineTo(w, y0 + 0.5); ctx.stroke();
    const x0 = 12, x1 = w - 12, X = (t) => x0 + (Math.min(t, span) / span) * (x1 - x0);
    const cmax = GAME.c0 * GAME.factor, top = y0 + 20, bot = h - 8;
    const Y = (cst) => bot - (Math.log(Math.min(cst, cmax) / GAME.c0) / Math.log(cmax / GAME.c0)) * (bot - top);
    const n = st.you && st.phase !== "live" ? st.you.n : rowAt(st.t), tn = n * DT;
    ctx.font = `700 ${small ? 9.5 : 10.5}px ${c.font}`; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = c["print-dim"];
    ctx.fillText(`WHAT WAITING COSTS · YOU’VE PAID ${m.spent[n].toFixed(2)}`, x0, y0 + 6);
    const last = Math.min(span, m.rows * DT);
    // what has been paid, under the curve, then the curve
    ctx.beginPath(); ctx.moveTo(X(0), bot);
    for (let t = 0; t <= Math.min(tn, last) + 1e-9; t += 0.01) ctx.lineTo(X(t), Y(kind.cost(t)));
    ctx.lineTo(X(Math.min(tn, last)), bot); ctx.closePath();
    ctx.globalAlpha = 0.28; ctx.fillStyle = c["accent-print"]; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(X(0), Y(GAME.c0));
    for (let t = 0; t <= last + 1e-9; t += 0.01) ctx.lineTo(X(t), Y(kind.cost(t)));
    ctx.strokeStyle = c["accent-print"]; ctx.lineWidth = 2; ctx.stroke();
    if (st.kind === "deadline") { ctx.fillStyle = c["accent-print"]; ctx.fillRect(X(GAME.deadline) - 1, top - 4, 2, bot - top + 4); }
    ctx.fillStyle = c["print-ink"]; ctx.fillRect(X(tn) - 1, top - 6, 2, bot - top + 6);
  }

  // without WebGL: the same road from above
  function flatProject(w, h) {
    const top = 70, bottom = h - 60, zSpan = 40, z0 = st.camZ - 8;
    const sx = Math.min(w / (6 * 4.6), 24);
    return (x, y, z) => ({ x: w / 2 - (x - st.camX * 0.6) * sx, y: bottom - ((z - z0) / zSpan) * (bottom - top), visible: true });
  }
  function drawFlat(ctx, w, h, view, P) {
    const c = st.colors;
    ctx.fillStyle = c.print; ctx.fillRect(0, 0, w, h);
    KEYS.forEach((k, i) => {
      const xc = laneX(i), a = P(xc + 2.75, 0, st.camZ - 12), b = P(xc - 2.75, 0, st.camZ + 40);
      ctx.fillStyle = c["print-2"]; ctx.fillRect(Math.min(a.x, b.x), b.y, Math.abs(b.x - a.x), a.y - b.y);
      const l = view.lanes[i];
      if (!l.visible) return;
      const q = P(xc - l.x, 0, l.z);
      ctx.fillStyle = c[k]; ctx.fillRect(q.x - 6, q.y - 11, 12, 22);
    });
    for (const [z, dashed] of [[view.endZ, false], [view.costZ, true]]) {
      if (z == null) continue;
      const l1 = P(laneX(0) + 3, 0, z), l2 = P(laneX(3) - 3, 0, z);
      ctx.strokeStyle = c["accent-print"]; ctx.setLineDash(dashed ? [5, 4] : []); ctx.beginPath(); ctx.moveTo(l1.x, l1.y); ctx.lineTo(l2.x, l2.y); ctx.stroke(); ctx.setLineDash([]);
    }
    // the glints, where the truck would be, and the truck once the fog lifts
    const gp = (side) => P(laneX(0) - side * SIDE, 0, view.endZ + TRUCK);
    [-1, 1].forEach((side, j) => { if (view.glow[j] > 0.01) { const q = gp(side); ctx.globalAlpha = Math.min(1, view.glow[j]); ctx.fillStyle = c.hot; ctx.beginPath(); ctx.arc(q.x, q.y, 9, 0, 2 * Math.PI); ctx.fill(); ctx.globalAlpha = 1; } });
    for (const sp of view.specks) { const q = gp(sp.side); ctx.globalAlpha = sp.a; ctx.fillStyle = c.hot; ctx.beginPath(); ctx.arc(q.x + (sp.u - 0.5) * 20, q.y + (sp.w - 0.5) * 16, 2.5, 0, 2 * Math.PI); ctx.fill(); }
    ctx.globalAlpha = 1;
    if (view.truck.shown) KEYS.forEach((k, i) => { const q = P(laneX(i) - view.truck.side * SIDE, 0, view.endZ + TRUCK + 3); ctx.fillStyle = c["print-dim"]; ctx.fillRect(q.x - 8, q.y - 14, 16, 28); });
  }

  /** After a round: its readings again, with each rule's walls, a dot where each rule swerved and a
   * ring where the player did. */
  function drawChart() {
    const cv = ui.chart, dpr = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext("2d"), c = st.colors, m = model(), run = st.run, kind = KINDS[st.kind];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ends = KEYS.map((k) => decision(k).n);
    const nMax = Math.min(m.rows, Math.max(...ends, Math.round((kind.at ?? 0.6) / DT) + 10) + 12);
    const L = 46, Rr = w - 10, T = 14, B = h - 24;
    const X = (n) => L + (n / nMax) * (Rr - L);
    let kTop = KMAX;
    for (let n = 0; n <= nMax; n++) kTop = Math.max(kTop, Math.abs(run.path[n]));
    kTop += 2;
    const Y = (k) => (T + B) / 2 - (k / kTop) * ((B - T) / 2);
    ctx.fillStyle = c.print; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = c["print-line"]; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, Y(0) + 0.5); ctx.lineTo(Rr, Y(0) + 0.5); ctx.stroke();
    ctx.font = `600 10px ${c.font}`; ctx.fillStyle = c["print-dim"]; ctx.textBaseline = "middle"; ctx.textAlign = "right";
    ctx.fillText("RIGHT", L - 6, T + 6); ctx.fillText("LEFT", L - 6, B - 6);
    if (kind.at != null && kind.at / DT <= nMax) {
      ctx.strokeStyle = c["accent-print"]; ctx.setLineDash(st.kind === "rises" ? [6, 5] : []); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(X(kind.at / DT), T); ctx.lineTo(X(kind.at / DT), B); ctx.stroke(); ctx.setLineDash([]);
    }
    const shown = Math.round(smooth(st.chart) * nMax);
    RULES.forEach((r) => {
      const K = m.walls[r.key];
      ctx.strokeStyle = c[r.key]; ctx.lineWidth = r.key === "pm" ? 1.6 : 2; ctx.setLineDash(r.key === "pm" ? [5, 4] : []);
      ctx.globalAlpha = 0.85;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        for (let n = 0; n <= shown; n++) { const kk = n >= m.rows ? 0 : Math.min(effectiveWall(K, n), kTop); if (n === 0) ctx.moveTo(X(n), Y(s * kk)); else ctx.lineTo(X(n), Y(s * kk)); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.setLineDash([]);
    });
    ctx.strokeStyle = c["print-ink"]; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let n = 0; n <= shown; n++) { if (n === 0) ctx.moveTo(X(0), Y(0)); else ctx.lineTo(X(n), Y(run.path[n])); }
    ctx.stroke();
    RULES.forEach((r) => { const d = run.decide[r.key]; if (shown >= d.n) { ctx.fillStyle = c[r.key]; ctx.beginPath(); ctx.arc(X(d.n), Y(d.k), 5, 0, 2 * Math.PI); ctx.fill(); } });
    if (shown >= st.you.n) {
      ctx.strokeStyle = c.you; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(X(st.you.n), Y(st.you.k), 8, 0, 2 * Math.PI); ctx.stroke();
      ctx.fillStyle = c.you; ctx.font = `700 10px ${c.font}`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText("YOU", X(st.you.n), Y(st.you.k) - 10);
    }
    ctx.fillStyle = c["print-dim"]; ctx.font = `600 10px ${c.font}`; ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText("0 s", L, B + 8);
    ctx.textAlign = "right"; ctx.fillText(secs(nMax), Rr, B + 8);
  }

  // ------------------------------------------------------------ input
  ui.start.addEventListener("click", begin);
  ui.left.addEventListener("click", () => commit(-1));
  ui.right.addEventListener("click", () => commit(1));
  ui.next.addEventListener("click", next);
  ui.again.addEventListener("click", again);
  const paintTally = () => { ui.tally.setAttribute("aria-pressed", String(st.tally)); ui.tally.textContent = st.tally ? "Hide the tally" : "Add it up for me"; };
  ui.tally.addEventListener("click", () => { st.tally = !st.tally; paintTally(); draw(); });
  paintTally();
  // the arrow keys swerve only while a round is running, so they scroll the page as usual otherwise
  document.addEventListener("keydown", (e) => {
    if (st.phase !== "live" || e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); commit(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); commit(1); }
  });
  stage.addEventListener("keydown", (e) => {
    if ((e.key === " " || e.key === "Enter") && e.target === stage) {
      if (st.phase === "ready") { e.preventDefault(); begin(); }
      else if (st.phase === "done") { e.preventDefault(); next(); }
    }
  });

  // ------------------------------------------------------------ the 3D road, once it is near
  async function build() {
    let T;
    try {
      const probe = document.createElement("canvas");
      if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) throw new Error("no WebGL");
      T = await import("./vendor/three.min.js");
    } catch {
      stage.classList.add("is-flat"); glCv.hidden = true; st.flat = true; draw(); return;
    }
    const { playScene3 } = await import("./play-scene.js");
    st.three = playScene3(T, { glCv, keys: KEYS });
    st.three.paint(st.colors);
    stage.classList.add("is-ready");
    draw(); wake();
  }
  let started = false;
  new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting && !started) { started = true; build(); } }, { rootMargin: "700px 0px" }).observe(root);
  new IntersectionObserver((es) => { st.visible = es[0].isIntersecting; if (st.visible) { st.last = 0; draw(); wake(); } }, { threshold: 0.05 }).observe(stage);
  document.addEventListener("visibilitychange", wake);
  new ResizeObserver(() => draw()).observe(stage);

  paintBoard();
  setRound();
}

function smooth(u) { return u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u); }
