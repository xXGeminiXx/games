// ---------------------------------------------------------------------------
// What each kind of work does when it fires.
//
// One function per job, dispatched on the kind's type, so adding a kind is
// adding a case rather than editing a long branch. Everything here is handed
// the already-effective numbers - tier, high ground and any buff are settled
// before a shot is taken - so none of it reads config values of its own.
//
// Visual events are pushed onto `fx` in world coordinates and nothing here
// knows how they are drawn.
// ---------------------------------------------------------------------------

import {
  damage, applySlow, applyBurn, applyPull, forEachInRadius, firstInRadius, MOTE_FLAG,
} from './motes.js?v=8';

/** Put a shot's result on the work that took it. */
function credit(w, res) {
  if (w && res) {
    w.dealt += res.dealt;
    if (res.killed) w.kills++;
  }
  return res;
}

/** Reused between shots so a chain does not allocate a set every time. */
const chainHits = [];

/**
 * Take one shot or pulse. Returns true when the work found something to do,
 * which is what puts it back on cooldown.
 */
export function fireWork(cfg, works, w, def, st, pool, dt, telemetry, fx, events) {
  switch (def.type) {
    case 'kinetic': return fireBolt(cfg, w, st, pool, telemetry, fx, events);
    case 'blast':   return fireShell(works, w, st, pool);
    case 'burn':    return pulseBurn(cfg, w, st, pool, fx);
    case 'slow':    return pulseSlow(cfg, w, st, pool, fx);
    case 'arc':     return fireChain(cfg, w, st, pool, telemetry, fx, events);
    case 'pull':    return drag(cfg, w, st, pool, dt);
    default:        return false;
  }
}

/** One mote, the one nearest the hearth, hit at once. */
function fireBolt(cfg, w, st, pool, telemetry, fx, events) {
  const id = firstInRadius(pool, w.x, w.y, st.range);
  if (id < 0) return false;
  const tx = pool.x[id], ty = pool.y[id];
  w.angle = Math.atan2(ty - w.y, tx - w.x);
  credit(w, damage(pool, cfg, id, st.dmg, 'kinetic', events, telemetry, w.id));
  if (fx) fx.push({ kind: 'bolt', x0: w.x, y0: w.y, x1: tx, y1: ty, t: 0 });
  return true;
}

/** A shell is lobbed at where the target stands and bursts there later. */
function fireShell(works, w, st, pool) {
  const id = firstInRadius(pool, w.x, w.y, st.range, st.minRange || 0);
  if (id < 0) return false;
  const tx = pool.x[id], ty = pool.y[id];
  w.angle = Math.atan2(ty - w.y, tx - w.x);
  works.projectiles.push({
    x0: w.x, y0: w.y, x1: tx, y1: ty, t: 0,
    flight: st.flight, dmg: st.dmg, splash: st.splash, source: w.id,
  });
  return true;
}

/** Everything in reach starts burning. Burning follows them out of reach. */
function pulseBurn(cfg, w, st, pool, fx) {
  let hit = 0;
  forEachInRadius(pool, w.x, w.y, st.range, (id) => {
    hit++;
    applyBurn(pool, cfg, id, st.burnDps, st.burnSeconds);
  });
  if (!hit) return false;
  w.pulseT = 0;
  if (fx) fx.push({ kind: 'flare', x: w.x, y: w.y, r: st.range, t: 0 });
  return true;
}

/** Everything in reach is slowed. The config number is how much is taken off. */
function pulseSlow(cfg, w, st, pool, fx) {
  let hit = 0;
  const factor = 1 - st.slow;
  forEachInRadius(pool, w.x, w.y, st.range, (id) => {
    hit++;
    applySlow(pool, cfg, id, factor, st.slowSeconds);
  });
  if (!hit) return false;
  w.pulseT = 0;
  if (fx) fx.push({ kind: 'rime', x: w.x, y: w.y, r: st.range, t: 0 });
  return true;
}

/** One target, then a jump to the nearest untouched mote, weaker each jump. */
function fireChain(cfg, w, st, pool, telemetry, fx, events) {
  const first = firstInRadius(pool, w.x, w.y, st.range);
  if (first < 0) return false;
  chainHits.length = 0;
  const points = [[w.x, w.y]];
  w.angle = Math.atan2(pool.y[first] - w.y, pool.x[first] - w.x);

  let cur = first;
  let dmg = st.dmg;
  let hops = Math.max(0, st.chain | 0);
  for (;;) {
    const cx = pool.x[cur], cy = pool.y[cur];
    const earths = (pool.flags[cur] & MOTE_FLAG.stopsChain) !== 0;
    chainHits.push(cur);
    points.push([cx, cy]);
    credit(w, damage(pool, cfg, cur, dmg, 'arc', events, telemetry, w.id));
    // A mote that earths the arc still takes its hit; the chain ends on it.
    if (earths || hops <= 0) break;
    const next = nearestUnhit(pool, cx, cy, st.hop);
    if (next < 0) break;
    hops--;
    dmg *= st.decay;
    cur = next;
  }
  if (fx) fx.push({ kind: 'arc', points, t: 0 });
  return true;
}

/** The closest living mote within one jump that this chain has not hit. */
function nearestUnhit(pool, cx, cy, hop) {
  let best = -1;
  let bestD = Infinity;
  forEachInRadius(pool, cx, cy, hop, (id, d2) => {
    if (d2 < bestD && chainHits.indexOf(id) === -1) { bestD = d2; best = id; }
  });
  return best;
}

/**
 * A steady drag toward the work, weakest right on top of it. The drag never
 * exceeds a fraction of the mote's own walking speed, so a slowed mote is
 * held back hard but is never held still: a mote that could be pinned
 * forever would keep its surge from ever ending.
 */
function drag(cfg, w, st, pool, dt) {
  const falloff = cfg.works.pullFalloff;
  const cap = Number.isFinite(cfg.works.pullCap) ? cfg.works.pullCap : 0.8;
  forEachInRadius(pool, w.x, w.y, st.range, (id, d2) => {
    const d = Math.sqrt(d2);
    if (d < 1e-6) return;
    const walk = pool.speed[id] * pool.slow[id];
    const most = walk > 0 ? cap * walk : st.pull;
    const mag = (st.pull < most ? st.pull : most) * dt;
    // Fading the last half cell keeps a crowd from collapsing to one point.
    const s = mag * Math.min(1, d / falloff) / d;
    applyPull(pool, cfg, id, (w.x - pool.x[id]) * s, (w.y - pool.y[id]) * s);
  });
  w.angle += dt;
  return true;
}

/** Move every shell along and burst the ones that have arrived. */
export function stepProjectiles(cfg, works, pool, dt, telemetry, fx, events) {
  const live = works.projectiles;
  for (let k = live.length - 1; k >= 0; k--) {
    const p = live[k];
    p.t += dt;
    if (p.t < p.flight) continue;
    let src = null;
    for (const w of works.list) if (w.id === p.source) { src = w; break; }
    forEachInRadius(pool, p.x1, p.y1, p.splash, (id) => {
      credit(src, damage(pool, cfg, id, p.dmg, 'blast', events, telemetry, p.source));
    });
    if (fx) fx.push({ kind: 'splash', x: p.x1, y: p.y1, r: p.splash, t: 0 });
    live.splice(k, 1);
  }
}
