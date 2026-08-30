// ---------------------------------------------------------------------------
// Fittings, and where they get to speak.
//
// A fitting is a part bolted into the machine. It does its work by attaching
// to one moment in a round and being handed a context it may change. This file
// is the whole of that arrangement: the list of moments, the shape of the
// context each one carries, and the dispatcher.
//
// THE MOMENTS
//   roundStart  { state, mods, round }        before a tray is handed over
//   launch      { state, mods, ball, worth }  a ball leaves the handle
//   pinHit      { state, ball, x, y }         a nail is struck
//   pocket      { state, pocket, kind, pay }  a ball is caught; `pay` may change
//   gate        { state, spins }              a ball goes through the gate
//   reelSpin    { state, chance }             the reels are about to settle
//   feverStart  { state, balls, mult }        a fever begins
//   feverBall   { state, left }               a ball is spent during a fever
//   feverEnd    { state, won, chance }        a fever is over; `chance` chains it
//   ballLost    { state, refund }             a ball reaches the out lane
//   roundEnd    { state, won, quota, cleared }
//   shopOpen    { state, offers, prices }
//
// A fitting that returns a number from a moment carrying one replaces it. A
// fitting that returns nothing has changed the context in place or done
// nothing at all. Either is fine.
//
// Nothing a fitting does may stop a round. A fitting that throws is switched
// off for the rest of the session and the game carries on without it, because
// a part that is wrong should cost its own effect and nothing else.
// ---------------------------------------------------------------------------

import { baseMods } from './run.js?v=49';

export const MOMENTS = [
  'onRunStart', 'onRoundStart', 'onShopOpen', 'onLaunch', 'onPinHit', 'onPocket',
  'onGate', 'onReelSpin', 'onFeverStart', 'onFeverBall', 'onFeverEnd',
  'onBallLost', 'onRoundEnd',
];

/** Wraps a catalogue into something the run can fire cheaply. */
export function createBench(catalogue) {
  const all = Array.isArray(catalogue && catalogue.FITTINGS) ? catalogue.FITTINGS : [];
  const byId = new Map();
  for (const f of all) if (f && typeof f.id === 'string') byId.set(f.id, f);
  return {
    all,
    byId,
    synergies: Array.isArray(catalogue && catalogue.SYNERGIES) ? catalogue.SYNERGIES : [],
    rollOffer: typeof (catalogue && catalogue.rollOffer) === 'function' ? catalogue.rollOffer : null,
    describe: typeof (catalogue && catalogue.describe) === 'function' ? catalogue.describe : null,
    broken: new Set(),
    hooks: indexHooks(all),
  };
}

function indexHooks(all) {
  const hooks = {};
  for (const m of MOMENTS) hooks[m] = [];
  for (const f of all) {
    if (!f || typeof f.apply !== 'function') continue;
    const list = Array.isArray(f.hook) ? f.hook : [f.hook];
    for (const h of list) if (hooks[h]) hooks[h].push(f);
  }
  return hooks;
}

/** Whether any of the parts bolted in is listening for a moment. */
export function hasHook(bench, ids, moment) {
  const attached = bench && bench.hooks && bench.hooks[moment];
  if (!attached || attached.length === 0) return false;
  for (const id of ids) {
    if (bench.broken.has(id)) continue;
    const f = bench.byId.get(id);
    if (!f) continue;
    const list = Array.isArray(f.hook) ? f.hook : [f.hook];
    if (list.indexOf(moment) >= 0) return true;
  }
  return false;
}

/** The fittings a run owns, in catalogue order. */
export function owned(bench, ids) {
  const out = [];
  for (const id of ids) {
    const f = bench.byId.get(id);
    if (f && !bench.broken.has(id)) out.push(f);
  }
  return out;
}

/**
 * Fires a moment.
 *
 * `ctx` is handed to every fitting attached to that moment, in the order they
 * were bolted in, so a player can reason about what happens first.
 */
export function fire(bench, ids, moment, ctx) {
  const attached = bench.hooks[moment];
  if (!attached || attached.length === 0) return ctx;
  for (const id of ids) {
    if (bench.broken.has(id)) continue;
    const f = bench.byId.get(id);
    if (!f || typeof f.apply !== 'function') continue;
    const list = Array.isArray(f.hook) ? f.hook : [f.hook];
    if (list.indexOf(moment) < 0) continue;
    try {
      const r = f.apply(ctx, moment);
      if (typeof r === 'number' && Number.isFinite(r) && 'value' in ctx) ctx.value = r;
    } catch (e) {
      // One bad part is switched off. The machine keeps running.
      bench.broken.add(id);
    }
  }
  return ctx;
}

/**
 * The multipliers a run should carry, rebuilt from what is bolted in.
 *
 * Rebuilt from scratch every time rather than adjusted, so removing a fitting
 * can never leave part of its effect behind. Declarative fields on a fitting
 * are added up here; anything a fitting wants to do that cannot be written as
 * one of these numbers it does from a moment instead.
 */
export function buildMods(cfg, bench, ids, extra) {
  const mods = baseMods();
  const MULTIPLY = new Set(['payMult', 'gatePayMult', 'feverMult', 'launchRate', 'quotaMult', 'scatter', 'ballWorth']);

  for (const f of owned(bench, ids)) {
    const m = f.mods;
    if (!m || typeof m !== 'object') continue;
    for (const k of Object.keys(mods)) {
      const v = Number(m[k]);
      if (!Number.isFinite(v)) continue;
      if (MULTIPLY.has(k)) mods[k] *= v;
      else mods[k] += v;
    }
  }
  if (extra && typeof extra === 'object') {
    for (const k of Object.keys(mods)) {
      const v = Number(extra[k]);
      if (!Number.isFinite(v)) continue;
      if (MULTIPLY.has(k)) mods[k] *= v;
      else mods[k] += v;
    }
  }

  // Guards. A multiplier that reaches zero or turns negative silently ends a
  // run in a way no message explains, and one that stops being a number takes
  // every figure on the page with it.
  for (const k of Object.keys(mods)) {
    if (!Number.isFinite(mods[k])) mods[k] = MULTIPLY.has(k) ? 1 : 0;
    if (MULTIPLY.has(k) && mods[k] <= 0) mods[k] = 0.01;
  }
  return mods;
}

/** Which of a player's fittings a candidate would work with. */
export function synergiesWith(bench, ids, candidateId) {
  const have = new Set(ids);
  const out = [];
  for (const s of bench.synergies) {
    if (!s || !Array.isArray(s.ids)) continue;
    if (s.ids.indexOf(candidateId) < 0) continue;
    const others = s.ids.filter(id => id !== candidateId);
    if (others.every(id => have.has(id))) out.push(s);
  }
  return out;
}

/** Every fitting already owned that a candidate shares a named combo with. */
export function partnersFor(bench, ids, candidateId) {
  const partners = new Set();
  for (const s of bench.synergies) {
    if (!s || !Array.isArray(s.ids) || s.ids.indexOf(candidateId) < 0) continue;
    for (const id of s.ids) if (id !== candidateId && ids.indexOf(id) >= 0) partners.add(id);
  }
  return Array.from(partners);
}
