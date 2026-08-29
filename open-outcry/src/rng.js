// Vendored from the game-art foundation (lib/rng.js) at commit 42c692f, 2026-08-29.
// This copy belongs to Open Outcry: fixes land in the foundation first, then are
// carried here by reading the diff, never by a blind overwrite.
// ---------------------------------------------------------------------------
// Seeded random numbers.
//
// The same seed gives the same sequence in every browser and in node, so a
// world can be rebuilt from one number, a save can carry its world as a seed
// instead of as data, and a test can pin an exact picture.
//
// sfc32 is the generator: 128 bits of state, passes PractRand, and it is a
// handful of integer operations, so it costs nothing next to Math.random.
// Seeds may be strings or numbers; xmur3 turns either into four 32-bit words.
// ---------------------------------------------------------------------------

// Hash a string into a function that yields successive 32-bit words.
export function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

// One 32-bit hash of an integer pair, for per-cell decisions that must not
// depend on the order things were asked in (a tree at (x, y) is always the
// same tree).
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// Same, as a float in [0, 1).
export function hash2f(x, y, seed = 0) {
  return hash2(x, y, seed) / 4294967296;
}

export function hash3(x, y, z, seed = 0) {
  return hash2(hash2(x, y, seed) | 0, z, seed ^ 0x9e3779b9);
}

export function hash3f(x, y, z, seed = 0) {
  return hash3(x, y, z, seed) / 4294967296;
}

// A generator object. Every method draws from the same stream, so the order
// of calls matters and is part of what the seed reproduces.
export function rng(seed = 'seed') {
  const words = xmur3(String(seed));
  let a = words(), b = words(), c = words(), d = words();

  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };

  // Warm up: the first few outputs of a freshly seeded sfc32 are correlated
  // with the seed words.
  for (let i = 0; i < 12; i++) next();

  const r = {
    seed,
    // [0, 1)
    next,
    // [min, max)
    float: (min = 0, max = 1) => min + (max - min) * next(),
    // integer in [min, max] inclusive
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    // weighted pick: weights is an array of non-negative numbers
    weighted: (arr, weights) => {
      let total = 0;
      for (const w of weights) total += w;
      let x = next() * total;
      for (let i = 0; i < arr.length; i++) {
        x -= weights[i];
        if (x < 0) return arr[i];
      }
      return arr[arr.length - 1];
    },
    // -1..1 triangle-ish, cheap "mostly small" jitter
    jitter: (amount = 1) => (next() + next() - 1) * amount,
    // standard normal via Box-Muller
    gauss: (mean = 0, sd = 1) => {
      const u = 1 - next();
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    // angle in radians
    angle: () => next() * Math.PI * 2,
    // unit vector in 2D
    dir2: () => {
      const t = next() * Math.PI * 2;
      return [Math.cos(t), Math.sin(t)];
    },
    // uniform point on the unit sphere
    dir3: () => {
      const z = next() * 2 - 1;
      const t = next() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      return [s * Math.cos(t), s * Math.sin(t), z];
    },
    // uniform point in the unit disc
    disc: () => {
      const t = next() * Math.PI * 2;
      const rr = Math.sqrt(next());
      return [rr * Math.cos(t), rr * Math.sin(t)];
    },
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
    // An independent stream derived from this seed and a label, so one part
    // of a world can be regenerated without replaying everything before it.
    fork: (label) => rng(`${seed}/${label}`),
  };
  return r;
}

export default rng;
