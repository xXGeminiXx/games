// ---------------------------------------------------------------------------
// The world answering back.
//
// Four things that happen to the organism rather than because of it. A
// drought takes half the minerals out of the soil for a season. A windthrow
// puts logs on the ground where the wind ran. A fire burns a wedge of the
// reach, takes the threads out of it, and leaves charred wood standing in it.
// Another fungus comes up at the edge of the reach and takes ground of its
// own, and it has to be pushed off it.
//
// Nothing here rolls a die at the moment it matters. Each kind carries a due
// time that is a hash of the seed and how many of that kind have already
// happened, so a seed always brings the same weather at the same times, a
// save replays exactly, and an absence caught up in five-second chunks is the
// same run as one played through.
//
// What an event leaves behind lives in state.events as plain data: which
// ground is burnt and until when, which ground the rival holds, and how much
// wood is waiting in a log the wind brought down. Nothing here draws.
// ---------------------------------------------------------------------------

import { hash, unit } from './rng.js?v=10';
import { nearestOpen } from './world.js?v=10';

// These lines belong in content.js, in pools under CONTENT.events, and are
// read from there as soon as they are written; they sit here so the events
// can be said before the writing has caught up with them. Holes: {thing} is
// what the ground is called at this scale, {n} a count, {level} the scale.
export const TEXT = {
  drought: [
    'The rain stops. The ground goes hard, and half of what is in it stays there.',
    'A dry season sets in. {Thing} holds on to half of what it would have given.',
  ],
  droughtEnds: [
    'Rain, at last. The ground softens and gives again.',
    'The drought breaks with the season. {Thing} runs wet.',
  ],
  windthrow: [
    'A storm comes through in the night. {n} more logs are down, and every one of them is food.',
    'The wind runs across {level} and leaves {n} trees lying where they fell.',
  ],
  fire: [
    'Fire runs the dry side of {level}. {n} places burn, and the threads in them are ash.',
    'Smoke, then heat. {n} places are taken back to bare ground.',
  ],
  fireOut: [
    'The burn cools. Charred wood is rich, and nothing is standing in the way of going back.',
    'The fire is out. What\'s left of the trees in it will feed better than they traded.',
  ],
  rival: [
    'Another fungus is in the ground at the edge of the reach. It isn\'t sharing.',
    'Something else has come up out there, in {thing} nothing had touched. It\'s spreading.',
  ],
  rivalGains: [
    'The other fungus has taken {n} more places this season.',
    'It\'s still spreading: {n} places this season are held against you.',
  ],
  rivalGone: [
    'The other fungus lets go of the last of its ground.',
    'Nothing is left of the other one. The {n} places it took are open again.',
  ],
};

const TAU = Math.PI * 2;
export const KINDS = ['drought', 'windthrow', 'fire', 'rival'];

const kindCfg = (cfg, kind) => (cfg.events && cfg.events[kind]) || {};

/** The angle between two directions, 0..pi. */
export function angleGap(a, b) {
  let d = Math.abs(a - b) % TAU;
  if (d > Math.PI) d = TAU - d;
  return d;
}

/** The gap before the k-th event of a kind: its mean, widened by the seed. */
function interval(cfg, seed, kind, k) {
  const mean = kindCfg(cfg, kind).mean > 0 ? kindCfg(cfg, kind).mean : 600;
  const spread = cfg.events.spread > 0 ? cfg.events.spread : 0;
  return Math.max(1, mean * (1 - spread + 2 * spread * unit(seed, 'event:' + kind + ':' + k)));
}

/** When a kind can first happen: its earliest time, plus a hashed nudge. */
function firstDue(cfg, seed, kind) {
  const c = kindCfg(cfg, kind);
  const mean = c.mean > 0 ? c.mean : 600;
  const spread = cfg.events.spread > 0 ? cfg.events.spread : 0;
  return (c.first || 0) + unit(seed, 'event:' + kind + ':first') * spread * mean;
}

/** The events part of a fresh organism. The schedule is filled by ensure. */
export function freshEvents() {
  return {
    next: {},       // kind -> the simulation second it is next due
    count: {},      // kind -> how many of that kind have happened
    year: -1,       // the year and the season last looked at, so a turn is
    season: -1,     // noticed exactly once however the step is sized
    drought: null,  // { until }
    burn: null,     // { nodes, until, angle, half, from }: what burnt
    rival: null,    // { nodes: [...], born, seed, due, gained, claimed, said }
    fallen: {},     // node id -> wood waiting in a log the wind brought down
  };
}

