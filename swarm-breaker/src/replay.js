// VENDORED FROM THE GAME ART FOUNDATION.
// Source: /mnt/c/Personal/game-art lib/replay.js at commit 1fe237d (2026-08-29).
// Copied, not imported: every game here is a self-contained static page, so
// the foundation is a template rather than a library. A fix lands there first
// with a test and is carried across; `node tools/vendor-diff.js <game>/src` in
// that repo says which copies have drifted. Edit this file only to carry a
// fix, and record the drift if the change is deliberate.

// ---------------------------------------------------------------------------
// Input logs and deterministic replay.
//
// A run is recorded as the inputs the player gave and the tick each one
// landed on. Nothing about the world is stored, so a whole run is a few
// hundred bytes: that is what makes ghosts, shared runs and a board that can
// re-check a score possible at all.
//
// The bargain the game has to keep for this to work:
//   - fixed step. The sim advances one tick at a time and never reads a wall
//     clock or a frame delta.
//   - one integer per tick of input. A game packs its per-tick input into a
//     32-bit integer (a bitfield of held keys, or a small enum plus a
//     payload). Integers are what serialize identically everywhere and what
//     the no-op rule below can compare.
//   - integer randomness from rng.js and no transcendental math in the sim.
//     Math.sin, pow, exp and log are allowed to differ in the last bit
//     between engines, and one bit is a different run by tick 400.
//
// The log is a flat array of tick, input, tick, input pairs. A tick with no
// entry is played as the no-op input, which is why dropping no-op entries is
// lossless and why two entries with the same value are NOT collapsed: the
// runner fills a gap with the no-op, not with the previous input.
// ---------------------------------------------------------------------------

export const LOG_VERSION = 1;

// A run recorder. `cap` is the maximum number of entries kept; past it the
// log stops growing and `truncated` goes true, so a score built on a longer
// run can still be posted and is honestly labelled as unreplayable.
export function recorder({ cap = 4096, noop = 0 } = {}) {
  const data = [];
  let truncated = false;
  let lastTick = -1;

  return {
    get length() { return data.length >> 1; },
    get truncated() { return truncated; },
    get lastTick() { return lastTick; },

    // Returns false when the entry was dropped, either as a no-op or by the
    // cap. Ticks must not go backwards; that is a bug in the caller, not a
    // condition to tolerate quietly.
    record(tick, input) {
      if (!Number.isInteger(tick) || tick < 0) throw new Error('tick must be a non-negative integer');
      if (!Number.isInteger(input)) throw new Error('input must be an integer');
      if (tick < lastTick) throw new Error(`tick went backwards: ${tick} after ${lastTick}`);
      lastTick = tick;
      if (input === noop) return false;
      if ((data.length >> 1) >= cap) { truncated = true; return false; }
      data.push(tick, input | 0);
      return true;
    },

    reset() { data.length = 0; truncated = false; lastTick = -1; },

    // The serializable form. `ticks` is the length of the run, which the
    // replayer needs and which the last input does not imply (a run can end
    // long after the last key press).
    log(ticks = lastTick + 1) {
      return { v: LOG_VERSION, ticks, noop, truncated, data: data.slice() };
    },
  };
}

// Drop no-op entries. A recorder already refuses them; this is for logs
// built elsewhere, and for re-checking one that arrived over the wire.
export function compact(log) {
  const noop = log.noop | 0;
  const data = [];
  for (let i = 0; i < log.data.length; i += 2) {
    if ((log.data[i + 1] | 0) !== noop) data.push(log.data[i] | 0, log.data[i + 1] | 0);
  }
  return { ...log, data };
}

// Reject a log that cannot be replayed before spending any CPU on it: wrong
// version, odd length, ticks out of order, values that are not integers, or
// more entries than allowed.
export function validate(log, { maxEntries = 4096, maxTicks = 1000000 } = {}) {
  if (!log || typeof log !== 'object') return 'log is not an object';
  if (log.v !== LOG_VERSION) return `log version ${log.v} is not ${LOG_VERSION}`;
  if (!Array.isArray(log.data)) return 'log.data is not an array';
  if (log.data.length & 1) return 'log.data has an odd length';
  if ((log.data.length >> 1) > maxEntries) return `log has ${log.data.length >> 1} entries, over the ${maxEntries} cap`;
  if (!Number.isInteger(log.ticks) || log.ticks < 0 || log.ticks > maxTicks) return 'log.ticks is out of range';
  let prev = -1;
  for (let i = 0; i < log.data.length; i += 2) {
    const t = log.data[i], v = log.data[i + 1];
    if (!Number.isInteger(t) || !Number.isInteger(v)) return `entry ${i >> 1} is not integers`;
    if (t < prev) return `entry ${i >> 1} goes backwards in time`;
    if (t >= log.ticks) return `entry ${i >> 1} is at tick ${t}, past the run's ${log.ticks} ticks`;
    prev = t;
  }
  return null;
}

