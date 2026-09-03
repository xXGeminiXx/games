// ---------------------------------------------------------------------------
// Swarm Breaker - leaderboard
//
// A run ends with a depth, a swarm, an essence total and a doctrine. This
// module is what turns those four numbers into something worth beating.
//
// THE POINT OF IT, SO IT DOES NOT GET BUILT INTO SOMETHING ELSE. The hook is
// asynchronous competition between people who know each other: a number gets
// posted, somebody who recognises the name tries to beat it, and neither of
// them ever has to be online at the same time or agree to anything in advance.
// Nothing here schedules, invites, matches, or requires two people to show up
// together. A board is a thing left behind, not an appointment.
//
// THREE LAYERS, AND EACH ONE WORKS ALONE
//
//   PERSONAL   Local, per tier, no server involved and none possible. Kept in
//              localStorage, ranked the same way every other board is ranked.
//              This layer is the default and it is complete on its own - a
//              clone of the repository with no backend anywhere still has a
//              leaderboard, still remembers the best run, still says whether
//              this one beat it.
//
//   CREW       A code shared once with people who know each other. Whoever
//              holds it reads and writes that board. No accounts, no invites,
//              no membership, nothing to administer - the code IS the board,
//              and it travels as one line pasted into a chat.
//
//   OPEN       The global board for a tier. Present because it should be, and
//              deliberately the least important of the three.
//
// WHAT LEAVES THE MACHINE, AND WHEN. Nothing, until a name is typed. Setting a
// name is the consent, and it is the only consent there is - with no name this
// module makes no request of any kind and the game plays exactly as it does
// now. A submission carries a name, four run numbers, a tier id and a doctrine
// id. There is no client id, no install id, no session id, no device or
// browser reporting, no timing beacon, no third party, and nothing that would
// need declaring anywhere. A persistent random identifier would make some of
// this code shorter and it is deliberately absent: identity here is the name
// somebody typed, and nothing else.
//
// FAIR PLAY. Runs are not verified, and no attempt is made to verify them. The
// project rules out anti-cheat and this module agrees with that rather than
// working around it - a browser game holds its whole state on the client, so
// verification is theatre with a maintenance cost, and every trick that catches
// a cheat also eventually accuses somebody honest. What is offered instead is
// an honest frame: personal bests cannot be gamed because there is nobody to
// impress; crew boards are small and named, where a fabricated depth is not a
// win but a thing that has to keep being explained; and a run may declare
// itself ASSISTED, which is carried, shown, and never penalised. There is no
// signature on the local board either. Signing a private diary would only
// discourage the one player it can reach, who is the owner of the file.
//
// FAILURE IS THE NORMAL CASE. No network, a worker that is down, a fork with no
// backend configured, a browser with storage disabled, a player who simply does
// not want to post: all five are ordinary, all five are handled, and in every
// one of them the game keeps working and this module keeps returning sensible
// values. No exported function throws. No exported function blocks - the only
// synchronous work is sorting a list a few dozen rows long, and every request
// runs in the background under a timeout while the game reads whatever the last
// good answer was.
//
// ---------------------------------------------------------------------------
// USE
//
//   import { createLeaderboard } from './src/leaderboard.js';
//
//   const boards = createLeaderboard({
//     endpoint: 'https://swarm-breaker-boards.example.workers.dev',
//     allowedHosts: ['xxgeminixx.github.io'],
//   });
//
//   // run over - local always, remote only if a name was set
//   const { local, remote } = boards.finish({
//     tier: 'swell', depth: S.depth, swarm: S.balls,
//     essence: S.gold, doctrine: 'legion', endless: false,
//   });
//   if (local.best) showBanner('best run yet');
//   remote.then(() => repaintBoard());
//
//   // painting, any frame, no awaiting
//   const standing = boards.standing('swell');
//   text.textContent = standing.text;
//
// Leaving `endpoint` empty is a supported configuration, not a broken one: the
// personal board is the whole feature and nothing tries to reach a server.
// ---------------------------------------------------------------------------


/** Bumped when the stored shape changes in a way old data cannot survive. */
// Verification. A board entry may carry a written down run and a signature
// over what it claims; other players replay it and post signed verdicts. None
// of this is required - a board with no logs at all still works exactly as it
// did, and every entry simply reads UNVERIFIED.
import { identity as deviceIdentity, verify as verifySignature } from './identity.js?v=19';
import { canonicalRun, canonicalWitness, logHash as logHashOf, entryState, STATE } from './verify.js?v=19';

const STORAGE_VERSION = 1;

const KEYS = {
  runs: 'swarmbreaker.board.runs',
  name: 'swarmbreaker.board.name',
  crew: 'swarmbreaker.board.crew',
  online: 'swarmbreaker.board.online',
  override: 'swarmbreaker.board.override',
};

