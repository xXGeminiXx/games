// The island as textures: height and moisture, what the land can hold, and
// what is left of it. The CPU keeps one copy of the height (for the camera
// and for clicks) and reads a small summary of the richness once a second.
import { fullscreen, target, pingpong, bindScreen } from './gl.js?v=15';
import { rng } from './rng.js?v=15';

export function createWorld(gl, cfg, S) {
  const F = cfg.world.field;
  const heightPass = fullscreen(gl, S.HEIGHT_FS);
  const suitPass = fullscreen(gl, S.SUIT_FS);
  const richPass = fullscreen(gl, S.RICH_FS);
  const initRich = fullscreen(gl, S.INIT_RICH_FS);
  const blit = fullscreen(gl, S.BLIT_FS);

  const height = target(gl, { width: F, height: F, format: 'rgba32f', filter: 'linear' });
  const suit = target(gl, { width: F, height: F, format: 'rgba16f', filter: 'linear' });
  const rich = pingpong(gl, { width: F, height: F, format: 'rgba16f', filter: 'linear' });
  const harvest = target(gl, { width: F, height: F, format: 'rgba16f', filter: 'linear' });
  const small = target(gl, { width: 64, height: 64, format: 'rgba8', filter: 'linear' });
  const heightCpu = new Float32Array(F * F * 4);
  const suitCpu = new Uint8Array(64 * 64 * 4);
  const richCpu = new Uint8Array(64 * 64 * 4);

  const world = { seed: cfg.world.seed, island: 1, height, suit, rich, harvest };

  const groundAt = (x, z) => {
    const u = Math.max(0, Math.min(F - 1, Math.floor((x / cfg.world.size + 0.5) * F)));
    const v = Math.max(0, Math.min(F - 1, Math.floor((z / cfg.world.size + 0.5) * F)));
    return heightCpu[(v * F + u) * 4] * cfg.world.height;
  };

  // Build an island from its number. Island n's seed derives from the save's
  // seed, so a save always regrows the same land.
  const generate = (island) => {
    world.island = island;
    const r = rng(cfg.world.seed + '/island-' + island);
    height.bind();
    heightPass.draw({ u_seed: r.float(0, 100), u_island: island });
    gl.readPixels(0, 0, F, F, gl.RGBA, gl.FLOAT, heightCpu);
    suit.bind();
    suitPass.draw({ u_height: height, u_seed: r.float(0, 100) });
    for (const t of [rich.read, rich.write]) { t.bind(); initRich.draw({ u_suit: suit }); }
    harvest.bind();
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    // the summary of what the island holds in full
    small.bind();
    blit.draw({ u_tex: suit });
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, suitCpu);
    bindScreen(gl);
  };

  // A point on land near the middle, for the first anchor.
  const landPoint = (r, tries = 300) => {
    for (let i = 0; i < tries; i++) {
      const x = r.float(-0.3, 0.3) * cfg.world.size, z = r.float(-0.3, 0.3) * cfg.world.size;
      const h = groundAt(x, z);
      if (h > cfg.world.sea + 5 && h < cfg.world.height * 0.55) return [x, z];
    }
    return [0, 0];
  };

  // Advance the land: take what the harvest texture says, regrow toward full.
  const step = (dt, carrier, range, bulk = 0) => {
    rich.write.bind();
    richPass.draw({ u_rich: rich.read, u_suit: suit, u_harvest: harvest, u_dt: dt, u_take: cfg.economy.take, u_regrow: cfg.economy.regrow, u_bulk: bulk, u_carrier: [carrier[0], carrier[2]], u_range: range });
    rich.swap();
    harvest.bind();
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  };

  // What is within the carrier's reach, per kind, 0..1 of what the island
  // could hold there; and what fraction of the whole island remains.
  const summary = (carrier, range) => {
    small.bind();
    blit.draw({ u_tex: rich.read });
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, richCpu);
    bindScreen(gl);
    const inRich = [0, 0, 0, 0], inFull = [0, 0, 0, 0];
    let allRich = 0, allFull = 0;
    for (let j = 0; j < 64; j++) {
      for (let i = 0; i < 64; i++) {
        const x = ((i + 0.5) / 64 - 0.5) * cfg.world.size, z = ((j + 0.5) / 64 - 0.5) * cfg.world.size;
        const o = (j * 64 + i) * 4;
        const near = Math.hypot(x - carrier[0], z - carrier[2]) <= range;
        for (let k = 0; k < 4; k++) {
          allRich += richCpu[o + k]; allFull += suitCpu[o + k];
          if (near) { inRich[k] += richCpu[o + k]; inFull[k] += suitCpu[o + k]; }
        }
      }
    }
    // avail is the share of full richness still standing, weighted by how
    // much of the range is that kind at all
    const avail = {};
    const order = ['ore', 'timber', 'fish', 'ice'];
    let inArea = 0;
    for (let k = 0; k < 4; k++) inArea += inFull[k];
    for (let k = 0; k < 4; k++) {
      const share = inArea > 0 ? inFull[k] / inArea : 0;      // how much of the reach is this kind
      const standing = inFull[k] > 0 ? inRich[k] / inFull[k] : 0;
      avail[order[k]] = Math.min(1, share * 2.2) * standing;
    }
    return { avail, remaining: allFull > 0 ? allRich / allFull : 1 };
  };

  return Object.assign(world, { F, groundAt, generate, landPoint, step, summary, heightCpu });
}