/** Put the events block on any state, fresh or restored, and date it. */
export function ensure(state, cfg) {
  if (!cfg || !cfg.events) return null;
  if (!state.events) state.events = freshEvents();
  const e = state.events;
  if (!e.next) e.next = {};
  if (!e.count) e.count = {};
  if (!e.fallen) e.fallen = {};
  if (e.year === undefined) e.year = -1;
  if (e.season === undefined) e.season = -1;
  for (const kind of KINDS) {
    if (!(e.count[kind] >= 0)) e.count[kind] = 0;
    if (!(e.next[kind] >= 0)) e.next[kind] = firstDue(cfg, state.seed, kind);
  }
  return e;
}

/** What the tips need to know about ground another fungus holds. */
export function runtime(state, cfg, rt) {
  const r = state.events && state.events.rival;
  rt.rival = r && r.nodes.length ? new Set(r.nodes) : null;
  rt.rivalCost = kindCfg(cfg, 'rival').cost > 1 ? kindCfg(cfg, 'rival').cost : 1;
}

/** A predicate over ground the rival holds, or null when it holds none. */
export function rivalGuard(rt) {
  return rt && rt.rival && rt.rival.size ? (id) => rt.rival.has(id) : null;
}

/** Wood waiting in a log the wind brought down, taken as it is read. */
export function fallenStock(state, id) {
  const e = state.events;
  if (!e || !e.fallen) return 0;
  const stock = e.fallen[id];
  if (!(stock > 0)) return 0;
  delete e.fallen[id];
  return stock;
}

/** Ground the threads have just taken stops being anybody else's. */
export function taken(state, id) {
  const r = state.events && state.events.rival;
  if (!r) return;
  const at = r.nodes.indexOf(id);
  if (at >= 0) r.nodes.splice(at, 1);
}

/** Whether one node is currently burnt. Data for the picture. */
export function isBurnt(state, id) {
  const e = state.events;
  return !!(e && e.burn && e.burn.nodes.indexOf(id) >= 0);
}

/** The burnt ground as a set, for a caller about to ask about every node. */
export function burntSet(state) {
  const e = state.events;
  return new Set(e && e.burn ? e.burn.nodes : []);
}

/** Everything tied to one level's node numbers, dropped when it is folded. */
export function levelChanged(state) {
  const e = state.events;
  if (!e) return;
  e.burn = null;
  e.rival = null;
  e.fallen = {};
}

// -- the step ---------------------------------------------------------------

/**
 * One step of the world's own doings, run before the tips move.
 * @param {object} ctx world, roster, season, say, rebuild, rt(), lore, search
 * @returns {{ soil: number }} what the ground is giving this step
 */
