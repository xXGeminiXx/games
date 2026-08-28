/**
 * stellar.js - what a star is, how long it lives, and how it dies.
 *
 * Pure functions, no state, no DOM, no dependency on the simulation. The
 * simulation asks these questions about a body and acts on the answers; the
 * interface asks them to colour and name things. Both get the same answer
 * because there is only one place the answer lives.
 *
 * MASS IS THE ONLY INPUT THAT MATTERS, and everything below is the real
 * relation scaled into the game's units, not a table of made-up rungs:
 *
 *   - a star ignites at 0.08 solar masses (below that, deuterium burning only:
 *     a brown dwarf), and a main-sequence star's colour, brightness and size
 *     all follow from its mass alone
 *   - luminosity climbs as M^3.5, so lifetime falls as M^-2.5: a red dwarf
 *     outlives the universe, a blue giant is gone in a moment. FEEDING A STAR
 *     SHORTENS ITS LIFE. That is the physics, and it is also the player's
 *     one real decision about a star
 *   - what a star leaves behind is decided by its mass at death: a planetary
 *     nebula and a white dwarf, a supernova and a neutron star, a supernova
 *     and a black hole, or - for the most massive - no explosion at all, the
 *     star simply going dark from the inside out
 *   - a white dwarf fed past the Chandrasekhar mass detonates and leaves
 *     nothing; a neutron star fed past its own limit collapses, quietly, into
 *     a black hole
 *
 * Unit convention. The simulation's mass ladder puts ignition at 2^64 units
 * of mass ("one dot is 1"), so one solar mass is 2^64 / 0.08. Every function
 * here takes SOLAR masses; converting from the simulation's log2 mass is the
 * job of solar() and it is the only place the unit convention appears.
 */

export const IGNITION_LOG2 = 64;          // the simulation's star threshold
export const IGNITION_SOLAR = 0.08;       // hydrogen burning begins here

/** log2 of one solar mass in the simulation's absolute units. */
export const SOLAR_LOG2 = IGNITION_LOG2 - Math.log2(IGNITION_SOLAR);

/**
 * The tunables. A host may pass an object with any of these to any function
 * that takes `P`; unspecified ones fall back to these.
 */
export const DEFAULTS = Object.freeze({
  // How long a sun-like star shines, in seconds of play, and the shortest any
  // star may live once it has ignited. The floor is what keeps a massive star
  // on screen long enough to be seen as the blue thing it is before it goes.
  sunLifeSeconds: 240,
  lifeFloorSeconds: 12,

  // The giant phase, as a share of main-sequence life, with its own floor so
  // the swelling is watchable rather than a pop.
  giantShare: 0.12,
  giantFloorSeconds: 9,

  // How much a giant swells over its main-sequence radius. Real giants swell
  // a hundredfold and supergiants a thousandfold; in a field where orbits sit
  // a few radii out, that would swallow the whole system every time, so these
  // are the visible fraction of the truth.
  giantSwell: 6,
  supergiantSwell: 11,

  // Mass at death, in solar masses, deciding what is left. Below the first
  // figure: a white dwarf. Then a neutron star. Then a black hole born in a
  // supernova. Then a black hole born without one - the star goes dark from
  // the inside out and the shell is never thrown. Then pair instability: the
  // star is destroyed entirely and leaves nothing. Above the last, direct
  // collapse again.
  fateWhiteDwarf: 8,
  fateNeutronStar: 25,
  fateBlackHole: 40,
  fatePairInstability: 130,
  fateDirectAgain: 250,

  // The two limits a remnant may be fed past.
  chandrasekhar: 1.4,
  tov: 2.3,

  // How long thrown gas must cool before it can gather into a new star, and
  // how long it lasts before it has thinned into the void if nothing does.
  gasCoolSeconds: 25,
  gasLifeSeconds: 75,

  // How long each way of dying takes, in seconds. The shell is thrown part
  // way through (see ejectionAt); the rest is the remnant settling.
  deathSeconds: Object.freeze({
    collapse: 3.6,      // direct collapse: the shadow spreads, the halo, then nothing
    supernova: 5.0,     // core collapse, the flash, the shell
    nebula: 7.0,        // the envelope lifts off slowly
    detonation: 1.8,    // a white dwarf past its limit: everything, at once
    quiet: 1.4,         // a neutron star past its limit: it winks out
  }),
});

