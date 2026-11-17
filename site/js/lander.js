// The lander, in 3D. Three landers hover over the same kind of site, each with a pad marked to its
// left and its right; one side is clear, the other strewn with boulders. They take the same lidar
// scans (lander-model.js) and differ only in their walls: the best walls, the 2025 rule, and the
// look-ahead rule. Hovering is cheap while the hover fuel lasts and dearer by the moment once the
// fuel reaches its reserve, so the best walls start falling before the reserve and the 2025 rule's
// only as the cost climbs. Each scan flashes on the side it points to; the gauge over each lander
// shows how far its scans lean and where its walls are now; the bar under it is its fuel, with the
// reserve marked. At a wall the lander slides over its chosen pad and sets down, upright on clear
// ground or tipped on the boulders. The strip along the bottom is the cost of a moment's doubt.
// The reader can see which side is clear; the landers can't.
//
// The scene's plumbing (controls, clock, gauges, loading) is lanes-scene.js. Without WebGL the same
// run is drawn from above on a plain canvas.
import { landerModel, landerCost, landerNumbers, LANDER, ROWS } from "./lander-model.js";
import { RULES } from "./lanes.js";
import { DT } from "./lattice.js";
import { laneScene, colorKit, R, smooth, clamp01 } from "./lanes-scene.js";

const OUT = LANDER.out;         // the fuel runs out
const RESERVE = LANDER.reserve; // the fuel reaches its reserve
const SEC = LANDER.seconds;     // seconds in a time unit
const LANE = 5.4;               // meters between landers
const SIDE = 1.45;              // from the middle of a site to the center of each pad
const Z_SITE = 6;               // the sites' centers
const HOVER = 3.1;              // the landers' height while they hover
const ACROSS = 0.2, DOWN = 0.38; // time units to slide over the pad, and to come down
const RATE = { reading: 0.24, after: 0.5, ease: 0.25 }; // time units per real second
const KMAX = 16;                // the gauges' half width, in scans

