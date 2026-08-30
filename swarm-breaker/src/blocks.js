// ---------------------------------------------------------------------------
// BLOCK KINDS - what a block is besides a number
//
// Every block on the field is a cell with health. A KIND is what else it is:
// what happens at the moment that health runs out.
//
// Kinds are deliberately rare. The first thing a player learns is that a block
// is a number and the swarm is the answer, and a surprise is only a surprise
// against a rule they already trust. So nothing special appears in the opening
// minute, and after that a special block is a few in a hundred.
//
// A kind is DATA. It names itself, says how often it can appear and how deep
// the run has to be before it can, carries a colour so it can be recognised
// before it is broken, and holds an EFFECT. The effect is a small shared
// vocabulary - spray bodies, pay essence, add to the swarm, clear a row - that
// the game knows how to apply. Adding a kind needs an entry in config.js and
// nothing else, unless it wants a verb that does not exist yet, in which case
// it needs exactly one more line where effects are applied.
//
// Which blocks are special is decided from the run's seed and the block's own
// position, never from a random number drawn at placement time. The same seed
// gives the same field down to which of its blocks will surprise you, which is
// what lets a run be saved, replayed and tested.
// ---------------------------------------------------------------------------

import { CONFIG } from '../config.js?v=17';

/** 32 bit mix. Three inputs so a kind depends on the run, the depth and the
 *  column, and never on the order blocks happened to be placed in. */
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

const DEFAULTS = { share: 0, firstDepth: 1, kinds: [] };

/**
 * A kind's colour, resolved from the palette by MEANING.
 *
 * A kind names one of the palette's own colours - swarm, essence, force, trade,
 * hot - rather than carrying a hex of its own, so the bracket around a special
 * block promises exactly what that colour promises everywhere else in the game.
 * Anything unrecognised is taken as a literal colour, so a one-off is still
 * possible without touching this.
 */
function tintOf(name) {
  if (!name) return null;
  const p = CONFIG.palette || {};
  return p[name] || name;
}

/**
 * Build the kind roller for a run.
 *
 * @param {number} seed  the run's field seed
 * @param {object} [opts]
 * @param {number} [opts.share]       share of blocks that are special
 * @param {number} [opts.firstDepth]  no kind appears above this depth
 * @param {Array}  [opts.kinds]       kind definitions; defaults to config
 * @param {boolean} [opts.lattice]    false on a field whose blocks are not
 *                                    cells; kinds marked needsLattice are dropped
 * @returns {{rollFor: function, byId: function, list: Array, share: number}}
 */
export function createBlockKinds(seed, opts) {
  const cfg = Object.assign({}, DEFAULTS, CONFIG.blocks || {}, opts || {});
  const s = (seed >>> 0) || 1;

  // A kind with no weight, no effect or an impossible depth is not an error;
  // it is a kind that has been switched off, and it simply never rolls. A
  // kind that needs the lattice - one that puts new blocks in the cells
  // beside it - is switched off on a field whose blocks are not cells.
  const lattice = !opts || opts.lattice !== false;
  const kinds = (Array.isArray(cfg.kinds) ? cfg.kinds : [])
    .filter(k => k && k.id && k.effect && (k.weight || 0) > 0)
    .filter(k => lattice || !k.needsLattice)
    .map(k => Object.assign({}, k, { tint: tintOf(k.tint) }));

  const share = Math.max(0, Math.min(1, Number(cfg.share) || 0));
  const firstDepth = Math.max(1, cfg.firstDepth | 0);

  /** The kinds a given depth is allowed to produce.
   *
   *  Each kind names its own first depth, so the vocabulary arrives a piece at
   *  a time instead of landing whole on a player who has just learned that a
   *  block is a number. A kind can push itself later than the global floor and
   *  never earlier. */
  function poolAt(d) {
    return kinds.filter(k => d >= Math.max(firstDepth, k.from | 0 || firstDepth));
  }

  return {
    share,
    list: kinds.slice(),
    poolAt,

    /** The kind for a block, or null for an ordinary one. */
    rollFor(depth, col) {
      if (!kinds.length || share <= 0) return null;
      const d = Math.max(1, Math.floor(depth) || 1);
      if (d < firstDepth) return null;
      if (roll(s, d, col | 0) >= share) return null;

      const pool = poolAt(d);
      if (!pool.length) return null;

      // A second, independent draw picks WHICH kind, so changing one kind's
      // weight does not shuffle which blocks are special at all. The pool is a
      // function of the depth alone, so the same seed still gives the same
      // field down to which of its blocks will surprise you.
      let pick = roll(s ^ 0x5bf03635, d, col | 0)
        * pool.reduce((t, k) => t + k.weight, 0);
      for (const k of pool) {
        pick -= k.weight;
        if (pick < 0) return k.id;
      }
      return pool[pool.length - 1].id;
    },

    /** How much health a kind's block carries, as a multiple of what the tier
     *  asked for. Most kinds are payouts and leave it alone; the ones that are
     *  obstacles rather than rewards say so here. */
    healthScale(id) {
      const k = this.byId(id);
      const m = k && Number(k.hp);
      return Number.isFinite(m) && m > 0 ? m : 1;
    },

    /** A kind by id, or null. */
    byId(id) {
      return id ? (kinds.find(k => k.id === id) || null) : null;
    },

    /** What a kind does when the block carrying it breaks. */
    effectOf(id) {
      const k = this.byId(id);
      return k ? k.effect : null;
    },
  };
}

export default createBlockKinds;
