// ---------------------------------------------------------------------------
// The terrain polygon cache and the row painter.
//
// Every cell is a flat diamond top plus, where the ground in front of it drops
// away, one or two wall faces. There is a sun, low in the upper left: tops
// are lit and warmed, the faces that turn away from it are darkened, a tall
// cell throws a hard shadow across the ground to its lower right, ground
// hemmed in by higher neighbours sits in its own shade, and the far end of
// the field fades a little toward the paper it is drawn on. None of that is
// soft: a shadow is a shadow-coloured facet with a hard edge.
//
// The whole field is walked once when heights change and never again: for each
// cell this keeps the north corner of its top face, the two face depths, a
// colour class (its height band and its light) and which of its four edges
// to line. Rebuilding is the only place any of that arithmetic happens.
// ---------------------------------------------------------------------------

import { mixHex, scaleLightness } from './oklab.js?v=11';

/** Edge bits, named for the direction the neighbour lies in. */
const E_BACKX = 1;   // upper-left edge, toward the cell at x - 1
const E_BACKY = 2;   // upper-right edge, toward the cell at y - 1
const E_FRONTY = 4;  // lower-left edge, toward the cell at y + 1
const E_FRONTX = 8;  // lower-right edge, toward the cell at x + 1

/** Light states: in the sun or in a cast shadow, three grades of enclosure,
 *  four grades of distance. Encoded as shadow * 12 + ao * 4 + fade. */
const AO_GRADES = 3;
const FADE_GRADES = 4;
const STATES = 2 * AO_GRADES * FADE_GRADES;

const SUN_DEFAULT = { slope: 1.0, reach: 6, drift: 0.35, shadow: 0.8, cool: '#517791', coolMix: 0.28, warm: '#f7dba1', warmMix: 0.05 };
const AO_DEFAULT = { step: 0.05 };
const FADE_DEFAULT = { mix: 0.045 };

/** One colour scaled toward black, kept as a hex string. */
function shade(hex, f) {
  const s = String(hex).replace('#', '');
  const v = parseInt(s.length === 3
    ? s[0] + s[0] + s[1] + s[1] + s[2] + s[2]
    : s.slice(0, 6), 16);
  if (!Number.isFinite(v)) return '#000000';
  const ch = (shift) => {
    const c = Math.round(((v >> shift) & 255) * f);
    return c < 0 ? 0 : (c > 255 ? 255 : c);
  };
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}

/**
 * Fill a run of same-coloured faces, then stroke the same path in the same
 * colour. Two filled polygons that share an edge each cover half of the pixels
 * along it, so the shared edge shows as a hairline; the stroke covers that
 * half pixel and flat ground comes out as one unbroken surface.
 */
function paintRun(ctx, colour) {
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = colour;
  ctx.stroke();
}

