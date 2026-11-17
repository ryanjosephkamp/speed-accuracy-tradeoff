// Sends schedules to the worker (compute.js off the main thread) and returns promises; falls back
// to computing on the page when module workers aren't available.
let worker = null, failed = false, seq = 0;
const pending = new Map();

function start() {
  if (worker || failed) return;
  try {
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.seq);
      if (!p) return;
      pending.delete(e.data.seq);
      if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.result);
    };
    worker.onerror = () => { failed = true; worker = null; for (const [, p] of pending) p.retry(); pending.clear(); };
  } catch {
    failed = true;
  }
}

async function onPage(spec) {
  const { computeSchedule } = await import("./compute.js");
  return computeSchedule(spec);
}

// ?noworker computes on the page, so a headless capture waits for the result
const NO_WORKER = typeof location !== "undefined" && new URLSearchParams(location.search).has("noworker");

export function solve(spec) {
  if (NO_WORKER) return onPage(spec);
  start();
  if (!worker) return onPage(spec);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, retry: () => onPage(spec).then(resolve, reject) });
    worker.postMessage({ seq: id, spec });
  });
}
