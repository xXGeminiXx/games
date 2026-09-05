// ===========================================================================
// BLOOM - a field that grows out of what you left standing
//
// The other two generators are blind. An automaton row and a fractal figure are
// both decided before the field is looked at: the same seed at the same depth
// produces the same arrangement whether the board beneath is empty or packed.
// That is correct for a field that descends, because the player's answer to it
// is where to aim, and a field that reacted to the aim would be arguing with
// the only decision in the game.
//
// A field that does not descend has to be answered differently, and this is the
// third layout: growth that reads the board every turn and accretes onto what
// is still there.
//
// THE RULE, IN ONE LINE: a new block appears where the mass already is.
//
// Every consequence of the game falls out of that one line.
//
//   A clump left standing is not just health you still owe, it is the seed the
//   next turn grows from. Breaking the edge off a clump is worth less than
//   breaking its middle out.
//
//   The board fills from the FLOOR UPWARD, like a tide. Growth seeds on the
//   bottom row and prefers to hang below what is already there, so the mass
//   thickens along the bottom and then climbs. The board getting fuller is
//   something you watch happen rather than a number you have to read.
//
//   Clear the board completely and the field has nothing to grow from, so it
//   starts again from a handful of cells at the top. A perfect turn buys a
//   quiet one, which is the only mercy in the mode and it has to be earned.
//
//   A marker nothing has collected is a hole the growth cannot fill. Leaving it
//   there shapes where the mass can go; taking it hands that cell back. Both
//   are real answers and neither is free.
//
// This is the Eden growth process, which is a genuinely fractal object rather
// than a fractal-looking one: a cluster grown by accretion has a rough,
// self-similar boundary at every scale it is allowed to reach. It is in the
// same family as the constructions the fractal mode deals, arrived at from the
// other direction - those are drawn whole and revealed a row at a time, this
// one is never drawn at all and is only ever what the player has left behind.
//
// ---------------------------------------------------------------------------
// DETERMINISM
//
// Every choice here is a hash of the run seed, the depth, and the cell's own
// position. Nothing is drawn at random and nothing depends on the order blocks
// happen to sit in an array, so the same run replayed from the same saved board
// grows the same field. That matters more here than anywhere else in the game:
// the board IS the generator's input, so a save that restores the board
// restores the whole future of the run.
// ===========================================================================

import { CONFIG } from '../config.js?v=25';
import { safeRows, cellKey } from './arrival.js?v=25';

/** 32 bit mix over three inputs. The run, the depth, and the cell. */
function mix(a, b, c) {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b + 0x85ebca6b), 0xcc9e2d51) >>> 0;
  h = Math.imul(h ^ (c + 0xc2b2ae35), 0x1b873593) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2545f491) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

/** That mix as a fraction in [0, 1). */
const roll = (a, b, c) => mix(a, b, c) / 4294967296;

// Neighbours, and what each one is worth to a candidate cell. A cell hanging
// below the mass is worth more than one beside it, and one touching only at a
// corner is worth least - which is what makes a cluster grow into a body rather
// than into a scatter of diagonals.
//
//   dc, dr, weight
const NEIGHBOURS = [
  [0, -1, 1.0],    // directly above: the mass hangs down
  [-1, 0, 0.62], [1, 0, 0.62],
  [0, 1, 0.34],    // directly below: growth climbs, but reluctantly
  [-1, -1, 0.30], [1, -1, 0.30],
  [-1, 1, 0.16], [1, 1, 0.16],
];

const DEFAULTS = {
  budget: 3,
  seedCells: 3,
  hang: 0.55,
  jitter: 0.5,
  climb: 0.14,
};

/**
 * A source of growth.
 *
 * Unlike the other two layouts this one holds no sequence of its own. It has
 * nothing to deal, because what it produces next depends entirely on what is on
 * the board when it is asked. That is the whole point of it, and it is why this
 * mode's save is the board rather than a position in a queue.
 *
 * @param {number} seed  the run's field seed
 * @param {object} [opts]
 * @param {number} [opts.budget]     blocks grown per turn, before the tier
 * @param {number} [opts.seedCells]  blocks placed when the board is empty
 * @param {number} [opts.hang]       extra weight for growing downward
 * @param {number} [opts.jitter]     how much of the score is the hash
 * @param {number} [opts.climb]      preference for lower rows over higher ones
 */
