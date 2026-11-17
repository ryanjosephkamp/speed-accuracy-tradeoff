// The goalkeeper, in 3D. Three goals side by side face the same penalty; their keepers read the
// same cues from the kicker's run-up (keeper-model.js) and differ only in their walls: the best
// walls, the 2025 rule, and the look-ahead rule. Each cue flashes on the side of the goal it
// points to; the gauge over each goal shows how far the keeper's cues lean and where its walls
// are now. A keeper commits at a wall and moves across, faster the later it starts, to meet the
// ball as it arrives; one still in doubt at the kick must guess with what its cues say. The strip
// along the bottom is the cost of a moment's doubt, climbing toward the kick. The reader can see
// where the kick will go; the keepers can't.
//
// Three.js loads only when the scene comes near the screen (as the car's, js/car.js). Colors come
// from the page's tokens and are read again when the theme or its dial changes. Without WebGL the
// same run is drawn from above on a plain canvas.
import { keeperModel, keeperCost, keeperNumbers, KEEPER, ROWS } from "./keeper-model.js";
import { RULES } from "./lanes.js";
import { DT } from "./lattice.js";
import { laneScene, colorKit, R, smooth, clamp01 } from "./lanes-scene.js";

const LANE = 6.6;             // meters between goal centers
const GW = 5.4, GH = 1.85;    // the goal, smaller than life so that three fit a phone
const Z_GOAL = 8;             // the goal line; the penalty spot is at z = 0
const KICK = KEEPER.kick;     // the ball is struck at the end of the run-up, one story second in
const FLIGHT = 0.42;          // story seconds from the spot to the line
const T_ARRIVE = KICK + FLIGHT;
const T_END = T_ARRIVE + 0.8;
const AIM = 2.05;             // where the ball crosses the line, from the goal's center
const BALL_Y = 0.78;          // and how high
const HIP = 0.7;              // the keeper's hips, where it turns as it dives
const SHIFT = 0.95;           // how far the keeper's hips travel to meet the ball
const DIVE = 0.34;            // the last part of the move, off the ground
const BALL_R = 0.15;
const RATE = { reading: 0.26, after: 0.55 }; // story seconds per real second
const KMAX = 24;              // the gauge's half width, in cues

