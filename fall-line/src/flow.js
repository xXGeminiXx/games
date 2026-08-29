// ---------------------------------------------------------------------------
// The flow field.
//
// Every cell is asked one question: which neighbour is the quickest way to the
// hearth from here, and how long does the rest of the road take. The answer is
// a single Dijkstra pass outward from the hearth over the eight neighbours,
// and it is the whole of the Melt's routing: a mote reads `next` and walks.
//
// Nothing is impassable. Height is time, so every cell always has a finite
// answer, and a wall is a toll rather than a barrier. Because the field is
// recomputed while the player drags a brush across the ground, the pass has to
// stay inside a couple of milliseconds; it works on typed arrays throughout
// and allocates only the two arrays it hands back.
// ---------------------------------------------------------------------------

import { KIND } from './terrain.js?v=7';

export const SQRT2 = Math.SQRT2;

// Neighbours in the order they are visited: four orthogonal, then four
// diagonal. A diagonal is the last four, which is what the loop tests on.
const DX = new Int8Array([1, -1, 0, 0, 1, 1, -1, -1]);
const DY = new Int8Array([0, 0, 1, -1, 1, -1, 1, -1]);


/** The height a step has to reckon with: the ground, plus anything built on it. */
export function effectiveHeight(cfg, terrain, occupied, i) {
  return terrain.h[i] + (occupied && occupied[i] ? cfg.terrain.workPathHeight : 0);
}

/**
 * The time one step takes. Climbing is what costs; going down is free, so a
 * long shallow road can beat a short steep one.
 *
 * The motes move at the reciprocal of this, which is why it lives in one
 * function: the least-cost road and the least-time road have to be the same
 * road, or the field would send them somewhere they do not want to go.
 */
export function stepCost(cfg, effFrom, effTo, dist) {
  const up = effTo - effFrom;
  return up > 0 ? dist * (1 + cfg.terrain.climbCost * up) : dist;
}


// Scratch that outlives a call, so a drag does not allocate once per frame.
// One pass is never inside another, so a single set is enough.
let scratchCells = 0;
let eff = null;
let settled = null;
let heapCell = null;
let heapCost = null;

function reserve(n) {
  if (scratchCells >= n) return;
  scratchCells = n;
  eff = new Float32Array(n);
  settled = new Uint8Array(n);
  // Every cell can be improved once per neighbour that settles before it, so
  // eight entries a cell is the ceiling on what the heap ever holds.
  heapCell = new Int32Array(n * 8 + 8);
  heapCost = new Float32Array(n * 8 + 8);
}

/**
 * The cost to the hearth from every cell, and the neighbour to walk toward.
 * `occupied` is a per-cell flag for the works standing on the ground, or null.
 */
export function computeFlow(cfg, terrain, occupied) {
  const W = terrain.W, H = terrain.H, n = W * H;
  reserve(n);

  const cost = new Float32Array(n);
  const next = new Int32Array(n);
  cost.fill(Infinity);
  next.fill(-1);

  const lift = cfg.terrain.workPathHeight;
  for (let i = 0; i < n; i++) {
    eff[i] = occupied && occupied[i] ? terrain.h[i] + lift : terrain.h[i];
    settled[i] = 0;
  }

  let size = 0;
  const push = (cell, key) => {
    let k = size++;
    heapCell[k] = cell;
    heapCost[k] = key;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (heapCost[parent] <= heapCost[k]) break;
      const c = heapCell[parent]; const q = heapCost[parent];
      heapCell[parent] = heapCell[k]; heapCost[parent] = heapCost[k];
      heapCell[k] = c; heapCost[k] = q;
      k = parent;
    }
  };
  const pop = () => {
    const top = heapCell[0];
    size--;
    if (size > 0) {
      heapCell[0] = heapCell[size];
      heapCost[0] = heapCost[size];
      let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1;
        if (l >= size) break;
        let m = (r < size && heapCost[r] < heapCost[l]) ? r : l;
        if (heapCost[k] <= heapCost[m]) break;
        const c = heapCell[m]; const q = heapCost[m];
        heapCell[m] = heapCell[k]; heapCost[m] = heapCost[k];
        heapCell[k] = c; heapCost[k] = q;
        k = m;
      }
    }
    return top;
  };

  for (let s = 0; s < terrain.hearth.length; s++) {
    const i = terrain.hearth[s];
    cost[i] = 0;
    next[i] = -1;
    push(i, 0);
  }

  while (size > 0) {
    const b = pop();
    if (settled[b]) continue;
    settled[b] = 1;
    const base = cost[b];
    const bx = b % W, by = (b - bx) / W;
    const effB = eff[b];

    for (let d = 0; d < 8; d++) {
      const ax = bx + DX[d], ay = by + DY[d];
      if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
      const a = ay * W + ax;
      if (settled[a]) continue;

      // A mote walking a -> b squeezes between the two cells that share a
      // corner with both of them, so a diagonal is only as open as the lower
      // of the pair. Only the ground counts as a corner: a work makes its own
      // cell costly and nothing else, otherwise a road lined with works on
      // both sides would grow dearer with every one built and slide away
      // from the very works meant to cover it.
      let target = effB;
      let dist = 1;
      if (d >= 4) {
        dist = SQRT2;
        const c1 = terrain.h[by * W + ax];
        const c2 = terrain.h[ay * W + bx];
        const gate = c1 < c2 ? c1 : c2;
        if (gate > target) target = gate;
      }

      const c = base + stepCost(cfg, eff[a], target, dist);
      if (c < cost[a]) {
        cost[a] = c;
        next[a] = b;
        push(a, c);
      }
    }
  }

  return { cost, next, version: terrain.version };
}

/**
 * The cells a mote starting here will walk over, ending on the hearth cell it
 * reaches. The step limit is the whole grid: `next` always descends, so it can
 * never come back around, and the guard is there for a field that never was
 * computed rather than for a loop.
 */
export function traceFallLine(flow, terrain, fromIdx) {
  const out = [];
  const n = terrain.W * terrain.H;
  let i = fromIdx | 0;
  if (i < 0 || i >= n) return out;
  for (let step = 0; step <= n; step++) {
    out.push(i);
    if (terrain.kind[i] === KIND.hearth) break;
    const to = flow.next[i];
    if (to < 0 || to >= n) break;
    i = to;
  }
  return out;
}

/** The snowline cell with the shortest road down, which is where the Melt aims. */
export function bestSnowlineStart(flow, terrain) {
  let best = -1;
  let bestCost = Infinity;
  for (let s = 0; s < terrain.snowline.length; s++) {
    const i = terrain.snowline[s];
    if (flow.cost[i] < bestCost) { bestCost = flow.cost[i]; best = i; }
  }
  return best;
}

/** How long that road is. This against the straight line is the detour earned. */
export function pathCostFromSnowline(flow, terrain) {
  const i = bestSnowlineStart(flow, terrain);
  return i < 0 ? Infinity : flow.cost[i];
}

/** The distance down with no ground in the way, in cells. */
export function straightCells(terrain) {
  const dx = terrain.hearthCenter.x - terrain.snowCenter.x;
  const dy = terrain.hearthCenter.y - terrain.snowCenter.y;
  return Math.sqrt(dx * dx + dy * dy);
}
