// The driverless car, as the paper's model on the decision machine's lattice (lanes.js). A car
// first sees something in the road one time unit before the last moment it can still swerve
// around it. Every row (0.01 of a time unit) it takes one noisy reading that points to the clear
// side with probability p = (1 + delta) / 2 = 0.55. Every moment of doubt costs c0 per time
// unit, and at the last moment the car must swerve toward whichever side its readings favor (the
// deadline schedule, "A window closes"). The three cars, one per rule, get the same readings.
//
// Pure functions, no DOM: car.js draws them and site/tools/check_site.mjs checks them.
import { DT, rowCosts } from "./lattice.js";
import { laneModel, runLanes } from "./lanes.js";

export { RULES, lookAheadLevels, confidenceAt } from "./lanes.js";

/** The story's numbers: the cost of a moment of doubt and the deadline, in model units. */
export const CAR = { c0: 0.1, deadline: 1, speed: 20 };
export const ROWS = Math.round(CAR.deadline / DT);

/** The three wall sets for the car, and each one's exact expected score. */
export const carWalls = (mu = 1) => laneModel(rowCosts(() => CAR.c0, ROWS), mu);

/** One car: see lanes.js runLanes. */
export const runCar = runLanes;
