/**
 * progression.js
 *
 * The progression spine: the research line, the eras, the object types as data,
 * the laws and their dials, and the three-slot resource ledger.
 *
 * This module is pure logic. It never touches the DOM, never renders, never
 * simulates a body, and never reads a clock of its own. The simulation feeds it
 * a FieldStats snapshot on every tick; it updates the ledger and answers
 * questions.
 *
 * Design invariants this file is written to preserve, in priority order:
 *
 *   1. At most six research nodes are ever open at once. Crossing an era
 *      deletes the previous board and leaves one Law behind in its place.
 *   2. Exactly three resources exist for the whole game and their names never
 *      change: MASS (monotone, never spent), FLUX (spent constantly, earned
 *      from field activity only), ORDER (scarce, minted by thresholds and by
 *      deliberate destruction, never by time).
 *   3. Nothing is gated on elapsed time. There are no timers, no cooldowns and
 *      no offline accrual anywhere in this file.
 *   4. A type is one clause of the form "on <event>, <verb>". Ten verbs exist
 *      and no eleventh will be added.
 *
 * HEAD_BUDGET and headCount() make invariant 1 testable.
 */

/* ==========================================================================
 * SECTION 1 - Big
 *
 * A run crosses 1e53 in the base game and compounds past it with dimensional
 * depth. Doubles lose integer precision at 1e15 and die at 1e308, so the mass
 * ledger would be visibly wrong before the end of the second era.
 *
 * Big is a normalised mantissa-exponent pair: mantissa in [1, 10) or exactly
 * zero, exponent an integer. It carries about 15 significant digits and reaches
 * 10^(1e308), which is past any number this game can produce.
 *
 * Exported so the simulation uses this type rather than a second one.
 * ========================================================================== */

/** Multiply a double by a power of ten without overflowing on the way. */
function shiftBy(a, k) {
  while (k > 100) { a *= 1e100; k -= 100; if (!Number.isFinite(a)) return a; }
  while (k < -100) { a *= 1e-100; k += 100; if (a === 0) return 0; }
  return a * Math.pow(10, k);
}

function normalize(m, e) {
  if (m === 0 || !Number.isFinite(m) || !Number.isFinite(e)) {
    return Number.isFinite(m) ? { m: 0, e: 0 } : { m: m > 0 ? Infinity : -Infinity, e: 0 };
  }
  const sign = m < 0 ? -1 : 1;
  let a = Math.abs(m);
  if (a >= 10 || a < 1) {
    const k = Math.floor(Math.log10(a));
    a = shiftBy(a, -k);
    e += k;
  }
  // Guard against log10 rounding at exact powers of ten.
  while (a >= 10) { a *= 0.1; e += 1; }
  while (a < 1) { a *= 10; e -= 1; }
  return { m: sign * a, e };
}

export class Big {
  constructor(m = 0, e = 0) {
    const n = normalize(m, e);
    this.m = n.m;
    this.e = n.e;
  }

  /**
   * Accepts a Big, a number, a string such as "1.6e29", a [mantissa, exponent]
   * pair, or any plain object carrying {m, e} or {mantissa, exponent}.
   *
   * The last two forms exist so a normalised decimal produced anywhere else in
   * the codebase drops straight in without a conversion step, and so a Big
   * drops straight back out: see the mantissa and exponent accessors below.
   */
  static from(v) {
    if (v instanceof Big) return new Big(v.m, v.e);
    if (typeof v === 'number') return new Big(v, 0);
    if (Array.isArray(v)) return new Big(v[0], v[1]);
    if (v && typeof v === 'object' && 'm' in v && 'e' in v) return new Big(v.m, v.e);
    if (v && typeof v === 'object' && 'mantissa' in v && 'exponent' in v) {
      return new Big(v.mantissa, v.exponent);
    }
    if (v == null) return Big.zero();
    const s = String(v).trim();
    const i = s.search(/[eE]/);
    if (i < 0) return new Big(Number(s), 0);
    return new Big(Number(s.slice(0, i) || '1'), Number(s.slice(i + 1)));
  }

  static zero() { return new Big(0, 0); }
  static one() { return new Big(1, 0); }
  static max(a, b) { return Big.from(a).cmp(b) >= 0 ? Big.from(a) : Big.from(b); }
  static min(a, b) { return Big.from(a).cmp(b) <= 0 ? Big.from(a) : Big.from(b); }

  /** Aliases so a Big satisfies a {mantissa, exponent} reader unchanged. */
  get mantissa() { return this.m; }
  get exponent() { return this.e; }

  isZero() { return this.m === 0; }
  neg() { return new Big(-this.m, this.e); }
  abs() { return new Big(Math.abs(this.m), this.e); }

  add(o) {
    o = Big.from(o);
    if (this.isZero()) return Big.from(o);
    if (o.isZero()) return Big.from(this);
    const hi = this.e >= o.e ? this : o;
    const lo = this.e >= o.e ? o : this;
    const d = hi.e - lo.e;
    if (d > 17) return Big.from(hi);
    return new Big(hi.m + shiftBy(lo.m, -d), hi.e);
  }

  sub(o) { return this.add(Big.from(o).neg()); }
  mul(o) { o = Big.from(o); return new Big(this.m * o.m, this.e + o.e); }

  div(o) {
    o = Big.from(o);
    if (o.isZero()) return new Big(this.m >= 0 ? Infinity : -Infinity, 0);
    return new Big(this.m / o.m, this.e - o.e);
  }

  /** Fractional exponents require a positive base. */
  pow(n) {
    if (this.isZero()) return Big.zero();
    if (this.m < 0 && !Number.isInteger(n)) return Big.zero();
    const sign = this.m < 0 && Math.abs(n % 2) === 1 ? -1 : 1;
    const L = (Math.log10(Math.abs(this.m)) + this.e) * n;
    const e = Math.floor(L);
    return new Big(sign * Math.pow(10, L - e), e);
  }

  /** Base-ten logarithm as a plain number. This is how the game measures scale. */
  log10() {
    if (this.m <= 0) return -Infinity;
    return this.e + Math.log10(this.m);
  }

  cmp(o) {
    o = Big.from(o);
    if (this.m === 0 && o.m === 0) return 0;
    const sa = Math.sign(this.m);
    const sb = Math.sign(o.m);
    if (sa !== sb) return sa < sb ? -1 : 1;
    if (this.e !== o.e) return (this.e < o.e) === (sa > 0) ? -1 : 1;
    if (this.m === o.m) return 0;
    return this.m < o.m ? -1 : 1;
  }

  gte(o) { return this.cmp(o) >= 0; }
  gt(o) { return this.cmp(o) > 0; }
  lte(o) { return this.cmp(o) <= 0; }
  lt(o) { return this.cmp(o) < 0; }
  eq(o) { return this.cmp(o) === 0; }

  /** Lossy below 1e-308 and above 1e308. Only for local, small quantities. */
  toNumber() { return shiftBy(this.m, this.e); }

  toJSON() { return [this.m, this.e]; }
  toString() { return format(this); }
}

/**
 * Render a Big for display. Scientific notation past six digits, which happens
 * partway through the first era and stays for the rest of the game.
 */
export function format(v, digits = 3) {
  const b = Big.from(v);
  if (b.isZero()) return '0';
  if (!Number.isFinite(b.m)) return b.m > 0 ? 'inf' : '-inf';
  if (b.e >= -3 && b.e < 6) {
    const n = b.toNumber();
    const abs = Math.abs(n);
    if (abs >= 1000) return n.toFixed(0);
    if (abs >= 1) return trimZeros(n.toFixed(2));
    return trimZeros(n.toFixed(4));
  }
  return trimZeros(b.m.toFixed(digits)) + 'e' + b.e;
}

function trimZeros(s) {
  return s.indexOf('.') < 0 ? s : s.replace(/\.?0+$/, '');
}

/* ==========================================================================
 * SECTION 2 - Content
 *
 * The verbs, the types, the laws, the eras, the research line and the mass
 * ladder. Every balance coefficient in the game lives in TUNING at the bottom
 * of this section and nowhere else.
 * ========================================================================== */

/**
 * The complete physics vocabulary. Ten verbs, closed set. A proposed type that
 * cannot be written as "on <event>, <verb>" using one of these is an upgrade,
 * not a type, and belongs on the research line instead.
 */
export const VERBS = Object.freeze([
  'merge',    // two things become one
  'shatter',  // one thing becomes many
  'sink',     // migrate toward a centre of mass without merging
  'eject',    // leave the parent body
  'emit',     // convert held mass into flux
  'push',     // apply outward force to neighbours
  'orbit',    // bend a passing path without capture
  'convert',  // leave the field entirely and mint order
  'bind',     // hold a group against dispersal
  'inherit'   // merge rule sets rather than mass
]);

