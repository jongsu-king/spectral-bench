export const MAX_MEASUREMENT_FILE_BYTES = 4_000_000;
export const MAX_MEASUREMENT_POINTS = 20_000;

const MAX_COLUMNS = 64;
const MAX_ROWS = 100_000;
const MAX_TRACES = 128;
const MAX_LABEL_LENGTH = 160;
const delimiters = [',', '\t', ';'];
const nativeColumns = [
  'record', 'instrument', 'acquisition', 'chart', 'series', 'x_axis', 'x', 'y_axis', 'y', 'z', 'setting', 'value',
];
const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const missingPattern = /^(?:|nan|n\/a|na|null|—|-)$/i;

function label(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_LABEL_LENGTH) : '';
}

function numericCell(value, delimiter) {
  let numeric = value.trim().replace(/^−/, '-');
  if (delimiter !== ',') numeric = numeric.replace(',', '.');
  if (!numberPattern.test(numeric)) return null;
  const number = Number(numeric);
  return Number.isFinite(number) ? number : null;
}

function commentStartsAt(text, index) {
  let first = index;
  while (text[first] === ' ' || text[first] === '\t') first++;
  return text[first] === '#' || text.startsWith('//', first) ||
    (text[first] === '%' && (text[first + 1] === ' ' || text[first + 1] === '\t'));
}

function readRows(text, delimiter, limit) {
  const rows = [];
  let fields = [];
  let field = '';
  let line = 1;
  let rowLine = 1;
  let lineStart = true;
  let quoted = false;
  let closedQuote = false;

  function finishField() {
    fields.push(field.trim());
    if (fields.length > MAX_COLUMNS) throw new Error('Line ' + rowLine + ' has more than ' + MAX_COLUMNS + ' columns.');
    field = '';
    closedQuote = false;
  }

  function finishRow() {
    finishField();
    if (fields.some(value => value !== '')) rows.push({ fields, line: rowLine });
    fields = [];
  }

  for (let index = 0; index < text.length && rows.length < limit; index++) {
    const char = text[index];
    if (lineStart) {
      lineStart = false;
      if (commentStartsAt(text, index)) {
        while (index < text.length && text[index] !== '\n' && text[index] !== '\r') index++;
        if (text[index] === '\r' && text[index + 1] === '\n') index++;
        line++;
        rowLine = line;
        lineStart = true;
        continue;
      }
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      if (quoted) {
        field += '\n';
        line++;
      } else {
        finishRow();
        line++;
        rowLine = line;
        lineStart = true;
      }
      continue;
    }
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
        closedQuote = true;
      } else field += char;
    } else if (char === delimiter) finishField();
    else if (closedQuote) {
      if (char !== ' ' && char !== '\t') throw new Error('Unexpected character after a quoted field on line ' + line + '.');
    } else if (char === '"') {
      if (field.trim()) throw new Error('Unexpected quote on line ' + line + '.');
      field = '';
      quoted = true;
    } else field += char;
  }
  if (quoted) throw new Error('Unclosed quoted field starting on line ' + rowLine + '.');
  if (rows.length < limit && (field || fields.length || closedQuote)) finishRow();
  return rows;
}

function numericRow(fields, delimiter) {
  return fields.some(value => numericCell(value, delimiter) !== null) &&
    fields.every(value => missingPattern.test(value) || numericCell(value, delimiter) !== null);
}

function selectDelimiter(text) {
  let best;
  let error;
  for (const delimiter of delimiters) {
    let sample;
    try {
      sample = readRows(text, delimiter, 12);
    } catch (reason) {
      error ??= reason;
      continue;
    }
    const width = sample[0]?.fields.length ?? 0;
    if (width < 2) continue;
    const data = sample.slice(numericRow(sample[0].fields, delimiter) ? 0 : 1);
    const cells = data.flatMap(row => row.fields);
    const matching = sample.filter(row => row.fields.length === width).length;
    const numerics = cells.filter(value => numericCell(value, delimiter) !== null).length;
    const score = 4 * matching / sample.length + 2 * numerics / Math.max(1, cells.length);
    if (!best || score > best.score) best = { delimiter, score };
  }
  if (best) return best.delimiter;
  throw error ?? new Error('Use a CSV, TSV or semicolon-delimited file with at least two columns.');
}

function sortedPairs(pairs) {
  pairs.sort((a, b) => a[0] - b[0]);
  return { x: pairs.map(pair => pair[0]), y: pairs.map(pair => pair[1]) };
}

function addPair(pairs, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (pairs.length >= MAX_MEASUREMENT_POINTS) {
    throw new Error('A measurement trace may contain up to ' + MAX_MEASUREMENT_POINTS.toLocaleString('en-US') + ' points.');
  }
  pairs.push([x, y]);
  return true;
}

function parseNativeTraces(rows, indexes, delimiter) {
  const groups = new Map();
  for (const { fields } of rows) {
    const get = key => fields[indexes.get(key)];
    const record = get('record').toLowerCase();
    if (record !== 'signal' && record !== 'measured_signal') continue;
    const identity = [get('instrument'), get('acquisition'), get('chart'), get('series'), get('x_axis'), get('y_axis')];
    const key = JSON.stringify([record, ...identity]);
    let group = groups.get(key);
    if (!group) {
      if (groups.size >= MAX_TRACES) throw new Error('This file contains too many signal series.');
      group = { identity, pairs: [], skipped: 0 };
      groups.set(key, group);
    }
    if (!addPair(group.pairs, numericCell(get('x'), delimiter), numericCell(get('y'), delimiter))) group.skipped++;
  }
  const traces = [];
  for (const { identity, pairs, skipped } of groups.values()) {
    if (pairs.length < 2) continue;
    const [instrument, acquisition, chartTitle, name, xLabel, yLabel] = identity.map(label);
    traces.push({ instrument, acquisition, chartTitle, name, xLabel, yLabel, ...sortedPairs(pairs), skipped });
  }
  if (!traces.length) throw new Error('This export contains no signal series with two numeric X/Y pairs.');
  return traces;
}

