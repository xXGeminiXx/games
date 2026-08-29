// ---------------------------------------------------------------------------
// Aerie - every sentence the player reads.
//
// The voice is a ship's officer keeping the deck log: short, dry, present
// tense, nothing cute. Placeholders in braces are filled by the game.
// ---------------------------------------------------------------------------
export const CONTENT = {
  sections: {
    fleet: 'Fleet',
    hold: 'Hold',
    carrier: 'Carrier',
    voyage: 'Voyage',
    log: 'Deck log',
    view: 'View',
    keys: 'Keys',
  },

  labels: {
    funds: 'funds',
    drones: 'drones',
    working: 'working',
    yield: 'per second',
    price: 'price',
    ofBase: 'of base',
    hire: 'hire a drone',
    hireWing: 'hire a wing of {n}',
    specialist: 'train {kind} specialist',
    specialists: 'specialists',
    generalists: 'generalists',
    island: 'island {n}',
    richness: 'land remaining',
    castOff: 'cast off',
    castOffHint: 'leave this island for a richer one. Drones and upgrades come along.',
    anchor: 'click the land to move the carrier',
    range: 'range',
    export: 'export save',
    import: 'import save',
    reset: 'start over',
    resetConfirm: 'Start over? The island, the fleet and the funds are gone.',
    level: 'level {n}',
    maxed: 'at its limit',
    offline: 'While you were away ({time}): {funds} earned.',
    quality: 'detail',
    rate: '{n} frames a second',
    quality_auto: 'auto',
    fold: 'hide the table',
    unfold: 'show the table',
    keys: 'keys',
    closeKeys: 'close',
    hint: 'W A S D to fly, drag to look, click the land to move the carrier, ? for keys',
    hintFolded: 'P brings the table back',
  },

  // What each key does, in the player's words. The table itself lives in
  // config; this only names the rows.
  keyNames: {
    forward: 'fly ahead',
    back: 'fly astern',
    left: 'fly to port',
    right: 'fly to starboard',
    orbitLeft: 'turn the view left',
    orbitRight: 'turn the view right',
    pitchUp: 'raise the view',
    pitchDown: 'lower the view',
    zoomIn: 'closer',
    zoomOut: 'further off',
    recentre: 'frame the carrier again',
    hire: 'hire a drone',
    wing: 'hire a wing',
    upgrade1: 'work on the hold',
    upgrade2: 'work on the range',
    upgrade3: 'work on the engines',
    upgrade4: 'work on the hangars',
    panel: 'show or hide the table',
    help: 'show or hide this list',
    close: 'close this list',
  },

  keyGroups: {
    flying: ['forward', 'back', 'left', 'right'],
    view: ['orbitLeft', 'orbitRight', 'pitchUp', 'pitchDown', 'zoomIn', 'zoomOut', 'recentre'],
    ship: ['hire', 'wing', 'upgrade1', 'upgrade2', 'upgrade3', 'upgrade4'],
    page: ['panel', 'help', 'close'],
  },

  keyGroupNames: {
    flying: 'Flying the carrier',
    view: 'The view',
    ship: 'The ship',
    page: 'The page',
  },

  // How a key is printed. Anything not named here is printed as itself, in
  // capitals.
  keyLabels: {
    arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
    escape: 'Esc', ' ': 'Space',
  },

  kinds: {
    timber: 'timber', fish: 'fish', ore: 'ore', ice: 'ice',
  },

  log: {
    start: 'The carrier holds station over the island. Three drones on the deck.',
    firstHire: 'A fourth drone. The deck is not large.',
    hire: 'Drone {n} launched.',
    wing: 'A wing of {n} launched.',
    holdOpen: 'The hold is filling. Prices are on the board.',
    specialistsOpen: 'Enough drones to train some for one trade.',
    specialist: 'A {kind} specialist trained. It will gather nothing else.',
    carrierOpen: 'The yard will take work on the carrier.',
    upgrade: '{name} to level {n}.',
    priceLow: 'The {kind} price is down to {pct} of base. The market is flooded.',
    priceBack: 'The {kind} price has recovered.',
    stripped: 'The land within range is worked thin.',
    voyageOpen: 'Charts for the next island are on the table.',
    castOff: 'Cast off. Island {n} lies ahead, and it is richer.',
    arrive: 'Land. The drones are away.',
    anchor: 'Carrier moving to the new anchor.',
    depleted: 'The island is worked out. Time to move on.',
    saved: 'Saved.',
    imported: 'Save loaded.',
    badImport: 'That is not a save string.',
  },

  hints: {
    hire: 'more drones, more trips, more in the hold',
    specialist: 'gathers its kind at {x} times the rate',
    prices: 'selling floods a market; prices fall with volume and recover with time',
    range: 'drones work the land within this radius of the carrier',
    castOff: 'the next island is {x} times as rich and pays {y} times the price',
    quality: 'how much of the picture is drawn; auto follows what your machine can hold',
    fold: 'fold the table away and see the whole world',
    perf: 'how the game has been running on this machine, kept here and sent nowhere',
  },
};

export function fill(s, vars = {}) {
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export default CONTENT;
