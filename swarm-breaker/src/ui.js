// ===========================================================================
// Swarm Breaker - interface
//
// The play field is canvas. Everything else is DOM and CSS, because this is a
// game about numbers: crisp text at any zoom, free layout, real focus rings,
// selectable figures, and no glyph atlas to maintain.
//
// Pure presentation. This module holds no rules. It is handed a plain data
// model each frame and it draws it; when the player acts it calls back and
// waits to be told what changed. It never prices an order, never decides what
// is unlocked, and never mutates anything it was given.
//
// ---------------------------------------------------------------------------
// THE ONE STRUCTURAL IDEA: the surface is never rebuilt, only filled in.
//
// A first run shows one price and one button. A long run shows a trading desk.
// Those are the same screen, and the way that is achieved is by settling the
// structure on the very first frame and then adding to it:
//
//   * The market is a TABLE from the first frame, with a column header, even
//     though it holds one row and three columns. New instruments arrive as new
//     COLUMNS in a table the player has already learned to read. A column
//     appearing is a far smaller event than a panel appearing, and it is why
//     depth 50 does not feel like a different product from depth 1.
//
//   * Every section keeps a one-line summary in its header, so a collapsed
//     section still prints its most decision-relevant number. A deep run is
//     dense but never a wall: six closed lines, one open.
//
//   * The order panel is progressive in the same way. It appears the turn a
//     second action exists, holds nothing but a size and a total, and then
//     grows a fill curve, a price history, a book meter and a cycle readout as
//     those instruments arrive.
//
//   * A section that has just appeared opens itself once, then remembers what
//     the player left it at.
//
// Nothing is ever taken away, nothing moves once it has a place, and there is
// no mode switch anywhere in the interface.
//
// ---------------------------------------------------------------------------
// LEGIBILITY RULES THIS FILE KEEPS
//
//   * Nothing is signalled by sound. Every change of state has a visible form,
//     and every coloured signal also carries a word or a glyph, so colour is
//     never the only carrier.
//   * Figures are monospace with tabular numerals and fixed-width cells, so a
//     ticking number does not shove its neighbours around.
//   * Text nodes are written only when their string actually changed, which
//     keeps selection, focus and scroll alive under a 60fps repaint.
//   * Charts are inline SVG built here from the data. No libraries, no fetches,
//     no images, no webfonts.
//   * Works at 520px and on touch: rows fold to two lines, hit targets grow on
//     coarse pointers, and every control is a real focusable button.
// ===========================================================================


// ---------------------------------------------------------------------------
// THEME
//
// Defaults match the field palette. Each token reads the host page's variable
// first, so dropping this into a page that already defines the palette
// inherits it, and running standalone still looks right.
// ---------------------------------------------------------------------------

export const THEME = {
  material: {
    slag:    '#7a828f',
    ferrite: '#9aa7b8',
    quartz:  '#5ad1ff',
    cinder:  '#ff5c46',
    alloy:   '#6ee7a8',
    lens:    '#b98cff',
    core:    '#ffc94a',
  },
  tone: {
    good: '#6ee7a8',
    warn: '#ffc94a',
    bad:  '#ff5c46',
    flat: '#7a828f',
  },
};

const CSS = `
.sb-root{
  --sb-bg: var(--bg, #08090c);
  --sb-panel: var(--panel, #0e1016);
  --sb-line: var(--line, #1c2029);
  --sb-ink: var(--ink, #e6e9ef);
  --sb-dim: var(--dim, #7a828f);
  --sb-hot: var(--hot, #ff5c46);
  --sb-swarm: var(--swarm, #5ad1ff);
  --sb-gold: var(--pickup, #ffc94a);
  --sb-good: #6ee7a8;
  --sb-deep: #05060a;
  --sb-main: 10ch minmax(5ch,1fr) minmax(5ch,1fr);

  width:100%; max-width:var(--sb-max, 520px); margin:0 auto;
  flex:1 1 100%; box-sizing:border-box;
  color:var(--sb-ink);
  font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-variant-numeric:tabular-nums;
  font-feature-settings:'tnum' 1;
  -webkit-text-size-adjust:100%;
}
.sb-root *,.sb-root *::before,.sb-root *::after{box-sizing:border-box}
.sb-hid{display:none !important}

/* ---- type ---- */
.sb-root .lab{
  font-size:9px; letter-spacing:.11em; text-transform:uppercase;
  color:var(--sb-dim); white-space:nowrap;
}
.sb-root .num{font-variant-numeric:tabular-nums; white-space:nowrap}
.sb-root .dim{color:var(--sb-dim)}
.sb-root .ink{color:var(--sb-ink)}
.sb-root .up{color:var(--sb-good)}
.sb-root .dn{color:var(--sb-hot)}
.sb-root .gold{color:var(--sb-gold)}
.sb-root .cy{color:var(--sb-swarm)}
.sb-root .tiny{font-size:10px; line-height:1.4}
.sb-root .ell{overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0}

/* a value that just changed: colour carries the direction, the sign carries it
   again for anyone the colour does not reach */
.sb-root .fl-up{color:var(--sb-good)}
.sb-root .fl-dn{color:var(--sb-hot)}
.sb-root .flashable{transition:color .38s ease-out}
@media (prefers-reduced-motion: reduce){
  .sb-root .flashable{transition:none}
}

/* ---- controls ---- */
.sb-root .btn{
  font:inherit; font-size:11px; line-height:1;
  background:var(--sb-panel); color:var(--sb-ink);
  border:1px solid var(--sb-line); border-radius:2px;
  padding:6px 9px; min-height:28px; cursor:pointer;
  text-align:center; white-space:nowrap; letter-spacing:.02em;
  -webkit-appearance:none; appearance:none;
}
.sb-root .btn:hover:not(:disabled){border-color:var(--sb-swarm); color:var(--sb-ink)}
.sb-root .btn:active:not(:disabled){background:#141822}
.sb-root .btn:disabled{opacity:.3; cursor:default}
.sb-root .btn.go{border-color:#2b4a5c; color:var(--sb-swarm)}
.sb-root .btn.go:hover:not(:disabled){border-color:var(--sb-swarm); background:#0d1a22}
.sb-root .btn.warn{border-color:#4a2b28; color:var(--sb-hot)}
.sb-root .btn.mini{padding:3px 6px; min-height:22px; font-size:10px}
.sb-root .btn.on{border-color:var(--sb-swarm); color:var(--sb-swarm); background:#0c1620}
.sb-root .btn.ghost{background:transparent; border-color:transparent; color:var(--sb-dim); padding:3px 5px; min-height:22px}
.sb-root .btn.ghost:hover:not(:disabled){color:var(--sb-ink); border-color:var(--sb-line)}
.sb-root :focus-visible{outline:2px solid var(--sb-swarm); outline-offset:1px}
.sb-root input[type=text],.sb-root input[type=number]{
  font:inherit; font-size:11px; background:var(--sb-deep); color:var(--sb-ink);
  border:1px solid var(--sb-line); border-radius:2px; padding:5px 6px;
  width:9ch; text-align:right; font-variant-numeric:tabular-nums;
  -moz-appearance:textfield;
}
.sb-root input::-webkit-outer-spin-button,.sb-root input::-webkit-inner-spin-button{-webkit-appearance:none; margin:0}
@media (pointer:coarse){
  .sb-root .btn{min-height:34px; padding:8px 11px}
  .sb-root .btn.mini{min-height:28px}
  .sb-root .btn.ghost{min-height:28px}
}

/* ---- the run header ---- */
.sb-hd{
  display:flex; gap:14px; align-items:flex-end; justify-content:space-between;
  padding:9px 12px 8px; border-bottom:1px solid var(--sb-line); flex-wrap:wrap;
}
.sb-hd .grp{display:flex; gap:16px; align-items:flex-end; min-width:0}
.sb-hd .st{display:flex; flex-direction:column; gap:2px; min-width:0}
.sb-hd .st b{
  font-size:19px; font-weight:600; letter-spacing:-.02em; line-height:1;
  font-variant-numeric:tabular-nums;
}
.sb-hd .st .sub{font-size:9px; color:var(--sb-dim); letter-spacing:.09em; text-transform:uppercase}
.sb-strip{
  display:flex; flex-wrap:wrap; gap:0 14px; padding:5px 12px 6px;
  border-bottom:1px solid var(--sb-line); font-size:10px; color:var(--sb-dim);
}
.sb-strip .it{display:flex; gap:5px; align-items:baseline; white-space:nowrap}
.sb-strip .it .v{color:var(--sb-ink)}

/* ---- regime band ---- */
.sb-reg{
  display:flex; gap:10px; align-items:center; flex-wrap:wrap;
  padding:6px 12px; border-bottom:1px solid var(--sb-line);
  font-size:10px; background:linear-gradient(90deg,rgba(255,201,74,.05),transparent 60%);
}
.sb-reg .nm{font-size:11px; letter-spacing:.12em; color:var(--sb-gold)}
.sb-reg .mul{color:var(--sb-dim)}
.sb-reg .mul b{color:var(--sb-ink); font-weight:400}
.sb-reg .clock{display:flex; gap:2px; align-items:center; margin-left:auto}
.sb-reg .pip{width:7px; height:7px; border:1px solid var(--sb-line); background:transparent}
.sb-reg .pip.done{background:var(--sb-line); border-color:var(--sb-line)}
.sb-reg .pip.now{background:var(--sb-gold); border-color:var(--sb-gold)}

/* ---- deck ---- */
.sb-deck{display:flex; flex-direction:column}
.sb-sec{border-bottom:1px solid var(--sb-line)}
.sb-sec > .hd{
  display:flex; gap:10px; align-items:center; width:100%;
  background:transparent; border:0; color:inherit; font:inherit;
  padding:8px 12px; cursor:pointer; text-align:left; min-height:32px;
}
.sb-sec > .hd:hover .t{color:var(--sb-swarm)}
.sb-sec > .hd .caret{color:var(--sb-dim); width:1ch; flex:0 0 auto; font-size:10px}
.sb-sec > .hd .t{
  font-size:10px; letter-spacing:.13em; text-transform:uppercase; color:var(--sb-ink);
  flex:0 0 auto;
}
.sb-sec > .hd .sum{
  font-size:10px; color:var(--sb-dim); margin-left:auto; text-align:right;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;
}
.sb-sec > .bd{padding:0 12px 12px}
.sb-sec.shut > .bd{display:none}
.sb-sec.bare > .hd{display:none}
.sb-sec.bare > .bd{padding-top:10px}
.sb-sec.fresh > .hd .t{color:var(--sb-gold)}
.sb-sec.fresh{box-shadow:inset 2px 0 0 var(--sb-gold)}

/* ---- notices, digest, watch ---- */
.sb-note{
  display:flex; gap:9px; align-items:flex-start; padding:8px 12px;
  border-bottom:1px solid var(--sb-line); background:rgba(255,201,74,.05);
}
.sb-note .k{color:var(--sb-gold); flex:0 0 auto; font-size:10px; letter-spacing:.1em; text-transform:uppercase}
.sb-note .b{flex:1 1 auto; min-width:0; font-size:11px; color:var(--sb-ink)}
.sb-note .b em{font-style:normal; color:var(--sb-dim); display:block; font-size:10px}
.sb-note.info{background:rgba(90,209,255,.05)} .sb-note.info .k{color:var(--sb-swarm)}
.sb-note.bad{background:rgba(255,92,70,.06)} .sb-note.bad .k{color:var(--sb-hot)}
.sb-dig{
  display:flex; gap:12px; flex-wrap:wrap; align-items:baseline;
  padding:7px 12px; border-bottom:1px solid var(--sb-line); font-size:10px; color:var(--sb-dim);
}
.sb-dig .it{white-space:nowrap} .sb-dig .it b{font-weight:400; color:var(--sb-ink)}
.sb-watch{display:flex; flex-direction:column; border-bottom:1px solid var(--sb-line)}
.sb-watch .w{display:flex; gap:8px; align-items:baseline; padding:5px 12px; font-size:10px}
.sb-watch .w .g{flex:0 0 1.6ch; text-align:center}
.sb-watch .w.warn .g{color:var(--sb-gold)} .sb-watch .w.warn{background:rgba(255,201,74,.04)}
.sb-watch .w.bad .g{color:var(--sb-hot)} .sb-watch .w.bad{background:rgba(255,92,70,.05)}
.sb-watch .w.good .g{color:var(--sb-good)}
.sb-watch .w .x{margin-left:auto}

/* ---- the market table ---- */
.sb-mk{display:flex; flex-direction:column}
.sb-mkh{
  display:flex; gap:10px; align-items:center; padding:0 0 4px; min-height:0;
  border-bottom:1px solid var(--sb-line); margin-bottom:2px;
}
.sb-mkrow{border-bottom:1px solid rgba(28,32,41,.55)}
.sb-mkrow:last-child{border-bottom:0}
.sb-row{display:flex; gap:10px; align-items:center; padding:5px 0; min-height:30px}
.sb-row .main{display:grid; grid-template-columns:var(--sb-main); gap:10px; align-items:baseline; flex:1 1 22ch; min-width:0}
.sb-mkh .main{align-items:end}
.sb-row .inst{display:flex; gap:10px; align-items:center; flex:0 0 auto; min-width:0}
.sb-row .act{display:flex; gap:5px; align-items:center; flex:0 0 auto}
.sb-row .nm{cursor:default; letter-spacing:.02em}
.sb-mkrow.sel{background:rgba(90,209,255,.045)}
.sb-mkrow.sel .sb-row .nm{color:var(--sb-swarm)}
.sb-row button.nm{
  background:transparent; border:0; color:inherit; font:inherit; padding:0;
  text-align:left; cursor:pointer; min-height:0;
}
.sb-row button.nm:hover{color:var(--sb-swarm)}
.sb-root .chip{display:flex; gap:4px; align-items:center; flex:0 0 auto; font-size:10px; white-space:nowrap}
.sb-root .chip.ix{width:8ch; justify-content:flex-start}
.sb-root .chip.sp{width:78px}
.sb-root .chip.bk{width:82px}
.sb-root .chip.cy{width:10ch}
.sb-root .chip.al{width:10ch}
.sb-root .chip .mark{font-size:9px}
.sb-root.narrow .sb-row{flex-wrap:wrap}
.sb-root.narrow .sb-row .main{flex:1 1 16ch}
.sb-root.narrow .sb-row .act{order:1}
.sb-root.narrow .sb-row .inst{order:2; flex:1 1 100%; padding:3px 0 1px; flex-wrap:wrap; gap:8px 12px}
.sb-root.narrow .sb-mkh .inst{display:none}

/* ---- the order panel ---- */
.sb-ord{padding:2px 0 10px; border-top:1px dashed rgba(28,32,41,.9); margin-top:2px}
.sb-ord .tabs{display:flex; gap:5px; align-items:center; padding:7px 0 6px}
.sb-ord .tabs .sp{margin-left:auto}
.sb-ord .sizer{display:flex; gap:5px; align-items:center; flex-wrap:wrap; padding-bottom:7px}
.sb-ord .sizer .of{font-size:10px; color:var(--sb-dim); margin-left:2px}
.sb-ord .line{display:flex; gap:12px; flex-wrap:wrap; font-size:11px; padding:3px 0}
.sb-ord .line .k{color:var(--sb-dim)}
.sb-ord .box{border:1px solid var(--sb-line); background:var(--sb-deep); padding:8px; margin:6px 0}
.sb-ord .box .cap{display:flex; gap:8px; align-items:baseline; padding-bottom:5px}
.sb-ord .go{width:100%; margin-top:5px}
.sb-ord .facts{display:grid; grid-template-columns:repeat(auto-fit,minmax(21ch,1fr)); gap:3px 14px; font-size:10px; padding-top:5px}
.sb-ord .facts .f{display:flex; gap:8px; justify-content:space-between; min-width:0}
.sb-ord .facts .f .k{white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.sb-ord .facts .f .num{white-space:nowrap}
.sb-ord .facts .f.wide{grid-column:1/-1}
.sb-ord .facts .f .k{color:var(--sb-dim)}
.sb-scrub{font-size:10px; color:var(--sb-dim); padding-top:4px; min-height:14px}
.sb-scrub b{font-weight:400; color:var(--sb-ink)}

/* ---- generic table used by refinery / forwards / fills ---- */
.sb-tab{display:flex; flex-direction:column; font-size:11px}
.sb-tab .r{display:flex; gap:10px; align-items:baseline; padding:4px 0; border-bottom:1px solid rgba(28,32,41,.55)}
.sb-tab .r:last-child{border-bottom:0}
.sb-tab .r.h{border-bottom:1px solid var(--sb-line); padding-bottom:3px}
.sb-tab .r .grow{flex:1 1 auto; min-width:0}
.sb-tab .r .rt{margin-left:auto; text-align:right}

/* ---- assay grid ---- */
.sb-assay{display:flex; flex-direction:column; gap:2px; font-size:10px}
.sb-assay .r{display:flex; gap:6px; align-items:center}
.sb-assay .d{width:5ch; color:var(--sb-dim); flex:0 0 auto}
.sb-assay .cells{display:grid; grid-template-columns:repeat(8,1fr); gap:2px; flex:1 1 auto}
.sb-assay .c{
  height:17px; display:flex; align-items:center; justify-content:center;
  border:1px solid rgba(28,32,41,.8); font-size:9px; letter-spacing:.04em;
}
.sb-assay .c.off{border-color:rgba(28,32,41,.35); color:transparent}
.sb-assay .tot{display:flex; gap:10px; flex-wrap:wrap; padding-top:6px; font-size:10px; color:var(--sb-dim)}
.sb-assay .tot b{font-weight:400}

/* ---- power cards ---- */
.sb-cards{display:flex; flex-direction:column; gap:6px}
.sb-card{
  border:1px solid var(--sb-line); border-left:2px solid var(--sb-line);
  background:var(--sb-panel); padding:8px 9px;
  display:flex; flex-direction:column; gap:4px;
}
.sb-card .top{display:flex; gap:8px; align-items:baseline}
.sb-card .nm{font-size:12px; letter-spacing:.06em}
.sb-card .doc{font-size:9px; letter-spacing:.11em; margin-left:auto}
.sb-card .rk{font-size:9px; color:var(--sb-dim); border:1px solid var(--sb-line); padding:0 4px}
.sb-card .ln{font-size:11px; color:var(--sb-ink)}
.sb-card .vs{font-size:10px; color:var(--sb-dim)}
.sb-card .buys{display:flex; gap:5px; align-items:center; padding-top:2px; flex-wrap:wrap}
.sb-card .buys .sp{margin-left:auto; font-size:10px; color:var(--sb-dim)}
.sb-card.key{border-color:#3a4256}
.sb-card.key .kt{font-size:9px; letter-spacing:.14em; color:var(--sb-gold)}
.sb-card.dead{opacity:.45}

/* ---- upgrade offers ---- */
.sb-offs{display:flex; flex-direction:column}
.sb-off{display:flex; gap:10px; align-items:center; padding:6px 0; border-bottom:1px solid rgba(28,32,41,.55); flex-wrap:wrap}
.sb-off:last-child{border-bottom:0}
.sb-off .l{flex:1 1 12ch; min-width:0}
.sb-off .nm{font-size:11px}
.sb-off .ds{font-size:10px; color:var(--sb-dim)}
.sb-off .cost{display:flex; gap:8px; flex-wrap:wrap; font-size:10px; flex:1 1 auto}
.sb-off .cost .c{white-space:nowrap}
.sb-off .b{display:flex; gap:5px; margin-left:auto}

/* ---- codex ---- */
.sb-cdx{display:flex; flex-direction:column; gap:10px}
.sb-cdx .doc{border-left:2px solid var(--sb-line); padding-left:8px}
.sb-cdx .doc .h{display:flex; gap:8px; align-items:baseline}
.sb-cdx .doc .h .n{font-size:11px; letter-spacing:.12em}
.sb-cdx .doc .h .p{font-size:10px; color:var(--sb-dim); margin-left:auto}
.sb-cdx .doc .cr{font-size:10px; color:var(--sb-dim); padding-bottom:3px}
.sb-cdx .e{display:flex; gap:8px; align-items:baseline; font-size:10px; padding:1px 0}
.sb-cdx .e .n{width:13ch; flex:0 0 auto}
.sb-cdx .e .l{color:var(--sb-dim); flex:1 1 auto; min-width:0}
.sb-cdx .e.un .n{color:var(--sb-dim)}
.sb-cdx .hidden-n{font-size:10px; color:var(--sb-dim); letter-spacing:.3em}
.sb-cdx .rev{display:flex; gap:8px; align-items:baseline; font-size:10px; padding:1px 0}
.sb-cdx .rev .d{width:4ch; color:var(--sb-dim); text-align:right; flex:0 0 auto}
.sb-cdx .rev.locked{opacity:.45}

/* ---- wager ---- */
.sb-wg .ln{display:flex; gap:10px; align-items:baseline; padding-bottom:6px}
.sb-wg .ln b{font-size:17px; font-weight:600; letter-spacing:-.02em}
.sb-wg .sides{display:flex; gap:6px; align-items:center; flex-wrap:wrap}
.sb-wg .hist{display:flex; gap:2px; align-items:flex-end; padding-top:8px; height:22px}
.sb-wg .hist i{width:5px; background:var(--sb-line); display:block}
.sb-wg .hist i.won{background:var(--sb-good)} .sb-wg .hist i.lost{background:var(--sb-hot)}

/* ---- next teaser ---- */
.sb-next{padding:8px 12px; font-size:10px; color:var(--sb-dim); display:flex; gap:8px; align-items:baseline}
.sb-next b{font-weight:400; color:#9aa2ae}

/* ---- busy state: the swarm is working, nothing is clickable ---- */
.sb-root.busy .sb-deck{opacity:.62}
.sb-busy{
  padding:8px 12px; font-size:10px; letter-spacing:.14em; text-transform:uppercase;
  color:var(--sb-swarm); border-bottom:1px solid var(--sb-line);
}

/* ---- run end ---- */
.sb-over{
  position:fixed; inset:0; z-index:40; background:rgba(8,9,12,.955);
  display:none; align-items:center; justify-content:center; padding:20px;
  overflow:auto;
}
.sb-over.open{display:flex}
.sb-over .card{width:100%; max-width:460px; display:flex; flex-direction:column; gap:12px}
.sb-over h2{margin:0; font-size:19px; font-weight:600; letter-spacing:-.02em}
.sb-over .grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(11ch,1fr)); gap:10px 14px}
.sb-over .grid .st b{display:block; font-size:16px; font-weight:600; letter-spacing:-.02em}
.sb-over .rows{display:flex; flex-direction:column; gap:2px; font-size:10px; color:var(--sb-dim)}

/* ---- svg ---- */
.sb-root svg{display:block; overflow:visible}
.sb-root .plot{border:1px solid var(--sb-line); background:var(--sb-deep)}
.sb-root .scrub{touch-action:none}
`;


