import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTrace } from '../dist/app/plot-analysis.js';
import { samplePresets } from '../dist/app/sample-presets.js';
import { traceInstrumentOptics } from '../dist/app/instrument-optics.js';
import { opticalModels } from '../dist/app/models-optical.js';
import { advancedModels } from '../dist/app/models-advanced.js';

test('surface sweeps align different sample grids without extending or filling masked values', () => {
  const trace = { x: [4, 2, 0, 1], y: [8, NaN, 0, 2] };
  assert.deepEqual(projectTrace(trace, [-1, 0, 0.5, 1, 1.5, 2, 3, 4, 5]), [null, 0, 1, 2, null, null, null, 8, null]);
});

test('each of the nine instruments has two literature specimens with distinct calculated signals', () => {
  const models = { ...opticalModels, ...advancedModels };
  assert.deepEqual(Object.keys(samplePresets).sort(), Object.keys(models).sort());
  for (const [id, model] of Object.entries(models)) {
    const responses = [];
    for (const preset of samplePresets[id]) {
      assert.match(preset.source.url, /^https:\/\//);
      const settings = { ...Object.fromEntries(model.controls.map(control => [control.key, control.value])),
        ...preset.settings, sampleProfile: preset.profile };
      const trace = traceInstrumentOptics(id, settings);
      const { charts } = model.simulate(settings, { mode: 'sample', seed: 631, ...trace });
      const lines = charts.flatMap(chart => chart.series ?? []);
      assert(lines.some(series => series.y.some(Number.isFinite)), id + '/' + preset.id);
      responses.push(JSON.stringify(charts));
    }
    assert(responses.length >= 2 && new Set(responses).size === responses.length, id + ': distinguish the specimens');
  }
});
