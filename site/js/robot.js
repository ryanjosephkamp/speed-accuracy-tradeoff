// The walking robot, in 3D. Three robots side by side walk toward the same kind of rock, with firm
// ground on one side and loose scree on the other. They take the same sensor readings
// (robot-model.js) and differ only in their walls: the best walls, the 2025 rule, and the
// look-ahead rule. A doubt costs most as each foot comes down, so the walls breathe with the
// steps: the 2025 rule's in time with the cost and far, the best walls a little ahead of it and
// much less. Each reading flashes on its side of the rock; the gauge over each robot shows how far
// its readings lean and where its walls are now; at a wall it moves across to pass on that side,
// and a robot on the scree slips. The strip along the bottom is the cost of a moment's doubt, with
// a tick at each footfall. A switch makes the cost steady, the 2025 rule's own case. The reader
// can see which side is firm; the robots can't.
//
// The scene's plumbing (controls, clock, gauges, loading) is lanes-scene.js. Without WebGL the same
// run is drawn from above on a plain canvas.
import { robotModel, robotCost, robotNumbers, ROBOT, ROWS } from "./robot-model.js";
import { RULES } from "./lanes.js";
import { DT } from "./lattice.js";
import { laneScene, colorKit, reduced, R, smooth, clamp01 } from "./lanes-scene.js";

const V = ROBOT.speed;          // meters per second of story time
const STEP = ROBOT.step;        // seconds between footfalls
const FIRST = ROBOT.first;      // the first footfall
const ROCK = ROBOT.rock;        // the last moment to choose a side
const LANE = 3.2;               // meters between lane centers
const Z_LINE = V * ROCK;        // where the robots are at the last moment to choose
const Z_ROCK = Z_LINE + 1.1;    // the rock's center
const SIDE = 0.95;              // how far a robot moves across to pass the rock
const ACROSS = 0.6, FORCED_ACROSS = 0.45; // story seconds to move across
const Z_SCREE = Z_ROCK - 0.85;  // where the loose ground starts
const T_END = (Z_ROCK + 0.95) / V;
const RATE = { reading: 0.26, after: 1.4, ease: 0.3 }; // story seconds per real second
const KMAX = 20;                // the gauges' half width, in readings
// the robot: hips, thigh, shin, the ankle above the sole, a foot under each hip
const HIP = 0.74, THIGH = 0.4, SHIN = 0.38, ANKLE = 0.05, FOOT_X = 0.12;
const STANCE = 0.6;             // seconds each foot stays down in its 1 s cycle
const REACH = (V * STANCE) / 2; // where a foot lands, ahead of the hips
const PRINTS = 14;              // footprints kept per robot

