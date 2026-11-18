import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSessionDocument } from '../dist/app/session-format.js';

const instruments = ['uv', 'pl'];
const document = { format: 'spectral-bench', version: 1, instrument: 'pl', instruments: { pl: { settings: { concentration: 5 }, seed: 632 } } };
const parse = value => parseSessionDocument(JSON.stringify(value), instruments);

test('complete instrument and workbench-only documents retain backward-compatible version 1', () => {
  assert.deepEqual(parse(document), document);
  const bench = { ...document, instrument: 'workbench', instruments: {}, workbench: { scene: { parts: [] } } };
  assert.deepEqual(parse(bench), bench);
});

test('malformed instrument containers and absent active records cannot silently reset an experiment', () => {
  for (const invalid of [[], true, 'pl', null]) assert.throws(() => parse({ ...document, instruments: invalid }), /supported/);
  assert.throws(() => parse({ ...document, instruments: {} }), /selected instrument/);
  assert.throws(() => parse({ ...document, instruments: { pl: {} } }), /incomplete/);
  assert.throws(() => parse({ ...document, instruments: { ...document.instruments, uv: null } }), /incomplete/);
  assert.throws(() => parse({ ...document, instrument: '__proto__' }), /supported/);
});

test('workbench selection requires its own scene before any existing state can be replaced', () => {
  for (const workbench of [undefined, {}, { scene: {} }, { scene: { parts: 'invalid' } }]) {
    assert.throws(() => parse({ ...document, instrument: 'workbench', workbench }), /workbench layout/);
  }
  assert.throws(() => parseSessionDocument('broken', instruments), SyntaxError);
});
