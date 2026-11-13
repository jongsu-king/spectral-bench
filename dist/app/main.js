import { opticalModels } from './models-optical.js';
import { advancedModels, setFftBackend } from './models-advanced.js';
import { traceBench } from './bench.js';
import { formatNumber, renderCharts } from './charts.js';
import { protocols } from './protocols.js';
import { createWorkbench } from './workbench3d.js';
import { createViewport3D } from './viewport3d.js';
import { createRayInspector } from './ray-inspector.js';
import { createAlignmentSweep } from './alignment-sweep.js';
import { addMeasuredOverlay, createMeasurementImport, measuredComparison, restoreMeasuredTrace } from './measurement-import.js';
import { createInstrumentScene, traceInstrumentOptics } from './instrument-optics.js';
import { changePose, changeProperty, editedScene, emptyEdits, hasEdits, newOptic, partNames, partProperties, removePart, restoreEdits } from './instrument-layout.js';
import { overlayLineCharts, snapshotLineCharts } from './trace-memory.js';
import { renderPlotTable } from './plot-table.js';
import { createPlotAnalysis } from './plot-analysis.js';
import { samplePresets } from './sample-presets.js';

const models = { ...opticalModels, ...advancedModels };
const catalog = {
  array: {
    tab: 'Array', name: 'Array Spectrometer', category: 'CCD ARRAY', icon: 'array',
    description: 'Disperse incident light with a diffraction grating and read the spectrum across a linear CCD.',
    reference: 'Calibrate wavelength',
    url: 'https://www.oceanoptics.com/wp-content/uploads/2024/12/USB4000-Operating-Instructions.pdf',
  },
  uv: {
    tab: 'UV–Vis', name: 'UV–Vis Spectrophotometer', category: 'UV–VISIBLE', icon: 'uv',
    description: 'Measure wavelength-dependent transmission or reflectance using a blank or white standard.',
    reference: 'Acquire blank', dark: true,
    url: 'https://www.shimadzu.com/an/service-support/technical-support/uv/overview/structure.html',
  },
  pl: {
    tab: 'PL', name: 'Steady-State Photoluminescence', category: 'PHOTOLUMINESCENCE', icon: 'pl',
    description: 'Excite a sample at a fixed wavelength and scan its emitted light.',
    reference: 'Acquire blank',
    url: 'https://www.horiba.com/pol/scientific/technologies/fluorescence-spectroscopy/what-is-a-fluorescence-measurement/',
  },
  trpl: {
    tab: 'TRPL', name: 'Time-Resolved Photoluminescence', category: 'TCSPC', icon: 'clock',
    description: 'Record single-photon delays after laser excitation and fit the emission lifetime.',
    reference: 'Acquire IRF',
    url: 'https://www.picoquant.com/applications-methods/tcspc/',
  },
  raman: {
    tab: 'Raman', name: 'Confocal Raman Spectrometer', category: 'RAMAN SCATTERING', icon: 'raman',
    description: 'Find vibrational modes from the wavenumber shift of scattered light.',
    reference: 'Acquire Si standard',
    url: 'https://www.renishaw.com/sl/what-raman-spectroscopy-can-tell-you--25800',
  },
  ftir: {
    tab: 'FTIR', name: 'FTIR · ATR', category: 'INFRARED INTERFEROMETRY', icon: 'wave',
    description: 'Scan the Michelson interferometer and transform the interferogram into an infrared spectrum.',
    reference: 'Acquire background',
    url: 'https://www.thermofisher.com/us/en/home/industrial/spectroscopy-elemental-isotope-analysis/molecular-spectroscopy/fourier-transform-infrared-spectroscopy/resources/ftir-spectroscopy-academy.html',
  },
  ellipsometry: {
    tab: 'Ellipsometry', name: 'Spectroscopic Ellipsometer', category: 'SPECTROSCOPIC ELLIPSOMETRY', icon: 'ellipse',
    description: 'Measure polarization changes upon reflection and fit thin-film thickness.',
    reference: 'Acquire substrate',
    url: 'https://www.jawoollam.com/resources/ellipsometry-tutorial/ellipsometry-measurements',
  },
  ta: {
    tab: 'TA', name: 'Pump–Probe Transient Absorption', category: 'TRANSIENT ABSORPTION', icon: 'ta',
    description: 'Scan the pump–probe delay to resolve photoinduced absorption as a function of wavelength and time.',
    reference: 'Acquire pump off',
    url: 'https://www.edinst.com/resource/what-is-transient-absorption-spectroscopy/',
  },
  thz: {
    tab: 'THz–TDS', name: 'Terahertz Time-Domain Spectrometer', category: 'TERAHERTZ TIME DOMAIN', icon: 'thz',
    description: 'Sample the signed electric field with an optical delay line and retrieve the material response.',
    reference: 'Acquire air reference',
    url: 'https://www.itwm.fraunhofer.de/en/departments/processes-materials/materials-characterization-services-products-competences/terahertz-spectroscopy.html',
  },
};

const paths = {
  array: 'M4 18V6m5 12v-7m5 7V4m5 14V8',
  uv: 'M3 12h6m6 0h6M9 5h6v14H9z',
  pl: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2 2m8 8 2 2m0-12-2 2m-8 8-2 2m6-8 2 2-2 2-2-2z',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  raman: 'M3 5v14h18M5 17l4-2 2-8 2 7 3 2 2-5 3 6',
  wave: 'M3 12h3c2 0 2-7 4-7s2 14 4 14 2-7 4-7h3',
  ellipse: 'M19 5c2 2 1 6-3 10s-8 6-11 3c-2-2-1-6 3-10s8-6 11-3ZM4 20 20 4',
  ta: 'M3 18h18M5 14l2-6 2 6m5 0 2-10 2 10',
  thz: 'M2 12h3l2-3 2 7 3-12 3 16 2-8 2 3 2-3h1',
  help: 'M9.5 9a2.6 2.6 0 0 1 5.2 0c0 2-2.7 2.3-2.7 4m0 3h.01m9-4a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  reset: 'M3 12a9 9 0 1 1 2.6 6.4M3 5v7h7',
  bench: 'M3 5h18v14H3zM3 10h18m-12 0v9',
  cursor: 'm4 4 14 7-7 2-2 7-5-16Z',
  sliders: 'M5 4v4m0 4v8m7-16v9m0 4v3m7-16v2m0 4v10M2 8h6m1 9h6m1-11h6',
  moon: 'M20.8 13A8.8 8.8 0 0 1 11 3.2 8.9 8.9 0 1 0 20.8 13Z',
  target: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-5 0a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  play: 'm8 5 11 7-11 7V5Z',
  stop: 'M6 6h12v12H6z',
  chart: 'M3 4v16h18M6 16l4-5 4 2 6-7',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4',
  close: 'm6 6 12 12M18 6 6 18',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  folder: 'M3 5h7l2 3h9v11H3V5Z',
  save: 'M4 4h13l3 3v13H4V4Zm4 0v6h8V4M8 20v-6h8v6',
};

function icon(name) {
  return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + paths[name] + '"/></svg>';
}

const alignmentControl = { key: 'alignment', label: 'Alignment error', type: 'range', value: 0, min: -8, max: 8, step: 0.25, unit: '°' };
const referenceControls = {
  array: ['density', 'rotation', 'slit'],
  uv: ['mode', 'blank', 'pathLength', 'bandwidth', 'wall', 'stray'],
  pl: ['excitation', 'bandwidth', 'filter'],
  trpl: ['excitation', 'detection', 'repetition', 'irf'],
  raman: ['laser', 'focus'],
  ftir: ['mode', 'mirrorTravel'],
  ellipsometry: ['incidenceAngle', 'analyzerAngle'],
  ta: ['offset'],
  thz: ['humidity', 'window'],
};
const states = new Map();
const el = id => document.getElementById(id);
const controlsRoot = el('controls');
const nav = el('instruments');
const progress = el('scan-progress');
const urlOptions = new URLSearchParams(location.search);
const urlStation = urlOptions.get('instrument');
let station = Object.hasOwn(catalog, urlStation) ? urlStation : 'uv';
let workbenchActive = urlStation === 'workbench';
let instrumentViewport;
let instrumentTool = 'move';
let currentNominal;
let inspectorId;
let selectedPart = null;
let probe = null;
let raySelection = null;
let currentResult;
let currentTrace;
let visiblePlots;
let renderPending = 0;
let scanFrame = 0;
let acquisition = null;
let playbackTimer = 0;
let playbackPart = null;
let fileTimer = 0;
let fileBusy = false;
let fftEngine = 'c';
let matlabRelease = '';
let matlabStarting = false;
let matlabPlot;