export function step(state, cfg, ctx) {
  const out = { soil: 1 };
  const e = state.events;
  if (!cfg.events || !cfg.events.enabled || !e) return out;
  const t = state.t;
  const season = ctx.season;
  const info = ctx.lore.levelInfo(state.level);
  // How long a kind waits before looking again when the ground cannot carry
  // it. A kind may want its own, and the rival does.
  const retryFor = (kind) => {
    const own = kindCfg(cfg, kind).retry;
    if (own > 0) return own;
    return cfg.events.retry > 0 ? cfg.events.retry : 60;
  };

  // The first of a kind is the reveal and is said once; the ones after it
  // carry the time as a salt, so an organism words them differently.
  const tell = (name, values) => {
    const key = 'events.' + name;
    if (state.fired[key]) ctx.say(key, values, false, String(Math.floor(t)));
    else ctx.say(key, values, true);
  };
  const soilWords = { thing: ctx.lore.thing(state.level, 'soil'), level: info.name };
  const woodWords = { thing: info.many, level: info.name };

  // Anything in flight that has run its course.
  if (e.drought && t >= e.drought.until) {
    e.drought = null;
    tell('droughtEnds', Object.assign({ n: ctx.rt().soil }, soilWords));
  }
  if (e.burn && t >= e.burn.until) {
    const n = e.burn.nodes.length;
    e.burn = null;
    tell('fireOut', Object.assign({ n }, woodWords));
  }

  // The year turning: what only a season can start, and what it reports.
  const turned = season.year !== e.year || season.index !== e.season;
  if (turned) {
    e.year = season.year;
    e.season = season.index;
    const c = kindCfg(cfg, 'drought');
    const inSeason = Array.isArray(c.seasons) && c.seasons.indexOf(season.index) >= 0;
    if (c.enabled && !e.drought && t >= e.next.drought && inSeason && season.year >= (c.firstYear || 0)) {
      e.drought = { until: t + season.left };
      e.count.drought++;
      e.next.drought = t + interval(cfg, state.seed, 'drought', e.count.drought);
      tell('drought', Object.assign({ n: ctx.rt().soil }, soilWords));
    }
    const r = e.rival;
    if (r && r.claimed > r.said) {
      const n = r.claimed - r.said;
      r.said = r.claimed;
      tell('rivalGains', Object.assign({ n }, soilWords));
    }
  }

  if (kindCfg(cfg, 'windthrow').enabled && t >= e.next.windthrow) {
    const n = windthrow(state, cfg, e, ctx);
    if (n > 0) {
      e.count.windthrow++;
      e.next.windthrow = t + interval(cfg, state.seed, 'windthrow', e.count.windthrow);
      tell('windthrow', Object.assign({ n }, woodWords));
    } else {
      e.next.windthrow = t + retryFor('windthrow');
    }
  }

  if (kindCfg(cfg, 'fire').enabled && t >= e.next.fire) {
    const n = fire(state, cfg, e, ctx);
    if (n > 0) {
      e.count.fire++;
      e.next.fire = t + interval(cfg, state.seed, 'fire', e.count.fire);
      tell('fire', Object.assign({ n }, woodWords));
    } else {
      e.next.fire = t + retryFor('fire');
    }
  }

  const rc = kindCfg(cfg, 'rival');
  if (rc.enabled && !e.rival && t >= e.next.rival) {
    if (rivalArrives(state, cfg, e, ctx)) {
      e.count.rival++;
      tell('rival', Object.assign({ n: 1 }, soilWords));
    } else {
      e.next.rival = t + retryFor('rival');
    }
  }
  if (e.rival) {
    if (rivalStep(state, cfg, e, ctx) === 0) {
      const took = e.rival.claimed;
      e.rival = null;
      e.next.rival = t + interval(cfg, state.seed, 'rival', e.count.rival);
      tell('rivalGone', Object.assign({ n: took }, soilWords));
    }
  }

  if (e.drought) {
    const share = kindCfg(cfg, 'drought').minerals;
    out.soil = share >= 0 ? share : 1;
  }
  runtime(state, cfg, ctx.rt());
  return out;
}

// -- the windthrow ----------------------------------------------------------

/**
 * The wind puts logs on the ground around a hashed point inside the reach.
 * What it leaves is a fixed number of seconds of the income the organism
 * already makes, split across those logs, so it is worth the same share of a
 * run at every scale and can never be a multiplier on anything.
 * @returns how many logs it brought down, or 0 for nothing
 */
function windthrow(state, cfg, e, ctx) {
  const c = kindCfg(cfg, 'windthrow');
  const world = ctx.world;
  const rt = ctx.rt();
  const total = Math.max(0, state.rate.sugar) * (c.seconds > 0 ? c.seconds : 0);
  if (!(total > 0)) return 0;
  const k = e.count.windthrow;
  const radius = Math.max(1, state.ring * cfg.world.ringWidth);
  const a = unit(state.seed, 'windthrow:angle:' + k) * TAU;
  const r = Math.sqrt(unit(state.seed, 'windthrow:radius:' + k)) * radius;
  const px = Math.cos(a) * r, py = Math.sin(a) * r;

  const near = [];
  for (const n of world.nodes) {
    if (n.kind !== 'wood' || n.ring > state.ring) continue;
    const dx = n.x - px, dy = n.y - py;
    near.push([dx * dx + dy * dy, n.id]);
  }
  if (!near.length) return 0;
  near.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const take = Math.min(Math.max(1, Math.floor(c.logs || 1)), near.length);
  const share = total / take;
  for (let i = 0; i < take; i++) {
    const id = near[i][1];
    // A log the threads are already in fills straight away; one they have not
    // found yet holds what fell on it until they do.
    if (rt.reached.has(id)) state.wood[id] = (state.wood[id] || 0) + share;
    else e.fallen[id] = (e.fallen[id] || 0) + share;
  }
  return take;
}

