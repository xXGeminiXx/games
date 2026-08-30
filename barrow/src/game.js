// ---------------------------------------------------------------------------
// The composition root: the simulation, the page, the field, the clock and
// the save, wired together.
//
// Time is the one thing this file owns. The simulation is stepped at a fixed
// tick while the tab is open; a gap longer than a few seconds (the tab was
// hidden, the machine slept, the page was closed) is handed to the simulation
// as time away and caught up in coarse chunks, then reported in the log. The
// save carries the wall clock so a reload knows how long that was.
//
// It also owns the one thing that outlives a run. Sealing a barrow does not
// edit the state in place: it writes the next barrow's opening state, with
// the oaths already applied and the closing lines already in its log, and
// reloads onto it.
// ---------------------------------------------------------------------------

import { storageKey, fill } from '../config.js?v=14';
import { createSim, restoreSim, openedState } from './sim.js?v=14';
import * as Save from './save.js?v=14';
import * as Rb from './rebirth.js?v=14';
import * as Lore from './lore.js?v=14';
import { hash } from './rng.js?v=14';
import { createUI } from './ui.js?v=14';
import { createView } from './view.js?v=14';
import { fmtTime, fmt, fmtCoin, fmtCount } from './numbers.js?v=14';
import * as Mat from './materials.js?v=14';

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

  const view = createView(canvas, cfg.view, cfg.palette, cfg.strata, cfg.horde, doc, sim.ground);

  const actions = {};
  const ui = createUI(doc, sim, cfg, actions);
  const tell = (events) => { for (const e of events) ui.say(e); };

  const wrap = (fn) => (...args) => {
    const r = fn(...args);
    const events = Array.isArray(r) ? r : (r && r.events) || [];
    tell(events);
    ui.render();
    return r;
  };
  actions.dig = wrap(() => sim.dig());
  actions.sell = wrap((id, q) => sim.sell(id, q));
  actions.sellShare = wrap((id, share) => sim.sellShare(id, share));
  actions.sellLot = wrap((id) => sim.sellLot(id));
  actions.sellLesser = wrap(() => {
    const events = [];
    const from = sim.activeFrom();
    for (const id of sim.goods()) {
      const k = Mat.strataOf(id);
      if (k >= 0 && k < from) for (const e of sim.sellShare(id, 1).events) events.push(e);
    }
    return events;
  });
  actions.buy = wrap((id) => sim.buy(id));
  actions.raise = wrap((count) => { const r = sim.raise(count); save(); return r; });
  actions.setWeight = wrap((key, delta) => { sim.setWeight(key, delta); return []; });
  actions.buyRite = wrap((id, count) => { const r = sim.buyRite(id, count); save(); return r; });
  actions.takeOffer = wrap((i) => { const r = sim.takeOffer(i); save(); return r; });
  actions.acceptVisitor = wrap(() => { const r = sim.acceptVisitor(); save(); return r; });
  actions.declineVisitor = wrap(() => { const r = sim.declineVisitor(); save(); return r; });
  actions.buyOath = wrap((id) => {
    const level = Rb.buyOath(sim.legacy, id, cfg);
    if (level > 0) save();
    return [];
  });
  actions.seal = () => seal();

  // -- the clock -------------------------------------------------------------

  let last = null;          // wall ms of the previous frame
  let acc = 0;              // seconds owed to the simulation
  let sinceSave = 0;
  let sinceRender = 0;
  let running = false;
  let disposed = false;     // after a reset, an import or a seal: never write the old run again

  const away = (seconds) => {
    const r = sim.advance(seconds);
    tell(r.events);
    if (r.away && r.elapsed > 30) {
      // The stat labels are stored the way a label reads, so they come back
      // down to lower case before going into a sentence.
      const parts = [];
      if (r.gained.coin > 0.005) parts.push(fmtCoin(r.gained.coin) + ' ' + Lore.inline(cfg.text.stats.coin));
      if (r.gained.horde >= 1) parts.push(fmtCount(r.gained.horde) + ' more of them');
      if (r.gained.bones >= 1) parts.push(fmt(Math.floor(r.gained.bones)) + ' ' + Lore.inline(cfg.text.stats.bones));
      if (r.gained.strata > 0) parts.push(r.gained.strata + (r.gained.strata === 1 ? ' layer' : ' layers'));
      // How long the player was gone, not how long the dead lasted: when the
      // two differ, the tail below says where they stopped.
      const gone = r.capped ? seconds : r.elapsed;
      let line = Lore.line(sim.state.seed, 'away', { t: fmtTime(gone) }, String(Math.floor(sim.state.t)));
      if (parts.length) line += ' ' + parts.join(', ') + '.';
      // These are whole sentences after a full stop, so they take capitals
      // like every other sentence the game writes.
      if (r.gained.visits > 0) line += ' ' + (r.gained.visits === 1 ? 'Somebody called at the gate.' : r.gained.visits + ' called at the gate.');
      if (r.capped) line += ' They stopped after ' + fmtTime(r.elapsed) + '.';
      ui.log(line);
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
    view.draw(sim.state, sim.state.effort, dt, sim.mods().activeStrata);

    sinceSave += dt;
    if (sinceSave >= cfg.time.autosaveSeconds) { save(); sinceSave = 0; }

    win.requestAnimationFrame(frame);
  };

  // -- saving ---------------------------------------------------------------

  const save = () => {
    if (!storage || disposed) return false;
    const ok = Save.write(storage, KEY, sim.snapshot(), now());
    if (!ok) ui.savedNote('Couldn\'t save');
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
   * Close this barrow and open the next one. What the run paid is folded into
   * the legacy, the closing lines go to the top of the new run's log, and the
   * page comes back on ground it has never seen.
   */
  const seal = () => {
    if (!sim.canSeal()) return null;
    const result = Rb.seal(sim.state, cfg, sim.legacy);
    const seed = hash(sim.state.seed, 'next-barrow:' + sim.legacy.seals);
    const state = openedState(cfg, sim.legacy, seed, result.lines.slice().reverse());
    const snap = { state, markets: [], legacy: JSON.parse(JSON.stringify(sim.legacy)) };
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

  const fit = () => {
    const host = canvas.parentNode;
    const w = host && host.clientWidth ? host.clientWidth : (win.innerWidth || 600);
    const h = host && host.clientHeight ? host.clientHeight : (win.innerHeight || 400);
    view.resize(w, h, win.devicePixelRatio || 1);
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
    win.addEventListener('resize', fit);
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
    sim, view, ui, actions, cfg, start, stop, frame, save, reset, seal, exportSave, importSave, fit,
    get resumed() { return resumed; },
    get key() { return KEY; },
  };
  return game;
}
