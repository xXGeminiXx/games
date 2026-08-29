// Vendored from the game-art foundation (lib/cfgpatch.js) at commit 42c692f, 2026-08-29.
// This copy belongs to Open Outcry: fixes land in the foundation first, then are
// carried here by reading the diff, never by a blind overwrite.
// ---------------------------------------------------------------------------
// The developer tuning patch: a config override a game reads at startup so a
// hosted build can be retuned without a push.
//
// Self-contained: no imports.
//
// WHY THE KEY IS NAMESPACED. localStorage is scoped to an ORIGIN, not to a
// path. Every game published to the same GitHub Pages site shares one origin,
// so a patch written under the bare key `cfg` by one game is read at startup
// by every sibling on that host. A tuning value meant for one game silently
// becomes a tuning value for all of them, and the symptom shows up in a game
// nobody was working on, which is close to undebuggable. The key here is
// `cfg:<storageKey>`, so the games cannot see each other's patches even
// though they share a domain.
//
// WHY UNKNOWN PATHS ARE REPORTED, NOT CREATED. A patch that creates the path
// it names always "works": a typo in a path becomes a new config field that
// nothing reads, and the tuning appears to be applied while nothing changes.
// So a path is applied only where it already exists in the config, and every
// path that does not is handed back for the caller to show. A patch that does
// nothing should say so.
//
// THE LEGACY KEY. Builds already in the wild wrote a bare `cfg`. It is still
// read, but only when the stored object carries a `game` field naming this
// game, which is the only way to tell whose patch it was. Anything else under
// that key belongs to a sibling and is left alone.
// ---------------------------------------------------------------------------

export const LEGACY_KEY = 'cfg';

export function patchKey(storageKey) {
  return 'cfg:' + storageKey;
}

// Flatten { a: { b: 1 } } into { 'a.b': 1 }. A patch may be written either
// way; nested is easier to type by hand, flat is easier to read back.
// Arrays and null are values, not branches to walk into.
export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, path, out);
    else out[path] = v;
  }
  return out;
}

function walk(config, parts) {
  let node = config;
  for (let i = 0; i < parts.length; i++) {
    if (!node || typeof node !== 'object') return null;
    if (!Object.prototype.hasOwnProperty.call(node, parts[i])) return null;
    if (i === parts.length - 1) return { parent: node, key: parts[i] };
    node = node[parts[i]];
  }
  return null;
}

// Apply a patch to a config in place. Returns what happened, so a game can
// print it in a dev overlay and a test can assert it.
//
//   { applied: [{ path, from, to }], unknown: [path], count }
export function applyPatch(config, patch) {
  const flat = flatten(patch);
  const applied = [];
  const unknown = [];
  for (const [path, value] of Object.entries(flat)) {
    const hit = walk(config, path.split('.'));
    if (!hit) { unknown.push(path); continue; }
    const from = hit.parent[hit.key];
    // Numbers written as strings (a query string, a hand-edited patch) are
    // coerced to match what the config already holds, so a tuning value does
    // not silently turn a number field into a string.
    let to = value;
    if (typeof from === 'number' && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) to = Number(value);
    if (typeof from === 'boolean' && typeof value === 'string') to = value === 'true' || value === '1';
    hit.parent[hit.key] = to;
    applied.push({ path, from, to });
  }
  return { applied, unknown, count: applied.length };
}

function readJSON(storage, key) {
  let raw;
  try { raw = storage.getItem(key); } catch (e) { return null; }
  if (!raw) return null;
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
}

// Read this game's patch and apply it.
//
//   loadPatch({ storageKey: 'aerie', config: CONFIG })
//     -> { source, applied, unknown, count, key }
//
//   source: 'namespaced' | 'legacy' | 'none'
//
// The patch object may carry a `game` field; under the namespaced key it is
// ignored (the key already says which game), and under the legacy bare key it
// is required and must match.
export function loadPatch(opts = {}) {
  const storageKey = opts.storageKey;
  if (!storageKey) throw new Error('cfgpatch: storageKey is required, it is what keeps the games apart');
  const config = opts.config;
  const storage = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const key = patchKey(storageKey);
  const empty = { source: 'none', applied: [], unknown: [], count: 0, key };
  if (!storage || !config) return empty;

  let patch = readJSON(storage, key);
  let source = 'namespaced';
  if (!patch) {
    const legacy = readJSON(storage, LEGACY_KEY);
    // A bare `cfg` with no game field, or one naming a sibling, is not ours.
    if (!legacy || legacy.game !== storageKey) return empty;
    patch = legacy;
    source = 'legacy';
  }
  const { game, ...values } = patch;
  const r = applyPatch(config, values);
  return { source, key, ...r };
}

// Write a patch for this game. Passing null clears it.
export function savePatch(storageKey, patch, storage) {
  const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!s) return false;
  try {
    if (patch === null || patch === undefined) s.removeItem(patchKey(storageKey));
    else s.setItem(patchKey(storageKey), JSON.stringify(patch));
    return true;
  } catch (e) {
    return false;
  }
}

// Remove this game's patch and, if it was ours, the legacy one too.
export function clearPatch(storageKey, storage) {
  const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!s) return false;
  try {
    s.removeItem(patchKey(storageKey));
    const legacy = readJSON(s, LEGACY_KEY);
    if (legacy && legacy.game === storageKey) s.removeItem(LEGACY_KEY);
    return true;
  } catch (e) {
    return false;
  }
}

export default loadPatch;
