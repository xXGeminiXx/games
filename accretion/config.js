// ===========================================================================
// CONFIGURATION
//
// Every name, every word on screen and every number worth turning lives in
// this file and nowhere else. Change something here and the whole game follows:
// the browser tab, the readout, the colours, the physics, the save slot.
//
// Nothing here is read more than once per load, so a change takes effect on
// refresh. Nothing here needs a build step.
//
// HOW TO RENAME THE GAME
//   Set identity.name. That alone retitles the tab and the save slot. If you
//   want an existing save to carry over, leave identity.storagePrefix pinned to
//   its current value instead of letting it follow the name.
//
// HOW TO TRY A NUMBER WITHOUT EDITING THIS FILE
//   Append overrides to the URL, which is the fastest way to test a hosted
//   build from a phone:
//     ?set=seeding.bodiesPerClick=8&set=seeding.launchSpeed=0.9
//   They last for that one page load. To make one stick in this browser, open
//   the console and run:
//     localStorage.setItem('cfg', '{"seeding":{"bodiesPerClick":8}}')
//   Clear it with localStorage.removeItem('cfg'). Set dev.allowOverrides to
//   false to switch both off entirely.
// ===========================================================================

export const CONFIG = {

  // -------------------------------------------------------------------------
  // IDENTITY - what the game is called and where it keeps its things
  // -------------------------------------------------------------------------
  identity: {
    name: 'Accretion',
    tagline: 'a blank field, and whatever gravity makes of it',

    // Prefixes every browser storage key this game writes. Changing it starts
    // every player from a clean slate; keeping it preserves saves across a
    // rename.
    storagePrefix: 'accretion',
  },

  // -------------------------------------------------------------------------
  // TEXT - every word the player reads
  //
  // The game is close to wordless on purpose. These are all of them.
  // -------------------------------------------------------------------------
  text: {
    // The figure in the corner, and what it is called.
    massLabel: 'bound mass',

    // The line along the bottom. It says the least it can and then stops: the
    // first prompt, one nudge to repeat it, and then silence.
    promptFirst:  'click the void',
    promptSecond: 'again',
    promptDone:   '',
  },

  // -------------------------------------------------------------------------
  // SEEDING - what a click puts into the field
  //
  // A click is a seed, not a placement. Mass arrives with a little scatter and
  // a little sideways momentum, so two clicks in the same spot make a system
  // rather than a stack.
  // -------------------------------------------------------------------------
  seeding: {
    bodiesPerClick: 3,

    // Scatter radius in world units: spreadBase + spreadGrowth * clicksSoFar.
    // Later clicks land wider, so a field being fed keeps finding new orbits
    // instead of piling onto the one it already has.
    spreadBase:   6,
    spreadGrowth: 0.4,

    // Sideways speed given to each body, across the line from the click centre.
    // Zero drops everything straight in and the field collapses to a point.
    launchSpeed: 0.35,

    massPerBody: 1,

    // Clicks after which the prompt goes quiet for good.
    promptFadesAt: 3,
  },

  // -------------------------------------------------------------------------
  // FIELD - the simulation itself
  //
  // These are handed straight to the simulation. Full notes on what each one
  // costs live beside its use in src/sim.js.
  // -------------------------------------------------------------------------
  field: {
    // Identical seeds and identical inputs produce an identical universe.
    seed: 20260827,

    capacity: 4096,      // starting pool size; grows on demand
    hardCap:  32768,     // absolute ceiling on individually tracked bodies

    // Milliseconds of simulation allowed per frame. Past this the field starts
    // condensing groups it can no longer afford to resolve, which it would do
    // eventually anyway.
    budgetMs: 8,

    // Barnes-Hut opening angle. Lower is more exact and more expensive.
    theta: 0.75,

    // Longest step the simulation will take in one frame, in seconds. A tab
    // returning from the background must not hand it a whole minute at once.
    maxStepSeconds: 0.05,
  },

  // -------------------------------------------------------------------------
  // LAYOUT - where the two pieces of text sit
  //
  // The renderer owns the top left corner: it prints the stratum the view is
  // currently in, and how far across the screen reaches. The bound mass figure
  // is laid out UNDER that block, in the same gutter, so the corner reads as
  // one column instead of two overlapping ones. Move either of them and check
  // the corner again.
  // -------------------------------------------------------------------------
  layout: {
    hudLeft: 30,        // px from the left edge; 30 matches the renderer's gutter
    hudTop: 74,         // px from the top; clears the renderer's own two lines

    promptLeft: 30,     // the line along the bottom
    promptBottom: 30,
  },

  // -------------------------------------------------------------------------
  // CAMERA - how the view moves
  // -------------------------------------------------------------------------
  camera: {
    // Scroll wheel steps per notch. The camera reads scale as ratio per
    // second, so this is a multiplier's worth of zoom, not a distance.
    zoomStep: 1,
  },

  // -------------------------------------------------------------------------
  // PALETTE - the whole colour vocabulary
  //
  // The field lights itself, so these are only the surfaces around it: the
  // ground it sits on and the few figures laid over the top.
  // -------------------------------------------------------------------------
  palette: {
    void:   '#04050a',   // the ground everything sits on
    ink:    '#c8cede',   // body text
    figure: '#e6ebf5',   // the one number that matters
    label:  '#5d6579',   // what that number is called
    quiet:  '#4a5164',   // the prompt along the bottom
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
// ---------------------------------------------------------------------------

/** Namespaced browser storage key. */
export const storageKey = (slot) => CONFIG.identity.storagePrefix + '.' + slot;

/** The options the simulation is built with. */
export const simOptions = () => ({
  seed: CONFIG.field.seed,
  capacity: CONFIG.field.capacity,
  hardCap: CONFIG.field.hardCap,
  budgetMs: CONFIG.field.budgetMs,
  theta: CONFIG.field.theta,
});


// ---------------------------------------------------------------------------
// APPLYING IDENTITY TO THE PAGE
//
// The document carries the game's name and colours in several places. This
// puts them all there from the one source, so the markup never has to repeat a
// value that lives above.
// ---------------------------------------------------------------------------

export function applyIdentity(doc) {
  const d = doc || document;
  const p = CONFIG.palette;

  d.title = CONFIG.identity.name;

  const root = d.documentElement;
  root.style.setProperty('--void', p.void);
  root.style.setProperty('--ink', p.ink);
  root.style.setProperty('--figure', p.figure);
  root.style.setProperty('--label', p.label);
  root.style.setProperty('--quiet', p.quiet);

  const hud = d.getElementById('hud');
  if (hud) {
    hud.style.left = CONFIG.layout.hudLeft + 'px';
    hud.style.top = CONFIG.layout.hudTop + 'px';
  }

  const label = d.getElementById('masslabel');
  if (label) label.textContent = CONFIG.text.massLabel;

  const note = d.getElementById('note');
  if (note) {
    note.textContent = CONFIG.text.promptFirst;
    note.style.left = CONFIG.layout.promptLeft + 'px';
    note.style.bottom = CONFIG.layout.promptBottom + 'px';
  }

  // The tab icon is drawn from the palette rather than shipped as a file, so a
  // recolour needs no asset and the game still has no binary dependencies.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" fill="' + p.void + '"/>' +
    '<circle cx="16" cy="16" r="5" fill="' + p.figure + '"/>' +
    '<circle cx="27" cy="9" r="1.6" fill="' + p.ink + '"/>' +
    '<circle cx="6" cy="23" r="2.2" fill="' + p.ink + '"/>' +
    '</svg>';
  let icon = d.getElementById('cfg-favicon');
  if (!icon) {
    icon = d.createElement('link');
    icon.id = 'cfg-favicon';
    icon.rel = 'icon';
    d.head.appendChild(icon);
  }
  icon.type = 'image/svg+xml';
  icon.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}
