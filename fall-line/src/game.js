// ---------------------------------------------------------------------------
// The composition root: clock, input, drawing, saving.
//
// createGame takes the page (or the test stub of one) and returns the running
// game. Everything here is glue: the run simulates, the scene draws, the ui
// writes the page, and this file decides when each of them happens.
// ---------------------------------------------------------------------------

import { createRun, step, newRun, preview, actSculpt, actBuild, actUpgrade, actSell, actCall, actSpeed, actPause, unlocked, summary, logLine } from './run.js?v=8';
import { restore, loadMeta, saveMeta, loadSave, storeSave, clearSave, exportString, importString } from './save.js?v=8';
import { countAlive } from './motes.js?v=8';
import { kindDef, workAt, stats } from './works.js?v=8';
import { createIso } from './render/iso.js?v=8';
import { createGround } from './render/ground.js?v=8';
import { createScene } from './render/scene.js?v=8';
import { createUi } from './ui.js?v=8';

export function createGame({ doc, win, canvas, cfg, storage, now, seed }) {
  const keyMeta = cfg.identity.storagePrefix + '.meta';
  const keySave = cfg.identity.storagePrefix + '.save';
  const clock = now || (() => Date.now());

  const meta = loadMeta(storage, keyMeta);
  let state = null;
  const saved = loadSave(storage, keySave);
  let badSave = false;
  if (saved) {
    state = restore(cfg, saved, meta);
    if (!state) badSave = true;
  }
  if (!state) {
    state = createRun(cfg, seed === undefined ? freshSeed() : seed, meta);
    if (badSave) logLine(state, cfg.text.log.saveBad);
  }

  const iso = createIso(cfg);
  const ground = createGround(cfg, iso);
  const scene = createScene(cfg, canvas, iso, ground);

  const tool = { type: null, kind: null };
  const hover = { cell: -1, tool: null, kind: null, ok: false, range: 0, height: 0 };
  let selectedId = 0;
  const sceneState = { terrain: null, works: null, pool: null, fallLine: null, fallLines: null, fx: null, hover, selected: null, time: 0, reducedMotion: false };
  try {
    const mq = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (mq) {
      sceneState.reducedMotion = !!mq.matches;
      if (mq.addEventListener) mq.addEventListener('change', (e) => { sceneState.reducedMotion = !!e.matches; });
    }
  } catch (e) { /* no media queries here */ }

  function bind() {
    sceneState.terrain = state.terrain;
    sceneState.works = state.works;
    sceneState.pool = state.pool;
    sceneState.fx = state.fx;
  }
  bind();

  // ---- the api the page uses ----------------------------------------------

  const api = {
    state: () => state,
    tool: () => tool,
    hover: () => hover,
    setTool(type, kind) {
      if (tool.type === type && tool.kind === (kind || null)) { tool.type = null; tool.kind = null; return; }
      tool.type = type;
      tool.kind = kind || null;
      selectedId = 0;
    },
    clearTool() { tool.type = null; tool.kind = null; },
    selected() { return selectedId ? state.works.list.find(w => w.id === selectedId) || null : null; },
    select(id) { selectedId = id || 0; },
    workAt: (i) => workAt(state.works, i),
    workStats: (w) => stats(cfg, state.terrain, state.works, w),
    isUnlocked: (kind) => unlocked(state, kind),
    preview: (type, kind, i) => preview(state, type, kind, i),
    aliveSurge: () => countAlive(state.pool, true),
    summary: () => summary(state),
    upgrade() { const w = api.selected(); return w ? actUpgrade(state, w.id) : { ok: false }; },
    sell() { const w = api.selected(); if (!w) return { ok: false }; const r = actSell(state, w.id); if (r.ok) selectedId = 0; return r; },
    callSurge: () => actCall(state),
    setSpeed: (n) => actSpeed(state, n),
    togglePause() { const r = actPause(state); if (state.paused) save(); return r; },
    newRun(seedValue) {
      state = newRun(state, seedValue);
      selectedId = 0;
      tool.type = null; tool.kind = null;
      bind();
      clearSave(storage, keySave);
      save();
      return state;
    },
    exportString: () => exportString(state),
    importString(s) {
      const got = importString(s);
      if (!got) return false;
      if (got.meta && typeof got.meta === 'object') {
        if (Number.isFinite(got.meta.bestReached)) meta.bestReached = Math.max(meta.bestReached, got.meta.bestReached);
        if (Array.isArray(got.meta.awards)) for (const a of got.meta.awards) if (!meta.awards.includes(a)) meta.awards.push(a);
      }
      const next = restore(cfg, got.run, meta);
      if (!next) return false;
      state = next;
      selectedId = 0;
      bind();
      save();
      return true;
    },
  };

  const ui = createUi(cfg, doc, win, api);

  // ---- saving -------------------------------------------------------------

  let saveClock = 0;
  function save() {
    storeSave(storage, keySave, state);
    saveMeta(storage, keyMeta, meta);
    state.saveRequested = false;
    saveClock = 0;
  }

  // ---- input --------------------------------------------------------------

  let dragging = false;
  // Every cell a drag has already touched, so sweeping back over one does
  // not raise it twice.
  const painted = new Set();

  function cellUnder(ev) {
    const rect = canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    return iso.pick(sx, sy, state.terrain);
  }

  function refreshHover(cell) {
    hover.cell = cell;
    hover.tool = tool.type;
    hover.kind = tool.kind;
    hover.ok = false;
    hover.range = 0;
    hover.height = cell >= 0 ? state.terrain.h[cell] : 0;
    if (cell < 0 || !tool.type) return;
    const p = preview(state, tool.type, tool.kind, cell);
    hover.ok = !!p.ok;
    if (tool.type === 'build') {
      const def = kindDef(cfg, tool.kind);
      if (def) hover.range = (def.range || def.aura || 0) * (1 + cfg.works.highGroundRange * state.terrain.h[cell]);
    } else if (p.height !== undefined) {
      hover.height = p.height;
    }
  }

  function apply(cell) {
    if (cell < 0) return;
    if (tool.type === 'raise' || tool.type === 'cut') {
      if (painted.has(cell)) return;
      painted.add(cell);
      actSculpt(state, cell, tool.type === 'raise' ? 1 : -1);
      refreshHover(cell);
      return;
    }
    const w = workAt(state.works, cell);
    if (tool.type === 'build') {
      if (w) { selectedId = w.id; return; }
      const r = actBuild(state, tool.kind, cell);
      if (r.ok) refreshHover(cell);
      return;
    }
    selectedId = w ? w.id : 0;
  }

  function onPointerDown(ev) {
    if (ev.button === 2) { onRightClick(ev); return; }
    if (ev.button !== undefined && ev.button !== 0) return;
    const cell = cellUnder(ev);
    dragging = true;
    painted.clear();
    apply(cell);
  }
  function onPointerMove(ev) {
    const cell = cellUnder(ev);
    refreshHover(cell);
    if (dragging && (tool.type === 'raise' || tool.type === 'cut')) apply(cell);
  }
  function onPointerUp() { dragging = false; painted.clear(); }
  function onLeave() { hover.cell = -1; dragging = false; }
  function onRightClick(ev) {
    if (ev.preventDefault) ev.preventDefault();
    if (tool.type) api.clearTool(); else selectedId = 0;
    refreshHover(hover.cell);
  }

  function onKey(ev) {
    const k = ev.key;
    if (!k) return;
    if (ui.isHelpOpen() && k !== 'Escape' && k !== 'h' && k !== 'H') return;
    const kinds = cfg.works.kinds;
    if (k >= '1' && k <= '9') {
      const def = kinds[Number(k) - 1];
      if (def && unlocked(state, def.id)) api.setTool('build', def.id);
      return;
    }
    switch (k) {
      case 'r': case 'R': api.setTool('raise'); break;
      case 'c': case 'C': case 'l': case 'L': api.setTool('cut'); break;
      case 'Escape': if (ui.isHelpOpen()) ui.showHelp(false); else if (tool.type) api.clearTool(); else selectedId = 0; break;
      case ' ': api.togglePause(); if (ev.preventDefault) ev.preventDefault(); break;
      case 'n': case 'N': api.callSurge(); break;
      case '-': case '_': stepSpeed(-1); break;
      case '=': case '+': stepSpeed(1); break;
      case 'u': case 'U': api.upgrade(); break;
      case 's': case 'S': api.sell(); break;
      case 'h': case 'H': ui.showHelp(!ui.isHelpOpen()); break;
      default: return;
    }
    refreshHover(hover.cell);
  }
  function stepSpeed(dir) {
    const list = cfg.sim.speeds;
    const i = Math.max(0, Math.min(list.length - 1, list.indexOf(state.speed) + dir));
    api.setSpeed(list[i]);
  }

  // ---- the frame ----------------------------------------------------------

  let running = false;
  let last = 0;
  let acc = 0;
  let boxW = 0, boxH = 0;

  function fit() {
    const box = canvas.parentNode || canvas;
    const w = box.clientWidth || win.innerWidth || 800;
    const h = box.clientHeight || win.innerHeight || 500;
    if (w === boxW && h === boxH) return;
    boxW = w; boxH = h;
    scene.resize(w, h, win.devicePixelRatio || 1, state.terrain.W, state.terrain.H, cfg.terrain.maxHeight);
  }

  function frame(tNow) {
    if (!running) return;
    const ms = typeof tNow === 'number' ? tNow : clock();
    let dt = last ? (ms - last) / 1000 : 0;
    last = ms;
    if (dt > cfg.sim.maxFrame) dt = cfg.sim.maxFrame;
    if (dt < 0) dt = 0;

    fit();
    if (!state.paused && state.phase !== 'over') {
      acc += dt * state.speed;
      const h = cfg.sim.dt;
      let guard = 0;
      // A fault inside a step pauses the run instead of killing the frame
      // loop, so the page stays alive and the save can still be exported.
      try {
        while (acc >= h && guard++ < 40) { step(state, h); acc -= h; }
      } catch (err) {
        state.paused = true;
        acc = 0;
        if (win.console && win.console.error) win.console.error(err);
      }
      if (acc > h) acc = 0;
    }

    const sel = api.selected();
    if (sel) {
      const s = stats(cfg, state.terrain, state.works, sel);
      sceneState.selected = { cell: sel.cell, x: sel.x, y: sel.y, range: s.range || s.aura || 0 };
    } else sceneState.selected = null;
    sceneState.fallLine = state.fallLine;
    sceneState.fallLines = state.fallLines;
    sceneState.time = state.time;
    scene.draw(sceneState, dt);
    ui.update();

    saveClock += dt;
    if (state.saveRequested || saveClock >= cfg.save.intervalSeconds) save();

    win.requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('contextmenu', onRightClick);
    win.addEventListener('keydown', onKey);
    win.addEventListener('resize', fit);
    win.addEventListener('beforeunload', save);
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') save(); });
    fit();
    if (meta.runs === 0 && !saved) ui.showHelp(true);
    last = 0;
    win.requestAnimationFrame(frame);
  }

  function stop() { running = false; save(); }

  function freshSeed() {
    return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
  }

  return {
    start, stop, save,
    state: () => state,
    meta: () => meta,
    api, ui, scene, iso, tool, hover,
    /** Advance the simulation by n fixed steps without drawing. */
    step(n) { for (let i = 0; i < n; i++) step(state, cfg.sim.dt); },
  };
}