export function parseMeasurementFile(text) {
  if (typeof text !== 'string') throw new Error('The measurement file must contain text.');
  if (text.length > MAX_MEASUREMENT_FILE_BYTES || new TextEncoder().encode(text).length > MAX_MEASUREMENT_FILE_BYTES) {
    throw new Error('The measurement file exceeds 4 MB.');
  }
  if (text.includes('\0')) throw new Error('Use a UTF-8 text file for measurement data.');
  const content = text.replace(/^\uFEFF/, '');
  const delimiter = selectDelimiter(content);
  const rows = readRows(content, delimiter, MAX_ROWS + 1);
  if (rows.length > MAX_ROWS) throw new Error('The measurement file has too many rows.');

  const header = rows[0].fields;
  if (header.length * rows.length > 1_000_000) throw new Error('The measurement file has too many cells.');
  for (const row of rows) {
    if (row.fields.length !== header.length) {
      throw new Error('Line ' + row.line + ' has ' + row.fields.length + ' columns. Expected ' + header.length + '.');
    }
  }
  const indexes = new Map(header.map((value, index) => [value.toLowerCase(), index]));
  if (nativeColumns.every(key => indexes.has(key))) {
    return { columns: [], rows: [], traces: parseNativeTraces(rows.slice(1), indexes, delimiter) };
  }

  const headerless = numericRow(header, delimiter);
  const columns = header.map((value, index) => (!headerless && label(value)) || 'Column ' + (index + 1));
  const data = rows.slice(headerless ? 0 : 1).map(row => row.fields.map(value => numericCell(value, delimiter)));
  if (data.filter(row => row.filter(Number.isFinite).length >= 2).length < 2) {
    throw new Error('The measurement file needs at least two rows with numeric X/Y values.');
  }
  return { columns, rows: data, traces: [] };
}

export function measurementPairs(parsed, xColumn, yColumn) {
  const count = parsed.columns.length;
  if (![xColumn, yColumn].every(index => Number.isInteger(index) && index >= 0 && index < count) || xColumn === yColumn) {
    throw new Error('Choose two different columns for X and Y.');
  }
  const pairs = [];
  let skipped = 0;
  for (const row of parsed.rows) {
    if (!addPair(pairs, row[xColumn], row[yColumn])) skipped++;
  }
  if (pairs.length < 2) throw new Error('The selected columns need at least two numeric X/Y pairs.');
  return { xLabel: parsed.columns[xColumn], yLabel: parsed.columns[yColumn], ...sortedPairs(pairs), skipped };
}

export function validateMeasurementTrace(value) {
  const { x, y } = value ?? {};
  if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length ||
      x.length < 2 || x.length > MAX_MEASUREMENT_POINTS) return null;
  const pairs = [];
  for (let index = 0; index < x.length; index++) {
    if (!addPair(pairs, x[index], y[index])) return null;
  }
  return { xLabel: label(value.xLabel), yLabel: label(value.yLabel), ...sortedPairs(pairs) };
}

function simulationSampler({ x, y }) {
  const exact = new Map();
  const spans = [];
  for (let index = 0; index < x.length; index++) {
    const next = x[index];
    const nextY = y[index];
    if (!Number.isFinite(next) || !Number.isFinite(nextY)) continue;
    if (!exact.has(next)) exact.set(next, nextY);
    else if (exact.get(next) !== nextY) exact.set(next, null);
    const previous = x[index - 1];
    const previousY = y[index - 1];
    if (!Number.isFinite(previous) || !Number.isFinite(previousY) || previous === next) continue;
    spans.push(previous < next
      ? { from: previous, to: next, fromY: previousY, toY: nextY }
      : { from: next, to: previous, fromY: nextY, toY: previousY });
  }
  spans.sort((a, b) => a.from - b.from);
  let upper = -Infinity;
  for (const span of spans) {
    upper = Math.max(upper, span.to);
    span.upper = upper;
  }
  return target => {
    if (exact.has(target)) return exact.get(target);
    let low = 0;
    let high = spans.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (spans[middle].upper < target) low = middle + 1;
      else high = middle;
    }
    const span = spans[low];
    if (!span || target < span.from) return null;
    const width = span.to - span.from;
    const fraction = Number.isFinite(width) ? (target - span.from) / width
      : (target / 2 - span.from / 2) / (span.to / 2 - span.from / 2);
    return (1 - fraction) * span.fromY + fraction * span.toY;
  };
}

export function compareMeasurement(measured, simulated) {
  if (!measured?.x || !measured.y || !simulated?.x || !simulated.y) {
    return { count: 0, rmse: null, bias: null };
  }
  const sample = simulationSampler(simulated);
  let count = 0;
  let scale = 0;
  let sum = 0;
  let squares = 0;
  for (let index = 0; index < measured.x.length; index++) {
    const x = measured.x[index];
    const y = measured.y[index];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const expected = sample(x);
    if (!Number.isFinite(expected)) continue;
    const difference = y - expected;
    if (!Number.isFinite(difference)) continue;
    const magnitude = Math.abs(difference);
    if (magnitude > scale) {
      const factor = scale / magnitude;
      sum *= factor;
      squares *= factor ** 2;
      scale = magnitude;
    }
    if (scale > 0) {
      const scaled = difference / scale;
      sum += scaled;
      squares += scaled ** 2;
    }
    count++;
  }
  return {
    count,
    rmse: count ? scale * Math.sqrt(squares / count) : null,
    bias: count ? scale * (sum / count) : null,
  };
}
