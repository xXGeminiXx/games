// ---------------------------------------------------------------------------
// The picture: a market hall seen from the gallery.
//
// Three bands down the window. The slate fills the top and carries the figures
// - the purse, the going rate, the price line and the two prices written on
// it - all drawn in chalk strokes by src/chalk.js. A worn timber rail crosses
// under it. Everything below the rail is the crowd.
//
// THE FLOOR IS A READOUT. The people who want to buy stand on the left of the
// room and the people who want to sell stand on the right, and each side holds
// as many bodies as that side of the market is actually resting. A player who
// reads no numbers at all can see the room tip before the price moves. Arms go
// up on the side that is trading, which is what the game is named after.
//
// WHAT IS DRAWN ONCE AND WHAT IS DRAWN EVERY FRAME. The room itself - the
// slate wash, the chalk dust, the old score lines, the clerestory beam, the
// timber of the rail, the floor's fall-off - never changes between resizes, so
// it is rendered to its own canvas and stamped.
//
// Every figure is drawn in one of a handful of depth bands, and each band is
// three batched strokes - bodies, heads, arms - instead of three calls per
// person.
//
// GHOSTS. A figure that changes is not cross-faded and does not slide. The old
// strokes stay where they were, greyed, and fade over a couple of seconds
// while the new ones are written over them. That wipe and the money thrown up
// the wall after a trade are the only two animations on the slate.
// ---------------------------------------------------------------------------

import { createHand } from './chalk.js?v=6';
import { alpha as withAlpha } from './oklch.js?v=6';
import { hash2f } from './rng.js?v=6';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// The least of the wall the going rate's own walk is allowed to have. Below
// this the walk is a straight line and the picture says nothing.
const WALK_SHARE = 0.45;