// -- the fire ---------------------------------------------------------------

/**
 * A wedge of the level burns, from a hashed radius out to the edge of the
 * open reach. Everything reached inside it is unreached: the threads through
 * it come down, the logs in it are left at nothing, and the living trees in
 * it die to snags worth more dead than they were felled. The ground can be
 * taken back the ordinary way, and the charred wood is the reason to.
 * @returns how many places burnt, or 0 for nothing
 */
function fire(state, cfg, e, ctx) {
  const c = kindCfg(cfg, 'fire');
  const world = ctx.world;
  const rt = ctx.rt();
  if (ctx.season.year < (c.firstYear || 0)) return 0;
  const cap = Math.floor(state.reached.length * (c.cap > 0 ? c.cap : 0));
  if (cap < 1) return 0;

  const k = e.count.fire;
  const openR = Math.max(1, state.ring * cfg.world.ringWidth);
  const a0 = unit(state.seed, 'fire:angle:' + k) * TAU;
  const span = Math.max(0, (c.radiusTo || 0) - (c.radiusFrom || 0));
  const r0 = openR * ((c.radiusFrom || 0) + unit(state.seed, 'fire:radius:' + k) * span);

  // Everything reached that lies out in that direction, with how far off the
  // middle of the wedge it is, so narrowing the fire drops the edges first.
  const out = [];
  for (const id of state.reached) {
    if (id === world.origin) continue;   // the fire never takes the first log
    const n = world.nodes[id];
    if (!n) continue;
    if (Math.sqrt(n.x * n.x + n.y * n.y) < r0) continue;
    out.push({ id, gap: angleGap(Math.atan2(n.y, n.x), a0) });
  }
  let half = Math.max(0, (c.width || 0) / 2);
  let burnt = out.filter(x => x.gap <= half);
  for (let tries = 0; burnt.length > cap && tries < (c.narrowTries || 0); tries++) {
    half *= (c.narrow > 0 ? c.narrow : 0.8);
    burnt = out.filter(x => x.gap <= half);
  }
  // A narrow enough wedge always fits under the cap, but the ground is never
  // that even: whatever is left over stands, and the middle burns.
  if (burnt.length > cap) {
    burnt.sort((p, q) => p.gap - q.gap || p.id - q.id);
    burnt = burnt.slice(0, cap);
  }
  if (!burnt.length) return 0;

  const gone = new Set(burnt.map(x => x.id));
  state.reached = state.reached.filter(id => !gone.has(id));
  state.threads = state.threads.filter(([a, b]) => !gone.has(a) && !gone.has(b));
  for (const id of gone) {
    const n = world.nodes[id];
    if (n.kind === 'wood') {
      // The log burns. It is left in the books at nothing, so the threads
      // cannot come back to a full one.
      if (state.wood[id] !== undefined) state.wood[id] = 0;
    } else if (n.kind === 'root') {
      const tree = state.trees[id];
      if (!tree) continue;
      if (tree.dead) {
        tree.wood = 0;
        tree.regrow = state.t + cfg.trees.regrowSeconds;
      } else {
        const sp = ctx.roster[tree.sp];
        tree.dead = true;
        tree.h = 0;
        tree.wood = tree.s * sp.wood * (c.burnBonus > 0 ? c.burnBonus : 1);
        tree.regrow = 0;
      }
    }
  }

  // A tip standing in the burn goes back to the nearest ground still held.
  for (const t of state.tips) {
    if (!gone.has(t.from) && !gone.has(t.to)) continue;
    let best = world.origin, bestD = Infinity;
    for (const id of state.reached) {
      const n = world.nodes[id];
      const dx = n.x - t.x, dy = n.y - t.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = id; }
    }
    const n = world.nodes[best];
    t.from = best; t.to = -1; t.x = n.x; t.y = n.y; t.pay = 0;
  }
  // The front only has new work where the fire went: the rest of the reach is
  // as picked over as it was a moment ago. Rebuilding hands back a frontier
  // holding everything reached, so it is put back to what it was, plus the
  // ground around the burn.
  const front = [];
  for (let i = 0; i < rt.frontier.size; i++) front.push(rt.frontier.at(i));
  ctx.rebuild();
  const now = ctx.rt();
  now.frontier.clear();
  for (const id of front) if (now.reached.has(id)) now.frontier.add(id);
  const look = Math.ceil(ctx.search > 0 ? ctx.search : 1);
  for (const id of gone) {
    const n = world.nodes[id];
    for (let di = -look; di <= look; di++) {
      for (let dj = -look; dj <= look; dj++) {
        const other = world.byCell.get((n.i + di) + ',' + (n.j + dj));
        if (other !== undefined && now.reached.has(other)) now.frontier.add(other);
      }
    }
  }
  // The front is never left with nowhere to look: if nothing held lies beside
  // the burn at all, everything reached goes back on the frontier.
  if (now.frontier.size === 0) for (const id of state.reached) now.frontier.add(id);
  // The wedge itself is kept alongside the places it took, so the burn can be
  // drawn as the shape it was rather than as a scatter of dark points.
  e.burn = {
    nodes: Array.from(gone),
    until: state.t + (c.markSeconds > 0 ? c.markSeconds : 0),
    angle: a0,
    half,
    from: r0,
  };
  return gone.size;
}

