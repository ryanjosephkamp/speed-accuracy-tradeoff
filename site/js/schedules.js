// Cost schedules for the cost lab, shared by the page and the worker. Time is in units of
// sigma^2 / mu^2, as in the paper. Steps and pulses have logistic edges 0.05 wide, as in the
// experiments.

const logistic = (x) => 1 / (1 + Math.exp(-x));

export const PRESETS = [
  {
    id: "jump", label: "Cost jumps",
    params: [
      { id: "at", label: "When", min: 0.2, max: 2, step: 0.05, value: 0.5, unit: "" },
      { id: "factor", label: "How many times higher", min: 2, max: 32, step: 1, value: 16, unit: "×" },
    ],
    cost: (p) => (t) => 0.1 + (0.1 * p.factor - 0.1) * logistic((t - p.at) / 0.05),
    horizon: () => 8, view: () => 2.5,
  },
  {
    id: "fall", label: "Cost falls",
    params: [
      { id: "at", label: "When", min: 0.1, max: 2, step: 0.05, value: 0.3, unit: "" },
      { id: "factor", label: "How many times lower", min: 2, max: 16, step: 1, value: 8, unit: "×" },
    ],
    cost: (p) => (t) => 0.4 + (0.4 / p.factor - 0.4) * logistic((t - p.at) / 0.05),
    horizon: () => 8, view: () => 2.5,
  },
  {
    id: "deadline", label: "Deadline",
    params: [
      { id: "at", label: "Deadline", min: 0.4, max: 3, step: 0.05, value: 1, unit: "" },
      { id: "c", label: "Cost of time", min: 0.02, max: 0.5, step: 0.01, value: 0.1, unit: "" },
    ],
    cost: (p) => (t) => (t <= p.at + 1e-12 ? p.c : Infinity),
    horizon: (p) => p.at, view: (p) => p.at,
  },
  {
    id: "pulse", label: "Pulse",
    params: [
      { id: "at", label: "When", min: 0.2, max: 2, step: 0.05, value: 0.8, unit: "" },
      { id: "factor", label: "How many times higher", min: 2, max: 32, step: 1, value: 8, unit: "×" },
    ],
    cost: (p) => (t) => 0.1 * (1 + (p.factor - 1) * (logistic((t - p.at) / 0.05) - logistic((t - p.at - 0.4) / 0.05))),
    horizon: () => 8, view: () => 2.5,
  },
  {
    id: "rising", label: "Rising",
    params: [
      { id: "at", label: "Starts rising", min: 0, max: 2, step: 0.05, value: 0.5, unit: "" },
      { id: "rate", label: "Rate", min: 0.1, max: 2, step: 0.05, value: 0.8, unit: "" },
    ],
    cost: (p) => (t) => 0.1 + p.rate * Math.max(t - p.at, 0),
    horizon: () => 8, view: () => 2.5,
  },
  {
    id: "wave", label: "Wave",
    params: [
      { id: "omega", label: "How fast", min: 0.5, max: 8, step: 0.5, value: 2, unit: "" },
      { id: "size", label: "How big", min: 0.05, max: 0.6, step: 0.05, value: 0.3, unit: "%" },
    ],
    cost: (p) => (t) => 0.1 * (1 + p.size * Math.sin(p.omega * t)),
    horizon: () => 10, view: () => 4,
  },
];

export const presetById = (id) => PRESETS.find((p) => p.id === id);
