// Vendored from the game-art foundation (lib/market-save.js) at commit 42c692f, 2026-08-29.
// This copy belongs to Open Outcry: fixes land in the foundation first, then are
// carried here by reading the diff, never by a blind overwrite.
// ---------------------------------------------------------------------------
// Saving and restoring a market.
//
// The seeded generator is re-derived from (seed, tick) at the top of every
// tick, so no generator state is written down: a save carries the world and a
// tick number, and the restored market takes an identical next tick. That is
// what makes a saved run and a live run the same run, and it is checked by a
// test rather than assumed.
//
// Rules are functions and cannot be written to a file. They are handed back in
// on load; a load that forgets them silently reverts the world to the default
// rules, which is a different economy under the same numbers.
// ---------------------------------------------------------------------------

// Per-agent state lives in flat typed arrays, so a market of ten thousand is
// one allocation per field and a save is a plain array copy.
export const F64 = ['money', 'escrow', 'bLo', 'bHi', 'profit', 'lastWorth', 'need'];
export const I32 = ['inv', 'lock', 'oid', 'oAt', 'fail', 'hunger'];
export const U8 = ['role', 'good'];
const ALL = [...F64, ...I32, ...U8];

export function save(m) {
  const p = m.player;
  const j = {
    v: 1, seed: m.seed, t: m.t, opt: m.opt, feeBps: m.feeBps,
    issued: m.issued, fees: m.fees, taxPot: m.taxPot, wagePool: m.wagePool,
    produced: Array.from(m.produced), consumed: Array.from(m.consumed),
    prevMid: Array.from(m.prevMid),
    books: m.books.map((b) => b.toJSON()),
    shocks: m.shocks.map((s) => ({ ...s })),
    player: {
      money: p.money, escrow: p.escrow, inv: Array.from(p.inv), lock: Array.from(p.lock),
      bid: Array.from(p.bid), ask: Array.from(p.ask),
      manual: p.manual.map((x) => ({ ...x })), mm: p.mm.map((x) => (x ? { ...x } : null)),
    },
    history: m.history.map((h) => ({ mid: h.mid.slice(), vol: h.vol.slice(), flow: h.flow.slice() })),
    a: {},
  };
  for (const f of ALL) j.a[f] = Array.from(m[f]);
  return j;
}

export function load(Market, j, opts = {}) {
  const m = new Market({ ...j.opt, seed: j.seed, rules: opts.rules });
  m.t = j.t;
  m.reseed();
  m.feeBps = j.feeBps;
  m.issued = j.issued; m.fees = j.fees; m.taxPot = j.taxPot; m.wagePool = j.wagePool || 0;
  const set = (dst, src) => { for (let i = 0; i < src.length; i++) dst[i] = src[i]; };
  set(m.produced, j.produced); set(m.consumed, j.consumed); set(m.prevMid, j.prevMid);
  for (const f of ALL) set(m[f], j.a[f]);
  m.books = j.books.map((b) => m.books[0].constructor.fromJSON(b));
  m.shocks = j.shocks.map((s) => ({ ...s }));
  const p = j.player;
  m.player.money = p.money; m.player.escrow = p.escrow;
  set(m.player.inv, p.inv); set(m.player.lock, p.lock);
  set(m.player.bid, p.bid); set(m.player.ask, p.ask);
  m.player.manual = p.manual.map((x) => ({ ...x }));
  m.player.mm = p.mm.map((x) => (x ? { ...x } : null));
  m.history = j.history.map((h) => ({ mid: h.mid.slice(), vol: h.vol.slice(), flow: h.flow.slice() }));
  return m;
}

export default { save, load, F64, I32, U8 };