export function createGround(cfg, iso) {

  const bands = cfg.render.bands;
  const NBASE = bands.length + 2;
  const SNOW = bands.length;
  const HEARTH = bands.length + 1;
  const NCLS = NBASE * STATES;
  const sun = Object.assign({}, SUN_DEFAULT, cfg.render.sun || {});
  const ao = Object.assign({}, AO_DEFAULT, cfg.render.ao || {});
  const fade = Object.assign({}, FADE_DEFAULT, cfg.render.fade || {});
  const paper = cfg.palette.void;

  // Every colour the painter will ever use, made once from the band colours.
  const topColor = new Array(NCLS);
  const leftColor = new Array(NCLS);
  const rightColor = new Array(NCLS);
  for (let b = 0; b < NBASE; b++) {
    const base = b === SNOW ? cfg.render.snow : (b === HEARTH ? cfg.render.hearthTop : bands[b]);
    for (let s = 0; s < 2; s++) {
      // Lit ground leans warm; ground in shadow is darker and leans cool.
      let lit = s === 0
        ? mixHex(base, sun.warm, sun.warmMix)
        : mixHex(scaleLightness(base, sun.shadow), sun.cool, sun.coolMix);
      for (let a = 0; a < AO_GRADES; a++) {
        const enclosed = a === 0 ? lit : scaleLightness(lit, 1 - ao.step * a);
        for (let f = 0; f < FADE_GRADES; f++) {
          const c = f === 0 ? enclosed : mixHex(enclosed, paper, fade.mix * f);
          const cls = b * STATES + s * (AO_GRADES * FADE_GRADES) + a * FADE_GRADES + f;
          topColor[cls] = c;
          leftColor[cls] = shade(c, cfg.render.wallLeft);
          rightColor[cls] = shade(c, cfg.render.wallRight);
        }
      }
    }
  }

  let W = 0, H = 0, n = 0;
  let nx = new Float32Array(0);     // screen x of the top face's north corner
  let ny = new Float32Array(0);     // screen y of the same corner
  let cls = new Uint16Array(0);     // colour class: band and light
  let light = new Uint8Array(0);    // the light state alone, for tests and tools
  let dropL = new Float32Array(0);  // depth of the lower-left face, 0 for none
  let dropR = new Float32Array(0);  // depth of the lower-right face
  let edges = new Uint8Array(0);
  let rowCells = new Int32Array(0); // cells sorted by row, then by colour class
  let rowStart = new Int32Array(1);
  let counts = new Int32Array(0);

  function allocate(w, h) {
    W = w; H = h; n = w * h;
    nx = new Float32Array(n);
    ny = new Float32Array(n);
    cls = new Uint16Array(n);
    light = new Uint8Array(n);
    dropL = new Float32Array(n);
    dropR = new Float32Array(n);
    edges = new Uint8Array(n);
    rowCells = new Int32Array(n);
    rowStart = new Int32Array(w + h);
    counts = new Int32Array((w + h - 1) * NCLS);
    ground.rows = w + h - 1;
  }

  /**
   * Whether a cell stands in the shadow of taller ground toward the sun. The
   * sun is low in the upper left, so the check walks toward -x (and a little
   * toward -y), one cell per step, and a wall n levels higher than this cell
   * shades the n - 1 cells in front of it.
   */
  function inShadow(hs, x, y, h) {
    const reach = sun.reach | 0;
    for (let k = 1; k <= reach; k++) {
      const sx = x - k;
      if (sx < 0) return false;
      const sy = y - Math.round(k * sun.drift);
      if (sy < 0) return false;
      if (hs[sy * W + sx] - h > k * sun.slope) return true;
    }
    return false;
  }

  /** How hemmed in a cell is by higher neighbours: 0, 1 or 2. */
  function enclosure(hs, x, y, h) {
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const xx = x + dx;
        if (xx < 0 || xx >= W) continue;
        const d = hs[yy * W + xx] - h;
        if (d > 0) sum += d > 2 ? 2 : d;
      }
    }
    return sum === 0 ? 0 : (sum <= 3 ? 1 : 2);
  }

  const ground = {
    rows: 0,
    version: -1,
    fitKey: '',

    /** Walk the field and cache everything the row painter needs. */
    rebuild(terrain) {
      if (terrain.W !== W || terrain.H !== H) allocate(terrain.W, terrain.H);
      const hs = terrain.h;
      const kinds = terrain.kind;
      const hz = iso.hz;
      const rows = W + H - 1;
      const span = Math.max(1, W + H - 2);

      counts.fill(0);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const h = hs[i];
          iso.project(x, y, h);
          nx[i] = iso.sx;
          ny[i] = iso.sy;

          const k = kinds ? kinds[i] : 0;
          const b = k === 1 ? SNOW : (k === 2 ? HEARTH : (h < bands.length ? h : bands.length - 1));
          const s = inShadow(hs, x, y, h) ? 1 : 0;
          const a = enclosure(hs, x, y, h);
          let f = Math.floor((1 - (x + y) / span) * FADE_GRADES);
          if (f < 0) f = 0; else if (f >= FADE_GRADES) f = FADE_GRADES - 1;
          const st = s * (AO_GRADES * FADE_GRADES) + a * FADE_GRADES + f;
          light[i] = st;
          const c = b * STATES + st;
          cls[i] = c;

          // Off the field counts as height zero, so a raised rim shows its
          // wall to the outside instead of ending in mid air.
          const hBackX = x > 0 ? hs[i - 1] : 0;
          const hBackY = y > 0 ? hs[i - W] : 0;
          const hFrontX = x < W - 1 ? hs[i + 1] : 0;
          const hFrontY = y < H - 1 ? hs[i + W] : 0;

          dropL[i] = h > hFrontY ? (h - hFrontY) * hz : 0;
          dropR[i] = h > hFrontX ? (h - hFrontX) * hz : 0;

          // One line per height difference: the higher of the two cells owns
          // it, so no edge is drawn twice and flat ground stays unbroken.
          let e = 0;
          if (h > hBackX) e |= E_BACKX;
          if (h > hBackY) e |= E_BACKY;
          if (h > hFrontY) e |= E_FRONTY;
          if (h > hFrontX) e |= E_FRONTX;
          edges[i] = e;

          counts[(x + y) * NCLS + c]++;
        }
      }

      // Counting sort into row order, and within a row into colour order, so
      // the painter fills a run of same-coloured tops with one call.
      let run = 0;
      for (let d = 0; d < rows; d++) {
        rowStart[d] = run;
        const base = d * NCLS;
        for (let c = 0; c < NCLS; c++) {
          const k = counts[base + c];
          counts[base + c] = run;
          run += k;
        }
      }
      rowStart[rows] = run;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          rowCells[counts[(x + y) * NCLS + cls[i]]++] = i;
        }
      }

      this.rows = rows;
      this.version = terrain.version;
      this.fitKey = iso.key;
      return this;
    },

    /** Rebuild only if the heights or the fit have moved since last time. */
    ensure(terrain) {
      if (terrain.version !== this.version || iso.key !== this.fitKey ||
          terrain.W !== W || terrain.H !== H) {
        this.rebuild(terrain);
      }
      return this;
    },

    /** Trace one cell's top face, at its own height or a given one. */
    cellTopPath(ctx, terrain, i, h) {
      const halfW = iso.tw * 0.5;
      const halfH = iso.th * 0.5;
      const cols = terrain.W || 1;
      const x = i % cols;
      const y = Math.floor(i / cols);
      iso.project(x, y, h === undefined || h === null ? terrain.h[i] : h);
      const px = iso.sx, py = iso.sy;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + halfW, py + halfH);
      ctx.lineTo(px, py + iso.th);
      ctx.lineTo(px - halfW, py + halfH);
      ctx.closePath();
    },

    /** One cell's top face in a flat colour. Used by cursors and ghosts. */
    drawCellTop(ctx, terrain, i, color, alpha, h) {
      if (i < 0 || i >= terrain.W * terrain.H) return;
      const a = alpha === undefined ? 1 : alpha;
      this.cellTopPath(ctx, terrain, i, h);
      if (a !== 1) ctx.globalAlpha = a;
      ctx.fillStyle = color;
      ctx.fill();
      if (a !== 1) ctx.globalAlpha = 1;
    },

    /** Every cell whose x + y is d: tops, then the wall faces, then the lines. */
    drawRow(ctx, terrain, d) {
      if (d < 0 || d >= this.rows) return;
      const s = rowStart[d];
      const e = rowStart[d + 1];
      if (s === e) return;
      const halfW = iso.tw * 0.5;
      const halfH = iso.th * 0.5;
      const th = iso.th;
      ctx.lineWidth = 1;

      // Tops.
      let cur = -1;
      for (let k = s; k < e; k++) {
        const i = rowCells[k];
        const c = cls[i];
        if (c !== cur) {
          if (cur >= 0) paintRun(ctx, topColor[cur]);
          ctx.beginPath();
          cur = c;
        }
        const px = nx[i], py = ny[i];
        ctx.moveTo(px, py);
        ctx.lineTo(px + halfW, py + halfH);
        ctx.lineTo(px, py + th);
        ctx.lineTo(px - halfW, py + halfH);
        ctx.closePath();
      }
      if (cur >= 0) paintRun(ctx, topColor[cur]);

      // The face that points down-left, toward the cell at y + 1.
      cur = -1;
      for (let k = s; k < e; k++) {
        const i = rowCells[k];
        const drop = dropL[i];
        if (drop <= 0) continue;
        const c = cls[i];
        if (c !== cur) {
          if (cur >= 0) paintRun(ctx, leftColor[cur]);
          ctx.beginPath();
          cur = c;
        }
        const px = nx[i], py = ny[i];
        ctx.moveTo(px - halfW, py + halfH);
        ctx.lineTo(px, py + th);
        ctx.lineTo(px, py + th + drop);
        ctx.lineTo(px - halfW, py + halfH + drop);
        ctx.closePath();
      }
      if (cur >= 0) paintRun(ctx, leftColor[cur]);

      // The face that points down-right, toward the cell at x + 1. It turns
      // away from the sun, so it is the darker of the two.
      cur = -1;
      for (let k = s; k < e; k++) {
        const i = rowCells[k];
        const drop = dropR[i];
        if (drop <= 0) continue;
        const c = cls[i];
        if (c !== cur) {
          if (cur >= 0) paintRun(ctx, rightColor[cur]);
          ctx.beginPath();
          cur = c;
        }
        const px = nx[i], py = ny[i];
        ctx.moveTo(px + halfW, py + halfH);
        ctx.lineTo(px, py + th);
        ctx.lineTo(px, py + th + drop);
        ctx.lineTo(px + halfW, py + halfH + drop);
        ctx.closePath();
      }
      if (cur >= 0) paintRun(ctx, rightColor[cur]);

      // Contours. Only where a height actually changes, so a plain reads as
      // one surface and a cliff reads as a line.
      let lines = 0;
      ctx.beginPath();
      for (let k = s; k < e; k++) {
        const i = rowCells[k];
        const bits = edges[i];
        if (!bits) continue;
        const px = nx[i], py = ny[i];
        if (bits & E_BACKX) { ctx.moveTo(px, py); ctx.lineTo(px - halfW, py + halfH); lines++; }
        if (bits & E_BACKY) { ctx.moveTo(px, py); ctx.lineTo(px + halfW, py + halfH); lines++; }
        if (bits & E_FRONTY) { ctx.moveTo(px - halfW, py + halfH); ctx.lineTo(px, py + th); lines++; }
        if (bits & E_FRONTX) { ctx.moveTo(px + halfW, py + halfH); ctx.lineTo(px, py + th); lines++; }
      }
      if (lines) {
        ctx.globalAlpha = cfg.render.edgeAlpha;
        ctx.strokeStyle = cfg.render.edge;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    },

    // Read-only views, for tests and tools.
    faceDepths(i) { return { left: dropL[i], right: dropR[i] }; },
    edgeBits(i) { return edges[i]; },
    colourClass(i) { return cls[i]; },
    bandClass(i) { return Math.floor(cls[i] / STATES); },
    lightOf(i) {
      const st = light[i];
      return {
        shadow: st >= AO_GRADES * FADE_GRADES ? 1 : 0,
        ao: Math.floor((st % (AO_GRADES * FADE_GRADES)) / FADE_GRADES),
        fade: st % FADE_GRADES,
      };
    },
    topColour(i) { return topColor[cls[i]]; },
    corner(i) { return { sx: nx[i], sy: ny[i] }; },
    classes: NCLS,
  };

  return ground;
}
