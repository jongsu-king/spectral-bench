import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreAnalysisSettings, serializeAnalysisSettings, restorePlotCursors } from '../dist/app/session-analysis.js';

test('session analysis retains chosen inputs without stale fitted data or full model arrays', () => {
  const state = { fitPanel: { key: '[1,"Time (ns)","Counts"]', series: 1, min: '3', max: '18', model: 'exponential',
    output: { large: [1, 2, 3] }, error: 'old' },
  traceAnalysis: { key: '[0,"Signal","X","Y"]', series: 0, min: '', max: '12', baseline: 'constant', baselineValue: '-2' },
  mapSettings: { key: 'concentration', min: 1, max: 10, steps: 7 } };
  const saved = JSON.parse(JSON.stringify(serializeAnalysisSettings(state)));
  assert.equal(saved.fit.output, undefined);
  const restored = restoreAnalysisSettings(saved, [{ type: 'range', key: 'concentration', min: 0, max: 100 }]);
  assert.deepEqual(restored.fitPanel, { key: state.fitPanel.key, series: 1, min: '3', max: '18', model: 'exponential', output: null, error: '' });
  assert.equal(restored.traceAnalysis.baselineValue, '-2');
  assert.deepEqual(restored.mapSettings, state.mapSettings);
});

test('malformed analysis settings and out-of-bounds sweep ranges cannot enter restored controls', () => {
  const restored = restoreAnalysisSettings({ fit: { key: 'valid', series: 900, model: '__proto__', min: 'bad', max: 'Infinity' },
    statistics: { key: 'valid', baseline: 'unknown', baselineValue: Infinity },
    map: { key: 'concentration', min: -1, max: 9999, steps: 1000 } }, [{ type: 'range', key: 'concentration', min: 0, max: 100 }]);
  assert.equal(restored.fitPanel.model, 'gaussian');
  assert.equal(restored.fitPanel.series, 0);
  assert.equal(restored.fitPanel.min, '');
  assert.equal(restored.fitPanel.max, '');
  assert.equal(restored.traceAnalysis.baseline, 'none');
  assert.equal(restored.traceAnalysis.baselineValue, '0');
  assert.equal(restored.mapSettings, null);
});

test('A/B cursors round-trip finite line and map coordinates, excluding invalid entries', () => {
  const values = [['line', { a: { x: 3 }, b: { x: 18 } }], ['map', { a: { x: 540, y: 2.5 }, b: null }],
    ['bad', { a: { x: 1, y: NaN } }], [null, { a: { x: 3 } }]];
  const cursors = restorePlotCursors(values);
  assert.deepEqual([...cursors.keys()], ['line', 'map']);
  const restored = restorePlotCursors(JSON.parse(JSON.stringify([...cursors])));
  assert.deepEqual(restored, cursors);
});
