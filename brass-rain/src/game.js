// ---------------------------------------------------------------------------
// The game.
//
// One machine on the floor of a parlour. The player works the handle, reads
// the nails, leans a few of them, and between rounds bolts parts into the
// face. What the tray is worth at the counter buys more machines, and the
// machines earn while the handle is still.
//
// This file owns the clock and nothing else. Every rule lives in the module it
// belongs to; what happens here is the order things happen in, which is the
// one thing that cannot live anywhere else.
// ---------------------------------------------------------------------------

import { loadConfig } from '../config.js?v=3';
import { createRun, stepRun, createOut, startRound, pullHandle, quotaFor, quotaRate,
         matchChance, continueChance, ballsPerPull, logLine, launchesLeft,
         budgetFor, clearBonusFor, pullsLeft, pullsFor, useCabinet,
         PHASE_PLAY, PHASE_SETTLE, PHASE_SHOP, PHASE_OVER } from './run.js?v=3';
import { createFloor, tickFloor, cashOut, buyMachine, hireAttendant, quote,
         attendantPrice, floorIncome, machineIncome, milestoneMult, nextMilestone,
         handMult, restoreFloor } from './floor.js?v=3';
import { createQuality, observe, renderQuality, resetMeasurement, restoreQuality } from './quality.js?v=3';
import { createBench, buildMods, partnersFor, fire as fireHook, hasHook } from './hooks.js?v=3';
import { fitMachine, buildFittedBoard, runConfig } from './parts.js?v=3';
import { nailNear, bendNail, bendCheck, straighten, nailPos } from './board.js?v=3';
import { rng as makeRng } from './rng.js?v=3';
import { offerCabinets } from './cabinets.js?v=3';
import * as Save from './save.js?v=3';

export const VIEW_MACHINE = 'machine';
export const VIEW_BENCH = 'bench';
export const VIEW_FLOOR = 'floor';

/**
 * Builds a game.
 *
 * The catalogue of fittings and the permanent record are loaded rather than
 * imported so that a machine missing one of them is a machine without that
 * feature, not a blank page.
 */
export async function createGame(opts) {
  const options = opts || {};
  const cfg = options.cfg || loadConfig(
    typeof location !== 'undefined' ? location.search : '',
    safeStorage(options.storage),
  );
  const storage = safeStorage(options.storage);

  const catalogue = await optional('./fittings.js?v=3');
  const metaModule = await optional('./meta.js?v=3');
  const bench = createBench(catalogue || {});

  const game = {
    cfg,
    storage,
    catalogue,
    metaModule,
    bench,
    view: VIEW_MACHINE,
    floor: createFloor(cfg),
    quality: createQuality(cfg),
    meta: metaModule && metaModule.createMeta ? metaModule.createMeta() : { marks: 0, nodes: {} },
    run: null,
    runCfg: runConfig(cfg),
    out: createOut(),
    offer: null,
    offerRng: makeRng('shop:' + Date.now()),
    rerolls: 0,
    notes: [],
    away: null,
    listeners: [],
    lastSave: 0,
    lastFrame: 0,
    running: false,
    scene: null,
    onChange: options.onChange || null,
  };

  const saved = Save.read(cfg, storage);
  if (saved) loadSave(game, saved);
  else newRun(game, (Math.random() * 1e9) | 0);

  return Object.assign(game, api(game));
}

/** Fires one moment at a run's parts. */
function fireMoment(run, name, ctx) {
  if (!run || !run.bench || !hasHook(run.bench, run.fittings, name)) return null;
  fireHook(run.bench, run.fittings, name, ctx);
  return ctx;
}

async function optional(path) {
  try { return await import(path); } catch (e) { return null; }
}

function safeStorage(given) {
  if (given !== undefined) return given;
  try {
    if (typeof localStorage === 'undefined') return null;
    localStorage.setItem('__t', '1'); localStorage.removeItem('__t');
    return localStorage;
  } catch (e) { return null; }
}

/** What prestige is worth right now, or nothing when there is no such layer. */
function metaEffects(game) {
  const m = game.metaModule;
  if (m && typeof m.effects === 'function') {
    try { return m.effects(game.meta); } catch (e) { /* fall through */ }
  }
  return {};
}

