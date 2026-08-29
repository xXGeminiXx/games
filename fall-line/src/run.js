// ---------------------------------------------------------------------------
// The run: one field, one hearth, surges until the hearth goes out.
//
// This is the composition of the simulation. It owns the state, advances it
// by fixed steps, and exposes every action the page can take. It does not
// draw and it does not touch the page: the renderer reads the state, the ui
// calls the actions.
// ---------------------------------------------------------------------------

import { createTerrain, xy, canSculpt, sculptCost, sculpt } from './terrain.js?v=5';
import { computeFlow, traceFallLine, bestSnowlineStart, pathCostFromSnowline, straightCells } from './flow.js?v=5';
import { createPool, spawn, stepMotes, countAlive } from './motes.js?v=5';
import { createWorks, kindDef, costOf, canBuild, build, upgrade, sell, workAt } from './works.js?v=5';
import { stepWorks } from './works.js?v=5';
import { surgePlan, ebbPlan, emptyTelemetry, evolve, forecast } from './melt.js?v=5';
import { clearBonus, callBonus } from './economy.js?v=5';
import { checkAwards, awardDef } from './awards.js?v=5';
import { isUnlocked, newlyUnlocked, unlockedKinds } from './unlocks.js?v=5';
import { stream, hash } from './rng.js?v=5';
import { idsOf } from './traits.js?v=5';
import { fill } from '../config.js?v=5';

const LOG_KEEP = 40;

/** The cross-run record. Lives beside the save, not inside it. */
export function emptyMeta() {
  return { bestReached: 0, awards: [], runs: 0, totalSurges: 0 };
}

/** A fresh run on a fresh field. `meta` is shared with the page and persists. */
export function createRun(cfg, seed, meta) {
  seed = (seed >>> 0) || 1;
  const terrain = createTerrain(cfg, seed);
  const works = createWorks(cfg, terrain.W, terrain.H);
  const rand = stream(hash(seed, 'motes'));
  const pool = createPool(cfg, terrain.W, terrain.H, rand);
  const plan = surgePlan(cfg, 1, 0);

  const state = {
    cfg, seed, meta: meta || emptyMeta(),
    terrain, works, pool, rand,
    flow: null, fallLine: [], fallLines: [], flowVersion: '',
    phase: 'countdown',
    surge: 1,
    timer: cfg.surge.firstCountdown,
    ore: cfg.economy.startOre,
    hearthHp: cfg.hearth.hp,
    traits: 0,
    plan,
    ebb: ebbPlan(cfg, plan),
    ebbT: cfg.ebb.intervalSeconds,
    spawnLeft: 0,
    spawnAcc: 0,
    spawnPerSecond: 0,
    telemetry: emptyTelemetry(),
    lastTelemetry: null,
    change: null,
    forecast: null,
    log: [],
    speed: 1,
    paused: false,
    time: 0,
    stats: {
      sculptActions: 0, dryStreak: 0, killHeightMax: -1, trampled: false, heldSeconds: 0,
      kills: 0, leaks: 0, oreEarned: 0, surgesHeld: 0,
    },
    fx: [],
    events: { killed: [], leaked: [] },
    scanT: 0,
    saveRequested: false,
    over: false,
  };
  refreshFlow(state);
  state.forecast = forecast(cfg, plan, 0, null, emptyTelemetry());
  logLine(state, cfg.text.log.start, {}, 'ink');
  return state;
}

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------

export function logLine(state, template, values, cls) {
  state.log.push({ text: fill(template, values || {}), cls: cls || 'dim', t: state.time });
  if (state.log.length > LOG_KEEP) state.log.splice(0, state.log.length - LOG_KEEP);
}

/** Recompute the flow and the fall line when the ground or the works changed. */
export function refreshFlow(state) {
  const key = state.terrain.version + ':' + state.works.version;
  if (state.flow && state.flowVersion === key) return false;
  state.flow = computeFlow(state.cfg, state.terrain, state.works.occupied);
  const start = bestSnowlineStart(state.flow, state.terrain);
  state.fallLine = start >= 0 ? traceFallLine(state.flow, state.terrain, start) : [];
  // Every snowline cell has its own least-time road, and the ground can split
  // them. The main road is drawn from the cheapest start; the others are
  // drawn too, so the player never sees one line while the Melt walks two.
  const seen = new Set(state.fallLine);
  const others = [];
  for (const cell of state.terrain.snowline) {
    if (cell === start) continue;
    const trace = traceFallLine(state.flow, state.terrain, cell);
    // Keep only the part before it joins a road already drawn.
    const branch = [];
    for (const c of trace) { branch.push(c); if (seen.has(c)) break; }
    if (branch.length < 3) continue;
    for (const c of branch) seen.add(c);
    others.push(branch);
  }
  state.fallLines = others;
  state.flowVersion = key;
  return true;
}

