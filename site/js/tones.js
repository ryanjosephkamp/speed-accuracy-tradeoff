// The color math behind the page's dial, with no DOM, so site/tools/check_site.mjs can hold it to
// its promises: every color that carries meaning turns by the same angle, keeps its OKLCH
// lightness and chroma (chroma lowered only where a hue cannot carry it inside sRGB), then moves
// only in lightness until it reaches 4.5:1 on every surface of its theme. After Björn Ottosson's
// OKLab and the constitutions appearance template.
const hexToRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const chan = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
export function contrast(a, b) {
  const x = lum(hexToRgb(a)), y = lum(hexToRgb(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const D2R = Math.PI / 180;
const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const enc = (v) => { const x = Math.min(1, Math.max(0, v)); return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055); };
export function oklchOf(hex) {
  const [r, g, b] = hexToRgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: (Math.atan2(B, A) / D2R + 360) % 360 };
}
function linearOf(l, c, h) {
  const a = c * Math.cos(h * D2R), b = c * Math.sin(h * D2R);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_];
}
const inGamut = (rgb) => rgb.every((v) => v >= -1e-6 && v <= 1 + 1e-6);
function maxChroma(l, h) {
  let lo = 0, hi = 0.4;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (inGamut(linearOf(l, mid, h))) lo = mid; else hi = mid; }
  return lo;
}
const oklchHex = (l, c, h) => rgbToHex(linearOf(l, Math.min(c, maxChroma(l, h)), h).map(enc));
/** The nearest color to `hex` in OKLCH lightness, same hue and chroma, with `target` contrast on every surface. */
function toward(hex, surfaces, target) {
  const ok = (c) => Math.min(...surfaces.map((s) => contrast(c, s))) >= target;
  if (ok(hex)) return hex;
  const { l, c, h } = oklchOf(hex), lighten = lum(hexToRgb(surfaces[0])) < 0.2;
  let pass = lighten ? 1 : 0, fail = l;
  for (let i = 0; i < 26; i++) { const mid = (pass + fail) / 2; if (ok(oklchHex(mid, c, h))) pass = mid; else fail = mid; }
  return oklchHex(pass, c, h);
}

// ---- the editions' colors as printed (site.css), their surfaces, and each color's contrast line
export const SURFACES = { light: ["#eef0f2", "#e1e4e8", "#f8f9fa", "#e9ebee"], dark: ["#0d0e0f", "#17191b", "#000000", "#111315"] };
export const PRINTED = {
  light: { accent: "#b8330a", "accent-print": "#b73709", hot: "#a7471b", wb: "#0a734f", right: "#7a6200", left: "#1c63a8", pm: "#56637d" },
  dark: { accent: "#ff6a36", "accent-print": "#ff5a24", hot: "#ffd2a0", wb: "#2fd39a", right: "#ffcf3d", left: "#5cb8ff", pm: "#8f9bb3" },
};
const ON = { light: ["#141518", "#ffffff"], dark: ["#160801", "#ffffff"] };
const LINE = 4.5; // every one of them is used for small text somewhere, so all meet the text line
/** Where the dial rests: the dark edition's accent, in whole degrees. */
export const DEFAULT_HUE = Math.round(oklchOf(PRINTED.dark["accent-print"]).h);
const NAMES = [[5, "rose"], [38, "orange"], [62, "amber"], [88, "gold"], [118, "lime"], [150, "green"], [185, "teal"], [215, "cyan"], [255, "blue"], [292, "violet"], [328, "magenta"]];
export function hueName(h) {
  const away = (a) => Math.min(Math.abs(a - h), 360 - Math.abs(a - h));
  return NAMES.reduce((best, e) => (away(e[0]) < away(best[0]) ? e : best))[1];
}
/** The --dial-* properties for one position of the dial, in both editions. */
export function dialProperties(hue) {
  const out = {}, turn = hue - DEFAULT_HUE;
  for (const theme of ["light", "dark"]) {
    for (const [key, hex] of Object.entries(PRINTED[theme])) {
      const { l, c, h } = oklchOf(hex);
      out[`--dial-${theme}-${key}`] = toward(oklchHex(l, c, (h + turn + 360) % 360), SURFACES[theme], LINE);
    }
    // the cost handle's text: whichever of near-black and white reads better on the accent
    let fill = out[`--dial-${theme}-accent-print`];
    let on = ON[theme].reduce((a, b) => (contrast(fill, a) >= contrast(fill, b) ? a : b));
    if (contrast(fill, on) < 4.5) { on = theme === "dark" ? ON.dark[0] : ON.light[1]; fill = toward(fill, [on], 4.5); out[`--dial-${theme}-accent-print`] = fill; }
    out[`--dial-${theme}-on-accent`] = on;
  }
  return out;
}
export const PROPS = Object.keys(dialProperties(DEFAULT_HUE + 1));
/** The machine's light in the dark edition: warm at rest, turned by the dial's angle like the rest. */
export const GLOW_TINT = [1.0, 0.72, 0.46];
export function glowTint(hue) {
  if (hue === null || hue === undefined || hue === DEFAULT_HUE) return GLOW_TINT;
  const { l, c, h } = oklchOf(rgbToHex(GLOW_TINT.map((v) => v * 255)));
  return hexToRgb(oklchHex(l, c, (h + hue - DEFAULT_HUE + 360) % 360)).map((v) => v / 255);
}
export const TRACK = `linear-gradient(90deg, ${Array.from({ length: 13 }, (_, i) => oklchHex(0.72, 0.13, (DEFAULT_HUE + i * 30) % 360)).join(", ")})`;
/** Distance between two colors in OKLab. */
export function oklabDistance(a, b) {
  const x = oklchOf(a), y = oklchOf(b);
  const ax = x.c * Math.cos(x.h * D2R), bx = x.c * Math.sin(x.h * D2R), ay = y.c * Math.cos(y.h * D2R), by = y.c * Math.sin(y.h * D2R);
  return Math.hypot(x.l - y.l, ax - ay, bx - by);
}
