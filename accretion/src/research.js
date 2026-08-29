/**
 * research.js - the game on top of the field.
 *
 * Pure logic: no DOM, no simulation, no clock of its own. The interface tells
 * it what the field did and how much time passed; it answers with what the
 * player has earned, what is on the board, and what buying a node does.
 *
 * THE SHAPE, stated so it stays this shape:
 *
 *   - ONE currency, flux, earned only from what the field DOES: things
 *     meeting, igniting, dying. A star shines flux every second it is a
 *     star, and a death pays out at once. A field with nothing happening in
 *     it earns nothing, so there is nothing to wait for and nothing to skip.
 *   - THE BOARD IS A WINDOW, NOT AN ARCHIVE. At most six nodes are ever on
 *     it, all from the current era. Crossing into the next era removes the
 *     old board and leaves behind one law with one dial. Nothing accumulates
 *     on screen.
 *   - A node does exactly one of three things: lets the field make a kind it
 *     could not (the simulation gates every kind above dust), multiplies
 *     what a class of event pays, or grants a law - an automation the player
 *     sets with a dial and then watches run.
 *   - Knowledge carries. Closing a universe and starting again is not a
 *     reset: every node ever bought is known, and known nodes cost nothing
 *     the next time round.
 */

/** Kind codes, matching the simulation's, so this file need not import it. */
export const K = Object.freeze({
  DUST: 0, ROCK: 1, PLANETESIMAL: 2, PLANET: 3, GAS_GIANT: 4, BROWN_DWARF: 5, STAR: 6,
  GIANT_STAR: 7, WHITE_DWARF: 8, NEUTRON_STAR: 9, BLACK_HOLE: 10,
});

/**
 * The eras. `law` is the id of the node whose purchase ends the era and
 * whose law survives it.
 */
export const ERAS = Object.freeze([
  { id: 'field', name: 'the field', law: null },
  { id: 'dust', name: 'dust', law: 'infall' },
  { id: 'stars', name: 'stars', law: 'orbit' },
  { id: 'remnants', name: 'remnants', law: 'cycle' },
  { id: 'cosmos', name: 'the cosmos', law: 'formation' },
]);

/**
 * The nodes, six per era. `needs` is at most one node, which keeps the
 * board a line with a fork rather than a graph. `does` is declarative: the
 * interface reads it and acts.
 *
 *   { unlock: kind }         the field may now make this kind
 *   { pays: class, x: n }    events of this class pay n times as much
 *   { shines: class, x: n }  this class of body earns n times as much per second
 *   { law: id, dial: {...} } grants a law with a dial the player sets
 *   { hud: 'spectroscopy' }  the interface shows something it did not
 *   { capstone: true }       ends the era
 *   { ending: true }         closes the universe
 */