// ===========================================================================
// SMALL HELPERS
// ===========================================================================

const NS = 'http://www.w3.org/2000/svg';

function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) { n.textContent = text; n.__t = text; }
  return n;
}

function svgEl(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

function attr(node, name, value) {
  const v = String(value);
  if (node.__a === undefined) node.__a = {};
  if (node.__a[name] === v) return;
  node.__a[name] = v;
  node.setAttribute(name, v);
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); node.__k = null; }

function on(node, ev, fn, opts) { node.addEventListener(ev, fn, opts); return node; }

function show(node, yes) {
  if (!node) return node;
  const want = !yes;
  if (node.__hid === want) return node;
  node.__hid = want;
  node.classList.toggle('sb-hid', want);
  return node;
}

/**
 * Write text only when it actually changed, so a 60fps repaint does not blow
 * away selection, focus or scroll. Optionally flash the direction of change,
 * which is how a value that moved announces itself with no sound involved.
 */
function setText(node, text, dir) {
  if (node == null) return false;
  const s = text == null ? '' : String(text);
  if (node.__t === s) return false;
  const first = node.__t === undefined;
  node.__t = s;
  node.textContent = s;
  if (!first && dir) flash(node, dir);
  return true;
}

/** Same, but works out the direction from the previous numeric value. */
function setNum(node, text, value) {
  const prev = node.__n;
  node.__n = value;
  const dir = prev == null || value == null || !isFinite(prev) || !isFinite(value) ? 0
    : value > prev ? 1 : value < prev ? -1 : 0;
  return setText(node, text, dir);
}

function flash(node, dir) {
  if (!dir) return;
  node.classList.add('flashable');
  node.classList.remove('fl-up', 'fl-dn');
  // force the class change to land before the transition back
  void node.offsetWidth;
  node.classList.add(dir > 0 ? 'fl-up' : 'fl-dn');
  clearTimeout(node.__ft);
  node.__ft = setTimeout(() => node.classList.remove('fl-up', 'fl-dn'), 420);
}

function cls(node, name, yes) { node.classList.toggle(name, !!yes); return node; }

function tint(node, colour) {
  if (node.__c === colour) return node;
  node.__c = colour;
  node.style.color = colour || '';
  return node;
}

/**
 * Reconcile a list of items against a container's children by key. Keeps
 * existing nodes (and their focus, scroll and input state) wherever the key
 * survives, and keeps DOM order matching the data order.
 */
function keyed(parent, items, keyOf, create, update) {
  const map = parent.__k || (parent.__k = new Map());
  const seen = new Set();
  let prev = null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const k = String(keyOf(item, i));
    seen.add(k);
    let node = map.get(k);
    if (!node) { node = create(item, k, i); map.set(k, node); }
    const want = prev ? prev.nextSibling : parent.firstChild;
    if (want !== node) parent.insertBefore(node, want);
    if (update) update(node, item, k, i);
    prev = node;
  }
  for (const [k, node] of map) {
    if (!seen.has(k)) { node.remove(); map.delete(k); }
  }
  return parent;
}


// ===========================================================================
// MAGNITUDE AND FORMATTING
//
// Balances arrive as {m, e} mantissa/exponent pairs, as plain numbers, or as
// strings already formatted by the caller. Everything here reads all three.
// This is presentation only: it scales and prints values, and knows nothing
// about what they mean.
// ===========================================================================

const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

function isMag(v) {
  return v != null && typeof v === 'object' && typeof v.m === 'number' && typeof v.e === 'number';
}

function normMag(m, e) {
  if (!isFinite(m) || m === 0) return { m: 0, e: 0 };
  const sign = m < 0 ? -1 : 1;
  const a = Math.abs(m);
  const d = Math.floor(Math.log10(a));
  const nm = a / Math.pow(10, d);
  return { m: sign * (isFinite(nm) ? nm : 1), e: e + d };
}

function toMag(v) {
  if (isMag(v)) return normMag(v.m, v.e);
  const n = Number(v);
  return normMag(isFinite(n) ? n : 0, 0);
}

/** A float, saturating rather than becoming Infinity in the middle of layout. */
function num(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : (v > 0 ? 1e308 : -1e308);
  if (isMag(v)) {
    if (v.e > 300) return v.m < 0 ? -1e308 : 1e308;
    if (v.e < -300) return 0;
    const n = v.m * Math.pow(10, v.e);
    return isFinite(n) ? n : (v.m < 0 ? -1e308 : 1e308);
  }
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/** Multiply by a plain factor, staying in whichever representation came in. */
function scaleBy(v, k) {
  if (isMag(v)) { const a = normMag(v.m * k, v.e); return a; }
  return num(v) * k;
}

/** log10 of a magnitude, floored at a very small number so charts stay finite. */
function mlog(v) {
  const a = toMag(v);
  if (a.m === 0) return -Infinity;
  return a.e + Math.log10(Math.abs(a.m));
}

function cmpMag(a, b) {
  const x = toMag(a), y = toMag(b);
  if (x.m === 0 && y.m === 0) return 0;
  if (x.m === 0) return y.m > 0 ? -1 : 1;
  if (y.m === 0) return x.m > 0 ? 1 : -1;
  if ((x.m < 0) !== (y.m < 0)) return x.m < 0 ? -1 : 1;
  const s = x.m < 0 ? -1 : 1;
  if (x.e !== y.e) return x.e > y.e ? s : -s;
  return x.m === y.m ? 0 : (x.m > y.m ? s : -s);
}

/** Short human form: 1.24K, 8.03Qa, 3.11e57. Matches the modules' own output. */
function fmtDefault(v, places) {
  if (v == null) return '-';
  if (typeof v === 'string') return v;
  const a = toMag(v);
  if (a.m === 0) return '0';
  const sign = a.m < 0 ? '-' : '';
  const m = Math.abs(a.m), e = a.e;
  const p = places == null ? 2 : places;
  if (e < 0) {
    const n = m * Math.pow(10, e);
    return sign + (n < 0.01 ? n.toExponential(1) : n.toFixed(p));
  }
  if (e < 3) {
    const n = m * Math.pow(10, e);
    const r = Math.round(n * 100) / 100;
    return sign + (Number.isInteger(r) ? String(r) : String(r));
  }
  let t = Math.floor(e / 3);
  let x = m * Math.pow(10, e - t * 3);
  if (x >= 999.995 && t + 1 < SUFFIX.length) { t += 1; x /= 1000; }
  if (t < SUFFIX.length) return sign + (x >= 100 ? String(Math.round(x)) : x.toFixed(p)) + SUFFIX[t];
  return sign + m.toFixed(2) + 'e' + e;
}

const signPct = (x, d) => (x == null || !isFinite(x) ? '-' : (x >= 0 ? '+' : '') + (x * 100).toFixed(d == null ? 1 : d) + '%');
const mult = (x, d) => (x == null || !isFinite(x) ? '-' : 'x' + x.toFixed(d == null ? 2 : d));
const ix = (x) => (x == null || !isFinite(x) ? '-' : x.toFixed(2));
const bookText = (u) => (u == null || !isFinite(u) ? '-' : (u >= 10 ? u.toFixed(1) : u.toFixed(2)) + 'x');
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

/** A word for a direction, so nothing depends on colour alone. */
function trendWord(x, eps) {
  const e = eps == null ? 0.005 : eps;
  if (x == null || !isFinite(x)) return { g: '-', w: 'flat', d: 0 };
  if (x > e) return { g: '▲', w: 'rising', d: 1 };
  if (x < -e) return { g: '▼', w: 'falling', d: -1 };
  return { g: '-', w: 'flat', d: 0 };
}


// ===========================================================================
// CHARTS
//
// Inline SVG built from the data given. Everything is plotted in real pixels
// against a viewBox of the same size, so strokes are one device pixel and text
// is never scaled. No library, no canvas, no images.
// ===========================================================================

/**
 * A tiny index sparkline with the 1.00 line drawn through it, which is the
 * whole point: at a glance you see whether a good is above or below normal and
 * which way it has been going.
 */
function makeSpark(w, hgt) {
  const root = svgEl('svg', { width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}`, 'aria-hidden': 'true', class: 'spark' });
  const base = svgEl('line', { x1: 0, x2: w, stroke: 'currentColor', 'stroke-width': 1, opacity: .28, 'stroke-dasharray': '2 3' });
  const path = svgEl('polyline', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.25, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
  const dot = svgEl('circle', { r: 1.7, fill: 'currentColor' });
  root.appendChild(base); root.appendChild(path); root.appendChild(dot);
  root.style.color = 'var(--sb-dim)';

  return {
    el: root,
    /** series: array of numbers. anchor: value the dashed baseline sits at. */
    draw(series, anchor, accent) {
      const n = series ? series.length : 0;
      if (n < 2) { show(path, false); show(dot, false); show(base, false); return; }
      show(path, true); show(dot, true); show(base, true);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < n; i++) { const v = series[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      if (anchor != null) { if (anchor < lo) lo = anchor; if (anchor > hi) hi = anchor; }
      if (!isFinite(lo) || !isFinite(hi)) { show(path, false); return; }
      const pad = (hi - lo) * 0.12 || Math.max(0.02, Math.abs(hi) * 0.04) || 0.02;
      lo -= pad; hi += pad;
      const span = hi - lo || 1;
      const y = (v) => hgt - 1.5 - ((v - lo) / span) * (hgt - 3);
      const x = (i) => (i / (n - 1)) * (w - 2) + 1;
      let d = '';
      for (let i = 0; i < n; i++) d += (i ? ' ' : '') + x(i).toFixed(1) + ',' + y(series[i]).toFixed(1);
      attr(path, 'points', d);
      if (anchor != null) { attr(base, 'y1', y(anchor).toFixed(1)); attr(base, 'y2', y(anchor).toFixed(1)); show(base, true); }
      else show(base, false);
      attr(dot, 'cx', x(n - 1).toFixed(1));
      attr(dot, 'cy', y(series[n - 1]).toFixed(1));
      dot.style.fill = accent || 'currentColor';
    },
  };
}

/**
 * The book depth meter. The book runs from nearly empty to heavily flooded over
 * three orders of magnitude, so it is drawn on a log scale with a hard tick at
 * normal depth. Left of the tick the market is short and paying up; right of it
 * you are selling into your own backlog.
 */
function makeMeter(w, hgt, lo, hi, tickAt) {
  const root = svgEl('svg', { width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}`, 'aria-hidden': 'true' });
  const frame = svgEl('rect', { x: .5, y: .5, width: w - 1, height: hgt - 1, fill: 'none', stroke: 'var(--sb-line)' });
  const fill = svgEl('rect', { x: 1, y: 1, height: hgt - 2, fill: 'currentColor', opacity: .5 });
  const tick = svgEl('line', { y1: 0, y2: hgt, stroke: 'var(--sb-ink)', 'stroke-width': 1, opacity: .55 });
  root.appendChild(fill); root.appendChild(frame); root.appendChild(tick);
  const l0 = Math.log10(lo), l1 = Math.log10(hi);
  const pos = (v) => clamp((Math.log10(clamp(v, lo, hi)) - l0) / (l1 - l0), 0, 1);
  attr(tick, 'x1', (pos(tickAt) * (w - 2) + 1).toFixed(1));
  attr(tick, 'x2', (pos(tickAt) * (w - 2) + 1).toFixed(1));
  return {
    el: root,
    draw(v, colour) {
      if (v == null || !isFinite(v)) { show(fill, false); return; }
      show(fill, true);
      attr(fill, 'width', Math.max(1, pos(v) * (w - 2)).toFixed(1));
      root.style.color = colour || 'var(--sb-dim)';
    },
  };
}

/**
 * The ledger: index over depth, with the six-depth market epochs banded behind
 * it. The bands are what turn "the schedule is fixed" into something you can
 * see - the rhythm of the market is drawn under the price rather than looked up
 * in a table. Scrub it with a pointer or a finger to read any point exactly.
 */
