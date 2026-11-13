import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { traceInstrumentOptics } from '../dist/app/instrument-optics.js';
import { generateMatlabMeasurement } from '../dist/app/matlab-measurement.js';
import { opticalModels } from '../dist/app/models-optical.js';
import { advancedModels } from '../dist/app/models-advanced.js';

const models = { ...opticalModels, ...advancedModels };
const destination = process.argv[2] ?? fileURLToPath(new URL('../releases/Spectral Bench MATLAB Measurements/', import.meta.url));
const instruments = [
  ['array', 'Array CCD', 'CCD pixels, lamp calibration and calibrated wavelength spectrum.'],
  ['uv', 'UV–Vis', 'Sample, blank and dark channels; absorbance and transmission.'],
  ['pl', 'Steady-state PL', 'Emission spectrum and photon counts.'],
  ['trpl', 'TRPL', 'TCSPC histogram, instrument response and lifetime fit.'],
  ['raman', 'Raman', 'Detected Raman shift spectrum and silicon standard.'],
  ['ftir', 'FTIR · ATR', 'Michelson interferogram, Fourier spectrum and absorbance.'],
  ['ellipsometry', 'Ellipsometry', 'Analyzer intensity, Ψ and Δ, and film thickness.'],
  ['ta', 'Transient absorption', 'Pump-on/off spectra, delay trace and wavelength–time map.'],
  ['thz', 'THz–TDS', 'Signed waveform, complex transfer and material retrieval.'],
];

await mkdir(destination, { recursive: true });
for (const [id] of instruments) {
  const settings = { ...Object.fromEntries(models[id].controls.map(({ key, value }) => [key, value])), alignment: 0 };
  const capture = (mode, seed) => {
    const { traceScene, opticalTransfer } = traceInstrumentOptics(id, settings, undefined, mode);
    return { settings, mode, seed, scene: traceScene, opticalTransfer };
  };
  const dark = id === 'uv' ? capture('dark', 632) : null;
  const reference = capture('reference', 633);
  const sample = capture('sample', 634);
  const script = generateMatlabMeasurement(id, sample.scene, { ...sample, reference, dark });
  await writeFile(join(destination, 'spectral_bench_' + id + '_measurement.m'), script);
}
await writeFile(join(destination, 'README.txt'), [
  'Spectral Bench | MATLAB Measurements',
  '',
  'Open any .m file in MATLAB and click Run. The scripts use base MATLAB.',
  'Each example includes the factory optics and its reference acquisition.',
  'The UV–Vis example also includes a dark acquisition.',
  '',
  ...instruments.map(([id, title, description]) => 'spectral_bench_' + id + '_measurement.m | ' + title + ' | ' + description),
  '',
  'Workspace outputs:',
  '  measurement.charts   Data for the instrument plots.',
  '  measurement.metrics Values derived from the measurement.',
  '  rayTrace            Traced 3D rays, detector hits and path information.',
  '  detectorSummary     Detector power and spot summaries.',
  '  pathSegments        Individual ray segment lengths and cumulative distances in mm.',
  '',
  'To test an alignment change, insert these lines just after "scene = savedScene;" in any script:',
  "  k = find(cellfun(@(part) strcmp(part.type,'lens') || strcmp(part.type,'mirror'),scene.parts),1);",
  '  scene.parts{k}.rotation(3) = scene.parts{k}.rotation(3) + 10;',
  '',
  'The reference stays fixed while the sample layout is retraced. To export a custom',
  'setup, edit its optics in the desktop app and choose MATLAB code → Save .m file.',
  'The measurements are synthetic and use a geometric ray model.',
  '',
].join('\n'));