const DEFAULTS = Object.freeze({
  /** Master switch. False makes the module local-only and inert. */
  enabled: true,

  /**
   * Worker origin, or a path if the worker sits behind the same domain. Empty
   * means no backend exists, which is a complete and supported setup.
   */
  endpoint: '',

  /**
   * Remote boards only run on hosts named here. A fork served from anywhere
   * else keeps its personal board and never calls the original's worker.
   */
  allowedHosts: ['localhost', '127.0.0.1'],
  allowAnyHost: false,

  /** Lets a self-hoster switch remote boards on without editing this file. */
  allowLocalOverride: true,
  overrideKey: KEYS.override,

  /**
   * Where a run lands if it arrives without a tier. Boards are scoped by tier
   * id and the ids belong to the game, not to this module - this is only the
   * fallback for a caller that forgot to name one, and it is a real tier on
   * purpose so a mistake cannot open a board no player will ever see.
   */
  defaultTier: 'swell',

  /** Rows asked for, rows kept locally, and how long a fetch stays fresh. */
  maxEntries: 10,
  localEntries: 10,
  maxNameLength: 18,
  cacheTtlMs: 30000,
  requestTimeoutMs: 6000,
});

/** Matches the game's own number formatting so a board reads like the HUD. */
const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/** Crew codes are minted by the worker; this only checks the shape of one. */
export const CREW_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;

const TIER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,23}$/;
const DOCTRINE_PATTERN = /^[a-z][a-z0-9_-]{0,15}$/;

const MAX_DEPTH = 1000000;
const MAX_LOG = 4096;


// ---------------------------------------------------------------------------
// MAGNITUDES
//
// Swarm size and essence are stored by the game as mantissa/exponent pairs and
// run past anything a double can hold. A board only ever needs to order them
// and print them, so both travel as a base-10 logarithm: one finite number,
// comparable, small on the wire, and immune to the whole class of bugs that
// starts with a count reaching 1e60.
//
// The encoding is log10(value + 1) rather than log10(value), for one reason: it
// keeps zero representable. Zero essence has to survive the round trip and read
// back as zero rather than as one. Above about 1e15 the correction stops
// mattering and the two are the same number.
// ---------------------------------------------------------------------------

/** Accepts a number, a numeric string, or a {m, e} magnitude. */
export function logOf(value) {
  const pair = toPair(value);
  if (!pair || pair.m <= 0) return 0;
  if (pair.e < 15) {
    const n = pair.m * Math.pow(10, pair.e);
    return clamp(Math.log10(n + 1), 0, MAX_LOG);
  }
  return clamp(Math.log10(pair.m) + pair.e, 0, MAX_LOG);
}

function toPair(value) {
  if (value == null) return null;
  if (typeof value === 'object') {
    const m = Number(value.m);
    const e = Number(value.e);
    if (!Number.isFinite(m) || !Number.isFinite(e)) return null;
    if (m <= 0) return { m: 0, e: 0 };
    // Normalise so the mantissa sits in [1, 10) whatever was handed over.
    const shift = Math.floor(Math.log10(m));
    return Number.isFinite(shift) ? { m: m / Math.pow(10, shift), e: e + shift } : { m, e };
  }
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return { m: 0, e: 0 };
  const e = Math.floor(Math.log10(n));
  return { m: n / Math.pow(10, e), e };
}

/**
 * Short display string for a logged magnitude: 0, 812, 1.24K, 8.03Qa, 3.11e57.
 * Deliberately the same shape the rest of the game prints numbers in.
 */
export function formatLog(log) {
  if (!Number.isFinite(log) || log <= 0) return '0';

  let e;
  let m;
  if (log < 15) {
    const n = Math.pow(10, log) - 1;
    if (n < 1) return '0';
    if (Math.round(n) < 1000) return String(Math.round(n));
    e = Math.floor(Math.log10(n));
    m = n / Math.pow(10, e);
  } else {
    e = Math.floor(log);
    m = Math.pow(10, log - e);
  }

  let i = Math.floor(e / 3);
  let v = m * Math.pow(10, e - i * 3);

  // Undoing the logarithm lands a hair under a round power of ten more often
  // than not, so a value that should print as 1.00T arrives as 999.9999B.
  // Carrying it into the next suffix is what keeps the board honest to the HUD.
  if (v >= 999.995 && i + 1 < SUFFIX.length) {
    i += 1;
    v /= 1000;
  }

  if (i < SUFFIX.length) {
    const s = v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : String(Math.round(v));
    return s + SUFFIX[i];
  }
  return m.toFixed(2) + 'e' + e;
}


// ---------------------------------------------------------------------------
// NAMES
// ---------------------------------------------------------------------------

/** One line of visible text, trimmed to length. Matches the worker exactly. */
export function sanitizeName(value, maxLength = DEFAULTS.maxNameLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(1, maxLength));
}