function makeState(id) {
  const settings = Object.fromEntries([...models[id].controls, alignmentControl].map(item => [item.key, item.value]));
  return {
    settings, layout: emptyEdits(), seed: 631, reference: null, dark: null, mode: 'sample', acquired: false, measured: null, runs: [],
    stopped: false, undo: [], redo: [], gesture: null, memory: null, overlay: true, cursors: new Map(),
    view: 'optics', display: 'graph', plot: null, measurement: null, measuredOverlay: true,
  };
}

function stateOf(id = station) {
  if (!states.has(id)) states.set(id, makeState(id));
  return states.get(id);
}

function findSample(id, presetId) {
  return samplePresets[id]?.find(preset => preset.id === presetId);
}

function setSample(settings, preset) {
  delete settings.samplePreset;
  delete settings.sampleProfile;
  if (preset) {
    settings.samplePreset = preset.id;
    if (preset.profile) settings.sampleProfile = structuredClone(preset.profile);
  }
}

function renderSamplePicker() {
  const picker = el('sample-preset');
  if (picker.dataset.instrument !== station) {
    picker.replaceChildren(new Option('Custom / default response', ''),
      ...(samplePresets[station] ?? []).map(preset => new Option(preset.label, preset.id)));
    picker.dataset.instrument = station;
    el('sample-details').open = false;
  }
  const preset = findSample(station, stateOf().settings.samplePreset);
  picker.value = preset?.id ?? '';
  el('sample-label').textContent = station === 'array' ? 'Optical input' : 'Sample';
  el('sample-details').hidden = !preset;
  if (preset) {
    el('sample-note').textContent = preset.note;
    el('sample-source').textContent = preset.source.title;
    el('sample-source').href = preset.source.url;
  }
}

function htmlElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function traceOptics(id, settings, layout, mode, nominal = createInstrumentScene(id, settings)) {
  const scene = hasEdits(layout) ? editedScene(nominal, layout) : undefined;
  return traceInstrumentOptics(id, settings, scene, mode);
}

function runModel(id, settings, seed, trace, mode, reference, dark) {
  const context = {
    seed,
    coupling: trace.coupling,
    geometry: trace.geometry,
    spectralThroughput: trace.spectralThroughput,
    mode,
    reference,
    dark,
  };
  try {
    return models[id].simulate(settings, context);
  } catch (error) {
    if (fftEngine !== 'matlab') throw error;
    fftEngine = 'c';
    setFftBackend('c');
    updateEngineControls('MATLAB FFT failed. Native C is now active.');
    return models[id].simulate(settings, context);
  }
}

function captureSnapshot(settings, layout, seed, trace, result) {
  return { settings: structuredClone(settings), layout: structuredClone(layout), scene: structuredClone(trace.scene), seed, result,
    traceScene: structuredClone(trace.traceScene),
    coupling: trace.coupling, geometry: trace.geometry, spectralThroughput: trace.spectralThroughput, opticalTransfer: trace.opticalTransfer };
}

function activeReference(state, mode) {
  if (mode !== 'sample' || state.reference || !hasEdits(state.layout) || !['uv', 'ftir', 'thz'].includes(station)) return state.reference;
  const key = JSON.stringify([state.settings, state.dark?.seed, fftEngine]);
  if (state.nominalReference?.key !== key) {
    const layout = emptyEdits();
    const trace = traceOptics(station, state.settings, layout, 'reference', currentNominal);
    const result = runModel(station, state.settings, 631, trace, 'reference', null, state.dark);
    state.nominalReference = { key, record: captureSnapshot(state.settings, layout, 631, trace, result) };
  }
  return state.nominalReference.record;
}

function simulate(state, trace, mode) {
  return runModel(station, state.settings, state.seed, trace, mode, activeReference(state, mode), state.dark);
}

function selectPart(id) {
  selectedPart = currentTrace?.scene.parts.find(part => part.id === id) ?? null;
  inspectorId = undefined;
}

function layoutSnapshot(state) {
  return structuredClone({ layout: state.layout, positions: state.settings.positions });
}

function updateLayoutHistory() {
  const { undo, redo, gesture } = stateOf();
  el('instrument-undo').disabled = !!gesture || !undo.length;
  el('instrument-redo').disabled = !!gesture || !redo.length;
}

function rememberLayout(state, before) {
  if (JSON.stringify(before) === JSON.stringify({ layout: state.layout, positions: state.settings.positions })) return;
  state.undo.push(before);
  if (state.undo.length > 50) state.undo.shift();
  state.redo.length = 0;
}

function finishLayoutGesture() {
  const state = states.get(station);
  if (!state?.gesture) return;
  rememberLayout(state, state.gesture);
  state.gesture = null;
}

function editLayout(operation, phase = 'commit') {
  const state = stateOf();
  const before = state.gesture ?? layoutSnapshot(state);
  if (operation(state) === false) return;
  if (phase === 'preview') state.gesture = before;
  else {
    rememberLayout(state, before);
    state.gesture = null;
  }
  updateLayoutHistory();
  geometryEdited();
}

function stepLayoutHistory(backward) {
  const state = stateOf();
  const from = backward ? state.undo : state.redo;
  const to = backward ? state.redo : state.undo;
  if (state.gesture || !from.length) return false;
  to.push(layoutSnapshot(state));
  const previous = from.pop();
  state.layout = previous.layout;
  if (previous.positions) state.settings.positions = previous.positions;
  else delete state.settings.positions;
  inspectorId = undefined;
  updateLayoutHistory();
  geometryEdited();
  return true;
}

function movePart(id, axis, vector, phase) {
  if (!currentNominal || workbenchActive) return;
  const editable = currentTrace?.scene.parts.find(part => part.id === id);
  const displayed = currentTrace?.parts?.find(part => part.id === id);
  const next = editable && displayed
    ? vector.map((value, index) => value - displayed[axis][index] + editable[axis][index])
    : vector;
  editLayout(state => changePose(state.layout, currentNominal, id, axis, next), phase);
}

function snapshotAlignment() {
  if (workbenchActive) return null;
  flushResult();
  if (!currentNominal || !currentTrace) return null;
  const state = stateOf();
  if (state.mode === 'dark' || acquisition) return null;
  return { station, settings: structuredClone(state.settings), layout: structuredClone(state.layout),
    nominal: currentNominal, trace: currentTrace, mode: state.mode };
}

function alignmentPose(snapshot, { partId, axis, coordinate, offset }) {
  const part = snapshot.trace.scene.parts.find(candidate => candidate.id === partId);
  if (!part) throw new Error('The selected optic is unavailable.');
  const vector = [...part[axis]];
  vector[coordinate] += offset;
  return vector;
}

const pathLabels = {
  signal: 'Signal', excitation: 'Excitation', moving: 'Moving arm', fixed: 'Fixed arm',
  pump: 'Pump', probe: 'Probe', generation: 'Continuum input', gate: 'Gate',
};
const instrumentToolHints = {
  move: 'Drag an optic in the table plane. Alt-drag changes height.',
  rotate: 'Drag to rotate about Z. Shift adjusts Y and Alt adjusts X.',
  ray: 'Click a ray to inspect its path. Drag to orbit.',
};

function selectInstrumentRay(selection, openInspector = false) {
  const ray = currentTrace?.rays[selection.index];
  if (!ray || stateOf().mode === 'dark') return;
  raySelection = selection;
  el('show-rays').checked = true;
  if (openInspector) rayInspector.open();
  refreshBench();
}

