const rayCountFormat = new Intl.NumberFormat('en-US');
const rayValueFormat = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 5 });
const endings = {
  aperture: 'Blocked by aperture',
  absorption: 'Absorbed',
  escaped: 'Escaped the layout',
  evanescent: 'Diffraction order does not propagate',
  limit: 'Trace limit reached',
  table: 'Hit the optical table',
};

function describeWavelength(wavelength) {
  if (wavelength >= 1e6) return rayValueFormat.format(wavelength / 1e6) + ' mm';
  if (wavelength >= 1000) return rayValueFormat.format(wavelength / 1000) + ' µm';
  return rayValueFormat.format(wavelength) + ' nm';
}

function describePower(power) {
  if (power > 0 && power < 0.1) return rayValueFormat.format(power * 1000) + ' µW';
  return rayValueFormat.format(power) + ' mW';
}

function segmentsOf(ray, partName) {
  let from = partName(ray.sourceId) ?? 'Source';
  let distance = 0;
  const segments = [];
  for (let index = 0; index < ray.points.length - 1; index++) {
    const hit = ray.interactions?.[index];
    const to = partName(hit?.partId) ?? (ray.reason === 'table' ? 'Optical table' : 'Trace end');
    const length = hit?.segmentLength ?? Math.hypot(...ray.points[index + 1].map((value, axis) => value - ray.points[index][axis]));
    distance = hit?.pathLength ?? distance + length;
    segments.push({ from, to, length, distance });
    from = to;
  }
  return segments;
}

export function createRayInspector({ onSelect, onClear }) {
  const details = document.getElementById('instrument-ray-inspector');
  const count = document.getElementById('instrument-ray-count');
  const input = document.getElementById('instrument-ray-index');
  const clear = document.getElementById('instrument-ray-clear');
  const status = document.getElementById('instrument-ray-status');
  const table = document.getElementById('instrument-ray-table');
  const rows = document.getElementById('instrument-ray-segments');
  let rays = [];
  let trace;
  let selection;
  let renderedTrace;
  let renderedRay;
  let segmentButtons = [];

  function render() {
    const ray = rays[selection?.index];
    const rayNumber = ray ? String(selection.index + 1) : '';
    if (document.activeElement !== input) input.value = rayNumber;
    input.max = String(Math.max(1, rays.length));
    input.placeholder = rays.length > 1 ? '1–' + rays.length : '1';
    input.disabled = rays.length === 0;
    clear.disabled = !ray;

    if (trace !== renderedTrace || ray !== renderedRay) {
      renderedTrace = trace;
      renderedRay = ray;
      segmentButtons = [];
      if (!ray) {
        status.textContent = rays.length ? 'Click a ray or enter its number.' : 'No rays to inspect.';
        table.hidden = true;
        rows.replaceChildren();
        return;
      }

      const parts = trace.traceScene?.parts ?? trace.parts ?? trace.scene?.parts ?? [];
      const names = new Map(parts.map(part => [part.id, part.name || part.id]));
      const partName = id => id ? names.get(id) ?? id : null;
      const endpoint = ray.detectorId ? 'Detected at ' + partName(ray.detectorId) : endings[ray.reason] ?? 'Missed detector';
      status.textContent = [describeWavelength(ray.wavelength), endpoint,
        (ray.detectorId ? 'Received ' : 'End power ') + describePower(ray.power),
        rayValueFormat.format(ray.pathLength) + ' mm total'].join(' · ');
      const segments = segmentsOf(ray, partName);
      table.hidden = !segments.length;
      rows.replaceChildren(...segments.map(({ from, to, length, distance }, index) => {
        const row = document.createElement('tr');
        const first = document.createElement('td');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button ray-segment';
        button.textContent = index + 1;
        button.setAttribute('aria-label', 'Highlight segment ' + (index + 1) + ' from ' + from + ' to ' + to);
        segmentButtons.push(button);
        first.append(button);
        row.append(first);
        for (const value of [from, to, rayValueFormat.format(length), rayValueFormat.format(distance)]) {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.append(cell);
        }
        row.addEventListener('click', () => onSelect({ index: selection.index, segment: index }));
        return row;
      }));
    }

    segmentButtons.forEach((button, index) => {
      const active = index === selection?.segment;
      button.setAttribute('aria-pressed', String(active));
      button.closest('tr').classList.toggle('is-selected', active);
    });
  }

  input.addEventListener('change', () => {
    const value = input.valueAsNumber;
    if (!rays.length || !Number.isFinite(value)) {
      input.value = rays[selection?.index] ? String(selection.index + 1) : '';
      return;
    }
    const index = Math.min(rays.length, Math.max(1, Math.round(value))) - 1;
    input.value = index + 1;
    onSelect({ index, segment: null });
  });
  clear.addEventListener('click', () => {
    onClear();
    input.value = '';
    input.focus();
  });
  details.addEventListener('toggle', () => { if (details.open) render(); });

  return {
    update(nextTrace, nextSelection) {
      if (nextTrace === trace && nextSelection?.index === selection?.index && nextSelection?.segment === selection?.segment) return;
      trace = nextTrace;
      selection = nextSelection;
      if (rays !== trace?.rays) {
        rays = trace?.rays ?? [];
        const detected = rays.reduce((total, ray) => total + Number(Boolean(ray.detectorId)), 0);
        count.textContent = rayCountFormat.format(rays.length) + (rays.length === 1 ? ' ray' : ' rays') +
          ' · ' + rayCountFormat.format(detected) + ' detected';
      }
      if (details.open) render();
    },
    open() {
      details.open = true;
      render();
    },
  };
}
