// ---------------------------------------------------------------------------
// The Melt, as a pool.
//
// Thousands of motes stand on the field at once, so they are held as parallel
// typed arrays rather than as objects: one array per field, one index per
// mote, and a free list of retired slots. Nothing in the step allocates, and
// nothing here rolls a die of its own - the pool is handed the number source
// it should use, so a run replays exactly from its save.
//
// A mote walks toward the centre of the cell the flow field points at, shifted
// by a lateral amount that is its own for life, which makes a crowd read as a
// river rather than a single file. Climbing costs it time by the same rule the
// flow costs use, so the cheapest road is also the quickest one and the line
// drawn on the field is the line that gets walked.
// ---------------------------------------------------------------------------

import { traitEffects, takenMultiplier } from './traits.js?v=5';

/** Bits cached on each mote at spawn, so the step never re-reads its traits. */
export const MOTE_FLAG = { ignoreTerrain: 1, immuneSlow: 2, immunePull: 4, stopsChain: 8 };

const HEARTH = 2;             // terrain.kind value for a hearth cell
const EDGE = 1e-4;            // keeps a clamped position inside its own cell

const FLOATS = [
  'x', 'y', 'vx', 'vy', 'tx', 'ty', 'hp', 'maxHp', 'speed', 'slow', 'slowT',
  'burnDps', 'burnT', 'regen', 'size', 'leak', 'ore', 'prio', 'px', 'py',
  'ox', 'oy', 'age', 'pullT', 'stuckT',
];
const INTS = ['traits', 'cell', 'lastCell', 'isSurge', 'flags'];

const DAMAGE_TYPES = ['kinetic', 'blast', 'burn', 'arc'];
const COUNTERS = [
  'aliveSeconds', 'slowedSeconds', 'pulledSeconds', 'climbSeconds',
  'woundedDealt', 'leaked', 'killed', 'ebbKilled',
];

// Somewhere for numbers to go when a caller keeps no telemetry.
const SINK = {};

/** Every counter a step can touch, so a caller may pass an empty object. */
function ensureTelemetry(t) {
  const o = t || SINK;
  if (!o.dealt || typeof o.dealt !== 'object') o.dealt = {};
  if (!o.kills || typeof o.kills !== 'object') o.kills = {};
  for (const k of DAMAGE_TYPES) {
    if (typeof o.dealt[k] !== 'number') o.dealt[k] = 0;
    if (typeof o.kills[k] !== 'number') o.kills[k] = 0;
  }
  for (const k of COUNTERS) if (typeof o[k] !== 'number') o[k] = 0;
  return o;
}

// --- the pool ---------------------------------------------------------------

/** A pool of `cfg.motes.cap` slots over a W by H field. `rand` returns [0,1). */
export function createPool(cfg, W, H, rand) {
  const cap = Math.max(1, cfg.motes.cap | 0);
  const pool = {
    W, H, cap,
    rand: typeof rand === 'function' ? rand : () => 0.5,
    count: 0,
    // Highest slot ever handed out. The step scans to here, not to cap, so an
    // early surge does not pay for room the late ones will need.
    top: 0,
    freeList: [],
    traits: new Uint32Array(cap),
    cell: new Int32Array(cap),
    lastCell: new Int32Array(cap),
    alive: new Uint8Array(cap),
    isSurge: new Uint8Array(cap),
    flags: new Uint8Array(cap),
    head: new Int32Array(W * H),
    link: new Int32Array(cap),
  };
  for (const f of FLOATS) pool[f] = new Float32Array(cap);
  pool.head.fill(-1);
  pool.link.fill(-1);
  pool.lastCell.fill(-1);
  return pool;
}

/** The cell index holding a world position, clamped onto the field. */
function cellAt(pool, x, y) {
  let cx = Math.floor(x); if (cx < 0) cx = 0; else if (cx >= pool.W) cx = pool.W - 1;
  let cy = Math.floor(y); if (cy < 0) cy = 0; else if (cy >= pool.H) cy = pool.H - 1;
  return cy * pool.W + cx;
}

