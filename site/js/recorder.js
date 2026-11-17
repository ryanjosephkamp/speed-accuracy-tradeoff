// The solar field recorder, in 3D. Three recorders on posts in a meadow at first light listen to
// the same flycatcher (recorder-model.js): an alder or a willow flycatcher, which look alike and
// are told apart by song. They hear the same songs and differ only in their walls: the best walls,
// the 2025 rule, and the look-ahead rule. Listening runs each recorder on its battery until the sun
// clears the ridge and its panel takes over, so a moment of doubt costs less as the sun comes up:
// the best walls are patient before the sun is up, since listening is about to get cheap, while the
// 2025 rule's are as low as the dark makes them. Each song flashes by the species it sounds like;
// the gauge over each recorder shows how far its songs lean and where its walls are now; the bar
// under it is the battery its doubt has used. At a wall the recorder turns its microphone to that
// species' sign and logs it. The strip along the bottom is the cost of a moment's doubt, falling
// as the sun comes up. The reader is told which bird it is; the recorders aren't.
//
// The scene's plumbing (controls, clock, gauges, loading) is lanes-scene.js. Without WebGL the same
// run is drawn from above on a plain canvas.
import { recorderModel, recorderCost, recorderNumbers, sunUp, RECORDER, ROWS } from "./recorder-model.js";
import { RULES } from "./lanes.js";
import { DT } from "./lattice.js";
import { laneScene, colorKit, R, smooth, clamp01 } from "./lanes-scene.js";

const STOP = RECORDER.stop;     // the bird stops singing: the last moment to log it
const PER = RECORDER.minutes;   // minutes in a time unit
const LANE = 2.7;               // meters between recorders
const SIGN_X = 0.8, SIGN_Z = 2.0, BIRD_Z = 2.7;
const RATE = { reading: 0.26, after: 0.7, ease: 0.25 }; // time units per real second
const KMAX = 22;                // the gauges' half width, in songs
const NAME = { [-1]: "ALDER", 1: "WILLOW" };

