import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepeatAccumulator } from '../dist/app/repeat-acquisition.js';

const line = (values, x = [1, 2, 3]) => ({ charts: [{
  title: 'Detector signal', xLabel: 'Wavelength (nm)', yLabel: 'Counts',
  series: [{ name: 'Sample', x, y: values }],
}] });

test('repeated acquisitions return means, sample standard deviation and independent output snapshots', () => {
  const accumulator = createRepeatAccumulator();
  const first = line([1, 3, 1e12 + 1]);
  accumulator.add(first);
  first.charts[0].series[0].y[0] = 200;
  accumulator.add(line([3, 7, 1e12 + 2]));
  accumulator.add(line([5, 11, 1e12 + 3]));
  const result = accumulator.result();
  assert.equal(result.count, 3);
  assert.deepEqual(result.charts[0].series[0].y, [3, 7, 1e12 + 2]);
  assert.deepEqual(result.deviationCharts[0].series[0].y, [2, 4, 1]);
  assert.equal(result.deviationCharts[0].yLabel, 'SD · Counts');
  assert.deepEqual(result.counts[0].series[0], [3, 3, 3]);
  result.charts[0].series[0].y[0] = 100;
  assert.equal(accumulator.result().charts[0].series[0].y[0], 3);
});

test('masked samples keep per-point counts and a single observation has no sample deviation', () => {
  const accumulator = createRepeatAccumulator();
  accumulator.add(line([1, NaN, null]));
  assert.deepEqual(accumulator.result().deviationCharts[0].series[0].y, [null, null, null]);
  accumulator.add(line([3, 9, Infinity]));
  const { charts, deviationCharts, counts } = accumulator.result();
  assert.deepEqual(charts[0].series[0].y, [2, 9, null]);
  assert.deepEqual(deviationCharts[0].series[0].y, [Math.sqrt(2), null, null]);
  assert.deepEqual(counts[0].series[0], [2, 1, 0]);
});

test('map statistics preserve holes and account for each finite cell', () => {
  const accumulator = createRepeatAccumulator();
  const map = z => ({ charts: [{ title: 'TA map', xLabel: 'Wavelength (nm)', yLabel: 'Delay (ps)', series: [],
    heatmap: { x: [500, 600], y: [0, 1], z } }] });
  accumulator.add(map([[1, NaN], [2, 4]]));
  accumulator.add(map([[3, 8], [null, 6]]));
  const result = accumulator.result();
  assert.deepEqual(result.charts[0].heatmap.z, [[2, 8], [2, 5]]);
  assert.deepEqual(result.counts[0].heatmap, [[2, 1], [1, 2]]);
  assert.deepEqual(result.deviationCharts[0].heatmap.z, [[Math.sqrt(2), null], [null, Math.sqrt(2)]]);
});

test('changed grids or channels reject the entire acquisition without mutating previous statistics', () => {
  const accumulator = createRepeatAccumulator();
  assert.deepEqual(accumulator.result(), { charts: [], deviationCharts: [], count: 0, counts: [], metrics: [], metricDeviations: [] });
  accumulator.add(line([1, 2, 3]));
  const original = accumulator.result();
  assert.throws(() => accumulator.add(line([3, 4, 5], [1, 2, 4])), /coordinates changed/);
  const differentUnit = line([3, 4, 5]);
  differentUnit.charts[0].yLabel = 'Transmittance (%)';
  assert.throws(() => accumulator.add(differentUnit), /units changed/);
  const malformed = line([3, 4]);
  assert.throws(() => accumulator.add(malformed), /unequal/);
  assert.deepEqual(accumulator.result(), original);
});

test('numeric metrics aggregate by label and unit while changing text metrics are omitted', () => {
  const accumulator = createRepeatAccumulator();
  const record = (value, status) => ({ ...line([1, 2, 3]), metrics: [
    { label: 'Lifetime', unit: 'ns', value }, { label: 'Status', value: status },
    { label: 'Sample', value: 'Coumarin' },
  ] });
  accumulator.add(record('2.0', 'Ready'));
  accumulator.add(record(4, 'Changed'));
  const result = accumulator.result();
  assert.deepEqual(result.metrics, [
    { label: 'Lifetime', unit: 'ns', value: 3, count: 2 }, { label: 'Sample', value: 'Coumarin' },
  ]);
  assert.deepEqual(result.metricDeviations, [{ label: 'Lifetime', unit: 'ns', value: Math.sqrt(2), count: 2 }]);
  const invalid = record(100, 'Ready');
  invalid.metrics.push({ label: 'Malformed', value: {} });
  assert.throws(() => accumulator.add(invalid), /invalid metric/);
  assert.deepEqual(accumulator.result(), result);
});
