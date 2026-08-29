// ===========================================================================
// CONFIGURATION
//
// Every number worth turning and every word on the furniture lives here.
// Nothing in this file is read more than once per load, so a change takes
// effect on refresh and nothing here needs a build step.
//
// HOW TO RENAME THE GAME
//   Set identity.name. That retitles the tab, the header and the machine
//   plate, and every sentence that names the game reads it from here. A few
//   candidates are parked in identity.alternates; moving one into name is the
//   whole rename. Leave identity.storagePrefix alone if saves from the old
//   name should carry over.
//
// HOW TO TRY A NUMBER WITHOUT EDITING THIS FILE
//   Append overrides to the address:
//     ?set=fever.balls=200&set=launch.perMinute=400
//   They last for that page load. To pin one in this browser, in the console:
//     localStorage.setItem('cfg', '{"fever":{"balls":200}}')
//   Clear it with localStorage.removeItem('cfg'). Set dev.allowOverrides to
//   false to switch both off.
// ===========================================================================

export const CONFIG = {

  // -------------------------------------------------------------------------
  // IDENTITY
  // -------------------------------------------------------------------------
  identity: {
    name: 'Brass Rain',
    tagline: 'One lamp, seven hundred nails, and a tray that never fills itself.',
    storagePrefix: 'brassrain',

    // Parked names. Any of these can take the place of name above with no
    // other change anywhere.
    alternates: [
      'Brass Rain',
      'Kugishi',        // the craftsman who sets the nails
      'The Nail Room',
      'Oxblood',
      'Ten Thousand Nails',
      'Silver Tray',
      'Fever Line',
      'Lacquer',
      'The Parlour Floor',
      'Chrome and Brass',
    ],
  },

  // -------------------------------------------------------------------------
  // WORDS - every label on the furniture, so the whole game can be reworded
  // from one place and so nothing is spelled twice.
  // -------------------------------------------------------------------------
  text: {
    ball:       'ball',
    balls:      'balls',
    tray:       'Tray',
    scrip:      'Scrip',
    marks:      'Marks',
    quota:      'Quota',
    round:      'Round',
    launch:     'Launch',
    strength:   'Strength',
    auto:       'Auto',
    fever:      'FEVER',
    gate:       'Gate',
    attacker:   'Attacker',
    shop:       'The Bench',
    fittings:   'Fittings',
    fitting:    'Fitting',
    machines:   'The parlour',
    machine:    'Machine',
    attendant:  'Attendant',
    cashOut:    'Cash out',
    reroll:     'Reroll',
    skip:       'Leave the bench',
    best:       'Best',
    speed:      'Speed',
    pause:      'Pause',
    resume:     'Resume',
    help:       'Help',
    newRun:     'New run',
    settings:   'Settings',

    // Sentences. Braces are filled in at the point of use.
    firstLine:  'Turn the handle. Balls arc over the top and fall through the nails. Most are lost. The gate in the middle is the one that matters.',
    quotaLine:  '{have} of {need}',
    roundWon:   'Round {n} cleared.',
    roundLost:  'The tray ran out {short} short.',
    feverOn:    'Fever - the attacker is open for {n} balls.',
    feverOff:   'The attacker closed.',
    gateHit:    'Through the gate.',
    reelMiss:   'The reels missed.',
    cashOutAsk: 'Cash out {balls} balls for {scrip} scrip? The run ends here.',
    emptyTray:  'The tray is empty.',
  },

  // -------------------------------------------------------------------------
  // PALETTE - one warm family, one cool accent, built by eye in OKLCH and
  // written here as hex so the page can use them before any module runs.
  // -------------------------------------------------------------------------
  palette: {
    lacquer:  '#2b0f12',   // the board ground, very dark warm red
    lacquer2: '#4a1a1c',   // where the lamp pools on it
    lamp:     '#f6e6c8',   // the single warm light
    brass:    '#b08637',
    brassLit: '#f0cf83',
    chrome:   '#9aa2a8',
    chromeLit:'#ffffff',
    enamel:   '#e9e6d6',   // plaque cream
    enamel2:  '#d5d1bd',
    jade:     '#4fa88a',   // the one cool accent, live values only
    oxblood:  '#5c1d20',   // lettering on enamel
    ink:      '#1a0c0d',
    dim:      '#8c7f76',
    rule:     '#7d5a2e',
  },

  // -------------------------------------------------------------------------
  // THE BOARD - geometry in board units. x runs 0..w left to right, y runs
  // 0..h top to bottom. One unit is about a third of a ball.
  // -------------------------------------------------------------------------
  board: {
    w: 100,
    h: 116,

    // The playable field inside the rails.
    fieldLeft: 6,
    fieldRight: 94,
    fieldTop: 12,
    fieldBottom: 112,

    // The nail lattice. Rows are staggered by half a column.
    // The lattice is laid at parlour proportions: a ball a little over two
    // units across, nails a little over three apart, and about seven hundred
    // of them on the face. A sparser board is easier to reason about and does
    // not look like a machine anybody built.
    pinRadius: 0.34,
    colStep: 3.2,
    rowStep: 2.75,
    rowsTop: 13,          // first nail row, in board units from the top
    rows: 33,             // laid past the plates; the clearance check trims
                          // whatever would stand too close to one

    // Nails are not laid out by machine. Every row leans a little and a few
    // nails are pulled aside, and the lean is what makes one board play
    // differently from the next.
    leanMax: 0.40,
    jitterMax: 0.34,

    // The reel counter is set into the lacquer above the gate. Nails are kept
    // out of it, because a nail drawn under a counter is a nail a player
    // cannot see and a ball can still hit.
    reel: { x: 50, y: 34.8, w: 13.5, h: 5.4 },

    // How far a nail head will lean. A board is set by thousandths of an inch
    // in a parlour; here it is a fraction of a ball, which is small enough
    // that one nail is a nudge and large enough that six are a plan.
    bendReach: 0.95,
    bendsPerRound: 3,

    // The funnel of nails that feeds the gate, and the shoulders that guard it.
    gateFunnelRows: 3,
    gateFunnelWidth: 9,

    // Pockets.
    // A mouth is barely wider than a ball. That is what makes a board a board
    // rather than a funnel, and every pocket here is measured in balls: the
    // pay mouths take a ball with about a third of a ball to spare, the gate
    // is tighter still, and the attacker is wide because it is only ever open
    // during a fever.
    //
    // These are the DEFAULTS. A cabinet picks a layout from the list below and
    // overrides them, so two machines on the floor are different objects
    // rather than the same object nailed slightly differently.
    gate:      { x: 50, y: 74, w: 3.20, h: 1.42 },
    attacker:  { x: 50, y: 97, w: 10.5, h: 2.13 },
    payPockets: [
      { id: 'side0',  x: 17, y: 62, w: 2.73, h: 1.30, pay: 1, tone: 'enamel' },
      { id: 'side1',  x: 83, y: 62, w: 2.73, h: 1.30, pay: 1, tone: 'enamel' },
      { id: 'cream0', x: 31, y: 86, w: 3.00, h: 1.30, pay: 2, tone: 'enamel' },
      { id: 'cream1', x: 69, y: 86, w: 3.00, h: 1.30, pay: 2, tone: 'enamel' },
      { id: 'jade',   x: 50, y: 41, w: 2.18, h: 1.30, pay: 6, tone: 'jade' },
    ],

    // ------------------------------------------------------------------
    // THE CABINETS
    //
    // A parlour is a row of different machines, not one machine repeated. A
    // layout is a whole face: where the gate sits, what mouths are cut into
    // it, how the plates run, how tight the funnel is and how the nails are
    // laid. Two of these read as different objects across a room, which is
    // the point - a player walks the row and picks one.
    //
    // Every layout is measured before it ships: each has to resolve every
    // ball, keep the return under one without a fever, and put a findable
    // number of balls through its gate.
    // ------------------------------------------------------------------
    layouts: [
      {
        id: 'sea',
        baseReturn: 0.60,
        name: 'Sea',
        note: 'the plain one: a centre gate, shelves high and cream mouths low',
      },
      {
        id: 'tower',
        baseReturn: 0.80,
        name: 'Tower',
        note: 'a high gate under a long funnel, and everything else pushed low',
        gate: { x: 50, y: 58, w: 3.0, h: 1.42 },
        funnelRows: 5, funnelWidth: 11,
        payPockets: [
          { id: 'side0',  x: 13, y: 48, w: 2.9, h: 1.30, pay: 1, tone: 'enamel' },
          { id: 'side1',  x: 87, y: 48, w: 2.9, h: 1.30, pay: 1, tone: 'enamel' },
          { id: 'cream0', x: 27, y: 88, w: 3.2, h: 1.30, pay: 2, tone: 'enamel' },
          { id: 'cream1', x: 73, y: 88, w: 3.2, h: 1.30, pay: 2, tone: 'enamel' },
          { id: 'jade',   x: 50, y: 45, w: 2.1, h: 1.30, pay: 5, tone: 'jade' },
        ],
      },
      {
        id: 'shelf',
        baseReturn: 0.68,
        name: 'Shelf',
        note: 'four wide shelves either side and a gate that sits low and tight',
        gate: { x: 50, y: 88, w: 2.9, h: 1.42 },
        funnelRows: 3, funnelWidth: 8,
        attacker: { x: 50, y: 103, w: 12, h: 2.13 },
        payPockets: [
          { id: 'side0',  x: 15, y: 46, w: 3.4, h: 1.30, pay: 1, tone: 'enamel' },
          { id: 'side1',  x: 85, y: 46, w: 3.4, h: 1.30, pay: 1, tone: 'enamel' },
          { id: 'side2',  x: 20, y: 68, w: 3.4, h: 1.30, pay: 1, tone: 'enamel' },
          { id: 'side3',  x: 80, y: 68, w: 3.4, h: 1.30, pay: 1, tone: 'enamel' },
          { id: 'cream0', x: 34, y: 80, w: 2.8, h: 1.30, pay: 2, tone: 'enamel' },
          { id: 'cream1', x: 66, y: 80, w: 2.8, h: 1.30, pay: 2, tone: 'enamel' },
          { id: 'jade',   x: 50, y: 55, w: 1.9, h: 1.30, pay: 5, tone: 'jade' },
        ],
      },
      {
        id: 'twin',
        baseReturn: 0.53,
        name: 'Twin',
        note: 'two gates off the centre line, and no jade mouth at all',
        gate: { x: 32, y: 76, w: 3.1, h: 1.42 },
        extraGate: { x: 68, y: 76, w: 3.1, h: 1.42 },
        funnelRows: 3, funnelWidth: 9,
        payPockets: [
          { id: 'side0',  x: 12, y: 58, w: 2.8, h: 1.30, pay: 1, tone: 'enamel' },
          { id: 'side1',  x: 88, y: 58, w: 2.8, h: 1.30, pay: 1, tone: 'enamel' },
          { id: 'cream0', x: 50, y: 50, w: 3.6, h: 1.30, pay: 4, tone: 'enamel' },
          { id: 'cream1', x: 50, y: 88, w: 3.2, h: 1.30, pay: 3, tone: 'enamel' },
        ],
      },
      {
        id: 'well',
        baseReturn: 0.81,
        name: 'Well',
        note: 'a deep centre well: the jade mouth sits right above the gate',
        gate: { x: 50, y: 80, w: 3.3, h: 1.42 },
        funnelRows: 4, funnelWidth: 7,
        payPockets: [
          { id: 'side0',  x: 20, y: 54, w: 2.7, h: 1.30, pay: 1, tone: 'enamel' },
          { id: 'side1',  x: 80, y: 54, w: 2.7, h: 1.30, pay: 1, tone: 'enamel' },
          { id: 'cream0', x: 24, y: 84, w: 3.1, h: 1.30, pay: 2, tone: 'enamel' },
          { id: 'cream1', x: 76, y: 84, w: 3.1, h: 1.30, pay: 2, tone: 'enamel' },
          { id: 'jade',   x: 50, y: 66, w: 1.9, h: 1.30, pay: 5, tone: 'jade' },
        ],
      },
      {
        id: 'ladder',
        baseReturn: 0.67,
        name: 'Ladder',
        note: 'mouths stepped down the face in a line, cheapest at the top',
        gate: { x: 50, y: 92, w: 3.0, h: 1.42 },
        funnelRows: 2, funnelWidth: 8,
        attacker: { x: 50, y: 104, w: 11, h: 2.13 },
        payPockets: [
          { id: 'side0',  x: 30, y: 40, w: 3.0, h: 1.30, pay: 1, tone: 'enamel' },
          { id: 'side1',  x: 70, y: 52, w: 3.0, h: 1.30, pay: 1, tone: 'enamel' },
          { id: 'cream0', x: 26, y: 64, w: 3.0, h: 1.30, pay: 2, tone: 'enamel' },
          { id: 'cream1', x: 74, y: 76, w: 3.0, h: 1.30, pay: 3, tone: 'enamel' },
          { id: 'jade',   x: 50, y: 46, w: 2.1, h: 1.30, pay: 7, tone: 'jade' },
        ],
      },
    ],

    // The out lane across the bottom - everything that misses ends here.
    outY: 108,
  },

  // -------------------------------------------------------------------------
  // PHYSICS - a fixed step so a run replays the same way from the same seed.
  // -------------------------------------------------------------------------
  physics: {
    step: 1 / 120,        // seconds per simulation step
    maxSteps: 8,          // catch-up steps per frame before time is dropped
    gravity: 165,         // board units per second squared
    ballRadius: 0.80,
    restitution: 0.36,    // how much of the approach speed survives a nail
    tangent: 0.72,        // how much sideways speed survives a nail
    scatter: 0.30,        // sideways kick per nail, the reason two balls differ
    drag: 0.002,          // per step; the brass takes the energy, not the air
    restSpeed: 3.5,       // below this a contact is a ball lying against
                          // something rather than striking it, and the two are
                          // answered differently
    slide: 0.994,         // friction along a plate a ball is running down
    maxSpeed: 150,
    settleSpeed: 6,       // below this a ball resting on a nail is nudged off,
                          // because a ball balanced on a nail head is not a
                          // thing a real machine does and a stuck ball never
                          // resolves on its own
    nudge: 7,
    maxAge: 22,           // seconds before a ball in flight is written off, so
                          // no fault in the field can hold a launch forever
    // The outer rail: the arc a launched ball rides up the right side and
    // across the top before it drops into the field. Strength decides how far
    // around it gets, which is the whole of the handle.
    railCx: 50, railCy: 62, railR: 48,
    railFromDeg: -70,
    railToDeg: 166,
    railSpeed: 150,
    // A ball rolls off the end of the rail rather than being flung from it.
    // Measured: at full speed the handle only ever reaches one corner and the
    // peak gate rate is 4 percent; at a third the sweet spot is so strong it
    // stops being a game. At this the handle picks a side of the face and the
    // best setting is worth about eight times the worst.
    railExit: 0.6,
    maxLive: 4000,        // hard ceiling on balls in flight at once
  },

  // -------------------------------------------------------------------------
  // LAUNCHING - the handle. Strength decides how far left a ball carries
  // before it drops off the top rail, exactly as a real handle does.
  // -------------------------------------------------------------------------
  launch: {
    // The cadence of the handle. One ball a second, which is slow enough that
    // the opening reads as a machine sending single balls and steady enough
    // that it never reads as waiting. Fittings raise it; nothing lowers it.
    perMinute: 60,
    strength: 0.67,       // where the handle sits when a run starts,
                          // which is the best setting measured across boards
    strengthMin: 0.18,
    strengthMax: 1.0,
    // The machine's own slop. Measured: at a tenth of this the handle is a
    // knife edge - one setting in fifteen finds the gate at all - and at twice
    // it the handle stops mattering. Here a setting samples a band of the rail
    // wide enough to be findable and narrow enough to be worth finding.
    spread: 0.06,
    perLaunch: 1,         // balls sent per pull, raised by fittings
    cost: 1,              // balls taken from the tray per ball sent
  },

  // -------------------------------------------------------------------------
  // THE GATE, THE REELS AND THE FEVER - the heartbeat.
  // -------------------------------------------------------------------------
  reels: {
    digits: 10,
    // Which face is the seven. A cabinet has one, and parts that care about it
    // ask for it by name rather than by number.
    sevenDigit: 7,
    spinSeconds: 1.6,
    holdSeconds: 1.1,     // how long the result stays up
    // How many more sets of drums can turn at once, arranged around the centre
    // window. A spin that arrives while the centre is busy opens one of these
    // instead of waiting in line, so what the gate bought is paid during the
    // round rather than after the last ball has dropped. Past the ring a spin
    // waits, so no run can cover the face in windows.
    around: 6,
    // The published odds. A real cabinet prints these on the glass and this
    // one shows them on the plaque, because a machine that hides its odds and
    // a machine that advertises them are not the same kind of object.
    //
    // When the reels do not match they are drawn honestly and whatever they
    // show is what they landed on. Two of three turns up on its own about a
    // quarter of the time, and it is never arranged.
    matchChance: 0.11,
  },

  fever: {
    balls: 30,            // launches the attacker stays open for
    // Balls paid per ball into the open attacker. Measured: with the plates
    // feeding it, an open attacker takes about three quarters of everything
    // launched, so this number is close to the multiple a fever pays outright.
    attackerPay: 6,
    continueChance: 0.30, // chance a fever rolls straight into another
    lampWarm: 1.0,        // how far the lamp warms and brightens
  },

  // -------------------------------------------------------------------------
  // THE RUN - rounds, quotas and the tray.
  // -------------------------------------------------------------------------
  run: {
    // A round rents the machine for a fixed number of launches and asks for a
    // number of balls back. Both grow, and the launches grow slowly while the
    // demand grows fast, so what has to change is the machine rather than the
    // time spent at it. Twelve rounds is a night, and a night is about twenty
    // minutes.
    startTray: 100,
    rounds: 12,

    // Launches allowed in round n: budgetBase + budgetStep * n.
    budgetBase: 64,
    budgetStep: 4,

    // What round n asks for, as a share of what the budget would pay back at
    // the machine's own rate. Demand crosses 1.000 at round 4, which is the
    // first round a bare machine can lose, and keeps climbing after it. The
    // ratio is fixed rather than bending, so the curve is one number.
    quotaBase: 0,          // unused; the quota is derived from the budget
    demandBase: 0.62,
    demandGrowth: 1.1727,
    // What the face pays back with nothing bolted into it, measured over four
    // thousand balls at the default handle across eight boards. The quota is
    // derived from this, so measuring it rather than assuming it is what keeps
    // a round asking for the same effort after the face has been re-nailed.
    // What a cabinet pays back with nothing bolted in, used to derive its
    // quota. Each layout carries its own measured figure, so a thin board is
    // not asked for the same number of balls as a generous one; this is only
    // the fallback for a layout that has not declared one.
    baseReturn: 0.68,

    // Cleared rounds pay. This is the money the bench runs on, and it is
    // deliberately larger than the quota so that clearing early is worth more
    // than grinding the quota out exactly.
    clearBonus: 1.5,

    // Balls handed over at the start of a round on top of whatever survived
    // the last one. The tray is the wallet at the bench, not the fuel.
    trayGrant: 40,
    trayGrantGrowth: 1.06,
    carryOver: 1.0,

    // Balls sent by one pull of the handle, by round. A machine starts with
    // one ball on the glass at a time, which is the only way the opening reads
    // as a machine rather than a spray. Fittings add to it.
    ballsPerPull: [1, 1, 1, 2, 2, 3, 4, 6, 8, 11, 15, 20],
  },

  // -------------------------------------------------------------------------
  // THE BENCH - the between-round shop.
  // -------------------------------------------------------------------------
  shop: {
    offers: 3,
    rerollCost: 8,
    rerollGrowth: 1.5,
    slots: 5,             // fittings that can be bolted in at once
    // The four the catalogue actually files parts under. A weight named for a
    // rarity that does not exist is a set of parts nobody is ever offered.
    rarityWeights: { common: 62, uncommon: 26, rare: 10, brass: 2 },
  },

  // -------------------------------------------------------------------------
  // THE FLOOR - the parlour that earns while the handle is still.
  // -------------------------------------------------------------------------
  floor: {
    cashRate: 0.004,      // scrip per ball cashed out
    milestones: [10, 25, 50, 100, 200, 400],
    milestoneMult: 2,
    idleCap: 12 * 3600,   // seconds of away time that are ever paid out
    attendantRatio: 240,  // an attendant costs this many times the first unit

    // How much the floor is worth is decided at the handle. A player who never
    // sits down at a machine earns the floor's bare rate; one who plays deep
    // into a run multiplies everything the floor makes.
    handMultBase: 8,
    handMultPower: 1.35,

    // The ladder. Each rung costs about twelve times the one before it and
    // earns about four times as much, which is the shape that keeps every rung
    // worth buying for a while and none of them worth buying forever.
    machines: [
      { id: 'upright',  name: 'Upright Ten',   cost: 4,              income: 0.1,    ratio: 1.07 },
      { id: 'handle',   name: 'Handle Cabinet', cost: 60,            income: 0.5,    ratio: 1.15 },
      { id: 'digital',  name: 'Digital Sea',   cost: 720,            income: 2,      ratio: 1.14 },
      { id: 'drum',     name: 'Drum Row',      cost: 8640,           income: 8,      ratio: 1.13 },
      { id: 'twin',     name: 'Twin Attacker', cost: 103680,         income: 32,     ratio: 1.12 },
      { id: 'kakuhen',  name: 'Chain Bank',    cost: 1244160,        income: 128,    ratio: 1.11 },
      { id: 'silver',   name: 'Silver Hall',   cost: 14929920,       income: 512,    ratio: 1.10 },
      { id: 'corner',   name: 'Corner Stand',  cost: 179159040,      income: 2048,   ratio: 1.09 },
      { id: 'aisle',    name: 'The Long Aisle', cost: 2149908480,    income: 8192,   ratio: 1.08 },
      { id: 'tower',    name: 'Tower Floor',   cost: 25798901760,    income: 32768,  ratio: 1.07 },
    ],
  },

  // -------------------------------------------------------------------------
  // PRESTIGE - the technician comes in overnight and re-nails every board.
  // -------------------------------------------------------------------------
  prestige: {
    // marks = scale * (lifetime scrip / divisor) ^ exponent.
    //
    // The exponent sets the whole pace of the layer: at 0.5 the marks double
    // for every four times the scrip, which is too fast for a tree this size,
    // and at a third they double for every eight, which puts the fifth night
    // out past twenty hours. This sits between the two.
    divisor: 1e7,
    exponent: 0.45,
    scale: 4,
    minScrip: 1e6,
    minMarks: 12,
    minFraction: 0.25,
  },

  // -------------------------------------------------------------------------
  // QUALITY - the picture adapts to the machine it is running on, and the
  // player can override every part of that.
  // -------------------------------------------------------------------------
  quality: {
    targetFps: 60,
    targetChoices: [30, 45, 60, 90, 120, 144],
    scale: 1,             // 0 means let the game choose
    scaleMin: 0.5,
    scaleMax: 1,
    maxDpr: 2,
    warmSeconds: 5,       // frames before this are never measured
    sampleSeconds: 3,     // window the running average is taken over
    stepDown: 0.9,        // how far scale falls in one adjustment
    stepUp: 1.06,         // and how carefully it climbs back
    holdSeconds: 4,       // minimum time between adjustments
    auto: true,
    shadows: true,
    reflections: true,
    glass: true,
    maxBalls: 3000,       // drawn, not simulated
  },

  // -------------------------------------------------------------------------
  // SAVING
  // -------------------------------------------------------------------------
  save: {
    version: 1,
    everySeconds: 10,
  },

  dev: {
    allowOverrides: true,
    showStats: false,
  },
};

