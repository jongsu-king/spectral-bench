const maximum = 0xffffffff;
export const isAcquisitionSeed = value => Number.isInteger(value) && value >= 0 && value <= maximum;
export const validSeed = value => isAcquisitionSeed(value) ? value : 631;

export function nextAcquisitionSeed(seed, offset = 1) {
  if (!isAcquisitionSeed(seed) || !Number.isInteger(offset) || offset < 0 || offset > 25) {
    throw new Error('Invalid acquisition seed sequence.');
  }
  return (seed + offset) >>> 0;
}

export function restoredRepeatSeeds(value, finalSeed) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 25 || value.at(-1) !== finalSeed) return null;
  return value.every((seed, index) => isAcquisitionSeed(seed) &&
    (index === 0 || seed === nextAcquisitionSeed(value[index - 1]))) ? [...value] : null;
}