/**
 * Object types. Each is exactly one behavioural clause the simulation reads.
 * `foldsAt` names the era after which the type stops being simulated
 * individually and is handled by the law that replaced its era.
 */
export const TYPES = Object.freeze({
  dust: {
    id: 'dust', name: 'Dust', era: 'dust', unlockedBy: null, foldsAt: 'body',
    on: 'contact', then: 'merge',
    rule: 'On contact, merge.',
    params: { mergeSpeed: 1.0, density: 1.0 }
  },
  ice: {
    id: 'ice', name: 'Ice', era: 'dust', unlockedBy: 'volatiles', foldsAt: 'star',
    on: 'contact', then: 'shatter',
    rule: 'On contact above merge speed, shatter into grains.',
    params: { mergeSpeed: 0.4, shards: 6, density: 0.6, sublimatesNearLight: true }
  },
  iron: {
    id: 'iron', name: 'Iron', era: 'dust', unlockedBy: 'differentiation', foldsAt: 'star',
    on: 'contact', then: 'sink',
    rule: 'On contact, never merge: sink toward the centre.',
    params: { density: 3.2, survivesCollapse: true }
  },
  rock: {
    id: 'rock', name: 'Rock', era: 'body', unlockedBy: 'pressure', foldsAt: 'star',
    on: 'contact', then: 'merge',
    rule: 'On contact, merge, carrying composition through.',
    params: { mergeSpeed: 0.8, density: 1.8, carriesComposition: true }
  },
  hydrogen: {
    id: 'hydrogen', name: 'Hydrogen', era: 'body', unlockedBy: 'capture', foldsAt: 'collapse',
    on: 'contact', then: 'eject',
    rule: 'On contact with a body below capture mass, eject.',
    params: { captureMass: '1e22', density: 0.15, fuel: true }
  },
  star: {
    id: 'star', name: 'Star', era: 'star', unlockedBy: 'fusion', foldsAt: 'collapse',
    on: 'tick', then: 'emit',
    rule: 'On tick, emit: convert held mass into light.',
    params: { minMass: '1.6e29', burnExponent: 3.5 }
  },
  giant: {
    id: 'giant', name: 'Giant', era: 'star', unlockedBy: 'radiation', foldsAt: 'collapse',
    on: 'tick', then: 'push',
    rule: 'On tick, push: clear neighbouring matter with radiation.',
    params: { pushRadius: 6.0, clearsIce: true }
  },
  remnant: {
    id: 'remnant', name: 'Remnant', era: 'star', unlockedBy: 'nucleosynthesis', foldsAt: 'galaxy',
    on: 'pass', then: 'orbit',
    rule: 'On close pass, orbit: bend paths without emitting.',
    params: { enriches: true, dark: true }
  },
  horizon: {
    id: 'horizon', name: 'Horizon', era: 'collapse', unlockedBy: 'horizon', foldsAt: 'universe',
    on: 'cross', then: 'convert',
    rule: 'On cross, convert: mass leaves the field and mints Order.',
    params: { minMass: '6e30' }
  },
  disk: {
    id: 'disk', name: 'Disk', era: 'collapse', unlockedBy: 'disruption', foldsAt: 'galaxy',
    on: 'tick', then: 'emit',
    rule: 'On tick, emit, brighter than anything else in the game.',
    params: { brightness: 40.0 }
  },
  jet: {
    id: 'jet', name: 'Jet', era: 'collapse', unlockedBy: 'jets', foldsAt: 'galaxy',
    on: 'feed', then: 'eject',
    rule: 'On feed, eject: seed new dust far along an axis.',
    params: { reach: 30.0, seedsField: true }
  },
  halo: {
    id: 'halo', name: 'Halo', era: 'galaxy', unlockedBy: 'halo', foldsAt: 'dimension',
    on: 'tick', then: 'bind',
    rule: 'On tick, bind: hold structure together, invisibly.',
    params: { invisible: true, massRatio: 5.0 }
  },
  cluster: {
    id: 'cluster', name: 'Cluster', era: 'galaxy', unlockedBy: 'cluster', foldsAt: 'dimension',
    on: 'tick', then: 'bind',
    rule: 'On tick, bind at region scale.',
    params: { invisible: false }
  },
  universe: {
    id: 'universe', name: 'Universe', era: 'dimension', unlockedBy: 'adjacency', foldsAt: null,
    on: 'contact', then: 'inherit',
    rule: 'On contact, inherit: merge constants rather than mass.',
    params: {}
  }
});

/**
 * Laws. One per era, granted by that era's capstone, and the only thing that
 * survives the board being deleted. Each is one sentence and one dial, and each
 * makes the era it replaced run by itself.
 */
export const LAWS = Object.freeze({
  accretion: {
    id: 'accretion', name: 'ACCRETION', era: 'dust',
    line: 'Loose matter falls inward at a rate you set.',
    dials: [{ key: 'infall', label: 'infall rate', kind: 'ratio', min: 0, max: 1, def: 0.35 }]
  },
  composition: {
    id: 'composition', name: 'COMPOSITION', era: 'body',
    line: 'Infall arrives in a mix you set.',
    dials: [{
      key: 'mix', label: 'mix', kind: 'mix',
      keys: ['dust', 'ice', 'iron', 'hydrogen'],
      def: { dust: 0.4, ice: 0.3, iron: 0.2, hydrogen: 0.1 }
    }]
  },
  stellar_cycle: {
    id: 'stellar_cycle', name: 'STELLAR CYCLE', era: 'star',
    line: 'Stars form from enriched gas and die enriching it further.',
    dials: [{ key: 'imf', label: 'many small ... few huge', kind: 'ratio', min: 0, max: 1, def: 0.5 }]
  },
  horizon: {
    id: 'horizon', name: 'HORIZON', era: 'collapse',
    line: 'Matter crossing a horizon becomes Order at a fixed ratio.',
    dials: [{
      key: 'priority', label: 'feed priority', kind: 'enum',
      options: ['remnants', 'cold bodies', 'stars', 'everything'], def: 'remnants'
    }]
  },
  structure: {
    id: 'structure', name: 'STRUCTURE', era: 'galaxy',
    line: 'Regions inherit the topology you specify.',
    dials: [{
      key: 'topology', label: 'topology', kind: 'enum',
      options: ['spiral', 'elliptical', 'irregular'], def: 'spiral'
    }]
  },
  constants: {
    id: 'constants', name: 'CONSTANTS', era: 'universe',
    line: 'The constants are yours to set, and every law above reads them.',
    dials: [
      { key: 'g', label: 'gravitation', kind: 'ratio', min: 0.25, max: 4, def: 1 },
      { key: 'binding', label: 'nuclear binding', kind: 'ratio', min: 0.25, max: 4, def: 1 },
      { key: 'expansion', label: 'expansion', kind: 'ratio', min: 0.25, max: 4, def: 1 },
      { key: 'vacuum', label: 'vacuum energy', kind: 'ratio', min: 0, max: 4, def: 1 }
    ]
  },
  depth: {
    id: 'depth', name: 'DEPTH', era: 'dimension',
    line: 'Dimensional depth multiplies every law above it.',
    dials: [{
      key: 'disposition', label: 'disposition', kind: 'enum',
      options: ['garden', 'forge', 'weave'], def: 'garden'
    }]
  }
});

/**
 * Eras, in order. `target` and `gate` are the capstone's two requirements: a
 * Mass figure and an event the era's own mechanics produce, so no era can be
 * cleared by accumulation alone.
 *
 * `retires` and `introduces` are what visibly changes on the way out. They are
 * the seven qualitative jumps, stated as data so the renderer and the
 * simulation read the same list this document does.
 */
