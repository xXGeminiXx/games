// The compass: the single move worth making right now, and the figures behind
// it, worked out from the live ledger every time it is asked.
//
// It is one ordered list of conditions. The first one that holds wins, so the
// order IS the game's own view of what matters: a free move before a bought
// one, the ground before the ledger, and a purchase named only when it is not
// stealing from a voyage the player is saving for.
//
// Pure. It reads the economy and formats numbers; it touches no page.
import { fmt, pct, duration } from './numbers.js?v=19';

export function createAdvice(cfg, eco) {
  const K = cfg.kindOrder;
  const E = cfg.economy;
  const A = cfg.advice;

  const say = (key, vars) => ({ key, vars });

  // Everything a drone's haul is multiplied by before it reaches the price.
  const haulFactor = () => eco.islandRich() * eco.holdMult() * (0.6 + 0.4 * (eco.droneSpeed() / cfg.drones.speed));

  /** What one more untrained drone adds to income each second. */
  const perDrone = () => {
    const w = K.map((k) => Math.max(0, eco.state.avail[k]));
    const wsum = w.reduce((a, b) => a + b, 0) || 1;
    const f = haulFactor();
    return K.reduce((a, k, i) => a + (w[i] / wsum) * cfg.kinds[k].rate * eco.state.avail[k] * f * eco.price(k), 0);
  };

  /** What training one drone to a trade adds: what it gathers there, less what it gathered everywhere. */
  const perSpecialist = (k) =>
    E.specialistMult * cfg.kinds[k].rate * eco.state.avail[k] * haulFactor() * eco.price(k) - perDrone();

  /**
   * What one more level of an upgrade adds to income each second. Hold and
   * engines multiply the haul, so their gain is the current income times the
   * step they add. Range and hangars change where drones can go and what the
   * next one costs, not what today's fleet brings back, so they are worth
   * nothing on this scale and are named by their own conditions instead.
   */
  const perUpgrade = (u) => {
    const U = E.upgrades[u], lv = eco.level(u);
    if (!U || lv >= U.max) return 0;
    const income = eco.revenue();
    if (u === 'hold') return income * U.effect / (1 + U.effect * lv);
    if (u === 'engines') return income * (0.4 * U.effect) / (0.6 + 0.4 * (1 + U.effect * lv));
    return 0;
  };

  /**
   * How long something takes, for a player to read. A payback under a second
   * printed as "0s", which reads as a bug rather than as a bargain.
   */
  const howLong = (seconds) => (seconds < 1 ? labelOf('instant') : duration(seconds));

  /** Seconds of the current income needed to cover a price. */
  const waitFor = (cost) => {
    const income = eco.revenue();
    const short = cost - eco.state.funds;
    if (short <= 0) return 0;
    return income > 0 ? short / income : Infinity;
  };

  const read = () => {
    const s = eco.state;
    const flags = s.flags || {};
    const income = eco.revenue();
    const best = K.reduce((a, k) => (s.avail[k] > s.avail[a] ? k : a), K[0]);

    // A trade the fleet is locked to that has nothing left underneath it. The
    // drones keep flying and bring back nothing, which is the one failure the
    // panel cannot show as a falling number - it shows as a number that was
    // never there.
    if (flags.specialists) {
      const dry = K.filter((k) => s.specialists[k] > 0 && s.avail[k] <= A.dryLand);
      if (dry.length) return say('stranded', { kind: names(dry) });
    }

    // The ground under the carrier is worked down but the island is not. The
    // fix costs nothing, so it beats anything that costs funds.
    if (s.avail[best] < A.thinLand && s.remaining > A.emptyIsland) {
      return say('move', { kind: cfg.kinds[best].name, pct: pct(s.avail[best]) });
    }

    // One market carrying the fleet and crashed by it. This is the lever the
    // game is built on and the only place it shows is a percentage in a
    // column, so it is worth a sentence when it bites: the fleet is selling
    // more of one thing than the market will take, and another trade is
    // paying full price for the same work.
    if (flags.hold && flags.specialists) {
      const y = eco.yields();
      const share = (k) => y[k] * eco.price(k);
      const demand = (k) => eco.price(k) / (cfg.kinds[k].basePrice * eco.islandPrice());
      const earner = K.reduce((a, k) => (share(k) > share(a) ? k : a), K[0]);
      if (demand(earner) <= A.floodedDemand) {
        const spare = K.filter((k) => k !== earner && demand(k) >= A.healthyDemand && s.avail[k] >= A.thinLand)
          .sort((a, b) => s.avail[b] * cfg.kinds[b].rate * eco.price(b) - s.avail[a] * cfg.kinds[a].rate * eco.price(a))[0];
        if (spare) {
          return say('flooded', { kind: cfg.kinds[earner].name, pct: pct(demand(earner)),
            other: cfg.kinds[spare].name, otherPct: pct(demand(spare)) });
        }
      }
    }

    // The island itself is worked out.
    const castCost = eco.castOffCost();
    const islandThin = s.remaining <= cfg.reveal.voyageAtDepletion;
    if (flags.voyage && islandThin) {
      if (s.funds >= castCost) {
        return say('castOff', { n: s.island + 1, cost: fmt(castCost), rich: E.islandRichness, pay: E.islandPrice, gone: pct(1 - s.remaining) });
      }
      // Reach is the other answer when there is nowhere better to sit.
      if (flags.carrier && eco.level('range') < E.upgrades.range.max && s.funds >= eco.upgradeCost('range')) {
        return say('range', { cost: fmt(eco.upgradeCost('range')), n: E.upgrades.range.effect, reach: fmt(eco.range()) });
      }
    }

    // Saving for a voyage. Anything worth naming during the wait has to be
    // small enough that buying it does not push the voyage further away.
    const saving = flags.voyage && islandThin && s.funds < castCost;
    const ceiling = saving ? castCost * A.smallShare : Infinity;

    // Hangars pay in the price of every drone after them, never in today's
    // income, so they are named when they cost less than the drone they
    // replace - at that price the hangar is the cheaper of the two outright.
    if (flags.carrier && eco.level('hangars') < E.upgrades.hangars.max) {
      const cost = eco.upgradeCost('hangars');
      if (cost <= eco.hireCost() * A.hangarWorth && cost <= s.funds && cost <= ceiling) {
        return say('hangars', { cost: fmt(cost), hire: fmt(eco.hireCost()) });
      }
    }

    // Everything that can be bought right now, ranked by how long it takes to
    // pay its own price back out of what it adds.
    const buys = [];
    const hire = eco.hireCost();
    if (hire <= s.funds && hire <= ceiling) buys.push({ what: 'drone', cost: hire, gain: perDrone(), vars: {} });
    if (flags.specialists) {
      for (const k of K) {
        const cost = eco.specialistCost();
        if (eco.generalists() >= 1 && cost <= s.funds && cost <= ceiling) {
          buys.push({ what: 'specialist', cost, gain: perSpecialist(k), vars: { kind: cfg.kinds[k].name } });
        }
      }
    }
    if (flags.carrier) {
      for (const u of ['hold', 'engines']) {
        const cost = eco.upgradeCost(u);
        if (eco.level(u) < E.upgrades[u].max && cost <= s.funds && cost <= ceiling) {
          buys.push({ what: 'upgrade', cost, gain: perUpgrade(u), vars: { name: E.upgrades[u].name } });
        }
      }
    }
    const worth = buys.filter((b) => b.gain > 0).sort((a, b) => a.cost / a.gain - b.cost / b.gain)[0];
    if (worth) {
      // Each of these is written out rather than keyed from the variable so a
      // scan of this file can find every sentence the module is able to say.
      const v = { ...worth.vars, cost: fmt(worth.cost), gain: fmt(worth.gain), time: howLong(worth.cost / worth.gain) };
      if (worth.what === 'specialist') return say('buySpecialist', v);
      if (worth.what === 'upgrade') return say('buyUpgrade', v);
      return say('buyDrone', v);
    }

    // Nothing to buy. Either a voyage is being saved for, or the fleet is
    // simply earning its way to the next thing on the list.
    if (saving) {
      return say('saveVoyage', { gone: pct(1 - s.remaining), cost: fmt(castCost), rate: fmt(income), time: howLong(waitFor(castCost)) });
    }
    const next = cheapest(flags);
    if (next) return say('wait', { what: next.what, cost: fmt(next.cost), rate: fmt(income), time: howLong(waitFor(next.cost)) });
    return say('idle', { rate: fmt(income) });
  };

  /** The cheapest thing on the panel that is not yet affordable. */
  const cheapest = (flags) => {
    const out = [];
    out.push({ what: labelOf('drone'), cost: eco.hireCost() });
    if (flags.specialists && eco.generalists() >= 1) out.push({ what: labelOf('specialist'), cost: eco.specialistCost() });
    if (flags.carrier) {
      for (const u in E.upgrades) {
        if (eco.level(u) < E.upgrades[u].max) out.push({ what: E.upgrades[u].name, cost: eco.upgradeCost(u) });
      }
    }
    if (flags.voyage) out.push({ what: labelOf('voyage'), cost: eco.castOffCost() });
    const over = out.filter((o) => o.cost > eco.state.funds).sort((a, b) => a.cost - b.cost);
    return over[0] || null;
  };

  // The few nouns this module puts in front of a player. They live in config
  // beside the numbers so the words and the figures are changed together.
  const labelOf = (what) => (A.words && A.words[what]) || what;
  const names = (ks) => {
    const list = ks.map((k) => cfg.kinds[k].name);
    if (list.length < 2) return list.join('');
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  };

  return { read, perDrone, perSpecialist, perUpgrade, waitFor };
}

export default createAdvice;
