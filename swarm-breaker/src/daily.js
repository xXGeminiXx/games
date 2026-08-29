// VENDORED FROM THE GAME ART FOUNDATION.
// Source: /mnt/c/Personal/game-art lib/daily.js at commit 1fe237d (2026-08-29).
// Copied, not imported: every game here is a self-contained static page, so
// the foundation is a template rather than a library. A fix lands there first
// with a test and is carried across; `node tools/vendor-diff.js <game>/src` in
// that repo says which copies have drifted. Edit this file only to carry a
// fix, and record the drift if the change is deliberate.

// ---------------------------------------------------------------------------
// The daily seed.
//
// Everyone who plays on the same UTC day plays the same world: the seed is
// SHA-256(date + ':' + gameId), computed on the device, so a run needs no
// network at all. A board is per (game, seed), which makes the day the unit
// of competition and makes any past day permanently replayable from its
// date alone.
//
// The digest's first eight bytes become a uint32 pair. `seed` is those two
// words written as sixteen lowercase hex characters, which is the form
// rng.js takes: rng(daily.seed).
//
// WebCrypto does the hashing wherever it exists (browsers on https or
// localhost, node 19 and later). Where it does not - a page served over
// plain http on a LAN address is the case that actually happens - the small
// SHA-256 below runs instead. The two agree byte for byte; the tests pin the
// vectors and check both paths.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86400000;

// UTC calendar date as YYYY-MM-DD. UTC, not local, so two players in
// different time zones are on the same board at the same moment.
export function today(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

// Milliseconds until the next UTC midnight, when today() changes and a new
// board opens. Useful for a countdown and for scheduling a refresh.
export function msUntilNextSeed(now = Date.now()) {
  const t = now instanceof Date ? now.getTime() : now;
  return MS_PER_DAY - (((t % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY);
}

// YYYY-MM-DD shifted by whole days, for "yesterday's board".
export function dayOffset(dateString, days) {
  requireDate(dateString);
  return today(Date.parse(dateString + 'T00:00:00Z') + days * MS_PER_DAY);
}

function requireDate(dateString) {
  if (typeof dateString !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw new Error('date must be YYYY-MM-DD, got ' + JSON.stringify(dateString));
  }
  if (!Number.isFinite(Date.parse(dateString + 'T00:00:00Z'))) {
    throw new Error('not a real date: ' + dateString);
  }
}

function requireGameId(gameId) {
  if (typeof gameId !== 'string' || !gameId.length || gameId.length > 64) {
    throw new Error('gameId must be a string of 1 to 64 characters');
  }
}

function pack(digest, dateString, gameId) {
  const hi = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
  const lo = ((digest[4] << 24) | (digest[5] << 16) | (digest[6] << 8) | digest[7]) >>> 0;
  return {
    date: dateString,
    gameId,
    hi,
    lo,
    // Pass this to rng() from rng.js. Hex, so it is stable in a URL, a
    // filename and a KV key, and it is the id the board is stored under.
    seed: hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0'),
  };
}

// The canonical async path: WebCrypto if the page has it, the local hash if
// it does not.
export async function seedFor(dateString, gameId) {
  requireDate(dateString);
  requireGameId(gameId);
  const message = dateString + ':' + gameId;
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (subtle) {
    const digest = new Uint8Array(await subtle.digest('SHA-256', utf8(message)));
    return pack(digest, dateString, gameId);
  }
  return pack(sha256(message), dateString, gameId);
}

// The same value with no await, for code that cannot be async (a config
// read at module load, a test vector). Always uses the local hash.
export function seedForSync(dateString, gameId) {
  requireDate(dateString);
  requireGameId(gameId);
  return pack(sha256(dateString + ':' + gameId), dateString, gameId);
}

export function seedForToday(gameId, now = Date.now()) {
  return seedFor(today(now), gameId);
}

export function utf8(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      c = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

// FIPS 180-4 SHA-256, about as small as it gets and fast enough for the one
// short string a day this module hashes. Kept here rather than imported so
// a game can copy daily.js on its own.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(input) {
  const bytes = typeof input === 'string' ? utf8(input) : input;
  const len = bytes.length;
  const blocks = ((len + 9 + 63) >> 6);
  const w32 = new Uint32Array(blocks * 16);
  for (let i = 0; i < len; i++) w32[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
  w32[len >> 2] |= 0x80 << (24 - (len & 3) * 8);
  const bits = len * 8;
  w32[blocks * 16 - 2] = Math.floor(bits / 4294967296) >>> 0;
  w32[blocks * 16 - 1] = bits >>> 0;

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 16; i++) w[i] = w32[b * 16 + i];
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, bb = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + bb) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const hs = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) {
    out[i * 4] = hs[i] >>> 24; out[i * 4 + 1] = (hs[i] >>> 16) & 255;
    out[i * 4 + 2] = (hs[i] >>> 8) & 255; out[i * 4 + 3] = hs[i] & 255;
  }
  return out;
}

export function hex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

export default { today, msUntilNextSeed, dayOffset, seedFor, seedForSync, seedForToday, sha256, hex, utf8 };