export const ERAS = Object.freeze([
  {
    id: 'field', name: 'FIELD', index: 0,
    start: '0', target: '1e-3', gate: 'merged', orderGrant: 0,
    scaleExponent: -6, paletteKey: 'noise', law: null,
    decision: null,
    introduces: ['the field', 'the click', 'gravity'],
    retires: [],
    jumpOut: 'Noise becomes matter. The board appears.'
  },
  {
    id: 'dust', name: 'DUST', index: 1,
    start: '1e-3', target: '1e15', gate: 'core_formed', orderGrant: 3,
    scaleExponent: 0, paletteKey: 'ash', law: 'accretion',
    decision: 'WHERE',
    introduces: ['the board', 'ice', 'iron', 'the contact channel'],
    retires: ['individual grains', 'dust as an object'],
    jumpOut: 'The camera pulls back. Individual grains stop being drawn, permanently.'
  },
  {
    id: 'body', name: 'BODY', index: 2,
    start: '1e15', target: '1.6e29', gate: 'ignited', orderGrant: 4,
    scaleExponent: 15, paletteKey: 'slate', law: 'composition',
    decision: 'WHAT OF',
    introduces: ['composition', 'hydrogen', 'the pressure channel'],
    retires: ['bodies you place by hand'],
    jumpOut: 'First light. First colour. First repulsive force in the game.'
  },
  {
    id: 'star', name: 'STAR', index: 3,
    start: '1.6e29', target: '1e33', gate: 'collapsed', orderGrant: 4,
    scaleExponent: 29, paletteKey: 'ember', law: 'stellar_cycle',
    decision: 'HOW FAST TO BURN',
    introduces: ['fusion', 'radiation pressure', 'enrichment', 'the fusion channel'],
    retires: ['ice', 'iron', 'rock as separate objects'],
    jumpOut: 'Things start dying without you. Destruction starts paying.'
  },
  {
    id: 'collapse', name: 'COLLAPSE', index: 4,
    start: '1e33', target: '1e39', gate: 'horizon_fed', orderGrant: 5,
    scaleExponent: 33, paletteKey: 'void', law: 'horizon',
    decision: 'WHAT TO KILL',
    introduces: ['horizons', 'Order from destruction', 'jets', 'the horizon channel'],
    retires: ['the click', 'hydrogen', 'stars as individual objects'],
    jumpOut: 'The click is retired. Direct control ends and you edit rules from here.'
  },
  {
    id: 'galaxy', name: 'GALAXY', index: 5,
    start: '1e39', target: '1e49', gate: 'region_bound', orderGrant: 6,
    scaleExponent: 39, paletteKey: 'deep', law: 'structure',
    decision: 'WHAT SHAPE',
    introduces: ['rotation', 'unseen mass', 'topology', 'the structure channel'],
    retires: ['remnants', 'disks and jets'],
    jumpOut: 'Space expands. Distance becomes a variable and the camera never stops moving.'
  },
  {
    id: 'universe', name: 'UNIVERSE', index: 6,
    start: '1e49', target: '1e53', gate: 'constant_set', orderGrant: 7,
    scaleExponent: 49, paletteKey: 'cold', law: 'constants',
    decision: 'WHICH LAWS',
    introduces: ['the constants', 'volume as income', 'the vacuum channel'],
    retires: ['horizons as objects'],
    jumpOut: 'Your entire run becomes one dot on a blank screen.'
  },
  {
    id: 'dimension', name: 'DIMENSION', index: 7,
    start: '1e53', target: '1e60', gate: 'universes_merged', orderGrant: 8,
    scaleExponent: 53, paletteKey: 'noise', law: 'depth',
    decision: 'WHAT TO KEEP',
    introduces: ['universes as objects', 'lineage', 'depth'],
    retires: ['everything below, folded into one dot'],
    jumpOut: 'Close the run, or carry three laws down and start again one level deeper.'
  }
]);

export const ERA_IDS = Object.freeze(ERAS.map(e => e.id));

/**
 * The research line. Six nodes per era, laid out left to right.
 *
 * Structural rules, enforced by assertTreeShape():
 *   - no node has more than one prerequisite, which is what keeps the board a
 *     line rather than a graph;
 *   - exactly one fork per era, two or three wide, re-merging immediately;
 *   - the sixth node is the capstone and it carries the era's law.
 *
 * Effects are declarative. The simulation and the economy read them; nothing in
 * this module executes anything on the field.
 */
