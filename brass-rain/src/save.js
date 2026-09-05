// ---------------------------------------------------------------------------
// Saving.
//
// A save is the whole parlour: what the floor owns, what the technician has
// learned, and the run in progress down to every ball still falling and every
// nail that has been leaned. A page closed in the middle of a fever reopens in
// the middle of that fever.
//
// Three rules, each of which is a way a save has gone wrong before:
//
//   A save that cannot be read is discarded, never half-applied. Half a save
//   is a game in a state no code was written for.
//
//   A version that is not this version is not read at all. Guessing at an
//   older shape is how a player's parlour quietly becomes somebody else's.
//
//   Nothing here throws. Storage can be full, disabled, or holding something
//   another program wrote, and none of those may stop the game from starting.
// ---------------------------------------------------------------------------

import { signBlob } from './nights.js?v=71';
import { serializeBends, restoreBends } from './board.js?v=71';
import { serializeBalls, restoreBalls } from './physics.js?v=71';
import { serializeFloor, restoreFloor } from './floor.js?v=71';
import { serializeQuality } from './quality.js?v=71';

export function saveKey(cfg) { return cfg.identity.storagePrefix + ':save'; }

/** The whole parlour as plain data. */
export function serialize(cfg, game) {
  const run = game.run;
  return {
    version: cfg.save.version,
    at: Date.now(),
    meta: game.metaModule && game.metaModule.serializeMeta ? game.metaModule.serializeMeta(game.meta) : (game.meta || null),
    floor: serializeFloor(game.floor),
    quality: serializeQuality(game.quality),
    run: run ? {
      seed: run.seed,
      round: run.round,
      phase: run.phase,
      quota: run.quota,
      won: run.won,
      tray: run.tray,
      launched: run.launched,
      budget: run.budget,
      lent: run.lent,
      strength: run.strength,
      auto: run.auto,
      speed: run.speed,
      time: run.time,
      over: run.over,
      // The bench: which hand this round deals, and how many rerolls have been
      // paid for. Both are needed or a reopened bench is a free reroll.
      shopSeed: run.shopSeed,
      rerolls: Math.max(0, Math.floor(game.rerolls || 0)),
      fever: { ...run.fever },
      // The windows turning beside the centre are not written down one by
      // one: they go back on the queue, so a run resumes owing exactly the
      // spins it owed and none of them is lost to a reload.
      reel: {
        ...run.reel,
        digits: Array.from(run.reel.digits),
        around: undefined,
        plan: undefined,
        spinning: false,
        // A spin still turning when the game was put down goes back on the
        // queue with the rest, so it is turned again rather than resumed
        // halfway through a decision that was not written down.
        queued: run.reel.queued + run.reel.around.length + (run.reel.spinning ? 1 : 0),
      },
      fittings: run.fittings.slice(),
      mods: { ...run.mods },
      stats: { ...run.stats },
      bends: serializeBends(run.board),
      balls: serializeBalls(run.balls),
      landing: Array.from(run.landing),
      landingLast: Array.from(run.landingLast),
      landingPaid: Array.from(run.landingPaid),
      landingPaidLast: Array.from(run.landingPaidLast),
      log: run.log.slice(-16),
      bendsLeft: run.bendsLeft,
    } : null,
  };
}

/** Writes a save. Returns whether it landed. */
export function write(cfg, game, storage) {
  if (!storage) return false;
  try {
    // The save is signed with this browser's salt. A save edited by hand no
    // longer matches, still loads, and the nights it produces stay off the board.
    const obj = serialize(cfg, game);
    const body = JSON.stringify(obj);
    obj.sig = signBlob(body, storage);
    storage.setItem(saveKey(cfg), JSON.stringify(obj));
    return true;
  } catch (e) {
    // Storage can be full or switched off. Neither is worth interrupting play.
    return false;
  }
}

/** Reads a save, or null. Never throws, whatever is in storage. */
export function read(cfg, storage) {
  if (!storage) return null;
  let raw;
  try { raw = storage.getItem(saveKey(cfg)); } catch (e) { return null; }
  if (!raw) return null;
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { return null; }
  if (!obj || typeof obj !== 'object') return null;
  if (obj.version !== cfg.save.version) return null;
  // Trusted when it carries this browser's signature over its own body. A save
  // from before signing began carries none and is taken as it is; a save that
  // carries one that does not match was changed after it was written.
  if (obj.sig === undefined) obj.trusted = true;
  else {
    const sig = obj.sig;
    delete obj.sig;
    obj.trusted = sig === signBlob(JSON.stringify(obj), storage);
  }
  return obj;
}

