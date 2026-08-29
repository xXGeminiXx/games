// Number formatting for a game whose numbers do not stop.
//
// Under a thousand: as written. Then K, M, B, T and the standard short
// scale to decillion. Past that, scientific with two decimals. One system,
// stated once, never mixed.
const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

export function fmt(n, digits = 2) {
  if (!Number.isFinite(n)) return '0';
  const neg = n < 0;
  n = Math.abs(n);
  let s;
  if (n < 1000) s = n < 10 ? n.toFixed(n === Math.floor(n) ? 0 : 1) : Math.floor(n).toString();
  else {
    const e = Math.floor(Math.log10(n) / 3);
    if (e < SUFFIX.length) {
      const v = n / Math.pow(1000, e);
      s = v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : digits) + SUFFIX[e];
    } else {
      s = n.toExponential(2).replace('e+', 'e');
    }
  }
  return neg ? '-' + s : s;
}

// A rate: fmt plus /s.
export const rate = (n) => fmt(n) + '/s';

// Whole numbers with thin separators up to a million, then fmt.
export function count(n) {
  n = Math.floor(n);
  if (n < 1e6) return n.toLocaleString('en-US');
  return fmt(n);
}

export function pct(x, digits = 0) {
  return (x * 100).toFixed(digits) + '%';
}

// Seconds to a short duration: 4s, 2m 10s, 3h 5m, 2d 4h.
export function duration(s) {
  s = Math.max(0, Math.floor(s));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), sec = s % 60;
  if (m < 60) return m + 'm ' + sec + 's';
  const h = Math.floor(m / 60), min = m % 60;
  if (h < 24) return h + 'h ' + min + 'm';
  const d = Math.floor(h / 24);
  return d + 'd ' + (h % 24) + 'h';
}
