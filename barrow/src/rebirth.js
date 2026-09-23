// ---------------------------------------------------------------------------
// The seal, and what carries past it.
//
// A barrow runs out. The floors get thicker faster than the horde grows, and
// past a point the only honest move is to fill the hole in and go and find
// another hill. Sealing pays REMEMBRANCE, remembrance buys OATHS, and oaths
// are the only thing in the game that survives a run.
//
// The payment is deliberately readable on the panel rather than clever: so
// much for every layer past the shallow ones, and so much for every order of
// magnitude of coin the barrow ever earned. A player can see what one more
// hour is worth before spending it.
// ---------------------------------------------------------------------------

import * as Lore from './lore.js?v=39';
import { pick, hash } from './rng.js?v=39';
import { fill } from '../config.js?v=39';
import { fmt, fmtCoin, fmtCount } from './numbers.js?v=39';

export const LEGACY_VERSION = 1;

export function freshLegacy() {
  return {
    v: LEGACY_VERSION,
    remembrance: 0,
    earned: 0,
    oaths: {},
    seals: 0,
    finale: false,
    best: { depth: 0, earned: 0, horde: 0 },
    // What the lords leave: a trophy per lord ever broken, and how many times
    // each has been met.
    trophies: {},
    lordsMet: {},
    // Rank points. Null on a save from before ranks, which the simulation
    // fills in from what that save had already done.
    renown: 0,
    // The dead Mother Natron's jar carries to the next barrow.
    carry: 0,
    // One line per barrow filled in, newest first.
    barrows: [],
    // The switches rank hands over: upgrades buying themselves, and the layer
    // a barrow fills itself in at (0 is off).
    autoBuy: false,
    autoSealAt: 0,
    // Mortifer's upgrade raises the dead by itself; this is its switch, on
    // until the player turns it off.
    autoRaise: true,
    // How many levels one press of an upgrade buys: 1, 5, 25 or 'max'.
    ritePick: 1,
    // The rest of what the player last set on the page: the open tab and
    // whether the worked-out layers are shown.
    ui: {},
    // How many of the digger milestones have ever been reached, across barrows.
    crewMark: 0,
  };
}

/** A legacy from a save, with every field back on its feet. */
export function restoreLegacy(raw) {
  const l = freshLegacy();
  if (!raw || typeof raw !== 'object') return l;
  for (const key of ['remembrance', 'earned', 'seals']) {
    if (Number.isFinite(raw[key])) l[key] = raw[key];
  }
  l.finale = !!raw.finale;
  l.renown = Number.isFinite(raw.renown) ? raw.renown : null;
  if (Number.isFinite(raw.carry) && raw.carry > 0) l.carry = raw.carry;
  l.autoBuy = !!raw.autoBuy;
  l.autoRaise = raw.autoRaise !== false;
  if ([1, 5, 25, 'max'].includes(raw.ritePick)) l.ritePick = raw.ritePick;
  if (Number.isFinite(raw.crewMark) && raw.crewMark > 0) l.crewMark = Math.floor(raw.crewMark);
  if (raw.ui && typeof raw.ui === 'object') {
    if (typeof raw.ui.showSpent === 'boolean') l.ui.showSpent = raw.ui.showSpent;
    if (raw.ui.tab === 'oaths' || raw.ui.tab === 'rites') l.ui.tab = raw.ui.tab;
  }
  if (Number.isFinite(raw.autoSealAt) && raw.autoSealAt > 0) l.autoSealAt = Math.round(raw.autoSealAt);
  for (const key of ['trophies', 'lordsMet']) {
    if (raw[key] && typeof raw[key] === 'object') {
      for (const id of Object.keys(raw[key])) if (raw[key][id]) l[key][id] = raw[key][id];
    }
  }
  if (Array.isArray(raw.barrows)) l.barrows = raw.barrows.filter(b => b && typeof b === 'object').slice(0, 50);
  if (raw.oaths && typeof raw.oaths === 'object') {
    for (const id of Object.keys(raw.oaths)) {
      const lv = raw.oaths[id];
      if (Number.isFinite(lv) && lv > 0) l.oaths[id] = Math.floor(lv);
    }
  }
  if (raw.best && typeof raw.best === 'object') {
    for (const key of ['depth', 'earned', 'horde']) {
      if (Number.isFinite(raw.best[key])) l.best[key] = raw.best[key];
    }
  }
  return l;
}

// ---------------------------------------------------------------------------
// What a seal is worth
// ---------------------------------------------------------------------------

/** Remembrance a seal would pay for this run, right now. */
export function yieldOf(state, cfg) {
  const s = cfg.seal;
  const layers = Math.max(0, state.depth - s.fromDepth + 1) * s.perStratum;
  const earned = Math.max(0, state.totals.earned);
  const decades = earned > s.earnFloor ? Math.log10(earned / s.earnFloor) * s.perDecade : 0;
  const bonus = Number.isFinite(state.remBonus) ? state.remBonus : 0;
  // Coin spent on the books late in a barrow comes back out of it as relics,
  // which is the only thing coin can buy that the next barrow keeps.
  const books = (cfg.rites.recordsRelics || 0) * ((state.rites && state.rites.records) || 0);
  const total = layers + decades + bonus + books;
  return Number.isFinite(total) ? Math.floor(total) : 0;
}

/** Whether the shaft has gone deep enough for the seal to be offered at all. */
export function canSeal(state, cfg) {
  return state.depth >= cfg.seal.unlockDepth;
}

