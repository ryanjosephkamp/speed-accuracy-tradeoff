// The game's road in 3D, in the car scene's look (car.js): flat fills with inked edges, the
// print's own colors. Four lanes side by side: the player's car, then the best walls', the 2025
// rule's, and the look-ahead rule's. Each road ends at a stalled truck that blocks one side, hidden
// in fog until the round is over; its hazard lights glint through the fog, and those glints are the
// readings. game.js says where everything is and what to show; this file only builds and draws it.
//
// Three.js (the site's minified bundle) is loaded by game.js only when the game comes near the
// screen; without WebGL game.js draws the same road from above.
const R = -1;              // the camera looks down +z, so screen right is world -x
export const LANE = 7;     // meters between lane centers (wider than the car scene's, so swerving neighbors keep clear)
export const SIDE = 1.9;   // how far a car moves to pass the truck
export const SPEED = 20;   // meters per time unit (the car scene's 72 km/h)
export const TRUCK = 12;   // meters from the last moment to swerve to the truck's back
export const laneX = (i) => R * (i - 1.5) * LANE;
const SPECKS = 160;        // the most glints shown at once when they linger

export function playScene3(T, { glCv, keys }) {
  const renderer = new T.WebGLRenderer({ canvas: glCv, antialias: true, powerPreference: "low-power" });
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(36, 1, 0.5, 300);
  scene.fog = new T.Fog(0x000000, 70, 170);
  const mat = {}, M = (key, opts = {}) => (mat[key] = new T.MeshBasicMaterial(opts));
  M("ground"); M("road"); M("truck"); M("truckCab"); M("wheel"); M("lane"); M("dash"); M("line"); M("lamp", { fog: false });
  M("sky", { depthWrite: false, fog: false });
  M("shadow", { transparent: true, depthWrite: false });
  M("beam", { transparent: true, depthWrite: false, blending: T.AdditiveBlending });
  M("headlamp", { fog: false });
  for (const k of keys) { M(`body-${k}`); M(`cab-${k}`); }
  const edge = new T.LineBasicMaterial({ transparent: true });
  // a soft round glow, for the hazard lights through the fog
  const cv = document.createElement("canvas"); cv.width = cv.height = 64;
  const g2 = cv.getContext("2d"), gr = g2.createRadialGradient(32, 32, 1, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,0.65)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
  const glowTex = new T.CanvasTexture(cv);
  const glowMat = () => new T.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, depthTest: false, fog: false });

  const flatOn = (geo, m, x, z, y = 0.01) => { const mesh = new T.Mesh(geo, m); mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); scene.add(mesh); return mesh; };
  const withEdges = (mesh) => { mesh.add(new T.LineSegments(new T.EdgesGeometry(mesh.geometry, 20), edge)); return mesh; };

  // the ground, the four lanes, their edges and dashes
  flatOn(new T.PlaneGeometry(500, 400), mat.ground, 0, 150, 0);
  const sky = new T.Mesh(new T.PlaneGeometry(500, 70), mat.sky);
  sky.position.set(0, 22, 260); sky.rotation.y = Math.PI; scene.add(sky);
  keys.forEach((k, i) => {
    const xc = laneX(i);
    flatOn(new T.PlaneGeometry(LANE - 0.5, 360), mat.road, xc, 170, 0.005);
    for (const s of [-1, 1]) flatOn(new T.PlaneGeometry(0.12, 360), mat.lane, xc + s * (LANE / 2 - 0.25), 170, 0.012);
    for (let z = -10; z < 340; z += 6) flatOn(new T.PlaneGeometry(0.1, 2.2), mat.dash, xc, z, 0.012);
  });
  // two lines across the road: the last moment to swerve (solid), and where the cost jumps (dashed)
  const lineAt = (dashed) => {
    const g = new T.Group(); scene.add(g);
    if (!dashed) { const m = new T.Mesh(new T.PlaneGeometry(LANE * 4, 0.22), mat.line); m.rotation.x = -Math.PI / 2; m.position.y = 0.016; g.add(m); }
    else for (let x = -LANE * 2 + 0.6; x < LANE * 2; x += 1.6) { const m = new T.Mesh(new T.PlaneGeometry(0.9, 0.22), mat.line); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.016, 0); g.add(m); }
    return g;
  };
  const endLine = lineAt(false), costLine = lineAt(true);

  // a stalled truck in each lane, on the side that is not clear, facing away; its hazard lights on
  // its back, toward the car
  const trucks = keys.map(() => {
    const g = new T.Group();
    const box = withEdges(new T.Mesh(new T.BoxGeometry(2.3, 2.5, 6.4), mat.truck)); box.position.set(0, 1.55, 3.2); g.add(box);
    const cab = withEdges(new T.Mesh(new T.BoxGeometry(2.3, 2.0, 1.9), mat.truckCab)); cab.position.set(0, 1.3, 7.4); g.add(cab);
    for (const [x, z] of [[-1.05, 1.2], [1.05, 1.2], [-1.05, 5.4], [1.05, 5.4], [-1.05, 7.4], [1.05, 7.4]]) {
      const wh = new T.Mesh(new T.CylinderGeometry(0.45, 0.45, 0.3, 16), mat.wheel); wh.rotation.z = Math.PI / 2; wh.position.set(x, 0.45, z); g.add(wh);
    }
    for (const x of [-0.95, 0.95]) { const l = new T.Mesh(new T.BoxGeometry(0.3, 0.2, 0.05), mat.lamp); l.position.set(x, 0.75, -0.01); g.add(l); }
    scene.add(g);
    return g;
  });
  // the glints: a glow on each side of the player's lane where the truck might be, and a pool of
  // small specks for glints that linger
  const glows = [0, 1].map(() => { const m = new T.Mesh(new T.PlaneGeometry(3.4, 3.4), glowMat()); m.renderOrder = 5; scene.add(m); return m; });
  const specks = Array.from({ length: SPECKS }, () => { const m = new T.Mesh(new T.PlaneGeometry(0.55, 0.55), glowMat()); m.renderOrder = 6; m.visible = false; scene.add(m); return m; });

  // the cars
  const cars = keys.map((k) => {
    const g = new T.Group();
    const body = withEdges(new T.Mesh(new T.BoxGeometry(1.8, 0.58, 4.2), mat[`body-${k}`])); body.position.y = 0.52; g.add(body);
    const cab = withEdges(new T.Mesh(new T.BoxGeometry(1.5, 0.48, 2.0), mat[`cab-${k}`])); cab.position.set(0, 1.03, -0.35); g.add(cab);
    for (const [x, z] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.35], [0.85, -1.35]]) {
      const wh = new T.Mesh(new T.CylinderGeometry(0.33, 0.33, 0.26, 16), mat.wheel); wh.rotation.z = Math.PI / 2; wh.position.set(x, 0.33, z); g.add(wh);
    }
    const shadow = new T.Mesh(new T.PlaneGeometry(2.3, 4.8), mat.shadow); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; g.add(shadow);
    const beam = new T.Mesh(new T.BufferGeometry(), mat.beam);
    beam.geometry.setAttribute("position", new T.Float32BufferAttribute([-0.7, 0.03, 2.1, 0.7, 0.03, 2.1, -3.2, 0.03, 16, 0.7, 0.03, 2.1, 3.2, 0.03, 16, -3.2, 0.03, 16], 3));
    g.add(beam);
    for (const x of [-0.6, 0.6]) { const l = new T.Mesh(new T.SphereGeometry(0.12, 10, 8), mat.headlamp); l.position.set(x, 0.62, 2.12); g.add(l); }
    scene.add(g);
    return { g, beam };
  });

  const col = (s) => new T.Color(s || "#888888");
  const mixed = (a, b, t) => col(a).lerp(col(b), t);
  let dark = false;
  function paint(c) {
    dark = c.dark;
    scene.background = col(c.print);
    scene.fog.color.copy(col(c.print));
    mat.ground.color = col(c.print);
    mat.road.color = mixed(c.print, c["print-ink"], dark ? 0.07 : 0.05);
    mat.lane.color = col(c["print-line"]);
    mat.dash.color = mixed(c["print-line"], c.print, 0.3);
    mat.line.color = col(c["accent-print"]);
    mat.truck.color = mixed(c.print, c["print-ink"], dark ? 0.42 : 0.3);
    mat.truckCab.color = mixed(c.print, c["print-ink"], dark ? 0.55 : 0.45);
    mat.wheel.color = mixed(c["print-ink"], c.print, dark ? 0.75 : 0.1);
    mat.lamp.color = col(c.hot);
    for (const k of keys) {
      const base = k === "you" ? c["accent-print"] : c[k];
      mat[`body-${k}`].color = col(base);
      mat[`cab-${k}`].color = mixed(base, c.print, dark ? 0.35 : 0.22);
    }
    edge.color.copy(col(dark ? c.print : c["print-ink"])); edge.opacity = dark ? 0.8 : 0.6;
    mat.shadow.color = col(dark ? "#000000" : c["print-ink"]); mat.shadow.opacity = dark ? 0 : 0.12;
    mat.beam.color = mixed(c.hot, "#ffffff", 0.5); mat.beam.opacity = dark ? 0.09 : 0;
    mat.headlamp.color = dark ? col("#fff6e8") : mixed(c["print-ink"], c.print, 0.6);
    const sk = document.createElement("canvas"); sk.width = 4; sk.height = 128;
    const sctx = sk.getContext("2d"), grad = sctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, c.print); grad.addColorStop(0.72, c.print);
    grad.addColorStop(1, `#${mixed(c.print, dark ? c.hot : c["print-dim"], dark ? 0.22 : 0.12).getHexString()}`);
    sctx.fillStyle = grad; sctx.fillRect(0, 0, 4, 128);
    if (mat.sky.map) mat.sky.map.dispose();
    mat.sky.map = new T.CanvasTexture(sk); mat.sky.map.colorSpace = T.SRGBColorSpace; mat.sky.needsUpdate = true;
    // the glints: light added to the night print, an amber stain on the paper one (1: NormalBlending)
    for (const m of [...glows, ...specks]) { m.material.color = col(c.hot); m.material.blending = dark ? T.AdditiveBlending : 1; m.material.needsUpdate = true; }
    cars.forEach((car) => { car.beam.visible = dark; });
  }

  const v = new T.Vector3();
  /**
   * Draw one frame. view: { lanes: [{ visible, x, z, yaw }], endZ, costZ (or null), truck: { side
   * (-1 left, +1 right, as the player sees it), shown }, glow: [left, right] beside the player's
   * truck, specks: [{ side, u, w, a }] (where in the patch, and how bright), fog (0 clear to 1
   * dense), camX, camZ, and wide: 0 frames the player's lane, 1 all four }.
   */
  function render(w, h, view) {
    const dpr = Math.min(devicePixelRatio || 1, w < 600 ? 1.5 : 2);
    if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
    const size = renderer.getSize(new T.Vector2());
    if (size.x !== w || size.y !== h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    // narrow screens pull back further; the wide view keeps all four lanes in frame
    // (and on a wide screen the four lanes still need a step back to fit side by side)
    const fit = Math.max(1 + 0.45 * view.wide, (1.35 + 1.0 * view.wide) / camera.aspect);
    const back = 14 * fit, up = (7.5 + 2.5 * view.wide) * fit;
    camera.position.set(view.camX, up, view.camZ - back);
    // while the player decides, tilt so both the car and the glints at the truck stay in frame;
    // for the replay, look just past the cars
    const carDown = Math.atan2(up, back), glintDown = Math.atan2(up - 1.1, view.endZ + TRUCK - view.camZ + back);
    const pitch = (1 - view.wide) * ((carDown + glintDown) / 2 + 0.03) + view.wide * Math.atan2(up, back + 9);
    camera.lookAt(view.camX * 0.9, 0, view.camZ - back + up / Math.tan(pitch));
    // fog thick enough to hide the truck while the player decides, thin once the round is over
    const dist = Math.hypot(back, up), f = view.fog;
    scene.fog.near = dist * (1 + 0.6 * (1 - f)) - 6 * f;
    scene.fog.far = dist + 26 + 150 * (1 - f);
    view.lanes.forEach((l, i) => {
      const car = cars[i];
      car.g.visible = l.visible;
      car.g.position.set(laneX(i) + R * l.x, 0, l.z);
      car.g.rotation.y = R * l.yaw;
      const tr = trucks[i];
      tr.visible = view.truck.shown && l.visible;
      tr.position.set(laneX(i) + R * view.truck.side * SIDE, 0, view.endZ + TRUCK);
    });
    endLine.position.z = view.endZ;
    costLine.visible = view.costZ != null;
    if (view.costZ != null) costLine.position.z = view.costZ;
    // the glints face the camera, at the truck's back, beside the player's lane; past about 75 m they
    // stop shrinking, so a far truck's glints stay readable
    const gz = view.endZ + TRUCK - 0.2;
    const keep = Math.max(1, Math.hypot(gz - (view.camZ - back), up - 1.1) / 75);
    glows.forEach((m, j) => {
      m.visible = view.glow[j] > 0.01;
      m.position.set(laneX(0) + R * (j ? 1 : -1) * SIDE, 1.1, gz);
      m.quaternion.copy(camera.quaternion);
      m.material.opacity = Math.min(1, view.glow[j]) * (dark ? 1 : 0.85);
      m.scale.setScalar((0.7 + 0.5 * Math.min(1, view.glow[j])) * keep);
    });
    specks.forEach((m, n) => {
      const s = view.specks[n];
      m.visible = !!s;
      if (!s) return;
      m.position.set(laneX(0) + R * (s.side * SIDE + (s.u - 0.5) * 1.8), 0.35 + s.w * 2.0, gz - 0.5 + s.w * 0.8);
      m.quaternion.copy(camera.quaternion);
      m.material.opacity = s.a;
      m.scale.setScalar(keep);
    });
    renderer.render(scene, camera);
  }
  function project(x, y, z) {
    v.set(x, y, z).project(camera);
    const w = glCv.clientWidth, h = glCv.clientHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, visible: v.z < 1 && v.z > -1 };
  }
  return { paint, render, project };
}
