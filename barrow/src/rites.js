// ---------------------------------------------------------------------------
// Rites: what coin buys.
//
// A rite is a level. Its cost grows geometrically per level and its effect is
// a multiplier. This file is also the ONE place the game asks what all its
// multipliers currently are: the rites bought this run, the boons taken in
// chambers and from peddlers, and the oaths that carry from barrow to barrow
// are folded together in modsOf and nothing else in the game reads any of
// them separately.
// ---------------------------------------------------------------------------

import * as Ch from './chambers.js?v=19';
import * as Rb from './rebirth.js?v=19';
import * as Lore from './lore.js?v=19';

export function defs(cfg) {
  return cfg.rites.list;
}

export function defOf(cfg, id) {
  return cfg.rites.list.find(d => d.id === id) || null;
}

/** The name and the line a rite shows, from the writing. */
export function wordsOf(id) {
  return Lore.rite(id);
}

export function levelOf(s, id) {
  return s.rites[id] || 0;
}

/** Coin for the next level of a rite. */
export function cost(def, level) {
  return def.cost * Math.pow(def.growth, level);
}

export function maxed(s, def) {
  return levelOf(s, def.id) >= def.max;
}

export function canBuy(s, def) {
  return !maxed(s, def) && s.coin >= cost(def, levelOf(s, def.id));
}

/** Buy the next level. Returns the level reached, or 0 if nothing happened. */
export function buy(s, id, cfg, count) {
  const def = defOf(cfg, id);
  if (!def) return 0;
  // Levels are bought one at a time even when many are asked for: each level
  // sets the price of the next, and a rite may have a ceiling. Buying stops at
  // whichever runs out first, the coin or the levels.
  const want = count === undefined ? 1 : Math.max(1, count | 0);
  let bought = 0;
  for (let i = 0; i < want; i++) {
    if (!canBuy(s, def)) break;
    const price = cost(def, levelOf(s, id));
    s.coin -= price;
    s.totals.spent += price;
    s.rites[id] = levelOf(s, id) + 1;
    bought++;
  }
  return bought > 0 ? s.rites[id] : 0;
}

/** The most levels of this rite the coin in hand allows. */
export function maxBuy(s, id, cfg) {
  const def = defOf(cfg, id);
  if (!def) return 0;
  let coin = s.coin, lv = levelOf(s, id), n = 0;
  // A hundred is not a limit anyone reaches; it stops a runaway loop if a
  // rite is ever given a price that does not climb.
  while (n < 100) {
    const price = cost(def, lv);
    if (!(price <= coin)) break;
    if (def.max !== undefined && lv >= def.max) break;
    coin -= price; lv++; n++;
  }
  return n;
}

/**
 * Every multiplier the simulation reads, in one object.
 *
 * Three sources, multiplied together: rites bought with coin this run, boons
 * taken in chambers and bought from peddlers this run, and oaths held forever.
 * Nothing outside this function needs to know which of the three a number
 * came from.
 */
export function modsOf(s, cfg, legacy) {
  const lv = id => levelOf(s, id);
  const r = cfg.rites;
  const b = Ch.boonsOf(s);
  const o = legacy ? Rb.oathMods(legacy, cfg) : null;
  const oath = (key, fallback) => (o ? o[key] : fallback);
  const brokerLv = lv('broker');
  const table = r.broker;
  return {
    // Production.
    digMult:  Math.pow(r.handsFactor, lv('hands')) * b.dig * oath('dig', 1),
    boneMult: Math.pow(r.pitsFactor, lv('pits')) * b.bones,
    softMult: Math.pow(r.graveFactor, lv('grave')) * b.soft * oath('soft', 1),
    faceMult: Math.pow(r.picksFactor, lv('picks')) * b.face * oath('face', 1),
    valueMult: b.value,
    activeStrata: cfg.horde.activeStrata + lv('workings'),
    // Markets.
    absorbMult: Math.pow(r.routesFactor, lv('routes')) * b.absorb * oath('absorb', 1),
    recoveryMult: Math.pow(r.hasteFactor, lv('haste')),
    broker: brokerLv > 0 ? table[Math.min(brokerLv, table.length) - 1] : null,
    // Information.
    ledger: lv('ledger') > 0,
    foresight: lv('foresight') > 0,
    assay: lv('assay') > 0,
    // Layers below the cut whose ground is known before the dead reach it.
    readAhead: lv('survey') > 0 ? r.surveyReads : 0,
    // Relics this barrow will pay for being filled in, over what its depth
    // and its earnings are worth on their own.
    records: r.recordsRelics * lv('records'),
    // The world outside the field.
    visitGap: Math.pow(r.crierGap, lv('crier')) * oath('visitGap', 1),
    visitPay: Math.pow(r.crierPay, lv('crier')) * oath('visitPay', 1),
    offlineHours: cfg.time.offlineMaxHours + r.vigilHours * lv('vigil') + oath('offlineHours', 0),
  };
}

/**
 * Which rites the panel shows. They arrive one at a time, in list order: a
 * rite appears once the one before it is held and coin has reached a share of
 * its own cost. A rite with an `atDepth` is held back until the shaft reaches
 * that layer however rich the player is, and once it does the depth stands in
 * for the chain, so the deep rites arrive on their own schedule.
 *
 * Once shown a rite stays shown (a flag on the state), so the list only ever
 * grows.
 */
export function visible(s, cfg) {
  const out = [];
  let prevHeld = true;
  for (const def of cfg.rites.list) {
    const flag = 'rite:' + def.id;
    const lv = levelOf(s, def.id);
    const deepEnough = !def.atDepth || s.depth >= def.atDepth;
    const chainOpen = def.atDepth ? deepEnough : prevHeld;
    if (!s.flags[flag]) {
      const price = cost(def, lv);
      if (lv > 0 || (chainOpen && deepEnough && s.coin >= price * cfg.rites.showAtShare)) s.flags[flag] = true;
    }
    if (s.flags[flag]) out.push(def);
    prevHeld = lv > 0;
  }
  return out;
}
