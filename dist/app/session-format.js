const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate the document before any currently open experiment is replaced. */
export function parseSessionDocument(content, instruments) {
  if (typeof content !== 'string' || new TextEncoder().encode(content).length > 12_000_000) {
    throw new Error('The session file exceeds 12 MB.');
  }
  const data = JSON.parse(content);
  if (!record(data) || data.format !== 'spectral-bench' || data.version !== 1 || !record(data.instruments) ||
      (data.instrument !== 'workbench' && !instruments.includes(data.instrument))) {
    throw new Error('This is not a supported Spectral Bench session.');
  }
  for (const id of instruments) {
    if (Object.hasOwn(data.instruments, id) && (!record(data.instruments[id]) || !record(data.instruments[id].settings))) {
      throw new Error('The session contains an incomplete ' + id + ' instrument record.');
    }
  }
  if (data.instrument === 'workbench') {
    if (!record(data.workbench?.scene) || !Array.isArray(data.workbench.scene.parts)) {
      throw new Error('The session does not contain an optical workbench layout.');
    }
  } else if (!Object.hasOwn(data.instruments, data.instrument)) {
    throw new Error('The session does not contain its selected instrument.');
  }
  return data;
}