export const NODES = Object.freeze([
  // --- dust ----------------------------------------------------------------
  { id: 'accretion', era: 1, name: 'accretion', cost: 12, needs: null,
    line: 'Grains that touch, stay. The field may make rock.',
    does: { unlock: K.ROCK } },
  { id: 'pressure', era: 1, name: 'pressure', cost: 80, needs: 'accretion',
    line: 'Enough rock presses itself into one body. The field may make planetesimals.',
    does: { unlock: K.PLANETESIMAL } },
  { id: 'differentiation', era: 1, name: 'differentiation', cost: 400, needs: 'pressure',
    line: 'Iron sinks, stone floats. The field may make planets.',
    does: { unlock: K.PLANET } },
  { id: 'capture', era: 1, name: 'capture', cost: 1500, needs: 'differentiation',
    line: 'A world heavy enough holds on to gas. The field may make gas giants.',
    does: { unlock: K.GAS_GIANT } },
  { id: 'infall', era: 1, name: 'infall', cost: 600, needs: 'pressure',
    line: 'Loose matter falls in on its own, at a rate you set.',
    does: { law: 'infall', dial: { key: 'infall', label: 'infall rate', min: 0, max: 1, def: 0.5,
                                   line: 'matter falls in without a click' } } },
  { id: 'worlds', era: 1, name: 'worlds', cost: 4000, needs: 'capture',
    line: 'Ends the era. New research replaces this list; infall stays.',
    does: { capstone: true } },

  // --- stars ---------------------------------------------------------------
  { id: 'deuterium', era: 2, name: 'deuterium', cost: 6000, needs: null,
    line: 'A gas giant past thirteen Jupiters burns a little. The field may make brown dwarfs.',
    does: { unlock: K.BROWN_DWARF } },
  { id: 'fusion', era: 2, name: 'fusion', cost: 15000, needs: 'deuterium',
    line: 'Hydrogen ignites. The field may make stars.',
    does: { unlock: K.STAR } },
  { id: 'orbit', era: 2, name: 'orbit', cost: 8000, needs: 'deuterium',
    line: 'What falls in arrives with sideways motion, and makes systems instead of piles.',
    does: { law: 'orbit', dial: { key: 'orbit', label: 'orbital speed', min: 0, max: 1, def: 0.8,
                                  line: 'sideways motion; 100% is a circular orbit' } } },
  { id: 'spectroscopy', era: 2, name: 'spectroscopy', cost: 5000, needs: 'fusion',
    line: 'The heaviest star is named: its class, its mass, how long it has left.',
    does: { hud: 'spectroscopy' } },
  { id: 'luminosity', era: 2, name: 'luminosity', cost: 20000, needs: 'fusion',
    line: 'Starlight pays double.',
    does: { shines: 'star', x: 2 } },
  { id: 'sequence', era: 2, name: 'the main sequence', cost: 50000, needs: 'luminosity',
    line: 'Ends the era. New research replaces this list; orbit stays.',
    does: { capstone: true } },

  // --- remnants ------------------------------------------------------------
  { id: 'helium', era: 3, name: 'helium flash', cost: 120000, needs: null,
    line: 'A giant burns what a star could not. Giant stars pay triple.',
    does: { shines: 'giant', x: 3 } },
  { id: 'nucleosynthesis', era: 3, name: 'nucleosynthesis', cost: 240000, needs: 'helium',
    line: 'Everything heavier than iron is made in a death. Deaths pay triple.',
    does: { pays: 'death', x: 3 } },
  { id: 'degeneracy', era: 3, name: 'degeneracy', cost: 180000, needs: 'helium',
    line: 'What is left keeps shining. White dwarfs and neutron stars begin to pay.',
    does: { shines: 'remnant', x: 1 } },
  { id: 'cycle', era: 3, name: 'the stellar cycle', cost: 360000, needs: 'nucleosynthesis',
    line: 'Thrown gas gathers again sooner, at a pace you set.',
    does: { law: 'cycle', dial: { key: 'cycle', label: 'cooling time', min: 0, max: 1, def: 0.5,
                                  line: 'how long thrown gas takes to gather' } } },
  { id: 'disc', era: 3, name: 'accretion disc', cost: 480000, needs: 'degeneracy',
    line: 'A black hole that feeds outshines a galaxy. Black holes begin to pay.',
    does: { shines: 'hole', x: 1 } },
  { id: 'horizon', era: 3, name: 'the event horizon', cost: 1200000, needs: 'disc',
    line: 'Ends the era. New research replaces this list; the stellar cycle stays.',
    does: { capstone: true } },

  // --- the cosmos ----------------------------------------------------------
  { id: 'formation', era: 4, name: 'star formation', cost: 1500000, needs: null,
    line: 'Infall arrives as whole clouds, and the clouds make stars.',
    does: { law: 'formation', dial: { key: 'formation', label: 'cloud size', min: 0, max: 1, def: 0.5,
                                      line: 'the size of each cloud that arrives' } } },
  { id: 'clusters', era: 4, name: 'clusters', cost: 3000000, needs: 'formation',
    line: 'Too many to draw: the field condenses what it cannot resolve. Condensation pays.',
    does: { pays: 'condense', x: 1 } },
  { id: 'galaxies', era: 4, name: 'galaxies', cost: 6000000, needs: 'clusters',
    line: 'A million stars in one point of light. Everything pays double.',
    does: { pays: 'all', x: 2 } },
  { id: 'web', era: 4, name: 'the web', cost: 12000000, needs: 'galaxies',
    line: 'Structure at every scale. Everything pays double again.',
    does: { pays: 'all', x: 2 } },
  { id: 'universe', era: 4, name: 'universe', cost: 25000000, needs: 'web',
    line: 'There is no larger thing to make. Only to close.',
    does: { hud: 'universe' } },
  { id: 'close', era: 4, name: 'close the universe', cost: 0, needs: 'universe',
    line: 'This ends the universe. Everything learned is kept; nothing else is.',
    does: { ending: true } },
]);