export const NODES = Object.freeze([
  /* --- FIELD has no board. ------------------------------------------------ */

  /* --- DUST: where. ------------------------------------------------------- */
  { id: 'notice', era: 'dust', name: 'Notice', requires: null, cost: { flux: '10' },
    line: 'Naming a thing lets you count it.',
    effects: { flag: 'readout', enableChannel: 'contact' } },
  { id: 'cohesion', era: 'dust', name: 'Cohesion', requires: 'notice', cost: { flux: '60' },
    line: 'Grains that touch below a relative speed stick.',
    effects: { mult: { merge: 2.0 } } },
  { id: 'volatiles', era: 'dust', name: 'Volatiles', requires: 'cohesion', cost: { flux: '300' },
    line: 'Ice merges slowly and shatters fast.',
    effects: { unlockType: 'ice', mult: { flux: 1.4 } } },
  { id: 'differentiation', era: 'dust', name: 'Differentiation', requires: 'volatiles', cost: { flux: '1.5e3' },
    line: 'Heavy grains refuse to merge and fall to the centre.',
    effects: { unlockType: 'iron' } },
  { id: 'perturbation', era: 'dust', name: 'Perturbation', requires: 'differentiation',
    cost: { flux: '6e3', order: 2 }, fork: true,
    line: 'Decide what a click is, for the rest of the run.',
    options: [
      { id: 'sweep', name: 'Sweep', line: 'A click drags a line of grains.',
        effects: { flag: 'click_sweep', mult: { merge: 1.2 } } },
      { id: 'burst', name: 'Burst', line: 'A click sprays a shell outward.',
        effects: { flag: 'click_burst', mult: { flux: 1.5 } } },
      { id: 'seed', name: 'Seed', line: 'A click drops one dense grain that pulls others in.',
        effects: { flag: 'click_seed', mult: { mass: 1.3 } } }
    ] },
  { id: 'disk_capstone', era: 'dust', name: 'Accretion Disk', requires: 'perturbation',
    cost: { flux: '3e4' }, capstone: true,
    line: 'Loose matter begins falling inward without you.',
    effects: { grantLaw: 'accretion', advance: true } },

  /* --- BODY: what of. ----------------------------------------------------- */
  { id: 'pressure', era: 'body', name: 'Pressure', requires: null, cost: { flux: '2e5' },
    line: 'Mass compresses its own core.',
    effects: { unlockType: 'rock', enableChannel: 'pressure' } },
  { id: 'melting', era: 'body', name: 'Melting', requires: 'pressure', cost: { flux: '1e6' },
    line: 'Hot bodies deform on contact and merge instead of bouncing.',
    effects: { mult: { merge: 1.8 } } },
  { id: 'capture', era: 'body', name: 'Volatile Capture', requires: 'melting', cost: { flux: '5e6' },
    line: 'Only bodies above a capture mass hold hydrogen, and only hydrogen ignites.',
    effects: { unlockType: 'hydrogen' } },
  { id: 'focusing', era: 'body', name: 'Gravitational Focusing', requires: 'capture', cost: { flux: '2e7' },
    line: 'A heavy body sweeps a path far wider than itself.',
    effects: { mult: { flux: 1.6, mass: 1.4 } } },
  { id: 'regime', era: 'body', name: 'Regime', requires: 'focusing',
    cost: { flux: '8e7', order: 3 }, fork: true,
    line: 'Decide what your bodies are made of.',
    options: [
      { id: 'rocky', name: 'Rocky', line: 'Dense and small. Strong gravity, poor cross-section.',
        effects: { mult: { mass: 1.6 }, dialDefaults: { composition: { mix: { dust: 0.35, ice: 0.05, iron: 0.45, hydrogen: 0.15 } } } } },
      { id: 'icy', name: 'Icy', line: 'Enormous and fragile. Superb income, late ignition.',
        effects: { mult: { flux: 2.2 }, dialDefaults: { composition: { mix: { dust: 0.25, ice: 0.55, iron: 0.05, hydrogen: 0.15 } } } } },
      { id: 'gaseous', name: 'Gaseous', line: 'Weak until it ignites, and it ignites first.',
        effects: { mult: { fusion: 1.8 }, dialDefaults: { composition: { mix: { dust: 0.2, ice: 0.1, iron: 0.05, hydrogen: 0.65 } } } } }
    ] },
  { id: 'ignition', era: 'body', name: 'Ignition Threshold', requires: 'regime',
    cost: { flux: '4e8' }, capstone: true,
    line: 'Past a mass, a hydrogen-rich body lights.',
    effects: { grantLaw: 'composition', advance: true } },

  /* --- STAR: how fast to burn. -------------------------------------------- */
  { id: 'fusion', era: 'star', name: 'Fusion', requires: null, cost: { flux: '2e9' },
    line: 'A star converts held mass into light.',
    effects: { unlockType: 'star', enableChannel: 'fusion' } },
  { id: 'radiation', era: 'star', name: 'Radiation Pressure', requires: 'fusion', cost: { flux: '1e10' },
    line: 'Light pushes matter away. The field is no longer purely attractive.',
    effects: { unlockType: 'giant', flag: 'repulsion' } },
  { id: 'wind', era: 'star', name: 'Stellar Wind', requires: 'radiation', cost: { flux: '5e10' },
    line: 'Stars shed mass, and what they shed comes back enriched.',
    effects: { mult: { flux: 1.7 }, flag: 'recycling' } },
  { id: 'nucleosynthesis', era: 'star', name: 'Nucleosynthesis', requires: 'wind', cost: { flux: '2e11' },
    line: 'Dead stars enrich the field, and every body formed after them is better.',
    effects: { unlockType: 'remnant', flag: 'enrichment' } },
  { id: 'population', era: 'star', name: 'Population', requires: 'nucleosynthesis',
    cost: { flux: '8e11', order: 3 }, fork: true,
    line: 'Decide how your stars burn.',
    options: [
      { id: 'bright', name: 'Bright', line: 'Few huge stars. Colossal income, short lives, violent enrichment.',
        effects: { mult: { fusion: 3.0 }, dialDefaults: { stellar_cycle: { imf: 0.9 } } } },
      { id: 'long', name: 'Long', line: 'Many small stars. Steady, near-immortal, and they never enrich anything.',
        effects: { mult: { flux: 1.5, mass: 1.8 }, dialDefaults: { stellar_cycle: { imf: 0.1 } } } },
      { id: 'binary', name: 'Binary', line: 'Paired stars. Orbital income, chaotic ejections.',
        effects: { mult: { fusion: 1.8, order: 1.4 }, dialDefaults: { stellar_cycle: { imf: 0.5 } } } }
    ] },
  { id: 'core_collapse', era: 'star', name: 'Core Collapse', requires: 'population',
    cost: { flux: '4e12' }, capstone: true,
    line: 'Above eight solar masses, the end of a star is a horizon.',
    effects: { grantLaw: 'stellar_cycle', advance: true } },

  /* --- COLLAPSE: what to kill. -------------------------------------------- */
  { id: 'horizon', era: 'collapse', name: 'Event Horizon', requires: null, cost: { flux: '2e13' },
    line: 'What crosses does not come back, and what does not come back mints Order.',
    effects: { unlockType: 'horizon', enableChannel: 'horizon', flag: 'order_minting' } },
  { id: 'disruption', era: 'collapse', name: 'Tidal Disruption', requires: 'horizon', cost: { flux: '1e14' },
    line: 'A body passing close is torn into the brightest thing in the game.',
    effects: { unlockType: 'disk', mult: { flux: 2.5 } } },
  { id: 'evaporation', era: 'collapse', name: 'Evaporation', requires: 'disruption', cost: { flux: '5e14' },
    line: 'A horizon shrinks by a fraction of every Order it mints.',
    effects: { flag: 'upkeep', mult: { order: 1.8 } } },
  { id: 'jets', era: 'collapse', name: 'Relativistic Jets', requires: 'evaporation', cost: { flux: '2e15' },
    line: 'A fed horizon throws matter far out along an axis, and the field begins seeding itself.',
    effects: { unlockType: 'jet', flag: 'self_seeding', mult: { mass: 1.6 } } },
  { id: 'feeding', era: 'collapse', name: 'Feeding', requires: 'jets',
    cost: { flux: '8e15', order: 4 }, fork: true,
    line: 'Decide how you feed it.',
    options: [
      { id: 'steady', name: 'Steady', line: 'Constant slow infall. Low yield per event, nothing gets wrecked.',
        effects: { mult: { order: 1.3, flux: 1.4 }, dialDefaults: { horizon: { priority: 'cold bodies' } } } },
      { id: 'violent', name: 'Violent', line: 'Rare enormous meals that wreck the neighbourhood.',
        effects: { mult: { order: 2.2 }, dialDefaults: { horizon: { priority: 'stars' } } } },
      { id: 'merge', name: 'Merger', line: 'Horizons hunt each other. Vast Order, almost nothing left after.',
        effects: { mult: { order: 3.0, mass: 0.7 }, dialDefaults: { horizon: { priority: 'everything' } } } }
    ] },
  { id: 'supermassive', era: 'collapse', name: 'Supermassive', requires: 'feeding',
    cost: { flux: '4e16' }, capstone: true,
    line: 'A horizon large enough anchors everything around it.',
    effects: { grantLaw: 'horizon', advance: true, flag: 'click_retired' } },

  /* --- GALAXY: what shape. ------------------------------------------------ */
  { id: 'rotation', era: 'galaxy', name: 'Rotation', requires: null, cost: { flux: '2e17' },
    line: 'Angular momentum resists collapse, and structures start persisting without you.',
    effects: { enableChannel: 'structure', flag: 'orbits' } },
  { id: 'halo', era: 'galaxy', name: 'Dark Halo', requires: 'rotation', cost: { flux: '1e18' },
    line: 'Mass that is in every calculation and never on the screen.',
    effects: { unlockType: 'halo', mult: { mass: 2.4 } } },
  { id: 'density_waves', era: 'galaxy', name: 'Density Waves', requires: 'halo', cost: { flux: '5e18' },
    line: 'A moving compression front lights new stars along its length.',
    effects: { mult: { flux: 2.0, fusion: 1.5 } } },
  { id: 'feedback', era: 'galaxy', name: 'Feedback', requires: 'density_waves', cost: { flux: '2e19' },
    line: 'The central horizon shuts off formation in its own region.',
    effects: { flag: 'self_regulation', mult: { order: 1.5 } } },
  { id: 'topology', era: 'galaxy', name: 'Topology', requires: 'feedback',
    cost: { flux: '8e19', order: 4 }, fork: true,
    line: 'Decide the shape a region inherits.',
    options: [
      { id: 'spiral', name: 'Spiral', line: 'High formation, high income, fragile to mergers.',
        effects: { mult: { flux: 2.4 }, dialDefaults: { structure: { topology: 'spiral' } } } },
      { id: 'elliptical', name: 'Elliptical', line: 'Dead and dense. Enormous merger Order, almost no income.',
        effects: { mult: { order: 2.6, mass: 1.5, flux: 0.6 }, dialDefaults: { structure: { topology: 'elliptical' } } } },
      { id: 'irregular', name: 'Irregular', line: 'Chaotic and spiky, with the best per-event yields.',
        effects: { mult: { flux: 1.5, order: 1.5 }, dialDefaults: { structure: { topology: 'irregular' } } } }
    ] },
  { id: 'cluster', era: 'galaxy', name: 'Cluster', requires: 'topology',
    cost: { flux: '4e20' }, capstone: true,
    line: 'Regions bind into groups, and the field acquires an edge.',
    effects: { unlockType: 'cluster', grantLaw: 'structure', advance: true, flag: 'expansion' } },

  /* --- UNIVERSE: which laws. ---------------------------------------------- */
  { id: 'expansion', era: 'universe', name: 'Expansion', requires: null, cost: { flux: '2e21' },
    line: 'The field grows, and distance becomes something you set.',
    effects: { enableChannel: 'vacuum', dialUnlock: { constants: 'expansion' } } },
  { id: 'gravitation', era: 'universe', name: 'Gravitational Constant', requires: 'expansion', cost: { flux: '1e22' },
    line: 'How hard everything pulls, as a number you own.',
    effects: { dialUnlock: { constants: 'g' } } },
  { id: 'binding', era: 'universe', name: 'Nuclear Binding', requires: 'gravitation', cost: { flux: '5e22' },
    line: 'How much of a mass fusion is allowed to convert.',
    effects: { dialUnlock: { constants: 'binding' } } },
  { id: 'vacuum', era: 'universe', name: 'Vacuum Energy', requires: 'binding', cost: { flux: '2e23' },
    line: 'A floor of income proportional to volume. Expansion becomes an engine.',
    effects: { dialUnlock: { constants: 'vacuum' }, mult: { flux: 2.0 } } },
  { id: 'inflation', era: 'universe', name: 'Inflation', requires: 'vacuum',
    cost: { flux: '8e23', order: 5 }, fork: true,
    line: 'Decide what kind of universe this was going to be.',
    options: [
      { id: 'flat', name: 'Flat', line: 'Balanced. Everything works and nothing is extreme.',
        effects: { mult: { flux: 1.6, mass: 1.6, order: 1.6 } } },
      { id: 'dense', name: 'Dense', line: 'Everything collapses. Vast Order, no lasting structure.',
        effects: { mult: { order: 3.5, mass: 2.0, flux: 0.7 }, dialDefaults: { constants: { g: 2.5 } } } },
      { id: 'sparse', name: 'Sparse', line: 'Cold, vast and slow. Colossal volume, almost no mergers.',
        effects: { mult: { flux: 3.5, order: 0.6 }, dialDefaults: { constants: { g: 0.4, expansion: 2.5 } } } }
    ] },
  { id: 'closure', era: 'universe', name: 'Closure', requires: 'inflation',
    cost: { flux: '4e24' }, capstone: true,
    line: 'The universe becomes a countable object.',
    effects: { grantLaw: 'constants', advance: true, flag: 'universe_is_a_dot' } },

  /* --- DIMENSION: what to keep. ------------------------------------------- */
  { id: 'adjacency', era: 'dimension', name: 'Adjacency', requires: null, cost: { flux: '2e25' },
    line: 'Two things near each other fall together.',
    effects: { unlockType: 'universe', flag: 'dimension_gravity' } },
  { id: 'bleed', era: 'dimension', name: 'Bleed', requires: 'adjacency', cost: { flux: '1e26' },
    line: 'Adjacent universes exchange constants, whether or not you wanted them to.',
    effects: { flag: 'constant_bleed', mult: { flux: 1.8 } } },
  { id: 'lineage', era: 'dimension', name: 'Lineage', requires: 'bleed', cost: { flux: '5e26' },
    line: 'A merged universe keeps the better of each constant. Merging becomes curation.',
    effects: { flag: 'curated_merge', mult: { mass: 2.0 } } },
  { id: 'depth', era: 'dimension', name: 'Depth', requires: 'lineage', cost: { flux: '2e27' },
    line: 'Dimensions nest, and depth multiplies everything above it.',
    effects: { flag: 'depth_scaling' } },
  { id: 'disposition', era: 'dimension', name: 'Disposition', requires: 'depth',
    cost: { flux: '8e27', order: 6 }, fork: true,
    line: 'Decide what you are curating toward.',
    options: [
      { id: 'garden', name: 'Garden', line: 'Many small universes. Slow, stable, compounding.',
        effects: { mult: { mass: 2.5 }, dialDefaults: { depth: { disposition: 'garden' } } } },
      { id: 'forge', name: 'Forge', line: 'Few enormous universes and violent merges.',
        effects: { mult: { order: 3.0, flux: 1.5 }, dialDefaults: { depth: { disposition: 'forge' } } } },
      { id: 'weave', name: 'Weave', line: 'Every universe stays linked. Every law applies everywhere, weakened.',
        effects: { mult: { flux: 2.2, mass: 1.4, order: 1.4 }, dialDefaults: { depth: { disposition: 'weave' } } } }
    ] },
  { id: 'recursion', era: 'dimension', name: 'Recursion', requires: 'disposition',
    cost: { flux: '4e28' }, capstone: true, terminal: true,
    line: 'Close the run, or carry three laws down and begin again one level deeper.',
    effects: { grantLaw: 'depth', advance: false, flag: 'ending_available' } }
]);

