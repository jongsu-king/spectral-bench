import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionRecovery, packRecovery, unpackRecovery } from '../dist/app/session-recovery.js';

const session = JSON.stringify({ format: 'spectral-bench', version: 1, instrument: 'uv', instruments: { uv: { seed: 632 } } });

function setup(content = null) {
  const calls = { writes: [], restored: [], cleared: 0 };
  let allowed = true, current = session;
  const state = [];
  const storage = { async load() { return { content }; }, async save(value) { calls.writes.push(value); return { saved: true }; },
    async clear() { calls.cleared++; return { cleared: true }; } };
  const recovery = createSessionRecovery({ storage, serialize: () => current, restore: value => calls.restored.push(value),
    canSave: () => allowed, onState: value => state.push(value), now: () => 1000 });
  return { recovery, calls, state, storage, allow(value) { allowed = value; }, change(value) { current = value; } };
}

test('recovery envelopes round-trip sessions and reject invalid or oversized records', () => {
  assert.deepEqual(unpackRecovery(packRecovery(session, 1000)), { session, savedAt: 1000 });
  assert.throws(() => unpackRecovery('{}'), /supported/);
  assert.throws(() => unpackRecovery(packRecovery(session).replace('"savedAt":', '"savedAt":null,"unused":')), /supported/);
  assert.throws(() => packRecovery('{"format":"other"}'), /supported/);
  assert.throws(() => packRecovery('x'.repeat(12_000_001)), /12 MB/);
});

test('unchanged sessions are not rewritten and active acquisitions defer saves', async () => {
  const { recovery, calls, allow, change } = setup();
  await recovery.start();
  allow(false);
  assert.equal(await recovery.flush(), false);
  assert.equal(calls.writes.length, 0);
  allow(true);
  assert.equal(await recovery.flush(), true);
  assert.equal(await recovery.flush(), false);
  change(session.replace('632', '633'));
  assert.equal(await recovery.flush(), true);
  assert.equal(calls.writes.length, 2);
});

test('pending recovery survives normal edits until explicitly restored', async () => {
  const { recovery, calls, state } = setup(packRecovery(session, 1000));
  await recovery.start();
  assert.equal(state.at(-1).pending, true);
  assert.equal(await recovery.flush(), false);
  assert.equal(calls.writes.length, 0);
  assert.equal(await recovery.restorePending(), true);
  assert.deepEqual(calls.restored, [session]);
  assert.equal(state.at(-1).pending, false);
});

test('unreadable recovery is retained until discard and failed writes can retry', async () => {
  const { recovery, calls, state, storage } = setup('broken');
  await recovery.start();
  assert.equal(state.at(-1).pending, true);
  assert.equal(state.at(-1).restorable, false);
  assert.equal(await recovery.flush(), false);
  assert.equal(await recovery.discard(), true);
  assert.equal(calls.cleared, 1);
  storage.save = async () => ({ error: 'Disk full' });
  assert.equal(await recovery.flush(), false);
  assert.equal(state.at(-1).error, 'Disk full');
  storage.save = async value => { calls.writes.push(value); return { saved: true }; };
  assert.equal(await recovery.flush(), true);
  assert.equal(state.at(-1).error, '');
});

test('failed restore or discard keeps the pending copy', async () => {
  const states = [];
  const recovery = createSessionRecovery({
    storage: { load: () => ({ content: packRecovery(session) }), clear: () => ({ error: 'Read only' }) },
    serialize: () => session, restore: () => { throw new Error('Invalid optic'); }, onState: state => states.push(state),
  });
  await recovery.start();
  assert.equal(await recovery.restorePending(), false);
  assert.equal(states.at(-1).pending, true);
  assert.equal(states.at(-1).error, 'Invalid optic');
  assert.equal(await recovery.discard(), false);
  assert.equal(states.at(-1).pending, true);
});
