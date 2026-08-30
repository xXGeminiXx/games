// ---------------------------------------------------------------------------
// Saving.
//
// A save is the whole run: the ground, the works, every live mote, the
// Melt's traits and the bookkeeping, so a page closed in the middle of a
// surge reopens in the middle of that surge. The cross-run record (best
// surge, awards) lives under its own key and survives a new run.
// ---------------------------------------------------------------------------

import { createRun, refreshFlow, emptyMeta, logLine } from './run.js?v=9';
import { serializeMotes, restoreMotes } from './motes.js?v=9';
import { serializeWorks, restoreWorks } from './works.js?v=9';
import { surgePlan, ebbPlan, forecast, emptyTelemetry } from './melt.js?v=9';

const PREFIX = 'FL1:';

export function serialize(state) {
  return {
    version: state.cfg.save.version,
    seed: state.seed,
    surge: state.surge,
    phase: state.phase,
    timer: state.timer,
    ore: state.ore,
    hearthHp: state.hearthHp,
    traits: state.traits,
    spawnLeft: state.spawnLeft,
    spawnAcc: state.spawnAcc,
    spawnPerSecond: state.spawnPerSecond,
    ebbT: state.ebbT,
    telemetry: state.telemetry,
    lastTelemetry: state.lastTelemetry,
    change: state.change,
    log: state.log.slice(-12),
    speed: state.speed,
    time: state.time,
    stats: state.stats,
    over: state.over,
    heights: Array.from(state.terrain.h),
    works: serializeWorks(state.works),
    motes: serializeMotes(state.pool),
  };
}

/** A run rebuilt from a serialized one, or null when it cannot be read. */
export function restore(cfg, obj, meta) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.version !== cfg.save.version) return null;
  if (!Number.isFinite(obj.seed) || !Array.isArray(obj.heights)) return null;
  const state = createRun(cfg, obj.seed, meta);
  if (obj.heights.length !== state.terrain.h.length) return null;
  state.log.length = 0;

  for (let i = 0; i < obj.heights.length; i++) {
    // Fixed cells keep the height the field gives them whatever the save says.
    if (state.terrain.kind[i] === 0) state.terrain.h[i] = obj.heights[i] | 0;
  }
  state.terrain.version++;
  if (obj.works) restoreWorks(cfg, state.works, state.terrain, obj.works);
  if (obj.motes) restoreMotes(state.pool, cfg, obj.motes);

  state.surge = obj.surge | 0 || 1;
  state.phase = obj.phase === 'surge' || obj.phase === 'over' ? obj.phase : 'countdown';
  state.timer = Number.isFinite(obj.timer) ? obj.timer : cfg.surge.countdownSeconds;
  state.ore = Number.isFinite(obj.ore) ? obj.ore : cfg.economy.startOre;
  state.hearthHp = Number.isFinite(obj.hearthHp) ? obj.hearthHp : cfg.hearth.hp;
  state.traits = (obj.traits >>> 0) || 0;
  state.spawnLeft = obj.spawnLeft | 0;
  state.spawnAcc = Number.isFinite(obj.spawnAcc) ? obj.spawnAcc : 0;
  state.spawnPerSecond = Number.isFinite(obj.spawnPerSecond) ? obj.spawnPerSecond : 1;
  state.ebbT = Number.isFinite(obj.ebbT) ? obj.ebbT : cfg.ebb.intervalSeconds;
  state.telemetry = Object.assign(emptyTelemetry(), obj.telemetry || {});
  state.lastTelemetry = obj.lastTelemetry || null;
  state.change = obj.change || null;
  state.speed = cfg.sim.speeds.includes(obj.speed) ? obj.speed : 1;
  state.time = Number.isFinite(obj.time) ? obj.time : 0;
  state.over = !!obj.over;
  if (obj.stats && typeof obj.stats === 'object') Object.assign(state.stats, obj.stats);
  if (Array.isArray(obj.log)) for (const l of obj.log) if (l && l.text) state.log.push({ text: String(l.text), cls: l.cls || 'dim', t: l.t || 0 });

  state.plan = surgePlan(cfg, state.surge, state.traits);
  state.ebb = ebbPlan(cfg, surgePlan(cfg, state.surge, 0));
  state.forecast = forecast(cfg, state.plan, state.traits, state.change, state.lastTelemetry || emptyTelemetry());
  state.flowVersion = '';
  refreshFlow(state);
  logLine(state, cfg.text.log.loaded, { n: state.surge });
  return state;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function loadMeta(storage, key) {
  const meta = emptyMeta();
  try {
    const raw = storage.getItem(key);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        if (Number.isFinite(obj.bestReached)) meta.bestReached = obj.bestReached;
        if (Array.isArray(obj.awards)) meta.awards = obj.awards.filter(a => typeof a === 'string');
        if (Number.isFinite(obj.runs)) meta.runs = obj.runs;
        if (Number.isFinite(obj.totalSurges)) meta.totalSurges = obj.totalSurges;
      }
    }
  } catch (e) { /* an unreadable record is an empty one */ }
  return meta;
}

export function saveMeta(storage, key, meta) {
  try { storage.setItem(key, JSON.stringify(meta)); return true; } catch (e) { return false; }
}

export function loadSave(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

export function storeSave(storage, key, state) {
  try { storage.setItem(key, JSON.stringify(serialize(state))); return true; } catch (e) { return false; }
}

export function clearSave(storage, key) {
  try { storage.removeItem(key); } catch (e) { /* nothing to clear */ }
}

/** A pasteable string carrying the run and the record. */
export function exportString(state) {
  const body = JSON.stringify({ run: serialize(state), meta: state.meta });
  return PREFIX + toBase64(body);
}

/** The run and the record out of a pasted string, or null. */
export function importString(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim();
  if (!s.startsWith(PREFIX)) return null;
  try {
    const obj = JSON.parse(fromBase64(s.slice(PREFIX.length)));
    if (!obj || typeof obj !== 'object' || !obj.run) return null;
    return { run: obj.run, meta: obj.meta || null };
  } catch (e) { return null; }
}

function toBase64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  if (typeof btoa === 'function') return btoa(bin);
  return Buffer.from(bin, 'binary').toString('base64');
}

function fromBase64(s) {
  const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
