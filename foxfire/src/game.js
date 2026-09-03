// ---------------------------------------------------------------------------
// The composition root: the simulation, the page, the picture, the clock and
// the save, wired together.
//
// Time is the one thing this file owns. The simulation is stepped at a fixed
// tick while the tab is open; a gap longer than a few seconds (the tab was
// hidden, the machine slept, the page was closed) is handed to the simulation
// as time away and caught up in coarse chunks, then reported in the log. The
// save carries the wall clock so a reload knows how long that was.
//
// It also owns the one thing that outlives an organism. Fruiting does not
// edit the state in place: it writes the next organism's opening state, with
// the genome kept and the closing lines already in its log, and reloads.
// ---------------------------------------------------------------------------

import { storageKey } from '../config.js?v=13';
import { createSim, restoreSim, openedState } from './sim.js?v=13';
import * as Save from './save.js?v=13';
import * as Sp from './spores.js?v=13';
import * as Lore from './lore.js?v=13';
import { hash } from './rng.js?v=13';
import { createUI } from './ui.js?v=13';
import { createView } from './view.js?v=13';
import { fmtTime, fmt, fmtCount } from './numbers.js?v=13';

/**
 * @param {object} o
 * @param {Document} o.doc
 * @param {Window|object} o.win     addEventListener, requestAnimationFrame, devicePixelRatio, prompt
 * @param {HTMLCanvasElement} o.canvas
 * @param {object} o.cfg
 * @param {Storage} o.storage
 * @param {function} o.now          wall-clock milliseconds
 * @param {number} [o.seed]
 */