export function initLander() {
  const root = document.getElementById("lander");
  if (!root) return;
  const model = landerModel();
  const nums = landerNumbers(model);
  for (const el of root.querySelectorAll("[data-ld-n]")) if (typeof nums[el.dataset.ldN] === "string") el.textContent = nums[el.dataset.ldN];
  let st = null;

  /** A rule's lander at time t: its offset across and its height, whether it has touched down,
   * and how far it has tipped (on the boulders). */
  function landerAt(key, t) {
    const d = st.run.decide[key], td = d.n * DT, decided = t >= td - 1e-9;
    if (!decided) return { x: 0, y: HOVER + 0.08 * Math.sin(t * 9), decided, d, down: false, tip: 0, burn: 1 };
    const u = smooth((t - td) / ACROSS), v = smooth((t - td - 0.06) / DOWN);
    const landed = t >= td + 0.06 + DOWN, after = clamp01((t - td - 0.06 - DOWN) / 0.18);
    const tip = d.correct ? 0 : 0.42 * smooth(after);
    return { x: R * d.choice * SIDE * u, y: (HOVER - 0.02) * (1 - v) + (d.correct ? 0 : 0.2 * v), decided, d, down: landed, tip, burn: landed ? 0 : 1, td };
  }
  const secs = (t) => `${(SEC * t).toFixed(1)} s`;

  const scene = laneScene(root, {
    key: "lander", data: "ld", model, salt: 0x5be0cd19,
    words: { one: "landing", many: "landings", who: "lander", did: "found clear ground for", at: "Fuel out", per: SEC, unit: "s" },
    // a run ends a little after the last lander is down
    endOf: (run) => Math.min(Math.max(...RULES.map((r) => run.decide[r.key].n)) * DT, OUT) + 0.06 + DOWN + 0.3,
    reading: (t) => t < OUT && RULES.some((r) => st.run.decide[r.key].n * DT > t - 1e-9),
    rate: RATE, kmax: KMAX,
    at: landerAt,
    status(run, t, n) {
      const side = run.z > 0 ? "right" : "left", row = Math.min(Math.floor(t / DT + 1e-9), ROWS);
      if (RULES.some((r) => run.decide[r.key].n > row)) return `Landing ${n}: scan ${row} of ${ROWS}, ${secs(t)} into the hover. The ${side} side is clear.`;
      return `Landing ${n}: all three have chosen, ${secs(t)} in. The ${side} side was clear.`;
    },
    gaugeAt: (i, s) => [R * (i - 1) * LANE + s.x, s.y + 1.2, Z_SITE],
    gaugeLine(s, pct, small) {
      if (!s.decided) return small ? `${pct}% TO LAND` : `${pct}% SURE TO LAND`;
      const way = s.d.choice > 0 ? "RIGHT" : "LEFT", forced = s.d.forced ? "FORCED, " : "";
      if (!s.down) return `${forced}GOES ${way}`;
      return `${forced}${s.d.correct ? "DOWN CLEAR" : "ON THE BOULDERS"}`;
    },
    under(ctx, g) { drawFuel(ctx, g); },
    over(ctx, g) { drawCost(ctx, g); },
    flat: { project: flat, draw: drawFlat },
    build3: (T, api) => scene3(T, api),
  });
  st = scene.st;

  /** Each lander's fuel, burning while it hovers, with the reserve marked. */
  function drawFuel(ctx, { project, small }) {
    const c = st.colors;
    ctx.save();
    RULES.forEach((r, i) => {
      const s = landerAt(r.key, st.t), p = project(R * (i - 1) * LANE + s.x, s.y - 0.5, Z_SITE);
      if (!p.visible) return;
      const used = Math.min(s.decided ? s.td + 0.06 + DOWN : st.t, OUT) / OUT;
      const bw = small ? 36 : 46, bh = 7, x0 = p.x - bw / 2, y0 = p.y + 8;
      ctx.fillStyle = c.print; ctx.globalAlpha = 0.7; ctx.fillRect(x0 - 2, y0 - 2, bw + 7, bh + 4); ctx.globalAlpha = 1;
      ctx.strokeStyle = c["print-ink"]; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, bw, bh);
      ctx.fillStyle = c[r.key]; ctx.fillRect(x0 + 1.5, y0 + 1.5, (bw - 2) * (1 - used), bh - 2);
      // the reserve: the fuel left when the hover fuel is gone
      const xr = x0 + 1.5 + (bw - 2) * (1 - RESERVE / OUT);
      ctx.strokeStyle = c["accent-print"]; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(xr, y0 - 2); ctx.lineTo(xr, y0 + bh + 2); ctx.stroke();
    });
    ctx.restore();
  }

  /** The cost of a moment's doubt from the start of the hover until the fuel runs out, and now. */
  function drawCost(ctx, { w, h, font, small }) {
    const c = st.colors, x0 = 14, x1 = w - 14, base = h - 12, top = h - 40;
    const X = (t) => x0 + ((x1 - x0) * t) / OUT, Y = (v) => base - ((base - top) * v) / landerCost(OUT);
    ctx.save();
    ctx.fillStyle = c.print; ctx.globalAlpha = 0.78; ctx.fillRect(0, top - 18, w, h - top + 18); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(X(0), base);
    for (let i = 0; i <= 200; i++) { const t = (OUT * i) / 200; ctx.lineTo(X(t), Y(landerCost(t))); }
    ctx.lineTo(X(OUT), base); ctx.closePath();
    ctx.fillStyle = c["accent-print"]; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = c["print-line"]; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, base + 0.5); ctx.lineTo(x1, base + 0.5); ctx.stroke();
    // the reserve, and the fuel running out
    ctx.strokeStyle = c["print-dim"]; ctx.beginPath(); ctx.moveTo(X(RESERVE), base + 1); ctx.lineTo(X(RESERVE), base + 5); ctx.stroke();
    ctx.strokeStyle = c["accent-print"]; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(X(OUT) - 0.5, top - 6); ctx.lineTo(X(OUT) - 0.5, base); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = `700 ${small ? 9.5 : 10.5}px ${font}`; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = c["print-dim"]; ctx.textAlign = "left"; ctx.fillText(small ? "COST OF HOVERING" : "COST OF HOVERING, CLIMBING ONCE THE FUEL REACHES ITS RESERVE", x0, top - 6);
    ctx.fillStyle = c["accent-print"]; ctx.textAlign = "right"; ctx.fillText("FUEL OUT", X(OUT) - 5, top - 6);
    const t = Math.min(st.t, OUT), x = X(t);
    ctx.strokeStyle = c["print-ink"]; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, top - 2); ctx.lineTo(x, base); ctx.stroke();
    ctx.fillStyle = c["print-ink"]; ctx.beginPath(); ctx.arc(x, Y(landerCost(t)), 3, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------ without WebGL: the same run from above
  function flat(w, h) {
    const top = 96, bottom = h - 64, zMin = Z_SITE - 2.6, zMax = Z_SITE + 2.6;
    const sx = Math.min(w / (LANE * 3.3), 40);
    return (x, y, z) => ({ x: w / 2 + R * x * sx, y: bottom - ((z - zMin) / (zMax - zMin)) * (bottom - top), visible: true });
  }
  function drawFlat(ctx, w, h, P) {
    const c = st.colors;
    ctx.fillStyle = c.print; ctx.fillRect(0, 0, w, h);
    RULES.forEach((r, i) => {
      const xc = R * (i - 1) * LANE;
      for (const side of [-1, 1]) { const p = P(xc + R * side * SIDE, 0, Z_SITE); ctx.strokeStyle = c["print-line"]; ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, 2 * Math.PI); ctx.stroke(); }
      ctx.fillStyle = c["accent-print"];
      for (const [dx, dz] of [[-0.4, -0.3], [0.2, 0.4], [0.4, -0.2], [-0.2, 0.5], [0, 0]]) { const q = P(xc - R * st.run.z * SIDE + dx, 0, Z_SITE + dz); ctx.beginPath(); ctx.arc(q.x, q.y, 2.5, 0, 2 * Math.PI); ctx.fill(); }
      const s = landerAt(r.key, st.t), q = P(xc + s.x, 0, Z_SITE);
      ctx.fillStyle = c[r.key]; ctx.beginPath(); ctx.arc(q.x, q.y, 6 + 3 * (s.y / HOVER), 0, 2 * Math.PI); ctx.fill();
    });
  }

  // ------------------------------------------------------------ the 3D scene, once it is near
  function scene3(T, { glCv, stage }) {
    const renderer = new T.WebGLRenderer({ canvas: glCv, antialias: true, powerPreference: "low-power" });
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(32, 1, 0.3, 300);
    scene.fog = new T.Fog(0x000000, 40, 120);
    const mat = {}, M = (key, opts = {}) => (mat[key] = new T.MeshBasicMaterial(opts));
    for (const k of ["ground", "pad", "rock", "boulder", "leg", "foot", "bell", "top"]) M(k);
    for (const r of RULES) M(`body-${r.key}`);
    M("flame", { transparent: true, depthWrite: false, blending: T.AdditiveBlending });
    M("shadow", { transparent: true, depthWrite: false });
    M("sky", { depthWrite: false, fog: false });
    const edge = new T.LineBasicMaterial({ transparent: true });
    const pulseMats = [0, 1, 2].map(() => [0, 1].map(() => new T.MeshBasicMaterial({ transparent: true, depthWrite: false })));
    const flatOn = (geo, m, x, z, y = 0.01) => { const mesh = new T.Mesh(geo, m); mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); scene.add(mesh); return mesh; };
    const withEdges = (mesh) => { mesh.add(new T.LineSegments(new T.EdgesGeometry(mesh.geometry, 20), edge)); return mesh; };
    const box = (w, h, d, m, x = 0, y = 0, z = 0, parent = scene) => { const b = withEdges(new T.Mesh(new T.BoxGeometry(w, h, d), m)); b.position.set(x, y, z); parent.add(b); return b; };

    // the plain, a few far rocks, and the sky
    flatOn(new T.PlaneGeometry(300, 300), mat.ground, 0, 40, 0);
    const sky = new T.Mesh(new T.PlaneGeometry(300, 60), mat.sky); sky.position.set(0, 20, 110); sky.rotation.y = Math.PI; scene.add(sky);
    const rand = ((a) => () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 2 ** 32; })(4111);
    for (let k = 0; k < 14; k++) {
      const rock = withEdges(new T.Mesh(new T.SphereGeometry(0.6 + 1.6 * rand(), 7, 5), mat.rock));
      rock.scale.y = 0.5; rock.position.set(-40 + 80 * rand(), 0, 16 + 50 * rand());
      if (Math.abs(rock.position.x) < LANE * 1.8 && rock.position.z < 22) rock.position.z += 12;
      scene.add(rock);
    }
    // each site: a pad marked on each side, boulders on the side that is not clear (moved for each
    // landing), and a patch on each side where the scans flash
    const sites = RULES.map((r, i) => {
      const xc = R * (i - 1) * LANE;
      for (const side of [-1, 1]) {
        const ring = new T.Mesh(new T.CylinderGeometry(0.95, 0.95, 0.006, 28), mat.pad); ring.position.set(xc + R * side * SIDE, 0.004, Z_SITE); scene.add(ring);
      }
      const field = new T.Group();
      for (let k = 0; k < 16; k++) {
        const a = rand() * 2 * Math.PI, rr = Math.sqrt(rand()) * 1.05;
        const b = withEdges(new T.Mesh(new T.SphereGeometry(0.1 + 0.2 * rand(), 6, 4), mat.boulder));
        b.scale.y = 0.65; b.position.set(Math.cos(a) * rr, 0.06, Math.sin(a) * rr); b.rotation.set(rand(), rand(), rand());
        field.add(b);
      }
      field.position.set(xc, 0, Z_SITE); scene.add(field);
      const pulses = [-1, 1].map((side, j) => flatOn(new T.PlaneGeometry(1.5, 1.5), pulseMats[i][j], xc + R * side * SIDE, Z_SITE, 0.012));
      return { xc, field, pulses };
    });

    // a lander: a body in its rule's color, a sensor top, an engine bell with a flame under it, and
    // four legs out to round feet
    function lander(key) {
      const g = new T.Group();
      box(1.1, 0.55, 1.1, mat[`body-${key}`], 0, 0.95, 0, g);
      box(0.6, 0.28, 0.6, mat.top, 0, 1.37, 0, g);
      const bell = new T.Mesh(new T.CylinderGeometry(0.16, 0.32, 0.36, 14), mat.bell); bell.position.y = 0.5; g.add(bell);
      const flame = new T.Mesh(new T.ConeGeometry(0.26, 1.2, 14), mat.flame); flame.rotation.x = Math.PI; flame.position.y = -0.25; g.add(flame);
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const leg = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 1.05, 6), mat.leg);
        leg.position.set(sx * 0.68, 0.48, sz * 0.68);
        // tilted so the top meets the body and the foot stands out past it
        leg.rotation.set(-sz * 0.42, 0, sx * 0.42);
        g.add(leg);
        const foot = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 0.04, 12), mat.foot); foot.position.set(sx * 0.88, 0.02, sz * 0.88); g.add(foot);
      }
      scene.add(g);
      const shadow = new T.Mesh(new T.CylinderGeometry(1, 1, 0.002, 20), mat.shadow); scene.add(shadow);
      return { g, flame, shadow };
    }
    const landers = RULES.map((r) => lander(r.key));

    const { col, mixed } = colorKit(T);
    function paint() {
      const c = st.colors, dark = c.dark;
      scene.background = col(c.print);
      scene.fog.color.copy(col(c.print));
      mat.ground.color = col(c.print);
      mat.pad.color = mixed(c.print, c["print-ink"], dark ? 0.12 : 0.1);
      mat.rock.color = mixed(c.print, c["print-ink"], dark ? 0.22 : 0.25);
      mat.boulder.color = col(c["accent-print"]);
      mat.leg.color = mixed(c.print, c["print-ink"], dark ? 0.6 : 0.6);
      mat.foot.color = mixed(c.print, c["print-ink"], dark ? 0.75 : 0.75);
      mat.bell.color = mixed(c.print, c["print-ink"], dark ? 0.5 : 0.55);
      mat.top.color = mixed(c.print, c["print-ink"], dark ? 0.3 : 0.2);
      for (const r of RULES) mat[`body-${r.key}`].color = col(c[r.key]);
      mat.flame.color = mixed(c.hot, "#ffffff", 0.35); mat.flame.opacity = dark ? 0.55 : 0.35;
      edge.color.copy(col(dark ? c.print : c["print-ink"])); edge.opacity = dark ? 0.8 : 0.6;
      mat.shadow.color = col(dark ? "#000000" : c["print-ink"]); mat.shadow.opacity = dark ? 0 : 0.14;
      const sk = document.createElement("canvas"); sk.width = 4; sk.height = 128;
      const sctx = sk.getContext("2d"), grad = sctx.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, c.print); grad.addColorStop(0.72, c.print);
      grad.addColorStop(1, `#${mixed(c.print, dark ? c.hot : c["print-dim"], dark ? 0.12 : 0.1).getHexString()}`);
      sctx.fillStyle = grad; sctx.fillRect(0, 0, 4, 128);
      if (mat.sky.map) mat.sky.map.dispose();
      mat.sky.map = new T.CanvasTexture(sk); mat.sky.map.colorSpace = T.SRGBColorSpace;
      mat.sky.needsUpdate = true;
      pulseMats.forEach((pair) => { pair[0].color.copy(col(c.left)); pair[1].color.copy(col(c.right)); });
    }
    paint();

    // Behind the sites and above them, far enough back for the three sites and the landers over
    // them to fit between the gauges and the cost strip; steeper on a narrow screen.
    let fitFor = "";
    const corners = [];
    for (const x of [-1, 1]) for (const y of [0, HOVER + 1.6]) corners.push(new T.Vector3(x * (LANE + SIDE + 1.0), y, Z_SITE - 1.6), new T.Vector3(x * (LANE + SIDE + 1.0), y, Z_SITE + 1.6));
    const q = new T.Vector3();
    function fit(w, h) {
      const el = camera.aspect < 1 ? 0.62 : camera.aspect < 1.4 ? 0.48 : 0.4;
      const yHi = 1 - (2 * 74) / h, yLo = -1 + (2 * 64) / h, mid = (yHi + yLo) / 2;
      const dir = new T.Vector3(0, Math.sin(el), -Math.cos(el)), up = new T.Vector3(0, Math.cos(el), Math.sin(el));
      const target = new T.Vector3(0, 1.4, Z_SITE);
      const place = (d) => { camera.position.copy(target).addScaledVector(dir, d); camera.lookAt(target); camera.updateMatrixWorld(); };
      const span = () => {
        let x = 0, lo = Infinity, hi = -Infinity;
        for (const c of corners) { q.copy(c).project(camera); x = Math.max(x, Math.abs(q.x)); lo = Math.min(lo, q.y); hi = Math.max(hi, q.y); }
        return { x, lo, hi };
      };
      for (let pass = 0; pass < 3; pass++) {
        let a = 2, b = 300;
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
    }
    function placeSides(z) {
      // the boulders lie on the side that is not clear
      sites.forEach((s) => s.field.position.set(s.xc - R * z * SIDE, 0, Z_SITE));
    }
    function render(w, h) {
      const dpr = Math.min(devicePixelRatio || 1, w < 600 ? 1.5 : 2);
      if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
      const size = renderer.getSize(new T.Vector2());
      if (size.x !== w || size.y !== h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
      if (fitFor !== `${w}x${h}`) { fit(w, h); fitFor = `${w}x${h}`; }
      const t = st.t, row = Math.floor(t / DT + 1e-9);
      RULES.forEach((r, i) => {
        const S = sites[i], L = landers[i], s = landerAt(r.key, t);
        L.g.position.set(S.xc + s.x, s.y, Z_SITE);
        L.g.rotation.set(0, 0, s.tip * R * s.d.choice);
        L.flame.visible = s.burn > 0;
        L.flame.scale.set(1, 0.85 + 0.15 * Math.sin(t * 60 + i * 2), 1);
        L.shadow.position.set(S.xc + s.x, 0.008, Z_SITE);
        const sc = 0.9 + 0.25 * (s.y / HOVER); L.shadow.scale.set(sc, 1, sc);
        const on = st.run.decide[r.key].n > row;
        S.pulses[0].material.opacity = 0.6 * st.pulses[i][0] * (on ? 1 : 0);
        S.pulses[1].material.opacity = 0.6 * st.pulses[i][1] * (on ? 1 : 0);
      });
      renderer.render(scene, camera);
    }
    const v = new T.Vector3();
    function project(x, y, z) {
      v.set(x, y, z).project(camera);
      return { x: (v.x * 0.5 + 0.5) * stage.clientWidth, y: (-v.y * 0.5 + 0.5) * stage.clientHeight, visible: v.z < 1 && v.z > -1 };
    }
    return { paint, render, project, onRun: (run) => placeSides(run.z) };
  }

  scene.start();
}