const P_ = (P) => (P ? P : DEFAULTS);
const get = (P, k) => (P && P[k] !== undefined ? P[k] : DEFAULTS[k]);

/** Solar masses from the simulation's absolute log2 mass. */
export function solar(log2m) { return Math.pow(2, log2m - SOLAR_LOG2); }
/** The inverse. */
export function log2FromSolar(M) { return SOLAR_LOG2 + Math.log2(Math.max(M, 1e-300)); }

/**
 * A main-sequence star of mass M, in solar units: effective temperature (K),
 * luminosity (suns) and radius (suns). Piecewise power laws that reproduce
 * the real sequence to within the width of a spectral class: an M dwarf at
 * the ignition limit comes out near 2200 K, the sun at 5800, a ten solar mass
 * B star past 20000, an O star past 40000.
 */
export function mainSequence(M) {
  const m = Math.max(M, 1e-9);
  const T = m < 1 ? 5800 * Math.pow(m, 0.38) : 5800 * Math.pow(m, 0.55);
  const L = m < 0.43 ? 0.23 * Math.pow(m, 2.3) : Math.pow(m, 3.5);
  const R = m < 1 ? Math.pow(m, 0.9) : Math.pow(m, 0.8);
  return { T, L, R };
}

/** Spectral class by mass, for a readout. Brown dwarfs are below the sequence. */
export function spectralClass(M) {
  if (M < IGNITION_SOLAR) return 'brown dwarf';
  if (M < 0.45) return 'M';
  if (M < 0.8) return 'K';
  if (M < 1.04) return 'G';
  if (M < 1.4) return 'F';
  if (M < 2.1) return 'A';
  if (M < 16) return 'B';
  return 'O';
}

/** Main-sequence lifetime in seconds of play. */
export function lifeSeconds(M, P) {
  const life = get(P, 'sunLifeSeconds') * Math.pow(Math.max(M, 1e-9), -2.5);
  return Math.max(get(P, 'lifeFloorSeconds'), life);
}

/** How long the giant phase lasts, in seconds of play. */
export function giantSeconds(M, P) {
  return Math.max(get(P, 'giantFloorSeconds'), lifeSeconds(M, P) * get(P, 'giantShare'));
}

/** Is this a supergiant (massive) or a plain red giant? */
export function isSupergiant(M, P) { return M >= get(P, 'fateWhiteDwarf'); }

/** Radius multiplier of a fully swollen giant over its main-sequence radius. */
export function swell(M, P) {
  return isSupergiant(M, P) ? get(P, 'supergiantSwell') : get(P, 'giantSwell');
}

/** Surface temperature of a giant. Red, and a supergiant is redder still. */
export function giantTemperature(M, P) { return isSupergiant(M, P) ? 3400 : 3700; }

/** Luminosity of a giant relative to the sun. Bright: the same fuel, spent faster. */
export function giantLuminosity(M) {
  const ms = mainSequence(M).L;
  return Math.max(ms * 8, 60);
}

/**
 * What a star of mass M (at death) becomes.
 * @returns {'white dwarf'|'neutron star'|'black hole'|'direct collapse'|'pair instability'}
 */
export function fate(M, P) {
  if (M < get(P, 'fateWhiteDwarf')) return 'white dwarf';
  if (M < get(P, 'fateNeutronStar')) return 'neutron star';
  if (M < get(P, 'fateBlackHole')) return 'black hole';
  if (M < get(P, 'fatePairInstability')) return 'direct collapse';
  if (M < get(P, 'fateDirectAgain')) return 'pair instability';
  return 'direct collapse';
}

/** Which death sequence a fate plays out. */
export function stageFor(f) {
  switch (f) {
    case 'white dwarf': return 'nebula';
    case 'neutron star': return 'supernova';
    case 'black hole': return 'supernova';
    case 'direct collapse': return 'collapse';
    case 'pair instability': return 'detonation';
    default: return 'collapse';
  }
}

/** The kind name a fate leaves behind, or null when nothing is left. */
export function remnantKindName(f) {
  switch (f) {
    case 'white dwarf': return 'white dwarf';
    case 'neutron star': return 'neutron star';
    case 'black hole': return 'black hole';
    case 'direct collapse': return 'black hole';
    default: return null;
  }
}

