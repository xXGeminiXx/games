// ---------------------------------------------------------------------------
// The picture: a pit hall seen from the gallery.
//
// Four bands down the window. The slate fills the top and carries every figure
// in the game, written in chalk strokes by src/chalk.js. A worn timber rail
// crosses under it. Below that is the floor, where every trader in the crowd
// is one short stroke with a round cap and a dot for a head; they lean toward
// the rail in proportion to how much the book moved this tick, so the press of
// bodies IS the volume rather than a decoration beside it. The tape runs along
// the bottom edge.
//
// WHAT IS DRAWN ONCE AND WHAT IS DRAWN EVERY FRAME. The room itself - the
// slate wash, the chalk dust, the old score lines, the clerestory beam, the
// timber of the rail, the floor's fall-off - never changes between resizes, so
// it is rendered to its own canvas and stamped. That was worth about three
// times the frame rate on a comparable page in the lab, and it is most of why
// a few thousand marks fit in a frame here.
//
// Every mark is drawn in one of a handful of depth bands, and each band is a
// single batched stroke: two calls per band, one for the bodies and one for
// the heads, instead of one call per trader.
//
// GHOSTS. A figure that changes is not cross-faded and does not slide. The old
// strokes stay where they were, greyed, and fade over a couple of seconds
// while the new ones are written over them. That wipe is the one animation the
// game has, and everything else on the slate is still.
// ---------------------------------------------------------------------------