function refreshBench() {
  if (!currentTrace || workbenchActive || stateOf().view !== 'optics') return;
  if (!instrumentViewport) instrumentViewport = createViewport3D(el('instrument-3d'), {
    onSelect: id => { selectPart(id); refreshBench(); },
    onMove: (id, vector, phase) => movePart(id, 'position', vector, phase),
    onRotate: (id, vector, phase) => movePart(id, 'rotation', vector, phase),
    onRaySelect: (index, segment) => selectInstrumentRay({ index, segment }, true),
    onViewChange: view => { el('instrument-view').value = view; },
  });
  const parts = currentTrace.scene.parts;
  const displayed = currentTrace.parts ?? parts;
  const selected = parts.find(part => part.id === selectedPart?.id) ?? parts.find(part => ['lens', 'mirror'].includes(part.type)) ?? parts[0];
  const displayPose = displayed.find(part => part.id === selected?.id);
  selectedPart = selected && displayPose ? { ...selected, position: displayPose.position, rotation: displayPose.rotation } : selected ?? null;
  const matches = Number.isFinite(probe?.x) && currentResult?.charts?.some(chart => chart.title === probe.chart && chart.xLabel?.includes('nm'));
  let closest;
  if (matches && !raySelection) {
    let distance = Infinity;
    currentTrace.rays.forEach((ray, index) => {
      const difference = Math.abs(ray.wavelength - probe.x);
      if (ray.detectorId && difference < distance) { closest = index; distance = difference; }
    });
  }
  const dark = stateOf().mode === 'dark';
  instrumentViewport.update({ parts: displayed, rays: currentTrace.rays, selectedId: playbackPart ?? selectedPart?.id,
    tool: instrumentTool, showRays: el('show-rays').checked && !dark, showLabels: el('show-labels').checked,
    highlightRay: raySelection?.index ?? closest ?? null, highlightSegment: raySelection?.segment ?? null });
  rayInspector.update(dark ? null : currentTrace, raySelection);
  alignmentSweep.update({ station, trace: currentTrace, partId: selectedPart?.id, mode: stateOf().mode });
  renderOpticInspector(parts);
  el('part-label').textContent = selectedPart?.name ?? 'Instrument optics';
  el('part-description').textContent = instrumentToolHints[instrumentTool];
  el('bench-coordinate').textContent = selectedPart ? selectedPart.position.map(value => formatNumber(value, 5)).join(' / ') + ' mm' : '';
  const paths = Object.entries(currentTrace.opticalTransfer.paths).filter(([name]) => Object.hasOwn(pathLabels, name));
  const pathItems = paths.map(([name, path]) => {
    const entry = htmlElement('span', '', pathLabels[name]);
    entry.append(htmlElement('b', '', Number.isFinite(path.distance) ? formatNumber(path.distance, 5) + ' mm' : 'No hit'));
    return entry;
  });
  el('instrument-paths').replaceChildren(htmlElement('strong', '', 'Mean optical path'), ...pathItems);
  el('reset-layout').hidden = !hasEdits(stateOf().layout) && !Object.keys(stateOf().settings.positions ?? {}).length;
}

function opticNumber(value, min, max, step, label, onChange) {
  const input = htmlElement('input');
  input.type = 'number'; input.min = min; input.max = max; input.step = step;
  input.value = Number.isFinite(value) ? Number(value.toFixed(4)) : '';
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => {
    if (!Number.isFinite(input.valueAsNumber)) { input.value = input.defaultValue; return; }
    const next = Math.max(min, Math.min(max, input.valueAsNumber));
    input.value = next;
    onChange(next);
  });
  return input;
}

function renderOpticInspector(parts) {
  const select = el('instrument-part');
  const listKey = parts.map(part => part.id + ':' + part.name).join('|');
  if (select.dataset.list !== listKey) {
    select.dataset.list = listKey;
    select.replaceChildren(...parts.map(part => new Option(part.name, part.id)));
  }
  select.value = selectedPart?.id ?? '';
  select.disabled = !parts.length;
  el('instrument-delete').disabled = !selectedPart;
  el('instrument-add').disabled = parts.length >= 36;
  const container = el('instrument-properties');
  const part = selectedPart;
  if (inspectorId !== part?.id || !container.firstChild) {
    inspectorId = part?.id;
    container.replaceChildren();
    if (!part) {
      container.append(htmlElement('p', 'wb-empty', 'Add an optic to begin.'));
      return;
    }
    for (const [axis, title] of [['position', 'Position (mm)'], ['rotation', 'Rotation (°)']]) {
      const group = htmlElement('section', 'wb-prop-group');
      group.append(htmlElement('h3', '', title));
      const controls = htmlElement('div', 'wb-triplet');
      for (const [index, coordinate] of ['X', 'Y', 'Z'].entries()) {
        const label = htmlElement('label', '', coordinate);
        const limit = axis === 'position' ? 2500 : 360;
        const input = opticNumber(part[axis][index], -limit, limit, 1, title + ' ' + coordinate, value => {
          const optic = (currentTrace.parts ?? currentTrace.scene.parts).find(candidate => candidate.id === part.id);
          if (optic) movePart(part.id, axis, optic[axis].map((old, i) => i === index ? value : old));
        });
        input.dataset.field = axis + index;
        label.append(input);
        controls.append(label);
      }
      group.append(controls);
      container.append(group);
    }
    const optics = htmlElement('section', 'wb-prop-group');
    optics.append(htmlElement('h3', '', partNames[part.type]));
    for (const [key, label, min, max, step] of partProperties[part.type]) {
      const field = htmlElement('label', 'wb-prop-row');
      const input = opticNumber(part[key], min, max, step, label, value => {
        if (key === 'focalLength' && Math.abs(value) < 1) value = value < 0 ? -1 : 1;
        if (value !== currentTrace.scene.parts.find(optic => optic.id === part.id)?.[key]) {
          editLayout(state => changeProperty(state.layout, part.id, key, value));
        }
      });
      input.dataset.field = key;
      field.append(htmlElement('span', '', label), input);
      optics.append(field);
    }
    const enabled = htmlElement('input');
    enabled.type = 'checkbox';
    enabled.dataset.field = 'enabled';
    enabled.addEventListener('change', () => editLayout(state => changeProperty(state.layout, part.id, 'enabled', enabled.checked)));
    const label = htmlElement('label', 'wb-prop-row');
    label.append(htmlElement('span', '', 'Enabled'), enabled);
    optics.append(label);
    container.append(optics);
  }
  if (!part) return;
  for (const input of container.querySelectorAll('[data-field]')) {
    const field = input.dataset.field;
    if (field === 'enabled') { input.checked = part.enabled !== false; continue; }
    const axis = /^(position|rotation)([0-2])$/.exec(field);
    const value = axis ? part[axis[1]][Number(axis[2])] : part[field];
    input.defaultValue = Number.isFinite(value) ? Number(value.toFixed(4)) : '';
    if (document.activeElement !== input) input.value = input.defaultValue;
  }
}

function referenceLabel() {
  return station === 'uv' && stateOf().settings.mode === 'sphere' ? 'Acquire white standard' : catalog[station].reference;
}

function referenceChanged(state) {
  if (JSON.stringify(state.layout) !== JSON.stringify(state.reference.layout ?? emptyEdits())) return true;
  const baseline = state.reference.settings;
  const keys = ['alignment', ...referenceControls[station]];
  if (keys.some(key => state.settings[key] !== baseline[key])) return true;
  const current = state.settings.positions ?? {};
  const stored = baseline.positions ?? {};
  return [...new Set([...Object.keys(current), ...Object.keys(stored)])].some(id =>
    current[id]?.x !== stored[id]?.x || current[id]?.y !== stored[id]?.y);
}

function refreshStatus() {
  const state = stateOf();
  const status = el('acquisition-status');
  const bits = [];
  if (state.dark) bits.push('Dark stored');
  if (state.reference) bits.push(referenceChanged(state) ? 'Reference stored · optics changed' : 'Reference stored');
  if (acquisition) {
    bits.push({ sample: 'Acquiring sample', reference: 'Recording reference', dark: 'Recording dark' }[acquisition.mode]);
  } else if (state.stopped) {
    bits.push('Acquisition stopped');
  } else if (state.acquired) {
    bits.push('Acquisition complete');
  } else if (state.mode === 'sample') {
    bits.push('Live preview');
  }
  status.textContent = bits.join(' · ');
  status.dataset.ready = String(Boolean(state.acquired || state.reference));
  status.dataset.phase = acquisition ? 'acquiring' : state.stopped ? 'stopped' : state.acquired || state.reference ? 'ready' : 'preview';
  el('reference-label').textContent = referenceLabel();
  el('measure-label').textContent = acquisition?.mode === 'sample' ? 'Acquiring…' : 'Acquire sample';
  for (const id of ['reference', 'measure', 'dark']) el(id).disabled = Boolean(acquisition);
  el('stop-scan').disabled = !acquisition;
  updateTraceMemoryControls(state);
}