export function unlocked(state, kindId) {
  const def = kindDef(state.cfg, kindId);
  return !!def && isUnlocked(state.cfg, def, state.meta.bestReached, state.surge);
}

/** The surge number a run counts as having reached: the one coming or under way. */
export function reached(state) {
  return state.surge;
}

// ---------------------------------------------------------------------------
// Actions - every one validates and returns { ok, reason? }
// ---------------------------------------------------------------------------

export function actSculpt(state, i, dir) {
  const { cfg, terrain } = state;
  if (state.phase === 'over') return { ok: false, reason: 'over' };
  if (!canSculpt(cfg, terrain, i, dir)) return { ok: false, reason: 'fixed' };
  const cost = sculptCost(cfg, terrain, i, dir);
  if (!(cost <= state.ore)) return { ok: false, reason: 'ore', cost };
  if (!sculpt(terrain, i, dir)) return { ok: false, reason: 'fixed' };
  state.ore -= cost;
  state.stats.sculptActions++;
  refreshFlow(state);
  return { ok: true, cost };
}

export function actBuild(state, kindId, i) {
  const { cfg, terrain, works } = state;
  if (state.phase === 'over') return { ok: false, reason: 'over' };
  const def = kindDef(cfg, kindId);
  if (!def) return { ok: false, reason: 'kind' };
  if (!unlocked(state, kindId)) return { ok: false, reason: 'locked' };
  const can = canBuild(cfg, terrain, works, kindId, i);
  if (!can.ok) return can;
  const cost = costOf(cfg, def, 1);
  if (!(cost <= state.ore)) return { ok: false, reason: 'ore', cost };
  const work = build(cfg, works, terrain, kindId, i);
  state.ore -= cost;
  refreshFlow(state);
  return { ok: true, cost, work };
}

export function actUpgrade(state, id) {
  const { cfg, works } = state;
  if (state.phase === 'over') return { ok: false, reason: 'over' };
  const work = works.list.find(w => w.id === id);
  if (!work) return { ok: false, reason: 'none' };
  const def = kindDef(cfg, work.kind);
  if (work.tier >= cfg.works.maxTier) return { ok: false, reason: 'max' };
  const cost = costOf(cfg, def, work.tier + 1);
  if (!(cost <= state.ore)) return { ok: false, reason: 'ore', cost };
  const r = upgrade(cfg, works, id);
  if (!r.ok) return r;
  state.ore -= cost;
  return { ok: true, cost, tier: work.tier };
}

export function actSell(state, id) {
  const { cfg, works } = state;
  if (state.phase === 'over') return { ok: false, reason: 'over' };
  const r = sell(cfg, works, id);
  if (!r.ok) return r;
  state.ore += r.refund;
  refreshFlow(state);
  return r;
}

export function actCall(state) {
  if (state.phase !== 'countdown') return { ok: false, reason: 'phase' };
  const bonus = callBonus(state.cfg, state.surge, state.timer);
  state.ore += bonus;
  state.stats.oreEarned += bonus;
  if (bonus > 0) logLine(state, state.cfg.text.log.called, { ore: bonus });
  startSurge(state);
  return { ok: true, bonus };
}

export function actSpeed(state, n) {
  if (!state.cfg.sim.speeds.includes(n)) return { ok: false, reason: 'speed' };
  state.speed = n;
  return { ok: true };
}

export function actPause(state, on) {
  state.paused = on === undefined ? !state.paused : !!on;
  if (state.paused) state.saveRequested = true;
  return { ok: true, paused: state.paused };
}

/** What sculpting or building at a cell would cost and whether it can happen. */
export function preview(state, tool, kindId, i) {
  const { cfg, terrain, works } = state;
  if (i < 0 || state.phase === 'over') return { ok: false, cost: 0, reason: 'none' };
  if (tool === 'raise' || tool === 'cut') {
    const dir = tool === 'raise' ? 1 : -1;
    if (!canSculpt(cfg, terrain, i, dir)) return { ok: false, cost: 0, reason: 'fixed' };
    const cost = sculptCost(cfg, terrain, i, dir);
    return { ok: cost <= state.ore, cost, reason: cost <= state.ore ? null : 'ore', height: terrain.h[i] + dir };
  }
  if (tool === 'build') {
    const def = kindDef(cfg, kindId);
    if (!def) return { ok: false, cost: 0, reason: 'kind' };
    if (!unlocked(state, kindId)) return { ok: false, cost: 0, reason: 'locked' };
    const can = canBuild(cfg, terrain, works, kindId, i);
    const cost = costOf(cfg, def, 1);
    if (!can.ok) return { ok: false, cost, reason: can.reason };
    return { ok: cost <= state.ore, cost, reason: cost <= state.ore ? null : 'ore' };
  }
  return { ok: false, cost: 0, reason: 'tool' };
}

