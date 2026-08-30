// ===========================================================================
// FRACTAL SURFACE - the picture itself, and the pieces standing on it
//
// src/fractal.js decides what the pieces are. This draws them, and it draws
// nothing square. Every dealt row of the field is a STRIP of the escape-time
// picture rendered at the size its cells had when it was dealt, and two
// things are painted from it:
//
//   the GHOST  the whole picture, dim, under everything - every dealt row
//              still on screen, pieces or not. The sky between the arms is
//              where the swarm goes, and it should look like sky, not like a
//              hole in the picture. A piece that is gone leaves the ghost.
//
//   the LIVING the pixels of every piece still standing, bright, with the
//              piece's own outline traced round it in the dark of the void -
//              or in a kind's colour when the piece is something other than a
//              number, or in the hot colour when it is about to reach the
//              line. A piece wearing down darkens toward the void.
//
// A piece's health number, where there is room for one, sits on the piece
// with no plate under it: ink with a dark rim, at the pixel furthest from the
// piece's edge. Below a size there is no number, because the picture is the
// information at that size.
//
// The living layer of a strip is rebuilt only when something on it changed -
// a piece struck, a piece gone, a piece nearing the line - so a frame is a
// handful of image draws, not a walk over every pixel.
// ===========================================================================

import { CONFIG } from '../config.js?v=18';
import { formatTight } from './visual.js?v=18';

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

const FONT = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

/**
 * @param {object} source   the field source from src/fractal.js
 * @param {object} [opts]
 * @param {Document} [opts.document]  where offscreen canvases come from
 */
