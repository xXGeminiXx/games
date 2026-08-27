// ===========================================================================
// CONFIGURATION
//
// Every name, every label, every number worth turning lives in this file and
// nowhere else. Change something here and the whole game follows: the browser
// tab, the header, the shop, the colours, the physics, the save slot.
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
//     ?set=board.cols=10&set=swarm.speed=16
//   They last for that one page load. To make one stick in this browser, open
//   the console and run:
//     localStorage.setItem('cfg', '{"board":{"cols":10}}')
//   Clear it with localStorage.removeItem('cfg'). Set dev.allowOverrides to
//   false to switch both off entirely.
// ===========================================================================

export const CONFIG = {

  // -------------------------------------------------------------------------
  // IDENTITY - what the game is called and where it keeps its things
  // -------------------------------------------------------------------------
  identity: {
    name: 'Swarm Breaker',
    tagline: 'aim once. the swarm does the work.',

    // Prefixes every browser storage key this game writes. Changing it starts
    // every player from a clean slate; keeping it preserves saves across a
    // rename.
    storagePrefix: 'swarmbreaker',
  },

  // -------------------------------------------------------------------------
  // TEXT - every word the player reads
  //
  // Nothing below is referenced by id anywhere else, so any of it can be
  // rewritten freely. Renaming a currency here renames it everywhere it is
  // shown.
  // -------------------------------------------------------------------------
  text: {
    // The four figures across the top of the screen.
    stats: {
      depth:   'depth',      // how far the field has descended
      swarm:   'swarm',      // how many bodies fire each turn
      essence: 'essence',    // the currency
      pattern: 'pattern',    // which generator is drawing the field
    },

    hintIdle:    'drag to aim · release to fire',
    hintFiring:  'the swarm is working',

    difficultyLabel: 'difficulty',
    resetButton:     'reset',

    // Shown when a block reaches the swarm line.
    overTitle:   'the swarm is overrun',
    overAgain:   'again',
    overDepth:   'depth',
    overSwarm:   'swarm',
    overMenu:    'modes',

    // The mode screen.
    menuPlay:       'play',
    menuResume:     'resume run',
    menuButton:     'modes',
    menuModeLabel:  'mode',
    menuBestLabel:  'best depth',
    menuNoBest:     'not yet played',
    menuHint:       'esc opens this  \u00b7  drag to aim, release to fire',
  },

  // -------------------------------------------------------------------------
  // MODES - the fields a run can be played on
  //
  // A mode changes what descends and nothing else. The swarm, the angle, the
  // economy and the difficulty ladder are the same in all of them, so a mode
  // is safe to add: give it an id here, give it a row source in src/modes.js,
  // and the menu picks it up.
  // -------------------------------------------------------------------------
  modes: {
    // What a fresh install plays.
    default: 'swarm',

    list: [
      {
        id: 'swarm',
        name: 'swarm',
        tell: 'the main game',
        blurb: 'Eight columns, one row at a time, drawn by an automaton that '
             + 'changes its rule as you descend. Tuned, and the one to play.',
      },
      {
        id: 'fractal',
        name: 'fractal',
        tell: 'whole figures, dealt downward',
        blurb: 'A complete construction is built first - gasket, mesh, Cantor '
             + 'bars, canopy - then dealt one row at a time so it assembles as '
             + 'it falls. The field widens to give the figures room. Rougher, '
             + 'and still being worked on.',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // BOARD - the shape of the playfield
  //
  // The canvas is a fixed pixel grid scaled to fit the window, so these are
  // authoring units, not screen units. Cell size is width / cols and is not
  // set directly.
  // -------------------------------------------------------------------------
  board: {
    width:  520,
    height: 620,

    // Columns the field STARTS at. It does not stay here: see `ladder`.
    cols: 8,

    // THE VIEW PULLS BACK AS A RUN GOES ON.
    //
    // One width per figure, and the last entry repeats forever. Each step
    // shrinks the blocks a little and fits more of them, which is the only way
    // the fractal constructions get room to be themselves: eight columns holds
    // three levels of recursion and no exact Cantor set at all. Nine and
    // twenty seven are on the ladder because the base three figures - dust,
    // cross, carpet - are exact only at a power of three, and sixteen and
    // twenty four because the bisecting one is exact only at a multiple of
    // eight.
    //
    // Keep the steps small. A figure is dealt one row per turn that the
    // difficulty tier lets a row descend, which on the middle tiers is about
    // every other turn, so a figure lasts roughly twice its height in turns and
    // a widening lands about every twenty. Each step should read as the field
    // having a little more room, never as the camera moving. The far rungs are
    // deliberately out of reach of a short run: a twenty seven wide carpet is
    // something to play toward.
    ladder: [8, 9, 10, 12, 14, 16, 18, 21, 24, 27],

    // Seconds the view takes to settle after a widening. The lattice changes
    // between figures in one step; what the player sees is this ease. Long
    // enough not to snap, short enough to finish inside one turn.
    viewEase: 0.9,

    // Pixels of headroom at the top of the canvas, under the readout.
    topGap: 40,

    // Pixels from the bottom of the canvas to the swarm line. A block crossing
    // that line ends the run.
    floorGap: 86,
  },

  // -------------------------------------------------------------------------
  // SWARM - the bodies, and how they move
  // -------------------------------------------------------------------------
  swarm: {
    radius: 5,          // body radius in board units
    speed:  11,         // board units per frame

    // Collision is checked this many times per frame. Lower it and a fast body
    // can pass through a block; raise it and the cost per body climbs.
    substeps: 3,

    // Shots below this angle above the horizontal are refused, because a flat
    // shot rattles along the floor and returns nothing.
    minAngleDeg: 15,

    // Frames between bodies leaving the launcher, before the crowding term.
    // A larger swarm fires tighter: gap = max(1, round(baseGap - swarm/crowd)).
    launchGap:   4,
    launchCrowd: 20,

    // What a new run starts with when the difficulty tier does not say
    // otherwise. Tiers normally do say otherwise.
    startingPower: 1,   // damage per hit
    startingGain:  0,   // bonus essence per block destroyed
  },

  // -------------------------------------------------------------------------
  // ECONOMY - what things pay, and what things cost
  //
  // Costs are linear in depth: cost = base + perDepth * depth. The shop reads
  // this list in order, so reordering it reorders the buttons and deleting an
  // entry removes the offer. The `id` is what wires an entry to its effect;
  // everything else is free to change.
  // -------------------------------------------------------------------------
  economy: {
    // Essence a destroyed block pays: max(1, round(blockHealth * blockShare))
    // plus whatever `harvest` has been bought.
    blockShare: 0.5,

    // HOW MUCH HEALTH A ROW IS WORTH, RATHER THAN A BLOCK.
    //
    // The difficulty ladder decides how much health a block carries, and it was
    // measured against a generator that put about three blocks in a row. A
    // fractal figure does not care about that: a carpet row can be solid and a
    // gasket row can hold one block. Taking the tier at its word would mean a
    // solid row arriving with nearly three times the health the tier intended,
    // which kills a run in single digit depths.
    //
    // So the tier's number is treated as the health of a ROW, and shared out
    // among whatever blocks the figure put in it. A dense row is many soft
    // blocks, a sparse row is a few hard ones, and the material colouring makes
    // which is which readable at a glance.
    rowBlocks: 3,

    // Bounds on that sharing, so a one block row is not an unbreakable pillar
    // and a solid row is not free.
    rowShareMin: 0.5,
    rowShareMax: 2,

    // An essence pickup collected at depth d pays windfallBase + d.
    windfallBase: 5,

    offers: [
      { id: 'ball',  name: 'conscript', desc: '+1 to the swarm',        base: 12, perDepth: 4,  amount: 1 },
      { id: 'power', name: 'sharpen',   desc: '+1 damage per hit',      base: 25, perDepth: 10, amount: 1 },
      { id: 'gain',  name: 'harvest',   desc: '+2 essence per block',   base: 30, perDepth: 8,  amount: 2 },

      // Priced by how much it actually removes, so clearing a wide row costs
      // more than clearing a thin one.
      { id: 'clear', name: 'purge row', desc: 'destroy the lowest row', base: 25, perDepth: 6,  amount: 1 },
    ],
  },

  // -------------------------------------------------------------------------
  // DIFFICULTY - which ladder rung a run is played on
  //
  // The tiers themselves live in src/tiers.js, where each one carries the
  // measurements it was built from. Override numbers here rather than editing
  // that file, so the reasoning next to each number stays intact.
  //
  //   tierOverrides: { shallows: { supply: { start: 8 } } }
  //
  // Only the keys you name are replaced; the rest of the tier is untouched.
  // -------------------------------------------------------------------------
  difficulty: {
    defaultTier: 'swell',

    // Tiers are designed to open one at a time. While true, every rung is
    // selectable from the start.
    unlockAll: true,

    tierOverrides: {},
  },

  // -------------------------------------------------------------------------
  // PALETTE - the whole colour vocabulary
  //
  // A colour in this game says one thing and only that thing. Change a value
  // and every surface carrying that meaning changes with it: the readout, the
  // blocks, the particles, the shop.
  // -------------------------------------------------------------------------
  palette: {
    void:  '#08090c',   // the ground everything sits on
    panel: '#0e1016',   // raised surfaces, readout backing
    rule:  '#1c2029',   // hairlines, frames, grid

    ink:   '#e6e9ef',   // anything that must be read
    dim:   '#7a828f',   // labels, units, secondary figures

    swarm:   '#5ad1ff', // the player: bodies, the pool, the launcher
    essence: '#ffc94a', // value: payout, pickups, prices
    hot:     '#ff5c46', // threat: proximity to the line, breach, loss
    force:   '#b98cff', // curvature: gravity, orbits, anything that bends
    trade:   '#6ee7a8', // supply: material, fills, contracts
    tithe:   '#8f9aa8', // obligation: costs, interest, what is owed
  },

  // -------------------------------------------------------------------------
  // FEEL - effects that change nothing about the outcome
  // -------------------------------------------------------------------------
  feel: {
    shake:     1,       // screen shake multiplier; 0 turns it off
    particles: 1,       // particle density, 0 to 1

    // null follows the operating system's reduced motion setting. true or
    // false overrides it.
    reducedMotion: null,

    // Draws the wordless opening lesson for a player who has never fired.
    onboarding: true,
  },

  // -------------------------------------------------------------------------
  // DEV - switches that only matter while tuning
  // -------------------------------------------------------------------------
  dev: {
    // Allows ?set= in the URL and a `cfg` entry in browser storage to patch
    // anything above. Turn off for a build you do not want poked at.
    allowOverrides: true,
  },
};


// ---------------------------------------------------------------------------
// OVERRIDES
//
// Applied in order: this file, then browser storage, then the URL. The URL wins
// so a link can carry a whole configuration.
// ---------------------------------------------------------------------------

function assignPath(target, path, value) {
  const keys = path.split('.');
  let node = target;
  for (let i = 0; i < keys.length - 1; i++) {
    if (node[keys[i]] === null || typeof node[keys[i]] !== 'object') return false;
    node = node[keys[i]];
  }
  const leaf = keys[keys.length - 1];
  if (!(leaf in node)) return false;

  // The type already in place decides how the text is read, so a number stays
  // a number and a colour stays a string.
  const was = node[leaf];
  if (typeof was === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    node[leaf] = n;
  } else if (typeof was === 'boolean') {
    node[leaf] = value === 'true' || value === '1';
  } else {
    node[leaf] = value;
  }
  return true;
}

function mergeDeep(target, patch) {
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) &&
        target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      mergeDeep(target[k], v);
    } else {
      target[k] = v;
    }
  }
}

