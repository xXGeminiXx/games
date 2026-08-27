/**
 * rebirth.js - closure and authorship.
 *
 * The climb from a single dot to a universe is one unbroken run. Nothing in it
 * is ever reset, banked, or traded for a multiplier. This module owns what
 * happens at the top of that climb and everything after it.
 *
 * The model, in one paragraph: a completed universe can be closed. Closing it
 * destroys it. The first closure is the end of the game - it is performed once,
 * it cannot be undone, and nothing further is required of the player. If the
 * player acts again after that, the verb changes: they are no longer inside a
 * universe accumulating matter, they are outside one writing the laws it will
 * run under. Every universe after the first is an experiment whose result is
 * classified and catalogued. There is no prestige currency, because a currency
 * creates an optimal-reset calculation and that calculation is clerical work,
 * not a decision. The only things that survive a closure are what was learned
 * (permanently, in full) and the right to write one more law.
 *
 * PURE LOGIC. No DOM, no timers, no rendering, no randomness, no I/O. Every
 * exported function is deterministic and every state transition returns a new
 * state object rather than mutating the one passed in.
 *
 * LARGE NUMBERS. Quantities that cross forty orders of magnitude are never
 * materialised as doubles here. Anywhere a mass, a count or a duration is
 * accepted, it may be given as a plain number, as {mantissa, exponent}, or as
 * {log10}. All internal arithmetic on them happens in log space, so a total
 * mass of 1e800 compares correctly against a bound mass of 1e799.
 *
 * ---------------------------------------------------------------------------
 * PUBLIC API
 * ---------------------------------------------------------------------------
 *   createState()                          -> new RebirthState (phase 'FIRST_ARC')
 *   phase(state)                           -> 'FIRST_ARC' | 'CLOSED' | 'AUTHORING'
 *   canClose(run, state)                   -> boolean
 *   projectClosure(run, state)             -> preview, no mutation
 *   close(run, state)                      -> { state, closure }
 *   beginAuthoring(state)                  -> state ('CLOSED' -> 'AUTHORING')
 *
 *   AXIOMS / AXIOM_IDS / getAxiom(id)      -> the writable laws
 *   axiomCost(id, value)                   -> slots consumed by that setting
 *   slots(state)                           -> { total, used, free }
 *   writeAxiom(state, id, value)           -> { ok, state, reason }
 *   eraseAxiom(state, id)                  -> state
 *   clearAxioms(state)                     -> state
 *
 *   defaultLaws()                          -> the law object of an unwritten universe
 *   deriveLaws(state, tierClassMap?)       -> law object for the next universe
 *   classify(run)                          -> { signature, name, bands }
 *   catalogue(state)                       -> array of discovered universe classes
 *
 *   toLog10(v) / fraction(part, whole)     -> large-number helpers
 *   serialize(state) / deserialize(json)   -> save/load
 *   selfTest()                             -> { passed, failures }
 *
 * ---------------------------------------------------------------------------
 * CONTRACT WITH THE SIMULATION
 * ---------------------------------------------------------------------------
 * A RunSnapshot is a plain object describing a universe at the moment it is
 * closed. Every field is optional except where noted; missing fields degrade
 * to a conservative default rather than throwing.
 *
 *   arcComplete    boolean   the ladder has been climbed to its final rung
 *   peakTierIndex  int       highest rung reached, zero-based
 *   tierCount      int       how many rungs the ladder has in total
 *   boundMass      Magnitude matter currently held in structures
 *   totalMass      Magnitude matter that ever existed in this universe
 *   lostMass       Magnitude matter carried beyond reach or radiated away
 *   structureCount int       distinct structures at the highest occupied rung
 *   elapsed        Magnitude simulated time from first seed to closure
 *   researched     string[]  ids of everything learned in this universe
 *   recursionDepth int       how many universes were nested inside this one
 *   exotic         boolean   the seeding was too sparse for ordinary matter
 *   terminatedBy   string    'terminal' | 'vacuum' | 'recollapse' | 'manual'
 *
 * deriveLaws returns a flat object of scalars. The simulation reads what it
 * cares about and ignores the rest. Everything multiplicative is centred on
 * 1.0, so an unwritten universe derives exactly the default laws.
 *
 *   gravity          multiplier on the attraction between masses
 *   forceExponent    exponent in the r^-n force falloff (3 spatial dims -> 2)
 *   expansion        multiplier on the rate space grows
 *   binding          multiplier on the rate matter forms composite types
 *   tempo            global multiplier on simulated time
 *   familiarity      0..1, how much of the ladder is already known; the sim
 *                    should apply extra speed only below the frontier, so that
 *                    ground already understood is crossed quickly and new
 *                    ground is not skipped
 *   coherence        resistance of structures to being torn apart
 *   reach            multiplier on interaction distance
 *   decay            multiplier on the rate unbound matter is lost
 *   seedDensity      multiplier on how much matter the beginning yields
 *   seedCount        multiplier on how many independent seeds start
 *   observerCoupling 0..2, how strongly attention feeds back into the field
 *   recursionDepth   0..3, how many levels of nested universe are permitted
 *   vacuumHazard     probability per unit simulated time of spontaneous decay;
 *                    the simulation owns the roll, this module never rolls
 *   recollapse       boolean, the universe is bound and will fall back in
 *   exotic           boolean, seeding is sparse enough for rare matter only
 *   suppressed       string[] of physical classes this universe cannot form:
 *                    'composite' | 'fusion' | 'degenerate' | 'collapse' |
 *                    'structure'
 *   knownTiers       string[] of everything already learned, carried forward
 *   inert            string[] of known tiers that cannot be used under these
 *                    laws; empty unless a tierClassMap is supplied
 *
 * tierClassMap is an optional { [tierId]: physicalClass } supplied by the
 * progression ladder. It is the only coupling between this module and the
 * ladder, and it is one-way: this module never names a tier itself.
 */

