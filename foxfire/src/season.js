// ---------------------------------------------------------------------------
// The year.
//
// Four equal seasons on the simulation clock, deterministic, so a player can
// read when the next one comes and plan for it. The multipliers are the raw
// ones from config; the simulation folds in the traits that soften winter.
// ---------------------------------------------------------------------------

/** @returns {{ year, index, frac, left, seasonSeconds, trade, growth, tips, litter }} */
export function seasonOf(cfg, t) {
  const yearSeconds = Math.max(4, cfg.season.yearSeconds);
  const seasonSeconds = yearSeconds / 4;
  const tt = Math.max(0, t);
  const year = Math.floor(tt / yearSeconds);
  const into = tt - year * yearSeconds;
  const index = Math.min(3, Math.floor(into / seasonSeconds));
  const within = into - index * seasonSeconds;
  return {
    year,
    index,
    frac: within / seasonSeconds,
    left: seasonSeconds - within,
    seasonSeconds,
    trade: cfg.season.trade[index],
    growth: cfg.season.growth[index],
    tips: cfg.season.tips[index],
    litter: cfg.season.litter[index],
  };
}

export const SPRING = 0, SUMMER = 1, AUTUMN = 2, WINTER = 3;
