const limit = 12_000_000;
const byteLength = text => new TextEncoder().encode(text).length;

function sessionObject(text) {
  const data = JSON.parse(text);
  if (!data || data.format !== 'spectral-bench' || data.version !== 1 ||
      !data.instruments || typeof data.instruments !== 'object' || Array.isArray(data.instruments)) {
    throw new Error('The recovery copy does not contain a supported session.');
  }
  return data;
}

export function packRecovery(session, savedAt = Date.now()) {
  if (typeof session !== 'string' || byteLength(session) > limit) throw new Error('The recovery copy exceeds 12 MB.');
  const content = JSON.stringify({ format: 'spectral-bench-recovery', version: 1, savedAt,
    session: sessionObject(session) });
  if (byteLength(content) > limit) throw new Error('The recovery copy exceeds 12 MB.');
  return content;
}

export function unpackRecovery(content) {
  if (typeof content !== 'string' || byteLength(content) > limit) throw new Error('The recovery copy exceeds 12 MB.');
  const data = JSON.parse(content);
  if (!data || data.format !== 'spectral-bench-recovery' || data.version !== 1 ||
      !Number.isFinite(data.savedAt) || Math.abs(data.savedAt) > 8.64e15) {
    throw new Error('The recovery copy is not a supported session.');
  }
  const session = JSON.stringify(data.session);
  sessionObject(session);
  return { session, savedAt: data.savedAt };
}

/** One recovery copy per app/profile. A pending copy is never overwritten. */
export function createSessionRecovery({ storage, serialize, restore, canSave = () => true,
  onState = () => {}, now = Date.now }) {
  let initialized = false, initializing, pending = false, record, busy = false, savedAt = null;
  let lastSession, error = '', timer;

  function publish() { onState({ initialized, pending, restorable: Boolean(record), busy, savedAt, error }); }
  function fail(problem) { error = problem?.message || 'The recovery copy is unavailable.'; publish(); }
  function checked(reply) {
    if (reply?.error) throw new Error(reply.error);
    return reply;
  }

  async function start() {
    if (initializing) return initializing;
    initializing = (async () => {
      try {
        const reply = checked(await storage.load());
        if (reply?.content) {
          pending = true;
          record = unpackRecovery(reply.content);
          savedAt = record.savedAt;
        }
      } catch (problem) {
        // Leave an unreadable copy available for explicit discard, too.
        pending = true;
        fail(problem);
      }
      initialized = true;
      publish();
    })();
    return initializing;
  }

  async function flush() {
    if (!initialized || pending || busy || !canSave()) return false;
    busy = true;
    try {
      const session = serialize();
      if (session === lastSession) return false;
      const timestamp = now();
      const content = packRecovery(session, timestamp);
      checked(await storage.save(content));
      lastSession = session;
      savedAt = timestamp;
      error = '';
      return true;
    } catch (problem) { fail(problem); return false; }
    finally { busy = false; publish(); }
  }

  async function restorePending() {
    if (!pending || !record || busy) return false;
    busy = true;
    publish();
    try {
      await restore(record.session);
      lastSession = record.session;
      pending = false;
      record = null;
      error = '';
      return true;
    } catch (problem) { fail(problem); return false; }
    finally { busy = false; publish(); }
  }

  async function discard() {
    if (!pending || busy) return false;
    busy = true;
    publish();
    try {
      checked(await storage.clear());
      pending = false;
      record = null;
      lastSession = undefined;
      savedAt = null;
      error = '';
      return true;
    } catch (problem) { fail(problem); return false; }
    finally { busy = false; publish(); }
  }

  return {
    start, flush, restorePending, discard,
    schedule() { clearTimeout(timer); timer = setTimeout(flush, 900); },
    dispose() { clearTimeout(timer); },
  };
}
