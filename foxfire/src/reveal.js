// ---------------------------------------------------------------------------
// Progressive reveal.
//
// Nothing is on the page until it means something. Each flag turns on once,
// on a condition read from the state, and never turns off, so a save carries
// exactly the page the player had. The conditions are here and nowhere else.
// ---------------------------------------------------------------------------

/** Set any flags whose condition now holds. Returns the ones newly set. */
export function update(state, cfg, ctx) {
  const f = state.flags;
  const on = [];
  const set = (k) => { if (!f[k]) { f[k] = true; on.push(k); } };

  set('hand');
  if (state.reached.length >= 3 || state.sugar >= ctx.tipCost * 0.6 || state.tipCount > 0) set('tips');
  if (state.tipCount > 0) set('traits');
  if (state.tipCount > 0 || state.reached.length >= 4) set('reach');
  if (ctx.rootsReached > 0) set('trees');
  if (state.totals.traded > 0) set('season');
  if (state.level >= 1) set('below');
  if (state.level >= cfg.spores.fromLevel || (ctx.genome && ctx.genome.fruitings > 0)) set('spores');
  if (f.tips && state.tipCount >= 1) set('handDone');

  return on;
}
