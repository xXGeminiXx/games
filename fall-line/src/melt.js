// ---------------------------------------------------------------------------
// The Melt - what comes down the hill, and how it learns.
//
// Surges are not authored. How many come and how tough they are is a formula
// of the surge number and whatever the Melt has grown; what it grows next is
// scored from what killed it last time. Nothing here touches the field, the
// clock or the page: hand it a surge number, a trait mask and one surge of
// telemetry and it returns the plan, the one mutation it would grow, and the
// sentences that explain both.
// ---------------------------------------------------------------------------

import { TRAIT, idsOf, hasTrait, traitEffects, conflicts } from './traits.js?v=7';
import { unit } from './rng.js?v=7';

/** The damage types telemetry counts, in the order the panel lists them. */
const TYPES = ['kinetic', 'blast', 'burn', 'arc'];

/** Trait ids in the order the config table lists them. */
const IDS = Object.keys(TRAIT);

const clamp01 = (v) => (Number.isFinite(v) ? (v < 0 ? 0 : (v > 1 ? 1 : v)) : 0);

/** A ratio that is 0 rather than Infinity or NaN when the bottom is empty. */
function ratio(top, bottom) {
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return 0;
  return top / bottom;
}

/** Fill {name} holes in a line of text. Unknown holes are left alone. */
function fillHoles(line, values) {
  return String(line == null ? '' : line)
    .replace(/\{(\w+)\}/g, (m, k) => (values && k in values ? String(values[k]) : m));
}


// ---------------------------------------------------------------------------
// THE SURGE
// ---------------------------------------------------------------------------

/**
 * The plan for surge `n` against a mote carrying `traitsMask`.
 * Ore is divided by the count multiplier so that a swarm surge, which arrives
 * two and a half times over, still pays about what a plain one pays in total.
 */
export function surgePlan(cfg, n, traitsMask) {
  const s = cfg.surge;
  const mask = (traitsMask || 0) >>> 0;
  const e = traitEffects(cfg, mask);
  const crest = (s.crestEvery > 0 && n % s.crestEvery === 0) ? s.crestMul : 1;
  const countMul = e.count > 0 ? e.count : 1;
  const count = Math.max(1, Math.round((s.countBase + s.countPer * n) * crest * e.count));

  let size = cfg.motes.sizes.normal;
  if (hasTrait(mask, 'bulk')) size = cfg.motes.sizes.bulk;
  else if (hasTrait(mask, 'swarm')) size = cfg.motes.sizes.swarm;

  return {
    n,
    count,
    hp: s.hpBase * Math.pow(1 + s.hpGrowth * n, s.hpPower) * Math.pow(s.hpExp || 1, n) * e.hp,
    speed: cfg.motes.baseSpeed * e.speed,
    spawnSeconds: Math.min(s.spawnMax || Infinity, s.spawnBase + s.spawnPer * n),
    leak: cfg.motes.leakDamage * e.leak,
    ore: (s.oreBase + s.orePer * n) / countMul,
    size,
    traits: mask,
    crest,
  };
}

/**
 * The trickle between surges. It carries none of what the Melt has grown, so
 * its hp and ore come from the plain version of the coming surge rather than
 * from the mutated plan: the ebb is a reminder that the field is never empty,
 * not a preview of the counter you are about to meet.
 */
export function ebbPlan(cfg, plan) {
  const plain = surgePlan(cfg, plan.n, 0);
  return {
    n: plan.n,
    hp: plain.hp * cfg.ebb.hpMul,
    speed: cfg.motes.baseSpeed,
    ore: plain.ore * cfg.ebb.oreMul,
    leak: cfg.motes.leakDamage,
    size: cfg.motes.sizes.normal,
    traits: 0,
    isSurge: false,
  };
}


// ---------------------------------------------------------------------------
// TELEMETRY AND GAINS
// ---------------------------------------------------------------------------

