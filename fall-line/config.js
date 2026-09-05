// ===========================================================================
// CONFIGURATION
//
// Every number worth turning and every short label lives here. Nothing in
// this file is read more than once per load, so a change takes effect on
// refresh, and nothing here needs a build step.
//
// HOW TO RENAME THE GAME
//   Set identity.name. That retitles the tab and the header. Leave
//   identity.storagePrefix alone if saves from the old name should carry over.
//
// HOW TO TRY A NUMBER WITHOUT EDITING THIS FILE
//   Append overrides to the address:
//     ?set=surge.hpGrowth=0.2&set=hearth.hp=50
//   They last for that page load. To pin one in this browser, in the console:
//     localStorage.setItem('cfg', '{"surge":{"hpGrowth":0.2}}')
//   Clear it with localStorage.removeItem('cfg'). Set dev.allowOverrides to
//   false to switch both off.
// ===========================================================================

export const CONFIG = {

  // -------------------------------------------------------------------------
  // IDENTITY
  // -------------------------------------------------------------------------
  identity: {
    name: 'Fall Line',
    tagline: 'Everything flows downhill. Make it a long way down.',
    storagePrefix: 'fallline',
  },

  // -------------------------------------------------------------------------
  // LABELS - the short words on the furniture
  // -------------------------------------------------------------------------
  text: {
    melt:      'the water',
    mote:      'drop',
    motes:     'drops',
    surge:     'Wave',
    hearth:    'Fire',
    snowline:  'Snow',
    ore:       'Ore',
    best:      'Best wave',
    call:      'Call the wave',
    callIn:    'Call the wave {n} early - {s}s',
    callHint:  'The wave comes on its own when the count runs out. Calling it early pays ore for every second you skip.',
    calling:   'Wave {n} - {count} left',
    over:      'The fire is out',
    pause:     'Pause',
    resume:    'Resume',
    speed:     'Speed',
    raise:     'Raise',
    cut:       'Lower',
    upgrade:   'Upgrade',
    sell:      'Sell',
    helpButton:'Help',
    startButton:'Start',
    moreButton:'The rest of the rules',
    closeButton:'Close',
    newRun:    'New run',
    newRunSure:'Start a new run? This run ends now.',
    export:    'Copy save',
    exportAsk: 'Copy this text somewhere safe. Paste it back in to pick this run up again.',
    import:    'Paste save',
    importAsk: 'Paste a run you copied out.',
    locked:    'from wave {n}',
    tier:      'Level {t}',
    topTier:   'Top level',
    boosted:   'boosted',
    nothing:   'No tower picked. Click one on the field to see what it does. Upgrade takes the tower that needs it most.',

    // The line above the field when the pointer is off it: one move, named,
    // with the figures it will actually cost and pay right now.
    compass: {
      first:    'First move: pick {name} in the tray, then click a cell the dashed road runs through. It costs {cost} ore and you have {ore}.',
      reach:    'Nothing you built reaches the dashed road. Sell one for its ore back and set it down on the dashes.',
      buy:      '{ore} ore in hand. Another {name} standing on the road costs {cost}.',
      upgrade:  '{ore} ore in hand. Upgrade takes that {name} to level {t} for {cost}.',
      sculpt:   '{ore} ore in hand. The cheapest lift on the road is {cost} ore, and every step the water climbs costs it time.',
      earn:     '{ore} ore. Every kill pays {kill}, and holding wave {n} with nothing through pays {bonus}.',
      hurt:     'Fire at {hp} of {max}. It takes {regen} back at the end of every wave, so a wave you hold is ground won back.',
    },

    // The ground panel and the sentences that say why a cell will not move.
    earthNote: 'Raise ground in the road and the water has to climb it, which is slow. Raise {raise}+ ore a step, lower {cut} ore.',
    earthFixed:'The {where} can\'t be moved.',
    earthTop:  'This is as high as ground goes.',
    earthLow:  'This is the valley floor. Nothing left to take off.',
    toolHint:  '{tool}: click or drag on the ground. Right click to put the tool down.',
    clickToSelect: 'Click to select.',

    // The picked tower's read-out.
    stats: {
      damage:    'Damage {dmg}, {rate} shots a second',
      damageOnly:'Damage {dmg}',
      burn:      'Burns {dps} a second for {secs}s',
      slow:      'Slows {pct}% for {secs}s',
      pull:      'Drags {rate} cells a second',
      chain:     'Jumps to {n} more',
      splash:    'Hits everything {r} cells across',
      aura:      'Makes towers within {r} cells hit harder',
      range:     'Reaches {r} cells',
      rangeHigh: 'Reaches {r} cells, high ground +{pct}%',
      tally:     '{kills} kills, {dealt} damage dealt',
    },

    // What Upgrade says when the player has picked nothing and it is choosing
    // the target itself.
    upgradeBest: 'Upgrade {name} {cost}',
    upgradeNone: 'Upgrade',

    panels: {
      build:    'Build',
      earth:    'The ground',
      selected: 'This tower',
      melt:     'Next wave',
      log:      'Log',
      awards:   'Awards',
    },

    // The panel that says what is coming.
    forecast: {
      coming:   'Wave {n}: {count} {motes}, {hp} health each',
      crest:    'A big one. More of them than usual.',
      quiet:    'The water hasn\'t learned anything yet.',
      learned:  'New this wave: {name}. {reason}',
      dropped:  'Gone this wave: {name}.',
      last:     'Last wave: {killed} of {spawned} killed, {leaked} got through.',
      share:    'Damage by {name}: {pct}%',
    },

    // Why the water picked up each trick. {pct} is the number that drove it.
    reasons: {
      chitin:   'Your bolts did {pct}% of your damage.',
      scatter:  'Your shells did {pct}% of your damage.',
      slick:    'Your furnaces did {pct}% of your damage.',
      faraday:  'Your sparks did {pct}% of your damage.',
      numb:     'It spent {pct}% of its time slowed.',
      ballast:  'It spent {pct}% of its time being dragged.',
      wings:    'It spent {pct}% of its time climbing.',
      haste:    'Your road takes it far longer than the straight way down.',
      bulk:     'Bursts and jumps punish a crowd, so it comes as fewer, bigger drops.',
      swarm:    'Single shots kill one at a time, so it comes as many small drops.',
      regrowth: '{pct}% of your damage landed on drops that reached the fire anyway.',
    },

    // The run-over card.
    summary: {
      reached: '{Surge} {n} reached.',
      tally:   '{held} waves held, {kills} {motes} killed, {ore} ore earned.',
      best:    'Best run so far: wave {best}.',
    },

    // Log lines.
    log: {
      start:    'Wave 1 is coming. Build towers, and raise the ground to lengthen its road.',
      surge:    'Wave {n} begins: {count} {motes}.',
      cleared:  'Wave {n} held, nothing got through. +{ore} ore.',
      leaked:   'Wave {n}: {leaked} got through to the fire. Fire at {hp}.',
      unlocked: '{name} unlocked.',
      award:    'Award: {name}.',
      over:     'The fire went out on wave {n}.',
      called:   'Called early. +{ore} ore.',
      trampled: 'The water ran right over a {name}.',
      loaded:   'Back on wave {n}.',
      saveBad:  'The old save couldn\'t be read and was set aside.',
    },

    // What a player reads before the first click. Short on purpose: the rest
    // of the rules are one button away and the run is held until Start.
    opening: [
      'Snow melts at the top of the hill. The water runs down it in drops, and every drop that reaches your fire puts a bit of it out.',
      'There is no track and no wall. The water goes the fastest way down, it climbs anything, and climbing is slow, so a longer road is a road your towers get more shots at.',
      'Your first minute: put two Bolts on the dashed road, then raise a cell or two of the road so the water has to climb over.',
      'Nothing moves while this is open. Press Start when you are ready, and Help at the top brings it back.',
    ],

    help: [
      'The water comes off the snow at the top every wave and runs the fastest way down to your fire.',
      'There\'s no wall to build and no maze to seal. It climbs anything, and climbing is slow, so it always takes the quickest way down.',
      'Raise ground in its way and it goes around, or climbs over and loses time doing it. Lower ground to draw it where you want it. The dashed line is the road it will take.',
      'Towers stand on the ground you shaped. A tower on high ground reaches further.',
      'Ore comes from kills and from waves you hold. It pays for towers and for moving the ground.',
      'Every tower has ten levels. Upgrade takes the tower that needs it most, or click one first to choose it yourself.',
      'After every wave the water looks at what killed it and picks up a trick against that. The panel on the right names the trick and the reason.',
      'Every trick costs it speed or health. Keep changing what you kill with.',
      'The run ends when the fire goes out. The wave you reached is your score.',
      'Space pauses. N calls the next wave early for extra ore. 1-7 pick a tower, R raises the ground, L lowers it, U upgrades, Esc puts the tool down.',
    ],
  },

  // -------------------------------------------------------------------------
  // TERRAIN
  // -------------------------------------------------------------------------
  terrain: {
    cols: 40,
    rows: 28,
    maxHeight: 6,
    snowlineDepth: 3,      // cells with x + y <= this are the snowline
    snowlineHeight: 5,
    climbCost: 2.0,        // extra time per level climbed, per cell moved
    workPathHeight: 3,     // a work adds this to its cell for pathing
    gen: {
      slopeTop: 4,         // natural height at the snowline end of the slope
      noise: 1.6,          // amplitude of the value noise, in levels
      noiseScale: 5.5,     // cells per noise feature
      ridges: 2,           // ridge lines running across the slope
      ridgeHeight: 2,
      channelDepth: 1,     // the natural channel is this much lower
      maxNatural: 4,
    },
  },

  // -------------------------------------------------------------------------
  // MOTES
  // -------------------------------------------------------------------------
  motes: {
    cap: 6000,
    baseSpeed: 1.5,        // cells per second on the flat
    leakDamage: 1,
    lateralSpread: 0.32,   // persistent per-mote offset from the cell centre
    arriveRadius: 0.12,
    stuckSeconds: 1.5,
    sizes: { normal: 1, bulk: 2.2, swarm: 0.6 },
  },

  // -------------------------------------------------------------------------
  // SURGES
  // -------------------------------------------------------------------------
  surge: {
    countBase: 12,
    countPer: 3,
    hpBase: 10,
    hpGrowth: 0.20,
    hpPower: 2.0,
    hpExp: 1.02,           // and a gentle exponential on top, so a run always ends
    spawnBase: 10,         // seconds a surge takes to spawn
    spawnPer: 0.5,
    spawnMax: 24,          // a stream never lasts longer than this
    crestEvery: 10,
    crestMul: 1.3,
    oreBase: 1.5,          // ore per kill on surge 0
    orePer: 0.2,
    clearBase: 16,         // bonus for a surge with no leak
    clearPer: 3,
    countdownSeconds: 12,
    firstCountdown: 30,
    callBonusPerSecond: 0.6,
    callBonusPer: 0.1,
  },

  ebb: {
    intervalSeconds: 3,
    hpMul: 0.3,
    oreMul: 0.5,
  },

  hearth: {
    hp: 50,
    regenPerSurge: 3,
  },

  // -------------------------------------------------------------------------
  // ECONOMY
  // -------------------------------------------------------------------------
  economy: {
    startOre: 80,
    sellRefund: 0.7,
    raiseBase: 3,
    raisePer: 1.5,
    cutCost: 2,
  },

  // -------------------------------------------------------------------------
  // THE MELT'S LEARNING
  // -------------------------------------------------------------------------
  melt: {
    mutationsFrom: 4,
    slots: [[4, 1], [8, 2], [14, 3], [22, 4], [35, 5]],
    addThreshold: 0.12,
    swapMargin: 0.15,
    jitter: 0.03,
    hasteSpan: 3,          // exposure ratio that counts as a full haste gain
    // Effects are multipliers unless named otherwise. Missing keys mean 1.
    mutations: {
      chitin:   { name: 'Thick skin', line: 'Half damage from bolts. Slower.',
                  kinetic: 0.5, speed: 0.85 },
      scatter:  { name: 'Spread out', line: 'Half damage from bursting shells. Weaker.',
                  blast: 0.5, hp: 0.9 },
      slick:    { name: 'Wet',      line: 'Barely burns. Weaker.',
                  burn: 0.4, burnTime: 0.5, hp: 0.9 },
      faraday:  { name: 'Shockproof', line: 'Half damage from sparks, and a jump stops on it. Weaker.',
                  arc: 0.5, stopsChain: true, hp: 0.9 },
      numb:     { name: 'Warm',     line: 'Frost slides right off. Weaker.',
                  immuneSlow: true, hp: 0.9 },
      ballast:  { name: 'Heavy',    line: 'Too heavy to drag. Slower.',
                  immunePull: true, speed: 0.9 },
      wings:    { name: 'Wings',    line: 'Flies straight over everything. Much weaker.',
                  ignoreTerrain: true, hp: 0.6 },
      haste:    { name: 'Fast',     line: 'Much faster. Weaker.',
                  speed: 1.4, hp: 0.75 },
      bulk:     { name: 'Big',      line: 'A third as many, four times the health, and each one hurts the fire three times as much.',
                  count: 0.35, hp: 4, leak: 3, conflicts: 'swarm' },
      swarm:    { name: 'Small',    line: 'Two and a half times as many, tiny, and each one barely hurts the fire.',
                  count: 2.5, hp: 0.4, leak: 0.4, conflicts: 'bulk' },
      regrowth: { name: 'Healing',  line: 'Heals four percent a second. Slower.',
                  regen: 0.04, speed: 0.9 },
    },
  },

  // -------------------------------------------------------------------------
  // WORKS
  // -------------------------------------------------------------------------
  works: {
    maxTier: 10,
    dmgMul: 1.7,           // per tier
    upgradeMul: 1.5,       // cost per tier
    rangePerTier: 0.15,
    highGroundRange: 0.10, // range bonus per level of the cell's height
    buffPerTier: 0.05,
    statusPerTier: 1.15,   // how much longer a burn or a slow holds, per tier
    pullPerTier: 1.2,      // how much harder a lodestone drags, per tier
    pullFalloff: 0.5,      // pull fades inside this many cells of the centre
    pullCap: 0.8,          // a drag never exceeds this share of the mote's own speed
    kinds: [
      { id: 'bolt',      name: 'Bolt',      type: 'kinetic', glyph: 'triangle', unlock: 0,
        cost: 20, dmg: 6,  rate: 2.0, range: 3.5,
        line: 'Shoots one at a time, fast. Always the one closest to your fire.' },
      { id: 'mortar',    name: 'Mortar',    type: 'blast',   glyph: 'square',   unlock: 0,
        cost: 45, dmg: 14, rate: 0.6, range: 4.6, minRange: 1.2, splash: 1.1, flight: 0.45,
        line: 'Lobs a shell that bursts where it lands. Can\'t hit anything right next to it.' },
      { id: 'kiln',      name: 'Furnace',      type: 'burn',    glyph: 'hexagon',  unlock: 3,
        cost: 40, burnDps: 5, burnSeconds: 3, rate: 1.25, range: 1.9,
        line: 'Sets everything close to it burning. Burning carries on after they leave.' },
      { id: 'rime',      name: 'Frost',     type: 'slow',    glyph: 'asterisk', unlock: 6,
        cost: 35, slow: 0.45, slowSeconds: 2, rate: 1.0, range: 2.4,
        line: 'Slows everything in range. Does no damage of its own.' },
      { id: 'coil',      name: 'Spark',      type: 'arc',     glyph: 'diamond',  unlock: 9,
        cost: 60, dmg: 8, rate: 1.0, range: 3.0, chain: 4, hop: 1.6, decay: 0.75,
        line: 'Hits one and jumps to the next four, a little weaker each jump.' },
      { id: 'lodestone', name: 'Magnet', type: 'pull',    glyph: 'ring',     unlock: 13,
        cost: 50, pull: 1.2, range: 2.8,
        line: 'Drags everything in range toward itself, and keeps dragging.' },
      { id: 'lantern',   name: 'Lantern',   type: 'buff',    glyph: 'star',     unlock: 18,
        cost: 70, aura: 1.8, buffDmg: 0.25, buffRange: 0.15,
        line: 'Towers near it hit harder and reach further. Two lanterns are no better than one.' },
    ],
  },

  // -------------------------------------------------------------------------
  // AWARDS - none of these change play
  // -------------------------------------------------------------------------
  awards: [
    { id: 'longway',   name: 'Long way around', line: 'A wave walked three times the straight way down.' },
    { id: 'dry',       name: 'Never touched',  line: 'Ten waves in a row with nothing through.' },
    { id: 'unadapted', name: 'Four tricks',    line: 'Held a wave with four tricks grown against you.' },
    { id: 'highground',name: 'High ground',    line: 'A kill from a tower standing six steps up.' },
    { id: 'earthworks',name: 'Digger',         line: 'Two hundred changes to the ground in one run.' },
    { id: 'fullhouse', name: 'Full house',     line: 'Every kind of tower standing at once.' },
    { id: 'twenty',    name: 'Twenty',         line: 'Reached wave twenty.' },
    { id: 'fifty',     name: 'Fifty',          line: 'Reached wave fifty.' },
    { id: 'trampled',  name: 'Trampled',       line: 'The water ran right over one of your towers.' },
    { id: 'held',      name: 'Held',           line: 'One drop spent ten seconds being dragged.' },
  ],

  awardRules: {
    longwayRatio: 3,
    drySurges: 10,
    unadaptedTraits: 4,
    highgroundHeight: 6,
    earthworksActions: 200,
    heldSeconds: 10,
    twentySurge: 20,
    fiftySurge: 50,
    fullhouseKinds: 3,     // the award needs at least this many kinds open
  },

  // -------------------------------------------------------------------------
  // SIMULATION AND SAVING
  // -------------------------------------------------------------------------
  sim: {
    dt: 1 / 60,
    maxFrame: 0.1,
    speeds: [1, 2, 3],
  },
  save: {
    version: 1,
    intervalSeconds: 10,
  },

  // -------------------------------------------------------------------------
  // RENDERING - the look. Crisp only: no blur, no gradients, no soft discs.
  // -------------------------------------------------------------------------
  render: {
    tileWidthMax: 44,
    heightUnit: 0.36,      // height unit as a fraction of tile width
    wallLeft: 0.72,        // brightness of the lower-left wall face, side-on to the sun
    wallRight: 0.58,       // brightness of the lower-right wall face, turned away from it
    // Top colours by height, 0 to maxHeight: one hue family from valley moss
    // up to bare limestone, stepped evenly in OKLCH so no band goes muddy.
    bands: ['#476f48', '#627f56', '#7b8f65', '#95a076', '#adb189', '#c6c29d', '#ddd5b4'],
    // The sun sits low in the upper left. A cell `slope` levels higher than
    // the ground `k` cells toward it shades that ground; `drift` bends the
    // shadow a little toward the top of the screen; shadowed tops lose a
    // fifth of their lightness and lean toward `cool`, lit tops lean toward
    // `warm`, the way a technical illustration shades.
    sun: { slope: 1.0, reach: 6, drift: 0.35, shadow: 0.82, cool: '#517791', coolMix: 0.26, warm: '#f7dba1', warmMix: 0.05 },
    ao: { step: 0.05 },    // lightness lost per grade of enclosure by higher ground
    fade: { mix: 0.045 },  // how far each grade of distance fades toward the paper
    grain: { alpha: 0.28, amount: 36 },  // the paper's tooth, one soft-light pass
    flowSpeed: 14,         // pixels a second the road's dashes run downhill
    workShadow: 0.32,      // alpha of the hard shadow under a standing work
    edge: '#2f2c26',
    edgeAlpha: 0.45,
    snow: '#f3f5f6',
    hearthTop: '#5a3a2e',
    ember: '#d9482b',
    // The road is the one thing the whole game turns on, so it is drawn as a
    // route on a survey sheet: a pale casing cleared through the ground under
    // it, then the dashes over that. Blue on green alone is a difference of
    // hue with almost none of lightness, which is no line at all on a dim
    // screen or to an eye that mixes the two.
    fallLine: '#123f6b',
    fallLineAlpha: 1,
    fallLineWidth: 2,
    fallLineCasing: '#f2ead9',
    fallLineCasingAlpha: 0.78,
    fallLineCasingWidth: 3.2,
    // The snowline and the hearth are lettered on the sheet, the way a survey
    // names the features it draws.
    label: '#8c5a1c',
    labelHalo: '#f4eee0',
    labelSize: 11,
    work: '#e3a63a',
    workInk: '#2a2620',
    workTick: '#7a4b16',
    range: '#8c5a1c',
    cursor: '#2a2620',
    okGhost: '#3d7a4c',
    badGhost: '#b23a2a',
    moteColors: {
      base:     '#1f4f80',
      chitin:   '#8a5220',
      scatter:  '#3a3a3a',
      slick:    '#5f2f8f',
      faraday:  '#a1521d',
      numb:     '#4c6079',
      ballast:  '#2c3138',
      wings:    '#1d8db3',
      haste:    '#b88a00',
      bulk:     '#12345e',
      swarm:    '#5c8fc4',
      regrowth: '#2f7d4e',
      burning:  '#d9482b',
    },
    fx: {
      bolt:     '#3b2a12',
      shell:    '#5a3e1a',
      splash:   '#b5411f',
      flare:    '#c8501e',
      rime:     '#2f8fd0',
      arc:      '#6a48c8',
      kill:     '#2a2620',
      splashSeconds: 0.35,
      killSeconds: 0.3,
      arcFrames: 2,
    },
    maxDrawMs: 8,
  },

  // -------------------------------------------------------------------------
  // PAGE PALETTE - the sheet around the field. `void` is the field's own
  // ground colour, the paper the relief is drawn on.
  // -------------------------------------------------------------------------
  palette: {
    void:  '#d8d0bf',
    paper: '#ece6d6',
    panel: '#f5f0e4',
    rule:  '#c9c0ad',
    ink:   '#2a2620',
    dim:   '#6e6656',
    quiet: '#a69d8a',
    ore:   '#8c5a1c',
    hot:   '#b23a2a',
    good:  '#3d7a4c',
    melt:  '#2c6ca6',
  },

  // -------------------------------------------------------------------------
  // DEV
  // -------------------------------------------------------------------------
  dev: {
    allowOverrides: true,
    // Bump when src/ changes so a browser cannot pair a stale module with a
    // fresh page. Every import in index.html and src/ carries ?v=<this>.
    build: 12,
  },
};


