// ---------------------------------------------------------------------------
// Aerie - every name, number and colour in one place.
//
// Nothing in src/ owns a constant; it reads this file. Change a value here
// and the game changes. To try a value on a hosted build without a push:
//   ?set=economy.hireBase=20&set=drones.speed=30      one page load
//   localStorage.setItem('cfg', '{"drones":{"speed":30}}')   sticks in that browser
// Type is taken from the value already in place, so a number stays a number.
// ---------------------------------------------------------------------------
import { oklch } from './src/palette.js?v=20';

export const CONFIG = {
  identity: {
    name: 'Aerie',
    tagline: 'A carrier over cold water. Your drones work the land.',
    storageKey: 'aerie',
  },

  dev: {
    build: 20,             // the ?v= tag every import carries; bump on every src change
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
    ore:    { name: 'ore',    where: 'rocky slopes and cliffs', basePrice: 9,  rate: 0.42 },
    timber: { name: 'timber', where: 'the pine lowlands',     basePrice: 5,  rate: 0.7 },
    fish:   { name: 'fish',   where: 'the shallows',          basePrice: 6,  rate: 0.6 },
    ice:    { name: 'ice',    where: 'above the snowline',    basePrice: 16, rate: 0.28 },
  },
  kindOrder: ['timber', 'fish', 'ore', 'ice'],

  // How many a purchase buys at once. `0` is the max the funds allow, worked
  // out from the price series rather than by trying one at a time.
  bulk: { steps: [1, 10, 100, 1000, 10000, 0], start: 1 },

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
    // The carrier looks after itself. The ground it hangs over runs down as
    // the fleet works it, and a player who never thought to move the carrier
    // simply watched their income fall - 12 hours into a real save the best
    // trade under it was down to 27 percent of what the land holds. So it
    // finds better ground on its own. Clicking or flying still wins outright
    // and stops it choosing for a while, so anyone who wants the wheel has it.
    drift: {
      on: true,
      below: 0.35,        // best availability that starts it looking
      better: 1.4,        // how much richer the new ground has to be to bother
      afterHand: 45,      // seconds to leave the carrier alone after a player moves it
      every: 8,           // seconds between looks
      arrived: 5,         // how near its chosen spot counts as having got there
    },
  },

  economy: {
    startFunds: 40,
    // hiring one drone; cost grows by hireGrowth per drone owned
    hireBase: 12,
    hireGrowth: 1.085,
    // a wing is ten drones at a discount, unlocked later
    // Enough hangar levels make each drone cheaper than the last, so `max`
    // would otherwise ask for an unbounded number. This is that bound.
    hireMaxAtOnce: 100000,
    // A fleet larger than this in an old save was bought under a price that
    // fell as it grew, and is brought back to what the funds could reach.
    hireSaneFleet: 400,
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
      hold:    { name: 'bigger loads',  base: 90,  growth: 2.1, effect: 0.35, max: 30, does: 'each level: +35% to everything the drones bring back' },
      range:   { name: 'longer reach',  base: 140, growth: 2.3, effect: 12,   max: 12, does: 'each level: +12 to how far from the carrier the drones will work' },
      engines: { name: 'faster drones', base: 120, growth: 2.2, effect: 0.18, max: 20, does: 'each level: +18% drone speed, so every trip is quicker' },
      hangars: { name: 'cheaper drones', base: 260, growth: 2.6, effect: 1,   max: 12, does: 'each level: every new drone costs less than it would have. the first level also lets you hire ten at once, at a discount' },
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

  // The compass line: when each piece of advice applies. These are the
  // thresholds behind the one sentence at the corner of the picture.
  // Measured on a live run: a fresh anchor reads 0.49 to 0.96 per kind and a
  // trade with none of its ground in reach reads 0.01, so a best-of-the-four
  // under 0.3 means the carrier is sitting on worked ground.
  advice: {
    thinLand: 0.3,        // best availability below this: the ground is worked down
    dryLand: 0.03,        // a trade with this little left has nothing for its specialists
    emptyIsland: 0.2,     // below this remaining, moving the carrier will not help
    floodedDemand: 0.55,  // the biggest earner's price below this fraction of base
    healthyDemand: 0.85,  // another trade above this is worth moving effort to
    smallShare: 0.25,     // while saving for a voyage, only name a buy this small
    hangarWorth: 1.0,     // name hangars when they cost no more than this many drones
    every: 1,             // seconds between recalculations
    words: { drone: 'another drone', specialist: 'a specialist', voyage: 'leaving for the next island', instant: 'under a second', never: 'never' },
  },

  camera: {
    distance: 95,
    yaw: 0.7,
    pitch: 0.36,
    fov: 48,
    idleOrbit: 0.035,     // radians per second when nobody is dragging
    idleAfter: 5,
  },

  // The picture's resolution, and the only real dial in the game's cost. The
  // island is raymarched into an offscreen buffer at `scale` of the canvas
  // and stretched back to fill it, and the canvas is sized at the display's
  // pixel ratio capped by `maxDpr`. Both multiply the pixels marched, and the
  // frame cost tracks that count very nearly one for one: quadrupling the
  // pixels has measured about 2.7x the frame on a desktop GPU and 3.2x in
  // software rendering, which is close enough that the ratio can be trusted.
  //
  // There is no single right default, because the same setting that leaves a
  // good GPU idle will halve the frame rate on the next machine. So the
  // shipped setting is `auto`: the game measures its own frames and settles
  // on the sharpest picture that still holds the budget. A player who picks a
  // setting instead is never overruled, and the choice is remembered.
  render: {
    scale: 0.7,           // raymarch resolution as a fraction of the canvas
    maxDpr: 1.5,          // CEILING on the drawing buffer's pixel ratio. It is
                          // only a cap: on a display reporting less than this
                          // - browser zoom easily puts it under 1 - raising it
                          // changes nothing. It is not a sharpness dial.
    // A FLOOR on the same ratio, and it is deliberately off. Browser zoom
    // below 100% reports a ratio under 1, which looks like the game is
    // rendering below native - but that ratio is the number of real display
    // pixels per page pixel, so matching it IS native. Forcing the buffer up
    // to 1.0 there would not recover any detail the display can show; it
    // would march about half again as many rays for a slightly smoother edge,
    // on machines already measured at 20 to 30 frames a second. Raise it only
    // if antialiasing is wanted and the frames are there to pay for it.
    minDpr: 0,            // floor on the drawing buffer's pixel ratio
    quality: 'auto',      // the preset a new player starts on
    presets: {
      // Opens at the top and comes down only if the machine cannot hold it,
      // rather than opening in the middle and working up. A player's first
      // sight of the island should be the best one their machine can draw;
      // finding that out by degrading is kinder than by improving, because
      // nobody sees the picture they never got.
      auto:   { name: 'auto',   scale: 1.0,  dpr: 1.5, adapt: true,  hint: 'starts at the sharpest picture and eases off only if your machine can\'t keep up' },
      low:    { name: 'low',    scale: 0.5,  dpr: 1.0, adapt: false, hint: 'a quarter of the pixels, for a slow machine' },
      normal: { name: 'normal', scale: 0.7,  dpr: 1.5, adapt: false, hint: 'a good picture on most machines, at about half the cost of high' },
      high:   { name: 'high',   scale: 1.0,  dpr: 1.5, adapt: false, hint: 'the whole picture drawn at full resolution' },
      // The stored name stays `extra` so a remembered choice survives; only
      // what the button says has changed.
      extra:  { name: 'ultra',  scale: 1.0,  dpr: 2.0, adapt: false, hint: 'drawn at twice the pixels and shrunk back down, which softens hard edges. the slowest setting here, and it does nothing on a low-resolution display' },
    },
    presetOrder: ['auto', 'low', 'normal', 'high', 'extra'],

    // WHAT THE PICTURE IS BEING TRADED AGAINST. The guard spends spare frame
    // time on resolution and stops at the target; raise the target and it
    // spends less, lower it and it spends more. `0` means never stop spending,
    // which on a display that caps at its own refresh means the sharpest
    // picture the machine can draw. This is the player's trade to make, so it
    // is a setting rather than a number in this file.
    targets: [30, 60, 120, 0],
    target: 60,
    showRate: true,       // the frame rate beside the quality buttons
    resizeDelay: 0.25,    // seconds a new window size must hold before the
                          // picture's buffer is rebuilt for it
  },

  // The automatic quality guard.
  //
  // The budget is 60 frames a second, not as many as the display will take.
  // Nothing here is played on reflex: the camera drifts, the carrier glides,
  // and the drones are a stream rather than a thing you aim at. Past 60 the
  // extra frames buy nothing a player can see, while the same time spent on
  // resolution buys a sharper island every second they look at it. So the
  // guard spends headroom on pixels and stops at 60.
  //
  // Two measures, because one is not enough. `budgetMs` is what a frame
  // should usually take; `stutterMs` is how slow the worst twentieth of
  // frames is allowed to get before the picture is called rough. A run
  // measured at a median of 30 a second and a worst twentieth of 12 is not
  // smooth, and a guard watching only the median would have called it fine.
  adapt: {
    rungs: [0.4, 0.55, 0.7, 0.85, 1.0],
    // Derived from the chosen target rather than fixed: a frame should
    // usually fit the target, and the worst twentieth is allowed twice that
    // before the picture is called rough. An uncapped target has no budget to
    // miss, so the guard only ever climbs.
    budgetMs: 16.7,       // the default target, 60 a second; recomputed on change
    stutterMs: 33,        // and no worse than half the target in the roughest twentieth
    upMargin: 0.86,       // a predicted frame must fit this far inside both
    window: 45,           // frames in the rolling measurement
    minSamples: 24,       // enough to judge by; a slow machine would take many
                          // seconds to fill the whole window, and waiting that
                          // long to notice trouble is itself the trouble
    downAfter: 2.5,       // seconds of trouble before stepping down
    upAfter: 5,           // seconds of headroom before stepping up
    settle: 2,            // seconds ignored after any change of resolution
    // Nothing is measured for the first several seconds. A GPU that has been
    // idle runs at a low clock and takes seconds to boost; the same page has
    // been measured reporting 24, 45, 68 and 92 frames a second over four
    // consecutive samples with nothing changed between them. Acting on the
    // first of those would cost the player the whole run.
    start: 7,             // seconds ignored at the start, while things warm
    logEvery: 20,         // seconds between entries in the local performance log
  },

  // Every key the page listens to, in one table. A key named here does that
  // one thing and nothing else. Keys match lower-case, and are ignored while a
  // text box has focus or ctrl / alt / meta is held, so the browser's own
  // shortcuts still work.
  keys: {
    // flying the carrier, relative to the view: forward is always away from
    // the camera, whichever way it has been turned
    forward: ['w', 'arrowup'],
    back: ['s', 'arrowdown'],
    left: ['a', 'arrowleft'],
    right: ['d', 'arrowright'],
    // turning and framing
    orbitLeft: ['q'],
    orbitRight: ['e'],
    pitchUp: ['r'],
    pitchDown: ['f'],
    zoomIn: ['=', '+'],
    zoomOut: ['-', '_'],
    recentre: ['c'],
    // the ledger
    hire: ['h'],
    wing: ['g'],
    upgrade1: ['1'], upgrade2: ['2'], upgrade3: ['3'], upgrade4: ['4'],
    // the page
    panel: ['p'],
    help: ['?', '/'],
    close: ['escape'],
  },

  // How fast the keyboard flies the carrier and moves the camera.
  controls: {
    flySpeed: 52,         // world units per second the anchor is pushed
    orbitSpeed: 1.5,      // radians per second on the orbit keys
    pitchSpeed: 1.0,      // radians per second on the pitch keys
    zoomSpeed: 1.7,       // e-folds of camera distance per second
    minPitch: -0.2,
    maxPitch: 1.35,
    minDistance: 26,
    maxDistance: 340,
  },

  // The look: a cold northern morning with the fog burning off. Slate water,
  // chalk cliffs, pine and grey-green land, black scree, a low white sun in
  // haze. The carrier is bone; the drones are signal orange.
  palette: {
    ground: oklch(0.86, 0.012, 230),   // the page behind everything
    glass: oklch(0.95, 0.008, 230),
    ink: oklch(0.22, 0.02, 250),
    // The cards are glass over the world, so the paper under a dim string is
    // whatever the island is doing behind it. Measured on a real frame at
    // 0.5: 4.4 to 4.9 to one against the sky, and worse over water and scree.
    // 0.45 holds above 4.5 wherever the panel sits.
    dim: oklch(0.45, 0.02, 250),
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
    hullTrim: oklch(0.62, 0.025, 82),   // frames, stringers and panel seams
    glazing: oklch(0.36, 0.012, 245),   // bridge and gallery glass, seen dark
    lit: oklch(0.7, 0.15, 50),          // what is lit from inside
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
  if (!doc.getElementById) return;
  const brand = doc.getElementById('brand');
  if (brand) brand.textContent = cfg.identity.name;
  const tagline = doc.getElementById('tagline');
  if (tagline) tagline.textContent = cfg.identity.tagline;
}

export default CONFIG;
