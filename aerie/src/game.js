// Aerie: the carrier, the island, the fleet and the ledger, wired together.
import { withOverrides, applyIdentity } from '../config.js?v=20';
import { fill } from '../content.js?v=20';
import { makeShaders } from './shaders.js?v=20';
import { createWorld } from './world.js?v=20';
import { createDrones } from './drones.js?v=20';
import { createView } from './view.js?v=20';
import { createEconomy } from './economy.js?v=20';
import { createAdvice } from './advice.js?v=20';
import { createSave, createPrefs } from './save.js?v=20';
import { createUI } from './ui.js?v=20';
import { createControls } from './controls.js?v=20';
import { createQuality } from './quality.js?v=20';
import { createPerfLog } from './perflog.js?v=20';
import { loop, createGL } from './gl.js?v=20';
import { rng } from './rng.js?v=20';
import { fmt, duration } from './numbers.js?v=20';

export function createGame({ doc, canvas, cfg, content, storage, search }) {
  cfg = withOverrides(cfg, search, storage);
  applyIdentity(cfg, doc);
  const S = makeShaders(cfg);
  const eco = createEconomy(cfg);
  const advice = createAdvice(cfg, eco, { moving: () => selfMoving() });
  const save = createSave(cfg, storage);
  const prefs = createPrefs(cfg, storage);
  const perf = createPerfLog(cfg, storage);
  const K = cfg.kindOrder;

  // What the player set about the window last time. A quality preset they
  // chose is honoured before anything is drawn, so the first frame is already
  // the one they asked for.
  const wantQuality = cfg.render.presets[prefs.get('quality', cfg.render.quality)] ? prefs.get('quality', cfg.render.quality) : cfg.render.quality;
  cfg.render.scale = cfg.render.presets[wantQuality].scale;
  cfg.render.maxDpr = cfg.render.presets[wantQuality].dpr;
  // The frame they asked to be held, and what the guard learned this machine
  // could actually hold. Opening at last time's answer means the second run
  // starts where the first one settled instead of working the machine out
  // again from scratch, which the player watches happen.
  cfg.render.target = Number(prefs.get('target', cfg.render.target)) || cfg.render.target;
  if (cfg.render.presets[wantQuality].adapt) {
    const learned = Number(prefs.get('learnedScale', 0));
    if (learned > 0 && cfg.adapt.rungs.indexOf(learned) >= 0) cfg.render.scale = learned;
  }

  // ---- the picture ----
  const G = createGL(canvas, { maxDpr: cfg.render.maxDpr, minDpr: cfg.render.minDpr });
  const gl = G.gl;
  const world = createWorld(gl, cfg, S);
  const drones = createDrones(gl, cfg, S);
  const view = createView(G, canvas, cfg, S, world, drones);

  // ---- load or begin ----
  const snap = save.read();
  let anchor = null;
  let offline = null;
  if (snap && eco.load(snap.eco)) {
    if (snap.seed) cfg.world.seed = snap.seed;
    anchor = Array.isArray(snap.anchor) && snap.anchor.length === 2 ? snap.anchor : null;
    const away = snap.at ? (Date.now() - snap.at) / 1000 : 0;
    if (away > 30) offline = eco.catchUp(away);
  } else {
    cfg.world.seed = 'north-' + rng(String(Date.now())).int(1000, 999999).toString(36);
  }
  world.generate(eco.state.island);
  if (!anchor) anchor = world.landPoint(rng(cfg.world.seed + '/anchor'));
  view.placeCarrier(anchor[0], anchor[1]);
  drones.reset(view.state.carrier);
  const syncFleet = () => drones.setFleet(eco.state.drones, eco.state.specialists, K);
  syncFleet();
  // the land the fleet worked while the tab was closed
  if (offline && offline.worked > 60) {
    const strip = Math.min(0.85, offline.worked / 3600 * 0.08 * Math.log10(10 + eco.state.drones));
    world.step(0, view.state.carrier, eco.range(), strip);
  }

  // ---- the interface ----
  const actions = {
    hire: (n) => {
      const many = Math.max(1, n | 0);
      if (!eco.actions.hire.do(many)) return;
      syncFleet();
      // One drone is a moment worth naming; a wing of them is a fleet figure.
      if (eco.state.drones === cfg.drones.start + 1) ui.log(content.log.firstHire);
      else if (many === 1) ui.log(fill(content.log.hire, { n: eco.state.drones }), 'hire');
      else ui.log(fill(content.log.hireMany, { n: fmt(many), total: fmt(eco.state.drones) }), 'hire');
    },
    wing: () => { if (eco.actions.wing.do()) { syncFleet(); ui.log(fill(content.log.wing, { n: cfg.economy.wingSize })); } },
    specialist: (k, n) => {
      const many = Math.max(1, n | 0);
      if (!eco.actions.specialist.do(k, many)) return;
      syncFleet();
      ui.log(many === 1 ? fill(content.log.specialist, { kind: content.kinds[k] })
                        : fill(content.log.specialistMany, { n: fmt(many), kind: content.kinds[k] }), 'spec-' + k);
    },
    upgrade: (u, n) => {
      const many = Math.max(1, n | 0);
      if (!eco.actions.upgrade.do(u, many)) return;
      ui.log(fill(content.log.upgrade, { name: cfg.economy.upgrades[u].name, n: eco.level(u) }), 'up-' + u);
      if (u === 'hangars') cfg.carrier.scale = 1 + 0.06 * eco.level('hangars');
    },
    castOff: () => {
      if (!eco.actions.castOff.do()) return;
      ui.log(fill(content.log.castOff, { n: eco.state.island }));
      world.generate(eco.state.island);
      const p = world.landPoint(rng(cfg.world.seed + '/anchor-' + eco.state.island));
      view.placeCarrier(p[0], p[1]);
      // A new island: whatever the carrier was crossing to belonged to the old
      // one, and a spot left behind there would read as a crossing that never
      // ends.
      driftTarget = null;
      drones.reset(view.state.carrier);
      syncFleet();
      // The card stays. Hiding it here only made it blink: the test that
      // reveals it reads lifetime earnings, which never fall, so it came
      // straight back and announced itself again on every voyage.
      ui.log(content.log.arrive);
      persist();
    },
    exportSave: () => { ui.el.saveBox.hidden = false; ui.el.saveBox.value = save.encode(snapshot()); ui.el.saveBox.select(); ui.log(content.log.exported); },
    importSave: () => {
      const s = ui.el.saveBox.hidden ? '' : ui.el.saveBox.value;
      // The first press opens an empty box; the second reads what was pasted
      // into it, so the first press has to say what it is waiting for.
      if (!s) { ui.el.saveBox.hidden = false; ui.el.saveBox.value = ''; ui.el.saveBox.focus(); ui.log(content.log.pasteSave); return; }
      const obj = save.decode(s);
      if (!obj || !obj.eco) { ui.log(content.log.badImport); return; }
      save.write(obj);
      keepSaving = false;
      location.reload();
    },
    reset: () => {
      if (doc.defaultView && doc.defaultView.confirm && !doc.defaultView.confirm(content.labels.resetConfirm)) return;
      keepSaving = false;
      save.clear();
      location.reload();
    },
    // the window's own controls
    quality: (name) => {
      if (!quality.choose(name)) return;
      prefs.set('quality', name);
      // A preset chosen by hand replaces whatever the guard had learned; the
      // learned number is only ever the guard's own answer.
      if (!quality.adapting) prefs.set('learnedScale', 0);
      ui.showQuality(quality.preset, quality.scale, quality.rate);
    },
    target: (fps) => {
      if (!quality.aimAt(fps)) return;
      prefs.set('target', fps);
      // What was learned was learned against the old frame, so it stops being
      // an answer the moment the question changes.
      prefs.set('learnedScale', 0);
      ui.showTarget(quality.target);
    },
    fold: () => { const next = !prefs.get('folded', false); prefs.set('folded', next); ui.showFold(next); },
    help: () => { ui.showKeys(!ui.keysOpen); },
    closeHelp: () => ui.showKeys(false),
    recentre: () => view.control.recentre(),
    close: () => { ui.showKeys(false); ui.el.saveBox.hidden = true; },
    exportPerf: () => { ui.el.saveBox.hidden = false; ui.el.saveBox.value = perf.text(); ui.el.saveBox.select(); },
    upgrade1: () => actions.upgrade(Object.keys(cfg.economy.upgrades)[0]),
    upgrade2: () => actions.upgrade(Object.keys(cfg.economy.upgrades)[1]),
    upgrade3: () => actions.upgrade(Object.keys(cfg.economy.upgrades)[2]),
    upgrade4: () => actions.upgrade(Object.keys(cfg.economy.upgrades)[3]),
  };

  // The quality guard, and the keyboard. Both read their tables from config,
  // so a change there is the whole change.
  const quality = createQuality(cfg, {
    onScale: (s) => view.setScale(s),
    onDpr: (d) => { G.setMaxDpr(d); view.setScale(cfg.render.scale); },
  });
  const ui = createUI(doc, cfg, content, eco, actions);
  const flags = eco.state.flags;
  // Opened at what the guard learned about this machine, if it learned one.
  quality.choose(wantQuality, cfg.render.scale !== cfg.render.presets[wantQuality].scale);
  ui.showQuality(quality.preset, quality.scale, 0);
  ui.showTarget(quality.target);
  ui.showFold(prefs.get('folded', false));
  ui.reveal(flags);
  ui.log(snap ? fill(content.log.resume, { n: eco.state.island }) : fill(content.log.start, { n: cfg.drones.start }));
  if (offline && offline.worked > 30) {
    ui.log(fill(content.labels.offline, { time: duration(offline.away), funds: fmt(offline.earned) }));
    if (offline.capped) ui.log(fill(content.labels.offlineCapped, { worked: duration(offline.worked) }));
  }

  const controls = createControls(cfg, {
    fly: (dx, dz) => { view.fly(dx, dz); tookTheWheel(); },
    camera: view.control,
    actions,
    panel: actions.fold,
    help: actions.help,
  });
  controls.attach(window);

  // Moving the carrier is said once, not once per click. The deck log holds a
  // handful of lines, and a few camera-side clicks used to push out the very
  // messages the game had just spent an unlock teaching.
  let saidAnchor = false;
  // When the player last took the carrier themselves. The carrier finds its
  // own ground when the land runs down, and a hand on the wheel stops it doing
  // that for a while - being overruled by the game a second after choosing
  // where to sit would be worse than never being helped at all.
  let handAt = -1e9;
  const tookTheWheel = () => { handAt = clock; driftTarget = null; };
  // Where the carrier chose to go, while it is still on its way there. The
  // compass reads this so it does not spend its one sentence asking for a
  // move that is already under way.
  let driftTarget = null;
  const selfMoving = () => {
    if (!driftTarget) return false;
    const c = view.state.carrier;
    if (Math.hypot(c[0] - driftTarget[0], c[2] - driftTarget[1]) <= cfg.carrier.drift.arrived) { driftTarget = null; return false; }
    return true;
  };
  canvas.addEventListener('click', (e) => {
    const p = view.pick(e.clientX, e.clientY);
    if (!p) return;
    view.state.anchor = p;
    tookTheWheel();
    if (!saidAnchor) { saidAnchor = true; ui.log(content.log.anchor); }
  });

  const snapshot = () => ({ eco: eco.snapshot(), seed: cfg.world.seed, anchor: view.state.anchor, at: Date.now() });
  // Starting over and importing both write storage and then reload the page,
  // and a reload fires the unload save on the way out - which put the run that
  // was just thrown away straight back on top of it. Neither button did
  // anything at all. Once a save has been deliberately replaced or cleared,
  // this run stops writing.
  let keepSaving = true;
  const persist = () => { if (keepSaving) save.write(snapshot()); };

  // ---- reveal: panels arrive when they matter ----
  const checkReveal = () => {
    const s = eco.state;
    let changed = false;
    if (!flags.hold && s.drones >= cfg.reveal.holdAtDrones) { flags.hold = true; ui.log(content.log.holdOpen); changed = true; }
    if (!flags.specialists && s.drones >= cfg.reveal.specialistsAtDrones) { flags.specialists = true; ui.log(content.log.specialistsOpen); changed = true; }
    if (!flags.carrier && s.lifetime >= cfg.reveal.carrierAtFunds) { flags.carrier = true; ui.log(content.log.carrierOpen); changed = true; }
    if (!flags.voyage && (s.remaining <= cfg.reveal.voyageAtDepletion || s.lifetime >= cfg.reveal.voyageAtFunds)) { flags.voyage = true; ui.log(content.log.voyageOpen); changed = true; }
    if (changed) ui.reveal(flags);
  };
  // The compass line. It reads the same ledger the panel does, so it can
  // never name a figure the player cannot find on screen.
  const showAdvice = () => {
    const a = advice.read();
    const line = content.advice[a.key];
    if (line) ui.advise(fill(line, a.vars), a.key);
  };

  // The carrier looks for better ground when the land under it is worked
  // down. It is the one thing in the game a player has to think of on their
  // own, and nobody did: it is on by default and a hand on the wheel outranks
  // it. What it finds costs nothing to work out - it reads the same richness
  // grid the summary already brought back this second.
  let driftAt = 0, saidDrift = false;
  const drift = () => {
    const D = cfg.carrier.drift;
    if (!D || !D.on) return;
    if (clock - handAt < D.afterHand || clock - driftAt < D.every) return;
    const s = eco.state;
    const bestKind = K.reduce((a, k) => (s.avail[k] > s.avail[a] ? k : a), K[0]);
    if (s.avail[bestKind] >= D.below) return;
    driftAt = clock;
    const spot = world.bestSpot(eco.range(), [view.state.carrier[0], view.state.carrier[2]]);
    if (!spot.at || !(spot.best > spot.here * D.better)) return;
    view.state.anchor = spot.at;
    driftTarget = spot.at;
    if (!saidDrift) { saidDrift = true; ui.log(content.log.drift); }
  };

  const priceWarned = {};
  const checkPrices = () => {
    for (const k of K) {
      const p = eco.price(k) / (cfg.kinds[k].basePrice * eco.islandPrice());
      if (p < 0.5 && !priceWarned[k]) { priceWarned[k] = true; ui.log(fill(content.log.priceLow, { kind: content.kinds[k], pct: Math.round(p * 100) + '%' })); }
      if (p > 0.85 && priceWarned[k]) { priceWarned[k] = false; ui.log(fill(content.log.priceBack, { kind: content.kinds[k] })); }
    }
  };

  // ---- the loop ----
  let summaryT = 0, saveT = 0, uiT = 0, clock = 0, adviceT = 0;
  const speed = () => eco.droneSpeed();
  let qualityT = 0, perfT = 0;
  const stop = loop((dt, t) => {
    const h = Math.min(dt, 0.05);
    clock += dt;
    // The keys get the real frame, not the simulation's clamped one. That
    // clamp is there so a long frame cannot make the world jump; applying it
    // to input instead makes the camera crawl on exactly the machines that
    // can least afford to feel sluggish. A generous ceiling still stops a
    // tab returning from the background flinging the carrier across the sea.
    controls.step(Math.min(dt, 0.25));
    view.update(h);
    drones.step(h, t, world, view.state.carrier, eco.range(), speed());
    world.step(h, view.state.carrier, eco.range());
    summaryT += dt;
    if (summaryT >= 1) {
      summaryT = 0;
      const sum = world.summary(view.state.carrier, eco.range());
      eco.state.remaining = sum.remaining;
      eco.tick(1, sum.avail);
      checkReveal();
      checkPrices();
      drift();
    }
    // The compass, on its own clock. It read the ledger once a second because
    // that is where the call sat, not because anything said so, and the number
    // in config that says how often was read by nothing at all.
    adviceT += dt;
    if (adviceT >= cfg.advice.every) { adviceT = 0; showAdvice(); }
    view.draw(t, eco.range(), 0.0009, h);
    // Watch the frames and let the guard move the resolution if it must.
    // A move is what this machine has just been shown to hold, so it is
    // remembered; the next run opens there rather than working it out again.
    if (quality.sample(dt * 1000) && quality.adapting) {
      prefs.set('learnedScale', +quality.scale.toFixed(2));
    }
    perfT += dt;
    if (perfT >= cfg.adapt.logEvery) {
      perfT = 0;
      perf.record(quality.window(), { quality: quality.preset, scale: +quality.scale.toFixed(2), buffer: canvas.width + 'x' + canvas.height, dpr: +G.dpr().toFixed(2), drones: eco.state.drones });
    }
    uiT += dt;
    if (uiT >= 0.25) { uiT = 0; ui.update({ active: drones.active }); }
    qualityT += dt;
    if (qualityT >= 1) { qualityT = 0; ui.showQuality(quality.preset, quality.scale, quality.rate); }
    saveT += dt;
    if (saveT >= 10) { saveT = 0; persist(); }
    window.__frame = (window.__frame || 0) + 1;
  });
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) persist(); });
  window.addEventListener('beforeunload', persist);

  // If the graphics context is taken away, everything on the GPU goes with it
  // - the island, the fleet, every shader - and none of it can be drawn again
  // from the objects this run is holding. The run itself is only a seed and a
  // ledger, so the honest recovery is to write it down and start the page
  // over once the browser offers a context back: the same island rebuilds
  // from the same seed and the player keeps everything they had.
  G.onContextLost(() => { persist(); ui.log(content.log.contextLost); });
  G.onContextRestored(() => { location.reload(); });
  ui.update({ active: drones.active });
  showAdvice();

  return { cfg, eco, world, drones, view, ui, save, prefs, perf, quality, controls, advice, stop, persist, snapshot };
}