/** Everything an override actually changed, so a session can show its own
 *  configuration rather than guessing at it. */
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
// DERIVED VALUES
//
// Read these rather than recomputing them, so one definition of a cell or a
// storage key exists.
// ---------------------------------------------------------------------------

/** Cell size at the STARTING width. The live one moves as the view pulls back
 *  and is owned by the game, not by this file. */
export const CELL0 = CONFIG.board.width / CONFIG.board.cols;

/** Width the figure numbered n is dealt at. The last rung repeats. */
export const latticeAt = (n) => {
  const L = CONFIG.board.ladder;
  return L[Math.min(Math.max(0, n | 0), L.length - 1)];
};

/** Leftmost WORLD column at a given width. World column zero is the left edge
 *  of the starting field, so widening opens negative columns on one side and
 *  columns past the start width on the other, symmetrically. */
export const leftEdgeAt = (cols) => -Math.floor((cols - CONFIG.board.cols) / 2);
export const TOP = CONFIG.board.topGap;
export const FLOOR = CONFIG.board.height - CONFIG.board.floorGap;

/** Minimum vertical component of a legal shot, as a unit vector term. */
export const MIN_AIM_Y = Math.sin(CONFIG.swarm.minAngleDeg * Math.PI / 180);

/** Namespaced browser storage key. */
export const storageKey = (slot) => CONFIG.identity.storagePrefix + '.' + slot;

