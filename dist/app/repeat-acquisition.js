const isSequence = value => Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView));

function sequence(value, label) {
  if (!isSequence(value)) throw new Error(label + ' must be a numeric array.');
  const values = Array.from(value);
  if (values.some(item => item != null && typeof item !== 'number')) {
    throw new Error(label + ' contains a nonnumeric value.');
  }
  return values;
}

function readCharts(result) {
  if (!Array.isArray(result?.charts) || !result.charts.length) {
    throw new Error('The acquisition has no measurement charts.');
  }
  return result.charts.map((chart, chartIndex) => {
    if (!chart || typeof chart !== 'object') throw new Error('The acquisition contains an invalid chart.');
    const name = chart.title || 'Chart ' + (chartIndex + 1);
    const series = chart.series ?? [];
    if (!Array.isArray(series)) throw new Error(name + ' has an invalid trace list.');
    const copy = { ...chart, series: series.map((entry, index) => {
      if (!entry || typeof entry !== 'object') throw new Error(name + ' contains an invalid trace.');
      const x = sequence(entry.x, name + ' trace ' + (index + 1) + ' X');
      const y = sequence(entry.y, name + ' trace ' + (index + 1) + ' Y');
      if (x.length !== y.length) throw new Error(name + ' has unequal X and Y sample counts.');
      return { ...entry, x, y };
    }) };
    if (chart.heatmap) {
      const x = sequence(chart.heatmap.x, name + ' map X');
      const y = sequence(chart.heatmap.y, name + ' map Y');
      if (!Array.isArray(chart.heatmap.z) || chart.heatmap.z.length !== y.length) {
        throw new Error(name + ' has an invalid map row count.');
      }
      const z = chart.heatmap.z.map((row, index) => {
        const values = sequence(row, name + ' map row ' + (index + 1));
        if (values.length !== x.length) throw new Error(name + ' has an invalid map column count.');
        return values;
      });
      copy.heatmap = { ...chart.heatmap, x, y, z };
    }
    return copy;
  });
}

function numericMetric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const number = Number(text.replaceAll(',', ''));
  return Number.isFinite(number) ? number : null;
}

function readMetrics(result) {
  if (result.metrics == null) return [];
  if (!Array.isArray(result.metrics)) throw new Error('Measurement metrics must be an array.');
  const keys = new Set();
  return result.metrics.map(metric => {
    if (!metric || typeof metric.label !== 'string' || !['string', 'number'].includes(typeof metric.value) ||
        (metric.unit != null && typeof metric.unit !== 'string')) {
      throw new Error('The acquisition contains an invalid metric.');
    }
    const key = JSON.stringify([metric.label, metric.unit ?? '']);
    if (keys.has(key)) throw new Error('Measurement metric labels and units must be unique.');
    keys.add(key);
    return { ...metric, key, numeric: numericMetric(metric.value) };
  });
}

function sameAxis(first, next) {
  return first.length === next.length && first.every((value, index) =>
    value === next[index] || (Number.isNaN(value) && Number.isNaN(next[index])));
}

function checkTopology(firstCharts, nextCharts) {
  if (firstCharts.length !== nextCharts.length) throw new Error('Measurement channels changed during repeated acquisition.');
  for (let index = 0; index < firstCharts.length; index++) {
    const first = firstCharts[index];
    const next = nextCharts[index];
    if (first.title !== next.title || first.xLabel !== next.xLabel || first.yLabel !== next.yLabel ||
        first.series.length !== next.series.length || Boolean(first.heatmap) !== Boolean(next.heatmap)) {
      throw new Error('Measurement channels or units changed during repeated acquisition.');
    }
    for (let trace = 0; trace < first.series.length; trace++) {
      if (first.series[trace].name !== next.series[trace].name || !sameAxis(first.series[trace].x, next.series[trace].x)) {
        throw new Error('Measurement trace names or X coordinates changed during repeated acquisition.');
      }
    }
    if (first.heatmap && (!sameAxis(first.heatmap.x, next.heatmap.x) || !sameAxis(first.heatmap.y, next.heatmap.y))) {
      throw new Error('Measurement map coordinates changed during repeated acquisition.');
    }
  }
}

