// ===========================================================================
// Swarm Breaker - persistence
//
// Pure logic. No DOM rendering, no canvas, no network, no assets, no audio.
// The only host objects it touches are localStorage (defensively) and, if the
// caller asks for lifecycle binding, the page visibility events. It runs
// unchanged in a headless script, where storage simply reports as absent.
//
// WHAT THIS MODULE PROMISES
//
//   1. A run can be put down mid-thought and picked up exactly as it stood -
//      including balls still in the air, the angle that was aimed, and the
//      market book with every price and every open consignment.
//   2. Nothing it reads can make it throw. A corrupt, truncated, absent or
//      newer-than-this-build save all resolve to a report, never an exception.
//   3. Autosave never costs a frame. Nothing is serialised during play; the
//      work happens in idle time and backs off if it ever gets expensive.
//   4. A save moves between machines as one copy-pasteable string.
//
// ---------------------------------------------------------------------------
// OFFLINE PROGRESS: NOTHING ACCRUES, AND THAT IS THE FEATURE
// ---------------------------------------------------------------------------
//
// A closed tab earns nothing here. Not a reduced rate, not a capped bank, not
// a "welcome back" pile. The run resumes on the exact frame it was left on.
//
// The argument, because this is the kind of decision that gets quietly
// reversed later by someone who assumes it was an oversight:
//
// THE PREMISE FORBIDS IT. The whole game is one decision per turn: an angle.
// Nothing happens until the swarm is pointed. A closed tab has no angle, so
// there is no honest way to say what the swarm did while it was closed. Paying
// out for that interval is inventing a turn the player never took, and the
// number it pays is arbitrary by construction - there is no correct value,
// only a tuned one, which is another way of saying it is a lever for pacing
// rather than a reward for anything.
//
// IT IS A TIMER WEARING A GIFT'S CLOTHES. Any payout indexed to elapsed time
// makes the interval itself valuable, and the moment an interval is valuable
// the optimal move is to stop playing and come back later. A game whose best
// play is "close the tab" has been designed against itself. Everything worth
// having in this game is attached to a turn somebody took, and this module is
// not the place to open the one exception.
//
// IT REMOVES THE CLOCK PROBLEM ENTIRELY. A game that pays for elapsed time has
// to defend its clock, and defending a clock means choosing between punishing a
// player whose timezone changed and accepting an obvious exploit. There is no
// third option and there is no way to tell those two players apart from inside
// a browser tab. Owing nothing to the clock dissolves the question: rolling the
// system clock forward a decade buys precisely nothing, so no anti-cheat is
// needed and none is present. See describeAway() for the only place a clock
// reading is used at all, and note that it feeds a sentence, not a balance.
//
// SO WHAT IS THE GIFT? Fidelity. Most games in this shape make you replay the
// turn you were in the middle of, or quietly round your position down to the
// last clean checkpoint. This one does not. The save captures live balls with
// their velocities, the aim you were holding, the pickups still falling, the
// half-refilled market book, the powers hand you had been dealt and not yet
// chosen from. You lose nothing, which is a better gift than being handed
// something you did not earn - and unlike a payout, it is a promise the game
// can keep exactly rather than approximately.
//
// The welcome-back line says so out loud. It reports the absence as a fact and
// confirms that nothing was taken and nothing was fabricated. That honesty is
// the point of the feature, and it costs nothing to keep.
//
// If a future build ever does want a catch-up, offlineGrant() below is the one
// function that would have to change, and it is documented as deliberately
// empty rather than unimplemented.
//
// ---------------------------------------------------------------------------
// WIRING
//
//   import { createSave } from './src/save.js';
//
//   const persist = createSave({
//     capture: () => ({
//       run:    { depth: S.depth, balls: S.balls, gold: S.gold, power: S.power,
//                 gain: S.gain, dead: S.dead, origin: S.origin, aim: S.aim,
//                 rows: S.rows, drops: S.drops,
//                 live: S.live, firing: S.firing, queue: S.queue,
//                 fireT: S.fireT, dir: S.dir, nextOrigin: S.nextOrigin },
//       field:  { seed: fieldSeed },        // see THE SEED TRAP below
//       market: economy.save(marketState),  // strips cfg, which holds functions
//       powers: packPowers(powerState),     // see THE CACHE TRAP below
//     }),
//     restore: (data, info) => { ...rebuild S, market and powers from data... },
//     fingerprint: () => fieldFingerprint(depth => field.rowFor(depth)),
//   });
//
//   persist.load();          // once, before the first frame
//   persist.start();         // begins autosave and lifecycle binding
//   ...
//   persist.mark();          // at the end of every turn; free to call per frame
//
// THE SEED TRAP. createPatternSource() hashes whatever it is given, and the
// `seed` property it exposes is the hashed result, not the argument. Saving
// that property and feeding it back hashes it a second time and silently hands
// the player a different world with the same save file. Keep the raw argument
// and save that. The `fingerprint` option exists to catch this class of
// mistake: supply fieldFingerprint() and a mismatch is reported on load
// instead of being discovered forty depths later.
//
// THE CACHE TRAP. Two kinds of field must never be written to a save. Functions
// cannot survive JSON at all - the market state carries a `cfg` holding its hp
// and row callbacks, which is exactly why that module ships its own save()
// that strips them. And derived caches must be rebuilt rather than trusted,
// because a stale one restored over a newer build's rules is a bug that looks
// like a balance problem: drop the powers state's `derived` and `offerCache`
// and call its recompute() after restoring. Per-turn scratch (`turn`) is
// keepable and worth keeping - it is what makes a mid-turn resume exact.
//
// The codec silently drops functions wherever it finds them, so a caller that
// forgets is degraded rather than broken. It cannot rebuild them, though, so
// the caller still has to put them back.
//
// WHAT ELSE BELONGS IN A SAVE. Anything the game computes from a player's own
// past has to be in here or it silently resets every session and quietly stops
// being about the player. Per-run records, the running history any posted line
// is derived from, the highest depth ever reached - that last one in
// particular, because the market gates its reveals on it rather than on the
// current depth, so dropping it takes back tools that were already earned.
// ===========================================================================


// ===========================================================================
// SECTION 1 - storage that cannot throw
// ===========================================================================
// localStorage throws rather than returning null in several ordinary
// situations: Safari private browsing historically threw on every write, site
// data can be blocked by policy or extension, and a full origin throws
// QuotaExceededError. Access is funnelled through here so no other line in
// this file has to think about it.
//
// When real storage is unavailable the module keeps working against an
// in-memory map. Nothing persists across a reload, which is the honest
// outcome, but the game runs correctly, autosave stays silent instead of
// erroring, and export strings still work - so a player in a locked-down
// browser can still move a run to another machine by hand.

const MEM = new Map();

const memoryBackend = {
  kind: 'memory',
  get(k) { return MEM.has(k) ? MEM.get(k) : null; },
  set(k, v) { MEM.set(k, v); return true; },
  del(k) { MEM.delete(k); return true; },
};

let backend = null;
let backendNote = '';

function probeStorage() {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) {
      backendNote = 'no localStorage in this environment';
      return memoryBackend;
    }
    const probe = '__swarmbreaker_probe__';
    localStorage.setItem(probe, '1');
    const ok = localStorage.getItem(probe) === '1';
    localStorage.removeItem(probe);
    if (!ok) {
      backendNote = 'localStorage accepted a write but did not return it';
      return memoryBackend;
    }
    backendNote = '';
    return {
      kind: 'local',
      get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set(k, v) { localStorage.setItem(k, v); return true; },   // throws on quota, handled by the caller
      del(k) { try { localStorage.removeItem(k); } catch (e) {} return true; },
    };
  } catch (e) {
    backendNote = 'localStorage is blocked: ' + errText(e);
    return memoryBackend;
  }
}

function store() {
  if (backend === null) backend = probeStorage();
  return backend;
}