function updateEngineControls(message) {
  const supportsFft = station === 'ftir' || station === 'thz';
  el('analysis-engine').hidden = !supportsFft || window.__SPECTRAL_DESKTOP__ !== true;
  el('fft-engine').value = matlabStarting ? 'matlab' : fftEngine;
  el('fft-engine').disabled = matlabStarting;
  el('matlab-run').hidden = fftEngine !== 'matlab';
  const status = el('engine-status');
  status.textContent = message ?? (matlabStarting ? 'Starting MATLAB…' : fftEngine === 'matlab' ? 'MATLAB ' + matlabRelease + ' connected' : '');
  status.hidden = !status.textContent;
}

async function engineRequest(path, body) {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'MATLAB operation failed.');
  return result;
}

async function changeEngine() {
  const next = el('fft-engine').value;
  cancelScan();
  refreshStatus();
  if (next === 'matlab' && !matlabRelease) {
    matlabStarting = true;
    updateEngineControls();
    try {
      const result = await engineRequest('/api/matlab/connect', {});
      matlabRelease = result.release;
    } catch (error) {
      matlabStarting = false;
      updateEngineControls(error.message);
      return;
    }
    matlabStarting = false;
  }
  fftEngine = next;
  setFftBackend(next);
  for (const id of ['ftir', 'thz']) {
    const state = states.get(id);
    if (state) state.measured = null;
  }
  updateEngineControls();
  refreshResult();
}

async function runMatlabModel() {
  const button = el('matlab-run');
  if (button.disabled) return;
  button.disabled = true;
  const instrument = station;
  try {
    const chart = await engineRequest('/api/matlab/simulate', { instrument, settings: stateOf().settings });
    if (station !== instrument) return;
    el('matlab-title').textContent = chart.title;
    el('matlab-summary').textContent = chart.summary;
    el('matlab-dialog').showModal();
    matlabPlot?.disconnect();
    matlabPlot = renderCharts(el('matlab-plots'), [chart], () => {});
  } catch (error) {
    updateEngineControls(error.message);
  } finally {
    button.disabled = false;
  }
}

function renderMetrics(metrics) {
  const container = el('metrics');
  container.replaceChildren();
  for (const metric of metrics) {
    const item = htmlElement('div', 'metric');
    const value = typeof metric.value === 'number' ? formatNumber(metric.value, 5) : String(metric.value ?? '—');
    item.append(htmlElement('span', '', metric.label), htmlElement('strong', '', value));
    if (metric.unit && value !== '—') item.append(htmlElement('span', 'metric-unit', metric.unit));
    container.append(item);
  }
}

function renderTransfer(result) {
  const container = el('transfer');
  container.hidden = true;
  container.replaceChildren();
  if (stateOf().mode !== 'sample' || !Number.isFinite(result.peak)) return;
  const target = station === 'uv' && stateOf().settings.mode !== 'sphere' ? 'pl' : station === 'pl' ? 'trpl' : null;
  if (!target) return;
  const key = target === 'pl' ? 'excitation' : 'detection';
  const destination = target === 'pl' ? 'PL excitation' : 'TRPL detection';
  const setting = models[target].controls.find(control => control.key === key);
  if (result.peak < setting.min || result.peak > setting.max) return;
  const wavelength = Math.round(result.peak);
  const button = htmlElement('button', 'button subtle-button', 'Use ' + wavelength + ' nm for ' + destination);
  button.type = 'button';
  button.addEventListener('click', () => {
    const next = stateOf(target);
    next.settings[key] = wavelength;
    if (target === 'pl') next.settings.concentration = stateOf().settings.concentration;
    if (target === 'trpl') next.settings.excitation = stateOf().settings.excitation;
    next.mode = 'sample';
    next.acquired = false;
    next.measured = null;
    openStation(target);
  });
  container.append(button);
  container.hidden = false;
}

function renderRunLog(state) {
  const list = el('run-entries');
  list.replaceChildren();
  el('run-log').hidden = !state.runs.length;
  const names = { dark: 'Dark scan', reference: 'Reference scan', sample: 'Sample scan' };
  for (const run of state.runs) {
    const stamp = new Date(run.timestamp).toLocaleString('en-US');
    list.append(htmlElement('li', '', stamp + ' · ' + names[run.mode]));
  }
}

function updateTraceMemoryControls(state, matched) {
  const memory = state.memory;
  const charts = currentResult?.charts ?? [];
  const eligible = state.mode === 'sample' && charts.some(chart => !chart.heatmap && chart.series?.length);
  el('trace-store').disabled = Boolean(acquisition) || !eligible;
  el('trace-store').textContent = memory ? 'Replace trace' : 'Store trace';
  el('trace-clear').disabled = !memory;
  el('trace-overlay').disabled = !memory;
  el('trace-overlay').checked = state.overlay;
  const output = el('trace-memory-status');
  if (!memory || matched !== undefined) {
    const count = memory?.charts.length;
    const status = memory
      ? (memory.acquired ? 'Acquisition' : 'Preview') + ' · ' + new Date(memory.timestamp).toLocaleTimeString('en-US', { hour12: false }) +
        ' · ' + count + (count === 1 ? ' graph' : ' graphs') + (state.overlay && !matched ? ' · No matching graphs' : '')
      : 'No trace stored';
    if (output.textContent !== status) output.textContent = status;
  }
}

const primaryPlots = { array: 1, uv: 1, pl: 1, raman: 1, ftir: 1, ta: 2 };

function renderDetectorPlots() {
  const state = stateOf();
  const liveCharts = currentResult?.charts ?? [];
  const stored = state.memory && state.overlay ? overlayLineCharts(liveCharts, state.memory.charts) : { charts: liveCharts, count: 0 };
  const comparison = measuredComparison(liveCharts, state.measurement);
  const chartsWithOverlays = comparison && state.measuredOverlay
    ? addMeasuredOverlay(stored.charts, state.measurement, comparison.chartIndex) : stored.charts;
  const { display } = state;
  const allowed = chartsWithOverlays.flatMap((chart, index) => display === 'fit' && (chart.heatmap || !chart.series?.length) ? [] : [index]);
  const preferred = state.mode === 'sample' ? station === 'ta' && display === 'fit' ? 1 : primaryPlots[station] ?? 0 : 0;
  const fallback = allowed.includes(preferred) ? preferred : allowed[0];
  const selection = state.plot === '*' && display === 'graph' ? '*' : allowed.includes(state.plot) ? state.plot : fallback;
  const plotSelect = el('plot-selection');
  const menu = [
    ...(display === 'graph' ? [['*', 'All graphs']] : []),
    ...allowed.map(index => [String(index), chartsWithOverlays[index].title]),
  ];
  const listKey = JSON.stringify(menu);
  if (plotSelect.dataset.list !== listKey) {
    plotSelect.replaceChildren(...menu.map(([value, name]) => new Option(name, value)));
    plotSelect.dataset.list = listKey;
  }
  plotSelect.value = selection === undefined ? '' : String(selection);
  plotSelect.disabled = !allowed.length;
  for (const button of document.querySelectorAll('[data-plot-display]')) {
    button.setAttribute('aria-pressed', String(button.dataset.plotDisplay === display));
  }
  visiblePlots?.disconnect();
  visiblePlots = null;
  const graph = display === 'graph' || display === 'fit';
  el('plots').hidden = !graph;
  el('plot-table').hidden = display !== 'table';
  el('fit-panel').hidden = display !== 'fit';
  el('map-panel').hidden = display !== 'map';
  const context = { id: station, state, chart: chartsWithOverlays[selection], baseChart: liveCharts[selection],
    chartIndex: selection, result: currentResult, controls: [...models[station].controls, alignmentControl] };
  if (display === 'table') renderPlotTable(el('plot-table'), chartsWithOverlays, selection);
  else if (display === 'map') plotAnalysis.renderMap(context);
  else if (graph) {
    const charts = display === 'fit' ? plotAnalysis.renderFit(context)
      : selection === '*' ? chartsWithOverlays : selection !== undefined ? [chartsWithOverlays[selection]] : [];
    visiblePlots = renderCharts(el('plots'), charts, selected => {
      probe = selected;
      refreshBench();
      if (state.display === 'fit') plotAnalysis.syncFitCursors();
    }, { cursors: state.cursors });
  }
  updateTraceMemoryControls(state, stored.count);
  measurementImport.update(state.measurement, state.measuredOverlay, comparison);
}