/** A fresh record of one surge. Every field counts up from here. */
export function emptyTelemetry() {
  return {
    spawned: 0,
    killed: 0,
    leaked: 0,
    ebbKilled: 0,
    dealt: { kinetic: 0, blast: 0, burn: 0, arc: 0 },
    kills: { kinetic: 0, blast: 0, burn: 0, arc: 0 },
    aliveSeconds: 0,
    slowedSeconds: 0,
    pulledSeconds: 0,
    climbSeconds: 0,
    woundedDealt: 0,
    pathCost: 0,
    straightCells: 0,
  };
}

/** Total damage dealt across every type. */
function totalDealt(t) {
  const d = (t && t.dealt) || {};
  let sum = 0;
  for (const type of TYPES) {
    const v = d[type];
    if (Number.isFinite(v) && v > 0) sum += v;
  }
  return sum;
}

/** What fraction of the damage each type did. All zero when nothing landed. */
export function dealtShares(t) {
  const d = (t && t.dealt) || {};
  const total = totalDealt(t);
  const out = { kinetic: 0, blast: 0, burn: 0, arc: 0 };
  if (!(total > 0)) return out;
  for (const type of TYPES) {
    const v = d[type];
    out[type] = (Number.isFinite(v) && v > 0) ? v / total : 0;
  }
  return out;
}

/**
 * How badly the Melt wants each mutation, from 0 to 1, read off one surge.
 * Every one of these is a plain fraction of something the player did, which is
 * what lets the forecast explain the choice in a single honest sentence.
 */
export function gains(cfg, t) {
  const tel = t || {};
  const share = dealtShares(tel);
  const alive = tel.aliveSeconds;
  const total = totalDealt(tel);

  let haste = 0;
  const span = cfg.melt.hasteSpan;
  const base = cfg.motes.baseSpeed;
  if (tel.spawned > 0 && tel.straightCells > 0 && base > 0 && span > 0) {
    const avgAlive = ratio(alive, tel.spawned);
    const straightSeconds = tel.straightCells / base;
    haste = (ratio(avgAlive, straightSeconds) - 1) / span;
  }

  return {
    chitin: clamp01(share.kinetic),
    scatter: clamp01(share.blast),
    slick: clamp01(share.burn),
    faraday: clamp01(share.arc),
    numb: clamp01(ratio(tel.slowedSeconds, alive)),
    ballast: clamp01(ratio(tel.pulledSeconds, alive)),
    wings: clamp01(ratio(tel.climbSeconds, alive)),
    haste: clamp01(haste),
    bulk: clamp01(0.8 * (share.blast + share.arc)),
    swarm: clamp01(0.8 * share.kinetic),
    regrowth: clamp01(ratio(tel.woundedDealt, total)),
  };
}


// ---------------------------------------------------------------------------
// EVOLUTION
// ---------------------------------------------------------------------------

/** How many mutations the Melt may carry at surge `n`. */
export function slotsFor(cfg, n) {
  let slots = 0;
  let at = -Infinity;
  for (const entry of cfg.melt.slots || []) {
    if (!entry || entry.length < 2) continue;
    if (n >= entry[0] && entry[0] >= at) { at = entry[0]; slots = entry[1]; }
  }
  return slots;
}

/**
 * One surge of learning. At most one mutation changes, so a forecast is always
 * one sentence and the player can always see which of their choices caused it.
 * A small seeded jitter keeps two near-equal counters from being decided by the
 * order of the table alone; it is never large enough to grow something the
 * player did not provoke.
 */
