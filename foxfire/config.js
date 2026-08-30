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
    // The words on the specimen label pinned to the floor. Each one sits in
    // front of its figure, except the rate, which carries its unit behind it.
    stats: {
      sugar:    'sugar',
      income:   '/s',
      minerals: 'minerals',
      tips:     'tips',
      area:     'ground',
      level:    'on',
    },
    // The label's first line: where the organism is, after its name.
    where:       '{level}, ring {ring} of {rings}',
    whereClosed: '{level}, all {rings} rings',
    gain:        '+',

    reach:       'Grow a thread',
    reachTip:    'Pushes one thread out to the nearest place not yet reached',
    buyTip:      'Grow a tip',
    buyTipMax:   'Max',
    buyTipTip:   'A tip forages on its own for as long as the fungus lives',
    extend:      'Open the next ring',
    beyond:      'Go beyond',
    fruit:       'Fruit',
    fruitSure:   'Sure? This fungus ends',
    weightTip:   'How much of the mineral flow goes to this kind, set against the other kinds',
    harvest:     ['Keep', 'Fell grown', 'Fell all'],
    harvestTip:  'What to do with this kind: keep them trading, fell the grown ones, or fell every one',
    nurture:     'Feed',
    nurtureOn:   'Feeding',
    nurtureTip:  'Send sugar to this kind so it grows faster',
    export:      'Export',
    import:      'Import',
    reset:       'Start over',
    resetSure:   'Sure? Everything goes',
    bought:      'Learned',

    // Instinct: the habits the organism can learn, what it says it last did,
    // and the share of the sugar it is not allowed to touch.
    instinct: {
      names: { extend: 'Open rings', tips: 'Grow tips', beyond: 'Go beyond' },
      hints: {
        extend: 'Open the next ring once the front has nothing left to reach',
        tips:   'Grow the front when the ground gives up more than the tips can carry',
        beyond: 'Go beyond a finished level without being asked. Off until you switch it on',
      },
      acted:  { extend: 'opened a ring', tips: 'grew the front', beyond: 'went beyond' },
      on:     'on',
      off:    'off',
      ago:    '{what}, {t} ago',
      idle:   'has done nothing yet',
      reserve:    'Reserve',
      reserves:   ['none', '1/4', '1/2', '3/4'],
      reserveTip: 'The share of the sugar these habits won\'t spend',
    },

    // Moving a save between browsers.
    savePrompt:   'Copy this save',
    savePaste:    'Paste a save',
    saveCopied:   'Save copied',
    saveCopyThis: 'Copy this: ',

    panels: {
      entries: 'Field notes',
      tips:    'Tips',
      trees:   'Trees',
      season:  'Seasons',
      reach:   'Reach',
      traits:  'Traits',
      instinct: 'Habits',
      spores:  'Fruiting',
      genome:  'What the spore carries',
    },

    seasons: ['spring', 'summer', 'autumn', 'winter'],
    // Every entry is written with the year and the season it was written in,
    // and that mark is found again when the entry is drawn so it can be set
    // in small capitals.
    entryMark: 'Year {n}, {season}. ',
    seasonLeft: '{left} left',

    // How many trees of a kind there are, under its name in the ledger.
    counts: {
      one:   '1 tree',
      many:  '{n} trees',
      grown: '{n} grown',
      dead:  '{n} dead',
    },

    columns: {
      size:     'Size',
      sent:     'Minerals sent',
      got:      'Sugar paid',
      rate:     'Price',
      rateTip:  'Sugar the next mineral sent here would fetch. Send the minerals where this is highest',
      weight:   'Share',
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
  //
  // The three kinds on a level are deliberately far apart. The first mineral
  // fetches rate/need, and within a level those three prices stand at about
  // 1 : 1.6 : 2.6, so where the minerals go is worth deciding. They are also
  // deep to different depths: a kind saturates around need * size minerals a
  // second, and the dearest kind has the largest appetite, so filling it is
  // what the good answer usually looks like - until the year moves.
  //
  // season is what a kind pays, spring to winter, on top of the year's own
  // curve. Each one averages to one, so it swings a kind's price about rather
  // than handing anything out, and the swings are wide enough that a
  // different kind pays best in different seasons.
  // -------------------------------------------------------------------------
  trees: {
    perLevel: 3,
    roster: [
      // name        rate  need  growth   max   wood   weight  season (spring, summer, autumn, winter)
      { name: 'birch',    rate: 0.28, need: 0.29, growth: 0.0045, max: 3.5, wood: 38,  weight: 5, season: [0.90, 1.70, 0.85, 0.55] },
      { name: 'alder',    rate: 0.77, need: 0.51, growth: 0.0040, max: 4.0, wood: 69,  weight: 4, season: [0.75, 0.80, 1.65, 0.80] },
      { name: 'pine',     rate: 1.55, need: 0.63, growth: 0.0028, max: 7.0, wood: 85,  weight: 3, season: [1.35, 0.50, 0.95, 1.20] },
      { name: 'aspen',    rate: 0.46, need: 0.40, growth: 0.0050, max: 4.5, wood: 64,  weight: 5, season: [0.85, 0.80, 1.75, 0.60] },
      { name: 'spruce',   rate: 0.82, need: 0.45, growth: 0.0026, max: 8.0, wood: 74,  weight: 4, season: [1.15, 0.85, 0.70, 1.30] },
      { name: 'maple',    rate: 3.57, need: 1.20, growth: 0.0030, max: 6.5, wood: 196, weight: 3, season: [1.00, 1.60, 0.65, 0.75] },
      { name: 'beech',    rate: 0.63, need: 0.50, growth: 0.0022, max: 9.0, wood: 89,  weight: 4, season: [0.75, 0.80, 0.75, 1.70] },
      { name: 'oak',      rate: 1.62, need: 0.80, growth: 0.0018, max: 12.0, wood: 146, weight: 3, season: [1.55, 0.85, 0.90, 0.70] },
      { name: 'fir',      rate: 3.50, need: 1.07, growth: 0.0024, max: 11.0, wood: 193, weight: 4, season: [0.90, 1.30, 1.25, 0.55] },
      { name: 'hemlock',  rate: 0.84, need: 0.60, growth: 0.0020, max: 13.0, wood: 117, weight: 4, season: [0.80, 1.75, 0.85, 0.60] },
      { name: 'cedar',    rate: 2.47, need: 1.11, growth: 0.0016, max: 15.0, wood: 223, weight: 3, season: [0.90, 0.75, 1.60, 0.75] },
      { name: 'redwood',  rate: 6.12, need: 1.70, growth: 0.0012, max: 24.0, wood: 337, weight: 2, season: [1.35, 0.65, 0.95, 1.05] },
    ],
    ages: ['old', 'ancient', 'elder', 'primeval', 'first'],
    // A tree begins between these shares of its full size.
    startSize: [0.08, 0.9],
    // A tree counts as grown at this share of its full size.
    mature: 0.8,
    // Felling: a tree drained by parasitism loses health at this rate and pays
    // this many times its trade rate while it goes, without wanting minerals.
    // A drain pays yield * seconds times the tree's rate whatever the season,
    // which is the whole of the rotation question: a tree nobody is sending
    // minerals to, or a tree in a season that pays nothing, is worth more
    // felled than kept, and a tree at the front of a good trade is not.
    fell: { seconds: 60, yield: 1.6 },
    // A felled tree becomes dead wood worth size * wood, and once that has
    // been eaten a seedling comes up in its place.
    regrowSeconds: 240,
    // Feeding: sugar sent per second per unit of size, and the growth it buys.
    // The ledger states when it pays for itself; past this many seconds it is
    // stated as not paying at all rather than as a number nobody would wait
    // out.
    nurture: { sugarPerSize: 0.06, boost: 2.0, paybackHorizon: 3600 },
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
  //
  // The three instincts are habits rather than powers: each one is a button
  // the player has been pressing, learned. They are priced to arrive across
  // the first level and the second - reach at about the fourth ring, the
  // front in the middle of the floor, and going beyond only once a level has
  // been folded, since the floor's whole economy is spent on the fold itself.
  // -------------------------------------------------------------------------
  traits: [
    { id: 'lignin',         cost: 300,    growth: 3.5, cap: 3,  effect: { eat: 0.5 } },
    { id: 'cables',         cost: 450,    growth: 3.5, cap: 6,  effect: { speed: 0.3 } },
    { id: 'instinctExtend', cost: 500,    growth: 1,   cap: 1,  effect: { instinct: 'extend' } },
    { id: 'branching',      cost: 750,    growth: 3.5, cap: 5,  effect: { tipCost: -0.12 } },
    { id: 'reach',          cost: 1000,   growth: 3.5, cap: 4,  effect: { search: 1.0 } },
    { id: 'symbiosis',      cost: 1300,   growth: 3.5, cap: 6,  effect: { trade: 0.25 } },
    { id: 'parasitism',     cost: 2500,   growth: 1,   cap: 1,  effect: { fell: 1 } },
    { id: 'transfer',       cost: 3500,   growth: 1,   cap: 1,  effect: { nurture: 1 } },
    { id: 'instinctTips',   cost: 4000,   growth: 1,   cap: 1,  effect: { instinct: 'tips' } },
    { id: 'rot',            cost: 4500,   growth: 3.5, cap: 5,  effect: { felledWood: 0.3 } },
    { id: 'frost',          cost: 6000,   growth: 1,   cap: 1,  effect: { frost: 1 } },
    { id: 'reserve',        cost: 7500,   growth: 3.0, cap: 6,  effect: { awayHours: 4 } },
    { id: 'evergreen',      cost: 20000,  growth: 1,   cap: 1,  effect: { evergreen: 1 } },
    { id: 'instinctBeyond', cost: 60000,  growth: 1,   cap: 1,  effect: { instinct: 'beyond' } },
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
  // EVENTS - the world answering back
  //
  // Four things that happen to the organism rather than because of it: a
  // drought, a windthrow, a fire, and another fungus with designs on the same
  // ground. Each one is scheduled by hashing the seed with a counter and
  // never rolled at the moment it lands, so a seed always brings the same
  // weather at the same times, a save replays exactly, and an absence caught
  // up in coarse chunks is the same run as one played through.
  //
  // None of them hands out a share of anything. The windthrow is the only one
  // that gives, and it gives a number of seconds of the income the organism
  // already makes - a small fraction of the gap between windthrows, so the
  // income settles at a fixed multiple of the income without them rather than
  // climbing off on its own.
  // -------------------------------------------------------------------------
  events: {
    enabled: true,      // the lot of it: off, and the world stays quiet
    // A gap between events of one kind is that kind's mean times a hashed
    // number in 1 +/- this, and the first of a kind waits its earliest time
    // plus up to this many means.
    spread: 0.5,
    // When one comes due and the ground cannot carry it - no logs in reach,
    // too little reached to burn, nowhere for a rival to come up - it waits
    // this many seconds and looks again.
    retry: 60,

    drought: {
      enabled: true,
      first: 900,       // earliest it can happen, in simulation seconds
      mean: 2400,       // seconds between droughts, on average
      // It begins with a season and ends with it, and only these seasons
      // (spring and summer) can carry one.
      seasons: [0, 1],
      firstYear: 1,     // never in the organism's first year
      minerals: 0.5,    // the share of its minerals dry soil still gives
    },

    windthrow: {
      enabled: true,
      first: 600,
      mean: 1500,
      logs: 5,          // how many logs the wind puts on the ground
      // The wood it leaves, in seconds of the income the organism already
      // makes, split across those logs. Well under the mean gap above, which
      // is what keeps it from compounding.
      seconds: 90,
    },

    fire: {
      enabled: true,
      first: 1800,
      mean: 3600,
      firstYear: 2,     // never in the first two years
      width: 0.8,       // the wedge that burns, in radians
      // The wedge starts this far out, as a share of the open reach, and
      // runs from there to the edge of it.
      radiusFrom: 0.3,
      radiusTo: 0.75,
      // A fire never takes more than this share of what has been reached; the
      // wedge is narrowed by the factor below until it does not.
      cap: 0.25,
      narrow: 0.8,
      narrowTries: 12,
      // A living tree in the fire dies to a snag holding this many times the
      // wood it would have left felled. Charred wood is rich, and it is the
      // whole reason to go back into a burn.
      burnBonus: 1.6,
      markSeconds: 300, // how long the ground stays marked as burnt
    },

    rival: {
      enabled: true,
      first: 1500,
      mean: 5400,
      // It comes up past this share of the open reach, out in the ground the
      // threads come to last, which is what gives it time to be anything.
      edge: 0.75,
      rate: 12,         // seconds per place it takes
      search: 2.4,      // how far it looks for ground to take, in cells
      // It can only come up where there is open ground nobody has reached, and
      // a fast front leaves that open for seconds at a time, so it looks for
      // its chance more often than the others do.
      retry: 10,
      maxPerStep: 32,   // most places it can take in one catch-up chunk
      // A hop into ground it holds costs a tip this many times the distance.
      // Pushing through another organism's threads is slow, and this is what
      // decides how long it can hold anything against a big front.
      cost: 12,
      // It withers once it has taken nothing new for this long.
      stallSeconds: 420,
    },
  },

  // -------------------------------------------------------------------------
  // INSTINCT - what the organism does for itself
  //
  // Three habits, each learned as a trait and switched on in the journal:
  // open the next ring when the front has run out of ground, grow the front
  // when the ground gives up more minerals than the tips can carry, and fold
  // a level that is finished. Each one presses a button the player could
  // press and nothing else, so instinct saves attention and never buys
  // anything cheaper than a hand would.
  //
  // They decide on their own coarse clock rather than every tick, so an hour
  // watched and an hour away take the same decisions at the same moments.
  // -------------------------------------------------------------------------
  instinct: {
    everySeconds: 5,    // sim seconds between decisions, awake or away
    // The shares of the sugar an instinct will not spend, and which of them
    // an organism starts on. A reserve is one of these and nothing else.
    reserves: [0, 0.25, 0.5, 0.75],
    reserveDefault: 1,
    // The front is grown once the ground produces this much more than the
    // tips can carry, so a hair of leaching does not set it buying.
    carryShort: 1.05,
    // At most this share of what is above the reserve goes into tips in one
    // decision, so closing a wide gap takes several and leaves sugar for
    // ground and traits meanwhile.
    tipsShare: 0.5,
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
    pad: 1.5,               // cells of ground kept in view beyond the open reach
    tipsDrawn: 1500,        // at most this many tips are drawn; the count is shown
    // Below this many screen pixels per cell the picture drops its detail: a
    // log loses its face and its grain, a canopy its shading.
    massBelow: 4.0,
    // How many shapes are kept stamped and ready. The floor holds hundreds of
    // logs and trees among a handful of shapes, so each is drawn once and
    // stamped; past this many the set is dropped and drawn again.
    spriteCache: 240,
    // Stamps are drawn at rungs of this ladder of sizes and scaled down to
    // what is wanted, so an easing camera reuses them instead of drawing a new
    // set every frame.
    spriteStep: 1.25,

    // THE FLOOR. Drawn once per season, camera scale, canvas size and level
    // into an offscreen canvas and blitted, so a frame costs only the threads,
    // the nodes and the tips.
    floor: {
      // The mottling of the loam, coarse to fine. `scale` is cells per
      // feature; an octave finer than grainMin pixels on the screen is left
      // out, because at that size it only averages back into the flat tone.
      octaves: [
        { scale: 9.0, alpha: 0.30 },
        { scale: 2.6, alpha: 0.40 },
        { scale: 0.7, alpha: 0.34 },
      ],
      grainMin: 5,          // pixels: finer than this an octave is not drawn
      grainBroad: 0.5,      // an octave whose feature is wider than this share of the
                            // canvas is not drawn; the view would sit inside one of them
      grainMax: 90,         // pixels: no blob of ground tone is wider than this
      mossScale: 6.5,       // cells per moss feature
      mossThreshold: 0.54,  // moss grows where the noise is above this
      litterLen: 0.26,      // one leaf mark, in cells
      litterWide: 0.075,
      litterMax: 5000,      // however wide the view, never more marks than this
      dampRadius: 0.8,      // a damp patch of bare soil, in cells
      scaleStep: 1.12,      // the floor is redrawn when the camera crosses one of these steps
    },

    // LOGS - dead wood, lying where it fell.
    log: {
      length: 1.6,          // in cells
      width: 0.5,
      face: 0.8,            // how far the pale face covers the bark under it
      stages: 6,            // stages of being eaten a log is drawn in
      grain: 3,             // grain lines along the face
      snow: 0.34,           // the share of the width winter's snow covers
    },

    // TREES - canopy discs seen from above.
    tree: {
      radius: 0.85,         // a full grown canopy, in cells
      min: 0.35,            // no canopy is drawn smaller than this, in cells
      core: 0.5,            // the share of a canopy that is solid before its edge softens
      vary: 0.4,            // how much one crown differs in width from the next
      trunk: 0.22,          // the dark centre, as a share of the canopy
      lift: 0.24,           // how far the lit side sits toward the top left
      seedlingBelow: 0.16,  // a tree this small a share of its size is a seedling
      snag: 5,              // bare branches on a dead tree
    },

    // THE LACE - the organism itself.
    lace: {
      width: 0.09,          // a thread, in cells
      wave: 0.22,           // how far a thread bows off the straight line, in cells
      alpha: 0.6,
      fresh: 20,            // seconds a thread counts as newly grown
      freshAlpha: 0.95,
      freshGlow: 0.3,       // how much of the glow a newly grown thread carries
      glowWidth: 4.5,       // the soft pass under a thread, as a multiple of its width
      glowAlpha: 0.09,
    },

    // THE TIPS - short bright dashes at the front, never round dots.
    tip: {
      dash: 0.4,            // in cells
      width: 0.13,
      alpha: 0.9,
      glow: 0.35,           // the tint of glow the front carries in daylight
    },

    // THE REACH - the bought ground is the lit clearing; past it, mist.
    mist: {
      max: 0.7,             // how thickly the unbought ground is veiled
      rings: 1.6,           // rings of ground over which the mist thickens
    },

    // BEYOND - how slowly a folded level opens its new clearing.
    fold: { seconds: 1.5 },

    // THE BURN - the wedge of ground a fire has been through. Ash lies over
    // the floor in it, char takes the place of the leaf litter, the moss is
    // gone, the logs are husks and the trees in it stand as black snags with
    // charred heartwood at the foot. All of it fades back toward ordinary
    // ground as the mark ages.
    burn: {
      ash: 'night',           // the wash that darkens scorched ground
      ashAlpha: 0.72,         // how heavily the ash lies in the middle of it
      ashScale: 1.1,          // cells per patch of ash laid on the floor
      ashVary: 0.45,          // how unevenly it lies, as a share of its weight
      soften: 1.4,            // cells of soft edge at the near and far rims
      softenAngle: 0.22,      // radians of soft edge along its sides
      char: ['night', 'damp', 'bark'],  // splinters left where the litter was
      charPer: 2.2,           // char marks per cell of scorched ground
      charAlpha: 0.75,
      charLen: 0.3,           // one char mark, in cells
      charWide: 0.085,
      husk: 'night',          // a log the fire went through
      huskAlpha: 0.8,
      snag: 'night',          // a tree it went through: black, not ordinary grey
      snagAlpha: 0.95,
      snagBranch: 1.5,        // its branches, against an ordinary snag's
      ember: 'rust',          // charred heartwood, the whole reason to go back
      emberAlpha: 0.45,
      emberRadius: 0.5,       // as a share of the snag
      fadeSteps: 5,           // steps the mark fades over, so an ageing burn
                              // redraws the floor a handful of times, not on every frame
    },

    // THE DROUGHT - while the rain holds off the floor dries out: the litter
    // goes pale and grey, the moss browns off, the damp patches lighten, and
    // a dry light lies over the whole of it.
    drought: {
      mix: 0.55,              // how far it dries: the share of the litter that
                              // takes the dry colour, and how much of the moss
                              // and the damp is left
      litter: 'dead',         // dry litter, paler and greyer than the season's
      moss: 'litter',         // moss browned off
      wash: 'dead',           // the dry light over all of it
      washAlpha: 0.1,
    },

    // A RIVAL - another fungus holding ground of its own. Its lace is dark,
    // thick and matted where ours is pale and open, and it carries a tuft on
    // every place it holds, so its patch never reads as more of us.
    rival: {
      lace: 'damp',           // its threads: dark, never our cream
      laceAlpha: 0.9,
      width: 0.17,            // one of its threads, in cells
      mat: 'bark',            // the matted ground under them
      matWidth: 3.2,          // as a multiple of the thread
      matAlpha: 0.22,
      tuft: 'damp',           // small dark tufts on the ground it holds
      tuftAlpha: 0.85,
      tufts: 4,               // marks in one tuft
      tuftLen: 0.34,          // in cells
      tuftWide: 0.1,
      tuftSpread: 0.26,       // how far a tuft's marks sit from the node, in cells
    },

    // WINDTHROW - a log the wind has just put on the ground. Until the threads
    // find it the break is fresh: pale, bright, unweathered wood.
    fallen: {
      wood: 'woodPale',       // the fresh face, brighter than wood that has lain
      face: 0.9,              // how much of the log's width it covers
      alpha: 1,
      breakLen: 0.16,         // the splintered end, as a share of the log
      breakAlpha: 0.95,
    },

    // THE SEASONS. A season is a set of overrides on the palette: which
    // colours the litter takes, how thickly it lies, what the light washes
    // over the floor, and how much the lace glows in it. Colours are named
    // from the palette, which is the only place one is written. In the order
    // spring, summer, autumn, winter.
    seasons: [
      { // spring - pale green litter and fresh moss
        ground: 'loamLight', shade: 'damp',
        litter: ['mossFloor', 'litter', 'seedling'],
        litterPer: 3.0, litterAlpha: 0.42,
        moss: 'mossFloor', mossAlpha: 0.52,
        damp: 'damp', dampAlpha: 0.5,
        wash: 'mossFloor', washAlpha: 0.06,
        veil: 'mist', veilAlpha: 1,
        frost: 'frost', frostPer: 0,
        snow: 'snow', snowAlpha: 0,
        lace: 'lace', laceAlpha: 1, glow: 'glow', glowAll: 0,
      },
      { // summer - deep green and brown
        ground: 'loamLight', shade: 'damp',
        litter: ['litter', 'mossFloor', 'bark'],
        litterPer: 3.4, litterAlpha: 0.46,
        moss: 'mossFloor', mossAlpha: 0.66,
        damp: 'damp', dampAlpha: 0.5,
        wash: 'mossFloor', washAlpha: 0.03,
        veil: 'mist', veilAlpha: 1,
        frost: 'frost', frostPer: 0,
        snow: 'snow', snowAlpha: 0,
        lace: 'lace', laceAlpha: 1, glow: 'glow', glowAll: 0,
      },
      { // autumn - rust and ochre litter, thick
        ground: 'loamLight', shade: 'damp',
        litter: ['rust', 'litter', 'woodPale'],
        litterPer: 5.5, litterAlpha: 0.55,
        moss: 'mossFloor', mossAlpha: 0.4,
        damp: 'damp', dampAlpha: 0.5,
        wash: 'rust', washAlpha: 0.09,
        veil: 'mist', veilAlpha: 1,
        frost: 'frost', frostPer: 0,
        snow: 'snow', snowAlpha: 0,
        lace: 'lace', laceAlpha: 1, glow: 'glow', glowAll: 0,
      },
      { // winter - dusk, frost on the litter, snow on the logs, the lace glows
        ground: 'frost', shade: 'night',
        litter: ['litter', 'frost', 'snow'],
        litterPer: 2.0, litterAlpha: 0.32,
        moss: 'mossFloor', mossAlpha: 0.28,
        damp: 'night', dampAlpha: 0.5,
        wash: 'night', washAlpha: 0.45,
        veil: 'night', veilAlpha: 0.75,
        frost: 'frost', frostPer: 0.85,
        snow: 'snow', snowAlpha: 0.8,
        lace: 'lace', laceAlpha: 0.5, glow: 'glow', glowAll: 0.45,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // PALETTE - the only place a colour is written. See docs/IDENTITY.md.
  //
  // The journal is paper and ink. The floor is loam, litter, moss, bark and
  // pale lace. A season is a set of overrides on these, in view.seasons.
  // -------------------------------------------------------------------------
  palette: {
    // the journal
    paper:     '#efe7d6',
    paperDeep: '#e2d7bf',
    ink:       '#2b2621',
    faded:     '#5c5346',
    rule:      '#c9bda6',
    rust:      '#a8512b',
    // The journal's inks are darker than the floor's colours of the same
    // name, because they are read as words on pale paper: every one of these
    // stands at 4.5:1 or better against both paper tones, which is what a
    // page of small figures needs to be read without leaning in. rustInk is
    // the written rust; rust itself stays as the floor's autumn colour.
    rustInk:   '#82401f',
    moss:      '#455a2c',
    sugar:     '#755213',
    mineral:   '#3a4f5b',
    glow:      '#8ff0c0',
    // the floor
    loam:      '#6b5236',
    loamLight: '#8a6d4b',
    litter:    '#a07b4e',
    mossFloor: '#4e6a35',
    damp:      '#3f3a34',
    bark:      '#4a3623',
    woodPale:  '#c9a878',
    lace:      '#f3ecd8',
    // one canopy colour per roster species, in roster order
    canopy: ['#9db36a', '#5c7a52', '#3f5f4a', '#7c8f4f', '#2f5548', '#6f7f3f',
             '#527045', '#8b8a4a', '#3d6650', '#4f6f5b', '#5e5a3a', '#2c4e3e'],
    dead:      '#8f8577',
    seedling:  '#b7d38a',
    snow:      '#e9eef2',
    frost:     '#b9c7d6',
    mist:      '#d8d2c2',
    night:     '#1d2530',
  },

  // -------------------------------------------------------------------------
  // DEV
  // -------------------------------------------------------------------------
  dev: {
    allowOverrides: true,
    // Bump when src/ changes so a browser cannot pair a stale module with a
    // fresh page. Every import in index.html and src/ carries ?v=<this>.
    build: 9,
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
  setVar('--paper',      p.paper);
  setVar('--paper-deep', p.paperDeep);
  setVar('--ink',        p.ink);
  setVar('--faded',      p.faded);
  setVar('--rule',       p.rule);
  setVar('--rust',       p.rust);
  setVar('--rust-ink',   p.rustInk);
  setVar('--moss',       p.moss);
  setVar('--sugar',      p.sugar);
  setVar('--mineral',    p.mineral);
  setVar('--glow',       p.glow);
  setVar('--loam',       p.loam);

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
  put('fruit',        t.fruit);
  put('p-tips',       t.panels.tips);
  put('p-trees',      t.panels.trees);
  put('p-season',     t.panels.season);
  put('p-reach',      t.panels.reach);
  put('p-traits',     t.panels.traits);
  put('p-instinct',   t.panels.instinct);
  put('p-spores',     t.panels.spores);
  put('p-genome',     t.panels.genome);
  put('fieldhint',    t.panels.entries);

  // The tab icon is drawn from the palette rather than shipped as a file, so a
  // recolour needs no asset and the game still has no binary dependencies.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" fill="' + p.loam + '"/>' +
    '<path d="M16 16 L7 9 M16 16 L25 8 M16 16 L9 25 M16 16 L26 22 M7 9 L4 4 M25 8 L29 3" ' +
    'stroke="' + p.lace + '" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
    '<circle cx="16" cy="16" r="3" fill="' + p.glow + '"/>' +
    '<circle cx="7" cy="9" r="1.4" fill="' + p.lace + '"/>' +
    '<circle cx="25" cy="8" r="1.4" fill="' + p.lace + '"/>' +
    '<circle cx="9" cy="25" r="1.4" fill="' + p.lace + '"/>' +
    '<circle cx="26" cy="22" r="1.4" fill="' + p.lace + '"/>' +
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
