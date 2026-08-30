// ---------------------------------------------------------------------------
// The tips: the foraging front.
//
// A tip sits on a reached node, picks the nearest open node nobody has
// reached or claimed, and travels to it. Arriving reaches the node and lays a
// thread. When there is nothing left near it, a tip moves to another node on
// the frontier and looks again; when the frontier is empty it waits.
//
// Movement is by distance budget, so a step of five seconds covers as many
// hops as five seconds would and lands exactly where fifty steps of a tenth
// would. That is what lets time away be caught up in coarse chunks.
// ---------------------------------------------------------------------------

import { nearestOpen } from './world.js?v=9';
import { hash } from './rng.js?v=9';

/** A set with O(1) add, delete and random access, for the frontier. */
export class IndexedSet {
  constructor() { this.items = []; this.index = new Map(); }
  get size() { return this.items.length; }
  has(v) { return this.index.has(v); }
  add(v) {
    if (this.index.has(v)) return;
    this.index.set(v, this.items.length);
    this.items.push(v);
  }
  delete(v) {
    const i = this.index.get(v);
    if (i === undefined) return;
    const last = this.items.pop();
    this.index.delete(v);
    if (i < this.items.length) { this.items[i] = last; this.index.set(last, i); }
  }
  at(i) { return this.items[i]; }
  clear() { this.items.length = 0; this.index.clear(); }
}

/** Runtime bookkeeping rebuilt from a save: what is reached, claimed, and on the frontier. */
export function runtimeOf(state) {
  const rt = { reached: new Set(state.reached), claimed: new Set(), frontier: new IndexedSet() };
  for (const id of state.reached) rt.frontier.add(id);
  for (const t of state.tips) if (t.to >= 0) rt.claimed.add(t.to);
  return rt;
}

/** A new tip on the given node. */
export function makeTip(world, nodeId) {
  const n = world.nodes[nodeId];
  // events.js: `pay` is distance still owed for pushing into contested ground.
  return { x: n.x, y: n.y, from: nodeId, to: -1, pay: 0 };
}

/**
 * Move every tip by `budget` cells. `reach(id, fromId)` is called for each
 * node newly arrived at. Returns how many arrivals there were.
 */
export function step(state, world, rt, budget, search, reach) {
  if (!(budget > 0)) return 0;
  // Nothing left to reach and nobody on the way to anything: the whole front
  // waits, and a step costs nothing. A tip already travelling still arrives.
  if (rt.frontier.size === 0) {
    let moving = false;
    for (let k = 0; k < state.tips.length; k++) if (state.tips[k].to >= 0) { moving = true; break; }
    if (!moving) return 0;
  }
  const nodes = world.nodes;
  const isReached = (id) => rt.reached.has(id);
  const isClaimed = (id) => rt.claimed.has(id);
  const unclaimed = () => false;
  let arrivals = 0;
  // events.js: ground another fungus holds is not free to take. A tip looks
  // past it first and pushes into it only when there is nothing else beside
  // it, and the hop costs this many times the distance.
  const rival = rt.rival;
  const isRival = (rival && rival.size) ? (id) => rival.has(id) : null;
  const rivalCost = rt.rivalCost > 1 ? rt.rivalCost : 1;

  for (let k = 0; k < state.tips.length; k++) {
    const t = state.tips[k];
    let left = budget;
    let hops = 0;
    while (left > 0 && hops < 256) {
      if (t.to < 0) {
        let target = nearestOpen(world, t.from, search, state.ring, isReached, isClaimed, isRival, false);
        if (target < 0 && isRival) {
          target = nearestOpen(world, t.from, search, state.ring, isReached, isClaimed, isRival, true);
          if (target >= 0) {
            const n = nodes[target];
            t.pay = (rivalCost - 1) * Math.sqrt((n.x - t.x) * (n.x - t.x) + (n.y - t.y) * (n.y - t.y));
          }
        }
        if (target < 0) {
          // Nothing free near here. If there is nothing open near here at all
          // the node is exhausted and the tip moves to the frontier; if the
          // open nodes are merely claimed by other tips, it waits its turn.
          // Contested ground is not worth queueing behind: another tip is
          // already paying its way in, so this one goes and finds work.
          if (nearestOpen(world, t.from, search, state.ring, isReached, unclaimed, isRival, false) >= 0) break;
          rt.frontier.delete(t.from);
          if (rt.frontier.size === 0) break;
          const pick = hash(state.seed, 'relocate:' + k + ':' + state.relocations) % rt.frontier.size;
          state.relocations = (state.relocations + 1) >>> 0;
          const f = rt.frontier.at(pick);
          t.from = f;
          t.x = nodes[f].x;
          t.y = nodes[f].y;
          hops++;
          continue;
        }
        t.to = target;
        rt.claimed.add(target);
      }
      // events.js: the distance owed for contested ground is paid first, out
      // of the same budget, so a coarse step and a fine one pay the same.
      if (t.pay > 0) {
        const spend = Math.min(t.pay, left);
        t.pay -= spend;
        left -= spend;
        if (!(left > 0)) break;
      }
      const n = nodes[t.to];
      const dx = n.x - t.x, dy = n.y - t.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= left) {
        t.x = n.x;
        t.y = n.y;
        left -= d;
        rt.claimed.delete(t.to);
        if (!rt.reached.has(t.to)) { reach(t.to, t.from); arrivals++; }
        t.from = t.to;
        t.to = -1;
        hops++;
      } else {
        t.x += (dx / d) * left;
        t.y += (dy / d) * left;
        left = 0;
      }
    }
  }
  return arrivals;
}

/** Every tip back on one node, with no target. Used when a level is folded. */
export function gather(state, world, nodeId) {
  for (const t of state.tips) {
    const n = world.nodes[nodeId];
    t.x = n.x; t.y = n.y; t.from = nodeId; t.to = -1; t.pay = 0;
  }
}
