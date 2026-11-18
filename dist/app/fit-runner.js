import { fitTrace } from './plot-fit.js';

export class FitCancelledError extends Error {
  constructor() { super('Fit stopped.'); this.name = 'AbortError'; }
}

export function selectedFitPointCount(series, options = {}) {
  const min = options.min ?? -Infinity, max = options.max ?? Infinity;
  let count = 0;
  for (let index = 0; index < Math.min(series?.x?.length ?? 0, series?.y?.length ?? 0); index++) {
    if (Number.isFinite(series.x[index]) && Number.isFinite(series.y[index]) && series.x[index] >= min && series.x[index] <= max) count++;
  }
  return count;
}

// A separate worker owns each fit so cancellation can terminate numerical work,
// including the optimizer's coarse grid and its covariance calculation.
export function startTraceFit(series, options = {}, {
  createWorker = () => {
    if (typeof Worker !== 'function') throw new Error('Workers are unavailable.');
    return new Worker(new URL('./fit-worker.js', import.meta.url), { type: 'module', name: 'Spectral Bench trace fit' });
  },
  onExecution,
  foregroundLimit = 2000,
  foregroundFit = fitTrace,
  schedule = callback => setTimeout(callback, 0),
  cancelSchedule = clearTimeout,
} = {}) {
  let resolve, reject, worker, timer, settled = false, execution = null;
  const count = selectedFitPointCount(series, options);
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  function stopWorker() {
    if (!worker) return;
    worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
    worker.terminate(); worker = null;
  }
  function finish(error, result) {
    if (settled) return;
    settled = true; stopWorker();
    if (timer !== undefined) cancelSchedule(timer);
    if (error) reject(error); else resolve(result);
  }
  function foreground() {
    if (settled) return;
    stopWorker();
    if (count > foregroundLimit) {
      finish(new Error('Background fitting is unavailable in this browser. Reduce the selected fit range to ' + foregroundLimit.toLocaleString('en-US') + ' finite points or fewer, or use a browser with module-worker support.'));
      return;
    }
    execution = 'foreground'; onExecution?.({ mode: execution, count, cancellable: false });
    timer = schedule(() => {
      timer = undefined;
      if (settled) return;
      try { finish(null, foregroundFit(series, options)); }
      catch (error) { finish(error); }
    });
  }
  try {
    worker = createWorker();
    worker.onmessage = event => {
      if (settled) return;
      const message = event.data;
      if (message?.kind === 'result') finish(null, message.result);
      else if (message?.kind === 'error') finish(new Error(message.message || 'The fit could not be completed.'));
    };
    worker.onerror = event => { event.preventDefault?.(); foreground(); };
    worker.onmessageerror = () => finish(new Error('The background fit result could not be read. Run the fit again.'));
    execution = 'worker'; onExecution?.({ mode: execution, count, cancellable: true });
    worker.postMessage({ series: { x: Array.from(series?.x ?? []), y: Array.from(series?.y ?? []) },
      options: { model: options.model, min: options.min, max: options.max } });
  } catch { foreground(); }
  return { promise, count, get execution() { return execution; }, cancel() {
    if (settled) return false;
    finish(new FitCancelledError()); return true;
  } };
}