function storeTrace() {
  const state = stateOf();
  if (acquisition || state.mode !== 'sample') return;
  flushResult();
  const charts = snapshotLineCharts(currentResult?.charts);
  if (!charts.length) return;
  state.memory = {
    charts, timestamp: Date.now(), acquired: state.acquired, seed: state.seed,
    settings: structuredClone(state.settings), layout: structuredClone(state.layout),
  };
  state.overlay = true;
  renderDetectorPlots();
}

function refreshResult() {
  const state = stateOf();
  raySelection = null;
  currentNominal = createInstrumentScene(station, state.settings);
  currentTrace = traceOptics(station, state.settings, state.layout, state.mode, currentNominal);
  currentResult = state.measured ?? simulate(state, currentTrace, state.mode);
  refreshBench();
  const metrics = currentResult.metrics ?? [];
  renderMetrics(state.mode === 'dark' ? metrics : [{ label: 'Optical transfer', value: 100 * currentTrace.coupling, unit: '%' }, ...metrics]);
  renderDetectorPlots();
  el('model-note').textContent = currentResult.note ?? '';
  el('model-note').hidden = !currentResult.note;
  el('export').disabled = !currentResult.charts?.length;
  el('photon-play').hidden = station !== 'trpl' || state.mode !== 'sample';
  renderRunLog(state);
  renderTransfer(currentResult);
  refreshStatus();
}

function cancelScan() {
  cancelAnimationFrame(scanFrame);
  scanFrame = 0;
  acquisition = null;
  progress.hidden = true;
  progress.value = 0;
}

function stopPlayback() {
  clearTimeout(playbackTimer);
  playbackTimer = 0;
  playbackPart = null;
  el('photon-state').hidden = true;
  el('photon-play').setAttribute('aria-pressed', 'false');
  el('photon-label').textContent = 'Replay photons';
}

function replayPhotons() {
  if (playbackTimer) {
    stopPlayback();
    refreshBench();
    return;
  }
  if (acquisition || station !== 'trpl') return;
  const histogram = currentResult.charts[0].series[0];
  let total = 0;
  const cumulative = Array.from(histogram.y, count => (total += count));
  if (!total) return;
  const display = el('photon-state');
  const eventCount = 10;
  display.hidden = false;
  el('photon-play').setAttribute('aria-pressed', 'true');
  el('photon-label').textContent = 'Stop replay';
  let index = 0;

  function pulse() {
    playbackPart = 'source';
    display.textContent = (index + 1) + '/' + eventCount + ' · Laser pulse';
    refreshBench();
    playbackTimer = setTimeout(() => {
      const quantile = ((index * 7) % eventCount + 0.5) / eventCount;
      const bin = cumulative.findIndex(count => count >= total * quantile);
      const time = histogram.x[bin];
      visiblePlots.showPoint(0, time);
      playbackPart = 'detector';
      display.textContent = (index + 1) + '/' + eventCount + ' · Photon detected at ' + formatNumber(time, 4) + ' ns';
      refreshBench();
      index += 1;
      playbackTimer = setTimeout(index < eventCount ? pulse : () => {
        stopPlayback();
        refreshBench();
      }, 420);
    }, 170);
  }

  pulse();
}

function editControl(key, value, rerenderControls) {
  const settings = stateOf().settings;
  const preset = findSample(station, settings.samplePreset);
  if (preset && (['source', 'sample', 'material'].includes(key) || (station === 'uv' && key === 'mode')) &&
      Object.hasOwn(preset.settings, key) && preset.settings[key] !== value) {
    setSample(settings, null);
    renderSamplePicker();
  }
  settings[key] = value;
  if (rerenderControls) updateConditionalControls();
  geometryEdited();
}

function geometryEdited() {
  stopPlayback();
  cancelScan();
  plotAnalysis.stopMap();
  alignmentSweep.cancel();
  const state = stateOf();
  state.mode = 'sample';
  state.acquired = false;
  state.measured = null;
  state.stopped = false;
  probe = null;
  if (!renderPending) {
    renderPending = requestAnimationFrame(() => {
      renderPending = 0;
      refreshResult();
    });
  }
}

function flushResult() {
  if (!renderPending) return;
  cancelAnimationFrame(renderPending);
  renderPending = 0;
  refreshResult();
}

function updateConditionalControls() {
  const settings = stateOf().settings;
  for (const field of controlsRoot.querySelectorAll('[data-depends]')) {
    const control = models[station].controls.find(item => item.key === field.dataset.key);
    field.hidden = settings[control.when.key] !== control.when.value;
  }
}

function addControl(control, settings) {
  const { key, label, unit, type } = control;
  const field = htmlElement('div', 'parameter');
  field.dataset.key = key;
  if (control.when) field.dataset.depends = control.when.key;
  const id = 'parameter-' + key;
  const title = htmlElement('label', 'parameter-title', label);
  title.htmlFor = id;
  const controlValue = settings[key];

  if (type === 'range') {
    const input = htmlElement('input');
    input.id = id;
    input.type = 'range';
    input.min = control.min;
    input.max = control.max;
    input.step = control.step;
    input.value = controlValue;
    const number = htmlElement('input', 'parameter-number');
    number.type = 'number';
    number.id = id + '-value';
    number.min = input.min;
    number.max = input.max;
    number.step = input.step;
    number.value = input.value;
    number.setAttribute('aria-label', label + (unit ? ' (' + unit + ')' : ''));
    number.addEventListener('change', () => {
      if (Number.isFinite(number.valueAsNumber)) input.valueAsNumber = number.valueAsNumber;
      number.value = input.value;
      if (settings[key] !== input.valueAsNumber) editControl(key, input.valueAsNumber, false);
    });
    input.addEventListener('input', () => {
      number.value = input.value;
      editControl(key, input.valueAsNumber, false);
    });
    const header = htmlElement('div', 'parameter-header');
    const value = htmlElement('div', 'parameter-value');
    value.append(number);
    if (unit) value.append(htmlElement('span', 'parameter-unit', unit));
    header.append(title, value);
    field.append(header, input);
  } else if (type === 'select') {
    const select = htmlElement('select');
    select.id = id;
    control.options.forEach((item, index) => {
      const option = htmlElement('option', '', item.label);
      option.value = index;
      option.selected = item.value === controlValue;
      select.append(option);
    });
    select.addEventListener('change', () => editControl(key, control.options[select.selectedIndex].value, true));
    field.append(title, select);
  } else if (type === 'toggle') {
    const input = htmlElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.setAttribute('role', 'switch');
    input.checked = controlValue;
    input.addEventListener('change', () => editControl(key, input.checked, true));
    title.className = 'switch-control';
    title.replaceChildren(input, htmlElement('span', 'switch-track'), document.createTextNode(label));
    field.append(title);
  }
  controlsRoot.append(field);
}

function renderControls() {
  controlsRoot.replaceChildren();
  const settings = stateOf().settings;
  for (const control of [...models[station].controls, alignmentControl]) addControl(control, settings);
  updateConditionalControls();
  renderSamplePicker();
}

function updateLocation() {
  const url = new URL(location.href);
  url.searchParams.set('instrument', workbenchActive ? 'workbench' : station);
  if (!workbenchActive && stateOf().view === 'acquire') url.searchParams.set('view', 'acquire');
  else url.searchParams.delete('view');
  history.replaceState(null, '', url);
}

