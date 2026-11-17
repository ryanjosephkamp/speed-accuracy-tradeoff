// Runs the cost lab's computations off the page's main thread.
import { computeSchedule } from "./compute.js";

self.onmessage = (e) => {
  const { seq, spec } = e.data;
  try {
    self.postMessage({ seq, result: computeSchedule(spec) });
  } catch (err) {
    self.postMessage({ seq, error: String(err && err.message ? err.message : err) });
  }
};
