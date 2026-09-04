// The ledger side of the game: funds, the fleet, prices, upgrades, islands.
//
// The picture decides where drones go; this decides what it is worth. It
// takes one input from the picture each second - how rich the land within
// range is, per kind - and turns the fleet into money. Selling floods a
// market: every kind has a pressure that builds with what you sell and
// decays with time, and its price is base / (1 + pressure). A fleet that
// gathers one thing crashes one price; the game is in the mix.
//
// Pure: no DOM, no GPU. Everything here is driven by tick(dt, avail).
export function createEconomy(cfg, rngLike = Math.random) {
  const E = cfg.economy;
  const K = cfg.kindOrder;

  const state = {
    funds: E.startFunds,
    drones: cfg.drones.start,        // total, generalists + specialists
    specialists: Object.fromEntries(K.map((k) => [k, 0])),
    upgrades: Object.fromEntries(Object.keys(E.upgrades).map((u) => [u, 0])),
    pressure: Object.fromEntries(K.map((k) => [k, 0])),
    island: 1,
    islandsVisited: 0,   // how many islands have been worked, counting the first
    lifetime: 0,                     // funds earned ever
    playtime: 0,
    avail: Object.fromEntries(K.map((k) => [k, 0.5])),   // last richness within range, 0..1
    remaining: 1,                    // island richness fraction remaining
    flags: {},                       // reveal flags, set once
  };

  const level = (u) => state.upgrades[u] || 0;
  const generalists = () => state.drones - K.reduce((a, k) => a + state.specialists[k], 0);
  const droneSpeed = () => cfg.drones.speed * (1 + level('engines') * E.upgrades.engines.effect);
  const range = () => cfg.carrier.range + level('range') * E.upgrades.range.effect;
  const holdMult = () => 1 + level('hold') * E.upgrades.hold.effect;
  const islandRich = () => Math.pow(E.islandRichness, state.island - 1);
  const islandPrice = () => Math.pow(E.islandPrice, state.island - 1);

  const price = (k) => Math.max(E.priceFloor, 1 / (1 + state.pressure[k])) * cfg.kinds[k].basePrice * islandPrice();

  // Yield per kind per second. Generalists spread themselves by where the
  // land is rich; specialists work their trade only.
  const yields = () => {
    const out = {};
    const g = generalists();
    const weights = K.map((k) => Math.max(0, state.avail[k]));
    const wsum = weights.reduce((a, b) => a + b, 0) || 1;
    const speedMult = droneSpeed() / cfg.drones.speed;
    K.forEach((k, i) => {
      const gen = g * (weights[i] / wsum);
      const spec = state.specialists[k] * E.specialistMult;
      const workers = gen + spec;
      out[k] = workers * cfg.kinds[k].rate * state.avail[k] * islandRich() * holdMult() * (0.6 + 0.4 * speedMult);
    });
    return out;
  };

  const revenue = () => {
    const y = yields();
    return K.reduce((a, k) => a + y[k] * price(k), 0);
  };

  // Advance the ledger. avail is {kind: 0..1} from the picture, or null to
  // keep the last reading (offline catch-up uses the last reading).
  const tick = (dt, avail = null) => {
    if (avail) for (const k of K) if (Number.isFinite(avail[k])) state.avail[k] = avail[k];
    const y = yields();
    let earned = 0;
    for (const k of K) {
      const sold = y[k] * dt;
      earned += sold * price(k);
      state.pressure[k] += sold * E.priceSensitivity;
      state.pressure[k] -= state.pressure[k] * E.priceRecovery * dt;
      if (state.pressure[k] < 0) state.pressure[k] = 0;
    }
    state.funds += earned;
    state.lifetime += earned;
    state.playtime += dt;
    return earned;
  };

  // ---- costs and purchases ----
  const hireCost = () => E.hireBase * Math.pow(hireRatio(), state.drones - cfg.drones.start);
  // The price of the next drone times a ratio, again and again, so the price
  // of n of them is a geometric series rather than n times anything. Summed in
  // closed form: a player buying ten thousand should not wait for a loop.
  // Hangars discount the CLIMB, not the whole ratio. Multiplying the ratio
  // itself put it below one from the second hangar on, which does not mean
  // "cheaper" - it means each drone costs less than the last, compounding
  // downward until they are free. A fleet of a few thousand reached a price of
  // 1e-118. Discounting only the part above one keeps the price climbing, more
  // slowly, which is what the upgrade is for.
  const hireRatio = () => 1 + (E.hireGrowth - 1) * Math.pow(E.hangarDiscount, level('hangars'));
  const hireCostN = (n) => {
    if (!(n > 0)) return 0;
    const r = hireRatio(), first = hireCost();
    return r === 1 ? first * n : first * (Math.pow(r, n) - 1) / (r - 1);
  };
  /**
   * The most that can be afforded right now, from the same series solved for n.
   *
   * The ratio is not always above one: hangar levels discount it, and enough of
   * them put it BELOW one, so each drone is cheaper than the last and the
   * series converges. Solving as though the price always climbs takes the log
   * of a negative number there and returns NaN, which is what a fleet of a few
   * thousand with three hangar levels actually hit.
   */
  const hireMax = () => {
    const r = hireRatio(), first = hireCost();
    if (!(first > 0) || state.funds < first) return 0;
    if (r === 1) return Math.floor(state.funds / first);
    if (r > 1) {
      const n = Math.log(1 + (state.funds * (r - 1)) / first) / Math.log(r);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    }
    // Falling price. The whole infinite series costs first/(1-r); if that is
    // affordable then every drone is, and the answer is a cap rather than a
    // number - there has to be one, or a press would ask for more bodies than
    // the fleet can hold.
    const whole = first / (1 - r);
    if (state.funds >= whole) return E.hireMaxAtOnce;
    const rest = 1 - (state.funds * (1 - r)) / first;
    const n = Math.log(rest) / Math.log(r);
    return Number.isFinite(n) ? Math.max(0, Math.min(E.hireMaxAtOnce, Math.floor(n))) : 0;
  };
  // Ten drones at a discount, priced off the same series a single drone uses.
  // It used to build its own price by multiplying the growth ratio by the
  // hangar discount, which puts the ratio below one from the first hangar
  // level on: each drone in the wing cost less than the one before it and the
  // whole wing collapsed toward nothing. A fleet of 393 with twelve hangar
  // levels was offered ten more for 2e-111 with a single drone priced at
  // 62.5M beside it.
  const wingCost = () => hireCostN(E.wingSize) * E.wingDiscount;
  const specialistCost = () => hireCost() * E.specialistCost;
  const upgradeCost = (u) => E.upgrades[u].base * Math.pow(E.upgrades[u].growth, level(u));
  const castOffCost = () => E.castOffBase * Math.pow(E.castOffGrowth, state.island - 1);

  const spend = (c) => { if (state.funds < c) return false; state.funds -= c; return true; };

  const actions = {
    hire: {
      cost: (n) => hireCostN(Math.max(1, n | 0)),
      max: hireMax,
      can: (n) => { const k = Math.max(1, n | 0); return k > 0 && state.funds >= hireCostN(k); },
      do: (n) => {
        const k = Math.max(1, n | 0);
        if (!(k > 0) || !spend(hireCostN(k))) return false;
        state.drones += k;
        return true;
      },
    },
    wing: { cost: wingCost, can: () => level('hangars') >= 1 && state.funds >= wingCost(), do: () => { if (level('hangars') < 1 || !spend(wingCost())) return false; state.drones += E.wingSize; return true; } },
    specialist: {
      // A specialist costs the same each time - the price follows the fleet,
      // not how many are already trained - so n of them is n times one, and
      // the limit is the generalists there are left to train.
      cost: (k, n) => specialistCost() * Math.max(1, n | 0),
      max: () => Math.min(generalists(), Math.floor(state.funds / Math.max(1e-9, specialistCost()))),
      can: (k, n) => {
        const c = Math.max(1, n | 0);
        return generalists() >= c && state.funds >= specialistCost() * c;
      },
      do: (k, n) => {
        const c = Math.max(1, n | 0);
        if (!K.includes(k) || generalists() < c || !spend(specialistCost() * c)) return false;
        state.specialists[k] += c;
        return true;
      },
    },
    upgrade: {
      // Each level costs the one before times a ratio, so n levels is a
      // geometric series - and it stops at the upgrade's own ceiling however
      // much is in the bank.
      cost: (u, n) => {
        if (!(u in E.upgrades)) return Infinity;
        const g = E.upgrades[u].growth, lv = level(u);
        const c = Math.min(Math.max(1, n | 0), E.upgrades[u].max - lv);
        if (c <= 0) return Infinity;
        const first = E.upgrades[u].base * Math.pow(g, lv);
        return g === 1 ? first * c : first * (Math.pow(g, c) - 1) / (g - 1);
      },
      max: (u) => {
        if (!(u in E.upgrades)) return 0;
        const g = E.upgrades[u].growth, lv = level(u);
        const room = E.upgrades[u].max - lv;
        if (room <= 0) return 0;
        const first = E.upgrades[u].base * Math.pow(g, lv);
        if (state.funds < first) return 0;
        const n = g === 1 ? Math.floor(state.funds / first)
                          : Math.floor(Math.log(1 + (state.funds * (g - 1)) / first) / Math.log(g));
        return Math.max(0, Math.min(room, n));
      },
      can: (u, n) => {
        const c = Math.max(1, n | 0);
        return u in E.upgrades && level(u) + c <= E.upgrades[u].max && state.funds >= actions.upgrade.cost(u, c);
      },
      do: (u, n) => {
        const c = Math.max(1, n | 0);
        if (!(u in E.upgrades) || level(u) + c > E.upgrades[u].max) return false;
        if (!spend(actions.upgrade.cost(u, c))) return false;
        state.upgrades[u] += c;
        return true;
      },
    },
    castOff: {
      cost: castOffCost,
      can: () => state.funds >= castOffCost(),
      do: () => {
        if (!spend(castOffCost())) return false;
        state.island += 1;
        state.islandsVisited += 1;
        state.remaining = 1;
        for (const k of K) { state.pressure[k] *= 0.5; state.avail[k] = 0.5; }
        return true;
      },
    },
  };

  // Offline: the last reading of the land, the fleet as it was, capped, in
  // steps so the price pressure integrates rather than spikes.
  const catchUp = (seconds) => {
    const away = Math.max(0, seconds);
    const t = Math.min(E.offlineCap, away);
    let earned = 0;
    const step = E.offlineStep;
    for (let s = 0; s < t; s += step) earned += tick(Math.min(step, t - s), null);
    // Both times are handed back, not just the one that was paid for. A player
    // gone two days who is told they were gone eight hours reads it as the game
    // having quietly lost their time; they were away as long as they were away,
    // and the fleet stopping before they came back is a separate fact worth
    // saying out loud rather than hiding inside the first number.
    return { worked: t, away, capped: away > t, earned };
  };

  const snapshot = () => JSON.parse(JSON.stringify({
    funds: state.funds, drones: state.drones, specialists: state.specialists, upgrades: state.upgrades,
    pressure: state.pressure, island: state.island, islandsVisited: state.islandsVisited, lifetime: state.lifetime,
    playtime: state.playtime, avail: state.avail, remaining: state.remaining, flags: state.flags,
  }));

  const load = (snap) => {
    if (!snap || typeof snap !== 'object') return false;
    const num = (v, d) => (Number.isFinite(v) ? v : d);
    state.funds = num(snap.funds, state.funds);
    state.drones = Math.max(cfg.drones.start, num(snap.drones, state.drones));
    // A fleet bought while hangars made drones cheaper than the last one is
    // larger than the price curve can now explain, and its owner would find
    // the hire button dead for ever - the next drone priced at a number with
    // seventy digits. Bring such a fleet back to what the funds on hand could
    // actually reach, so the run carries on instead of ending in a wall.
    if (state.drones > E.hireSaneFleet) {
      const ratio = 1 + (E.hireGrowth - 1) * Math.pow(E.hangarDiscount, state.upgrades.hangars || 0);
      const affordable = Math.log(1 + (Math.max(0, state.funds) * (ratio - 1)) / E.hireBase) / Math.log(ratio);
      // What the funds on hand actually reach, never below the opening fleet.
      // A floor set at the threshold would leave the hire button just as dead
      // as before, which is the whole thing being fixed.
      const keep = Math.max(cfg.drones.start, Math.floor(Number.isFinite(affordable) ? affordable : 0));
      if (keep < state.drones) {
        // The specialists among them go with the fleet, in proportion, so the
        // makeup a player chose survives the correction.
        const share = keep / state.drones;
        for (const k of K) state.specialists[k] = Math.floor(state.specialists[k] * share);
        state.drones = keep;
      }
    }
    for (const k of K) { state.specialists[k] = num(snap.specialists && snap.specialists[k], 0); state.pressure[k] = num(snap.pressure && snap.pressure[k], 0); state.avail[k] = num(snap.avail && snap.avail[k], 0.5); }
    for (const u in E.upgrades) state.upgrades[u] = Math.min(E.upgrades[u].max, num(snap.upgrades && snap.upgrades[u], 0));
    state.island = Math.max(1, num(snap.island, 1));
    // Saves written before this was named for what it counts still carry the
    // old field, so either spelling is accepted on the way in.
    state.islandsVisited = num(snap.islandsVisited, num(snap.islandsLeft, 0));
    state.lifetime = num(snap.lifetime, 0);
    state.playtime = num(snap.playtime, 0);
    state.remaining = num(snap.remaining, 1);
    state.flags = snap.flags && typeof snap.flags === 'object' ? { ...snap.flags } : {};
    return true;
  };

  return { state, K, tick, yields, revenue, price, generalists, droneSpeed, range, holdMult, islandRich, islandPrice, actions, hireCost, wingCost, specialistCost, upgradeCost, castOffCost, level, catchUp, snapshot, load };
}