/** For callers that build a board with innerHTML rather than textContent. */
export function escapeName(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isCrewCode(value) {
  return typeof value === 'string' && CREW_PATTERN.test(value.trim().toUpperCase());
}


// ---------------------------------------------------------------------------
// ORDER
//
// Identical to the worker's, and it has to stay that way - a personal board and
// a crew board that disagreed about which of two runs was better would be worse
// than having no board at all. Depth decides; everything else breaks a tie, and
// the last tiebreak is arrival, so a record holds until it is actually beaten.
// ---------------------------------------------------------------------------

export function compareEntries(a, b) {
  if (a.depth !== b.depth) return b.depth - a.depth;
  if (a.swarmLog !== b.swarmLog) return b.swarmLog - a.swarmLog;
  if (a.essenceLog !== b.essenceLog) return b.essenceLog - a.essenceLog;
  return (a.at || 0) - (b.at || 0);
}

/** Turns whatever the game hands over into the one shape everything else uses. */
export function normalizeRun(run, maxNameLength, defaultTier) {
  const source = run && typeof run === 'object' ? run : {};
  return {
    tier: slug(source.tier, TIER_PATTERN, slug(defaultTier, TIER_PATTERN, DEFAULTS.defaultTier)),
    depth: clampInt(source.depth, 0, MAX_DEPTH, 0),
    swarmLog: round3(logOf(source.swarmLog != null ? fromLogInput(source.swarmLog) : source.swarm)),
    essenceLog: round3(logOf(source.essenceLog != null ? fromLogInput(source.essenceLog) : source.essence)),
    doctrine: slug(source.doctrine, DOCTRINE_PATTERN, 'none'),
    endless: Boolean(source.endless),
    assisted: Boolean(source.assisted),
    name: sanitizeName(source.name || '', maxNameLength || DEFAULTS.maxNameLength),
  };
}

// A caller that already holds a log can pass it straight through.
function fromLogInput(log) {
  const n = Number(log);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return { m: Math.pow(10, n - Math.floor(n)), e: Math.floor(n) };
}


// ---------------------------------------------------------------------------
// STORAGE
//
// Every read and write is guarded, and a browser that refuses storage falls
// back to a map that lives as long as the tab. Losing the personal board on
// reload is a worse day than not having one, but it is not a crash and the game
// never learns the difference.
// ---------------------------------------------------------------------------

function createStore() {
  let backing = null;
  try {
    const probe = '__swarmbreaker__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    backing = window.localStorage;
  } catch (err) {
    backing = null;
  }

  const memory = new Map();

  return {
    persistent: Boolean(backing),
    get(key) {
      try {
        return backing ? backing.getItem(key) : (memory.has(key) ? memory.get(key) : null);
      } catch (err) {
        return memory.has(key) ? memory.get(key) : null;
      }
    },
    set(key, value) {
      try {
        if (backing) backing.setItem(key, value);
        else memory.set(key, value);
        return true;
      } catch (err) {
        memory.set(key, value);
        return false;
      }
    },
    remove(key) {
      try {
        if (backing) backing.removeItem(key);
      } catch (err) {
        // nothing useful to do; the in-memory copy still goes
      }
      memory.delete(key);
    },
  };
}


// ---------------------------------------------------------------------------
// THE MODULE
// ---------------------------------------------------------------------------

export function createLeaderboard(config = {}) {
  const settings = resolveConfig(config);
  const store = createStore();

  /** Remote rows, per scope, as last seen. Read synchronously while painting. */
  const cache = new Map();     // scopeKey -> { entries, total, at, pending, error }
  const listeners = new Set();
  let lastError = null;

  const scopeKey = (tier, crew) => `${crew || 'open'}|${tier}`;

  // ONE KEY PER DEVICE, MADE ON DEMAND.
  //
  // It is created the first time a run is posted and never before, so a player
  // who never types a name never generates one. The player id is the hash of
  // its public key, which is what lets a board tell "the same person as last
  // week" from "somebody who typed the same name" without an account.
  let identityPromise = null;
  function device() {
    if (!identityPromise) {
      identityPromise = deviceIdentity({ appId: 'swarm-breaker' })
        .catch(() => null);   // no WebCrypto: the run posts unsigned and reads UNVERIFIED
    }
    return identityPromise;
  }

  function emit() {
    for (const fn of listeners) {
      try {
        fn();
      } catch (err) {
        // A listener that throws is the caller's problem, not the board's.
      }
    }
  }

  // --- identity and switches ----------------------------------------------

  function readName() {
    return sanitizeName(store.get(KEYS.name) || '', settings.maxNameLength);
  }

  function readCrew() {
    const raw = (store.get(KEYS.crew) || '').trim().toUpperCase();
    return CREW_PATTERN.test(raw) ? raw : '';
  }

  function readOnline() {
    const raw = store.get(KEYS.online);
    return raw == null ? true : raw === '1';
  }

  function hostAllowed() {
    if (settings.allowAnyHost) return true;
    if (settings.allowLocalOverride && overrideSet(store, settings.overrideKey)) return true;
    let host = '';
    try {
      host = window.location.hostname || '';
    } catch (err) {
      return false;
    }
    return settings.allowedHosts.some(allowed => {
      if (!allowed) return false;
      if (allowed === host) return true;
      return allowed.startsWith('*.') && host.endsWith(allowed.slice(1));
    });
  }

  /** True when a request could be made at all - before asking whether it should. */
  function configured() {
    return Boolean(settings.enabled && settings.endpoint && hostAllowed());
  }

  /**
   * The complete answer to "can this run be posted", with the reason attached
   * so a menu can say why the button is off instead of just disabling it.
   */
  function consent() {
    if (!settings.enabled) return { ok: false, reason: 'disabled' };
    if (!settings.endpoint) return { ok: false, reason: 'no-backend' };
    if (!hostAllowed()) return { ok: false, reason: 'host' };
    if (!readOnline()) return { ok: false, reason: 'offline' };
    if (!readName()) return { ok: false, reason: 'no-name' };
    return { ok: true, reason: 'ready' };
  }

  // --- the personal board --------------------------------------------------

  function loadLocal() {
    const fallback = { v: STORAGE_VERSION, tiers: {} };
    try {
      const raw = store.get(KEYS.runs);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || parsed.v !== STORAGE_VERSION) return fallback;
      if (!parsed.tiers || typeof parsed.tiers !== 'object') return fallback;
      return parsed;
    } catch (err) {
      return fallback;
    }
  }

  function saveLocal(state) {
    try {
      store.set(KEYS.runs, JSON.stringify(state));
      return true;
    } catch (err) {
      return false;
    }
  }

  function tierSlice(state, tier) {
    const slice = state.tiers[tier];
    if (!slice || typeof slice !== 'object') return { runs: 0, entries: [] };
    return {
      runs: clampInt(slice.runs, 0, 1e9, 0),
      entries: Array.isArray(slice.entries) ? slice.entries.filter(isEntry).sort(compareEntries) : [],
    };
  }

  /**
   * Files a finished run on the personal board. Local, synchronous, always
   * available, and the only part of this module the game actually needs.
   */
  function record(run) {
    return guard(() => {
      const normalized = normalizeRun(run, settings.maxNameLength, settings.defaultTier);
      if (normalized.depth <= 0) {
        return { ok: false, reason: 'no-depth', added: false, best: false, rank: null, runs: 0 };
      }

      const state = loadLocal();
      const slice = tierSlice(state, normalized.tier);
      const previous = slice.entries.length ? slice.entries[0] : null;

      const entry = {
        depth: normalized.depth,
        swarmLog: normalized.swarmLog,
        essenceLog: normalized.essenceLog,
        doctrine: normalized.doctrine,
        endless: normalized.endless,
        assisted: normalized.assisted,
        // A local run carries the same shape a remote row does, so the board
        // renderer is one piece of code rather than two that drift.
        build: run && run.build ? String(run.build).slice(0, 16) : '',
        runHash: run && /^[0-9a-f]{16}$/.test(run.runHash || '') ? run.runHash : '',
        hasLog: Boolean(run && run.hasLog),
        truncated: Boolean(run && run.truncated),
        witnesses: 0,
        mismatch: 0,
        at: Date.now(),
      };

      const entries = slice.entries.concat(entry).sort(compareEntries);
      const kept = entries.slice(0, settings.localEntries);
      const rankIndex = kept.indexOf(entry);

      state.tiers[normalized.tier] = { runs: slice.runs + 1, entries: kept };
      saveLocal(state);
      emit();

      return {
        ok: true,
        reason: 'recorded',
        tier: normalized.tier,
        entry,
        added: rankIndex >= 0,
        rank: rankIndex >= 0 ? rankIndex + 1 : null,
        best: !previous || compareEntries(entry, previous) < 0,
        previousDepth: previous ? previous.depth : 0,
        runs: slice.runs + 1,
      };
    }, { ok: false, reason: 'error', added: false, best: false, rank: null, runs: 0 });
  }

  function personal(tier, limit) {
    return guard(() => {
      const slice = tierSlice(loadLocal(), slug(tier, TIER_PATTERN, settings.defaultTier));
      return slice.entries.slice(0, limit == null ? settings.localEntries : Math.max(0, limit));
    }, []);
  }

  function best(tier) {
    const rows = personal(tier, 1);
    return rows.length ? rows[0] : null;
  }

  function runCount(tier) {
    return guard(() => tierSlice(loadLocal(), slug(tier, TIER_PATTERN, settings.defaultTier)).runs, 0);
  }

  function clearLocal(tier) {
    return guard(() => {
      const state = loadLocal();
      if (tier == null) state.tiers = {};
      else delete state.tiers[slug(tier, TIER_PATTERN, settings.defaultTier)];
      saveLocal(state);
      emit();
      return true;
    }, false);
  }

  // --- remote boards -------------------------------------------------------

  function board(tier, opts = {}) {
    return guard(() => {
      const key = scopeKey(slug(tier, TIER_PATTERN, settings.defaultTier), crewFor(opts));
      const held = cache.get(key);
      return held ? held.entries.slice(0, settings.maxEntries) : [];
    }, []);
  }

  function crewFor(opts) {
    if (opts && opts.crew === null) return '';
    if (opts && typeof opts.crew === 'string') {
      const code = opts.crew.trim().toUpperCase();
      return CREW_PATTERN.test(code) ? code : '';
    }
    return readCrew();
  }

  /**
   * Pulls a board in the background. Resolves to whatever is known afterwards -
   * fresh rows on success, the previous rows on failure, an empty list if there
   * has never been anything. It does not reject and it never leaves the caller
   * waiting longer than the configured timeout.
   */
  function refresh(tier, opts = {}) {
    return guardAsync(async () => {
      const tierId = slug(tier, TIER_PATTERN, settings.defaultTier);
      const crew = crewFor(opts);
      const key = scopeKey(tierId, crew);
      const held = cache.get(key) || { entries: [], total: 0, at: 0, pending: null, error: null };

      if (!configured() || !readOnline()) return held.entries.slice(0, settings.maxEntries);
      if (held.pending) return held.pending;
      if (!opts.force && held.at && Date.now() - held.at < settings.cacheTtlMs) {
        return held.entries.slice(0, settings.maxEntries);
      }

      const query = { tier: tierId, limit: String(settings.maxEntries) };
      if (crew) query.crew = crew;

      held.pending = (async () => {
        const result = await request('GET', '/api/board', null, query);
        if (result.ok && result.data && Array.isArray(result.data.entries)) {
          held.entries = result.data.entries.map(readEntry).filter(Boolean).sort(compareEntries);
          held.total = clampInt(result.data.total, 0, 1e6, held.entries.length);
          held.at = Date.now();
          held.error = null;
          lastError = null;
        } else {
          held.error = result.reason || 'error';
          lastError = held.error;
        }
        held.pending = null;
        cache.set(key, held);
        emit();
        return held.entries.slice(0, settings.maxEntries);
      })();

      cache.set(key, held);
      return held.pending;
    }, []);
  }

  /**
   * Posts a run. Requires a name, which is the only consent gate there is: with
   * no name set this returns immediately and no request is made.
   */
  function submit(run, opts = {}) {
    return guardAsync(async () => {
      const gate = consent();
      if (!gate.ok) return { ok: false, reason: gate.reason, rank: null };

      const normalized = normalizeRun(run, settings.maxNameLength, settings.defaultTier);
      if (normalized.depth <= 0) return { ok: false, reason: 'no-depth', rank: null };

      const name = readName();
      const crew = crewFor(opts);
      const payload = {
        name,
        tier: normalized.tier,
        depth: normalized.depth,
        swarmLog: normalized.swarmLog,
        essenceLog: normalized.essenceLog,
        doctrine: normalized.doctrine,
        endless: normalized.endless,
        assisted: normalized.assisted,
      };
      if (crew) payload.crew = crew;
      if (opts.daily) payload.daily = String(opts.daily);

      // THE CLAIM, IF THERE IS ONE.
      //
      // A run that wrote itself down posts the log, the hash it reached, and a
      // signature over both. Anything missing here is not an error: the run
      // posts as it always did and the board shows it as unchecked. A
      // truncated log is deliberately NOT signed as checkable - there is
      // nothing complete to replay.
      const claim = opts.claim;
      if (claim && claim.log && claim.runHash && !claim.log.truncated) {
        const id = await device();
        if (id) {
          const signed = {
            tier: normalized.tier,
            mode: claim.log.mode,
            seed: claim.log.seed,
            depth: normalized.depth,
            swarmLog: normalized.swarmLog,
            essenceLog: normalized.essenceLog,
            build: claim.build,
            playerId: id.playerId,
            runHash: claim.runHash,
            logHash: logHashOf(claim.log),
          };
          payload.build = claim.build;
          payload.playerId = id.playerId;
          payload.pubKey = id.publicKey;
          payload.runHash = claim.runHash;
          payload.logHash = signed.logHash;
          payload.mode = claim.log.mode;
          payload.seed = claim.log.seed;
          payload.log = claim.log;
          payload.sig = await id.sign(canonicalRun(signed));
        }
      }

      const result = await request('POST', '/api/board', payload);
      if (!result.ok) {
        lastError = result.reason;
        return { ok: false, reason: result.reason, rank: null };
      }

      // The response carries the updated board, so a submission never needs a
      // read behind it - the rows are already here.
      const data = result.data || {};
      if (Array.isArray(data.entries)) {
        const key = scopeKey(normalized.tier, crew);
        const held = cache.get(key) || { entries: [], total: 0, at: 0, pending: null, error: null };
        held.entries = data.entries.map(readEntry).filter(Boolean).sort(compareEntries);
        held.total = clampInt(data.total, 0, 1e6, held.entries.length);
        held.at = Date.now();
        held.error = null;
        cache.set(key, held);
      }

      lastError = null;
      emit();
      return {
        ok: true,
        reason: data.improved ? 'posted' : 'not-improved',
        tier: normalized.tier,
        crew: crew || null,
        ranked: Boolean(data.ranked),
        rank: Number.isFinite(data.rank) ? data.rank : null,
        improved: Boolean(data.improved),
      };
    }, { ok: false, reason: 'error', rank: null });
  }

  /**
   * Fetch one entry's written down run, so it can be replayed.
   * Answers null when there is nothing to replay, which is most rows.
   */
  function runLog(tier, opts = {}) {
    return guardAsync(async () => {
      if (!configured() || !readOnline()) return null;
      const query = { tier: slug(tier, TIER_PATTERN, settings.defaultTier), player: String(opts.playerId || '') };
      const crew = crewFor(opts);
      if (crew) query.crew = crew;
      const result = await request('GET', '/api/log', null, query);
      return (result.ok && result.data && result.data.log) ? result.data.log : null;
    }, null);
  }

  /**
   * Post a verdict about somebody else's run.
   *
   * A witness is a player whose browser replayed an entry and either reached
   * the same result or did not. Both verdicts are posted, because a board that
   * only ever hears agreement is not evidence of anything.
   *
   * NOBODY WITNESSES THEMSELVES. A run's own device is refused here rather
   * than at the Worker, so the pointless request is never made either.
   */
  function witness(tier, entry, verdict, opts = {}) {
    return guardAsync(async () => {
      if (!configured() || !readOnline()) return { ok: false, reason: 'offline' };
      if (!entry || !entry.playerId || !entry.runHash) return { ok: false, reason: 'nothing-to-witness' };
      if (verdict !== 'match' && verdict !== 'mismatch') return { ok: false, reason: 'bad-verdict' };
      const id = await device();
      if (!id) return { ok: false, reason: 'no-identity' };
      if (id.playerId === entry.playerId) return { ok: false, reason: 'own-run' };

      const crew = crewFor(opts);
      const signed = {
        tier: slug(tier, TIER_PATTERN, settings.defaultTier),
        crew: crew || '',
        entryId: entry.playerId,
        entryHash: entry.runHash,
        verdict,
        witnessId: id.playerId,
      };
      const body = { ...signed, pubKey: id.publicKey, sig: await id.sign(canonicalWitness(signed)) };
      const result = await request('POST', '/api/witness', body);
      if (!result.ok) return { ok: false, reason: result.reason };
      return { ok: true, counted: Boolean(result.data && result.data.counted), witnesses: result.data && result.data.witnesses };
    }, { ok: false, reason: 'error' });
  }

  /** This device's player id, or '' when it has none yet. */
  function playerId() {
    return guardAsync(async () => {
      const id = await device();
      return id ? id.playerId : '';
    }, '');
  }

  /**
   * The one call a game-over screen needs. The local half is done by the time
   * this returns; the remote half is a promise that always resolves and can be
   * ignored entirely.
   */
  function finish(run, opts = {}) {
    const local = record(run);
    const wanted = opts.submit !== false;
    const remote = wanted && local.ok
      ? submit(run, opts)
      : Promise.resolve({ ok: false, reason: wanted ? 'no-depth' : 'declined', rank: null });
    return { local, remote };
  }

  // --- the race ------------------------------------------------------------

  /**
   * Where this player sits, and who is directly in front of them. This is the
   * whole feature in one function: a name, a gap, and a number to beat.
   */
  function standing(tier, opts = {}) {
    return guard(() => {
      const tierId = slug(tier, TIER_PATTERN, settings.defaultTier);
      const crew = crewFor(opts);
      const rows = board(tierId, opts);
      const mine = readName().toLowerCase();
      const localBest = best(tierId);
      const full = rows.length >= settings.maxEntries;

      const index = mine ? rows.findIndex(row => row.name.toLowerCase() === mine) : -1;
      const you = index >= 0 ? rows[index] : null;
      const myDepth = you ? you.depth : (localBest ? localBest.depth : 0);

      let rival = null;
      if (index > 0) rival = rows[index - 1];
      else if (index < 0 && rows.length) rival = rows[rows.length - 1];

      const below = index >= 0 && index + 1 < rows.length ? rows[index + 1] : null;
      const gap = rival ? Math.max(0, rival.depth - myDepth) : 0;
      const lead = below ? Math.max(0, myDepth - below.depth) : 0;

      return {
        tier: tierId,
        crew: crew || null,
        rows,
        you,
        rank: index >= 0 ? index + 1 : null,
        rival,
        below,
        gap,
        lead,
        depth: myDepth,
        full,
        text: standingText({ rows, you, index, rival, below, gap, lead, myDepth, full, named: Boolean(mine) }),
      };
    }, {
      tier: settings.defaultTier, crew: null, rows: [], you: null, rank: null, rival: null,
      below: null, gap: 0, lead: 0, depth: 0, full: false, text: '',
    });
  }

  function standingText(s) {
    if (!s.rows.length) return 'nobody has posted here yet';
    if (!s.named) return `deepest posted: ${s.rows[0].name} at ${s.rows[0].depth}`;

    if (s.index === 0) {
      if (!s.below) return 'you hold it, alone';
      return s.lead > 0 ? `you hold it by ${s.lead}` : `you hold it, level with ${s.below.name}`;
    }

    if (s.index > 0 && s.rival) {
      if (s.gap === 0) return `level with ${s.rival.name} - go one deeper`;
      return `${s.rival.name} is ${s.gap} deeper`;
    }

    if (s.full && s.rival) {
      const need = Math.max(1, s.rival.depth - s.myDepth + 1);
      return s.myDepth > 0
        ? `${need} more to make the board`
        : `reach depth ${s.rival.depth + 1} to make the board`;
    }

    return 'post a run to take a place';
  }

  // --- crews ---------------------------------------------------------------

  function createCrew() {
    return guardAsync(async () => {
      if (!configured()) return { ok: false, reason: 'no-backend', crew: '' };
      if (!readOnline()) return { ok: false, reason: 'offline', crew: '' };

      const result = await request('POST', '/api/crew', {});
      if (!result.ok || !result.data || !isCrewCode(result.data.crew)) {
        lastError = result.reason || 'error';
        return { ok: false, reason: lastError, crew: '' };
      }

      const code = result.data.crew.toUpperCase();
      store.set(KEYS.crew, code);
      emit();
      return { ok: true, reason: 'created', crew: code };
    }, { ok: false, reason: 'error', crew: '' });
  }

  /**
   * Joins by code. The format is checked here; whether the crew exists is
   * checked against the worker when one is reachable, and taken on trust when
   * one is not - so a code pasted in on a plane still works when the plane
   * lands, rather than being rejected for being unverifiable.
   */
  function joinCrew(code, opts = {}) {
    return guardAsync(async () => {
      if (!isCrewCode(code)) return { ok: false, reason: 'bad-code', crew: '' };
      const normalized = code.trim().toUpperCase();

      if (!configured() || !readOnline() || opts.verify === false) {
        store.set(KEYS.crew, normalized);
        emit();
        return { ok: true, reason: 'saved', crew: normalized };
      }

      const tierId = slug(opts.tier, TIER_PATTERN, settings.defaultTier);
      const result = await request('GET', '/api/board', null, { tier: tierId, crew: normalized, limit: '1' });
      if (!result.ok && result.reason === 'crew-unknown') {
        return { ok: false, reason: 'crew-unknown', crew: '' };
      }

      store.set(KEYS.crew, normalized);
      emit();
      return { ok: true, reason: result.ok ? 'joined' : 'saved', crew: normalized };
    }, { ok: false, reason: 'error', crew: '' });
  }

  function leaveCrew() {
    return guard(() => {
      store.remove(KEYS.crew);
      emit();
      return true;
    }, false);
  }

  // --- requests ------------------------------------------------------------

  /**
   * The only place a request is made. Everything it can throw is caught here
   * and turned into a reason string, so no caller above this line has to know
   * that a network exists.
   */
  async function request(method, path, body, query) {
    try {
      const url = buildUrl(settings.endpoint, path, query);
      if (!url) return { ok: false, reason: 'no-backend' };

      const init = {
        method,
        credentials: 'omit',
        cache: 'no-store',
        mode: 'cors',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json' },
      };
      if (body != null) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }

      const response = await withTimeout(url, init, settings.requestTimeoutMs);
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const reason = data && typeof data.error === 'string' ? data.error : `http-${response.status}`;
        return { ok: false, reason, status: response.status, data };
      }
      return { ok: true, data };
    } catch (err) {
      const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
      return { ok: false, reason: aborted ? 'timeout' : 'network' };
    }
  }

  async function withTimeout(url, init, timeoutMs) {
    if (typeof AbortController === 'undefined') return fetch(url, init);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function ping() {
    return guardAsync(async () => {
      if (!configured()) return { ok: false, reason: 'no-backend' };
      const result = await request('GET', '/api/health');
      return result.ok ? { ok: true, reason: 'up', version: result.data && result.data.version }
        : { ok: false, reason: result.reason };
    }, { ok: false, reason: 'error' });
  }

  // --- the public surface --------------------------------------------------

  return {
    // identity and switches
    name: () => guard(readName, ''),
    setName(value) {
      return guard(() => {
        const clean = sanitizeName(value, settings.maxNameLength);
        if (clean) store.set(KEYS.name, clean);
        else store.remove(KEYS.name);
        emit();
        return clean;
      }, '');
    },
    clearName() {
      return guard(() => { store.remove(KEYS.name); emit(); return true; }, false);
    },
    online: () => guard(readOnline, false),
    setOnline(value) {
      return guard(() => { store.set(KEYS.online, value ? '1' : '0'); emit(); return Boolean(value); }, false);
    },
    configured,
    consent,
    // verification
    runLog,
    witness,
    playerId,
    entryState,
    STATE,
    status() {
      return guard(() => {
        const gate = consent();
        return {
          enabled: settings.enabled,
          configured: configured(),
          online: readOnline(),
          canSubmit: gate.ok,
          reason: gate.reason,
          name: readName(),
          crew: readCrew(),
          persistent: store.persistent,
          endpoint: settings.endpoint,
          defaultTier: settings.defaultTier,
          maxNameLength: settings.maxNameLength,
          maxEntries: settings.maxEntries,
          lastError,
        };
      }, {
        enabled: false, configured: false, online: false, canSubmit: false,
        reason: 'error', name: '', crew: '', persistent: false, endpoint: '',
        maxNameLength: DEFAULTS.maxNameLength, maxEntries: DEFAULTS.maxEntries, lastError: 'error',
      });
    },

    // the personal board
    record,
    personal,
    best,
    runCount,
    clearLocal,

    // remote boards
    board,
    refresh,
    submit,
    finish,
    standing,
    ping,

    // crews
    crew: () => guard(readCrew, ''),
    createCrew,
    joinCrew,
    leaveCrew,

    // painting
    onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Removes every trace this module has kept, on request, immediately. */
    forget() {
      return guard(() => {
        Object.keys(KEYS).forEach(key => store.remove(KEYS[key]));
        cache.clear();
        lastError = null;
        emit();
        return true;
      }, false);
    },

    // formatting, so a caller does not have to import the helpers separately
    format: {
      count: formatLog,
      name: escapeName,
      entry(entry) {
        if (!entry) return '';
        const mark = entry.assisted ? ' *' : '';
        const deep = entry.endless ? '+' : '';
        return `${entry.depth}${deep} - ${formatLog(entry.swarmLog)} swarm - ${entry.doctrine}${mark}`;
      },
    },
  };
}


