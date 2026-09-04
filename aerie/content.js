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
    voyage: 'Next island',
    log: 'Log',
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
    hireWing: 'hire {n} at once',
    specialist: 'train {kind} specialist',
    island: 'island {n}',
    richness: 'land remaining',
    castOff: 'leave for island {n}',
    castOffHint: 'Leave this island for the next one, which is richer and pays more. The fleet and the carrier come with you. You can\'t come back.',
    range: 'reach',
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
    offlineCapped: 'The fleet worked {worked} of that, then stopped, with nobody aboard to send it out again.',
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
    wing: 'hire ten drones',
    upgrade1: 'buy bigger loads',
    upgrade2: 'buy longer reach',
    upgrade3: 'buy faster drones',
    upgrade4: 'buy cheaper drones',
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
    view: 'Looking around',
    ship: 'Fleet and upgrades',
    page: 'Panels and keys',
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
    start: 'The carrier hangs over the island. {n} drones on the deck.',
    resume: 'The carrier is over island {n}. The drones are away.',
    contextLost: 'The picture stopped. Your run is saved and it comes back on its own.',
    firstHire: 'A fourth drone. There\'s room on the deck for many more.',
    hire: 'Drone {n} launched.',
    hireMany: '{n} more drones launched. {total} in the fleet.',
    wing: '{n} drones launched at once.',
    holdOpen: 'The drones are bringing back enough to sell. Prices are on the panel now.',
    specialistsOpen: 'Enough drones to train specialists, each to one trade.',
    specialist: 'A {kind} specialist trained. It gathers nothing else.',
    specialistMany: '{n} more drones trained to {kind}. They gather nothing else.',
    carrierOpen: 'You can start improving the carrier now.',
    upgrade: '{name} bought. Level {n}.',
    priceLow: 'The market is flooded with {kind}. Demand is down to {pct}, and the price with it.',
    priceBack: 'Demand for {kind} has recovered.',
    voyageOpen: 'You can leave for the next island now.',
    castOff: 'On the way to island {n}, and it\'s richer.',
    arrive: 'A new island. The drones are away.',
    anchor: 'The carrier is moving to that point.',
    drift: 'The land here is worked down, so the carrier is moving to better ground. Click anywhere to take it yourself.',
    exported: 'Your save is in the box below. Copy it somewhere safe.',
    pasteSave: 'Paste a save into the box below, then press import save again.',
    badImport: 'That isn\'t a save string.',
  },

  // The compass line at the corner of the picture: one sentence naming the
  // move worth making now, rebuilt from the ledger every second. The keys in
  // here are the keys src/advice.js can return, and a test holds the two
  // lists together.
  advice: {
    stranded: 'Your {kind} specialists have nothing left within reach. Click the land to move the carrier.',
    move: 'The ground under the carrier is worked down - the best left is {kind} at {pct}. Click fresh land and the carrier moves there.',
    flooded: 'The market has all the {kind} it wants and pays {pct}. {other} still pays {otherPct}, so train {other} specialists instead.',
    castOff: '{gone} of this island is worked out. Island {n} costs {cost} and holds {rich} times as much at {pay} times the price.',
    range: 'There\'s nowhere better to sit. Another {n} of reach costs {cost}, on top of the {reach} you have.',
    hangars: 'For {cost} every new drone gets cheaper, and one drone on its own costs {hire}. Buy that first.',
    buyDrone: 'A drone costs {cost} and adds {gain} a second. It pays for itself in {time}.',
    buySpecialist: 'A {kind} specialist costs {cost} and adds {gain} a second. It pays for itself in {time}.',
    buyUpgrade: '{name}: {cost}, and it adds {gain} a second. It pays for itself in {time}.',
    saveVoyage: '{gone} of this island is worked out. Leaving costs {cost} and you earn {rate} a second, so about {time}.',
    wait: 'Nothing\'s affordable yet. The next step is {what} at {cost}, about {time} at {rate} a second.',
    idle: 'The fleet is working and you\'re earning {rate} a second.',
  },

  hints: {
    hire: 'more drones, more trips, more brought back',
    specialist: 'turns one drone into a specialist in {kind}: it gathers {kind} at {x} times the rate, and nothing else',
    prices: 'Sell a lot of one good and demand for it falls, and the price with it. Demand comes back while you sell something else.',
    range: 'the drones work the land within this distance of the carrier',
    castOff: 'the next island holds {x} times as much and pays {y} times the price. This one is left behind for good',
    quality: 'how much of the picture is drawn. auto follows what your machine can keep up with',
    perf: 'how the game has been running on this machine, kept here and sent nowhere',
  },
};

export function fill(s, vars = {}) {
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export default CONTENT;
