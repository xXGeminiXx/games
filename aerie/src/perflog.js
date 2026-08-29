// ---------------------------------------------------------------------------
// A record of how the game actually ran, kept on this machine and nowhere
// else.
//
// The frame guard has to measure frame time continuously anyway. This keeps
// that measurement instead of throwing it away, so a slow session can be
// looked at afterwards rather than guessed about. A reading is worthless
// without what produced it, so every entry carries the settings in force, the
// size of the fleet, the size of the buffer and the display's pixel ratio.
//
// It is written to this browser's own storage and read back by the player
// pressing a button. It is never sent anywhere: the game makes no network
// calls at all, and that is worth more than any telemetry.
// ---------------------------------------------------------------------------

const MAX = 240;   // entries kept; older ones fall off the end

export function createPerfLog(cfg, storage, { key = cfg.identity.storageKey + '.perf' } = {}) {
  let entries = [];
  try { const s = storage && storage.getItem(key); const a = s ? JSON.parse(s) : null; if (Array.isArray(a)) entries = a.slice(-MAX); } catch (e) { entries = []; }

  const flush = () => {
    try { storage && storage.setItem(key, JSON.stringify(entries)); } catch (e) { /* a full store just means this session is not kept */ }
  };

  // One entry, from a window of frame times in milliseconds.
  const record = (times, about) => {
    if (!times || times.length < 5) return null;
    const a = [...times].sort((x, y) => x - y);
    const at = (q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
    const e = {
      t: Date.now(),
      med: +at(0.5).toFixed(2),
      p95: +at(0.95).toFixed(2),
      n: a.length,
      ...about,
    };
    entries.push(e);
    while (entries.length > MAX) entries.shift();
    flush();
    return e;
  };

  // Plain text the player can read or paste somewhere. One line per window.
  const text = () => {
    const head = `${cfg.identity.name} performance log, this machine only, ${entries.length} windows`;
    const cols = 'when                  median   worst 5%   fps   detail   buffer      ratio   drones';
    const lines = entries.map((e) => {
      const when = new Date(e.t).toISOString().replace('T', ' ').slice(0, 19);
      const fps = e.med > 0 ? (1000 / e.med).toFixed(0) : '-';
      return [
        when.padEnd(21),
        (e.med + 'ms').padStart(7),
        (e.p95 + 'ms').padStart(10),
        String(fps).padStart(5),
        String(e.quality || '-').padStart(8),
        String(e.buffer || '-').padStart(10),
        String(e.dpr || '-').padStart(7),
        String(e.drones == null ? '-' : e.drones).padStart(8),
      ].join(' ');
    });
    return [head, cols, ...lines].join('\n');
  };

  const clear = () => { entries = []; flush(); };

  return { record, text, clear, key, get length() { return entries.length; }, all: () => entries.slice() };
}
