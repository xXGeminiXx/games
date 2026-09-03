// ---------------------------------------------------------------------------
// The picture: a forest floor seen from directly above, in daylight.
//
// Warm loam with leaf litter and moss, logs lying where they fell, damp
// patches of bare soil, living trees as canopy discs, and the organism itself
// as a pale lace of mycelium spreading across all of it, brightest where it
// has just grown. The ground that has been bought is the lit clearing;
// everything past it lies under mist. In winter the floor goes to dusk, frost
// lies on the litter, snow gathers along the logs, and the lace glows.
//
// What the world does to the organism is on the floor as well. A wedge that
// has burned lies under ash and char, its logs husks and its trees black
// snags with charred heartwood at the foot, all of it fading back toward
// ordinary ground as the mark ages. Another fungus holds ground of its own in
// a dark matted lace that is nothing like ours. A drought takes the litter
// pale and grey, browns the moss off and lightens the damp patches. A log the
// wind has just brought down shows fresh pale wood until the threads find it.
//
// The floor texture is the expensive part of that and it does not change from
// frame to frame, so it is drawn once into an offscreen canvas - per season,
// camera scale, canvas size, level, burn and drought - and blitted. A frame
// after that costs the threads, the nodes and the tips and nothing else. A
// burn's fade is quantised into a few steps for that key, so ageing ground
// costs a handful of redraws over the life of the mark rather than one a
// frame.
//
// Nothing here writes to the simulation. Nothing is kept between frames but
// the eased camera, the floor texture and a short record of when threads
// arrived, so a save restores the same picture.
// ---------------------------------------------------------------------------

import { seasonOf } from './season.js?v=12';
import { noise } from './world.js?v=12';
import { hash, unit } from './rng.js?v=12';
import { angleGap, burntSet } from './events.js?v=12';

const TAU = Math.PI * 2;
const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * A palette colour at an alpha, for a gradient stop. The colour itself always
 * comes from the palette; only its transparency is decided here.
 */
function rgba(colour, a) {
  const s = typeof colour === 'string' ? colour.trim() : '';
  let r = 0, g = 0, b = 0;
  if (/^#[0-9a-fA-F]{6}$/.test(s)) {
    r = parseInt(s.slice(1, 3), 16);
    g = parseInt(s.slice(3, 5), 16);
    b = parseInt(s.slice(5, 7), 16);
  } else if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    r = parseInt(s[1] + s[1], 16);
    g = parseInt(s[2] + s[2], 16);
    b = parseInt(s[3] + s[3], 16);
  } else {
    return s || 'rgba(0,0,0,0)';
  }
  const alpha = ok(a) ? clamp01(a) : 1;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha.toFixed(3) + ')';
}

/**
 * What a season does to the floor.
 *
 * Every colour named here is resolved out of the palette, which is the only
 * place a colour is written; a season is a choice among those colours and a
 * set of strengths, nothing more.
 */
export function seasonLook(cfg, index) {
  const P = cfg.palette || {};
  const list = (cfg.view && cfg.view.seasons) || [];
  const i = Math.max(0, Math.min(list.length - 1, Math.floor(index) || 0));
  const S = list[i] || {};
  const col = (token, fallback) => {
    const c = P[token];
    return typeof c === 'string' ? c : (typeof P[fallback] === 'string' ? P[fallback] : '#000000');
  };
  const num = (v, fallback) => (ok(v) ? v : fallback);
  const litter = (Array.isArray(S.litter) && S.litter.length ? S.litter : ['litter'])
    .map((token) => col(token, 'litter'));
  return {
    index: i,
    ground:     col(S.ground, 'loamLight'),
    shade:      col(S.shade, 'damp'),
    moss:       col(S.moss, 'mossFloor'),
    damp:       col(S.damp, 'damp'),
    wash:       col(S.wash, 'loam'),
    veil:       col(S.veil, 'mist'),
    frost:      col(S.frost, 'frost'),
    snow:       col(S.snow, 'snow'),
    lace:       col(S.lace, 'lace'),
    glow:       col(S.glow, 'glow'),
    litter,
    litterPer:   num(S.litterPer, 2),
    litterAlpha: num(S.litterAlpha, 0.45),
    mossAlpha:   num(S.mossAlpha, 0.5),
    dampAlpha:   num(S.dampAlpha, 0.55),
    washAlpha:   num(S.washAlpha, 0),
    veilAlpha:   num(S.veilAlpha, 0.75),
    frostPer:    num(S.frostPer, 0),
    snowAlpha:   num(S.snowAlpha, 0),
    laceAlpha:   num(S.laceAlpha, 1),
    glowAll:     num(S.glowAll, 0),
  };
}

/** One reusable soft blob per colour, placed by translate and scale. */
function gradPool(context) {
  const map = new Map();
  return (colour, ox, oy, inner) => {
    if (!context || typeof context.createRadialGradient !== 'function') return colour;
    const key = colour + '|' + ox + '|' + oy + '|' + inner;
    let g = map.get(key);
    if (g === undefined) {
      try {
        g = context.createRadialGradient(ox, oy, inner, 0, 0, 1);
        g.addColorStop(0, rgba(colour, 1));
        g.addColorStop(1, rgba(colour, 0));
      } catch (e) {
        g = colour;
      }
      map.set(key, g);
    }
    return g;
  };
}

