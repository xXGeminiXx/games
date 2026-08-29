// Vendored from the game-art foundation (lib/save.js) at commit 42c692f, 2026-08-29.
// This copy belongs to Open Outcry: fixes land in the foundation first, then are
// carried here by reading the diff, never by a blind overwrite.
// ---------------------------------------------------------------------------
// Saving, migrating, exporting and importing a run.
//
// Self-contained: no imports, no dependencies, works in a browser and in
// node (pass a storage object in node).
//
// FOUR THINGS IT REFUSES TO DO
//
// 1. LOSE A GOOD SAVE TO A BAD WRITE. Every write moves the previous good
//    save into a .bak slot first. A load that cannot parse the main slot
//    falls back to the backup and SAYS WHICH SLOT IT LOADED, so a game can
//    tell the player it went back a step instead of silently starting them
//    over. A save is a player's hours; the failure mode of a save system is
//    not "an error", it is "they stop playing".
//
// 2. WRITE A HALF-BUILT SAVE. The payload is serialised, checksummed and
//    verified as a string BEFORE anything is written, so a serialiser that
//    throws on a circular reference or a value that will not survive JSON
//    leaves the old save exactly where it was.
//
// 3. GUESS AT A VERSION, OR REFUSE ONE IT COULD HAVE READ. Migrations are
//    the only version path here: migrations[i] takes a save at version i and
//    returns one at version i + 1, and the array's length IS the current
//    version. An older save WALKS FORWARD through them. There is deliberately
//    no exact-version check anywhere in this file, because the shape that
//    keeps appearing in these games is
//
//        if (obj.v !== VERSION) return null;   // every old save, deleted
//
//    which throws away a player's run for the crime of predating a field
//    that a two-line migration could have added. A save from the FUTURE (a
//    newer version than this build knows) is the one case that cannot be
//    handled: it is refused with reason 'future', reported to the caller, and
//    LEFT WHERE IT IS. It is not migrated, not overwritten and not cleared,
//    so the player who opens a stale tab and then goes back to the current
//    one still has their run.
//
// 4. TRUST AN IMPORT STRING. An import carries a version prefix and a
//    checksum, and both are checked before the data is handed to a game.
//    The checksum catches the ordinary damage: a string pasted with a
//    newline in it, a truncated copy, an autocorrected character. It is not
//    a signature and does not pretend to be; anyone can edit their own save
//    and that is their business.
//
// EXPORT FORMAT
//
//     idle1.<base64 of the UTF-8 JSON>.<8 hex digits of FNV-1a>
//
// Three dot-separated fields so a human can see at a glance which part is
// wrong, and base64 rather than raw JSON so a chat client cannot reflow it.
// ---------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Base64 written out rather than reached for, because btoa is browser-only,
// Buffer is node-only, and btoa throws on any character above U+00FF. This
// goes through UTF-8 bytes, so a save with a name in it in any language
// survives the round trip in both environments.
function toBase64(str) {
  const bytes = utf8Bytes(str);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b === undefined ? 0 : b) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c === undefined ? 0 : c) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}

function fromBase64(s) {
  s = String(s).replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = [];
  for (let i = 0; i < s.length; i += 4) {
    const a = B64.indexOf(s[i]), b = B64.indexOf(s[i + 1]);
    const c = B64.indexOf(s[i + 2]), d = B64.indexOf(s[i + 3]);
    if (a < 0 || b < 0) break;
    bytes.push(((a << 2) | (b >> 4)) & 255);
    if (c >= 0) bytes.push(((b << 4) | (c >> 2)) & 255);
    if (d >= 0) bytes.push(((c << 6) | d) & 255);
  }
  return utf8String(bytes);
}

