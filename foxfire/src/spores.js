// ---------------------------------------------------------------------------
// Fruiting: the rebirth.
//
// An organism that has grown past a given reach can fruit. That ends it. The
// spores it releases are counted from how far it got, and they buy perks that
// hold in every organism after: the genome. The genome is the one thing that
// outlives a run; the simulation reads it and never writes it, except here.
// ---------------------------------------------------------------------------

export function freshGenome() {
  return { spores: 0, perks: {}, fruitings: 0, best: { level: 0, area: 0 }, total: 0 };
}

export function canFruit(cfg, state) {
  return state.level >= cfg.spores.fromLevel;
}

/** Spores an organism would release now. */
export function sporesFor(cfg, state, area) {
  const s = cfg.spores;
  const lv = state.level;
  return Math.max(0, Math.floor(s.perLevel * lv * lv + s.perLog * Math.log10(1 + Math.max(0, area))));
}

/** End the organism. Returns what was gained. */
export function fruit(cfg, state, genome, area) {
  const spores = sporesFor(cfg, state, area);
  genome.spores += spores;
  genome.total += spores;
  genome.fruitings += 1;
  if (state.level > genome.best.level) genome.best.level = state.level;
  if (area > genome.best.area) genome.best.area = area;
  return { spores };
}

export function perkLevel(genome, id) {
  return (genome.perks && genome.perks[id]) || 0;
}

/** Spores for the next level of a perk, or null when capped. */
export function perkCost(cfg, genome, id) {
  const p = cfg.spores.genome.find(x => x.id === id);
  if (!p) return null;
  const lv = perkLevel(genome, id);
  if (lv >= p.cap) return null;
  return Math.ceil(p.cost * Math.pow(p.growth, lv));
}

/** Buy one level of a perk. Returns the new level, or 0 if it could not be bought. */
export function buyPerk(cfg, genome, id) {
  const cost = perkCost(cfg, genome, id);
  if (cost === null || genome.spores < cost) return 0;
  genome.spores -= cost;
  genome.perks[id] = perkLevel(genome, id) + 1;
  return genome.perks[id];
}

export function offered(cfg, genome) {
  return cfg.spores.genome.map(p => ({
    id: p.id, level: perkLevel(genome, p.id), cap: p.cap, cost: perkCost(cfg, genome, p.id),
  }));
}