/**
 * How much of a dying star survives as the remnant, in solar masses, and how
 * much is thrown back into the field. The white dwarf figure is the
 * initial-final mass relation; a neutron star sits near 1.4 and creeps up
 * with the progenitor; a supernova black hole keeps about a third; a direct
 * collapse keeps nearly everything, which is exactly why it is so quiet.
 */
export function remnant(M, f, P) {
  let keep;
  switch (f) {
    case 'white dwarf': keep = Math.min(get(P, 'chandrasekhar') - 0.05, 0.5 + 0.08 * M); break;
    case 'neutron star': keep = Math.min(get(P, 'tov') - 0.1, 1.2 + 0.03 * M); break;
    case 'black hole': keep = 0.35 * M; break;
    case 'direct collapse': keep = 0.9 * M; break;
    default: keep = 0;
  }
  keep = Math.max(0, Math.min(keep, M));
  return { keepSolar: keep, ejectSolar: M - keep, fraction: M > 0 ? keep / M : 0 };
}

/**
 * At what fraction of the death sequence the mass leaves. The supernova shell
 * goes at the bounce, a third of the way in; a planetary nebula lifts off at
 * once and takes its time; a direct collapse throws almost nothing, and what
 * little it does goes at the very end, dark, once the halo has gone.
 */
export function ejectionAt(stage) {
  switch (stage) {
    case 'supernova': return 0.32;
    case 'nebula': return 0.06;
    case 'detonation': return 0.30;
    case 'collapse': return 0.97;
    default: return 1.0;
  }
}

/** Whether the gas a death throws is shock-heated (glows) or merely shed. */
export function ejectaIsHot(stage) { return stage === 'supernova' || stage === 'detonation'; }

/** Seconds a death sequence takes. */
export function deathSeconds(stage, P) {
  const d = P && P.deathSeconds ? P.deathSeconds : DEFAULTS.deathSeconds;
  const v = d[stage];
  return v === undefined ? DEFAULTS.deathSeconds[stage] || 3 : v;
}

/**
 * Ejection speed as a multiple of the surface escape speed. A supernova shell
 * leaves at several times escape; a planetary nebula barely escapes at all.
 */
export function ejectionSpeed(stage) {
  switch (stage) {
    case 'supernova': return 3.2;
    case 'detonation': return 4.0;
    case 'nebula': return 1.25;
    case 'collapse': return 1.6;
    default: return 1.5;
  }
}

/**
 * A white dwarf is born searingly hot and does nothing but cool, for ever.
 * Age in seconds of play.
 */
export function whiteDwarfTemperature(ageSeconds) {
  return 42000 * Math.pow(1 + Math.max(0, ageSeconds) / 90, -0.4);
}

/** A neutron star: hotter than any ramp resolves. */
export const NEUTRON_STAR_TEMPERATURE = 300000;

/** A brown dwarf glows dull red from gravitational contraction and deuterium. */
export const BROWN_DWARF_TEMPERATURE = 1500;

/**
 * Gas thrown off a star cools as it expands. Age in seconds since ejection.
 * Supernova ejecta start far hotter than a nebula's shed envelope.
 */
export function gasTemperature(ageSeconds, hot) {
  const t0 = hot ? 16000 : 2600;
  return 1100 + (t0 - 1100) * Math.exp(-Math.max(0, ageSeconds) / 7);
}

/** A remnant's brightness relative to a sun-like star, for the aperture. */
export function remnantLuminosity(kindName, ageSeconds) {
  switch (kindName) {
    case 'white dwarf': return 0.55 * Math.pow(1 + Math.max(0, ageSeconds) / 90, -0.6);
    case 'neutron star': return 1.6;
    case 'black hole': return 1.0;
    default: return 0.5;
  }
}

export default {
  SOLAR_LOG2, IGNITION_LOG2, IGNITION_SOLAR, DEFAULTS,
  solar, log2FromSolar, mainSequence, spectralClass, lifeSeconds, giantSeconds,
  isSupergiant, swell, giantTemperature, giantLuminosity, fate, stageFor,
  remnantKindName, remnant, ejectionAt, deathSeconds, ejectionSpeed,
  whiteDwarfTemperature, gasTemperature, remnantLuminosity,
};
