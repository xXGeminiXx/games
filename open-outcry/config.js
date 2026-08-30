// ---------------------------------------------------------------------------
// Open Outcry - every name, number and colour in one place.
//
// Nothing in src/ owns a constant; it reads this file. Change a value here and
// the game changes. To try a value on a hosted build without a push:
//   ?set=ladder.clerk.base=50&set=sim.tickHz=12          one page load
//   localStorage.setItem('cfg:open-outcry', '{"sim":{"tickHz":12}}')  sticks
// The patch key is namespaced per game (src/cfgpatch.js) because localStorage
// is scoped to an origin and every game on the same site would otherwise read
// each other's tuning. Type is taken from the value already in place, so a
// number stays a number and a typo in a path is reported rather than created.
// ---------------------------------------------------------------------------
import { oklch } from './src/oklch.js?v=2';

export const CONFIG = {
  identity: {
    name: 'Open Outcry',
    tagline: 'You make the market. The pit trades against you.',
    storageKey: 'open-outcry',
  },

  dev: {
    build: 2,              // the ?v= tag every import carries; bump on every src change
    allowOverrides: true,  // ?set= and the namespaced localStorage patch
  },

  sim: {
    tickHz: 5,             // pit ticks per second in the first city
    maxCatchUpTicks: 24,   // ticks a single frame may run before it gives up and drops time
    historyLen: 240,       // price samples kept for the chalked line, across crowd rebuilds
    tapeLen: 40,           // prints kept for the tape strip
    logLen: 60,            // lines kept in the log
  },

  // A pit keeps no standing float. It borrows from the till exactly what the
  // quote it is about to write escrows, and everything loose is swept back the
  // same tick, so the number on the wall really is all of the money. Cash
  // crossing the boundary is recorded as a change in that market's issuance,
  // which is what keeps the engine's conservation identity closed.
  pit: {
    startFunds: 900,       // what the till holds at the first tick of a run
    wireShare: 0.85,       // most of the till one quote may stand on
    reserveOfQuote: 1.0,   // cash held back per unit of quote the boards carry
    minSpread: 2,          // ticks; a quote narrower than this is not a quote
    startSpread: 6,
    startSize: 5,
    carryOfSize: 4,        // stock the quote will hold, as a multiple of its size
    impatience: 0.3,       // share of orders written at the other side's touch
    // The pit is not a closed room. Left alone, the crowd's price level tracks
    // whatever cash happens to be on the floor, so every coin the player sweeps
    // out would deflate the pit that paid it. A slow flow of city money keeps
    // the floor's cash near what its stock is worth at the pit's own price. It
    // is deliberately slow: a tick's move is entirely the crowd's, and only an
    // hour's drift belongs to the city.
    anchorEvery: 10,       // ticks between adjustments
    anchorSpan: 5,         // how far from that value a price may ever run
    anchorPull: 0.02,      // share of the way a belief creeps back to the pit's price
    // How much of that pull survives when the stock is scarce. A floor with
    // its normal stock on it knows what the good is worth; a floor with a
    // tenth of it left does not, and the price runs. This is what makes
    // cornering cost something instead of buying a quiet market out at par.
    floorPerTrader: 4.5,   // units on a settled floor, per trader
    moneyFloor: 0.85,      // cash the floor should hold, as a share of its stock's worth
    lendRate: 0.12,        // share of that shortfall the city lends each time
  },

  // The crowd grows with the pit's own volume, in batches, so the floor fills
  // as trade picks up rather than on a clock. Growth is capped by the city.
  crowd: {
    start: 150,
    per: 500,              // units traded that earn one more trader
    batchOf: 0.08,         // rebuild once pending growth is this share of the crowd
    batchMin: 12,
    reputationCapBonus: 40, // extra cap per point of reputation spent on the floor
  },

  // Every pit is one good and one crowd. The belief and sizing rules are what
  // make two pits feel different: the same quote earns in one and is run over
  // in the other, so a player who has learned grain has not learned oil.
  pits: {
    grain:  { name: 'grain',  belief: 'adaptive', sizing: 'need',       price: 40,  supply: 10, demand: 6, make: 4, wear: 1,    impatience: 0.34, cost: 0 },
    salt:   { name: 'salt',   belief: 'anchored', sizing: 'flat',       price: 26,  supply: 8,  demand: 6, make: 3, wear: 0.8,  impatience: 0.18, cost: 3000 },
    timber: { name: 'timber', belief: 'adaptive', sizing: 'flat',       price: 65,  supply: 9,  demand: 5, make: 3, wear: 0.7,  impatience: 0.30, cost: 42000 },
    iron:   { name: 'iron',   belief: 'momentum', sizing: 'need',       price: 110, supply: 7,  demand: 5, make: 3, wear: 0.6,  impatience: 0.46, cost: 520000 },
    cloth:  { name: 'cloth',  belief: 'anchored', sizing: 'conviction', price: 180, supply: 7,  demand: 6, make: 2, wear: 0.5,  impatience: 0.22, cost: 6500000 },
    oil:    { name: 'oil',    belief: 'momentum', sizing: 'conviction', price: 320, supply: 6,  demand: 5, make: 2, wear: 0.45, impatience: 0.42, cost: 90000000 },
  },
  pitOrder: ['grain', 'salt', 'timber', 'iron', 'cloth', 'oil'],

  // What the crowd is made of and how hard it is to move. These are the
  // engine's options; they are here so a pit can be retuned without a push.
  market: {
    roleSplit: [0.16, 0.80],
    // Cash each trader opens with, as a multiple of the pit's own price. The
    // crowd's price level follows the money on the floor divided by the stock
    // on it, so this is what puts a pit's price where its name says it is.
    moneyOfPrice: 4,
    seedStock: 10,
    actEvery: 2,
    orderTtl: 4,
    maxOrder: 14,
    stockCap: 3,
    consumeIdeal: 8,
    specCap: 14,
    historyLen: 60,
  },

  // Everything the player buys. base and r are a geometric curve read by
  // src/purchase.js; a click re-quotes against the funds at that instant, so
  // a button can never promise a price the wallet cannot meet.
  ladder: {
    size:   { base: 26,      r: 1.155, step: 5,  label: 'quote size' },
    clerk:  { base: 900,     r: 2.15,  max: 8,   label: 'clerk' },
    seat:   { base: 11000,   r: 1.7,   bps: 4, max: 10, label: 'seat' },
    runner: { base: 26000,   r: 1.9,   lead: 15, max: 8, label: 'runner' },
  },
  bulk: [1, 10, 100, 'max'],

  // Rumours of what is coming. A runner reaches you before the pit does; that
  // lead is the whole of what the money buys.
  rumour: {
    everyTicks: 700,
    jitter: 260,
    leadBase: 0,           // ticks of warning with no runners at all
    kinds: {
      harvest: { shock: 'supply', factor: 1.9,  ticks: 220, dir: 'down' },
      drought: { shock: 'supply', factor: 0.35, ticks: 260, dir: 'up' },
      fire:    { shock: 'supply', factor: 0.15, ticks: 120, dir: 'up' },
      war:     { shock: 'demand', factor: 2.3,  ticks: 200, dir: 'up' },
      road:    { shock: 'demand', factor: 0.5,  ticks: 240, dir: 'down' },
    },
  },

  // Owning most of a pit's float closes it. What it pays is your own stock at
  // a premium, and by then the stock is dear because a floor stripped of its
  // goods no longer knows what they are worth. Reputation carries to the next
  // city; the funds stay in the till.
  corner: {
    share: 0.5,            // share of the float that lets the corner be called
    holdTicks: 240,        // ticks that share must hold before it can be called
    premium: 1.6,          // what your stock is paid, as a multiple of the mid
    reputationOfCrowd: 0.05,
    reputationMin: 1,
  },

  // The endless layer. A city is bigger, faster and dearer than the last.
  city: {
    crowdCap: [400, 750, 1200, 1700, 2300],
    crowdCapGrowth: 1.3,   // past the table, each city multiplies the last cap
    openShare: 0.4,        // a new pit opens with this share of the city's cap
    slots: [2, 3, 4, 5, 6], // pits that may be open at once
    slotsMax: 6,
    tickHzGrowth: 1.15,    // ticks per second, per city
    tickHzMax: 20,
    priceGrowth: 1.8,      // opening prices, per city
    costGrowth: 9,         // what a pit costs to open, per city
    // Pits cornered before the road out is offered. A pit cannot be opened
    // twice in one city, so this is a count of DIFFERENT pits taken, and the
    // arc of a city is taking as much of it as it will give.
    cornersToLeave: [4, 5, 6, 6, 6],
    // Reputation is spent ONCE, on structure. Nothing here pays out on a
    // schedule: a bought floor is bigger from the moment you arrive and never
    // grows on its own, which is what keeps the curve from accelerating.
    spend: {
      floor:  { base: 3, r: 1.6, label: 'a bigger floor' },
      seat:   { base: 4, r: 1.7, label: 'a cheaper seat' },
      slot:   { base: 6, r: 2.4, label: 'another pit' },
      clock:  { base: 5, r: 2.0, label: 'a faster clock' },
    },
    seatDiscount: 0.16,    // per point spent on the seat
    clockBonus: 0.07,      // ticks per second, per point spent on the clock
  },

  // What appears when. Nothing is on screen before the player has reached it,
  // and nothing appears on a timer.
  reveal: {
    ladder: { fills: 2 },
    spread: { fills: 5 },
    clerks: { funds: 420 },
    seat:   { volume: 6000 },
    pits:   { clerks: 1 },
    runners: { pits: 2 },
    corner: { share: 0.12 },
    city:   { corners: 1 },
  },

  offline: {
    cap: 8 * 3600,         // seconds of absence that count
    maxTicks: 4000,        // pit ticks actually run; the rest is paid at that rate
    minSeconds: 60,        // shorter than this is not worth a summary
  },

  save: {
    intervalSeconds: 20,
  },

  // The picture. Fractions are of the canvas height.
  view: {
    boardTop: 0.0,
    railTop: 0.62,
    railBottom: 0.665,
    floorBottom: 0.93,
    portraitRailTop: 0.52,     // used when the canvas is taller than it is wide
    portraitRailBottom: 0.575,
    portraitFloorBottom: 0.90,
    maxDpr: 2,
    marksMax: 2600,        // chalk marks drawn; the crowd count can run past it
    // The floor is rasterised into a buffer this many times the window and
    // stretched back over it. Every stroke on the floor costs, and there are
    // thousands of them; a crowd seen from a gallery does not need to be sharp.
    // 1 draws it at full size. ?set=view.crowdScale=1 for the crisp version.
    crowdScale: 1,
    headFrom: 0.3,         // marks nearer than this get a head drawn on them
    markLen: 15,           // body stroke length in CSS pixels at the near edge
    markLenFar: 7,         // and at the rail, where the floor is furthest
    surge: 26,             // pixels a mark leans toward the rail at full volume
    surgeEase: 0.16,       // how fast a mark moves toward where it wants to be
    settle: 0.06,          // and how fast it drifts back
    dustGrains: 2600,
    beamAngle: 0.42,       // radians the clerestory beam leans from vertical
    ghostSeconds: 1.5,     // how long a wiped figure stays legible
    priceLine: 0.9,        // width of the chalked price line as a share of the slate
  },

  // The chalk hand: how a written figure is drawn.
  chalk: {
    passes: 3,             // strokes laid over each other to build a chalk line
    jitter: 0.055,         // how far a point wanders, as a share of the size
    widthOfSize: 0.075,    // stroke width as a share of the glyph height
    tracking: 0.09,        // space between glyphs, as a share of the size
    grain: 0.35,           // alpha of the roughest pass
  },

  // OKLCH: a lightness, a chroma and a hue. Slate is green-grey and never
  // black; the only saturated colour in the game is the red chalk, and it
  // belongs to the player alone.
  palette: {
    slate:      oklch(0.26, 0.022, 155),
    slateDeep:  oklch(0.185, 0.020, 155),
    slateLit:   oklch(0.325, 0.020, 152),
    floor:      oklch(0.255, 0.018, 150),
    floorFar:   oklch(0.20, 0.016, 150),
    chalk:      oklch(0.93, 0.012, 95),
    chalkDim:   oklch(0.72, 0.010, 100),
    ghost:      oklch(0.45, 0.008, 150),
    dust:       oklch(0.56, 0.010, 140),
    timber:     oklch(0.42, 0.045, 62),
    timberLit:  oklch(0.56, 0.050, 66),
    timberDark: oklch(0.27, 0.035, 55),
    red:        oklch(0.66, 0.145, 30),
    redDim:     oklch(0.50, 0.110, 30),
    beam:       oklch(0.87, 0.015, 95),
    panel:      oklch(0.225, 0.020, 155),
    rule:       oklch(0.38, 0.014, 150),
  },
};