/** 'local' when writes persist, 'memory' when they do not. Never throws. */
export function storageKind() { return store().kind; }

/** Why storage fell back to memory, or '' when it did not. */
export function storageNote() { store(); return backendNote; }

function errText(e) {
  if (!e) return 'unknown';
  if (typeof e === 'string') return e;
  return String(e.message || e.name || e);
}

function readRaw(key) {
  try { return store().get(key); } catch (e) { return null; }
}

// Returns { ok, error }. A quota failure demotes to memory only after the
// caller has had a chance to free space, so this reports rather than decides.
function writeRaw(key, text) {
  try {
    store().set(key, text);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: errText(e), quota: isQuotaError(e) };
  }
}

function deleteRaw(key) {
  try { store().del(key); } catch (e) {}
}

function isQuotaError(e) {
  if (!e) return false;
  const n = String(e.name || '');
  return n === 'QuotaExceededError' || n === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014;
}


// ===========================================================================
// SECTION 2 - the value codec
// ===========================================================================
// Plain JSON of raw floats does not survive this game, for three separate
// reasons, and all three are silent corruption rather than a visible failure:
//
//   * MAGNITUDES. Damage, essence, block health and swarm count are stored as
//     {m, e} mantissa/exponent pairs precisely because they outgrow a float.
//     Those pairs are JSON-safe but enormously wasteful written out longhand -
//     a market state carries several hundred of them across its books, its
//     inventory and its price history, at about twenty bytes each. They are
//     packed to a short tagged string instead, and zero, which is by far the
//     most common value in a fresh state, packs to two characters.
//
//   * NON-FINITE NUMBERS. JSON.stringify turns Infinity and NaN into null, and
//     null read back as a number is zero. A saturated intermediate value would
//     therefore reload as nothing at all, which is not a rounding error but a
//     wiped balance. Both are tagged and round-trip exactly.
//
//   * FUNCTIONS. JSON drops them without complaint, so a state object holding
//     a callback reloads as a state object that looks fine until something
//     calls it. They are dropped here too, but deliberately and documented, so
//     the caller knows the contract rather than discovering it.
//
// The scheme is a string sigil. Any encoded string beginning with '~' is a tag;
// any genuine string that happens to begin with '~' is escaped by doubling it,
// so the two can never be confused. Unknown tags decode to themselves rather
// than throwing, which is what lets a save written by a newer build survive
// this one reading it.
//
// Integers past 2^53 still lose precision through JSON. That is already true
// of them in memory, which is why the magnitude layer exists, and nothing here
// can improve on it.

const TAG = '~';
const T_INF = '~I';
const T_NEGINF = '~i';
const T_NAN = '~N';
const T_UNDEF = '~u';
const T_CYCLE = '~c';
const T_ZERO = '~z';
const OMIT = { omit: true };
const MAX_DEPTH = 96;

function isMagnitude(o) {
  if (typeof o.m !== 'number' || typeof o.e !== 'number') return false;
  if (!isFinite(o.m) || !isFinite(o.e)) return false;
  let n = 0;
  for (const k in o) {
    if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
    if (k !== 'm' && k !== 'e') return false;
    n++;
  }
  return n === 2;
}

function encodeAny(value, seen, depth) {
  const t = typeof value;

  if (value === null) return null;
  if (t === 'boolean') return value;
  if (t === 'string') return value.charCodeAt(0) === 126 ? TAG + value : value;
  if (t === 'undefined') return T_UNDEF;
  if (t === 'bigint') return '~b' + value.toString();
  if (t === 'function' || t === 'symbol') return OMIT;

  if (t === 'number') {
    if (Number.isFinite(value)) return value === 0 ? 0 : value;   // folds -0 to 0
    if (value === Infinity) return T_INF;
    if (value === -Infinity) return T_NEGINF;
    return T_NAN;
  }

  if (t !== 'object') return OMIT;

  // A cycle or a pathological nest reports itself rather than hanging or
  // overflowing the stack. Neither should occur in game state; both have
  // occurred in every codebase that assumed they would not.
  if (depth > MAX_DEPTH) return T_CYCLE;
  if (seen.has(value)) return T_CYCLE;

  if (value instanceof Date) {
    const ms = value.getTime();
    return '~d' + (Number.isFinite(ms) ? ms : 0);
  }

  if (isMagnitude(value)) {
    if (value.m === 0) return T_ZERO;
    return '~L' + value.m + '|' + value.e;
  }

  seen.add(value);
  let out;
  try {
    if (Array.isArray(value)) {
      out = new Array(value.length);
      for (let i = 0; i < value.length; i++) {
        const enc = encodeAny(value[i], seen, depth + 1);
        // A hole in an array cannot be dropped without shifting every index
        // after it, so an unencodable element becomes null instead.
        out[i] = enc === OMIT ? null : enc;
      }
    } else if (value instanceof Map) {
      const entries = [];
      value.forEach((v, k) => {
        const ek = encodeAny(k, seen, depth + 1);
        const ev = encodeAny(v, seen, depth + 1);
        if (ek !== OMIT && ev !== OMIT) entries.push([ek, ev]);
      });
      out = ['~M', entries];
    } else if (value instanceof Set) {
      const items = [];
      value.forEach(v => {
        const ev = encodeAny(v, seen, depth + 1);
        if (ev !== OMIT) items.push(ev);
      });
      out = ['~S', items];
    } else {
      out = {};
      for (const k in value) {
        if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
        const enc = encodeAny(value[k], seen, depth + 1);
        if (enc === OMIT) continue;                 // functions leave no trace
        out[k] = enc;
      }
    }
  } finally {
    seen.delete(value);
  }
  return out;
}

function decodeAny(value) {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'boolean' || t === 'number') return value;

  if (t === 'string') {
    if (value.charCodeAt(0) !== 126) return value;          // not a tag
    if (value.charCodeAt(1) === 126) return value.slice(1); // escaped literal
    switch (value) {
      case T_INF: return Infinity;
      case T_NEGINF: return -Infinity;
      case T_NAN: return NaN;
      case T_UNDEF: return undefined;
      case T_CYCLE: return null;
      case T_ZERO: return { m: 0, e: 0 };
      default: break;
    }
    const kind = value.charCodeAt(1);
    if (kind === 76) {                                       // '~L' magnitude
      const bar = value.indexOf('|', 2);
      if (bar < 0) return { m: 0, e: 0 };
      const m = parseFloat(value.slice(2, bar));
      const e = parseInt(value.slice(bar + 1), 10);
      if (!isFinite(m) || !isFinite(e)) return { m: 0, e: 0 };
      return { m, e };
    }
    if (kind === 100) {                                      // '~d' date
      const ms = parseInt(value.slice(2), 10);
      return new Date(isFinite(ms) ? ms : 0);
    }
    if (kind === 98) {                                       // '~b' bigint
      try { return BigInt(value.slice(2)); } catch (e) { return 0; }
    }
    // An unknown tag came from a build this one has never met. Handing back
    // the raw string keeps the save loadable and keeps the unknown field
    // intact for whatever build does understand it.
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 2 && value[0] === '~M') {
      const m = new Map();
      const entries = Array.isArray(value[1]) ? value[1] : [];
      for (const pair of entries) {
        if (!Array.isArray(pair) || pair.length !== 2) continue;
        m.set(decodeAny(pair[0]), decodeAny(pair[1]));
      }
      return m;
    }
    if (value.length === 2 && value[0] === '~S') {
      const s = new Set();
      const items = Array.isArray(value[1]) ? value[1] : [];
      for (const it of items) s.add(decodeAny(it));
      return s;
    }
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = decodeAny(value[i]);
    return out;
  }

  if (t === 'object') {
    const out = {};
    for (const k in value) {
      if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
      out[k] = decodeAny(value[k]);
    }
    return out;
  }

  return null;
}