const NODE_BY_ID = Object.freeze(
  NODES.reduce((acc, n) => { acc[n.id] = n; return acc; }, Object.create(null))
);

/**
 * The mass ladder. Read-only flavour that grants nothing and exists only
 * because comparing to a real object is the cheapest way to make forty orders
 * of magnitude legible without a single asset.
 */
export const MILESTONES = Object.freeze([
  { kg: '1e-6', label: 'a grain of dust' },
  { kg: '1e-3', label: 'a snowflake' },
  { kg: '1e0', label: 'a bag of sugar' },
  { kg: '1e2', label: 'a person' },
  { kg: '1.5e3', label: 'a small car' },
  { kg: '1.5e5', label: 'a blue whale' },
  { kg: '1e6', label: 'a locomotive' },
  { kg: '1e8', label: 'a cruise ship' },
  { kg: '6e9', label: 'the Great Pyramid' },
  { kg: '1e12', label: 'a small mountain' },
  { kg: '8.1e14', label: 'Mount Everest' },
  { kg: '1e17', label: 'a comet swarm' },
  { kg: '1e19', label: 'a large asteroid' },
  { kg: '9.4e20', label: 'Ceres' },
  { kg: '1.3e22', label: 'Pluto' },
  { kg: '7.3e22', label: 'the Moon' },
  { kg: '6.4e23', label: 'Mars' },
  { kg: '6.0e24', label: 'Earth' },
  { kg: '8.7e25', label: 'Uranus' },
  { kg: '1.9e27', label: 'Jupiter' },
  { kg: '1.6e29', label: 'the ignition limit' },
  { kg: '2.0e30', label: 'the Sun' },
  { kg: '6.0e30', label: 'the collapse limit' },
  { kg: '4.0e31', label: 'a blue supergiant' },
  { kg: '2.0e33', label: 'a thousand suns' },
  { kg: '2.0e35', label: 'a globular cluster' },
  { kg: '8.6e36', label: 'the hole at the centre of this galaxy' },
  { kg: '2.0e39', label: 'a million suns' },
  { kg: '1.2e42', label: 'the Milky Way' },
  { kg: '2.0e45', label: 'the Local Group' },
  { kg: '1.0e49', label: 'a supercluster' },
  { kg: '1.5e53', label: 'the observable universe' },
  { kg: '1e56', label: 'a thousand universes' },
  { kg: '1e60', label: 'a dimension' },
  { kg: '1e70', label: 'nothing left to compare it to' }
]);

/**
 * Every balance coefficient in the game. Nothing else in the codebase should
 * contain a number that affects pacing.
 *
 * Channel coefficients are provisional and expected to move during tuning. The
 * shape is the design; the magnitudes are not.
 */
export const TUNING = Object.freeze({
  // Flux channel coefficients, applied to the simulation's reported rates.
  channel: {
    contact: '4e0',      // per collision per second
    pressure: '2e2',     // against the cube root of the largest body
    fusion: '6e4',       // per luminous object per second
    horizon: '5e6',      // against the square root of infall in kg per second
    structure: '2e9',    // per bound object per second
    vacuum: '1e11'       // per unit of comoving volume per second
  },
  // Order is minted one per full decade of mass deliberately converted.
  orderPerDecade: 1,
  orderMintFloor: 24,    // log10 kg below which conversion mints nothing
  // The design promise that nothing is ever a wait.
  maxSecondsToAfford: 90,
  // Dimensional depth multiplier applied to every channel.
  depthExponent: 0.75,
  // How many laws survive into the next dimension.
  carryLimit: 3,
  // How many things the player may be asked to hold at once.
  headBudget: 21,
  // How many distinct object types may be live in any one era.
  typeBudget: 4
});

export const HEAD_BUDGET = TUNING.headBudget;
export const TYPE_BUDGET = TUNING.typeBudget;

/* ==========================================================================
 * SECTION 3 - State
 * ========================================================================== */

/**
 * @typedef {Object} FieldStats
 * The simulation's report for one tick. Rates are per second; masses are Big
 * or anything Big.from accepts. Every field is optional and defaults to nothing
 * happening, so the simulation can grow into this contract one era at a time.
 *
 * @property {number} [contactRate]    collisions per second in the field
 * @property {number} [objects]        live objects being simulated
 * @property {number} [boundObjects]   objects held in a bound structure
 * @property {number} [luminous]       objects currently emitting
 * @property {Big}    [boundMass]      mass currently in the field, kg
 * @property {Big}    [largestMass]    mass of the single largest object, kg
 * @property {Big}    [horizonInfall]  mass crossing horizons this second, kg/s
 * @property {Big}    [converted]      mass converted since the last tick, kg
 * @property {Big}    [volume]         comoving volume, arbitrary units
 * @property {number} [metallicity]    0..1 enrichment of the field
 * @property {string[]} [events]       gate events observed, for example
 *                                     'merged', 'ignited', 'collapsed'
 */

/** Gate events the eras look for. The simulation raises these by name. */
export const GATES = Object.freeze([
  'merged', 'core_formed', 'ignited', 'collapsed',
  'horizon_fed', 'region_bound', 'constant_set', 'universes_merged'
]);

/** Create a fresh run. `depth` and `carried` come from closing a dimension. */
export function createProgression({ depth = 1, carried = [] } = {}) {
  const state = {
    version: 1,
    eraIndex: 0,
    depth,
    carried: carried.slice(0, TUNING.carryLimit),
    purchased: Object.create(null),
    forks: Object.create(null),
    laws: Object.create(null),
    dials: Object.create(null),
    mass: Big.zero(),        // this run's honest ledger, kg
    lifetime: Big.zero(),    // every run summed, kg, the number on the screen
    flux: Big.zero(),
    order: 0,
    orderSpent: 0,
    orderMinted: 0,
    converted: Big.zero(),
    milestones: Object.create(null),
    gates: Object.create(null),
    ended: false,
    finalMass: null,
    elapsed: 0
  };
  for (const id of state.carried) grantLaw(state, id);
  return state;
}

function grantLaw(state, lawId) {
  const law = LAWS[lawId];
  if (!law || state.laws[lawId]) return;
  state.laws[lawId] = true;
  const dials = Object.create(null);
  for (const d of law.dials) {
    dials[d.key] = d.kind === 'mix' ? Object.assign(Object.create(null), d.def) : d.def;
  }
  state.dials[lawId] = dials;
}

/* ==========================================================================
 * SECTION 4 - Derived coefficients
 * ========================================================================== */

/**
 * Fold every purchased node's multipliers into one set. Cheap enough to run per
 * tick against forty-two nodes, and derived rather than stored so a save file
 * can never drift from the tree.
 *
 * Contract with the simulation: `flux`, `order` and `fusion` are consumed here.
 * `mass`, `merge` and `depth` are published for the simulation to apply to
 * infall, merge tolerance and field density respectively. Mass is made in the
 * field, not in this ledger, so that the kilogram figure stays truthful.
 */
