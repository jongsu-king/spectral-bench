const svgNamespace = 'http://www.w3.org/2000/svg';
const font = 'Arial, Helvetica, sans-serif';
const inlineProperties = [
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
  'stroke-opacity', 'fill-opacity', 'opacity', 'font-family', 'font-size', 'font-weight',
  'font-style', 'letter-spacing', 'text-anchor', 'dominant-baseline', 'visibility', 'image-rendering',
];

function svgElement(tag, attributes = {}, text) {
  const node = document.createElementNS(svgNamespace, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

export function figureFilename(title, format) {
  if (!['svg', 'png'].includes(format)) throw new Error('Choose SVG or PNG for the figure.');
  const stem = String(title ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100).replace(/-$/g, '');
  return 'spectral-bench-' + (stem || 'figure') + '.' + format;
}

// Wrap long names as well as words so imported filenames remain inside the figure.
export function wrapFigureText(value, width, measure) {
  if (!Number.isFinite(width) || width <= 0) throw new Error('The figure text width must be positive.');
  const words = String(value ?? '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && measure(line + ' ' + word) <= width) {
      line += ' ' + word;
      continue;
    }
    if (line) { lines.push(line); line = ''; }
    for (const character of word) {
      if (line && measure(line + character) > width) { lines.push(line); line = ''; }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function inlineSvgStyles(source, clone) {
  const originals = [source, ...source.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  originals.forEach((node, index) => {
    const computed = getComputedStyle(node);
    for (const property of inlineProperties) {
      const value = computed.getPropertyValue(property);
      if (value) copies[index].setAttribute(property, value);
    }
  });
  clone.querySelectorAll('.plot-cursor, .plot-zoom-box').forEach(node => node.remove());
  for (const node of [clone, ...clone.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) {
      if (attribute.name === 'class' || attribute.name === 'tabindex' || attribute.name === 'role' ||
          attribute.name.startsWith('aria-') || attribute.name.startsWith('on')) node.removeAttribute(attribute.name);
    }
  }
}

export function createFigureSvg(source, { title = '', legend = [], note = '', xLabel = '', yLabel = '', zLabel = '' } = {}) {
  const dimensions = (source.getAttribute('viewBox') ?? '').trim().split(/\s+/).map(Number);
  const width = dimensions[2], plotHeight = dimensions[3];
  if (dimensions.length !== 4 || !dimensions.every(Number.isFinite) || !(width > 0 && plotHeight > 0)) {
    throw new Error('The graph is not ready to export.');
  }
  const margin = 18;
  const measureContext = document.createElement('canvas').getContext('2d');
  if (!measureContext) throw new Error('A canvas is required to prepare this figure.');
  measureContext.font = '600 14px Arial';
  const titleLines = wrapFigureText(title, width, text => measureContext.measureText(text).width);
  let offset = margin + titleLines.length * 19;
  const root = svgElement('svg', { xmlns: svgNamespace, width: width + 2 * margin, role: 'img' });
  root.append(svgElement('title', {}, title));
  const description = [xLabel, yLabel, zLabel, note].filter(Boolean).join(' · ');
  if (description) root.append(svgElement('desc', {}, description));
  const metadata = { title, xLabel, yLabel, ...(zLabel ? { zLabel } : {}),
    xRange: [Number(source.dataset.xMin), Number(source.dataset.xMax)],
    yRange: [Number(source.dataset.yMin), Number(source.dataset.yMax)], logY: source.dataset.logY === 'true',
    legend: legend.map(item => item.name), ...(note ? { note } : {}) };
  root.append(svgElement('metadata', {}, JSON.stringify(metadata)));
  const content = svgElement('g', { 'font-family': font, fill: '#202020' });
  titleLines.forEach((line, index) => content.append(svgElement('text', {
    x: margin, y: margin + 14 + index * 19, 'font-size': 14, 'font-weight': 600,
  }, line)));
  if (titleLines.length) offset += 5;

  measureContext.font = '12px Arial';
  let legendX = 0, legendY = offset, rowHeight = 0;
  for (const item of legend) {
    const lines = wrapFigureText(item.name, width - 27, text => measureContext.measureText(text).width);
    if (!lines.length) continue;
    const itemWidth = 27 + Math.max(...lines.map(text => measureContext.measureText(text).width));
    if (legendX && legendX + itemWidth > width) { legendY += rowHeight + 4; legendX = 0; rowHeight = 0; }
    const x = margin + legendX;
    content.append(svgElement('line', { x1: x, x2: x + 17, y1: legendY + 8, y2: legendY + 8,
      stroke: item.color || '#205586', 'stroke-width': 2, ...(item.dash ? { 'stroke-dasharray': item.dash } : {}) }));
    lines.forEach((line, index) => content.append(svgElement('text', {
      x: x + 23, y: legendY + 12 + index * 16, 'font-size': 12,
    }, line)));
    legendX += itemWidth + 17;
    rowHeight = Math.max(rowHeight, lines.length * 16);
  }
  offset = legendY + rowHeight + (rowHeight ? 9 : 0);
  if (zLabel) {
    const lines = wrapFigureText(zLabel, width, text => measureContext.measureText(text).width);
    lines.forEach((line, index) => content.append(svgElement('text', {
      x: margin, y: offset + 12 + index * 16, 'font-size': 12, fill: '#555555',
    }, line)));
    offset += lines.length * 16 + 5;
  }

  const plot = source.cloneNode(true);
  inlineSvgStyles(source, plot);
  plot.setAttribute('x', margin);
  plot.setAttribute('y', offset);
  plot.setAttribute('width', width);
  plot.setAttribute('height', plotHeight);
  content.append(plot);
  offset += plotHeight;
  if (note) {
    measureContext.font = '11px Arial';
    const lines = wrapFigureText(note, width, text => measureContext.measureText(text).width);
    lines.forEach((line, index) => content.append(svgElement('text', {
      x: margin, y: offset + 17 + index * 15, 'font-size': 11, fill: '#555555',
    }, line)));
    offset += 5 + lines.length * 15;
  }
  const height = offset + margin;
  root.setAttribute('height', height);
  root.setAttribute('viewBox', '0 0 ' + (width + 2 * margin) + ' ' + height);
  root.append(svgElement('rect', { width: '100%', height: '100%', fill: '#ffffff' }), content);
  return { content: new XMLSerializer().serializeToString(root), width: width + 2 * margin, height };
}

export async function createFigureAsset(source, options, format) {
  const filename = figureFilename(options?.title, format);
  const figure = createFigureSvg(source, options);
  if (format === 'svg') return { filename, content: figure.content, mimeType: 'image/svg+xml', encoding: 'utf8' };
  const url = URL.createObjectURL(new Blob([figure.content], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('The graph could not be rasterized. Save SVG to retain the vector figure.'));
      image.src = url;
    });
    // Three samples per CSS pixel, bounded to keep very large displays responsive.
    const scale = Math.min(3, 8192 / figure.width, 8192 / figure.height,
      Math.sqrt(24_000_000 / (figure.width * figure.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(figure.width * scale));
    canvas.height = Math.max(1, Math.round(figure.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('A canvas is required to save PNG figures.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/png');
    if (!data.startsWith('data:image/png;base64,')) throw new Error('The PNG figure is too large to encode.');
    return { filename, content: data.slice(data.indexOf(',') + 1), mimeType: 'image/png', encoding: 'base64' };
  } finally { URL.revokeObjectURL(url); }
}

export function downloadFigure(asset) {
  const content = asset.encoding === 'base64'
    ? Uint8Array.from(atob(asset.content), value => value.charCodeAt(0)) : asset.content;
  const href = URL.createObjectURL(new Blob([content], { type: asset.mimeType }));
  const link = document.createElement('a');
  link.href = href;
  link.download = asset.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
