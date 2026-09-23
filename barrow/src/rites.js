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

import * as Ch from './chambers.js?v=44';
import * as Rb from './rebirth.js?v=44';
import * as Lore from './lore.js?v=44';
import * as Lords from './lords.js?v=44';
import * as Ranks from './ranks.js?v=44';

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
  const trophy = (id) => !!(legacy && legacy.trophies && legacy.trophies[id]);
  const rank = (id) => !!(legacy && cfg.ranks && Ranks.has(legacy, cfg, id));
  // The lord whose layers the dig is in: his rule on callers holds while the
  // shaft is in his ten.
  const here = cfg.lords ? Lords.lordAt(cfg, s.seed, Lords.realmOf(s.depth, cfg)) : null;
  const hereGap = here && here.rule.visitGap !== undefined ? here.rule.visitGap : 1;
  // The hill's twist on callers and on how far a bone goes.
  const hill = Rb.hillRule(cfg, s.hill);
  const hillGap = hill.visitGap !== undefined ? hill.visitGap : 1;
  const hillSoft = hill.soft !== undefined ? hill.soft : 1;
  const hillDef = cfg.hills && s.hill ? cfg.hills.list.find(h => h.id === s.hill) : null;
  const T = cfg.lords ? cfg.lords.trophy : {};
  // What a lord hands over beside his trophy, held for good once his door
  // has been broken. Never bought, so never a level.
  const P = (cfg.lords && cfg.lords.power) || null;
  const twice = id => (P && trophy(id) ? P.factor : 1);
  return {
    // Production.
    digMult:  Math.pow(r.handsFactor, lv('hands')) * b.dig * oath('dig', 1) * twice('neb'),
    boneMult: Math.pow(r.pitsFactor, lv('pits')) * b.bones * twice('pater'),
    softMult: Math.pow(r.graveFactor, lv('grave')) * b.soft * oath('soft', 1) * hillSoft,
    faceMult: Math.pow(r.picksFactor, lv('picks')) * b.face * oath('face', 1) * twice('sepulturero'),
    valueMult: b.value * twice('rey') * oath('value', 1),
    activeStrata: cfg.horde.activeStrata + lv('workings') + (rank('openMore') ? 1 : 0),
    // Information.
    assay: lv('assay') > 0,
    // Layers below the cut whose ground is known before the dead reach it.
    readAhead: Math.max(lv('survey') > 0 ? r.surveyReads : 0, rank('readTwo') ? 2 : 0),
    // Rey Muerto's lamp names every layer down to the next door.
    readToDoor: trophy('rey'),
    // Relics this barrow will pay for being filled in, over what its depth
    // and its earnings are worth on their own.
    records: r.recordsRelics * lv('records'),
    // The world outside the field.
    visitGap: Math.pow(r.crierGap, lv('crier')) * oath('visitGap', 1) * hereGap * hillGap / twice('dona'),
    visitPay: Math.pow(r.crierPay, lv('crier')) * oath('visitPay', 1) * twice('dona'),
    offlineHours: cfg.time.offlineMaxHours + r.vigilHours * lv('vigil') + oath('offlineHours', 0),
    // What the lords' trophies do.
    doorEase: (trophy('sepulturero') ? (T.doorEase || 1) : 1) * (rank('doorsEasy') ? 1.25 : 1),
    hoardMult: (trophy('mortifer') ? (T.hoardMult || 1) : 1) * (rank('hoardPlus') ? 1.5 : 1) * (rank('lordHoard') ? 2 : 1),
    // Neb-Amenti's scales weigh every barrow again when it is filled in.
    sealRelics: trophy('neb') ? (T.sealRelics || 1) : 1,
    // What clearing a layer turns up, and how many times over.
    findsMult: rank('clearFinds') ? 2 : 1,
    boneCart: trophy('pater') ? (T.boneCartSeconds || 0) : 0,
    callersWait: trophy('dona'),
    // The lords' powers that are not a doubling.
    muster: P && trophy('rex') ? P.musterSeconds : 0,
    autoRaise: !!P && trophy('mortifer'),
    awayPace: P && trophy('natron') ? P.awayPace : cfg.time.awayPace,
    // What rank has handed over that the run has to know about.
    autoBuy: rank('autoBuy'),
    autoSeal: rank('autoSeal'),
    bothGifts: rank('bothGifts'),
    // What the drawing needs to know about the hill.
    hillTint: hillDef && hillDef.tint ? hillDef.tint : null,
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