export function clear(cfg, storage) {
  try { if (storage) storage.removeItem(saveKey(cfg)); } catch (e) { /* nothing to do */ }
}

/** Puts a saved run back into a freshly created one. Returns whether it fit. */
export function restoreRun(cfg, run, obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (!Number.isFinite(obj.seed) || obj.seed >>> 0 !== run.seed) return false;

  run.round = int(obj.round, 1);
  run.phase = typeof obj.phase === 'string' ? obj.phase : run.phase;
  run.quota = int(obj.quota, run.quota);
  run.won = int(obj.won, 0);
  run.tray = int(obj.tray, 0);
  run.launched = int(obj.launched, 0);
  run.budget = int(obj.budget, run.budget);
  run.lent = int(obj.lent, 0);
  run.strength = clampNum(obj.strength, cfg.launch.strengthMin, cfg.launch.strengthMax, cfg.launch.strength);
  run.auto = !!obj.auto;
  run.speed = clampNum(obj.speed, 0.25, 8, 1);
  run.time = num(obj.time, 0);
  run.over = !!obj.over;
  run.bendsLeft = int(obj.bendsLeft, cfg.board.bendsPerRound);
  run.shopSeed = int(obj.shopSeed, run.shopSeed) >>> 0;

  if (obj.fever) {
    run.fever.active = !!obj.fever.active;
    // Whether the pocket is already running on the window the parts left
    // behind it. Without this a reload in the middle of one asks them for
    // another.
    run.fever.trailing = !!obj.fever.trailing;
    run.fever.ballsLeft = int(obj.fever.ballsLeft, 0);
    run.fever.chain = int(obj.fever.chain, 0);
    run.fever.mult = num(obj.fever.mult, 1);
  }
  if (obj.reel) {
    run.reel.spinning = !!obj.reel.spinning;
    run.reel.t = num(obj.reel.t, 0);
    run.reel.queued = int(obj.reel.queued, 0);
    run.reel.around.length = 0;
    run.reel.holdT = num(obj.reel.holdT, 0);
    run.reel.result = typeof obj.reel.result === 'string' ? obj.reel.result : null;
    if (Array.isArray(obj.reel.digits)) {
      for (let i = 0; i < 3; i++) run.reel.digits[i] = int(obj.reel.digits[i], 0);
    }
  }
  if (Array.isArray(obj.fittings)) run.fittings = obj.fittings.filter(id => typeof id === 'string');
  if (obj.mods && typeof obj.mods === 'object') {
    for (const k of Object.keys(run.mods)) {
      if (Number.isFinite(obj.mods[k])) run.mods[k] = obj.mods[k];
    }
  }
  if (obj.stats && typeof obj.stats === 'object') {
    for (const k of Object.keys(run.stats)) {
      if (Number.isFinite(obj.stats[k])) run.stats[k] = obj.stats[k];
    }
  }
  restoreBends(run.board, obj.bends);
  restoreBalls(run.balls, obj.balls);
  copyCounts(run.landing, obj.landing);
  copyCounts(run.landingLast, obj.landingLast);
  copyCounts(run.landingPaid, obj.landingPaid);
  copyCounts(run.landingPaidLast, obj.landingPaidLast);
  if (Array.isArray(obj.log)) {
    run.log.length = 0;
    for (const line of obj.log) {
      if (line && typeof line.text === 'string') run.log.push({ kind: String(line.kind || ''), text: line.text, t: num(line.t, 0) });
    }
  }
  // The attacker's flap is not saved on its own; it is whatever the fever says
  // it should be, so a save can never reopen holding a pocket the run has no
  // reason to have open.
  const attacker = run.board.pockets.find(p => p.id === 'attacker');
  if (attacker) attacker.open = run.fever.active;
  return true;
}

export { restoreFloor };

function num(v, fallback) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function int(v, fallback) { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : fallback; }
function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n < lo ? lo : n > hi ? hi : n;
}
function copyCounts(target, arr) {
  if (!Array.isArray(arr)) return;
  for (let i = 0; i < target.length && i < arr.length; i++) {
    const n = Number(arr[i]);
    target[i] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
}
