// ---------------------------------------------------------------------------
// The ground, one stratum at a time, forever.
//
// A stratum is a number k. Everything about it derives from k and the config:
// its name (the ladder, then generated), its good's base value, how hard it
// is to dig, what its market can absorb, and the cap that must be broken to
// reach it. Nothing here is stored, so a save is just k.
// ---------------------------------------------------------------------------

import { CONFIG } from '../config.js?v=7';

const ROMAN = ['', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];

/** The stratum's good: id, display name and colour. */
export function goodAt(k, cfg = CONFIG.strata) {
  k = Math.max(0, k | 0);
  const ladder = cfg.ladder;
  if (k < ladder.length) {
    return { id: 's' + k, k, name: ladder[k].name, hue: ladder[k].hue };
  }
  const pool = ladder.slice(cfg.generatedFrom);
  const i = k - ladder.length;
  const base = pool[i % pool.length];
  const round = Math.floor(i / pool.length);
  const prefix = cfg.prefixes[round % cfg.prefixes.length];
  const cycle = Math.floor(round / cfg.prefixes.length);
  const suffix = cycle > 0 ? ' ' + (ROMAN[Math.min(cycle, ROMAN.length - 1)] || String(cycle)) : '';
  return { id: 's' + k, k, name: prefix + ' ' + base.name + suffix, hue: base.hue };
}

/**
 * The exponent a layer climbs with. Past the horizon it stops climbing, so
 * every number derived from a layer stays a number a double can hold.
 */
export function rung(k, cfg = CONFIG.strata) {
  const n = Math.max(0, k | 0);
  const cap = cfg.horizon > 0 ? cfg.horizon : n;
  return Math.min(n, cap);
}

/** Coin per unit of the stratum's good at a calm market. */
export function valueAt(k, cfg = CONFIG.strata) {
  return cfg.soilValue * Math.pow(cfg.valueGrowth, rung(k, cfg));
}

/** How many times harder than the surface the stratum is to dig. */
export function hardnessAt(k, cfg = CONFIG.strata) {
  return Math.pow(cfg.hardnessGrowth, rung(k, cfg));
}

/** Units that must be dug, at stratum k+1's hardness, to open stratum k+1. */
export function capUnits(k, cfg = CONFIG.strata) {
  return cfg.capBase * Math.pow(cfg.capGrowth, rung(k, cfg));
}

/**
 * What a unit dug at stratum k is made of: mostly its own good, some of the
 * good above (the layers are not clean), and a trace of the good below so the
 * next market is seen before it is reached. Shares sum to one.
 */
export function mixAt(k, cfg = CONFIG.strata) {
  k = Math.max(0, k | 0);
  const own = cfg.ownShare, carry = cfg.carryShare, trace = cfg.traceShare;
  const total = own + carry + trace;
  if (k === 0) {
    return [{ k: 0, share: (own + carry) / total }, { k: 1, share: trace / total }];
  }
  return [
    { k, share: own / total },
    { k: k - 1, share: carry / total },
    { k: k + 1, share: trace / total },
  ];
}

/** Units the stratum's market takes before it buckles. */
export function absorbAt(k, cfg = CONFIG.market) {
  return cfg.absorb0 * Math.pow(cfg.absorbGrowth, Math.max(0, k | 0));
}

/** The stratum index a good id refers to, or -1 for bones and anything else. */
export function strataOf(id) {
  if (typeof id !== 'string' || id[0] !== 's') return -1;
  const k = parseInt(id.slice(1), 10);
  return Number.isInteger(k) && k >= 0 ? k : -1;
}

export const BONES = 'bones';