// ---------------------------------------------------------------------------
// OVERRIDES
//
// Two ways to change a value without touching this file: a JSON patch in
// localStorage under 'cfg', and ?set=path=value pairs on the address. Both
// are applied once, here, before anything reads CONFIG. The type of a value
// is taken from what is already in place, so a number stays a number.
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
 * Fill {name}-style holes in a line of text. A hole written with a capital,
 * {Name}, is filled with the same value and then capitalised.
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

/** The work definition for a kind id, or undefined. */
export function kindDef(id) {
  return CONFIG.works.kinds.find(k => k.id === id);
}


// ---------------------------------------------------------------------------
// APPLYING IDENTITY TO THE PAGE
//
// The document carries the game's name and colours in a few places. This puts
// them all there from the one source. Every surface touched is optional: the
// headless test harness supplies just enough of a document to run the game.
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
  for (const k of Object.keys(p)) setVar('--' + k, p[k]);

  const byId = (id) => (typeof d.getElementById === 'function' ? d.getElementById(id) : null);
  const put = (id, value) => { const el = byId(id); if (el) el.textContent = value; };
  const t = CONFIG.text;
  put('title',      CONFIG.identity.name);
  put('tagline',    CONFIG.identity.tagline);
  put('lbl-ore',    t.ore);
  put('lbl-hearth', t.hearth);
  put('lbl-surge',  t.surge);
  put('lbl-best',   t.best);
  put('raise',      t.raise);
  put('cut',        t.cut);
  put('upgrade',    t.upgrade);
  put('sell',       t.sell);
  put('help',       t.helpButton);
  put('newrun',     t.newRun);
  put('export',     t.export);
  put('import',     t.import);
  put('p-build',    t.panels.build);
  put('p-earth',    t.panels.earth);
  put('p-selected', t.panels.selected);
  put('p-melt',     t.panels.melt);
  put('p-log',      t.panels.log);
  put('p-awards',   t.panels.awards);

  // The tab icon is drawn from the palette rather than shipped as a file.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" fill="' + p.void + '"/>' +
    '<path d="M4 8 L16 2 L28 8 L28 14 L16 8 L4 14 Z" fill="' + CONFIG.render.bands[5] + '"/>' +
    '<path d="M4 18 L16 12 L28 18 L28 24 L16 18 L4 24 Z" fill="' + CONFIG.render.bands[2] + '"/>' +
    '<path d="M6 4 L12 22 L18 10 L24 28" stroke="' + p.melt + '" stroke-width="2" fill="none"/>' +
    '<rect x="21" y="25" width="6" height="6" fill="' + CONFIG.render.ember + '"/>' +
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