export function createGame(o) {
  const { doc, win, canvas, cfg, storage } = o;
  const now = o.now || (() => Date.now());
  const KEY = storageKey('run');

  let sim = null;
  const saved = storage ? Save.read(storage, KEY) : null;
  if (saved) sim = restoreSim(cfg, saved.snap);
  const resumed = !!sim;
  if (!sim) sim = createSim(cfg, { seed: o.seed });

  const view = createView(canvas, cfg, doc);

  const actions = {};
  const ui = createUI(doc, sim, cfg, actions);
  const tell = (events) => { for (const e of events) ui.say(e); };

  const wrap = (fn, saveAfter) => (...args) => {
    // Anything pressed means the player is back and has read the note.
    ui.clearAway();
    const r = fn(...args);
    const events = Array.isArray(r) ? r : (r && r.events) || [];
    tell(events);
    if (saveAfter) save();
    ui.render();
    return r;
  };
  actions.reach = wrap(() => sim.reachByHand());
  actions.buyTips = wrap((n) => sim.buyTips(n), true);
  actions.buyTipsMax = wrap(() => sim.buyTipsMax(), true);
  actions.setWeight = wrap((key, d) => sim.setWeight(key, d));
  actions.setHarvest = wrap((key, p) => sim.setHarvest(key, p), true);
  actions.toggleNurture = wrap((key) => sim.toggleNurture(key), true);
  actions.buyTrait = wrap((id) => sim.buyTrait(id), true);
  actions.setInstinct = wrap((key, on) => sim.setInstinct(key, on), true);
  actions.setReserve = wrap((share) => sim.setReserve(share), true);
  actions.extend = wrap(() => sim.extend(), true);
  actions.beyond = wrap(() => sim.beyond(), true);
  actions.buyPerk = wrap((id) => { Sp.buyPerk(cfg, sim.genome, id); return []; }, true);
  actions.setAim = wrap((x, y) => sim.setAim(x, y), true);
  actions.clearAim = wrap(() => sim.clearAim(), true);
  actions.fruit = () => fruit();

  // A press on the floor sends the front toward that place. Where the press
  // landed is read back through the picture's own projection rather than
  // through a second fit of the same ground: two fits drift, and the mark then
  // stands somewhere the player did not press.
  if (canvas && canvas.addEventListener) {
    canvas.addEventListener('click', (e) => {
      const box = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
      const x = (e.clientX || 0) - (box ? box.left : 0);
      const y = (e.clientY || 0) - (box ? box.top : 0);
      const at = view.at(x, y);
      actions.setAim(at.x, at.y);
    });
  }

  // -- the clock -------------------------------------------------------------

  let last = null;          // wall ms of the previous frame
  let acc = 0;              // seconds owed to the simulation
  let sinceSave = 0;
  let sinceRender = 0;
  let running = false;
  let disposed = false;     // after a reset, an import or fruiting: never write the old organism again

  const away = (seconds) => {
    const r = sim.advance(seconds);
    // Only the lines worth keeping from a long absence: the firsts and the
    // seasons would bury the log, so the arrivals are folded into one line.
    const keep = r.events.filter(e => !/^season\./.test(e.key));
    tell(keep.slice(-6));
    if (r.away && seconds > 30) {
      // The entry says how long the absence was, not how much of it was
      // worked: a player who was gone a week is told a week, and then told
      // where the organism ran out.
      let line = Lore.line(sim.state.seed, 'away', { t: fmtTime(seconds) }, String(Math.floor(sim.state.t)));
      if (r.capped) line += ' ' + Lore.ui('awayCapped', { t: fmtTime(r.elapsed) });
      const parts = [];
      if (r.gained.sugar > 0.5) parts.push(fmt(r.gained.sugar) + ' ' + Lore.inline(cfg.text.stats.sugar));
      if (r.gained.reached > 0) parts.push(Lore.ui('awayPlaces', { n: fmtCount(r.gained.reached) }));
      if (parts.length) line += ' ' + parts.join(', ') + '.';
      ui.log(line);
      // And at the top of the page, where somebody coming back is looking.
      ui.awayNote(line);
    }
    return r;
  };

  const frame = (ms) => {
    if (!running) return;
    const t = typeof ms === 'number' ? ms : now();
    if (last === null) last = t;
    let dt = (t - last) / 1000;
    last = t;
    if (dt < 0) dt = 0;

    if (dt > cfg.time.catchUpAfter) {
      away(dt);
      acc = 0;
    } else {
      acc += dt;
      const tick = cfg.time.tick;
      let steps = 0;
      while (acc >= tick && steps < 100) { tell(sim.step(tick)); acc -= tick; steps++; }
    }

    sinceRender += dt;
    if (sinceRender >= 0.1) { ui.render(); sinceRender = 0; }
    view.draw(sim, dt);

    sinceSave += dt;
    if (sinceSave >= cfg.time.autosaveSeconds) { save(); sinceSave = 0; }

    win.requestAnimationFrame(frame);
  };

  // -- saving ---------------------------------------------------------------

  const save = () => {
    if (!storage || disposed) return false;
    const ok = Save.write(storage, KEY, sim.snapshot(), now());
    if (!ok) ui.savedNote('Couldn\'t save.');
    return ok;
  };

  const reload = () => {
    if (typeof win.location !== 'undefined' && win.location && typeof win.location.reload === 'function') {
      win.location.reload();
    }
  };

  const reset = () => {
    disposed = true;
    running = false;
    if (storage) Save.clear(storage, KEY);
    reload();
  };

  /**
   * Fruit: end this organism, count its spores into the genome, and open the
   * next one on new ground with the closing lines at the top of its log.
   */
  const fruit = () => {
    if (!sim.canFruit()) return null;
    const area = sim.area();
    const result = Sp.fruit(cfg, sim.state, sim.genome, area);
    const seed = hash(sim.state.seed, 'next:' + sim.genome.fruitings);
    const lines = [
      Lore.line(seed, 'fruitOpen'),
      Lore.line(sim.state.seed, 'fruit', { level: Lore.levelInfo(sim.state.level).name }),
    ];
    const state = openedState(cfg, sim.genome, seed, lines);
    const snap = { state, genome: JSON.parse(JSON.stringify(sim.genome)) };
    disposed = true;
    running = false;
    if (storage) Save.write(storage, KEY, snap, now());
    reload();
    return result;
  };

  const exportSave = () => Save.exportString(sim.snapshot(), now());

  const importSave = (str) => {
    const r = Save.importString(str);
    disposed = true;
    running = false;
    if (storage) Save.write(storage, KEY, r.snap, r.wall || now());
    reload();
    return true;
  };

  // -- layout ---------------------------------------------------------------

  /**
   * The picture is the whole window, and the journal lies over one edge of
   * it. The view is told how much of each edge is covered so it can keep the
   * organism in the part that can be seen.
   */
  const fit = () => {
    const host = canvas.parentNode;
    const w = win.innerWidth || (host && host.clientWidth) || 600;
    const h = win.innerHeight || (host && host.clientHeight) || 400;
    const inset = { left: 0, right: 0, top: 0, bottom: 0 };
    const journal = doc && doc.getElementById ? doc.getElementById('journal') : null;
    const box = journal && typeof journal.getBoundingClientRect === 'function'
      ? journal.getBoundingClientRect() : null;
    if (box && box.width > 0 && box.height > 0) {
      // Docked down one side on a wide window, along the foot on a narrow one.
      if (box.width >= w - 1) inset.bottom = Math.max(0, Math.min(h, h - box.top));
      else inset.right = Math.max(0, Math.min(w, box.width));
    }
    view.resize(w, h, win.devicePixelRatio || 1, inset);
  };

  const start = () => {
    fit();
    if (resumed && saved && saved.wall) {
      const gap = (now() - saved.wall) / 1000;
      if (gap > cfg.time.catchUpAfter) away(gap);
    }
    if (!resumed && !sim.state.log.length) ui.log(Lore.line(sim.state.seed, 'start'));
    else ui.restore();
    ui.render();
    running = true;
    last = null;
    win.requestAnimationFrame(frame);
  };

  const stop = () => { running = false; };

  if (win.addEventListener) {
    // A window that changes shape changes how much of the journal is on
    // screen, so the entries are laid out again and the newest one stays at
    // the foot of the page where it was.
    win.addEventListener('resize', () => { fit(); ui.renderLog(); });
    win.addEventListener('pagehide', save);
    win.addEventListener('beforeunload', save);
    if (doc && doc.addEventListener) {
      doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState === 'hidden') save();
        else last = null; // the next frame measures from now, so the gap counts once
      });
    }
  }

  const game = {
    sim, view, ui, actions, cfg, start, stop, frame, save, reset, fruit, exportSave, importSave, fit,
    get resumed() { return resumed; },
    get key() { return KEY; },
  };
  return game;
}