/** Convert live state into a JSON-safe tree. Never throws; never mutates the input. */
export function encodeState(state) {
  const enc = encodeAny(state, new Set(), 0);
  return enc === OMIT ? null : enc;
}

/** Inverse of encodeState. Unknown tags survive as their raw strings. */
export function decodeState(tree) {
  return decodeAny(tree);
}


// ===========================================================================
// SECTION 3 - bytes, checksums and compression
// ===========================================================================
// Only the portable export string is compressed. The autosave path writes
// plain JSON, because compression there would put real work on a budget that
// is supposed to be invisible, and localStorage has room to spare for a state
// this size. Exports are rare and user-initiated, so they can afford it, and
// the length of the string is the thing a person actually has to handle.

function utf8Encode(text) {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text);
  const out = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00); i++; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

function utf8Decode(bytes) {
  if (typeof TextDecoder === 'function') return new TextDecoder().decode(bytes);
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++];
    let c;
    if (b < 0x80) c = b;
    else if (b < 0xe0) c = ((b & 31) << 6) | (bytes[i++] & 63);
    else if (b < 0xf0) c = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else c = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    if (c > 0xffff) {
      c -= 0x10000;
      out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023));
    } else out += String.fromCharCode(c);
  }
  return out;
}

/** FNV-1a, 32 bit. Not a security function - it is here to catch a truncated paste. */
function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64REV = (() => {
  const m = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) m[B64.charCodeAt(i)] = i;
  m['+'.charCodeAt(0)] = 62;   // tolerate standard base64 arriving from elsewhere
  m['/'.charCodeAt(0)] = 63;
  return m;
})();

function b64Encode(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63];
  }
  return out;
}

function b64Decode(text) {
  const vals = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 61) continue;                      // '=' padding, ignored
    if (c > 127) continue;
    const v = B64REV[c];
    if (v >= 0) vals.push(v);
  }
  const full = (vals.length >> 2) * 3;
  const rem = vals.length & 3;
  const extra = rem === 2 ? 1 : rem === 3 ? 2 : 0;
  const out = new Uint8Array(full + extra);
  let o = 0, i = 0;
  for (; i + 3 < vals.length; i += 4) {
    const n = (vals[i] << 18) | (vals[i + 1] << 12) | (vals[i + 2] << 6) | vals[i + 3];
    out[o++] = (n >> 16) & 255; out[o++] = (n >> 8) & 255; out[o++] = n & 255;
  }
  if (rem === 2) out[o++] = ((vals[i] << 18) | (vals[i + 1] << 12)) >> 16 & 255;
  else if (rem === 3) {
    const n = (vals[i] << 18) | (vals[i + 1] << 12) | (vals[i + 2] << 6);
    out[o++] = (n >> 16) & 255; out[o++] = (n >> 8) & 255;
  }
  return out;
}

// LZSS. Chosen over the usual dictionary coder because its decoder is correct
// by inspection - there is no shared table for the two halves to disagree
// about, which is the failure mode that turns a save into noise. A group is
// one flag byte followed by eight items; a clear flag bit is a literal byte, a
// set one is a two byte back reference carrying a 12 bit offset and a 4 bit
// length. JSON of this shape typically comes out between a third and a half of
// its original size, which more than pays for the third that base64 adds back.
const LZ_WINDOW = 4096;
const LZ_MIN = 3;
const LZ_MAX = 18;
const LZ_CHAIN = 48;

function lzssCompress(src) {
  const out = [];
  const heads = new Map();
  const prevAt = new Int32Array(src.length).fill(-1);
  let flagIndex = -1, flagBit = 0, flags = 0;

  const pushFlag = (bit) => {
    if (flagBit === 0) { flagIndex = out.length; out.push(0); flags = 0; }
    if (bit) flags |= (1 << flagBit);
    out[flagIndex] = flags;                     // kept correct mid-group
    flagBit = (flagBit + 1) & 7;
  };

  const indexAt = (p) => {
    if (p + LZ_MIN > src.length) return;
    const key = (src[p] << 16) | (src[p + 1] << 8) | src[p + 2];
    const prior = heads.has(key) ? heads.get(key) : -1;
    prevAt[p] = prior;
    heads.set(key, p);
  };

  let i = 0;
  while (i < src.length) {
    let bestLen = 0, bestOff = 0;
    if (i + LZ_MIN <= src.length) {
      const key = (src[i] << 16) | (src[i + 1] << 8) | src[i + 2];
      let cand = heads.has(key) ? heads.get(key) : -1;
      let tries = 0;
      const cap = Math.min(LZ_MAX, src.length - i);
      while (cand >= 0 && i - cand <= LZ_WINDOW && tries < LZ_CHAIN) {
        let len = 0;
        while (len < cap && src[cand + len] === src[i + len]) len++;
        if (len > bestLen) { bestLen = len; bestOff = i - cand; if (len === cap) break; }
        cand = prevAt[cand];
        tries++;
      }
    }
    if (bestLen >= LZ_MIN) {
      pushFlag(1);
      const off = bestOff - 1;              // 0..4095
      const ln = bestLen - LZ_MIN;          // 0..15
      out.push(off & 255, ((off >> 8) & 15) | (ln << 4));
      for (let k = 0; k < bestLen; k++) indexAt(i + k);
      i += bestLen;
    } else {
      pushFlag(0);
      out.push(src[i]);
      indexAt(i);
      i += 1;
    }
  }
  return Uint8Array.from(out);
}

function lzssDecompress(src) {
  const out = [];
  let i = 0, flags = 0, bit = 8;
  while (i < src.length) {
    if (bit === 8) {
      flags = src[i++];
      bit = 0;
      if (i >= src.length) break;
    }
    const isMatch = (flags >> bit) & 1;
    bit++;
    if (!isMatch) {
      out.push(src[i++]);
    } else {
      if (i + 1 >= src.length) break;
      const b0 = src[i++], b1 = src[i++];
      const off = (b0 | ((b1 & 15) << 8)) + 1;
      const len = (b1 >> 4) + LZ_MIN;
      let p = out.length - off;
      if (p < 0) throw new Error('back reference before the start of the stream');
      for (let k = 0; k < len; k++) out.push(out[p + k]);
    }
  }
  return Uint8Array.from(out);
}


// ===========================================================================
// SECTION 4 - the envelope, the schema and migration
// ===========================================================================
// The game is going to change under saves that already exist, so the shape is
// versioned from the first release rather than from the first time it hurts.
//
// An envelope is deliberately tiny and deliberately not the state:
//
//   v  schema version of the payload
//   t  wall clock at the moment of writing, for the welcome-back line only
//   n  write serial, which only ever increases and never consults the clock
//   p  accumulated play time in milliseconds, measured from frame deltas
//   f  optional field fingerprint, to catch a world that quietly changed
//   d  the encoded state
//
// `n` exists because `t` cannot be trusted to order two saves. A machine whose
// clock was wrong when one of them was written would otherwise resolve the
// wrong way round. The serial is monotonic per lineage and is what decides
// which of two candidates is newer.
//
// MIGRATION. Each step takes decoded state at version `from` and returns
// decoded state at version `to`, and the loader walks the chain until it
// arrives at the current version. Steps run on decoded values, so a migration
// author sees real magnitudes and real numbers rather than tagged strings.
//
// A worked example of what an entry looks like, for whoever writes the first
// real one. Suppose version 2 splits the prototype's single `gold` field into
// a cash balance and a material inventory:
//
//   registerMigration(1, 2, (data) => {
//     const run = data.run || {};
//     return {
//       ...data,
//       run: { ...run, gold: undefined },
//       market: { essence: { m: run.gold || 0, e: 0 }, held: {} },
//     };
//   });
//
// Two rules for those functions. Never throw - return the input unchanged if
// the shape is not what was expected, because a save that arrives half-broken
// is still better than a save that refuses to open. And never drop a field you
// do not recognise: unknown keys are carried forward untouched, which is what
// lets a save round-trip through an older build without losing the parts that
// build has never heard of.

