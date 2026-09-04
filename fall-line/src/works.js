// ---------------------------------------------------------------------------
// Works - the things that stand on the ground and shoot.
//
// A work is a plain object in a list, plus two per-cell arrays: which work is
// where, and which cells are taken. The taken array is what the flow field
// reads, because a work is not a wall - it is a very tall cell that the Melt
// will still crawl over when that is the quickest way past.
//
// Every effective number a work fires with - reach, harm, how long a status
// holds - is worked out in one place, `stats`, from the tier it has bought,
// the height it stands on, and the best light shining on it. Nothing else
// applies a multiplier of its own.
// ---------------------------------------------------------------------------

import { fireWork, stepProjectiles } from './works-fire.js?v=11';

// How much longer a status holds, and how much harder the drag pulls, for
// each tier bought. Read from config when the keys exist; these are the
// shipped values otherwise.
const STATUS_PER_TIER = 1.15;
const PULL_PER_TIER = 1.2;
const statusPerTier = (cfg) => (Number.isFinite(cfg.works.statusPerTier) ? cfg.works.statusPerTier : STATUS_PER_TIER);
const pullPerTier = (cfg) => (Number.isFinite(cfg.works.pullPerTier) ? cfg.works.pullPerTier : PULL_PER_TIER);

const PASS_THROUGH = ['splash', 'minRange', 'flight', 'chain', 'hop', 'decay', 'aura', 'slow'];

/** The board the works stand on: the list, and where each one is. */
export function createWorks(cfg, W, H) {
  return {
    W, H,
    list: [],
    byCell: new Int32Array(W * H).fill(-1),
    occupied: new Uint8Array(W * H),
    projectiles: [],
    nextId: 1,
    version: 1,
    spentTotal: 0,
  };
}

/** The config entry for a kind id, or undefined. */
export function kindDef(cfg, id) {
  for (const k of cfg.works.kinds) if (k.id === id) return k;
  return undefined;
}

/** What the given tier costs to buy. Tier 1 is the price on the button. */
export function costOf(cfg, def, tier) {
  return def.cost * Math.pow(cfg.works.upgradeMul, Math.max(0, (tier || 1) - 1));
}

/** Whether a kind may stand on a cell, and in plain words why not. */
export function canBuild(cfg, terrain, works, kindId, i) {
  if (!kindDef(cfg, kindId)) return { ok: false, reason: 'no such work' };
  if (!(i >= 0) || i >= works.byCell.length) return { ok: false, reason: 'off the field' };
  if (terrain.kind[i] !== 0) return { ok: false, reason: 'the ground here can\'t be built on' };
  if (works.occupied[i]) return { ok: false, reason: 'something is already here' };
  return { ok: true, reason: '' };
}

/**
 * Put a work on a cell. Ore is the run's business, not this module's; this
 * refuses only for reasons of the ground itself.
 */
export function build(cfg, works, terrain, kindId, i) {
  const check = canBuild(cfg, terrain, works, kindId, i);
  if (!check.ok) return null;
  const def = kindDef(cfg, kindId);
  const spent = costOf(cfg, def, 1);
  const work = {
    id: works.nextId++,
    kind: kindId,
    cell: i,
    x: (i % works.W) + 0.5,
    y: Math.floor(i / works.W) + 0.5,
    tier: 1,
    cd: 0,
    spent,
    kills: 0,
    dealt: 0,
    angle: 0,
    pulseT: 0,
  };
  works.list.push(work);
  works.byCell[i] = work.id;
  works.occupied[i] = 1;
  works.spentTotal += spent;
  // The road changed: a taken cell reads as tall ground to the flow field.
  works.version++;
  return work;
}

/** Buy the next tier. */
export function upgrade(cfg, works, id) {
  const work = byId(works, id);
  if (!work) return { ok: false, cost: 0, tier: 0 };
  if (work.tier >= cfg.works.maxTier) return { ok: false, cost: 0, tier: work.tier };
  const def = kindDef(cfg, work.kind);
  const cost = costOf(cfg, def, work.tier + 1);
  work.tier++;
  work.spent += cost;
  works.spentTotal += cost;
  // Occupancy has not changed, so the flow field does not need redoing.
  return { ok: true, cost, tier: work.tier };
}

/** Take a work off the field and hand back a share of everything it cost. */
export function sell(cfg, works, id) {
  const work = byId(works, id);
  if (!work) return { ok: false, refund: 0 };
  const refund = Math.floor(work.spent * cfg.economy.sellRefund);
  works.list.splice(works.list.indexOf(work), 1);
  works.byCell[work.cell] = -1;
  works.occupied[work.cell] = 0;
  works.version++;
  return { ok: true, refund };
}

/** The work standing on a cell, or null. */
export function workAt(works, i) {
  if (!(i >= 0) || i >= works.byCell.length) return null;
  return byId(works, works.byCell[i]);
}

function byId(works, id) {
  for (const w of works.list) if (w.id === id) return w;
  return null;
}

/**
 * The best lantern shining on a work, as its two bonuses. Lanterns do not
 * stack and none of them lights itself.
 */