/* -------------------------------------------------------------------------- */
/* large numbers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Reduce any accepted Magnitude to its base-10 logarithm.
 * Zero and absent values return -Infinity. Nonsense returns NaN.
 */
export function toLog10(v) {
  if (v === null || v === undefined) return -Infinity;
  if (typeof v === 'number') {
    if (!isFinite(v)) return v > 0 ? Infinity : NaN;
    if (v > 0) return Math.log10(v);
    return v === 0 ? -Infinity : NaN;
  }
  if (typeof v === 'object') {
    if (typeof v.log10 === 'number') return v.log10;
    if (typeof v.mantissa === 'number' && typeof v.exponent === 'number') {
      if (v.mantissa > 0) return Math.log10(v.mantissa) + v.exponent;
      return v.mantissa === 0 ? -Infinity : NaN;
    }
  }
  return NaN;
}

/**
 * part / whole as an ordinary 0..1 number, computed entirely in log space so
 * that both operands may be far beyond the range of a double.
 */
export function fraction(part, whole) {
  const lp = toLog10(part);
  const lw = toLog10(whole);
  if (!isFinite(lw) || Number.isNaN(lp)) return 0;
  if (!isFinite(lp)) return lp === Infinity ? 1 : 0;
  const d = lp - lw;
  if (d >= 0) return 1;
  if (d < -300) return 0;
  return Math.pow(10, d);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/* -------------------------------------------------------------------------- */
/* the writable laws                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Each axiom is one dial with one legible trade. Pushing a dial away from its
 * default costs slots in proportion to how far it is pushed, so a budget buys
 * either several mild laws or one violent one. There are no strictly better
 * settings: every direction on every dial closes something off.
 *
 * scale 'log' measures deviation in decades, 'linear' in raw units. step is
 * the size of one unit of deviation, and each unit past the first costs one
 * further slot, to a ceiling of MAX_AXIOM_COST.
 */
export const MAX_AXIOM_COST = 6;

export const AXIOMS = [
  {
    id: 'gravitation',
    label: 'Gravitation',
    summary: 'How hard matter pulls on matter. Strong gravity collapses everything before it has time to organise; weak gravity permits intricate structure but takes an age to build anything heavy.',
    min: 0.1, max: 100, default: 1, scale: 'log', step: 0.5, integer: false,
    apply(v, L) {
      L.gravity *= v;
      L.tempo *= Math.sqrt(v);
      if (v > 1) L.coherence /= 1 + Math.log10(v);
      else if (v < 1) L.coherence *= 1 + Math.abs(Math.log10(v)) * 0.3;
      if (v >= 30) L.suppressed.push('structure');
    }
  },
  {
    id: 'expansion',
    label: 'Expansion',
    summary: 'How fast the field grows. Expansion buys room for many independent beginnings and steals matter permanently out of reach. Set to nothing, the universe is bound and falls back in on itself.',
    min: 0, max: 10, default: 1, scale: 'linear', step: 1, integer: false,
    apply(v, L) {
      L.expansion *= v;
      L.decay *= 0.2 + 0.8 * v;
      L.reach *= 1 / (0.5 + 0.5 * v);
      L.seedCount *= 0.5 + 0.5 * v;
      if (v === 0) L.recollapse = true;
    }
  },
  {
    id: 'binding',
    label: 'Binding',
    summary: 'How readily matter sticks into composite kinds. High binding is a rich chemistry that also refuses to fall in on itself. At zero the universe is featureless dust that collapses beautifully and learns nothing.',
    min: 0, max: 5, default: 1, scale: 'linear', step: 0.5, integer: false,
    apply(v, L) {
      L.binding *= v;
      L.coherence *= 1 + 0.2 * v;
      L.decay *= 1 / (1 + 0.3 * v);
      if (v === 0) { L.suppressed.push('composite', 'fusion'); }
      if (v >= 4) L.suppressed.push('collapse');
    }
  },
  {
    id: 'causality',
    label: 'Causality',
    summary: 'How fast influence crosses distance. A quick universe runs hot and shears its own structures apart; a slow one is coherent and patient.',
    min: 0.2, max: 20, default: 1, scale: 'log', step: 0.4, integer: false,
    apply(v, L) {
      L.tempo *= v;
      L.coherence *= 1 / Math.sqrt(v);
      L.reach *= v;
    }
  },
  {
    id: 'asymmetry',
    label: 'Asymmetry',
    summary: 'The exponent of how much matter survives the beginning at all. Near the floor almost nothing remains, and what does is strange enough to have no ordinary history.',
    min: -12, max: -1, default: -9, scale: 'linear', step: 1, integer: false,
    apply(v, L) {
      L.seedDensity *= Math.pow(10, (v + 9) * 0.5);
      if (v <= -11) L.exotic = true;
    }
  },
  {
    id: 'degeneracy',
    label: 'Degeneracy',
    summary: 'How hard compressed matter pushes back. Without it, anything heavy enough falls straight through every intermediate kind. With too much of it, nothing can ever finish falling.',
    min: 0, max: 3, default: 1, scale: 'linear', step: 0.5, integer: false,
    apply(v, L) {
      L.coherence *= 1 + 0.15 * v;
      if (v === 0) { L.suppressed.push('degenerate'); L.tempo *= 1.3; }
      if (v >= 2.5) L.suppressed.push('collapse');
    }
  },
  {
    id: 'dimensionality',
    label: 'Dimensionality',
    summary: 'How many directions there are. In two, the field is confining and nothing ever escapes, but nothing collapses to a point either. In four or more, no orbit is stable, so nothing holds together long enough to be a structure and everything ends up falling in.',
    min: 2, max: 5, default: 3, scale: 'linear', step: 1, integer: true,
    apply(v, L) {
      L.forceExponent = v - 1;
      if (v === 2) {
        L.decay *= 0.05;
        L.reach *= 4;
        L.suppressed.push('collapse');
      } else if (v >= 4) {
        L.suppressed.push('structure');
        L.gravity *= 1.5 * (v - 2);
        L.tempo *= 1.5;
        L.decay *= 1.5;
      }
    }
  },
  {
    id: 'arrow',
    label: 'Arrow',
    summary: 'How steeply order runs downhill. A shallow arrow lets everything persist; a steep one erodes what is built but returns its matter to the field almost immediately.',
    min: 0.1, max: 10, default: 1, scale: 'log', step: 0.5, integer: false,
    apply(v, L) {
      L.decay *= v;
      L.tempo *= Math.pow(v, 0.25);
      L.coherence *= 1 / Math.pow(v, 0.3);
    }
  },
  {
    id: 'vacuum',
    label: 'Vacuum',
    summary: 'How unstable the ground state is. An unstable vacuum is dense and violent and quick, and may end without warning at any moment. Some outcomes are only reachable through a universe that does not expect to survive.',
    min: 0, max: 1, default: 0, scale: 'linear', step: 0.2, integer: false,
    apply(v, L) {
      L.vacuumHazard = v * 0.02;
      L.seedDensity *= 1 + 3 * v;
      L.tempo *= 1 + v;
    }
  },
  {
    id: 'observation',
    label: 'Observation',
    summary: 'How strongly attention feeds back into the field. What is watched holds together and does not disperse. It also slows: a universe under observation takes longer to become anything.',
    min: 0, max: 2, default: 0, scale: 'linear', step: 0.5, integer: false,
    apply(v, L) {
      L.observerCoupling = v;
      L.coherence *= 1 + 0.3 * v;
      L.decay *= 1 / (1 + 0.3 * v);
      L.tempo *= 1 / (1 + 0.4 * v);
    }
  },
  {
    id: 'recursion',
    label: 'Recursion',
    summary: 'Whether a collapsed object may contain a universe of its own. Every nested level drains matter out of the one that made it, and opens outcomes that a flat universe has no way to reach.',
    min: 0, max: 3, default: 0, scale: 'linear', step: 1, integer: true,
    apply(v, L) {
      L.recursionDepth = v;
      L.seedDensity *= 1 / (1 + 0.5 * v);
    }
  }
];

export const AXIOM_IDS = AXIOMS.map((a) => a.id);

const AXIOM_BY_ID = new Map(AXIOMS.map((a) => [a.id, a]));

export function getAxiom(id) {
  return AXIOM_BY_ID.get(id) || null;
}

/** Snap a raw dial value into the axiom's legal range and granularity. */
export function normalizeAxiomValue(id, value) {
  const ax = getAxiom(id);
  if (!ax) return null;
  let v = Number(value);
  if (!isFinite(v)) return null;
  if (ax.integer) v = Math.round(v);
  return clamp(v, ax.min, ax.max);
}

/** How far from default a setting sits, in the axiom's own units of deviation. */
function deviationUnits(ax, value) {
  if (value === ax.default) return 0;
  if (ax.scale === 'log') {
    const a = Math.log10(Math.max(value, 1e-12));
    const b = Math.log10(Math.max(ax.default, 1e-12));
    return Math.abs(a - b) / ax.step;
  }
  return Math.abs(value - ax.default) / ax.step;
}

/**
 * Slots consumed by holding an axiom at a given value. A dial left at its
 * default costs nothing and does not occupy a slot.
 */
export function axiomCost(id, value) {
  const ax = getAxiom(id);
  if (!ax) return 0;
  const v = normalizeAxiomValue(id, value);
  if (v === null || v === ax.default) return 0;
  const units = deviationUnits(ax, v);
  return Math.min(MAX_AXIOM_COST, 1 + Math.floor(units - 1e-9));
}

/* -------------------------------------------------------------------------- */
/* state                                                                      */
/* -------------------------------------------------------------------------- */

export const PHASE_FIRST_ARC = 'FIRST_ARC';
export const PHASE_CLOSED = 'CLOSED';
export const PHASE_AUTHORING = 'AUTHORING';

const STATE_VERSION = 1;

/**
 * A fresh save. The first arc has no rebirth in it: nothing here does anything
 * until the ladder has been climbed to its final rung.
 */
export function createState() {
  return {
    version: STATE_VERSION,
    phase: PHASE_FIRST_ARC,
    closures: 0,
    known: [],
    tierCount: 0,
    written: {},
    catalogue: {},
    endedAtClosure: 0
  };
}

function cloneState(s) {
  return {
    version: STATE_VERSION,
    phase: s.phase,
    closures: s.closures,
    known: s.known.slice(),
    tierCount: s.tierCount,
    written: Object.assign({}, s.written),
    catalogue: Object.assign({}, s.catalogue),
    endedAtClosure: s.endedAtClosure
  };
}

export function phase(state) {
  return state.phase;
}

/** Distinct universe classes ever produced. This is the only source of slots. */
export function discoveries(state) {
  return Object.keys(state.catalogue).length;
}

/**
 * Slot budget. Supply grows with the square root of distinct outcomes found,
 * so repeating a universe already in the catalogue is worth nothing and the
 * budget never opens wide enough to hold every dial at its extreme.
 */
export function slots(state) {
  const total = Math.floor(1.5 * Math.sqrt(discoveries(state)));
  let used = 0;
  for (const id of Object.keys(state.written)) used += axiomCost(id, state.written[id]);
  return { total, used, free: Math.max(0, total - used) };
}

/**
 * Set a law for the next universe. Returns { ok, state, reason }; never throws.
 * Writing a value equal to the default erases the law instead.
 */
export function writeAxiom(state, id, value) {
  const ax = getAxiom(id);
  if (!ax) return { ok: false, state, reason: 'unknown-axiom' };
  if (state.phase !== PHASE_AUTHORING) return { ok: false, state, reason: 'not-authoring' };
  const v = normalizeAxiomValue(id, value);
  if (v === null) return { ok: false, state, reason: 'invalid-value' };
  if (v === ax.default) return { ok: true, state: eraseAxiom(state, id), reason: 'erased' };

  const next = cloneState(state);
  next.written[id] = v;
  const budget = slots(next);
  if (budget.used > budget.total) {
    return { ok: false, state, reason: 'insufficient-slots' };
  }
  return { ok: true, state: next, reason: 'written' };
}

export function eraseAxiom(state, id) {
  if (!(id in state.written)) return state;
  const next = cloneState(state);
  delete next.written[id];
  return next;
}

export function clearAxioms(state) {
  const next = cloneState(state);
  next.written = {};
  return next;
}

/* -------------------------------------------------------------------------- */
/* laws                                                                       */
/* -------------------------------------------------------------------------- */

export function defaultLaws() {
  return {
    gravity: 1,
    forceExponent: 2,
    expansion: 1,
    binding: 1,
    tempo: 1,
    familiarity: 0,
    coherence: 1,
    reach: 1,
    decay: 1,
    seedDensity: 1,
    seedCount: 1,
    observerCoupling: 0,
    recursionDepth: 0,
    vacuumHazard: 0,
    recollapse: false,
    exotic: false,
    suppressed: [],
    knownTiers: [],
    inert: []
  };
}

/**
 * How much of the ladder is already understood. Ground already crossed should
 * be crossed quickly next time, because there is no decision left in it.
 */
function familiarityOf(state) {
  const n = state.known.length;
  if (n === 0) return 0;
  if (state.tierCount > 0) return clamp(n / state.tierCount, 0, 1);
  return 1 - 1 / (1 + n / 12);
}

/**
 * The laws the next universe will run under. With nothing written this returns
 * the default laws plus whatever knowledge has been carried forward.
 *
 * tierClassMap is optional; supply it to have known-but-impossible tiers
 * reported in `inert`.
 */
export function deriveLaws(state, tierClassMap) {
  const L = defaultLaws();
  for (const ax of AXIOMS) {
    const v = state.written[ax.id];
    if (v === undefined) continue;
    ax.apply(v, L);
  }
  L.suppressed = Array.from(new Set(L.suppressed));
  L.knownTiers = state.known.slice();
  L.familiarity = familiarityOf(state);

  if (tierClassMap && L.suppressed.length) {
    const blocked = new Set(L.suppressed);
    L.inert = L.knownTiers.filter((t) => blocked.has(tierClassMap[t]));
  }
  return L;
}

/* -------------------------------------------------------------------------- */
/* classification                                                             */
/* -------------------------------------------------------------------------- */

function bandReach(run) {
  const total = run.tierCount > 0 ? run.tierCount : 1;
  const f = (Number(run.peakTierIndex || 0) + 1) / total;
  if (run.arcComplete) return 'COMPLETE';
  if (f < 0.15) return 'ARRESTED';
  if (f < 0.45) return 'SHALLOW';
  if (f < 0.8) return 'DEEP';
  return 'COMPLETE';
}

function bandDensity(f) {
  if (f < 0.1) return 'SPARSE';
  if (f < 0.5) return 'DIFFUSE';
  if (f < 0.85) return 'DENSE';
  return 'SATURATED';
}

function bandTopology(n) {
  const c = Number(n || 0);
  if (c <= 0) return 'VOID';
  if (c === 1) return 'MONOLITHIC';
  if (c <= 8) return 'CLUSTERED';
  if (c <= 1000) return 'FILAMENTARY';
  return 'FOAMED';
}

function bandDuration(run) {
  const t = toLog10(run.elapsed);
  if (!isFinite(t)) return 'FLEETING';
  if (t < 2) return 'FLEETING';
  if (t < 5) return 'BRIEF';
  if (t < 9) return 'LONG';
  return 'ENDURING';
}

function bandFate(run, reach, density, lostFraction) {
  if (run.terminatedBy === 'vacuum') return 'DECAY';
  if (run.terminatedBy === 'recollapse') return 'RECOLLAPSE';
  if (lostFraction >= 0.9) return 'DISPERSAL';
  if (reach === 'COMPLETE') return 'CLOSURE';
  if (density === 'SATURATED' || (density === 'DENSE' && reach === 'DEEP')) return 'COLLAPSE';
  return 'STASIS';
}

/**
 * Name a universe by what it turned out to be. Nothing here is a lookup table
 * of authored outcomes: the name is composed from measurements, so the set of
 * reachable classes is whatever the laws actually permit rather than whatever
 * was written down in advance.
 */
export function classify(run) {
  const r = run || {};
  const density = fraction(r.boundMass, r.totalMass);
  const lost = fraction(r.lostMass, r.totalMass);
  const reachBand = bandReach(r);
  const densityBand = bandDensity(density);
  const topologyBand = bandTopology(r.structureCount);
  const durationBand = bandDuration(r);
  const fateBand = bandFate(r, reachBand, densityBand, lost);
  const recursive = Number(r.recursionDepth || 0) > 0;
  const exotic = !!r.exotic;

  const signature = [
    reachBand, densityBand, topologyBand, fateBand, durationBand,
    'R' + (recursive ? 1 : 0), 'X' + (exotic ? 1 : 0)
  ].join('/');

  let modifier = null;
  if (recursive) modifier = 'RECURSIVE';
  else if (exotic) modifier = 'EXOTIC';
  else if (reachBand === 'ARRESTED') modifier = 'STILLBORN';
  else if (durationBand === 'ENDURING') modifier = 'ENDURING';
  else if (durationBand === 'FLEETING') modifier = 'FLEETING';

  const words = modifier ? [modifier] : [];
  words.push(densityBand, topologyBand, fateBand);

  return {
    signature,
    name: words.join(' '),
    bands: {
      reach: reachBand,
      density: densityBand,
      topology: topologyBand,
      fate: fateBand,
      duration: durationBand,
      recursive,
      exotic
    },
    measures: { density, lost }
  };
}

/** Every distinct class produced so far, oldest first. */
export function catalogue(state) {
  return Object.keys(state.catalogue)
    .map((sig) => state.catalogue[sig])
    .sort((a, b) => a.firstSeen - b.firstSeen);
}

/* -------------------------------------------------------------------------- */
/* closure                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Whether this universe may be closed.
 *
 * During the first arc the answer is no until the ladder has been climbed to
 * its final rung. There is no early reset, no partial cash-out, and no reason
 * to consider one. After that, any universe that exists may be closed at any
 * time; there is no yield curve to time it against.
 */
export function canClose(run, state) {
  if (!run) return false;
  if (state.phase === PHASE_CLOSED) return false;
  if (state.phase === PHASE_FIRST_ARC) return run.arcComplete === true;
  return Number(run.peakTierIndex || 0) >= 0;
}

function closureResult(run, state) {
  const cls = classify(run);
  const researched = Array.isArray(run.researched) ? run.researched : [];
  const knownSet = new Set(state.known);
  const learned = researched.filter((t) => !knownSet.has(t));
  const isNew = !(cls.signature in state.catalogue);

  const projected = cloneState(state);
  projected.catalogue[cls.signature] = projected.catalogue[cls.signature] || {
    signature: cls.signature, name: cls.name, bands: cls.bands, firstSeen: state.closures + 1, count: 0
  };
  const slotsAfter = Math.floor(1.5 * Math.sqrt(Object.keys(projected.catalogue).length));

  return {
    classification: cls,
    learned,
    isNewClass: isNew,
    slotsBefore: slots(state).total,
    slotsAfter,
    endsTheGame: state.phase === PHASE_FIRST_ARC
  };
}

/**
 * What closing this universe would yield, without closing it. Safe to call
 * every frame.
 */
export function projectClosure(run, state) {
  if (!canClose(run, state)) return null;
  return closureResult(run, state);
}

/**
 * Close a universe. This destroys it. What survives is everything that was
 * learned, and the catalogue entry describing what this universe turned out
 * to be. No matter, no multiplier, and no banked currency crosses the gap.
 *
 * The first closure is the ending. It moves the save to 'CLOSED' and asks for
 * nothing further. Reaching 'AUTHORING' from there requires a deliberate call
 * to beginAuthoring, which exists so that a player who stops at the ending has
 * finished a whole game rather than paused in the middle of one.
 *
 * Returns { state, closure }.
 */
export function close(run, state) {
  if (!canClose(run, state)) {
    return { state, closure: null };
  }
  const result = closureResult(run, state);
  const next = cloneState(state);

  next.closures = state.closures + 1;

  const knownSet = new Set(next.known);
  for (const t of result.learned) knownSet.add(t);
  next.known = Array.from(knownSet);
  if (Number(run.tierCount || 0) > next.tierCount) next.tierCount = Number(run.tierCount);

  const sig = result.classification.signature;
  const prior = next.catalogue[sig];
  next.catalogue[sig] = prior
    ? Object.assign({}, prior, { count: prior.count + 1 })
    : {
        signature: sig,
        name: result.classification.name,
        bands: result.classification.bands,
        firstSeen: next.closures,
        count: 1
      };

  if (state.phase === PHASE_FIRST_ARC) {
    next.phase = PHASE_CLOSED;
    next.endedAtClosure = next.closures;
  }

  // Written laws are consumed by the universe they were written for. Slots are
  // released so the next universe is authored from a blank field, which is the
  // only way a budget stays a decision rather than a one-time configuration.
  next.written = {};

  return { state: next, closure: result };
}

/**
 * Leave the ending. The only transition out of 'CLOSED'. Nothing in the game
 * should prompt for this; it exists to be found.
 */
export function beginAuthoring(state) {
  if (state.phase !== PHASE_CLOSED) return state;
  const next = cloneState(state);
  next.phase = PHASE_AUTHORING;
  return next;
}

/* -------------------------------------------------------------------------- */
/* persistence                                                                */
/* -------------------------------------------------------------------------- */

export function serialize(state) {
  return JSON.stringify({
    version: STATE_VERSION,
    phase: state.phase,
    closures: state.closures,
    known: state.known,
    tierCount: state.tierCount,
    written: state.written,
    catalogue: state.catalogue,
    endedAtClosure: state.endedAtClosure
  });
}

export function deserialize(json) {
  let raw;
  try {
    raw = typeof json === 'string' ? JSON.parse(json) : json;
  } catch (e) {
    return createState();
  }
  if (!raw || typeof raw !== 'object') return createState();
  const s = createState();
  if (raw.phase === PHASE_CLOSED || raw.phase === PHASE_AUTHORING) s.phase = raw.phase;
  s.closures = Number(raw.closures) || 0;
  s.known = Array.isArray(raw.known) ? raw.known.slice() : [];
  s.tierCount = Number(raw.tierCount) || 0;
  s.endedAtClosure = Number(raw.endedAtClosure) || 0;
  if (raw.written && typeof raw.written === 'object') {
    for (const id of Object.keys(raw.written)) {
      const v = normalizeAxiomValue(id, raw.written[id]);
      if (v !== null && v !== getAxiom(id).default) s.written[id] = v;
    }
  }
  if (raw.catalogue && typeof raw.catalogue === 'object') {
    for (const sig of Object.keys(raw.catalogue)) {
      const e = raw.catalogue[sig];
      if (e && typeof e === 'object' && typeof e.signature === 'string') s.catalogue[sig] = e;
    }
  }
  return s;
}

/* -------------------------------------------------------------------------- */
/* self test                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * No build step means no test runner, so the module checks itself. Returns
 * { passed, failures } and never throws.
 */
export function selfTest() {
  const failures = [];
  const ok = (cond, msg) => { if (!cond) failures.push(msg); };

  // large numbers survive beyond the range of a double
  ok(fraction({ mantissa: 5, exponent: 799 }, { mantissa: 1, exponent: 800 }) > 0.49, 'fraction: 1e800 scale');
  ok(fraction({ log10: 53 }, { log10: 53 }) === 1, 'fraction: equal magnitudes');
  ok(fraction(0, { mantissa: 1, exponent: 400 }) === 0, 'fraction: zero part');
  ok(fraction(1, 0) === 0, 'fraction: zero whole');
  ok(toLog10(1e53) > 52.9 && toLog10(1e53) < 53.1, 'toLog10: plain number');

  // an unwritten universe derives exactly the default laws
  const s0 = createState();
  const L0 = deriveLaws(s0);
  ok(L0.gravity === 1 && L0.tempo === 1 && L0.forceExponent === 2, 'deriveLaws: identity at defaults');
  ok(L0.suppressed.length === 0 && L0.familiarity === 0, 'deriveLaws: nothing suppressed at defaults');

  // the first arc has no rebirth in it
  ok(canClose({ arcComplete: false, peakTierIndex: 4 }, s0) === false, 'canClose: no early reset');
  ok(canClose({ arcComplete: true, peakTierIndex: 9, tierCount: 10 }, s0) === true, 'canClose: at the top of the ladder');
  ok(writeAxiom(s0, 'gravitation', 10).ok === false, 'writeAxiom: refused before authoring');

  // closing the first universe ends the game and keeps what was learned
  const run1 = {
    arcComplete: true, peakTierIndex: 9, tierCount: 10,
    boundMass: { mantissa: 8, exponent: 52 }, totalMass: { mantissa: 1, exponent: 53 },
    lostMass: { mantissa: 2, exponent: 52 }, structureCount: 400,
    elapsed: { log10: 17 }, researched: ['dust', 'star', 'hole'], terminatedBy: 'terminal'
  };
  const c1 = close(run1, s0);
  ok(c1.closure.endsTheGame === true, 'close: first closure is the ending');
  ok(c1.state.phase === PHASE_CLOSED, 'close: phase becomes CLOSED');
  ok(c1.state.known.length === 3, 'close: knowledge is retained in full');
  ok(canClose(run1, c1.state) === false, 'close: the ending happens once');
  ok(discoveries(c1.state) === 1, 'close: first universe is a discovery');
  ok(slots(c1.state).total === 1, 'slots: one law after the ending');

  const s1 = beginAuthoring(c1.state);
  ok(s1.phase === PHASE_AUTHORING, 'beginAuthoring: leaves the ending');

  // slot budget bites
  const cheap = writeAxiom(s1, 'gravitation', 3.16);
  ok(cheap.ok === true, 'writeAxiom: one step costs one slot');
  ok(slots(cheap.state).used === 1, 'slots: cost accounting');
  const violent = writeAxiom(s1, 'gravitation', 100);
  ok(violent.ok === false && violent.reason === 'insufficient-slots', 'writeAxiom: extremes cost more than one slot');
  ok(axiomCost('gravitation', 100) === 4, 'axiomCost: log scale deviation');
  ok(axiomCost('gravitation', 1) === 0, 'axiomCost: default is free');
  ok(axiomCost('dimensionality', 5) === 2, 'axiomCost: linear scale deviation');

  // written laws actually change the universe
  const L1 = deriveLaws(cheap.state);
  ok(L1.gravity > 3 && L1.tempo > 1.7, 'deriveLaws: gravitation applied');
  const dim = writeAxiom(s1, 'dimensionality', 2);
  const L2 = deriveLaws(dim.state, { dust: 'composite', hole: 'collapse' });
  ok(L2.forceExponent === 1, 'deriveLaws: two dimensions change the falloff');
  ok(L2.suppressed.indexOf('collapse') >= 0, 'deriveLaws: two dimensions forbid collapse');
  ok(L2.inert.indexOf('hole') >= 0, 'deriveLaws: known but impossible is reported inert');
  ok(L2.inert.indexOf('dust') === -1, 'deriveLaws: unaffected knowledge stays usable');

  // classification is deterministic and composed from measurement
  const a = classify(run1);
  const b = classify(run1);
  ok(a.signature === b.signature, 'classify: deterministic');
  ok(a.bands.fate === 'CLOSURE' && a.bands.topology === 'FILAMENTARY', 'classify: bands from measurement');
  const dead = classify({
    arcComplete: false, peakTierIndex: 0, tierCount: 10,
    boundMass: 0, totalMass: 1e40, lostMass: 1e40, structureCount: 0,
    elapsed: 10, terminatedBy: 'terminal'
  });
  ok(dead.bands.fate === 'DISPERSAL' && dead.name.indexOf('STILLBORN') === 0, 'classify: a dead universe is still a class');

  // repeating a universe yields nothing
  const c2 = close(run1, s1);
  ok(discoveries(c2.state) === 1, 'close: a repeat is not a discovery');
  ok(slots(c2.state).total === 1, 'slots: repeats do not grow the budget');
  ok(Object.keys(c2.state.written).length === 0, 'close: written laws are consumed');
  ok(c2.state.phase === PHASE_AUTHORING, 'close: later closures are not endings');

  // round trip
  const restored = deserialize(serialize(cheap.state));
  ok(restored.phase === PHASE_AUTHORING && restored.written.gravitation === 3.16, 'serialize: round trip');
  ok(deserialize('not json').phase === PHASE_FIRST_ARC, 'deserialize: garbage falls back to a fresh save');

  // nothing mutates its input
  const before = serialize(s1);
  writeAxiom(s1, 'binding', 0);
  close(run1, s1);
  ok(serialize(s1) === before, 'purity: state is never mutated in place');

  return { passed: failures.length === 0, failures };
}
