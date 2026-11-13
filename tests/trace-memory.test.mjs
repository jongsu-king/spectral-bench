import test from 'node:test';
import assert from 'node:assert/strict';
import { overlayLineCharts, snapshotLineCharts } from '../dist/app/trace-memory.js';

const sample = () => ({
  title: 'Absorbance spectrum', xLabel: 'Wavelength (nm)', yLabel: 'Absorbance (AU)',
  series: [{ name: 'Sample', x: [480, 490, 500], y: [0.1, NaN, 0.5] }],
});

test('trace memory freezes the measured values and preserves gaps on a session round trip', () => {
  const live = sample();
  const memory = snapshotLineCharts([live]);
  live.series[0].y[0] = 0.8;
  const restored = snapshotLineCharts(JSON.parse(JSON.stringify(memory)));
  const { charts, count } = overlayLineCharts([live], restored);
  assert.equal(count, 1);
  assert.equal(live.series.length, 1);
  assert.deepEqual(charts[0].series[1].y, [0.1, null, 0.5]);
  assert.equal(charts[0].series[1].memory, true);
});

test('trace memory leaves heatmaps and incompatible measurement units unmodified', () => {
  const live = sample();
  const map = { ...live, heatmap: { x: [480, 490], y: [0], z: [[1, 2]] } };
  assert.equal(snapshotLineCharts([map]).length, 0);
  const changedUnits = { ...live, xLabel: 'Raman shift (cm⁻¹)' };
  const result = overlayLineCharts([changedUnits, map], snapshotLineCharts([live]));
  assert.equal(result.count, 0);
  assert.deepEqual(result.charts, [changedUnits, map]);
});