// ---------------------------------------------------------------------------
// Surges
// ---------------------------------------------------------------------------

function spawnAt(state, plan, isSurge) {
  const { terrain, rand, cfg } = state;
  const cell = terrain.snowline[Math.floor(rand() * terrain.snowline.length)];
  const p = xy(terrain, cell);
  const x = p.x + 0.15 + rand() * 0.7;
  const y = p.y + 0.15 + rand() * 0.7;
  const id = spawn(state.pool, cfg, {
    x, y, hp: plan.hp, speed: plan.speed, traits: plan.traits || 0, size: plan.size,
    leak: plan.leak, ore: plan.ore, isSurge: isSurge ? 1 : 0,
  });
  if (id >= 0 && isSurge) state.telemetry.spawned++;
  return id;
}

export function startSurge(state) {
  const { cfg } = state;
  refreshFlow(state);
  state.phase = 'surge';
  state.timer = 0;
  state.spawnLeft = state.plan.count;
  state.spawnPerSecond = state.plan.count / Math.max(0.5, state.plan.spawnSeconds);
  state.spawnAcc = 1;
  state.telemetry = emptyTelemetry();
  state.telemetry.pathCost = pathCostFromSnowline(state.flow, state.terrain);
  state.telemetry.straightCells = straightCells(state.terrain);
  logLine(state, cfg.text.log.surge, { n: state.surge, count: state.plan.count, motes: cfg.text.motes }, 'ink');
}

function endSurge(state) {
  const { cfg, meta, stats } = state;
  const t = state.telemetry;
  const n = state.surge;
  const leakFree = t.leaked === 0;

  if (leakFree) {
    const bonus = clearBonus(cfg, n);
    state.ore += bonus;
    stats.oreEarned += bonus;
    stats.dryStreak++;
    stats.surgesHeld++;
    logLine(state, cfg.text.log.cleared, { n, ore: bonus }, 'ink');
  } else {
    stats.dryStreak = 0;
    logLine(state, cfg.text.log.leaked, { n, leaked: t.leaked, hp: Math.max(0, Math.round(state.hearthHp)) }, 'dim');
  }
  state.hearthHp = Math.min(cfg.hearth.hp, state.hearthHp + cfg.hearth.regenPerSurge);

  // The Melt looks at what happened and grows at most one counter.
  const ev = evolve(cfg, state.seed, n, state.traits, t);
  state.traits = ev.traits;
  state.change = ev.change;

  const prevReached = Math.max(meta.bestReached, n);
  state.surge = n + 1;
  meta.totalSurges++;
  meta.bestReached = Math.max(meta.bestReached, state.surge);

  state.plan = surgePlan(cfg, state.surge, state.traits);
  state.ebb = ebbPlan(cfg, surgePlan(cfg, state.surge, 0));
  state.forecast = forecast(cfg, state.plan, state.traits, state.change, t);
  state.lastTelemetry = t;
  state.telemetry = emptyTelemetry();

  for (const def of newlyUnlocked(cfg, prevReached, state.surge)) {
    logLine(state, cfg.text.log.unlocked, { name: def.name }, 'ink');
  }

  const signals = {
    pathRatio: t.straightCells > 0 ? t.pathCost / t.straightCells : 0,
    dryStreak: stats.dryStreak,
    activeTraits: idsOf(state.traits).length,
    leakFree,
    killHeightMax: stats.killHeightMax,
    sculptActions: stats.sculptActions,
    kindsStanding: Array.from(new Set(state.works.list.map(w => w.kind))),
    unlockedCount: unlockedKinds(cfg, meta.bestReached, state.surge).length,
    reached: state.surge,
    trampled: stats.trampled,
    heldSeconds: stats.heldSeconds,
  };
  for (const id of checkAwards(cfg, meta.awards, signals)) {
    meta.awards.push(id);
    const def = awardDef(cfg, id);
    logLine(state, cfg.text.log.award, { name: def ? def.name : id }, 'ink');
  }

  state.phase = 'countdown';
  state.timer = cfg.surge.countdownSeconds;
  state.ebbT = cfg.ebb.intervalSeconds;
  state.saveRequested = true;
}

