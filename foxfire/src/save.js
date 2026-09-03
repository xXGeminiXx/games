// ---------------------------------------------------------------------------
// Saving.
//
// One key in browser storage holds the snapshot and the wall-clock time it was
// taken, so the next load knows how long the organism was left alone. A save
// from a newer build than this one is refused rather than half-loaded; a save
// from an older build is walked forward through the migrations registered
// here. The export string is the same snapshot, base64, so a save can move
// between browsers by paste.
// ---------------------------------------------------------------------------

import { SAVE_VERSION } from './sim.js?v=11';

const migrations = new Map();

/** Register how to carry a save from version `from` to `from + 1`. */
export function registerMigration(from, fn) {
  migrations.set(from, fn);
}

/** Walk a snapshot forward to the current version. Null when it cannot be. */
export function migrate(snap) {
  if (!snap || !snap.state || !Number.isInteger(snap.state.v)) return null;
  let cur = snap;
  let guard = 0;
  while (cur.state.v < SAVE_VERSION && guard++ < 64) {
    const fn = migrations.get(cur.state.v);
    if (!fn) return null;
    cur = fn(cur);
    if (!cur || !cur.state) return null;
  }
  return cur.state.v === SAVE_VERSION ? cur : null;
}

export function write(store, key, snap, wallMs) {
  try {
    store.setItem(key, JSON.stringify({ wall: wallMs, snap }));
    return true;
  } catch (e) {
    return false;
  }
}

/** { wall, snap } or null. A malformed or unmigratable save reads as absent. */
export function read(store, key) {
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const snap = migrate(parsed.snap);
    if (!snap) return null;
    return { wall: Number.isFinite(parsed.wall) ? parsed.wall : null, snap };
  } catch (e) {
    return null;
  }
}

export function clear(store, key) {
  try { store.removeItem(key); } catch (e) { /* nothing to clear */ }
}

/** The snapshot as a string a player can paste elsewhere. */
export function exportString(snap, wallMs) {
  return toBase64(JSON.stringify({ wall: wallMs, snap }));
}

/** The reverse. Throws on anything that is not a save. */
export function importString(str) {
  // Anything that is not a save comes back as one sentence the player can act
  // on, rather than as whatever the decoder happened to throw.
  let parsed = null;
  try { parsed = JSON.parse(fromBase64(String(str).trim())); } catch (e) { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || !parsed.snap) throw new Error('That isn\'t a save.');
  const snap = migrate(parsed.snap);
  if (!snap) throw new Error('That save is from a version this one can\'t read.');
  return { wall: Number.isFinite(parsed.wall) ? parsed.wall : null, snap };
}

function toBase64(s) {
  if (typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  return Buffer.from(s, 'utf8').toString('base64');
}

function fromBase64(s) {
  if (typeof atob === 'function') {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(s, 'base64').toString('utf8');
}