export const SCHEMA = 1;

const MIGRATIONS = new Map();
let currentVersion = SCHEMA;

/** Register a migration step. Raises the current schema version to `to`. */
export function registerMigration(from, to, fn) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || typeof fn !== 'function') return false;
  MIGRATIONS.set(from, { to, fn });
  if (to > currentVersion) currentVersion = to;
  return true;
}

/** The version this build writes. Moves when a migration is registered. */
export function currentSchema() { return currentVersion; }

function migrate(data, fromVersion) {
  const notes = [];
  let v = fromVersion;
  let out = data;
  let guard = 0;

  if (v > currentVersion) {
    // A newer build wrote this. Everything this build understands is still
    // sitting in it, so it is read rather than refused, and the untouched
    // original is kept aside so nothing is lost when this build saves over it.
    notes.push('written by a newer build (schema ' + v + ', this build reads ' + currentVersion + ')');
    return { data: out, version: v, notes, future: true, complete: false };
  }

  while (v < currentVersion && guard++ < 64) {
    const step = MIGRATIONS.get(v);
    if (!step) {
      notes.push('no migration from schema ' + v + '; loaded as far as it goes');
      return { data: out, version: v, notes, future: false, complete: false };
    }
    try {
      const next = step.fn(out, v);
      if (next !== undefined && next !== null) out = next;
      notes.push('migrated ' + v + ' to ' + step.to);
      v = step.to;
    } catch (e) {
      notes.push('migration ' + v + ' to ' + step.to + ' failed: ' + errText(e));
      return { data: out, version: v, notes, future: false, complete: false };
    }
  }

  return { data: out, version: v, notes, future: false, complete: v === currentVersion };
}


// ===========================================================================
// SECTION 5 - serialise, deserialise, and the storage slots
// ===========================================================================
// Three slots per key, and the two extras exist because losing a run to a
// mechanical accident is unacceptable in a way that losing one to a block
// reaching the swarm line is not.
//
//   <key>          the live save
//   <key>.prev     the save before it, in case a write was interrupted
//   <key>.kept     an untouched copy of anything that could not be read
//                  cleanly, so a later build can still recover it
//
// The stored form carries its own magic and checksum. localStorage rarely
// truncates, but a corrupted profile, an extension writing to the same key or
// a quota failure caught halfway are all real, and a checksum turns a silent
// wrong answer into a clean fall back to the previous slot.

const MAGIC = 'SWB';

/** Build the stored text for a state. Never throws; returns null if it cannot. */
export function serialize(state, meta) {
  meta = meta || {};
  try {
    const env = {
      v: Number.isFinite(meta.version) ? meta.version : currentVersion,
      t: Number.isFinite(meta.savedAt) ? meta.savedAt : Date.now(),
      n: Number.isFinite(meta.serial) ? meta.serial : 0,
      p: Number.isFinite(meta.playMs) ? Math.round(meta.playMs) : 0,
      f: meta.fingerprint == null ? null : String(meta.fingerprint),
      d: encodeState(state),
    };
    const json = JSON.stringify(env);
    if (typeof json !== 'string') return null;
    const sum = fnv1a(utf8Encode(json)).toString(16).padStart(8, '0');
    return MAGIC + ':' + sum + ':' + json;
  } catch (e) {
    return null;
  }
}

/**
 * Read stored text back. Always returns a report:
 *   { ok, env, state, error, checksum }
 * where `env` carries the metadata and `state` is decoded but not migrated.
 */
export function deserialize(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { ok: false, error: 'empty', env: null, state: null, checksum: null };
  }
  let json = text;
  let checksum = null;
  if (text.startsWith(MAGIC + ':')) {
    const a = text.indexOf(':');
    const b = text.indexOf(':', a + 1);
    if (b < 0) return { ok: false, error: 'truncated header', env: null, state: null, checksum: null };
    const claimed = text.slice(a + 1, b);
    json = text.slice(b + 1);
    const actual = fnv1a(utf8Encode(json)).toString(16).padStart(8, '0');
    // A mismatch is reported rather than acted on. It usually means truncation,
    // in which case the parse below fails anyway and the backup slot takes
    // over - but if the payload does still parse, a slightly damaged run beats
    // no run, so the caller is handed checksum:false and decides for itself.
    checksum = actual === claimed;
  }

  let env;
  try {
    env = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: 'not valid JSON: ' + errText(e), env: null, state: null, checksum };
  }
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return { ok: false, error: 'envelope is not an object', env: null, state: null, checksum };
  }
  if (!Number.isFinite(env.v)) {
    return { ok: false, error: 'envelope has no schema version', env: null, state: null, checksum };
  }
  if (!('d' in env) || env.d === null || typeof env.d !== 'object') {
    return { ok: false, error: 'envelope carries no state', env: null, state: null, checksum };
  }

  let state;
  try {
    state = decodeState(env.d);
  } catch (e) {
    return { ok: false, error: 'state did not decode: ' + errText(e), env, state: null, checksum };
  }
  if (state === null || typeof state !== 'object') {
    return { ok: false, error: 'state is not an object', env, state: null, checksum };
  }

  return { ok: true, error: null, env, state, checksum };
}

const slotPrev = key => key + '.prev';
const slotKept = key => key + '.kept';

/** True when something is stored under this key. Never throws. */
export function hasSave(key) {
  return typeof readRaw(key) === 'string' || typeof readRaw(slotPrev(key)) === 'string';
}

/**
 * Load, verify, migrate. Always returns a report and never throws:
 *
 *   { found, ok, state, version, serial, savedAt, playMs, fingerprint,
 *     away, notes, migrated, future, degraded, slot, error }
 *
 * `found:false` with `ok:false` is the ordinary first-run answer, not an error.
 */
export function readSave(key, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  const notes = [];
  const candidates = [
    { slot: 'main', text: readRaw(key) },
    { slot: 'prev', text: readRaw(slotPrev(key)) },
  ].filter(c => typeof c.text === 'string' && c.text.length > 0);

  if (candidates.length === 0) {
    return blankReport(at, 'nothing stored');
  }

  let firstError = null;
  for (const cand of candidates) {
    const parsed = deserialize(cand.text);
    if (!parsed.ok) {
      if (firstError === null) firstError = parsed.error;
      notes.push('the ' + cand.slot + ' slot did not read: ' + parsed.error);
      continue;
    }
    if (parsed.checksum === false) notes.push('checksum did not match; the save may be slightly damaged');
    if (cand.slot === 'prev') notes.push('recovered from the backup slot; the most recent write did not survive');

    const m = migrate(parsed.state, parsed.env.v);
    for (const n of m.notes) notes.push(n);

    if (m.future || !m.complete) {
      // Keep the bytes exactly as they arrived. Whatever build understands
      // them can still have them after this one has saved over the main slot.
      if (readRaw(slotKept(key)) === null) writeRaw(slotKept(key), cand.text);
    }

    return {
      found: true,
      ok: true,
      state: m.data,
      version: m.version,
      serial: Number.isFinite(parsed.env.n) ? parsed.env.n : 0,
      savedAt: Number.isFinite(parsed.env.t) ? parsed.env.t : null,
      playMs: Number.isFinite(parsed.env.p) ? parsed.env.p : 0,
      fingerprint: parsed.env.f == null ? null : String(parsed.env.f),
      away: describeAway(parsed.env.t, at),
      notes,
      migrated: m.notes.length > 0 && m.complete,
      future: m.future,
      degraded: m.future || !m.complete || parsed.checksum === false,
      slot: cand.slot,
      error: null,
    };
  }

  // Something was stored and none of it was readable. Keep it rather than
  // silently writing over it, and start fresh.
  if (readRaw(slotKept(key)) === null && candidates.length > 0) {
    writeRaw(slotKept(key), candidates[0].text);
    notes.push('the unreadable save was set aside rather than discarded');
  }
  const report = blankReport(at, firstError || 'unreadable');
  report.found = true;
  report.notes = notes;
  return report;
}

