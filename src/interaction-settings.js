// The grab motor's original force ceiling, per unit of sculpture mass.
export const MAX_GRAB_FORCE = 10000;
export const DEFAULT_GRAB_FORCE = 1000;
export const interactionFields = [
  ['grabForce', 'Grab / throw force', DEFAULT_GRAB_FORCE, 0, MAX_GRAB_FORCE, 10],
];
