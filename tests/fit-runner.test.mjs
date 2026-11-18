import test from 'node:test';
import assert from 'node:assert/strict';
import { startTraceFit, selectedFitPointCount } from '../dist/app/fit-runner.js';
import { fitTrace } from '../dist/app/plot-fit.js';

class FakeWorker {
  terminated = 0;
  postMessage(message) { this.request = message; }
  terminate() { this.terminated++; }
}
const data = { x: [0, 1, 2, 3], y: [1, 3, 5, 7] };

test('background fit messages transfer only numeric arrays and return the existing fit result', async () => {
  const worker = new FakeWorker(), execution = [];
  const task = startTraceFit({ ...data, name: 'Measured', extra: () => {} }, { model: 'linear' },
    { createWorker: () => worker, onExecution: mode => execution.push(mode) });
  assert.deepEqual(worker.request, { series: data, options: { model: 'linear', min: undefined, max: undefined } });
  assert.notEqual(worker.request.series.x, data.x);
  assert.equal(task.count, 4); assert.equal(task.execution, 'worker');
  assert.deepEqual(execution, [{ mode: 'worker', count: 4, cancellable: true }]);
  const result = fitTrace(data, { model: 'linear' });
  worker.onmessage({ data: { kind: 'result', result } });
  assert.deepEqual(await task.promise, result);
  assert.equal(worker.terminated, 1); assert.equal(worker.onmessage, null); assert.equal(task.cancel(), false);
});

test('cancelling terminates numerical work and ignores a late result', async () => {
  const worker = new FakeWorker(), task = startTraceFit(data, { model: 'linear' }, { createWorker: () => worker });
  const lateMessage = worker.onmessage;
  const rejection = assert.rejects(task.promise, { name: 'AbortError', message: 'Fit stopped.' });
  assert.equal(task.cancel(), true); assert.equal(task.cancel(), false);
  lateMessage({ data: { kind: 'result', result: 'stale' } });
  await rejection; assert.equal(worker.terminated, 1);
});

test('a reported fit error rejects directly instead of silently refitting in the foreground', async () => {
  const worker = new FakeWorker(); let foregroundCalls = 0;
  const task = startTraceFit(data, { model: 'linear' }, { createWorker: () => worker,
    foregroundFit: () => { foregroundCalls++; } });
  worker.onmessage({ data: { kind: 'error', message: 'Select at least 5 distinct measured points for this fit.' } });
  await assert.rejects(task.promise, /5 distinct/); assert.equal(foregroundCalls, 0); assert.equal(worker.terminated, 1);
});

test('a worker-load failure uses an announced bounded foreground fallback', async () => {
  const worker = new FakeWorker(), modes = [];
  const task = startTraceFit(data, { model: 'linear' }, { createWorker: () => worker, onExecution: mode => modes.push(mode) });
  let prevented = false;
  worker.onerror({ preventDefault() { prevented = true; } });
  assert(prevented); assert.equal(worker.terminated, 1); assert.equal(task.execution, 'foreground');
  assert.deepEqual(modes.map(mode => [mode.mode, mode.cancellable]), [['worker', true], ['foreground', false]]);
  assert.deepEqual(await task.promise, fitTrace(data, { model: 'linear' }));
});

test('foreground fallback counts the selected finite range and refuses a long blocking fit', async () => {
  const many = { x: Array.from({ length: 20_000 }, (_, i) => i), y: Array.from({ length: 20_000 }, (_, i) => 2 * i + 3) };
  const unavailable = () => { throw new Error('No Worker'); };
  const task = startTraceFit(many, { model: 'linear' }, { createWorker: unavailable });
  await assert.rejects(task.promise, /2,000 finite points/);
  const bounded = startTraceFit(many, { model: 'linear', min: 0, max: 9 }, { createWorker: unavailable });
  assert.equal((await bounded.promise).count, 10);
  assert.equal(selectedFitPointCount({ x: [0, 1, 2, null, 4], y: [0, null, 2, 3, Infinity] }, { min: 0, max: 3 }), 2);
});

test('a pending foreground fallback can be cancelled before its bounded calculation begins', async () => {
  let scheduled, cancelled, calls = 0;
  const task = startTraceFit(data, { model: 'linear' }, { createWorker() { throw new Error('No Worker'); },
    schedule(callback) { scheduled = callback; return 17; }, cancelSchedule(id) { cancelled = id; },
    foregroundFit() { calls++; } });
  const rejection = assert.rejects(task.promise, { name: 'AbortError' });
  task.cancel(); scheduled(); await rejection;
  assert.equal(cancelled, 17); assert.equal(calls, 0);
});