function blankReport(at, error) {
  return {
    found: false, ok: false, state: null, version: currentVersion,
    serial: 0, savedAt: null, playMs: 0, fingerprint: null,
    away: describeAway(null, at),
    notes: [], migrated: false, future: false, degraded: false,
    slot: null, error,
  };
}

/**
 * Write a state. Rotates the live save into the backup slot first, so an
 * interrupted or rejected write can never leave the key with nothing in it.
 * Returns { ok, bytes, error, quota, demoted }.
 */
export function writeSave(key, state, meta) {
  const text = serialize(state, meta);
  if (text === null) {
    return { ok: false, bytes: 0, error: 'state could not be serialised', quota: false, demoted: false };
  }
  return writeText(key, text, meta);
}

function writeText(key, text, meta) {
  const previous = readRaw(key);
  if (typeof previous === 'string' && previous !== text) writeRaw(slotPrev(key), previous);

  let res = writeRaw(key, text);
  if (res.ok) return { ok: true, bytes: text.length, error: null, quota: false, demoted: false };

  if (res.quota) {
    // Give up the backup before giving up the save. The backup exists to guard
    // against an interrupted write; the live save is the run.
    deleteRaw(slotPrev(key));
    deleteRaw(slotKept(key));
    res = writeRaw(key, text);
    if (res.ok) {
      return { ok: true, bytes: text.length, error: null, quota: true, demoted: false };
    }
    if (meta && typeof meta.shrink === 'function') {
      try {
        const smaller = serialize(meta.shrink(), meta);
        if (smaller !== null) {
          res = writeRaw(key, smaller);
          if (res.ok) return { ok: true, bytes: smaller.length, error: null, quota: true, demoted: false };
        }
      } catch (e) { /* the shrink hook is best effort */ }
    }
  }

  // Storage is refusing writes. Fall back to memory so the rest of the session
  // still behaves - autosave stops erroring, and the export string still works,
  // which is how a run gets off a browser that will not store anything.
  backend = memoryBackend;
  backendNote = 'storage refused a write: ' + res.error;
  const mem = writeRaw(key, text);
  return { ok: mem.ok, bytes: text.length, error: res.error, quota: !!res.quota, demoted: true };
}

/** Remove every slot for a key. Never throws. */
export function clearSave(key) {
  deleteRaw(key);
  deleteRaw(slotPrev(key));
  deleteRaw(slotKept(key));
}

/** Bytes currently held across all slots for a key. */
export function saveBytes(key) {
  let n = 0;
  for (const k of [key, slotPrev(key), slotKept(key)]) {
    const t = readRaw(k);
    if (typeof t === 'string') n += t.length;
  }
  return n;
}


// ===========================================================================
// SECTION 6 - the portable string
// ===========================================================================
// One token, no spaces, safe in a URL, safe in a text field, safe through an
// email client that rewraps it - import strips every whitespace character
// before it looks at anything, so a string broken across five lines still
// imports. Case is preserved because base64 needs it; the prefix is matched
// case insensitively because people retype prefixes.
//
// Layout of the decoded bytes:
//   [0]      format: 0 plain, 1 compressed
//   [1..4]   FNV-1a of the uncompressed payload, big endian
//   [5..]    payload
//
// The compressor is verified in place: the string is decompressed and compared
// against the input before it is handed out, and anything short of an exact
// match falls back to the uncompressed form. A compression bug can therefore
// cost size and never a save.

const EXPORT_PREFIX = 'SWB1.';

/** Turn a state into a copy-pasteable string. Returns null only if it cannot serialise. */
export function exportSave(state, meta) {
  const text = serialize(state, meta);
  if (text === null) return null;
  return packExport(text);
}

/** Turn already-stored text into a copy-pasteable string. */
export function exportText(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  return packExport(text);
}

function packExport(text) {
  const plain = utf8Encode(text);
  const sum = fnv1a(plain);

  let format = 0;
  let payload = plain;
  try {
    const packed = lzssCompress(plain);
    if (packed.length < plain.length) {
      const check = lzssDecompress(packed);
      let same = check.length === plain.length;
      if (same) {
        for (let i = 0; i < plain.length; i++) {
          if (check[i] !== plain[i]) { same = false; break; }
        }
      }
      if (same) { format = 1; payload = packed; }
    }
  } catch (e) {
    format = 0;
    payload = plain;
  }

  const out = new Uint8Array(5 + payload.length);
  out[0] = format;
  out[1] = (sum >>> 24) & 255;
  out[2] = (sum >>> 16) & 255;
  out[3] = (sum >>> 8) & 255;
  out[4] = sum & 255;
  out.set(payload, 5);
  return EXPORT_PREFIX + b64Encode(out);
}

/**
 * Validate and unpack a pasted string. Always returns a report:
 *   { ok, state, env, text, version, savedAt, serial, playMs, fingerprint,
 *     away, notes, migrated, future, degraded, error }
 * Every failure is named in `error` in terms a player can act on.
 */
export function importSave(input, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  const fail = (error) => {
    const r = blankReport(at, error);
    r.text = null;
    r.env = null;
    return r;
  };

  if (typeof input !== 'string') return fail('nothing to import');
  const cleaned = input.replace(/\s+/g, '');
  if (cleaned.length === 0) return fail('nothing to import');

  const head = cleaned.slice(0, EXPORT_PREFIX.length);
  if (head.toUpperCase() !== EXPORT_PREFIX.toUpperCase()) {
    return fail('that does not look like a Swarm Breaker save - it should start with ' + EXPORT_PREFIX);
  }
  const body = cleaned.slice(EXPORT_PREFIX.length);
  if (body.length === 0) return fail('the save string is empty after its prefix');

  let bytes;
  try {
    bytes = b64Decode(body);
  } catch (e) {
    return fail('the save string is not readable: ' + errText(e));
  }
  if (bytes.length < 6) return fail('the save string is too short to be complete');

  const format = bytes[0];
  const claimed = ((bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4]) >>> 0;
  const payload = bytes.subarray(5);

  let plain;
  if (format === 1) {
    try {
      plain = lzssDecompress(payload);
    } catch (e) {
      return fail('the save string is damaged or was cut short');
    }
  } else if (format === 0) {
    plain = payload;
  } else {
    return fail('the save string uses a format this build does not know (' + format + ')');
  }

  if (fnv1a(plain) !== claimed) {
    return fail('the save string failed its checksum - it was probably truncated in transit');
  }

  let text;
  try {
    text = utf8Decode(plain);
  } catch (e) {
    return fail('the save string is not readable text');
  }

  const parsed = deserialize(text);
  if (!parsed.ok) return fail('the save string unpacked but its contents did not read: ' + parsed.error);

  const m = migrate(parsed.state, parsed.env.v);
  const notes = m.notes.slice();
  if (parsed.checksum === false) notes.push('inner checksum did not match; the save may be slightly damaged');

  return {
    found: true,
    ok: true,
    state: m.data,
    env: parsed.env,
    text,
    version: m.version,
    serial: Number.isFinite(parsed.env.n) ? parsed.env.n : 0,
    savedAt: Number.isFinite(parsed.env.t) ? parsed.env.t : null,
    playMs: Number.isFinite(parsed.env.p) ? parsed.env.p : 0,
    fingerprint: parsed.env.f == null ? null : String(parsed.env.f),
    away: describeAway(parsed.env.t, at),
    notes,
    migrated: m.notes.length > 0 && m.complete,
    future: m.future,
    degraded: m.future || !m.complete || parsed.checksum === false,
    slot: 'import',
    error: null,
  };
}


// ===========================================================================
// SECTION 7 - time away
// ===========================================================================
// The only reading of the wall clock in this module, and it produces a
// sentence rather than a balance. Read the argument at the top of the file
// before adding anything to it.