/**
 * The permanent effects, in the words the run uses.
 *
 * Several of them are named for what the player was promised rather than for
 * the lever that delivers it - a discount on the quota is a multiplier under
 * it, a bonus to the tray is a larger grant. Translating them in one place is
 * the difference between an upgrade working and an upgrade being bought,
 * costing marks, and silently doing nothing at all.
 */
function metaMods(eff) {
  const out = {};
  if (Number.isFinite(eff.trayBonus)) out.trayGrant = eff.trayBonus;
  if (Number.isFinite(eff.quotaDiscount) && eff.quotaDiscount > 0 && eff.quotaDiscount < 1) {
    out.quotaMult = 1 - eff.quotaDiscount;
  }
  for (const k of ['matchBonus', 'continueBonus', 'feverBalls', 'launchPer', 'spinsPerGate']) {
    if (Number.isFinite(eff[k])) out[k] = eff[k];
  }
  return out;
}

/** Rebuilds the machine from what is bolted into it. */
export function refit(game, seed) {
  const eff = metaEffects(game);
  const ids = game.pendingFittings || (game.run ? game.run.fittings : []);
  const fitted = fitMachine(game.cfg, game.catalogue || {}, ids, eff);
  addEarnedPockets(fitted.cfg, eff);
  game.runCfg = fitted.cfg;
  game.notes = fitted.notes;
  game.shape = fitted.shape;
  const modsFromParts = fitted.mods;
  const mods = buildMods(game.cfg, game.bench, ids, mergeMods(modsFromParts, metaMods(eff)));
  return { cfg: fitted.cfg, mods, shape: fitted.shape, seed };
}

/**
 * Puts the mouths the technician has earned onto the face.
 *
 * They are added to the configuration before the board is built, because the
 * nail layout keeps its distance from whatever furniture is already there. A
 * pocket added afterwards would have nails standing in it.
 */
function addEarnedPockets(cfg, eff) {
  if (Number.isFinite(eff && eff.bendReach) && eff.bendReach > 0) {
    cfg.board.bendReach = Math.round((cfg.board.bendReach + eff.bendReach) * 100) / 100;
  }
  if (Number.isFinite(eff && eff.idleHours) && eff.idleHours > 0) {
    cfg.floor.idleCap = cfg.floor.idleCap + eff.idleHours * 3600;
  }
  const extra = eff && Array.isArray(eff.extraPockets) ? eff.extraPockets : null;
  if (!extra || !extra.length) return;
  for (const p of extra) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.kind === 'gate') {
      cfg.board.extraGates = cfg.board.extraGates || [];
      cfg.board.extraGates.push({ ...p });
      continue;
    }
    if (cfg.board.payPockets.some(q => q.id === p.id)) continue;
    cfg.board.payPockets.push({
      id: p.id, x: p.x, y: p.y,
      w: Number.isFinite(p.w) ? p.w : 3.6,
      h: Number.isFinite(p.h) ? p.h : 2.2,
      pay: Number.isFinite(p.pay) ? p.pay : 3,
      tone: p.tone || 'enamel',
    });
  }
  if (Number.isFinite(eff.gateWidth) && eff.gateWidth > 0) {
    cfg.board.gate.w = Math.round((cfg.board.gate.w + eff.gateWidth) * 100) / 100;
  }
}

function mergeMods(a, b) {
  const out = {};
  for (const k of Object.keys(a || {})) out[k] = a[k];
  if (b && typeof b === 'object') {
    const MULT = new Set(['payMult', 'gatePayMult', 'feverMult', 'launchRate', 'quotaMult', 'scatter', 'ballWorth']);
    for (const k of Object.keys(b)) {
      const v = Number(b[k]);
      if (!Number.isFinite(v)) continue;
      if (k in out) out[k] = MULT.has(k) ? out[k] * v : out[k] + v;
    }
  }
  return out;
}

