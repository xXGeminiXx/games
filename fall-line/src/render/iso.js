// ---------------------------------------------------------------------------
// The isometric projection, the fit to the box, and picking.
//
// One flat diamond per cell. Screen x comes from (x - y) and screen y from
// (x + y), and height lifts a cell straight up the screen, so depth order is
// just x + y and the painter walks rows from the back of the field forward.
//
// Tile width is always even. Half a tile is then a whole pixel, so every cell
// corner sits on an exact screen x and the vertical edge of every wall face is
// a hard line. Fractional geometry is what makes an isometric field look soft.
// ---------------------------------------------------------------------------

const SQRT2 = Math.SQRT2;
const TAU = Math.PI * 2;

/** Clear space kept between the tallest cell and the top of the box, in px. */
const MARGIN = 4;

/** The field stays legible down to this tile width and goes no smaller. */
const MIN_TILE = 6;

/** Tile widths snap to this so half a tile is a whole pixel. */
const STEP = 2;

/**
 * The projection for one field. Every value it needs is on the object, so a
 * caller can read tw, th, hz and the origin without asking for them.
 */
export function createIso(cfg) {

  const iso = {
    // Geometry, set by fit.
    tw: 16,        // tile width in px
    th: 8,         // tile height in px, always half the width
    hz: 6,         // pixels a cell rises per level of height
    ox: 0,         // screen x of world (0, 0)
    oy: 0,         // screen y of world (0, 0) at height 0
    boxW: 0,
    boxH: 0,

    // The last projected point. Reused rather than returned so that projecting
    // thousands of motes a frame allocates nothing.
    sx: 0,
    sy: 0,

    // Changes whenever the geometry does, so caches know to rebuild.
    key: '',

    /**
     * Choose the largest tile width that puts the whole field, including the
     * tallest cell, inside the box, then centre the diamond in it.
     */
    fit(boxW, boxH, W, H, maxHeight) {
      const span = W + H;
      const unit = cfg.render.heightUnit;
      const tall = Math.max(0, maxHeight);

      const byWidth = span > 0 ? (2 * boxW) / span : cfg.render.tileWidthMax;
      const byHeight = (boxH - MARGIN) / (span / 4 + tall * unit);
      let tw = Math.min(cfg.render.tileWidthMax, byWidth, byHeight);
      tw = Math.floor(tw / STEP) * STEP;
      if (!(tw >= MIN_TILE)) tw = MIN_TILE;

      // The height unit is rounded to a whole pixel, which can cost a little
      // more headroom than the estimate above allowed; step down until the
      // rounded geometry really fits.
      let th = tw / 2;
      let hz = Math.max(1, Math.round(tw * unit));
      while (tw > MIN_TILE &&
             (span * tw / 2 > boxW || span * th / 2 + tall * hz + MARGIN > boxH)) {
        tw = Math.max(MIN_TILE, tw - STEP);
        th = tw / 2;
        hz = Math.max(1, Math.round(tw * unit));
      }

      const fullW = span * tw / 2;
      const fullH = span * th / 2 + tall * hz;

      this.tw = tw;
      this.th = th;
      this.hz = hz;
      this.boxW = boxW;
      this.boxH = boxH;
      this.ox = Math.round((boxW - fullW) / 2) + H * tw / 2;
      this.oy = Math.round((boxH - fullH) / 2) + tall * hz;
      this.key = tw + ':' + hz + ':' + this.ox + ':' + this.oy + ':' + W + 'x' + H;
      return this;
    },

    /** Project a world point onto sx, sy. Allocates nothing. */
    project(x, y, h) {
      this.sx = this.ox + (x - y) * this.tw * 0.5;
      this.sy = this.oy + (x + y) * this.th * 0.5 - h * this.hz;
    },

    /** The same, handed back as a pair, for callers that want one point. */
    projectTo(x, y, h) {
      this.project(x, y, h);
      return { sx: this.sx, sy: this.sy };
    },

    /**
     * The cell under a screen point, or -1. Cells are tested from the front of
     * the field backwards and the first top face that contains the point wins,
     * which is what makes a tall cell take the click away from the low ground
     * it is standing in front of.
     */
    pick(sx, sy, terrain) {
      const W = terrain.W, H = terrain.H, hs = terrain.h;
      const halfW = this.tw * 0.5;
      const halfH = this.th * 0.5;
      for (let d = W + H - 2; d >= 0; d--) {
        const xLo = d - H + 1 > 0 ? d - H + 1 : 0;
        const xHi = d < W - 1 ? d : W - 1;
        for (let x = xLo; x <= xHi; x++) {
          const y = d - x;
          const i = y * W + x;
          const cx = this.ox + (x - y) * halfW;
          const cy = this.oy + (x + y + 1) * halfH - hs[i] * this.hz;
          const dx = sx - cx;
          const dy = sy - cy;
          const ax = dx < 0 ? -dx : dx;
          const ay = dy < 0 ? -dy : dy;
          if (ax / halfW + ay / halfH <= 1.0000001) return i;
        }
      }
      return -1;
    },

    /**
     * Trace the ellipse a world circle projects to. A unit circle on the
     * ground comes out axis aligned on screen, wider than it is tall by
     * exactly the tile ratio, so a range ring sits flat on the terrain.
     */
    ellipsePath(ctx, x, y, h, rCells) {
      this.project(x, y, h);
      const rx = rCells * this.tw / SQRT2;
      const ry = rCells * this.th / SQRT2;
      ctx.beginPath();
      ctx.ellipse(this.sx, this.sy, rx, ry, 0, 0, TAU);
    },

    /** Screen-x and screen-y semi-axes of that ellipse, for callers that measure. */
    ellipseAxes(rCells) {
      return { rx: rCells * this.tw / SQRT2, ry: rCells * this.th / SQRT2 };
    },

    /** The painter's row a world point belongs to. */
    depthRow(x, y) {
      return Math.floor(x) + Math.floor(y);
    },
  };

  return iso;
}
