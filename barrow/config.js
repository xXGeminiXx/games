// ===========================================================================
// CONFIGURATION
//
// Every name, every line of text and every number worth turning lives in this
// file and nowhere else. Change something here and the whole game follows: the
// browser tab, the header, the prices, the pace, the colours, the save slot.
//
// Nothing in here is read more than once per load, so a change takes effect on
// refresh. Nothing in here needs a build step.
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
//     ?set=horde.digRate=2&set=market.recoverySeconds=30
//   They last for that one page load. To make one stick in this browser, open
//   the console and run:
//     localStorage.setItem('cfg', '{"horde":{"digRate":2}}')
//   Clear it with localStorage.removeItem('cfg'). Set dev.allowOverrides to
//   false to switch both off entirely.
// ===========================================================================

export const CONFIG = {

  // -------------------------------------------------------------------------
  // IDENTITY - what the game is called and where it keeps its things
  // -------------------------------------------------------------------------
  identity: {
    name: 'Barrow',
    tagline: 'the dead dig. you keep the books.',

    // Prefixes every browser storage key this game writes. Changing it starts
    // every player from a clean slate; keeping it preserves saves across a
    // rename.
    storagePrefix: 'barrow',
  },

  // -------------------------------------------------------------------------
  // TEXT - every word the player reads
  //
  // Nothing below is referenced by id anywhere else, so any of it can be
  // rewritten freely. {name}, {n} and {t} are filled in where they appear.
  // -------------------------------------------------------------------------
  text: {
    // The figures across the top.
    stats: {
      coin:   'coin',
      bones:  'bones',
      horde:  'horde',
      depth:  'depth',
      income: 'coin/s',
    },

    // Buttons.
    dig:        'dig',
    sell:       'sell',
    sellLot:    'lot',
    sellLotTip: 'sell about what the market absorbs before it buckles',
    sellAll:    'all',
    buy:        'buy',
    buyTip:     'buy a tenth of what the market absorbs, at the going price',
    raise:      'raise',
    raiseMax:   'max',
    weightMore: '+',
    weightLess: '-',
    face:       'the face',
    faceLine:   'harder ground. break it and the next stratum opens.',
    export:     'export',
    import:     'import',
    reset:      'start over',
    resetSure:  'sure? everything goes',
    bought:     'held',

    // Panel titles.
    panels: {
      horde:  'the horde',
      market: 'the market',
      rites:  'rites',
    },

    // Column heads in the market.
    columns: {
      good:   'good',
      held:   'held',
      price:  'price',
      demand: 'demand',
    },

    // What the ledger rite writes on each market row.
    ledgerBase:  'base {base}',
    ledgerTakes: '~{absorb} / {t}',
    ceilingLine: 'saturated {pct}%',

    // The story, one line at a time. These fire once each, the first time the
    // thing they describe happens.
    log: {
      start:       'the ground is soft here.',
      firstDig:    'soil. it comes up easily.',
      sellShown:   'someone would pay for this.',
      firstSale:   'coin.',
      firstBone:   'a hand in the dirt.',
      raiseShown:  'it could be made to work.',
      firstRaise:  'the first of them stands. it digs.',
      faceShown:   'there is harder ground below. set some of them to it.',
      breakthrough:'{name}. the dead bring it up.',
      newMarket:   'someone will pay for {name}.',
      marketShown: 'prices move. watch them.',
      buckled:     'the {name} market buckles under what you sold. it will recover.',
      ritesShown:  'coin can buy more than goods.',
      handsDone:   'your hands are no longer needed.',
      away:        'you were away {t}. the dead kept digging.',
      hordeMilestones: [
        [100,       'a hundred of them.'],
        [1000,      'a thousand. the hill is quieter than it should be.'],
        [10000,     'ten thousand. the ground hums.'],
        [100000,    'a hundred thousand.'],
        [1000000,   'a million. the hill is hollow.'],
        [1e9,       'a billion. there was never this many buried here.'],
        [1e12,      'a trillion. it stopped being a hill some time ago.'],
      ],
      depthMilestones: [
        [5,  'five strata down. the soil is a memory.'],
        [10, 'ten strata. older graves than anyone recorded.'],
        [20, 'twenty. nothing here has a name you know.'],
        [30, 'thirty. you keep the books. that is all you do now.'],
      ],
    },

    // The note under the field before anything is dug.
    fieldHint: 'the surface',
  },

  // -------------------------------------------------------------------------
  // THE HAND - digging before there is anyone to dig for you
  // -------------------------------------------------------------------------
  hand: {
    units: 1,          // units of the top stratum per press
    firstBoneAt: 6,    // the press that turns up the first bone
    bonesPerDig: 0.2,  // bones per press after that, so pressing still helps early
  },

  // -------------------------------------------------------------------------
  // THE HORDE - how the dead are raised and how fast they dig
  //
  // Raising costs BONES only. Every digger turns up bones at one steady rate
  // wherever it stands, so the horde grows with its own size and nothing else
  // but the grave rite.
  // -------------------------------------------------------------------------
  horde: {
    digRate: 1,          // units per second per digger, at hardness 1
    boneShare: 0.03,     // bones per unit dug at stratum 0
    boneCostBase: 1,     // bones for the first raise
    boneCostSoft: 25,    // cost climbs as 1 + n / soft: doubles at this many
    bulk: [1, 10, 100],  // the raise buttons, plus max
    hideHandAt: 10,      // the dig button goes when the horde reaches this
    faceShownAt: 3,      // the face row appears at this many
    maxWeight: 5,        // weight notches per row
    activeStrata: 5,     // only this many of the deepest strata can be dug;
                         // the dead abandon shallower ground as they go down
    weightNew: 3,        // weight a newly opened stratum starts on
    weightFace: 2,       // weight the face starts on
  },

  // -------------------------------------------------------------------------
  // STRATA - the ground, layer by layer, forever
  //
  // Stratum k is hardnessGrowth^k times harder to dig than the surface and its
  // good is worth valueGrowth^k times soil. Breaking into stratum k+1 means
  // digging capBase * capGrowth^k units at the harder rate.
  // -------------------------------------------------------------------------
  strata: {
    hardnessGrowth: 2.5,
    valueGrowth: 3.5,
    capBase: 12,
    capGrowth: 1.8,
    ownShare: 0.75,      // share of a stratum's dig that is its own good
    carryShare: 0.20,    // share that is the stratum above's good
    traceShare: 0.05,    // share that is the stratum below's good, as a preview
    soilValue: 1,        // coin per unit of soil at base

    // The named ladder. Past its end the names are generated (see
    // src/materials.js) and the numbers keep climbing.
    ladder: [
      { name: 'soil',     hue: '#6b4f3a' },
      { name: 'clay',     hue: '#9a6a4a' },
      { name: 'flint',    hue: '#7d7a72' },
      { name: 'peat',     hue: '#5a4f35' },
      { name: 'coal',     hue: '#56565e' },
      { name: 'tin',      hue: '#9aa3a8' },
      { name: 'copper',   hue: '#b87333' },
      { name: 'bronze',   hue: '#b08d57' },
      { name: 'iron',     hue: '#8c8c90' },
      { name: 'silver',   hue: '#c0c6cc' },
      { name: 'amber',    hue: '#d08a2a' },
      { name: 'gold',     hue: '#d9b23f' },
      { name: 'garnet',   hue: '#a3283a' },
      { name: 'jet',      hue: '#4a4a52' },
      { name: 'ivory',    hue: '#f1e6cf' },
      { name: 'glass',    hue: '#9fd3c7' },
      { name: 'quartz',   hue: '#e3e6ea' },
      { name: 'cobalt',   hue: '#3f6fb8' },
      { name: 'platinum', hue: '#d8dde3' },
      { name: 'emerald',  hue: '#2e9e5b' },
      { name: 'sapphire', hue: '#3b6fd0' },
      { name: 'ruby',     hue: '#c81f3a' },
      { name: 'diamond',  hue: '#dff4ff' },
      { name: 'iridium',  hue: '#8fa0c0' },
    ],
    // Names past the ladder: a prefix on a ladder name from this index on.
    generatedFrom: 5,
    prefixes: ['old', 'deep', 'black', 'cold', 'pale', 'red', 'nameless', 'kings'],
  },

  // -------------------------------------------------------------------------
  // THE MARKET - one price per good, and what moves it
  //
  // price = base * cycle(t) * exp(-pressure). Selling q units adds q/absorb to
  // pressure, buying takes it away, and pressure drains back toward zero over
  // recoverySeconds. The cycle is a slow, deterministic swell around the base:
  // it can be read, and with the right rite it can be seen coming.
  // -------------------------------------------------------------------------
  market: {
    absorb0: 300,            // units the soil market takes before it buckles
    absorbGrowth: 1.0,       // deeper markets take the same units; the units are worth more
    recoverySeconds: 60,     // pressure falls by e in this long
    cycle: {
      amplitude: 0.25,       // swell of +-25% around base
      periodMin: 240,        // seconds
      periodMax: 720,
    },
    sampleSeconds: 2,        // how often the chart takes a point
    history: 90,             // points on the chart
    historyLedger: 240,      // points once the ledger is held
    forecastSeconds: 180,    // how far ahead foresight draws
    buckleBelow: 0.6,        // price/base at which the market is called buckled
    buyShare: 0.1,           // a buy takes this share of what the market absorbs
    lotShare: 0.5,           // the lot button sells this share of what it absorbs;
                             // must stay below -ln(buckleBelow) so a lot never buckles a calm market
    bones: {
      base: 5,               // coin per bone
      absorb: 60,
      recoverySeconds: 90,
    },
  },

  // -------------------------------------------------------------------------
  // RITES - what coin buys
  //
  // Each has an id the code knows, a cost that grows by `growth` per level and
  // a level cap. The effects: hands doubles dig speed; grave doubles how far
  // bones go; routes doubles what every market absorbs; haste makes every
  // market recover 1.5x faster; broker sells for you; ledger shows the
  // numbers under each market and lets you buy; foresight draws the cycle
  // ahead.
  // -------------------------------------------------------------------------
  rites: {
    // Per-level multipliers. Each level of hands multiplies dig speed by
    // handsFactor, and so on. Kept small so no single purchase is a cliff.
    handsFactor: 1.5,
    graveFactor: 1.5,
    routesFactor: 1.5,
    hasteFactor: 1.25,
    list: [
      { id: 'hands',     name: 'deeper hands',  line: 'the dead dig half again as fast.',           cost: 40,   growth: 10, max: 60 },
      { id: 'grave',     name: 'mass grave',    line: 'bones go half again as far when raising.',    cost: 60,   growth: 10, max: 60 },
      { id: 'ledger',    name: 'the ledger',    line: 'the numbers under every price, and buying.', cost: 80,   growth: 1, max: 1 },
      { id: 'broker',    name: 'a broker',      line: 'sells a share of every stock each second, for a cut.', cost: 120, growth: 6, max: 3 },
      { id: 'routes',    name: 'trade routes',  line: 'every market absorbs half again as much.',   cost: 150,  growth: 10, max: 60 },
      { id: 'haste',     name: 'quick markets', line: 'every market recovers a quarter faster.',    cost: 250,  growth: 10, max: 30 },
      { id: 'foresight', name: 'foresight',     line: 'the chart shows where the price is going.',  cost: 300,  growth: 1, max: 1 },
    ],
    // The broker by level: the share of each stock sold per second, its cut,
    // and whether it waits for the price to be above base.
    broker: [
      { share: 0.05, fee: 0.15, patient: false },
      { share: 0.05, fee: 0.08, patient: false },
      { share: 0.08, fee: 0.03, patient: true },
    ],
    // A rite is shown once coin reaches this share of its cost.
    showAtShare: 0.35,
  },

  // -------------------------------------------------------------------------
  // REVEAL - when each part of the game appears
  //
  // Nothing is shown before it matters. Every gate is monotonic: once a panel
  // has appeared it stays.
  // -------------------------------------------------------------------------
  reveal: {
    sellAtUnits: 5,      // the sell button appears at this much soil
    marketAtGoods: 2,    // the market appears once a digger has brought up this many goods
    ritesAtCoin: 15,     // the rites panel appears at this much coin
  },

  // -------------------------------------------------------------------------
  // TIME - how the simulation steps, and what happens while you are away
  // -------------------------------------------------------------------------
  time: {
    tick: 0.1,             // seconds per simulation step while the tab is open
    catchUpAfter: 4,       // a gap longer than this is stepped in coarse chunks
    offlineStep: 1,        // seconds per chunk when catching up
    offlineMaxHours: 12,   // the dead stop after this long without you
    autosaveSeconds: 5,
    incomeWindow: 10,      // seconds the coin/s figure averages over
  },

  // -------------------------------------------------------------------------
  // THE FIELD - the one drawing: a cross-section of the hill
  // -------------------------------------------------------------------------
  view: {
    bandHeight: 90,        // px per stratum until the field runs out of room
    minBandHeight: 12,
    surfaceHeight: 34,     // the sky and the mound
    particleCap: 2200,     // dots drawn; past this the mass is conveyed by density
    particleSize: 1.6,
    tunnelSegments: 260,   // carve segments per stratum, revealed as it is dug
    carveScale: 60,        // units dug for the first ~63% of a stratum's carve
    shaftWidth: 3,
    glintCount: 14,        // mineral glints per band, in the good's colour
  },

  // -------------------------------------------------------------------------
  // PALETTE
  // -------------------------------------------------------------------------
  palette: {
    void:   '#07080b',
    panel:  '#0d0f14',
    rule:   '#1b1f28',
    ink:    '#d7dbe3',
    dim:    '#6c7482',
    quiet:  '#464c58',
    bone:   '#d9cdb4',
    coin:   '#c9a95a',
    hot:    '#c8553d',
    good:   '#6fb08a',
    sky:    '#0c0f15',
    mound:  '#1d1a16',
    earth:  '#1a1612',
    deep:   '#0c1018',
    tunnel: '#050608',
    face:   '#2b2620',
  },

  // -------------------------------------------------------------------------
  // DEV
  // -------------------------------------------------------------------------
  dev: {
    allowOverrides: true,
    // Bump when src/ changes so a browser cannot pair a stale module with a
    // fresh page. Every import in index.html and src/ carries ?v=<this>.
    build: 1,
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

/** Fill {name}-style holes in a line of text. */
export function fill(line, values) {
  return String(line).replace(/\{(\w+)\}/g, (m, k) => (values && k in values ? String(values[k]) : m));
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
  setVar('--void',  p.void);
  setVar('--panel', p.panel);
  setVar('--rule',  p.rule);
  setVar('--ink',   p.ink);
  setVar('--dim',   p.dim);
  setVar('--quiet', p.quiet);
  setVar('--bone',  p.bone);
  setVar('--coin',  p.coin);
  setVar('--hot',   p.hot);
  setVar('--good',  p.good);

  const byId = (id) => (typeof d.getElementById === 'function' ? d.getElementById(id) : null);
  const put = (id, value) => { const el = byId(id); if (el) el.textContent = value; };
  const t = CONFIG.text;
  put('title',      CONFIG.identity.name);
  put('tagline',    CONFIG.identity.tagline);
  put('lbl-coin',   t.stats.coin);
  put('lbl-bones',  t.stats.bones);
  put('lbl-horde',  t.stats.horde);
  put('lbl-depth',  t.stats.depth);
  put('lbl-income', t.stats.income);
  put('dig',        t.dig);
  put('sell',       t.sell);
  put('export',     t.export);
  put('import',     t.import);
  put('reset',      t.reset);
  put('p-horde',    t.panels.horde);
  put('p-market',   t.panels.market);
  put('p-rites',    t.panels.rites);
  put('fieldhint',  t.fieldHint);

  // The tab icon is drawn from the palette rather than shipped as a file, so a
  // recolour needs no asset and the game still has no binary dependencies.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" fill="' + p.void + '"/>' +
    '<path d="M2 20 Q16 6 30 20 L30 32 L2 32 Z" fill="' + p.mound + '"/>' +
    '<rect x="15" y="14" width="2" height="18" fill="' + p.tunnel + '"/>' +
    '<circle cx="16" cy="26" r="2" fill="' + p.bone + '"/>' +
    '</svg>';
  if (typeof d.querySelector === 'function' && typeof d.createElement === 'function') {
    let link = d.querySelector('link[rel="icon"]');
    if (!link) {
      link = d.createElement('link');
      link.rel = 'icon';
      if (d.head && typeof d.head.appendChild === 'function') d.head.appendChild(link);
    }
    if (link) {
      link.type = 'image/svg+xml';
      link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
    }
  }
}