export function newRun(game, seed, withFittings) {
  // Parts can be named up front. The machine is then fitted around them
  // before the board is laid, which is the only order that works: the nail
  // layout keeps clear of whatever furniture a part adds, and furniture added
  // after the nails would have nails standing in it.
  game.pendingFittings = Array.isArray(withFittings) ? withFittings.slice() : null;
  const fitted = refit(game, seed);
  const ids = game.pendingFittings ? game.pendingFittings.slice() : [];
  game.run = createRun(fitted.cfg, seed >>> 0, game.meta, {
    bench: game.bench, model: modelFor(game, ids), fittings: ids, mods: fitted.mods,
  });
  game.run.board = buildFittedBoard(fitted.cfg, seed >>> 0, fitted.shape);
  useCabinet(fitted.cfg, game.run.board);
  // Anything the technician has learned to bolt in before the night starts is
  // bolted in now, and the machine is then refitted around it. An id that is
  // not in the catalogue is dropped without a word.
  const start = game.pendingFittings ? null : metaEffects(game).startFittings;
  if (Array.isArray(start) && start.length) {
    game.run.fittings = start.filter(id => game.bench.byId.has(id));
    if (game.run.fittings.length) {
      const again = refit(game, seed);
      game.runCfg = again.cfg;
      game.run.cfg = again.cfg;
      game.run.mods = again.mods;
      game.run.model = catalogueModel(game);
      game.run.board = buildFittedBoard(again.cfg, seed >>> 0, again.shape);
      useCabinet(again.cfg, game.run.board);
    }
  }
  game.run.bendsLeft = bendsPerRound(game);
  game.run.strength = fitted.cfg.launch.strength;
  // The first round is opened by createRun. Opening it again here would hand
  // over a second tray, which is a machine that starts the night owing nobody
  // anything and is the kind of fault that only shows up as a number being
  // slightly too kind.
  game.view = VIEW_MACHINE;
  game.offer = null;
  game.rerolls = 0;
  game.pendingFittings = null;
  return game.run;
}

function bendsPerRound(game) {
  const eff = metaEffects(game);
  const extra = Number.isFinite(eff.bendsPerRound) ? eff.bendsPerRound : 0;
  return Math.max(0, game.cfg.board.bendsPerRound + extra);
}

/** Puts the machine back on the bench between rounds. */
function openBench(game) {
  const run = game.run;
  game.view = VIEW_BENCH;
  run.bendsLeft = bendsPerRound(game);
  game.rerolls = 0;
  rollOffer(game);
}

export function rollOffer(game) {
  const cat = game.catalogue;
  const run = game.run;
  // Parts that change the shop get their say before it is rolled.
  game.shopTerms = { rerollCost: null, rerollStep: null, freeRerolls: 0, guarantee: null };
  if (run && run.bench) {
    const ctx = {
      model: null, state: run.scratch, stats: run.counters, rand: run.rng.next, disable: false,
      shop: { offers: game.runCfg.shop.offers, rerollCost: game.cfg.shop.rerollCost,
              rerollStep: game.cfg.shop.rerollGrowth, freeRerolls: 0,
              slots: game.runCfg.shop.slots, guarantee: null },
    };
    fireMoment(run, 'onShopOpen', ctx);
    game.shopTerms = ctx.shop;
  }
  if (!cat || typeof cat.rollOffer !== 'function') { game.offer = []; return; }
  const eff = metaEffects(game);
  const count = Math.max(1, Math.round(game.runCfg.shop.offers + (eff.shopOffers || 0)));
  let list = [];
  try {
    list = cat.rollOffer(game.offerRng.next, run.fittings, game.cfg.shop.rarityWeights, count) || [];
  } catch (e) {
    list = [];
  }
  game.offer = list.map(f => ({
    fitting: f,
    partners: partnersFor(game.bench, run.fittings, f.id),
    price: priceOfFitting(game, f),
  }));
}

function priceOfFitting(game, f) {
  const eff = metaEffects(game);
  const discount = Number.isFinite(eff.rerollDiscount) ? eff.rerollDiscount : 0;
  return Math.max(1, Math.round((f.price || 10) * (1 - discount)));
}

function rerollPrice(game) {
  const s = game.cfg.shop;
  const terms = game.shopTerms || {};
  const freeLeft = Number.isFinite(terms.freeRerolls) ? terms.freeRerolls : 0;
  if (freeLeft > game.rerolls) return 0;
  const baseCost = Number.isFinite(terms.rerollCost) && terms.rerollCost > 0 ? terms.rerollCost : s.rerollCost;
  const step = Number.isFinite(terms.rerollStep) && terms.rerollStep > 0 ? terms.rerollStep : s.rerollGrowth;
  const fallback = Math.max(0, Math.round(baseCost * Math.pow(step, Math.max(0, game.rerolls - freeLeft))));
  const cat = game.catalogue;
  if (cat && typeof cat.rerollCost === 'function') {
    try {
      const price = Math.round(cat.rerollCost(catalogueModel(game), game.rerolls));
      // A price that is not a number would be spent anyway and would take the
      // whole tray with it. Anything that is not a real price is not a price.
      if (Number.isFinite(price) && price >= 0) return price;
    } catch (e) { /* fall through to the price this game sets itself */ }
  }
  return fallback;
}

