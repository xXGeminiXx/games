// ---------------------------------------------------------------------------
// Aerie - every name, number and colour in one place.
//
// Nothing in src/ owns a constant; it reads this file. Change a value here
// and the game changes. To try a value on a hosted build without a push:
//   ?set=economy.hireBase=20&set=drones.speed=30      one page load
//   localStorage.setItem('cfg', '{"drones":{"speed":30}}')   sticks in that browser
// Type is taken from the value already in place, so a number stays a number.
// ---------------------------------------------------------------------------
import { oklch } from './src/palette.js?v=1';

export const CONFIG = {
  identity: {
    name: 'Aerie',
    tagline: 'A carrier over cold water. Your drones work the land.',
    storageKey: 'aerie',
  },

  dev: {
    build: 1,             // the ?v= tag every import carries; bump on every src change
    allowOverrides: true, // ?set= and the localStorage cfg patch
  },

  // The island. Distances in world units; the raymarcher and the CPU agree.
  world: {
    size: 420,            // width of the world
    field: 1024,          // texels across the height and richness textures
    height: 52,           // tallest peak above zero
    sea: 11,              // water level
    snowLine: 0.7,        // fraction of height where ice begins
    seed: 'north-1',      // the first island; later islands derive from it
  },

  // The four things the land holds. Suitability is decided on the GPU from
  // height, slope and moisture; these are the economy's numbers.
  kinds: {
    ore:    { name: 'ore',    where: 'scree and cliff faces', basePrice: 9,  rate: 0.42 },
    timber: { name: 'timber', where: 'the pine lowlands',     basePrice: 5,  rate: 0.7 },
    fish:   { name: 'fish',   where: 'the shallows',          basePrice: 6,  rate: 0.6 },
    ice:    { name: 'ice',    where: 'above the snowline',    basePrice: 16, rate: 0.28 },
  },
  kindOrder: ['timber', 'fish', 'ore', 'ice'],

  drones: {
    start: 3,             // drones on a new save
    visibleCap: 65536,    // bodies drawn (a 256x256 texture); the count can go far past this
    speed: 22,            // cruise speed, units per second
    gatherTime: 2.2,      // seconds hovering over a cell
    dockTime: 0.35,       // seconds inside the carrier between trips
    cruise: 7,            // height above ground on the way out
    hover: 1.8,           // height above ground while gathering
    candidates: 5,        // cells sampled when choosing where to go
    minRich: 0.06,        // a cell poorer than this is not worth the trip
    size: 1.25,           // body size in world units
  },

  carrier: {
    hover: 34,            // height above the ground it hangs over
    range: 70,            // radius of land the drones will work
    speed: 9,             // how fast it glides to a new anchor
    scale: 1.0,           // hull size; hull upgrades grow it
  },

  economy: {
    startFunds: 40,
    // hiring one drone; cost grows by hireGrowth per drone owned
    hireBase: 12,
    hireGrowth: 1.085,
    // a wing is ten drones at a discount, unlocked later
    wingSize: 10,
    wingDiscount: 0.82,
    // specialists gather their kind at specialistMult and nothing else
    specialistMult: 2.6,
    specialistCost: 1.6,  // times the current hire cost
    // prices fall as you sell: pressure builds with volume and decays
    priceSensitivity: 0.0022,
    priceRecovery: 0.045,
    priceFloor: 0.22,     // fraction of base a price cannot fall below
    // carrier upgrades: [cost, growth, effect per level]
    upgrades: {
      hold:    { name: 'hold',    base: 90,  growth: 2.1, effect: 0.35, max: 30, does: 'each level +35% yield' },
      range:   { name: 'range',   base: 140, growth: 2.3, effect: 12,   max: 12, does: 'each level +12 range' },
      engines: { name: 'engines', base: 120, growth: 2.2, effect: 0.18, max: 20, does: 'each level +18% drone speed' },
      hangars: { name: 'hangars', base: 260, growth: 2.6, effect: 1,    max: 12, does: 'each level unlocks a wing per hire and cheaper hires' },
    },
    hangarDiscount: 0.94, // hire growth multiplier per hangar level (compounding)
    // casting off to the next island
    castOffBase: 8000,
    castOffGrowth: 3.2,
    islandRichness: 1.55, // richness multiplier per island
    islandPrice: 1.25,    // base price multiplier per island
    // the land: how fast drones strip it and how fast it comes back
    take: 0.06,           // richness removed per drone-gather-second
    regrow: 0.0035,       // fraction of the gap to full regrown per second
    // offline
    offlineCap: 8 * 3600,
    offlineStep: 5,
  },

  // When things appear. Never dump: each panel arrives when it is relevant.
  reveal: {
    holdAtDrones: 5,
    specialistsAtDrones: 12,
    carrierAtFunds: 90,
    voyageAtDepletion: 0.45,  // island richness fraction remaining
    voyageAtFunds: 900,
    wingsAtHangars: 1,
  },

  camera: {
    distance: 95,
    yaw: 0.7,
    pitch: 0.36,
    fov: 48,
    idleOrbit: 0.035,     // radians per second when nobody is dragging
    idleAfter: 5,
  },

  render: {
    scale: 0.5,           // raymarch resolution as a fraction of the canvas
    maxDpr: 1.5,
  },

  // The look: a cold northern morning with the fog burning off. Slate water,
  // chalk cliffs, pine and grey-green land, black scree, a low white sun in
  // haze. The carrier is bone; the drones are signal orange.
  palette: {
    ground: oklch(0.86, 0.012, 230),   // the page behind everything
    glass: oklch(0.95, 0.008, 230),
    ink: oklch(0.22, 0.02, 250),
    dim: oklch(0.5, 0.02, 250),
    rule: oklch(0.8, 0.015, 240),
    accent: oklch(0.66, 0.19, 45),     // signal orange
    good: oklch(0.55, 0.11, 150),
    bad: oklch(0.55, 0.16, 25),
    // the world
    sea: oklch(0.42, 0.06, 240),
    seaShallow: oklch(0.58, 0.08, 215),
    foam: oklch(0.9, 0.02, 220),
    sand: oklch(0.8, 0.04, 85),
    chalk: oklch(0.78, 0.025, 85),
    rock: oklch(0.44, 0.02, 250),
    scree: oklch(0.3, 0.015, 260),
    scrub: oklch(0.56, 0.06, 118),
    pine: oklch(0.36, 0.07, 150),
    stump: oklch(0.62, 0.035, 105),
    snow: oklch(0.95, 0.01, 240),
    bareIce: oklch(0.7, 0.02, 245),
    zenith: oklch(0.72, 0.05, 240),
    horizon: oklch(0.9, 0.02, 230),
    sun: oklch(0.98, 0.03, 90),
    fog: oklch(0.88, 0.02, 235),
    hull: oklch(0.82, 0.02, 85),
    hullDark: oklch(0.4, 0.02, 80),
    drone: oklch(0.7, 0.19, 45),
    droneLoaded: oklch(0.55, 0.14, 35),
  },
};