/** Cost of an offer at a given depth, before any per offer multiplier. */
export const offerCost = (offer, depth) => Math.round(offer.base + offer.perDepth * depth);


// ---------------------------------------------------------------------------
// APPLYING IDENTITY TO THE PAGE
//
// The document carries the game's name and colours in half a dozen places.
// This puts them all there from the one source, so the markup never has to
// repeat a value that lives above.
// ---------------------------------------------------------------------------

export function applyIdentity(doc) {
  const d = doc || document;

  d.title = CONFIG.identity.name;

  // The headless test harness supplies enough of a document to boot the game
  // and no more, so every surface touched here is optional.
  const root = d.documentElement;
  const p = CONFIG.palette;
  const setVar = (name, value) => {
    if (root && root.style && typeof root.style.setProperty === 'function') {
      root.style.setProperty(name, value);
    }
  };
  setVar('--bg', p.void);
  setVar('--panel', p.panel);
  setVar('--line', p.rule);
  setVar('--ink', p.ink);
  setVar('--dim', p.dim);
  setVar('--hot', p.hot);
  setVar('--swarm', p.swarm);
  setVar('--block', p.rule);
  setVar('--pickup', p.essence);

  const put = (id, value) => {
    const el = typeof d.getElementById === 'function' ? d.getElementById(id) : null;
    if (el) el.textContent = value;
  };
  const t = CONFIG.text;
  put('lbl-depth',   t.stats.depth);
  put('lbl-swarm',   t.stats.swarm);
  put('lbl-essence', t.stats.essence);
  put('lbl-pattern', t.stats.pattern);
  put('hint',        t.hintIdle);
  put('reset',       t.resetButton);
  put('overtitle',   t.overTitle);
  put('again',       t.overAgain);
  put('overmodes',   t.overMenu);
  put('over-lbl-depth', t.overDepth);
  put('over-lbl-swarm', t.overSwarm);

  // The mode screen.
  put('menutitle',      CONFIG.identity.name);
  put('menutag',        CONFIG.identity.tagline);
  put('lbl-difficulty', t.difficultyLabel);
  put('modes',          t.menuButton);
  put('resume',         t.menuResume);
  put('menuhint',       t.menuHint);

  const byId = (id) => (typeof d.getElementById === 'function' ? d.getElementById(id) : null);

  const sel = byId('tier');
  if (sel) sel.title = t.difficultyLabel;

  const canvas = byId('c');
  if (canvas) { canvas.width = CONFIG.board.width; canvas.height = CONFIG.board.height; }

  // The tab icon is drawn from the palette rather than shipped as a file, so a
  // recolour needs no asset and the game still has no binary dependencies.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" fill="' + p.void + '"/>' +
    '<rect x="6" y="5" width="9" height="7" fill="' + p.rule + '"/>' +
    '<rect x="17" y="5" width="9" height="7" fill="' + p.rule + '"/>' +
    '<circle cx="16" cy="23" r="4" fill="' + p.swarm + '"/>' +
    '</svg>';
  if (typeof d.createElement !== 'function' || !d.head) return;
  let icon = byId('cfg-favicon');
  if (!icon) {
    icon = d.createElement('link');
    icon.id = 'cfg-favicon';
    icon.rel = 'icon';
    d.head.appendChild(icon);
  }
  icon.type = 'image/svg+xml';
  icon.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}