/** The catalogue's own view of the machine, for the text and the prices. */
function catalogueModel(game) {
  return modelFor(game, game.run ? game.run.fittings : []);
}

/** The catalogue's view of a machine with these parts bolted in. */
function modelFor(game, ids) {
  const cat = game.catalogue;
  if (!cat || typeof cat.buildModel !== 'function') return null;
  try {
    const want = new Set(ids || []);
    return cat.buildModel((cat.FITTINGS || []).filter(f => want.has(f.id)));
  } catch (e) { return null; }
}

function loadSave(game, saved) {
  if (saved.meta && game.metaModule && game.metaModule.restoreMeta) {
    try { game.meta = game.metaModule.restoreMeta(saved.meta); } catch (e) { /* keep the fresh one */ }
  } else if (saved.meta) {
    game.meta = saved.meta;
  }
  game.floor = restoreFloor(game.cfg, saved.floor);
  restoreQuality(game.quality, saved.quality);

  if (saved.run && Number.isFinite(saved.run.seed)) {
    const seed = saved.run.seed >>> 0;
    const fitted = refit(game, seed);
    const savedIds = Array.isArray(saved.run.fittings) ? saved.run.fittings.filter(id => typeof id === 'string') : [];
    game.run = createRun(fitted.cfg, seed, game.meta, {
      bench: game.bench, model: modelFor(game, savedIds), fittings: savedIds, mods: fitted.mods,
    });
    game.run.board = buildFittedBoard(fitted.cfg, seed, fitted.shape);
    useCabinet(fitted.cfg, game.run.board);
    if (Array.isArray(saved.run.fittings)) {
      game.run.fittings = saved.run.fittings.slice();
      const again = refit(game, seed);
      game.runCfg = again.cfg;
      game.run.cfg = again.cfg;
      game.run.mods = again.mods;
      game.run.model = catalogueModel(game);
      game.run.board = buildFittedBoard(again.cfg, seed, again.shape);
      useCabinet(again.cfg, game.run.board);
    } else {
      game.run.mods = fitted.mods;
    }
    Save.restoreRun(game.runCfg, game.run, saved.run);
    game.view = game.run.phase === PHASE_SHOP ? VIEW_BENCH : VIEW_MACHINE;
    if (game.view === VIEW_BENCH) rollOffer(game);
  } else {
    newRun(game, (Math.random() * 1e9) | 0);
  }

  // Time away. Both numbers are kept and each is named for what it is, so the
  // sentence the player reads about how long they were gone is never the
  // sentence about how much of it was paid for.
  const at = Number(saved.at);
  if (Number.isFinite(at) && at > 0) {
    const seconds = Math.max(0, (Date.now() - at) / 1000);
    if (seconds > 20) game.away = tickFloor(game.cfg, game.floor, seconds, metaEffects(game));
  }
}