export function coefficients(state) {
  const c = { flux: 1, mass: 1, order: 1, merge: 1, fusion: 1 };
  const channels = Object.create(null);
  const flags = Object.create(null);
  const apply = (fx) => {
    if (!fx) return;
    if (fx.mult) for (const k in fx.mult) c[k] = (c[k] || 1) * fx.mult[k];
    if (fx.enableChannel) channels[fx.enableChannel] = true;
    if (fx.flag) flags[fx.flag] = true;
  };
  for (const node of NODES) {
    if (!state.purchased[node.id]) continue;
    apply(node.effects);
    if (node.fork) {
      const chosen = state.forks[node.id];
      const opt = node.options.find(o => o.id === chosen);
      if (opt) apply(opt.effects);
    }
  }
  // Carried laws bring their channel online before the era that would grant it.
  for (const id of state.carried) {
    const law = LAWS[id];
    if (!law) continue;
    const era = ERAS.find(e => e.law === id);
    if (era) for (const n of NODES) {
      if (n.era === era.id && n.effects && n.effects.enableChannel) channels[n.effects.enableChannel] = true;
    }
  }
  c.depth = Math.pow(state.depth, TUNING.depthExponent);
  c.channels = channels;
  c.flags = flags;
  return c;
}

/** Constants dial values, defaulting to one when the law is not yet held. */
function constantsOf(state) {
  const d = state.dials.constants;
  return {
    g: d && d.g != null ? d.g : 1,
    binding: d && d.binding != null ? d.binding : 1,
    expansion: d && d.expansion != null ? d.expansion : 1,
    vacuum: d && d.vacuum != null ? d.vacuum : 1
  };
}

/* ==========================================================================
 * SECTION 5 - The economy
 *
 * Flux is generated by activity in the field and never by mass held. That is
 * the formula that structurally forbids the idle-and-wait failure: there is no
 * configuration in which the correct play is to stop touching it.
 * ========================================================================== */

/**
 * Per-second flux from each live channel, as Bigs. Returned as a breakdown so
 * the interface can show the player where their income is coming from without
 * this module knowing anything about the interface.
 */
export function fluxBreakdown(state, stats = {}) {
  const c = coefficients(state);
  const K = TUNING.channel;
  const con = constantsOf(state);
  const out = Object.create(null);
  const on = (name) => !!c.channels[name];

  if (on('contact')) {
    out.contact = Big.from(stats.contactRate || 0).mul(K.contact);
  }
  if (on('pressure')) {
    out.pressure = Big.from(stats.largestMass || 0).pow(1 / 3).mul(K.pressure).mul(con.g);
  }
  if (on('fusion')) {
    const enrich = 1 + (stats.metallicity || 0) * 3;
    out.fusion = Big.from(stats.luminous || 0)
      .mul(K.fusion).mul(c.fusion).mul(enrich).mul(con.binding);
  }
  if (on('horizon')) {
    out.horizon = Big.from(stats.horizonInfall || 0).pow(0.5).mul(K.horizon);
  }
  if (on('structure')) {
    out.structure = Big.from(stats.boundObjects || 0).mul(K.structure).mul(con.g);
  }
  if (on('vacuum')) {
    out.vacuum = Big.from(stats.volume || 0).mul(K.vacuum).mul(con.vacuum).mul(con.expansion);
  }

  const scale = c.flux * c.depth;
  for (const k in out) out[k] = out[k].mul(scale);
  return out;
}

/** Total flux per second. */
export function fluxRate(state, stats = {}) {
  const parts = fluxBreakdown(state, stats);
  let total = Big.zero();
  for (const k in parts) total = total.add(parts[k]);
  return total;
}

/**
 * Advance the ledger by dt seconds against what the field did.
 *
 * Mass is the greatest value ever reached of bound mass plus mass ever
 * converted, which makes it monotone by construction: feeding a horizon moves
 * mass out of the field but never out of the number on the screen.
 *
 * The figure is honest kilograms and nothing here inflates it, because the
 * milestone ladder compares it against real objects and would otherwise be
 * lying. Growth multipliers are published as coefficients(state).mass and
 * coefficients(state).depth for the simulation to apply to infall, which is
 * where mass is actually made.
 *
 * state.mass is this run's ledger and resets when a dimension closes.
 * state.lifetime is every run summed and never resets. The interface shows
 * lifetime as MASS and uses the run ledger for the era goal.
 *
 * Returns the list of events that fired. dt is supplied by the caller; this
 * module never reads a clock and there is no offline accrual anywhere.
 */
export function tick(state, dt, stats = {}) {
  const events = [];
  if (state.ended || !(dt > 0)) return events;
  state.elapsed += dt;

  state.flux = state.flux.add(fluxRate(state, stats).mul(dt));

  if (stats.converted) {
    state.converted = state.converted.add(stats.converted);
    events.push(...mintOrder(state));
  }

  const ledger = Big.from(stats.boundMass || 0).add(state.converted);
  if (ledger.gt(state.mass)) {
    state.lifetime = state.lifetime.add(ledger.sub(state.mass));
    state.mass = ledger;
  }

  if (Array.isArray(stats.events)) {
    for (const g of stats.events) {
      if (!state.gates[g]) { state.gates[g] = true; events.push({ type: 'gate', id: g }); }
    }
  }

  events.push(...checkMilestones(state));
  return events;
}

/**
 * Order is minted per full decade of mass deliberately converted, not per
 * kilogram, so feeding a grain to a horizon does nothing and feeding a star
 * matters. It is never minted by the passage of time.
 */
function mintOrder(state) {
  const events = [];
  const decade = Math.floor(state.converted.log10());
  if (!Number.isFinite(decade) || decade <= TUNING.orderMintFloor) return events;
  const c = coefficients(state);
  const total = Math.floor((decade - TUNING.orderMintFloor) * TUNING.orderPerDecade * c.order);
  const gained = total - state.orderMinted;
  if (gained <= 0) return events;
  state.orderMinted = total;
  state.order += gained;
  events.push({ type: 'order', amount: gained, reason: 'conversion', decade });
  return events;
}

function checkMilestones(state) {
  const events = [];
  for (let i = 0; i < MILESTONES.length; i++) {
    const m = MILESTONES[i];
    if (state.milestones[m.kg]) continue;
    if (!state.mass.gte(m.kg)) break;
    state.milestones[m.kg] = true;
    events.push({ type: 'milestone', index: i, kg: m.kg, label: m.label });
  }
  return events;
}

/* ==========================================================================
 * SECTION 6 - Queries
 * ========================================================================== */

export function era(state) { return ERAS[state.eraIndex]; }

/** Nodes belonging to the current era, in line order. */
export function eraNodes(state) {
  const id = era(state).id;
  return NODES.filter(n => n.era === id);
}

/**
 * The board: the current era's six nodes with a status each. The previous
 * era's nodes are not here, in any form. That deletion is the design.
 *
 *   done   already purchased
 *   open   purchasable right now
 *   short  prerequisite met, cannot afford yet
 *   locked capstone whose mass or gate requirement is unmet
 *   dim    prerequisite not met; drawn as a mark with no label
 */
export function board(state) {
  const row = eraNodes(state);
  return row.map(n => {
    if (state.purchased[n.id]) return { node: n, status: 'done', reason: null };
    const prereqOk = !n.requires || !!state.purchased[n.requires];
    if (!prereqOk) return { node: n, status: 'dim', reason: 'earlier work first' };
    if (n.capstone) {
      const gate = capstoneGate(state);
      if (!gate.ok) return { node: n, status: 'locked', reason: gate.reason, goal: gate };
    }
    const aff = canAfford(state, n.id);
    return { node: n, status: aff.ok ? 'open' : 'short', reason: aff.reason };
  });
}

/** Only what can be bought this instant. */
export function available(state) {
  return board(state).filter(s => s.status === 'open').map(s => s.node);
}

/** A capstone needs both a Mass figure and an event the era's mechanics make. */
export function capstoneGate(state) {
  const e = era(state);
  const target = Big.from(e.target);
  const massOk = state.mass.gte(target);
  const gateOk = !e.gate || !!state.gates[e.gate];
  return {
    ok: massOk && gateOk,
    massOk,
    gateOk,
    target,
    gate: e.gate,
    reason: massOk ? (gateOk ? null : 'requires: ' + gateLabel(e.gate)) : 'requires ' + format(target) + ' kg'
  };
}

function gateLabel(g) {
  return ({
    merged: 'two things merging',
    core_formed: 'a body with a core',
    ignited: 'something igniting',
    collapsed: 'a star ending',
    horizon_fed: 'feeding a horizon',
    region_bound: 'a bound region',
    constant_set: 'a constant moved off default',
    universes_merged: 'two universes merging'
  })[g] || g;
}