export function createView(canvas, cfg, doc) {
  const ctx = canvas.getContext('2d');
  const P = cfg.palette;
  const V = cfg.view;
  const D = doc || (typeof document !== 'undefined' ? document : null);

  let W = 300, H = 150, dpr = 1;
  let inset = { left: 0, right: 0, top: 0, bottom: 0 };
  let px = null;                 // screen pixels per cell, eased
  let seenLevel = -1;
  let fold = 1e6;                // seconds since the last level folded
  let marks = [];                // [sim time, thread count], for what is newly grown

  // The floor, drawn once and blitted.
  let tex = null, texCtx = null, texKey = '', texScale = 1, texCx = 0, texCy = 0;

  const paint = gradPool(ctx);
  let texPaint = null;

  /** A colour named under `view`, resolved out of the palette. */
  const col = (token, fallback) => {
    const c = P[token];
    return typeof c === 'string' ? c : (typeof P[fallback] === 'string' ? P[fallback] : '#000000');
  };
  const num = (v, fallback) => (ok(v) ? v : fallback);

  // -- what the world has done to the ground --------------------------------

  /**
   * The burnt wedge in the numbers the picture needs: where it lies, and how
   * much of the mark is left. The fade is quantised into a few steps so an
   * ageing burn redraws the floor a handful of times over its life instead of
   * once a frame.
   */
  const burnOf = (state) => {
    const e = state.events;
    const b = e && e.burn;
    if (!b || !Array.isArray(b.nodes) || !b.nodes.length) return null;
    const fire = (cfg.events && cfg.events.fire) || {};
    const life = Math.max(1, num(fire.markSeconds, 1));
    const steps = Math.max(1, Math.round(num(V.burn.fadeSteps, 5)));
    const left = clamp01((num(b.until, 0) - state.t) / life);
    const fade = Math.ceil(left * steps) / steps;
    if (!(fade > 0)) return null;
    return {
      angle: num(b.angle, 0),
      half: Math.max(0, num(b.half, 0)),
      from: Math.max(0, num(b.from, 0)),
      to: Math.max(0, state.ring * cfg.world.ringWidth),
      fade,
      nodes: burntSet(state),
    };
  };

  /**
   * How scorched a point of ground is, in cells from the origin: 0 outside the
   * wedge, up to 1 well inside a fresh one. The edges are soft, so the burn
   * meets the ordinary floor the way a fire's edge does rather than at a line.
   */
  const burnAt = (burn, x, y) => {
    if (!burn) return 0;
    const gap = angleGap(Math.atan2(y, x), burn.angle);
    const wide = Math.max(1e-6, num(V.burn.softenAngle, 0.2));
    const side = clamp01((burn.half - gap) / wide);
    if (side <= 0) return 0;
    const soft = Math.max(1e-6, num(V.burn.soften, 1));
    const r = Math.hypot(x, y);
    const near = clamp01((r - burn.from) / soft);
    const far = clamp01((burn.to - r) / soft);
    return side * Math.min(near, far) * burn.fade;
  };

  /**
   * The floor with the rain held off: a share of the litter goes to the dry
   * colour, the moss browns off and thins, and the damp patches lighten.
   * Everything else about the season is left alone.
   */
  const dryLook = (look) => {
    const Dr = V.drought;
    const mix = clamp01(num(Dr.mix, 0.5));
    const litter = look.litter.slice();
    const add = Math.round((litter.length * mix) / Math.max(0.05, 1 - mix));
    for (let k = 0; k < add; k++) litter.push(col(Dr.litter, 'dead'));
    return Object.assign({}, look, {
      litter,
      moss: col(Dr.moss, 'litter'),
      mossAlpha: look.mossAlpha * (1 - mix),
      dampAlpha: look.dampAlpha * (1 - mix),
    });
  };

  // -- the frame the picture is fitted into ---------------------------------

  const readInset = (v) => {
    if (!v || typeof v !== 'object') return null;
    const n = (x) => (ok(x) && x > 0 ? x : 0);
    return { left: n(v.left), right: n(v.right), top: n(v.top), bottom: n(v.bottom) };
  };

  /**
   * The rectangle the picture has to itself. The interface is docked over one
   * edge of the canvas, so the organism is centred in what is left of it
   * rather than in the middle of the window, where the journal would cover it.
   */
  const frame = () => {
    let x0 = inset.left, x1 = W - inset.right;
    let y0 = inset.top, y1 = H - inset.bottom;
    if (!(x1 - x0 > 16)) { x0 = 0; x1 = W; }
    if (!(y1 - y0 > 16)) { y0 = 0; y1 = H; }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  };

  /**
   * Size the bitmap. The element's CSS size stays 100% of its host so the host
   * can shrink; an inline width would hold the old size and the floor could
   * never get narrower than it once was. An inset given here is remembered
   * until another is given, so a plain resize cannot quietly slide the
   * organism back under the journal.
   */
  const resize = (w, h, ratio, ins) => {
    W = Math.max(1, Math.floor(ok(w) ? w : W));
    H = Math.max(1, Math.floor(ok(h) ? h : H));
    dpr = ok(ratio) && ratio > 0 ? ratio : 1;
    const next = readInset(ins);
    if (next) inset = next;
    canvas.width = Math.max(1, Math.floor(W * dpr));
    canvas.height = Math.max(1, Math.floor(H * dpr));
    // Every stamp was drawn for the old pixel ratio and the old frame.
    sprites.clear();
    texKey = '';
  };

  const targetScale = (state) => {
    const f = frame();
    // The reach, plus the ground kept in view past it - but never closer in
    // than cellsMin, so the ground the next ring will open is already on the
    // screen and a log is a log rather than a wall.
    const extent = Math.max(1, state.ring * cfg.world.ringWidth + V.pad) * V.margin;
    return Math.min(f.w, f.h) / (2 * Math.max(extent, num(V.cellsMin, 0)));
  };

  // -- the floor ------------------------------------------------------------

  /**
   * The camera scale the texture is drawn at: the current scale rounded down
   * to a step, so easing the camera does not redraw the floor every frame. The
   * blit stretches the difference, which is never more than one step.
   */
  const quantise = (s) => {
    const step = V.floor.scaleStep > 1.001 ? V.floor.scaleStep : 1.1;
    const k = Math.floor(Math.log(Math.max(1e-4, s)) / Math.log(step));
    const q = Math.pow(step, k);
    return ok(q) && q > 1e-4 ? q : Math.max(1e-4, s);
  };

  /** A small mark on the floor: a leaf, a needle, a splinter of frost. */
  const mark = (g, x, y, a, len, wide, colour, alpha) => {
    if (!ok(x) || !ok(y) || !ok(a) || !(len > 0) || !(wide > 0)) return;
    const c = Math.cos(a), s = Math.sin(a);
    g.globalAlpha = alpha;
    g.fillStyle = colour;
    g.setTransform(dpr * c, dpr * s, -dpr * s, dpr * c, dpr * x, dpr * y);
    g.fillRect(-len / 2, -wide / 2, len, wide);
  };

  /**
   * A soft round patch of colour, from the pool of reusable gradients. `core`
   * is how much of it is solid before the edge starts to fade, and (ox, oy)
   * moves that solid part off centre, which is what gives a canopy a lit side.
   */
  const blob = (g, pool, colour, x, y, r, alpha, ox, oy, core) => {
    if (!ok(x) || !ok(y) || !(r > 0) || !(alpha > 0)) return;
    g.save();
    g.globalAlpha = clamp01(alpha);
    g.fillStyle = pool(colour, ox || 0, oy || 0, core || 0);
    g.translate(x, y);
    g.scale(r, r);
    g.fillRect(-1, -1, 2, 2);
    g.restore();
  };

  /**
   * Draw the floor for one season at one camera scale: the ground tone, the
   * moss, the litter, the damp patches where the bare soil is, and, in winter,
   * frost over all of it. Where a fire has been through, the moss is gone, ash
   * lies over the ground and char takes the place of the leaf litter.
   */
  const buildFloor = (world, look, qs, cx, cy, burn) => {
    if (!D || typeof D.createElement !== 'function') return false;
    if (!tex) {
      tex = D.createElement('canvas');
      texCtx = tex.getContext ? tex.getContext('2d') : null;
      texPaint = gradPool(texCtx);
    }
    if (!texCtx) return false;
    const g = texCtx;
    const F = V.floor;
    const seed = world.seed >>> 0;

    tex.width = Math.max(1, Math.floor(W * dpr));
    tex.height = Math.max(1, Math.floor(H * dpr));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = P.loam;
    g.fillRect(0, 0, W, H);

    // The world rectangle the canvas covers, in cells.
    const wx0 = (0 - cx) / qs, wx1 = (W - cx) / qs;
    const wy0 = (0 - cy) / qs, wy1 = (H - cy) / qs;

    // The ground tone: octaves of value noise laid down as soft blobs, the
    // light half in the season's ground colour and the dark half in its shade.
    // An octave whose grain would land finer than a few pixels is left out; at
    // that size it only averages back into the flat tone underneath.
    const octaves = Array.isArray(F.octaves) ? F.octaves : [];
    for (let o = 0; o < octaves.length; o++) {
      const oct = octaves[o] || {};
      const fscale = oct.scale > 0 ? oct.scale : 1;
      const grain = fscale * qs * 0.5;
      // Too fine to see, or so broad that the view sits inside one feature of
      // it and it would read as a shadow across the whole floor.
      if (grain < F.grainMin) continue;
      if (fscale * qs > Math.min(W, H) * F.grainBroad) continue;
      const step = Math.min(grain, F.grainMax);
      const r = step * 1.05;
      const strength = ok(oct.alpha) ? oct.alpha : 0.3;
      for (let y = -step / 2; y < H + step; y += step) {
        for (let x = -step / 2; x < W + step; x += step) {
          const n = noise(seed + o * 977, ((x - cx) / qs) / fscale, ((y - cy) / qs) / fscale) - 0.5;
          const a = Math.abs(n) * 2 * strength;
          if (a < 0.02) continue;
          blob(g, texPaint, n > 0 ? look.ground : look.shade, x, y, r, a);
        }
      }
    }

    // Moss: low-frequency noise above a threshold, so it arrives in blotches.
    const mstep = Math.max(F.grainMin, Math.min(F.grainMax, F.mossScale * qs * 0.3));
    const mr = mstep * 1.15;
    for (let y = -mstep / 2; y < H + mstep; y += mstep) {
      for (let x = -mstep / 2; x < W + mstep; x += mstep) {
        const n = noise(seed + 11, ((x - cx) / qs) / F.mossScale, ((y - cy) / qs) / F.mossScale);
        if (n <= F.mossThreshold) continue;
        // Nothing green is left where the fire went; it comes back as the mark
        // of the burn fades.
        const scorch = burnAt(burn, (x - cx) / qs, (y - cy) / qs);
        const a = ((n - F.mossThreshold) / Math.max(0.01, 1 - F.mossThreshold)) * look.mossAlpha * (1 - scorch);
        if (!(a > 0.002)) continue;
        blob(g, texPaint, look.moss, x, y, mr, a);
      }
    }

    // Leaf litter: small elongated marks at random angles, on a lattice of the
    // ground itself so they stay where they fell when the camera pulls back.
    const i0 = Math.floor(wx0), i1 = Math.ceil(wx1);
    const j0 = Math.floor(wy0), j1 = Math.ceil(wy1);
    const cells = Math.max(1, (i1 - i0 + 1) * (j1 - j0 + 1));
    let per = look.litterPer;
    if (cells * per > F.litterMax) per = F.litterMax / cells;
    const len = Math.max(1, F.litterLen * qs);
    const wide = Math.max(0.6, F.litterWide * qs);
    const frostPer = look.frostPer;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        // A leaf that fell in the fire is not a leaf any more: the char that
        // took its place is laid over the ash, further down.
        const scorch = burnAt(burn, i, j);
        const whole = Math.floor(per);
        const extra = unit(seed, 'le:' + i + ':' + j) < (per - whole) ? 1 : 0;
        for (let k = 0; k < whole + extra; k++) {
          if (scorch > 0 && unit(seed, 'lb:' + i + ':' + j + ':' + k) < scorch) continue;
          const lx = cx + (i + unit(seed, 'lx:' + i + ':' + j + ':' + k)) * qs;
          const ly = cy + (j + unit(seed, 'ly:' + i + ':' + j + ':' + k)) * qs;
          const a = unit(seed, 'la:' + i + ':' + j + ':' + k) * TAU;
          const c = look.litter[hash(seed, 'lc:' + i + ':' + j + ':' + k) % look.litter.length];
          mark(g, lx, ly, a, len, wide, c, look.litterAlpha);
        }
        if (frostPer > 0 && scorch < 0.5 && unit(seed, 'fr:' + i + ':' + j) < frostPer) {
          const fx = cx + (i + unit(seed, 'fx:' + i + ':' + j)) * qs;
          const fy = cy + (j + unit(seed, 'fy:' + i + ':' + j)) * qs;
          const fa = unit(seed, 'fa:' + i + ':' + j) * TAU;
          mark(g, fx, fy, fa, len * 0.7, wide * 0.8, look.frost, look.litterAlpha * 0.9);
        }
      }
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;

    // Bare soil: damp patches, smooth, laid over the litter so nothing lies on
    // them. They are ground, not organism, so they belong in the texture.
    const dr = F.dampRadius * qs;
    if (dr > 0.5) {
      const nodes = world.nodes;
      for (let n = 0; n < nodes.length; n++) {
        const node = nodes[n];
        if (node.kind !== 'soil') continue;
        const x = cx + node.x * qs, y = cy + node.y * qs;
        if (x < -dr * 2 || x > W + dr * 2 || y < -dr * 2 || y > H + dr * 2) continue;
        const wobble = 0.7 + unit(seed, 'dp:' + node.id) * 0.7;
        blob(g, texPaint, look.damp, x, y, dr * wobble, look.dampAlpha);
        blob(g, texPaint, look.damp, x + dr * 0.5, y + dr * 0.35, dr * wobble * 0.7, look.dampAlpha * 0.8);
      }
    }
    g.globalAlpha = 1;

    // The burn: ash over everything the fire went through, laid in soft
    // patches of uneven weight so its edge is as ragged as the fire's was.
    if (burn) {
      const B = V.burn;
      const ash = col(B.ash, 'night');
      const astep = Math.max(F.grainMin, Math.min(F.grainMax, num(B.ashScale, 1) * qs));
      const ar = astep * 1.25;
      const vary = clamp01(num(B.ashVary, 0.4));
      for (let y = -astep / 2; y < H + astep; y += astep) {
        for (let x = -astep / 2; x < W + astep; x += astep) {
          const wx = (x - cx) / qs, wy = (y - cy) / qs;
          const scorch = burnAt(burn, wx, wy);
          if (scorch <= 0.01) continue;
          const n = 1 - vary + noise(seed + 31, wx / 1.6, wy / 1.6) * vary * 2;
          blob(g, texPaint, ash, x, y, ar, clamp01(scorch * num(B.ashAlpha, 0.7) * n));
        }
      }

      // Char where the litter was: splinters of burnt wood on the same lattice
      // the leaves fall on, lying over the ash rather than under it.
      const chars = (Array.isArray(B.char) && B.char.length ? B.char : ['night'])
        .map((token) => col(token, 'damp'));
      const clen = Math.max(1, num(B.charLen, 0.3) * qs);
      const cwide = Math.max(0.6, num(B.charWide, 0.08) * qs);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const scorch = burnAt(burn, i, j);
          if (scorch <= 0.02) continue;
          const cper = num(B.charPer, 2) * scorch;
          const whole = Math.floor(cper);
          const extra = unit(seed, 'ce:' + i + ':' + j) < (cper - whole) ? 1 : 0;
          for (let k = 0; k < whole + extra; k++) {
            const x = cx + (i + unit(seed, 'cx:' + i + ':' + j + ':' + k)) * qs;
            const y = cy + (j + unit(seed, 'cy:' + i + ':' + j + ':' + k)) * qs;
            const a = unit(seed, 'ca:' + i + ':' + j + ':' + k) * TAU;
            const c = chars[hash(seed, 'cc:' + i + ':' + j + ':' + k) % chars.length];
            mark(g, x, y, a, clen, cwide, c, num(B.charAlpha, 0.7) * scorch);
          }
        }
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalAlpha = 1;
    }
    return true;
  };

  // -- the things on the floor ----------------------------------------------
  //
  // A floor holds hundreds of logs and trees, and there are only a handful of
  // shapes among them: a log at one of a few stages of being eaten, a canopy
  // at one of a few widths. Each shape is drawn once into a small offscreen
  // canvas and stamped wherever it is needed, so a crowded floor costs one
  // stamp a node instead of a dozen strokes.

  const sprites = new Map();

  /**
   * How much of a thing's colour is put down.
   *
   * Ground the threads have not got to is somebody else's: it is drawn faint
   * and the mist over it does the rest, so a glance separates the logs being
   * eaten from the logs merely lying there. Everything the fungus holds is
   * drawn whole. Every shape below multiplies its own alpha by this.
   */
  let paintAlpha = 1;

  /** Screen pixels per cell for the frame being drawn, so a shape can size
   *  itself in cells without every one of them being handed the scale. */
  let pxNow = 1;

  // Where the middle of the ground sat in the last frame, in canvas pixels.
  // A press on the floor is turned back into a place on the ground through
  // exactly these numbers rather than through a second fit of the same
  // ground, because two fits drift and the mark then lands somewhere the
  // player did not press.
  let lastCx = 0, lastCy = 0;

  // -- what the threads are carrying ----------------------------------------
  //
  // A fungus moves what it takes. Minerals come out of bare soil and out of
  // the wood it is eating, run to the middle and back out to the trees; the
  // sugar the trees pay for them, and the sugar in the wood, runs back to the
  // middle. Drawn as it moves, the whole economy is on the floor: which ground
  // is paying, which is spent, and how hard the fungus is working.
  //
  // Every reached place was reached along exactly one thread, so the threads
  // are a tree rooted at the middle and what a thread carries is the sum of
  // what everything past it produces. Threads are held in the order they were
  // laid, so a pass backwards over them adds every branch into its own stem
  // before that stem is read.
  let flowKey = '';
  let flowAt = -1e9;     // simulation time the sums were last made at
  let flowSug = null;    // sugar running toward the middle, per thread
  let flowMin = null;    // minerals running toward the middle, per thread
  let flowOut = null;    // minerals running out to the trees, per thread
  let flowPeak = [0, 0, 0];
  // What each place is putting in a second, against the busiest place on the
  // floor. A log eaten hollow falls to nothing here and goes dark, which is
  // the one thing on the floor that says the ground is spent and more is
  // wanted.
  let nodePay = null;
  let nodePayPeak = 0;

  const flowSums = (state, world, rt, market, roster) => {
    const threads = state.threads;
    const n = threads.length;
    // Remade when the shape of the network changes or the market moves. The
    // market figure is rounded hard, so a rate creeping up by a hair does not
    // cost a pass over every thread on the floor.
    let paid = 0, sent = 0;
    for (const key in market) { paid += market[key].got || 0; sent += market[key].sent || 0; }
    const key = n + '|' + state.level + '|' + state.reached.length
      + '|' + paid.toExponential(2) + '|' + sent.toExponential(2);
    // A log emptying and a pool growing move these figures every step, so the
    // key alone would rebuild them on every frame. Four times a second is
    // faster than an eye reads a change and a fraction of the cost.
    if (key === flowKey || state.t - flowAt < 0.25) return n > 0 && nodePay !== null;
    flowKey = key;
    flowAt = state.t;
    if (!nodePay || nodePay.length < world.nodes.length) nodePay = new Float64Array(world.nodes.length);
    nodePay.fill(0);
    nodePayPeak = 0;

    if (!flowSug || flowSug.length < n) {
      const room = Math.max(64, n * 2);
      flowSug = new Float64Array(room);
      flowMin = new Float64Array(room);
      flowOut = new Float64Array(room);
    }
    flowSug.fill(0, 0, n); flowMin.fill(0, 0, n); flowOut.fill(0, 0, n);

    // The thread every place was reached along.
    const edgeOf = new Map();
    for (let e = 0; e < n; e++) edgeOf.set(threads[e][1], e);

    // What one place puts into the network a second. A log gives sugar and
    // minerals while there is anything left in it; bare soil gives minerals; a
    // tree gives back the sugar it pays and takes the minerals it is sent, both
    // shared out of its pool by how big it is.
    const woodRate = cfg.wood.eatRate;
    const own = (id) => {
      const node = world.nodes[id];
      if (!node) return null;
      if (node.kind === 'wood') {
        const stock = state.wood[id] || 0;
        if (!(stock > 0)) return null;
        return [woodRate, woodRate * cfg.wood.mineralsPerSugar, 0];
      }
      if (node.kind === 'soil') return [0, cfg.soil.rate, 0];
      const tree = state.trees[id];
      if (!tree || tree.dead) return null;
      const sp = roster[tree.sp];
      const row = sp && market[sp.key];
      if (!row || !(row.size > 0)) return null;
      const share = tree.s / row.size;
      return [(row.got || 0) * share, 0, (row.sent || 0) * share];
    };

    // The log the spore came down on is never the far end of a thread, so it
    // is measured on its own. It is also the whole organism on the first
    // frame, which is the one moment the light on it has to be right.
    const at0 = own(world.origin);
    if (at0) {
      nodePay[world.origin] = at0[0] + at0[1] + at0[2];
      nodePayPeak = nodePay[world.origin];
    }
    if (!n) { flowPeak = [0, 0, 0]; return false; }

    for (let e = n - 1; e >= 0; e--) {
      const to = threads[e][1];
      if (rt.reached.has(to)) {
        const o = own(to);
        if (o) {
          flowSug[e] += o[0]; flowMin[e] += o[1]; flowOut[e] += o[2];
          const busy = o[0] + o[1] + o[2];
          nodePay[to] = busy;
          if (busy > nodePayPeak) nodePayPeak = busy;
        }
      }
      const up = edgeOf.get(threads[e][0]);
      if (up !== undefined && up !== e) {
        flowSug[up] += flowSug[e];
        flowMin[up] += flowMin[e];
        flowOut[up] += flowOut[e];
      }
    }
    let a = 0, b = 0, c = 0;
    for (let e = 0; e < n; e++) {
      if (flowSug[e] > a) a = flowSug[e];
      if (flowMin[e] > b) b = flowMin[e];
      if (flowOut[e] > c) c = flowOut[e];
    }
    flowPeak = [a, b, c];
    return true;
  };

  /**
   * The size a stamp is drawn at: the next rung of a geometric ladder at or
   * above what is wanted. Stamps are then scaled down to the exact size, so an
   * easing camera reuses the ones it has instead of drawing a new set every
   * frame, and nothing is ever enlarged past the resolution it was drawn at.
   */
  const rung = (v) => {
    const step = V.spriteStep > 1.01 ? V.spriteStep : 1.25;
    if (!(v > 0)) return 1;
    const up = Math.pow(step, Math.ceil(Math.log(v) / Math.log(step)));
    return ok(up) && up > 0 ? up : v;
  };

  /** The stamp for a key, drawn by `paint` into a canvas w by h CSS pixels. */
  const sprite = (key, w, h, paintInto) => {
    const held = sprites.get(key);
    if (held !== undefined) return held;
    if (!D || typeof D.createElement !== 'function' || !(w > 0) || !(h > 0)) return null;
    if (sprites.size > V.spriteCache) sprites.clear();
    const c = D.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * dpr));
    c.height = Math.max(1, Math.ceil(h * dpr));
    const g = c.getContext ? c.getContext('2d') : null;
    if (!g) { sprites.set(key, null); return null; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintInto(g, gradPool(g));
    const made = { canvas: c, w, h };
    sprites.set(key, made);
    return made;
  };

  /** The path of a log: a capsule of the given length and width, lying flat. */
  const capsule = (g, cxp, cyp, len, wide) => {
    const r = wide / 2;
    const half = Math.max(0, len / 2 - r);
    g.beginPath();
    g.moveTo(cxp - half, cyp - r);
    g.lineTo(cxp + half, cyp - r);
    g.arc(cxp + half, cyp, r, -Math.PI / 2, Math.PI / 2);
    g.lineTo(cxp - half, cyp + r);
    g.arc(cxp - half, cyp, r, Math.PI / 2, Math.PI * 1.5);
    g.closePath();
  };

  /**
   * What the fire leaves of a log: a black husk over the wood, coming back
   * toward the ordinary colour of it as the mark of the burn fades.
   */
  const husk = (g, w, mid, len, wide, burnt) => {
    if (!(burnt > 0)) return;
    g.globalAlpha = clamp01(num(V.burn.huskAlpha, 0.8) * burnt);
    g.fillStyle = col(V.burn.husk, 'damp');
    capsule(g, w / 2, mid, len, wide);
    g.fill();
    g.globalAlpha = 1;
  };

  /**
   * A fallen log. `full` is how much of it is left to eat, from 1 for a whole
   * log down to 0 for a hollow husk: the face darkens from the middle outward
   * as the organism works through it, and the log shrinks a little with it.
   * `fresh` is a log the wind has just brought down, still showing pale broken
   * wood, and `char` how black a log the fire went through still is.
   */
  const log = (x, y, cells, id, full, detail, look, fresh, char) => {
    const L = V.log;
    const step = Math.max(1, Math.round(L.stages));
    const bucket = Math.round(clamp01(full) * step) / step;
    const shrink = 0.82 + 0.18 * bucket;
    const want = L.length * cells * shrink;
    if (!ok(x) || !ok(y) || !(want > 0.6)) return;
    // Drawn at a rung of the ladder, stamped at the size actually wanted.
    const drawn = rung(want);
    const shown = want / drawn;
    const len = drawn;
    const wide = drawn * (L.width / Math.max(1e-6, L.length));
    if (!(wide > 0.3)) return;
    const burnt = clamp01(num(char, 0));
    const raw = fresh ? 1 : 0;
    const pad = Math.max(2, wide * 0.6);
    const w = len + pad, h = wide * 2 + pad;
    const key = 'log|' + bucket + '|' + drawn.toFixed(3) + '|' + (detail ? 1 : 0) + '|' + look.index
      + '|' + raw + '|' + burnt.toFixed(2);
    const mid = h / 2;
    const stamp = sprite(key, w, h, (g) => {
      const Fa = V.fallen;
      // Bark, then the paler face inside it. A log that has only just come
      // down is pale all through, broken wood rather than weathered bark.
      g.fillStyle = fresh ? col(Fa.wood, 'woodPale') : P.bark;
      capsule(g, w / 2, mid, len, wide);
      g.fill();
      if (!detail) { husk(g, w, mid, len, wide, burnt); return; }
      g.globalAlpha = fresh ? num(Fa.alpha, 1) : (bucket > 0.02 ? L.face : 1);
      g.fillStyle = fresh ? col(Fa.wood, 'woodPale') : (bucket > 0.02 ? P.woodPale : P.damp);
      capsule(g, w / 2, mid, len * 0.88, wide * (fresh ? num(Fa.face, 0.9) : 0.58));
      g.fill();
      g.globalAlpha = 1;
      if (fresh) {
        // The two ends where it snapped: raw wood, brighter than the face.
        const end = len * clamp01(num(Fa.breakLen, 0.16));
        g.globalAlpha = clamp01(num(Fa.breakAlpha, 0.9));
        g.fillStyle = col(Fa.wood, 'woodPale');
        capsule(g, w / 2 - (len - end) / 2, mid, end, wide);
        g.fill();
        capsule(g, w / 2 + (len - end) / 2, mid, end, wide);
        g.fill();
        g.globalAlpha = 1;
      }

      // The grain, and then the rot working outward from the middle.
      if (bucket > 0.02) {
        g.strokeStyle = P.bark;
        g.globalAlpha = 0.4;
        g.lineWidth = Math.max(0.4, wide * 0.045);
        const lines = Math.max(1, Math.round(L.grain));
        for (let k = 0; k < lines; k++) {
          const off = mid + ((k + 1) / (lines + 1) - 0.5) * wide * 0.46;
          g.beginPath();
          g.moveTo(w / 2 - len * 0.4, off);
          g.quadraticCurveTo(w / 2, off + wide * 0.05, w / 2 + len * 0.4, off);
          g.stroke();
        }
        // The underside of a round thing lying on the ground.
        g.globalAlpha = 0.3;
        g.fillStyle = P.damp;
        g.fillRect(w / 2 - len * 0.44, mid + wide * 0.14, len * 0.88, wide * 0.15);
        g.globalAlpha = 1;
        const eaten = 1 - bucket;
        if (eaten > 0.02) {
          g.globalAlpha = 0.25 + 0.75 * eaten;
          g.fillStyle = P.damp;
          capsule(g, w / 2, mid, len * 0.86 * eaten, wide * 0.5);
          g.fill();
          g.globalAlpha = 1;
        }
      }

      // Winter gathers snow along the upper side of a log.
      if (look.snowAlpha > 0) {
        g.globalAlpha = look.snowAlpha;
        g.fillStyle = look.snow;
        capsule(g, w / 2, mid - wide * 0.22, len * 0.82, wide * L.snow);
        g.fill();
        g.globalAlpha = 1;
      }
      husk(g, w, mid, len, wide, burnt);
    });
    if (!stamp) return;
    const a = unit(id, 'log') * Math.PI;
    const c = Math.cos(a), sn = Math.sin(a);
    const dw = w * shown, dh = h * shown;
    ctx.setTransform(dpr * c, dpr * sn, -dpr * sn, dpr * c, dpr * x, dpr * y);
    ctx.globalAlpha = paintAlpha;
    ctx.drawImage(stamp.canvas, -dw / 2, -dh / 2, dw, dh);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
  };

  /** A canopy seen from above: lit from the top left, dark at the trunk. */
  const canopy = (x, y, r, colour, detail) => {
    if (!ok(x) || !ok(y) || !(r > 0.4)) return;
    const T = V.tree;
    if (!detail) {
      ctx.globalAlpha = 0.9 * paintAlpha;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    // Drawn at a rung of the ladder, stamped at the size actually wanted.
    const rr = rung(r);
    const shown = r / rr;
    const w = rr * (2 + T.lift * 3.2) + 2;
    const at = w / 2;
    const stamp = sprite('tree|' + colour + '|' + rr.toFixed(3), w, w, (g, pool) => {
      // The shadow it casts down and to the right of itself.
      blob(g, pool, P.damp, at + rr * T.lift * 1.6, at + rr * T.lift * 1.6, rr * 0.95, 0.28, 0, 0, T.core * 0.6);
      // The canopy: solid to the light side, soft at the far edge.
      blob(g, pool, colour, at, at, rr, 1, -T.lift, -T.lift, T.core);
      // The trunk under the middle of it.
      blob(g, pool, P.bark, at, at, rr * T.trunk, 0.35);
    });
    if (!stamp) return;
    const dw = w * shown;
    ctx.globalAlpha = paintAlpha;
    ctx.drawImage(stamp.canvas, x - dw / 2, y - dw / 2, dw, dw);
    ctx.globalAlpha = 1;
  };

  /**
   * A dead tree: a grey snag of a few bare branches over a small trunk. One the
   * fire went through is heavier and black rather than grey, with charred
   * heartwood showing at its foot - the reason to go back into a burn at all.
   * The one path is stroked twice, so a snag crosses from black to ordinary
   * grey as the mark of the burn fades.
   */
  const snag = (x, y, r, id, char) => {
    if (!ok(x) || !ok(y) || !(r > 0.4)) return;
    const T = V.tree;
    const B = V.burn;
    const burnt = clamp01(num(char, 0));
    const n = Math.max(2, Math.round(T.snag));
    ctx.lineWidth = Math.max(0.5, r * 0.16 * (1 + (num(B.snagBranch, 1.5) - 1) * burnt));
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + unit(id, 'snag') * TAU;
      const len = r * (0.6 + unit(id, 'sl:' + k) * 0.6);
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    }
    if (burnt < 1) {
      ctx.strokeStyle = P.dead;
      ctx.globalAlpha = 0.85 * (1 - burnt) * paintAlpha;
      ctx.stroke();
    }
    if (burnt > 0) {
      ctx.strokeStyle = col(B.snag, 'night');
      ctx.globalAlpha = clamp01(num(B.snagAlpha, 0.95) * burnt) * paintAlpha;
      ctx.stroke();
    }
    ctx.globalAlpha = paintAlpha;
    ctx.fillStyle = P.bark;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, r * 0.22), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (burnt > 0) {
      blob(ctx, paint, col(B.ember, 'rust'), x, y,
        Math.max(0.6, r * clamp01(num(B.emberRadius, 0.5))),
        clamp01(num(B.emberAlpha, 0.45) * burnt) * paintAlpha);
    }
  };

  /**
   * Bare soil the threads are in: a damp patch is already in the floor, so
   * what is drawn here is what the fungus is taking out of it - a pale mineral
   * bloom over the patch and a scatter of grains in it. Unreached soil stays
   * as it lies, which is why bare ground is invisible until it is worked.
   */
  const mineralPatch = (x, y, r, id, take) => {
    if (!ok(x) || !ok(y) || !(r > 1)) return;
    const F = V.flow;
    const colour = col(F.mineral, 'frost');
    blob(ctx, paint, colour, x, y, r, clamp01(0.14 + 0.2 * clamp01(take)) * paintAlpha);
    if (r < 5) return;
    const grains = 7;
    ctx.fillStyle = colour;
    ctx.globalAlpha = clamp01(0.4 + 0.35 * clamp01(take)) * paintAlpha;
    for (let k = 0; k < grains; k++) {
      const a = unit(id, 'g:' + k) * TAU;
      const d = Math.sqrt(unit(id, 'gd:' + k)) * r * 0.8;
      const g = Math.max(0.6, r * 0.055);
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, g, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  /**
   * The sheath: pale thread wrapped round a place the fungus holds, drawn as
   * light lying on it rather than as an outline round it. It burns at what the
   * place is putting into the network, so a log eaten hollow goes dark where it
   * lies, bare soil that is being worked keeps its light, and the ground worth
   * more tips is the ground that is brightest. `pay` is 0 to 1 against the
   * busiest place on the floor.
   */
  const sheath = (x, y, r, pay, colour) => {
    const Hd = V.held;
    if (!ok(x) || !ok(y) || !(r > num(Hd.minPixels, 3.5))) return;
    const dim = num(Hd.dim, 0);
    const lit = clamp01(dim + (1 - dim) * Math.pow(clamp01(pay), num(Hd.bias, 1.5)));
    if (!(lit > 0.02)) return;
    blob(ctx, paint, colour, x, y, r,
      clamp01(num(Hd.sheathAlpha, 0.34) * lit), 0, 0, num(Hd.sheathCore, 0.2));
  };

  // -- the frame ------------------------------------------------------------

  const draw = (sim, dt) => {
    const state = sim.state;
    const world = sim.world;
    const nodes = world.nodes;
    const rt = sim.rt;
    dt = ok(dt) ? Math.max(0, Math.min(0.25, dt)) : 0;

    // A level folded: the clearing has to open again around the new origin.
    if (state.level !== seenLevel) {
      fold = seenLevel >= 0 ? 0 : 1e6;
      seenLevel = state.level;
      marks = [];
    }
    fold += dt;
    const foldSeconds = Math.max(0.1, V.fold.seconds);
    const foldK = fold >= foldSeconds ? 1 : smooth(clamp01(fold / foldSeconds));

    const want = targetScale(state);
    if (px === null || !ok(px)) px = want;
    else px += (want - px) * Math.min(1, V.ease * dt);
    const s = ok(px) && px > 1e-4 ? px : 1;
    const f = frame();
    const cx = f.cx, cy = f.cy;
    pxNow = s;
    lastCx = cx; lastCy = cy;
    const detail = s >= V.massBelow;

    const season = seasonOf(cfg, state.t);
    const look = seasonLook(cfg, season.index);
    // What the world has done to this ground: a wedge of it burnt, the rain
    // held off, logs the wind put down, another fungus holding its own.
    const ev = state.events || {};
    const burn = burnOf(state);
    const dry = !!ev.drought;
    const fallen = ev.fallen || {};

    // How much of what the ground gives up is actually being carried away. It
    // is the one number that decides whether more tips are wanted, so the
    // mineral bloom on every worked patch is drawn at it: a front that cannot
    // keep up leaves the ground looking as though it is going to waste, which
    // is what is happening.
    const carry = typeof sim.carry === 'function' ? sim.carry() : null;
    const soilTake = carry && carry.produced > 0
      ? clamp01(carry.carried / carry.produced) : 1;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';

    // The floor, drawn once per season, scale, size and level, then blitted.
    const qs = quantise(s);
    // A burn and a drought are in the ground itself, so both belong in the key
    // the texture is held under. The burn's fade is already quantised, which
    // is what keeps an ageing mark from redrawing the floor every frame.
    const burnKey = burn
      ? [burn.fade, burn.angle.toFixed(3), burn.half.toFixed(3), burn.from.toFixed(2), burn.to].join(':')
      : '';
    const key = [season.index, state.level, world.seed >>> 0, W, H, dpr,
      Math.round(cx), Math.round(cy), qs.toFixed(5), burnKey, dry ? 'dry' : ''].join('|');
    if (key !== texKey) {
      texCx = cx; texCy = cy; texScale = qs;
      texKey = buildFloor(world, dry ? dryLook(look) : look, qs, cx, cy, burn) ? key : '';
    }
    if (texKey && tex) {
      const k = ok(s / texScale) && s / texScale > 0 ? s / texScale : 1;
      ctx.drawImage(tex, cx - texCx * k, cy - texCy * k, W * k, H * k);
    } else {
      ctx.fillStyle = P.loam;
      ctx.fillRect(0, 0, W, H);
    }

    // What is on the floor. Two passes over the nodes, because whose ground it
    // is has to be the first thing a glance answers: everything the threads
    // have not got to goes down first and faint, then everything they hold
    // goes down whole and wrapped in a ring of sheath.
    const cells = Math.max(1, V.log.length) * s;
    const pad = Math.max(cells, V.tree.radius * s) * 2;
    const inFrame = (x, y) => x > -pad && x < W + pad && y > -pad && y < H + pad;
    const scaleNow = sim.scale();
    const roster = sim.roster;
    // What every thread is carrying and what every place is putting in. Both
    // the light on the ground and the motes running along the threads are
    // drawn from this, so it is worked out once, before either.
    const hasFlow = flowSums(state, world, rt, sim.market(), roster);
    const canopyOf = (sp) => {
      const list = P.canopy;
      if (!Array.isArray(list) || !list.length) return P.mossFloor;
      const per = cfg.trees.perLevel || 1;
      const idx = ((state.level * per + (sp >= 0 ? sp : 0)) % list.length + list.length) % list.length;
      return list[idx];
    };

    const T = V.tree;
    const Hd = V.held;
    const sheathPad = num(Hd.sheathPad, 0.34) * s;

    /**
     * One place on the floor. `held` says whether the threads are in it, which
     * is the whole of what separates a log being eaten from a log lying there.
     * Returns the radius the sheath ring wants, or 0 for a place that wears
     * none.
     */
    const place = (i, n, x, y, held) => {
      // Ground the fire took is not reached any more, but what happened to it
      // is still standing there and is still in the books.
      const char = burn && burn.nodes.has(i) ? burn.fade : 0;

      if (n.kind === 'soil') {
        // A damp patch is already in the floor. What is drawn here is what the
        // fungus is taking out of it, so bare ground shows nothing until it is
        // worked, and then shows how hard.
        if (!held) return 0;
        const r = Math.max(1, num(V.floor.dampRadius, 0.8) * s * 0.9);
        mineralPatch(x, y, r, i, soilTake);
        return r * 1.05;
      }

      if (n.kind === 'wood') {
        let full = 1;
        if (held || char > 0) {
          const stock = state.wood[i] || 0;
          const whole = cfg.wood.stockBase * n.stock * scaleNow;
          full = whole > 0 ? clamp01(stock / whole) : 0;
        }
        log(x, y, s, i, full, detail, look, fallen[i] > 0, char);
        return held ? Math.max(2, V.log.length * s * 0.5 * (0.82 + 0.18 * full) + sheathPad) : 0;
      }

      // A living tree, a seedling, or a snag with its wood lying beside it.
      // A tree that has been reached is known, and stays known if the fire
      // takes the ground back off us: it is still standing there, dead.
      const tree = state.trees[i] || null;
      const sp = tree ? roster[tree.sp] : null;
      const size = tree && sp && sp.max > 0 ? clamp01(tree.s / sp.max) : clamp01(n.s0);
      // No two crowns are the same width, so a stand of one kind does not read
      // as one flat field of colour.
      const vary = 1 + (unit(i, 'crown') - 0.5) * T.vary;
      const r = Math.max(T.min * s, T.radius * s * (0.35 + 0.65 * size) * vary);
      if (tree && tree.dead) {
        snag(x, y, r, i, char);
        if (tree.wood > 0 && sp) {
          const whole = tree.s * sp.wood;
          const left = whole > 0 ? clamp01(tree.wood / whole) : 1;
          const a = unit(i, 'fallen') * TAU;
          log(x + Math.cos(a) * r * 1.3, y + Math.sin(a) * r * 1.3, s, i + 7919, left, detail, look, false, char);
        }
      } else if (size < T.seedlingBelow) {
        blob(ctx, paint, P.seedling, x, y, Math.max(1, r * 0.7), 0.9 * paintAlpha);
      } else {
        canopy(x, y, r, canopyOf(tree ? tree.sp : n.sp), detail);
      }
      return held ? r + sheathPad : 0;
    };

    // Ground nobody is in: faint, and left to the mist.
    paintAlpha = clamp01(num(Hd.ghost, 0.3));
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (rt.reached.has(i)) continue;
      const x = cx + n.x * s, y = cy + n.y * s;
      if (!inFrame(x, y)) continue;
      place(i, n, x, y, false);
    }

    // Ground the threads hold: whole, and ringed.
    paintAlpha = 1;
    const rings = [];
    for (const i of state.reached) {
      const n = nodes[i];
      if (!n) continue;
      const x = cx + n.x * s, y = cy + n.y * s;
      if (!inFrame(x, y)) continue;
      const r = place(i, n, x, y, true);
      if (r > 0) rings.push(x, y, r, nodePay && nodePayPeak > 0 ? nodePay[i] / nodePayPeak : 0);
    }
    for (let k = 0; k < rings.length; k += 4) {
      sheath(rings[k], rings[k + 1], rings[k + 2], rings[k + 3], look.glow);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // The light of the season, over the ground and the trees but under the
    // organism: winter takes the whole floor to dusk and the lace glows in it.
    if (look.washAlpha > 0) {
      ctx.globalAlpha = look.washAlpha;
      ctx.fillStyle = look.wash;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    // A dry light over the whole floor while the rain holds off, over the
    // paler litter and the browned moss already in the texture.
    if (dry && num(V.drought.washAlpha, 0) > 0) {
      ctx.globalAlpha = clamp01(num(V.drought.washAlpha, 0.1));
      ctx.fillStyle = col(V.drought.wash, 'dead');
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    // Another fungus, in the ground it has taken. Its threads are not ours to
    // know, so what is drawn is the ground it holds joined up where two of its
    // places are close enough to have grown into one another: a dark matted
    // lace, thicker and straighter than ours, with a tuft on every place. It
    // shrinks in front of the player as the tips take the ground back.
    const rival = ev.rival;
    if (rival && Array.isArray(rival.nodes) && rival.nodes.length) {
      const R = V.rival;
      const held = new Set(rival.nodes);
      const search = num((cfg.events && cfg.events.rival || {}).search, 0);
      const span = Math.ceil(search);
      const near = search * search;
      let drew = 0;
      ctx.beginPath();
      for (let k = 0; k < rival.nodes.length; k++) {
        const id = rival.nodes[k];
        const a = nodes[id];
        if (!a) continue;
        const ax = cx + a.x * s, ay = cy + a.y * s;
        if (!inFrame(ax, ay)) continue;
        for (let di = -span; di <= span; di++) {
          for (let dj = -span; dj <= span; dj++) {
            const other = world.byCell.get((a.i + di) + ',' + (a.j + dj));
            if (other === undefined || other <= id || !held.has(other)) continue;
            const b = nodes[other];
            const dx = b.x - a.x, dy = b.y - a.y;
            if (dx * dx + dy * dy > near) continue;
            ctx.moveTo(ax, ay);
            ctx.lineTo(cx + b.x * s, cy + b.y * s);
            drew++;
          }
        }
      }
      if (drew > 0) {
        const width = Math.max(0.6, num(R.width, 0.17) * s);
        ctx.strokeStyle = col(R.mat, 'bark');
        ctx.lineWidth = width * num(R.matWidth, 3);
        ctx.globalAlpha = clamp01(num(R.matAlpha, 0.22));
        ctx.stroke();
        ctx.strokeStyle = col(R.lace, 'damp');
        ctx.lineWidth = width;
        ctx.globalAlpha = clamp01(num(R.laceAlpha, 0.9));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const tufts = Math.max(1, Math.round(num(R.tufts, 4)));
      const tlen = Math.max(1, num(R.tuftLen, 0.34) * s);
      const twide = Math.max(0.6, num(R.tuftWide, 0.1) * s);
      const spread = num(R.tuftSpread, 0.26) * s;
      const tuft = col(R.tuft, 'damp');
      const tuftAlpha = clamp01(num(R.tuftAlpha, 0.85));
      for (let k = 0; k < rival.nodes.length; k++) {
        const id = rival.nodes[k];
        const a = nodes[id];
        if (!a) continue;
        const ax = cx + a.x * s, ay = cy + a.y * s;
        if (!inFrame(ax, ay)) continue;
        for (let m = 0; m < tufts; m++) {
          const ang = (m / tufts) * TAU + unit(id, 'tuft') * TAU;
          mark(ctx, ax + Math.cos(ang) * spread, ay + Math.sin(ang) * spread,
            ang, tlen, twide, tuft, tuftAlpha);
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
    }

    // The lace. Every thread wanders a little off the straight line between
    // its ends, so the network reads as grown rather than plotted.
    const threads = state.threads;
    if (threads.length) {
      if (!marks.length || marks[marks.length - 1][1] !== threads.length) {
        marks.push([state.t, threads.length]);
        if (marks.length > 2000) marks.splice(0, marks.length - 2000);
      }
      const cut = state.t - Math.max(0, V.lace.fresh);
      while (marks.length > 1 && marks[1][0] <= cut) marks.shift();
      const freshFrom = marks[0][1];

      const width = Math.max(0.55, V.lace.width * s);
      const lay = (from, to) => {
        ctx.beginPath();
        for (let i = from; i < to; i++) {
          const a = nodes[threads[i][0]], b = nodes[threads[i][1]];
          if (!a || !b) continue;
          const ax = cx + a.x * s, ay = cy + a.y * s;
          const bx = cx + b.x * s, by = cy + b.y * s;
          if (!ok(ax) || !ok(ay) || !ok(bx) || !ok(by)) continue;
          const dx = bx - ax, dy = by - ay;
          const d = Math.hypot(dx, dy);
          ctx.moveTo(ax, ay);
          if (d < 1e-6) { ctx.lineTo(bx, by); continue; }
          // The control point sits off to one side of the middle, so the
          // thread bows there by half of it.
          const off = (unit(threads[i][0] * 131 + threads[i][1], 'w') - 0.5) * 4 * V.lace.wave * s;
          ctx.quadraticCurveTo((ax + bx) / 2 - (dy / d) * off, (ay + by) / 2 + (dx / d) * off, bx, by);
        }
      };

      // The path is laid once and stroked more than once: the same threads
      // carry the pale line, and over it whatever glow the season gives them.
      lay(0, threads.length);
      if (look.glowAll > 0 && detail) {
        ctx.strokeStyle = look.glow;
        ctx.lineWidth = width * V.lace.glowWidth;
        ctx.globalAlpha = look.glowAll * V.lace.glowAlpha * 3;
        ctx.stroke();
      }
      ctx.strokeStyle = look.lace;
      ctx.lineWidth = width;
      ctx.globalAlpha = V.lace.alpha * look.laceAlpha;
      ctx.stroke();
      if (look.glowAll > 0) {
        ctx.strokeStyle = look.glow;
        ctx.globalAlpha = look.glowAll;
        ctx.stroke();
      }
      // What has just grown is brighter than what has settled, and carries a
      // little of the glow whatever the season.
      if (freshFrom < threads.length) {
        lay(freshFrom, threads.length);
        if (detail) {
          ctx.strokeStyle = look.glow;
          ctx.lineWidth = width * V.lace.glowWidth;
          ctx.globalAlpha = V.lace.glowAlpha;
          ctx.stroke();
        }
        ctx.strokeStyle = look.lace;
        ctx.lineWidth = width * 1.15;
        ctx.globalAlpha = V.lace.freshAlpha;
        ctx.stroke();
        ctx.strokeStyle = look.glow;
        ctx.globalAlpha = Math.min(1, V.lace.freshGlow + look.glowAll);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // What the threads are carrying, drawn as it moves. Pale blue runs out to
    // the trees and amber runs back, along the same threads the lace drew, so
    // a glance says which ground pays and which is spent.
    if (threads.length && detail && hasFlow) {
      const F = V.flow;
      const size = Math.max(0.5, num(F.size, 0.075) * s);
      if (size >= num(F.minPixels, 2.2)) {
        const budget = Math.max(0, Math.round(num(F.motes, 900)));
        const cap = Math.max(1, Math.round(num(F.maxPerThread, 4)));
        const speed = num(F.speed, 1.35);
        const mineral = col(F.mineral, 'frost');
        const sugar = col(F.sugar, 'woodPale');
        // How many motes each stream would like, and what they all have to be
        // held back by to fit in the budget.
        const want = (peak, arr) => {
          if (!(peak > 0)) return 0;
          let total = 0;
          for (let e = 0; e < threads.length; e++) {
            if (arr[e] > 0) total += Math.min(cap, 1 + Math.floor(cap * Math.sqrt(arr[e] / peak)));
          }
          return total;
        };
        const asked = want(flowPeak[0], flowSug) + want(flowPeak[1], flowMin) + want(flowPeak[2], flowOut);
        const hold = asked > budget && asked > 0 ? budget / asked : 1;

        // One stream: motes spaced evenly along every thread that carries it,
        // walking at a fixed speed whichever way the stream runs. A thread's
        // own offset is fixed, so nothing stutters between frames and a mote
        // count that changes does not jump the ones already on the wire.
        const stream = (arr, peak, colour, outward) => {
          if (!(peak > 0)) return;
          ctx.fillStyle = colour;
          ctx.globalAlpha = clamp01(num(F.alpha, 0.85));
          ctx.beginPath();
          for (let e = 0; e < threads.length; e++) {
            const v = arr[e];
            if (!(v > 0)) continue;
            const a = nodes[threads[e][0]], b = nodes[threads[e][1]];
            if (!a || !b) continue;
            const ax = cx + a.x * s, ay = cy + a.y * s;
            const bx = cx + b.x * s, by = cy + b.y * s;
            if (!inFrame(ax, ay) && !inFrame(bx, by)) continue;
            const phase = unit(threads[e][0] * 131 + threads[e][1], 'flow');
            const n = Math.floor((1 + Math.floor(cap * Math.sqrt(v / peak))) * hold + phase);
            if (n < 1) continue;
            const dx = bx - ax, dy = by - ay;
            const d = Math.hypot(dx, dy);
            if (!(d > 1e-6)) continue;
            // The same bow the lace was drawn with, so a mote rides the thread
            // it is on rather than the straight line between its ends.
            const off = (unit(threads[e][0] * 131 + threads[e][1], 'w') - 0.5) * 4 * V.lace.wave * s;
            const qx = (ax + bx) / 2 - (dy / d) * off, qy = (ay + by) / 2 + (dx / d) * off;
            const walk = (state.t * speed * s / d + phase) % 1;
            for (let k = 0; k < n; k++) {
              let u = (walk + k / n) % 1;
              if (!outward) u = 1 - u;
              const w = 1 - u;
              const px2 = w * w * ax + 2 * w * u * qx + u * u * bx;
              const py2 = w * w * ay + 2 * w * u * qy + u * u * by;
              ctx.moveTo(px2 + size, py2);
              ctx.arc(px2, py2, size, 0, TAU);
            }
          }
          ctx.fill();
          // A soft pass under the motes, so light seems to be inside the
          // thread rather than sitting on top of it.
          if (num(F.glowAlpha, 0) > 0) {
            ctx.globalAlpha = clamp01(num(F.glowAlpha, 0.22));
            ctx.lineWidth = size * num(F.glowSize, 2.4);
            ctx.strokeStyle = colour;
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        };
        stream(flowSug, flowPeak[0], sugar, false);
        stream(flowMin, flowPeak[1], mineral, false);
        stream(flowOut, flowPeak[2], mineral, true);
      }
    }

    // The tips: short bright dashes at the front, pointing where they are
    // going. Past the cap on bodies the front reads as a bright fringe.
    const tips = state.tips;
    if (tips.length) {
      const stride = tips.length > V.tipsDrawn ? tips.length / V.tipsDrawn : 1;
      const len = Math.max(1.5, V.tip.dash * s);
      const origin = nodes[world.origin] || { x: 0, y: 0 };
      const front = () => {
        ctx.beginPath();
        for (let k = 0; k < tips.length; k += stride) {
          const t = tips[Math.floor(k)];
          if (!t || !ok(t.x) || !ok(t.y)) continue;
          const x = cx + t.x * s, y = cy + t.y * s;
          if (!inFrame(x, y)) continue;
          // Pointing where it is going; a tip with nowhere to go yet faces out
          // from the middle of the organism, which is where it came from.
          let ux = t.x - origin.x, uy = t.y - origin.y;
          const to = t.to >= 0 ? nodes[t.to] : null;
          if (to) { ux = to.x - t.x; uy = to.y - t.y; }
          const d = Math.hypot(ux, uy);
          if (d > 1e-6) { ux /= d; uy /= d; }
          else {
            const a = unit(t.from >= 0 ? t.from : 0, 'idle:' + Math.floor(k)) * TAU;
            ux = Math.cos(a); uy = Math.sin(a);
          }
          ctx.moveTo(x - ux * len, y - uy * len);
          ctx.lineTo(x, y);
        }
      };
      ctx.lineWidth = Math.max(0.7, V.tip.width * s);
      front();
      ctx.strokeStyle = look.lace;
      ctx.globalAlpha = V.tip.alpha;
      ctx.stroke();
      // The front carries the glow even in daylight, more of it in winter.
      ctx.strokeStyle = look.glow;
      ctx.globalAlpha = Math.min(1, V.tip.glow + look.glowAll);
      ctx.stroke();
      // A bright point at the head of each tail. Without it a tip is another
      // short pale line among thousands of them, and a front of two thousand
      // reads as more thread rather than as something moving.
      //
      // The head is a stub of a line under a round cap rather than a circle:
      // an arc of its own for every one of two thousand tips costs a quarter
      // of the frame in software, and a two-point path stroked wide is the
      // same disc for a fraction of it.
      const head = Math.max(0.9, num(V.tip.head, 0.13) * s);
      if (head >= 1) {
        ctx.beginPath();
        for (let k = 0; k < tips.length; k += stride) {
          const t = tips[Math.floor(k)];
          if (!t || !ok(t.x) || !ok(t.y)) continue;
          const x = cx + t.x * s, y = cy + t.y * s;
          if (!inFrame(x, y)) continue;
          ctx.moveTo(x, y);
          ctx.lineTo(x + 0.01, y);
        }
        ctx.strokeStyle = look.glow;
        ctx.lineWidth = head * 2;
        ctx.globalAlpha = clamp01(num(V.tip.headAlpha, 1));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Where the front has been sent: an open ring with a short cross through
    // it, standing on the ground rather than lying on it, so it is not read as
    // another thing the fungus has found.
    const aim = state.aim;
    if (aim && ok(aim.x) && ok(aim.y)) {
      const M = V.aimMark || {};
      const ax = cx + aim.x * s, ay = cy + aim.y * s;
      // One slow beat, so the eye finds it among a thousand other things.
      const beat = Math.max(0.2, num(M.beat, 3.2));
      const swell = 1 + num(M.beatDepth, 0.16) * Math.sin((state.t / beat) * TAU);
      const r = Math.max(4, num(M.radius, 0.75) * s) * swell;
      const arm = r * num(M.arm, 2);
      const width = Math.max(1, num(M.width, 0.075) * s);
      ctx.beginPath();
      ctx.arc(ax, ay, r, 0, TAU);
      ctx.moveTo(ax - arm, ay); ctx.lineTo(ax - r * 0.5, ay);
      ctx.moveTo(ax + r * 0.5, ay); ctx.lineTo(ax + arm, ay);
      ctx.moveTo(ax, ay - arm); ctx.lineTo(ax, ay - r * 0.5);
      ctx.moveTo(ax, ay + r * 0.5); ctx.lineTo(ax, ay + arm);
      // A dark backing under a pale mark, so it reads on litter, on loam, on
      // snow and on a wedge of ash without changing colour with the season.
      ctx.strokeStyle = col(M.shadow, 'night');
      ctx.lineWidth = width * num(M.shadowWidth, 2.6);
      ctx.globalAlpha = clamp01(num(M.shadowAlpha, 0.4));
      ctx.stroke();
      ctx.strokeStyle = col(M.colour, 'lace');
      ctx.lineWidth = width;
      ctx.globalAlpha = clamp01(num(M.alpha, 0.95));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // The reach: the ground that has been bought is the lit clearing, and the
    // ground past it lies under mist that thickens with distance. A level that
    // has just folded opens its clearing from the origin outward.
    const openR = state.ring * cfg.world.ringWidth * s * foldK;
    const far = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
    if (far > 1 && ok(openR)) {
      const edge = openR + Math.max(0.2, V.mist.rings) * cfg.world.ringWidth * s;
      const a0 = clamp01(openR / far);
      const a1 = clamp01(edge / far);
      if (a0 < 1 && typeof ctx.createRadialGradient === 'function') {
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, far);
        const top = Math.min(1, Math.max(a1, a0 + 0.001));
        grad.addColorStop(0, rgba(look.veil, 0));
        grad.addColorStop(a0, rgba(look.veil, 0));
        grad.addColorStop(top, rgba(look.veil, look.veilAlpha * V.mist.max));
        grad.addColorStop(1, rgba(look.veil, look.veilAlpha * V.mist.max));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      }
    }

    // The fold itself: the new floor comes out from under the mist. Quiet -
    // nothing flashes.
    if (foldK < 1) {
      ctx.globalAlpha = clamp01((1 - foldK) * look.veilAlpha * V.mist.max);
      ctx.fillStyle = look.veil;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  };

  /**
   * A point on the canvas, in CSS pixels from its top left, as a place on the
   * ground in cells from the middle. The inverse of what the last frame drew.
   */
  const at = (x, y) => {
    const s = ok(px) && px > 1e-4 ? px : 1;
    return { x: (x - lastCx) / s, y: (y - lastCy) / s };
  };

  return {
    resize, draw, at,
    get scale() { return px; },
    get size() { return { w: W, h: H }; },
  };
}