function api(game) {
  return {
    // ---- the handle ----------------------------------------------------
    pull() {
      if (game.view !== VIEW_MACHINE || game.run.phase !== PHASE_PLAY) return 0;
      const sent = pullHandle(game.run);
      changed(game);
      return sent;
    },
    setStrength(v) {
      const cfg = game.runCfg;
      if (cfg.launch.locked) return;
      const n = Number(v);
      if (!Number.isFinite(n)) return;
      game.run.strength = Math.min(cfg.launch.strengthMax, Math.max(cfg.launch.strengthMin, n));
      changed(game);
    },
    setAuto(on) { game.run.auto = !!on; changed(game); },
    setSpeed(v) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) game.run.speed = Math.min(8, Math.max(0.25, n));
      changed(game);
    },
    setPaused(on) { game.run.paused = !!on; changed(game); },

    // ---- the nails -----------------------------------------------------
    nailAt(x, y, reach) { return nailNear(game.run.board, x, y, reach === undefined ? 3 : reach); },
    nailPosition(i) { const n = game.run.board.nails[i]; return n ? nailPos(n) : null; },
    checkBend(i, x, y) { return bendCheck(game.runCfg, game.run.board, i, x, y); },
    bend(i, x, y) {
      if (game.view !== VIEW_BENCH) return { ok: false, why: 'the nails are set while the machine is on the bench' };
      if (game.run.bendsLeft <= 0) return { ok: false, why: 'no bends left this round' };
      const nail = game.run.board.nails[i];
      if (!nail) return { ok: false, why: 'no nail there' };
      const wasBent = nail.bx !== 0 || nail.by !== 0;
      const r = bendNail(game.runCfg, game.run.board, i, x, y);
      if (r.ok && !wasBent) game.run.bendsLeft--;
      if (r.ok) changed(game);
      return r;
    },
    straightenAll() { straighten(game.run.board); changed(game); },
    bendsLeft() { return game.run.bendsLeft; },

    // ---- the bench -----------------------------------------------------
    offers() { return game.offer || []; },
    rerollPrice() { return rerollPrice(game); },
    catalogueModel() { return catalogueModel(game); },
    reroll() {
      const price = rerollPrice(game);
      if (!Number.isFinite(price) || game.run.tray < price) return false;
      if (price === 0 && game.rerolls > 40) return false;
      game.run.tray -= price;
      game.rerolls++;
      rollOffer(game);
      changed(game);
      return true;
    },
    /**
     * Bolts an offered part in.
     *
     * Takes the part's id, or its position in the row. The id is the safer
     * one and the one the page uses: buying removes the offer, so a position
     * captured before a purchase points at something else after it.
     */
    buyFitting(which) {
      const list = game.offer || [];
      const index = typeof which === 'string'
        ? list.findIndex(o => o.fitting && o.fitting.id === which)
        : which;
      const offer = list[index];
      if (!offer) return { ok: false, why: 'nothing there' };
      const eff = metaEffects(game);
      const slots = Math.max(1, game.runCfg.shop.slots + (eff.shopSlots || 0));
      if (game.run.fittings.length >= slots) return { ok: false, why: 'every slot is full' };
      if (game.run.tray < offer.price) return { ok: false, why: 'not enough balls in the tray' };
      game.run.tray -= offer.price;
      game.run.fittings.push(offer.fitting.id);
      const fitted = refit(game, game.run.seed);
      game.runCfg = fitted.cfg;
      game.run.cfg = fitted.cfg;
      game.run.mods = fitted.mods;
      game.run.model = catalogueModel(game);
      const bends = serializeBendState(game.run.board);
      game.run.board = buildFittedBoard(fitted.cfg, game.run.seed, fitted.shape);
      useCabinet(fitted.cfg, game.run.board);
      restoreBendState(game.run.board, bends);
      game.offer.splice(index, 1);
      logLine(game.run, 'fitting', offer.fitting.name + ' bolted in');
      changed(game);
      return { ok: true, why: '' };
    },
    sellFitting(id) {
      const i = game.run.fittings.indexOf(id);
      if (i < 0) return false;
      game.run.fittings.splice(i, 1);
      const fitted = refit(game, game.run.seed);
      game.runCfg = fitted.cfg;
      game.run.cfg = fitted.cfg;
      game.run.mods = fitted.mods;
      game.run.model = catalogueModel(game);
      const bends = serializeBendState(game.run.board);
      game.run.board = buildFittedBoard(fitted.cfg, game.run.seed, fitted.shape);
      restoreBendState(game.run.board, bends);
      changed(game);
      return true;
    },
    leaveBench() {
      startRound(game.run, game.run.round + 1);
      game.run.bendsLeft = bendsPerRound(game);
      game.view = VIEW_MACHINE;
      game.offer = null;
      changed(game);
    },

    // ---- the counter and the floor -------------------------------------
    cashOutValue() { return game.run.tray * game.cfg.floor.cashRate * (metaEffects(game).cashMult || 1); },
    cashOut() {
      const balls = game.run.tray;
      if (balls <= 0) return 0;
      const got = cashOut(game.cfg, game.floor, balls, metaEffects(game));
      if (game.run.round - 1 > game.floor.bestRound) game.floor.bestRound = game.run.round - 1;
      game.run.tray = 0;
      newRun(game, (Math.random() * 1e9) | 0);
      save(game);
      changed(game);
      return got;
    },
    quoteMachine(id, want) { return quote(game.cfg, game.floor, id, want); },
    buyMachine(id, want) { const n = buyMachine(game.cfg, game.floor, id, want); if (n) changed(game); return n; },
    attendantPrice(id) { return attendantPrice(game.cfg, id); },
    hireAttendant(id) { const ok = hireAttendant(game.cfg, game.floor, id); if (ok) changed(game); return ok; },
    income() { return floorIncome(game.cfg, game.floor, metaEffects(game)); },
    machineIncome(id) { return machineIncome(game.cfg, game.floor, id, metaEffects(game)); },
    milestone(id) {
      const n = game.floor.owned[id] || 0;
      return { mult: milestoneMult(game.cfg, n), next: nextMilestone(game.cfg, n), owned: n };
    },
    handMultiplier() { return handMult(game.cfg, game.floor.bestRound); },

    // ---- prestige ------------------------------------------------------
    prestige() {
      const m = game.metaModule;
      if (!m || typeof m.applyReset !== 'function') return { ok: false, why: 'not yet' };
      const can = m.canReset(game.cfg, game.meta, game.floor);
      if (!can.ok) return can;
      const plan = m.applyReset(game.cfg, game.meta, game.floor) || {};
      const keptBest = plan.start && Number.isFinite(plan.start.bestRound)
        ? plan.start.bestRound : game.floor.bestRound;
      game.floor = createFloor(game.cfg);
      // A reset that took the deepest round with it would make every night
      // after the first worse than the first, so what the plan says to keep
      // is kept.
      game.floor.bestRound = keptBest;
      const start = plan.start && plan.start.machines;
      if (start && typeof start === 'object') {
        for (const id of Object.keys(start)) {
          const n = Number(start[id]);
          if (Number.isFinite(n) && n > 0 && id in game.floor.owned) game.floor.owned[id] = Math.floor(n);
        }
      }
      newRun(game, (Math.random() * 1e9) | 0);
      save(game);
      changed(game);
      return { ok: true, why: '' };
    },
    pendingMarks() {
      const m = game.metaModule;
      if (!m || typeof m.pendingMarks !== 'function') return 0;
      try { return m.pendingMarks(game.cfg, game.meta, game.floor); } catch (e) { return 0; }
    },
    buyNode(id) {
      const m = game.metaModule;
      if (!m || typeof m.buyNode !== 'function') return { ok: false, why: 'not yet' };
      const r = m.buyNode(game.cfg, game.meta, id);
      if (r.ok) { const f = refit(game, game.run.seed); game.run.mods = f.mods; changed(game); }
      return r;
    },

    // ---- the row of machines -------------------------------------------
    cabinets() {
      // Read once and kept, because reading a row means putting a few hundred
      // balls through three boards and a player must never wait for that
      // twice.
      if (!game.row) game.row = offerCabinets(game.cfg, game.rowSeed || 'first', 3);
      return game.row;
    },
    sitAt(seed) {
      game.row = null;
      game.rowSeed = 'row:' + Date.now();
      newRun(game, seed >>> 0);
      save(game);
      changed(game);
    },
    newRow() {
      game.row = null;
      game.rowSeed = 'row:' + Date.now();
      return this.cabinets();
    },

    // ---- the page ------------------------------------------------------
    setView(v) { game.view = v; changed(game); },
    newRun(seed, fittings) {
      newRun(game, seed === undefined ? (Math.random() * 1e9) | 0 : seed, fittings);
      save(game); changed(game);
    },
    reading() { return reading(game); },
    attach(scene) { game.scene = scene; },
    start(now) { start(game, now); },
    stop() { game.running = false; },
    frame(now) { frame(game, now); },
    save() { return save(game); },
    wipe() { Save.clear(game.cfg, game.storage); },
  };
}

