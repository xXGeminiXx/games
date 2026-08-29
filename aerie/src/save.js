// Saves: localStorage, plus a string a player can carry between machines.
//
// The save holds the ledger, the island seed and number, the carrier's
// anchor, and the time. The land itself is not saved: it regrows from the
// seed and the offline catch-up strips it by what the fleet would have taken.
const VERSION = 1;

export function createSave(cfg, storage) {
  const key = cfg.identity.storageKey + '.save';

  const encode = (obj) => {
    const json = JSON.stringify({ v: VERSION, ...obj });
    if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(json)));
    return Buffer.from(json, 'utf8').toString('base64');
  };
  const decode = (str) => {
    try {
      const s = String(str).trim();
      const json = typeof atob === 'function' ? decodeURIComponent(escape(atob(s))) : Buffer.from(s, 'base64').toString('utf8');
      const obj = JSON.parse(json);
      if (!obj || obj.v !== VERSION) return null;
      return obj;
    } catch (e) { return null; }
  };

  const write = (obj) => {
    if (!storage) return false;
    try { storage.setItem(key, encode(obj)); return true; } catch (e) { return false; }
  };
  const read = () => {
    try { const s = storage && storage.getItem(key); return s ? decode(s) : null; } catch (e) { return null; }
  };
  const clear = () => { try { storage && storage.removeItem(key); } catch (e) { /* nothing to clear */ } };

  return { encode, decode, write, read, clear, key };
}

// What the player set about the page rather than the game: the quality they
// chose and whether the chart table is folded away. Kept apart from the save
// so importing someone else's game does not reach into their window, and so
// starting over leaves these alone.
export function createPrefs(cfg, storage) {
  const key = cfg.identity.storageKey + '.view';
  const read = () => {
    try { const s = storage && storage.getItem(key); const o = s ? JSON.parse(s) : null; return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
  };
  let cache = read();
  const get = (k, fallback) => (k in cache ? cache[k] : fallback);
  const set = (k, v) => {
    cache[k] = v;
    try { storage && storage.setItem(key, JSON.stringify(cache)); } catch (e) { /* a full or blocked store just means it is not remembered */ }
    return v;
  };
  return { get, set, key, all: () => ({ ...cache }) };
}
