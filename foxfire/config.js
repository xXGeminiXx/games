// ===========================================================================
// CONFIGURATION
//
// Every number worth turning and every short label lives here. The writing -
// the log, the names of things at each scale, the trait descriptions - lives
// in content.js next door, so a sentence can be rewritten without reading a
// rate and a rate can be turned without reading a sentence.
//
// Nothing in here is read more than once per load, so a change takes effect
// on refresh. Nothing in here needs a build step.
//
// HOW TO RENAME THE GAME
//   Set identity.name. That alone retitles the tab, the header and the save
//   slot. If you want the save from the old name to carry over, leave
//   identity.storagePrefix pinned to its current value instead of letting it
//   follow the name.
//
// HOW TO TRY A NUMBER WITHOUT EDITING THIS FILE
//   Append overrides to the URL, which is the fastest way to test a hosted
//   build from a phone:
//     ?set=tips.speed=1.2&set=season.yearSeconds=300
//   They last for that one page load. To make one stick in this browser, open
//   the console and run:
//     localStorage.setItem('cfg', '{"tips":{"speed":1.2}}')
//   Clear it with localStorage.removeItem('cfg'). Set dev.allowOverrides to
//   false to switch both off entirely.
// ===========================================================================

export const CONFIG = {

  // -------------------------------------------------------------------------
  // IDENTITY - what the game is called and where it keeps its things
  // -------------------------------------------------------------------------
  identity: {
    name: 'Foxfire',
    tagline: 'One spore on a dead log. Then the forest.',

    // Prefixes every browser storage key this game writes. Changing it starts
    // every player from a clean slate; keeping it preserves saves across a
    // rename.
    storagePrefix: 'foxfire',
  },

  // -------------------------------------------------------------------------
  // LABELS - the short words on the furniture. Sentences live in content.js.
  // -------------------------------------------------------------------------
  text: {
    stats: {
      sugar:    'Sugar',
      income:   'Sugar/s',
      minerals: 'Minerals/s',
      tips:     'Tips',
      area:     'Ground',
      level:    'Reach',
    },

    reach:       'Reach',
    reachTip:    'Push one thread out by hand',
    buyTip:      'Grow a tip',
    buyTipMax:   'Max',
    buyTipTip:   'A tip forages on its own for as long as the organism lives',
    extend:      'Extend',
    beyond:      'Go beyond',
    fruit:       'Fruit',
    fruitSure:   'Sure? This organism ends',
    weightMore:  '+',
    weightLess:  '-',
    harvest:     ['Keep', 'Fell mature', 'Fell all'],
    harvestTip:  'What to do with the trees of this kind: milk them, fell the grown ones, or fell everything',
    nurture:     'Feed',
    nurtureTip:  'Send sugar to this kind so it grows faster',
    export:      'Export',
    import:      'Import',
    reset:       'Start over',
    resetSure:   'Sure? Everything goes',
    bought:      'Held',

    panels: {
      tips:    'The tips',
      trees:   'The trees',
      season:  'The year',
      reach:   'Reach',
      traits:  'Traits',
      spores:  'Fruiting',
      genome:  'What the spore carries',
    },

    seasons: ['Spring', 'Summer', 'Autumn', 'Winter'],
    fieldHint: 'the floor',

    columns: {
      kind:     'Kind',
      count:    'Trees',
      size:     'Grown',
      sent:     'Sent',
      got:      'Pays',
      rate:     'Per mineral',
      weight:   'Share',
      policy:   'Policy',
    },
  },

  // -------------------------------------------------------------------------
  // WORLD - how the ground at one scale is laid out
  //
  // A level is a disc of cells. Each cell holds at most one node, jittered off
  // its lattice point; what kind of node is decided by a slow noise so kinds
  // arrive in patches (a fall of dead wood here, a stand of the same tree
  // there, a bog of bare soil between). The disc is opened ring by ring.
  // -------------------------------------------------------------------------
  world: {
    ringWidth: 2,       // cells per ring of reach
    rings: 12,          // rings in a level; the last one is the edge of the map
    density: 0.62,      // share of cells that hold a node
    jitter: 0.36,       // how far a node sits from its lattice point, in cells
    noiseScale: 5.5,    // cells per noise feature; bigger means broader patches
    // Kind thresholds on the noise value in [0,1): below soil is soil, below
    // wood is dead wood, the rest is a living tree.
    soilBelow: 0.30,
    woodBelow: 0.58,
    // The three nodes nearest the origin are always one of each kind, so the
    // first ring shows everything the game is made of.
    openingKinds: ['root', 'soil', 'wood'],
  },

  // -------------------------------------------------------------------------
  // LEVELS - the scales the organism grows through
  //
  // Going beyond a level folds everything on it into one node of the next.
  // Yields at level L are yieldFactor^L times the floor's, and so are costs,
  // so a level is the same shape as the one below it with a larger number on
  // everything - but the tips carry over, and so does everything learned.
  // -------------------------------------------------------------------------
  levels: {
    yieldFactor: 30,
    // What everything costs at level L, relative to the floor. Steeper than
    // the yield, so every level takes longer than the one before it.
    costFactor: 60,
    // The share of the previous level's income that keeps arriving from
    // below after going beyond it. Less than one, so the new ground matters.
    carry: 0.5,
    // Square metres one node of the floor stands for. Each level up, a node
    // stands for the whole disc below it.
    floorNodeArea: 1,
    // Reach rings: ring r costs base * growth^(r-1) at the floor.
    ringCostBase: 40,
    ringCostGrowth: 2.0,
    // Going beyond costs the next ring's price times this.
    beyondMult: 1.5,
    // The share of the level's nodes that must be reached before going
    // beyond is offered. Nothing forces the rest.
    beyondNeeds: 0.5,
  },

  // -------------------------------------------------------------------------
  // TIPS - the foraging front, the swarm
  // -------------------------------------------------------------------------
  tips: {
    speed: 0.55,        // cells per second
    search: 3.2,        // how far a tip looks for an unreached node, in cells
    costBase: 20,       // sugar for the first tip at the floor
    costSlope: 40,      // the n-th tip costs costBase * (1 + n / costSlope)
    costFactor: 5,      // and all of that times this per level
    // Minerals a second one tip can carry to the trees, at the floor. What
    // the soil gives beyond that leaches away, so the front is also the
    // organism's throughput and never stops mattering. Carrying scales up
    // the levels more slowly than the ground does, which is why every level
    // wants more tips than the last.
    carry: 1.5,
    carryFactor: 12,
    // Only this many tips are simulated as moving bodies; the count goes on
    // past it and the picture shows the mass.
    bodies: 2500,
    // Bulk purchase: how many at once the Max button will try for.
    maxBuy: 100000,
  },

  // -------------------------------------------------------------------------
  // THE HAND - reaching by hand before there are any tips
  // -------------------------------------------------------------------------
  hand: {
    sugar: 2,           // sugar a press yields even when nothing is reached
  },

  // -------------------------------------------------------------------------
  // DEAD WOOD - eaten for sugar, and the minerals inside it come loose
  // -------------------------------------------------------------------------
  wood: {
    stockBase: 900,     // sugar in a log at the floor
    stockSpread: 0.6,   // logs vary from (1-spread/2) to (1+spread/2) of base
    eatRate: 0.3,       // sugar per second per reached log, at the floor
    mineralsPerSugar: 0.12,
    litterFall: 0.35,   // share of stockBase every reached log regains each autumn
  },

  // -------------------------------------------------------------------------
  // SOIL - minerals for the trade
  // -------------------------------------------------------------------------
  soil: {
    rate: 0.5,          // minerals per second per reached patch, at the floor
  },

  // -------------------------------------------------------------------------
  // TREES - the market
  //
  // A reached tree trades: it takes minerals and pays sugar. For a kind with
  // trees of total size S given m minerals a second, sugar out is
  //   rate * S * (1 - exp(-m / (need * S)))
  // so the first mineral fetches rate/need sugar and every one after fetches
  // less. Which kind to send the next mineral to is the whole market.
  //
  // The roster is ordered by value; each level takes perLevel kinds starting
  // at level * perLevel, and past the end of the roster the names repeat with
  // an age in front of them.
  // -------------------------------------------------------------------------
  trees: {
    perLevel: 3,
    roster: [
      // name        rate  need  growth   max   wood   weight
      { name: 'birch',    rate: 0.55, need: 0.40, growth: 0.0045, max: 3.5, wood: 90,  weight: 5 },
      { name: 'alder',    rate: 0.75, need: 0.55, growth: 0.0040, max: 4.0, wood: 100, weight: 4 },
      { name: 'pine',     rate: 1.10, need: 0.50, growth: 0.0028, max: 7.0, wood: 130, weight: 3 },
      { name: 'aspen',    rate: 0.90, need: 0.45, growth: 0.0050, max: 4.5, wood: 95,  weight: 5 },
      { name: 'spruce',   rate: 1.30, need: 0.60, growth: 0.0026, max: 8.0, wood: 150, weight: 4 },
      { name: 'maple',    rate: 1.60, need: 0.90, growth: 0.0030, max: 6.5, wood: 170, weight: 3 },
      { name: 'beech',    rate: 1.50, need: 0.70, growth: 0.0022, max: 9.0, wood: 190, weight: 4 },
      { name: 'oak',      rate: 2.00, need: 1.00, growth: 0.0018, max: 12.0, wood: 240, weight: 3 },
      { name: 'fir',      rate: 1.80, need: 0.75, growth: 0.0024, max: 11.0, wood: 200, weight: 4 },
      { name: 'hemlock',  rate: 2.10, need: 0.80, growth: 0.0020, max: 13.0, wood: 230, weight: 4 },
      { name: 'cedar',    rate: 2.60, need: 1.20, growth: 0.0016, max: 15.0, wood: 300, weight: 3 },
      { name: 'redwood',  rate: 3.40, need: 1.40, growth: 0.0012, max: 24.0, wood: 420, weight: 2 },
    ],
    ages: ['old', 'ancient', 'elder', 'primeval', 'first'],
    // A tree begins between these shares of its full size.
    startSize: [0.08, 0.9],
    // A tree counts as grown at this share of its full size.
    mature: 0.8,
    // Felling: a tree drained by parasitism loses health at this rate and pays
    // this many times its trade rate while it goes, without wanting minerals.
    fell: { seconds: 90, yield: 2.5 },
    // A felled tree becomes dead wood worth size * wood, and once that has
    // been eaten a seedling comes up in its place.
    regrowSeconds: 240,
    // Feeding: sugar sent per second per unit of size, and the growth it buys.
    nurture: { sugarPerSize: 0.12, boost: 2.0 },
    // A weight is 0..this; the trade splits minerals by weight.
    weightMax: 5,
    weightNew: 1,
  },

  // -------------------------------------------------------------------------
  // THE YEAR - seasons change what things pay
  // -------------------------------------------------------------------------
  season: {
    yearSeconds: 960,   // a whole year; four equal seasons
    // Per season, in the order spring, summer, autumn, winter.
    trade:  [1.5, 1.0, 0.7, 0.25],
    // What winter pays instead once the trade is evergreen.
    evergreenWinter: 0.6,
    growth: [1.3, 1.0, 0.4, 0.0],
    tips:   [1.0, 1.0, 1.0, 0.5],
    litter: [0, 0, 1, 0],
  },

  // -------------------------------------------------------------------------
  // TRAITS - what sugar buys besides tips and ground
  //
  // cost is for the first level; each level after costs growth times more.
  // Levels stop at cap. Every effect is read in one place, traits.modsOf.
  // -------------------------------------------------------------------------
  traits: [
    { id: 'lignin',     cost: 300,   growth: 3.5, cap: 3,  effect: { eat: 0.5 } },
    { id: 'cables',     cost: 450,   growth: 3.5, cap: 6,  effect: { speed: 0.3 } },
    { id: 'branching',  cost: 750,   growth: 3.5, cap: 5,  effect: { tipCost: -0.12 } },
    { id: 'reach',      cost: 1000,  growth: 3.5, cap: 4,  effect: { search: 1.0 } },
    { id: 'symbiosis',  cost: 1300,  growth: 3.5, cap: 6,  effect: { trade: 0.25 } },
    { id: 'parasitism', cost: 2500,  growth: 1,   cap: 1,  effect: { fell: 1 } },
    { id: 'transfer',   cost: 3500,  growth: 1,   cap: 1,  effect: { nurture: 1 } },
    { id: 'rot',        cost: 4500,  growth: 3.5, cap: 5,  effect: { felledWood: 0.3 } },
    { id: 'frost',      cost: 6000,  growth: 1,   cap: 1,  effect: { frost: 1 } },
    { id: 'reserve',    cost: 7500,  growth: 3.0, cap: 6,  effect: { awayHours: 4 } },
    { id: 'evergreen',  cost: 20000, growth: 1,   cap: 1,  effect: { evergreen: 1 } },
  ],

  // -------------------------------------------------------------------------
  // FRUITING - the rebirth
  //
  // Past the given reach the organism can fruit: it throws up mushrooms,
  // releases spores and ends. What the spore carries is bought with spores
  // and holds in every organism after.
  // -------------------------------------------------------------------------
  spores: {
    fromLevel: 2,
    // Spores for an organism: perLevel * (level^2) + perLog * log10(area m2).
    perLevel: 3,
    perLog: 1,
    genome: [
      { id: 'headstart', cost: 2, growth: 1.5, cap: 8,  effect: { startTips: 4 } },
      { id: 'quick',     cost: 3, growth: 1.6, cap: 10, effect: { speed: 0.15 } },
      { id: 'enzymes',   cost: 3, growth: 1.6, cap: 10, effect: { yield: 0.15 } },
      { id: 'memory',    cost: 4, growth: 1.7, cap: 6,  effect: { traitCost: -0.1 } },
      { id: 'patience',  cost: 4, growth: 1.7, cap: 5,  effect: { awayHours: 8 } },
    ],
  },

  // -------------------------------------------------------------------------
  // TIME
  // -------------------------------------------------------------------------
  time: {
    tick: 0.1,              // simulation step while the tab is open, seconds
    catchUpAfter: 4,        // a gap longer than this is time away
    awayChunk: 5,           // seconds per step while catching up
    awayHours: 8,           // hours of time away that count, before traits
    autosaveSeconds: 12,
  },

  // -------------------------------------------------------------------------
  // VIEW - the one picture
  // -------------------------------------------------------------------------
  view: {
    margin: 1.18,           // the camera fits the reach times this
    ease: 2.2,              // camera easing per second
    tipsDrawn: 3000,        // at most this many tips are drawn; the count is shown
    threadWidth: 1.0,
    nodeRadius: 0.16,       // in cells
    treeRadius: 0.30,       // in cells, at full size
    tipRadius: 0.09,
    glow: 0.55,
    // Below this many screen pixels per cell the picture switches to mass:
    // the glow around each node is dropped and unreached nodes become points.
    massBelow: 4.0,
    // A wash over the ground per season, in the order spring, summer, autumn,
    // winter, and how strong it is. The season is always readable from the
    // picture, not only from the panel.
    tint: ['#14301c', '#000000', '#3a2410', '#0c1a2e'],
    tintAlpha: 0.22,
  },

  // -------------------------------------------------------------------------
  // PALETTE
  // -------------------------------------------------------------------------
  palette: {
    void:    '#07090a',
    panel:   '#0c1011',
    rule:    '#1a2220',
    ink:     '#d5dcd7',
    dim:     '#6a7873',
    quiet:   '#414d49',
    sugar:   '#d9b35a',
    mineral: '#7fa6c4',
    glow:    '#7ff2b0',   // foxfire
    thread:  '#3f9d72',
    tip:     '#c9ffe0',
    hot:     '#c8553d',
    good:    '#7fd39a',
    wood:    '#6b5340',
    soil:    '#2e3a38',
    tree:    '#3a7d4a',
    dead:    '#55534c',
    ground:  '#0a0d0d',
  },

  // -------------------------------------------------------------------------
  // DEV
  // -------------------------------------------------------------------------
  dev: {
    allowOverrides: true,
    // Bump when src/ changes so a browser cannot pair a stale module with a
    // fresh page. Every import in index.html and src/ carries ?v=<this>.
    build: 2,
  },
};