function moments(length) {
  return Array.from({ length }, () => ({ count: 0, mean: 0, m2: 0 }));
}

function addValue(moment, value, validAxis) {
  if (!validAxis || !Number.isFinite(value)) return;
  moment.count += 1;
  const delta = value - moment.mean;
  moment.mean += delta / moment.count;
  moment.m2 += delta * (value - moment.mean);
}

function valueOf(moment, deviation) {
  if (!moment.count || (deviation && moment.count < 2)) return null;
  return deviation ? Math.sqrt(Math.max(0, moment.m2 / (moment.count - 1))) : moment.mean;
}

export function createRepeatAccumulator() {
  let charts;
  let stats;
  let count = 0;
  const metricStats = new Map();

  function add(result) {
    const nextCharts = readCharts(result);
    const nextMetrics = readMetrics(result);
    if (charts) checkTopology(charts, nextCharts);
    else {
      charts = nextCharts;
      stats = charts.map(chart => ({
        series: chart.series.map(entry => moments(entry.x.length)),
        heatmap: chart.heatmap?.z.map(row => moments(row.length)),
      }));
    }
    for (let index = 0; index < nextCharts.length; index++) {
      const chart = nextCharts[index];
      const chartStats = stats[index];
      chart.series.forEach((entry, trace) => entry.y.forEach((value, sample) => {
        addValue(chartStats.series[trace][sample], value, Number.isFinite(entry.x[sample]));
      }));
      chart.heatmap?.z.forEach((row, y) => row.forEach((value, x) => {
        addValue(chartStats.heatmap[y][x], value,
          Number.isFinite(chart.heatmap.x[x]) && Number.isFinite(chart.heatmap.y[y]));
      }));
    }
    for (const metric of nextMetrics) {
      if (!metricStats.has(metric.key)) {
        metricStats.set(metric.key, { metric, moment: moments(1)[0], textValues: new Set() });
      }
      const stat = metricStats.get(metric.key);
      stat.metric = metric;
      if (metric.numeric !== null) addValue(stat.moment, metric.numeric, true);
      else if (typeof metric.value === 'string') stat.textValues.add(metric.value);
    }
    count += 1;
    return count;
  }

  function outputCharts(deviation) {
    return charts.map((chart, index) => {
      const chartStats = stats[index];
      const copy = { ...chart, statistic: deviation ? 'sample-standard-deviation' : 'mean',
        yLabel: deviation && !chart.heatmap ? 'SD · ' + chart.yLabel : chart.yLabel,
        series: chart.series.map((entry, trace) => ({
          ...entry, x: [...entry.x], y: chartStats.series[trace].map(moment => valueOf(moment, deviation)),
        })) };
      if (chart.heatmap) copy.heatmap = { ...chart.heatmap,
        x: [...chart.heatmap.x], y: [...chart.heatmap.y],
        z: chartStats.heatmap.map(row => row.map(moment => valueOf(moment, deviation))),
        ...(deviation ? { zLabel: 'SD · ' + (chart.heatmap.zLabel ?? (chart.title === 'Transient absorption map' ? 'ΔA (mOD)' : 'Value')) } : {}),
      };
      return copy;
    });
  }

  function result() {
    const metrics = [];
    const metricDeviations = [];
    for (const { metric, moment, textValues } of metricStats.values()) {
      const { key, numeric, ...template } = metric;
      if (moment.count) {
        metrics.push({ ...template, value: moment.mean, count: moment.count });
        metricDeviations.push({ ...template, value: valueOf(moment, true), count: moment.count });
      } else if (textValues.size === 1) metrics.push({ ...template });
    }
    if (!count) return { charts: [], deviationCharts: [], count: 0, counts: [], metrics, metricDeviations };
    return {
      charts: outputCharts(false), deviationCharts: outputCharts(true), count, metrics, metricDeviations,
      counts: stats.map(chartStats => ({
        series: chartStats.series.map(trace => trace.map(moment => moment.count)),
        ...(chartStats.heatmap ? { heatmap: chartStats.heatmap.map(row => row.map(moment => moment.count)) } : {}),
      })),
    };
  }

  return { add, result };
}
