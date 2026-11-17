// The driverless car, in 3D. Three cars side by side, each closing on the same kind of obstacle,
// get the same noisy readings (car-model.js); they differ only in their walls: the best walls, the
// 2025 rule, and the look-ahead rule. Each reading flashes on the side of the obstacle it points
// to; the gauge over each car shows how far its readings lean and where its walls are now; at a
// wall it swerves. The reader can see which side is clear; the cars can't.
//
// Three.js (a minified bundle of the parts used here, js/vendor/three.min.js) loads only when the
// scene comes near the screen. Colors come from the page's tokens and are read again when the
// theme or its dial changes, so the scene is ink on paper in the light theme and a night print in
// the dark one. Without WebGL the same run is drawn from above on a plain canvas.
import { carWalls, RULES, ROWS, CAR } from "./car-model.js";
import { DT } from "./lattice.js";
import { laneScene, reduced, R, smooth } from "./lanes-scene.js";

const LANE = 6;                       // meters between lane centers
const SIDE = 1.9;                     // how far a car moves to pass the obstacle
const Z_LINE = CAR.speed * CAR.deadline; // the last moment to swerve, 20 m from the start
const Z_OB = 34;                      // the obstacle's center
const Z_HIT = Z_OB - 1.9;             // where a car on the blocked side meets the cones
const SWERVE = 0.5;                   // seconds of story time to move across
const T_END = 2.05;                   // the story's end for one car
const RATE = { reading: 0.26, after: 0.6 }; // story seconds per real second
const KMAX = 14;                      // the gauge's half width, in readings
const TRAIL_N = 90;                   // samples along each car's track