// ---------------------------------------------------------------------------
// OVERRIDES
//
// Two ways to change a value without touching this file: a JSON patch in
// localStorage under 'cfg', and ?set=path=value pairs on the URL. Both are
// applied once, here, before anything reads CONFIG. The type of a value is
// taken from what is already in place, so a number stays a number.
// ---------------------------------------------------------------------------

function mergeDeep(target, patch) {
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) &&
        target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      mergeDeep(target[k], v);
    } else if (k in target) {
      target[k] = coerce(target[k], v);
    }
  }
}

function coerce(existing, value) {
  if (typeof existing === 'number') {
    const n = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(n) ? n : existing;
  }
  if (typeof existing === 'boolean') {
    if (typeof value === 'boolean') return value;
    const s = String(value).toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }
  if (Array.isArray(existing)) {
    if (Array.isArray(value)) return value;
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed; } catch (e) { /* keep */ }
    return existing;
  }
  return String(value);
}

function assignPath(root, path, value) {
  const parts = path.split('.');
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    node = node ? node[parts[i]] : undefined;
    if (!node || typeof node !== 'object') return false;
  }
  const last = parts[parts.length - 1];
  if (!(last in node)) return false;
  node[last] = coerce(node[last], value);
  return true;
}

/** Which overrides took effect, for the console. */
export const appliedOverrides = [];

