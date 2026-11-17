// The page's two editions and its dial. "Follow the system" (the default), Light (ink on silver
// paper), or Dark (light on a black print), and a dial that turns every color that carries meaning
// together: the accent your finger moves, the look-ahead light, left and right, and the 2025
// rule's slate. They turn by the same angle, so their hues stay as far apart as printed; each then
// shifts only as far as it must to stay inside sRGB and readable on every surface of its theme
// (tones.js). site/tools/check_site.mjs measures the closest pair at every position of the dial.
// At rest the dial sets nothing and every color is exactly as printed in site.css.
//
// The choice is kept in this browser (one key, with the worked-out colors), and the snippet in the
// page's head sets it before the first paint. Canvases read colors once: they listen for
// "appearance:change" on document, which fires on every choice and when the system's theme flips.

export const STORAGE_KEY = "sat-appearance";

import { contrast, oklchOf, dialProperties, hueName, DEFAULT_HUE, PRINTED, PROPS, TRACK } from "./tones.js";

/** The name of a meaning color as the reader sees it now ("green" for the look-ahead at rest). */
const WORDS = { wb: "green", accent: "orange", right: "yellow", left: "blue" };
export function colorWord(key) {
  if (state.hue === null) return WORDS[key];
  const base = oklchOf(PRINTED.dark[key === "accent" ? "accent-print" : key]).h;
  return hueName((base + state.hue - DEFAULT_HUE + 360) % 360);
}


// ---- keeping and applying a choice
const root = document.documentElement;
function read() {
  try {
    const kept = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    const theme = kept?.theme === "light" || kept?.theme === "dark" ? kept.theme : "system";
    const hue = Number.isInteger(kept?.hue) && kept.hue >= 0 && kept.hue < 360 ? kept.hue : null;
    return { theme, hue };
  } catch { return { theme: "system", hue: null }; }
}
let state = read();
const darkSystem = matchMedia("(prefers-color-scheme: dark)");
/** The edition being drawn now: "light" or "dark". */
export const edition = () => (state.theme === "system" ? (darkSystem.matches ? "dark" : "light") : state.theme);
export const current = () => ({ ...state });

function announce() {
  for (const el of document.querySelectorAll("[data-color-word]")) el.textContent = colorWord(el.dataset.colorWord);
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const dark = state.theme === "system" ? (meta.media || "").includes("dark") : state.theme === "dark";
    meta.content = dark ? "#0d0e0f" : "#eef0f2";
  }
  document.dispatchEvent(new CustomEvent("appearance:change", { detail: { ...state, edition: edition() } }));
}
export function apply(next) {
  state = next;
  if (next.theme === "system") delete root.dataset.theme; else root.dataset.theme = next.theme;
  const tones = next.hue === null ? null : dialProperties(next.hue);
  for (const name of PROPS) { if (tones?.[name]) root.style.setProperty(name, tones[name]); else root.style.removeProperty(name); }
  try {
    if (next.theme === "system" && next.hue === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, ...(tones ? { tones } : {}) }));
  } catch { /* storage refused: the choice lasts for this visit */ }
  announce();
}
darkSystem.addEventListener("change", () => { if (state.theme === "system") announce(); });

export function initAppearance() {
  apply(state);
  const control = document.querySelector("[data-appearance]");
  if (!control) return;
  const button = control.querySelector("[data-appearance-button]"), panel = control.querySelector("[data-appearance-panel]");
  const dial = control.querySelector("[data-hue]"), named = control.querySelector("[data-hue-name]"), reset = control.querySelector("[data-hue-reset]");
  const themes = [...control.querySelectorAll('input[name="theme"]')];
  dial.min = "0"; dial.max = "359"; dial.step = "1";
  dial.style.setProperty("--track", TRACK);
  const sync = () => {
    for (const r of themes) r.checked = r.value === state.theme;
    const hue = state.hue ?? DEFAULT_HUE;
    dial.value = String(hue);
    named.textContent = hueName(hue);
    dial.setAttribute("aria-valuetext", `${hueName(hue)}, ${hue} degrees`);
    reset.disabled = state.hue === null;
  };
  const open = (shown) => { panel.hidden = !shown; button.setAttribute("aria-expanded", String(shown)); };
  button.addEventListener("click", () => open(panel.hidden));
  for (const r of themes) r.addEventListener("change", () => { if (r.checked) apply({ ...state, theme: r.value }); });
  let pending = 0;
  dial.addEventListener("input", () => {
    const hue = Number(dial.value);
    named.textContent = hueName(hue);
    // the dial can move faster than the page can repaint its prints: one apply per frame
    if (!pending) pending = requestAnimationFrame(() => { pending = 0; const h = Number(dial.value); apply({ ...state, hue: h === DEFAULT_HUE ? null : h }); sync(); });
  });
  reset.addEventListener("click", () => { apply({ ...state, hue: null }); sync(); dial.focus(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { open(false); button.focus(); } });
  document.addEventListener("click", (e) => { if (!panel.hidden && e.target instanceof Node && !control.contains(e.target)) open(false); });
  sync();
  control.hidden = false;
}