function utf8Bytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.codePointAt(i);
    if (c > 0xffff) i++;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function utf8String(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    if (b < 0x80) { out += String.fromCharCode(b); i += 1; }
    else if (b < 0xe0) { out += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2; }
    else if (b < 0xf0) { out += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3; }
    else {
      out += String.fromCodePoint(((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63));
      i += 4;
    }
  }
  return out;
}

// FNV-1a, 32 bit. Not a cryptographic hash and not used as one: it is here
// to catch a truncated or reflowed paste, which it does.
export function checksum(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// A localStorage stand-in, so tests and node runs need no browser and a
// game with storage disabled degrades to memory instead of throwing.
export function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    get length() { return map.size; },
    key: (i) => [...map.keys()][i],
  };
}

function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('__probe', '1');
      localStorage.removeItem('__probe');
      return localStorage;
    }
  } catch (e) {
    // Private browsing, a blocked third-party context, or a full quota. A
    // game should still run; it just will not remember.
  }
  return memoryStorage();
}

export const PREFIX = 'idle';

// Encode a save object into the export string.
export function encode(data, version) {
  const json = JSON.stringify({ version, data });
  const body = toBase64(json);
  return `${PREFIX}${version}.${body}.${checksum(body)}`;
}

// Decode an export string. Never throws: it reports.
//
//   { ok: true, version, data }
//   { ok: false, reason: 'format' | 'checksum' | 'json', detail }
export function decode(str) {
  const s = String(str == null ? '' : str).trim();
  const m = /^([a-z]+)(\d+)\.([A-Za-z0-9+/=\s]+)\.([0-9a-f]{8})$/.exec(s);
  if (!m) return { ok: false, reason: 'format', detail: 'not an export string' };
  const version = Number(m[2]);
  const body = m[3].replace(/\s+/g, '');
  if (checksum(body) !== m[4]) {
    return { ok: false, reason: 'checksum', detail: 'the string is damaged or was edited' };
  }
  let parsed;
  try {
    parsed = JSON.parse(fromBase64(body));
  } catch (e) {
    return { ok: false, reason: 'json', detail: String(e && e.message) };
  }
  return { ok: true, version: parsed && parsed.version !== undefined ? parsed.version : version, data: parsed ? parsed.data : null };
}

// Run the migration chain over a save. migrations[i] takes version i and
// returns version i + 1, so migrations.length is the current version.
//
//   { ok, data, from, to, ran: [i, ...] }        or
//   { ok: false, reason: 'future' | 'migration', ... }
export function migrate(data, fromVersion, migrations) {
  const target = migrations.length;
  let v = Number(fromVersion) || 0;
  if (v > target) {
    return { ok: false, reason: 'future', data, from: v, to: target, ran: [] };
  }
  const ran = [];
  let out = data;
  while (v < target) {
    try {
      const next = migrations[v](out);
      out = next === undefined ? out : next;
    } catch (e) {
      return { ok: false, reason: 'migration', detail: `migration ${v}: ${e && e.message}`, data: out, from: fromVersion, to: v, ran };
    }
    ran.push(v);
    v += 1;
  }
  if (out && typeof out === 'object') out.version = target;
  return { ok: true, data: out, from: Number(fromVersion) || 0, to: target, ran };
}

// ---------------------------------------------------------------------------
// The save file itself.
//
//   const save = createSave({
//     key: 'aerie',
//     migrations: [ (s) => { s.flux = s.money; delete s.money; return s; } ],
//     serialize: () => game.toJSON(),
//     interval: 30,
//   });
//   save.start();                 autosave on a timer, on tab hide, on unload
//   const loaded = save.load();   { data, slot, version, migrated, error }
//
// A game calls save.write() itself at the moments that matter (a prestige, a
// purchase it would hate to lose) and lets start() cover the rest.
// ---------------------------------------------------------------------------

