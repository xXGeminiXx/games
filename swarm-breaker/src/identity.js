// VENDORED FROM THE GAME ART FOUNDATION.
// Source: /mnt/c/Personal/game-art lib/identity.js at commit 1fe237d (2026-08-29).
// Copied, not imported: every game here is a self-contained static page, so
// the foundation is a template rather than a library. A fix lands there first
// with a test and is carried across; `node tools/vendor-diff.js <game>/src` in
// that repo says which copies have drifted. Edit this file only to carry a
// fix, and record the drift if the change is deliberate.

// ---------------------------------------------------------------------------
// Who a player is, without an account.
//
// The device makes one P-256 keypair the first time the game runs and keeps
// it in IndexedDB. The player id is the hash of the public key, so it is
// derived rather than assigned: no sign-up, no email, no server that has to
// hand out names and no way for two devices to claim the same id by
// accident. Every run posted to a board carries a signature, so a board can
// tell "the same player as yesterday" from "somebody typing that name".
//
// What this does NOT do, deliberately: it does not stop cheating. A player
// who edits their own score still signs it with their own key, and the
// signature proves only that the claim came from that identity. Boards fed
// by this are labelled unverified unless a server replays the run.
//
// The private key is stored as a CryptoKey, so it is never a string in
// localStorage and never crosses a JSON boundary. It IS generated
// extractable, because a claim string is the only way a player moves to a
// new phone without losing their history; that is the cost, and it means
// script running on the origin could lift the key. Pass
// { extractable: false } for a game that will never offer a claim.
// ---------------------------------------------------------------------------

const DB_NAME = 'game-identity';
const STORE = 'keys';
const CLAIM_PREFIX = 'claim1';
const KDF_ITERATIONS = 310000;
const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' };

function subtle() {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new Error('WebCrypto is unavailable: serve the page over https or localhost');
  return s;
}

