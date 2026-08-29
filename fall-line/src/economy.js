// ---------------------------------------------------------------------------
// Ore - the one currency, spent on works and on the ground itself.
//
// Every price and every payout in the game is one of these functions, so the
// balance of "another work" against "another level of height" can be read in
// one place. Nothing here holds state or decides whether a purchase happens;
// it only says what a thing costs and what it pays.
// ---------------------------------------------------------------------------

/** Raising a cell from height `h` to `h + 1`. Each level costs more. */
export function raiseCost(cfg, h) {
  const e = cfg.economy;
  return e.raiseBase + e.raisePer * (Number.isFinite(h) ? h : 0);
}

/** Cutting a cell down one level. Flat, and cheaper than building up. */
export function cutCost(cfg) {
  return cfg.economy.cutCost;
}

/** The reward for a surge that reached the hearth with nothing to show. */
export function clearBonus(cfg, n) {
  const s = cfg.surge;
  return s.clearBase + s.clearPer * n;
}

/**
 * The reward for calling a surge before the countdown runs out. It pays by the
 * second saved and grows with the surge number, so hurrying stays worth it
 * once a single work costs more than an early call used to pay.
 */
export function callBonus(cfg, n, remainingSeconds) {
  const s = cfg.surge;
  const left = Number.isFinite(remainingSeconds) ? remainingSeconds : 0;
  if (left <= 0) return 0;
  const paid = Math.floor(left * s.callBonusPerSecond * (1 + s.callBonusPer * n));
  return paid > 0 ? paid : 0;
}

/** What selling a work hands back out of everything spent on it. */
export function sellRefund(cfg, spent) {
  const total = Number.isFinite(spent) ? spent : 0;
  const back = Math.floor(total * cfg.economy.sellRefund);
  return back > 0 ? back : 0;
}

/** Whether a purchase can go through. */
export function canAfford(ore, cost) {
  return Number.isFinite(ore) && Number.isFinite(cost) && ore >= cost;
}

/**
 * A number short enough for the header. Anything a player can still spend
 * exactly is printed exactly; past that it is abbreviated. A fraction is cut
 * off rather than rounded up, so the counter never reads higher than what the
 * next purchase will actually find there.
 */
export function format(n) {
  if (!Number.isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (v < 1e4) return sign + String(Math.trunc(v));
  const unit = v < 1e6 ? ['k', 1e3] : (v < 1e9 ? ['M', 1e6] : ['B', 1e9]);
  const scaled = Math.trunc((v / unit[1]) * 10) / 10;
  const body = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
  return sign + body + unit[0];
}
