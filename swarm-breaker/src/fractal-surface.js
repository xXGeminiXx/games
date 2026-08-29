// ===========================================================================
// FRACTAL SURFACE - the picture itself, painted through the blocks
//
// src/fractal.js decides which cells are blocks. This draws what the blocks
// are made of, and it is not a colour per cell: every row of the field is
// rendered as a STRIP of the escape-time picture at the size its cells have on
// screen, and a block is a window onto that strip. A sixty-five pixel cell at
// the start of a run therefore shows sixty-five pixels of spiral, and the
// blocks read as pieces of one picture rather than as squares in a grid.
//
// Two hooks, both called by the block layer in src/visual.js:
//
//   ghost   the whole picture, dim, drawn under the field - every row that has
//           been dealt and is still on screen, blocks or not. The sky between
//           the arms is where the swarm goes, and it should look like sky,
//           not like a hole in the picture.
//
//   paint   the living blocks' fills: the same strips, bright, clipped to the
//           cells that still stand. A block wearing down darkens; a block gone
//           leaves the dim ghost behind it, so a cleared field is the picture
//           faded, not the picture deleted.
//
// A strip is rendered once, the first time it is needed, at the cell size the
// row was dealt at. The view only ever pulls back, so a strip is only ever
// drawn smaller than it was rendered, never blurred by being enlarged.
// ===========================================================================

import { CONFIG } from '../config.js';

function parseHex(css) {
  const s = String(css || '').trim().replace('#', '');
  const v = s.length === 3
    ? [s[0] + s[0], s[1] + s[1], s[2] + s[2]].map(h => parseInt(h, 16))
    : [s.slice(0, 2), s.slice(2, 4), s.slice(4, 6)].map(h => parseInt(h, 16));
  return v.map(n => (Number.isFinite(n) ? n : 0));
}

/** A cyclic colour ramp as a lookup table. `stops` are [t, hex] pairs. */
export function buildRamp(stops, size) {
  const n = Math.max(16, size | 0 || 512);
  const lut = new Uint8ClampedArray(n * 3);
  const pts = (Array.isArray(stops) && stops.length ? stops : [[0, '#000000'], [1, '#ffffff']])
    .map(([t, hex]) => ({ t: Math.min(1, Math.max(0, Number(t) || 0)), c: parseHex(hex) }))
    .sort((a, b) => a.t - b.t);
  if (pts[0].t > 0) pts.unshift({ t: 0, c: pts[pts.length - 1].c });
  if (pts[pts.length - 1].t < 1) pts.push({ t: 1, c: pts[0].c });
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    while (k < pts.length - 2 && t > pts[k + 1].t) k++;
    const a = pts[k], b = pts[k + 1];
    const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    lut[i * 3] = a.c[0] + (b.c[0] - a.c[0]) * f;
    lut[i * 3 + 1] = a.c[1] + (b.c[1] - a.c[1]) * f;
    lut[i * 3 + 2] = a.c[2] + (b.c[2] - a.c[2]) * f;
  }
  return lut;
}

/**
 * @param {object} source   the field source from src/fractal.js
 * @param {object} [opts]
 * @param {Document} [opts.document]  where offscreen canvases come from
 */