export function evolve(cfg, seed, n, traitsMask, telemetry) {
  const mask = (traitsMask || 0) >>> 0;
  const unchanged = { traits: mask, change: null };
  if (n < cfg.melt.mutationsFrom) return unchanged;

  const g = gains(cfg, telemetry);
  const table = cfg.melt.mutations || {};
  const active = idsOf(mask);

  let bestId = null;
  let bestScore = -Infinity;
  for (const id of IDS) {
    if (!table[id]) continue;
    if (mask & TRAIT[id]) continue;
    let blocked = false;
    for (const other of active) {
      if (conflicts(cfg, id, other)) { blocked = true; break; }
    }
    if (blocked) continue;
    const jitter = (unit(seed, 'mut:' + n + ':' + id) * 2 - 1) * cfg.melt.jitter;
    const score = g[id] + jitter;
    if (score > bestScore) { bestScore = score; bestId = id; }
  }
  if (bestId === null) return unchanged;

  const grew = (traits, removed) => ({
    traits,
    change: {
      added: bestId,
      removed: removed || null,
      gain: g[bestId],
      driver: { id: bestId, value: g[bestId] },
    },
  });

  // A free slot: grow the best counter, but only if something really provoked
  // it. Below the threshold the Melt would be growing a cost for nothing.
  if (active.length < slotsFor(cfg, n)) {
    if (!(bestScore >= cfg.melt.addThreshold)) return unchanged;
    return grew((mask | TRAIT[bestId]) >>> 0, null);
  }

  // Full up: trade only when the newcomer clearly beats the least useful thing
  // standing. Without the margin the Melt would thrash between two near-equal
  // counters every surge and the forecast would stop meaning anything.
  if (active.length === 0) return unchanged;
  let weakest = null;
  let weakestGain = Infinity;
  for (const id of active) {
    const v = Number.isFinite(g[id]) ? g[id] : 0;
    if (v < weakestGain) { weakestGain = v; weakest = id; }
  }
  if (!(bestScore > weakestGain + cfg.melt.swapMargin)) return unchanged;
  return grew(((mask | TRAIT[bestId]) & ~TRAIT[weakest]) >>> 0, weakest);
}


// ---------------------------------------------------------------------------
// THE FORECAST
// ---------------------------------------------------------------------------

/** The work whose name stands for a damage type in the breakdown. */
function typeName(cfg, type) {
  const kinds = (cfg.works && cfg.works.kinds) || [];
  for (const k of kinds) if (k && k.type === type) return k.name || k.id;
  return type;
}

/**
 * The panel's account of the coming surge: how big it is, what it carries,
 * what it just grew and why, and how last surge went. Every line is text from
 * config with its holes filled, so the whole forecast can be reworded without
 * touching this file.
 */
export function forecast(cfg, plan, traits, change, telemetry) {
  const f = cfg.text.forecast;
  const table = cfg.melt.mutations || {};
  const lines = [];
  const push = (text, cls) => { if (text) lines.push({ text: String(text), cls }); };

  push(fillHoles(f.coming, {
    n: plan.n,
    count: plan.count,
    motes: cfg.text.motes,
    hp: Math.round(plan.hp),
  }), 'ink');

  if (plan.crest > 1) push(f.crest, 'dim');

  const mask = ((traits === undefined || traits === null ? plan.traits : traits) || 0) >>> 0;
  const active = idsOf(mask);
  for (const id of active) {
    const def = table[id] || {};
    const name = def.name || id;
    push(def.line ? name + ' - ' + def.line : name, 'trait');
  }

  if (change && change.added) {
    const def = table[change.added] || {};
    const driver = change.driver || {};
    const pct = Math.round((Number.isFinite(driver.value) ? driver.value : 0) * 100);
    const reason = fillHoles((cfg.text.reasons || {})[change.added] || '', { pct });
    push(fillHoles(f.learned, { name: def.name || change.added, reason }), 'new');
  }
  if (change && change.removed) {
    const def = table[change.removed] || {};
    push(fillHoles(f.dropped, { name: def.name || change.removed }), 'dim');
  }

  const t = telemetry || {};
  if (t.spawned > 0) {
    push(fillHoles(f.last, {
      killed: t.killed || 0,
      spawned: t.spawned,
      leaked: t.leaked || 0,
    }), 'dim');
    const share = dealtShares(t);
    for (const type of TYPES) {
      if (!(share[type] > 0)) continue;
      push(fillHoles(f.share, {
        name: typeName(cfg, type),
        pct: Math.round(share[type] * 100),
      }), 'dim');
    }
  }

  if (active.length === 0 && !change) push(f.quiet, 'dim');

  const panels = cfg.text.panels || {};
  return { title: panels.melt || cfg.text.melt, lines };
}