export class Board {
  constructor(canvas, cfg, content) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cfg = cfg;
    this.content = content;
    this.hand = createHand(cfg.chalk);
    this.crowd = null;
    this.shown = { buy: 0, sell: 0 };   // figures actually on the floor, eased
    this.heat = { buy: 0, sell: 0 };    // how many arms are up on each side
    this.pops = [];
    this.furniture = null;
    this.W = 0; this.H = 0; this.dpr = 1;
    this.inset = { right: 0 };
    this.slots = new Map();      // id -> { text, ghost, ghostAt }
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.frame = 0;
    this.now = 0;
  }

  // --- layout --------------------------------------------------------------

  resize(w, h, dpr) {
    const d = Math.min(this.cfg.view.maxDpr, dpr || 1);
    if (w === this.W && h === this.H && d === this.dpr) return false;
    this.W = w; this.H = h; this.dpr = d;
    this.canvas.width = Math.max(1, Math.round(w * d));
    this.canvas.height = Math.max(1, Math.round(h * d));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.layout();
    this.furniture = null;
    this.hand.clear();
    this.crowd = null;
    return true;
  }

  // WHICH LAYOUT, and why it is not measured off the canvas. On a phone the
  // board is a band across the top of a page that scrolls, so the canvas comes
  // out 390 by 371 - wider than it is tall - and a check on its own shape puts
  // the wide layout on a phone, with a desk band at the bottom that nothing
  // ever draws in. The page decides, and it tells the board.
  layout() {
    const v = this.cfg.view, portrait = this.narrow === undefined ? this.H > this.W : this.narrow;
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

  setNarrow(on) {
    if (this.narrow === on) return;
    this.narrow = on;
    this.layout();
    this.furniture = null;
    this.crowd = null;
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
    g.strokeStyle = withAlpha(p.ghost, 0.11);
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

    // The aisle down the middle of the room, between the two halves of the
    // crowd. It is the only thing that says the split is a split and not a
    // gap in a scatter.
    const gap = this.cfg.view.crowdGap;
    const aisle = g.createLinearGradient(W * (0.5 - gap * 0.9), 0, W * (0.5 + gap * 0.9), 0);
    aisle.addColorStop(0, withAlpha(p.slateDeep, 0));
    aisle.addColorStop(0.5, withAlpha(p.slateDeep, 0.42));
    aisle.addColorStop(1, withAlpha(p.slateDeep, 0));
    g.fillStyle = aisle;
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

    // TWO WORDS THAT MAKE THE ROOM A READOUT. Without them the split is a
    // pattern; with them it is the one thing on screen that says which way the
    // price is about to go. They are burnt into the timber, because a word
    // written on the back wall of the room has people standing in front of it.
    const size = clamp(Math.round(this.railTop * 0.045), 15, 22);
    const ty = this.railTop - size * 0.55;
    const lab = this.content.labels;
    this.hand.write(g, lab.buyers, this.slateW * 0.25, ty, size, { colour: p.dust, align: 'centre', width: 0.95, alpha: 0.85 });
    this.hand.write(g, lab.sellers, this.slateW * 0.75, ty, size, { colour: p.dust, align: 'centre', width: 0.95, alpha: 0.85 });

    // A shadow the rail casts down onto the floor.
    const cast = g.createLinearGradient(0, this.railBottom, 0, this.railBottom + 34);
    cast.addColorStop(0, withAlpha(p.slateDeep, 0.7));
    cast.addColorStop(1, withAlpha(p.slateDeep, 0));
    g.fillStyle = cast;
    g.fillRect(0, this.railBottom, W, 34);

    // The desk across the front, where your own hands are. Everything the
    // player touches sits on this and nothing is drawn behind it.
    if (this.floorBottom < H) {
      const deep = g.createLinearGradient(0, this.floorBottom - 26, 0, this.floorBottom + 6);
      deep.addColorStop(0, withAlpha(p.slateDeep, 0));
      deep.addColorStop(1, withAlpha(p.slateDeep, 0.92));
      g.fillStyle = deep;
      g.fillRect(0, this.floorBottom - 26, W, 32);
      g.fillStyle = p.slateDeep;
      g.fillRect(0, this.floorBottom, W, H - this.floorBottom);
      g.strokeStyle = withAlpha(p.timber, 0.55);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, this.floorBottom + 1);
      g.lineTo(W, this.floorBottom + 1);
      g.stroke();
    }

    this.furniture = c;
  }

  // --- the crowd -----------------------------------------------------------

  // One pool of standing places per side, built once at the biggest the floor
  // ever gets. A side with fewer people shows the first N of its pool, so a
  // crowd that grows fills in around the people already standing there rather
  // than shuffling everybody to a new spot.
  buildCrowd() {
    const n = this.cfg.view.crowdMax;
    const side = (salt) => {
      const s = { x: new Float32Array(n), base: new Float32Array(n), d: new Float32Array(n), phase: new Float32Array(n) };
      for (let i = 0; i < n; i++) {
        // People stand in knots, not on a grid. Each place belongs to one of a
        // couple of dozen knots and sits near its middle.
        const knot = i % 26;
        const kx = hash2f(knot, salt + 7, 3);
        const kd = hash2f(knot, salt + 11, 5);
        const u = kx + (hash2f(i, salt + 101, 7) - 0.5) * 0.22;
        const v = kd * 0.78 + hash2f(i, salt + 211, 13) * 0.30;
        s.x[i] = clamp(u, 0.02, 0.98);
        s.base[i] = clamp(v / 1.08, 0.03, 1);
        s.d[i] = s.base[i];
        s.phase[i] = hash2f(i, salt + 401, 19);
      }
      return s;
    };
    this.crowd = { buy: side(0), sell: side(900) };
  }

  // How many bodies each side should be showing, and how many arms are up.
  // buy and sell are units the crowd has resting; expected is what a settled
  // market of this size rests, so a busy room is a full one.
  setFloor(buy, sell, crowd, volume) {
    const v = this.cfg.view;
    // How many bodies a side shows is that side's own share of the buying and
    // selling, against what a busy half-room is worth, so the floor fills the
    // same way in a market of two hundred and one of two thousand. Each side is
    // counted on its own: when one of them stops trading, half the room walks
    // out, and that is the reading the whole picture exists to give.
    //
    // The square root is what makes it worth looking at. Trading swings from
    // nothing to several hundred inside a minute, and counting bodies straight
    // off it leaves the floor either empty or jammed with nothing in between.
    const norm = Math.max(1, crowd * v.flowPerSide);
    const span = v.crowdMax - v.crowdMin;
    const want = {
      buy: v.crowdMin + span * clamp(Math.sqrt(buy / norm), 0, 1),
      sell: v.crowdMin + span * clamp(Math.sqrt(sell / norm), 0, 1),
    };
    for (const k of ['buy', 'sell']) this.shown[k] += (want[k] - this.shown[k]) * 0.06;

    const total = buy + sell;
    const share = total > 0 ? buy / total : 0.5;
    const hot = clamp(volume / Math.max(1, crowd * v.tradePerTrader), 0, 1);
    for (const k of ['buy', 'sell']) {
      const target = hot * clamp((k === 'buy' ? share : 1 - share) * 1.6, 0, 1);
      this.heat[k] += (target - this.heat[k]) * (target > this.heat[k] ? 0.35 : 0.05);
    }
  }

  stepCrowd(dt) {
    if (!this.crowd) return;
    const v = this.cfg.view;
    const k = Math.min(1, dt * 60);
    for (const name of ['buy', 'sell']) {
      const s = this.crowd[name];
      const press = this.heat[name] * v.lean;
      const up = this.reduced ? v.surgeEase * 0.4 : v.surgeEase;
      const back = this.reduced ? v.settle * 0.6 : v.settle;
      for (let i = 0; i < s.d.length; i++) {
        const target = clamp(s.base[i] * (1 - press), 0.02, 1);
        const rate = target < s.d[i] ? up : back;
        s.d[i] += (target - s.d[i]) * rate * k;
      }
    }
  }

  // One half of the room. from and to are the fractions of the window this
  // side stands between; arms are raised toward the aisle.
  drawSide(g, s, count, from, to, heat, armDir) {
    const v = this.cfg.view, p = this.cfg.palette;
    const top = this.railBottom + 8, bot = this.floorBottom - 6;
    const x0 = this.slateW * from, x1 = this.slateW * to;
    const BANDS = 4;
    const t = this.now / 1000;
    for (let b = 0; b < BANDS; b++) {
      const lo = b / BANDS, hi = (b + 1) / BANDS, mid = (lo + hi) / 2;
      const h = lerp(v.figureFar, v.figureNear, mid);
      g.globalAlpha = lerp(0.42, 1.0, mid);
      g.strokeStyle = p.chalk;
      g.lineCap = 'round';

      // Bodies: hip to shoulder.
      g.lineWidth = Math.max(1.1, h * 0.11);
      g.beginPath();
      for (let i = 0; i < count; i++) {
        const d = s.d[i];
        if (d < lo || d >= hi) continue;
        const y = lerp(top, bot, d);
        const x = lerp(x0, x1, s.x[i]);
        g.moveTo(x, y - h * 0.30);
        g.lineTo(x, y - h * 0.66);
      }
      g.stroke();

      // Legs, splayed off the hip. This is the whole difference between a
      // person and a pin, and it only costs anything at the front of the room.
      if (mid >= v.legsFrom) {
        g.lineWidth = Math.max(1, h * 0.085);
        g.beginPath();
        for (let i = 0; i < count; i++) {
          const d = s.d[i];
          if (d < lo || d >= hi) continue;
          const y = lerp(top, bot, d);
          const x = lerp(x0, x1, s.x[i]);
          const w = h * (0.09 + (s.phase[i] - 0.5) * 0.05);
          g.moveTo(x, y - h * 0.31);
          g.lineTo(x - w, y);
          g.moveTo(x, y - h * 0.31);
          g.lineTo(x + w, y);
        }
        g.stroke();
      }

      // Heads: a round cap on a zero length stroke, sitting on the shoulders.
      g.lineWidth = h * 0.23;
      g.beginPath();
      for (let i = 0; i < count; i++) {
        const d = s.d[i];
        if (d < lo || d >= hi) continue;
        const y = lerp(top, bot, d) - h * 0.76;
        const x = lerp(x0, x1, s.x[i]);
        g.moveTo(x, y);
        g.lineTo(x + 0.01, y);
      }
      g.stroke();

      // Arms. A figure has its arm up while its own slot in the cycle is
      // inside the share of the crowd that is trading, so the hands go up in
      // ones and twos across the room instead of all together.
      if (heat > 0.02) {
        g.lineWidth = Math.max(1, h * 0.085);
        g.beginPath();
        let any = false;
        for (let i = 0; i < count; i++) {
          const d = s.d[i];
          if (d < lo || d >= hi) continue;
          const slot = (t * 0.9 + s.phase[i]) % 1;
          if (slot > heat * v.armShare) continue;
          any = true;
          const y = lerp(top, bot, d);
          const x = lerp(x0, x1, s.x[i]);
          g.moveTo(x, y - h * 0.60);
          g.lineTo(x + armDir * h * 0.30, y - h * 1.02);
        }
        if (any) g.stroke();
      }
    }
    g.globalAlpha = 1;
  }

  // THE FLOOR IS DRAWN ON ITS OWN CANVAS AND STAMPED. Six hundred figures is
  // sixteen batched strokes and a few thousand round caps, and it was most of
  // what a frame cost. Nothing down there moves fast: the counts ease at six
  // hundredths a frame and an arm is up for half a second, so the room is
  // redrawn a few times a second and the frames in between stamp the last one.
  drawCrowd(g) {
    const every = this.cfg.view.crowdRedrawMs;
    const band = this.floorBottom - this.railBottom;
    if (band <= 0) return;
    const w = Math.max(1, Math.round(this.W * this.dpr));
    const h = Math.max(1, Math.round(band * this.dpr));
    if (!this.floorBuf || this.floorBuf.width !== w || this.floorBuf.height !== h) {
      this.floorBuf = document.createElement('canvas');
      this.floorBuf.width = w;
      this.floorBuf.height = h;
      this.floorCtx = this.floorBuf.getContext('2d');
      this.crowdAt = -1e9;
    }
    if (this.now - this.crowdAt >= every) {
      this.crowdAt = this.now;
      const fg = this.floorCtx;
      fg.setTransform(1, 0, 0, 1, 0, 0);
      fg.clearRect(0, 0, w, h);
      fg.setTransform(this.dpr, 0, 0, this.dpr, 0, -this.railBottom * this.dpr);
      this.paintCrowd(fg);
    }
    g.drawImage(this.floorBuf, 0, this.railBottom, this.W, band);
  }

  paintCrowd(g) {
    if (!this.crowd) this.buildCrowd();
    const v = this.cfg.view, p = this.cfg.palette;
    const half = v.crowdGap / 2;
    // How many bodies a half-room can hold is how wide it is. The same count
    // that reads as a packed floor at twelve hundred pixels is a solid block
    // of chalk at four hundred.
    const room = clamp(this.slateW / 1000, 0.34, 1);
    const cap = Math.max(v.crowdMin, Math.round(v.crowdMax * room));
    const nBuy = Math.round(clamp(this.shown.buy, 0, cap));
    const nSell = Math.round(clamp(this.shown.sell, 0, cap));
    // TWO WORDS THAT MAKE THE ROOM A READOUT. Without them the split is a
    // pattern; with them it is the one thing on screen that says which way the
    // price is about to go. They go on before the crowd does, so they read as
    // painted on the back wall with people standing in front of them.
    this.drawSide(g, this.crowd.buy, nBuy, 0.015, 0.5 - half, this.heat.buy, 1);
    this.drawSide(g, this.crowd.sell, nSell, 0.5 + half, 0.985, this.heat.sell, -1);
    void half;
  }

  // --- money thrown up the wall -------------------------------------------

  // What a trade paid, written over the rail where it happened and gone in a
  // second. Nothing else on the slate moves by itself.
  pop(text, side) {
    const v = this.cfg.view;
    const lane = side === 'buy' ? 0.44 : 0.56;
    // Two pops in a row must not land on the same spot, and the scatter comes
    // off the counter rather than a live generator so nothing in the game
    // reaches for randomness the run does not own.
    this.popN = (this.popN || 0) + 1;
    const jog = (hash2f(this.popN, side === 'buy' ? 5 : 9, 313) - 0.5) * 0.17;
    this.pops.push({ text, x: this.slateW * (lane + jog), at: this.now });
    while (this.pops.length > v.popMax) this.pops.shift();
  }

  drawPops(g) {
    if (!this.pops.length) return;
    const v = this.cfg.view, p = this.cfg.palette;
    const life = v.popSeconds * 1000;
    const size = clamp(Math.round(this.railTop * 0.052), 16, 30);
    const base = this.railBottom + 34;
    let kept = 0;
    for (const q of this.pops) {
      const age = (this.now - q.at) / life;
      if (age >= 1) continue;
      this.pops[kept++] = q;
      const y = base - v.popRise * age;
      if (y < 0) continue;
      const a = age < 0.15 ? age / 0.15 : 1 - (age - 0.15) / 0.85;
      this.hand.write(g, q.text, q.x, y, size, { colour: p.red, align: 'centre', alpha: clamp(a, 0, 1) });
    }
    this.pops.length = kept;
  }

  // --- written figures, with a ghost behind a change -----------------------

  // Draw a value that has a place on the board. When the text changes, the old
  // strokes stay as a ghost for a moment instead of being replaced outright.
  slot(g, id, text, x, y, size, o = {}) {
    text = String(text);
    let s = this.slots.get(id);
    if (!s) { s = { text, ghost: null, ghostAt: 0, size, x, y }; this.slots.set(id, s); }
    else if (s.text !== text) {
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
    if (!this.crowd) this.buildCrowd();
    this.setFloor(view.buyPressure, view.sellPressure, view.crowd, view.volume);
    this.stepCrowd(dt);

    g.save();
    g.scale(this.dpr, this.dpr);
    g.drawImage(this.furniture, 0, 0, this.W, this.H);
    this.drawCrowd(g);
    this.drawSlate(g, view);
    this.drawPops(g);
    g.restore();
  }

  // WHERE EVERYTHING ON THE WALL SITS, as a share of the height down to the
  // rail. The page positions its sentences off the same fractions, so a line
  // of type and a written figure never land on each other.
  drawSlate(g, view) {
    const p = this.cfg.palette;
    const W = this.slateW, top = this.railTop;
    const pad = Math.max(16, Math.round(W * 0.024));

    // The purse, top left, the biggest figure on the wall after the rate.
    const label = clamp(Math.round(top * 0.042), 15, 20);
    const purseSize = clamp(Math.round(top * 0.125), 26, 60);
    this.slot(g, 'purse-label', this.content.labels.purse, pad, top * 0.075, label, { colour: p.chalkDim, width: 0.9, ghost: false });
    this.slot(g, 'purse', view.purse, pad, top * 0.075 + purseSize * 1.02, purseSize, { colour: p.chalk });

    // The going rate, centred, with the name of the market small above it.
    const cx = W * 0.5;
    const rateSize = clamp(Math.round(top * 0.20), 34, 100);
    const nameSize = clamp(Math.round(top * 0.048), 15, 24);
    this.slot(g, 'pit', view.pitName, cx, top * 0.085, nameSize, { colour: p.chalkDim, align: 'centre', width: 0.95, ghost: false });
    this.slot(g, 'rate', view.rate, cx, top * 0.085 + rateSize * 1.02, rateSize, { colour: p.chalk, align: 'centre' });

    this.drawPriceLine(g, view, pad, top);
  }

  // THE PICTURE THAT IS THE GAME. The going rate is chalked as a line walking
  // left to right across the wall, and the two prices on your board are two
  // straight lines laid over it in your own red chalk. While the walk stays
  // between them you are being traded with on both sides and keeping the gap.
  // When it climbs over the top line or falls under the bottom one, one side
  // of your board is being taken and the other is dead, and you can see that
  // without reading a number.
  drawPriceLine(g, view, pad, top) {
    const h = view.history;
    if (!h || h.length < 3) return;
    const p = this.cfg.palette;
    const c = this.content.labels;
    const s = clamp(Math.round(top * 0.036), 14, 19);
    const tight = this.slateW < 620;
    const pay = tight ? c.payShort : c.pay;
    const charge = tight ? c.chargeShort : c.charge;
    const labelRoom = this.hand.measure(charge + ' 0000', s) + s;
    const x0 = pad, x1 = Math.max(pad + 60, this.slateW - pad - labelRoom);
    // The two words naming the halves of the room go on the wall just above the
    // rail on a wide board. A narrow one has no wall left there - the price
    // labels are already sitting in it - so the chart stops higher.
    const y0 = top * 0.47, y1 = top * (this.portrait ? 0.84 : 0.93);

    // The window holds the walk and your own two prices. THE WALK KEEPS A
    // FLOOR ON THE WALL: stretching the window far enough to reach a board the
    // price has run away from flattens the walk into a straight line, and that
    // is the exact moment the walk is worth looking at. Past the floor the two
    // red rules go to the edge instead, hard against it, which is what being
    // off the board looks like.
    let walkLo = Infinity, walkHi = -Infinity;
    for (const v of h) { if (v < walkLo) walkLo = v; if (v > walkHi) walkHi = v; }
    let lo = walkLo, hi = walkHi;
    if (view.showQuote) { lo = Math.min(lo, view.bid); hi = Math.max(hi, view.ask); }
    const pad10 = Math.max(1, (hi - lo) * 0.12);
    lo -= pad10; hi += pad10;
    if (!(hi > lo)) hi = lo + 1;
    const walkSpan = Math.max(1, (walkHi - walkLo) * 1.24);   // the walk, with the same margin
    if (walkSpan / (hi - lo) < WALK_SHARE) {
      const middle = (walkHi + walkLo) / 2;
      const half = walkSpan / (2 * WALK_SHARE);
      lo = middle - half; hi = middle + half;
    }
    const yOf = (v) => lerp(y1, y0, clamp((v - lo) / (hi - lo), 0, 1));

    // Your two prices, ruled across the whole wall in red.
    if (view.showQuote) {
      // On a short wall the two prices are a few pixels apart and their names
      // land on top of each other, and a board the price has run away from
      // puts both of them on the same edge. The pair is pushed apart far enough
      // to be read and then slid back inside the wall, keeping what you charge
      // above what you pay.
      const need = s * 1.25;
      let ya = yOf(view.ask), yb = yOf(view.bid);
      if (yb - ya < need) { const m = (ya + yb) / 2; ya = m - need / 2; yb = m + need / 2; }
      if (ya < y0) { const d = y0 - ya; ya += d; yb += d; }
      if (yb > y1) { const d = yb - y1; ya -= d; yb -= d; }
      const at = { ask: ya, bid: yb };
      for (const [key, price, text] of [['ask', view.ask, charge], ['bid', view.bid, pay]]) {
        const y = at[key];
        g.strokeStyle = p.red;
        g.globalAlpha = 0.5;
        g.lineWidth = 1.4;
        g.setLineDash([7, 6]);
        g.beginPath();
        g.moveTo(x0, y);
        g.lineTo(x1 + s * 0.5, y);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
        this.slot(g, 'q-' + key, `${text} ${price}`, x1 + s, at[key] + s * 0.36, s, { colour: p.red, width: 0.95 });
      }
    }

    // The walk itself, laid down twice: a line and a softer one under it.
    const n = h.length;
    for (let pass = 0; pass < 2; pass++) {
      g.strokeStyle = p.chalk;
      g.globalAlpha = pass === 0 ? 0.92 : 0.28;
      g.lineWidth = pass === 0 ? 1.8 : 3.4;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const x = lerp(x0, x1, t) + (hash2f(i, pass, 61) - 0.5) * 1.4;
        const y = yOf(h[i]) + (hash2f(i, pass, 71) - 0.5) * 1.6;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;

    // The head of the walk, so the eye knows which end is now.
    const hy = yOf(h[n - 1]);
    g.fillStyle = p.chalk;
    g.beginPath();
    g.arc(x1, hy, 3.2, 0, Math.PI * 2);
    g.fill();
  }
}

export default Board;
