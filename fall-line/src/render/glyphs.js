// ---------------------------------------------------------------------------
// The marks: one geometric glyph per kind of work, one small hard shape per
// mote, and the ember that burns on the hearth.
//
// Nothing here is soft. Glyphs are filled polygons with a one pixel outline
// standing on a short stem, so a work reads as an object planted on the
// ground rather than a sticker lying on it. Motes are whole-pixel rectangles
// and darts, drawn in batches: a caller may open one path, add a few thousand
// marks of the same colour to it, and fill once.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

/** A regular polygon as flat x, y pairs on a unit box. */
function poly(sides, start, r) {
  const out = [];
  for (let k = 0; k < sides; k++) {
    const a = start + k * TAU / sides;
    out.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return out;
}

/** A star as flat x, y pairs, alternating outer and inner radius. */
function starPoly(points, outer, inner) {
  const out = [];
  for (let k = 0; k < points * 2; k++) {
    const a = -Math.PI / 2 + k * Math.PI / points;
    const r = k % 2 === 0 ? outer : inner;
    out.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return out;
}

const SHAPES = {
  triangle: poly(3, -Math.PI / 2, 0.58),
  square: [-0.44, -0.44, 0.44, -0.44, 0.44, 0.44, -0.44, 0.44],
  hexagon: poly(6, -Math.PI / 2, 0.54),
  diamond: [0, -0.58, 0.58, 0, 0, 0.58, -0.58, 0],
  ring: poly(12, -Math.PI / 2, 0.52),
  star: starPoly(5, 0.6, 0.26),
};

/** The glyphs that carry a facing, and so turn with the work. */
const TURNS = { triangle: 1, square: 1, diamond: 1, ring: 1 };

function tracePoly(ctx, pts, cx, cy, size, cos, sin) {
  for (let k = 0; k < pts.length; k += 2) {
    const px = pts[k] * size;
    const py = pts[k + 1] * size;
    const x = cx + px * cos - py * sin;
    const y = cy + px * sin + py * cos;
    if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * One work standing on a cell top. (sx, sy) is where it meets the ground.
 * lineColor overrides the outline, which is how a build ghost is drawn in the
 * allowed or refused colour without touching anything else.
 */
export function drawWork(ctx, iso, cfg, glyph, sx, sy, size, angle, tier, lineColor) {
  const body = size > 4 ? size : 4;
  const stem = Math.round(body * 0.5) + 1;
  const cx = Math.round(sx);
  const foot = Math.round(sy);
  const cy = foot - stem - Math.round(body * 0.5);
  const line = lineColor || cfg.render.work;
  const turn = TURNS[glyph] ? (angle || 0) : 0;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);

  ctx.lineWidth = 1;
  ctx.strokeStyle = line;

  // The stem. A whole pixel wide, on a half pixel, so it stays one pixel.
  ctx.beginPath();
  ctx.moveTo(cx + 0.5, foot);
  ctx.lineTo(cx + 0.5, cy);
  ctx.stroke();

  if (glyph === 'asterisk') {
    // Six spokes through the centre, with a small solid heart.
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = turn + k * Math.PI / 3;
      const dx = Math.cos(a) * body * 0.58;
      const dy = Math.sin(a) * body * 0.58;
      ctx.moveTo(cx - dx, cy - dy);
      ctx.lineTo(cx + dx, cy + dy);
    }
    ctx.stroke();
    ctx.fillStyle = line;
    ctx.fillRect(cx - 1, cy - 1, 3, 3);
  } else {
    const pts = SHAPES[glyph] || SHAPES.square;
    ctx.beginPath();
    tracePoly(ctx, pts, cx, cy, body, cos, sin);
    ctx.fillStyle = cfg.render.workInk;
    ctx.fill();
    ctx.stroke();

    if (glyph === 'ring') {
      // A hollow centre and four spokes, so the turn is visible.
      ctx.beginPath();
      tracePoly(ctx, SHAPES.ring, cx, cy, body * 0.42, cos, sin);
      ctx.stroke();
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = turn + k * Math.PI / 2;
        const c = Math.cos(a), s = Math.sin(a);
        ctx.moveTo(cx + c * body * 0.21, cy + s * body * 0.21);
        ctx.lineTo(cx + c * body * 0.26 * 2, cy + s * body * 0.26 * 2);
      }
      ctx.stroke();
    }
  }

  // Tier as a row of ticks on the ground under the glyph.
  const ticks = Math.min(9, Math.max(0, Math.round(tier || 1) - 1));
  if (ticks > 0) {
    ctx.fillStyle = cfg.render.workTick;
    const pitch = 2;
    let tx = cx - ((ticks * pitch - 1) >> 1);
    const ty = foot + 2;
    for (let k = 0; k < ticks; k++) {
      ctx.fillRect(tx, ty, 1, 2);
      tx += pitch;
    }
  }
}

/**
 * Short radial ticks around an ellipse. One burst of hard little lines, which
 * is what a hit looks like here instead of a glow. `from` and `to` are
 * multiples of the radius, so a burst can be made to fly outward over its life.
 */
export function addRadialTicks(ctx, cx, cy, rx, ry, count, start, from, to) {
  for (let k = 0; k < count; k++) {
    const a = start + k * TAU / count;
    const c = Math.cos(a), s = Math.sin(a);
    ctx.moveTo(cx + c * rx * from, cy + s * ry * from);
    ctx.lineTo(cx + c * rx * to, cy + s * ry * to);
  }
}

/** A closed hexagon on an ellipse: the print a freezing pulse leaves behind. */
export function addHexRing(ctx, cx, cy, rx, ry) {
  for (let k = 0; k < 6; k++) {
    const a = -Math.PI / 2 + k * Math.PI / 3;
    const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
    if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** The colour a mote is drawn in. Burning beats whatever it has grown. */
export function moteColor(cfg, traitId, burning) {
  const c = cfg.render.moteColors;
  if (burning) return c.burning;
  return (traitId && c[traitId]) ? c[traitId] : c.base;
}

/**
 * A mote's mark in whole pixels: bulk is fat, swarm is a dot. A swarm mote may
 * shrink to a single pixel, because that is what it is; nothing else may, or
 * the river stops reading as a current on a small field.
 */
export function moteSizePx(size, tw) {
  const s = size || 1;
  const d = Math.round(s * (1.6 + tw / 16));
  const least = s < 1 ? 1 : 2;
  return d < least ? least : d;
}

/**
 * Add one mote's mark to the open path. Nothing is filled or stroked here, so
 * a whole colour's worth of motes costs one fill.
 */
export function addMoteMark(ctx, sx, sy, size, traitId, vx, vy, tw) {
  const d = moteSizePx(size, tw);
  if (traitId === 'wings') {
    // Screen space direction: world x moves right and down, world y left and
    // down, and the tile is twice as wide as it is tall.
    const dx = (vx - vy);
    const dy = (vx + vy) * 0.5;
    const m = Math.sqrt(dx * dx + dy * dy);
    if (m > 1e-6) {
      const ux = dx / m, uy = dy / m;
      const px = -uy, py = ux;
      const a = d * 0.9 + 1.5;
      const b = d * 0.7 + 1;
      ctx.moveTo(sx + ux * a, sy + uy * a);
      ctx.lineTo(sx + px * b - ux * b * 0.7, sy + py * b - uy * b * 0.7);
      ctx.lineTo(sx - ux * a * 0.3, sy - uy * a * 0.3);
      ctx.lineTo(sx - px * b - ux * b * 0.7, sy - py * b - uy * b * 0.7);
      ctx.closePath();
      return;
    }
  }
  const r = d >> 1;
  ctx.rect(Math.round(sx) - r, Math.round(sy) - r, d, d);
}

/** Add one mote's tail to the open path: a short streak back along its travel. */
export function addMoteTail(ctx, sx, sy, vx, vy, tw) {
  const dx = (vx - vy) * tw * 0.5;
  const dy = (vx + vy) * tw * 0.25;
  const m = Math.sqrt(dx * dx + dy * dy);
  if (m < 1) return;
  const cap = tw * 0.45;
  let len = tw * 0.14 + m * 0.09;
  if (len > cap) len = cap;
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx - dx / m * len, sy - dy / m * len);
}

/** One mote on its own, tail and mark. The scene batches instead. */
export function drawMote(ctx, cfg, sx, sy, size, traitId, vx, vy, burning, tw) {
  const col = moteColor(cfg, traitId, burning);
  ctx.lineWidth = 1;
  ctx.strokeStyle = col;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  addMoteTail(ctx, sx, sy, vx, vy, tw);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = col;
  ctx.beginPath();
  addMoteMark(ctx, sx, sy, size, traitId, vx, vy, tw);
  ctx.fill();
}

/**
 * The hearth mark. It beats by growing and shrinking a whole pixel at a time,
 * which reads at a glance and stays as hard-edged as everything else.
 */
export function drawEmber(ctx, cfg, sx, sy, tw, time) {
  const base = Math.max(3, Math.round(tw * 0.15));
  const beat = Math.round(1.5 + Math.sin((time || 0) * 2.7) * 1.5);
  const r = base + beat;
  const inner = r * 0.38;
  const cx = Math.round(sx);
  const cy = Math.round(sy);
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = -Math.PI / 2 + k * Math.PI / 4;
    const rad = k % 2 === 0 ? r : inner;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad * 0.85;
    if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = cfg.render.ember;
  ctx.fill();
}
