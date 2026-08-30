// ---------------------------------------------------------------------------
// The rules Open Outcry's crowds run on.
//
// The market engine deliberately leaves the CAUSAL SHAPE of a market to the
// world that uses it: how an opinion about price changes, how big an order
// gets written, what a shock does. The three belief rules it ships with are a
// good spread of characters, and this file keeps all three - but it adds one
// thing every pit in this game needs and a bare engine has no business
// assuming.
//
// A crowd whose only reference is its own prints random-walks. Over a few
// hundred ticks that is a market; over a few hours it is a grain pit trading
// grain at three, which is not a pit any more. So every belief here also
// creeps toward the pit's STANDING VALUE - what a trader on this floor has
// known grain to be worth for twenty years - by a small share on each fill and
// each miss. A day's prints move an opinion; a lifetime of them is what it
// comes back to.
//
// The pull is deliberately weak next to the evidence. A fill still moves a
// belief half the distance to the print; the anchor moves it a few percent of
// the way home. Every short move on the board is the crowd's, and a shock is
// entirely believed while it lasts. Only the hours belong to the anchor.
//
// The three characters survive it intact, and they are what makes two pits
// play differently:
//   adaptive   finds a price and holds near it
//   anchored   crawls, and lags news by many ticks, so reading early pays
//   momentum   reads a print past its view as a reason to expect another
// ---------------------------------------------------------------------------

import { BELIEFS, SIZING, setBand } from './market-rules.js?v=2';
import { BUY } from './orderbook.js?v=2';

const centreOf = (m, k) => (m.bLo[k] + m.bHi[k]) / 2;
const halfOf = (m, k) => (m.bHi[k] - m.bLo[k]) / 2;

// Creep one agent's band toward what this pit has always been worth. The
// market sets anchorPrice and anchorPull when it is built; with neither set
// this does nothing, so the rules still work on a bare engine.
function home(m, i, g) {
  const a = m.anchorPrice;
  if (!a || !m.anchorPull) return;
  const k = i * m.G + g;
  const c = centreOf(m, k);
  const next = c + (a - c) * m.anchorPull;
  const half = halfOf(m, k);
  // A belief that has gone unreadable is left alone rather than written back
  // as one. Nothing here should be able to produce it, and a price that is not
  // a number would take the whole book down on the next order.
  if (!Number.isFinite(next) || !Number.isFinite(half)) return;
  // A hard rail either side of the standing value. Momentum is allowed to run
  // a pit to several times what it is worth and back, which is the whole point
  // of a momentum pit, but not to forty times: measured, a maker quoting small
  // in oil could leave the price at 39,000 against a standing value of 320,
  // and every reading on the board is unreadable after that.
  const span = m.anchorSpan || 5;
  setBand(m, i, g, Math.min(a * span, Math.max(a / span, next)), half);
}

function withHome(base) {
  return {
    name: base.name,
    fill(m, i, g, price) { base.fill(m, i, g, price); home(m, i, g); },
    miss(m, i, g) { base.miss(m, i, g); home(m, i, g); },
  };
}

export const PIT_BELIEFS = {
  adaptive: withHome(BELIEFS.adaptive),
  anchored: withHome(BELIEFS.anchored),
  momentum: withHome(BELIEFS.momentum),
};

// A SHARE OF THE CROWD WILL NOT WAIT.
//
// This is the difference between a pit and a limit book, and it is what a
// market maker is paid for. Left to itself the crowd only ever posts orders
// inside its own belief band and waits, so the two sides meet at a spread of
// nearly nothing and standing between them earns nothing: measured over five
// thousand ticks, a maker in that market loses money at every size. A pit is
// full of people who need the thing today and take the price that is on the
// board, and taking the price on the board is exactly what pays whoever wrote
// it.
//
// So a fraction of orders are written AT the other side's touch instead of
// inside the band. The fraction is a per-pit number, which is most of why one
// pit feels frantic and another feels patient. A maker who is priced at that
// touch is who they trade with; a maker standing back from it is not.
//
// IT WILL NOT WAIT, BUT IT WILL NOT BE ROBBED. An impatient order still has to
// be inside the agent's own band: a household that needs grain today pays up to
// what it thinks grain is worth and not one tick more. Without that test the
// crowd takes any price on the board, a maker is paid more the wider they
// quote, and the whole spread decision inverts - measured, a twenty-tick quote
// earned three times a four-tick one. With it, quoting wide means the crowd
// walks past you, which is what quoting wide should mean.
//
// A producer still will not sell under what its inputs cost: the floor the
// engine passes in is respected, because a taker that breaks its own floor
// trades itself out of business within a few hundred ticks.
function impatient(base) {
  return {
    name: base.name,
    price(m, i, g, side, role, floor) {
      if (m.impatience > 0 && m.r.next() < m.impatience) {
        const book = m.books[g];
        const touch = side === BUY ? book.bestAsk() : book.bestBid();
        const k = i * m.G + g;
        const worth = side === BUY ? touch <= m.bHi[k] : touch >= m.bLo[k];
        if (touch && Number.isFinite(touch) && worth) {
          const p = side === BUY ? touch : Math.max(floor, touch);
          if (p >= 1) return Math.round(p);
        }
      }
      return base.price(m, i, g, side, role, floor);
    },
    qty: base.qty,
  };
}

export const PIT_SIZING = {
  need: impatient(SIZING.need),
  flat: impatient(SIZING.flat),
  conviction: impatient(SIZING.conviction),
};

export default PIT_BELIEFS;
