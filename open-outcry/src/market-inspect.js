// Vendored from the game-art foundation (lib/market-inspect.js) at commit 42c692f, 2026-08-29.
// This copy belongs to Open Outcry: fixes land in the foundation first, then are
// carried here by reading the diff, never by a blind overwrite.
// ---------------------------------------------------------------------------
// The legibility layer: everything a player needs to read a market off the
// screen, kept apart from the simulation that produces it.
//
// A price that moves for reasons nobody can see is noise, and a player learns
// nothing from noise. Every function here answers one question a player
// actually asks: what is on the book, what just traded, who is holding the
// stock, what does the crowd think it is worth, why did it move, and is the
// world still adding up.
//
// These are plain functions over a Market so a game can call them from a
// worker, a test or a renderer without owning the market object. lib/market.js
// exposes each as a method as well.
// ---------------------------------------------------------------------------

import { BUY } from './orderbook.js?v=5';

export const ROLE_NAMES = ['producer', 'consumer', 'speculator', 'player'];
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Top n price levels each side, aggregated the way a ladder shows them.
export function depth(m, g, n = 8) { return m.books[g].depth(n); }

// The tape, newest first.
export function tape(m, g, n = 24) { return m.books[g].recentTrades(n); }

// Units held and money by role, plus the player, so a legend can say who is
// sitting on the stock and who is sitting on the cash.
export function byRole(m, g) {
  const out = ROLE_NAMES.map((name) => ({ name, agents: 0, units: 0, money: 0 }));
  const G = m.G;
  for (let i = 0; i < m.N; i++) {
    const r = out[m.role[i]];
    r.agents++;
    r.units += m.inv[i * G + g] + m.lock[i * G + g];
    r.money += m.money[i] + m.escrow[i];
  }
  const p = out[3];
  p.agents = 1;
  p.units = m.player.inv[g] + m.player.lock[g];
  p.money = m.player.money + m.player.escrow;
  return out;
}

// Where the crowd thinks a good is worth, as counts per price bin. The shape
// is the story: one hump is a settled market, two humps is a disagreement
// that is about to turn into volume.
export function beliefHistogram(m, g, bins = 24, lo = null, hi = null) {
  const G = m.G, mids = new Float64Array(m.N);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < m.N; i++) {
    const v = (m.bLo[i * G + g] + m.bHi[i * G + g]) / 2;
    mids[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (lo == null) lo = min;
  if (hi == null) hi = max;
  if (!(hi > lo)) hi = lo + 1;
  const counts = new Int32Array(bins);
  for (let i = 0; i < m.N; i++) counts[clamp(Math.floor(((mids[i] - lo) / (hi - lo)) * bins), 0, bins - 1)]++;
  return { lo, hi, bins, counts };
}

// Mean belief half-width as a share of the belief centre: how sure the crowd
// is. Falling means the market is converging on a price.
export function beliefSpread(m, g) {
  const G = m.G;
  let sum = 0;
  for (let i = 0; i < m.N; i++) {
    const k = i * G + g;
    const mid = (m.bLo[k] + m.bHi[k]) / 2;
    sum += mid > 0 ? (m.bHi[k] - m.bLo[k]) / 2 / mid : 0;
  }
  return sum / m.N;
}

// Units the takers lifted minus units they hit, this tick. Positive means
// buyers were the impatient side, which is what pushes a price up.
export function netFlow(m, g) {
  let net = 0;
  for (const t of m.books[g].recentTrades(128)) {
    if (t.tick !== m.t) continue;
    net += t.aggressor === BUY ? t.qty : -t.qty;
  }
  return net;
}

// Why the price moved this tick, in numbers and in one sentence.
export function why(m, g) {
  const from = m.prevMid[g], to = m.mid(g);
  const byR = [];
  let vol = 0;
  for (let r = 0; r < 4; r++) {
    const bought = m.flowBuy[g * 4 + r], sold = m.flowSell[g * 4 + r];
    vol += bought;
    byR.push({ name: ROLE_NAMES[r], bought, sold });
  }
  const net = netFlow(m, g);
  let dom = byR[0], domVol = -1;
  for (const r of byR) { const v = r.bought + r.sold; if (v > domVol) { domVol = v; dom = r; } }
  const dir = to > from + 1e-9 ? 'up' : to < from - 1e-9 ? 'down' : 'flat';
  const share = vol ? Math.round((domVol / (vol * 2)) * 100) : 0;
  const lean = dom.bought > dom.sold ? 'buying' : dom.bought < dom.sold ? 'selling' : 'on both sides';
  const text = vol === 0
    ? `no trades in ${m.goods[g].key}; mid held at ${to.toFixed(1)}`
    : `${dom.name}s took ${share}% of ${vol} units, mostly ${lean}; takers were ${net > 0 ? '+' : ''}${net} net; mid ${from.toFixed(1)} to ${to.toFixed(1)}`;
  return { tick: m.t, good: m.goods[g].key, from, to, dir, volume: vol, net, byRole: byR, dominant: dom.name, text };
}

// The invariant. `ok` goes false the moment a unit or a coin is invented.
// Money is conserved against what was explicitly issued; each good against
// what was explicitly produced less what was explicitly consumed.
export function conservation(m) {
  let money = m.player.money + m.player.escrow + m.wagePool;
  for (let i = 0; i < m.N; i++) money += m.money[i] + m.escrow[i];
  let ok = Math.abs(money + m.fees + m.taxPot - m.issued) < 1e-6;
  const goods = [];
  for (let g = 0; g < m.G; g++) {
    let held = m.player.inv[g] + m.player.lock[g];
    for (let i = 0; i < m.N; i++) held += m.inv[i * m.G + g] + m.lock[i * m.G + g];
    const expect = m.produced[g] - m.consumed[g];
    goods.push({ key: m.goods[g].key, held, expect, ok: held === expect });
    if (held !== expect) ok = false;
  }
  return { ok, money, issued: m.issued, fees: m.fees, tax: m.taxPot, goods };
}

export function stats(m) {
  return {
    tick: m.t, agents: m.N, fees: m.fees, tax: m.taxPot,
    money: conservation(m).money,
    goods: m.goods.map((gd, g) => ({
      key: gd.key, mid: m.mid(g), last: m.books[g].last, spread: m.books[g].spread(),
      volume: m.books[g].volume, open: m.books[g].openCount,
      belief: beliefSpread(m, g), net: netFlow(m, g),
    })),
  };
}

export default { depth, tape, byRole, beliefHistogram, beliefSpread, netFlow, why, conservation, stats };