// The fixed-step runner. `step(state, input, tick)` advances the sim by one
// tick; it may mutate state and may return a replacement. Two inputs on the
// same tick are delivered in the order they were recorded, each as its own
// call, so a game never has to merge them.
//
// `snapshot(state)` is called at the end and its result handed to
// stateHash. `onTick` is for a ghost that has to draw as it replays.
export function run({ state, step, log, ticks, snapshot, onTick, budget = 0 }) {
  if (typeof step !== 'function') throw new Error('step must be a function');
  const problem = validate(log, { maxEntries: Infinity, maxTicks: Infinity });
  if (problem) throw new Error('bad log: ' + problem);
  const total = ticks == null ? log.ticks : ticks;
  const noop = log.noop | 0;
  const data = log.data;
  let cursor = 0;
  let s = state;

  for (let tick = 0; tick < total; tick++) {
    if (cursor >= data.length || data[cursor] !== tick) {
      const r = step(s, noop, tick);
      if (r !== undefined) s = r;
    } else {
      while (cursor < data.length && data[cursor] === tick) {
        const r = step(s, data[cursor + 1] | 0, tick);
        if (r !== undefined) s = r;
        cursor += 2;
      }
    }
    if (onTick) onTick(s, tick);
    if (budget && tick % 4096 === 4095 && budget()) throw new Error('replay budget exhausted at tick ' + tick);
  }

  const snap = snapshot ? snapshot(s) : s;
  return { state: s, ticks: total, hash: snapshot ? stateHash(snap) : null, snapshot: snap };
}

// FNV-1a over 64 bits, carried as two uint32 words because JavaScript has no
// 64-bit integer arithmetic that is fast in every engine. The bytes are read
// little-endian whatever the machine is, so the same snapshot hashes the
// same on any CPU.
const FNV_OFFSET_HI = 0xcbf29ce4, FNV_OFFSET_LO = 0x84222325;
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

export function stateHash(snapshot) {
  const bytes = toBytes(snapshot);
  let hi = FNV_OFFSET_HI, lo = FNV_OFFSET_LO;
  for (let i = 0; i < bytes.length; i++) {
    lo = (lo ^ bytes[i]) >>> 0;
    // Multiply by the FNV prime 0x100000001b3. Both partial products stay
    // under 2 to the 53, so double arithmetic is exact here.
    const loP = lo * 0x1b3;
    const carry = Math.floor(loP / 4294967296);
    const newLo = loP >>> 0;
    hi = (hi * 0x1b3 + lo * 0x100 + carry) >>> 0;
    lo = newLo;
  }
  return [hi >>> 0, lo >>> 0];
}

// The fingerprint of a whole log: version, length, no-op value and every
// entry, folded into the same 64-bit hash. The board signs this, so an
// attached ghost log can be checked against the score it came with instead
// of being taken on trust.
export function logHash(log) {
  const head = [LOG_VERSION, log.ticks | 0, log.noop | 0, log.data.length >> 1];
  const buf = new Int32Array(head.length + log.data.length);
  buf.set(head, 0);
  buf.set(log.data.map((n) => n | 0), head.length);
  return hashHex(stateHash(buf));
}

export function hashHex(pair) {
  return (pair[0] >>> 0).toString(16).padStart(8, '0') + (pair[1] >>> 0).toString(16).padStart(8, '0');
}

export function hashEqual(a, b) {
  return (a[0] >>> 0) === (b[0] >>> 0) && (a[1] >>> 0) === (b[1] >>> 0);
}

function toBytes(snapshot) {
  if (snapshot instanceof Uint8Array) return snapshot;
  let view = snapshot;
  if (Array.isArray(snapshot)) view = Float64Array.from(snapshot);
  if (view instanceof ArrayBuffer) return new Uint8Array(view);
  if (!ArrayBuffer.isView(view)) throw new Error('snapshot must be a typed array, an ArrayBuffer or an array of numbers');
  const raw = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const width = view.BYTES_PER_ELEMENT || 1;
  if (LITTLE_ENDIAN || width === 1) return raw;
  const swapped = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += width) {
    for (let j = 0; j < width; j++) swapped[i + j] = raw[i + width - 1 - j];
  }
  return swapped;
}

// Where two logs first differ, in the terms a person can act on. Used when a
// replay disagrees with the run it came from and somebody has to find out
// which tick went wrong.
export function compare(a, b) {
  const da = a.data, db = b.data;
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i += 2) {
    if (da[i] !== db[i] || da[i + 1] !== db[i + 1]) {
      return {
        equal: false,
        index: i >> 1,
        tick: Math.min(da[i], db[i]),
        a: { tick: da[i], input: da[i + 1] },
        b: { tick: db[i], input: db[i + 1] },
        reason: 'entries differ',
      };
    }
  }
  if (da.length !== db.length) {
    const longer = da.length > db.length ? 'a' : 'b';
    return { equal: false, index: n >> 1, tick: (da.length > db.length ? da : db)[n], a: null, b: null, reason: `${longer} has ${Math.abs(da.length - db.length) >> 1} more entries` };
  }
  if (a.ticks !== b.ticks) return { equal: false, index: n >> 1, tick: Math.min(a.ticks, b.ticks), a: null, b: null, reason: `run lengths differ: ${a.ticks} and ${b.ticks}` };
  return { equal: true, index: -1, tick: -1, a: null, b: null, reason: 'identical' };
}

export default { LOG_VERSION, recorder, compact, validate, run, stateHash, logHash, hashHex, hashEqual, compare };