// Apply ?set= and the storage patch. Values keep the type of what they replace.
export function withOverrides(cfg, search, storage) {
  if (!cfg.dev.allowOverrides) return cfg;
  const setPath = (obj, path, raw) => {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) { if (!(keys[i] in o)) return; o = o[keys[i]]; }
    const k = keys[keys.length - 1];
    if (!(k in o)) return;
    const cur = o[k];
    if (typeof cur === 'number') { const n = Number(raw); if (Number.isFinite(n)) o[k] = n; }
    else if (typeof cur === 'boolean') o[k] = raw === 'true' || raw === '1';
    else if (typeof cur === 'string') o[k] = String(raw);
  };
  const merge = (dst, src) => {
    for (const k in src) {
      if (src[k] && typeof src[k] === 'object' && dst[k] && typeof dst[k] === 'object') merge(dst[k], src[k]);
      else if (k in dst) setPath(dst, k, src[k]);
    }
  };
  try {
    const patch = storage && storage.getItem('cfg');
    if (patch) merge(cfg, JSON.parse(patch));
  } catch (e) { /* a bad patch is ignored */ }
  if (search) {
    const q = new URLSearchParams(search);
    for (const v of q.getAll('set')) {
      const i = v.indexOf('=');
      if (i > 0) setPath(cfg, v.slice(0, i), v.slice(i + 1));
    }
  }
  return cfg;
}

// The page's custom properties and title come from here.
export function applyIdentity(cfg, doc) {
  if (!doc) return;
  if (doc.title !== undefined) doc.title = cfg.identity.name;
  const root = doc.documentElement;
  if (root && root.style && root.style.setProperty) {
    for (const [k, v] of Object.entries(cfg.palette)) root.style.setProperty('--' + k, v);
  }
  const brand = doc.getElementById && doc.getElementById('brand');
  if (brand) brand.textContent = cfg.identity.name;
}

export default CONFIG;
