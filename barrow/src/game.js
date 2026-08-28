// ---------------------------------------------------------------------------
// The composition root: the simulation, the page, the field, the clock and
// the save, wired together.
//
// Time is the one thing this file owns. The simulation is stepped at a fixed
// tick while the tab is open; a gap longer than a few seconds (the tab was
// hidden, the machine slept, the page was closed) is handed to the simulation
// as time away and caught up in coarse chunks, then reported in the log. The
// save carries the wall clock so a reload knows how long that was.
// ---------------------------------------------------------------------------

import { storageKey, fill } from '../config.js?v=1';
import { createSim, restoreSim } from './sim.js?v=1';
import * as Save from './save.js?v=1';
import { createUI } from './ui.js?v=1';
import { createView } from './view.js?v=1';
import { fmtTime, fmt, fmtCoin } from './numbers.js?v=1';
import * as Mat from './materials.js?v=1';

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

  const view = createView(canvas, cfg.view, cfg.palette, cfg.strata, cfg.horde, doc);

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
    const from = Math.max(0, sim.state.depth - cfg.horde.activeStrata + 1);
    for (const id of sim.goods()) {
      const k = Mat.strataOf(id);
      if (k >= 0 && k < from) for (const e of sim.sellShare(id, 1).events) events.push(e);
    }
    return events;
  });
  actions.buy = wrap((id) => sim.buy(id));
  actions.raise = wrap((count) => { const r = sim.raise(count); save(); return r; });
  actions.setWeight = wrap((key, delta) => { sim.setWeight(key, delta); return []; });
  actions.buyRite = wrap((id) => { const r = sim.buyRite(id); save(); return r; });

  // -- the clock -------------------------------------------------------------

  let last = null;          // wall ms of the previous frame
  let acc = 0;              // seconds owed to the simulation
  let sinceSave = 0;
  let sinceRender = 0;
  let running = false;
  let disposed = false;     // after a reset or an import: never write the old run again

  const away = (seconds) => {
    const r = sim.advance(seconds);
    tell(r.events);
    if (r.away && r.elapsed > 30) {
      const parts = [];
      if (r.gained.coin > 0.005) parts.push(fmtCoin(r.gained.coin) + ' ' + cfg.text.stats.coin);
      if (r.gained.bones >= 1) parts.push(fmt(Math.floor(r.gained.bones)) + ' ' + cfg.text.stats.bones);
      if (r.gained.strata > 0) parts.push(r.gained.strata + ' strata');
      let line = fill(cfg.text.log.away, { t: fmtTime(r.elapsed) });
      if (parts.length) line += ' ' + parts.join(', ') + '.';
      if (r.capped) line += ' they stopped after ' + fmtTime(r.elapsed) + '.';
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
    view.draw(sim.state, sim.state.effort, dt);

    sinceSave += dt;
    if (sinceSave >= cfg.time.autosaveSeconds) { save(); sinceSave = 0; }

    win.requestAnimationFrame(frame);
  };

  // -- saving ---------------------------------------------------------------

  const save = () => {
    if (!storage || disposed) return false;
    const ok = Save.write(storage, KEY, sim.snapshot(), now());
    if (!ok) ui.savedNote('could not save');
    return ok;
  };

  const reset = () => {
    disposed = true;
    running = false;
    if (storage) Save.clear(storage, KEY);
    if (typeof win.location !== 'undefined' && win.location && typeof win.location.reload === 'function') win.location.reload();
  };

  const exportSave = () => Save.exportString(sim.snapshot(), now());

  const importSave = (str) => {
    const r = Save.importString(str);
    disposed = true;
    running = false;
    if (storage) Save.write(storage, KEY, r.snap, r.wall || now());
    if (typeof win.location !== 'undefined' && win.location && typeof win.location.reload === 'function') win.location.reload();
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
    if (!resumed) ui.log(cfg.text.log.start);
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
    sim, view, ui, actions, start, stop, frame, save, reset, exportSave, importSave, fit,
    get resumed() { return resumed; },
    get key() { return KEY; },
  };
  return game;
}
