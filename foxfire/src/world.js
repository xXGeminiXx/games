// ---------------------------------------------------------------------------
// The ground at one scale.
//
// A level is a disc of lattice cells. Each cell holds at most one node, set a
// little off its lattice point so the picture is not a grid. What a node is -
// dead wood, bare soil, or the root of a living tree - comes from a slow noise
// over the lattice, so kinds arrive in patches the way a forest floor does.
//
// Everything here is a pure function of (config, seed, level). Nothing is
// stored: the same seed always lays out the same ground, which is why a save
// only has to remember which nodes have been reached.
// ---------------------------------------------------------------------------

import { hash, unit } from './rng.js?v=19';

/** Number of lattice cells inside a disc of the given radius. */
export function cellsInDisc(radius) {
  let n = 0;
  const r2 = radius * radius;
  for (let i = -radius; i <= radius; i++) {
    for (let j = -radius; j <= radius; j++) if (i * i + j * j <= r2) n++;
  }
  return n;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Value noise in [0,1): lattice hashes, blended. Continuous in x and y. */
export function noise(seed, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const v = (ix, iy) => unit(seed, 'n:' + ix + ':' + iy);
  const a = v(x0, y0), b = v(x0 + 1, y0), c = v(x0, y0 + 1), d = v(x0 + 1, y0 + 1);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

/** The ring a lattice cell belongs to. The origin is ring 1. */
export function ringOf(i, j, ringWidth) {
  const d = Math.sqrt(i * i + j * j);
  return Math.max(1, Math.ceil(d / ringWidth));
}

/**
 * Lay out one level.
 * @returns {{ level, seed, radius, nodes, byCell, ringCounts, total, origin }}
 */
export function buildLevel(cfg, seed, level) {
  const w = cfg.world;
  const lseed = hash(seed >>> 0, 'level:' + level);
  const radius = w.ringWidth * w.rings;
  const r2 = radius * radius;
  const nodes = [];
  const byCell = new Map();
  const ringCounts = new Array(w.rings + 1).fill(0);
  const perLevel = cfg.trees.perLevel;

  // Weighted species pick over the level's roster window.
  const roster = [];
  for (let k = 0; k < perLevel; k++) {
    const entry = cfg.trees.roster[(level * perLevel + k) % cfg.trees.roster.length];
    roster.push(entry.weight > 0 ? entry.weight : 1);
  }
  const rosterTotal = roster.reduce((a, b) => a + b, 0);
  const pickSpecies = (i, j) => {
    let roll = unit(lseed, 'sp:' + i + ':' + j) * rosterTotal;
    for (let k = 0; k < roster.length; k++) {
      if (roll < roster[k]) return k;
      roll -= roster[k];
    }
    return roster.length - 1;
  };

  const add = (i, j, kind, jitter) => {
    const id = nodes.length;
    const jx = jitter ? (unit(lseed, 'jx:' + i + ':' + j) - 0.5) * 2 * w.jitter : 0;
    const jy = jitter ? (unit(lseed, 'jy:' + i + ':' + j) - 0.5) * 2 * w.jitter : 0;
    const ring = ringOf(i, j, w.ringWidth);
    const node = { id, i, j, x: i + jx, y: j + jy, kind, ring, sp: -1, s0: 0, stock: 1 };
    if (kind === 'root') {
      node.sp = pickSpecies(i, j);
      const [lo, hi] = cfg.trees.startSize;
      node.s0 = lo + unit(lseed, 's0:' + i + ':' + j) * (hi - lo);
    } else if (kind === 'wood') {
      node.stock = 1 + (unit(lseed, 'st:' + i + ':' + j) - 0.5) * cfg.wood.stockSpread;
    }
    nodes.push(node);
    byCell.set(i + ',' + j, id);
    ringCounts[ring]++;
    return node;
  };

  // The origin: the log the spore landed on. Always present, always wood.
  add(0, 0, 'wood', false);

  for (let i = -radius; i <= radius; i++) {
    for (let j = -radius; j <= radius; j++) {
      if (i === 0 && j === 0) continue;
      if (i * i + j * j > r2) continue;
      if (unit(lseed, 'has:' + i + ':' + j) >= w.density) continue;
      const n = noise(lseed, i / w.noiseScale, j / w.noiseScale);
      const kind = n < w.soilBelow ? 'soil' : (n < w.woodBelow ? 'wood' : 'root');
      add(i, j, kind, true);
    }
  }

  // The nearest nodes to the origin are one of each kind, in a fixed order,
  // so the opening always shows a root, bare soil and a log.
  const opening = w.openingKinds || [];
  if (opening.length) {
    const near = nodes.slice(1).sort((a, b) => (a.x * a.x + a.y * a.y) - (b.x * b.x + b.y * b.y) || a.id - b.id);
    for (let k = 0; k < opening.length && k < near.length; k++) {
      const n = near[k];
      const kind = opening[k];
      if (n.kind === kind) continue;
      n.kind = kind;
      n.sp = kind === 'root' ? pickSpecies(n.i, n.j) : -1;
      n.s0 = kind === 'root' ? cfg.trees.startSize[0] + unit(lseed, 's0:' + n.i + ':' + n.j) * (cfg.trees.startSize[1] - cfg.trees.startSize[0]) : 0;
      n.stock = kind === 'wood' ? 1 + (unit(lseed, 'st:' + n.i + ':' + n.j) - 0.5) * cfg.wood.stockSpread : 1;
    }
  }

  return { level, seed: lseed, radius, nodes, byCell, ringCounts, total: nodes.length, origin: 0 };
}

/** How many nodes lie within the first `ring` rings. */
export function openedCount(world, ring) {
  let n = 0;
  for (let r = 1; r <= ring && r < world.ringCounts.length; r++) n += world.ringCounts[r];
  return n;
}

/**
 * The nearest node to `from` that is open, unreached and unclaimed, within
 * `search` cells. Ties break on id so the choice is deterministic.
 *
 * events.js: `isRival` names ground another fungus holds. It is passed over
 * like reached ground unless the caller asks for it with `takeRival`, which
 * is how ground is contested rather than simply walked into.
 *
 * `aim` is a place on this ground the player has sent the front toward, as
 * {x, y, pull}. A node lying that way is judged nearer than it is - a node
 * straight toward the mark counts as (1 - pull) of its distance - so the front
 * leans without ever refusing ground beside it. It is a pure function of the
 * positions, so a coarse step and a fine one still choose the same node.
 * @returns node id, or -1
 */
export function nearestOpen(world, fromId, search, ring, isReached, isClaimed, isRival, takeRival, aim) {
  const from = world.nodes[fromId];
  if (!from) return -1;
  const span = Math.ceil(search);
  const s2 = search * search;
  let ax = 0, ay = 0, pull = 0;
  if (aim) {
    ax = aim.x - from.x;
    ay = aim.y - from.y;
    const len = Math.sqrt(ax * ax + ay * ay);
    if (len > 1e-6) { ax /= len; ay /= len; pull = aim.pull > 0 ? aim.pull : 0; }
  }
  let best = -1;
  let bestScore = Infinity;
  for (let di = -span; di <= span; di++) {
    for (let dj = -span; dj <= span; dj++) {
      const id = world.byCell.get((from.i + di) + ',' + (from.j + dj));
      if (id === undefined || id === fromId) continue;
      const n = world.nodes[id];
      if (n.ring > ring) continue;
      if (isReached(id) || isClaimed(id)) continue;
      if (isRival && !takeRival && isRival(id)) continue;
      const dx = n.x - from.x, dy = n.y - from.y;
      const d = dx * dx + dy * dy;
      if (d > s2) continue;
      let score = d;
      if (pull > 0 && d > 1e-12) {
        const cos = (dx * ax + dy * ay) / Math.sqrt(d);
        if (cos > 0) score = d * (1 - pull * cos);
      }
      if (score < bestScore || (score === bestScore && id < best)) { bestScore = score; best = id; }
    }
  }
  return best;
}

/** Whether `fromId` has any open, unreached node within reach at all. */
export function hasOpenNear(world, fromId, search, ring, isReached) {
  return nearestOpen(world, fromId, search, ring, isReached, () => false) >= 0;
}
