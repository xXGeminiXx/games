// ---------------------------------------------------------------------------
// The per-frame painter.
//
// One canvas, one pass, back to front. Per depth row: the ground, the
// predicted path, the works standing in that row, then the motes in it. The
// shells in flight, the effects, the cursor and the ghosts come after the last
// row, because they belong on top of the whole field.
//
// The frame budget goes almost entirely on motes, so they never allocate and
// never touch the canvas state one at a time. Every mote is bucketed once, by
// depth row then by colour, into arrays allocated once; a row then draws each
// colour as one path with one fill.
// ---------------------------------------------------------------------------

import {
  drawWork, addMoteMark, addMoteTail, drawEmber, addRadialTicks, addHexRing,
} from './glyphs.js?v=12';
import { dominantTrait, TRAIT, TRAIT_IDS } from '../traits.js?v=12';

const SQRT2 = Math.SQRT2;

/** The sheet's own hand for the notes it letters on the field. */
const FIELD_LABEL_FONT = '"Segoe UI", system-ui, -apple-system, Helvetica, Arial, sans-serif';

const clock = (typeof performance !== 'undefined' && performance && performance.now)
  ? () => performance.now()
  : () => 0;

export function createScene(cfg, canvas, iso, ground) {

  const ctx = canvas.getContext('2d');

  // Colours in one flat table: plain first, then one per trait, burning last.
  const NC = TRAIT_IDS.length + 2;
  const BURN = NC - 1;
  const MASK = (1 << TRAIT_IDS.length) - 1;
  const moteHex = new Array(NC);
  moteHex[0] = cfg.render.moteColors.base;
  moteHex[BURN] = cfg.render.moteColors.burning;
  for (let k = 0; k < TRAIT_IDS.length; k++) {
    moteHex[k + 1] = cfg.render.moteColors[TRAIT_IDS[k]] || moteHex[0];
  }

  // A trait mask is eleven bits, so every possible answer fits in one table.
  const maskColor = new Int16Array(MASK + 1).fill(-1);
  function colourOf(mask) {
    let c = maskColor[mask];
    if (c < 0) {
      const id = dominantTrait(mask);
      c = id ? TRAIT_IDS.indexOf(id) + 1 : 0;
      maskColor[mask] = c;
    }
    return c;
  }

  const glyphOf = {};
  for (const k of cfg.works.kinds) glyphOf[k.id] = k.glyph;

  const FX_LIFE = {
    bolt: 0.06, flare: 0.25, rime: 0.4,
    splash: cfg.render.fx.splashSeconds,
    arc: cfg.render.fx.arcFrames / 60,
    kill: cfg.render.fx.killSeconds,
  };

  let dpr = 1, boxW = 0, boxH = 0, rows = 0;

  // The paper's grain: one small tile of noise, laid over the finished frame
  // as a pattern so the relief and the sheet around it read as one printed
  // surface. Made once; the stub context in tests has no patterns, so the
  // pass simply does nothing there.
  let grain = null;
  let grainTried = false;
  function grainPattern() {
    if (grainTried) return grain;
    grainTried = true;
    const g = cfg.render.grain;
    if (!g || !(g.alpha > 0) || typeof ctx.createPattern !== 'function' ||
        typeof ctx.createImageData !== 'function' || typeof document === 'undefined') return null;
    try {
      const size = 128;
      const tile = document.createElement('canvas');
      tile.width = size; tile.height = size;
      const tc = tile.getContext('2d');
      const img = tc.createImageData(size, size);
      const d = img.data;
      // A fixed sequence, so the sheet is the same sheet on every visit.
      let seed = 0x9e3779b9;
      const amount = g.amount > 0 ? g.amount : 32;
      for (let k = 0; k < d.length; k += 4) {
        seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x1b56c4e9) >>> 0;
        const v = 128 + (((seed >>> 8) & 255) / 255 - 0.5) * 2 * amount;
        d[k] = v; d[k + 1] = v; d[k + 2] = v; d[k + 3] = 255;
      }
      tc.putImageData(img, 0, 0);
      grain = ctx.createPattern(tile, 'repeat');
    } catch (e) { grain = null; }
    return grain;
  }

  function drawGrain() {
    const pat = grainPattern();
    if (!pat) return;
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = cfg.render.grain.alpha;
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, boxW, boxH);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** How far the road's dashes have run downhill: they move unless motion is off. */
  function dashOffset(state) {
    if (state.reducedMotion) return 0;
    const speed = cfg.render.flowSpeed > 0 ? cfg.render.flowSpeed : 0;
    return -((state.time || 0) * speed) % 7;
  }
  let keys = new Int32Array(0), order = new Int32Array(0);
  let msx = new Float32Array(0), msy = new Float32Array(0), mwing = new Uint8Array(0);
  let counts = new Int32Array(0), rowStart = new Int32Array(1);
  let workOrder = new Int32Array(0), workStart = new Int32Array(1), workCount = new Int32Array(0);
  let fallOrder = new Int32Array(0), fallStart = new Int32Array(1), fallCount = new Int32Array(0);

  function ensureRows(r) {
    if (r === rows) return;
    rows = r;
    counts = new Int32Array(r * NC);
    rowStart = new Int32Array(r + 1);
    workStart = new Int32Array(r + 1);
    workCount = new Int32Array(r);
    fallStart = new Int32Array(r + 1);
    fallCount = new Int32Array(r);
  }

  function ensureMotes(cap) {
    if (keys.length >= cap) return;
    keys = new Int32Array(cap);
    order = new Int32Array(cap);
    msx = new Float32Array(cap);
    msy = new Float32Array(cap);
    mwing = new Uint8Array(cap);
  }

  /** The height of the flat facet a world point stands on. */
  function heightAt(terrain, x, y) {
    let cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0) cx = 0; else if (cx >= terrain.W) cx = terrain.W - 1;
    if (cy < 0) cy = 0; else if (cy >= terrain.H) cy = terrain.H - 1;
    return terrain.h[cy * terrain.W + cx];
  }

  /** Project a world point and hand back nothing: read iso.sx, iso.sy. */
  function put(terrain, x, y) {
    iso.project(x, y, heightAt(terrain, x, y));
  }

  // -- bucketing ------------------------------------------------------------

  function bucketMotes(pool, terrain) {
    const cap = pool.cap | 0;
    ensureMotes(cap);
    counts.fill(0);
    const alive = pool.alive, xs = pool.x, ys = pool.y;
    const tr = pool.traits, burnT = pool.burnT;
    const W = terrain.W, H = terrain.H, hs = terrain.h;
    const wingBit = TRAIT.wings;

    for (let i = 0; i < cap; i++) {
      if (!alive[i]) { keys[i] = -1; continue; }
      const x = xs[i], y = ys[i];
      let cx = Math.floor(x), cy = Math.floor(y);
      if (cx < 0) cx = 0; else if (cx >= W) cx = W - 1;
      if (cy < 0) cy = 0; else if (cy >= H) cy = H - 1;
      iso.project(x, y, hs[cy * W + cx]);
      msx[i] = iso.sx;
      msy[i] = iso.sy;
      const mask = tr ? (tr[i] & MASK) : 0;
      mwing[i] = (mask & wingBit) ? 1 : 0;
      const k = (cx + cy) * NC + ((burnT && burnT[i] > 0) ? BURN : colourOf(mask));
      keys[i] = k;
      counts[k]++;
    }

    let run = 0;
    for (let d = 0; d < rows; d++) {
      rowStart[d] = run;
      for (let c = 0; c < NC; c++) {
        const at = d * NC + c, q = counts[at];
        counts[at] = run;
        run += q;
      }
    }
    rowStart[rows] = run;
    for (let i = 0; i < cap; i++) {
      const k = keys[i];
      if (k >= 0) order[counts[k]++] = i;
    }
  }

  /** Counting sort of n things into depth rows. */
  function bucketBy(n, rowOf, count, start, out) {
    count.fill(0);
    for (let j = 0; j < n; j++) {
      const d = rowOf(j);
      if (d >= 0 && d < rows) count[d]++;
    }
    let run = 0;
    for (let d = 0; d < rows; d++) { start[d] = run; run += count[d]; count[d] = start[d]; }
    start[rows] = run;
    for (let j = 0; j < n; j++) {
      const d = rowOf(j);
      if (d >= 0 && d < rows) out[count[d]++] = j;
    }
  }

  // -- the layers -----------------------------------------------------------

  function drawFallRow(terrain, line, d, offset) {
    const s = fallStart[d], e = fallStart[d + 1];
    if (s === e) return;
    const W = terrain.W, hs = terrain.h;
    ctx.beginPath();
    for (let k = s; k < e; k++) {
      const j = fallOrder[k];
      const a = line[j], b = line[j + 1];
      iso.project((a % W) + 0.5, Math.floor(a / W) + 0.5, hs[a]);
      const ax = iso.sx, ay = iso.sy;
      iso.project((b % W) + 0.5, Math.floor(b / W) + 0.5, hs[b]);
      ctx.moveTo(ax, ay);
      ctx.lineTo(iso.sx, iso.sy);
    }
    // The casing is drawn solid and unbroken so the road still reads while the
    // dashes over it are in their gaps.
    ctx.setLineDash([]);
    ctx.lineWidth = cfg.render.fallLineCasingWidth;
    ctx.globalAlpha = cfg.render.fallLineCasingAlpha;
    ctx.strokeStyle = cfg.render.fallLineCasing;
    ctx.stroke();
    ctx.setLineDash([4, 3]);
    ctx.lineDashOffset = offset || 0;
    ctx.lineWidth = cfg.render.fallLineWidth;
    ctx.globalAlpha = cfg.render.fallLineAlpha;
    ctx.strokeStyle = cfg.render.fallLine;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  /**
   * The other roads off the snowline, drawn thinner and fainter in one pass
   * over the finished ground. They branch from the main road, so the player
   * sees every way the Melt may come, not only the cheapest one.
   */
  function drawBranches(terrain, lines, offset) {
    if (!lines || !lines.length) return;
    const W = terrain.W, hs = terrain.h;
    ctx.beginPath();
    for (const line of lines) {
      for (let j = 0; j + 1 < line.length; j++) {
        const a = line[j], b = line[j + 1];
        iso.project((a % W) + 0.5, Math.floor(a / W) + 0.5, hs[a]);
        const ax = iso.sx, ay = iso.sy;
        iso.project((b % W) + 0.5, Math.floor(b / W) + 0.5, hs[b]);
        ctx.moveTo(ax, ay);
        ctx.lineTo(iso.sx, iso.sy);
      }
    }
    ctx.setLineDash([]);
    ctx.lineWidth = cfg.render.fallLineCasingWidth * 0.62;
    ctx.globalAlpha = cfg.render.fallLineCasingAlpha * 0.7;
    ctx.strokeStyle = cfg.render.fallLineCasing;
    ctx.stroke();
    ctx.setLineDash([3, 4]);
    ctx.lineDashOffset = offset || 0;
    ctx.lineWidth = cfg.render.fallLineWidth * 0.7;
    ctx.globalAlpha = cfg.render.fallLineAlpha * 0.72;
    ctx.strokeStyle = cfg.render.fallLine;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  /**
   * The two ends of the field, lettered on the sheet. Where the Melt comes
   * from and what it is walking at are the two facts the picture cannot say on
   * its own, and a player who has to be told them in a panel has to look away
   * from the field to learn them. Drawn last, over everything, with a paper
   * halo so the letters hold over any band of ground.
   */
  function drawFieldLabels(terrain) {
    const W = terrain.W;
    const r = cfg.render;
    const marks = [];
    // The snowline sits at the top corner of the diamond, where the line above
    // the field already runs, so its name is lettered on the snow itself
    // rather than in the air over it. The hearth has clear paper above it.
    if (terrain.snowline && terrain.snowline.length) {
      marks.push({ cells: terrain.snowline, text: cfg.text.snowline, lift: -iso.th * 1.4 });
    }
    if (terrain.hearth && terrain.hearth.length) {
      marks.push({ cells: terrain.hearth, text: cfg.text.hearth, lift: iso.th * 1.5 });
    }
    if (!marks.length) return;
    ctx.save();
    ctx.font = '600 ' + r.labelSize + 'px ' + FIELD_LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    for (const mark of marks) {
      let ax = 0, ay = 0, top = 0, hi = 0;
      for (let k = 0; k < mark.cells.length; k++) {
        const i = mark.cells[k];
        const cx = i % W, cy = Math.floor(i / W);
        ax += cx + 0.5; ay += cy + 0.5;
        if (terrain.h[i] > hi) hi = terrain.h[i];
      }
      ax /= mark.cells.length; ay /= mark.cells.length;
      iso.project(ax, ay, hi);
      // Whole pixels: the sheet has no blur anywhere and a letter set on a
      // fractional baseline is the one soft thing on it.
      const lx = Math.round(iso.sx);
      top = Math.round(iso.sy - mark.lift);
      const label = String(mark.text).toUpperCase();
      ctx.strokeStyle = r.labelHalo;
      ctx.strokeText(label, lx, top);
      ctx.fillStyle = r.label;
      ctx.fillText(label, lx, top);
    }
    ctx.restore();
  }

  function drawWorksRow(terrain, works, d, time) {
    const s = workStart[d], e = workStart[d + 1];
    const size = iso.tw * 0.42;
    for (let k = s; k < e; k++) {
      const w = works.list[workOrder[k]];
      const glyph = glyphOf[w.kind] || 'square';
      put(terrain, w.x, w.y);
      drawWork(ctx, iso, cfg, glyph, iso.sx, iso.sy, size,
        glyph === 'ring' ? time * 0.7 : (w.angle || 0), w.tier);
    }
  }

  /** One run of same-coloured motes, as one path and one canvas call. */
  function flushMotes(c, tails) {
    if (tails) { ctx.strokeStyle = moteHex[c]; ctx.stroke(); }
    else { ctx.fillStyle = moteHex[c]; ctx.fill(); }
  }

  function moteRun(pool, s, e, base, tails) {
    const tw = iso.tw, vx = pool.vx, vy = pool.vy, size = pool.size;
    let cur = -1;
    for (let k = s; k < e; k++) {
      const i = order[k];
      const c = keys[i] - base;
      if (c !== cur) {
        if (cur >= 0) flushMotes(cur, tails);
        ctx.beginPath();
        cur = c;
      }
      const ux = vx ? vx[i] : 0, uy = vy ? vy[i] : 0;
      if (tails) addMoteTail(ctx, msx[i], msy[i], ux, uy, tw);
      else addMoteMark(ctx, msx[i], msy[i], size ? size[i] : 1,
        mwing[i] ? 'wings' : null, ux, uy, tw);
    }
    if (cur >= 0) flushMotes(cur, tails);
  }

  function drawMotesRow(pool, d) {
    const s = rowStart[d], e = rowStart[d + 1];
    if (s === e) return;
    const base = d * NC;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;      // tails first, so the marks sit on top
    moteRun(pool, s, e, base, true);
    ctx.globalAlpha = 1;
    moteRun(pool, s, e, base, false);
  }

  function drawProjectiles(terrain, list) {
    if (!list || !list.length) return;
    ctx.fillStyle = cfg.render.fx.shell;
    const rise = iso.tw * 0.8;
    for (let j = 0; j < list.length; j++) {
      const p = list[j];
      let u = p.t / (p.flight > 0 ? p.flight : 1);
      if (!(u >= 0)) u = 0; else if (u > 1) u = 1;
      const x = p.x0 + (p.x1 - p.x0) * u;
      const y = p.y0 + (p.y1 - p.y0) * u;
      put(terrain, x, y);
      const sy = iso.sy - rise * 4 * u * (1 - u);
      ctx.fillRect(Math.round(iso.sx) - 1, Math.round(sy) - 1, 3, 3);
    }
  }

  function strokeFx(colour, alpha) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = colour;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawFx(terrain, list, dt) {
    if (!list || !list.length) return;
    const fxc = cfg.render.fx;
    for (let k = list.length - 1; k >= 0; k--) {
      const e = list[k];
      e.t = (e.t || 0) + dt;
      const life = FX_LIFE[e.kind] || 0.2;
      if (e.t >= life) { list.splice(k, 1); continue; }
      const u = e.t / life;
      const r = e.r || 1;
      ctx.lineWidth = 1;

      if (e.kind === 'bolt') {
        put(terrain, e.x0, e.y0);
        const ax = iso.sx, ay = iso.sy;
        put(terrain, e.x1, e.y1);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(iso.sx, iso.sy);
        strokeFx(fxc.bolt, 1);

      } else if (e.kind === 'splash') {
        iso.ellipsePath(ctx, e.x, e.y, heightAt(terrain, e.x, e.y), r * u);
        strokeFx(fxc.splash, 1 - u);

      } else if (e.kind === 'flare' || e.kind === 'rime') {
        put(terrain, e.x, e.y);
        const rx = r * iso.tw / SQRT2, ry = r * iso.th / SQRT2;
        ctx.beginPath();
        if (e.kind === 'flare') {
          addRadialTicks(ctx, iso.sx, iso.sy, rx, ry, 8, 0, 1, 1.3);
          strokeFx(fxc.flare, 1 - u);
        } else {
          addHexRing(ctx, iso.sx, iso.sy, rx, ry);
          strokeFx(fxc.rime, 1 - u * 0.6);
        }

      } else if (e.kind === 'kill') {
        put(terrain, e.x, e.y);
        // A big mote dying throws its pieces further than a small one.
        const reach = iso.tw * 0.3 * (e.size > 0 ? Math.min(1.6, 0.6 + e.size * 0.4) : 1);
        ctx.beginPath();
        addRadialTicks(ctx, iso.sx, iso.sy, reach, reach * 0.5, 4,
          Math.PI / 4, u, u + 0.4);
        strokeFx(fxc.kill, 1 - u);

      } else if (e.kind === 'arc' && e.points) {
        // The chain accepts flat pairs, [x, y] pairs, or {x, y}.
        const pts = e.points;
        const flat = typeof pts[0] === 'number';
        const n = flat ? pts.length >> 1 : pts.length;
        if (n < 2) continue;
        ctx.beginPath();
        for (let j = 0; j < n; j++) {
          const p = pts[j];
          const px = flat ? pts[j * 2] : (Array.isArray(p) ? p[0] : p.x);
          const py = flat ? pts[j * 2 + 1] : (Array.isArray(p) ? p[1] : p.y);
          put(terrain, px, py);
          if (j === 0) ctx.moveTo(iso.sx, iso.sy); else ctx.lineTo(iso.sx, iso.sy);
        }
        strokeFx(fxc.arc, 1);
        strokeFx('#ffffff', 0.5);
      }
    }
  }

  function drawCursors(state) {
    const terrain = state.terrain;
    const hover = state.hover;
    const W = terrain.W;
    if (hover && hover.cell >= 0 && hover.cell < W * terrain.H) {
      const tool = hover.tool;
      const tint = hover.ok ? cfg.render.okGhost : cfg.render.badGhost;
      const wx = (hover.cell % W) + 0.5;
      const wy = Math.floor(hover.cell / W) + 0.5;
      const h = terrain.h[hover.cell];
      // A sculpt shows the cell where it would end up, over the outline of
      // where it is now, so the move itself is what the cursor says.
      if (tool === 'raise' || tool === 'cut') {
        const to = h + (tool === 'raise' ? 1 : -1);
        ground.drawCellTop(ctx, terrain, hover.cell, tint, 0.5, to < 0 ? 0 : to);
      }
      ground.cellTopPath(ctx, terrain, hover.cell);
      ctx.lineWidth = 1;
      ctx.strokeStyle = cfg.render.cursor;
      ctx.stroke();
      if (tool === 'build' && hover.kind) {
        if (hover.range > 0) {
          iso.ellipsePath(ctx, wx, wy, h, hover.range);
          strokeFx(tint, 0.85);
        }
        iso.project(wx, wy, h);
        drawWork(ctx, iso, cfg, glyphOf[hover.kind] || 'square',
          iso.sx, iso.sy, iso.tw * 0.42, 0, 1, tint);
      }
    }

    const sel = state.selected;
    if (sel && sel.range > 0) {
      const wx = sel.x === undefined ? (sel.cell % W) + 0.5 : sel.x;
      const wy = sel.y === undefined ? Math.floor(sel.cell / W) + 0.5 : sel.y;
      iso.ellipsePath(ctx, wx, wy, heightAt(terrain, wx, wy), sel.range);
      strokeFx(cfg.render.range, 0.8);
    }
  }

  // -- the scene ------------------------------------------------------------

  const scene = {
    lastDrawMs: 0,
    avgDrawMs: 0,

    /** Size the canvas to its box and refit the field inside it. */
    resize(bw, bh, ratio, W, H, maxHeight) {
      boxW = Math.max(1, Math.round(bw));
      boxH = Math.max(1, Math.round(bh));
      dpr = ratio > 0 ? ratio : 1;
      canvas.width = Math.round(boxW * dpr);
      canvas.height = Math.round(boxH * dpr);
      if (canvas.style) {
        canvas.style.width = boxW + 'px';
        canvas.style.height = boxH + 'px';
      }
      iso.fit(boxW, boxH, W, H, maxHeight);
      ensureRows(W + H - 1);
      return this;
    },

    /** One frame. */
    draw(state, dt) {
      const t0 = clock();
      const terrain = state.terrain;
      if (!terrain) return 0;
      const step = dt > 0 ? dt : 0;
      const time = state.time || 0;
      const works = state.works;
      const pool = state.pool;
      const line = state.fallLine;
      const W = terrain.W;
      ensureRows(W + terrain.H - 1);
      ground.ensure(terrain);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = cfg.palette.void;
      ctx.fillRect(0, 0, boxW, boxH);
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);

      const haveMotes = !!(pool && pool.cap && pool.alive);
      if (haveMotes) bucketMotes(pool, terrain);

      const list = works && works.list;
      const haveWorks = !!(list && list.length);
      if (haveWorks) {
        if (workOrder.length < list.length) workOrder = new Int32Array(list.length);
        bucketBy(list.length, (j) => Math.floor(list[j].x) + Math.floor(list[j].y),
          workCount, workStart, workOrder);
      }

      const haveLine = !!(line && line.length > 1);
      if (haveLine) {
        if (fallOrder.length < line.length) fallOrder = new Int32Array(line.length);
        bucketBy(line.length - 1, (j) => (line[j] % W) + Math.floor(line[j] / W),
          fallCount, fallStart, fallOrder);
      }

      // The hearth burns on the middle of its block, once its row is down.
      let emberRow = -1, emberX = 0, emberY = 0;
      const hearth = terrain.hearth;
      if (hearth && hearth.length) {
        let ax = 0, ay = 0;
        for (let k = 0; k < hearth.length; k++) {
          const cx = hearth[k] % W, cy = Math.floor(hearth[k] / W);
          ax += cx + 0.5; ay += cy + 0.5;
          if (cx + cy > emberRow) emberRow = cx + cy;
        }
        emberX = ax / hearth.length;
        emberY = ay / hearth.length;
      }

      const offset = dashOffset(state);
      for (let d = 0; d < rows; d++) {
        ground.drawRow(ctx, terrain, d);
        if (haveLine) drawFallRow(terrain, line, d, offset);
        if (haveWorks) drawWorksRow(terrain, works, d, time);
        if (haveMotes) drawMotesRow(pool, d);
        if (d === emberRow) {
          put(terrain, emberX, emberY);
          drawEmber(ctx, cfg, iso.sx, iso.sy, iso.tw, time);
        }
      }

      drawBranches(terrain, state.fallLines, offset);
      if (works) drawProjectiles(terrain, works.projectiles);
      drawFx(terrain, state.fx, step);
      drawCursors(state);
      drawFieldLabels(terrain);
      drawGrain();

      const ms = clock() - t0;
      this.lastDrawMs = ms;
      this.avgDrawMs = this.avgDrawMs === 0 ? ms : this.avgDrawMs * 0.9 + ms * 0.1;
      return ms;
    },
  };

  return scene;
}