(function applyOverrides() {
  if (!CONFIG.dev.allowOverrides) return;
  if (typeof window === 'undefined') return;

  try {
    const raw = localStorage.getItem('cfg');
    if (raw) {
      const patch = JSON.parse(raw);
      if (patch && typeof patch === 'object') {
        mergeDeep(CONFIG, patch);
        appliedOverrides.push('storage:cfg');
      }
    }
  } catch (e) { /* a malformed override must never stop the game loading */ }

  try {
    const params = new URLSearchParams(location.search);
    for (const entry of params.getAll('set')) {
      const eq = entry.indexOf('=');
      if (eq < 1) continue;
      const path = entry.slice(0, eq).trim();
      const value = entry.slice(eq + 1);
      if (assignPath(CONFIG, path, value)) appliedOverrides.push(path + '=' + value);
    }
  } catch (e) { /* same */ }
})();


// ---------------------------------------------------------------------------
// DERIVED
// ---------------------------------------------------------------------------

/** Namespaced browser storage key. */
export const storageKey = (slot) => CONFIG.identity.storagePrefix + '.' + slot;

/**
 * Fill {name}-style holes in a line of text.
 *
 * A hole written with a capital - {Name} - is filled with the same value and
 * then capitalised, which is how a sentence can begin with a word the game
 * supplies rather than one the writer typed.
 */
