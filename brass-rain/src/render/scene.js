// ---------------------------------------------------------------------------
// The machine, drawn.
//
// One face, ten draw calls, whatever the count. The still half of the board -
// pins, pockets, rails, deflectors - goes to the card once when the board's
// version changes and is drawn from there every frame. The moving half is
// five arrays of floats that the game already keeps, handed over as they are:
// no gathering, no packing, no array built while a frame is being drawn.
//
// The face is drawn into an offscreen buffer at whatever fraction of the
// window has been paid for, and the last pass stretches it up while laying
// the glass and the bezel over it at full resolution. That ordering is what
// lets a weak machine drop to a third of the pixels and still show a hairline
// chrome frame and a clean bevel, which is where the whole picture reads from.
//
// Everything this module makes is written down and handed back on dispose,
// and everything is built inside one function so that losing the graphics
// context - a driver reset, a laptop waking up, a phone reclaiming memory -
// is a matter of calling that function again rather than reloading the page.
//
// It knows nothing about the game. It is given a canvas, a palette and a
// description of what to draw, and it touches nothing else on the page.
// ---------------------------------------------------------------------------

import { createGL, program, buffer, vao, target, fittedTarget, bindScreen, FULLSCREEN_VS } from './gl.js?v=9';
import { createColours } from './colours.js?v=9';
import { fitBoard, clipTransform, lampPosition, reelRect, screenRect, drumStrip } from './layout.js?v=9';
import { normaliseQuality, bufferSize, sceneSize, drawnBalls } from './quality.js?v=9';
import {
  packPins, packPockets, packRails, packFlashes, packReels, packArc, packScreen,
  packEvents, tellHeat, showIntensity, medianPinRadius,
  POCKET_KINDS, POCKET_TONES, FLASH_KINDS, REEL_WINDOWS, EVENT_CAP,
} from './board-geom.js?v=9';
import {
  INSTANCE_VS, RAIL_VS, BALL_VS, GROUND_FS, PIN_FS, BALL_FS, BALL_SHADOW_FS,
  RAIL_FS, POCKET_FS, FLASH_FS, REEL_FS, ARC_FS, SCREEN_FS, EVENT_FS, COMPOSITE_FS,
} from './shaders.js?v=9';
import { themeForCabinet, themeIndex, DEFAULT_THEME } from './themes.js?v=9';
import { encode as encodeName, MAX_LETTERS } from './marquee.js?v=9';

// The unit quad every instance is stamped from, as a triangle strip so no
// index buffer is needed.
const QUAD = new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]);