export function initRobot() {
  const root = document.getElementById("robot");
  if (!root) return;
  const models = { step: robotModel(false), steady: robotModel(true) };
  const nums = robotNumbers(models.step, models.steady);
  for (const el of root.querySelectorAll("[data-rb-n]")) if (typeof nums[el.dataset.rbN] === "string") el.textContent = nums[el.dataset.rbN];
  let st = null, steady = false;
  const cost = (t) => robotCost(t, steady);

  // ------------------------------------------------------------ where each robot is
  /** A rule's robot at story time t: its hips across (x, from the lane's center) and along (z),
   * how far into a slip it is, and its state. */
  function robotAt(key, t) {
    const d = st.run.decide[key], td = d.n * DT, decided = t >= td - 1e-9;
    const across = d.forced ? FORCED_ACROSS : ACROSS;
    const xAt = (u) => (u >= td ? R * d.choice * SIDE * smooth((u - td) / across) : 0);
    // a robot that chose the loose side slips once it is across and onto the scree
    const loose = decided && !d.correct;
    const tSlip = loose ? Math.max(Z_SCREE / V, td + 0.8 * across) : Infinity;
    const slip = clamp01((t - tSlip) / 0.55);
    const tg = Math.min(t, tSlip); // the gait stops where the slip starts
    const z = V * tg + 0.32 * smooth(slip);
    const passed = decided && !loose && z > Z_ROCK + 0.4;
    return { x: xAt(tg), z, xAt, tg, tSlip, slip, decided, d, loose, passed, slipped: slip > 0 };
  }
  /** A foot at gait time t (0 left, 1 right): planted where it last landed, or on its way to the
   * next landing, lifted in an arc. */
  function footAt(s, t, foot) {
    const cycle = 2 * STEP, base = FIRST + foot * STEP;
    const tf = base + Math.floor((t - base) / cycle) * cycle, since = t - tf;
    const side = (foot ? R : -R) * FOOT_X;
    const plant = (u) => ({ x: s.xAt(u) + side, z: V * u + REACH });
    const a = plant(tf);
    if (since < STANCE) return { ...a, y: 0, down: true, tf };
    const b = plant(tf + cycle), u = (since - STANCE) / (cycle - STANCE), e = smooth(u);
    return { x: a.x + (b.x - a.x) * e, z: a.z + (b.z - a.z) * e, y: 0.11 * Math.sin(Math.PI * u), down: false, tf };
  }

  const scene = laneScene(root, {
    key: "robot", data: "rb", model: models.step, salt: 0x510e527f,
    words: { one: "rock", many: "rocks", who: "robot", did: "picked the firm side at", at: "At the rock" },
    end: T_END, rate: RATE, kmax: KMAX,
    // readings matter until the last robot has chosen, or the rock
    reading: (t) => t < ROCK && RULES.some((r) => st.run.decide[r.key].n * DT > t - 1e-9),
    at: robotAt,
    status(run, t, n) {
      const side = run.z > 0 ? "right" : "left", row = Math.min(Math.floor(t / DT + 1e-9), ROWS);
      if (t >= ROCK) return `Rock ${n}: past the last step to choose. The ${side} side was firm.`;
      if (RULES.some((r) => run.decide[r.key].n > row)) return `Rock ${n}: reading ${row} of ${ROWS}, ${t.toFixed(2)} s. The ${side} side is firm.`;
      return `Rock ${n}: all three have chosen, ${t.toFixed(2)} s in. The ${side} side is firm.`;
    },
    gaugeAt: (i, s) => [R * (i - 1) * LANE + s.x, 0, s.z],
    gaugeLine(s, pct, small) {
      if (!s.decided) return small ? `${pct}% TO CHOOSE` : `${pct}% SURE TO CHOOSE`;
      const way = s.d.choice > 0 ? "RIGHT" : "LEFT", forced = s.d.forced ? "FORCED" : "";
      if (s.slipped) return forced ? "FORCED, SLIPPED" : "SLIPPED";
      if (s.passed) return forced ? "FORCED, FIRM" : "FIRM GROUND";
      return `${forced || "GOES"} ${way}`;
    },
    // the line: the last step on which a robot can still choose its side of the rock
    under(ctx, { w, project, font, small }) {
      const c = st.colors, a = project(R * (-LANE * 1.5 - 0.1), 0, Z_LINE);
      if (!a.visible || a.y < 70) return;
      ctx.font = `700 ${small ? 9.5 : 10.5}px ${font}`; ctx.textBaseline = "bottom"; ctx.textAlign = "left";
      const txt = "LAST STEP TO CHOOSE", tw = ctx.measureText(txt).width;
      const x = Math.max(4, Math.min(a.x, w - tw - 6));
      ctx.fillStyle = c.print; ctx.globalAlpha = 0.8; ctx.fillRect(x - 3, a.y - 15, tw + 6, 14); ctx.globalAlpha = 1;
      ctx.fillStyle = c["accent-print"]; ctx.fillText(txt, x, a.y - 2);
    },
    over(ctx, g) { drawCost(ctx, g); },
    onSeek() { if (steady) setSteady(false); },
    flat: { project: flat, draw: drawFlat },
    build3: (T, api) => scene3(T, api),
  });
  st = scene.st;

  // ------------------------------------------------------------ the switch: with each step, or steady
  const seg = root.querySelector(".rb-cost");
  function setSteady(on) {
    steady = on;
    for (const input of seg.querySelectorAll("input")) input.checked = input.value === (on ? "steady" : "step");
    root.classList.toggle("is-steady", on);
    scene.setModel(on ? models.steady : models.step);
  }
  seg.addEventListener("change", (e) => setSteady(e.target.value === "steady"));

  /** The cost of a moment's doubt from first sight to the rock, a tick at each footfall, and now. */
  function drawCost(ctx, { w, h, font, small }) {
    const c = st.colors, x0 = 14, x1 = w - 14, base = h - 12, top = h - 40;
    const cMax = ROBOT.c0 * (1 + ROBOT.swing), X = (t) => x0 + ((x1 - x0) * t) / ROCK, Y = (v) => base - ((base - top) * v) / cMax;
    ctx.save();
    ctx.fillStyle = c.print; ctx.globalAlpha = 0.78; ctx.fillRect(0, top - 18, w, h - top + 18); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(X(0), base);
    for (let i = 0; i <= 240; i++) { const t = (ROCK * i) / 240; ctx.lineTo(X(t), Y(cost(t))); }
    ctx.lineTo(X(ROCK), base); ctx.closePath();
    ctx.fillStyle = c["accent-print"]; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = c["print-line"]; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, base + 0.5); ctx.lineTo(x1, base + 0.5); ctx.stroke();
    // a tick under each footfall
    ctx.strokeStyle = c["print-dim"];
    for (let f = FIRST; f < ROCK; f += STEP) { ctx.beginPath(); ctx.moveTo(X(f), base + 1); ctx.lineTo(X(f), base + 5); ctx.stroke(); }
    // the rock
    ctx.strokeStyle = c["accent-print"]; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(X(ROCK) - 0.5, top - 6); ctx.lineTo(X(ROCK) - 0.5, base); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = `700 ${small ? 9.5 : 10.5}px ${font}`; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = c["print-dim"]; ctx.textAlign = "left"; ctx.fillText(steady ? "COST OF DOUBT, STEADY" : "COST OF DOUBT, PEAKING AT EACH FOOTFALL", x0, top - 6);
    ctx.fillStyle = c["accent-print"]; ctx.textAlign = "right"; ctx.fillText("ROCK", X(ROCK) - 5, top - 6);
    // now
    const t = Math.min(st.t, ROCK), x = X(t);
    ctx.strokeStyle = c["print-ink"]; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, top - 2); ctx.lineTo(x, base); ctx.stroke();
    ctx.fillStyle = c["print-ink"]; ctx.beginPath(); ctx.arc(x, Y(cost(t)), 3, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------ without WebGL: the same run from above
  function flat(w, h) {
    const top = 88, bottom = h - 64, zMin = -0.6, zMax = Z_ROCK + 1.6;
    const sx = Math.min(w / (LANE * 3.4), 60);
    return (x, y, z) => ({ x: w / 2 + R * x * sx, y: bottom - ((z - zMin) / (zMax - zMin)) * (bottom - top) - y * 8, visible: true });
  }
  function drawFlat(ctx, w, h, P) {
    const c = st.colors;
    ctx.fillStyle = c.print; ctx.fillRect(0, 0, w, h);
    RULES.forEach((r, i) => {
      const xc = R * (i - 1) * LANE;
      const a = P(xc - LANE / 2 + 0.3, 0, -0.6), b = P(xc + LANE / 2 - 0.3, 0, Z_ROCK + 1.6);
      ctx.fillStyle = c["print-2"]; ctx.fillRect(Math.min(a.x, b.x), b.y, Math.abs(b.x - a.x), a.y - b.y);
      ctx.fillStyle = c["accent-print"];
      for (const [dx, dz] of [[-0.3, -0.5], [0.2, -0.2], [-0.1, 0.3], [0.3, 0.5], [-0.35, 0.1]]) { const q = P(xc - R * st.run.z * SIDE + dx, 0, Z_ROCK + dz); ctx.beginPath(); ctx.arc(q.x, q.y, 2.5, 0, 2 * Math.PI); ctx.fill(); }
      const rock = P(xc, 0, Z_ROCK);
      ctx.fillStyle = c["print-dim"]; ctx.beginPath(); ctx.arc(rock.x, rock.y, 9, 0, 2 * Math.PI); ctx.fill();
      const s = robotAt(r.key, st.t), q = P(xc + s.x, 0, s.z);
      ctx.fillStyle = c[r.key]; ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, 2 * Math.PI); ctx.fill();
    });
    const l1 = P(-LANE * 1.5, 0, Z_LINE), l2 = P(LANE * 1.5, 0, Z_LINE);
    ctx.strokeStyle = c["accent-print"]; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(l1.x, l1.y); ctx.lineTo(l2.x, l2.y); ctx.stroke(); ctx.setLineDash([]);
  }

  // ------------------------------------------------------------ the 3D scene, once it is near
  function scene3(T, { glCv, stage }) {
    const renderer = new T.WebGLRenderer({ canvas: glCv, antialias: true, powerPreference: "low-power" });
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(30, 1, 0.3, 200);
    scene.fog = new T.Fog(0x000000, 30, 70);
    // flat fills with drawn edges, like the prints
    const mat = {}, M = (key, opts = {}) => (mat[key] = new T.MeshBasicMaterial(opts));
    for (const k of ["ground", "path", "edge-line", "line", "rock", "scree", "loose", "limb", "foot", "head"]) M(k);
    for (const r of RULES) { M(`body-${r.key}`); M(`print-${r.key}`, { transparent: true, depthWrite: false }); }
    M("shadow", { transparent: true, depthWrite: false });
    M("sky", { depthWrite: false, fog: false });
    const edge = new T.LineBasicMaterial({ transparent: true });
    const pulseMats = [0, 1, 2].map(() => [0, 1].map(() => new T.MeshBasicMaterial({ transparent: true, depthWrite: false })));

    const flatOn = (geo, m, x, z, y = 0.01, parent = scene) => { const mesh = new T.Mesh(geo, m); mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); parent.add(mesh); return mesh; };
    const withEdges = (mesh) => { mesh.add(new T.LineSegments(new T.EdgesGeometry(mesh.geometry, 20), edge)); return mesh; };
    const box = (w, h, d, m, x = 0, y = 0, z = 0, parent = scene) => { const b = withEdges(new T.Mesh(new T.BoxGeometry(w, h, d), m)); b.position.set(x, y, z); parent.add(b); return b; };

    // the ground, a worn path down each lane, and the line
    flatOn(new T.PlaneGeometry(200, 200), mat.ground, 0, 30, 0);
    const sky = new T.Mesh(new T.PlaneGeometry(200, 40), mat.sky);
    sky.position.set(0, 12, 60); sky.rotation.y = Math.PI; scene.add(sky);
    RULES.forEach((r, i) => {
      const xc = R * (i - 1) * LANE;
      flatOn(new T.PlaneGeometry(LANE - 0.7, 60), mat.path, xc, 25, 0.004);
      for (const s of [-1, 1]) flatOn(new T.PlaneGeometry(0.05, 60), mat["edge-line"], xc + s * (LANE / 2 - 0.35), 25, 0.008);
    });
    flatOn(new T.PlaneGeometry(LANE * 3, 0.06), mat.line, 0, Z_LINE, 0.012);
    // the rocks, and the loose ground on one side of each: a patch, and scree on it
    const looses = [];
    const rand = ((a) => () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 2 ** 32; })(20261113);
    RULES.forEach((r, i) => {
      const xc = R * (i - 1) * LANE;
      // a low-poly sphere, squashed and turned, reads as a rock in flat fills with drawn edges
      const rock = withEdges(new T.Mesh(new T.SphereGeometry(0.5, 7, 5), mat.rock));
      rock.scale.set(1.15, 0.8, 1.05); rock.rotation.set(0.3, 0.7 + i, 0.1); rock.position.set(xc, 0.3, Z_ROCK); scene.add(rock);
      const g = new T.Group();
      const patch = new T.Mesh(new T.CylinderGeometry(1, 1, 0.002, 9), mat.loose);
      patch.scale.set(0.62, 1, 1.15); patch.position.y = 0.006; g.add(patch);
      for (let k = 0; k < 26; k++) {
        const a = rand() * 2 * Math.PI, rr = Math.sqrt(rand());
        const peb = new T.Mesh(new T.SphereGeometry(0.035 + 0.05 * rand(), 5, 3), mat.scree);
        peb.position.set(Math.cos(a) * rr * 0.55, 0.02, Math.sin(a) * rr * 1.0);
        peb.scale.y = 0.5; peb.rotation.set(rand(), rand(), rand());
        g.add(peb);
      }
      g.position.set(xc, 0, Z_ROCK);
      scene.add(g); looses.push({ g, xc });
    });
    // where each reading flashes: a patch on the ground on each side, before the rock
    const pulses = RULES.map((r, i) => [-1, 1].map((s, j) => flatOn(new T.PlaneGeometry(0.85, 1.1), pulseMats[i][j], R * ((i - 1) * LANE + s * SIDE), Z_ROCK - 1.55, 0.014)));

    // a robot: hips, a body with a sensor head, and two legs that bend at the knee and keep their
    // feet flat; the legs are set by two-link inverse kinematics from where each foot is
    function robot(key) {
      const g = new T.Group();
      const upper = new T.Group(); upper.position.y = HIP; g.add(upper);
      box(0.32, 0.1, 0.2, mat.limb, 0, 0, 0, upper);
      box(0.38, 0.42, 0.26, mat[`body-${key}`], 0, 0.28, 0, upper);
      box(0.25, 0.15, 0.21, mat.head, 0, 0.6, 0.01, upper);
      const puck = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 0.05, 14), mat.foot); puck.position.set(0, 0.7, 0); upper.add(puck);
      const legs = [0, 1].map((foot) => {
        const hip = new T.Group(); hip.position.set((foot ? R : -R) * FOOT_X, HIP, 0); g.add(hip);
        box(0.09, THIGH, 0.11, mat.limb, 0, -THIGH / 2, 0, hip);
        const knee = new T.Group(); knee.position.y = -THIGH; hip.add(knee);
        box(0.08, SHIN, 0.1, mat.limb, 0, -SHIN / 2, 0, knee);
        const ankle = new T.Group(); ankle.position.y = -SHIN; knee.add(ankle);
        box(0.12, ANKLE, 0.24, mat.foot, 0, -ANKLE / 2, 0.04, ankle);
        return { hip, knee, ankle };
      });
      const shadow = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 0.002, 16), mat.shadow); shadow.scale.set(0.62, 1, 0.8); shadow.position.y = 0.012; g.add(shadow);
      scene.add(g);
      // footprints, like the car's track: where this robot's feet have landed on this run
      const sole = new T.CylinderGeometry(0.5, 0.5, 0.002, 12);
      const prints = Array.from({ length: PRINTS }, () => { const m = new T.Mesh(sole, mat[`print-${key}`]); m.scale.set(0.1, 1, 0.19); scene.add(m); return m; });
      const pin = flatOn(new T.PlaneGeometry(0.26, 0.26), mat[`print-${key}`], 0, 0, 0.02);
      pin.rotation.z = Math.PI / 4;
      return { g, upper, legs, prints, pin };
    }
    const robots = RULES.map((r) => robot(r.key));

    const { col, mixed } = colorKit(T);
    function paint() {
      const c = st.colors, dark = c.dark;
      scene.background = col(c.print);
      scene.fog.color.copy(col(c.print));
      mat.ground.color = col(c.print);
      mat.path.color = mixed(c.print, c["print-ink"], dark ? 0.06 : 0.05);
      mat["edge-line"].color = mixed(c.print, c["print-ink"], dark ? 0.2 : 0.16);
      mat.line.color = col(c["accent-print"]);
      mat.rock.color = mixed(c.print, c["print-ink"], dark ? 0.42 : 0.3);
      mat.scree.color = col(c["accent-print"]);
      mat.loose.color = mixed(c.print, c["accent-print"], dark ? 0.16 : 0.12);
      mat.limb.color = mixed(c.print, c["print-ink"], dark ? 0.55 : 0.5);
      mat.foot.color = mixed(c.print, c["print-ink"], dark ? 0.75 : 0.72);
      mat.head.color = mixed(c.print, c["print-ink"], dark ? 0.3 : 0.25);
      for (const r of RULES) {
        mat[`body-${r.key}`].color = col(c[r.key]);
        mat[`print-${r.key}`].color = col(c[r.key]); mat[`print-${r.key}`].opacity = 0.55;
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

    /** A leg from the hip to where its foot is, in the side view: the thigh, the knee's bend, and
     * the ankle that keeps the sole flat (lifted a little at the toe in the air). */
    function setLeg(leg, hipY, hipZ, f) {
      const dz = f.z - hipZ, dy = f.y + ANKLE - hipY;
      const d = Math.min(Math.max(Math.hypot(dz, dy), 0.25), THIGH + SHIN - 0.004);
      const along = Math.atan2(dz, -dy);
      const atHip = Math.acos((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d));
      const atKnee = Math.acos((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN));
      leg.hip.rotation.x = -(along + atHip);
      leg.knee.rotation.x = Math.PI - atKnee;
      leg.ankle.rotation.x = -(leg.hip.rotation.x + leg.knee.rotation.x) - (f.down ? 0 : 0.25 * Math.sin(Math.PI * clamp01(f.y / 0.11)));
    }

    // Behind the robots and above them, far enough back for the three lanes, the robots, and the
    // rocks ahead to fit between the gauges and the cost strip; the camera then follows the robots.
    let fitFor = "";
    const target0 = new T.Vector3(), cam0 = new T.Vector3();
    const corners = [];
    for (const x of [-1, 1]) for (const y of [0, 1.5]) corners.push(new T.Vector3(x * (LANE + 0.75), y, -0.4), new T.Vector3(x * (LANE + 0.75), y, Z_ROCK + 0.7));
    const q = new T.Vector3();
    function fit(w, h) {
      // steeper on a narrow screen, so the approach fills the height a phone has to give
      const el = camera.aspect < 1 ? 1.0 : camera.aspect < 1.4 ? 0.62 : 0.5;
      const yHi = 1 - (2 * 74) / h, yLo = -1 + (2 * 64) / h, mid = (yHi + yLo) / 2;
      const dir = new T.Vector3(0, Math.sin(el), -Math.cos(el)), up = new T.Vector3(0, Math.cos(el), Math.sin(el));
      const target = new T.Vector3(0, 0.5, (Z_ROCK + 0.3) / 2);
      const place = (d) => { camera.position.copy(target).addScaledVector(dir, d); camera.lookAt(target); camera.updateMatrixWorld(); };
      const span = () => {
        let x = 0, lo = Infinity, hi = -Infinity;
        for (const c of corners) { q.copy(c).project(camera); x = Math.max(x, Math.abs(q.x)); lo = Math.min(lo, q.y); hi = Math.max(hi, q.y); }
        return { x, lo, hi };
      };
      let b = 20;
      for (let pass = 0; pass < 3; pass++) {
        let a = 2; b = 200;
        for (let i = 0; i < 40; i++) {
          const d = (a + b) / 2; place(d);
          const s = span();
          if (s.x <= 0.97 && s.hi - s.lo <= yHi - yLo) b = d; else a = d;
        }
        place(b);
        const s = span(), off = ((s.hi + s.lo) / 2 - mid) * b * Math.tan((camera.fov * Math.PI) / 360);
        target.addScaledVector(up, off);
        place(b);
      }
      target0.copy(target); cam0.copy(camera.position);
    }
    // how far the camera has moved along with the robots
    let camZ = 0;
    const follow = () => Math.min(Math.max(V * Math.min(st.t, T_END) - 1.6, 0), Z_ROCK - 2.2);

    function placeSides(z) {
      // the loose ground lies on the side that is not firm
      looses.forEach(({ g, xc }) => g.position.set(xc - R * z * SIDE, 0, Z_ROCK));
    }
    function render(w, h) {
      const dpr = Math.min(devicePixelRatio || 1, w < 600 ? 1.5 : 2);
      if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
      const size = renderer.getSize(new T.Vector2());
      if (size.x !== w || size.y !== h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
      if (fitFor !== `${w}x${h}`) { fit(w, h); fitFor = `${w}x${h}`; }
      const want = follow();
      camZ = reduced.matches ? want : camZ + (want - camZ) * 0.1;
      camera.position.copy(cam0).add(q.set(0, 0, camZ));
      camera.lookAt(target0.x, target0.y, target0.z + camZ);
      const t = st.t;
      RULES.forEach((r, i) => {
        const xc = R * (i - 1) * LANE, s = robotAt(r.key, t), rb = robots[i];
        // the hips bob, lowest as each foot lands; slipping, they drop and the body tips back
        const bob = -0.022 * Math.cos((2 * Math.PI * (s.tg - FIRST)) / STEP);
        const sl = smooth(s.slip), hipY = HIP + bob * (1 - sl) - 0.36 * sl;
        rb.g.position.set(xc + s.x, 0, s.z);
        rb.upper.position.y = hipY;
        for (const leg of rb.legs) leg.hip.position.y = hipY;
        const dx = s.decided ? (s.xAt(s.tg + 0.02) - s.xAt(s.tg - 0.02)) / 0.04 : 0;
        rb.upper.rotation.set(-0.55 * sl, 0.5 * Math.atan2(dx, V) * (1 - sl), (s.slipped ? 0.35 * sl * Math.sign(R * s.d.choice) : 0));
        // the feet: where the gait puts them; in a slip the front foot slides out ahead
        [0, 1].forEach((foot) => {
          const f = footAt(s, s.tg, foot);
          const lead = foot === (Math.floor((s.tg - FIRST) / STEP) & 1 ? 1 : 0);
          const fz = f.z + (lead ? 0.42 : 0.05) * sl, fy = f.y * (1 - sl);
          setLeg(rb.legs[foot], hipY, s.z, { x: f.x, y: fy, z: fz, down: f.down || sl > 0 });
        });
        // footprints where this robot's feet have landed, and the spot where it chose
        let k = 0;
        for (let tf = FIRST; tf <= s.tg + 1e-9 && k < PRINTS; tf += STEP, k++) {
          const foot = Math.round((tf - FIRST) / STEP) & 1, side = (foot ? R : -R) * FOOT_X;
          rb.prints[k].visible = true;
          rb.prints[k].position.set(xc + s.xAt(tf) + side, 0.016, V * tf + REACH + 0.04);
        }
        for (; k < PRINTS; k++) rb.prints[k].visible = false;
        const td = s.d.n * DT;
        rb.pin.visible = s.decided;
        if (s.decided) rb.pin.position.set(xc + s.xAt(td), 0.02, V * td);
        const on = st.run.decide[r.key].n > Math.floor(t / DT + 1e-9);
        pulses[i][0].material.opacity = 0.6 * st.pulses[i][0] * (on ? 1 : 0);
        pulses[i][1].material.opacity = 0.6 * st.pulses[i][1] * (on ? 1 : 0);
      });
      renderer.render(scene, camera);
    }
    const v = new T.Vector3();
    function project(x, y, z) {
      v.set(x, y, z).project(camera);
      return { x: (v.x * 0.5 + 0.5) * stage.clientWidth, y: (-v.y * 0.5 + 0.5) * stage.clientHeight, visible: v.z < 1 && v.z > -1 };
    }
    const moving = () => Math.abs(follow() - camZ) > 0.01;
    return { paint, render, project, moving, onRun: (run) => placeSides(run.z) };
  }

  scene.start();
}
