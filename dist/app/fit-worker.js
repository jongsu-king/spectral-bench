import { fitTrace } from './plot-fit.js';

self.onmessage = ({ data }) => {
  try { self.postMessage({ kind: 'result', result: fitTrace(data?.series, data?.options) }); }
  catch (error) { self.postMessage({ kind: 'error', message: error.message || 'The fit could not be completed.' }); }
};