// How many hit marks can be on the face at once. Marks past this are dropped
// rather than allowed to grow the buffer mid frame.
const FLASH_CAP = 256;

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function createScene(canvas, cfg) {
  const conf = cfg || {};
  const R = conf.render || {};
  // The simulation numbers the picture has to agree with: how big a ball is
  // and where the launch rail runs. Optional, and everything has a fallback,
  // but a renderer told these draws the machine that is actually being played.
  const P = conf.physics || {};
  const colours = createColours(conf, themeForCabinet(R.theme || (conf.identity && conf.identity.theme)));
  // What the sign on top says. A machine with no name on it is a prototype.
  const sign = encodeName((conf.identity && conf.identity.name) || R.name || 'BRASS RAIN');
  let signed = null;

  const G = createGL(canvas, { antialias: false, alpha: false, maxDpr: num(R.maxDpr, 2) });
  const gl = G.gl;

  /**
   * What the face can be drawn into, asked freshly every time the resources
   * are built.
   *
   * Half float is worth having: every pass writes linear light and blends in
   * it, and eight bits of linear in a lacquer this dark bands into stripes no
   * dither can hide. But extensions do not survive a lost context - they have
   * to be requested again on the one that comes back - and a format that a
   * driver advertises can still refuse to be a render target, so this asks
   * for the extension and then actually builds a two pixel buffer with it
   * before believing the answer.
   */
  function pickFormat() {
    gl.getExtension('OES_texture_float_linear');
    if (!gl.getExtension('EXT_color_buffer_float')) return 'rgba8';
    try {
      const probe = target(gl, { width: 2, height: 2, format: 'rgba16f', filter: 'linear' });
      probe.dispose();
      return 'rgba16f';
    } catch (e) {
      return 'rgba8';
    }
  }

  // The face no longer fills the window: it is set into a cabinet with a sign
  // above it and a dish below it, so it is given room and pushed up through
  // the slack rather than centred in it.
  const margin = num(R.margin, 0.135);
  const lift = num(R.lift, 0.30);
  const bezelPx = num(R.bezel, 2.2);
  const ballMinPixels = num(R.ballMinPixels, 4.5);
  const maxDpr = num(R.maxDpr, 2);

  let quality = normaliseQuality(conf.quality, undefined);

  // ---- what the window is worth --------------------------------------------
  let cssW = Math.max(1, num(canvas.clientWidth, 960));
  let cssH = Math.max(1, num(canvas.clientHeight, 640));
  let dprUsed = 1;
  let bufW = Math.max(1, canvas.width || 960);
  let bufH = Math.max(1, canvas.height || 640);

  // ---- the board, as it was last uploaded ----------------------------------
  let boardVersion = null;
  // The board object last uploaded, beside its version. Two machines built
  // from two seeds both count their version from one, so a version alone
  // cannot tell a re-nailed face from a different face: a player who changed
  // machine would keep looking at the old nails while the balls fell through
  // the new ones.
  let boardObj = null;
  let boardW = 1;
  let boardH = 1;
  let pinCount = 0;
  let pocketCount = 0;
  let railCount = 0;
  let ballR = 1;
  let flashR = 1;
  let smearK = 0;
  let settleSpeed = 1;
  let pocketPad = 0;
  let reel = { x: 0, y: 0, w: 1, h: 1 };
  let screen = { x: 0, y: 0, w: 1, h: 1 };
  let screenPack = null;
  let eventPack = null;
  let arcPack = null;
  let arcCount = 0;
  let pinPack = null;
  let pocketPack = null;
  let railPack = null;
  let flashScratch = null;
  let reelScratch = null;

  // ---- the frame's uniforms, allocated once --------------------------------
  const U = {
    u_xform: new Float32Array(4),
    u_pad: new Float32Array(2),
    u_lamp: colours.lampInto(0),
    u_lampPos: new Float32Array(4),
    u_board: new Float32Array(2),
    u_res: new Float32Array(2),
    u_fit: new Float32Array(4),
    u_face: new Float32Array(4),
    u_lacquer: colours.lin.lacquer,
    u_brass: colours.lin.brass,
    u_chrome: colours.lin.chrome,
    u_enamel: colours.lin.enamel,
    u_oxblood: colours.lin.oxblood,
    u_screen: colours.lin.screen,
    u_glow: colours.lin.glow,
    u_shell: colours.lin.shell,
    u_room: colours.lin.room,
    // How hard the machine is pushing, what it is pushing about, and which
    // skin's motif is on the panel.
    u_show: new Float32Array(4),
    u_name: sign.codes,
    u_nameLen: sign.length,
    u_pocketFill: colours.pocketFill,
    u_flashTint: new Float32Array(12),
    u_encode: 0,
    u_decode: 0,
    u_reflect: 1,
    u_glass: 1,
    u_shadow: 1,
    u_time: 0,
    u_ballR: 1,
    u_grow: 1.18,
    u_smear: num(R.ballSmear, 0.30),
    u_smearK: 0,
    u_settle: 1,
    u_bezel: bezelPx,
    u_scene: null,
  };
  // A struck pin, a filled pocket, a rail and a gate each throw the lamp back
  // with their own material's colour behind it.
  U.u_flashTint.set(colours.lin.brass, 0);
  U.u_flashTint.set(colours.lin.enamel, 3);
  U.u_flashTint.set(colours.lin.chrome, 6);
  U.u_flashTint.set(colours.lin.jade, 9);

  const stats = { drawCalls: 0, balls: 0, pins: 0, lastFrameMs: 0 };
  const projected = { x: 0, y: 0 };

  // ---- everything the card holds -------------------------------------------
  // Rebuilt wholesale when the context comes back, so nothing here may be
  // captured anywhere outside this object.
  let res = null;
  let lost = false;
  let disposed = false;
  let lastNow = 0;

  function instanceBuffer(bytes) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
    return { buf, bytes };
  }

  /** Grow a buffer's storage in place, so the vertex arrays stay valid. */
  function growBuffer(b, bytes) {
    if (b.bytes >= bytes) return false;
    let n = b.bytes;
    while (n < bytes) n *= 2;
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
    gl.bufferData(gl.ARRAY_BUFFER, n, gl.DYNAMIC_DRAW);
    b.bytes = n;
    return true;
  }

  function rectPass(fragSrc, inst) {
    const prog = program(gl, INSTANCE_VS, fragSrc);
    const v = vao(gl, prog, {
      attribs: {
        a_pos: { buffer: res.quad, size: 2 },
        a_rect: { buffer: inst.buf, size: 4, stride: 32, offset: 0, divisor: 1 },
        a_data: { buffer: inst.buf, size: 4, stride: 32, offset: 16, divisor: 1 },
      },
    });
    return { prog, v, inst };
  }

  function build() {
    res = {};
    res.format = pickFormat();
    // Eight bit targets hold sRGB bytes, so every pass encodes on the way out
    // and the last one decodes on the way in. Half float targets hold linear
    // light and neither happens.
    U.u_encode = res.format === 'rgba8' ? 1 : 0;
    U.u_decode = U.u_encode;
    res.quad = buffer(gl, QUAD);

    res.pinInst = instanceBuffer(1024 * 32);
    res.pocketInst = instanceBuffer(64 * 32);
    res.railInst = instanceBuffer(256 * 32);
    res.flashInst = instanceBuffer(FLASH_CAP * 32);
    // Room for the centre window and the whole ring around it, allocated once,
    // so a frame with seven sets turning uploads into a buffer that is already
    // the right size.
    res.reelInst = instanceBuffer(REEL_WINDOWS * 4 * 32);
    res.screenInst = instanceBuffer(32);
    res.eventInst = instanceBuffer(EVENT_CAP * 32);

    res.ballCap = 2048;
    res.ballX = instanceBuffer(res.ballCap * 4);
    res.ballY = instanceBuffer(res.ballCap * 4);
    res.ballVX = instanceBuffer(res.ballCap * 4);
    res.ballVY = instanceBuffer(res.ballCap * 4);
    res.ballSpin = instanceBuffer(res.ballCap * 4);

    res.ground = program(gl, FULLSCREEN_VS, GROUND_FS);
    res.groundVao = gl.createVertexArray();
    res.composite = program(gl, FULLSCREEN_VS, COMPOSITE_FS);
    res.compositeVao = gl.createVertexArray();

    res.arcInst = instanceBuffer(32);
    res.arc = rectPass(ARC_FS, res.arcInst);
    res.pin = rectPass(PIN_FS, res.pinInst);
    res.pocket = rectPass(POCKET_FS, res.pocketInst);
    res.flash = rectPass(FLASH_FS, res.flashInst);
    res.reel = rectPass(REEL_FS, res.reelInst);
    res.screen = rectPass(SCREEN_FS, res.screenInst);
    res.event = rectPass(EVENT_FS, res.eventInst);

    res.railProg = program(gl, RAIL_VS, RAIL_FS);
    res.railVao = vao(gl, res.railProg, {
      attribs: {
        a_pos: { buffer: res.quad, size: 2 },
        a_rect: { buffer: res.railInst.buf, size: 4, stride: 32, offset: 0, divisor: 1 },
        a_data: { buffer: res.railInst.buf, size: 4, stride: 32, offset: 16, divisor: 1 },
      },
    });

    res.ballProg = program(gl, BALL_VS, BALL_FS);
    res.ballVao = ballVao(res.ballProg);
    res.shadowProg = program(gl, BALL_VS, BALL_SHADOW_FS);
    res.shadowVao = ballVao(res.shadowProg);

    res.sceneTarget = fittedTarget(gl, { format: res.format, filter: 'linear', delay: 0.2 });

    // Whatever board was last handed over has to go back up.
    boardVersion = null;
    boardObj = null;
  }

  function ballVao(prog) {
    return vao(gl, prog, {
      attribs: {
        a_pos: { buffer: res.quad, size: 2 },
        a_x: { buffer: res.ballX.buf, size: 1, divisor: 1 },
        a_y: { buffer: res.ballY.buf, size: 1, divisor: 1 },
        a_vx: { buffer: res.ballVX.buf, size: 1, divisor: 1 },
        a_vy: { buffer: res.ballVY.buf, size: 1, divisor: 1 },
        a_spin: { buffer: res.ballSpin.buf, size: 1, divisor: 1 },
      },
    });
  }

  function teardown(deleteObjects) {
    const r = res;
    res = null;
    if (!r) return;
    if (!deleteObjects) return;
    gl.deleteBuffer(r.quad);
    for (const key of ['pinInst', 'pocketInst', 'railInst', 'flashInst', 'reelInst', 'arcInst', 'screenInst', 'eventInst',
      'ballX', 'ballY', 'ballVX', 'ballVY', 'ballSpin']) {
      if (r[key]) gl.deleteBuffer(r[key].buf);
    }
    for (const pass of [r.pin, r.pocket, r.flash, r.reel, r.arc, r.screen, r.event]) {
      if (!pass) continue;
      pass.v.dispose();
      pass.prog.dispose();
    }
    if (r.railVao) r.railVao.dispose();
    if (r.railProg) r.railProg.dispose();
    if (r.ballVao) r.ballVao.dispose();
    if (r.ballProg) r.ballProg.dispose();
    if (r.shadowVao) r.shadowVao.dispose();
    if (r.shadowProg) r.shadowProg.dispose();
    if (r.ground) r.ground.dispose();
    if (r.groundVao) gl.deleteVertexArray(r.groundVao);
    if (r.composite) r.composite.dispose();
    if (r.compositeVao) gl.deleteVertexArray(r.compositeVao);
    if (r.sceneTarget) r.sceneTarget.dispose();
  }

  build();

  // A lost context invalidates every object above without warning. The helper
  // keeps the browser willing to give one back; putting the objects back is
  // this module's job, and it is done by running the same builder again.
  G.onContextLost(() => {
    if (disposed) return;
    lost = true;
    res = null;
  });
  G.onContextRestored(() => {
    if (disposed) return;
    build();
    lost = false;
  });

  // ---- the still half of the board ------------------------------------------
  function uploadBoard(board) {
    boardW = Math.max(1e-4, num(board.w, 100));
    boardH = Math.max(1e-4, num(board.h, 140));
    U.u_board[0] = boardW;
    U.u_board[1] = boardH;

    const lamp = lampPosition(boardW, boardH, R.lamp);
    U.u_lampPos[0] = lamp[0];
    U.u_lampPos[1] = lamp[1];
    U.u_lampPos[2] = lamp[2];

    const pins = board.pins;
    pinPack = packPins(pins, pinPack ? pinPack.data : null);
    pinCount = pinPack.count;
    if (pinCount) {
      growBuffer(res.pinInst, pinCount * 32);
      gl.bindBuffer(gl.ARRAY_BUFFER, res.pinInst.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pinPack.data, 0, pinCount * 8);
    }

    // How big a ball is. The simulation knows exactly, so ask it first; a
    // renderer that guesses draws balls that do not match the ones bouncing.
    // Failing that, a ball is measured against the nails it has to fall
    // between: a real parlour ball is about eleven millimetres to a nail head
    // of four, and that ratio holds whatever units a board is described in.
    const median = medianPinRadius(pins);
    ballR = num(R.ballRadius, num(P.ballRadius, median > 0 ? median * 2.7 : boardW / 40));
    flashR = num(R.flashRadius, ballR * 1.15);
    smearK = num(R.ballSmearPerSpeed, 1 / (boardH * 3));
    settleSpeed = num(R.settleSpeed, boardH * 0.25);
    pocketPad = Math.min(boardW, boardH) * 0.02;

    pocketPack = packPockets(board.pockets, pocketPack ? pocketPack.data : null,
      { lip: num(R.pocketLip, 0.18) });
    pocketCount = pocketPack.count;
    if (pocketCount) {
      growBuffer(res.pocketInst, pocketCount * 32);
      gl.bindBuffer(gl.ARRAY_BUFFER, res.pocketInst.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pocketPack.data, 0, pocketCount * 8);
    }

    railPack = packRails(board.walls, board.guides, railPack ? railPack.data : null, {
      wallThickness: num(R.wallThickness, Math.min(boardW, boardH) * 0.016),
      guideThickness: num(R.guideThickness, Math.min(boardW, boardH) * 0.011),
    });
    railCount = railPack.count;
    if (railCount) {
      growBuffer(res.railInst, railCount * 32);
      gl.bindBuffer(gl.ARRAY_BUFFER, res.railInst.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, railPack.data, 0, railCount * 8);
    }

    // The show screen, and the strip of drums set into it. The board states
    // where its window is and how much room has been kept clear for it; the
    // screen is that window at the size a cabinet actually builds one.
    const window = reelRect(boardW, boardH, R.reel || overGate(board));
    screen = screenRect(boardW, boardH, window, R.screen);
    reel = drumStrip(screen, R.drums);

    // The launch rail. Its geometry belongs to the simulation - a drawn rail
    // that balls do not ride is worse than none - so the config is asked
    // first and the fallback is only the shape a parlour launch rail has.
    const rail = R.rail || (Number.isFinite(P.railR) ? {
      cx: P.railCx, cy: P.railCy, r: P.railR,
      fromDeg: P.railFromDeg, toDeg: P.railToDeg,
    } : {
      cx: boardW * 0.5, cy: boardH * 0.535, r: boardW * 0.48,
      fromDeg: -70, toDeg: 166,
    });
    rail.width = num(rail.width, num(R.railWidth, ballR * 1.05));
    arcPack = packArc(rail, arcPack ? arcPack.data : null);
    arcCount = arcPack.count;
    if (arcCount) {
      gl.bindBuffer(gl.ARRAY_BUFFER, res.arcInst.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, arcPack.data, 0, 8);
    }

    boardVersion = board.version;
    boardObj = board;
  }

  /** The counter window placed above whatever mouth the board calls its gate. */
  function overGate(board) {
    const list = Array.isArray(board.pockets) ? board.pockets : [];
    let gate = null;
    for (const p of list) if (p && p.kind === 'gate') { gate = p; break; }
    const w = boardW * 0.135;
    const h = boardH * 0.046;
    if (!gate) return undefined;
    return {
      x: num(gate.x, boardW * 0.5),
      y: Math.max(h * 0.6, num(gate.y, boardH * 0.5) - num(gate.h, 0) * 0.5 - h * 0.5 - boardH * 0.055),
      w,
      h,
    };
  }

  // ---- one frame -------------------------------------------------------------
  function draw(view) {
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    stats.drawCalls = 0;
    stats.balls = 0;
    stats.pins = 0;
    if (disposed || lost || !res || !view || !view.board) {
      stats.lastFrameMs = 0;
      return;
    }
    const dt = lastNow ? Math.min(0.25, (t0 - lastNow) / 1000) : 0.016;
    lastNow = t0;

    const board = view.board;
    // A machine keeps its paint. Repainting rewrites the material arrays the
    // uniforms already point at, so a skin change costs a hundred floats and
    // never a rebuild.
    colours.paint(themeForCabinet(view.theme));
    // The name on the sign arrives with the frame, because the page that owns
    // the name and the page that owns the renderer are not the same page. It
    // is only re-cut when it actually changes.
    if (typeof view.name === 'string' && view.name && view.name !== signed) {
      signed = view.name;
      const e = encodeName(view.name, U.u_name);
      U.u_name = e.codes;
      U.u_nameLen = e.length;
    }
    if (board !== boardObj || board.version !== boardVersion) uploadBoard(board);

    const show = view.show || null;
    // Two things push the machine: the spin in the middle of it, and anything
    // it is about to do that it has not done yet. They ride the same number,
    // so a warning lights the same lamps a near miss does.
    const heat = Math.max(showIntensity(show), tellHeat(view.events));
    U.u_show[0] = heat;
    U.u_show[1] = show ? Math.max(0, Math.min(1, Number(show.revival) || 0)) : 0;
    U.u_show[2] = show ? Math.max(0, Math.min(1, Number(show.win) || 0)) : 0;
    U.u_show[3] = themeIndex(colours.theme());

    const q = quality;
    const size = sceneSize(bufW, bufH, q.scale);
    const tgt = res.sceneTarget.fit(size.w, size.h, dt);

    const fitScene = fitBoard(tgt.width, tgt.height, boardW, boardH, { margin, lift });
    clipTransform(fitScene, U.u_xform);

    // A ball is the one thing on the face a player watches for a whole round,
    // and on a small window the honest radius puts it below the size anything
    // can be read at. Below that floor it is drawn larger than it is, because
    // a ball nobody can see is a worse lie than a ball slightly too big.
    const minR = ballMinPixels / Math.max(fitScene.scale, 1e-6);
    U.u_ballR = Math.max(ballR, minR);

    // The lamp answers to the fever and to the show, so an escalating machine
    // warms the whole face and not only the panel in the middle of it.
    const fever = Math.max(0, Math.min(1, Math.max(num(view.fever, 0), heat * 0.55)));
    U.u_lamp = colours.lampInto(fever);
    U.u_lampPos[3] = colours.lampGain(fever);
    U.u_time = num(view.t, 0);
    U.u_reflect = q.reflections ? 1 : 0;
    U.u_glass = q.glass ? 1 : 0;
    U.u_shadow = q.shadows ? 1 : 0;
    U.u_smearK = smearK;
    U.u_settle = settleSpeed;

    // ---- the face, at whatever resolution is being paid for ----------------
    tgt.bind();
    gl.disable(gl.BLEND);
    U.u_res[0] = tgt.width;
    U.u_res[1] = tgt.height;
    U.u_fit[0] = fitScene.ox;
    U.u_fit[1] = fitScene.oy;
    U.u_fit[2] = fitScene.scale;
    U.u_fit[3] = 0;
    U.u_pad[0] = 0;
    U.u_pad[1] = 0;
    res.ground.use();
    gl.bindVertexArray(res.groundVao);
    res.ground.set(U);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    stats.drawCalls++;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    if (arcCount) drawInstances(res.arc, 1);

    if (pocketCount) {
      U.u_pad[0] = pocketPad;
      U.u_pad[1] = pocketPad;
      drawInstances(res.pocket, pocketCount);
      U.u_pad[0] = 0;
      U.u_pad[1] = 0;
    }

    if (railCount) {
      res.railProg.use();
      gl.bindVertexArray(res.railVao.vao);
      res.railProg.set(U);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, railCount);
      gl.bindVertexArray(null);
      stats.drawCalls++;
    }

    if (pinCount) {
      drawInstances(res.pin, pinCount);
      stats.pins = pinCount;
    }

    // The screen goes on after the field and before the balls, because a ball
    // crosses in front of it and a nail never does.
    screenPack = packScreen(screen, {
      phase: show ? show.phase : 0,
      tier: show ? show.tier : 0,
      progress: show ? num(show.beat, 0) : 0,
      intensity: heat,
    }, screenPack ? screenPack.data : null);
    gl.bindBuffer(gl.ARRAY_BUFFER, res.screenInst.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, screenPack.data, 0, 8);
    drawInstances(res.screen, 1);

    // What the machine is doing back. Over the field, because a lit stripe
    // lights the nails in it, and under the balls, because all of it is behind
    // the glass and a ball is in front of it.
    eventPack = packEvents(view.events, boardW, boardH, eventPack ? eventPack.data : null);
    if (eventPack.count) {
      gl.bindBuffer(gl.ARRAY_BUFFER, res.eventInst.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, eventPack.data, 0, eventPack.count * 8);
      drawInstances(res.event, eventPack.count);
    }

    // ---- the moving half ---------------------------------------------------
    const balls = view.balls;
    const n = balls ? drawnBalls(balls.n, q) : 0;
    if (n > 0) {
      uploadBalls(balls, n);
      if (q.shadows) drawBalls(res.shadowProg, res.shadowVao, n);
      drawBalls(res.ballProg, res.ballVao, n);
      stats.balls = n;
    }

    const flashCount = uploadFlashes(view.flashes);
    if (flashCount) drawInstances(res.flash, flashCount);

    // The window is part of the machine and is always on the face. Only what
    // is showing in it comes and goes.
    reelScratch = packReels(view.reels, reel, reelScratch ? reelScratch.data : null, view.reelsAround, {
      housed: true,
      ring: screen,
      lastFace: show && Number.isFinite(show.face) ? show.face : -1,
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, res.reelInst.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, reelScratch.data, 0, reelScratch.count * 8);
    drawInstances(res.reel, reelScratch.count);

    // ---- the glass and the frame, at full resolution ------------------------
    bindScreen(gl);
    gl.disable(gl.BLEND);
    const fitBuf = fitBoard(bufW, bufH, boardW, boardH, { margin, lift });
    U.u_res[0] = bufW;
    U.u_res[1] = bufH;
    U.u_fit[0] = fitBuf.ox;
    U.u_fit[1] = fitBuf.oy;
    U.u_fit[2] = fitBuf.scale;
    U.u_face[0] = fitBuf.ox + fitBuf.w * 0.5;
    U.u_face[1] = fitBuf.oy + fitBuf.h * 0.5;
    U.u_face[2] = fitBuf.w * 0.5;
    U.u_face[3] = fitBuf.h * 0.5;
    U.u_bezel = bezelPx * dprUsed;
    U.u_scene = tgt;
    res.composite.use();
    gl.bindVertexArray(res.compositeVao);
    res.composite.set(U);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    stats.drawCalls++;

    const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    stats.lastFrameMs = t1 - t0;
  }

  function drawInstances(pass, count) {
    pass.prog.use();
    gl.bindVertexArray(pass.v.vao);
    pass.prog.set(U);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
    stats.drawCalls++;
  }

  function drawBalls(prog, v, n) {
    prog.use();
    gl.bindVertexArray(v.vao);
    prog.set(U);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.bindVertexArray(null);
    stats.drawCalls++;
  }

  /**
   * The five arrays go up exactly as the game keeps them. bufferSubData is
   * given an offset and a length rather than a subarray, because a subarray
   * is an object, and an object made every frame for every array is the kind
   * of allocation that shows up as a stutter long before it shows up as a
   * number.
   */
  function uploadBalls(balls, n) {
    if (n > res.ballCap) {
      let cap = res.ballCap;
      while (cap < n) cap *= 2;
      res.ballCap = cap;
      growBuffer(res.ballX, cap * 4);
      growBuffer(res.ballY, cap * 4);
      growBuffer(res.ballVX, cap * 4);
      growBuffer(res.ballVY, cap * 4);
      growBuffer(res.ballSpin, cap * 4);
    }
    put(res.ballX, balls.x, n);
    put(res.ballY, balls.y, n);
    put(res.ballVX, balls.vx, n);
    put(res.ballVY, balls.vy, n);
    put(res.ballSpin, balls.spin, n);
  }

  function put(b, src, n) {
    if (!src || src.length < n) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, src, 0, n);
  }

  function uploadFlashes(flashes) {
    if (!flashes || !flashes.length) return 0;
    flashScratch = packFlashes(flashes, flashScratch ? flashScratch.data : null, flashR, FLASH_CAP);
    const count = flashScratch.count;
    if (!count) return 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, res.flashInst.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, flashScratch.data, 0, count * 8);
    return count;
  }

  // ---- the contract ----------------------------------------------------------
  return {
    /** Size the drawing buffer. Returns the size actually used, in pixels. */
    resize(w, h, dpr) {
      cssW = Math.max(1, num(w, cssW));
      cssH = Math.max(1, num(h, cssH));
      const b = bufferSize(cssW, cssH, num(dpr, 1), maxDpr);
      dprUsed = b.dpr;
      bufW = b.w;
      bufH = b.h;
      if (canvas.width !== b.w) canvas.width = b.w;
      if (canvas.height !== b.h) canvas.height = b.h;
      return { w: b.w, h: b.h };
    },

    draw,

    /** What the lit sign on top of the cabinet spells. */
    setName(name) {
      const e = encodeName(name, U.u_name);
      U.u_name = e.codes;
      U.u_nameLen = e.length;
      return e.length;
    },

    /** The skin the machine is painted in, and which one it is now wearing. */
    setTheme(id) {
      colours.paint(themeForCabinet(id));
      return colours.theme();
    },

    theme() { return colours.theme(); },

    setQuality(q) {
      quality = normaliseQuality(q, quality);
      return quality;
    },

    quality() {
      return quality;
    },

    stats() {
      return stats;
    },

    /**
     * Where a point on the board lands in the page, in CSS pixels from the
     * canvas corner. The layer that letters the pockets needs this and has no
     * other way to know it; it is the only thing this module tells anyone
     * about the outside world.
     */
    project(x, y, out) {
      const fit = fitBoard(bufW, bufH, boardW, boardH, { margin, lift });
      const p = out || projected;
      p.x = (fit.ox + x * fit.scale) / dprUsed;
      p.y = (fit.oy + y * fit.scale) / dprUsed;
      return p;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      teardown(!lost);
      pinPack = null;
      pocketPack = null;
      screenPack = null;
      eventPack = null;
      railPack = null;
      flashScratch = null;
      reelScratch = null;
      U.u_scene = null;
    },
  };
}

export { POCKET_KINDS, FLASH_KINDS };