export function fill(line, values) {
  return String(line).replace(/\{(\w+)\}/g, (m, k) => {
    if (!values) return m;
    if (k in values) return String(values[k]);
    const lower = k.charAt(0).toLowerCase() + k.slice(1);
    if (k !== lower && lower in values) {
      const v = String(values[lower]);
      return v.charAt(0).toUpperCase() + v.slice(1);
    }
    return m;
  });
}


// ---------------------------------------------------------------------------
// APPLYING IDENTITY TO THE PAGE
//
// The document carries the game's name and colours in a few places. This puts
// them all there from the one source, so the markup never repeats a value that
// lives above. Every surface touched is optional: the headless test harness
// supplies just enough of a document to run the game and no more.
// ---------------------------------------------------------------------------

export function applyIdentity(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d) return;

  try { d.title = CONFIG.identity.name; } catch (e) { /* stub */ }

  const root = d.documentElement;
  const p = CONFIG.palette;
  const setVar = (name, value) => {
    if (root && root.style && typeof root.style.setProperty === 'function') {
      root.style.setProperty(name, value);
    }
  };
  setVar('--void',    p.void);
  setVar('--panel',   p.panel);
  setVar('--rule',    p.rule);
  setVar('--ink',     p.ink);
  setVar('--dim',     p.dim);
  setVar('--quiet',   p.quiet);
  setVar('--sugar',   p.sugar);
  setVar('--mineral', p.mineral);
  setVar('--glow',    p.glow);
  setVar('--hot',     p.hot);
  setVar('--good',    p.good);

  const byId = (id) => (typeof d.getElementById === 'function' ? d.getElementById(id) : null);
  const put = (id, value) => { const el = byId(id); if (el) el.textContent = value; };
  const t = CONFIG.text;
  put('title',        CONFIG.identity.name);
  put('tagline',      CONFIG.identity.tagline);
  put('lbl-sugar',    t.stats.sugar);
  put('lbl-income',   t.stats.income);
  put('lbl-minerals', t.stats.minerals);
  put('lbl-tips',     t.stats.tips);
  put('lbl-area',     t.stats.area);
  put('lbl-level',    t.stats.level);
  put('reach',        t.reach);
  put('export',       t.export);
  put('import',       t.import);
  put('reset',        t.reset);
  put('p-tips',       t.panels.tips);
  put('p-trees',      t.panels.trees);
  put('p-season',     t.panels.season);
  put('p-reach',      t.panels.reach);
  put('p-traits',     t.panels.traits);
  put('p-spores',     t.panels.spores);
  put('p-genome',     t.panels.genome);
  put('fieldhint',    t.fieldHint);

  // The tab icon is drawn from the palette rather than shipped as a file, so a
  // recolour needs no asset and the game still has no binary dependencies.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" fill="' + p.void + '"/>' +
    '<path d="M16 16 L7 9 M16 16 L25 8 M16 16 L9 25 M16 16 L26 22 M7 9 L4 4 M25 8 L29 3" ' +
    'stroke="' + p.thread + '" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
    '<circle cx="16" cy="16" r="3" fill="' + p.glow + '"/>' +
    '<circle cx="7" cy="9" r="1.4" fill="' + p.glow + '"/>' +
    '<circle cx="25" cy="8" r="1.4" fill="' + p.glow + '"/>' +
    '<circle cx="9" cy="25" r="1.4" fill="' + p.glow + '"/>' +
    '<circle cx="26" cy="22" r="1.4" fill="' + p.glow + '"/>' +
    '</svg>';
  if (typeof d.querySelector === 'function' && typeof d.createElement === 'function') {
    let link = d.querySelector('link[rel="icon"]');
    if (!link || String(link.tagName).toUpperCase() !== 'LINK') {
      link = d.createElement('link');
      link.rel = 'icon';
      if (d.head && typeof d.head.appendChild === 'function') d.head.appendChild(link);
    }
    link.type = 'image/svg+xml';
    link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
}
