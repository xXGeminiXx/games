// ===========================================================================
// CONFIGURATION
//
// Every number worth turning and every short label lives here. The writing -
// the log, the chambers, the visitors, the names of the rites - lives in
// content.js next door, so a paragraph can be rewritten without reading a
// rate and a rate can be turned without reading a paragraph.
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
    tagline: 'The dead dig. You keep the books.',

    // Prefixes every browser storage key this game writes. Changing it starts
    // every player from a clean slate; keeping it preserves saves across a
    // rename.
    storagePrefix: 'barrow',
  },

  // -------------------------------------------------------------------------
  // LABELS - the short words on the furniture. Sentences live in content.js.
  // -------------------------------------------------------------------------
  text: {
    stats: {
      coin:   'Coin',
      bones:  'Bones',
      horde:  'Diggers',
      depth:  'Depth',
      income: 'Coin/s',
      rem:    'Relics',
      rank:   'Rank {n}',
    },

    dig:        'Dig',
    sell:       'Sell',
    sellLot:    'Some',
    sellLotTip: 'Sells a small load, so the price barely moves',
    sellAll:    'All',
    buy:        'Buy',
    buyTip:     'Buys back {n} units for {coin}, which lifts the price back up',
    raise:      'Raise',
    raiseMax:   'Max',
    raiseTip:   'Bones raise the dead. Each button shows what it costs. Max spends every bone you have.',
    shareMore: '+',
    shareLess: '-',
    shareMoreTip: 'Send more of them to this layer',
    shareLessTip: 'Send fewer of them to this layer',
    shareBarTip:   'How many of them are digging here',
    // The one control nobody has to touch.
    autoOff:    'Let me place them',
    autoOn:     'Go back to placing them for me',
    autoOffTip: 'Place the diggers yourself. You never have to',
    autoOnTip:  'Hand it back and the game keeps them where they earn most',
    autoNoteGame: 'They move themselves as the ground changes.',
    autoNoteHand: 'You are placing them. They stay where you put them.',
    // Layers nobody is digging any more, folded into one line.
    spent:      '{N} older layers, worked out.',
    spentWorth: '{N} older layers, worked out. What they left is worth {coin}.',
    spentShow:  'Show them',
    spentHide:  'Hide them',
    // Under each row: what that layer is actually paying and how many of the
    // dead it is turning up, both per second. Deep ground is worth thousands
    // of times what shallow ground is and its buyers are nowhere near full,
    // so two rows that look alike on the panel can be a billion apart here.
    rowRate:     '{coin} coin/s',
    rowBones:    '{bones} bones/s',
    rowNothing:  'Nothing yet',
    rowRateTip:  'What this layer pays and how many of the dead it turns up, every second',
    face:       'Digging down',
    doorRow:    '{Name}\'s door',
    // The switches rank hands over.
    autoBuyOn:  'Auto-buy: on',
    autoBuyOff: 'Auto-buy: off',
    autoBuyTip: 'Buys the cheapest upgrade you can afford, as soon as you can afford it',
    autoSeal:   'Fill in by itself at layer {n}',
    autoSealOff: 'Fill in by itself: off',
    autoSealTip: 'The barrow fills itself in once it reaches this layer, and the next one starts',
    faceLine:   'Put some of them here and they break through to the layer below.',
    export:     'Export',
    import:     'Import',
    reset:      'Start over',
    resetSure:  'Sure? You lose the relics too',
    bought:     'Owned',
    take:       'Take it',
    pass:       'Pass',
    unknownSeam:'Unread',

    panels: {
      horde:   'Where they dig',
      market:  'Markets',
      rites:   'Upgrades',
      riteBulk: 'Buy',
      visitor: 'At the gate',
      chamber: 'A room',
      lord:    'A lord of the dead',
      seal:    'Fill it in',
      oaths:   'Kept forever',
    },

    // "Held" is what a bought row reads, so the units of a good on hand are
    // stock. One word, one meaning.
    columns: {
      good:   'Material',
      held:   'On hand',
      price:  'Price',
      demand: 'Demand',
    },

    // What a room's offer moves, named the same way on both sides of a choice
    // so the two can be compared. The figure beside it is worked out from the
    // run as it stands when the room opens.
    effects: {
      dig:      'Dig speed',
      bones:    'Bones found',
      value:    'Prices',
      face:     'Digs down',
      absorb:   'Markets take',
      soft:     'Bones raise more',
      windfall: '{Coin} coin now',
      diggers:  '{N} diggers now',
      rem:      '{N} relics when you fill it in',
    },

    ledgerBase:  'Usually {base}',
    // Units the market takes over the time it needs to forget them, which is
    // the flow it pays best for. It sits under the demand column, where a
    // figure about the market's appetite belongs.
    ledgerTakes: 'takes {absorb}, back in {t}',
    ledgerTakesTip: 'How much this market takes before the price drops, and how long it needs to come back',
    // Appended after a figure and a dash, so these three stay lower case:
    // "38% - oversold 1.7x" reads right and "38% - Oversold" does not.
    ceilingLine: '{x}x more than it buys',
    // Anything past the market's capacity is technically over it, and a run
    // sitting a few percent past is exactly where a player wants to be. Crying
    // oversold there teaches them to ignore the word. It is said once the
    // overshoot is large enough to be costing them something.
    ceilingAt: 1.15,
    ceilingTip:  'More of this is coming up than the buyers will take. The rest of it sells for almost nothing',
    lesserGoods: '{n} older materials',
    lesserTip:   'Everything still on hand from layers the dead have left behind',
    lesserWorth: 'Worth about {coin}',
    fieldHint:   'The surface',
    aheadLine:   'Next down: {list}',

    // THE GOAL: the next lord's door, under the line at the top.
    goal: {
      ahead: '{Name}\'s door is under layer {n}. {m} layers to go.',
      one:   '{Name}\'s door is under the next layer.',
      at:    'Breaking {Name}\'s door: {pct} through.',
      rule:  'In {Name}\'s layers: {line}',
      tip:   'Every tenth layer\'s floor is a lord\'s door. Break it and he pays his hoard, talks, and gives you a gift.',
    },
    // The Kept forever tab: rank, trophies, and what rank hands over.
    standing: {
      rank:     'Rank {n}: {name}',
      next:     'Next rank, {next}: {into} of {span}.',
      nextKey:  'Rank {n} gives you: {line}',
      how:      'Rank comes from breaking lords\' doors, digging deeper than ever, and filling barrows in. It never goes down.',
      trophies: 'Trophies',
      keys:     'What rank gives you',
      unknown:  '???',
      unmet:    'Break the door to keep it.',
      atRank:   'Rank {n}',
    },

    // THE LINE AT THE TOP. One rung of the ordered list in src/advice.js,
    // filled with figures read off the run as it stands. Every key here is
    // reachable and every key that file can return has a line here; the
    // suite checks both ways. Keep them short enough to read at a glance.
    compass: {
      room:      'A room is open. Pick one; it lasts the rest of this barrow.',
      lord:      '{Name} is waiting. Pick one of {his} gifts.',
      gate:      "Somebody's at the gate. They go in {t}.",
      dig:       'Press Dig. Every {n} presses turns up a bone, and bones raise the dead.',
      sell:      "You're holding {n} {name}, worth {coin}. Press Sell.",
      raise:     '{Bones} bones in hand and a digger costs {cost}. Press Raise.',
      raiseMore: '{Bones} bones will raise {n} more diggers. Nothing else uses bones.',
      face:      "Nothing's digging down. Send some of them to {name} and they break into {next}.",
      move:      '{From} pays {low} coin/s and {name} pays {high}. Send more of them down.',
      seal:      'Fill in now for {n} relics: enough for {Name} ({cost}), kept forever.',
      sealBeats: 'Fill in now for {n} relics: enough for {Name} ({cost}), kept forever. {Buy} ({coin}) would be buried with this barrow.',
      oath:      '{N} relics banked. {Name} costs {cost}, kept forever.',
      rite:      '{Name}: {cost}. {line}.',
      wait:      "{Name} costs {cost}. At {rate}, that's {t}.",
      work:      '{Name} pays the most: {coin} coin/s.',
      bones:     '{Name} is turning up {bones} bones a second.',
      idle:      'Nothing is digging yet.',
      go:        'Show me',
      tip:       'The one thing most worth doing now',
    },
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
  // Raising costs BONES only, and how FAST a digger works never changes how
  // many bones it turns up, so buying speed never buys growth. Deeper ground
  // holds more of the dead, in a straight line, which is the whole reason to
  // send them down rather than sideways.
  //
  // Coin does reach the horde, through two rites and two oaths: what a bone
  // raises, and how much the ground gives up. Both scale how fast the horde
  // grows and neither scales how fast THAT rate grows, so the horde stays
  // linear in time. That is the line: a multiplier on the slope is fine, a
  // multiplier on the multiplier runs the game away inside a day.
  // -------------------------------------------------------------------------
  horde: {
    digRate: 1,          // units per second per digger, at hardness 1
    boneShare: 0.03,     // bones per digger-second in the surface layer
    bonePerLayer: 0.35,  // and this much again for every layer below it, so the
                         // deep is where the dead are without the growth ever
                         // compounding on itself
    boneCostBase: 1,     // bones for the first raise
    boneCostSoft: 25,    // cost climbs as 1 + n / soft: doubles at this many
    bulk: [1, 10, 100],  // the raise buttons, plus max
    hideHandAt: 10,      // the dig button goes when the horde reaches this
    faceShownAt: 3,      // the way-down row appears at this many
    maxWeight: 5,        // weight notches per row
    activeStrata: 5,     // layers kept open behind the face; the wider workings
                         // rite adds to this
    weightNew: 5,        // weight a newly opened layer starts on
    // Every time a layer opens, the layers above it step back by this much,
    // down to nothing, so the horde follows the work down without being told
    // to. A layer whose weight the player has set by hand is never moved
    // again. Deep ground is worth more per digger and its market is nowhere
    // near full, while a shallow one is a thousand times over what its buyers
    // will take, so an untouched panel spread evenly earns about half what the
    // same horde earns leaning down.
    weightDecay: 1,
    weightFace: 2,       // where the way down starts when it is set by hand
    // The share of the diggers kept on the way down when the game is doing
    // the splitting. Everything the open layers cannot use goes down on top
    // of this, so a big crew opens ground fast and a small one still moves.
    faceFloor: 0.25,
  },

  // -------------------------------------------------------------------------
  // STRATA - the ground, layer by layer, forever
  //
  // Stratum k is hardnessGrowth^k times harder to dig than the surface and its
  // good is worth valueGrowth^k times soil. Breaking into stratum k+1 means
  // digging capBase * capGrowth^k units at the harder rate. The seam a layer
  // carries then bends all four of those numbers.
  // -------------------------------------------------------------------------
  strata: {
    hardnessGrowth: 2.5,
    valueGrowth: 3.5,
    capBase: 12,
    capGrowth: 1.6,      // ordinary floors thicken this much a layer; the doors carry the weight (lords.doorThickness)
    // The ladder stops climbing here. Every layer past it is worth, costs and
    // holds what the horizon layer does, so the numbers stay inside a double
    // forever. It sits hundreds of layers below anything reachable: each layer
    // takes about twice as long as the one above it, so this is insurance
    // against a config turned by hand, not a wall a player can walk into.
    horizon: 400,
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
    prefixes: ['old', 'deep', 'black', 'cold', 'pale', 'red', 'nameless', 'kings', 'drowned', 'burnt'],

    // How deep each narrative band reaches. The band a layer falls in decides
    // which chambers it can open and how the ground is described.
    bands: [3, 9, 15, 23],
  },

  // -------------------------------------------------------------------------
  // SEAMS - what makes one layer worth working differently from the next
  //
  // Every layer below the surface rolls one of these from the run's seed, or
  // none at all. The numbers are multipliers on that layer only: what its
  // good is worth, how hard it digs, how much its market takes, how far its
  // price swings, how many of the dead are in it, and how much floor stands
  // between it and the layer below.
  //
  // `weight` is how often the seam comes up relative to the others.
  // -------------------------------------------------------------------------
  seams: {
    from: 1,             // the surface never carries one
    chance: 0.78,        // share of layers that carry a seam at all
    list: [
      { id: 'rich',      weight: 10, value: 2.2 },
      { id: 'dense',     weight: 8,  value: 2.8, hardness: 1.8 },
      { id: 'brittle',   weight: 9,  value: 0.6, hardness: 0.5 },
      { id: 'bonefield', weight: 9,  value: 0.7, bones: 3.2 },
      { id: 'thin',      weight: 8,  value: 1.8, absorb: 0.4 },
      { id: 'wide',      weight: 8,  absorb: 2.8 },
      { id: 'salted',    weight: 7,  swell: 2.8 },
      { id: 'still',     weight: 6,  value: 1.2, swell: 0.15 },
      { id: 'hollow',    weight: 8,  cap: 0.35 },
      { id: 'sealed',    weight: 6,  value: 1.7, cap: 2.6 },
      { id: 'flooded',   weight: 7,  value: 1.4, hardness: 2.0, bones: 2.2 },
      { id: 'burnt',     weight: 6,  value: 1.9, absorb: 0.7, cap: 0.7 },
    ],
  },

  // -------------------------------------------------------------------------
  // CHAMBERS - the rooms the shaft breaks into on the way down
  //
  // Not every layer is ground. Every `every` layers the dead come through
  // into something built, and the run stops for a scene and a choice of two.
  // The choice is a permanent multiplier for the rest of that run.
  // -------------------------------------------------------------------------
  chambers: {
    at: [3, 7],     // rooms sit this many layers into every lord's ten
    // Which of the writing's room pools each lord's layers draw from. A pool
    // is dealt in order across a barrow, so no room repeats before the rest
    // of its pool has been shown.
    pools: { rex: [0, 1], mortifer: [4], other: [2, 3] },
    windfallCap: 3600,   // a windfall pays at most this many seconds of income
    // A room that hands over the dead hands over this many seconds of the
    // horde's own growth, not a share of the horde. A share would multiply the
    // horde every few layers, which is an exponential in depth, and every
    // exponential in depth eventually eats the game.
    diggerSeconds: 3600,
  },

  // -------------------------------------------------------------------------
  // THE LORDS - who is under the hill, ten layers at a time
  //
  // The ground is cut into stretches of `every` layers. Each stretch belongs
  // to one lord of the dead: its materials are his, its one rule holds in all
  // of it, and the floor under its last layer is his DOOR - `doorThickness`
  // ordinary floors deep. Breaking it pays his hoard on the spot, puts him in
  // front of the player with two gifts to choose from, and the first time a
  // player ever breaks a given lord's door his trophy is theirs for good.
  //
  // The first door is always Rex Mortis and every fifth is Mortifer. The three
  // between are dealt from `rotating` by the barrow's seed, so every barrow
  // meets different lords. Past Mortifer the round starts again with every
  // lord in the deal, one pass harder: each pass adds one affix, and an affix
  // makes a door thicker and a hoard richer together.
  //
  // `rule` bends every layer in the stretch the way a seam bends one layer
  // (value, hardness, absorb, bones, swell, cap), plus visitGap, which moves
  // how often callers come while the dig is in that stretch.
  // -------------------------------------------------------------------------
  lords: {
    every: 10,
    first: 'rex',
    last: 'mortifer',
    round: 5,               // doors in a round: the first, three dealt, the last
    rotating: ['pater', 'rey', 'dona', 'sepulturero', 'neb', 'natron'],
    doorThickness: 24,      // a door is this many ordinary floors deep
    hoardSeconds: 1800,     // coin a broken door pays: this much of the income
    hoardRelics: 10,        // relics it pays, times which door of the round it is
    newDepthRelics: 3,      // relics for every layer deeper than the player has ever been
    // What the trophies do, where a number is involved.
    trophy: {
      startLayers: 3,       // Rex Mortis's: barrows start this many layers down
      boneCartSeconds: 90,  // Pater Ossium's: a cart of this many seconds of bones per layer
      doorEase: 2,          // El Sepulturero's: doors give way this many times faster
      carryShare: 0.01,     // Mother Natron's: this share of the dead come to the next barrow
      hoardMult: 2,         // Mortifer's: every hoard is this many times bigger
    },
    affixes: [
      { id: 'elder',     door: 2,   hoard: 2 },
      { id: 'crowned',   door: 3,   hoard: 3 },
      { id: 'hungry',    door: 1.5, hoard: 2, eats: 0.01 },   // share of the way-down crew he takes a minute
      { id: 'ironbound', door: 2.5, hoard: 2.5 },
      { id: 'jealous',   door: 1.5, hoard: 2, value: 0.5 },
      { id: 'wrathful',  door: 1.5, hoard: 2, visitGap: 4 },
    ],
    list: {
      rex: {
        color: '#c9a05a',    // his mark: his door, his name, his scene
        rule: {},
        materials: [
          ['soil', '#6b4f3a'], ['clay', '#9a6a4a'], ['flint', '#7d7a72'], ['peat', '#5a4f35'],
          ['coal', '#56565e'], ['tin', '#9aa3a8'], ['copper', '#b87333'], ['bronze', '#b08d57'],
          ['iron', '#8c8c90'], ['silver', '#c0c6cc'],
        ],
        gifts: [{ diggers: 2.0 }, { dig: 2 }],
      },
      pater: {
        color: '#e6dcc4',    // his mark: his door, his name, his scene
        rule: { bones: 3, value: 0.6 },
        materials: [
          ['chalk', '#e8e4d8'], ['lime', '#d6d2b8'], ['bone', '#d9cdb4'], ['horn', '#8a6f4e'],
          ['fossil', '#a89878'], ['ivory', '#f1e6cf'], ['jet', '#3a3a42'], ['amber', '#d08a2a'],
          ['opal', '#cfe3e0'], ['pearl', '#efe9df'],
        ],
        gifts: [{ bones: 2 }, { soft: 2 }],
      },
      rey: {
        color: '#c9433a',    // his mark: his door, his name, his scene
        rule: { value: 2.2 },
        materials: [
          ['lead', '#5f6670'], ['zinc', '#9ea7ad'], ['pyrite', '#c9b04a'], ['galena', '#7b8190'],
          ['nickel', '#a3a08f'], ['cinnabar', '#b3302a'], ['quicksilver', '#d0d4d8'], ['cobalt', '#3f6fb8'],
          ['platinum', '#d8dde3'], ['palladium', '#bfc3c8'],
        ],
        gifts: [{ value: 2 }, { absorb: 3 }],
      },
      dona: {
        color: '#f0a030',    // his mark: his door, his name, his scene
        rule: { visitGap: 0.5 },
        materials: [
          ['obsidian', '#3a3340'], ['agate', '#b0634a'], ['jasper', '#9c3b2e'], ['jade', '#4f9a6a'],
          ['turquoise', '#3fb5b0'], ['fire opal', '#e0662a'], ['garnet', '#a3283a'], ['topaz', '#e3a33a'],
          ['gold', '#d9b23f'], ['emerald', '#2e9e5b'],
        ],
        gifts: [{ windfall: 3600, value: 1.5 }, { diggers: 3 }],
      },
      sepulturero: {
        color: '#8fa0b0',    // his mark: his door, his name, his scene
        rule: { cap: 0.5 },
        materials: [
          ['slate', '#4d5560'], ['sandstone', '#c29a6b'], ['granite', '#8a8480'], ['basalt', '#3d3f44'],
          ['marble', '#e6e2dc'], ['alabaster', '#efe8dc'], ['travertine', '#d8c9a8'], ['onyx', '#2b2b2e'],
          ['porphyry', '#7a2e4a'], ['diorite', '#9a9a96'],
        ],
        gifts: [{ face: 2.5 }, { dig: 2 }],
      },
      neb: {
        color: '#4a78d8',    // his mark: his door, his name, his scene
        rule: { value: 3, absorb: 0.35 },
        materials: [
          ['sand', '#d8bf8a'], ['ochre', '#c7862f'], ['gypsum', '#ece6d6'], ['malachite', '#2f8f62'],
          ['carnelian', '#c24a2a'], ['amethyst', '#8e5bb5'], ['lapis', '#2c4f9e'], ['feldspar', '#d4b8a0'],
          ['electrum', '#d8c070'], ['meteor iron', '#6a6e78'],
        ],
        gifts: [{ value: 2.5 }, { absorb: 2.5, value: 1.5 }],
      },
      natron: {
        color: '#d8d0b0',    // his mark: his door, his name, his scene
        rule: { hardness: 0.6 },
        materials: [
          ['salt', '#eeeeea'], ['natron', '#e2dcc6'], ['alum', '#dfe6e8'], ['sulfur', '#d8cc3a'],
          ['resin', '#b5712a'], ['myrrh', '#8a4a2a'], ['frankincense', '#d8b878'], ['bitumen', '#2a2624'],
          ['naphtha', '#5a4a2a'], ['pitch', '#1e1b1a'],
        ],
        gifts: [{ soft: 2.5 }, { bones: 2 }],
      },
      mortifer: {
        color: '#e0552e',    // his mark: his door, his name, his scene
        rule: { value: 2, bones: 2, hardness: 1.4 },
        materials: [
          ['ash', '#8a8680'], ['cinder', '#6a3326'], ['soot', '#2c2828'], ['pumice', '#b8b2a8'],
          ['slag', '#4a4040'], ['brimstone', '#d8b02a'], ['bloodstone', '#3a5a3a'], ['star ruby', '#c81f3a'],
          ['black diamond', '#34343f'], ['adamant', '#a8b8d0'],
        ],
        gifts: [{ dig: 3, face: 2 }, { value: 3, bones: 2 }],
      },
    },
  },

  // -------------------------------------------------------------------------
  // HILLS - where the next barrow is dug
  //
  // Filling a barrow in opens the next one on a new hill. With the rank for
  // it, the player picks that hill from two or three, each with a twist that
  // holds in every layer of it: the same keys a lord's rule bends (value,
  // hardness, absorb, bones, cap), plus visitGap for callers and soft for how
  // far a bone goes. Without the rank it is a plain hill.
  // -------------------------------------------------------------------------
  hills: {
    plain: 'plain',
    list: [
      // `tint` is what the mound looks like from the field above.
      { id: 'plain',   rule: {} },
      { id: 'drowned', rule: { bones: 2, cap: 1.3 },          tint: '#2f5566' },
      { id: 'kings',   rule: { value: 1.6, cap: 1.25 },       tint: '#8a6a2e' },
      { id: 'plague',  rule: { soft: 2, value: 0.8 },         tint: '#56643a' },
      { id: 'burned',  rule: { absorb: 2, visitGap: 2 },      tint: '#1a1210' },
      { id: 'road',    rule: { visitGap: 0.5, value: 0.85 },  tint: '#6a5838' },
      { id: 'stony',   rule: { value: 2, hardness: 1.5 },     tint: '#62646c' },
      { id: 'soft',    rule: { hardness: 0.7, value: 0.75 },  tint: '#5e4632' },
    ],
  },

  // -------------------------------------------------------------------------
  // RANKS - what the player is, and it never goes back down
  //
  // Points come from breaking doors (more the first time a lord is met),
  // from every layer deeper than the player has ever been, and from filling a
  // barrow in. A rank is a grade and a title: four grades to a title, ten
  // titles, and past the last one the Rex title counts deeps forever.
  // `need(n)` is the points rank n takes: step * (n - 1) + (n - 1) squared.
  // Each rank in `keys` hands over one thing.
  // -------------------------------------------------------------------------
  ranks: {
    step: 4,
    points: { newDepth: 1, door: 3, firstLord: 10, sealPer: 5 },
    grades: ['Under-', '', 'High ', 'Grand '],
    titles: ['Fossor', 'Sexton', 'Capataz', 'Custos', 'Mortenant', 'Nomarch', 'Psychopomp', 'Tumularch', 'Virrey', 'Rex'],
    keys: [
      { rank: 3,  id: 'ledger' },
      { rank: 5,  id: 'broker' },
      { rank: 6,  id: 'hillTwo' },
      { rank: 7,  id: 'readTwo' },
      { rank: 9,  id: 'foresight' },
      { rank: 11, id: 'autoBuy' },
      { rank: 13, id: 'hillThree' },
      { rank: 14, id: 'assay' },
      { rank: 16, id: 'hoardPlus' },
      { rank: 17, id: 'broker2' },
      { rank: 20, id: 'autoSeal' },
      { rank: 25, id: 'bothGifts' },
      { rank: 40, id: 'lordHoard' },
    ],
  },

  // -------------------------------------------------------------------------
  // VISITORS - who comes up the track while the work goes on
  //
  // One at a time, at long gaps, and never on a clock the player has to beat:
  // a visitor waits a good while and then leaves, and another comes. Nothing
  // here is lost by being away, and nothing here is required.
  // -------------------------------------------------------------------------
  visitors: {
    firstAt: 240,        // seconds into a run before the first one
    gapMin: 200,
    gapMax: 520,
    stay: 300,           // seconds a visitor waits at the gate
    buyer: {
      multMin: 2.5,      // times base price, and the market's mood is ignored
      multMax: 7,
      seconds: 300,      // takes about this many seconds of the good's best flow
    },
    bonecart: {
      seconds: 180,      // bones worth about this many seconds of bone income
      priceSeconds: 90,  // and costs about this many seconds of coin income
      floor: 40,         // never fewer bones than this
    },
    gang: {
      // Free diggers, priced the same way a chamber prices them: seconds of
      // the growth the horde is already managing. Never a share of the horde,
      // which would compound every time somebody walked up the track.
      secondsMin: 400,
      secondsMax: 1400,
      floor: 4,
    },
    reeve: {
      seconds: 240,      // costs about this many seconds of income
      absorb: 1.18,      // paid: every market takes this much more for the run
      sting: 0.7,        // refused: one market carries this much pressure
      max: 5,            // and he only has this many arrangements to sell
      priceGrowth: 2.5,  // each dearer than the last
    },
    relic: {
      seconds: 600,      // costs about this many seconds of income
      boonMin: 1.12,     // and gives a permanent multiplier in this range
      boonMax: 1.3,
      // A barrow holds only so many of these. Anything that hands out a
      // permanent multiplier on a timer compounds with the clock, and a run
      // left open overnight would come back with a number nobody chose.
      max: 8,
      priceGrowth: 3,
    },
    surveyor: {
      reads: 4,          // reveals the seams of this many layers below the face
      seconds: 60,
    },
    mourner: {
      seconds: 120,      // leaves about this many seconds of income on the heap
    },
  },

  // -------------------------------------------------------------------------
  // THE MARKET - one price per good, and what moves it
  //
  // price = base * swell(t) * exp(-pressure). Selling q units adds q/absorb to
  // pressure, buying takes it away, and pressure drains back toward zero over
  // recoverySeconds. The swell is a slow, deterministic wave around the base:
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
    buyShare: 0.1,           // a buy takes this share of what the market holds
    lotShare: 0.5,           // the lot button sells this share of what it takes;
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
  // Each is a level with a cost that grows by `growth` per level. A rite with
  // an `atDepth` does not appear until the shaft is that deep, however much
  // coin is in hand, so the list keeps growing as the hole does.
  //
  // The costs climb steeply on purpose. A level is meant to be a decision an
  // hour or two apart, not a thing that is bought and then forgotten, and the
  // rites that feed the face are the steepest of all: anything that speeds up
  // breaking new ground compounds with the depth it unlocks.
  //
  // The effects: hands multiplies dig speed; grave multiplies how far bones
  // go; pits multiplies how many of the dead the ground gives up; picks
  // multiplies how fast the face gives way; routes multiplies what every
  // market takes; haste multiplies how fast every market forgets; workings
  // keeps another layer open; crier brings visitors sooner and richer; vigil
  // adds hours to the time the dead work alone; records pay relics when the
  // barrow is filled in; ledger, assay, foresight and survey buy information;
  // the factor sells for you.
  //
  // The depths the last seven are held back to are the schedule the list
  // arrives on. Set at four to eight they were all in hand inside a quarter
  // of an hour and everything after that was the same five rows getting
  // dearer. Spread to twenty one they keep opening through a first evening,
  // and a new barrow walks the ladder again.
  // -------------------------------------------------------------------------
  rites: {
    handsFactor:  1.5,
    graveFactor:  1.5,
    picksFactor:  1.25,
    routesFactor: 1.5,
    hasteFactor:  1.25,
    // The ground gives up this much more of the dead per level, and it stops
    // after twelve of them. Anything bought with coin that multiplies the
    // bones multiplies the horde, which multiplies the depth, which multiplies
    // the coin; left uncapped at 1.45 it moved a week of play from layer 34 to
    // layer 44 and ran the numbers past every suffix the game has. Twelve
    // levels is a fifty-six times boost that arrives deep and then ends.
    pitsFactor:   1.4,
    crierGap:     0.85,   // visitor gap per level
    crierPay:     1.25,   // visitor generosity per level
    vigilHours:   4,      // offline hours added per level
    surveyReads:  5,      // layers below the cut named ahead of time
    recordsRelics: 3,     // relics per level, paid when the barrow is filled in
    list: [
      { id: 'hands',     cost: 40,      growth: 8,    max: 200 },
      { id: 'grave',     cost: 60,      growth: 8,    max: 200 },
      { id: 'ledger',    cost: 110,     growth: 1,    max: 1 },
      { id: 'picks',     cost: 260,     growth: 12,   max: 120 },
      { id: 'broker',    cost: 400,     growth: 14,   max: 4 },
      { id: 'routes',    cost: 900,     growth: 7,    max: 150 },
      { id: 'haste',     cost: 1800,    growth: 7,    max: 100 },
      { id: 'foresight', cost: 4000,    growth: 1,    max: 1 },
      { id: 'crier',     cost: 12000,   growth: 9,    max: 6,   atDepth: 4 },
      { id: 'assay',     cost: 30000,   growth: 1,    max: 1,   atDepth: 6 },
      { id: 'vigil',     cost: 120000,  growth: 14,   max: 5,   atDepth: 9 },
      { id: 'workings',  cost: 600000,  growth: 70,   max: 5,   atDepth: 11 },
      { id: 'survey',    cost: 2e12,    growth: 1,    max: 1,   atDepth: 13 },
      { id: 'records',   cost: 5e13,    growth: 6,    max: 10,  atDepth: 17 },
      { id: 'pits',      cost: 1e16,    growth: 8,    max: 12,  atDepth: 21 },
    ],
    // The factor by level: the share of each market's best flow it sells into
    // every second, its cut, and how choosy it is about the swell. It never
    // touches bones - raising them is the player's decision and nothing sells
    // the horde out from under a click.
    broker: [
      { flow: 0.40, fee: 0.14, above: 0 },
      { flow: 0.75, fee: 0.07, above: 0 },
      { flow: 1.00, fee: 0.03, above: 1.0 },
      { flow: 1.30, fee: 0.01, above: 1.05 },
    ],
    // A rite is shown once coin reaches this share of its cost.
    showAtShare: 0.35,
  },

  // -------------------------------------------------------------------------
  // FILLING IT IN - closing a barrow, and what carries to the next one
  //
  // Filling a barrow in ends a run and pays relics. Relics buy the permanent
  // upgrades below, which hold across every barrow after it. The formula is
  // meant to be readable on the panel: so much per layer past the first ones,
  // so much per order of magnitude of coin ever earned.
  // -------------------------------------------------------------------------
  seal: {
    unlockDepth: 14,     // the shaft must reach this before filling in is offered
    fromDepth: 9,        // layers past this one pay relics
    perStratum: 3,
    earnFloor: 1e7,      // coin earned past this pays by the decade
    perDecade: 2,
  },

  // -------------------------------------------------------------------------
  // OATHS - permanent, bought with relics, kept forever
  // -------------------------------------------------------------------------
  oaths: {
    list: [
      { id: 'dead',    cost: 3,  growth: 2.4, max: 12 },
      { id: 'hands',   cost: 4,  growth: 2.2, max: 25 },
      { id: 'marrow',  cost: 4,  growth: 2.2, max: 25 },
      { id: 'purse',   cost: 3,  growth: 2.6, max: 15 },
      { id: 'roads',   cost: 5,  growth: 2.4, max: 20 },
      { id: 'depth',   cost: 5,  growth: 2.5, max: 20 },
      { id: 'ground',  cost: 8,  growth: 3.0, max: 10 },
      { id: 'books',   cost: 6,  growth: 4.0, max: 3 },
      { id: 'calling', cost: 7,  growth: 3.0, max: 6 },
      { id: 'night',   cost: 9,  growth: 3.0, max: 8 },
    ],
    deadBase: 8,         // diggers to begin with, times deadGrowth per level
    deadGrowth: 4,
    handsFactor: 1.35,   // dig speed per level
    marrowFactor: 1.4,   // bones per level
    roadsFactor: 1.35,   // what every market takes, per level
    depthFactor: 1.35,   // how fast the face gives way, per level
    purseBase: 500,      // coin to begin with, times purseGrowth per level
    purseGrowth: 8,
    nightHours: 8,       // offline hours added per level
    callingGap: 0.82,    // visitor gap per level
    callingPay: 1.25,    // visitor generosity per level
    // What the books remember, one rite per level, in this order.
    booksRites: ['ledger', 'foresight', 'broker'],
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
    bandHeight: 150,       // px per stratum until the field runs out of room; a
                           // shallow dig fills the frame rather than sitting in
                           // a strip at the top of an empty page
    // The absolute floor a band shrinks to. Fitting the whole dig into the
    // frame wins over readability: held at twelve, a phone at seventeen
    // layers pushed the deepest six and the face off the bottom of a two
    // hundred pixel field, which is the part worth looking at.
    minBandHeight: 2,
    // The picture follows the dig: this many of the deepest layers get full
    // bands, everything above them is pressed into a thin stack at the top
    // (historyBand pixels a layer, never more than historyShare of the frame),
    // and up to aheadMax known layers below the floor are drawn and named.
    focusLayers: 6,
    historyBand: 3,
    historyShare: 0.2,
    aheadMax: 10,
    labelBandHeight: 17,   // below this a band is too thin to write its name in
    seamBandHeight: 24,    // and below this there is no room for its seam too
    surfaceHeight: 46,     // the sky, the mound and the spoil heap
    particleCap: 2200,     // dots drawn; past this the mass is conveyed by density
    pixelsPerDot: 380,     // and never more than one dot per this many pixels of
                           // field, so a phone's strip does not fill with bone
    particleSize: 1.6,
    tunnelSegments: 260,   // carve segments per stratum, revealed as it is dug
    carveScale: 60,        // units dug for the first ~63% of a stratum's carve
    shaftWidth: 3,
    glintCount: 14,        // mineral glints per band, in the good's color
  },

  // -------------------------------------------------------------------------
  // PALETTE
  // -------------------------------------------------------------------------
  palette: {
    void:   '#07080b',
    panel:  '#0d0f14',
    rule:   '#1b1f28',
    ink:    '#d7dbe3',
    dim:    '#707886',
    quiet:  '#5d6575',
    bone:   '#d9cdb4',
    coin:   '#c9a95a',
    hot:    '#c8553d',
    good:   '#6fb08a',
    deepink:'#9a86c8',
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
    build: 33,
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
// The document carries the game's name and colors in a few places. This puts
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
  setVar('--deepink', p.deepink);

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
  put('lbl-rem',    t.stats.rem);
  put('dig',        t.dig);
  put('sell',       t.sell);
  put('export',     t.export);
  put('import',     t.import);
  put('reset',      t.reset);
  put('p-horde',    t.panels.horde);
  put('p-market',   t.panels.market);
  put('p-rites',    t.panels.rites);
  put('p-visitor',  t.panels.visitor);
  put('chamber-title', t.panels.chamber);
  put('p-seal',     t.panels.seal);
  put('p-oaths',    t.panels.oaths);
  put('fieldhint',  t.fieldHint);

  // The tab icon is drawn from the palette rather than shipped as a file, so a
  // recolor needs no asset and the game still has no binary dependencies.
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
