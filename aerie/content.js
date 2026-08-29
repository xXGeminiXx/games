// ---------------------------------------------------------------------------
// Aerie - every sentence the player reads.
//
// The voice is a ship's officer keeping the deck log: short, dry, present
// tense, nothing cute. Placeholders in braces are filled by the game.
//
// The page carries no copy of its own. Any heading or static label in
// index.html names its string here with a data-t attribute and the interface
// fills it in, so a word is changed in one place and a test proves every name
// resolves.
// ---------------------------------------------------------------------------
export const CONTENT = {
  sections: {
    fleet: 'Fleet',
    specialists: 'Specialists',
    hold: 'Market',
    carrier: 'Carrier',
    voyage: 'Voyage',
    log: 'Deck log',
    view: 'View',
    keys: 'Keys',
  },

  labels: {
    funds: 'funds',
    drones: 'drones',
    shown: '{n} of them drawn',
    goods: 'goods',
    yield: 'gathered',
    price: 'price',
    ofBase: 'demand',
    where: '{kind} comes from {where}',
    hire: 'hire a drone',
    hireMany: 'hire {n} drones',
    buyHowMany: 'how many',
    target: 'frames a second',
    targetFree: 'as many as it can',
    bulkMax: 'max',
    hireWing: 'hire a wing of {n}',
    specialistMany: '{n} more drones trained to the {kind}.',
    specialist: 'train {kind} specialist',
    island: 'island {n}',
    richness: 'land remaining',
    castOff: 'cast off for island {n}',
    castOffHint: 'Leave this island for the next one, which is richer and pays more. The fleet and the carrier come with you. You cannot come back.',
    range: 'range',
    export: 'export save',
    import: 'import save',
    perf: 'performance log',
    reset: 'start over',
    resetConfirm: 'Start over? The island, the fleet and the funds are gone.',
    level: 'level {n}',
    maxed: 'at its limit',
    workedOut: 'No {kinds} left within reach. Specialists there earn nothing until the carrier moves.',
    workedOutOne: 'No {kind} left within reach. This trade earns nothing until the carrier moves.',
    offline: 'Away for {time}. The fleet brought in {funds}.',
    offlineCapped: 'The fleet worked {worked} of that, then held station with nobody aboard to send it out again.',
    quality: 'detail',
    rate: '{n} frames a second',
    rateAuto: '{n} frames a second, drawn at {pct}',
    fold: 'hide the panel',
    unfold: 'show the panel',
    keys: 'keys',
    closeKeys: 'close',
    keySep: ' or ',
    hint: 'W A S D to fly, drag to look, click the land to move the carrier, ? for keys',
    hintFolded: 'P brings the panel back',
  },

  // What each key does, in the player's words. The table itself lives in
  // config; this only names the rows. The flying keys are named for the
  // direction the player sees, because that is what they do: forward is away
  // from the camera whichever way the ship happens to be pointing.
  keyNames: {
    forward: 'fly forward',
    back: 'fly back',
    left: 'fly left',
    right: 'fly right',
    orbitLeft: 'turn the view left',
    orbitRight: 'turn the view right',
    pitchUp: 'raise the view',
    pitchDown: 'lower the view',
    zoomIn: 'zoom in',
    zoomOut: 'zoom out',
    recentre: 'frame the carrier again',
    hire: 'hire a drone',
    wing: 'hire a wing',
    upgrade1: 'work on the hold',
    upgrade2: 'work on the range',
    upgrade3: 'work on the drone engines',
    upgrade4: 'work on the hangars',
    panel: 'show or hide the panel',
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
    ship: 'Fleet and upgrades',
    page: 'The window',
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
    start: 'The carrier holds station over the island. {n} drones on the deck.',
    resume: 'The carrier is on station over island {n}. The drones are away.',
    contextLost: 'The instruments have gone dark. Your run is saved, and the view comes back on its own.',
    firstHire: 'A fourth drone. There is room for many more.',
    hire: 'Drone {n} launched.',
    hireMany: '{n} more drones launched. {total} on the books.',
    wing: 'A wing of {n} launched.',
    holdOpen: 'The hold is filling. Market prices are on the board.',
    specialistsOpen: 'Enough drones to train specialists, each to one trade.',
    specialist: 'A {kind} specialist trained. It will gather nothing else.',
    carrierOpen: 'The yard will take work on the carrier.',
    upgrade: 'Work on the {name} is finished. Level {n}.',
    priceLow: 'The market is flooded with {kind}. Demand is down to {pct}, and the price with it.',
    priceBack: 'Demand for {kind} has recovered.',
    voyageOpen: 'Charts for the next island are on the table.',
    castOff: 'Cast off. Island {n} lies ahead, and it is richer.',
    arrive: 'Land. The drones are away.',
    anchor: 'The carrier is moving to that point.',
    exported: 'Your save is in the box below. Copy it somewhere safe.',
    pasteSave: 'Paste a save into the box below, then press import save again.',
    badImport: 'That is not a save string.',
  },

  hints: {
    hire: 'more drones, more trips, more in the hold',
    specialist: 'turns one drone into a specialist in {kind}: it gathers {kind} at {x} times the rate, and nothing else',
    prices: 'Sell a lot of one good and demand for it falls, and the price with it. Demand comes back while you sell something else.',
    range: 'the drones work the land within this radius of the carrier',
    castOff: 'the next island holds {x} times as much and pays {y} times the price. This one is left behind for good',
    quality: 'how much of the picture is drawn. Auto follows what your machine can hold',
    perf: 'how the game has been running on this machine, kept here and sent nowhere',
  },
};

export function fill(s, vars = {}) {
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export default CONTENT;