/** Take a slot, from the free list first, or -1 when the pool is full. */
function alloc(pool) {
  if (pool.freeList.length) return pool.freeList.pop();
  if (pool.top < pool.cap) return pool.top++;
  return -1;
}

/** Retire a slot. The spatial index is not touched; it is rebuilt each step. */
export function free(pool, id) {
  if (id < 0 || id >= pool.cap || !pool.alive[id]) return false;
  pool.alive[id] = 0;
  pool.count--;
  pool.freeList.push(id);
  return true;
}

/**
 * Put a mote on the field.
 * @param {object} o x, y, hp, speed, traits, size, leak, ore, isSurge
 * @returns {number} the mote's id, or -1 when the pool is full
 */
export function spawn(pool, cfg, o) {
  const id = alloc(pool);
  if (id < 0) return -1;

  const mask = (o.traits || 0) >>> 0;
  const e = traitEffects(cfg, mask);
  const spread = cfg.motes.lateralSpread;

  let x = o.x, y = o.y;
  if (!(x >= 0)) x = 0; else if (x > pool.W - EDGE) x = pool.W - EDGE;
  if (!(y >= 0)) y = 0; else if (y > pool.H - EDGE) y = pool.H - EDGE;

  pool.x[id] = x;
  pool.y[id] = y;
  pool.vx[id] = 0;
  pool.vy[id] = 0;
  pool.tx[id] = 0;
  pool.ty[id] = 0;
  pool.hp[id] = o.hp;
  pool.maxHp[id] = o.hp;
  pool.speed[id] = o.speed;
  pool.slow[id] = 1;
  pool.slowT[id] = 0;
  pool.burnDps[id] = 0;
  pool.burnT[id] = 0;
  pool.regen[id] = e.regen;
  pool.size[id] = o.size === undefined ? 1 : o.size;
  pool.leak[id] = o.leak || 0;
  pool.ore[id] = o.ore || 0;
  // Nothing has walked yet, so it is as far from the hearth as it can be.
  pool.prio[id] = Infinity;
  pool.px[id] = 0;
  pool.py[id] = 0;
  pool.ox[id] = (pool.rand() * 2 - 1) * spread;
  pool.oy[id] = (pool.rand() * 2 - 1) * spread;
  pool.age[id] = 0;
  pool.pullT[id] = 0;
  pool.stuckT[id] = 0;
  pool.traits[id] = mask;
  pool.cell[id] = cellAt(pool, x, y);
  pool.lastCell[id] = -1;   // no cell walked out of yet, so step one aims it
  pool.alive[id] = 1;
  pool.isSurge[id] = o.isSurge ? 1 : 0;
  pool.flags[id] =
    (e.ignoreTerrain ? MOTE_FLAG.ignoreTerrain : 0) |
    (e.immuneSlow ? MOTE_FLAG.immuneSlow : 0) |
    (e.immunePull ? MOTE_FLAG.immunePull : 0) |
    (e.stopsChain ? MOTE_FLAG.stopsChain : 0);
  pool.count++;
  return id;
}

/** Per-cell linked lists of the living, for the radius queries. */
export function rebuildIndex(pool) {
  pool.head.fill(-1);
  const { head, link, cell, alive } = pool;
  for (let i = 0; i < pool.top; i++) {
    if (!alive[i]) continue;
    const c = cell[i];
    link[i] = head[c];
    head[c] = i;
  }
}

// --- the step ---------------------------------------------------------------

/** Point a mote at the centre of the cell it should walk into next. */
function retarget(pool, id, c, flow) {
  const nxt = flow.next[c];
  const at = nxt >= 0 ? nxt : c;
  pool.tx[id] = (at % pool.W) + 0.5 + pool.ox[id];
  pool.ty[id] = Math.floor(at / pool.W) + 0.5 + pool.oy[id];
}

/**
 * Advance every living mote by `dt` seconds: walk, pull, statuses, leaks.
 * `occupied` is the works' per-cell flag, or null. Kills and leaks are pushed
 * onto `events`; mote-seconds and damage land in `telemetry`.
 */