function serializeBendState(board) {
  return board.nails.map(n => [n.x0, n.y0, n.bx, n.by]);
}

function restoreBendState(board, list) {
  if (!Array.isArray(list)) return;
  for (const [x0, y0, bx, by] of list) {
    if (!bx && !by) continue;
    for (const n of board.nails) {
      if (Math.abs(n.x0 - x0) < 0.001 && Math.abs(n.y0 - y0) < 0.001) { n.bx = bx; n.by = by; board.bends++; break; }
    }
  }
}

/** Everything the page shows, gathered once a frame. */
export function reading(game) {
  const run = game.run;
  const cfg = game.runCfg;
  const eff = metaEffects(game);
  return {
    view: game.view,
    round: run.round,
    quota: run.quota,
    won: run.won,
    tray: run.tray,
    perBall: quotaRate(run),
    perPull: ballsPerPull(run),
    budget: run.budget,
    launched: run.launched,
    launchesLeft: launchesLeft(run),
    pullsLeft: pullsLeft(run),
    pulls: pullsFor(cfg, run.round, run.mods),
    nextBonus: clearBonusFor(cfg, run.round, run.mods),
    cabinet: run.board && run.board.layout ? run.board.layout : null,
    lent: run.lent || 0,
    strength: run.strength,
    locked: !!cfg.launch.locked,
    auto: run.auto,
    speed: run.speed,
    paused: run.paused,
    phase: run.phase,
    over: run.phase === PHASE_OVER,
    settling: run.phase === PHASE_SETTLE,
    fever: run.fever.active,
    feverLeft: run.fever.ballsLeft,
    feverChain: run.fever.chain,
    matchChance: matchChance(run),
    continueChance: continueChance(run),
    reel: run.reel,
    inFlight: run.balls.n,
    bendsLeft: run.bendsLeft,
    bends: run.board.bends,
    fittings: run.fittings.slice(),
    slots: Math.max(1, cfg.shop.slots + (eff.shopSlots || 0)),
    stats: run.stats,
    log: run.log,
    scrip: game.floor.scrip,
    income: floorIncome(game.cfg, game.floor, eff),
    marks: game.meta ? game.meta.marks || 0 : 0,
    pendingMarks: game.pendingMarks ? game.pendingMarks() : 0,
    bestRound: game.floor.bestRound,
    away: game.away,
    notes: game.notes,
    fps: game.quality.fps,
    scale: game.quality.scale,
  };
}

