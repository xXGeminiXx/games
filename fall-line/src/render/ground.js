// ---------------------------------------------------------------------------
// The terrain polygon cache and the row painter.
//
// Every cell is a flat diamond top plus, where the ground in front of it drops
// away, one or two wall faces. Light comes from the upper left, so the face
// that points down-left is darker than the one that points down-right and a
// step in the ground reads as a step without a single soft edge.
//
// The whole field is walked once when heights change and never again: for each
// cell this keeps the north corner of its top face, the two face depths, a
// colour class and which of its four edges to line. Rebuilding is the only
// place any of that arithmetic happens.
// ---------------------------------------------------------------------------

/** Edge bits, named for the direction the neighbour lies in. */
const E_BACKX = 1;   // upper-left edge, toward the cell at x - 1
const E_BACKY = 2;   // upper-right edge, toward the cell at y - 1
const E_FRONTY = 4;  // lower-left edge, toward the cell at y + 1
const E_FRONTX = 8;  // lower-right edge, toward the cell at x + 1

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

  // Colour classes: one per height band, then the snowline, then the hearth.
  const bands = cfg.render.bands;
  const NCLS = bands.length + 2;
  const SNOW = bands.length;
  const HEARTH = bands.length + 1;

  const topColor = new Array(NCLS);
  const leftColor = new Array(NCLS);
  const rightColor = new Array(NCLS);
  for (let c = 0; c < NCLS; c++) {
    const base = c === SNOW ? cfg.render.snow : (c === HEARTH ? cfg.render.hearthTop : bands[c]);
    topColor[c] = base;
    leftColor[c] = shade(base, cfg.render.wallLeft);
    rightColor[c] = shade(base, cfg.render.wallRight);
  }

  let W = 0, H = 0, n = 0;
  let nx = new Float32Array(0);     // screen x of the top face's north corner
  let ny = new Float32Array(0);     // screen y of the same corner
  let cls = new Uint8Array(0);      // colour class
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
    cls = new Uint8Array(n);
    dropL = new Float32Array(n);
    dropR = new Float32Array(n);
    edges = new Uint8Array(n);
    rowCells = new Int32Array(n);
    rowStart = new Int32Array(w + h);
    counts = new Int32Array((w + h - 1) * NCLS);
    ground.rows = w + h - 1;
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

      counts.fill(0);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const h = hs[i];
          iso.project(x, y, h);
          nx[i] = iso.sx;
          ny[i] = iso.sy;

          const k = kinds ? kinds[i] : 0;
          const c = k === 1 ? SNOW : (k === 2 ? HEARTH : (h < bands.length ? h : bands.length - 1));
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
        for (let c = 0; c < NCLS; c++) {
          const at = d * NCLS + c;
          const k = counts[at];
          counts[at] = run;
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

      // The face that points down-right, toward the cell at x + 1.
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
    corner(i) { return { sx: nx[i], sy: ny[i] }; },
  };

  return ground;
}
