export const rigidBodyFields = [
  ['gravity', 'Rigid-body gravity', 98, 0, 980, .1],
  ['friction', 'Rigid-body friction', .55, 0, 2, .01],
];
export const RIGID_BODY_GRAVITY = rigidBodyFields[0][2];
export const RIGID_BODY_FRICTION = rigidBodyFields[1][2];
export const MAX_RIGID_BODY_GRAVITY = rigidBodyFields[0][4];

export function validateRigidBody(value) {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('Invalid rigid body settings.');
  const gravity = value?.gravity === undefined ? RIGID_BODY_GRAVITY : value.gravity;
  if (!Number.isFinite(gravity) || gravity < 0 || gravity > MAX_RIGID_BODY_GRAVITY) throw new Error('Invalid Rigid-body gravity.');
  const friction = value?.friction === undefined ? RIGID_BODY_FRICTION : value.friction;
  if (!Number.isFinite(friction) || friction < 0 || friction > 2) throw new Error('Invalid Rigid-body friction.');
  return {gravity, friction};
}