import { createHand } from './chalk.js?v=2';
import { alpha as withAlpha } from './oklch.js?v=2';
import { hash2f } from './rng.js?v=2';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Board {
  constructor(canvas, cfg, content) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cfg = cfg;
    this.content = content;
    this.hand = createHand(cfg.chalk);
    this.marks = null;
    this.markCount = 0;
    this.surge = 0;
    this.furniture = null;
    this.W = 0; this.H = 0; this.dpr = 1;
    this.inset = { right: 0, bottom: 0 };
    this.slots = new Map();      // id -> { text, ghost, ghostAt }
    this.tapeOffset = 0;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.frame = 0;
  }

  // --- layout --------------------------------------------------------------

  resize(w, h, dpr) {
    const d = Math.min(this.cfg.view.maxDpr, dpr || 1);
    if (w === this.W && h === this.H && d === this.dpr) return false;
    this.W = w; this.H = h; this.dpr = d;
    this.floorCanvas = null;
    this.canvas.width = Math.max(1, Math.round(w * d));
    this.canvas.height = Math.max(1, Math.round(h * d));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.layout();
    this.furniture = null;
    this.hand.clear();
    this.marks = null;
    return true;
  }

  layout() {
    const v = this.cfg.view, portrait = this.H > this.W;
    this.railTop = Math.round(this.H * (portrait ? v.portraitRailTop : v.railTop));
    this.railBottom = Math.round(this.H * (portrait ? v.portraitRailBottom : v.railBottom));
    this.floorBottom = Math.round(this.H * (portrait ? v.portraitFloorBottom : v.floorBottom));
    this.slateW = Math.max(240, this.W - this.inset.right);
    this.portrait = portrait;
  }

  setInset(right) {
    if (right === this.inset.right) return;
    this.inset.right = right;
    this.layout();
    this.furniture = null;
  }

  // --- the room, rendered once --------------------------------------------

  buildFurniture() {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d');
    g.scale(this.dpr, this.dpr);
    const p = this.cfg.palette, W = this.W, H = this.H;

    // The slate wash: darker into the corners and along the bottom edge where
    // a cloth has been over it most.
    g.fillStyle = p.slate;
    g.fillRect(0, 0, W, this.railTop);
    const wash = g.createRadialGradient(W * 0.34, this.railTop * 0.34, 10, W * 0.4, this.railTop * 0.5, Math.max(W, this.railTop) * 0.95);
    wash.addColorStop(0, withAlpha(p.slateLit, 0.55));
    wash.addColorStop(0.55, withAlpha(p.slate, 0));
    wash.addColorStop(1, withAlpha(p.slateDeep, 0.75));
    g.fillStyle = wash;
    g.fillRect(0, 0, W, this.railTop);

    // Old column rules, scored into the slate and never quite cleaned off.
    g.strokeStyle = withAlpha(p.ghost, 0.13);
    g.lineWidth = 1;
    for (let i = 1; i < 9; i++) {
      const x = Math.round((W * i) / 9) + 0.5;
      g.beginPath();
      g.moveTo(x, this.railTop * 0.06);
      g.lineTo(x, this.railTop * 0.97);
      g.stroke();
    }
    // Horizontal wipe bands: where a hand cleared a figure and left the dust
    // pushed to the edges of the sweep.
    for (let i = 0; i < 7; i++) {
      const y = this.railTop * (0.1 + hash2f(i, 3, 91) * 0.85);
      const hgt = 8 + hash2f(i, 7, 12) * 26;
      const grad = g.createLinearGradient(0, y, 0, y + hgt);
      grad.addColorStop(0, withAlpha(p.dust, 0.05));
      grad.addColorStop(0.5, withAlpha(p.dust, 0.012));
      grad.addColorStop(1, withAlpha(p.dust, 0.045));
      g.fillStyle = grad;
      const x0 = W * hash2f(i, 11, 5) * 0.5;
      g.fillRect(x0, y, W * (0.3 + hash2f(i, 13, 8) * 0.6), hgt);
    }

    // Chalk dust: grains, heavier low.
    for (let i = 0; i < this.cfg.view.dustGrains; i++) {
      const x = hash2f(i, 1, 17) * W;
      const t = hash2f(i, 2, 23);
      const y = Math.pow(t, 0.6) * this.railTop;
      const a = 0.012 + hash2f(i, 4, 31) * 0.05 * (0.3 + (y / this.railTop) * 0.9);
      g.fillStyle = withAlpha(p.dust, a);
      g.fillRect(x, y, 1 + (hash2f(i, 5, 41) > 0.9 ? 1 : 0), 1);
    }

    // The clerestory: one pale beam from high on the left, with dust in it.
    const bx = W * 0.06, bw = W * 0.30, lean = Math.tan(this.cfg.view.beamAngle);
    g.save();
    g.beginPath();
    g.moveTo(bx, 0);
    g.lineTo(bx + bw, 0);
    g.lineTo(bx + bw + this.floorBottom * lean, this.floorBottom);
    g.lineTo(bx + this.floorBottom * lean * 0.7, this.floorBottom);
    g.closePath();
    const beam = g.createLinearGradient(0, 0, 0, this.floorBottom);
    beam.addColorStop(0, withAlpha(p.beam, 0.075));
    beam.addColorStop(0.55, withAlpha(p.beam, 0.032));
    beam.addColorStop(1, withAlpha(p.beam, 0.008));
    g.fillStyle = beam;
    g.fill();
    g.restore();

    // The floor: it falls away from the near edge into the dark under the rail.
    const floor = g.createLinearGradient(0, this.railBottom, 0, this.floorBottom);
    floor.addColorStop(0, p.floorFar);
    floor.addColorStop(1, p.floor);
    g.fillStyle = floor;
    g.fillRect(0, this.railBottom, W, this.floorBottom - this.railBottom);

    // The rail: worn timber, lighter along the top edge where hands rest.
    const rail = g.createLinearGradient(0, this.railTop, 0, this.railBottom);
    rail.addColorStop(0, p.timberLit);
    rail.addColorStop(0.22, p.timber);
    rail.addColorStop(1, p.timberDark);
    g.fillStyle = rail;
    g.fillRect(0, this.railTop, W, this.railBottom - this.railTop);
    g.strokeStyle = withAlpha(p.timberDark, 0.75);
    g.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = Math.round(this.railTop + ((this.railBottom - this.railTop) * (i + 0.7)) / 5.6) + 0.5;
      g.beginPath();
      let x = 0;
      g.moveTo(0, y);
      while (x < W) {
        x += 24 + hash2f(i, x | 0, 3) * 60;
        g.lineTo(x, y + (hash2f(i, x | 0, 9) - 0.5) * 1.6);
      }
      g.globalAlpha = 0.25 + hash2f(i, 2, 5) * 0.4;
      g.stroke();
    }
    g.globalAlpha = 1;
    // A shadow the rail casts down onto the floor.
    const cast = g.createLinearGradient(0, this.railBottom, 0, this.railBottom + 34);
    cast.addColorStop(0, withAlpha(p.slateDeep, 0.7));
    cast.addColorStop(1, withAlpha(p.slateDeep, 0));
    g.fillStyle = cast;
    g.fillRect(0, this.railBottom, W, 34);

    // The strip the tape runs along.
    g.fillStyle = p.slateDeep;
    g.fillRect(0, this.floorBottom, W, H - this.floorBottom);
    g.strokeStyle = withAlpha(p.rule, 0.5);
    g.beginPath();
    g.moveTo(0, this.floorBottom + 0.5);
    g.lineTo(W, this.floorBottom + 0.5);
    g.stroke();

    this.furniture = c;
  }

  // --- the crowd -----------------------------------------------------------

  buildMarks(n) {
    const count = Math.min(n, this.cfg.view.marksMax);
    const m = {
      n: count,
      x: new Float32Array(count),
      base: new Float32Array(count),
      d: new Float32Array(count),
      eager: new Float32Array(count),
    };
    for (let i = 0; i < count; i++) {
      // Spread across the floor with a little clumping, deeper near the rail
      // than at the front so the crowd reads as a crowd rather than a grid.
      // People stand in knots, not on a grid: each mark belongs to one of a
      // few dozen knots and sits near its middle. An even scatter reads as a
      // tally of marks; a clumped one reads as a room with people in it.
      const knot = i % 34;
      const kx = hash2f(knot, 907, 3);
      const kd = hash2f(knot, 911, 5);
      const u = kx + (hash2f(i, 101, 7) - 0.5) * 0.16;
      const v = kd * 0.75 + hash2f(i, 211, 13) * 0.35;
      m.x[i] = clamp(u * 0.94 + 0.03, 0.015, 0.985);
      m.base[i] = clamp(Math.pow(v, 0.82), 0.02, 1);
      m.d[i] = m.base[i];
      m.eager[i] = 0.35 + hash2f(i, 401, 19) * 0.65;
    }
    this.marks = m;
    this.markCount = count;
    return m;
  }

  // volume is this tick's traded units, expected is what a settled pit does,
  // so the surge is a ratio and not a raw count.
  setSurge(volume, expected) {
    const want = clamp(volume / Math.max(1, expected), 0, 1.6);
    this.surge = this.surge + (want - this.surge) * (want > this.surge ? 0.45 : 0.08);
  }

  stepMarks(dt) {
    const m = this.marks;
    if (!m) return;
    const v = this.cfg.view;
    const up = this.reduced ? v.surgeEase * 0.4 : v.surgeEase;
    const back = this.reduced ? v.settle * 0.6 : v.settle;
    const k = Math.min(1, dt * 60);
    for (let i = 0; i < m.n; i++) {
      const target = clamp(m.base[i] * (1 - Math.min(0.8, this.surge * m.eager[i] * 0.75)), 0.02, 1);
      const rate = target < m.d[i] ? up : back;
      m.d[i] += (target - m.d[i]) * rate * k;
    }
  }

  // The floor, drawn to its own canvas when the crowd is being rendered at a
  // reduced scale. Thousands of little round-capped strokes are the whole cost
  // of a frame - measured, an empty floor held 60 and 2,600 marks took it to
  // 20 - and rasterising them into a smaller buffer and stretching it costs a
  // quarter of that. A crowd seen from a gallery is not sharp anyway.
  crowdTarget() {
    const scale = clamp(this.cfg.view.crowdScale, 0.25, 1);
    if (scale >= 1) return null;
    const w = Math.max(1, Math.round(this.W * scale));
    const h = Math.max(1, Math.round((this.floorBottom - this.railBottom) * scale));
    if (!this.floorCanvas || this.floorCanvas.width !== w || this.floorCanvas.height !== h) {
      this.floorCanvas = document.createElement('canvas');
      this.floorCanvas.width = w;
      this.floorCanvas.height = h;
      this.floorCtx = this.floorCanvas.getContext('2d');
    }
    this.floorCtx.clearRect(0, 0, w, h);
    return { ctx: this.floorCtx, scale };
  }

  drawCrowd(g) {
    const m = this.marks;
    if (!m) return;
    const v = this.cfg.view, p = this.cfg.palette;
    const target = this.crowdTarget();
    let offsetY = 0;
    if (target) {
      g = target.ctx;
      g.save();
      g.scale(target.scale, target.scale);
      offsetY = this.railBottom;
      g.translate(0, -offsetY);
    }
    const top = this.railBottom + 6, bot = this.floorBottom - 4;
    const cx = this.W * 0.5;
    const BANDS = 5;
    for (let b = 0; b < BANDS; b++) {
      const lo = b / BANDS, hi = (b + 1) / BANDS;
      const mid = (lo + hi) / 2;
      const a = lerp(0.46, 1.0, mid);
      const sc = lerp(v.markLenFar, v.markLen, mid);
      g.globalAlpha = a;
      g.strokeStyle = p.chalk;
      g.lineCap = 'round';
      g.lineWidth = lerp(1.2, 2.4, mid);
      g.beginPath();
      for (let i = 0; i < m.n; i++) {
        const d = m.d[i];
        if (d < lo || d >= hi) continue;
        const y = lerp(top, bot, d);
        const sx = cx + (m.x[i] - 0.5) * this.W * lerp(0.62, 1.0, d);
        g.moveTo(sx, y);
        g.lineTo(sx, y - sc);
      }
      g.stroke();
      // A head is a round cap on a zero length segment, and a round cap is the
      // most expensive thing on the floor. At the back of the room it is one
      // pixel wide and nobody can see it, so it is not drawn there.
      if (mid < v.headFrom) continue;
      g.lineWidth = lerp(2.2, 4.0, mid);
      g.beginPath();
      for (let i = 0; i < m.n; i++) {
        const d = m.d[i];
        if (d < lo || d >= hi) continue;
        const y = lerp(top, bot, d) - sc - sc * 0.24;
        const sx = cx + (m.x[i] - 0.5) * this.W * lerp(0.62, 1.0, d);
        g.moveTo(sx, y);
        g.lineTo(sx + 0.01, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    if (target) {
      g.restore();
      const out = this.ctx;
      out.imageSmoothingEnabled = true;
      out.drawImage(this.floorCanvas, 0, this.railBottom, this.W, this.floorBottom - this.railBottom);
    }
  }

  // --- written figures, with a ghost behind a change -----------------------

  // Draw a value that has a place on the board. When the text changes, the old
  // strokes stay as a ghost for a moment instead of being replaced outright.
  slot(g, id, text, x, y, size, o = {}) {
    text = String(text);
    let s = this.slots.get(id);
    if (!s) { s = { text, ghost: null, ghostAt: 0, size, x, y }; this.slots.set(id, s); }
    else if (s.text !== text) {
      // A sentence is not wiped and rewritten: two lines of prose laid over
      // each other are unreadable, and the ghost is for a FIGURE changing.
      s.ghost = o.ghost === false ? null : s.text;
      s.ghostAt = this.now; s.text = text; s.size = size; s.x = x; s.y = y;
    }
    const life = this.cfg.view.ghostSeconds;
    if (s.ghost !== null) {
      const age = (this.now - s.ghostAt) / 1000;
      if (age >= life) s.ghost = null;
      else {
        const a = (1 - age / life) * 0.34;
        this.hand.write(g, s.ghost, s.x, s.y, s.size, { ...o, colour: this.cfg.palette.ghost, alpha: a });
      }
    }
    return this.hand.write(g, text, x, y, size, o);
  }

  // --- the whole frame -----------------------------------------------------

  render(view, dt) {
    const g = this.ctx;
    this.now = view.now === undefined ? (typeof performance !== 'undefined' ? performance.now() : Date.now()) : view.now;
    this.frame++;
    if (!this.furniture) this.buildFurniture();
    if (!this.marks || this.markCount !== Math.min(view.crowd, this.cfg.view.marksMax)) this.buildMarks(view.crowd);
    this.setSurge(view.volume, view.expected);
    this.stepMarks(dt);

    g.save();
    g.scale(this.dpr, this.dpr);
    g.drawImage(this.furniture, 0, 0, this.W, this.H);
    this.drawCrowd(g);
    this.drawSlate(g, view);
    this.drawTape(g, view, dt);
    g.restore();
  }

  drawSlate(g, view) {
    const p = this.cfg.palette;
    const W = this.slateW, top = this.railTop;
    const pad = Math.max(16, Math.round(W * 0.022));
    const small = clamp(Math.round(top * 0.032), 11, 17);

    // Funds, top left, the largest thing on the wall after the price, with
    // what the pit has paid and what you are carrying under it.
    const fundsSize = clamp(Math.round(top * 0.105), 20, 52);
    let y = pad + small;
    this.slot(g, 'funds-label', this.content.labels.funds, pad, y, small, { colour: p.chalkDim, width: 0.9, ghost: false });
    y += fundsSize * 1.02;
    this.slot(g, 'funds', view.funds, pad, y, fundsSize, { colour: p.chalk });
    y += small * 1.6;
    this.slot(g, 'take', this.content.labels.take + ' ' + view.take, pad, y, small, { colour: p.chalkDim, width: 0.9 });
    y += small * 1.5;
    this.slot(g, 'pos', this.content.labels.position + ' ' + view.position, pad, y, small, { colour: p.red, width: 0.95 });
    this.slot(g, 'crowd', view.crowdText, W - pad, pad + small, small, { colour: p.chalkDim, align: 'right', width: 0.9, ghost: false });

    // The price, centred high, with the reason under it.
    const cx = this.portrait ? W * 0.42 : W * 0.47;
    const priceSize = clamp(Math.round(top * 0.19), 32, 100);
    const py = top * 0.36;
    this.slot(g, 'pit', view.pitName, cx, py - priceSize * 0.92, clamp(priceSize * 0.20, 12, 22), { colour: p.chalkDim, align: 'centre', width: 0.9, ghost: false });
    this.slot(g, 'price', view.price, cx, py, priceSize, { colour: p.chalk, align: 'centre' });
    const note = this.portrait ? small * 0.82 : small;
    this.slot(g, 'why', view.why, cx, py + small * 2.0, note, { colour: p.chalkDim, align: 'centre', width: 0.85, ghost: false });
    if (view.shock) this.slot(g, 'shock', view.shock, cx, py + small * 3.4, note, { colour: p.red, align: 'centre', width: 0.9, ghost: false });
    else this.slots.delete('shock');

    this.drawPriceLine(g, view, pad, top);
    this.drawLadder(g, view, W, top, small);
  }

  // The price, chalked as a line across the wall. Stable wobble by index, so
  // it is a drawn line rather than a jittering one.
  drawPriceLine(g, view, pad, top) {
    const h = view.history;
    if (!h || h.length < 3) return;
    const p = this.cfg.palette;
    const x0 = pad, x1 = this.slateW * 0.66;
    const y0 = top * 0.52, y1 = top * 0.70;
    let lo = Infinity, hi = -Infinity;
    for (const v of h) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!(hi > lo)) { hi = lo + 1; }
    const n = h.length;
    for (let pass = 0; pass < 2; pass++) {
      g.strokeStyle = p.chalk;
      g.globalAlpha = pass === 0 ? 0.85 : 0.3;
      g.lineWidth = pass === 0 ? 1.7 : 3.2;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const x = lerp(x0, x1, t) + (hash2f(i, pass, 61) - 0.5) * 1.6;
        const y = lerp(y1, y0, (h[i] - lo) / (hi - lo)) + (hash2f(i, pass, 71) - 0.5) * 1.8;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    const s = clamp(Math.round(top * 0.028), 10, 15);
    this.slot(g, 'hi', String(Math.round(hi)), x1 + 8, y0 + s * 0.4, s, { colour: p.ghost, width: 0.85 });
    this.slot(g, 'lo', String(Math.round(lo)), x1 + 8, y1 + s * 0.4, s, { colour: p.ghost, width: 0.85 });
  }

  // The depth ladder, chalked at the right of the slate: offers reaching right
  // above the spread, bids reaching left below it.
  drawLadder(g, view, W, top, small) {
    const p = this.cfg.palette;
    const d = view.depth;
    if (!d) return;
    const rows = this.portrait ? 4 : 6;
    const x = W * (this.portrait ? 0.84 : 0.80);
    const y0 = top * 0.14;
    const step = Math.max(13, small * 1.35);
    let maxQ = 1;
    for (const l of d.asks) maxQ = Math.max(maxQ, l.qty);
    for (const l of d.bids) maxQ = Math.max(maxQ, l.qty);
    const barW = W * 0.13;

    const row = (level, i, up) => {
      const y = up ? y0 + (rows - 1 - i) * step : y0 + (rows + 1 + i) * step;
      if (!level) { if (i === 0) this.slot(g, `lad-${up ? 'a' : 'b'}-none`, '-', x, y, small * 0.9, { colour: p.ghost, width: 0.8 }); return; }
      const w = (level.qty / maxQ) * barW;
      g.fillStyle = withAlpha(up ? p.chalkDim : p.chalkDim, 0.16);
      if (up) g.fillRect(x + small * 2.6, y - small * 0.8, w, small * 0.95);
      else g.fillRect(x + small * 2.6, y - small * 0.8, w, small * 0.95);
      this.slot(g, `lad-${up ? 'a' : 'b'}-${i}`, String(level.price), x + small * 2.3, y, small * 0.95, { colour: p.chalk, align: 'right', width: 0.85 });
      this.slot(g, `ladq-${up ? 'a' : 'b'}-${i}`, String(level.qty), x + small * 2.9, y, small * 0.85, { colour: p.chalkDim, width: 0.8 });
    };
    for (let i = 0; i < rows; i++) row(d.asks[i], i, true);
    for (let i = 0; i < rows; i++) row(d.bids[i], i, false);
    // The spread sits in the gap between the two halves.
    this.slot(g, 'lad-mid', view.spreadText, x + small * 2.3, y0 + rows * step, small * 0.95, { colour: p.red, align: 'right', width: 0.95 });
  }

  // The tape: small chalk prints running right to left along the bottom edge.
  drawTape(g, view, dt) {
    const p = this.cfg.palette;
    const y = this.floorBottom + (this.H - this.floorBottom) * 0.66;
    const size = clamp((this.H - this.floorBottom) * 0.30, 8, 12);
    if (!this.reduced) this.tapeOffset = (this.tapeOffset + dt * 26) % 1e7;
    let x = this.W - 10 - (this.reduced ? 0 : (this.tapeOffset % 40));
    const prints = view.tape || [];
    for (let i = 0; i < prints.length && x > -80; i++) {
      const t = prints[i];
      const text = `${t.price}x${t.qty}`;
      const w = this.hand.measure(text, size);
      const mine = t.buyer === -1 || t.seller === -1;
      this.hand.write(g, text, x - w, y, size, { colour: mine ? p.red : p.chalkDim, alpha: mine ? 1 : 0.62, width: 0.85 });
      x -= w + size * 1.7;
    }
  }
}

export default Board;