const MINUTE = 60000;
const HOUR = 3600000;
const DAY = 86400000;

/**
 * How long the tab was closed, described rather than valued.
 *
 *   { ms, text, clockSkew, unknown, grant }
 *
 * `ms` is null when it cannot be known. `clockSkew` is true when the clock
 * appears to have moved backwards since the save - which is a timezone change,
 * a daylight saving boundary, a clock correction or a deliberately altered
 * system clock, and there is no way to tell those apart from in here. Since
 * nothing is paid for elapsed time, all four produce the same outcome: the
 * player is told the interval is unclear, and loses nothing either way. That
 * is the whole of the clock policy, and it is why no anti-cheat exists here.
 */
export function describeAway(savedAt, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  if (!Number.isFinite(savedAt) || savedAt <= 0) {
    return { ms: null, text: 'a first run', clockSkew: false, unknown: true, grant: null };
  }
  const raw = at - savedAt;
  if (raw < -MINUTE) {
    return { ms: 0, text: 'an unclear stretch', clockSkew: true, unknown: true, grant: null };
  }
  const ms = Math.max(0, raw);
  return { ms, text: awayText(ms), clockSkew: false, unknown: false, grant: null };
}

function awayText(ms) {
  if (ms < 45000) return 'a moment';
  if (ms < HOUR) {
    const n = Math.round(ms / MINUTE);
    return n + (n === 1 ? ' minute' : ' minutes');
  }
  if (ms < DAY) {
    const n = Math.round(ms / HOUR);
    return n + (n === 1 ? ' hour' : ' hours');
  }
  if (ms < 60 * DAY) {
    const n = Math.round(ms / DAY);
    return n + (n === 1 ? ' day' : ' days');
  }
  return 'a long time';
}

/**
 * What the game accrued while it was closed. Nothing, on purpose.
 *
 * This is not a stub and it is not waiting to be filled in. Nothing happens in
 * this game until the swarm is pointed somewhere, so there is no honest answer
 * to what it did unpointed, and any number invented here would make the closed
 * tab worth something - which would make closing the tab a move. The whole
 * argument is at the top of the file.
 *
 * It has a name and a return value so that the decision is visible in the code
 * rather than implied by an absence, and so that anything reversing it has one
 * function to change and one comment to answer.
 */
export function offlineGrant() {
  return null;
}

/**
 * The welcome-back line. Two parts so a caller can lay them out however it
 * likes, and both are true statements rather than celebrations.
 */
export function welcome(report) {
  if (!report || !report.found || !report.ok) {
    return { headline: null, detail: null };
  }
  const away = report.away || describeAway(report.savedAt);
  if (away.unknown && away.clockSkew) {
    return {
      headline: 'the run is where you left it',
      detail: 'the clock moved while you were away, so the gap is unclear. Nothing turns on it - nothing accrues here.',
    };
  }
  if (away.unknown || away.ms < 45000) {
    return { headline: 'the run is where you left it', detail: 'exactly where you left it.' };
  }
  return {
    headline: 'away ' + away.text,
    detail: 'nothing accrued and nothing was lost - the swarm held its position, mid-flight and all.',
  };
}


// ===========================================================================
// SECTION 8 - a field fingerprint
// ===========================================================================
// The field is generated from a seed rather than authored, which means a save
// that restores the wrong seed does not fail - it hands back a different world
// wearing the right numbers, and that is only noticed much later. A short hash
// of a few rows, written into the save and compared on load, turns that into a
// line in the load report.

/**
 * Hash a handful of generated rows. `rowFor` is the pattern source's own
 * rowFor. Cheap enough to call on every save; the sample is fixed so two
 * builds of the same field always agree.
 */
export function fieldFingerprint(rowFor, depths) {
  const sample = Array.isArray(depths) && depths.length ? depths : [1, 2, 3, 7, 13, 29, 61];
  let h = 0x811c9dc5;
  try {
    for (const d of sample) {
      const row = rowFor(d);
      h ^= d & 255; h = Math.imul(h, 0x01000193);
      if (!row || typeof row.length !== 'number') continue;
      for (let i = 0; i < row.length; i++) {
        h ^= row[i] ? 1 : 0;
        h = Math.imul(h, 0x01000193);
      }
    }
  } catch (e) {
    return '';
  }
  return (h >>> 0).toString(36);
}


// ===========================================================================
// SECTION 9 - the autosave engine
// ===========================================================================
// The requirement is that autosave never costs a frame, which rules out doing
// any of the work during play. Three things follow from it:
//
//   * mark() does nothing but set a boolean. It is safe to call every frame,
//     every hit, or every turn - whichever is convenient at the call site.
//   * capture and serialisation both happen inside an idle callback, so the
//     cost lands in whatever the browser has left over rather than in the
//     frame that asked for it. Where requestIdleCallback is missing it falls
//     back to a macrotask, which is still off the render path.
//   * the interval backs itself off if a write is ever expensive. A run deep
//     enough to have a large market history writes less often than a fresh
//     one, automatically, and nobody has to tune a constant for it.
//
// The one place a synchronous write is correct is when the page is going away.
// visibilitychange and pagehide are used rather than beforeunload, because
// beforeunload does not fire reliably on mobile, and a phone backgrounding the
// tab is the single most likely way this game gets closed.

const DEFAULTS = {
  key: 'swarmbreaker.save',
  intervalMs: 8000,
  maxIntervalMs: 60000,
  idleTimeoutMs: 2000,
  budgetMs: 4,
  bindLifecycle: true,
};

function idleCall(fn, timeout) {
  if (typeof requestIdleCallback === 'function') {
    return { kind: 'idle', id: requestIdleCallback(fn, { timeout }) };
  }
  const id = setTimeout(() => fn({ timeRemaining: () => 8, didTimeout: true }), 0);
  return { kind: 'timeout', id };
}

function cancelIdle(handle) {
  if (!handle) return;
  if (handle.kind === 'idle' && typeof cancelIdleCallback === 'function') cancelIdleCallback(handle.id);
  else if (handle.kind === 'timeout') clearTimeout(handle.id);
}

/**
 * Build a persistence engine around a run.
 *
 * config:
 *   key           storage key, default 'swarmbreaker.save'
 *   capture       () => plain state object. Called only when a write happens.
 *   restore       (state, report) => void. Called by load() when there is one.
 *   fingerprint   optional () => string, compared on load
 *   shrink        optional () => smaller state, tried only if storage is full
 *   onError       optional (info) => void, for anything worth surfacing
 *   intervalMs    minimum gap between writes, default 8000
 *   maxIntervalMs ceiling the backoff will not pass, default 60000
 *   budgetMs      a write slower than this widens the interval, default 4
 *   bindLifecycle attach visibility and pagehide handlers, default true
 */