export function initKeeper() {
  const root = document.getElementById("keeper");
  if (!root) return;
  const model = keeperModel();
  const nums = keeperNumbers(model);
  for (const el of root.querySelectorAll("[data-gk-n]")) if (typeof nums[el.dataset.gkN] === "string") el.textContent = nums[el.dataset.gkN];
  let st = null;

  /** Where a rule's keeper is at story time t: its hips' offset across the goal, how high they
   * are, how far it has turned onto its side, and its state. */
  function keeperAt(key, t) {
    const d = st.run.decide[key], td = d.n * DT, decided = t >= td - 1e-9;
    if (!decided) return { x: 0, y: 0, roll: 0, arms: 0, decided, d, ready: 1 };
    const dir = R * d.choice;
    // across the goal by the time the ball arrives: slowly if it committed early, a lunge if late
    const u = smooth((t - td) / Math.max(T_ARRIVE - td, 0.25));
    const a = clamp01((t - (T_ARRIVE - DIVE)) / DIVE), land = clamp01((t - T_ARRIVE) / 0.32);
    const y = 0.42 * Math.sin(Math.PI * 0.5 * a) * (1 - smooth(land)) - 0.38 * smooth(land);
    const roll = -Math.sign(dir) * (1.35 * smooth(a) + 0.2 * smooth(land));
    return { x: dir * SHIFT * u, y, roll, arms: Math.max(smooth(a), 0.35 * u), decided, d, ready: 1 - u, saved: d.correct && t >= T_ARRIVE };
  }
  /** The ball at story time t: on the spot, in flight to its corner, then saved or in the net. */
  function ballAt(i, t) {
    const z = st.run.z, side = R * z, xc = R * (i - 1) * LANE;
    if (t <= KICK) return { x: xc, y: BALL_R, z: 0 };
    const s = clamp01((t - KICK) / FLIGHT);
    if (t <= T_ARRIVE) return { x: xc + side * AIM * s, y: BALL_R + (BALL_Y - BALL_R) * s + 0.9 * s * (1 - s), z: (Z_GOAL - 0.15) * s };
    const after = t - T_ARRIVE, saved = st.run.decide[RULES[i].key].correct;
    if (saved) {
      // pushed back out, past the post, and down
      const v = clamp01(after / 0.55);
      return { x: xc + side * (AIM + 1.6 * v), y: Math.max(BALL_R, BALL_Y + 0.5 * v - 1.6 * v * v), z: Z_GOAL - 0.15 - 2.6 * v };
    }
    const v = clamp01(after / 0.28), drop = clamp01((after - 0.28) / 0.3);
    return { x: xc + side * (AIM + 0.3 * v), y: BALL_R + (BALL_Y - BALL_R) * (1 - drop * drop) + 0.12 * v * (1 - v), z: Z_GOAL - 0.15 + 1.25 * v };
  }

  const scene = laneScene(root, {
    key: "keeper", data: "gk", model, salt: 0x3c6ef372,
    words: { one: "kick", many: "kicks", who: "keeper", did: "saved", at: "At the kick" },
    end: T_END, reading: (t) => t < KICK, rate: RATE, kmax: KMAX,
    at: keeperAt,
    status(run, t, n) {
      const side = run.z > 0 ? "right" : "left";
      return t < KICK
        ? `Kick ${n}: cue ${Math.min(Math.floor(t / DT + 1e-9), ROWS)} of ${ROWS}, ${t.toFixed(2)} s into the run-up. It will go ${side}.`
        : `Kick ${n}: struck at ${KICK.toFixed(2)} s. It went ${side}.`;
    },
    gaugeAt: (i) => [R * (i - 1) * LANE, 0, Z_GOAL],
    gaugeLine(s, pct, small) {
      const way = s.d.choice > 0 ? "RIGHT" : "LEFT";
      let line;
      if (!s.decided) line = `${pct}% SURE TO DIVE`;
      else if (st.t < T_ARRIVE) line = `${s.d.forced ? "GUESSES" : "DIVES"} ${way}`;
      else line = `${s.d.forced ? "GUESSED, " : ""}${s.d.correct ? "SAVED" : "GOAL"}`;
      if (small) line = line.replace(" SURE TO DIVE", " TO DIVE");
      return line;
    },
    under(ctx, { project }) { if (st.three) drawBalls(ctx, project); },
    over(ctx, { w, h, font, small }) { drawCost(ctx, w, h, font, small); },
    flat: { project: flat, draw: drawFlat },
    build3: (T, api) => scene3(T, api),
  });
  st = scene.st;

  /** Each goal's ball, as a printed disc at its place in the scene. */
  function drawBalls(ctx, project) {
    const c = st.colors;
    RULES.forEach((r, i) => {
      const b = ballAt(i, st.t), p = project(b.x, b.y, b.z), top = project(b.x, b.y + BALL_R, b.z);
      if (!p.visible) return;
      const rad = Math.max(Math.hypot(top.x - p.x, top.y - p.y), 2.2);
      ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, 2 * Math.PI);
      ctx.fillStyle = c.dark ? c["print-ink"] : c.print; ctx.fill();
      ctx.lineWidth = 1.1; ctx.strokeStyle = c.dark ? c.print : c["print-ink"]; ctx.stroke();
    });
  }

  /** The cost of a moment's doubt from the start of the run-up to the kick, and now. */
  function drawCost(ctx, w, h, font, small) {
    const c = st.colors, x0 = 14, x1 = w - 14, base = h - 12, top = h - 40;
    const cMax = keeperCost(KICK), X = (t) => x0 + ((x1 - x0) * t) / KICK, Y = (v) => base - ((base - top) * v) / cMax;
    ctx.save();
    ctx.fillStyle = c.print; ctx.globalAlpha = 0.78; ctx.fillRect(0, top - 18, w, h - top + 18); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(X(0), base);
    for (let i = 0; i <= 120; i++) { const t = (KICK * i) / 120; ctx.lineTo(X(t), Y(keeperCost(t))); }
    ctx.lineTo(X(KICK), base); ctx.closePath();
    ctx.fillStyle = c["accent-print"]; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = c["print-line"]; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, base + 0.5); ctx.lineTo(x1, base + 0.5); ctx.stroke();
    // the kick
    ctx.strokeStyle = c["accent-print"]; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(X(KICK) - 0.5, top - 6); ctx.lineTo(X(KICK) - 0.5, base); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = `700 ${small ? 9.5 : 10.5}px ${font}`; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = c["print-dim"]; ctx.textAlign = "left"; ctx.fillText("COST OF DOUBT", x0, top - 6);
    ctx.fillStyle = c["accent-print"]; ctx.textAlign = "right"; ctx.fillText("KICK", X(KICK) - 5, top - 6);
    // now
    const t = Math.min(st.t, KICK), x = X(t);
    ctx.strokeStyle = c["print-ink"]; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, top - 2); ctx.lineTo(x, base); ctx.stroke();
    ctx.fillStyle = c["print-ink"]; ctx.beginPath(); ctx.arc(x, Y(keeperCost(t)), 3, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------ without WebGL: the same run from above
  function flat(w, h) {
    const top = 88, bottom = h - 64, zMin = -3, zMax = Z_GOAL + 1.5;
    const sx = Math.min(w / (LANE * 3.3), 30);
    return (x, y, z) => ({ x: w / 2 + R * x * sx, y: bottom - ((z - zMin) / (zMax - zMin)) * (bottom - top) - y * 6, visible: true });
  }
  function drawFlat(ctx, w, h, P) {
    const c = st.colors;
    ctx.fillStyle = c.print; ctx.fillRect(0, 0, w, h);
    RULES.forEach((r, i) => {
      const xc = R * (i - 1) * LANE;
      const a = P(xc - GW / 2, 0, Z_GOAL), b = P(xc + GW / 2, 0, Z_GOAL);
      ctx.strokeStyle = c["print-ink"]; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const s = keeperAt(r.key, st.t), q = P(xc + s.x, 0, Z_GOAL - 0.3);
      ctx.fillStyle = c[r.key]; ctx.fillRect(q.x - 10, q.y - 5, 20, 10);
      const bl = ballAt(i, st.t), bq = P(bl.x, 0, bl.z);
      ctx.fillStyle = c["print-ink"]; ctx.beginPath(); ctx.arc(bq.x, bq.y, 4, 0, 2 * Math.PI); ctx.fill();
    });
  }

  // ------------------------------------------------------------ the 3D scene, once it is near
  function scene3(T, { glCv, stage }) {
    const renderer = new T.WebGLRenderer({ canvas: glCv, antialias: true, powerPreference: "low-power" });
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(24, 1, 0.5, 600);
    scene.fog = new T.Fog(0x000000, 50, 120);
    // flat fills with drawn edges, like the prints
    const mat = {}, M = (key, opts = {}) => (mat[key] = new T.MeshBasicMaterial(opts));
    for (const k of ["ground", "stripe", "chalk", "post", "kicker", "kicker-2", "skin"]) M(k);
    for (const r of RULES) { M(`kit-${r.key}`); M(`glove-${r.key}`); }
    M("net-back", { transparent: true, depthWrite: false, side: T.DoubleSide });
    M("shadow", { transparent: true, depthWrite: false });
    M("sky", { depthWrite: false, fog: false });
    const edge = new T.LineBasicMaterial({ transparent: true });
    const netLine = new T.LineBasicMaterial({ transparent: true });
    const pulseMats = [0, 1, 2].map(() => [0, 1].map(() => new T.MeshBasicMaterial({ transparent: true, depthWrite: false })));

    const flatOn = (geo, m, x, z, y = 0.01) => { const mesh = new T.Mesh(geo, m); mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); scene.add(mesh); return mesh; };
    const withEdges = (mesh) => { mesh.add(new T.LineSegments(new T.EdgesGeometry(mesh.geometry, 20), edge)); return mesh; };
    const box = (w, h, d, m, x = 0, y = 0, z = 0, parent = scene) => { const b = withEdges(new T.Mesh(new T.BoxGeometry(w, h, d), m)); b.position.set(x, y, z); parent.add(b); return b; };

    // the pitch: mowing stripes across it, the goal line, and a spot and a box for each goal
    flatOn(new T.PlaneGeometry(300, 300), mat.ground, 0, 40, 0);
    for (let z = -30; z < Z_GOAL + 30; z += 4) flatOn(new T.PlaneGeometry(300, 2), mat.stripe, 0, z + 1, 0.004);
    const sky = new T.Mesh(new T.PlaneGeometry(300, 60), mat.sky);
    sky.position.set(0, 18, 90); sky.rotation.y = Math.PI; scene.add(sky);
    flatOn(new T.PlaneGeometry(LANE * 3 + 8, 0.09), mat.chalk, 0, Z_GOAL, 0.012);
    RULES.forEach((r, i) => {
      const xc = R * (i - 1) * LANE;
      const spot = flatOn(new T.PlaneGeometry(0.22, 0.22), mat.chalk, xc, 0, 0.012);
      spot.rotation.z = Math.PI / 4;
      // the goal area in front of each goal, in chalk
      const gx = GW / 2 + 1.0, gz = Z_GOAL - 1.9;
      for (const s of [-1, 1]) flatOn(new T.PlaneGeometry(0.08, Z_GOAL - gz), mat.chalk, xc + s * gx, (Z_GOAL + gz) / 2, 0.012);
      flatOn(new T.PlaneGeometry(2 * gx + 0.08, 0.08), mat.chalk, xc, gz, 0.012);
      // posts, the bar, and the net behind
      for (const s of [-1, 1]) box(0.12, GH, 0.12, mat.post, xc + s * (GW / 2 + 0.06), GH / 2, Z_GOAL + 0.06);
      box(GW + 0.24, 0.12, 0.12, mat.post, xc, GH + 0.06, Z_GOAL + 0.06);
      const back = new T.Mesh(new T.PlaneGeometry(GW, GH), mat["net-back"]);
      back.position.set(xc, GH / 2, Z_GOAL + 1.3); scene.add(back);
      const pts = [], D = 1.3;
      for (let x = -GW / 2; x <= GW / 2 + 1e-6; x += 0.3) pts.push(xc + x, 0, Z_GOAL + D, xc + x, GH, Z_GOAL + D, xc + x, GH, Z_GOAL + 0.06, xc + x, GH, Z_GOAL + D);
      for (let y = 0; y <= GH + 1e-6; y += 0.3) pts.push(xc - GW / 2, y, Z_GOAL + D, xc + GW / 2, y, Z_GOAL + D);
      for (const s of [-1, 1]) for (let z = 0.06; z <= D + 1e-6; z += 0.3) pts.push(xc + (s * GW) / 2, 0, Z_GOAL + z, xc + (s * GW) / 2, GH, Z_GOAL + z);
      const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
      scene.add(new T.LineSegments(g, netLine));
    });
    // where each cue flashes: a patch in front of each half of each goal
    const pulses = RULES.map((r, i) => [-1, 1].map((s, j) => flatOn(new T.PlaneGeometry(2.0, 1.5), pulseMats[i][j], R * ((i - 1) * LANE + s * 1.45), Z_GOAL - 1.05, 0.016)));

    // a figure: legs, body, head, and arms that turn at the shoulder, built from its hips
    function figure(body, limb, hand) {
      const g = new T.Group();
      const legs = [-1, 1].map((s) => { const p = new T.Group(); p.position.set(s * 0.12, 0, 0); box(0.16, 0.68, 0.18, limb, 0, -0.34, 0, p); g.add(p); return p; });
      box(0.46, 0.6, 0.26, body, 0, 0.3, 0, g);
      const head = new T.Mesh(new T.SphereGeometry(0.13, 14, 10), mat.skin); head.position.y = 0.76; g.add(head);
      const arms = [-1, 1].map((s) => {
        const p = new T.Group(); p.position.set(s * 0.29, 0.54, 0);
        box(0.11, 0.56, 0.11, limb, 0, -0.28, 0, p);
        if (hand) box(0.15, 0.13, 0.15, hand, 0, -0.6, 0, p);
        g.add(p); return p;
      });
      const shadow = new T.Mesh(new T.PlaneGeometry(0.9, 0.9), mat.shadow); shadow.rotation.x = -Math.PI / 2;
      scene.add(shadow);
      scene.add(g);
      return { g, legs, arms, shadow };
    }
    const keepers = RULES.map((r) => figure(mat[`kit-${r.key}`], mat[`kit-${r.key}`], mat[`glove-${r.key}`]));
    const kickers = RULES.map(() => figure(mat.kicker, mat["kicker-2"], null));
    // the balls themselves are drawn over the scene as printed discs (drawHud); here, their shadows
    const balls = RULES.map(() => {
      const sh = new T.Mesh(new T.PlaneGeometry(0.42, 0.42), mat.shadow); sh.rotation.x = -Math.PI / 2; scene.add(sh);
      return { sh };
    });

    const { col, mixed } = colorKit(T);
    function paint() {
      const c = st.colors, dark = c.dark;
      scene.background = col(c.print);
      scene.fog.color.copy(col(c.print));
      mat.ground.color = col(c.print);
      mat.stripe.color = mixed(c.print, c["print-ink"], dark ? 0.04 : 0.045);
      mat.chalk.color = mixed(c.print, c["print-ink"], dark ? 0.32 : 0.28);
      mat.post.color = dark ? mixed(c["print-ink"], c.print, 0.12) : col(c.print);
      mat["net-back"].color = mixed(c.print, c["print-ink"], 0.06); mat["net-back"].opacity = 0.5;
      netLine.color.copy(mixed(c.print, c["print-ink"], dark ? 0.4 : 0.35)); netLine.opacity = 0.7;
      mat.kicker.color = mixed(c.print, c["print-ink"], dark ? 0.45 : 0.5);
      mat["kicker-2"].color = mixed(c.print, c["print-ink"], dark ? 0.3 : 0.32);
      mat.skin.color = mixed(c.print, c["print-ink"], dark ? 0.6 : 0.18);
      for (const r of RULES) {
        mat[`kit-${r.key}`].color = col(c[r.key]);
        mat[`glove-${r.key}`].color = mixed(c[r.key], c.print, dark ? 0.45 : 0.4);
      }
      edge.color.copy(col(dark ? c.print : c["print-ink"])); edge.opacity = dark ? 0.8 : 0.6;
      mat.shadow.color = col(dark ? "#000000" : c["print-ink"]); mat.shadow.opacity = dark ? 0 : 0.12;
      const sk = document.createElement("canvas"); sk.width = 4; sk.height = 128;
      const sctx = sk.getContext("2d"), grad = sctx.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, c.print); grad.addColorStop(0.72, c.print);
      grad.addColorStop(1, `#${mixed(c.print, dark ? c.hot : c["print-dim"], dark ? 0.18 : 0.1).getHexString()}`);
      sctx.fillStyle = grad; sctx.fillRect(0, 0, 4, 128);
      if (mat.sky.map) mat.sky.map.dispose();
      mat.sky.map = new T.CanvasTexture(sk); mat.sky.map.colorSpace = T.SRGBColorSpace;
      mat.sky.needsUpdate = true;
      pulseMats.forEach((pair) => { pair[0].color.copy(col(c.left)); pair[1].color.copy(col(c.right)); });
    }
    paint();

    function pose(f, x, y, z, roll, legSwing, armOut, armUp) {
      f.g.position.set(x, HIP + y, z);
      f.g.rotation.z = roll;
      f.legs[0].rotation.x = legSwing; f.legs[1].rotation.x = -legSwing;
      // arms out at the side, or raised over the head toward the dive
      f.arms[0].rotation.z = -armOut - armUp * (Math.PI - 0.2 - armOut);
      f.arms[1].rotation.z = armOut + armUp * (Math.PI - 0.2 - armOut);
      f.shadow.position.set(x, 0.02, z);
      f.shadow.scale.set(1 + 1.4 * Math.abs(Math.sin(roll)), 1, 1);
    }
    // Behind the spots and above them, as far back as it takes for the three goals, their nets, and
    // the kickers' run-ups to fit between the gauges and the cost strip; higher on a narrow screen,
    // so the pitch fills the height a phone has to give.
    let fitFor = "";
    const corners = [];
    // the far side: the goals and their nets; the near side: the kickers' run-ups
    for (const x of [-1, 1]) for (const y of [0, GH + 0.15]) corners.push(new T.Vector3(x * (LANE + GW / 2 + 0.35), y, Z_GOAL + 1.4), new T.Vector3(x * (LANE + 1.7), y, -3.6));
    const q = new T.Vector3();
    function fit(w, h) {
      const el = camera.aspect < 1 ? 0.78 : camera.aspect < 1.4 ? 0.6 : 0.5;
      const yHi = 1 - (2 * 74) / h, yLo = -1 + (2 * 66) / h, mid = (yHi + yLo) / 2;
      const dir = new T.Vector3(0, Math.sin(el), -Math.cos(el)), up = new T.Vector3(0, Math.cos(el), Math.sin(el));
      const target = new T.Vector3(0, 0.5, (Z_GOAL - 3.8) / 2);
      const place = (d) => { camera.position.copy(target).addScaledVector(dir, d); camera.lookAt(target); camera.updateMatrixWorld(); };
      const span = () => {
        let x = 0, lo = Infinity, hi = -Infinity;
        for (const c of corners) { q.copy(c).project(camera); x = Math.max(x, Math.abs(q.x)); lo = Math.min(lo, q.y); hi = Math.max(hi, q.y); }
        return { x, lo, hi };
      };
      for (let pass = 0; pass < 3; pass++) {
        let a = 4, b = 400;
        for (let i = 0; i < 40; i++) {
          const d = (a + b) / 2; place(d);
          const s = span();
          if (s.x <= 0.96 && s.hi - s.lo <= yHi - yLo) b = d; else a = d;
        }
        place(b);
        // center the box between the bands: move the camera and its target along the screen's up
        const s = span(), off = ((s.hi + s.lo) / 2 - mid) * b * Math.tan((camera.fov * Math.PI) / 360);
        target.addScaledVector(up, off);
        place(b);
      }
    }
    function render(w, h) {
      const dpr = Math.min(devicePixelRatio || 1, w < 600 ? 1.5 : 2);
      if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
      const size = renderer.getSize(new T.Vector2());
      if (size.x !== w || size.y !== h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
      if (fitFor !== `${w}x${h}`) { fit(w, h); fitFor = `${w}x${h}`; }
      const t = st.t;
      RULES.forEach((r, i) => {
        const xc = R * (i - 1) * LANE, s = keeperAt(r.key, t), k = keepers[i];
        // the keeper: on its toes until it commits, then across, then off the ground
        const bob = s.decided ? 0 : 0.03 * Math.abs(Math.sin(t * 9 + i));
        pose(k, xc + s.x, s.y + bob, Z_GOAL - 0.35, s.roll, 0.12 * s.ready, 0.55 * (1 - s.arms) + 0.15, s.arms);
        // the kicker: a run-up from the side, the strike, the follow-through
        const run = clamp01(t / (KICK - 0.02)), kx = xc + R * (-1.25 + 0.88 * run), kz = -3.3 + 2.85 * run;
        const stride = t < KICK ? Math.sin(t * 19) * 0.55 : 0, strike = clamp01((t - KICK + 0.06) / 0.12) * (1 - clamp01((t - KICK - 0.3) / 0.4));
        pose(kickers[i], kx, t < KICK ? 0.04 * Math.abs(Math.sin(t * 19)) : 0, kz, 0, stride - 1.1 * strike, 0.35, 0);
        const b = ballAt(i, t);
        balls[i].sh.position.set(b.x, 0.015, Math.min(b.z, Z_GOAL + 1.2));
        const on = st.run.decide[r.key].n > Math.floor(t / DT + 1e-9);
        pulses[i][0].material.opacity = 0.6 * st.pulses[i][0] * (on ? 1 : 0);
        pulses[i][1].material.opacity = 0.6 * st.pulses[i][1] * (on ? 1 : 0);
      });
      renderer.render(scene, camera);
    }
    const v = new T.Vector3();
    function project(x, y, z) {
      v.set(x, y, z).project(camera);
      const w = stage.clientWidth, h = stage.clientHeight;
      return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, visible: v.z < 1 && v.z > -1 };
    }
    return { paint, render, project };
  }

  scene.start();
}
