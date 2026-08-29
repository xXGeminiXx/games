// Aerie: the carrier, the island, the fleet and the ledger, wired together.
import { withOverrides, applyIdentity } from '../config.js?v=12';
import { fill } from '../content.js?v=12';
import { makeShaders } from './shaders.js?v=12';
import { createWorld } from './world.js?v=12';
import { createDrones } from './drones.js?v=12';
import { createView } from './view.js?v=12';
import { createEconomy } from './economy.js?v=12';
import { createSave, createPrefs } from './save.js?v=12';
import { createUI } from './ui.js?v=12';
import { createControls } from './controls.js?v=12';
import { createQuality } from './quality.js?v=12';
import { createPerfLog } from './perflog.js?v=12';
import { loop, createGL } from './gl.js?v=12';
import { rng } from './rng.js?v=12';
import { fmt, duration } from './numbers.js?v=12';

export function createGame({ doc, canvas, cfg, content, storage, search }) {
  cfg = withOverrides(cfg, search, storage);
  applyIdentity(cfg, doc);
  const S = makeShaders(cfg);
  const eco = createEconomy(cfg);
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
      else if (many === 1) ui.log(fill(content.log.hire, { n: eco.state.drones }));
      else ui.log(fill(content.log.hireMany, { n: fmt(many), total: fmt(eco.state.drones) }));
    },
    wing: () => { if (eco.actions.wing.do()) { syncFleet(); ui.log(fill(content.log.wing, { n: cfg.economy.wingSize })); } },
    specialist: (k) => { if (eco.actions.specialist.do(k)) { syncFleet(); ui.log(fill(content.log.specialist, { kind: content.kinds[k] })); } },
    upgrade: (u) => { if (eco.actions.upgrade.do(u)) { ui.log(fill(content.log.upgrade, { name: cfg.economy.upgrades[u].name, n: eco.level(u) })); if (u === 'hangars') cfg.carrier.scale = 1 + 0.06 * eco.level('hangars'); } },
    castOff: () => {
      if (!eco.actions.castOff.do()) return;
      ui.log(fill(content.log.castOff, { n: eco.state.island }));
      world.generate(eco.state.island);
      const p = world.landPoint(rng(cfg.world.seed + '/anchor-' + eco.state.island));
      view.placeCarrier(p[0], p[1]);
      drones.reset(view.state.carrier);
      syncFleet();
      flags.voyage = false;
      ui.reveal(flags);
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
      location.reload();
    },
    reset: () => { if (doc.defaultView && doc.defaultView.confirm && !doc.defaultView.confirm(content.labels.resetConfirm)) return; save.clear(); location.reload(); },
    // the window's own controls
    quality: (name) => { if (!quality.choose(name)) return; prefs.set('quality', name); ui.showQuality(quality.preset, quality.scale, quality.rate); },
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
  quality.choose(wantQuality);
  ui.showQuality(quality.preset, quality.scale, 0);
  ui.showFold(prefs.get('folded', false));
  ui.reveal(flags);
  ui.log(snap ? fill(content.log.resume, { n: eco.state.island }) : fill(content.log.start, { n: cfg.drones.start }));
  if (offline && offline.worked > 30) {
    ui.log(fill(content.labels.offline, { time: duration(offline.away), funds: fmt(offline.earned) }));
    if (offline.capped) ui.log(fill(content.labels.offlineCapped, { worked: duration(offline.worked) }));
  }

  const controls = createControls(cfg, {
    fly: (dx, dz) => view.fly(dx, dz),
    camera: view.control,
    actions,
    panel: actions.fold,
    help: actions.help,
  });
  controls.attach(window);

  canvas.addEventListener('click', (e) => {
    const p = view.pick(e.clientX, e.clientY);
    if (!p) return;
    view.state.anchor = p;
    ui.log(content.log.anchor);
  });

  const snapshot = () => ({ eco: eco.snapshot(), seed: cfg.world.seed, anchor: view.state.anchor, at: Date.now() });
  const persist = () => save.write(snapshot());

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
  const priceWarned = {};
  const checkPrices = () => {
    for (const k of K) {
      const p = eco.price(k) / (cfg.kinds[k].basePrice * eco.islandPrice());
      if (p < 0.5 && !priceWarned[k]) { priceWarned[k] = true; ui.log(fill(content.log.priceLow, { kind: content.kinds[k], pct: Math.round(p * 100) + '%' })); }
      if (p > 0.85 && priceWarned[k]) { priceWarned[k] = false; ui.log(fill(content.log.priceBack, { kind: content.kinds[k] })); }
    }
  };

  // ---- the loop ----
  let summaryT = 0, saveT = 0, uiT = 0;
  const speed = () => eco.droneSpeed();
  let qualityT = 0, perfT = 0;
  const stop = loop((dt, t) => {
    const h = Math.min(dt, 0.05);
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
    }
    view.draw(t, eco.range(), 0.0009, h);
    // Watch the frames and let the guard move the resolution if it must.
    quality.sample(dt * 1000);
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

  return { cfg, eco, world, drones, view, ui, save, prefs, perf, quality, controls, stop, persist, snapshot };
}
