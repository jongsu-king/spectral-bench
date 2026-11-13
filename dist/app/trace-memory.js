const MAX_CHARTS = 12;
const MAX_SERIES = 12;
const MAX_POINTS = 16000;
const title = value => typeof value === 'string' ? value.slice(0, 160) : '';
const isSequence = value => Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView));
const chartKey = chart => JSON.stringify([chart.title, chart.xLabel ?? '', chart.yLabel ?? '']);

function snapshotSeries(entry) {
  if (!isSequence(entry?.x) || !isSequence(entry?.y)) return null;
  const length = Math.min(entry.x.length, entry.y.length, MAX_POINTS);
  const x = [];
  const y = [];
  let count = 0;
  for (let index = 0; index < length; index += 1) {
    const validX = Number.isFinite(entry.x[index]);
    const validY = Number.isFinite(entry.y[index]);
    x.push(validX ? entry.x[index] : null);
    y.push(validX && validY ? entry.y[index] : null);
    count += Number(validX && validY);
  }
  return count ? { name: title(entry.name) || 'Signal', x, y } : null;
}

export function snapshotLineCharts(charts) {
  if (!Array.isArray(charts)) return [];
  return charts.slice(0, MAX_CHARTS).flatMap(chart => {
    if (!chart || chart.heatmap || !title(chart.title) || !Array.isArray(chart.series)) return [];
    const series = chart.series.slice(0, MAX_SERIES).map(snapshotSeries).filter(Boolean);
    return series.length ? [{ title: title(chart.title), xLabel: title(chart.xLabel), yLabel: title(chart.yLabel), series }] : [];
  });
}

export function overlayLineCharts(charts, storedCharts) {
  const stored = new Map(storedCharts.map(chart => [chartKey(chart), chart.series]));
  let count = 0;
  const result = charts.map(chart => {
    const memory = !chart.heatmap && stored.get(chartKey(chart));
    if (!memory?.length) return chart;
    count += 1;
    return { ...chart, series: [...(chart.series ?? []), ...memory.map(entry => ({
      ...entry, name: 'Stored · ' + entry.name, dash: '5 3', memory: true,
    }))] };
  });
  return { charts: result, count };
}