// -- the rival --------------------------------------------------------------

/** Another fungus comes up out where the threads are thinnest. */
function rivalArrives(state, cfg, e, ctx) {
  const c = kindCfg(cfg, 'rival');
  const world = ctx.world;
  const rt = ctx.rt();
  const edge = Math.max(1, state.ring * cfg.world.ringWidth) * (c.edge > 0 ? c.edge : 0);
  const open = [];
  for (const n of world.nodes) {
    if (n.ring > state.ring) continue;
    if (rt.reached.has(n.id) || rt.claimed.has(n.id)) continue;
    if (Math.sqrt(n.x * n.x + n.y * n.y) < edge) continue;
    open.push(n.id);
  }
  if (!open.length) return false;
  const k = e.count.rival;
  const at = open[hash(state.seed, 'rival:at:' + k) % open.length];
  e.rival = {
    nodes: [at],
    born: state.t,
    seed: hash(state.seed, 'rival:' + k),
    due: state.t,        // it starts spreading the moment it is noticed
    gained: state.t,
    claimed: 0,
    said: 0,
  };
  return true;
}

/**
 * The rival takes one open place next to ground it holds every `rate`
 * seconds, and never a place the threads have already reached or claimed. It
 * loses whatever the tips take back, and withers once it has been held still
 * for long enough.
 * @returns how many places it holds, 0 when it is finished
 */
function rivalStep(state, cfg, e, ctx) {
  const c = kindCfg(cfg, 'rival');
  const r = e.rival;
  const rt = ctx.rt();
  const world = ctx.world;
  const rate = c.rate > 0 ? c.rate : 30;

  // Whatever the threads have taken back is no longer its.
  if (r.nodes.some(id => rt.reached.has(id))) r.nodes = r.nodes.filter(id => !rt.reached.has(id));
  if (!r.nodes.length) return 0;

  const held = new Set(r.nodes);
  const isReached = (id) => rt.reached.has(id);
  const isTaken = (id) => rt.claimed.has(id) || held.has(id);
  let guard = 0;
  while (state.t >= r.due && guard++ < (c.maxPerStep > 0 ? c.maxPerStep : 32)) {
    r.due += rate;
    let got = -1;
    const n = r.nodes.length;
    const start = hash(r.seed, 'claim:' + r.claimed) % n;
    for (let i = 0; i < n && got < 0; i++) {
      got = nearestOpen(world, r.nodes[(start + i) % n], c.search, state.ring, isReached, isTaken);
    }
    if (got < 0) break;   // boxed in: it holds what it holds
    r.nodes.push(got);
    held.add(got);
    r.claimed++;
    r.gained = state.t;
  }
  if (state.t - r.gained > (c.stallSeconds > 0 ? c.stallSeconds : 300)) return 0;
  return r.nodes.length;
}