export function createFractalSurface(source, opts) {
  const o = opts || {};
  const cfg = Object.assign({}, CONFIG.fractal || {}, source && source.config || {});
  const doc = o.document || (typeof document !== 'undefined' ? document : null);
  const pal = CONFIG.palette || {};

  const ramp = buildRamp(cfg.ramp, 512);
  const RAMP_N = ramp.length / 3;
  const inner = parseHex(cfg.inside || '#05060f');
  const cycle = Math.max(2, Number(cfg.cycle) || 24);
  const phase = Number.isFinite(Number(cfg.phase)) ? Number(cfg.phase) : 0.14;
  const ghostAlpha = Math.min(1, Math.max(0, Number(cfg.ghost) || 0.24));
  const wearAlpha = Math.min(1, Math.max(0, Number(cfg.wear) || 0.6));
  const outlineA = Math.min(1, Math.max(0, Number.isFinite(Number(cfg.outline)) ? Number(cfg.outline) : 0.6));
  const threatRows = Math.max(0.5, Number(cfg.threatRows) || 2.5);
  const hazeShare = Math.min(1, Math.max(0, Number(cfg.haze)));
  const numeralMin = Math.max(8, Number(cfg.numeralMin) || 22);
  const void_ = parseHex(pal.void || '#05060f');
  const hot = parseHex(pal.hot || '#ff5c46');
  const inkCss = pal.ink || '#e6e9ef';
  const voidCss = pal.void || '#05060f';

  const layers = new Map();     // R -> { ghost, live, pic, keys: Map(id -> key), w, h, px, lo, width } or null
  const born = new Map();       // R -> alpha, easing in over the first quarter second
  let canDraw = null;
  let gradHaze = null, hazeH = 0, hazeKey = '';

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

  /** The picture's colour at a smooth iteration count, relative to a panel's threshold. */
  function colourAt(mu, T, cyc, out, at) {
    if (mu === Infinity) { out[at] = inner[0]; out[at + 1] = inner[1]; out[at + 2] = inner[2]; return; }
    let t = (mu - T) / cyc + phase;
    t -= Math.floor(t);
    const q = (t * (RAMP_N - 1)) | 0;
    out[at] = ramp[q * 3]; out[at + 1] = ramp[q * 3 + 1]; out[at + 2] = ramp[q * 3 + 2];
  }

  /** Build a row's layers from its strip: the picture, the ghost, the empty living layer. */
  function build(R) {
    const st = source.stripOf(R);
    if (!st) return null;
    const w = st.w, h = st.h;
    const g = makeCanvas(w, h);
    if (!g) { canDraw = false; return null; }
    canDraw = true;
    const pic = new Uint8ClampedArray(w * h * 3);
    const T = st.panel.T;
    const cyc = cycle * (0.85 + 0.3 * (((st.panel.index * 7919) % 13) / 12));
    const d = g.img.data;
    for (let i = 0, a = 0, q = 0; i < w * h; i++, a += 3, q += 4) {
      colourAt(st.mu[i], T, cyc, pic, a);
      d[q] = pic[a]; d[q + 1] = pic[a + 1]; d[q + 2] = pic[a + 2]; d[q + 3] = 255;
    }
    g.ctx.putImageData(g.img, 0, 0);
    const l = makeCanvas(w, h);
    if (!l) { canDraw = false; return null; }
    return { R, st, ghost: g.cv, live: l, pic, keys: new Map(), w, h, px: st.px, lo: st.lo, width: st.width, dirty: true };
  }

  function layerOf(R) {
    if (layers.has(R)) return layers.get(R);
    const l = build(R);
    if (l || canDraw !== false) layers.set(R, l);
    return l;
  }

  /** The state of a piece that the living layer depends on, as one string. */
  function keyOf(b, rowsTall) {
    if (!b || b.dead || !(b.hp > 0)) return 'x';
    const integ = b.max > 0 ? Math.max(0, Math.min(1, b.hp / b.max)) : 1;
    const wornQ = Math.round((1 - integ) * 8);
    const edge = b.r + 1;
    const th = Math.max(0, Math.min(1, 1 - (rowsTall - edge) / threatRows));
    const thQ = th > 0.66 ? 2 : th > 0.02 ? 1 : 0;
    return wornQ + ':' + thQ + ':' + (b.tint || '');
  }

  /**
   * Repaint the living layer of one row from its strip: the pixels of every
   * standing piece, shaded by wear, with the piece's outline traced round it.
   */
  function repaint(L, rowsTall) {
    const st = L.st, w = L.w, h = L.h, ids = st.id, pic = L.pic;
    const ctx = L.live.ctx, img = L.live.img, d = img.data;
    const up = source.stripOf(R_of(L) + 1), dn = source.stripOf(R_of(L) - 1);
    // Per piece shading, resolved once.
    const shade = new Map();
    for (const id of st.pieceIds) {
      const b = source.alive(id);
      if (!b) continue;
      const integ = b.max > 0 ? Math.max(0, Math.min(1, b.hp / b.max)) : 1;
      const worn = (1 - integ) * wearAlpha;
      const edgeRow = b.r + 1;
      const th = Math.max(0, Math.min(1, 1 - (rowsTall - edgeRow) / threatRows));
      let edge;
      if (th > 0.66) edge = hot;
      else if (b.tint) edge = parseHex(b.tint);
      else edge = void_;
      const edgeA = th > 0.66 ? 0.9 : b.tint ? 0.95 : outlineA;
      shade.set(id, { worn, edge, edgeA });
    }
    for (let k = 0; k < h; k++) {
      for (let i = 0; i < w; i++) {
        const g = k * w + i, q = g * 4;
        const id = ids[g];
        const sh = id ? shade.get(id) : undefined;
        if (!sh) { d[q + 3] = 0; continue; }
        // Edge: a neighbour that is not this piece. Across the strip's top
        // and bottom the neighbour strip is consulted where it exists.
        let edge = false;
        if (i > 0 && ids[g - 1] !== id) edge = true;
        else if (i + 1 < w && ids[g + 1] !== id) edge = true;
        else if (k > 0 && ids[g - w] !== id) edge = true;
        else if (k + 1 < h && ids[g + w] !== id) edge = true;
        else if (k === 0 && up) edge = !holds(up, st, i, id, up.h - 1);
        else if (k === h - 1 && dn) edge = !holds(dn, st, i, id, 0);
        const a = g * 3;
        let r = pic[a], gg = pic[a + 1], bb = pic[a + 2];
        if (sh.worn > 0) {
          r += (void_[0] - r) * sh.worn; gg += (void_[1] - gg) * sh.worn; bb += (void_[2] - bb) * sh.worn;
        }
        if (edge) {
          const e = sh.edge, ea = sh.edgeA;
          r += (e[0] - r) * ea; gg += (e[1] - gg) * ea; bb += (e[2] - bb) * ea;
        }
        d[q] = r; d[q + 1] = gg; d[q + 2] = bb; d[q + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    L.dirty = false;
  }

  function R_of(L) { return L.R; }

  function holds(other, st, i, id, k) {
    const xi = Math.floor((st.lo + (i + 0.5) / st.px - other.lo) * other.px);
    if (xi < 0 || xi >= other.w) return true;
    return other.id[k * other.w + xi] === id;
  }

  /** Forget layers that can no longer be on screen. */
  function prune(keepFrom) {
    if (layers.size < 96) return;
    for (const R of layers.keys()) if (R < keepFrom) { layers.delete(R); born.delete(R); }
  }

  function hazeFor(ctx, top, floor) {
    const key = top + ':' + floor;
    if (gradHaze && hazeKey === key) return gradHaze;
    hazeKey = key;
    hazeH = (floor - top) * 0.62;
    try {
      gradHaze = ctx.createLinearGradient(0, top, 0, top + hazeH);
      gradHaze.addColorStop(0, 'rgba(' + void_[0] + ',' + void_[1] + ',' + void_[2] + ',0.62)');
      gradHaze.addColorStop(1, 'rgba(' + void_[0] + ',' + void_[1] + ',' + void_[2] + ',0)');
    } catch (e) { gradHaze = null; }
    return gradHaze;
  }

  return {
    /** Cells narrower than this carry no health number; the picture is the
     *  information at that size. Kept for the tools that ask. */
    minNumeral: numeralMin,
    haze: hazeShare,
    /** The picture's colour for a piece, as a CSS string, for debris. */
    shadeOf(b) {
      if (!b || !Number.isFinite(b.mu)) return null;
      const st = source.stripOf(b.R);
      const T = st ? st.panel.T : 0;
      const out = new Uint8ClampedArray(3);
      colourAt(b.mu, T, cycle, out, 0);
      return 'rgb(' + Math.min(255, out[0] + 40) + ',' + Math.min(255, out[1] + 40) + ',' + Math.min(255, out[2] + 40) + ')';
    },

    /**
     * Draw the whole field: ghost, living pieces, haze, numerals.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} frame  { cell, origin, top, floor, width, off, rowsTall, dt, blocks }
     */
    draw(ctx, frame) {
      if (!ctx || canDraw === false) return;
      const cell = frame.cell, origin = frame.origin, top = frame.top, floor = frame.floor, W = frame.width;
      const off = frame.off || 0;
      const rowsTall = frame.rowsTall;
      const dt = Number.isFinite(frame.dt) ? frame.dt : 1 / 60;
      const place = source.placement();
      const rows = [];
      for (const [sr, R] of place) {
        const y = top + sr * cell + off;
        if (y > floor + cell || y + cell < top - cell) continue;
        rows.push({ sr, R, y });
      }
      rows.sort((a, b) => a.sr - b.sr);
      prune(source.dealt - 160);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, top, W, floor - top);
      ctx.clip();

      // The ghost: the whole picture, dim.
      ctx.globalAlpha = ghostAlpha;
      for (const row of rows) {
        const L = layerOf(row.R);
        if (!L) continue;
        ctx.drawImage(L.ghost, 0, 0, L.w, L.h, origin + L.lo * cell, row.y, L.width * cell, cell);
      }

      // The living pieces.
      for (const row of rows) {
        const L = layerOf(row.R);
        if (!L) continue;
        // Anything about a standing piece changed since the layer was painted?
        let dirty = L.dirty;
        if (!dirty) {
          for (const id of L.st.pieceIds) {
            const b = source.alive(id);
            const key = b ? keyOf(b, rowsTall) : 'x';
            if (L.keys.get(id) !== key) { dirty = true; break; }
          }
        }
        if (dirty) {
          repaint(L, rowsTall);
          for (const id of L.st.pieceIds) {
            const b = source.alive(id);
            L.keys.set(id, b ? keyOf(b, rowsTall) : 'x');
          }
        }
        let a = born.get(row.R);
        if (a === undefined) a = 0;
        a = Math.min(1, a + dt / 0.25);
        born.set(row.R, a);
        ctx.globalAlpha = a;
        ctx.drawImage(L.live.cv, 0, 0, L.w, L.h, origin + L.lo * cell, row.y, L.width * cell, cell);
      }
      ctx.globalAlpha = 1;

      // Atmospheric perspective, before the numerals and never over them.
      if (hazeShare > 0) {
        const gh = hazeFor(ctx, top, floor);
        if (gh) {
          ctx.globalAlpha = hazeShare;
          ctx.fillStyle = gh; ctx.fillRect(0, top, W, hazeH);
          ctx.globalAlpha = 1;
        }
      }

      // Numerals: ink with a dark rim, no plate, on pieces with room for one.
      const list = frame.blocks || [];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let font = '';
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!b || b.id === undefined || !(b.hp > 0) || b.dead) continue;
        const room = (b.insR || 0) * 2 * cell;
        if (room < numeralMin) continue;
        const txt = formatTight(b.hp);
        if (!txt) continue;
        const size = txt.length <= 3 ? 14 : txt.length === 4 ? 12 : 10;
        if (room < size * 0.9) continue;
        const f = '600 ' + size + 'px ' + FONT;
        if (f !== font) { ctx.font = f; font = f; }
        const x = origin + b.anchorU * cell;
        const y = top + (b.r + 1 - b.anchorH) * cell + off;
        if (y < top - size || y > floor + size) continue;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = voidCss;
        ctx.strokeText(txt, x, y + 0.5);
        ctx.fillStyle = inkCss;
        ctx.fillText(txt, x, y + 0.5);
      }
      ctx.restore();
    },

    /** For tools: the layers built so far, and the strip of a row. */
    layerOf,
    ramp,
    get strips() { return layers.size; },
  };
}

export default createFractalSurface;
