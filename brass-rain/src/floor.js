// ---------------------------------------------------------------------------
// The floor.
//
// The machine in front of the player is one of many. Every other machine on
// the floor is worked by somebody else and pays a little scrip whether the
// player is at the handle or not, which is what turns an evening at one
// cabinet into a parlour.
//
// The ladder is deliberately old fashioned: each rung costs about twelve times
// the rung below it and earns about four times as much, every unit bought
// raises the price of the next by a fixed ratio, and owning a round number of
// one machine doubles what that machine earns. Nothing here is clever. It is
// the shape that has kept working for twenty years because it never stops the
// player and never lets them run away.
//
// The one thing that is not old fashioned is that none of it is worth much
// until somebody sits down. What the floor earns is multiplied by how deep the
// player has taken a run at the handle, so the idle half of the game is paid
// for by the played half rather than replacing it.
// ---------------------------------------------------------------------------

import { priceAt, priceOf, maxAffordable, bulkBuy } from './economy.js?v=68';

/** The floor as it stands at the start of everything. */
export function createFloor(cfg) {
  const owned = {};
  const attendants = {};
  for (const m of cfg.floor.machines) { owned[m.id] = 0; attendants[m.id] = false; }
  return {
    owned,
    attendants,
    scrip: 0,
    earned: 0,        // every scrip ever taken, which is what prestige reads
    cashed: 0,        // balls ever handed to the counter
    bestRound: 0,     // the deepest round any run has reached
    games: 0,         // finished games, counted since this was added
    lastTick: 0,
  };
}

/** The definition of a machine by id. */
export function machineDef(cfg, id) {
  return cfg.floor.machines.find(m => m.id === id) || null;
}

/** How many milestones `n` of a machine has passed, and what they multiply by. */
export function milestoneMult(cfg, n) {
  let mult = 1;
  for (const m of cfg.floor.milestones) if (n >= m) mult *= cfg.floor.milestoneMult;
  return mult;
}

/** The next milestone above `n`, or null once they are all passed. */
export function nextMilestone(cfg, n) {
  for (const m of cfg.floor.milestones) if (n < m) return m;
  return null;
}

/**
 * What the deepest round reached is worth to the whole floor.
 *
 * Written so that never playing still earns, one ordinary run roughly doubles
 * the floor, and a deep run is worth several times that - large enough that
 * the handle is always the best thing to do next, bounded enough that a single
 * good run cannot replace the ladder.
 */
export function handMult(cfg, bestRound) {
  const r = Math.max(0, bestRound || 0);
  if (r <= 0) return 1;
  return 1 + Math.pow(r, cfg.floor.handMultPower) / cfg.floor.handMultBase;
}

/** What one machine earns per second, everything applied. */
export function machineIncome(cfg, floor, id, meta) {
  const def = machineDef(cfg, id);
  if (!def) return 0;
  const n = floor.owned[id] || 0;
  if (n <= 0) return 0;
  return def.income * n * milestoneMult(cfg, n) * handMult(cfg, floor.bestRound) * metaMult(meta);
}

/** The whole floor, per second. */
export function floorIncome(cfg, floor, meta) {
  let total = 0;
  for (const m of cfg.floor.machines) total += machineIncome(cfg, floor, m.id, meta);
  return total;
}

function metaMult(meta) {
  return meta && Number.isFinite(meta.floorMult) && meta.floorMult > 0 ? meta.floorMult : 1;
}

/** Price of the next unit of a machine. */
export function unitPrice(cfg, floor, id) {
  const def = machineDef(cfg, id);
  if (!def) return Infinity;
  return priceAt(def.cost, def.ratio, floor.owned[id] || 0);
}

/** What buying `want` of a machine would cost and how many that really is. */
export function quote(cfg, floor, id, want) {
  const def = machineDef(cfg, id);
  if (!def) return { k: 0, cost: 0 };
  return bulkBuy(def.cost, def.ratio, floor.owned[id] || 0, floor.scrip, want);
}

/**
 * Buys machines. Returns how many were actually bought, which is zero when
 * nothing was affordable - a button that cannot buy must do nothing at all
 * rather than half of something.
 */
export function buyMachine(cfg, floor, id, want) {
  const q = quote(cfg, floor, id, want);
  if (q.k <= 0) return 0;
  // The quote is allowed to land a hair over what is held, because the sum
  // and the logarithm behind it disagree in the last bits. Taking more than
  // is there would leave a negative balance, so the last hair is forgiven
  // rather than charged.
  floor.scrip = Math.max(0, floor.scrip - Math.min(q.cost, floor.scrip));
  floor.owned[id] = (floor.owned[id] || 0) + q.k;
  return q.k;
}

/** What an attendant for a machine costs. */
export function attendantPrice(cfg, id) {
  const def = machineDef(cfg, id);
  return def ? def.cost * cfg.floor.attendantRatio : Infinity;
}

export function hireAttendant(cfg, floor, id) {
  if (floor.attendants[id]) return false;
  const price = attendantPrice(cfg, id);
  if (floor.scrip < price) return false;
  floor.scrip -= price;
  floor.attendants[id] = true;
  return true;
}

/** Hands the tray to the counter. Returns the scrip taken. */
export function cashOut(cfg, floor, balls, meta) {
  const rate = cfg.floor.cashRate * (meta && meta.cashMult > 0 ? meta.cashMult : 1);
  const scrip = balls * rate;
  if (!(scrip > 0)) return 0;
  floor.scrip += scrip;
  floor.earned += scrip;
  floor.cashed += balls;
  return scrip;
}

/**
 * Runs the floor forward.
 *
 * Returns BOTH the time that was actually paid for and the time that really
 * passed, named for which is which. A caller that wants to tell the player how
 * long they were away must use `away`; one that wants to explain the payment
 * must use `paid`. Handing back one number under a general name is how a game
 * ends up telling somebody they were gone for twelve hours when they were gone
 * for three days.
 */
export function tickFloor(cfg, floor, seconds, meta) {
  const away = Math.max(0, seconds);
  const paid = Math.min(away, cfg.floor.idleCap);
  const income = floorIncome(cfg, floor, meta);
  const gained = income * paid;
  if (gained > 0) {
    floor.scrip += gained;
    floor.earned += gained;
  }
  return { away, paid, capped: away > paid, gained, perSecond: income };
}

/** Everything the floor knows, small enough to sit inside a save. */
export function serializeFloor(floor) {
  return {
    owned: floor.owned,
    attendants: floor.attendants,
    scrip: floor.scrip,
    earned: floor.earned,
    cashed: floor.cashed,
    bestRound: floor.bestRound,
    games: floor.games || 0,
  };
}

export function restoreFloor(cfg, obj) {
  const floor = createFloor(cfg);
  if (!obj || typeof obj !== 'object') return floor;
  for (const m of cfg.floor.machines) {
    const n = Number(obj.owned && obj.owned[m.id]);
    floor.owned[m.id] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    floor.attendants[m.id] = !!(obj.attendants && obj.attendants[m.id]);
  }
  floor.scrip = num(obj.scrip);
  floor.earned = num(obj.earned);
  floor.cashed = num(obj.cashed);
  floor.bestRound = num(obj.bestRound);
  floor.games = num(obj.games);
  return floor;
}

function num(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; }

export { priceOf, maxAffordable };