const BY_ID = new Map(NODES.map(n => [n.id, n]));
export const node = (id) => BY_ID.get(id) || null;

/** What each thing the field does is worth, before any multiplier. */
export const PAY = Object.freeze({
  merge: 2,             // two things touching, times one plus the rung of what they fell into
  promote: 8,           // a rung climbed, times the rung - for the first few of each kind only,
  promoteFirst: 12,     // because late in a run every seed that lands climbs three rungs at once
  ignite: 60,           // first light
  giant: 40,            // a star leaving the main sequence
  nebula: 120,          // a planetary nebula
  supernova: 500,       // the flash
  collapse: 300,        // a direct collapse
  detonation: 250,      // a white dwarf detonating
  remnant: 120,         // a remnant forming, times its rung above a star
  second: 150,          // gas gathering into a new star
  condense: 200,        // a group condensing into an aggregate
  // Per second, per body, by class. Stars scale with the fourth root of their
  // luminosity, capped, so a giant star pays more than a dwarf without a
  // single one outweighing the whole field.
  starPerSecond: 0.25,
  starLumCap: 40,
  giantPerSecond: 0.6,
  remnantPerSecond: 0.15,
  holePerSecond: 0.5,
});

/** A fresh run. `known` carries from earlier universes. */
export function createResearch(known = []) {
  return {
    era: 0,
    flux: 0,
    earned: 0,
    rate: 0,
    bought: [],
    known: Array.from(new Set(known)),
    laws: [],
    dials: {},
    mult: { death: 1, all: 1, condense: 1, star: 1, giant: 1, remnant: 0, hole: 0 },
    hud: [],
    wanted: [],      // kinds the field has earned but may not take
    closed: false,
    counts: {},
  };
}

export const era = (s) => ERAS[s.era];
export const has = (s, id) => s.bought.indexOf(id) >= 0;
export const knows = (s, id) => s.known.indexOf(id) >= 0;

/** The board: this era's nodes not yet bought, with what the player can do about each. */
export function board(s) {
  if (s.era === 0 || s.closed) return [];
  const out = [];
  for (const n of NODES) {
    if (n.era !== s.era || has(s, n.id)) continue;
    const open = !n.needs || has(s, n.needs);
    const cost = knows(s, n.id) ? 0 : n.cost;
    out.push({
      node: n, open, cost, known: knows(s, n.id),
      affordable: open && s.flux >= cost,
      wanted: n.does.unlock !== undefined && s.wanted.indexOf(n.does.unlock) >= 0,
    });
  }
  return out.slice(0, 6);
}

/** The board appears with the first thing that happens in the field. */
export function begin(s) {
  if (s.era === 0) s.era = 1;
}

export function canBuy(s, id) {
  const n = node(id);
  if (!n || n.era !== s.era || has(s, id) || s.closed) return false;
  if (n.needs && !has(s, n.needs)) return false;
  return s.flux >= (knows(s, id) ? 0 : n.cost);
}

