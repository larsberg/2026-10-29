export const boxFields = [
  ['spread', 'Box spread (×)', 2, 0, 4, .05],
];

export function validateBoxSpread(value = boxFields[0][2]) {
  const [, label, , min, max] = boxFields[0];
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label}.`);
  return value;
}
