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
// It also owns the one thing that outlives a run. Filling a barrow in writes
// the next barrow's opening state, with the oaths already applied and the
// closing lines already in its log, and opens it on the page that is already
// up. The page used to reload onto it, and a strong crew set to fill in at a
// shallow layer reloaded it several times a second: the page flashed, would
// not scroll, and the one control that could stop it was out of reach.
// ---------------------------------------------------------------------------

import { storageKey, fill } from '../config.js?v=56';
import { createSim, restoreSim, openedState } from './sim.js?v=56';
import * as Save from './save.js?v=56';
import * as Rb from './rebirth.js?v=56';
import * as Lore from './lore.js?v=56';
import { hash } from './rng.js?v=56';
import { createUI } from './ui.js?v=56';
import { createView } from './view.js?v=56';
import { fmtTime, fmt, fmtCoin, fmtCount } from './numbers.js?v=56';

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

  // The page reads the barrow through this, so a new barrow opening swaps
  // what it reads without the page being built again.
  const live = new Proxy({}, {
    get: (_, k) => sim[k],
    set: (_, k, v) => { sim[k] = v; return true; },
    has: (_, k) => k in sim,
  });

  const view = createView(canvas, cfg.view, cfg.palette, cfg.strata, cfg.horde, doc, sim.ground, cfg.lords);
  // The barrow the hill is drawing. It moves on to a new barrow at most once
  // a second: a strong crew set to fill in shallow opens barrows a fifth of a
  // second apart, one at layer 10 and the next at 75, and a hill swapping
  // between them at that rate is a flashing light. Barrows go on filling in
  // at their own pace underneath; only the picture waits.
  let shown = sim;
  let shownAt = -Infinity;
  const HILL_HOLD_MS = 1000;

  const actions = {};
  const ui = createUI(doc, live, cfg, actions);
  const tell = (events) => { for (const e of events) ui.say(e); };

  const wrap = (fn) => (...args) => {
    const r = fn(...args);
    const events = Array.isArray(r) ? r : (r && r.events) || [];
    tell(events);
    ui.render();
    return r;
  };
  actions.dig = wrap(() => sim.dig());
  actions.raise = wrap((count) => { const r = sim.raise(count); save(); return r; });
  actions.setWeight = wrap((key, delta) => { sim.setWeight(key, delta); return []; });
  actions.setWeightAt = wrap((key, value) => { sim.setWeightAt(key, value); return []; });
  actions.setByHand = wrap((on) => { sim.setByHand(on); save(); return []; });
  actions.buyRite = wrap((id, count) => { const r = sim.buyRite(id, count); save(); return r; });
  actions.takeOffer = wrap((i) => { const r = sim.takeOffer(i); save(); return r; });
  actions.acceptVisitor = wrap(() => { const r = sim.acceptVisitor(); save(); return r; });
  actions.declineVisitor = wrap(() => { const r = sim.declineVisitor(); save(); return r; });
  actions.buyOath = wrap((id) => {
    const level = Rb.buyOath(sim.legacy, id, cfg);
    if (level > 0) save();
    return [];
  });
  actions.seal = (hill) => seal(hill);
  actions.setAutoBuy = wrap((on) => { sim.setAutoBuy(on); save(); return []; });
  actions.setAutoRaise = wrap((on) => { sim.setAutoRaise(on); save(); return []; });
  actions.dismissEnding = wrap(() => { sim.dismissEnding(); save(); return []; });
  actions.setRitePick = (n) => { sim.legacy.ritePick = n; save(); };
  actions.savePrefs = () => { save(); };
  actions.setAutoSeal = wrap((n) => { sim.setAutoSeal(n); save(); return []; });

  // -- the clock -------------------------------------------------------------

  let last = null;          // wall ms of the previous frame
  let acc = 0;              // seconds owed to the simulation
  let sinceSave = 0;
  let sinceRender = 0;
  let running = false;
  let disposed = false;     // after a reset, an import or a seal: never write the old run again

  // Nobody was looking at the page for this stretch, so it is dug at the away
  // pace: an open tab with the player watching always gets further.
  // Time away that belongs to the next barrow: the one open now reached the
  // layer it fills itself in at before the time ran out.
  let owedNext = 0;
  // Time away still to be dug by barrows not yet opened. A strong crew set to
  // fill in shallow can go through thousands of barrows in a few hours away,
  // so they are worked off a few a frame and the page keeps answering.
  let backlog = 0;
  // What those barrows came to, said once in the log when they are done.
  let behind = null;
  const clockMs = win.performance && typeof win.performance.now === 'function' ? () => win.performance.now() : null;
  const FRAME_BUDGET_MS = 8;
  const FRAME_MAX_BARROWS = 25;

  // `quiet` is the backlog being dug after a fill-in: those barrows are summed
  // up in one line once they are all done, instead of a line each.
  const away = (seconds, quiet) => {
    const relics0 = sim.legacy.remembrance || 0;
    const r = sim.advance(seconds, { unwatched: true, stopForFillIn: true });
    owedNext = r.stopped ? r.leftover : 0;
    if (!quiet && r.stopped && !behind) behind = { gone: seconds, barrows: 0, relics: relics0, layer: sim.legacy.autoSealAt };
    // A barrow that did not fill in keeps going, so what it did is said.
    if (quiet) { if (!r.stopped) tell(r.events); return r; }
    tell(r.events);
    if (r.away && r.elapsed > 30) {
      // The stat labels are stored the way a label reads, so they come back
      // down to lower case before going into a sentence.
      const parts = [];
      if (r.gained.coin > 0.005) parts.push(fmtCoin(r.gained.coin) + ' ' + Lore.inline(cfg.text.stats.coin));
      if (r.gained.horde >= 1) parts.push(fmtCount(r.gained.horde) + ' more diggers');
      if (r.gained.bones >= 1) parts.push(fmt(Math.floor(r.gained.bones)) + ' ' + Lore.inline(cfg.text.stats.bones));
      if (r.gained.strata > 0) parts.push(r.gained.strata + (r.gained.strata === 1 ? ' layer' : ' layers'));
      if (r.gained.doors > 0) parts.push(r.gained.doors + (r.gained.doors === 1 ? ' lord\'s door broken' : ' lords\' doors broken'));
      if (r.gained.relics >= 1) parts.push('+' + fmt(Math.floor(r.gained.relics)) + ' relics');
      // How long the player was gone, not how long the dead lasted: when the
      // two differ, the tail below says where they stopped.
      const gone = r.capped ? seconds : r.elapsed;
      let line = Lore.line(sim.state.seed, 'away', { t: fmtTime(gone) }, String(Math.floor(sim.state.t)));
      // How much digging that came to, when nobody watching made it less.
      if (r.elapsed - r.worked >= 1) line += ' ' + Lore.line(sim.state.seed, 'slow', { t: fmtTime(r.worked) }, String(Math.floor(sim.state.t)));
      if (parts.length) line += ' ' + parts.join(', ') + '.';
      // These are whole sentences after a full stop, so they take capitals
      // like every other sentence the game writes.
      if (r.gained.waiting) {
        const who = sim.state.visitor && sim.state.visitor.name ? sim.state.visitor.name : 'Someone';
        line += ' ' + Lore.line(sim.state.seed, 'waiting', { who }, String(sim.state.visitCount));
      }
      if (r.capped) line += ' They stopped digging after ' + fmtTime(r.elapsed) + '.';
      ui.log(line);
    }
    return r;
  };

  const frame = () => {
    if (!running) return;
    // The wall clock, not the frame clock. A tab in the background is handed
    // no frames at all and a sleeping machine stops counting frame time, so
    // the only reading that survives either one is the time of day. It also
    // means every gap is measured once, by the same clock the save carries.
    const t = now();
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
    if (shown !== sim && t - shownAt >= HILL_HOLD_MS) {
      shown = sim;
      shownAt = t;
      view.setGround(sim.ground);
    }
    const md = shown.mods();
    view.draw(shown.state, shown.state.worked || [], dt, md.activeStrata, shown.split(), md, shown.legacy);

    // A barrow the player asked to fill itself in, once it is deep enough, and
    // whatever time away the barrows after it are still owed.
    if (sim.autoSealDue()) fillIn();
    catchUp();
    owedNext = 0;

    sinceSave += dt;
    if (sinceSave >= cfg.time.autosaveSeconds) { save(); sinceSave = 0; }

    win.requestAnimationFrame(frame);
  };

  // -- saving ---------------------------------------------------------------

  // Time away not yet dug is kept by dating the save back, so closing the tab
  // part way through loses none of it.
  const save = () => {
    if (!storage || disposed) return false;
    const ok = Save.write(storage, KEY, sim.snapshot(), now() - backlog * 1000);
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
   * page goes on, on ground it has never seen.
   */
  // `owed` is time away the next barrow is still to be given; it joins the
  // backlog and is dug by the frames that follow. `auto` is a barrow that
  // filled itself in: the card summing up the last barrow stays the way the
  // player left it, so one closed stays closed instead of coming back every
  // few seconds and shoving everything under it down the page.
  const seal = (hill, owed, auto) => {
    if (!sim.canSeal()) return null;
    // The next hill: the one picked, or the first on offer when the barrow
    // filled itself in, or a plain one when rank offers no choice.
    const choices = sim.hillChoices();
    const next = choices.includes(hill) ? hill : (choices[0] || null);
    const cardUp = !!sim.state.ending;
    sim.keepPlacing();
    const result = Rb.seal(sim.state, cfg, sim.legacy);
    const seed = hash(sim.state.seed, 'next-barrow:' + sim.legacy.seals);
    const state = openedState(cfg, sim.legacy, seed, result.lines.slice().reverse(), next);
    if (auto) state.ending = state.ending && cardUp;
    // The same trip through the save a reload would have taken, so the barrow
    // that opens here is the one a fresh page would have opened.
    const snap = Save.migrate(JSON.parse(JSON.stringify({ state, markets: [], legacy: sim.legacy })));
    const opened = snap && restoreSim(cfg, snap);
    if (!opened) return null;
    sim = opened;
    // Filled in by hand, the hill shows the new barrow straight away.
    if (!auto) shownAt = -Infinity;
    ui.newBarrow();
    if (owed > 0) backlog += owed;
    if (behind) behind.barrows++;
    save();
    ui.render();
    return result;
  };

  const fillIn = () => {
    sim.answerForFillIn();
    const owed = owedNext;
    owedNext = 0;
    return seal(null, owed, true);
  };

  // Time away the barrows after a fill-in are still owed, dug a few barrows a
  // frame. Each one stops at the layer it fills in at like any time away, and
  // what it leaves over goes to the one after.
  const catchUp = () => {
    const until = clockMs ? clockMs() + FRAME_BUDGET_MS : 0;
    for (let n = 0; backlog > 0 && n < FRAME_MAX_BARROWS; n++) {
      const owed = backlog;
      backlog = 0;
      away(owed, true);
      if (sim.autoSealDue()) fillIn();
      if (clockMs && clockMs() >= until) break;
    }
    if (!(backlog > 0) && behind) {
      if (behind.barrows > 0) ui.log(behindLine(behind));
      behind = null;
    }
  };

  const behindLine = (b) => {
    const T = cfg.text;
    const relics = (sim.legacy.remembrance || 0) - b.relics;
    let line = fill(b.barrows === 1 ? T.filledAwayOne : T.filledAway,
      { t: fmtTime(b.gone), n: fmt(b.barrows), depth: sim.legacy.autoSealAt || b.layer });
    if (relics >= 1) line += ' ' + fill(T.filledAwayPaid, { n: fmt(Math.floor(relics)) });
    return line;
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
    const now0 = view.size;
    if (now0 && now0.width === w && now0.height === h && now0.dpr === (win.devicePixelRatio || 1)) return;
    view.resize(w, h, win.devicePixelRatio || 1);
  };

  // The hill's box changes size after the page opens - the upgrades panel
  // under it appears, a window is resized - and a canvas sized once at the
  // start was then stretched to its new box: the picture was drawn for a
  // field twice as tall and squashed to half height, writing and all. It is
  // measured again whenever its box changes.
  let watching = false;
  const watchSize = () => {
    if (watching) return;
    watching = true;
    const host = canvas.parentNode;
    if (host && win.ResizeObserver) {
      try { new win.ResizeObserver(() => fit()).observe(host); } catch (e) { /* no observer: the window's resize event below still fits it */ }
    }
  };

  const start = () => {
    fit();
    watchSize();
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
      // Going out of sight writes the save, in case the tab never comes back.
      // Coming back does nothing on purpose: the next frame reads the time of
      // day and the whole stretch in the background arrives as its gap, the
      // same as any other, and is caught up there.
      doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState === 'hidden') save();
      });
    }
  }

  const game = {
    ui, actions, cfg, start, stop, frame, save, reset, seal, exportSave, importSave, fit,
    get sim() { return sim; },
    get view() { return view; },
    get backlog() { return backlog; },
    get resumed() { return resumed; },
    get key() { return KEY; },
  };
  return game;
}
