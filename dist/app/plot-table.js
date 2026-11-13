const PAGE_SIZE = 40;
const plotTables = new WeakMap();

function numberText(value) {
  return Number.isFinite(value) ? String(Number(value.toPrecision(8))) : '';
}

function dataSources(chart) {
  if (!chart) return [];
  const { heatmap } = chart;
  if (heatmap?.x?.length && heatmap.y?.length) {
    const valueLabel = heatmap.zLabel ?? (chart.title === 'Transient absorption map' ? 'ΔA (mOD)' : 'Value');
    return Array.from(heatmap.y, (delay, index) => ({
      id: String(index),
      label: numberText(delay),
      x: heatmap.x,
      y: heatmap.z?.[index],
      yLabel: valueLabel,
    })).filter((source, index) => Number.isFinite(heatmap.y[index]));
  }
  return (chart.series ?? []).flatMap((trace, index) => trace?.x?.length ? [{
    id: JSON.stringify([trace.name, Boolean(trace.memory), index]),
    label: trace.name ?? 'Signal',
    x: trace.x,
    y: trace.y,
    yLabel: chart.yLabel ?? 'Value',
  }] : []);
}

function node(tag, className, label) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (label !== undefined) element.textContent = label;
  return element;
}

function numberCell(value) {
  const cell = node('td', '', numberText(value));
  if (Number.isFinite(value)) cell.title = String(value);
  else cell.setAttribute('aria-label', 'No measured value');
  return cell;
}

function createPlotTable(container) {
  const toolbar = node('div', 'plot-table-toolbar');
  const selectorLabel = node('label', 'plot-table-source');
  const sourceLabel = node('span');
  const selector = node('select');
  selectorLabel.append(sourceLabel, selector);
  toolbar.append(selectorLabel);

  const scroller = node('div', 'plot-table-scroll');
  scroller.tabIndex = 0;
  scroller.setAttribute('role', 'region');
  scroller.setAttribute('aria-label', 'Sample rows');
  const table = node('table', 'plot-table-grid');
  const header = node('thead');
  const rows = node('tbody');
  table.append(header, rows);
  scroller.append(table);

  const footer = node('div', 'plot-table-footer');
  const range = node('output', 'plot-table-range');
  const previous = node('button', 'button', 'Previous');
  const next = node('button', 'button', 'Next');
  previous.type = next.type = 'button';
  footer.append(range, previous, next);

  const empty = node('p', 'plot-table-empty', 'No samples for this graph.');
  container.replaceChildren(toolbar, scroller, footer, empty);

  const viewState = new Map();
  let selection = { source: '', page: 0 };
  let chart;
  let sources = [];
  let optionSignature = '';

  function drawPage() {
    const source = sources[selector.selectedIndex];
    toolbar.hidden = scroller.hidden = footer.hidden = !source;
    empty.hidden = Boolean(source);
    if (!source) {
      header.replaceChildren();
      rows.replaceChildren();
      return;
    }

    table.setAttribute('aria-label', chart.title ?? 'Graph data');
    const headings = node('tr');
    for (const text of ['Point', chart.xLabel ?? 'X', source.yLabel]) {
      const heading = node('th', '', text);
      heading.scope = 'col';
      headings.append(heading);
    }
    header.replaceChildren(headings);

    const pointCount = source.x.length;
    selection.page = Math.max(0, Math.min(selection.page, Math.floor((pointCount - 1) / PAGE_SIZE)));
    const start = selection.page * PAGE_SIZE;
    const stop = Math.min(start + PAGE_SIZE, pointCount);
    const page = document.createDocumentFragment();
    for (let index = start; index < stop; index += 1) {
      const row = node('tr');
      row.append(node('td', '', String(index + 1)), numberCell(source.x[index]), numberCell(source.y?.[index]));
      page.append(row);
    }
    rows.replaceChildren(page);
    const label = (start + 1 === stop ? String(stop) : `${start + 1}–${stop}`) + ` of ${pointCount}`;
    if (range.value !== label) range.value = label;
    previous.disabled = start === 0;
    next.disabled = stop === pointCount;
  }

  selector.addEventListener('change', () => {
    selection.source = selector.value;
    selection.page = 0;
    drawPage();
  });
  previous.addEventListener('click', () => {
    selection.page -= 1;
    drawPage();
  });
  next.addEventListener('click', () => {
    selection.page += 1;
    drawPage();
  });

  return selectedChart => {
    chart = selectedChart;
    sources = dataSources(chart);
    const identity = JSON.stringify([chart?.title, chart?.xLabel, chart?.yLabel]);
    if (!viewState.has(identity)) viewState.set(identity, { source: '', page: 0 });
    selection = viewState.get(identity);

    sourceLabel.textContent = chart?.heatmap ? chart.yLabel ?? 'Slice' : 'Trace';
    const signature = JSON.stringify(sources.map(source => [source.id, source.label]));
    if (signature !== optionSignature) {
      selector.replaceChildren(...sources.map(source => new Option(source.label, source.id)));
      optionSignature = signature;
    }
    const retained = sources.find(source => source.id === selection.source);
    if (retained) selector.value = retained.id;
    else {
      selector.selectedIndex = sources.length ? 0 : -1;
      selection.source = selector.value;
      selection.page = 0;
    }
    selector.disabled = sources.length < 2;
    drawPage();
  };
}

export function renderPlotTable(container, charts, key) {
  const selected = typeof key === 'number' ? charts[key] : charts.find(chart => chart.title === key);
  if (!plotTables.has(container)) plotTables.set(container, createPlotTable(container));
  plotTables.get(container)(selected ?? charts[0]);
}