export function stepMotes(pool, cfg, terrain, flow, occupied, dt, events, telemetry) {
  rebuildIndex(pool);
  const tel = ensureTelemetry(telemetry);
  const W = pool.W, H = pool.H;
  const h = terrain.h, kind = terrain.kind;
  const climb = cfg.terrain.climbCost;
  const workHeight = cfg.terrain.workPathHeight;
  const stuckSeconds = cfg.motes.stuckSeconds;
  const hx = terrain.hearthCenter ? terrain.hearthCenter.x : W - 0.5;
  const hy = terrain.hearthCenter ? terrain.hearthCenter.y : H - 0.5;
  const maxX = W - EDGE, maxY = H - EDGE;

  for (let i = 0; i < pool.top; i++) {
    if (!pool.alive[i]) continue;

    pool.age[i] += dt;
    tel.aliveSeconds += dt;
    if (pool.slow[i] < 1) tel.slowedSeconds += dt;

    const x0 = pool.x[i], y0 = pool.y[i];
    const c = cellAt(pool, x0, y0);
    pool.cell[i] = c;
    const flying = (pool.flags[i] & MOTE_FLAG.ignoreTerrain) !== 0;

    if (c !== pool.lastCell[i]) {
      pool.lastCell[i] = c;
      pool.stuckT[i] = 0;
      if (!flying) retarget(pool, i, c, flow);
    }

    let nx = pool.x[i], ny = pool.y[i];
    let len = pool.speed[i] * pool.slow[i] * dt;

    if (flying) {
      // Wings ignore the ground entirely and make straight for the hearth.
      pool.tx[i] = hx;
      pool.ty[i] = hy;
    } else {
      const nxt = flow.next[c];
      if (nxt >= 0) {
        const effHere = h[c] + (occupied && occupied[c] ? workHeight : 0);
        const effNext = h[nxt] + (occupied && occupied[nxt] ? workHeight : 0);
        const up = effNext - effHere;
        if (up > 0) {
          // The same rule the road costs use, so the cheapest way down is
          // also the quickest way down.
          len /= 1 + climb * up;
          tel.climbSeconds += dt;
        }
      }
    }

    const dx = pool.tx[i] - nx, dy = pool.ty[i] - ny;
    const before = dx * dx + dy * dy;
    const d = Math.sqrt(before);
    if (d <= len || d < 1e-9) { nx = pool.tx[i]; ny = pool.ty[i]; }
    else { nx += dx / d * len; ny += dy / d * len; }

    const px = pool.px[i], py = pool.py[i];
    if (px !== 0 || py !== 0) {
      nx += px;
      ny += py;
      pool.px[i] = 0;
      pool.py[i] = 0;
      pool.pullT[i] += dt;
      tel.pulledSeconds += dt;
    }

    if (nx < 0) nx = 0; else if (nx > maxX) nx = maxX;
    if (ny < 0) ny = 0; else if (ny > maxY) ny = maxY;

    pool.vx[i] = (nx - x0) / dt;
    pool.vy[i] = (ny - y0) / dt;
    pool.x[i] = nx;
    pool.y[i] = ny;
    let c2 = cellAt(pool, nx, ny);
    pool.cell[i] = c2;

    // A walk that spends this long getting no closer to where it is going is
    // jammed against a corner: put the mote on its cell's centre and aim it
    // again. Slow is not stuck - a mote crawling up a tall face is closing on
    // its target every step, and a wall it cannot cross is not a wall.
    const rx = pool.tx[i] - nx, ry = pool.ty[i] - ny;
    if (rx * rx + ry * ry < before) pool.stuckT[i] = 0;
    else pool.stuckT[i] += dt;
    if (!flying && pool.stuckT[i] >= stuckSeconds) {
      pool.stuckT[i] = 0;
      nx = (c2 % W) + 0.5;
      ny = Math.floor(c2 / W) + 0.5;
      pool.x[i] = nx;
      pool.y[i] = ny;
      c2 = cellAt(pool, nx, ny);
      pool.cell[i] = c2;
      retarget(pool, i, c2, flow);
    }

    if (pool.slowT[i] > 0) {
      pool.slowT[i] -= dt;
      if (pool.slowT[i] <= 0) { pool.slowT[i] = 0; pool.slow[i] = 1; }
    }

    if (pool.burnT[i] > 0) {
      const dps = pool.burnDps[i];
      pool.burnT[i] -= dt;
      if (pool.burnT[i] <= 0) { pool.burnT[i] = 0; pool.burnDps[i] = 0; }
      if (dps > 0) {
        damage(pool, cfg, i, dps * dt, 'burn', events, tel, -1);
        if (!pool.alive[i]) continue;
      }
    }

    const regen = pool.regen[i];
    if (regen > 0 && pool.hp[i] < pool.maxHp[i]) {
      const hp = pool.hp[i] + regen * pool.maxHp[i] * dt;
      pool.hp[i] = hp > pool.maxHp[i] ? pool.maxHp[i] : hp;
    }

    if (flying) {
      const gx = hx - nx, gy = hy - ny;
      pool.prio[i] = Math.sqrt(gx * gx + gy * gy);
    } else {
      pool.prio[i] = flow.cost[c2];
    }

    if (kind[c2] === HEARTH) {
      if (events && events.leaked) {
        events.leaked.push({
          id: i,
          leak: pool.leak[i],
          hp: pool.hp[i],
          maxHp: pool.maxHp[i],
          traits: pool.traits[i],
          isSurge: !!pool.isSurge[i],
        });
      }
      // A trickle between surges still burns the hearth, but only the surge
      // itself is counted against the surge.
      if (pool.isSurge[i]) tel.leaked++;
      tel.woundedDealt += pool.maxHp[i] - pool.hp[i];
      free(pool, i);
    }
  }
}