// ---------------------------------------------------------------------------
// CONFIG
//
// Three sources, each overriding the last: the defaults, whatever the game
// passes in, and a window global. The global exists so a fork can point the
// game at its own worker without editing a file that will be overwritten by the
// next pull.
// ---------------------------------------------------------------------------

function resolveConfig(config) {
  const overrides = readWindowOverrides();
  const merged = { ...DEFAULTS, ...(config || {}), ...(overrides || {}) };

  return {
    enabled: merged.enabled !== false,
    endpoint: typeof merged.endpoint === 'string' ? merged.endpoint.trim().replace(/\/+$/, '') : '',
    allowedHosts: Array.isArray(merged.allowedHosts) ? merged.allowedHosts.filter(h => typeof h === 'string') : [],
    allowAnyHost: Boolean(merged.allowAnyHost),
    defaultTier: slug(merged.defaultTier, TIER_PATTERN, DEFAULTS.defaultTier),
    allowLocalOverride: merged.allowLocalOverride !== false,
    overrideKey: typeof merged.overrideKey === 'string' ? merged.overrideKey : KEYS.override,
    maxEntries: clampInt(merged.maxEntries, 1, 50, DEFAULTS.maxEntries),
    localEntries: clampInt(merged.localEntries, 1, 50, DEFAULTS.localEntries),
    maxNameLength: clampInt(merged.maxNameLength, 1, 40, DEFAULTS.maxNameLength),
    cacheTtlMs: clampInt(merged.cacheTtlMs, 0, 600000, DEFAULTS.cacheTtlMs),
    requestTimeoutMs: clampInt(merged.requestTimeoutMs, 250, 30000, DEFAULTS.requestTimeoutMs),
  };
}