// Apply ?set= and the namespaced storage patch. Values keep the type of what
// they replace, and a path that does not already exist is reported rather than
// created, so a typo cannot look like a tuning that worked.
export function withOverrides(cfg, search, storage) {
  if (!cfg.dev.allowOverrides) return cfg;
  const report = { applied: [], unknown: [] };
  const setPath = (obj, path, raw) => {
    const keys = String(path).split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!o || typeof o !== 'object' || !(keys[i] in o)) { report.unknown.push(path); return; }
      o = o[keys[i]];
    }
    const k = keys[keys.length - 1];
    if (!o || !(k in o)) { report.unknown.push(path); return; }
    const cur = o[k];
    if (typeof cur === 'number') { const n = Number(raw); if (Number.isFinite(n)) { o[k] = n; report.applied.push(path); } }
    else if (typeof cur === 'boolean') { o[k] = raw === 'true' || raw === '1' || raw === true; report.applied.push(path); }
    else if (typeof cur === 'string') { o[k] = String(raw); report.applied.push(path); }
    else report.unknown.push(path);
  };
  const flat = (obj, prefix, out) => {
    for (const [k, v] of Object.entries(obj || {})) {
      const p = prefix ? prefix + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, p, out);
      else out[p] = v;
    }
    return out;
  };
  if (storage) {
    try {
      const raw = storage.getItem('cfg:' + cfg.identity.storageKey);
      if (raw) { const { game, ...values } = JSON.parse(raw); for (const [p, v] of Object.entries(flat(values, '', {}))) setPath(cfg, p, v); }
    } catch (e) { /* a patch that will not parse is not a patch */ }
  }
  if (search) {
    const q = new URLSearchParams(search);
    for (const v of q.getAll('set')) {
      const i = v.indexOf('=');
      if (i > 0) setPath(cfg, v.slice(0, i), v.slice(i + 1));
    }
  }
  cfg.dev.overrides = report;
  return cfg;
}

// The page's custom properties and title come from here, so the palette is
// written down once and the stylesheet reads it.
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