export function createFractalSurface(source, opts) {
  const o = opts || {};
  const cfg = Object.assign({}, CONFIG.fractal || {}, source && source.config || {});
  const doc = o.document || (typeof document !== 'undefined' ? document : null);

  const boardW = CONFIG.board.width;
  const ramp = buildRamp(cfg.ramp, 512);
  const RAMP_N = ramp.length / 3;
  const inner = parseHex(cfg.inside || '#05060f');
  const cycle = Math.max(2, Number(cfg.cycle) || 24);
  const ghostAlpha = Math.min(1, Math.max(0, Number(cfg.ghost) || 0.24));
  const wearAlpha = Math.min(1, Math.max(0, Number(cfg.wear) || 0.6));
  const void_ = parseHex(CONFIG.palette.void);

  const strips = new Map();     // R -> { cv, px, width, lo } or null for a gap row
  let canDraw = null;           // whether this document can make an image at all

  /** An offscreen surface, or null where the document cannot provide one. */
  function makeCanvas(w, h) {
    try {
      if (!doc || typeof doc.createElement !== 'function') return null;
      const cv = doc.createElement('canvas');
      if (!cv) return null;
      cv.width = w; cv.height = h;
      const ctx = cv.getContext && cv.getContext('2d');
      if (!ctx || typeof ctx.createImageData !== 'function' || typeof ctx.putImageData !== 'function') return null;
      const img = ctx.createImageData(w, h);
      if (!img || !img.data || img.data.length < w * h * 4) return null;
      return { cv, ctx, img };
    } catch (e) { return null; }
  }

  /** Render row R's strip. Null for a row with no picture (a gap) or where
   *  nothing can be drawn. */
  function render(R) {
    const info = source.rowInfo(R);
    if (!info || !info.panel) return null;
    const p = info.panel;
    const px = Math.max(1, Math.ceil(boardW / info.width));
    const w = info.width * px, h = px;
    const made = makeCanvas(w, h);
    if (!made) { canDraw = false; return null; }
    canDraw = true;
    const data = made.img.data;
    // The picture column this strip starts at, in panel cells.
    const c0 = info.lo - source.panelLo;
    const v0 = p.top + info.j * p.dx;
    // The ramp starts at the sky and is never shifted: the sky of every panel
    // is the same dark, so a new panel arriving reads as more picture and not
    // as a lighter sheet laid over the top of the field. Variety between
    // panels comes from the sets themselves and a slightly different band
    // spacing.
    const cyc = cycle * (0.85 + 0.3 * (((p.index * 7919) % 13) / 12));
    const inv = 1 / px;
    for (let k = 0; k < h; k++) {
      const v = v0 + (k + 0.5) * inv * p.dx;
      let idx = k * w * 4;
      for (let i = 0; i < w; i++, idx += 4) {
        const u = p.u0 + (c0 + (i + 0.5) * inv) * p.dx;
        const mu = p.iter(u, v);
        if (mu === Infinity) {
          data[idx] = inner[0]; data[idx + 1] = inner[1]; data[idx + 2] = inner[2];
        } else {
          let t = mu / cyc;
          t -= Math.floor(t);
          const q = (t * (RAMP_N - 1)) | 0;
          data[idx] = ramp[q * 3]; data[idx + 1] = ramp[q * 3 + 1]; data[idx + 2] = ramp[q * 3 + 2];
        }
        data[idx + 3] = 255;
      }
    }
    made.ctx.putImageData(made.img, 0, 0);
    return { cv: made.cv, px, width: info.width, lo: info.lo };
  }

  function stripOf(R) {
    if (strips.has(R)) return strips.get(R);
    const s = render(R);
    // A row with no picture is remembered as such; a document that cannot
    // draw is not, so nothing accumulates where nothing can be shown.
    if (s || canDraw !== false) strips.set(R, s);
    return s;
  }

  /** Forget strips that can no longer be on screen. */
  function prune(keepFrom) {
    if (strips.size < 96) return;
    for (const R of strips.keys()) if (R < keepFrom) strips.delete(R);
  }

  /**
   * Where each dealt row sits this frame, in screen rows. Anchored on a
   * living block when there is one - blocks ease during a descent and the
   * picture has to move with them - and on the step count otherwise.
   */
  function placeRows(frame) {
    const cell = frame.cell;
    const dealt = source.dealt;
    const stepsNow = source.steps;
    // A row's screen row is the steps taken since it was dealt. Rows dealt in
    // the same step - a field re-asked while the board was empty - share one,
    // which is exactly where their blocks are.
    const rowOf = (info) => stepsNow - info.r0;
    // The anchor: a living block with a known row. Its cell top is the truth
    // this frame - blocks ease during a descent and are lifted by effects -
    // and every other row is a whole number of cells from it.
    let anchorY = 0, anchorRow = 0, anchored = false;
    for (let i = 0; i < frame.n; i++) {
      const b = frame.blocks[i];
      if (!b || b.R === undefined) continue;
      const info = source.rowInfo(b.R);
      if (!info) continue;
      anchorY = frame.cellY[i]; anchorRow = rowOf(info); anchored = true;
      break;
    }
    const rows = [];
    const lowest = frame.floor + cell;
    for (let R = dealt - 1; R >= 0; R--) {
      const info = source.rowInfo(R);
      if (!info) continue;
      const rr = rowOf(info);
      const y = anchored ? anchorY + (rr - anchorRow) * cell : frame.top + rr * cell + frame.off;
      if (y > lowest) break;
      if (y + cell < frame.top - cell) continue;
      rows.push({ R, y, info });
    }
    // Oldest first, so where two rows share a screen row the one dealt last
    // is the one that shows - it is the one whose blocks are there.
    rows.reverse();
    prune(dealt - 160);
    return rows;
  }

  function drawStrip(ctx, strip, x, y, cell) {
    ctx.drawImage(strip.cv, 0, 0, strip.cv.width, strip.cv.height, x, y, strip.width * cell, cell);
  }

  return {
    /** Cells narrower than this carry no health number; the picture is the
     *  information at that size. */
    minNumeral: Math.max(8, Number(cfg.numeralMin) || 22),
    /** Numerals get a dark plate: the picture underneath can be any colour. */
    backing: true,
    /** No column grid, no seams below this cell size: a mesh over a picture. */
    seamMin: Math.max(0, Number(cfg.seamMin) || 26),
    frameMin: Math.max(0, Number(cfg.frameMin) || 20),
    /** How much of the aerial haze the picture takes. Distance still costs
     *  contrast, but a picture washed to nothing at the top is not a picture. */
    haze: Math.min(1, Math.max(0, Number(cfg.haze))),

    ghost(ctx, frame) {
      if (!ctx || canDraw === false) return;
      const rows = placeRows(frame);
      if (!rows.length) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, frame.top, frame.width, frame.floor - frame.top);
      ctx.clip();
      ctx.globalAlpha = ghostAlpha;
      for (const row of rows) {
        const strip = stripOf(row.R);
        if (!strip) continue;
        drawStrip(ctx, strip, frame.origin + strip.lo * frame.cell, row.y, frame.cell);
      }
      ctx.restore();
    },

    paint(ctx, frame) {
      if (!ctx || canDraw === false) return;
      const cell = frame.cell;
      // Group the living blocks by the row they came from.
      const byRow = new Map();
      for (let i = 0; i < frame.n; i++) {
        const b = frame.blocks[i];
        if (!b || b.R === undefined) continue;
        let g = byRow.get(b.R);
        if (!g) { g = []; byRow.set(b.R, g); }
        g.push(i);
      }
      for (const [R, idx] of byRow) {
        const strip = stripOf(R);
        if (!strip) continue;
        // One clip per row, one image per row. Every block in a row was born
        // together, so the row's fade-in is the first block's.
        ctx.save();
        ctx.beginPath();
        let y = frame.cellY[idx[0]];
        for (const i of idx) {
          ctx.rect(frame.cellX[i], frame.cellY[i], cell, cell);
          if (frame.cellY[i] < y) y = frame.cellY[i];
        }
        ctx.clip();
        ctx.globalAlpha = Math.min(1, frame.alpha[idx[0]]);
        drawStrip(ctx, strip, frame.origin + strip.lo * cell, y, cell);
        ctx.restore();
        // Wear darkens the cell toward the void. Done after the clip is gone,
        // one rectangle per damaged block only.
        for (const i of idx) {
          const worn = 1 - frame.integ[i];
          if (worn < 0.04) continue;
          ctx.fillStyle = 'rgba(' + void_[0] + ',' + void_[1] + ',' + void_[2] + ',' + (worn * wearAlpha).toFixed(3) + ')';
          ctx.fillRect(frame.cellX[i], frame.cellY[i], cell, cell);
        }
      }
    },

    /** Blocks the given row has, for tools. */
    stripOf,
    render,
    ramp,
    get strips() { return strips.size; },
  };
}

export default createFractalSurface;
