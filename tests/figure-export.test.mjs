import test from 'node:test';
import assert from 'node:assert/strict';
import { figureFilename, wrapFigureText } from '../dist/app/figure-export.js';

test('figure filenames keep a bounded portable title and the selected extension', () => {
  assert.equal(figureFilename('UV–Vis · Absorbance (A.U.)', 'svg'), 'spectral-bench-uv-vis-absorbance-a-u.svg');
  assert.equal(figureFilename('Δ', 'png'), 'spectral-bench-figure.png');
  assert.equal(figureFilename('Café', 'svg'), 'spectral-bench-cafe.svg');
  assert(figureFilename('x'.repeat(300), 'svg').length <= 119);
  assert.throws(() => figureFilename('test', 'exe'), /SVG or PNG/);
});

test('figure text wraps words and unbroken imported filenames without losing text', () => {
  const measure = text => text.length;
  assert.deepEqual(wrapFigureText('Signal reference background', 16, measure), ['Signal reference', 'background']);
  assert.deepEqual(wrapFigureText('longfilename.csv', 5, measure), ['longf', 'ilena', 'me.cs', 'v']);
  const original = 'αβγδ'.repeat(30);
  const lines = wrapFigureText(original, 9, measure);
  assert.equal(lines.join(''), original);
  assert(lines.every(line => line.length <= 9));
  assert.deepEqual(wrapFigureText('', 100, measure), []);
  assert.throws(() => wrapFigureText('Signal', 0, measure), /positive/);
});