export function createSave(opts = {}) {
  const key = opts.key || 'save';
  const bakKey = key + '.bak';
  const migrations = opts.migrations || [];
  const version = migrations.length;
  const storage = opts.storage || defaultStorage();
  const serialize = opts.serialize || (() => ({}));
  const intervalMs = (opts.interval === undefined ? 30 : opts.interval) * 1000;
  const now = opts.now || (() => Date.now());
  const onError = opts.onError || (() => {});

  let timer = null;
  let listeners = null;
  let lastWrite = 0;
  let persisted = null;

  // ASK FOR PERSISTENT STORAGE, ONCE, AFTER THE FIRST SAVE ACTUALLY LANDS.
  //
  // Browser storage is best-effort by default: under storage pressure a
  // browser may evict a whole origin, and a player who has not visited for a
  // while loses their run to a cleanup they never saw. navigator.storage
  // .persist() asks for the bucket to be exempt, and it is the only lever a
  // page has. Chrome grants it silently on engagement signals, Firefox may
  // prompt, Safari does not implement it.
  //
  // It is asked AFTER a save, not at startup, because a browser that scores
  // engagement wants to see the player actually use the page, and because a
  // permission question in the first second of a game is a good way to be
  // dismissed. Nothing waits on the answer: the promise resolves whenever it
  // resolves and updates `persisted`, which is 'pending' until then and
  // 'unsupported' where the API is absent.
  function askForPersistence() {
    if (persisted !== null) return;
    const nav = opts.navigator || (typeof navigator !== 'undefined' ? navigator : null);
    if (!nav || !nav.storage || typeof nav.storage.persist !== 'function') {
      persisted = 'unsupported';
      return;
    }
    persisted = 'pending';
    try {
      Promise.resolve(nav.storage.persist())
        .then((granted) => { persisted = granted === true; })
        .catch(() => { persisted = false; });
    } catch (e) {
      persisted = false;
    }
  }

  function write(reason = 'manual') {
    let str;
    try {
      // Build and verify the whole string before touching storage: a
      // serialiser that throws must not be able to damage the save on disk.
      str = encode(serialize(), version);
      if (!decode(str).ok) throw new Error('the encoded save did not decode');
    } catch (e) {
      onError({ stage: 'serialize', error: e, reason });
      return { ok: false, stage: 'serialize', error: e };
    }
    try {
      const prev = storage.getItem(key);
      if (prev !== null && prev !== str) storage.setItem(bakKey, prev);
      storage.setItem(key, str);
      lastWrite = now();
      askForPersistence();
      return { ok: true, bytes: str.length, reason, at: lastWrite, persisted };
    } catch (e) {
      // A full quota is the usual cause. The previous save is untouched.
      onError({ stage: 'storage', error: e, reason });
      return { ok: false, stage: 'storage', error: e };
    }
  }

  function readSlot(k) {
    let raw;
    try { raw = storage.getItem(k); } catch (e) { return { ok: false, reason: 'storage', detail: String(e && e.message) }; }
    if (raw === null || raw === undefined || raw === '') return { ok: false, reason: 'empty' };
    return decode(raw);
  }

  // Load, preferring the main slot, falling back to the backup, and always
  // saying which one answered.
  //
  //   slot: 'main' | 'backup' | 'none'
  function load() {
    const main = readSlot(key);
    const tries = [['main', main]];
    let chosen = main.ok ? main : null;
    let slot = main.ok ? 'main' : null;
    if (!chosen) {
      const bak = readSlot(bakKey);
      tries.push(['backup', bak]);
      if (bak.ok) { chosen = bak; slot = 'backup'; }
    }
    if (!chosen) {
      return { data: null, slot: 'none', version: null, migrated: false, ran: [], error: main.reason === 'empty' ? null : main, tries };
    }
    // Falling back is not a silent success: the reason the main slot was
    // skipped travels with the result so a game can tell the player it went
    // back one save rather than quietly handing them an older run.
    const fellBack = slot === 'backup' && main.reason !== 'empty' ? main : null;
    const m = migrate(chosen.data, chosen.version, migrations);
    if (!m.ok) {
      return { data: chosen.data, slot, version: chosen.version, migrated: false, ran: m.ran, error: m, tries };
    }
    return { data: m.data, slot, version, migrated: m.ran.length > 0, ran: m.ran, error: fellBack, tries };
  }

  // Autosave. visibilitychange is the one that actually fires on a phone and
  // on a tab switch; pagehide is the one that fires on a real navigation
  // away. beforeunload is deliberately not used: it is unreliable on mobile
  // and it can block a page from being cached for a fast back-navigation.
  function start() {
    stop();
    if (intervalMs > 0) timer = setInterval(() => write('interval'), intervalMs);
    if (typeof document !== 'undefined' && typeof addEventListener === 'function') {
      const onVis = () => { if (document.visibilityState === 'hidden') write('hidden'); };
      const onHide = () => write('pagehide');
      addEventListener('visibilitychange', onVis);
      addEventListener('pagehide', onHide);
      listeners = () => {
        removeEventListener('visibilitychange', onVis);
        removeEventListener('pagehide', onHide);
      };
    }
    return api;
  }

  function stop() {
    if (timer !== null) { clearInterval(timer); timer = null; }
    if (listeners) { listeners(); listeners = null; }
    return api;
  }

  // RESET. Deliberately two steps, because one slip should not cost a run.
  //
  //   save.reset()                  clears the main slot, KEEPS the backup,
  //                                 so restore() can undo it
  //   save.reset({ backup: true })  clears both: there is no way back
  //   save.restore()                promotes the backup into the main slot
  //
  // A game's "start over" button calls reset(); a game's "wipe my data"
  // setting calls reset({ backup: true }) behind a confirmation.
  function reset(o = {}) {
    const current = storage.getItem(key);
    if (current !== null && !o.backup) {
      try { storage.setItem(bakKey, current); } catch (e) { onError({ stage: 'storage', error: e, reason: 'reset' }); }
    }
    storage.removeItem(key);
    if (o.backup) storage.removeItem(bakKey);
    return { ok: true, backupKept: !o.backup };
  }

  function restore() {
    const raw = storage.getItem(bakKey);
    if (raw === null) return { ok: false, reason: 'empty' };
    storage.setItem(key, raw);
    return { ok: true };
  }

  const api = {
    key, bakKey, version, storage,
    write, load, start, stop, reset, restore,
    // The string a player copies out, and the one they paste back in.
    exportString: () => encode(serialize(), version),
    importString(str) {
      const d = decode(str);
      if (!d.ok) return d;
      const m = migrate(d.data, d.version, migrations);
      if (!m.ok) return { ok: false, reason: m.reason, detail: m.detail, from: d.version, to: version };
      // Keep whatever was there as the backup: an import is the single
      // easiest way for a player to lose a run they wanted.
      try {
        const prev = storage.getItem(key);
        if (prev !== null) storage.setItem(bakKey, prev);
        storage.setItem(key, encode(m.data, version));
      } catch (e) {
        return { ok: false, reason: 'storage', detail: String(e && e.message) };
      }
      return { ok: true, data: m.data, version, migrated: m.ran.length > 0, ran: m.ran };
    },
    get lastWrite() { return lastWrite; },
    get running() { return timer !== null; },
    // true (granted), false (refused), 'pending' (asked, no answer yet),
    // 'unsupported' (no API here), or null (nothing has been saved yet).
    get persisted() { return persisted; },
    // Everything a settings panel wants to show about the save in one call.
    status() {
      return {
        key, version, persisted,
        running: timer !== null,
        lastWrite,
        bytes: (() => { try { const v = storage.getItem(key); return v === null ? 0 : v.length; } catch (e) { return 0; } })(),
        hasBackup: (() => { try { return storage.getItem(bakKey) !== null; } catch (e) { return false; } })(),
      };
    },
  };
  return api;
}

export default createSave;