/**
 * Buy a node. Returns the effects the interface must apply, or null.
 * The state is mutated in place; this is the one function that does.
 */
export function buy(s, id) {
  if (!canBuy(s, id)) return null;
  const n = node(id);
  const cost = knows(s, id) ? 0 : n.cost;
  s.flux -= cost;
  s.bought.push(id);
  if (!knows(s, id)) s.known.push(id);
  const d = n.does;
  const effects = [];
  if (d.unlock !== undefined) {
    effects.push({ unlock: d.unlock });
    s.wanted = s.wanted.filter(k => k !== d.unlock);
  }
  if (d.pays) { s.mult[d.pays] = (s.mult[d.pays] || 1) * d.x; effects.push({ pays: d.pays, x: d.x }); }
  if (d.shines) {
    s.mult[d.shines] = d.x === 1 && !s.mult[d.shines] ? 1 : (s.mult[d.shines] || 1) * d.x;
    effects.push({ shines: d.shines });
  }
  if (d.law) {
    s.laws.push(d.law);
    if (s.dials[d.dial.key] === undefined) s.dials[d.dial.key] = d.dial.def;
    effects.push({ law: d.law });
  }
  if (d.hud) { s.hud.push(d.hud); effects.push({ hud: d.hud }); }
  if (d.capstone) {
    // The window moves: the old board is gone, the era's law stays.
    s.era = Math.min(ERAS.length - 1, s.era + 1);
    effects.push({ era: s.era });
  }
  if (d.ending) { s.closed = true; effects.push({ ending: true }); }
  return effects;
}

export function setDial(s, key, value) {
  const n = NODES.find(x => x.does.law && x.does.dial.key === key);
  if (!n) return false;
  const d = n.does.dial;
  const v = Math.max(d.min, Math.min(d.max, Number(value)));
  if (!Number.isFinite(v)) return false;
  s.dials[key] = v;
  return true;
}

export const dial = (s, key) => (s.dials[key] === undefined ? 0 : s.dials[key]);
export const hasLaw = (s, id) => s.laws.indexOf(id) >= 0;

/** Note that the field has earned a kind it may not take. */
export function want(s, kind) {
  if (s.wanted.indexOf(kind) < 0) s.wanted.push(kind);
}

function pay(s, amount, cls) {
  const m = (cls ? (s.mult[cls] || 1) : 1) * (s.mult.all || 1);
  const v = amount * m;
  s.flux += v;
  s.earned += v;
  return v;
}

/**
 * What one field event is worth. `ev` is the interface's reading of it:
 *   { kind: 'merge' | 'promote' | 'ignite' | 'giant' | 'nebula' | 'supernova'
 *           | 'collapse' | 'detonation' | 'remnant' | 'second' | 'condense',
 *     rung?: number }
 * Returns the flux paid.
 */
export function onEvent(s, ev) {
  if (s.closed) return 0;
  s.counts[ev.kind] = (s.counts[ev.kind] || 0) + 1;
  switch (ev.kind) {
    case 'merge': return pay(s, PAY.merge * (1 + Math.max(0, ev.rung || 0)));
    case 'promote': {
      const key = 'promote' + (ev.rung | 0);
      s.counts[key] = (s.counts[key] || 0) + 1;
      if (s.counts[key] > PAY.promoteFirst) return 0;
      return pay(s, PAY.promote * Math.max(1, ev.rung || 1));
    }
    case 'ignite': return pay(s, PAY.ignite);
    case 'giant': return pay(s, PAY.giant);
    case 'nebula': return pay(s, PAY.nebula, 'death');
    case 'supernova': return pay(s, PAY.supernova, 'death');
    case 'collapse': return pay(s, PAY.collapse, 'death');
    case 'detonation': return pay(s, PAY.detonation, 'death');
    case 'remnant': return pay(s, PAY.remnant * Math.max(1, ev.rung || 1), 'death');
    case 'second': return pay(s, PAY.second);
    case 'condense': return pay(s, PAY.condense, 'condense');
    default: return 0;
  }
}