export function initRecorder() {
  const root = document.getElementById("recorder");
  if (!root) return;
  const model = recorderModel();
  const nums = recorderNumbers(model);
  for (const el of root.querySelectorAll("[data-rc-n]")) if (typeof nums[el.dataset.rcN] === "string") el.textContent = nums[el.dataset.rcN];
  let st = null;

  /** A rule's recorder at time t: whether it has logged the bird, and how far its microphone has
   * turned toward the species it chose. */
  function recorderAt(key, t) {
    const d = st.run.decide[key], td = d.n * DT, decided = t >= td - 1e-9;
    return { decided, d, turn: decided ? smooth((t - td) / 0.12) : 0, spent: model.spent[Math.min(decided ? d.n : Math.floor(t / DT + 1e-9), ROWS)] };
  }
  const minutes = (t) => `${(PER * t).toFixed(1)} min`;

  const scene = laneScene(root, {
    key: "recorder", data: "rc", model, salt: 0x1f83d9ab,
    words: { one: "bird", many: "birds", who: "recorder", did: "named the right species for", at: "When the bird stops", per: PER, unit: "min" },
    // a run ends a little after the last recorder has logged the bird, or the bird has stopped
    endOf: (run) => Math.min(Math.max(...RULES.map((r) => run.decide[r.key].n)) * DT, STOP) + 0.3,
    reading: (t) => t < STOP && RULES.some((r) => st.run.decide[r.key].n * DT > t - 1e-9),
    rate: RATE, kmax: KMAX,
    at: recorderAt,
    status(run, t, n) {
      const bird = run.z > 0 ? "a willow" : "an alder", row = Math.min(Math.floor(t / DT + 1e-9), ROWS);
      if (t >= STOP) return `Bird ${n}: it has stopped singing. It was ${bird} flycatcher.`;
      if (RULES.some((r) => run.decide[r.key].n > row)) return `Bird ${n}: song ${row} of ${ROWS}, ${minutes(t)} in. It is ${bird} flycatcher.`;
      return `Bird ${n}: all three have logged it, ${minutes(t)} in. It is ${bird} flycatcher.`;
    },
    gaugeAt: (i) => [R * (i - 1) * LANE, 1.5, 0],
    gaugeLine(s, pct, small) {
      if (!s.decided) return small ? `${pct}% SURE` : `${pct}% SURE OF THE BIRD`;
      const name = NAME[s.d.choice], verdict = s.d.correct ? "RIGHT" : "WRONG";
      return `${s.d.forced ? "FORCED: " : ""}${name}, ${verdict}`;
    },
    under(ctx, g) { drawMarks(ctx, g); },
    over(ctx, g) { drawCost(ctx, g); },
    flat: { project: flat, draw: drawFlat },
    build3: (T, api) => scene3(T, api),
  });
  st = scene.st;

  /** On the scene: each sign's species, the bird's own name, and the battery each recorder's doubt
   * has used (a share of what a recorder that listens until the bird stops would use). */
  function drawMarks(ctx, { project, font, small }) {
    const c = st.colors, full = model.spent[ROWS];
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    RULES.forEach((r, i) => {
      const xc = R * (i - 1) * LANE, s = recorderAt(r.key, st.t);
      ctx.font = `700 ${small ? 8.5 : 9.5}px ${font}`;
      for (const side of [-1, 1]) {
        const p = project(xc + R * side * SIGN_X, 0.7, SIGN_Z);
        if (!p.visible) continue;
        const chosen = s.decided && s.d.choice === side;
        ctx.fillStyle = chosen ? c.print : c["print-ink"];
        ctx.fillText(NAME[side], p.x, p.y);
      }
      // the bird's name, which the reader is told and the recorders aren't
      const b = project(xc, 1.5, BIRD_Z);
      if (b.visible) { ctx.fillStyle = c["print-dim"]; ctx.font = `600 ${small ? 8 : 9}px ${font}`; ctx.fillText(NAME[st.run.z].toLowerCase(), b.x, b.y + 10); }
      // the battery bar, under the recorder
      const q = project(xc, 0.8, -0.05);
      if (!q.visible) return;
      const bw = small ? 34 : 44, bh = 7, x0 = q.x - bw / 2, y0 = q.y + 6;
      ctx.strokeStyle = c["print-ink"]; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, bw, bh);
      ctx.fillStyle = c["print-ink"]; ctx.fillRect(x0 + bw + 1.5, y0 + 2.5, 2, 3);
      ctx.fillStyle = c[r.key]; ctx.fillRect(x0 + 1.5, y0 + 1.5, (bw - 2) * Math.min(s.spent / full, 1), bh - 2);
    });
    ctx.restore();
  }

  /** The cost of a moment's doubt from the first song to the last, falling as the sun comes up. */
  function drawCost(ctx, { w, h, font, small }) {
    const c = st.colors, x0 = 14, x1 = w - 14, base = h - 12, top = h - 40;
    const X = (t) => x0 + ((x1 - x0) * t) / STOP, Y = (v) => base - ((base - top) * v) / RECORDER.hi;
    ctx.save();
    ctx.fillStyle = c.print; ctx.globalAlpha = 0.78; ctx.fillRect(0, top - 18, w, h - top + 18); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(X(0), base);
    for (let i = 0; i <= 240; i++) { const t = (STOP * i) / 240; ctx.lineTo(X(t), Y(recorderCost(t))); }
    ctx.lineTo(X(STOP), base); ctx.closePath();
    ctx.fillStyle = c["accent-print"]; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = c["print-line"]; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, base + 0.5); ctx.lineTo(x1, base + 0.5); ctx.stroke();
    // the bird stops
    ctx.strokeStyle = c["accent-print"]; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(X(STOP) - 0.5, top - 6); ctx.lineTo(X(STOP) - 0.5, base); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = `700 ${small ? 9.5 : 10.5}px ${font}`; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = c["print-dim"]; ctx.textAlign = "left"; ctx.fillText(small ? "COST OF LISTENING" : "COST OF LISTENING, FALLING AS THE SUN COMES UP", x0, top - 6);
    ctx.fillStyle = c["accent-print"]; ctx.textAlign = "right"; ctx.fillText("BIRD STOPS", X(STOP) - 5, top - 6);
    // now
    const t = Math.min(st.t, STOP), x = X(t);
    ctx.strokeStyle = c["print-ink"]; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, top - 2); ctx.lineTo(x, base); ctx.stroke();
    ctx.fillStyle = c["print-ink"]; ctx.beginPath(); ctx.arc(x, Y(recorderCost(t)), 3, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------ without WebGL: the same run from above
  function flat(w, h) {
    const top = 96, bottom = h - 64, zMin = -0.8, zMax = BIRD_Z + 0.8;
    const sx = Math.min(w / (LANE * 3.4), 60);
    return (x, y, z) => ({ x: w / 2 + R * x * sx, y: bottom - ((z - zMin) / (zMax - zMin)) * (bottom - top) - y * 6, visible: true });
  }
  function drawFlat(ctx, w, h, P) {
    const c = st.colors;
    ctx.fillStyle = c.print; ctx.fillRect(0, 0, w, h);
    RULES.forEach((r, i) => {
      const xc = R * (i - 1) * LANE, s = recorderAt(r.key, st.t);
      for (const side of [-1, 1]) {
        const p = P(xc + R * side * SIGN_X, 0, SIGN_Z);
        ctx.fillStyle = s.decided && s.d.choice === side ? c[r.key] : c["print-2"];
        ctx.fillRect(p.x - 16, p.y - 6, 32, 12);
      }
      const b = P(xc, 0, BIRD_Z);
      ctx.fillStyle = c["print-dim"]; ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, 2 * Math.PI); ctx.fill();
      const q = P(xc, 0, 0);
      ctx.fillStyle = c[r.key]; ctx.fillRect(q.x - 7, q.y - 7, 14, 14);
    });
  }

  // ------------------------------------------------------------ the 3D scene, once it is near
  function scene3(T, { glCv, stage }) {
    const renderer = new T.WebGLRenderer({ canvas: glCv, antialias: true, powerPreference: "low-power" });
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(42, 1, 0.3, 300);
    scene.fog = new T.Fog(0x000000, 40, 160);
    const mat = {}, M = (key, opts = {}) => (mat[key] = new T.MeshBasicMaterial(opts));
    for (const k of ["ground", "path", "ridge", "ridge-far", "post", "box", "panel", "mic", "foam", "branch", "bird", "bird-2", "beak", "plate", "stake"]) M(k);
    for (const r of RULES) { M(`lamp-${r.key}`); M(`flag-${r.key}`); }
    M("sun", { fog: false }); M("glow", { transparent: true, depthWrite: false, fog: false });
    M("sky", { depthWrite: false, fog: false });
    M("shadow", { transparent: true, depthWrite: false });
    const edge = new T.LineBasicMaterial({ transparent: true });
    const pulseMats = [0, 1, 2].map(() => [0, 1].map(() => new T.MeshBasicMaterial({ transparent: true, depthWrite: false })));

    const flatOn = (geo, m, x, z, y = 0.01) => { const mesh = new T.Mesh(geo, m); mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); scene.add(mesh); return mesh; };
    const withEdges = (mesh) => { mesh.add(new T.LineSegments(new T.EdgesGeometry(mesh.geometry, 20), edge)); return mesh; };
    const box = (w, h, d, m, x = 0, y = 0, z = 0, parent = scene) => { const b = withEdges(new T.Mesh(new T.BoxGeometry(w, h, d), m)); b.position.set(x, y, z); parent.add(b); return b; };

    // the meadow, the sky with its dawn glow, the ridge, and the sun behind it
    flatOn(new T.PlaneGeometry(300, 300), mat.ground, 0, 60, 0);
    const sky = new T.Mesh(new T.PlaneGeometry(400, 90), mat.sky); sky.position.set(0, 30, 130); sky.rotation.y = Math.PI; scene.add(sky);
    const glow = new T.Mesh(new T.PlaneGeometry(400, 60), mat.glow); glow.position.set(0, 14, 129); glow.rotation.y = Math.PI; scene.add(glow);
    const sun = new T.Mesh(new T.SphereGeometry(4.2, 24, 16), mat.sun); scene.add(sun);
    const rand = ((a) => () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 2 ** 32; })(1103);
    for (let k = 0; k < 9; k++) {
      const hill = new T.Mesh(new T.SphereGeometry(1, 10, 6), k % 2 ? mat["ridge-far"] : mat.ridge);
      hill.scale.set(14 + 10 * rand(), 5 + 5 * rand(), 6);
      hill.position.set(-60 + 15 * k + 6 * rand(), -1.5, k % 2 ? 112 : 100);
      scene.add(hill);
    }
    // a worn path down each lane, toward the bird
    RULES.forEach((r, i) => flatOn(new T.PlaneGeometry(LANE - 0.9, 7), mat.path, R * (i - 1) * LANE, 2, 0.004));

    const lanes = RULES.map((r, i) => {
      const xc = R * (i - 1) * LANE;
      // the recorder: a post, the box, its panel tilted to the east, a lamp, and a microphone that turns
      box(0.09, 1.25, 0.09, mat.post, xc, 0.625, 0);
      box(0.46, 0.3, 0.2, mat.box, xc, 1.33, 0);
      const panel = box(0.6, 0.03, 0.38, mat.panel, xc, 1.6, -0.02);
      panel.rotation.x = 0.55;
      const lamp = new T.Mesh(new T.SphereGeometry(0.045, 10, 8), mat[`lamp-${r.key}`]); lamp.position.set(xc + 0.17, 1.52, 0.06); scene.add(lamp);
      const mic = new T.Group(); mic.position.set(xc, 1.28, 0.1); scene.add(mic);
      const tube = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.4, 10), mat.mic); tube.rotation.x = Math.PI / 2; tube.position.z = 0.2; mic.add(tube);
      const foam = new T.Mesh(new T.SphereGeometry(0.075, 12, 8), mat.foam); foam.position.z = 0.42; mic.add(foam);
      const shadow = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 0.002, 16), mat.shadow); shadow.scale.set(0.6, 1, 0.4); shadow.position.set(xc, 0.01, 0); scene.add(shadow);
      // the species' signs, one on each side, with a flag that goes up on the one a recorder logs
      const flags = [-1, 1].map((side) => {
        const x = xc + R * side * SIGN_X;
        box(0.05, 0.56, 0.05, mat.stake, x, 0.28, SIGN_Z);
        box(0.7, 0.25, 0.03, mat.plate, x, 0.7, SIGN_Z);
        const flag = box(0.7, 0.25, 0.031, mat[`flag-${r.key}`], x, 0.7, SIGN_Z - 0.005);
        flag.visible = false;
        return flag;
      });
      // the bird on its perch, facing the recorder
      const perch = new T.Mesh(new T.CylinderGeometry(0.03, 0.05, 1.8, 8), mat.branch); perch.position.set(xc, 0.9, BIRD_Z); scene.add(perch);
      const bar = new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 0.6, 8), mat.branch); bar.rotation.z = Math.PI / 2; bar.position.set(xc, 1.78, BIRD_Z); scene.add(bar);
      const bird = new T.Group(); bird.position.set(xc, 1.8, BIRD_Z); bird.rotation.y = Math.PI; bird.scale.setScalar(2.2); scene.add(bird);
      const body = new T.Mesh(new T.SphereGeometry(0.07, 12, 8), mat.bird); body.scale.set(0.85, 1, 1.35); body.position.y = 0.05; bird.add(body);
      const head = new T.Group(); head.position.set(0, 0.12, 0.06); bird.add(head);
      head.add(new T.Mesh(new T.SphereGeometry(0.045, 12, 8), mat["bird-2"]));
      const beak = new T.Mesh(new T.ConeGeometry(0.014, 0.05, 6), mat.beak); beak.rotation.x = Math.PI / 2; beak.position.z = 0.055; head.add(beak);
      const tail = new T.Mesh(new T.BoxGeometry(0.05, 0.012, 0.11), mat["bird-2"]); tail.position.set(0, 0.02, -0.12); tail.rotation.x = -0.4; bird.add(tail);
      // where each song flashes: a patch under each sign
      const pulses = [-1, 1].map((side, j) => flatOn(new T.PlaneGeometry(0.9, 0.6), pulseMats[i][j], xc + R * side * SIGN_X, SIGN_Z - 0.5, 0.012));
      return { xc, mic, lamp, flags, head, pulses };
    });

    const { col, mixed } = colorKit(T);
    function paint() {
      const c = st.colors, dark = c.dark;
      scene.background = col(c.print);
      scene.fog.color.copy(col(c.print));
      mat.ground.color = col(c.print);
      mat.path.color = mixed(c.print, c["print-ink"], dark ? 0.05 : 0.045);
      mat.ridge.color = mixed(c.print, c["print-ink"], dark ? 0.16 : 0.2);
      mat["ridge-far"].color = mixed(c.print, c["print-ink"], dark ? 0.1 : 0.12);
      mat.post.color = mixed(c.print, c["print-ink"], dark ? 0.45 : 0.5);
      mat.stake.color = mixed(c.print, c["print-ink"], dark ? 0.35 : 0.4);
      mat.box.color = mixed(c.print, c["print-ink"], dark ? 0.3 : 0.18);
      mat.mic.color = mixed(c.print, c["print-ink"], dark ? 0.7 : 0.75);
      mat.foam.color = mixed(c.print, c["print-ink"], dark ? 0.55 : 0.6);
      mat.plate.color = mixed(c.print, c["print-ink"], dark ? 0.12 : 0.08);
      mat.branch.color = mixed(c.print, c["print-ink"], dark ? 0.4 : 0.45);
      mat.bird.color = mixed(c.print, c["print-ink"], dark ? 0.55 : 0.5);
      mat["bird-2"].color = mixed(c.print, c["print-ink"], dark ? 0.68 : 0.62);
      mat.beak.color = mixed(c.print, c["print-ink"], dark ? 0.85 : 0.85);
      for (const r of RULES) { mat[`flag-${r.key}`].color = col(c[r.key]); }
      edge.color.copy(col(dark ? c.print : c["print-ink"])); edge.opacity = dark ? 0.8 : 0.6;
      mat.shadow.color = col(dark ? "#000000" : c["print-ink"]); mat.shadow.opacity = dark ? 0 : 0.12;
      mat.sun.color = dark ? mixed(c.hot, "#ffffff", 0.35) : mixed(c["accent-print"], c.print, 0.25);
      // the sky, and a dawn glow over the ridge that grows as the sun comes up
      const grad = (stops) => {
        const sk = document.createElement("canvas"); sk.width = 4; sk.height = 128;
        const sctx = sk.getContext("2d"), g = sctx.createLinearGradient(0, 0, 0, 128);
        for (const [at, color] of stops) g.addColorStop(at, color);
        sctx.fillStyle = g; sctx.fillRect(0, 0, 4, 128);
        const tex = new T.CanvasTexture(sk); tex.colorSpace = T.SRGBColorSpace; return tex;
      };
      if (mat.sky.map) mat.sky.map.dispose();
      if (mat.glow.map) mat.glow.map.dispose();
      mat.sky.map = grad([[0, c.print], [1, c.print]]);
      const warm = `#${mixed(c.print, dark ? c.hot : c["accent-print"], dark ? 0.32 : 0.22).getHexString()}`;
      mat.glow.map = grad([[0, `#${col(c.print).getHexString()}00`], [0.55, warm], [1, warm]]);
      mat.sky.needsUpdate = true; mat.glow.needsUpdate = true;
      pulseMats.forEach((pair) => { pair[0].color.copy(col(c.left)); pair[1].color.copy(col(c.right)); });
    }
    paint();

    // Behind the recorders and above them, tilted so the horizon sits near the top of the space
    // between the gauges and the cost strip, and far enough back for the three lanes to fill the
    // rest; the sun rises to just under the gauges.
    let fitFor = "", sunTop = 10;
    const corners = [];
    for (const x of [-1, 1]) for (const y of [0, 2.05]) corners.push(new T.Vector3(x * (LANE + 0.85), y, -0.3), new T.Vector3(x * (LANE + 0.85), y, BIRD_Z + 0.3));
    const q = new T.Vector3();
    function fit(w, h) {
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
      const yHi = 1 - (2 * 74) / h, yLo = -1 + (2 * 64) / h;
      const horizon = yLo + 0.8 * (yHi - yLo), top = horizon - 0.1, mid = (yLo + top) / 2;
      // the horizon's height in the frame is set by the tilt alone
      const el = Math.atan(horizon * tanHalf);
      const dir = new T.Vector3(0, Math.sin(el), -Math.cos(el)), up = new T.Vector3(0, Math.cos(el), Math.sin(el));
      const target = new T.Vector3(0, 0.9, BIRD_Z / 2);
      const place = (d) => { camera.position.copy(target).addScaledVector(dir, d); camera.lookAt(target); camera.updateMatrixWorld(); };
      const span = () => {
        let x = 0, lo = Infinity, hi = -Infinity;
        for (const c of corners) { q.copy(c).project(camera); x = Math.max(x, Math.abs(q.x)); lo = Math.min(lo, q.y); hi = Math.max(hi, q.y); }
        return { x, lo, hi };
      };
      for (let pass = 0; pass < 3; pass++) {
        let a = 2, b = 200;
        for (let i = 0; i < 40; i++) {
          const d = (a + b) / 2; place(d);
          const s = span();
          if (s.x <= 0.97 && s.hi - s.lo <= top - yLo) b = d; else a = d;
        }
        place(b);
        const s = span(), off = ((s.hi + s.lo) / 2 - mid) * b * tanHalf;
        target.addScaledVector(up, off);
        place(b);
      }
      // how high the sun can rise at its distance and still clear the gauges: along the ray through
      // a point a little under them
      const ray = new T.Vector3(0, horizon + 0.6 * (yHi - horizon), 0.5).unproject(camera).sub(camera.position);
      sunTop = Math.max(camera.position.y + (ray.y * (120 - camera.position.z)) / ray.z, 10.5);
    }
    function render(w, h) {
      const dpr = Math.min(devicePixelRatio || 1, w < 600 ? 1.5 : 2);
      if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
      const size = renderer.getSize(new T.Vector2());
      if (size.x !== w || size.y !== h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
      if (fitFor !== `${w}x${h}`) { fit(w, h); fitFor = `${w}x${h}`; }
      const t = st.t, up = sunUp(Math.min(t, STOP));
      // the sun rises from behind the ridge as the panel's output does
      sun.position.set(-14, -6 + (sunTop + 6) * up, 120);
      mat.glow.opacity = 0.25 + 0.75 * up;
      const c = st.colors;
      mat.panel.color = mixed(c.print, c["print-ink"], c.dark ? 0.75 - 0.4 * up : 0.8 - 0.25 * up);
      const row = Math.floor(t / DT + 1e-9), sing = Math.max(...st.pulses.flat());
      RULES.forEach((r, i) => {
        const L = lanes[i], s = recorderAt(r.key, t);
        L.mic.rotation.y = s.turn * Math.atan2(R * s.d.choice * SIGN_X, SIGN_Z - 0.1);
        L.lamp.visible = s.decided;
        L.flags.forEach((f, j) => { f.visible = s.decided && s.d.choice === (j ? 1 : -1); });
        // the bird lifts its head as it sings each song
        L.head.rotation.x = -0.35 * sing;
        const on = st.run.decide[r.key].n > row;
        L.pulses[0].material.opacity = 0.6 * st.pulses[i][0] * (on ? 1 : 0);
        L.pulses[1].material.opacity = 0.6 * st.pulses[i][1] * (on ? 1 : 0);
      });
      renderer.render(scene, camera);
    }
    const v = new T.Vector3();
    function project(x, y, z) {
      v.set(x, y, z).project(camera);
      return { x: (v.x * 0.5 + 0.5) * stage.clientWidth, y: (-v.y * 0.5 + 0.5) * stage.clientHeight, visible: v.z < 1 && v.z > -1 };
    }
    return { paint, render, project };
  }

  scene.start();
}
