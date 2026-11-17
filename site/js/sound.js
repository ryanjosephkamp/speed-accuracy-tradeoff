// One sound switch for the whole page. Off until the reader turns it on, and remembered in this
// browser. Every demo asks audio() for the shared context and output when it wants to make a
// sound; while the switch is off, audio() returns null and nothing plays. Browsers only start
// audio after a tap or a key, so a remembered "on" waits for the reader's first one.
const KEY = "sat-sound";
let on = false, ctx = null, out = null;
const subs = new Set();

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
}
/** The shared audio context and output while sound is on and running; otherwise null. */
export function audio() {
  if (!on || !ctx || ctx.state !== "running") return null;
  return { ctx, out };
}
export const soundOn = () => on;
export function setSound(v) {
  on = Boolean(v);
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {}
  if (on) ensure();
  for (const f of subs) f(on);
}
export const onSound = (fn) => { subs.add(fn); return () => subs.delete(fn); };

export function initSound() {
  try { on = localStorage.getItem(KEY) === "1"; } catch {}
  const btn = document.getElementById("sound-switch");
  const sync = () => {
    if (!btn) return;
    btn.setAttribute("aria-pressed", String(on));
    btn.querySelector(".sound-word").textContent = on ? "Sound on" : "Sound off";
  };
  if (btn) {
    btn.hidden = false;
    btn.addEventListener("click", () => { setSound(!on); sync(); });
  }
  sync();
  if (on) {
    const start = () => { ensure(); removeEventListener("pointerdown", start, true); removeEventListener("keydown", start, true); };
    addEventListener("pointerdown", start, true);
    addEventListener("keydown", start, true);
  }
}