export function canAfford(state, nodeId) {
  const n = NODE_BY_ID[nodeId];
  if (!n) return { ok: false, reason: 'no such node' };
  if (state.purchased[nodeId]) return { ok: false, reason: 'already held' };
  if (n.requires && !state.purchased[n.requires]) return { ok: false, reason: 'earlier work first' };
  const flux = Big.from(n.cost.flux || 0);
  if (state.flux.lt(flux)) return { ok: false, reason: 'flux', short: flux.sub(state.flux) };
  const order = n.cost.order || 0;
  if (state.order < order) return { ok: false, reason: 'order', short: order - state.order };
  return { ok: true, reason: null };
}

/**
 * Seconds of the current field's output needed to afford a node. Exists so a
 * balance test can assert nothing in the tree exceeds TUNING.maxSecondsToAfford,
 * which is the promise that waiting is never the content, made checkable.
 */
export function timeToAfford(state, nodeId, stats = {}) {
  const n = NODE_BY_ID[nodeId];
  if (!n) return Infinity;
  const need = Big.from(n.cost.flux || 0).sub(state.flux);
  if (need.lte(0)) return 0;
  const rate = fluxRate(state, stats);
  if (rate.lte(0)) return Infinity;
  return need.div(rate).toNumber();
}

/**
 * Types the simulation should be running individually right now.
 *
 * A type is live when its era has been reached, its unlocking node is held, and
 * the era that folds it has not arrived. TYPE_BUDGET is the ceiling and
 * assertTreeShape() checks every era against it: past four distinct objects on
 * screen the player is bookkeeping rather than deciding.
 */
export function activeTypes(state) {
  const eraIdx = state.eraIndex;
  const out = [];
  for (const id in TYPES) {
    const t = TYPES[id];
    if (ERA_IDS.indexOf(t.era) > eraIdx) continue;
    if (t.unlockedBy && !state.purchased[t.unlockedBy]) continue;
    if (t.foldsAt && eraIdx >= ERA_IDS.indexOf(t.foldsAt)) continue;
    out.push(t);
  }
  return out;
}

/** Types now handled in aggregate by a law rather than simulated one by one. */
export function foldedTypes(state) {
  const eraIdx = state.eraIndex;
  const out = [];
  for (const id in TYPES) {
    const t = TYPES[id];
    if (!t.foldsAt) continue;
    if (ERA_IDS.indexOf(t.era) > eraIdx) continue;
    if (eraIdx >= ERA_IDS.indexOf(t.foldsAt) && (!t.unlockedBy || state.purchased[t.unlockedBy])) out.push(t);
  }
  return out;
}

/** Held laws with their current dial values. This is the whole archive. */
export function activeLaws(state) {
  const out = [];
  for (const id of Object.keys(LAWS)) {
    if (!state.laws[id]) continue;
    out.push({ law: LAWS[id], dials: state.dials[id] });
  }
  return out;
}

export function setDial(state, lawId, key, value) {
  if (!state.laws[lawId]) return { ok: false, reason: 'law not held' };
  const law = LAWS[lawId];
  const d = law.dials.find(x => x.key === key);
  if (!d) return { ok: false, reason: 'no such dial' };
  let v = value;
  if (d.kind === 'ratio') {
    v = Math.min(d.max, Math.max(d.min, Number(value)));
  } else if (d.kind === 'enum') {
    if (d.options.indexOf(value) < 0) return { ok: false, reason: 'not an option' };
  } else if (d.kind === 'mix') {
    v = normalizeMix(value, d.keys);
  }
  const before = state.dials[lawId][key];
  state.dials[lawId][key] = v;
  const events = [];
  if (lawId === 'constants' && !state.gates.constant_set && v !== d.def) {
    state.gates.constant_set = true;
    events.push({ type: 'gate', id: 'constant_set' });
  }
  return { ok: true, before, after: v, events };
}

function normalizeMix(mix, keys) {
  const out = Object.create(null);
  let sum = 0;
  for (const k of keys) { const v = Math.max(0, Number(mix && mix[k]) || 0); out[k] = v; sum += v; }
  if (sum <= 0) { for (const k of keys) out[k] = 1 / keys.length; return out; }
  for (const k of keys) out[k] /= sum;
  return out;
}

/**
 * The single thing the player is climbing toward right now, in log space,
 * because linear progress across forty orders of magnitude is meaningless.
 */
export function nextGoal(state) {
  const e = era(state);
  const gate = capstoneGate(state);
  const from = Big.from(e.start).log10();
  const to = Big.from(e.target).log10();
  const now = state.mass.log10();
  const span = to - from;
  const frac = span > 0 && Number.isFinite(now)
    ? Math.max(0, Math.min(1, (now - from) / span))
    : (gate.massOk ? 1 : 0);
  return {
    era: e.id,
    label: e.name,
    decision: e.decision,
    current: state.mass,
    target: Big.from(e.target),
    fraction: frac,
    gate: e.gate,
    gateMet: gate.gateOk,
    gateLabel: e.gate ? gateLabel(e.gate) : null,
    ready: gate.ok
  };
}

/** The most recent mass comparison reached, for the world-changing readout. */
export function currentComparison(state) {
  let best = null;
  for (const m of MILESTONES) {
    if (state.mass.gte(m.kg)) best = m; else break;
  }
  return best;
}

/**
 * Presentation metadata that belongs to progression rather than to rendering:
 * where the camera should be on the magnitude ruler, what this era retires and
 * introduces, and an advisory palette key. No drawing happens here.
 */
export function describe(state) {
  const e = era(state);
  return {
    era: e.id,
    name: e.name,
    index: e.index,
    decision: e.decision,
    scaleExponent: e.scaleExponent,
    paletteKey: e.paletteKey,
    introduces: e.introduces,
    retires: e.retires,
    jumpOut: e.jumpOut,
    clickRetired: !!coefficients(state).flags.click_retired,
    depth: state.depth
  };
}

/**
 * The design's central constraint, made auditable: how many distinct things the
 * player is being asked to hold at once. Must stay at or under HEAD_BUDGET.
 */
export function headCount(state) {
  const types = activeTypes(state).length;
  const open = board(state).filter(s => s.status !== 'dim' && s.status !== 'done').length;
  const laws = activeLaws(state).length;
  const parts = { resources: 3, types, nodes: open, laws, goal: 1 };
  parts.total = parts.resources + types + open + laws + 1;
  parts.withinBudget = parts.total <= HEAD_BUDGET;
  return parts;
}

/* ==========================================================================
 * SECTION 7 - Mutations
 * ========================================================================== */

/**
 * Buy a node. `optionId` is required for a fork and ignored otherwise.
 * Research resolves instantly; nothing in this game has a duration.
 */
export function purchase(state, nodeId, optionId = null) {
  const n = NODE_BY_ID[nodeId];
  if (!n) return { ok: false, reason: 'no such node', events: [] };
  if (n.era !== era(state).id) return { ok: false, reason: 'not on this board', events: [] };
  if (n.capstone) {
    const gate = capstoneGate(state);
    if (!gate.ok) return { ok: false, reason: gate.reason, events: [] };
  }
  if (n.fork) {
    const opt = n.options.find(o => o.id === optionId);
    if (!opt) return { ok: false, reason: 'choose one', options: n.options, events: [] };
  }
  const aff = canAfford(state, nodeId);
  if (!aff.ok) return { ok: false, reason: aff.reason, short: aff.short, events: [] };

  state.flux = state.flux.sub(Big.from(n.cost.flux || 0));
  const orderCost = n.cost.order || 0;
  state.order -= orderCost;
  state.orderSpent += orderCost;
  state.purchased[nodeId] = true;

  const events = [{ type: 'purchase', id: nodeId, name: n.name }];
  applyEffects(state, n.effects, events);
  if (n.fork) {
    state.forks[nodeId] = optionId;
    const opt = n.options.find(o => o.id === optionId);
    events.push({ type: 'fork', id: nodeId, option: optionId, name: opt.name });
    applyEffects(state, opt.effects, events);
  }
  if (n.effects && n.effects.advance) events.push(...advanceEra(state));
  return { ok: true, events };
}

function applyEffects(state, fx, events) {
  if (!fx) return;
  if (fx.grantLaw) {
    grantLaw(state, fx.grantLaw);
    events.push({ type: 'law', id: fx.grantLaw, name: LAWS[fx.grantLaw].name, line: LAWS[fx.grantLaw].line });
  }
  if (fx.dialDefaults) {
    for (const lawId in fx.dialDefaults) {
      if (!state.laws[lawId]) grantLaw(state, lawId);
      for (const key in fx.dialDefaults[lawId]) {
        const val = fx.dialDefaults[lawId][key];
        const d = LAWS[lawId].dials.find(x => x.key === key);
        state.dials[lawId][key] = d && d.kind === 'mix' ? normalizeMix(val, d.keys) : val;
      }
    }
  }
  if (fx.unlockType) events.push({ type: 'type', id: fx.unlockType, rule: TYPES[fx.unlockType].rule });
}

