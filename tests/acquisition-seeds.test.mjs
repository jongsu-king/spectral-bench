import assert from 'node:assert/strict';
import test from 'node:test';
import { nextAcquisitionSeed, restoredRepeatSeeds, validSeed } from '../dist/app/acquisition-seeds.js';

test('accepted session seeds stay reproducible when acquisition crosses the former 1e9 boundary', () => {
  const seeds = [1, 2, 3].map(offset => nextAcquisitionSeed(999999999, offset));
  assert.deepEqual(seeds, [1000000000, 1000000001, 1000000002]);
  assert.equal(validSeed(seeds.at(-1)), seeds.at(-1));
  assert.deepEqual(restoredRepeatSeeds(seeds, validSeed(seeds.at(-1))), seeds);
});

test('the same uint32 seed domain as JS and MATLAB wraps without a missing or duplicated scan', () => {
  const seeds = [1, 2, 3].map(offset => nextAcquisitionSeed(0xfffffffe, offset));
  assert.deepEqual(seeds, [0xffffffff, 0, 1]);
  assert.deepEqual(restoredRepeatSeeds(seeds, 1), seeds);
  assert.equal(restoredRepeatSeeds([0xffffffff, 1, 0], 0), null);
  assert.equal(validSeed(0xffffffff), 0xffffffff);
  assert.equal(validSeed(0x100000000), 631);
  assert.equal(validSeed(-1), 631);
  assert.throws(() => nextAcquisitionSeed(1.5), /seed/);
});
