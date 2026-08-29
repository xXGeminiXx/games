// ---------------------------------------------------------------------------
// The one picture.
//
// A dark floor, the nodes on it, the threads between the ones that have been
// reached, and the tips at the front. The camera fits the open reach, so the
// view pulls back as the organism buys ground; going beyond a level shrinks
// everything to a point at the centre of a bigger, emptier floor.
//
// Everything is drawn from the state each frame. Nothing is cached between
// frames but the eased camera, so a save restores the same picture.
// ---------------------------------------------------------------------------

import { seasonOf } from './season.js?v=1';

export function createView(canvas, cfg, doc) {
  const ctx = canvas.getContext('2d');
  const P = cfg.palette;
  const V = cfg.view;
  let W = 300, H = 150, dpr = 1;
  let px = null;             // screen pixels per cell, eased
  let seenLevel = -1;
  let fold = 0;              // seconds since a level was folded, for the flash

  const resize = (w, h, ratio) => {
    W = Math.max(1, Math.floor(w));
    H = Math.max(1, Math.floor(h));
    dpr = ratio || 1;
    // Only the bitmap is sized here. The element's CSS size stays 100% of its
    // host, so the host can shrink; an inline width would hold the old size
    // and the column could never get narrower than it once was.
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
  };

  const targetScale = (state) => {
    const extent = state.ring * cfg.world.ringWidth + 1.5;
    return Math.min(W, H) / (2 * extent * V.margin);
  };

  const draw = (sim, dt) => {
    const state = sim.state;
    const world = sim.world;
    const nodes = world.nodes;
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(0.25, dt)) : 0;

    if (state.level !== seenLevel) {
      if (seenLevel >= 0) fold = 0.001;
      seenLevel = state.level;
    }
    if (fold > 0) fold += dt;
    if (fold > 2.5) fold = 0;

    const want = targetScale(state);
    if (px === null) px = want;
    else px += (want - px) * Math.min(1, V.ease * dt);
    const s = px;
    const cx = W / 2, cy = H / 2;
    const X = (x) => cx + x * s;
    const Y = (y) => cy + y * s;
    const mass = s < V.massBelow;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = P.ground;
    ctx.fillRect(0, 0, W, H);

    // The season, as a wash.
    const season = seasonOf(cfg, state.t);
    const tint = V.tint[season.index];
    if (tint && tint !== '#000000') {
      ctx.globalAlpha = V.tintAlpha;
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    // The edge of what is open, and the edge of the level.
    const openR = state.ring * cfg.world.ringWidth * s;
    ctx.strokeStyle = P.rule;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy, openR, 0, Math.PI * 2);
    ctx.stroke();
    if (state.ring < cfg.world.rings) {
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, (state.ring + 1) * cfg.world.ringWidth * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;

    // Unreached nodes: open ones dim, closed ones dimmer.
    const rt = sim.rt;
    const nr = Math.max(1, V.nodeRadius * s);
    const tr = Math.max(1.2, V.treeRadius * s);
    for (let i = 0; i < nodes.length; i++) {
      if (rt.reached.has(i)) continue;
      const n = nodes[i];
      const open = n.ring <= state.ring;
      if (!open && n.ring > state.ring + 1 && mass) continue;
      ctx.globalAlpha = open ? 0.55 : 0.16;
      if (n.kind === 'root') {
        ctx.fillStyle = P.tree;
        dot(X(n.x), Y(n.y), tr * (0.35 + 0.65 * n.s0), mass);
      } else {
        ctx.fillStyle = n.kind === 'wood' ? P.wood : P.soil;
        dot(X(n.x), Y(n.y), n.kind === 'wood' ? nr : nr * 0.8, mass);
      }
    }
    ctx.globalAlpha = 1;

    // The threads, in one path. A wider faint pass underneath is the foxfire.
    const threads = state.threads;
    if (threads.length) {
      const width = Math.max(0.6, V.threadWidth * Math.min(1, s / 10));
      const alpha = mass ? 0.45 : 0.8;
      if (!mass && V.glow > 0) {
        ctx.strokeStyle = P.glow;
        ctx.lineWidth = width * 4;
        ctx.globalAlpha = 0.07 * V.glow;
        path(threads, nodes, X, Y);
        ctx.stroke();
      }
      ctx.strokeStyle = P.thread;
      ctx.lineWidth = width;
      ctx.globalAlpha = alpha;
      path(threads, nodes, X, Y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Reached nodes.
    for (let k = 0; k < state.reached.length; k++) {
      const id = state.reached[k];
      const n = nodes[id];
      const x = X(n.x), y = Y(n.y);
      if (n.kind === 'wood') {
        const stock = state.wood[id] || 0;
        const full = cfg.wood.stockBase * n.stock * sim.scale();
        const frac = full > 0 ? Math.max(0, Math.min(1, stock / full)) : 0;
        ctx.globalAlpha = 0.25 + 0.75 * frac;
        ctx.fillStyle = frac > 0 ? P.sugar : P.dead;
        dot(x, y, nr, mass);
        if (!mass && frac > 0) glow(x, y, nr * 2.6, P.sugar, 0.12 * frac);
      } else if (n.kind === 'soil') {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = P.mineral;
        dot(x, y, nr * 0.8, mass);
        if (!mass) glow(x, y, nr * 2.2, P.mineral, 0.1);
      } else {
        const tree = state.trees[id];
        if (!tree) continue;
        if (tree.dead) {
          const alive = tree.wood > 0;
          ctx.globalAlpha = alive ? 0.8 : 0.35;
          ctx.fillStyle = alive ? P.sugar : P.dead;
          dot(x, y, tr * 0.6, mass);
        } else {
          const sp = sim.roster[tree.sp];
          const size = sp ? tree.s / sp.max : 0.5;
          ctx.globalAlpha = 0.5 + 0.5 * tree.h;
          ctx.fillStyle = P.good;
          dot(x, y, tr * (0.35 + 0.65 * size), mass);
          if (!mass) glow(x, y, tr * (0.35 + 0.65 * size) * 2.2, P.glow, 0.10);
        }
      }
    }
    ctx.globalAlpha = 1;

    // The origin: where the spore landed.
    const o = nodes[world.origin];
    glow(X(o.x), Y(o.y), Math.max(3, nr * 3.5), P.glow, 0.22);

    // The tips.
    const tips = state.tips;
    if (tips.length) {
      const stride = tips.length > V.tipsDrawn ? tips.length / V.tipsDrawn : 1;
      const r = Math.max(1.2, V.tipRadius * s);
      ctx.fillStyle = P.tip;
      ctx.globalAlpha = 0.95;
      for (let f = 0; f < tips.length; f += stride) {
        const t = tips[Math.floor(f)];
        dot(X(t.x), Y(t.y), r, r < 1.6);
      }
      ctx.globalAlpha = 1;
    }

    // A level just folded: a ring of light spreads from the centre and fades.
    if (fold > 0) {
      const a = Math.max(0, 1 - fold / 2.5);
      ctx.globalAlpha = 0.5 * a;
      ctx.strokeStyle = P.glow;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 6 + fold * Math.min(W, H) * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };

  function dot(x, y, r, asRect) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(r)) return;
    if (asRect) { ctx.fillRect(x - r, y - r, r * 2, r * 2); return; }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function glow(x, y, r, colour, alpha) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(r)) return;
    const was = ctx.globalAlpha;
    ctx.globalAlpha = alpha * V.glow;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = was;
  }

  function path(threads, nodes, X, Y) {
    ctx.beginPath();
    for (let i = 0; i < threads.length; i++) {
      const a = nodes[threads[i][0]], b = nodes[threads[i][1]];
      if (!a || !b) continue;
      ctx.moveTo(X(a.x), Y(a.y));
      ctx.lineTo(X(b.x), Y(b.y));
    }
  }

  return {
    resize, draw,
    get scale() { return px; },
    get size() { return { w: W, h: H }; },
  };
}
