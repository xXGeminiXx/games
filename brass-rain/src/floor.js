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

import { priceAt, priceOf, maxAffordable, bulkBuy } from './economy.js?v=71';

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
    // Coins buy arcade machines and nothing else, so a coin sitting still is
    // a coin doing nothing. On by default: a player who never opens the panel
    // still has an arcade that grows, and turning it off leaves every button
    // exactly as it was.
    autobuy: true,
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

/**
 * What one more of a machine adds per second, before the multipliers every
 * machine shares.
 *
 * The shared ones - how deep the best game got, and what the stars are worth -
 * multiply every machine equally, so they cancel out of a comparison between
 * two machines and are left out. What does not cancel is the milestone step:
 * the tenth of a machine is worth far more than the ninth, so the unit that
 * completes a milestone can be the best coin on the floor even when its
 * neighbour looks cheaper.
 */
export function unitGain(cfg, floor, id) {
  const def = machineDef(cfg, id);
  if (!def) return 0;
  const n = floor.owned[id] || 0;
  return def.income * ((n + 1) * milestoneMult(cfg, n + 1) - n * milestoneMult(cfg, n));
}

/** The machine whose next unit buys the most income per coin, or null. */
export function bestBuy(cfg, floor) {
  let best = null;
  let bestRate = 0;
  for (const m of cfg.floor.machines) {
    const price = unitPrice(cfg, floor, m.id);
    if (!Number.isFinite(price) || price <= 0 || price > floor.scrip) continue;
    const rate = unitGain(cfg, floor, m.id) / price;
    if (rate > bestRate) { bestRate = rate; best = m.id; }
  }
  return best;
}

/**
 * Spends idle coins on the best value on the floor, over and over, while
 * anything is affordable.
 *
 * There is nothing else to spend a coin on, so this can never cost the player
 * anything; the only judgement in it is WHICH machine, and that is settled by
 * income per coin with the milestone step counted. `steps` caps one call so a
 * large sum landing at once cannot hold a frame.
 */
export function autoSpend(cfg, floor, steps = 400) {
  if (floor.autobuy === false) return { bought: 0, spent: 0 };
  let bought = 0;
  const before = floor.scrip;
  for (let i = 0; i < steps; i++) {
    const id = bestBuy(cfg, floor);
    if (!id) break;
    const k = buyMachine(cfg, floor, id, 1);
    if (k <= 0) break;
    bought += k;
  }
  return { bought, spent: Math.max(0, before - floor.scrip) };
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
    autobuy: floor.autobuy !== false,
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
  // Saves written before this existed have no flag, and the answer for them is
  // the same as for a new arcade: on.
  floor.autobuy = obj.autobuy !== false;
  return floor;
}

function num(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; }

export { priceOf, maxAffordable };
