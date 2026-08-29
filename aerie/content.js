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
  },
};

export function fill(s, vars = {}) {
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export default CONTENT;