/**
 * Continuous income. `census` is what shines in the field this frame:
 *   { starLum: sum over stars of L^0.25, giants: n, remnants: n, holes: n }
 * Returns the flux paid this tick.
 */
export function tick(s, dt, census) {
  if (s.closed || !(dt > 0)) { s.rate = 0; return 0; }
  const per =
    PAY.starPerSecond * (census.starLum || 0) * (s.mult.star || 1) +
    PAY.giantPerSecond * (census.giants || 0) * (s.mult.giant || 1) +
    PAY.remnantPerSecond * (census.remnants || 0) * (s.mult.remnant || 0) +
    PAY.holePerSecond * (census.holes || 0) * (s.mult.hole || 0);
  const rate = per * (s.mult.all || 1);
  s.rate = rate;
  if (rate <= 0) return 0;
  const v = rate * dt;
  s.flux += v;
  s.earned += v;
  return v;
}

/** How long, at the current rate, until a node is affordable. Infinity if never. */
export function timeToAfford(s, id) {
  const n = node(id);
  if (!n) return Infinity;
  const cost = knows(s, id) ? 0 : n.cost;
  if (s.flux >= cost) return 0;
  if (!(s.rate > 0)) return Infinity;
  return (cost - s.flux) / s.rate;
}

export function serialize(s) {
  return {
    v: 1, era: s.era, flux: s.flux, earned: s.earned, bought: s.bought.slice(), known: s.known.slice(),
    laws: s.laws.slice(), dials: Object.assign({}, s.dials), mult: Object.assign({}, s.mult),
    hud: s.hud.slice(), wanted: s.wanted.slice(), closed: s.closed, counts: Object.assign({}, s.counts),
  };
}

export function deserialize(o) {
  const s = createResearch(o && o.known ? o.known : []);
  if (!o) return s;
  s.era = o.era | 0;
  s.flux = +o.flux || 0;
  s.earned = +o.earned || 0;
  s.bought = Array.isArray(o.bought) ? o.bought.slice() : [];
  s.laws = Array.isArray(o.laws) ? o.laws.slice() : [];
  s.dials = Object.assign({}, o.dials || {});
  s.mult = Object.assign(s.mult, o.mult || {});
  s.hud = Array.isArray(o.hud) ? o.hud.slice() : [];
  s.wanted = Array.isArray(o.wanted) ? o.wanted.slice() : [];
  s.closed = !!o.closed;
  s.counts = Object.assign({}, o.counts || {});
  return s;
}

/** Structural checks, so a data edit cannot quietly break the window rule. */
export function assertShape() {
  const problems = [];
  for (let e = 1; e < ERAS.length; e++) {
    const ns = NODES.filter(n => n.era === e);
    if (ns.length !== 6) problems.push(`era ${e} has ${ns.length} nodes, not six`);
    for (const n of ns) {
      if (n.needs && !(BY_ID.has(n.needs) && BY_ID.get(n.needs).era === e)) problems.push(`${n.id} needs ${n.needs}, which is not in its era`);
    }
    const ends = ns.filter(n => n.does.capstone || n.does.ending);
    if (ends.length !== 1) problems.push(`era ${e} has ${ends.length} ways to end`);
    const laws = ns.filter(n => n.does.law);
    if (laws.length > 1) problems.push(`era ${e} grants ${laws.length} laws`);
    if (ERAS[e].law && !laws.find(l => l.id === ERAS[e].law)) problems.push(`era ${e} names a law it does not grant`);
  }
  return problems;
}

export default {
  K, ERAS, NODES, PAY, node, createResearch, era, has, knows, board, begin, canBuy, buy, setDial, dial,
  hasLaw, want, onEvent, tick, timeToAfford, serialize, deserialize, assertShape,
};