// ---------------------------------------------------------------------------
// Hills
// ---------------------------------------------------------------------------

/** A hill's twist, from its id: the rule that holds in every layer of it. */
export function hillRule(cfg, id) {
  if (!cfg.hills || !id) return {};
  const h = cfg.hills.list.find(x => x.id === id);
  return h ? h.rule : {};
}

/**
 * The hills offered for the next barrow: two or three dealt from the ones
 * with a twist, once the rank for it is there, or none.
 */
export function hillChoices(legacy, cfg, seed, has) {
  if (!cfg.hills) return [];
  const n = has('hillThree') ? 3 : has('hillTwo') ? 2 : 0;
  if (!n) return [];
  const pool = cfg.hills.list.filter(h => h.id !== cfg.hills.plain).map(h => h.id);
  const out = [];
  let i = 0;
  while (out.length < Math.min(n, pool.length) && i < 64) {
    const id = pool[hash(seed, 'hill:' + (legacy.seals || 0) + ':' + i) % pool.length];
    if (!out.includes(id)) out.push(id);
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Oaths
// ---------------------------------------------------------------------------

export function oathDefs(cfg) {
  return cfg.oaths.list;
}

export function oathDef(cfg, id) {
  return cfg.oaths.list.find(d => d.id === id) || null;
}

export function oathLevel(legacy, id) {
  return (legacy.oaths && legacy.oaths[id]) || 0;
}

export function oathCost(def, level) {
  return Math.ceil(def.cost * Math.pow(def.growth, level));
}

export function oathMaxed(legacy, def) {
  return oathLevel(legacy, def.id) >= def.max;
}

export function canBuyOath(legacy, def) {
  return !oathMaxed(legacy, def) && legacy.remembrance >= oathCost(def, oathLevel(legacy, def.id));
}

/** Buy the next level of an oath. Returns the level reached, or 0. */
export function buyOath(legacy, id, cfg) {
  const def = oathDef(cfg, id);
  if (!def || !canBuyOath(legacy, def)) return 0;
  legacy.remembrance -= oathCost(def, oathLevel(legacy, id));
  legacy.oaths[id] = oathLevel(legacy, id) + 1;
  return legacy.oaths[id];
}

/** What every oath held adds up to, as plain multipliers and starting values. */
export function oathMods(legacy, cfg) {
  const o = cfg.oaths;
  const lv = (id) => oathLevel(legacy, id);
  return {
    dig:     Math.pow(o.handsFactor, lv('hands')),
    soft:    Math.pow(o.marrowFactor, lv('marrow')),
    absorb:  Math.pow(o.roadsFactor, lv('roads')),
    face:    Math.pow(o.depthFactor, lv('depth')),
    visitGap: Math.pow(o.callingGap, lv('calling')),
    visitPay: Math.pow(o.callingPay, lv('calling')),
    offlineHours: o.nightHours * lv('night'),
    startHorde: lv('dead') > 0 ? Math.round(o.deadBase * Math.pow(o.deadGrowth, lv('dead') - 1)) : 0,
    startDepth: lv('ground') + (legacy.trophies && legacy.trophies.rex ? ((cfg.lords && cfg.lords.trophy.startLayers) || 0) : 0),
    startCoin: lv('purse') > 0 ? o.purseBase * Math.pow(o.purseGrowth, lv('purse') - 1) : 0,
    startRites: o.booksRites.slice(0, lv('books')),
  };
}

// ---------------------------------------------------------------------------
// Sealing
// ---------------------------------------------------------------------------

/**
 * Close a barrow. Folds what it paid into the legacy and returns the lines
 * that belong at the top of the next run's log, newest last.
 *
 * The state is not touched: the caller builds the next run from a fresh one.
 */
export function seal(state, cfg, legacy) {
  const rem = yieldOf(state, cfg);
  legacy.remembrance += rem;
  legacy.earned += rem;
  legacy.seals += 1;
  legacy.best.depth = Math.max(legacy.best.depth, state.depth);
  legacy.best.earned = Math.max(legacy.best.earned, state.totals.earned);
  legacy.best.horde = Math.max(legacy.best.horde, state.horde);
  // Filling a barrow in is worth rank on its own, and the jar carries some of
  // the dead across to the next one.
  if (cfg.ranks) legacy.renown = (legacy.renown || 0) + cfg.ranks.points.sealPer;
  if (legacy.trophies && legacy.trophies.natron && cfg.lords) {
    legacy.carry = Math.floor(state.horde * cfg.lords.trophy.carryShare);
  }
  const lordsBroken = Object.keys(state.doors || {}).length;
  if (!Array.isArray(legacy.barrows)) legacy.barrows = [];
  legacy.barrows.unshift({
    n: legacy.seals, depth: state.depth + 1, coin: state.totals.earned, horde: state.horde,
    lords: lordsBroken, relics: rem,
  });
  if (legacy.barrows.length > 50) legacy.barrows.length = 50;

  const words = Lore.seal();
  const salt = 'seal:' + legacy.seals;
  const lines = [];
  lines.push(pick(words.doneLines, state.seed, salt) || '');
  lines.push(fill(words.statLine, {
    n: legacy.seals,
    depth: state.depth + 1,
    coin: fmtCoin(state.totals.earned),
    horde: fmtCount(state.horde),
  }));
  lines.push(fill(words.yieldPaid, { n: fmt(rem) }));
  lines.push(pick(words.openLines, state.seed, salt) || '');
  return { rem, lines: lines.filter(Boolean) };
}