// ---------------------------------------------------------------------------
// Overrides. The address bar and one localStorage key can change any number
// above without editing the file, which is how a number is tried on a build
// that is already published.
// ---------------------------------------------------------------------------

function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = clone(v[k]);
    return o;
  }
  return v;
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!o[parts[i]] || typeof o[parts[i]] !== 'object') return false;
    o = o[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (!(last in o)) return false;
  const was = o[last];
  if (typeof was === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    o[last] = n;
  } else if (typeof was === 'boolean') {
    o[last] = value === 'true' || value === '1';
  } else {
    o[last] = value;
  }
  return true;
}

function merge(target, patch) {
  for (const k of Object.keys(patch || {})) {
    if (!(k in target)) continue;
    const a = target[k], b = patch[k];
    if (a && typeof a === 'object' && !Array.isArray(a) && b && typeof b === 'object') merge(a, b);
    else target[k] = b;
  }
}

/** The configuration this page load should use, overrides applied. */
export function loadConfig(search, storage) {
  const cfg = clone(CONFIG);
  if (!cfg.dev.allowOverrides) return cfg;

  try {
    const pinned = storage && storage.getItem('cfg');
    if (pinned) merge(cfg, JSON.parse(pinned));
  } catch (e) { /* a broken pin must never stop the game loading */ }

  try {
    const params = new URLSearchParams(search || '');
    for (const raw of params.getAll('set')) {
      const eq = raw.indexOf('=');
      if (eq > 0) setPath(cfg, raw.slice(0, eq), raw.slice(eq + 1));
    }
  } catch (e) { /* likewise for a malformed address */ }

  return cfg;
}

export { clone as cloneConfig, setPath as setConfigPath };