function gameOver(state) {
  const { cfg, meta } = state;
  state.phase = 'over';
  state.over = true;
  state.hearthHp = 0;
  meta.runs++;
  logLine(state, cfg.text.log.over, { n: state.surge }, 'ink');
  state.saveRequested = true;
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

/** Advance the run by dt seconds of simulated time. Returns the events. */
export function step(state, dt) {
  const { cfg, pool, terrain, works } = state;
  const ev = state.events;
  ev.killed.length = 0;
  ev.leaked.length = 0;
  if (state.phase === 'over' || state.paused) return ev;

  state.time += dt;
  refreshFlow(state);

  if (state.phase === 'countdown') {
    state.timer -= dt;
    state.ebbT -= dt;
    if (state.ebbT <= 0) {
      spawnAt(state, state.ebb, false);
      state.ebbT += cfg.ebb.intervalSeconds;
    }
    if (state.timer <= 0) startSurge(state);
  } else if (state.phase === 'surge' && state.spawnLeft > 0) {
    state.spawnAcc += dt * state.spawnPerSecond;
    while (state.spawnAcc >= 1 && state.spawnLeft > 0) {
      if (spawnAt(state, state.plan, true) < 0) break;
      state.spawnLeft--;
      state.spawnAcc -= 1;
    }
  }

  stepMotes(pool, cfg, terrain, state.flow, works.occupied, dt, ev, state.telemetry);
  stepWorks(cfg, terrain, works, pool, state.flow, dt, state.telemetry, state.fx, ev);

  for (const k of ev.killed) {
    state.ore += k.ore;
    state.stats.oreEarned += k.ore;
    state.stats.kills++;
    state.fx.push({ kind: 'kill', x: k.x, y: k.y, t: 0, size: k.size });
    if (k.source) {
      const w = works.list.find(o => o.id === k.source);
      if (w) {
        const h = terrain.h[w.cell];
        if (h > state.stats.killHeightMax) state.stats.killHeightMax = h;
      }
    }
  }
  for (const l of ev.leaked) {
    state.hearthHp -= l.leak;
    state.stats.leaks++;
  }
  if (state.hearthHp <= 0) { gameOver(state); return ev; }

  // A slow scan for the two things no event reports: a mote crawling over a
  // work, and how long any mote has been dragged.
  state.scanT += dt;
  if (state.scanT >= 0.5) {
    state.scanT = 0;
    const occ = works.occupied;
    for (let i = 0; i < pool.cap; i++) {
      if (!pool.alive[i]) continue;
      if (pool.pullT[i] > state.stats.heldSeconds) state.stats.heldSeconds = pool.pullT[i];
      // Trampling means the road itself runs over a work: the mote is in the
      // work's cell and heading for that cell's centre, not merely clipping
      // its corner on a diagonal.
      const tcell = Math.floor(pool.ty[i]) * terrain.W + Math.floor(pool.tx[i]);
      if (!state.stats.trampled && occ[pool.cell[i]] && tcell === pool.cell[i] && !(pool.flags[i] & 1)) {
        state.stats.trampled = true;
        const w = workAt(works, pool.cell[i]);
        const def = w ? kindDef(cfg, w.kind) : null;
        logLine(state, cfg.text.log.trampled, { name: def ? def.name.toLowerCase() : 'work' });
      }
    }
  }

  if (state.phase === 'surge' && state.spawnLeft === 0 && countAlive(pool, true) === 0) endSurge(state);
  return ev;
}

/** A fresh run on the same meta. */
export function newRun(state, seed) {
  const next = createRun(state.cfg, seed === undefined ? (hash(state.seed, 'next:' + state.time) || 1) : seed, state.meta);
  return next;
}

/** The lines the run-over card shows. */
export function summary(state) {
  const { cfg, stats } = state;
  return [
    fill('{Surge} {n} reached.', { surge: cfg.text.surge, n: state.surge }),
    fill('{held} surges held, {kills} {motes} killed, {ore} ore earned.', {
      held: stats.surgesHeld, kills: stats.kills, motes: cfg.text.motes, ore: Math.round(stats.oreEarned),
    }),
    fill('{label}: surge {best}.', { label: cfg.text.best, best: state.meta.bestReached }),
  ];
}