function readWindowOverrides() {
  try {
    const value = window.SWARM_BREAKER_LEADERBOARD;
    return value && typeof value === 'object' ? value : null;
  } catch (err) {
    return null;
  }
}

function overrideSet(store, key) {
  if (!key) return false;
  const value = store.get(key);
  return value === '1' || (typeof value === 'string' && value.toLowerCase() === 'true');
}

function buildUrl(endpoint, path, query) {
  if (!endpoint) return '';
  try {
    const base = /^https?:\/\//i.test(endpoint)
      ? endpoint
      : new URL(endpoint, window.location.origin).toString().replace(/\/+$/, '');
    const url = new URL(base + path);
    if (query) {
      Object.keys(query).forEach(key => {
        if (query[key] != null) url.searchParams.set(key, String(query[key]));
      });
    }
    return url.toString();
  } catch (err) {
    return '';
  }
}


// ---------------------------------------------------------------------------
// SMALL HELPERS
//
// guard and guardAsync are the reason no exported function throws. Every public
// entry point runs inside one, so a broken storage backend, a browser that has
// removed an API, or a bug in this file costs the caller a fallback value and
// nothing else.
// ---------------------------------------------------------------------------

function guard(fn, fallback) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

function guardAsync(fn, fallback) {
  try {
    return Promise.resolve(fn()).catch(() => fallback);
  } catch (err) {
    return Promise.resolve(fallback);
  }
}

function readEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = sanitizeName(raw.name || '', DEFAULTS.maxNameLength);
  if (!name) return null;
  return {
    name,
    depth: clampInt(raw.depth, 0, MAX_DEPTH, 0),
    swarmLog: round3(clampFloat(raw.swarmLog, 0, MAX_LOG, 0)),
    essenceLog: round3(clampFloat(raw.essenceLog, 0, MAX_LOG, 0)),
    doctrine: slug(raw.doctrine, DOCTRINE_PATTERN, 'none'),
    endless: Boolean(raw.endless),
    assisted: Boolean(raw.assisted),
    at: clampInt(raw.at, 0, Number.MAX_SAFE_INTEGER, 0),
    // The verification half. A board that has never seen a log answers zeros
    // here and every row reads UNVERIFIED, which is what it was before any of
    // this existed.
    build: typeof raw.build === 'string' ? raw.build.slice(0, 16) : '',
    runHash: /^[0-9a-f]{16}$/.test(raw.runHash) ? raw.runHash : '',
    playerId: typeof raw.playerId === 'string' && raw.playerId.length === 43 ? raw.playerId : '',
    hasLog: Boolean(raw.hasLog),
    truncated: Boolean(raw.truncated),
    witnesses: clampInt(raw.witnesses, 0, 1e6, 0),
    mismatch: clampInt(raw.mismatch, 0, 1e6, 0),
  };
}

function isEntry(entry) {
  return Boolean(entry) && typeof entry === 'object' && Number.isFinite(entry.depth) && entry.depth > 0;
}

function slug(value, pattern, fallback) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.trim().toLowerCase();
  return pattern.test(cleaned) ? cleaned : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return clamp(Number.isFinite(n) ? Math.floor(n) : fallback, min, max);
}

function clampFloat(value, min, max, fallback) {
  const n = Number(value);
  return clamp(Number.isFinite(n) ? n : fallback, min, max);
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}


export default createLeaderboard;