function bestLantern(cfg, works, work) {
  let found = false;
  let bestDmg = 0;
  let bestRange = 0;
  for (const other of works.list) {
    if (other === work || other.id === work.id) continue;
    const def = kindDef(cfg, other.kind);
    if (!def || typeof def.buffDmg !== 'number') continue;
    const aura = def.aura || 0;
    const dx = other.x - work.x, dy = other.y - work.y;
    if (dx * dx + dy * dy > aura * aura) continue;
    const step = cfg.works.buffPerTier * ((other.tier || 1) - 1);
    const dmg = def.buffDmg + step;
    if (!found || dmg > bestDmg) {
      found = true;
      bestDmg = dmg;
      bestRange = (def.buffRange || 0) + step;
    }
  }
  return found ? { dmg: bestDmg, range: bestRange } : null;
}

/**
 * Everything a work actually fires with: its tier bought, the height it
 * stands on, and the best lantern on it, all folded in. Rate never changes.
 */
export function stats(cfg, terrain, works, work) {
  const out = { buffed: false };
  const def = kindDef(cfg, work.kind);
  if (!def) return out;

  const t = Math.max(0, (work.tier || 1) - 1);
  const harm = Math.pow(cfg.works.dmgMul, t);
  const lantern = bestLantern(cfg, works, work);
  const buffDmg = lantern ? lantern.dmg : 0;
  const buffRange = lantern ? lantern.range : 0;
  const height = terrain && terrain.h ? terrain.h[work.cell] : 0;
  out.buffed = !!lantern;

  out.range = ((def.range || 0) + cfg.works.rangePerTier * t) *
    (1 + cfg.works.highGroundRange * height) * (1 + buffRange);
  out.rate = def.rate || 0;
  if (typeof def.dmg === 'number') out.dmg = def.dmg * harm * (1 + buffDmg);
  if (typeof def.burnDps === 'number') out.burnDps = def.burnDps * harm * (1 + buffDmg);
  if (typeof def.burnSeconds === 'number') {
    out.burnSeconds = def.burnSeconds * Math.pow(statusPerTier(cfg), t);
  }
  if (typeof def.slowSeconds === 'number') {
    out.slowSeconds = def.slowSeconds * Math.pow(statusPerTier(cfg), t);
  }
  if (typeof def.pull === 'number') out.pull = def.pull * Math.pow(pullPerTier(cfg), t);
  for (const k of PASS_THROUGH) if (typeof def[k] === 'number') out[k] = def[k];
  const step = cfg.works.buffPerTier * t;
  if (typeof def.buffDmg === 'number') out.buffDmg = def.buffDmg + step;
  if (typeof def.buffRange === 'number') out.buffRange = def.buffRange + step;
  return out;
}

/**
 * Advance every work by `dt`: shells in the air first, then cooldowns, then
 * whatever each work can reach.
 */
export function stepWorks(cfg, terrain, works, pool, flow, dt, telemetry, fx, events) {
  stepProjectiles(cfg, works, pool, dt, telemetry, fx, events);

  for (const w of works.list) {
    const def = kindDef(cfg, w.kind);
    if (!def) continue;
    w.pulseT += dt;
    if (def.type === 'buff') continue;

    // A drag is not a shot: it happens every step, at a strength scaled by
    // how much of a step this was.
    if (def.type === 'pull') {
      fireWork(cfg, works, w, def, stats(cfg, terrain, works, w), pool, dt, telemetry, fx, events);
      continue;
    }

    if (!(def.rate > 0)) continue;
    w.cd -= dt;
    if (w.cd > 0) continue;
    const st = stats(cfg, terrain, works, w);
    if (fireWork(cfg, works, w, def, st, pool, dt, telemetry, fx, events)) {
      w.cd = st.rate > 0 ? 1 / st.rate : 0;
    } else {
      // Nothing in reach. Stay ready rather than banking a debt of seconds.
      w.cd = 0;
    }
  }
}

/** The board as plain data. */
export function serializeWorks(works) {
  return {
    list: works.list.map(w => Object.assign({}, w)),
    projectiles: works.projectiles.map(p => Object.assign({}, p)),
    nextId: works.nextId,
    spentTotal: works.spentTotal,
  };
}

/** Put a saved board back, cells and all. */
export function restoreWorks(cfg, works, terrain, data) {
  works.list.length = 0;
  works.projectiles.length = 0;
  works.byCell.fill(-1);
  works.occupied.fill(0);
  works.spentTotal = 0;
  works.nextId = 1;
  works.version++;
  if (!data) return works;

  for (const saved of data.list || []) {
    const work = Object.assign({}, saved);
    works.list.push(work);
    if (work.cell >= 0 && work.cell < works.byCell.length) {
      works.byCell[work.cell] = work.id;
      works.occupied[work.cell] = 1;
    }
    if (work.id >= works.nextId) works.nextId = work.id + 1;
  }
  for (const saved of data.projectiles || []) works.projectiles.push(Object.assign({}, saved));
  if (typeof data.nextId === 'number' && data.nextId > works.nextId) works.nextId = data.nextId;
  works.spentTotal = typeof data.spentTotal === 'number' ? data.spentTotal : 0;
  return works;
}
