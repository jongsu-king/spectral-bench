import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareMeasurement, MAX_MEASUREMENT_FILE_BYTES, MAX_MEASUREMENT_POINTS,
  measurementPairs, parseMeasurementFile, validateMeasurementTrace,
} from '../dist/app/measurement-csv.js';

test('CSV import preserves escaped labels and duplicate observations in sorted X/Y pairs', () => {
  const file = parseMeasurementFile('\uFEFF# Spectrometer export\r\n\r\n' +
    '"Wavelength, nm","Signal ""A""",Aux\r\n' +
    '500,3,0\r\n400,1,4\r\n500,4,1\r\n450,NaN,8\r\n');
  assert.deepEqual(file.columns, ['Wavelength, nm', 'Signal "A"', 'Aux']);
  assert.deepEqual(measurementPairs(file, 0, 1), {
    xLabel: 'Wavelength, nm', yLabel: 'Signal "A"', x: [400, 500, 500], y: [1, 3, 4], skipped: 1,
  });
  assert.throws(() => measurementPairs(file, 1, 1), /two different columns/);
});

test('semicolon and tab files read decimal commas and preserve a headerless first sample', () => {
  const file = parseMeasurementFile('% Sample data\n2,5;1,5e-2\n−1,2;3,6\n0,4;2,1');
  assert.deepEqual(measurementPairs(file, 0, 1), {
    xLabel: 'Column 1', yLabel: 'Column 2', x: [-1.2, 0.4, 2.5], y: [3.6, 2.1, 0.015], skipped: 0,
  });
  const tab = parseMeasurementFile('"Time\t(ps)"\t"Field\n(a.u.)"\r0,0\t1,3\r0,1\t2,5');
  assert.deepEqual(measurementPairs(tab, 0, 1), {
    xLabel: 'Time\t(ps)', yLabel: 'Field\n(a.u.)', x: [0, 0.1], y: [1.3, 2.5], skipped: 0,
  });
});

test('native long-form imports signal groups with distinct charts and axis labels', () => {
  const rows = [
    ['record', 'instrument', 'acquisition', 'chart', 'series', 'x_axis', 'x', 'y_axis', 'y', 'z', 'setting', 'value'],
    ['setting', 'uv', 'sample', '', '', '', '', '', '', '', 'quoted', '{ "value": "a,b" }'],
    ['signal', 'uv', 'sample', 'Absorbance', 'Sample', 'Wavelength (nm)', 480, 'Absorbance (AU)', 0.2, '', '', ''],
    ['signal', 'uv', 'sample', 'Absorbance', 'Sample', 'Wavelength (nm)', 470, 'Absorbance (AU)', 0.4, '', '', ''],
    ['signal', 'uv', 'sample', 'Absorbance', 'Sample', 'Wavelength (nm)', 460, 'Absorbance (AU)', '', '', '', ''],
    ['signal', 'uv', 'sample', 'Transmittance', 'Sample', 'Wavelength (nm)', 470, 'Transmittance (%)', 40, '', '', ''],
    ['signal', 'uv', 'sample', 'Transmittance', 'Sample', 'Wavelength (nm)', 480, 'Transmittance (%)', 70, '', '', ''],
    ['map', 'uv', 'sample', 'Map', '', 'Wavelength (nm)', 470, 'Time (ps)', 0, 50, '', ''],
  ];
  const csv = '\uFEFF' + rows.map(row => row.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(',')).join('\r\n');
  assert.deepEqual(parseMeasurementFile(csv), {
    columns: [], rows: [], traces: [
      { instrument: 'uv', acquisition: 'sample', chartTitle: 'Absorbance', name: 'Sample', xLabel: 'Wavelength (nm)',
        yLabel: 'Absorbance (AU)', x: [470, 480], y: [0.4, 0.2], skipped: 1 },
      { instrument: 'uv', acquisition: 'sample', chartTitle: 'Transmittance', name: 'Sample', xLabel: 'Wavelength (nm)',
        yLabel: 'Transmittance (%)', x: [470, 480], y: [40, 70], skipped: 0 },
    ],
  });
});

test('malformed or excessive files and nonfinite restored measurements are rejected', () => {
  assert.throws(() => parseMeasurementFile('x,y\n1,2\n3\n4,5'), /Line 3 has 1 columns/);
  assert.throws(() => parseMeasurementFile('x,y\n1,"2\n3,4'), /Unclosed quoted field/);
  assert.throws(() => parseMeasurementFile('é'.repeat(MAX_MEASUREMENT_FILE_BYTES / 2 + 1)), /exceeds 4 MB/);
  const tooMany = parseMeasurementFile('1,2\n'.repeat(MAX_MEASUREMENT_POINTS + 1));
  assert.throws(() => measurementPairs(tooMany, 0, 1), /20,000 points/);
  assert.equal(validateMeasurementTrace({ x: [0, 1], y: [null, 2] }), null);
  assert.deepEqual(validateMeasurementTrace({ xLabel: ' X ', yLabel: 'Y', x: [2, 1, 1], y: [4, 2, 3] }), {
    xLabel: 'X', yLabel: 'Y', x: [1, 1, 2], y: [2, 3, 4],
  });
});

test('measurement comparison respects descending coordinates, masks and duplicate steps', () => {
  const simulated = { x: [10, 8, 6, 4, 4, 2, 0], y: [20, 16, null, 8, 6, 2, 0] };
  const measured = { x: [-1, 0, 1, 3, 4, 5, 7, 8, 9, 10, 11], y: [42, 0, 2, 5, 8, 6, 9, 15, 20, 22, 30] };
  const comparison = compareMeasurement(measured, simulated);
  assert.equal(comparison.count, 6);
  assert(Math.abs(comparison.rmse - Math.sqrt(11 / 6)) < 1e-12);
  assert(Math.abs(comparison.bias - 5 / 6) < 1e-12);
  assert.deepEqual(compareMeasurement({ x: [6, 7, 11], y: [1, 2, 3] }, simulated),
    { count: 0, rmse: null, bias: null });
});
