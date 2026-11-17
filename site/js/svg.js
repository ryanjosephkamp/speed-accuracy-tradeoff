// Small SVG helpers shared by the prints: elements, linear and log scales, and the timing scale
// every time axis on the page uses.
export const NS = "http://www.w3.org/2000/svg";

export function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, v);
  if (parent) parent.append(node);
  return node;
}
/** Text; a variable written as {ω} is set in italic and kept lowercase inside uppercase labels. */
export function text(parent, x, y, str, attrs = {}) {
  const t = el("text", { x, y, ...attrs }, parent);
  for (const [i, part] of str.split(/\{([^}]*)\}/).entries()) {
    if (!part) continue;
    if (i % 2) el("tspan", { class: "var" }, t).textContent = part;
    else t.append(part);
  }
  return t;
}
export function clear(svg) {
  while (svg.lastChild && svg.lastChild.nodeName !== "desc") svg.lastChild.remove();
  // keep a <desc> if it is the first child
  return svg;
}
export function size(svg) {
  const r = svg.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
  return { w: r.width, h: r.height };
}
export function lin(d0, d1, r0, r1) {
  const f = (v) => r0 + ((v - d0) * (r1 - r0)) / (d1 - d0);
  f.inv = (p) => d0 + ((p - r0) * (d1 - d0)) / (r1 - r0);
  f.d0 = d0; f.d1 = d1; f.r0 = r0; f.r1 = r1;
  return f;
}
export function logScale(d0, d1, r0, r1) {
  const a = Math.log(d0), b = Math.log(d1);
  const f = (v) => r0 + ((Math.log(v) - a) * (r1 - r0)) / (b - a);
  f.inv = (p) => Math.exp(a + ((p - r0) * (b - a)) / (r1 - r0));
  f.d0 = d0; f.d1 = d1; f.r0 = r0; f.r1 = r1;
  return f;
}
/** Path through points; a null or non-finite y breaks the line. */
export function line(xs, ys, X, Y, clampY) {
  let d = "", pen = false;
  for (let i = 0; i < xs.length; i++) {
    let y = ys[i];
    if (y === null || !Number.isFinite(y)) { pen = false; continue; }
    if (clampY) y = Math.min(Math.max(y, clampY[0]), clampY[1]);
    d += `${pen ? "L" : "M"}${X(xs[i]).toFixed(1)},${Y(y).toFixed(1)}`;
    pen = true;
  }
  return d;
}
export function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x)), m = x / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
/** The timing scale along the bottom of a print: a band with fine ticks and labeled majors. */
export function timeScale(g, X, t0, t1, y, h, w, unitLabel = "") {
  el("rect", { class: "scale-bg", x: 0, y, width: w, height: h }, g);
  const span = X(t1) - X(t0);
  const unit = niceStep((t1 - t0) / Math.max(3, Math.floor(span / 64)));
  const dec = unit >= 1 ? 0 : unit >= 0.1 ? 1 : unit >= 0.01 ? 2 : 3;
  for (let k = Math.ceil((t0 * 5) / unit); (k * unit) / 5 <= t1 + 1e-9; k++) {
    const t = (k * unit) / 5, x = Math.round(X(t)) + 0.5, major = k % 5 === 0;
    el("line", { class: "tick", x1: x, x2: x, y1: y, y2: y + (major ? 7 : 3) }, g);
    if (major) text(g, x, y + 16, `${t.toFixed(dec)}${t === t0 && unitLabel ? ` ${unitLabel}` : ""}`, { "text-anchor": t === t0 ? "start" : "middle" });
  }
}