function changed(game) {
  if (typeof game.onChange === 'function') game.onChange(reading(game));
}

function save(game) {
  game.lastSave = Date.now();
  // What the floor has ever earned is what prestige is measured against, so
  // it is carried into the permanent record every time the game is written.
  // Without this a night closed halfway loses the ground it made.
  if (game.meta && typeof game.meta === 'object') {
    if (!game.meta.lifetime || typeof game.meta.lifetime !== 'object') game.meta.lifetime = {};
    const was = Number(game.meta.lifetime.scrip);
    game.meta.lifetime.scrip = Math.max(Number.isFinite(was) ? was : 0, game.floor.earned || 0);
  }
  return Save.write(game.cfg, game, game.storage);
}

function start(game, now) {
  game.running = true;
  game.lastFrame = now || 0;
  resetMeasurement(game.quality, now || 0);
}

/** One frame. The whole order of the game is these fifteen lines. */
export function frame(game, now) {
  if (!game.running) return;
  const last = game.lastFrame || now;
  const frameMs = Math.max(0, now - last);
  game.lastFrame = now;
  const dt = Math.min(0.25, frameMs / 1000);

  if (observe(game.quality, frameMs, now) && game.scene) {
    game.scene.setQuality(renderQuality(game.quality));
  }

  const run = game.run;
  const wasPhase = run.phase;
  if (game.view === VIEW_MACHINE) stepRun(run, dt, game.out);

  tickFloor(game.cfg, game.floor, dt, metaEffects(game));

  if (wasPhase !== PHASE_SHOP && run.phase === PHASE_SHOP) openBench(game);
  if (wasPhase !== PHASE_OVER && run.phase === PHASE_OVER) {
    if (run.round - 1 > game.floor.bestRound) game.floor.bestRound = run.round - 1;
  }

  if (game.scene) game.scene.draw(view(game));

  game.out.flashes.length = 0;
  game.out.marks.length = 0;

  if (Date.now() - game.lastSave > game.cfg.save.everySeconds * 1000) save(game);
  changed(game);
}

/** What the renderer is handed. */
export function view(game) {
  const run = game.run;
  return {
    board: run.board,
    balls: run.balls,
    fever: run.fever.active ? 1 : 0,
    flashes: game.out.flashes,
    marks: game.out.marks,
    reels: run.reel.spinning || run.reel.holdT > 0 ? run.reel.digits : null,
    t: run.time,
  };
}

export { quotaFor, PHASE_PLAY, PHASE_SETTLE, PHASE_SHOP, PHASE_OVER };