// --- harm and status --------------------------------------------------------

/**
 * Hurt a mote. The trait multiplier, the kill, and the counting all happen
 * here, so every source of harm is resisted and counted the same way.
 * @returns {{dealt: number, killed: boolean}}
 */
export function damage(pool, cfg, id, amount, type, events, telemetry, source) {
  if (id < 0 || id >= pool.cap || !pool.alive[id]) return { dealt: 0, killed: false };
  const tel = ensureTelemetry(telemetry);
  const dealt = amount * takenMultiplier(cfg, pool.traits[id], type);
  pool.hp[id] -= dealt;
  tel.dealt[type] = (tel.dealt[type] || 0) + dealt;

  if (pool.hp[id] > 0) return { dealt, killed: false };

  tel.kills[type] = (tel.kills[type] || 0) + 1;
  if (pool.isSurge[id]) tel.killed++; else tel.ebbKilled++;
  if (events && events.killed) {
    events.killed.push({
      id,
      x: pool.x[id],
      y: pool.y[id],
      type,
      ore: pool.ore[id],
      size: pool.size[id],
      traits: pool.traits[id],
      source: source === undefined ? -1 : source,
      isSurge: !!pool.isSurge[id],
    });
  }
  free(pool, id);
  return { dealt, killed: true };
}

/** Slow a mote. The strongest slow in force wins; the longest duration wins. */
export function applySlow(pool, cfg, id, factor, seconds) {
  if (id < 0 || id >= pool.cap || !pool.alive[id]) return false;
  if (pool.flags[id] & MOTE_FLAG.immuneSlow) return false;
  if (factor < pool.slow[id]) pool.slow[id] = factor;
  if (seconds > pool.slowT[id]) pool.slowT[id] = seconds;
  return true;
}

/** Set a mote burning. The fiercest burn wins; the longest duration wins. */
export function applyBurn(pool, cfg, id, dps, seconds) {
  if (id < 0 || id >= pool.cap || !pool.alive[id]) return false;
  const scaled = seconds * traitEffects(cfg, pool.traits[id]).burnTime;
  if (dps > pool.burnDps[id]) pool.burnDps[id] = dps;
  if (scaled > pool.burnT[id]) pool.burnT[id] = scaled;
  return true;
}