export function initCar() {
  const root = document.getElementById("car");
  if (!root) return;
  const model = carWalls();
  const carNums = { forcedPm: String(Math.round(100 * model.exact.pm.forced)), lossPm: (model.exact.ex.points - model.exact.pm.points).toFixed(2), lossWb: (model.exact.ex.points - model.exact.wb.points).toFixed(2) };
  for (const el of root.querySelectorAll("[data-car-n]")) if (carNums[el.dataset.carN]) el.textContent = carNums[el.dataset.carN];
  let st = null;

  /** Where a rule's car is at story time t: lateral offset, distance, and its state. */
  function carAt(key, t) {
    const d = st.run.decide[key], td = d.n * DT, decided = t >= td - 1e-9;
    const u = decided ? smooth((t - td) / SWERVE) : 0;
    let z = CAR.speed * t, stopped = false;
    const blocked = decided && !d.correct;
    if (blocked) {
      // a car that chose the blocked side runs into the cones: it stops dead at contact, with a
      // small jolt back
      if (z >= Z_HIT) {
        const over = Math.min((z - Z_HIT) / 3, 1);
        z = Z_HIT - 0.35 * Math.sin(Math.PI * over);
        stopped = true;
      }
    }
    const passed = !blocked && decided && z > Z_OB;
    return { x: R * d.choice * SIDE * u, z, decided, d, u, blocked, passed, stopped };
  }
  const fmtT = (t) => `${t.toFixed(2)} s`;

  const scene = laneScene(root, {
    key: "car", model, salt: 0x6a09e667,
    words: { one: "car", many: "cars", who: "car", did: "cleared", at: "At the line" },
    end: T_END, reading: (t) => t < CAR.deadline, rate: RATE, kmax: KMAX,
    at: carAt,
    status(run, t, n) {
      const side = run.z > 0 ? "right" : "left";
      return t < CAR.deadline
        ? `Car ${n}: reading ${Math.min(Math.floor(t / DT + 1e-9), ROWS)} of ${ROWS}, ${fmtT(t)}. The ${side} side is clear.`
        : `Car ${n}: past the last moment to swerve. The ${side} side was clear.`;
    },
    gaugeAt: (i, s) => [R * (i - 1) * LANE, 0, s.z],
    gaugeLine(s, pct, small) {
      let line;
      if (!s.decided) line = `${pct}% SURE TO SWERVE`;
      else if (s.blocked) line = s.stopped ? "INTO THE OBSTACLE" : `${s.d.forced ? "FORCED" : "SWERVED"} ${s.d.choice > 0 ? "RIGHT" : "LEFT"}`;
      else line = s.passed ? (s.d.forced ? "FORCED AT THE LINE, CLEAR" : "CLEAR") : `${s.d.forced ? "FORCED" : "SWERVED"} ${s.d.choice > 0 ? "RIGHT" : "LEFT"}`;
      if (small && line.length > 22) line = line.replace("FORCED AT THE LINE, CLEAR", "FORCED, CLEAR").replace(" SURE TO SWERVE", " TO SWERVE");
      return line;
    },
    // the line: the last moment a car can still swerve around the obstacle
    under(ctx, { w, project, font, small }) {
      const c = st.colors, a = project(R * (-LANE * 1.5 - 0.2), 0, Z_LINE);
      if (!a.visible) return;
      ctx.font = `700 ${small ? 9.5 : 10.5}px ${font}`; ctx.textBaseline = "bottom"; ctx.textAlign = "left";
      const txt = "LAST MOMENT TO SWERVE";
      const x = Math.max(4, Math.min(a.x, w - ctx.measureText(txt).width - 6));
      ctx.fillStyle = c.print; ctx.globalAlpha = 0.8; ctx.fillRect(x - 3, a.y - 15, ctx.measureText(txt).width + 6, 14); ctx.globalAlpha = 1;
      ctx.fillStyle = c["accent-print"]; ctx.fillText(txt, x, a.y - 2);
    },
    flat: { project: flat, draw: drawFlat },
    build3: (T, api) => scene3(T, api),
  });
  st = scene.st;

  // ------------------------------------------------------------ without WebGL: the same run from above
  function flat(w, h) {
    const top = 84, bottom = h - 16, zMax = Z_OB + 10;
    const sx = Math.min(w / (LANE * 3.4), 26);
    return (x, y, z) => ({ x: w / 2 + R * x * sx, y: bottom - (z / zMax) * (bottom - top) - y * 10, visible: true });
  }
  function drawFlat(ctx, w, h, P) {
    const c = st.colors;
    ctx.fillStyle = c.print; ctx.fillRect(0, 0, w, h);
    RULES.forEach((r, i) => {
      const xc = R * (i - 1) * LANE;
      const a = P(xc - LANE / 2 + 0.3, 0, 0), b = P(xc + LANE / 2 - 0.3, 0, Z_OB + 10);
      ctx.fillStyle = c["print-2"]; ctx.fillRect(Math.min(a.x, b.x), b.y, Math.abs(b.x - a.x), a.y - b.y);
      const o1 = P(xc - 0.9, 0, Z_OB - 0.6), o2 = P(xc + 0.9, 0, Z_OB + 0.6);
      ctx.fillStyle = c["print-dim"]; ctx.fillRect(Math.min(o1.x, o2.x), o2.y, Math.abs(o2.x - o1.x), o1.y - o2.y);
      const cone = P(xc - R * st.run.z * SIDE, 0, Z_OB);
      ctx.fillStyle = c.hot; ctx.beginPath(); ctx.arc(cone.x, cone.y, 4, 0, 2 * Math.PI); ctx.fill();
      const s = carAt(r.key, st.t), q = P(xc + s.x, 0, s.z);
      ctx.fillStyle = c[r.key]; ctx.fillRect(q.x - 6, q.y - 11, 12, 22);
    });
    const l1 = P(-LANE * 1.5, 0, Z_LINE), l2 = P(LANE * 1.5, 0, Z_LINE);
    ctx.strokeStyle = c["accent-print"]; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(l1.x, l1.y); ctx.lineTo(l2.x, l2.y); ctx.stroke(); ctx.setLineDash([]);
  }

  // ------------------------------------------------------------ the 3D scene, once it is near
  function scene3(T, { glCv, stage }) {
    const renderer = new T.WebGLRenderer({ canvas: glCv, antialias: true, powerPreference: "low-power" });
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(36, 1, 0.5, 260);
    const hemi = new T.HemisphereLight(0xffffff, 0x808080, 1.6);
    const sun = new T.DirectionalLight(0xffffff, 1.5);
    sun.position.set(-8, 14, -6);
    scene.add(hemi, sun);
    scene.fog = new T.Fog(0x000000, 60, 150);
    // flat fills with drawn edges, like the prints: no shading, so nothing reads as a toy
    const mat = {}, M = (key, opts = {}) => (mat[key] = new T.MeshBasicMaterial(opts));
    const flatMat = (key, opts = {}) => (mat[key] = new T.MeshBasicMaterial(opts));
    M("ground"); M("road"); M("block"); M("cone"); M("wheel");
    for (const r of RULES) { M(`body-${r.key}`); M(`cab-${r.key}`); flatMat(`trail-${r.key}`, { transparent: true, depthWrite: false, side: T.DoubleSide }); }
    flatMat("lane"); flatMat("dash"); flatMat("line"); flatMat("sky", { depthWrite: false, fog: false });
    flatMat("shadow", { transparent: true, depthWrite: false });
    flatMat("beam", { transparent: true, depthWrite: false, blending: T.AdditiveBlending });
    flatMat("lamp", { fog: false });
    const edge = new T.LineBasicMaterial({ transparent: true });
    const pulseMats = [0, 1, 2].map(() => [0, 1].map(() => new T.MeshBasicMaterial({ transparent: true, depthWrite: false })));

    const flatOn = (geo, m, x, z, y = 0.01) => { const mesh = new T.Mesh(geo, m); mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); scene.add(mesh); return mesh; };
    const withEdges = (mesh) => { const e = new T.LineSegments(new T.EdgesGeometry(mesh.geometry, 20), edge); mesh.add(e); return mesh; };
    // the ground, the three lanes, and the line
    flatOn(new T.PlaneGeometry(400, 400), mat.ground, 0, 60, 0);
    const sky = new T.Mesh(new T.PlaneGeometry(400, 60), mat.sky);
    sky.position.set(0, 20, 150); sky.rotation.y = Math.PI; scene.add(sky);
    RULES.forEach((r, i) => {
      const xc = R * (i - 1) * LANE;
      flatOn(new T.PlaneGeometry(LANE - 0.5, 260), mat.road, xc, 100, 0.005);
      for (const s of [-1, 1]) flatOn(new T.PlaneGeometry(0.12, 260), mat.lane, xc + s * (LANE / 2 - 0.25), 100, 0.012);
      for (let z = -10; z < 220; z += 6) flatOn(new T.PlaneGeometry(0.1, 2.2), mat.dash, xc, z, 0.012);
    });
    flatOn(new T.PlaneGeometry(LANE * 3, 0.2), mat.line, 0, Z_LINE, 0.016);
    // the obstacles, and the cones that block one side of each
    const cones = [];
    RULES.forEach((r, i) => {
      const xc = R * (i - 1) * LANE;
      const block = withEdges(new T.Mesh(new T.BoxGeometry(1.9, 1.05, 1.2), mat.block));
      block.position.set(xc, 0.53, Z_OB); scene.add(block);
      const g = new T.Group();
      for (const dz of [-0.9, 0, 0.9]) { const cone = new T.Mesh(new T.ConeGeometry(0.28, 0.78, 14), mat.cone); cone.position.set(0, 0.39, dz); g.add(cone); }
      scene.add(g); cones.push({ g, xc });
    });
    // where each reading flashes: a strip on the road on each side of each obstacle
    const pulses = RULES.map((r, i) => [-1, 1].map((s, j) => flatOn(new T.PlaneGeometry(1.25, 2.6), pulseMats[i][j], R * ((i - 1) * LANE + s * SIDE), Z_OB - 3.4, 0.02)));
    // the cars
    const cars = RULES.map((r) => {
      const g = new T.Group();
      const body = withEdges(new T.Mesh(new T.BoxGeometry(1.8, 0.58, 4.2), mat[`body-${r.key}`])); body.position.y = 0.52; g.add(body);
      const cab = withEdges(new T.Mesh(new T.BoxGeometry(1.5, 0.48, 2.0), mat[`cab-${r.key}`])); cab.position.set(0, 1.03, -0.35); g.add(cab);
      for (const [x, z] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.35], [0.85, -1.35]]) {
        const wh = new T.Mesh(new T.CylinderGeometry(0.33, 0.33, 0.26, 16), mat.wheel); wh.rotation.z = Math.PI / 2; wh.position.set(x, 0.33, z); g.add(wh);
      }
      const shadow = new T.Mesh(new T.PlaneGeometry(2.3, 4.8), mat.shadow); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; g.add(shadow);
      // headlights and their beams, for the night print
      const beam = new T.Mesh(new T.BufferGeometry(), mat.beam);
      beam.geometry.setAttribute("position", new T.Float32BufferAttribute([-0.7, 0.03, 2.1, 0.7, 0.03, 2.1, -3.2, 0.03, 16, 0.7, 0.03, 2.1, 3.2, 0.03, 16, -3.2, 0.03, 16], 3));
      g.add(beam);
      const lamps = [-0.6, 0.6].map((x) => { const l = new T.Mesh(new T.SphereGeometry(0.12, 10, 8), mat.lamp); l.position.set(x, 0.62, 2.12); g.add(l); return l; });
      scene.add(g);
      // the car's track on the road so far, like a long exposure, and the spot where it committed
      const trail = new T.Mesh(new T.BufferGeometry(), mat[`trail-${r.key}`]);
      trail.geometry.setAttribute("position", new T.Float32BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3));
      const idx = [];
      for (let k = 0; k < TRAIL_N - 1; k++) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
      trail.geometry.setIndex(idx);
      trail.frustumCulled = false;
      scene.add(trail);
      const pin = flatOn(new T.PlaneGeometry(0.62, 0.62), mat[`trail-${r.key}`], 0, 0, 0.03);
      pin.rotation.z = Math.PI / 4;
      return { g, beam, lamps, trail, pin };
    });

    const col = (s) => new T.Color(s || "#888888");
    const mixed = (a, b, t) => col(a).lerp(col(b), t);
    function paint() {
      const c = st.colors, dark = c.dark;
      scene.background = col(c.print);
      scene.fog.color.copy(col(c.print));
      mat.ground.color = col(c.print);
      mat.road.color = mixed(c.print, c["print-ink"], dark ? 0.07 : 0.05);
      mat.lane.color = col(c["print-line"]);
      mat.dash.color = mixed(c["print-line"], c.print, 0.3);
      mat.line.color = col(c["accent-print"]);
      mat.block.color = mixed(c.print, c["print-ink"], dark ? 0.42 : 0.3);
      mat.cone.color = col(c["accent-print"]);
      mat.wheel.color = mixed(c["print-ink"], c.print, dark ? 0.75 : 0.1);
      for (const r of RULES) {
        mat[`body-${r.key}`].color = col(c[r.key]);
        mat[`cab-${r.key}`].color = mixed(c[r.key], c.print, dark ? 0.35 : 0.22);
        mat[`trail-${r.key}`].color = col(c[r.key]); mat[`trail-${r.key}`].opacity = 0.9;
      }
      edge.color.copy(col(dark ? c.print : c["print-ink"])); edge.opacity = dark ? 0.8 : 0.6;
      mat.shadow.color = col(dark ? "#000000" : c["print-ink"]); mat.shadow.opacity = dark ? 0 : 0.12;
      mat.beam.color = mixed(c.hot, "#ffffff", 0.5); mat.beam.opacity = dark ? 0.09 : 0;
      mat.lamp.color = dark ? col("#fff6e8") : mixed(c["print-ink"], c.print, 0.6);
      // the sky: a band of light at the horizon in the night print, a haze on paper
      const sk = document.createElement("canvas"); sk.width = 4; sk.height = 128;
      const sctx = sk.getContext("2d"), grad = sctx.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, c.print); grad.addColorStop(0.72, c.print);
      grad.addColorStop(1, `#${mixed(c.print, dark ? c.hot : c["print-dim"], dark ? 0.22 : 0.12).getHexString()}`);
      sctx.fillStyle = grad; sctx.fillRect(0, 0, 4, 128);
      if (mat.sky.map) mat.sky.map.dispose();
      mat.sky.map = new T.CanvasTexture(sk); mat.sky.map.colorSpace = T.SRGBColorSpace;
      mat.sky.needsUpdate = true;
      hemi.groundColor.copy(mixed(c.print, c["print-ink"], 0.4));
      hemi.intensity = dark ? 1.3 : 1.9; sun.intensity = dark ? 0.9 : 1.6;
      pulseMats.forEach((pair) => { pair[0].color.copy(col(c.left)); pair[1].color.copy(col(c.right)); });
    }
    paint();

    let camZ = 0;
    const v = new T.Vector3();
    function placeSides(z) {
      // the cones stand on the side that is not clear
      cones.forEach(({ g, xc }) => g.position.set(xc - R * z * SIDE, 0, Z_OB));
    }
    function render(w, h) {
      const dpr = Math.min(devicePixelRatio || 1, w < 600 ? 1.5 : 2);
      if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
      const size = renderer.getSize(new T.Vector2());
      if (size.x !== w || size.y !== h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
      // follow the cars, and pull back far enough to keep all three lanes in view
      const lead = CAR.speed * Math.min(st.t, 1.45);
      camZ = reduced.matches ? lead : camZ + (lead - camZ) * 0.12;
      // high enough to see the cars and the obstacles at once; farther back on a narrow screen
      const f = Math.max(1, 1.5 / camera.aspect);
      camera.position.set(0, 11 * f, camZ - 14 * f);
      camera.lookAt(0, 0, camZ + 10);
      RULES.forEach((r, i) => {
        const s = carAt(r.key, st.t), car = cars[i];
        car.g.position.set(R * (i - 1) * LANE + s.x, 0, s.z);
        const t0 = s.d.n * DT, lat = s.decided ? (smooth((st.t - t0 + 0.01) / SWERVE) - smooth((st.t - t0 - 0.01) / SWERVE)) / 0.02 : 0;
        car.g.rotation.y = s.stopped ? 0 : 0.07 * lat * R * s.d.choice;
        car.beam.visible = st.colors.dark;
        // the track: TRAIL_N samples of the path from the start to now, a ribbon 0.18 m wide
        const pos = car.trail.geometry.attributes.position, xc = R * (i - 1) * LANE;
        for (let k = 0; k < TRAIL_N; k++) {
          const q = carAt(r.key, (st.t * k) / (TRAIL_N - 1));
          const x = xc + q.x;
          pos.setXYZ(2 * k, x - 0.09, 0.025, q.z - 2.1);
          pos.setXYZ(2 * k + 1, x + 0.09, 0.025, q.z - 2.1);
        }
        pos.needsUpdate = true;
        const td = s.d.n * DT, decided = st.t >= td - 1e-9;
        car.pin.visible = decided;
        if (decided) { const q = carAt(r.key, td); car.pin.position.set(xc + q.x, 0.03, q.z - 2.1); }
        const on = st.run.decide[r.key].n > Math.floor(st.t / DT + 1e-9);
        pulses[i][0].material.opacity = 0.6 * st.pulses[i][0] * (on ? 1 : 0);
        pulses[i][1].material.opacity = 0.6 * st.pulses[i][1] * (on ? 1 : 0);
      });
      renderer.render(scene, camera);
    }
    function project(x, y, z) {
      v.set(x, y, z).project(camera);
      const w = stage.clientWidth, h = stage.clientHeight;
      return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, visible: v.z < 1 && v.z > -1 };
    }
    const moving = () => Math.abs(CAR.speed * Math.min(st.t, 1.45) - camZ) > 0.05;
    return { paint, render, project, onRun: (run) => placeSides(run.z), moving };
  }

  scene.start();
}