function randomBytes(n) {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function b64u(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoaSafe(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atobSafe(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// btoa and atob exist in browsers and in node 16 and later; Buffer is the
// fallback for any runtime that only has the node side.
function btoaSafe(s) {
  if (typeof btoa === 'function') return btoa(s);
  return Buffer.from(s, 'binary').toString('base64');
}
function atobSafe(s) {
  if (typeof atob === 'function') return atob(s);
  return Buffer.from(s, 'base64').toString('binary');
}

function utf8(str) { return new TextEncoder().encode(str); }

function bytesOf(payload) {
  if (typeof payload === 'string') return utf8(payload);
  if (payload instanceof Uint8Array) return payload;
  if (ArrayBuffer.isView(payload)) return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  throw new Error('payload must be a string or bytes');
}

// The id every board keys on: base64url of the SHA-256 of the public key's
// 65 uncompressed point bytes. 43 characters, stable forever, and anybody
// holding the public key can recompute it and check a submission is not
// wearing someone else's name.
export async function playerIdFor(publicKey) {
  const raw = typeof publicKey === 'string' ? unb64u(publicKey) : bytesOf(publicKey);
  return b64u(new Uint8Array(await subtle().digest('SHA-256', raw)));
}

export async function verify(publicKey, payload, signature) {
  try {
    const raw = typeof publicKey === 'string' ? unb64u(publicKey) : bytesOf(publicKey);
    const key = await subtle().importKey('raw', raw, ALG, true, ['verify']);
    const sig = typeof signature === 'string' ? unb64u(signature) : bytesOf(signature);
    return await subtle().verify(SIGN_ALG, key, sig, bytesOf(payload));
  } catch (e) {
    return false;
  }
}

// ---- storage -------------------------------------------------------------

const memoryStore = new Map();

function memoryStorage() {
  return {
    kind: 'memory',
    async get(key) { return memoryStore.get(key) || null; },
    async put(key, value) { memoryStore.set(key, value); },
    async del(key) { memoryStore.delete(key); },
  };
}

// IndexedDB keeps CryptoKey objects as themselves through the structured
// clone, which is the whole reason it is used here instead of localStorage.
function idbStorage() {
  const open = () => new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    try {
      return await new Promise((res, rej) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    } finally { db.close(); }
  };
  return {
    kind: 'indexeddb',
    get: (key) => tx('readonly', (s) => s.get(key)),
    put: (key, value) => tx('readwrite', (s) => s.put(value, key)),
    del: (key) => tx('readwrite', (s) => s.delete(key)),
  };
}

function pickStorage() {
  try {
    if (typeof indexedDB !== 'undefined' && indexedDB) return idbStorage();
  } catch (e) { /* private mode can throw on access */ }
  return memoryStorage();
}

// ---- the identity --------------------------------------------------------

// Loads the device's identity, creating it on first run. `appId` separates
// games sharing an origin, so two games on the same Pages site are two
// players rather than one.
export async function identity({ appId = 'game', extractable = true, storage = null } = {}) {
  const store = storage || pickStorage();
  let record = null;
  try { record = await store.get(appId); } catch (e) { record = null; }

  if (!record || !record.privateKey || !record.publicKey) {
    const pair = await subtle().generateKey(ALG, extractable, ['sign', 'verify']);
    record = { privateKey: pair.privateKey, publicKey: pair.publicKey, created: new Date().toISOString() };
    try { await store.put(appId, record); } catch (e) { /* a full or blocked quota is not fatal: this run still has a key */ }
  }

  return wrap(appId, record, store);
}

async function wrap(appId, record, store) {
  const raw = new Uint8Array(await subtle().exportKey('raw', record.publicKey));
  const publicKey = b64u(raw);
  const playerId = await playerIdFor(raw);

  return {
    appId,
    playerId,
    publicKey,
    created: record.created,
    storage: store.kind,

    // Signature over the exact bytes given. Callers must build the payload
    // string in a fixed order and hand the same string to the verifier;
    // JSON.stringify of an object is not that, because key order is a
    // property of how the object was built.
    async sign(payload) {
      const sig = await subtle().sign(SIGN_ALG, record.privateKey, bytesOf(payload));
      return b64u(new Uint8Array(sig));
    },

    async verify(payload, signature) {
      return verify(publicKey, payload, signature);
    },

    // A move-to-another-device string. Shape:
    //   claim1.<header>.<ciphertext>.<signature>     all base64url
    // The header is readable and names the public key, the id and the KDF
    // parameters. The ciphertext is the PKCS8 private key sealed with
    // AES-GCM under a key derived from the passphrase by PBKDF2-SHA256.
    // The signature is made by the identity itself over header + '.' +
    // ciphertext, so a reader can tell a genuine claim from a corrupted or
    // edited one before spending the KDF, and cannot swap in a public key
    // that is not the one inside.
    //
    // The string is safe to email to yourself and useless to anyone who
    // does not have the passphrase: what leaks is the public key and the
    // fact this identity exists, both already public on any board.
    async exportClaim(passphrase) {
      if (typeof passphrase !== 'string' || passphrase.length < 8) {
        throw new Error('a claim needs a passphrase of at least 8 characters');
      }
      let pkcs8;
      try {
        pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', record.privateKey));
      } catch (e) {
        throw new Error('this identity was created non-extractable, so it cannot be claimed on another device');
      }
      const salt = randomBytes(16);
      const iv = randomBytes(12);
      const aes = await deriveAes(passphrase, salt, KDF_ITERATIONS);
      const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, aes, pkcs8));
      pkcs8.fill(0);
      const header = b64u(utf8(JSON.stringify({
        v: 1, alg: 'ECDSA-P-256', kdf: 'PBKDF2-SHA-256', iter: KDF_ITERATIONS,
        salt: b64u(salt), iv: b64u(iv), pub: publicKey, id: playerId, app: appId,
      })));
      const sig = await this.sign(header + '.' + b64u(ct));
      return [CLAIM_PREFIX, header, b64u(ct), sig].join('.');
    },

    async forget() { await store.del(appId); },
  };
}

async function deriveAes(passphrase, salt, iterations) {
  const base = await subtle().importKey('raw', utf8(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Read a claim's header without the passphrase, to show the player which
// identity a pasted string would install before they commit to it.
export function inspectClaim(claim) {
  const parts = String(claim).trim().split('.');
  if (parts.length !== 4 || parts[0] !== CLAIM_PREFIX) throw new Error('not a claim string');
  const header = JSON.parse(new TextDecoder().decode(unb64u(parts[1])));
  if (header.v !== 1) throw new Error('claim version ' + header.v + ' is not supported');
  return header;
}

// Install a claim on this device. Every failure is distinguishable: a
// mangled string, a wrong passphrase, and a claim whose key does not match
// the public key it advertises are three different problems and the player
// can only act on one of them.
export async function importClaim(claim, passphrase, { storage = null, appId = null } = {}) {
  const parts = String(claim).trim().split('.');
  const header = inspectClaim(claim);
  const [, headerB64, ctB64, sigB64] = parts;

  if (!(await verify(header.pub, headerB64 + '.' + ctB64, sigB64))) {
    throw new Error('this claim is damaged or was edited: its signature does not match its contents');
  }
  const expectedId = await playerIdFor(header.pub);
  if (expectedId !== header.id) throw new Error('this claim names an id that is not the hash of its public key');

  const aes = await deriveAes(passphrase, unb64u(header.salt), header.iter || KDF_ITERATIONS);
  let pkcs8;
  try {
    pkcs8 = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64u(header.iv) }, aes, unb64u(ctB64)));
  } catch (e) {
    throw new Error('wrong passphrase');
  }
  const privateKey = await subtle().importKey('pkcs8', pkcs8, ALG, true, ['sign']);
  pkcs8.fill(0);
  const publicKey = await subtle().importKey('raw', unb64u(header.pub), ALG, true, ['verify']);

  // Prove the two halves belong together rather than trusting the header.
  const probe = utf8('claim-probe:' + header.id);
  const proof = new Uint8Array(await subtle().sign(SIGN_ALG, privateKey, probe));
  if (!(await subtle().verify(SIGN_ALG, publicKey, proof, probe))) {
    throw new Error('the key inside this claim is not the one it advertises');
  }

  const id = appId || header.app || 'game';
  const store = storage || pickStorage();
  const record = { privateKey, publicKey, created: header.created || new Date().toISOString() };
  try { await store.put(id, record); } catch (e) { /* this run still has the identity even if it cannot be kept */ }
  return wrap(id, record, store);
}

export default { identity, importClaim, inspectClaim, verify, playerIdFor, b64u, unb64u };
