// ---------------------------------------------------------------------------
// Where the machine sits in the window.
//
// The board is described in its own units, with y running downward the way a
// ball falls. Everything drawn is placed in those units and turned into clip
// space by one four float transform, so a shader never needs to know the
// window size and the whole picture can be re-fitted by changing four
// numbers rather than by rebuilding a buffer.
//
// The face keeps its proportions. A window wider than the machine gets bars
// at the sides rather than a stretched face, because a pachinko face that
// changes shape with the window stops reading as an object somebody built.
// A margin is left around it for the bezel and the shadow it casts.
//
// Pure arithmetic: nothing here touches a canvas, a context or the document.
// ---------------------------------------------------------------------------

/**
 * Fit a board of `boardW` x `boardH` units into a `bufW` x `bufH` pixel
 * buffer, preserving shape and leaving a margin.
 *
 * Returns pixels per board unit, the top left corner of the face in pixels,
 * and the face size in pixels. Pixel y runs downward, matching board y.
 */
export function fitBoard(bufW, bufH, boardW, boardH, { margin = 0.045 } = {}) {
  const w = Math.max(1, bufW);
  const h = Math.max(1, bufH);
  const bw = Math.max(1e-6, boardW);
  const bh = Math.max(1e-6, boardH);
  const m = Math.max(0, Math.min(0.4, margin));
  const availW = w * (1 - m * 2);
  const availH = h * (1 - m * 2);
  const scale = Math.min(availW / bw, availH / bh);
  const faceW = bw * scale;
  const faceH = bh * scale;
  return {
    scale,
    ox: (w - faceW) * 0.5,
    oy: (h - faceH) * 0.5,
    w: faceW,
    h: faceH,
    bufW: w,
    bufH: h,
    boardW: bw,
    boardH: bh,
  };
}

/**
 * The board-to-clip transform as [sx, sy, tx, ty], so a vertex shader does
 * `clip = board * xform.xy + xform.zw`. sy is negative: board y grows
 * downward and clip y grows upward.
 */
export function clipTransform(fit, out) {
  const t = out || new Float32Array(4);
  const sx = (2 * fit.scale) / fit.bufW;
  const sy = (-2 * fit.scale) / fit.bufH;
  t[0] = sx;
  t[1] = sy;
  t[2] = (2 * fit.ox) / fit.bufW - 1;
  t[3] = 1 - (2 * fit.oy) / fit.bufH;
  return t;
}

/** A board point as a pixel position inside the buffer the fit was made for. */
export function boardToPixel(fit, x, y, out) {
  const p = out || { x: 0, y: 0 };
  p.x = fit.ox + x * fit.scale;
  p.y = fit.oy + y * fit.scale;
  return p;
}

/** The inverse, for turning a pointer position back into board units. */
export function pixelToBoard(fit, px, py, out) {
  const p = out || { x: 0, y: 0 };
  p.x = (px - fit.ox) / fit.scale;
  p.y = (py - fit.oy) / fit.scale;
  return p;
}

/**
 * Where the lamp hangs, in board units, as [x, y, height].
 *
 * Above the face and a little to its left, which is where the shadows in the
 * picture say it is. Height is in board units too, so the falloff across the
 * face stays the same whatever size the board is described in.
 */
export function lampPosition(boardW, boardH, { x = 0.38, y = -0.30, height = 1.05 } = {}) {
  return [boardW * x, boardH * y, boardH * height];
}

/**
 * The rectangle the reel window occupies, in board units, as
 * { x, y, w, h } with x and y at its centre. A config may name its own.
 */
export function reelRect(boardW, boardH, given) {
  const g = given || {};
  const w = num(g.w, boardW * 0.135);
  const h = num(g.h, boardH * 0.046);
  return {
    x: num(g.x, boardW * 0.5),
    y: num(g.y, boardH * 0.30),
    w,
    h,
  };
}

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