export function createSave(config) {
  const cfg = Object.assign({}, DEFAULTS, config || {});
  const key = String(cfg.key || DEFAULTS.key);

  let running = false;
  let dirty = false;
  let pending = null;
  let serial = 0;
  let playMs = 0;
  const floorMs = Math.max(250, cfg.intervalMs);
  let interval = floorMs;
  let lastWriteAt = 0;
  let lastWriteMs = 0;
  let writes = 0;
  let totalWriteMs = 0;
  let lastError = null;
  let listeners = null;

  const clockNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  function report(kind, detail) {
    lastError = kind === 'ok' ? null : { kind, detail, at: Date.now() };
    if (typeof cfg.onError === 'function' && kind !== 'ok') {
      try { cfg.onError({ kind, detail }); } catch (e) { /* a reporter must not break a save */ }
    }
  }

  function metaNow() {
    let fp = null;
    if (typeof cfg.fingerprint === 'function') {
      try { fp = cfg.fingerprint(); } catch (e) { fp = null; }
    }
    return {
      version: currentVersion,
      savedAt: Date.now(),
      serial: ++serial,
      playMs,
      fingerprint: fp,
      shrink: typeof cfg.shrink === 'function' ? cfg.shrink : null,
    };
  }

  // The single write path. Returns { ok, bytes, ms, error }.
  function commit() {
    if (typeof cfg.capture !== 'function') {
      report('nocapture', 'no capture function was supplied');
      return { ok: false, bytes: 0, ms: 0, error: 'no capture function' };
    }
    const t0 = clockNow();
    let state;
    try {
      state = cfg.capture();
    } catch (e) {
      // A capture that throws must not take the frame or the game with it.
      // The serial is not rolled back because it has not been spent yet -
      // metaNow() advances it, and metaNow() has not run.
      report('capture', errText(e));
      return { ok: false, bytes: 0, ms: 0, error: errText(e) };
    }
    const meta = metaNow();
    const res = writeSave(key, state, meta);
    const ms = clockNow() - t0;

    lastWriteMs = ms;
    totalWriteMs += ms;
    lastWriteAt = Date.now();
    dirty = false;

    if (res.ok) {
      writes++;
      // Widen the gap when a write costs more than its budget, and let it walk
      // back down when it does not. A deep run pays less often rather than the
      // player paying attention.
      if (ms > cfg.budgetMs) interval = Math.min(cfg.maxIntervalMs, Math.round(interval * 1.6) + 250);
      else if (interval > floorMs) interval = Math.max(floorMs, Math.round(interval * 0.85));
      report('ok', null);
    } else {
      if (res.quota) report('quota', res.error);
      else report('write', res.error);
    }
    return { ok: res.ok, bytes: res.bytes, ms, error: res.error };
  }

  function schedule() {
    if (!running || pending) return;
    pending = idleCall(deadline => {
      pending = null;
      if (!running) return;
      if (!dirty) return;
      if (Date.now() - lastWriteAt < interval) { schedule(); return; }
      // If the browser handed over a sliver of idle time, wait for a real one
      // rather than running long inside it. A timed-out callback always runs,
      // so this cannot starve.
      const left = deadline && typeof deadline.timeRemaining === 'function' ? deadline.timeRemaining() : 8;
      if (left < 2 && !(deadline && deadline.didTimeout)) { schedule(); return; }
      commit();
    }, cfg.idleTimeoutMs);
  }

  function onHide() {
    // The page may not come back. This one is synchronous on purpose.
    if (dirty) commit();
  }

  function bind() {
    if (!cfg.bindLifecycle || listeners) return;
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    const vis = () => { if (document.visibilityState === 'hidden') onHide(); };
    const hide = () => onHide();
    document.addEventListener('visibilitychange', vis);
    if (typeof addEventListener === 'function') addEventListener('pagehide', hide);
    listeners = { vis, hide };
  }

  function unbind() {
    if (!listeners) return;
    try {
      document.removeEventListener('visibilitychange', listeners.vis);
      if (typeof removeEventListener === 'function') removeEventListener('pagehide', listeners.hide);
    } catch (e) { /* nothing left to unbind */ }
    listeners = null;
  }

  const api = {
    /** Begin autosaving. Idempotent. */
    start() {
      if (running) return api;
      running = true;
      bind();
      if (dirty) schedule();
      return api;
    },

    /** Stop autosaving, flushing anything outstanding first. */
    stop() {
      if (!running) return api;
      if (dirty) commit();
      running = false;
      cancelIdle(pending);
      pending = null;
      unbind();
      return api;
    },

    /**
     * Something changed. Costs a boolean assignment, so call it wherever it is
     * convenient - the end of a turn is the natural place, but per frame is
     * fine and nothing is serialised until the engine is idle anyway.
     */
    mark() {
      dirty = true;
      if (running) schedule();
      return api;
    },

    /** Accumulate play time from the frame delta, in seconds. */
    tick(dtSeconds) {
      if (Number.isFinite(dtSeconds) && dtSeconds > 0 && dtSeconds < 1) playMs += dtSeconds * 1000;
      return api;
    },

    /** Write now, synchronously. For deliberate moments, not for the loop. */
    flush() {
      cancelIdle(pending);
      pending = null;
      const res = commit();
      if (running && dirty) schedule();
      return res;
    },

    /**
     * Read the stored run, hand it to restore(), and return the full report -
     * including `away` and a welcome-back line. Never throws.
     */
    load(now) {
      const res = readSave(key, now);
      res.welcome = welcome(res);

      if (res.ok && res.found) {
        serial = Math.max(serial, res.serial | 0);
        playMs = Math.max(playMs, res.playMs || 0);

        if (typeof cfg.fingerprint === 'function' && res.fingerprint) {
          let mine = null;
          try { mine = cfg.fingerprint(); } catch (e) { mine = null; }
          if (mine && mine !== res.fingerprint) {
            res.notes.push('the field does not match the one this save was made in - check that the raw seed was restored rather than the hashed one');
            res.degraded = true;
          }
        }

        if (typeof cfg.restore === 'function') {
          try {
            cfg.restore(res.state, res);
          } catch (e) {
            // The save read cleanly and the game could not take it. Keep the
            // bytes, tell the caller, and let it start fresh rather than
            // leaving a half-restored run standing.
            const raw = readRaw(key);
            if (typeof raw === 'string' && readRaw(slotKept(key)) === null) writeRaw(slotKept(key), raw);
            res.ok = false;
            res.error = 'the run could not be rebuilt from the save: ' + errText(e);
            res.degraded = true;
            res.notes.push(res.error);
            report('restore', res.error);
          }
        }
      }
      return res;
    },

    /** The current run as a copy-pasteable string, or null. */
    exportString() {
      if (typeof cfg.capture === 'function') {
        try {
          return exportSave(cfg.capture(), metaNow());
        } catch (e) {
          report('export', errText(e));
        }
      }
      const stored = readRaw(key);
      return typeof stored === 'string' ? exportText(stored) : null;
    },

    /**
     * Validate a pasted string and, unless told otherwise, adopt it.
     *
     * Adopting means restoring it and writing it to storage, with the run it
     * replaced rotated into the backup slot - so an import that turns out to
     * be the wrong save has not destroyed the right one.
     */
    importString(text, opts) {
      const apply = !opts || opts.apply !== false;
      const res = importSave(text);
      if (!res.ok || !apply) return res;

      if (typeof cfg.restore === 'function') {
        try {
          cfg.restore(res.state, res);
        } catch (e) {
          res.ok = false;
          res.error = 'that save is valid but this build could not rebuild the run from it: ' + errText(e);
          res.notes.push(res.error);
          return res;
        }
      }
      serial = Math.max(serial, res.serial | 0);
      playMs = Math.max(playMs, res.playMs || 0);
      const w = writeText(key, res.text, null);
      if (!w.ok) {
        res.notes.push('the run was restored but could not be stored: ' + w.error);
        report('write', w.error);
      }
      dirty = false;
      lastWriteAt = Date.now();
      return res;
    },

    /** Forget everything stored under this key. Does not touch the live run. */
    wipe() {
      clearSave(key);
      dirty = false;
      serial = 0;
      return api;
    },

    /** Everything worth showing in a diagnostics line. Never throws. */
    status() {
      return {
        key,
        storage: storageKind(),
        storageNote: storageNote(),
        running,
        dirty,
        schema: currentVersion,
        serial,
        writes,
        playMs: Math.round(playMs),
        intervalMs: interval,
        lastWriteAt: lastWriteAt || null,
        lastWriteMs: Math.round(lastWriteMs * 1000) / 1000,
        avgWriteMs: writes ? Math.round((totalWriteMs / writes) * 1000) / 1000 : 0,
        bytes: saveBytes(key),
        error: lastError,
      };
    },
  };

  return api;
}