function makeLedger(height, onScrub) {
  const root = h('div', 'ledger');
  const svg = svgEl('svg', { class: 'plot scrub', width: '100%', height: height, preserveAspectRatio: 'none', role: 'img' });
  const gBand = svgEl('g', {});
  const gGrid = svgEl('g', {});
  const gPath = svgEl('g', {});
  const base = svgEl('line', { stroke: 'var(--sb-ink)', 'stroke-width': 1, opacity: .32, 'stroke-dasharray': '3 4' });
  const line = svgEl('polyline', { fill: 'none', stroke: 'var(--sb-swarm)', 'stroke-width': 1.4, 'stroke-linejoin': 'round' });
  const fut = svgEl('polyline', { fill: 'none', stroke: 'var(--sb-gold)', 'stroke-width': 1.1, 'stroke-dasharray': '3 3', opacity: .8 });
  const cur = svgEl('line', { stroke: 'var(--sb-swarm)', 'stroke-width': 1, opacity: .35 });
  const dot = svgEl('circle', { r: 2.2, fill: 'var(--sb-swarm)' });
  const cross = svgEl('line', { stroke: 'var(--sb-ink)', 'stroke-width': 1, opacity: .45 });
  const hitRect = svgEl('rect', { fill: 'transparent', y: 0, x: 0, height: height });
  const yTop = svgEl('text', { x: 3, 'font-size': 9, fill: 'var(--sb-dim)' });
  const yBot = svgEl('text', { x: 3, 'font-size': 9, fill: 'var(--sb-dim)' });
  const yOne = svgEl('text', { x: 3, 'font-size': 9, fill: 'var(--sb-dim)' });
  gPath.appendChild(base); gPath.appendChild(fut); gPath.appendChild(line);
  gPath.appendChild(cur); gPath.appendChild(dot); gPath.appendChild(cross);
  svg.appendChild(gBand); svg.appendChild(gGrid); svg.appendChild(gPath);
  svg.appendChild(yTop); svg.appendChild(yBot); svg.appendChild(yOne);
  svg.appendChild(hitRect);
  root.appendChild(svg);
  const read = h('div', 'sb-scrub');
  root.appendChild(read);

  let W = 0, pts = [], model = null;

  function xOf(depth) {
    if (!model || model.span <= 0) return 0;
    return ((depth - model.d0) / model.span) * (W - 2) + 1;
  }
  function yOf(v) {
    if (!model) return 0;
    return height - 12 - ((v - model.lo) / model.range) * (height - 22);
  }

  function locate(clientX) {
    const r = svg.getBoundingClientRect();
    if (!r.width || !pts.length) return null;
    const px = ((clientX - r.left) / r.width) * W;
    let best = pts[0], bd = Infinity;
    for (const p of pts) { const d = Math.abs(p.x - px); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  function hover(ev) {
    const p = locate(ev.clientX);
    if (!p) return;
    attr(cross, 'x1', p.x.toFixed(1)); attr(cross, 'x2', p.x.toFixed(1));
    attr(cross, 'y1', 0); attr(cross, 'y2', height);
    show(cross, true);
    if (onScrub) onScrub(p.raw, read);
  }
  function leave() { show(cross, false); if (onScrub) onScrub(null, read); }

  on(svg, 'pointerdown', (e) => { svg.setPointerCapture(e.pointerId); hover(e); e.preventDefault(); });
  on(svg, 'pointermove', (e) => { if (e.buttons || e.pointerType === 'mouse') hover(e); });
  on(svg, 'pointerup', () => leave());
  on(svg, 'pointercancel', () => leave());
  on(svg, 'pointerleave', () => leave());

  return {
    el: root,
    readout: read,
    /**
     * series  [{depth, value}]  the history, oldest first
     * ahead   [{depth, value}]  optional forward curve drawn dashed
     * anchor  value the dashed baseline sits at, usually 1.00
     * epoch   band cadence in depths; 0 turns banding off
     * labels  optional map of depth -> short label drawn at the top of a band
     */
    draw(series, ahead, anchor, epoch, labels) {
      W = Math.max(80, Math.round(svg.getBoundingClientRect().width) || 300);
      attr(svg, 'viewBox', `0 0 ${W} ${height}`);
      attr(hitRect, 'width', W);
      const all = (series || []).concat(ahead || []);
      if (all.length < 2) { show(gPath, false); show(gBand, false); pts = []; return; }
      show(gPath, true); show(gBand, true);

      const d0 = all[0].depth, d1 = all[all.length - 1].depth;
      let lo = Infinity, hi = -Infinity;
      for (const p of all) { if (p.value < lo) lo = p.value; if (p.value > hi) hi = p.value; }
      if (anchor != null) { if (anchor < lo) lo = anchor; if (anchor > hi) hi = anchor; }
      const pad = (hi - lo) * 0.14 || Math.max(0.05, Math.abs(hi) * 0.08) || 0.05;
      const floorAtZero = lo >= 0;
      lo -= pad; hi += pad;
      if (floorAtZero && lo < 0) lo = 0;
      model = { d0, span: Math.max(1, d1 - d0), lo, range: (hi - lo) || 1 };

      // epoch bands, alternating, with an optional name on each
      if (epoch > 0) {
        const bands = [];
        const first = Math.floor((d0 - 1) / epoch);
        const last = Math.floor((d1 - 1) / epoch);
        for (let e = first; e <= last; e++) {
          const s = Math.max(d0, e * epoch + 1);
          const t = Math.min(d1, (e + 1) * epoch);
          bands.push({ e, s, t });
        }
        keyed(gBand, bands, (b) => b.e, () => {
          const g = svgEl('g', {});
          g.appendChild(svgEl('rect', { y: 0, height: height, fill: 'var(--sb-ink)' }));
          g.appendChild(svgEl('text', { 'font-size': 8, fill: 'var(--sb-dim)', y: 9 }));
          return g;
        }, (g, b) => {
          const r = g.firstChild, tx = g.lastChild;
          const x0 = xOf(b.s), x1 = xOf(b.t);
          attr(r, 'x', x0.toFixed(1));
          attr(r, 'width', Math.max(0, x1 - x0).toFixed(1));
          attr(r, 'opacity', b.e % 2 ? 0.05 : 0.015);
          const lbl = labels ? labels[b.s] || labels[b.e * epoch + 1] : null;
          setText(tx, lbl || '');
          attr(tx, 'x', (x0 + 3).toFixed(1));
        });
      } else clear(gBand);

      // the series
      pts = [];
      let d = '';
      for (let i = 0; i < series.length; i++) {
        const p = series[i], x = xOf(p.depth), y = yOf(p.value);
        d += (i ? ' ' : '') + x.toFixed(1) + ',' + y.toFixed(1);
        pts.push({ x, y, raw: p });
      }
      attr(line, 'points', d);

      if (ahead && ahead.length > 1) {
        let f = '';
        for (let i = 0; i < ahead.length; i++) {
          const p = ahead[i], x = xOf(p.depth), y = yOf(p.value);
          f += (i ? ' ' : '') + x.toFixed(1) + ',' + y.toFixed(1);
          pts.push({ x, y, raw: p });
        }
        attr(fut, 'points', f); show(fut, true);
      } else show(fut, false);

      if (anchor != null) {
        const y = yOf(anchor);
        attr(base, 'x1', 0); attr(base, 'x2', W); attr(base, 'y1', y.toFixed(1)); attr(base, 'y2', y.toFixed(1));
        setText(yOne, ix(anchor)); attr(yOne, 'y', (y - 2).toFixed(1)); show(yOne, true); show(base, true);
      } else { show(base, false); show(yOne, false); }

      const lastReal = series[series.length - 1];
      if (lastReal) {
        const x = xOf(lastReal.depth);
        attr(cur, 'x1', x.toFixed(1)); attr(cur, 'x2', x.toFixed(1)); attr(cur, 'y1', 0); attr(cur, 'y2', height);
        attr(dot, 'cx', x.toFixed(1)); attr(dot, 'cy', yOf(lastReal.value).toFixed(1));
      }
      setText(yTop, ix(hi)); attr(yTop, 'y', 9);
      setText(yBot, ix(lo)); attr(yBot, 'y', height - 3);
      show(cross, false);
    },
  };
}

/**
 * The fill curve. An order does not fill at the posted price; it walks the book
 * down as it goes. This draws unit price against order size with the chosen
 * size marked, so the cost of going one size bigger is a shape rather than a
 * paragraph. It is the single most useful picture in the market.
 */
function makeCurve(height) {
  const root = svgEl('svg', { class: 'plot', width: '100%', height: height, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const area = svgEl('polyline', { fill: 'none', stroke: 'var(--sb-swarm)', 'stroke-width': 1.4 });
  const spot = svgEl('line', { stroke: 'var(--sb-ink)', 'stroke-width': 1, opacity: .3, 'stroke-dasharray': '3 4' });
  const pick = svgEl('line', { stroke: 'var(--sb-gold)', 'stroke-width': 1 });
  const pdot = svgEl('circle', { r: 2.4, fill: 'var(--sb-gold)' });
  const lab = svgEl('text', { 'font-size': 9, fill: 'var(--sb-dim)', x: 3, y: 9 });
  root.appendChild(spot); root.appendChild(area); root.appendChild(pick); root.appendChild(pdot); root.appendChild(lab);
  return {
    el: root,
    /** samples: [{q, unit}] ascending in q. atQ: the chosen size. */
    draw(samples, atQ, spotUnit, caption) {
      const W = Math.max(80, Math.round(root.getBoundingClientRect().width) || 300);
      attr(root, 'viewBox', `0 0 ${W} ${height}`);
      if (!samples || samples.length < 2) { show(area, false); show(pick, false); show(pdot, false); show(spot, false); return; }
      show(area, true);
      let lo = Infinity, hi = -Infinity;
      for (const s of samples) { if (s.unit < lo) lo = s.unit; if (s.unit > hi) hi = s.unit; }
      if (spotUnit != null && isFinite(spotUnit)) { if (spotUnit < lo) lo = spotUnit; if (spotUnit > hi) hi = spotUnit; }
      const pad = (hi - lo) * 0.16 || Math.max(1e-6, hi * 0.08);
      lo -= pad; hi += pad;
      const qmax = samples[samples.length - 1].q || 1;
      const x = (q) => (q / qmax) * (W - 2) + 1;
      const y = (v) => height - 3 - ((v - lo) / ((hi - lo) || 1)) * (height - 14);
      let d = '';
      for (let i = 0; i < samples.length; i++) d += (i ? ' ' : '') + x(samples[i].q).toFixed(1) + ',' + y(samples[i].unit).toFixed(1);
      attr(area, 'points', d);
      if (spotUnit != null && isFinite(spotUnit)) {
        const sy = y(spotUnit);
        attr(spot, 'x1', 0); attr(spot, 'x2', W); attr(spot, 'y1', sy.toFixed(1)); attr(spot, 'y2', sy.toFixed(1));
        show(spot, true);
      } else show(spot, false);
      if (atQ != null && atQ > 0) {
        let best = samples[0];
        for (const s of samples) if (Math.abs(s.q - atQ) < Math.abs(best.q - atQ)) best = s;
        const px = x(clamp(atQ, 0, qmax));
        attr(pick, 'x1', px.toFixed(1)); attr(pick, 'x2', px.toFixed(1)); attr(pick, 'y1', 0); attr(pick, 'y2', height);
        attr(pdot, 'cx', px.toFixed(1)); attr(pdot, 'cy', y(best.unit).toFixed(1));
        show(pick, true); show(pdot, true);
      } else { show(pick, false); show(pdot, false); }
      setText(lab, caption || '');
    },
  };
}

/**
 * A labelled bar row. Used for the forward term curve and for order-splitting
 * plans, both of which are "ten options, pick the tall one" problems and both
 * of which are unreadable as a table on a narrow screen.
 */
function makeBars(height, onPick) {
  const root = svgEl('svg', { class: 'plot', width: '100%', height: height, preserveAspectRatio: 'none' });
  const g = svgEl('g', {});
  const zero = svgEl('line', { stroke: 'var(--sb-ink)', 'stroke-width': 1, opacity: .25, 'stroke-dasharray': '3 4' });
  root.appendChild(zero); root.appendChild(g);
  return {
    el: root,
    /** bars: [{key, label, value, tone, picked, sub}] */
    draw(bars, baseline) {
      const W = Math.max(80, Math.round(root.getBoundingClientRect().width) || 300);
      attr(root, 'viewBox', `0 0 ${W} ${height}`);
      if (!bars || !bars.length) { clear(g); show(zero, false); return; }
      let lo = 0, hi = 0;
      for (const b of bars) { if (b.value < lo) lo = b.value; if (b.value > hi) hi = b.value; }
      if (baseline != null) { if (baseline < lo) lo = baseline; if (baseline > hi) hi = baseline; }
      if (hi === lo) hi = lo + 1;
      const top = 12, bot = height - 12;
      const y = (v) => bot - ((v - lo) / (hi - lo)) * (bot - top);
      const bw = (W - 2) / bars.length;
      const y0 = y(baseline != null ? baseline : Math.max(0, lo));
      attr(zero, 'x1', 0); attr(zero, 'x2', W); attr(zero, 'y1', y0.toFixed(1)); attr(zero, 'y2', y0.toFixed(1));
      show(zero, true);
      keyed(g, bars, (b) => b.key, (b) => {
        const grp = svgEl('g', { style: 'cursor:pointer' });
        grp.appendChild(svgEl('rect', {}));
        grp.appendChild(svgEl('text', { 'font-size': 8, 'text-anchor': 'middle', fill: 'var(--sb-dim)' }));
        grp.appendChild(svgEl('text', { 'font-size': 8, 'text-anchor': 'middle', fill: 'var(--sb-dim)' }));
        on(grp, 'pointerdown', () => { if (onPick) onPick(grp.__key); });
        return grp;
      }, (grp, b, k, i) => {
        grp.__key = b.key;
        const r = grp.childNodes[0], t1 = grp.childNodes[1], t2 = grp.childNodes[2];
        const x = i * bw + 1;
        const yv = y(b.value);
        attr(r, 'x', (x + 1).toFixed(1));
        attr(r, 'width', Math.max(1, bw - 3).toFixed(1));
        attr(r, 'y', Math.min(yv, y0).toFixed(1));
        attr(r, 'height', Math.max(1, Math.abs(yv - y0)).toFixed(1));
        attr(r, 'fill', b.tone || 'var(--sb-dim)');
        attr(r, 'opacity', b.picked ? 1 : .55);
        setText(t1, b.label || '');
        attr(t1, 'x', (x + bw / 2).toFixed(1));
        attr(t1, 'y', height - 3);
        attr(t1, 'fill', b.picked ? 'var(--sb-ink)' : 'var(--sb-dim)');
        setText(t2, b.sub || '');
        attr(t2, 'x', (x + bw / 2).toFixed(1));
        attr(t2, 'y', 8);
        attr(t2, 'fill', b.picked ? 'var(--sb-ink)' : 'var(--sb-dim)');
      });
    },
  };
}

/**
 * Where a good sits in its demand cycle, as a position on the wave rather than
 * a number. Small enough for a table cell; the period is printed beside it.
 */
function makeDial(w, hgt) {
  const root = svgEl('svg', { width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}`, 'aria-hidden': 'true' });
  const wave = svgEl('path', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1, opacity: .4 });
  const dot = svgEl('circle', { r: 1.8, fill: 'currentColor' });
  root.appendChild(wave); root.appendChild(dot);
  let d = '';
  const mid = hgt / 2, amp = (hgt - 4) / 2;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const x = t * (w - 2) + 1;
    const y = mid - Math.sin(t * Math.PI * 2) * amp;
    d += (i ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }
  attr(wave, 'd', d);
  return {
    el: root,
    /** phase: 0..1 through the cycle. */
    draw(phase, colour) {
      if (phase == null || !isFinite(phase)) { show(dot, false); return; }
      show(dot, true);
      const t = ((phase % 1) + 1) % 1;
      attr(dot, 'cx', (t * (w - 2) + 1).toFixed(1));
      attr(dot, 'cy', (mid - Math.sin(t * Math.PI * 2) * amp).toFixed(1));
      root.style.color = colour || 'var(--sb-dim)';
    },
  };
}


// ===========================================================================
// SECTIONS
//
// Every part of the deck is a section, and every section keeps a one-line
// summary in its own header. That is what lets a deep run stay dense without
// becoming a wall: six closed lines each printing their most decision-relevant
// number, and whichever one the player is actually working in left open.
//
// When there is only one section on screen - which is the whole of a first run
// - the header is dropped entirely and the body stands alone. A new player
// never sees a collapsed panel, a caret, or a title bar.
// ===========================================================================

function makeSection(U, name, title) {
  const el = h('section', 'sb-sec');
  el.dataset.name = name;
  const hd = h('button', 'hd');
  hd.type = 'button';
  const caret = h('span', 'caret', '▾');
  const t = h('span', 't', title);
  const sum = h('span', 'sum', '');
  hd.appendChild(caret); hd.appendChild(t); hd.appendChild(sum);
  const bd = h('div', 'bd');
  el.appendChild(hd); el.appendChild(bd);
  on(hd, 'click', () => U.toggleSection(name));
  const sec = { name, el, hd, caret, titleEl: t, sumEl: sum, bd, live: false };
  sec.summary = (text) => setText(sum, text || '');
  return sec;
}


// ===========================================================================
// THE RUN HEADER
//
// Three figures that are always there - depth, swarm, essence - and a second
// line of instruments that fills in as the run earns them. The big three never
// move, never change size and never get pushed around by the arrival of
// anything else, which is what makes the header feel like the same object at
// depth 1 and at depth 500.
// ===========================================================================

function makeHeader(U) {
  const el = h('div', 'sb-hd');
  const grp = h('div', 'grp');
  el.appendChild(grp);

  function stat(sub, klass) {
    const box = h('div', 'st');
    const b = h('b', klass || '');
    const s = h('div', 'sub', sub);
    box.appendChild(b); box.appendChild(s);
    grp.appendChild(box);
    return { box, b, s };
  }

  const depth = stat('depth');
  const swarm = stat('swarm', 'cy');
  const ess = stat('essence', 'gold');

  const tools = h('div', 'grp');
  tools.style.gap = '4px';
  el.appendChild(tools);

  const strip = h('div', 'sb-strip');

  const toolBtns = {};
  function toolButton(name, label) {
    const b = h('button', 'btn ghost', label);
    b.type = 'button';
    on(b, 'click', () => U.reveal(name));
    tools.appendChild(b);
    show(b, false);
    toolBtns[name] = b;
    return b;
  }
  toolButton('codex', 'codex');
  toolButton('feats', 'awards');
  toolButton('boards', 'ranks');

  return {
    el, strip,
    paint(m) {
      const r = m.run || {};
      const mk = m.market || {};

      setNum(depth.b, String(r.depth == null ? '-' : r.depth), num(r.depth));
      setText(depth.s, r.reach != null && r.reach > (r.depth || 0) ? 'depth / best ' + r.reach : 'depth');

      const swarmTxt = r.swarmText != null ? r.swarmText : U.fmt(r.swarm);
      setNum(swarm.b, swarmTxt, mlog(r.swarm));
      setText(swarm.s, r.swarmWord ? 'swarm / ' + r.swarmWord : 'swarm');

      const essV = r.essence != null ? r.essence : mk.essence;
      const essTxt = r.essenceText != null ? r.essenceText : (mk.essenceText != null ? mk.essenceText : U.fmt(essV));
      setNum(ess.b, essTxt, mlog(essV));
      setText(ess.s, 'cash');

      // The instrument strip: only the facts this run has actually earned.
      const items = [];
      const push = (k, v, klass) => { if (v != null && v !== '') items.push({ k, v: String(v), klass }); };
      if (r.damage != null || r.damageText != null) push('dmg', r.damageText != null ? r.damageText : U.fmt(r.damage));
      if (r.bodies != null) push('bodies', r.bodyStack != null && num(r.bodyStack) > 1
        ? r.bodies + ' x' + U.fmt(r.bodyStack) : String(r.bodies));
      // net worth is a market reading, so it waits for the ledger like every
      // other market reading does
      if (mk.worth && U.has(m, 'ledger')) push('worth', mk.worth.text != null ? mk.worth.text : U.fmt(mk.worth), 'gold');
      else if (r.worth != null || r.worthText != null) push('worth', r.worthText != null ? r.worthText : U.fmt(r.worth), 'gold');
      if (mk.standing != null && U.has(m, 'consignments')) push('standing', mk.standing + '/100');
      if (r.pattern) push('field', r.pattern);
      if (mk.boost) push('boost', 'x' + mk.boost.mult + ' for ' + plural(mk.boost.turns, 'turn'));
      if (r.feats && r.feats.total) push('feats', r.feats.earned + '/' + r.feats.total);
      if (r.extra) for (const e of r.extra) push(e.k, e.v, e.klass);

      keyed(strip, items, (it) => it.k, () => {
        const n = h('div', 'it');
        n.appendChild(h('span', 'lab'));
        n.appendChild(h('span', 'v num'));
        return n;
      }, (n, it) => {
        setText(n.firstChild, it.k);
        setText(n.lastChild, it.v);
        n.lastChild.className = 'v num' + (it.klass ? ' ' + it.klass : '');
      });
      show(strip, items.length > 0);

      for (const k in toolBtns) show(toolBtns[k], U.sectionLive(k));
    },
  };
}


// ===========================================================================
// THE REGIME BAND
//
// The market reorganises itself on a fixed timetable. Once that is revealed it
// gets a permanent line of its own, because knowing a glut is two depths out is
// worth more than any other single fact on the screen. The pips count out where
// in the epoch the run is standing.
// ===========================================================================

function makeRegime(U) {
  const el = h('div', 'sb-reg');
  const nm = h('span', 'nm');
  const note = h('span', 'dim tiny ell');
  const muls = h('span', 'mul');
  const clock = h('div', 'clock');
  const ends = h('span', 'lab');
  el.appendChild(nm); el.appendChild(muls); el.appendChild(note);
  el.appendChild(ends); el.appendChild(clock);

  return {
    el,
    paint(m) {
      const mk = m.market || {};
      const r = mk.regime;
      if (!r) { show(el, false); return; }
      show(el, true);
      setText(nm, String(r.name || r.id || '').toUpperCase());
      const parts = [];
      if (r.mul) for (const tier of ['raw', 'refined', 'apex']) {
        if (r.mul[tier] != null) parts.push(tier + ' x' + r.mul[tier].toFixed(2));
      }
      setText(muls, parts.join('  '));
      setText(note, r.note || '');
      const depth = mk.depth != null ? mk.depth : (m.run && m.run.depth) || 0;
      const left = r.ends != null ? r.ends - depth : null;
      setText(ends, left == null ? '' : (r.next ? 'then ' + r.next + ' in ' : 'ends in ') + plural(left, 'depth'));

      const epoch = U.opt.epoch || 6;
      const pips = [];
      if (left != null && epoch > 0) {
        const at = epoch - left;
        for (let i = 0; i < epoch; i++) pips.push({ i, state: i < at ? 'done' : i === at ? 'now' : '' });
      }
      keyed(clock, pips, (p) => p.i, () => h('i', 'pip'), (n, p) => { n.className = 'pip ' + p.state; });
    },
  };
}


// ===========================================================================
// NOTICES, THE TURN DIGEST, AND THE WATCH LIST
//
// Three transient surfaces, all of them lines of text rather than dialogs.
// Nothing here ever blocks the game or asks to be dismissed before play can
// continue, because arriving and continuing should both feel like nothing.
// ===========================================================================

function makeNotices(U) {
  const el = h('div', 'sb-notes');
  const items = [];

  function paint() {
    keyed(el, items, (n) => n.key, (n) => {
      const box = h('div', 'sb-note');
      box.appendChild(h('span', 'k'));
      const b = h('div', 'b');
      b.appendChild(h('span', 'ttl'));
      b.appendChild(h('em', ''));
      box.appendChild(b);
      const x = h('button', 'btn ghost', 'x');
      x.type = 'button';
      x.setAttribute('aria-label', 'dismiss');
      on(x, 'click', () => { const i = items.findIndex(v => v.key === box.__key); if (i >= 0) { items.splice(i, 1); paint(); } });
      box.appendChild(x);
      return box;
    }, (box, n) => {
      box.__key = n.key;
      box.className = 'sb-note ' + (n.tone || '');
      setText(box.firstChild, n.kind || 'unlocked');
      setText(box.childNodes[1].firstChild, n.title || '');
      setText(box.childNodes[1].lastChild, n.body || '');
    });
    show(el, items.length > 0);
  }

  return {
    el,
    add(n) {
      const key = n.key || (n.title || '') + ':' + items.length + ':' + Date.now();
      if (items.some(v => v.key === key)) return;
      items.push({ ...n, key });
      while (items.length > 3) items.shift();
      paint();
      if (n.ttl) setTimeout(() => {
        const i = items.findIndex(v => v.key === key);
        if (i >= 0) { items.splice(i, 1); paint(); }
      }, n.ttl);
    },
    clear() { items.length = 0; paint(); },
    paint() { show(el, items.length > 0); },
  };
}

function makeDigest(U) {
  const el = h('div', 'sb-dig');
  show(el, false);
  return {
    el,
    set(entry) {
      if (!entry) { show(el, false); clear(el); return; }
      const items = [];
      const push = (k, v, klass) => { if (v != null && v !== '') items.push({ k, v: String(v), klass }); };
      if (entry.depth != null) push('turn', entry.depth);
      if (entry.blocks != null) push('broken', entry.blocks);
      if (entry.damage != null || entry.damageText != null) push('damage', entry.damageText != null ? entry.damageText : U.fmt(entry.damage));
      if (entry.essence != null || entry.essenceText != null) push('cash', '+' + (entry.essenceText != null ? entry.essenceText : U.fmt(entry.essence)), 'gold');
      if (entry.swarm != null || entry.swarmText != null) push('swarm', entry.swarmText != null ? entry.swarmText : U.fmt(entry.swarm), 'cy');
      if (entry.materials) for (const mm of entry.materials) {
        push(mm.id, '+' + (mm.text != null ? mm.text : U.fmt(mm.qty)));
      }
      if (entry.items) for (const it of entry.items) push(it.k, it.v, it.klass);
      keyed(el, items, (it) => it.k, () => {
        const n = h('div', 'it');
        n.appendChild(h('span', ''));
        n.appendChild(document.createTextNode(' '));
        n.appendChild(h('b', ''));
        return n;
      }, (n, it) => {
        setText(n.firstChild, it.k);
        setText(n.lastChild, it.v);
        n.lastChild.className = it.klass || '';
      });
      show(el, items.length > 0);
    },
  };
}

function makeWatch(U) {
  const el = h('div', 'sb-watch');
  show(el, false);
  const GLYPH = { bad: '!', warn: '!', good: '+', info: 'i' };
  return {
    el,
    paint(list) {
      keyed(el, list, (a) => a.id, (a) => {
        const n = h('div', 'w');
        n.appendChild(h('span', 'g'));
        n.appendChild(h('span', 'ell'));
        const b = h('button', 'btn mini x');
        b.type = 'button';
        show(b, false);
        n.appendChild(b);
        on(b, 'click', () => { if (n.__act) n.__act(); });
        return n;
      }, (n, a) => {
        n.className = 'w ' + (a.tone || 'info');
        setText(n.firstChild, GLYPH[a.tone] || 'i');
        setText(n.childNodes[1], a.text);
        const btn = n.lastChild;
        show(btn, !!a.action);
        if (a.action) { setText(btn, a.action.label); n.__act = a.action.run; }
      });
      show(el, list.length > 0);
    },
  };
}

/**
 * Watch items read straight off the model. Nothing here decides anything - it
 * surfaces facts already present in the data that are easy to miss while
 * looking somewhere else, which is exactly what a watch list is for.
 */
function deriveWatch(U, m) {
  const out = [];
  if (U.opt.watch === false) return out;
  const mk = m.market || {};
  const depth = mk.depth != null ? mk.depth : (m.run && m.run.depth) || 0;

  for (const f of mk.forwards || []) {
    if (f.covered) continue;
    if (f.away > 2) continue;
    const when = f.away <= 0 ? 'settles now' : f.away === 1 ? 'settles next turn' : 'settles in ' + f.away;
    out.push({
      id: 'fwd:' + f.key,
      tone: f.away <= 1 ? 'bad' : 'warn',
      text: f.id + ' consignment short ' + (f.shortText != null ? f.shortText : U.fmt(f.short)) + ', ' + when
        + ' (penalty ' + U.fmt(f.penalty) + ')',
      action: U.can('buy') && U.has(m, 'bids') ? { label: 'cover', run: () => U.emit('buy', { id: f.id, qty: f.short }) } : null,
    });
  }

  const r = mk.regime;
  if (r && r.ends != null && r.ends - depth <= 1) {
    out.push({ id: 'regime', tone: 'warn', text: 'the ' + (r.name || r.id) + ' regime ends after this depth' });
  }

  if (mk.boost && mk.boost.turns === 1) {
    out.push({ id: 'boost', tone: 'warn', text: 'yield boost x' + mk.boost.mult + ' expires after this turn' });
  }

  for (const a of m.alerts || []) out.push(a);
  return out;
}


// ===========================================================================
// THE NEXT LINE
//
// One dim line at the bottom of the deck naming the next instrument and the
// depth it arrives at. A first run has almost nothing in it on purpose; this is
// the one place that says so, without showing any of it.
// ===========================================================================

function makeNext(U) {
  const el = h('div', 'sb-next');
  const k = h('span', 'lab', 'next');
  const v = h('span', '');
  const away = h('b', '');
  el.appendChild(k); el.appendChild(v); el.appendChild(away);
  show(el, false);
  return {
    el,
    paint(m) {
      const rv = (m.market || {}).reveal;
      const n = rv && rv.next;
      if (!n) { show(el, false); return; }
      show(el, true);
      setText(v, n.title + ' - ' + (n.blurb || ''));
      setText(away, 'depth ' + n.depth);
    },
  };
}


// ===========================================================================
// THE MARKET
//
// One table, from the first frame to the last. On a first run it holds a single
// row and three columns - good, price, hold - and one button. Every instrument
// the run earns arrives as another COLUMN in that same table, which is a far
// smaller thing to absorb than a new panel, and it is the reason a deep run
// still reads as the screen the player learned on turn one.
//
// Columns, in the order they arrive:
//   good / price / hold      always
//   index + chart            once history is being kept
//   book depth               once the book is visible
//   cycle                    once periods are named
//   peaks                    once the almanac is running
//
// On a narrow screen the instrument columns fold onto a second line under each
// row rather than scrolling sideways, so nothing is ever hidden off the edge.
// ===========================================================================

const INST_COLS = [
  { key: 'ix', gate: 'ledger', label: 'index' },
  { key: 'sp', gate: 'ledger', label: 'history' },
  { key: 'bk', gate: 'book', label: 'book' },
  { key: 'cy', gate: 'cycles', label: 'cycle' },
  { key: 'al', gate: 'almanac', label: 'peaks' },
];

function makeMarket(U) {
  const el = h('div', 'sb-mk');

  // column header, built with the same three-part row structure as the data
  // rows so labels sit over their values at every width
  const head = h('div', 'sb-row sb-mkh');
  const hMain = h('div', 'main');
  hMain.appendChild(h('span', 'lab', 'good'));
  hMain.appendChild(h('span', 'lab', 'price'));
  hMain.appendChild(h('span', 'lab', 'hold'));
  const hInst = h('div', 'inst');
  const hLabels = {};
  for (const c of INST_COLS) {
    const n = h('span', 'lab chip ' + c.key, c.label);
    hLabels[c.key] = n;
    hInst.appendChild(n);
  }
  const hAct = h('div', 'act');
  head.appendChild(hMain); head.appendChild(hInst); head.appendChild(hAct);
  el.appendChild(head);

  const rows = h('div', 'rows');
  el.appendChild(rows);

  const fills = h('div', 'fills');
  const fillsCap = h('div', 'lab');
  setText(fillsCap, 'recent fills');
  const fillsList = h('div', 'sb-tab');
  fills.appendChild(fillsCap); fills.appendChild(fillsList);
  fills.style.paddingTop = '10px';
  show(fills, false);
  el.appendChild(fills);

  function buildRow(id) {
    const wrap = h('div', 'sb-mkrow');
    const row = h('div', 'sb-row');
    const main = h('div', 'main');
    const nmBtn = h('button', 'nm ell');
    nmBtn.type = 'button';
    const price = h('span', 'num');
    const hold = h('span', 'num dim');
    main.appendChild(nmBtn); main.appendChild(price); main.appendChild(hold);

    const inst = h('div', 'inst');
    const ixWrap = h('span', 'chip ix');
    const ixVal = h('span', 'num');
    const ixMark = h('span', 'mark');
    ixWrap.appendChild(ixVal); ixWrap.appendChild(ixMark);
    const spWrap = h('span', 'chip sp');
    const spark = makeSpark(74, 16);
    spWrap.appendChild(spark.el);
    const bkWrap = h('span', 'chip bk');
    const meter = makeMeter(44, 9, 0.02, 25, 1);
    const bkVal = h('span', 'num dim');
    bkWrap.appendChild(meter.el); bkWrap.appendChild(bkVal);
    const cyWrap = h('span', 'chip cy');
    const dial = makeDial(22, 12);
    const cyVal = h('span', 'num dim');
    cyWrap.appendChild(dial.el); cyWrap.appendChild(cyVal);
    const alWrap = h('span', 'chip al num dim');
    inst.appendChild(ixWrap); inst.appendChild(spWrap); inst.appendChild(bkWrap);
    inst.appendChild(cyWrap); inst.appendChild(alWrap);

    const act = h('div', 'act');
    const sellBtn = h('button', 'btn go');
    sellBtn.type = 'button';
    const buyBtn = h('button', 'btn', 'buy');
    buyBtn.type = 'button';
    // Dumping. Only appears for a player who bought the way to do it, because
    // without that there is nothing to dump material for.
    const meltBtn = h('button', 'btn', 'dump');
    meltBtn.type = 'button';
    show(meltBtn, false);
    act.appendChild(sellBtn); act.appendChild(buyBtn); act.appendChild(meltBtn);

    row.appendChild(main); row.appendChild(inst); row.appendChild(act);
    wrap.appendChild(row);

    on(nmBtn, 'click', () => U.selectGood(id));
    on(sellBtn, 'click', () => U.emit('sell', { id, qty: wrap.__qty }));
    on(meltBtn, 'click', () => U.emit('melt', { id, qty: wrap.__qty }));
    on(buyBtn, 'click', () => { U.orderState(id).mode = 'buy'; U.selectGood(id, true); });

    wrap.n = {
      row, nmBtn, price, hold, ixWrap, ixVal, ixMark, spWrap, spark,
      bkWrap, meter, bkVal, cyWrap, dial, cyVal, alWrap, act, sellBtn, buyBtn, meltBtn,
      order: null,
    };
    return wrap;
  }

  function paintRow(wrap, d, m, cols) {
    const n = wrap.n;
    const accent = U.tintOf(d.id);
    const sel = U.state.sel === d.id;
    cls(wrap, 'sel', sel);

    const expandable = cols.ix || U.has(m, 'bids');
    setText(n.nmBtn, d.name + (expandable ? (sel ? ' ▾' : ' ▸') : ''));
    n.nmBtn.disabled = !expandable;
    n.nmBtn.setAttribute('aria-expanded', sel ? 'true' : 'false');
    tint(n.nmBtn, sel ? '' : accent);

    setNum(n.price, d.midText != null ? d.midText : U.fmt(d.mid), mlog(d.mid));
    setText(n.hold, d.heldText != null ? d.heldText : U.fmt(d.held));

    show(n.ixWrap, cols.ix);
    if (cols.ix) {
      setText(n.ixVal, ix(d.index));
      const t = trendWord(d.trend != null ? d.trend : (d.index != null ? d.index - 1 : null), 0.01);
      setText(n.ixMark, t.g);
      tint(n.ixMark, t.d > 0 ? 'var(--sb-good)' : t.d < 0 ? 'var(--sb-hot)' : 'var(--sb-dim)');
      n.ixWrap.title = 'index ' + ix(d.index) + ', ' + t.w + ' against its own average';
    }

    show(n.spWrap, cols.sp);
    if (cols.sp) {
      const hist = U.history(d.id, 24);
      const sig = d.id + ':' + hist.length + ':' + (hist.length ? hist[hist.length - 1].depth : 0);
      if (n.spWrap.__sig !== sig) {
        n.spWrap.__sig = sig;
        n.spark.draw(hist.map(p => p.index), 1, accent);
      }
    }

    show(n.bkWrap, cols.bk);
    if (cols.bk) {
      const b = d.book;
      n.meter.draw(b, b == null ? null : (b < 1 ? 'var(--sb-gold)' : 'var(--sb-dim)'));
      setText(n.bkVal, bookText(b));
      n.bkWrap.title = b == null ? '' : b < 1
        ? 'book is short of normal, so the price is bid up'
        : 'book is above normal, so the price is marked down';
    }

    show(n.cyWrap, cols.cy);
    if (cols.cy) {
      n.dial.draw(d.phase, accent);
      setText(n.cyVal, 'p' + (d.period != null ? d.period : '-'));
      n.cyWrap.title = 'demand cycle of ' + d.period + ' depths, now at ' + ix(d.demand);
    }

    show(n.alWrap, cols.al);
    if (cols.al) {
      setText(n.alWrap, (d.nextPeak != null ? '^' + d.nextPeak : '') + (d.nextTrough != null ? ' v' + d.nextTrough : ''));
      n.alWrap.title = 'next peak at depth ' + d.nextPeak + ', next trough at depth ' + d.nextTrough;
    }

    // the one button. its label always carries the size it will move, so
    // "sell" never means an amount the player did not choose.
    const qty = U.orderQty(m, d.id, 'sell');
    wrap.__qty = qty;
    const hasStock = cmpMag(d.held, 0) > 0;
    setText(n.sellBtn, hasStock ? 'sell ' + U.fmt(qty) : 'sell');
    n.sellBtn.disabled = U.busy || !hasStock || !U.can('sell');
    show(n.buyBtn, U.has(m, 'bids') && U.can('buy'));
    n.buyBtn.disabled = U.busy;
    const canMelt = !!(m.powers && m.powers.melt) && U.can('melt');
    show(n.meltBtn, canMelt);
    if (canMelt) {
      setText(n.meltBtn, hasStock ? 'dump ' + U.fmt(qty) : 'dump');
      n.meltBtn.disabled = U.busy || !hasStock;
      n.meltBtn.title = 'a flat price with no book and no timing, worse than selling it well';
    }

    // the order panel is built the first time it is needed and never rebuilt
    if (sel && expandable) {
      if (!n.order) { n.order = makeOrder(U, d.id); wrap.appendChild(n.order.el); }
      show(n.order.el, true);
      n.order.paint(m, d);
    } else if (n.order) show(n.order.el, false);
  }

  return {
    el,
    paint(m, sec) {
      const mk = m.market || {};
      const list = mergeGoods(U, mk);

      const cols = {};
      for (const c of INST_COLS) cols[c.key] = U.has(m, c.gate);
      for (const c of INST_COLS) show(hLabels[c.key], cols[c.key]);
      show(hInst, INST_COLS.some(c => cols[c.key]));

      keyed(rows, list, (d) => d.id, (d) => buildRow(d.id), (wrap, d) => paintRow(wrap, d, m, cols));

      // recent fills: the player's own trade history, which is the other half
      // of reading a market well
      const trades = U.has(m, 'ledger') ? (mk.trades || []) : [];
      show(fills, trades.length > 0);
      keyed(fillsList, trades, (t, i) => t.d + ':' + t.kind + ':' + t.id + ':' + i, () => {
        const n = h('div', 'r tiny');
        n.appendChild(h('span', 'dim'));
        n.appendChild(h('span', ''));
        n.appendChild(h('span', 'grow dim'));
        n.appendChild(h('span', 'rt num'));
        return n;
      }, (n, t) => {
        setText(n.childNodes[0], 'd' + t.d);
        setText(n.childNodes[1], t.kind);
        tint(n.childNodes[1], t.kind === 'sell' ? 'var(--sb-good)' : t.kind === 'buy' ? 'var(--sb-hot)' : 'var(--sb-dim)');
        setText(n.childNodes[2], U.fmt(t.qty) + ' ' + t.id + (t.index != null ? '  at ' + ix(t.index) : ''));
        setText(n.childNodes[3], (t.kind === 'sell' ? '+' : '-') + U.fmt(t.value));
        tint(n.childNodes[3], t.kind === 'sell' ? 'var(--sb-good)' : 'var(--sb-dim)');
      });

      // the collapsed summary: every price, in order, on one line
      if (sec) {
        const bits = list.slice(0, 4).map(d => d.name + ' ' + (d.midText != null ? d.midText : U.fmt(d.mid)));
        if (list.length > 4) bits.push('+' + (list.length - 4));
        sec.summary(bits.join('  '));
      }
    },
  };
}

/**
 * Prices and indicators are two views of the same good and the table wants one.
 *
 * The price feed carries every dial whether or not the run has earned the
 * instrument that reads it, so those raw fields are dropped here and only the
 * indicator view - which respects the schedule - is allowed to put them back.
 * Without that, a chart or a cycle readout would leak in ahead of its depth.
 */
const RAW_DIALS = ['index', 'book', 'pressure', 'demand', 'regime'];

function mergeGoods(U, mk) {
  const byId = {};
  for (const p of mk.prices || []) {
    const g = { ...p };
    for (const k of RAW_DIALS) delete g[k];
    if (p.indexShown != null) g.index = p.indexShown;
    if (p.bookShown != null) g.book = p.bookShown;
    byId[p.id] = g;
  }
  for (const i of mk.indicators || []) byId[i.id] = { ...(byId[i.id] || {}), ...i };
  const order = (mk.prices || []).map(p => p.id);
  for (const id in byId) if (order.indexOf(id) < 0) order.push(id);
  return order.map(id => byId[id]).filter(Boolean);
}


// ===========================================================================
// THE ORDER PANEL
//
// Appears the turn a second action exists and grows from there. It answers one
// question the posted price cannot: what does THIS size actually fetch, and
// where does it leave the price afterwards. The fill curve makes the cost of
// going one size bigger a shape rather than a paragraph, and the before/after
// index is the market's own damage report on the order about to be sent.
// ===========================================================================

function makeOrder(U, id) {
  const el = h('div', 'sb-ord');

  const tabs = h('div', 'tabs');
  const tSell = h('button', 'btn mini on', 'sell');
  const tBuy = h('button', 'btn mini', 'buy');
  tSell.type = 'button'; tBuy.type = 'button';
  const closeBtn = h('button', 'btn ghost sp', 'close');
  closeBtn.type = 'button';
  tabs.appendChild(tSell); tabs.appendChild(tBuy); tabs.appendChild(closeBtn);
  el.appendChild(tabs);

  const sizer = h('div', 'sizer');
  const fracBtns = [];
  for (const f of [0.125, 0.25, 0.5, 1]) {
    const b = h('button', 'btn mini', f === 1 ? 'all' : (f === 0.125 ? '1/8' : f === 0.25 ? '1/4' : '1/2'));
    b.type = 'button';
    on(b, 'click', () => { const s = U.orderState(id); s.frac = f; s.abs = null; U.repaint(); });
    fracBtns.push({ b, f });
    sizer.appendChild(b);
  }
  const minus = h('button', 'btn mini', '-'); minus.type = 'button';
  const field = document.createElement('input');
  field.type = 'text'; field.inputMode = 'decimal'; field.setAttribute('aria-label', 'order size');
  const plus = h('button', 'btn mini', '+'); plus.type = 'button';
  const ofLine = h('span', 'of');
  sizer.appendChild(minus); sizer.appendChild(field); sizer.appendChild(plus); sizer.appendChild(ofLine);
  el.appendChild(sizer);

  on(minus, 'click', () => { const s = U.orderState(id); s.abs = null; s.frac = clamp(s.frac / 2, 0.001, 1); U.repaint(); });
  on(plus, 'click', () => { const s = U.orderState(id); s.abs = null; s.frac = clamp(s.frac * 2, 0.001, 1); U.repaint(); });
  on(field, 'change', () => {
    const v = parseFloat(field.value.replace(/[, ]/g, ''));
    const s = U.orderState(id);
    if (isFinite(v) && v > 0) s.abs = v; else s.abs = null;
    U.repaint();
  });
  on(field, 'keydown', (e) => { if (e.key === 'Enter') field.blur(); });

  const curveBox = h('div', 'box');
  const curveCap = h('div', 'cap');
  const curveTitle = h('span', 'lab', 'fill curve');
  const curveNote = h('span', 'tiny dim ell');
  curveCap.appendChild(curveTitle); curveCap.appendChild(curveNote);
  const curve = makeCurve(56);
  curveBox.appendChild(curveCap); curveBox.appendChild(curve.el);
  el.appendChild(curveBox);

  const l1 = h('div', 'line');
  const l1a = h('span', 'num'); const l1b = h('span', 'num'); const l1c = h('span', 'num dim');
  l1.appendChild(l1a); l1.appendChild(l1b); l1.appendChild(l1c);
  const l2 = h('div', 'line');
  const l2a = h('span', 'num dim'); const l2b = h('span', 'num dim'); const l2c = h('span', 'num');
  l2.appendChild(l2a); l2.appendChild(l2b); l2.appendChild(l2c);
  el.appendChild(l1); el.appendChild(l2);

  const goBtn = h('button', 'btn go');
  goBtn.type = 'button';
  el.appendChild(goBtn);
  const planBtn = h('button', 'btn mini', 'split this order');
  planBtn.type = 'button';
  planBtn.style.marginTop = '5px';
  el.appendChild(planBtn);

  const ledgerBox = h('div', 'box');
  const ledCap = h('div', 'cap');
  const ledTitle = h('span', 'lab', 'ledger');
  const ledRange = h('div', '');
  ledRange.style.marginLeft = 'auto';
  ledRange.style.display = 'flex';
  ledRange.style.gap = '4px';
  const rangeBtns = [];
  for (const nDepths of [24, 48, 96]) {
    const b = h('button', 'btn ghost', String(nDepths));
    b.type = 'button';
    on(b, 'click', () => { U.state.window = nDepths; U.repaint(); });
    rangeBtns.push({ b, n: nDepths });
    ledRange.appendChild(b);
  }
  ledCap.appendChild(ledTitle); ledCap.appendChild(ledRange);
  const ledger = makeLedger(96, (p, read) => {
    if (!p) { setText(read, U.state.scrubIdle || ''); return; }
    setText(read, 'd' + p.depth + '   index ' + ix(p.value)
      + (p.book != null ? '   book ' + bookText(p.book) : '')
      + (p.priceText ? '   price ' + p.priceText : '')
      + (p.tag ? '   ' + p.tag : ''));
  });
  ledgerBox.appendChild(ledCap); ledgerBox.appendChild(ledger.el);
  el.appendChild(ledgerBox);

  const facts = h('div', 'facts');
  el.appendChild(facts);

  on(tSell, 'click', () => { U.orderState(id).mode = 'sell'; U.repaint(); });
  on(tBuy, 'click', () => { U.orderState(id).mode = 'buy'; U.repaint(); });
  on(closeBtn, 'click', () => U.selectGood(null));
  on(goBtn, 'click', () => {
    const s = U.orderState(id);
    U.emit(s.mode === 'buy' ? 'buy' : 'sell', { id, qty: el.__qty });
  });
  on(planBtn, 'click', () => {
    U.state.exchange = { id, qty: el.__qty };
    U.reveal('exchange');
  });

  return {
    el,
    paint(m, d) {
      const s = U.orderState(id);
      const buying = s.mode === 'buy';
      const twoSided = U.has(m, 'bids');
      show(tBuy, twoSided);
      show(tSell, twoSided);
      cls(tSell, 'on', !buying); cls(tBuy, 'on', buying);
      if (!twoSided && buying) s.mode = 'sell';

      const qty = U.orderQty(m, id, s.mode);
      el.__qty = qty;
      const qn = num(qty);

      for (const fb of fracBtns) cls(fb.b, 'on', s.abs == null && Math.abs(s.frac - fb.f) < 1e-9);
      if (document.activeElement !== field) field.value = U.fmt(qty);
      const basis = buying ? U.buyBasis(m, id) : d.held;
      const share = num(basis) > 0 ? qn / num(basis) : 0;
      setText(ofLine, basis == null ? '' : (share * 100).toFixed(0) + '% of ' + U.fmt(basis)
        + (buying ? ' affordable' : ' held'));

      const pv = U.preview(s.mode, id, qty);
      const spot = buying ? d.ask : d.bid;

      if (pv && pv.ok) {
        const total = buying ? pv.cost : pv.net;
        const unit = pv.unit;
        setText(l1a, U.fmt(qty) + ' ' + d.name + (buying ? ' costs ' : ' pays ') + U.fmt(total));
        setText(l1b, 'unit ' + U.fmt(unit));
        const slip = num(spot) > 0 ? (num(unit) - num(spot)) / num(spot) : null;
        setText(l1c, 'spot ' + U.fmt(spot) + (slip == null ? '' : '  ' + signPct(slip)));
        tint(l1c, slip == null ? '' : (buying ? (slip > 0.001 ? 'var(--sb-hot)' : 'var(--sb-dim)')
          : (slip < -0.001 ? 'var(--sb-hot)' : 'var(--sb-dim)')));
        setText(l2a, pv.startIndex != null ? 'index ' + ix(pv.startIndex) + ' -> ' + ix(pv.endIndex) : '');
        setText(l2b, pv.startBook != null ? 'book ' + bookText(pv.startBook) + ' -> ' + bookText(pv.endBook) : '');
        const warn = buying
          ? (cmpMag(pv.short || 0, 0) > 0 ? 'book can only supply ' + U.fmt(pv.filled) : '')
          : (pv.capped ? U.fmt(pv.cappedQty) + ' fills flat at the floor' : '');
        setText(l2c, warn);
        tint(l2c, warn ? 'var(--sb-hot)' : '');
        show(l1, true); show(l2, true);
      } else {
        setText(l1a, U.fmt(qty) + ' ' + d.name);
        setText(l1b, ''); setText(l1c, '');
        setText(l2a, pv && pv.reason ? pv.reason : ''); setText(l2b, ''); setText(l2c, '');
        show(l2, !!(pv && pv.reason));
      }

      // the fill curve, resampled only when the size or the book moved
      const sig = id + ':' + s.mode + ':' + qn.toExponential(3) + ':' + ix(d.index) + ':' + bookText(d.book);
      if (curveBox.__sig !== sig) {
        curveBox.__sig = sig;
        const samples = U.sampleCurve(s.mode, id, qty, spot);
        show(curveBox, !!samples);
        if (samples) {
          curve.draw(samples.points, samples.at, samples.spot, samples.log ? 'log price' : '');
          setText(curveNote, buying
            ? 'each unit costs more than the one before it'
            : 'each unit sells into the damage the last one did');
        }
      }

      setText(goBtn, (buying ? 'buy ' : 'sell ') + U.fmt(qty) + ' ' + d.name);
      goBtn.disabled = U.busy || !pv || !pv.ok || !U.can(buying ? 'buy' : 'sell');
      goBtn.className = 'btn go' + (buying ? ' warn' : '');

      show(planBtn, U.has(m, 'exchange') && !buying);

      // ledger: history, plus the forward demand curve when the almanac has
      // taught the player what the cycle is
      const showLedger = U.has(m, 'ledger');
      show(ledgerBox, showLedger);
      show(facts, true);
      if (showLedger) {
        const win = U.state.window || 48;
        for (const rb of rangeBtns) cls(rb.b, 'on', rb.n === win);
        const hist = U.history(id, win);
        const ahead = U.curve(id, win);
        const sig2 = id + ':' + win + ':' + hist.length + ':' + (hist.length ? hist[hist.length - 1].depth : 0)
          + ':' + (ahead ? ahead.length : 0) + ':' + Math.round(el.clientWidth);
        if (ledgerBox.__sig !== sig2) {
          ledgerBox.__sig = sig2;
          const series = hist.map(p => ({ depth: p.depth, value: p.index, book: p.book, priceText: p.priceText }));
          const front = ahead ? ahead.map(p => ({ depth: p.depth, value: p.demand, tag: p.regime || '' })) : null;
          const labels = {};
          if (ahead) for (const p of ahead) if (p.regime) labels[p.depth] = p.regime;
          ledger.draw(series, front, 1, U.opt.epoch || 6, labels);
          U.state.scrubIdle = front && front.length
            ? 'solid line is what happened, dashed is the demand cycle ahead'
            : 'drag across the chart to read any depth';
          setText(ledger.readout, U.state.scrubIdle);
        }
      }

      // every dial the run has unlocked, printed rather than hidden in a tooltip
      const f = [];
      if (d.spread != null) f.push(['spread', (d.spread * 100).toFixed(1) + '%']);
      if (d.elasticity != null) f.push(['elasticity', d.elasticity.toFixed(2)]);
      if (d.refill != null) f.push(['refill', (d.refill * 100).toFixed(0) + '%/turn']);
      if (d.period != null) f.push(['period', d.period + ' depths']);
      if (d.demand != null) f.push(['demand', ix(d.demand)]);
      if (d.amp != null) f.push(['swing', '+/-' + (d.amp * 100).toFixed(0) + '%']);
      if (d.ma8 != null) f.push(['avg 8', ix(d.ma8)]);
      if (d.ma24 != null) f.push(['avg 24', ix(d.ma24)]);
      if (d.nextPeak != null) f.push(['peak', 'd' + d.nextPeak + ' at ' + ix(d.peakDemand)]);
      if (d.nextTrough != null) f.push(['trough', 'd' + d.nextTrough + ' at ' + ix(d.troughDemand)]);
      if (d.regime && d.regime.mul != null) f.push(['regime', d.regime.name + ' x' + d.regime.mul.toFixed(2) + ', ends d' + d.regime.ends, true]);
      keyed(facts, f, (x) => x[0], () => {
        const n = h('div', 'f');
        n.appendChild(h('span', 'k'));
        n.appendChild(h('span', 'num'));
        return n;
      }, (n, x) => { setText(n.firstChild, x[0]); setText(n.lastChild, x[1]); cls(n, 'wide', !!x[2]); });
    },
  };
}


// ===========================================================================
// SHARED: a size control
//
// Fractions of what you have, a halve/double stepper, and an exact field for
// the player who has worked out where the optimum actually is. The exact field
// matters: the order maths is closed form, so an exact size is a real answer
// rather than a fiddle.
// ===========================================================================

function makeSizer(U, onChange) {
  const el = h('div', 'sizer');
  const fracs = [];
  for (const f of [0.125, 0.25, 0.5, 1]) {
    const b = h('button', 'btn mini', f === 1 ? 'all' : (f === 0.125 ? '1/8' : f === 0.25 ? '1/4' : '1/2'));
    b.type = 'button';
    on(b, 'click', () => { const s = el.__s; if (!s) return; s.frac = f; s.abs = null; onChange(); });
    fracs.push({ b, f });
    el.appendChild(b);
  }
  const minus = h('button', 'btn mini', '-'); minus.type = 'button';
  const field = document.createElement('input');
  field.type = 'text'; field.inputMode = 'decimal'; field.setAttribute('aria-label', 'size');
  const plus = h('button', 'btn mini', '+'); plus.type = 'button';
  const note = h('span', 'of');
  el.appendChild(minus); el.appendChild(field); el.appendChild(plus); el.appendChild(note);
  on(minus, 'click', () => { const s = el.__s; if (!s) return; s.abs = null; s.frac = clamp((s.frac || 1) / 2, 0.001, 1); onChange(); });
  on(plus, 'click', () => { const s = el.__s; if (!s) return; s.abs = null; s.frac = clamp((s.frac || 1) * 2, 0.001, 1); onChange(); });
  on(field, 'change', () => {
    const s = el.__s; if (!s) return;
    const v = parseFloat(field.value.replace(/[, ]/g, ''));
    s.abs = isFinite(v) && v > 0 ? v : null;
    onChange();
  });
  on(field, 'keydown', (e) => { if (e.key === 'Enter') field.blur(); });

  return {
    el,
    paint(state, basis, qty, suffix) {
      el.__s = state;
      for (const fb of fracs) cls(fb.b, 'on', state.abs == null && Math.abs((state.frac || 1) - fb.f) < 1e-9);
      if (document.activeElement !== field) field.value = U.fmt(qty);
      const share = num(basis) > 0 ? num(qty) / num(basis) : 0;
      setText(note, basis == null ? '' : (share * 100).toFixed(0) + '% of ' + U.fmt(basis) + (suffix ? ' ' + suffix : ''));
    },
  };
}


// ===========================================================================
// THE REFINERY
//
// Recipes arrive long before the margin readout does, so for a stretch of the
// run this panel shows what a recipe consumes and how many runs the inventory
// supports and nothing else. That gap is deliberate: the player works the
// margin out by hand first, and the readout arrives to confirm a model already
// built rather than to replace the building of it.
// ===========================================================================

function makeRefinery(U) {
  const el = h('div', 'sb-tab');
  return {
    el,
    paint(m, sec) {
      const mk = m.market || {};
      const recs = mk.recipes || [];
      const mg = {};
      for (const g of mk.margins || []) mg[g.id] = g;

      keyed(el, recs, (r) => r.id, (r) => {
        const n = h('div', 'r');
        n.style.flexDirection = 'column';
        n.style.alignItems = 'stretch';
        const top = h('div', 'r');
        top.style.borderBottom = '0';
        top.style.padding = '0';
        const nm = h('span', '');
        nm.style.width = '7ch';
        nm.style.flex = '0 0 auto';
        const recipe = h('span', 'grow dim tiny');
        const runs = h('span', 'num dim');
        const pct = h('span', 'num');
        const b1 = h('button', 'btn mini', 'craft'); b1.type = 'button';
        const bAll = h('button', 'btn mini'); bAll.type = 'button';
        top.appendChild(nm); top.appendChild(recipe); top.appendChild(runs);
        top.appendChild(pct); top.appendChild(b1); top.appendChild(bAll);
        const detail = h('div', 'tiny dim');
        n.appendChild(top); n.appendChild(detail);
        on(b1, 'click', () => U.emit('craft', { id: n.__id, times: 1 }));
        on(bAll, 'click', () => U.emit('craft', { id: n.__id, times: n.__runs }));
        n.__nodes = { nm, recipe, runs, pct, b1, bAll, detail };
        return n;
      }, (n, r) => {
        n.__id = r.id;
        const q = n.__nodes;
        const runs = Math.floor(num(r.runs));
        n.__runs = runs;
        setText(q.nm, r.out);
        tint(q.nm, U.tintOf(r.out));
        const ins = Object.entries(r.inputs).map(([id, k]) => k + ' ' + id).join(' + ');
        setText(q.recipe, ins + ' -> ' + r.qty + ' ' + r.out);
        setText(q.runs, runs > 0 ? runs + ' run' + (runs === 1 ? '' : 's') : 'no inputs');

        const g = mg[r.id];
        if (g) {
          setText(q.pct, g.pctText);
          tint(q.pct, g.positive ? 'var(--sb-good)' : 'var(--sb-hot)');
          setText(q.detail, 'bid ' + U.fmt(g.revenue) + ' - inputs ' + U.fmt(g.cost)
            + ' - fee ' + U.fmt(g.fee) + ' = ' + (g.positive ? '+' : '') + U.fmt(g.margin) + ' per run');
          show(q.detail, true);
        } else {
          setText(q.pct, '');
          show(q.detail, false);
        }

        setText(q.bAll, 'x' + runs);
        show(q.bAll, runs > 1);
        q.b1.disabled = U.busy || runs < 1 || !U.can('craft');
        q.bAll.disabled = q.b1.disabled;
      });

      if (sec) {
        const withMargin = mk.margins || [];
        sec.summary(withMargin.length
          ? withMargin.map(g => g.out + ' ' + g.pctText).join('  ')
          : recs.map(r => r.out + ' ' + Math.floor(num(r.runs))).join('  '));
      }
    },
  };
}


// ===========================================================================
// CONSIGNMENTS
//
// Material sold before it is mined, paid now. Fair value at the delivery depth
// carries the demand cycle but not the book, so the row of terms IS the demand
// cycle drawn out in front of the player. Drawn as bars, picking a term stops
// being arithmetic and becomes pointing at the tall one - and the run that has
// not yet learned the periods still has to guess which bar it will be.
// ===========================================================================

function makeForwards(U) {
  const el = h('div', '');

  const top = h('div', 'sb-ord');
  top.style.borderTop = '0';
  top.style.paddingTop = '0';
  const standing = h('div', 'line');
  const stV = h('span', 'num');
  const stNote = h('span', 'dim tiny');
  standing.appendChild(stV); standing.appendChild(stNote);
  top.appendChild(standing);
  el.appendChild(top);

  const openCap = h('div', 'lab', 'open');
  const openList = h('div', 'sb-tab');
  el.appendChild(openCap); el.appendChild(openList);

  const build = h('div', 'sb-ord');
  const buildCap = h('div', 'lab', 'sell forward');
  const chips = h('div', 'sizer');
  const sizer = makeSizer(U, () => U.repaint());
  const barsBox = h('div', 'box');
  const barsCap = h('div', 'cap');
  const barsTitle = h('span', 'lab', 'terms');
  const barsNote = h('span', 'tiny dim ell');
  barsCap.appendChild(barsTitle); barsCap.appendChild(barsNote);
  const bars = makeBars(60, (k) => { U.state.fwd.term = Number(k); U.repaint(); });
  barsBox.appendChild(barsCap); barsBox.appendChild(bars.el);
  const line = h('div', 'line');
  const lnA = h('span', 'num'); const lnB = h('span', 'num'); const lnC = h('span', 'num dim');
  line.appendChild(lnA); line.appendChild(lnB); line.appendChild(lnC);
  const goBtn = h('button', 'btn go'); goBtn.type = 'button';
  goBtn.style.width = '100%';
  build.appendChild(buildCap); build.appendChild(chips); build.appendChild(sizer.el);
  build.appendChild(barsBox); build.appendChild(line); build.appendChild(goBtn);
  el.appendChild(build);

  on(goBtn, 'click', () => {
    const s = U.state.fwd;
    U.emit('consign', { id: s.id, qty: build.__qty, term: s.term });
  });

  return {
    el,
    paint(m, sec) {
      const mk = m.market || {};
      const list = mk.forwards || [];
      const goods = mergeGoods(U, mk);
      const s = U.state.fwd;
      if (!s.id || !goods.some(g => g.id === s.id)) s.id = goods.length ? goods[0].id : null;

      setText(stV, 'standing ' + (mk.standing == null ? '-' : mk.standing) + '/100');
      setText(stNote, 'clean delivery pays 5, a default costs 30 and twice the shortfall');

      show(openCap, list.length > 0);
      keyed(openList, list, (f) => f.key, () => {
        const n = h('div', 'r');
        n.appendChild(h('span', ''));           // good
        n.appendChild(h('span', 'num'));         // qty
        n.appendChild(h('span', 'num dim'));     // due
        n.appendChild(h('span', 'grow num'));    // status
        const b = h('button', 'btn mini', 'cover'); b.type = 'button';
        n.appendChild(b);
        on(b, 'click', () => U.emit('buy', { id: n.__id, qty: n.__short }));
        return n;
      }, (n, f) => {
        n.__id = f.id; n.__short = f.short;
        setText(n.childNodes[0], f.id);
        tint(n.childNodes[0], U.tintOf(f.id));
        setText(n.childNodes[1], f.qtyText != null ? f.qtyText : U.fmt(f.qty));
        setText(n.childNodes[2], 'due d' + f.due + (f.away > 0 ? ' (' + f.away + ')' : ' now'));
        if (f.covered) {
          setText(n.childNodes[3], 'covered');
          tint(n.childNodes[3], 'var(--sb-good)');
        } else {
          setText(n.childNodes[3], 'short ' + (f.shortText != null ? f.shortText : U.fmt(f.short))
            + ', penalty ' + U.fmt(f.penalty));
          tint(n.childNodes[3], 'var(--sb-hot)');
        }
        const b = n.lastChild;
        show(b, !f.covered && U.has(m, 'bids') && U.can('buy'));
        b.disabled = U.busy;
      });

      // the builder
      keyed(chips, goods, (g) => g.id, (g) => {
        const b = h('button', 'btn mini');
        b.type = 'button';
        on(b, 'click', () => { U.state.fwd.id = b.__id; U.repaint(); });
        return b;
      }, (b, g) => {
        b.__id = g.id;
        setText(b, g.name);
        cls(b, 'on', g.id === s.id);
        tint(b, g.id === s.id ? '' : U.tintOf(g.id));
      });

      const g = goods.find(x => x.id === s.id);
      if (!g) { show(build, false); return; }
      show(build, true);

      const free = U.forwardFree(s.id);
      const basis = free != null ? free : g.held;
      const qty = s.abs != null ? s.abs : scaleBy(basis, s.frac == null ? 0.5 : s.frac);
      build.__qty = qty;
      sizer.paint(s, basis, qty, free != null ? 'the desk will take' : 'held');

      const rows = [];
      let picked = null;
      for (let t = U.opt.termMin || 3; t <= (U.opt.termMax || 12); t++) {
        const pv = U.consignPreview(s.id, qty, t);
        if (!pv || !pv.ok) continue;
        const b = {
          key: String(t), label: 't' + t, value: pv.edge != null ? pv.edge : 0,
          sub: pv.edge != null ? signPct(pv.edge, 0) : '',
          tone: (pv.edge || 0) >= 0 ? 'var(--sb-good)' : 'var(--sb-hot)',
          picked: t === s.term, pv,
        };
        rows.push(b);
        if (t === s.term) picked = b;
      }
      if (!picked && rows.length) { s.term = Number(rows[0].key); picked = rows[0]; picked.picked = true; }
      bars.draw(rows, 0);
      setText(barsNote, 'payout against the spot bid, by delivery term');

      if (picked) {
        const pv = picked.pv;
        setText(lnA, 'term ' + pv.term + ', due d' + pv.due);
        setText(lnB, 'unit ' + (pv.unitText != null ? pv.unitText : U.fmt(pv.unit))
          + '  ' + signPct(pv.edge) + ' vs spot');
        tint(lnB, (pv.edge || 0) >= 0 ? 'var(--sb-good)' : 'var(--sb-hot)');
        setText(lnC, 'pays ' + (pv.payoutText != null ? pv.payoutText : U.fmt(pv.payout))
          + (pv.regimeAtDue ? '  into ' + pv.regimeAtDue : ''));
        setText(goBtn, 'consign ' + U.fmt(qty) + ' ' + g.name + ' for d' + pv.due);
        goBtn.disabled = U.busy || !U.can('consign');
      } else {
        setText(lnA, 'nothing can be committed at this size');
        setText(lnB, ''); setText(lnC, '');
        setText(goBtn, 'consign');
        goBtn.disabled = true;
      }

      if (sec) {
        const shortN = list.filter(f => !f.covered).length;
        sec.summary(list.length
          ? list.length + ' open' + (shortN ? ', ' + shortN + ' short' : ', all covered')
            + '  standing ' + mk.standing
          : 'nothing committed  standing ' + mk.standing);
      }
    },
  };
}


// ===========================================================================
// ASSAY
//
// The veins slide one column per depth and the field is deterministic, so the
// composition of rows that have not arrived yet is knowable. Before this
// exists, a forward sale is a judgement about your own production; after it,
// production is arithmetic. It is drawn as the board itself rather than a
// table, because that is the object the player is already reading.
// ===========================================================================

function makeAssay(U) {
  const el = h('div', 'sb-assay');
  const grid = h('div', '');
  grid.style.display = 'flex';
  grid.style.flexDirection = 'column';
  grid.style.gap = '2px';
  const head = h('div', 'r');
  const headD = h('span', 'd lab', 'depth');
  const headC = h('span', 'cells');
  for (let c = 0; c < 8; c++) headC.appendChild(h('span', 'lab', String(c)));
  head.appendChild(headD); head.appendChild(headC);
  const totals = h('div', 'tot');
  el.appendChild(head); el.appendChild(grid); el.appendChild(totals);

  return {
    el,
    paint(m, sec) {
      const f = U.forecast(U.opt.assayRows || 6);
      if (!f || !f.ok) { show(el, false); if (sec) sec.summary('locked'); return; }
      show(el, true);

      keyed(grid, f.rows, (r) => r.depth, () => {
        const n = h('div', 'r');
        n.appendChild(h('span', 'd num'));
        const cells = h('span', 'cells');
        for (let c = 0; c < 8; c++) cells.appendChild(h('span', 'c off'));
        n.appendChild(cells);
        n.appendChild(h('span', 'dim tiny'));
        return n;
      }, (n, r) => {
        setText(n.firstChild, 'd' + r.depth);
        const cells = n.childNodes[1];
        const by = {};
        for (const c of r.cells) by[c.col] = c;
        for (let c = 0; c < 8; c++) {
          const cell = cells.childNodes[c];
          const data = by[c];
          cls(cell, 'off', !data);
          setText(cell, data ? data.id.charAt(0).toUpperCase() : '.');
          if (data) {
            tint(cell, U.tintOf(data.id));
            cell.style.borderColor = U.tintOf(data.id) + '55';
            cell.title = data.id + ' ' + U.fmt(data.qty);
          } else {
            cell.style.borderColor = '';
            cell.title = '';
          }
        }
        setText(n.lastChild, r.regime || '');
      });

      const tot = Object.entries(f.totals || {})
        .map(([id, q]) => ({ id, q, text: (f.totalsText && f.totalsText[id]) || U.fmt(q) }))
        .filter(t => num(t.q) > 0);
      keyed(totals, tot, (t) => t.id, () => {
        const n = h('span', '');
        n.appendChild(h('b', ''));
        n.appendChild(document.createTextNode(' '));
        n.appendChild(h('span', ''));
        return n;
      }, (n, t) => {
        setText(n.firstChild, t.text);
        setText(n.lastChild, t.id);
        tint(n.lastChild, U.tintOf(t.id));
      });

      if (sec) sec.summary(tot.map(t => t.text + ' ' + t.id).join('  ') || 'nothing due');
    },
  };
}


// ===========================================================================
// THE EXCHANGE
//
// Order splitting. Selling everything the turn it lands is one of five shapes
// and usually the worst of them; this prices all five against each other and
// shows the schedule of the winner. It computes what the player could compute
// by hand and stops there - nothing here recommends anything.
// ===========================================================================

function makeExchange(U) {
  const el = h('div', 'sb-ord');
  el.style.borderTop = '0';
  el.style.paddingTop = '0';

  const chips = h('div', 'sizer');
  const sizer = makeSizer(U, () => U.repaint());
  const turns = h('div', 'sizer');
  const tLab = h('span', 'lab', 'over');
  const tMinus = h('button', 'btn mini', '-'); tMinus.type = 'button';
  const tVal = h('span', 'num'); tVal.style.minWidth = '6ch'; tVal.style.textAlign = 'center';
  const tPlus = h('button', 'btn mini', '+'); tPlus.type = 'button';
  turns.appendChild(tLab); turns.appendChild(tMinus); turns.appendChild(tVal); turns.appendChild(tPlus);
  on(tMinus, 'click', () => { U.state.ex.turns = clamp((U.state.ex.turns || 4) - 1, 1, 24); U.repaint(); });
  on(tPlus, 'click', () => { U.state.ex.turns = clamp((U.state.ex.turns || 4) + 1, 1, 24); U.repaint(); });

  const plansBox = h('div', 'box');
  const plansCap = h('div', 'cap');
  plansCap.appendChild(h('span', 'lab', 'shapes'));
  const plansNote = h('span', 'tiny dim ell');
  plansCap.appendChild(plansNote);
  const planBars = makeBars(62, null);
  plansBox.appendChild(plansCap); plansBox.appendChild(planBars.el);

  const stepsBox = h('div', 'box');
  const stepsCap = h('div', 'cap');
  stepsCap.appendChild(h('span', 'lab', 'schedule'));
  const stepsNote = h('span', 'tiny dim ell');
  stepsCap.appendChild(stepsNote);
  const stepBars = makeBars(52, null);
  stepsBox.appendChild(stepsCap); stepsBox.appendChild(stepBars.el);

  const verdict = h('div', 'line');
  const vA = h('span', 'num'); const vB = h('span', 'num');
  verdict.appendChild(vA); verdict.appendChild(vB);

  const sellNow = h('button', 'btn go'); sellNow.type = 'button';
  sellNow.style.width = '100%';
  on(sellNow, 'click', () => U.emit('sell', { id: U.state.ex.id, qty: el.__first }));

  el.appendChild(chips); el.appendChild(sizer.el); el.appendChild(turns);
  el.appendChild(plansBox); el.appendChild(stepsBox); el.appendChild(verdict); el.appendChild(sellNow);

  return {
    el,
    paint(m, sec) {
      const mk = m.market || {};
      const goods = mergeGoods(U, mk);
      const s = U.state.ex;
      // an order sent over from the market panel arrives here once
      if (U.state.exchange) {
        s.id = U.state.exchange.id;
        s.abs = num(U.state.exchange.qty) > 0 ? U.state.exchange.qty : null;
        U.state.exchange = null;
      }
      if (!s.id || !goods.some(g => g.id === s.id)) s.id = goods.length ? goods[0].id : null;
      if (!s.turns) s.turns = 6;

      keyed(chips, goods, (g) => g.id, (g) => {
        const b = h('button', 'btn mini'); b.type = 'button';
        on(b, 'click', () => { U.state.ex.id = b.__id; U.repaint(); });
        return b;
      }, (b, g) => {
        b.__id = g.id; setText(b, g.name);
        cls(b, 'on', g.id === s.id);
        tint(b, g.id === s.id ? '' : U.tintOf(g.id));
      });

      const g = goods.find(x => x.id === s.id);
      if (!g) { if (sec) sec.summary('nothing to plan'); return; }
      const qty = s.abs != null ? s.abs : scaleBy(g.held, s.frac == null ? 1 : s.frac);
      sizer.paint(s, g.held, qty, 'held');
      setText(tVal, plural(s.turns, 'turn'));

      const plan = U.plan(s.id, qty, s.turns);
      if (!plan || !plan.ok || !plan.plans || !plan.plans.length) {
        planBars.draw([], 0); stepBars.draw([], 0);
        setText(vA, plan && plan.reason ? plan.reason : 'nothing to plan');
        setText(vB, '');
        sellNow.disabled = true;
        if (sec) sec.summary('idle');
        return;
      }

      const now = plan.plans.find(p => p.id === 'all-now') || plan.plans[plan.plans.length - 1];
      const baseLog = mlog(now.net);
      const ratio = (v) => {
        const r = Math.pow(10, mlog(v) - baseLog);
        return isFinite(r) ? r : 1;
      };
      const bars = plan.plans.map(p => ({
        key: p.id, label: p.id, value: ratio(p.net),
        sub: mult(ratio(p.net)),
        tone: p.id === plan.best ? 'var(--sb-gold)' : 'var(--sb-dim)',
        picked: p.id === plan.best, p,
      }));
      planBars.draw(bars, 1);
      setText(plansNote, 'against selling it all this turn');

      const best = plan.plans.find(p => p.id === plan.best) || plan.plans[0];
      const steps = (best.steps || []).filter(st => num(st.qty) > 0);
      const totLog = mlog(qty);
      stepBars.draw(steps.map((st, i) => ({
        key: 'd' + st.depth + ':' + i,
        label: 'd' + st.depth,
        value: Math.max(0, Math.pow(10, mlog(st.qty) - totLog)) || 0,
        sub: st.index != null ? ix(st.index) : '',
        tone: 'var(--sb-swarm)', picked: i === 0,
      })), 0);
      setText(stepsNote, 'share of the order sold on each turn, with the index it meets');

      setText(vA, 'best: ' + plan.best);
      setText(vB, (plan.gainText != null ? '+' + plan.gainText : '')
        + (isFinite(plan.gainPct) ? '  ' + signPct(plan.gainPct / 100) + ' over selling it now' : ''));
      tint(vB, (plan.gainPct || 0) > 0 ? 'var(--sb-good)' : 'var(--sb-dim)');

      const first = steps.length ? steps[0].qty : qty;
      el.__first = first;
      setText(sellNow, 'sell the first slice: ' + U.fmt(first) + ' ' + g.name);
      sellNow.disabled = U.busy || !U.can('sell') || num(first) <= 0;

      if (sec) sec.summary(g.name + ' ' + U.fmt(qty) + '  best ' + plan.best
        + (isFinite(plan.gainPct) ? '  ' + signPct(plan.gainPct / 100, 0) : ''));
    },
  };
}


// ===========================================================================
// THE LINE
//
// A wager on your own run, in the game's own currency and never anything else.
// The line is computed from the player's own history, so beating it means
// knowing yourself better than the game knows you. Rendered as one number, two
// buttons and a record of how the last few calls went.
// ===========================================================================

function makeWager(U) {
  const el = h('div', 'sb-wg');
  const ln = h('div', 'ln');
  const lnLab = h('span', 'lab');
  const lnVal = h('b', 'num');
  const lnNote = h('span', 'dim tiny');
  ln.appendChild(lnLab); ln.appendChild(lnVal); ln.appendChild(lnNote);
  const sizer = makeSizer(U, () => U.repaint());
  const sides = h('div', 'sides');
  const over = h('button', 'btn go', 'over'); over.type = 'button';
  const under = h('button', 'btn warn', 'under'); under.type = 'button';
  const held = h('span', 'tiny dim');
  sides.appendChild(over); sides.appendChild(under); sides.appendChild(held);
  const hist = h('div', 'hist');
  el.appendChild(ln); el.appendChild(sizer.el); el.appendChild(sides); el.appendChild(hist);

  on(over, 'click', () => U.emit('wager', { side: 'over', stake: el.__stake, line: el.__line }));
  on(under, 'click', () => U.emit('wager', { side: 'under', stake: el.__stake, line: el.__line }));

  return {
    el,
    paint(m, sec) {
      const w = m.wager;
      if (!w || !w.line) { show(el, false); if (sec) sec.summary(''); return; }
      show(el, true);
      el.__line = w.line;
      setText(lnLab, w.line.metric || 'line');
      setNum(lnVal, w.line.text != null ? w.line.text : U.fmt(w.line.value), num(w.line.value));
      setText(lnNote, w.note || 'from your own last runs');

      const st = U.state.wager;
      const basis = w.bankroll != null ? w.bankroll : (m.run && m.run.essence);
      const stake = st.abs != null ? st.abs : scaleBy(basis, st.frac == null ? 0.125 : st.frac);
      el.__stake = stake;
      sizer.paint(st, basis, stake, 'on hand');

      const open = w.open !== false && !w.taken;
      over.disabled = !open || U.busy;
      under.disabled = !open || U.busy;
      setText(over, 'over' + (w.odds && w.odds.over ? '  ' + mult(w.odds.over) : ''));
      setText(under, 'under' + (w.odds && w.odds.under ? '  ' + mult(w.odds.under) : ''));
      setText(held, w.taken
        ? 'holding ' + w.taken.side + ' ' + U.fmt(w.taken.stake)
        : 'settles when the stretch ends');

      const past = (w.history || []).slice(-24);
      keyed(hist, past, (p, i) => i + ':' + p.depth, () => h('i', ''), (n, p) => {
        n.className = p.won ? 'won' : p.won === false ? 'lost' : '';
        const hgt = clamp(4 + Math.abs(p.margin || 0) * 14, 4, 20);
        n.style.height = hgt.toFixed(0) + 'px';
        n.title = 'd' + p.depth + ' ' + (p.side || '') + ' ' + (p.won ? 'won' : 'lost');
      });

      if (sec) sec.summary(w.taken
        ? w.taken.side + ' ' + U.fmt(w.taken.stake) + ' at ' + (w.line.text != null ? w.line.text : U.fmt(w.line.value))
        : 'line ' + (w.line.text != null ? w.line.text : U.fmt(w.line.value)) + ', open');
    },
  };
}


// ===========================================================================
// THE HAND
//
// A few cards between turns, and nothing during one. Each card says what the
// NEXT rank does in the player's own terms and names the tell it will leave on
// screen, because a power whose effect cannot be seen is a number pretending to
// be a decision. Cards can be paid for in cash or in material, and both rails
// are shown side by side so leaning on trade stays a choice rather than a toll.
// ===========================================================================

function makeHand(U) {
  const el = h('div', '');
  const cards = h('div', 'sb-cards');
  const foot = h('div', 'sizer');
  foot.style.paddingTop = '8px';
  const rerollBtn = h('button', 'btn mini'); rerollBtn.type = 'button';
  const footNote = h('span', 'of');
  foot.appendChild(rerollBtn); foot.appendChild(footNote);
  el.appendChild(cards); el.appendChild(foot);
  on(rerollBtn, 'click', () => U.emit('reroll', {}));

  return {
    el,
    paint(m, sec) {
      const o = (m.powers && m.powers.offer) || null;
      if (!o || !o.slots) { show(el, false); if (sec) sec.summary(''); return; }
      show(el, true);

      keyed(cards, o.slots, (s) => s.id, () => {
        const n = h('div', 'sb-card');
        const top = h('div', 'top');
        const nm = h('span', 'nm');
        const rk = h('span', 'rk');
        const kt = h('span', 'kt');
        const doc = h('span', 'doc');
        top.appendChild(nm); top.appendChild(rk); top.appendChild(kt); top.appendChild(doc);
        const ln = h('div', 'ln');
        const vs = h('div', 'vs');
        const buys = h('div', 'buys');
        const cash = h('button', 'btn go'); cash.type = 'button';
        const matl = h('button', 'btn'); matl.type = 'button';
        const sp = h('span', 'sp');
        buys.appendChild(cash); buys.appendChild(matl); buys.appendChild(sp);
        n.appendChild(top); n.appendChild(ln); n.appendChild(vs); n.appendChild(buys);
        on(cash, 'click', () => U.emit('power', { id: n.__id, rail: 'cash' }));
        on(matl, 'click', () => U.emit('power', { id: n.__id, rail: 'material' }));
        n.__q = { nm, rk, kt, doc, ln, vs, cash, matl, sp };
        return n;
      }, (n, s) => {
        n.__id = s.id;
        const q = n.__q;
        n.style.borderLeftColor = s.tint || 'var(--sb-line)';
        cls(n, 'key', !!s.keystone);
        cls(n, 'dead', !!s.maxed);
        setText(q.nm, s.name);
        tint(q.nm, s.tint);
        setText(q.rk, s.rank > 0 ? 'rank ' + s.rank : 'new');
        show(q.rk, true);
        setText(q.kt, s.keystone ? 'keystone' : (s.echo ? 'echo' : ''));
        show(q.kt, !!(s.keystone || s.echo));
        // The family's printed name, which says what it gives you. The id is
        // the fallback and it is only ever seen if a host forgets to send one.
        setText(q.doc, String(s.doctrineName || s.doctrine || '').toUpperCase());
        tint(q.doc, s.tint);
        setText(q.ln, s.line || '');
        setText(q.vs, s.visual || '');
        show(q.vs, U.opt.showTells !== false && !!s.visual);

        setText(q.cash, 'buy  ' + (s.costText != null ? s.costText : U.fmt(s.cost)) + ' cash');
        q.cash.disabled = U.busy || s.maxed || !s.affordable || !U.can('power');
        const wantMat = U.opt.rails !== false && s.costMaterialText != null;
        show(q.matl, wantMat);
        if (wantMat) {
          setText(q.matl, 'or ' + s.costMaterialText + ' ore');
          q.matl.disabled = U.busy || s.maxed || !U.can('power');
        }
        setText(q.sp, s.maxed ? 'no more of this one' : '');
      });

      const free = o.rerollFree;
      setText(rerollBtn, free ? 'redeal' : 'redeal  ' + U.fmt(o.rerollCost));
      rerollBtn.disabled = U.busy || !o.canReroll || !U.can('reroll');
      show(rerollBtn, U.can('reroll'));
      setText(footNote, 'a new hand every depth');

      if (sec) {
        const afford = o.slots.filter(s => s.affordable && !s.maxed).length;
        sec.summary(plural(o.slots.length, 'option') + ', ' + afford + ' affordable');
      }
    },
  };
}


// ===========================================================================
// UPGRADES
//
// Priced in material, never in cash, so what the field gives you and what the
// list wants are two different lists and the gap between them is the reason to
// trade at all. Each cost line prints have against need, and the cover button
// buys the shortfall and completes the purchase in one action - which is the
// intended way to play rather than a shortcut around it.
// ===========================================================================

function makeOffers(U) {
  const el = h('div', 'sb-offs');
  return {
    el,
    paint(m, sec) {
      const list = (m.market && m.market.offers) || [];
      keyed(el, list, (o) => o.id, () => {
        const n = h('div', 'sb-off');
        const l = h('div', 'l');
        const nm = h('div', 'nm');
        const ds = h('div', 'ds');
        l.appendChild(nm); l.appendChild(ds);
        const cost = h('div', 'cost');
        const b = h('div', 'b');
        const buy = h('button', 'btn go', 'buy'); buy.type = 'button';
        const cover = h('button', 'btn'); cover.type = 'button';
        b.appendChild(buy); b.appendChild(cover);
        n.appendChild(l); n.appendChild(cost); n.appendChild(b);
        on(buy, 'click', () => U.emit('upgrade', { id: n.__id, cover: false }));
        on(cover, 'click', () => U.emit('upgrade', { id: n.__id, cover: true }));
        n.__q = { nm, ds, cost, buy, cover };
        return n;
      }, (n, o) => {
        n.__id = o.id;
        const q = n.__q;
        setText(q.nm, o.name + (o.bought ? '  x' + o.bought : ''));
        setText(q.ds, o.desc || '');
        keyed(q.cost, o.lines || [], (l) => l.id, () => {
          const c = h('span', 'c num');
          return c;
        }, (c, l) => {
          const shortfall = cmpMag(l.short, 0) > 0;
          setText(c, (l.needText != null ? l.needText : U.fmt(l.need)) + ' ' + l.id
            + (shortfall ? '  (have ' + (l.haveText != null ? l.haveText : U.fmt(l.have)) + ')' : ''));
          tint(c, shortfall ? 'var(--sb-hot)' : U.tintOf(l.id));
        });
        q.buy.disabled = U.busy || !o.afford || !U.can('upgrade');
        show(q.cover, !!o.coverable);
        if (o.coverable) {
          setText(q.cover, 'cover  ' + (o.coverText != null ? o.coverText : U.fmt(o.coverCost)));
          q.cover.disabled = U.busy || !U.can('upgrade');
          q.cover.title = 'buy the shortfall on the open market and complete the purchase';
        }
      });
      if (sec) {
        const n = list.filter(o => o.afford).length;
        sec.summary(list.length ? n + ' of ' + list.length + ' affordable' : 'nothing offered');
      }
    },
  };
}


// ===========================================================================
// THE CODEX
//
// What the run has learned exists: doctrines and their commitment, powers owned
// and powers merely seen, a count of what is still out there, and the full
// instrument schedule with the depths attached. A first run has no reason to
// open it and no button for it; a long run wants exactly this.
// ===========================================================================

function makeCodex(U) {
  const el = h('div', 'sb-cdx');
  const docs = h('div', 'sb-cdx');
  const hiddenLine = h('div', 'hidden-n');
  const instCap = h('div', 'lab', 'instruments');
  const inst = h('div', '');
  el.appendChild(docs); el.appendChild(hiddenLine);
  el.appendChild(instCap); el.appendChild(inst);

  return {
    el,
    paint(m, sec) {
      const cx = (m.powers && m.powers.codex) || null;
      const rv = (m.market && m.market.reveal) || null;

      if (cx) {
        const byDoc = {};
        for (const d of cx.doctrines || []) byDoc[d.id] = { ...d, owned: [], seen: [] };
        for (const e of cx.owned || []) if (byDoc[e.doctrine]) byDoc[e.doctrine].owned.push(e);
        for (const e of cx.revealed || []) if (byDoc[e.doctrine]) byDoc[e.doctrine].seen.push(e);
        const list = Object.values(byDoc).filter(d => d.points > 0 || d.owned.length || d.seen.length);

        keyed(docs, list, (d) => d.id, () => {
          const n = h('div', 'doc');
          const hd = h('div', 'h');
          hd.appendChild(h('span', 'n'));
          hd.appendChild(h('span', 'lab'));
          hd.appendChild(h('span', 'p'));
          const cr = h('div', 'cr');
          const rows = h('div', '');
          n.appendChild(hd); n.appendChild(cr); n.appendChild(rows);
          return n;
        }, (n, d) => {
          n.style.borderLeftColor = d.tint || 'var(--sb-line)';
          const hd = n.firstChild;
          setText(hd.childNodes[0], d.name);
          tint(hd.childNodes[0], d.tint);
          setText(hd.childNodes[1], d.dominant ? 'leading' : '');
          setText(hd.childNodes[2], d.points + (d.points === 1 ? ' rank' : ' ranks'));
          setText(n.childNodes[1], d.creed || '');
          const rows = d.owned.map(e => ({ ...e, own: true })).concat(d.seen.map(e => ({ ...e, own: false })));
          keyed(n.childNodes[2], rows, (e) => e.id, () => {
            const r = h('div', 'e');
            r.appendChild(h('span', 'n'));
            r.appendChild(h('span', 'l ell'));
            r.appendChild(h('span', 'dim'));
            return r;
          }, (r, e) => {
            cls(r, 'un', !e.own);
            setText(r.childNodes[0], e.name || '???');
            tint(r.childNodes[0], e.own ? e.tint : '');
            setText(r.childNodes[1], e.line || '');
            setText(r.childNodes[2], e.own ? 'x' + e.rank : '');
          });
        });
        setText(hiddenLine, cx.hidden ? cx.hidden + ' more not yet seen  ' + '. '.repeat(Math.min(24, cx.hidden)) : '');
        show(hiddenLine, !!cx.hidden);
        show(docs, list.length > 0);
      } else {
        show(docs, false);
        show(hiddenLine, false);
      }

      if (rv) {
        const rows = (rv.detail || []).map(r => ({ ...r, got: true }));
        const nextOne = rv.next ? [{ ...rv.next, got: false }] : [];
        const all = rows.concat(nextOne);
        keyed(inst, all, (r) => r.id, () => {
          const n = h('div', 'rev');
          n.appendChild(h('span', 'd num'));
          n.appendChild(h('span', ''));
          n.appendChild(h('span', 'dim ell'));
          return n;
        }, (n, r) => {
          cls(n, 'locked', !r.got);
          setText(n.childNodes[0], 'd' + r.depth);
          setText(n.childNodes[1], r.title);
          setText(n.childNodes[2], r.blurb || '');
        });
        show(instCap, all.length > 0);
        show(inst, all.length > 0);
      } else { show(instCap, false); show(inst, false); }

      if (sec) {
        const bits = [];
        if (cx) bits.push(plural(cx.taken || 0, 'power'));
        if (rv) bits.push((rv.unlocked || []).length + ' instruments');
        sec.summary(bits.join('  '));
      }
    },
  };
}


// ===========================================================================
// FEATS AND STANDINGS
//
// Badges and a board, treated as ordinary furniture rather than a reward
// popup. A feat is a line of text with a bar under it; earning one posts a
// notice and nothing else interrupts. Both are entirely host-supplied - this
// draws what it is handed and awards nothing.
// ===========================================================================

function makeFeats(U) {
  const el = h('div', '');
  const grid = h('div', '');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(auto-fill,minmax(15ch,1fr))';
  grid.style.gap = '6px';
  el.appendChild(grid);
  return {
    el,
    paint(m, sec) {
      const list = m.feats || [];
      keyed(grid, list, (f) => f.id, () => {
        const n = h('div', '');
        n.style.border = '1px solid var(--sb-line)';
        n.style.padding = '5px 6px';
        n.appendChild(h('div', 'tiny'));
        n.appendChild(h('div', 'tiny dim'));
        const bar = h('div', '');
        bar.style.height = '2px';
        bar.style.background = 'var(--sb-line)';
        bar.style.marginTop = '4px';
        const fill = h('div', '');
        fill.style.height = '2px';
        bar.appendChild(fill);
        n.appendChild(bar);
        return n;
      }, (n, f) => {
        const done = !!f.earned;
        n.style.borderColor = done ? 'var(--sb-gold)' : 'var(--sb-line)';
        n.style.opacity = done ? '1' : '.62';
        setText(n.childNodes[0], (done ? '+ ' : '. ') + (f.name || f.id));
        tint(n.childNodes[0], done ? 'var(--sb-gold)' : '');
        setText(n.childNodes[1], f.hidden && !done ? 'hidden' : (f.desc || ''));
        const p = clamp(f.progress == null ? (done ? 1 : 0) : f.progress, 0, 1);
        const fill = n.childNodes[2].firstChild;
        fill.style.width = (p * 100).toFixed(1) + '%';
        fill.style.background = done ? 'var(--sb-gold)' : 'var(--sb-swarm)';
      });
      if (sec) {
        const got = list.filter(f => f.earned).length;
        sec.summary(list.length ? got + ' of ' + list.length : '');
      }
    },
  };
}

function makeBoards(U) {
  const el = h('div', '');
  const tabs = h('div', 'sizer');
  const table = h('div', 'sb-tab');
  el.appendChild(tabs); el.appendChild(table);
  return {
    el,
    paint(m, sec) {
      const boards = m.boards || [];
      if (!boards.length) { show(el, false); if (sec) sec.summary(''); return; }
      show(el, true);
      let pick = U.state.board;
      if (!pick || !boards.some(b => b.id === pick)) pick = boards[0].id;
      U.state.board = pick;

      keyed(tabs, boards, (b) => b.id, (b) => {
        const t = h('button', 'btn mini'); t.type = 'button';
        on(t, 'click', () => { U.state.board = t.__id; U.repaint(); });
        return t;
      }, (t, b) => { t.__id = b.id; setText(t, b.name || b.id); cls(t, 'on', b.id === pick); });
      show(tabs, boards.length > 1);

      const board = boards.find(b => b.id === pick);
      const rows = board.rows || [];
      keyed(table, rows, (r, i) => (r.key != null ? r.key : i), () => {
        const n = h('div', 'r');
        n.appendChild(h('span', 'num dim'));
        n.appendChild(h('span', 'grow ell'));
        n.appendChild(h('span', 'rt num'));
        return n;
      }, (n, r, k, i) => {
        cls(n, 'me', !!r.you);
        setText(n.childNodes[0], '#' + (r.rank != null ? r.rank : i + 1));
        setText(n.childNodes[1], (r.you ? '> ' : '') + (r.name || 'you'));
        tint(n.childNodes[1], r.you ? 'var(--sb-swarm)' : '');
        setText(n.childNodes[2], r.text != null ? r.text : U.fmt(r.value));
      });

      if (sec) {
        const mine = rows.find(r => r.you);
        sec.summary(board.name + (mine ? '  you #' + (mine.rank != null ? mine.rank : '-') : ''));
      }
    },
  };
}


// ===========================================================================
// THE RUN SUMMARY
//
// Text on a dark ground, one button, no ceremony. It reports what the run was
// worth and how it was built, and it is dismissible immediately, because
// starting again should feel like nothing.
// ===========================================================================

function makeRunEnd(U) {
  const el = h('div', 'sb-over');
  const card = h('div', 'card');
  const vis = (yes) => { cls(el, 'open', yes); el.__hid = !yes; };
  const title = h('h2', '');
  const sub = h('div', 'dim');
  const grid = h('div', 'grid');
  const rows = h('div', 'rows');
  const again = h('button', 'btn go', 'again'); again.type = 'button';
  card.appendChild(title); card.appendChild(sub); card.appendChild(grid);
  card.appendChild(rows); card.appendChild(again);
  el.appendChild(card);
  vis(false);
  on(again, 'click', () => { vis(false); U.emit('restart', {}); });
  on(el, 'keydown', (e) => { if (e.key === 'Escape') vis(false); });

  return {
    el,
    open(s) {
      s = s || {};
      setText(title, s.title || 'the swarm is overrun');
      setText(sub, s.subtitle || '');
      const stats = s.stats || [];
      keyed(grid, stats, (x) => x.k, () => {
        const n = h('div', 'st');
        n.appendChild(h('b', 'num'));
        n.appendChild(h('div', 'sub lab'));
        return n;
      }, (n, x) => {
        setText(n.firstChild, x.v);
        setText(n.lastChild, x.k);
        tint(n.firstChild, x.tint || '');
      });
      keyed(rows, s.lines || [], (l, i) => i + ':' + l, () => h('div', ''), (n, l) => setText(n, l));
      setText(again, s.action || 'again');
      vis(true);
      again.focus();
    },
    close() { vis(false); },
  };
}


// ===========================================================================
// THE DECK
//
// Sections in one fixed order that never changes. A section that is not live
// is not in the document at all; a section that has just become live opens
// itself once and marks itself, then behaves like everything else. Order is
// the only navigation there is - no tabs, no menu, no mode.
// ===========================================================================

const SECTIONS = [
  {
    name: 'hand', title: 'powers', open: true, make: makeHand,
    live: (m) => !!(m.powers && m.powers.offer && m.powers.offer.slots && m.powers.offer.slots.length),
  },
  {
    name: 'offers', title: 'upgrades', open: true, make: makeOffers,
    live: (m) => !!(m.market && m.market.offers && m.market.offers.length),
  },
  {
    name: 'market', title: 'market', open: true, make: makeMarket,
    live: (m) => !!(m.market && m.market.prices && m.market.prices.length),
  },
  {
    name: 'refinery', title: 'refinery', open: false, make: makeRefinery,
    live: (m) => !!(m.market && m.market.recipes && m.market.recipes.length),
  },
  {
    name: 'forwards', title: 'consignments', open: false, make: makeForwards,
    live: (m, U) => U.has(m, 'consignments'),
  },
  {
    name: 'assay', title: 'assay', open: false, make: makeAssay,
    live: (m, U) => U.has(m, 'assay') && !!U.data.forecast,
  },
  {
    name: 'exchange', title: 'exchange', open: false, make: makeExchange,
    live: (m, U) => U.has(m, 'exchange') && !!U.data.plan,
  },
  {
    name: 'wager', title: 'the line', open: false, make: makeWager,
    live: (m) => !!(m.wager && m.wager.line),
  },
  {
    name: 'feats', title: 'awards', open: false, make: makeFeats,
    live: (m) => !!(m.feats && m.feats.length),
  },
  {
    name: 'boards', title: 'standings', open: false, make: makeBoards,
    live: (m) => !!(m.boards && m.boards.length),
  },
  {
    // a reference panel, not a decision surface: it waits until there is
    // enough behind it to be worth opening
    name: 'codex', title: 'powers you have seen', open: false, make: makeCodex,
    live: (m, U) => !!(m.powers && m.powers.codex && (m.powers.codex.taken || 0) >= 3)
      || U.has(m, 'regimes'),
  },
];

const ACTIONS = ['sell', 'buy', 'melt', 'craft', 'consign', 'upgrade', 'power', 'reroll', 'wager', 'restart', 'select', 'section'];


// ===========================================================================
// createUI
// ===========================================================================

/**
 * Build the interface.
 *
 * @param {object} [options]
 * @param {Element} [options.mount]        where the deck goes. Defaults to a
 *                                         new div appended to document.body.
 * @param {Element|false} [options.headerMount]
 *                                         where the run header goes. Omit to
 *                                         put it at the top of the deck; pass
 *                                         false to suppress it entirely when
 *                                         the page already has one.
 * @param {object} [options.on]            action callbacks, see ACTIONS.
 * @param {object} [options.data]          pull providers, see setProviders().
 * @param {function} [options.format]      (value) => string for every figure.
 * @param {object} [options.material]      material id -> accent colour.
 * @param {number} [options.epoch]         band cadence on charts, in depths.
 *                                         Default 6. Zero turns banding off.
 * @param {number} [options.narrowAt]      px width below which rows fold.
 * @param {number} [options.maxWidth]      css max-width of the whole surface.
 * @param {boolean} [options.rails]        show the material price on power
 *                                         cards as well as the cash price.
 * @param {boolean} [options.showTells]    show each power's on-screen tell.
 * @param {boolean} [options.watch]        derive watch items from the model.
 * @param {boolean} [options.unhideMount]  force a hidden mount visible.
 * @returns {object} the controller described at the bottom of this file.
 */
export function createUI(options) {
  const opt = Object.assign({
    epoch: 6,
    narrowAt: 620,
    maxWidth: 520,
    rails: true,
    showTells: true,
    bareUntil: 3,
    watch: true,
    unhideMount: true,
    assayRows: 6,
    termMin: 3,
    termMax: 12,
  }, options || {});

  injectStyle();

  let mount = opt.mount || null;
  if (!mount) { mount = document.createElement('div'); document.body.appendChild(mount); }
  if (opt.unhideMount && mount.isConnected) {
    const disp = getComputedStyle(mount).display;
    if (disp === 'none') mount.style.display = 'block';
  }

  const root = h('div', 'sb-root');
  root.style.setProperty('--sb-max', (opt.maxWidth || 520) + 'px');
  mount.appendChild(root);

  const handlers = {};
  for (const a of ACTIONS) if (opt.on && typeof opt.on[a] === 'function') handlers[a] = opt.on[a];

  let model = {};
  let painting = false, queued = false, destroyed = false;
  let phase = 'aim';

  const U = {
    opt,
    data: Object.assign({}, opt.data),
    state: {
      sel: null,           // the good whose order panel is open
      order: {},           // per-good order size and side
      fwd: { id: null, frac: 0.5, abs: null, term: 6 },
      ex: { id: null, frac: 1, abs: null, turns: 6 },
      wager: { frac: 0.125, abs: null },
      window: 48,          // depths of history on the ledger chart
      board: null,
      open: {},            // section name -> open
      exchange: null,      // handoff from the order panel
      scrubIdle: '',
    },
    revSet: new Set(),
    cache: {},
    goods: [],
    busy: false,
    fmt: (v, p) => (opt.format ? opt.format(v, p) : fmtDefault(v, p)),
    tintOf: (id) => (opt.material && opt.material[id]) || THEME.material[id] || 'var(--sb-ink)',
    has: (m, id) => U.revSet.has(id),
    can: (action) => typeof handlers[action] === 'function',
    emit(name, payload) {
      const fn = handlers[name];
      if (fn) fn(payload);
      U.repaint();
    },
    repaint() {
      if (destroyed) return;
      if (painting) { queued = true; return; }
      paintAll(model);
    },
  };

  // ---- pull providers, cached for the length of one paint --------------
  function cached(key, make) {
    if (key in U.cache) return U.cache[key];
    const v = make();
    U.cache[key] = v;
    return v;
  }

  U.history = (id, n) => cached('h:' + id + ':' + n,
    () => (U.data.history ? U.data.history(id, n) || [] : []));

  U.curve = (id, n) => cached('c:' + id + ':' + n,
    () => (U.data.curve ? U.data.curve(id, n) || null : null));

  U.forecast = (n) => cached('f:' + n,
    () => (U.data.forecast ? U.data.forecast(n) : null));

  U.plan = (id, qty, turns) => cached('p:' + id + ':' + U.fmt(qty) + ':' + turns,
    () => (U.data.plan ? U.data.plan(id, qty, turns) : null));

  U.consignPreview = (id, qty, term) => cached('cp:' + id + ':' + U.fmt(qty) + ':' + term,
    () => (U.data.consignPreview ? U.data.consignPreview(id, qty, term) : null));

  U.preview = (mode, id, qty) => cached('pv:' + mode + ':' + id + ':' + U.fmt(qty), () => {
    const fn = mode === 'buy' ? U.data.buyPreview : U.data.sellPreview;
    return fn ? fn(id, qty) : null;
  });

  /** Capacity the forward desk will accept, learned by probing the preview. */
  U.forwardFree = (id) => cached('ff:' + id, () => {
    if (!U.data.consignPreview) return null;
    const probe = U.data.consignPreview(id, { m: 1, e: 60 }, opt.termMin);
    if (!probe) return null;
    if (probe.ok) return { m: 1, e: 60 };
    return probe.reason === 'capacity' ? probe.free : null;
  });

  U.buyBasis = (m, id) => cached('bb:' + id, () => {
    if (U.data.maxAffordable) return U.data.maxAffordable(id);
    const g = U.goods.find(x => x.id === id);
    return g && g.stock != null ? scaleBy(g.stock, 0.25) : 100;
  });

  /**
   * Trace unit price against order size out to twice the chosen size, so the
   * cost of going one step bigger is a shape. Switches to a log price axis when
   * the figures stop fitting a linear one, which they eventually do.
   */
  U.sampleCurve = (mode, id, qty, spot) => {
    const fn = mode === 'buy' ? U.data.buyPreview : U.data.sellPreview;
    if (!fn || num(qty) <= 0) return null;
    const N = 16, span = 2;
    const raw = [];
    let maxE = -Infinity;
    for (let i = 1; i <= N; i++) {
      const t = (i / N) * span;
      const pv = fn(id, scaleBy(qty, t));
      if (!pv || !pv.ok || pv.unit == null) continue;
      raw.push({ t, unit: pv.unit });
      const e = toMag(pv.unit).e;
      if (e > maxE) maxE = e;
    }
    if (raw.length < 2) return null;
    const useLog = maxE > 12;
    const conv = (v) => (useLog ? mlog(v) : num(v));
    return {
      points: raw.map(r => ({ q: r.t, unit: conv(r.unit) })),
      at: 1,
      spot: spot == null ? null : conv(spot),
      log: useLog,
    };
  };

  // ---- selection and sizing ---------------------------------------------
  U.orderState = (id) => {
    const o = U.state.order;
    if (!o[id]) o[id] = { mode: 'sell', frac: 1, abs: null };
    return o[id];
  };

  U.orderQty = (m, id, mode) => {
    const s = U.orderState(id);
    if (s.abs != null) return s.abs;
    const g = U.goods.find(x => x.id === id);
    const basis = mode === 'buy' ? U.buyBasis(m, id) : (g ? g.held : 0);
    return scaleBy(basis == null ? 0 : basis, s.frac == null ? 1 : s.frac);
  };

  U.selectGood = (id, force) => {
    U.state.sel = (!force && U.state.sel === id) ? null : id;
    if (U.state.sel) U.openSection('market');
    if (handlers.select) handlers.select({ id: U.state.sel });
    U.repaint();
  };

  // ---- sections ----------------------------------------------------------
  const views = {};
  const secs = {};
  const seenSec = {};

  U.sectionLive = (name) => !!(secs[name] && secs[name].live);

  U.openSection = (name, open) => {
    if (!secs[name]) return;
    U.state.open[name] = open === undefined ? true : !!open;
    applyOpen(name);
    if (handlers.section) handlers.section({ name, open: U.state.open[name] });
    U.repaint();
  };

  U.toggleSection = (name) => U.openSection(name, !U.state.open[name]);

  U.reveal = (name) => {
    U.openSection(name, true);
    const s = secs[name];
    if (s && s.el.scrollIntoView) s.el.scrollIntoView({ block: 'nearest' });
  };

  function applyOpen(name) {
    const s = secs[name];
    if (!s) return;
    const open = !!U.state.open[name];
    cls(s.el, 'shut', !open);
    s.hd.setAttribute('aria-expanded', open ? 'true' : 'false');
    setText(s.caret, open ? '▾' : '▸');
  }

  // ---- assembly ----------------------------------------------------------
  const header = opt.headerMount === false ? null : makeHeader(U);
  const regime = makeRegime(U);
  const headerHome = opt.headerMount && opt.headerMount !== true ? opt.headerMount : root;
  if (header) {
    headerHome.appendChild(header.el);
    headerHome.appendChild(header.strip);
    headerHome.appendChild(regime.el);
  } else {
    root.appendChild(regime.el);
  }

  const busyLine = h('div', 'sb-busy', 'the swarm is working');
  show(busyLine, false);
  root.appendChild(busyLine);

  const notices = makeNotices(U);
  const digest = makeDigest(U);
  const watch = makeWatch(U);
  root.appendChild(notices.el);
  root.appendChild(digest.el);
  root.appendChild(watch.el);

  const deck = h('div', 'sb-deck');
  root.appendChild(deck);

  for (const def of SECTIONS) {
    const sec = makeSection(U, def.name, def.title);
    const view = def.make(U);
    sec.bd.appendChild(view.el);
    sec.def = def;
    secs[def.name] = sec;
    views[def.name] = view;
    deck.appendChild(sec.el);
    show(sec.el, false);
    U.state.open[def.name] = def.open;
    applyOpen(def.name);
  }

  const nextLine = makeNext(U);
  root.appendChild(nextLine.el);

  const runEnd = makeRunEnd(U);
  document.body.appendChild(runEnd.el);

  // ---- narrow layout -----------------------------------------------------
  function measure() {
    const w = root.clientWidth || (opt.maxWidth || 520);
    cls(root, 'narrow', w < (opt.narrowAt || 620));
  }
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => { measure(); U.repaint(); });
    ro.observe(root);
  } else {
    addEventListener('resize', measure);
  }
  measure();

  // ---- the paint ---------------------------------------------------------
  function paintAll(m) {
    if (destroyed) return;
    painting = true;
    U.cache = {};
    model = m || {};
    const mk = model.market || {};
    U.revSet = new Set((mk.reveal && mk.reveal.unlocked) || []);
    U.goods = mergeGoods(U, mk);
    U.busy = phase === 'firing';

    cls(root, 'busy', U.busy);
    show(busyLine, U.busy);

    notices.paint();
    watch.paint(deriveWatch(U, model));

    // a section that just became live opens itself once and says so
    //
    // A SECTION THAT DECLARES ITSELF CLOSED IS A REFERENCE PANEL and unfolding
    // it anyway buries the row the turn is actually spent on. The awards list
    // is seventeen tiles, it is on the menu in full, and opening itself on
    // turn one pushed the two power cards and most of the playfield off the
    // screen: measured at 1280x800 it took 375 of the deck's 613 pixels and
    // squeezed the field to 292x348. It still lights up and still says it
    // arrived; it just waits to be opened.
    let liveCount = 0;
    for (const def of SECTIONS) {
      const sec = secs[def.name];
      const live = !!def.live(model, U);
      sec.live = live;
      show(sec.el, live);
      if (live) {
        liveCount++;
        if (!seenSec[def.name]) {
          seenSec[def.name] = true;
          if (def.open) {
            U.state.open[def.name] = true;
            applyOpen(def.name);
          }
          cls(sec.el, 'fresh', true);
          setTimeout(() => cls(sec.el, 'fresh', false), 9000);
        }
        views[def.name].paint(model, sec);
      }
    }
    // While the deck is short it carries no furniture at all: no titles, no
    // carets, nothing to collapse. A first run is a few blocks of text with
    // hairlines between them. Section headers arrive with the section that
    // makes the deck too long to read whole, and from then on everything has
    // one - including the parts that were already there.
    const bare = liveCount <= (opt.bareUntil || 3);
    for (const def of SECTIONS) {
      const sec = secs[def.name];
      // A bare deck hides the headers, and a header is the only thing that
      // opens a section. So a reference panel in a bare deck has no way in and
      // no way out: forcing it open was the only reason it was readable at
      // all, and open is exactly where it does the most damage. It waits until
      // the deck is long enough to grow the caret that opens it.
      const bareHere = bare && sec.live;
      if (bareHere && !def.open) { show(sec.el, false); sec.live = false; continue; }
      cls(sec.el, 'bare', bareHere);
      if (bareHere) cls(sec.el, 'shut', false);
    }

    if (header) header.paint(model);
    regime.paint(model);
    nextLine.paint(model);

    painting = false;
    if (queued) { queued = false; paintAll(model); }
  }

  // ---- the controller ----------------------------------------------------
  const ui = {
    /** The root element of the whole surface. */
    el: root,
    /** Where the run header ended up, for a host that wants to style it. */
    headerEl: header ? header.el : null,
    /** Live view of interface state: open sections, selection, order sizes. */
    state: U.state,

    /**
     * Draw the model. Cheap and idempotent; safe to call every frame. Every
     * field is optional and an absent field means "not revealed yet", so the
     * same call works on turn one and at depth five hundred.
     *
     * model = {
     *   run:     { depth, reach, swarm|swarmText, swarmWord, essence|essenceText,
     *              damage|damageText, worth|worthText, bodies, bodyStack,
     *              pattern, feats:{earned,total}, extra:[{k,v,klass}] },
     *   market:  the economy report - prices, indicators, offers, margins,
     *            recipes, forwards, trades, regime, reveal, standing, worth,
     *   powers:  { offer, codex },
     *   wager:   { line:{metric,value,text}, odds, taken, history, bankroll },
     *   feats:   [{id,name,desc,earned,progress,hidden}],
     *   boards:  [{id,name,rows:[{rank,name,value|text,you}]}],
     *   alerts:  [{id,tone,text,action:{label,run}}],
     * }
     */
    update(m) { paintAll(m); return ui; },

    /**
     * 'aim' or 'between' leaves the deck live; 'firing' disables every control
     * and dims the deck while the swarm works, without freezing the figures,
     * because watching them move is the point; 'over' does the same and is
     * usually paired with showRunEnd().
     */
    setPhase(p) {
      phase = p || 'aim';
      U.busy = phase === 'firing' || phase === 'over';
      U.repaint();
      return ui;
    },
    get phase() { return phase; },

    /** One line summarising the turn that just resolved, or null to clear. */
    digest(entry) { digest.set(entry); return ui; },

    /**
     * Post a notice line. Reveals, feats earned, contracts settled. Never a
     * dialog and never blocking.
     * n = { key, kind, title, body, tone: 'info'|'bad'|undefined, ttl }
     */
    announce(n) { notices.add(n); return ui; },
    clearNotices() { notices.clear(); return ui; },

    /** Section control by name: see SECTIONS for the list. */
    open(name) { U.openSection(name, true); return ui; },
    close(name) { U.openSection(name, false); return ui; },
    toggle(name) { U.toggleSection(name); return ui; },
    reveal(name) { U.reveal(name); return ui; },
    /** Which sections currently have anything in them. */
    sections() { return SECTIONS.filter(d => secs[d.name].live).map(d => d.name); },

    /** Open a good's order panel, or pass null to close it. */
    select(id) { U.selectGood(id, true); return ui; },

    /** The run summary. Text and one button; dismissible at once. */
    showRunEnd(s) { runEnd.open(s); return ui; },
    hideRunEnd() { runEnd.close(); return ui; },

    /** Register or replace an action callback after construction. */
    on(name, fn) { if (typeof fn === 'function') handlers[name] = fn; else delete handlers[name]; return ui; },
    off(name) { delete handlers[name]; return ui; },

    /**
     * Replace or extend the pull providers. All optional and all synchronous;
     * a missing one simply removes the part of the interface that needs it.
     *
     * data = {
     *   history(id, n)                -> [{depth, index, book, price, priceText}]
     *   curve(id, n)                  -> [{depth, demand, regime}] ahead of now
     *   sellPreview(id, qty)          -> {ok, net, unit, startIndex, endIndex,
     *                                     startBook, endBook, capped, cappedQty}
     *   buyPreview(id, qty)           -> {ok, cost, unit, filled, short, ...}
     *   maxAffordable(id)             -> qty
     *   consignPreview(id, qty, term) -> {ok, unit, payout, edge, due, term,
     *                                     regimeAtDue} or {ok:false, reason, free}
     *   plan(id, qty, turns)          -> {ok, plans, best, gainText, gainPct}
     *   forecast(n)                   -> {ok, rows, totals, totalsText}
     * }
     */
    setProviders(data) { U.data = Object.assign({}, U.data, data || {}); U.repaint(); return ui; },

    /** Adjust display options after construction. */
    setOptions(patch) {
      Object.assign(opt, patch || {});
      root.style.setProperty('--sb-max', (opt.maxWidth || 520) + 'px');
      measure();
      U.repaint();
      return ui;
    },

    /** The formatter in use, so a host can print figures the same way. */
    format(v, places) { return U.fmt(v, places); },

    /** Force a visible change flash on a header figure. */
    flash(which, dir) {
      const map = { depth: 0, swarm: 1, essence: 2 };
      if (!header || !(which in map)) return ui;
      const node = header.el.querySelectorAll('.st b')[map[which]];
      if (node) flash(node, dir || 1);
      return ui;
    },

    destroy() {
      destroyed = true;
      if (ro) ro.disconnect(); else removeEventListener('resize', measure);
      root.remove();
      runEnd.el.remove();
      return ui;
    },
  };

  paintAll({});
  return ui;
}

let styleDone = false;
function injectStyle() {
  if (styleDone || typeof document === 'undefined') return;
  if (document.getElementById('sb-ui-style')) { styleDone = true; return; }
  const s = document.createElement('style');
  s.id = 'sb-ui-style';
  s.textContent = CSS;
  document.head.appendChild(s);
  styleDone = true;
}

export default createUI;


// ===========================================================================
// THE EXPORTED SURFACE, IN ONE PLACE
//
//   createUI(options) -> ui        build it; see the option list above
//   THEME                          material accents, overridable per host
//
//   ui.el                          root element
//   ui.headerEl                    the run header, if this module drew one
//   ui.state                       live interface state (open sections,
//                                  selected good, order sizes, chart window)
//
//   ui.update(model)               draw. safe every frame. every field optional
//   ui.setPhase('aim'|'firing'|'between'|'over')
//   ui.phase                       current phase
//   ui.digest(entry|null)          the turn-summary line
//   ui.announce(notice)            a notice line, never a dialog
//   ui.clearNotices()
//   ui.open(name) / close / toggle / reveal(name)
//   ui.sections()                  which sections currently hold anything
//   ui.select(id|null)             open a good's order panel
//   ui.showRunEnd(summary) / ui.hideRunEnd()
//   ui.on(action, fn) / ui.off(action)
//   ui.setProviders(data)          the pull providers
//   ui.setOptions(patch)
//   ui.format(value)               the figure formatter in use
//   ui.flash(field, dir)           force a visible change on a header figure
//   ui.destroy()
//
//   actions emitted:
//     sell    ({id, qty})
//     buy     ({id, qty})
//     craft   ({id, times})
//     consign ({id, qty, term})
//     upgrade ({id, cover})
//     power   ({id, rail: 'cash'|'material'})
//     reroll  ({})
//     wager   ({side, stake, line})
//     restart ({})
//     select  ({id})               a good's panel was opened or closed
//     section ({name, open})       a section was opened or closed
//
// An action never changes anything here. The host applies it, then calls
// update() with the new model, and the interface follows.
// ===========================================================================