export function createBloomSource(seed, opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, CONFIG.bloom || {}, opts || {});
  const s = (seed >>> 0) || 1;

  const budget = Math.max(1, Math.round(Number(cfg.budget) || DEFAULTS.budget));
  const seedCells = Math.max(1, Math.round(Number(cfg.seedCells) || DEFAULTS.seedCells));
  const hang = Number.isFinite(cfg.hang) ? cfg.hang : DEFAULTS.hang;
  const jitter = Number.isFinite(cfg.jitter) ? cfg.jitter : DEFAULTS.jitter;
  const climb = Number.isFinite(cfg.climb) ? cfg.climb : DEFAULTS.climb;

  /**
   * The opening cluster, and the one the field falls back to whenever the
   * player has cleared everything.
   *
   * IT LANDS ON THE BOTTOM ROW, NOT THE TOP, and that is the whole shape of the
   * mode. The board fills from the floor upward like a tide coming in: the mass
   * thickens along the bottom, then climbs, and the last thing to go is the
   * headroom the swarm needs. Three things follow from it.
   *
   * The board being full is something a player SEES rather than a number they
   * have to read, at every stage of a run and not only at the end of a long
   * one. Seeded at the top instead, a run that ends early ends with a clump in
   * one corner and an empty floor, which is a board being called sealed while
   * it visibly is not.
   *
   * The mass is where the swarm's traffic is, so it is always breakable, and
   * the run is decided by whether the player can break it faster than it grows
   * rather than by whether they can reach it at all.
   *
   * And it puts the markers at the far end of the board from the mass, which is
   * where the only real decision in a turn comes from: pound the wall in front
   * of the launcher, or thread a shot up through the gaps to the pickup that
   * grows the swarm.
   *
   * The columns are offset by the depth so a cleared board does not come back
   * in the same place twice.
   */
  function seedCluster(depth, view, want) {
    const rows = safeRows(view);
    const span = Math.min(view.cols, Math.max(1, want));
    const start = view.lo + (mix(s, depth, 0) % Math.max(1, view.cols - span + 1));
    const out = [];
    for (let i = 0; i < want; i++) {
      // Wraps upward once the bottom row is full, so a large opening cluster is
      // a small block of field rather than a single long bar.
      const c = start + (i % span);
      const r = Math.max(0, rows - 1 - Math.floor(i / span));
      out.push({ c, r });
    }
    return out;
  }

  return {
    key: 'bloom',
    name: 'bloom',

    /** Blocks this source wants to add per turn, before the tier adjusts it. */
    budget,

    /**
     * How many blocks arrive this turn.
     *
     * The tier states its density as a BIAS rather than a count, because every
     * generator has its own idea of a normal amount and a tier is meant to lean
     * on that rather than replace it. This is where the lean lands for a field
     * that grows: the mode's own budget, moved by the tier.
     */
    wantAt(view) {
      const bias = (view && Number.isFinite(view.bias)) ? view.bias : 0;
      return Math.max(1, Math.round(budget * (1 + bias)));
    },

    /**
     * Where the field grows this turn.
     *
     * @param {number} depth
     * @param {import('./arrival.js').BoardView} view
     * @param {number} [want]  blocks to place; defaults to wantAt(view)
     * @returns {Array<{c: number, r: number}>}
     */
    grow(depth, view, want) {
      const n = Math.max(0, Math.round(Number.isFinite(want) ? want : this.wantAt(view)));
      if (n === 0) return [];

      const rows = safeRows(view);
      const taken = new Set();
      for (const b of view.blocks) taken.add(cellKey(b.c, b.r));
      // A marker is not a block, but nothing may grow on top of one: a ring and
      // a health number in the same cell leave neither readable, and an
      // uncollected marker being a hole in the growth is the whole reason to
      // think about whether to collect it.
      const blocked = new Set(taken);
      for (const p of view.drops) blocked.add(cellKey(p.c, p.r));

      if (taken.size === 0) {
        // Nothing to grow from. Seed, and place at least this turn's budget so
        // a cleared board is a quiet turn rather than a free one.
        return seedCluster(depth, view, Math.max(n, seedCells))
          .filter(cell => !blocked.has(cellKey(cell.c, cell.r)))
          .slice(0, Math.max(n, seedCells));
      }

      // Every free cell that touches the mass, scored by how much of the mass
      // it touches. Built by walking the BLOCKS rather than the whole field, so
      // the cost is the size of the cluster and not the size of the board.
      const scores = new Map();
      for (const b of view.blocks) {
        for (const [dc, dr, w] of NEIGHBOURS) {
          // The neighbour offsets are written from the CANDIDATE's point of
          // view, so reaching a candidate from a block means stepping the other
          // way: a block above a candidate is the candidate's [0, -1].
          const c = b.c - dc, r = b.r - dr;
          if (r < 0 || r >= rows) continue;
          if (c < view.lo || c >= view.lo + view.cols) continue;
          const k = cellKey(c, r);
          if (blocked.has(k)) continue;
          scores.set(k, (scores.get(k) || 0) + w + (dr === -1 ? hang : 0));
        }
      }

      if (scores.size === 0) {
        // The mass has sealed itself in behind the markers. Vanishingly rare,
        // and the run is nearly over when it happens, but a turn that grows
        // nothing is a turn with no pressure at all - so fall back to any free
        // cell rather than quietly doing nothing.
        for (let r = 0; r < rows; r++) {
          for (let c = view.lo; c < view.lo + view.cols; c++) {
            const k = cellKey(c, r);
            if (!blocked.has(k)) scores.set(k, 0);
          }
        }
        if (scores.size === 0) return [];
      }

      // Rank. The hash term is what stops the same handful of cells winning
      // every turn on a symmetric board, and it is a hash of the cell rather
      // than a random draw so the ranking is the same every time this board is
      // scored - which is what lets a saved run be restored and replayed.
      const ranked = [];
      for (const [k, base] of scores) {
        const cut = k.indexOf(',');
        const c = +k.slice(0, cut), r = +k.slice(cut + 1);
        ranked.push({
          c, r,
          score: base
            + climb * (r / Math.max(1, rows - 1))
            + jitter * roll(s ^ 0x27d4eb2f, depth, (r << 8) ^ (c & 255)),
        });
      }
      // Sorted on the score alone would be undefined where two cells tie, and
      // an unstable sort would then make the field depend on array order. The
      // position is the tiebreak, so the order is total.
      ranked.sort((a, b) =>
        (b.score - a.score) || (a.r - b.r) || (a.c - b.c));

      return ranked.slice(0, n).map(cell => ({ c: cell.c, r: cell.r }));
    },

    /**
     * Free cells a marker may land in, ranked. THE FRINGE OF THE MASS FIRST -
     * cells touching what is already standing, before open space.
     *
     * The opposite was tried and measured. Ranking the FURTHEST cells first
     * sounds better on paper: it makes a pickup something the swarm has to be
     * aimed at rather than something it was going to hit anyway, which is the
     * one decision the difficulty ladder is built to grip. It does not survive
     * contact with this field. The mass here sits along the floor in front of
     * the launcher, so the furthest free cell is at the top of the board behind
     * a wall, and a pickup behind a wall is not a hard shot, it is a tax.
     *
     * On the fringe it is a shot that has to clear the top edge of the mass,
     * which is a real aim and a reachable one. Measured over 32 runs a tier
     * against the same angle sweep, that is worth five depths of separation
     * between swell and undertow instead of three, and it lands a swarm of 15
     * against 9 rather than 12 against 8 - the supply line reaching the player
     * at all is what lets the tiers differ.
     *
     * A marker also blocks growth, so where they land shapes the field: one
     * left on the fringe holds open the cell the mass most wants next.
     */
    openCells(depth, view) {
      const rows = safeRows(view);
      const blocked = new Set();
      for (const b of view.blocks) blocked.add(cellKey(b.c, b.r));
      for (const p of view.drops) blocked.add(cellKey(p.c, p.r));

      const near = new Set();
      for (const b of view.blocks) {
        for (const [dc, dr] of NEIGHBOURS) near.add(cellKey(b.c - dc, b.r - dr));
      }

      const out = [];
      for (let r = 0; r < rows; r++) {
        for (let c = view.lo; c < view.lo + view.cols; c++) {
          const k = cellKey(c, r);
          if (blocked.has(k)) continue;
          out.push({ c, r, near: near.has(k) ? 1 : 0 });
        }
      }
      out.sort((a, b) =>
        (b.near - a.near)
        || (roll(s ^ 0x165667b1, depth, (a.r << 8) ^ (a.c & 255))
            - roll(s ^ 0x165667b1, depth, (b.r << 8) ^ (b.c & 255)))
        || (a.r - b.r) || (a.c - b.c));
      return out.map(cell => ({ c: cell.c, r: cell.r }));
    },
  };
}

export default createBloomSource;