// ===========================================================================
// SECTION 10 - self test
// ===========================================================================
// There is no build step and no test runner in this project, so the module
// carries its own check. It exercises the parts that fail silently rather than
// loudly: magnitudes past the float range, saturated values, the escape for
// strings that look like tags, the compressor, the checksum, a truncated
// paste, and a save from a version this build has never seen.
//
//   node -e "import('./src/save.js').then(m => console.log(m.selfTest()))"

export function selfTest() {
  const failures = [];
  const check = (name, cond) => { if (!cond) failures.push(name); };

  const sample = {
    run: { depth: 47, balls: 8123, gold: 91, aim: { x: 260.5, y: 402 }, dead: false },
    live: [{ x: 12.5, y: 30.25, vx: -7.5, vy: 3.25 }],
    market: {
      essence: { m: 4.87231, e: 613 },
      held: { ore: { m: 0, e: 0 }, glass: { m: 1.5, e: 4 } },
      hist: [{ d: 1, rel: 0.5, u: { m: 2, e: 3 }, p: { m: 9.99, e: 120 } }],
      cfg: { hpAt: () => 1, rowSource: () => [] },
    },
    edges: {
      inf: Infinity, ninf: -Infinity, nan: NaN, undef: undefined,
      tagLike: '~L1|2', plainTilde: '~', empty: '', zero: 0, negZero: -0,
      when: new Date(1756200000000),
      tags: new Set(['a', 'b']),
      lookup: new Map([['k', { m: 3, e: 9 }]]),
    },
  };
  sample.cycle = sample;

  const round = decodeState(encodeState(sample));

  check('magnitude survives', round.market.essence.m === 4.87231 && round.market.essence.e === 613);
  check('zero magnitude survives', round.market.held.ore.m === 0 && round.market.held.ore.e === 0);
  check('nested magnitude in history survives', round.market.hist[0].p.e === 120);
  check('functions are dropped', round.market.cfg && round.market.cfg.hpAt === undefined);
  check('infinity survives', round.edges.inf === Infinity && round.edges.ninf === -Infinity);
  check('nan survives', Number.isNaN(round.edges.nan));
  check('undefined survives', 'undef' in round.edges && round.edges.undef === undefined);
  check('tag-like string is escaped', round.edges.tagLike === '~L1|2');
  check('bare tilde survives', round.edges.plainTilde === '~');
  check('date survives', round.edges.when instanceof Date && round.edges.when.getTime() === 1756200000000);
  check('set survives', round.edges.tags instanceof Set && round.edges.tags.has('b'));
  check('map survives', round.edges.lookup instanceof Map && round.edges.lookup.get('k').e === 9);
  check('cycle does not hang', round.cycle === null);
  check('float precision holds', round.live[0].vx === -7.5);

  const text = serialize(sample, { version: currentVersion, savedAt: 1756200000000, serial: 3, playMs: 1234 });
  check('serialize produced text', typeof text === 'string' && text.startsWith(MAGIC + ':'));
  const back = deserialize(text);
  check('deserialize round-trips', back.ok && back.env.n === 3 && back.state.run.depth === 47);
  check('checksum verified', back.checksum === true);

  check('corrupt text does not throw', deserialize('SWB:deadbeef:{not json').ok === false);
  check('truncated text does not throw', deserialize(text.slice(0, text.length >> 1)).ok === false);
  check('empty text does not throw', deserialize('').ok === false);
  check('garbage does not throw', deserialize('hello there').ok === false);

  const exported = exportSave(sample, { version: currentVersion, savedAt: 1756200000000, serial: 3 });
  check('export produced a string', typeof exported === 'string' && exported.startsWith(EXPORT_PREFIX));
  check('export is one token', exported !== null && !/\s/.test(exported));
  const imported = importSave(exported, 1756200000000 + 3 * DAY);
  check('import round-trips', imported.ok && imported.state.run.depth === 47);
  check('import restores magnitudes', imported.ok && imported.state.market.essence.e === 613);
  check('away is described', imported.ok && imported.away.text === '3 days');
  check('away grants nothing', imported.ok && imported.away.grant === null && offlineGrant() === null);

  check('rewrapped paste imports', importSave(exported.replace(/(.{20})/g, '$1\n')).ok === true);
  check('truncated paste is caught', importSave(exported.slice(0, exported.length - 8)).ok === false);
  check('flipped character is caught', importSave(
    exported.slice(0, 30) + (exported[30] === 'A' ? 'B' : 'A') + exported.slice(31)
  ).ok === false);
  check('foreign string is caught', importSave('hello world').ok === false);
  check('empty import is caught', importSave('').ok === false);
  check('null import is caught', importSave(null).ok === false);

  // A save from a build that does not exist yet must still open.
  const future = serialize({ run: { depth: 9 } }, { version: currentVersion + 5, savedAt: Date.now(), serial: 1 });
  const fut = deserialize(future);
  const futMig = migrate(fut.state, fut.env.v);
  check('a newer save still reads', futMig.data.run.depth === 9 && futMig.future === true);

  // Clock moved backwards: unclear, and costs the player nothing.
  const back6h = describeAway(Date.now() + 6 * HOUR, Date.now());
  check('backwards clock is not punished', back6h.clockSkew === true && back6h.grant === null && back6h.ms === 0);
  check('missing timestamp is not punished', describeAway(null).unknown === true);

  // Compression must be a strict improvement or not used at all.
  const bulky = utf8Encode(JSON.stringify({ rows: new Array(400).fill({ c: 3, r: 2, hp: 17, max: 24 }) }));
  const packed = lzssCompress(bulky);
  const unpacked = lzssDecompress(packed);
  let identical = unpacked.length === bulky.length;
  for (let i = 0; identical && i < bulky.length; i++) if (unpacked[i] !== bulky[i]) identical = false;
  check('compressor round-trips', identical);
  check('compressor actually compresses', packed.length < bulky.length / 2);

  // Byte-level edges the base64 and window logic can trip on.
  for (const n of [0, 1, 2, 3, 4, 5, 255, 4095, 4096, 4097, 9000]) {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = (i * 37 + (i >> 3)) & 255;
    const dec = b64Decode(b64Encode(bytes));
    let ok = dec.length === n;
    for (let i = 0; ok && i < n; i++) if (dec[i] !== bytes[i]) ok = false;
    check('base64 round-trips at ' + n + ' bytes', ok);
    let lz;
    try { lz = lzssDecompress(lzssCompress(bytes)); } catch (e) { lz = new Uint8Array(0); }
    let lzok = lz.length === n;
    for (let i = 0; lzok && i < n; i++) if (lz[i] !== bytes[i]) lzok = false;
    check('compressor round-trips at ' + n + ' bytes', lzok);
  }

  // An absent store must read as a clean first run, not as an error.
  const virgin = readSave('swarmbreaker.selftest.absent.' + Math.random());
  check('absent save reads as a first run', virgin.found === false && virgin.ok === false && virgin.state === null);
  check('absent save still describes away', virgin.away && virgin.away.grant === null);

  // A full storage cycle, wherever it happens to land.
  const k = 'swarmbreaker.selftest';
  clearSave(k);
  const w = writeSave(k, sample, { version: currentVersion, savedAt: Date.now(), serial: 1 });
  check('write reports a result', typeof w.ok === 'boolean');
  if (w.ok) {
    const r = readSave(k);
    check('stored save reads back', r.ok && r.state.run.depth === 47);
    check('stored save is not degraded', r.degraded === false);
  }
  // Corrupt the live slot and prove the backup slot carries the run.
  if (w.ok) {
    writeSave(k, { run: { depth: 48 } }, { version: currentVersion, savedAt: Date.now(), serial: 2 });
    writeRaw(k, 'SWB:00000000:{ truncated');
    const rec = readSave(k);
    check('a corrupt live slot falls back to the backup', rec.ok === true && rec.slot === 'prev');
  }
  clearSave(k);

  return { ok: failures.length === 0, failures, storage: storageKind(), schema: currentVersion };
}


export default createSave;
