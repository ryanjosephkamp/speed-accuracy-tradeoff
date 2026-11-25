// The page: the contents menu and reading progress, the stored numbers, and each print.
import { initRace } from "./race.js";
import { initMachine } from "./machine.js";
import { initGame } from "./game.js";
import { initLab } from "./lab.js";
import { initKernel, initHeld, initWave, initUnknown, initChecks } from "./figures.js";
import { initScenarios } from "./scenarios.js";
import { initAppearance } from "./appearance.js";
import { initSound } from "./sound.js";

initAppearance();
initSound();

const toc = document.getElementById("toc");
// the menu's own sections; the links at its foot leave the page
const links = [...toc.querySelectorAll("ol a")];
const sections = links.map((a) => document.querySelector(a.getAttribute("href")));
const bar = document.getElementById("progress");

function onScroll() {
  const doc = document.documentElement;
  const p = doc.scrollTop / Math.max(doc.scrollHeight - doc.clientHeight, 1);
  bar.style.width = `${(100 * Math.min(Math.max(p, 0), 1)).toFixed(2)}%`;
  const line = 120;
  let cur = -1;
  sections.forEach((s, i) => { if (s && s.getBoundingClientRect().top <= line) cur = i; });
  links.forEach((a, i) => a.setAttribute("aria-current", String(i === cur)));
}
let ticking = false;
addEventListener("scroll", () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; onScroll(); });
}, { passive: true });
onScroll();
toc.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => { toc.open = false; }));
document.addEventListener("click", (e) => { if (toc.open && !toc.contains(e.target)) toc.open = false; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && toc.open) { toc.open = false; toc.querySelector("summary").focus(); } });

initMachine();
try { initGame(); } catch (e) { console.error(e); }
initRace();
initLab();

const load = (name) => fetch(new URL(`../data/${name}`, import.meta.url)).then((r) => (r.ok ? r.json() : null));
load("site-data.json")
  .then((data) => {
    for (const span of document.querySelectorAll("[data-n]")) {
      const v = data.numbers[span.dataset.n];
      if (v != null) span.textContent = v;
    }
    initScenarios(data.showcase);
    initKernel(data.numbers);
    initHeld(data.held);
    initWave(data.firstOrder);
    initUnknown(data.unknown);
  })
  .catch(() => {
    document.getElementById("held-name").textContent = "The stored results didn’t load. The numbers in the text still stand.";
    initKernel(null);
  });
load("checks.json").then(initChecks).catch(() => {});
