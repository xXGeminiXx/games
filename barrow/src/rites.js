// ---------------------------------------------------------------------------
// Rites: what coin buys.
//
// A rite is a level. Its cost grows geometrically per level and the effects
// are all simple multipliers read off the levels in one place (modsOf), so
// the rest of the game never asks what a rite is - only what the multipliers
// are right now.
// ---------------------------------------------------------------------------

export function defs(cfg) {
  return cfg.rites.list;
}

export function defOf(cfg, id) {
  return cfg.rites.list.find(d => d.id === id) || null;
}

export function levelOf(s, id) {
  return s.rites[id] || 0;
}

/** Coin for the next level of a rite. */
export function cost(def, level) {
  return def.cost * Math.pow(def.growth, level);
}

export function maxed(s, def) {
  return levelOf(s, def.id) >= def.max;
}

export function canBuy(s, def) {
  return !maxed(s, def) && s.coin >= cost(def, levelOf(s, def.id));
}

/** Buy the next level. Returns the level reached, or 0 if nothing happened. */
export function buy(s, id, cfg) {
  const def = defOf(cfg, id);
  if (!def || !canBuy(s, def)) return 0;
  const price = cost(def, levelOf(s, id));
  s.coin -= price;
  s.totals.spent += price;
  s.rites[id] = levelOf(s, id) + 1;
  return s.rites[id];
}

/** Every multiplier the simulation reads, from the levels held. */
export function modsOf(s, cfg) {
  const lv = id => levelOf(s, id);
  const brokerLv = lv('broker');
  const table = cfg.rites.broker;
  return {
    digMult: Math.pow(cfg.rites.handsFactor, lv('hands')),
    softMult: Math.pow(cfg.rites.graveFactor, lv('grave')),
    absorbMult: Math.pow(cfg.rites.routesFactor, lv('routes')),
    recoveryMult: Math.pow(cfg.rites.hasteFactor, lv('haste')),
    broker: brokerLv > 0 ? table[Math.min(brokerLv, table.length) - 1] : null,
    ledger: lv('ledger') > 0,
    foresight: lv('foresight') > 0,
  };
}

/**
 * Which rites the panel shows. They arrive one at a time, in list order: a
 * rite appears once the one before it is held and coin has reached a share
 * of its own cost, so the list unfolds at the pace the player buys into it.
 * Once shown it stays (a flag on the state), so the list only ever grows.
 */
export function visible(s, cfg) {
  const out = [];
  let prevHeld = true;
  for (const def of cfg.rites.list) {
    const flag = 'rite:' + def.id;
    const lv = levelOf(s, def.id);
    if (!s.flags[flag]) {
      const price = cost(def, lv);
      if (lv > 0 || (prevHeld && s.coin >= price * cfg.rites.showAtShare)) s.flags[flag] = true;
    }
    if (s.flags[flag]) out.push(def);
    prevHeld = lv > 0;
  }
  return out;
}