function displayInstrumentView() {
  const view = stateOf().view;
  el('instrument-workspace').dataset.view = view;
  el('instrument-bench').hidden = view !== 'optics';
  for (const button of document.querySelectorAll('[data-instrument-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.instrumentView === view));
  }
}

function openStation(id, updateUrl = true) {
  finishLayoutGesture();
  stopPlayback();
  plotAnalysis.stopMap();
  alignmentSweep.update(null);
  cancelAnimationFrame(renderPending);
  renderPending = 0;
  cancelScan();
  workbenchActive = false;
  workbench.hide();
  el('workbench').hidden = true;
  el('instrument-workspace').hidden = false;
  el('workbench').closest('.workspace').classList.remove('is-workbench');
  el('help').lastChild.textContent = 'Protocol';
  station = id;
  selectedPart = null;
  inspectorId = undefined;
  probe = null;
  const item = catalog[station];
  el('instrument-name').textContent = item.name;
  el('source-link').href = item.url;
  el('part-label').textContent = 'Instrument optics';
  el('bench-coordinate').textContent = '';
  el('dark').hidden = !item.dark;
  for (const button of nav.children) button.setAttribute('aria-current', String(button.dataset.station === station));
  displayInstrumentView();
  if (updateUrl) updateLocation();
  renderControls();
  updateLayoutHistory();
  updateEngineControls();
  refreshResult();
  instrumentViewport?.resetView();
}

function openWorkbench(updateUrl = true) {
  finishLayoutGesture();
  stopPlayback();
  plotAnalysis.stopMap();
  alignmentSweep.update(null);
  cancelAnimationFrame(renderPending);
  renderPending = 0;
  cancelScan();
  workbenchActive = true;
  el('workbench').hidden = false;
  el('instrument-workspace').hidden = true;
  el('workbench').closest('.workspace').classList.add('is-workbench');
  el('help').lastChild.textContent = 'Bench help';
  for (const button of nav.children) button.setAttribute('aria-current', String(button.dataset.station === 'workbench'));
  if (updateUrl) updateLocation();
  workbench.show();
}

function capture(mode) {
  if (acquisition) return;
  flushResult();
  alignmentSweep.cancel();
  plotAnalysis.stopMap();
  stopPlayback();
  const state = stateOf();
  state.stopped = false;
  const duration = station === 'thz' || station === 'trpl' ? 850 : 590;
  const start = performance.now();
  acquisition = { mode };
  progress.hidden = false;
  refreshStatus();

  function update(now) {
    const fraction = Math.min(1, (now - start) / duration);
    progress.value = fraction;
    if (fraction < 1) {
      scanFrame = requestAnimationFrame(update);
      return;
    }
    const trace = traceOptics(station, state.settings, state.layout, mode, currentNominal);
    state.seed += 1;
    const result = simulate(state, trace, mode);
    if (mode !== 'sample') state[mode] = captureSnapshot(state.settings, state.layout, state.seed, trace, result);
    state.mode = mode;
    state.measured = result;
    state.acquired = mode === 'sample';
    state.runs = [{ mode, timestamp: Date.now() }, ...state.runs].slice(0, 20);
    probe = null;
    cancelScan();
    refreshResult();
  }

  scanFrame = requestAnimationFrame(update);
}

function csvCell(value) {
  if (value === undefined || value === null || (typeof value === 'number' && !Number.isFinite(value))) return '';
  return '"' + String(value).replaceAll('"', '""') + '"';
}

function fileFeedback(message) {
  clearTimeout(fileTimer);
  const status = el('file-status');
  status.textContent = message;
  status.hidden = false;
  fileTimer = setTimeout(() => { status.hidden = true; }, 4200);
}

function captureRecord(record) {
  return record ? { settings: record.settings, layout: record.layout, seed: record.seed } : null;
}

function sessionJson() {
  const instruments = Object.fromEntries([...states].map(([id, state]) => [id, {
    settings: state.settings, layout: state.layout, seed: state.seed, mode: state.mode, acquired: state.acquired, runs: state.runs,
    reference: captureRecord(state.reference), dark: captureRecord(state.dark),
    memory: state.memory, overlay: state.overlay, view: state.view, display: state.display, plot: state.plot,
    measurement: state.measurement, measuredOverlay: state.measuredOverlay,
  }]));
  return JSON.stringify({ format: 'spectral-bench', version: 1,
    instrument: workbenchActive ? 'workbench' : station, instruments, workbench: workbench.serialize() });
}

function validateSettings(id, saved) {
  const settings = Object.fromEntries([...models[id].controls, alignmentControl].map(control => {
    const candidate = saved?.[control.key];
    let value = control.value;
    if (control.type === 'range' && Number.isFinite(candidate)) value = Math.min(control.max, Math.max(control.min, candidate));
    if (control.type === 'toggle' && typeof candidate === 'boolean') value = candidate;
    if (control.type === 'select' && control.options.some(option => option.value === candidate)) value = candidate;
    return [control.key, value];
  }));
  const positions = traceBench(id, settings).parts.flatMap(({ id: partId }) => {
    const position = saved?.positions?.[partId];
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return [];
    return [[partId, { x: Math.max(15, Math.min(845, position.x)), y: Math.max(15, Math.min(325, position.y)) }]];
  });
  if (positions.length) settings.positions = Object.fromEntries(positions);
  setSample(settings, findSample(id, saved?.samplePreset));
  return settings;
}

function validSeed(value) {
  return Number.isSafeInteger(value) && value >= 0 && value < 1e9 ? value : 631;
}

function restoreSession(content) {
  const data = JSON.parse(content);
  if (data?.format !== 'spectral-bench' || data.version !== 1 || !data.instruments ||
    (data.instrument !== 'workbench' && !Object.hasOwn(catalog, data.instrument))) {
    throw new Error('This is not a supported Spectral Bench session.');
  }
  const restored = new Map();
  for (const id of Object.keys(catalog)) {
    const saved = data.instruments[id];
    if (!saved || typeof saved !== 'object') continue;
    const state = makeState(id);
    state.settings = validateSettings(id, saved.settings);
    state.layout = restoreEdits(saved.layout);
    state.seed = validSeed(saved.seed);
    for (const mode of ['dark', 'reference']) {
      if (!saved[mode]?.settings) continue;
      const settings = validateSettings(id, saved[mode].settings);
      const layout = restoreEdits(saved[mode].layout);
      const seed = validSeed(saved[mode].seed);
      const trace = traceOptics(id, settings, layout, mode);
      const result = runModel(id, settings, seed, trace, mode, null, state.dark);
      state[mode] = captureSnapshot(settings, layout, seed, trace, result);
    }
    state.mode = saved.mode === 'reference' && state.reference ? 'reference' : saved.mode === 'dark' && state.dark ? 'dark' : 'sample';
    state.measured = state.mode !== 'sample' ? state[state.mode].result : null;
    state.acquired = state.mode === 'sample' && saved.acquired === true;
    const memory = saved.memory;
    if (Number.isFinite(memory?.timestamp) && Math.abs(memory.timestamp) <= 8.64e15) {
      const charts = snapshotLineCharts(memory.charts);
      if (charts.length) state.memory = {
        charts, timestamp: memory.timestamp, acquired: memory.acquired === true, seed: validSeed(memory.seed),
        settings: validateSettings(id, memory.settings), layout: restoreEdits(memory.layout),
      };
    }
    state.overlay = saved.overlay !== false;
    state.measurement = restoreMeasuredTrace(saved.measurement);
    state.measuredOverlay = saved.measuredOverlay !== false;
    state.view = saved.view === 'acquire' ? 'acquire' : 'optics';
    state.display = ['table', 'fit', 'map'].includes(saved.display) ? saved.display : 'graph';
    state.plot = saved.plot === '*' || (Number.isInteger(saved.plot) && saved.plot >= 0 && saved.plot <= 20) ? saved.plot : null;
    state.runs = Array.isArray(saved.runs) ? saved.runs.filter(run =>
      Number.isFinite(run?.timestamp) && ['dark', 'reference', 'sample'].includes(run.mode)).slice(0, 20) : [];
    restored.set(id, state);
  }
  workbench.restore(data.workbench);
  states.clear();
  for (const [id, state] of restored) states.set(id, state);
  if (data.instrument === 'workbench') openWorkbench();
  else openStation(data.instrument);
}

async function desktopFile(action, success) {
  if (fileBusy) return;
  fileBusy = true;
  try {
    const reply = await action(window.pywebview.api);
    if (reply.error) throw new Error(reply.error);
    if (!reply.cancelled) success(reply);
  } catch (error) {
    fileFeedback(error.message || 'Could not open or save the file.');
  } finally {
    fileBusy = false;
  }
}

function exportCsv() {
  flushResult();
  const state = stateOf();
  const rows = [['record', 'instrument', 'acquisition', 'chart', 'series', 'x_axis', 'x', 'y_axis', 'y', 'z', 'setting', 'value']];
  const appendSettings = (kind, settings, mode = state.mode) => {
    for (const [key, value] of Object.entries(settings ?? {})) {
      rows.push([kind, station, mode, '', '', '', '', '', '', '', key,
        typeof value === 'object' ? JSON.stringify(value) : value]);
    }
  };
  appendSettings('setting', state.settings);
  appendSettings('layout', { scene: currentTrace.scene });
  appendSettings('reference_setting', state.reference?.settings);
  appendSettings('dark_setting', state.dark?.settings);
  appendSettings('run', { seed: state.seed, acquired: state.acquired, fft_engine: fftEngine });
  for (const chart of currentResult.charts) {
    const { heatmap } = chart;
    if (heatmap) {
      for (let row = 0; row < heatmap.y.length; row += 1) {
        for (let column = 0; column < heatmap.x.length; column += 1) {
          rows.push(['map', station, state.mode, chart.title, '', chart.xLabel, heatmap.x[column],
            chart.yLabel, heatmap.y[row], heatmap.z[row][column]]);
        }
      }
    }
    for (const series of chart.series ?? []) {
      for (let index = 0; index < series.x.length; index += 1) {
        rows.push(['signal', station, state.mode, chart.title, series.name, chart.xLabel, series.x[index],
          chart.yLabel, series.y[index]]);
      }
    }
  }
  const memory = state.memory;
  if (memory) {
    appendSettings('memory_setting', memory.settings, 'sample');
    appendSettings('memory_run', { timestamp: new Date(memory.timestamp).toISOString(), acquired: memory.acquired, seed: memory.seed, layout: memory.layout }, 'sample');
    for (const chart of memory.charts) for (const series of chart.series) {
      for (let index = 0; index < series.x.length; index += 1) {
        rows.push(['memory_signal', station, 'sample', chart.title, series.name, chart.xLabel, series.x[index], chart.yLabel, series.y[index]]);
      }
    }
  }
  const measured = state.measurement;
  if (measured) {
    const comparison = measuredComparison(currentResult.charts, measured);
    const statistics = comparison?.statistics;
    appendSettings('measured_setting', { filename: measured.filename, target_series: measured.target.seriesName,
      compared_samples: statistics?.count, rmse: statistics?.rmse, bias_measured_minus_simulated: statistics?.bias });
    for (let index = 0; index < measured.x.length; index++) {
      rows.push(['measured_signal', station, state.mode, measured.target.title, measured.filename,
        measured.target.xLabel, measured.x[index], measured.target.yLabel, measured.y[index]]);
    }
  }
  const fit = plotAnalysis.currentFit(currentResult, state);
  if (fit) {
    const { result } = fit;
    appendSettings('fit', { model: result.model, source: fit.name, rmse: result.rmse, r2: result.r2,
      count: result.count, converged: result.converged, ...Object.fromEntries(result.parameters.map(param => [param.name, param.value])) });
    for (const [kind, series] of [['fit_signal', result.curve], ['fit_residual', result.residual]]) {
      for (let index = 0; index < series.x.length; index += 1) {
        rows.push([kind, station, state.mode, fit.title, fit.name, fit.xLabel, series.x[index], fit.yLabel, series.y[index]]);
      }
    }
  }
  const csv = '\uFEFF' + rows.map(row => Array.from({ length: 12 }, (_, index) => csvCell(row[index])).join(',')).join('\r\n');
  const filename = 'spectral-bench-' + station + '-' + (state.acquired ? 'measurement' : state.mode) + '.csv';
  exportUserFile(filename, csv);
}

function exportUserFile(filename, content) {
  const isMatlab = filename.endsWith('.m');
  if (window.pywebview?.api) {
    desktopFile(api => isMatlab ? api.save_matlab(filename, content) : api.save_csv(filename, content),
      reply => fileFeedback('Saved ' + reply.name));
    return;
  }
  const href = URL.createObjectURL(new Blob([content], { type: isMatlab ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8' }));
  const link = htmlElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

let currentCode;
function showCode({ title, description, filename, code }) {
  currentCode = { filename, code };
  el('wb-code-title').textContent = title;
  el('wb-code-description').textContent = description;
  el('wb-code').value = code;
  el('wb-code-dialog').showModal();
}

function matlabReference(record) {
  if (!record) return null;
  return { settings: record.settings, scene: record.traceScene ?? record.scene, seed: record.seed, opticalTransfer: record.opticalTransfer };
}

async function exportInstrumentMatlab() {
  if (!currentTrace || workbenchActive) return;
  const button = el('instrument-matlab');
  const id = station;
  button.disabled = true;
  try {
    const { generateMatlabMeasurement } = await import('./matlab-measurement.js');
    if (id !== station || workbenchActive) return;
    flushResult();
    const state = stateOf();
    const code = generateMatlabMeasurement(id, currentTrace.traceScene ?? currentTrace.scene, {
      settings: state.settings, seed: state.seed, mode: state.mode, opticalTransfer: currentTrace.opticalTransfer,
      reference: matlabReference(activeReference(state, state.mode)), dark: matlabReference(state.dark),
    });
    showCode({ title: catalog[id].name + ' · MATLAB',
      description: 'Run this script in MATLAB to retrace the current optics and calculate the instrument measurement.',
      filename: 'spectral_bench_' + id + '_measurement.m', code });
  } catch (error) { fileFeedback(error.message || 'MATLAB export failed.'); }
  finally { button.disabled = false; }
}

const rayInspector = createRayInspector({
  onSelect: selectInstrumentRay,
  onClear: () => { raySelection = null; refreshBench(); },
});

const alignmentSweep = createAlignmentSweep({
  snapshot: snapshotAlignment,
  trace(snapshot, pose) {
    const layout = structuredClone(snapshot.layout);
    const vector = alignmentPose(snapshot, pose);
    changePose(layout, snapshot.nominal, pose.partId, pose.axis, vector);
    return traceOptics(snapshot.station, snapshot.settings, layout, snapshot.mode, snapshot.nominal);
  },
  apply(snapshot, pose) {
    if (workbenchActive || station !== snapshot.station || currentTrace !== snapshot.trace || renderPending || acquisition) return false;
    const vector = alignmentPose(snapshot, pose);
    selectPart(pose.partId);
    editLayout(state => changePose(state.layout, snapshot.nominal, pose.partId, pose.axis, vector));
    return true;
  },
  exportFile: exportUserFile,
});

const measurementImport = createMeasurementImport({
  context() {
    if (workbenchActive) return null;
    flushResult();
    return { station, state: stateOf(), charts: currentResult?.charts ?? [], plotIndex: Number(el('plot-selection').value) };
  },
  openNative(receive) {
    if (!window.pywebview?.api?.open_measurement) return false;
    desktopFile(api => api.open_measurement(), receive);
    return true;
  },
  apply(measurement, plotIndex) {
    const state = stateOf();
    state.measurement = measurement;
    state.measuredOverlay = true;
    state.display = 'graph';
    state.plot = plotIndex;
    plotAnalysis.stopMap();
    renderDetectorPlots();
  },
  toggle(show) { stateOf().measuredOverlay = show; renderDetectorPlots(); },
  clear() { stateOf().measurement = null; renderDetectorPlots(); },
  notify: fileFeedback,
});

const plotAnalysis = createPlotAnalysis({
  repaint: renderDetectorPlots, exportFile: exportUserFile,
  reference: state => activeReference(state, 'sample'),
  calculate: (id, settings, layout, seed, reference, dark) => {
    const trace = traceOptics(id, settings, layout, 'sample');
    return runModel(id, settings, seed, trace, 'sample', reference, dark);
  },
});
const workbench = createWorkbench({ exportFile: exportUserFile, notify: fileFeedback, showCode });
for (const node of document.querySelectorAll('[data-icon]')) node.innerHTML = icon(node.dataset.icon);
const workbenchTab = htmlElement('button', 'instrument-tab');
workbenchTab.type = 'button';
workbenchTab.dataset.station = 'workbench';
workbenchTab.innerHTML = icon('bench');
workbenchTab.append(document.createTextNode('Workbench'));
workbenchTab.addEventListener('click', () => openWorkbench());
nav.append(workbenchTab);
for (const [id, item] of Object.entries(catalog)) {
  const button = htmlElement('button', 'instrument-tab');
  button.type = 'button';
  button.dataset.station = id;
  button.innerHTML = icon(item.icon);
  button.append(document.createTextNode(item.tab));
  button.addEventListener('click', () => openStation(id));
  nav.append(button);
}
el('help').addEventListener('click', () => {
  const protocol = workbenchActive ? {
    steps: [
      'Choose a layout or add optics in Components. Select an optic to edit its position, angles and optical properties in Inspector.',
      'Drag an optic in Move mode. Hold Alt to change height. In Rotate mode, drag about Z, hold Shift for Y or Alt for X.',
      'Set a light-source spectrum and rays per wavelength. The sensor plane and detected spectrum update after each edit.',
      'Open Distances to inspect a ray or sweep the detector along its normal. MATLAB code saves the current layout and sweep as a runnable script.',
    ],
    observation: 'Positions and path lengths are in millimeters. Drag the background to orbit, use the right or middle button to pan, and scroll to zoom.',
  } : protocols[station];
  el('help-title').textContent = workbenchActive ? 'Optical Workbench controls' : catalog[station].name + ' protocol';
  el('protocol-description').hidden = workbenchActive;
  el('protocol-description').textContent = workbenchActive ? '' : catalog[station].description;
  document.querySelector('.protocol-hint').hidden = workbenchActive;
  el('protocol-steps').replaceChildren(...protocol.steps.map(step => htmlElement('li', '', step)));
  el('protocol-observation').textContent = protocol.observation;
  el('help-dialog').showModal();
});
el('reset').addEventListener('click', () => {
  const state = stateOf();
  const positions = state.settings.positions;
  state.settings = makeState(station).settings;
  if (positions) state.settings.positions = positions;
  renderControls();
  geometryEdited();
});
el('sample-preset').addEventListener('change', event => {
  const preset = findSample(station, event.target.value);
  const settings = stateOf().settings;
  if (preset) Object.assign(settings, preset.settings);
  setSample(settings, preset);
  renderControls();
  geometryEdited();
});
el('reset-layout').addEventListener('click', () => {
  const id = station;
  editLayout(state => {
    state.layout = emptyEdits();
    delete state.settings.positions;
    inspectorId = undefined;
  });
  requestAnimationFrame(() => {
    if (station === id && !workbenchActive) instrumentViewport?.setView(el('instrument-view').value);
  });
});
el('instrument-undo').addEventListener('click', () => stepLayoutHistory(true));
el('instrument-redo').addEventListener('click', () => stepLayoutHistory(false));
document.addEventListener('keydown', event => {
  if (workbenchActive || event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey ||
      event.key.toLowerCase() !== 'z' || event.target?.closest?.('input,select,textarea,[contenteditable]') ||
      document.querySelector('dialog[open]')) return;
  if (stepLayoutHistory(!event.shiftKey)) event.preventDefault();
});
el('instrument-view').addEventListener('change', () => instrumentViewport?.setView(el('instrument-view').value));
el('instrument-fit').addEventListener('click', () => instrumentViewport?.resetView());
el('instrument-to-3d').addEventListener('click', () => {
  if (!currentTrace) return;
  workbench.loadLayout({ ...currentTrace.scene, parts: currentTrace.parts ?? currentTrace.scene.parts });
  openWorkbench();
});
for (const button of document.querySelectorAll('[data-instrument-tool]')) button.addEventListener('click', () => {
  instrumentTool = button.dataset.instrumentTool;
  if (instrumentTool === 'ray' && stateOf().mode !== 'dark') el('show-rays').checked = true;
  for (const item of document.querySelectorAll('[data-instrument-tool]')) item.setAttribute('aria-pressed', String(item === button));
  refreshBench();
});
const typeSelect = el('instrument-part-type');
typeSelect.append(...Object.entries(partNames).map(([type, name]) => new Option(name, type)));
el('instrument-part').addEventListener('change', event => { selectPart(event.target.value); refreshBench(); });
el('instrument-add').addEventListener('click', () => {
  if (!currentTrace || currentTrace.scene.parts.length >= 36) return;
  const part = newOptic(currentTrace.scene, currentTrace, typeSelect.value, selectedPart?.id);
  if (!part) return;
  editLayout(state => {
    state.layout.added.push(part);
    selectedPart = part;
    inspectorId = undefined;
  });
});
el('instrument-delete').addEventListener('click', () => {
  if (!selectedPart || !currentTrace) return;
  editLayout(state => {
    removePart(state.layout, currentTrace.scene, selectedPart.id);
    selectedPart = null;
  });
});
el('trace-store').addEventListener('click', storeTrace);
el('trace-overlay').addEventListener('change', event => {
  stateOf().overlay = event.target.checked;
  renderDetectorPlots();
});
el('trace-clear').addEventListener('click', () => {
  stateOf().memory = null;
  stateOf().overlay = true;
  renderDetectorPlots();
});
el('instrument-matlab').addEventListener('click', exportInstrumentMatlab);
el('wb-save-code').addEventListener('click', () => {
  if (currentCode) exportUserFile(currentCode.filename, currentCode.code);
});
el('wb-copy-code').addEventListener('click', async () => {
  if (!currentCode) return;
  try { await navigator.clipboard.writeText(currentCode.code); fileFeedback('MATLAB code copied.'); }
  catch { el('wb-code').select(); fileFeedback('Code selected. Use your system copy shortcut.'); }
});
el('show-rays').addEventListener('change', refreshBench);
el('show-labels').addEventListener('change', refreshBench);
for (const button of document.querySelectorAll('[data-instrument-view]')) button.addEventListener('click', () => {
  const state = stateOf();
  if (state.view === button.dataset.instrumentView) return;
  state.view = button.dataset.instrumentView;
  displayInstrumentView();
  updateLocation();
  if (state.view === 'optics') refreshBench();
  else alignmentSweep.cancel();
});
for (const button of document.querySelectorAll('[data-plot-display]')) button.addEventListener('click', () => {
  if (button.dataset.plotDisplay !== 'map') plotAnalysis.stopMap();
  stateOf().display = button.dataset.plotDisplay;
  if (renderPending) flushResult(); else renderDetectorPlots();
});
el('plot-selection').addEventListener('change', event => {
  plotAnalysis.stopMap();
  stateOf().plot = event.target.value === '*' ? '*' : Number(event.target.value);
  if (renderPending) flushResult(); else renderDetectorPlots();
});
el('photon-play').addEventListener('click', replayPhotons);
el('reference').addEventListener('click', () => capture('reference'));
el('dark').addEventListener('click', () => capture('dark'));
el('measure').addEventListener('click', () => capture('sample'));
el('stop-scan').addEventListener('click', () => {
  if (!acquisition) return;
  cancelScan();
  stateOf().stopped = true;
  refreshStatus();
});
el('export').addEventListener('click', exportCsv);
el('fft-engine').addEventListener('change', changeEngine);
el('matlab-run').addEventListener('click', runMatlabModel);
el('save-session').addEventListener('click', () =>
  desktopFile(api => api.save_session(sessionJson()), reply => fileFeedback('Saved ' + reply.name)));
el('open-session').addEventListener('click', () => desktopFile(api => api.open_session(), reply => {
  restoreSession(reply.content);
  fileFeedback('Opened ' + reply.name);
}));
for (const id of ['source-link', 'sample-source']) el(id).addEventListener('click', event => {
  if (!window.pywebview?.api) return;
  event.preventDefault();
  window.pywebview.api.open_source(el(id).href);
});
function enableNativeDialogs() {
  if (!window.pywebview?.api) return;
  el('open-session').hidden = false;
  el('save-session').hidden = false;
}
window.addEventListener('pywebviewready', enableNativeDialogs);
enableNativeDialogs();
if (workbenchActive) openWorkbench(false);
else {
  if (urlOptions.get('view') === 'acquire') stateOf().view = 'acquire';
  openStation(station, false);
}
