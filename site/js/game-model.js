// The decision game: the reader is one of the cars on the decision machine's board. Readings
// arrive one a row (0.01 of a time unit), each pointing to the clear side with probability p = 0.55;
// the cost of each moment of doubt follows a schedule the player sees in advance; the player swerves
// left or right whenever they choose. The best walls, the 2025 rule, and the look-ahead rule decide
// on the same readings (lanes.js runLanes), so a round compares strategies, not luck in the readings.
//
// Scores are the paper's: a point for the clear side, less what the waiting cost. "Fair" points
// replace the last coin flip with its odds: the chance the chosen side is clear given the readings
// so far, less the cost paid. They separate a good decision from a lucky one.
//
// Every road ends at a stalled truck that blocks one side, hidden in fog: each reading is a glint of
// its hazard lights, seen on the truck's side with probability p (the reading points to the clear
// side) and as a reflection on the other side otherwise (glintSide). Reaching the truck undecided
// forces the choice, as at the machine's last row.
//
// Pure functions, no DOM: game.js plays them and site/tools/check_site.mjs checks them.
import { DT, rowCosts, posterior, pUp } from "./lattice.js";
import { laneModel, runLanes, RULES } from "./lanes.js";

const logistic = (x) => 1 / (1 + Math.exp(-x));

/** The machine's three schedules (machine.js), and the game's clock: one time unit is 6 s of play, and
 * 3 s on the steady road, where decisions take longest. */
export const GAME = { c0: 0.1, factor: 16, rise: 0.6, deadline: 1, secondsPerUnit: 6, rounds: 9, p: pUp(1) };

export const KINDS = {
  rises: {
    key: "rises", name: "The cost jumps", at: GAME.rise, end: 1.5, rows: Math.round(1.5 / DT),
    story: "Past the dashed line only a hard swerve still works, so every moment of doubt after it costs 16 times as much.",
    cost: (t) => GAME.c0 + (GAME.c0 * GAME.factor - GAME.c0) * logistic((t - GAME.rise) / 0.015),
  },
  deadline: {
    key: "deadline", name: "A deadline", at: GAME.deadline, end: GAME.deadline, rows: Math.round(GAME.deadline / DT),
    story: "The truck is close: past the line it’s too late to swerve, and if you haven’t chosen you go with your best guess.",
    cost: () => GAME.c0,
  },
  constant: {
    key: "constant", name: "A steady cost", at: null, end: 5, rows: Math.round(5 / DT), secondsPerUnit: 3,
    story: "Every moment of doubt costs the same and the truck is far, so this road plays twice as fast. Here my 2025 rule is nearly the best rule.",
    cost: () => GAME.c0,
  },
};
export const ORDER = ["rises", "deadline", "constant"];
export const kindOfRound = (i) => ORDER[i % ORDER.length];

/** The three rules' walls and exact scores for each schedule. */
export function gameModels(mu = 1) {
  const out = {};
  for (const [k, s] of Object.entries(KINDS)) out[k] = laneModel(rowCosts(s.cost, s.rows), mu);
  return out;
}

/** What a decider could expect from where it stopped: the chance its side is clear given the
 * readings, less the time it paid. */
export function fairPoints(model, n, k, choice) {
  const pRight = posterior(k, model.mu);
  return (choice > 0 ? pRight : 1 - pRight) - model.spent[n];
}

/** The player's result for committing after n readings to a side (+1 right, -1 left), or 0 when
 * time ran out (then the choice goes with the readings, as the rules' does). */
export function yourResult(model, run, n, side) {
  const rows = model.rows;
  n = Math.min(Math.max(n, 0), rows);
  const k = run.path[n], forced = !side || n >= rows;
  const choice = forced ? (k > 0 ? 1 : k < 0 ? -1 : run.tie) : side;
  const correct = choice === run.z;
  return { n, k, choice, correct, forced, points: (correct ? 1 : 0) - model.spent[n], fair: fairPoints(model, n, k, choice) };
}

/** One round: the readings and where each rule commits, with each rule's fair points. */
export function playRound(model, rng) {
  const run = runLanes(model, rng);
  for (const r of RULES) {
    const d = run.decide[r.key];
    d.fair = fairPoints(model, d.n, d.k, d.choice);
  }
  return run;
}

/** Every number the game's text states, from the models (game.js writes them into the page and
 * site/tools/check_site.mjs compares them with what the page says). */
export function gameNumbers(models) {
  const gap = (k) => (models[k].exact.ex.points - models[k].exact.pm.points).toFixed(2);
  return {
    pct: String(Math.round(100 * pUp(models.rises.mu))),
    pctOther: String(100 - Math.round(100 * pUp(models.rises.mu))),
    factor: String(GAME.factor),
    rounds: String(GAME.rounds),
    gapRises: gap("rises"),
    gapDeadline: gap("deadline"),
    gapConstant: gap("constant"),
  };
}

/** Where a reading's glint shows: on the side opposite the one it points to (a reading that points
 * to the clear right side is a glint of the truck on the left). -1 left, +1 right. */
export const glintSide = (reading) => -reading;