/** Add to the shove a mote takes at the end of this step. */
export function applyPull(pool, cfg, id, dx, dy) {
  if (id < 0 || id >= pool.cap || !pool.alive[id]) return false;
  if (pool.flags[id] & MOTE_FLAG.immunePull) return false;
  pool.px[id] += dx;
  pool.py[id] += dy;
  return true;
}

// --- queries ----------------------------------------------------------------

/**
 * Call `fn(id, dist2)` for every living mote within `r` of a point. Only the
 * cells in the radius's box are walked. A mote killed inside `fn` is skipped
 * for the rest of the scan.
 */
export function forEachInRadius(pool, cx, cy, r, fn) {
  const W = pool.W, H = pool.H;
  const r2 = r * r;
  let x0 = Math.floor(cx - r); if (x0 < 0) x0 = 0;
  let x1 = Math.floor(cx + r); if (x1 > W - 1) x1 = W - 1;
  let y0 = Math.floor(cy - r); if (y0 < 0) y0 = 0;
  let y1 = Math.floor(cy + r); if (y1 > H - 1) y1 = H - 1;

  for (let gy = y0; gy <= y1; gy++) {
    const row = gy * W;
    for (let gx = x0; gx <= x1; gx++) {
      let id = pool.head[row + gx];
      while (id !== -1) {
        const nextId = pool.link[id];
        if (pool.alive[id]) {
          const dx = pool.x[id] - cx, dy = pool.y[id] - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) fn(id, d2);
        }
        id = nextId;
      }
    }
  }
}

/**
 * The living mote nearest the hearth within `r` and no closer than `minR`,
 * or -1. Nearest is by `prio`, which is road time rather than straight line.
 */
export function firstInRadius(pool, cx, cy, r, minR) {
  const min2 = minR ? minR * minR : 0;
  let best = -1;
  let bestPrio = 0;
  forEachInRadius(pool, cx, cy, r, (id, d2) => {
    if (d2 < min2) return;
    const p = pool.prio[id];
    if (best < 0 || p < bestPrio) { best = id; bestPrio = p; }
  });
  return best;
}

/** How many are on the field, or how many of them belong to the surge. */
export function countAlive(pool, surgeOnly) {
  if (!surgeOnly) return pool.count;
  let n = 0;
  for (let i = 0; i < pool.top; i++) if (pool.alive[i] && pool.isSurge[i]) n++;
  return n;
}

// --- saving -----------------------------------------------------------------

/** Every living mote as parallel plain arrays, in slot order. */
export function serializeMotes(pool) {
  const out = { n: pool.count };
  for (const f of FLOATS) out[f] = [];
  for (const f of INTS) out[f] = [];
  for (let i = 0; i < pool.top; i++) {
    if (!pool.alive[i]) continue;
    for (const f of FLOATS) out[f].push(pool[f][i]);
    for (const f of INTS) out[f].push(pool[f][i]);
  }
  return out;
}

/**
 * Put a saved set of motes back, exactly as they were. Slots are handed out
 * from the start, so ids are not the ones the save was written with; nothing
 * outside a single step holds a mote's id.
 */
export function restoreMotes(pool, cfg, data) {
  pool.alive.fill(0);
  pool.head.fill(-1);
  pool.link.fill(-1);
  pool.count = 0;
  pool.top = 0;
  pool.freeList.length = 0;
  if (!data) return 0;
  const n = data.x ? data.x.length : 0;
  for (let k = 0; k < n; k++) {
    const id = alloc(pool);
    if (id < 0) break;
    for (const f of FLOATS) {
      const v = data[f] ? data[f][k] : 0;
      // A save written through JSON loses an infinite priority; an unstepped
      // mote is furthest from the hearth, which is what that value means.
      pool[f][id] = (v === null || v === undefined) ? (f === 'prio' ? Infinity : 0) : v;
    }
    for (const f of INTS) pool[f][id] = data[f] ? data[f][k] : 0;
    if (!data.lastCell) pool.lastCell[id] = -1;
    pool.alive[id] = 1;
    pool.count++;
  }
  return pool.count;
}