/**
 * Cross into the next era. The previous board is not archived, hidden or
 * greyed out; eraNodes() simply stops returning it and one Law remains in its
 * place. This is the whole mechanism by which the game never gets wide.
 */
function advanceEra(state) {
  if (state.eraIndex >= ERAS.length - 1) return [];
  const from = ERAS[state.eraIndex];
  state.eraIndex += 1;
  const to = ERAS[state.eraIndex];
  state.order += from.orderGrant;
  return [{
    type: 'era',
    from: from.id,
    to: to.id,
    jump: from.jumpOut,
    retires: from.retires,
    introduces: to.introduces,
    order: from.orderGrant,
    decision: to.decision
  }];
}

/**
 * The prologue's exit. Era 0 has no board and no capstone; it ends on the first
 * merge, which is the only automatic era transition in the game.
 */
export function checkPrologue(state) {
  if (state.eraIndex !== 0) return [];
  if (!state.gates.merged || state.mass.lt(ERAS[0].target)) return [];
  return advanceEra(state);
}

/* ==========================================================================
 * SECTION 8 - The ending, and the loop
 * ========================================================================== */

/** Whether the terminal node has been reached and the two buttons are live. */
export function endingAvailable(state) {
  return !!state.purchased.recursion && !state.ended;
}

/** Laws eligible to be carried down. */
export function carryCandidates(state) {
  return Object.keys(state.laws).map(id => LAWS[id]);
}

/**
 * Close the run. Final Mass is stated, the seven forks taken are listed, and
 * that is the ending.
 */
export function closeRun(state) {
  if (!endingAvailable(state)) return { ok: false, reason: 'not yet' };
  state.ended = true;
  state.finalMass = state.lifetime;
  return {
    ok: true,
    finalMass: state.lifetime,
    runMass: state.mass,
    depth: state.depth,
    seconds: state.elapsed,
    comparison: currentComparison(state),
    forks: NODES.filter(n => n.fork && state.forks[n.id]).map(n => ({
      era: n.era,
      question: n.name,
      chose: n.options.find(o => o.id === state.forks[n.id]).name
    })),
    laws: activeLaws(state).map(l => l.law.line)
  };
}

/**
 * Continue instead: carry up to three laws down and begin again one level
 * deeper. There is no prestige screen. The universe becomes a dot and the
 * player clicks it.
 */
export function descend(state, carryLawIds = []) {
  if (!endingAvailable(state)) return { ok: false, reason: 'not yet' };
  const held = carryLawIds.filter(id => state.laws[id]).slice(0, TUNING.carryLimit);
  const next = createProgression({ depth: state.depth + 1, carried: held });
  // The run ledger starts over so the ladder is climbed again, faster. The
  // lifetime figure is the one that never resets.
  next.lifetime = state.lifetime;
  return { ok: true, state: next, carried: held, depth: next.depth };
}

/* ==========================================================================
 * SECTION 9 - Save and load
 *
 * There is no time debt. A save records where the run stopped and resumes
 * exactly there, with nothing owed and nothing accrued while it was closed.
 * ========================================================================== */

export function serialize(state) {
  return JSON.stringify({
    v: state.version,
    e: state.eraIndex,
    d: state.depth,
    c: state.carried,
    p: Object.keys(state.purchased),
    f: state.forks,
    l: Object.keys(state.laws),
    di: state.dials,
    m: state.mass.toJSON(),
    lt: state.lifetime.toJSON(),
    fx: state.flux.toJSON(),
    o: state.order,
    os: state.orderSpent,
    om: state.orderMinted,
    cv: state.converted.toJSON(),
    ms: Object.keys(state.milestones),
    g: Object.keys(state.gates),
    en: state.ended,
    fm: state.finalMass ? state.finalMass.toJSON() : null,
    el: state.elapsed
  });
}

export function deserialize(text) {
  const raw = typeof text === 'string' ? JSON.parse(text) : text;
  const state = createProgression({ depth: raw.d || 1, carried: [] });
  state.eraIndex = raw.e || 0;
  state.carried = raw.c || [];
  for (const id of raw.p || []) state.purchased[id] = true;
  state.forks = Object.assign(Object.create(null), raw.f || {});
  for (const id of raw.l || []) grantLaw(state, id);
  for (const lawId in raw.di || {}) {
    if (!state.dials[lawId]) state.dials[lawId] = Object.create(null);
    Object.assign(state.dials[lawId], raw.di[lawId]);
  }
  state.mass = Big.from(raw.m || 0);
  state.lifetime = Big.from(raw.lt || raw.m || 0);
  state.flux = Big.from(raw.fx || 0);
  state.order = raw.o || 0;
  state.orderSpent = raw.os || 0;
  state.orderMinted = raw.om || 0;
  state.converted = Big.from(raw.cv || 0);
  for (const k of raw.ms || []) state.milestones[k] = true;
  for (const k of raw.g || []) state.gates[k] = true;
  state.ended = !!raw.en;
  state.finalMass = raw.fm ? Big.from(raw.fm) : null;
  state.elapsed = raw.el || 0;
  return state;
}

/* ==========================================================================
 * SECTION 10 - Self-check
 *
 * The design constraints as assertions. Call from a test; it throws on the
 * first violation and returns a summary otherwise.
 * ========================================================================== */

export function assertTreeShape() {
  const problems = [];
  for (const e of ERAS) {
    if (e.id === 'field') continue;
    const row = NODES.filter(n => n.era === e.id);
    if (row.length !== 6) problems.push(e.id + ' has ' + row.length + ' nodes, not 6');
    const forks = row.filter(n => n.fork);
    if (forks.length !== 1) problems.push(e.id + ' has ' + forks.length + ' forks, not 1');
    for (const f of forks) {
      if (f.options.length < 2 || f.options.length > 3) {
        problems.push(f.id + ' is ' + f.options.length + ' wide, not 2 or 3');
      }
    }
    const caps = row.filter(n => n.capstone);
    if (caps.length !== 1) problems.push(e.id + ' has ' + caps.length + ' capstones, not 1');
    if (caps.length === 1 && caps[0] !== row[row.length - 1]) problems.push(e.id + ' capstone is not last');
    if (e.law && caps.length === 1 && caps[0].effects.grantLaw !== e.law) {
      problems.push(e.id + ' capstone does not grant ' + e.law);
    }
    // A line, not a graph: exactly one entry point and single prerequisites.
    const roots = row.filter(n => !n.requires);
    if (roots.length !== 1) problems.push(e.id + ' has ' + roots.length + ' entry points, not 1');
  }
  for (const n of NODES) {
    if (Array.isArray(n.requires)) problems.push(n.id + ' has multiple prerequisites');
    if (n.requires && !NODE_BY_ID[n.requires]) problems.push(n.id + ' requires a missing node');
  }
  for (const id in TYPES) {
    const t = TYPES[id];
    if (VERBS.indexOf(t.then) < 0) problems.push(id + ' uses a verb outside the vocabulary');
    if (ERA_IDS.indexOf(t.era) < 0) problems.push(id + ' belongs to no era');
    if (t.foldsAt && ERA_IDS.indexOf(t.foldsAt) <= ERA_IDS.indexOf(t.era)) {
      problems.push(id + ' folds before or during its own era');
    }
  }
  // The live type count is the other half of the head budget: a fully unlocked
  // run must still show at most TYPE_BUDGET distinct objects in every era.
  const full = createProgression();
  for (const n of NODES) full.purchased[n.id] = true;
  for (let i = 0; i < ERAS.length; i++) {
    full.eraIndex = i;
    const live = activeTypes(full).length;
    if (live > TUNING.typeBudget) problems.push(ERAS[i].id + ' has ' + live + ' live types, over ' + TUNING.typeBudget);
  }
  if (problems.length) throw new Error('tree shape: ' + problems.join('; '));
  return {
    eras: ERAS.length,
    boards: ERAS.length - 1,
    nodes: NODES.length,
    forks: NODES.filter(n => n.fork).length,
    laws: Object.keys(LAWS).length,
    types: Object.keys(TYPES).length,
    verbs: VERBS.length,
    jumps: ERAS.length - 1,
    maxLiveTypes: Math.max(...ERAS.map((_, i) => { full.eraIndex = i; return activeTypes(full).length; }))
  };
}

export default {
  Big, format,
  VERBS, TYPES, LAWS, ERAS, ERA_IDS, NODES, MILESTONES, TUNING, GATES, HEAD_BUDGET, TYPE_BUDGET,
  createProgression, coefficients,
  fluxBreakdown, fluxRate, tick,
  era, eraNodes, board, available, capstoneGate, canAfford, timeToAfford,
  activeTypes, foldedTypes, activeLaws, setDial,
  nextGoal, currentComparison, describe, headCount,
  purchase, checkPrologue,
  endingAvailable, carryCandidates, closeRun, descend,
  serialize, deserialize, assertTreeShape
};
