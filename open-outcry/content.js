// ---------------------------------------------------------------------------
// Open Outcry - every sentence the player reads.
//
// Read each line out loud. If a person would not say it to a friend who just
// sat down, it does not ship.
//
// No trading words. A player who has never bought a share should follow every
// line here on the first read: you pay a price, you charge a price, you keep
// the gap. Everything the market does is said in those terms and no others.
//
// Anything in braces is filled by the game. Pools are picked from with the
// run's seeded generator, so a line varies without ever varying what it means.
//
// The page carries no copy of its own. Every heading and static label in
// index.html names its string here with a data-t attribute and the interface
// fills it in, so a word is changed in one place and a test proves every name
// resolves to something.
// ---------------------------------------------------------------------------

export const CONTENT = {
  sections: {
    board: 'Your board',
    buy: 'Spend your money',
    clerks: 'Your clerks',
    markets: 'Other markets',
    corner: 'Buy the lot',
    city: 'Move on',
    log: 'What just happened',
    save: 'Your run',
    keys: 'Keys',
  },

  labels: {
    purse: 'purse',
    pay: 'you pay',
    charge: 'you charge',
    payShort: 'pay',        // on a narrow board, where the whole phrase will not fit
    chargeShort: 'charge',
    cut: 'your cut',
    atOnce: 'at a time',
    rate: 'going rate',
    each: 'a sack',

    holdingNone: 'You have nothing on hand.',
    holding: 'You have {n} sacks on hand.',
    holdingLots: "You have {n} sacks on hand. That's a lot to be sitting on if the price drops.",
    owing: 'You owe {n} sacks.',
    owingLots: "You owe {n} sacks. That's a lot to owe if the price climbs.",
    crowd: '{n} here today',
    buyers: 'buyers',
    sellers: 'sellers',

    wipe: 'Wipe and write it again',
    wipeHint: 'Puts both your prices back either side of the going rate. Space.',
    dump: 'Sell what you have',
    dumpHint: "Sells every sack you're holding right now, for whatever it fetches.",
    stop: 'Take your board down',
    stopHint: 'Nobody can trade with you until you put it back up.',
    start: 'Put your board back up',

    // How far the market has walked away from what is written on the board.
    freshOn: 'Your board is on the price.',
    freshDrift: 'The price is drifting off your board.',
    freshStale: 'The price has left your board. Wipe it.',
    freshHigh: 'The price is over what you charge. Wipe it.',
    freshLow: 'The price is under what you pay. Wipe it.',
    freshDown: 'Your board is down. Nobody can trade with you.',

    owned: 'you have {n}',
    buyFor: 'Buy {n} for {cost}',
    needs: 'needs {n} more',
    openMarket: 'Open the {pit} market',
    marketCost: 'costs {n}',

    sizeName: 'Bigger loads',
    sizeWhat: 'Handle {n} sacks at a time instead of {was}.',
    clerkName: 'Hire a clerk',
    clerkWhat: "Somebody to watch a board while you're at another one.",
    clerkSlots: '{used} of {n} clerks have a board.',
    clerkIdle: 'Waiting for a board to watch. Open another market.',
    
    seatName: 'A slice of every trade',
    seatWhat: "Takes a cut of every trade in this market, even the ones you're not in.",
    seatPaid: "It's paid you {n} so far.",
    runnerName: 'Hire a runner',
    runnerWhat: 'News reaches you {n} seconds before it reaches the market.',
    runnerNone: 'You hear the news when everybody else does.',

    cornerCall: 'Buy the lot',
    cornerNeed: 'You need half the {pit} in this market. You have {have} of it.',
    cornerHold: 'Hold it a while longer.',
    cornerPays: 'Pays about {funds} and makes your name worth {rep} more.',
    cornerLast: 'This is your only market. Open another one first.',

    cityGo: 'Take the road to {city}',
    cityNeed: 'Buy up {n} more markets here first.',
    cityRep: 'Your name is worth {n} in the next town.',
    cityHave: 'bought {n}',
    reputation: 'of your name',

    exportSave: 'Copy the run out',
    importDo: 'Load it',
    reset: 'Start over',
    resetConfirm: 'Start over? Your money, your markets and your clerks all go.',
    copied: 'Copied.',
    importBad: "That's not a run: {why}",
    fold: 'Hide this',
    unfold: 'Show the panel',
    keys: 'Keys',
    closeKeys: 'Close',
    hint: 'Space wipes the board. 1 to 6 pick a market.',
    away: 'You were away {away}. {counted} of it counted.',
    awayRan: 'The market kept trading. You made {funds}.',
    awayNothing: 'The market kept trading and you made nothing.',

    // The one line that says what to do next. Only ever one is shown.
    nextFirstFill: 'Somebody will take one of your prices in a moment. Watch the purse.',
    nextWipe: 'When the going rate walks away from your board, wipe it and write it again.',
    nextBuySize: 'Save up {n} to handle more sacks at a time.',
    nextBuySizeNow: 'Buy bigger loads for {n}. Every trade pays more.',
    nextBuyClerk: 'Save up {n} for a clerk, and you can work two markets at once.',
    nextBuyClerkNow: 'Hire a clerk for {n} and you can work two markets at once.',
    nextOpenPit: 'Save up {n} to open the {pit} market.',
    nextOpenPitNow: 'Open the {pit} market for {n}.',
    nextCorner: 'You hold {have} of the {pit} here. Get to half and you can buy the lot.',
    nextCity: 'Buy up {n} more markets here and the next town will seat you.',
    nextNone: 'Keep the board fresh and the purse fills.',
  },

  keys: [
    ['Space', 'wipe the board and write it again'],
    ['S', 'sell what you have'],
    ['X', 'take the board down, or put it back up'],
    ['1 - 6', 'go to one of your markets'],
    ['[ ]', 'a smaller or bigger cut'],
    ['- =', 'fewer or more sacks at a time'],
    ['P', 'hide the panel'],
    ['?', 'this list'],
  ],

  // The line under the going rate. Chosen by what the market actually did.
  why: {
    quiet: ['nobody is trading', 'the market is quiet', 'no sacks are moving'],
    upBuyers: ["everybody wants to buy, so it's going up", "they're all buying it up"],
    downSellers: ["everybody is selling, so it's going down", "they're all dumping it"],
    flatBoth: ['buying and selling, about even', 'trade is even both ways'],
    thin: ['nobody is naming a price', 'nobody will say what they want for it'],
  },

  fills: {
    bought: 'you bought {qty} at {price} a sack',
    sold: 'you sold {qty} at {price} a sack',
    both: 'you bought and sold {qty} at {price} a sack',
  },

  events: {
    stopped: 'you took your board down',
    started: 'your board is back up',
    dumped: 'you sold {qty} at {price} a sack',
    dumpedNothing: 'you had nothing to sell',
    wiped: 'you wrote {bid} and {ask}',
    crowdGrew: '{n} more came in',
    clerkHired: '{name} takes the {pit} board',
    seatUp: 'your slice of every trade here just got bigger',
    marketOpened: 'the {pit} market opens',
    marketCornered: 'you bought up the {pit} market. {funds}, and your name is worth {rep} more.',
    runnerHired: 'a runner takes the road. {lead} seconds of warning.',
    rumour: 'a runner brings word: {text}',
    shockHit: '{text}',
    cityLeft: 'the road to {city}. your name is worth {n} there.',
    citySpent: '{label}, {n} spent',
  },

  // What a runner brings in, and what it reads like when it lands. The two
  // describe the same event: first the word of it, then the thing itself.
  rumours: {
    harvest: { news: 'a big harvest is on its way here', land: 'the harvest lands. There is {pit} everywhere', dir: 'down' },
    drought: { news: 'the crop has failed where the {pit} comes from', land: 'the failed crop bites. {pit} is short', dir: 'up' },
    fire: { news: 'a fire in the {pit} stores', land: 'the {pit} stores are gone', dir: 'up' },
    war: { news: 'soldiers are buying {pit} by the wagon', land: 'the soldiers are here, buying {pit}', dir: 'up' },
    road: { news: 'a new road reaches the {pit} country', land: 'the road is open. {pit} comes in cheaper', dir: 'down' },
  },

  // One line per market. It says how the crowd behaves, which is the only
  // thing that changes between them.
  pits: {
    grain:  'Steady. The crowd finds a price and stays near it.',
    salt:   'Slow to believe news. Hear it first and you have time to act.',
    timber: 'Orders arrive in big lumps. One of them moves the price further than you expect.',
    iron:   'It runs. A high price makes them expect a higher one.',
    cloth:  'Sits still for a long time, then jumps hard.',
    oil:    'Never settles. Leave your board up for ten seconds and it gets run over.',
  },

  // Clerks are people. A hired clerk arrives already doing one job, said in
  // one line, and the job is the same rule the composer would build by hand.
  clerkNames: ['Nell', 'Tom', 'Bess', 'Hal', 'Meg', 'Wat', 'Joan', 'Sim'],
  clerkJobs: {
    follow: 'wipes the board and writes it again when the price walks off',
    dump: 'sells what you are holding when you are carrying too much',
    widen: 'takes a bigger cut when the market turns rough',
    duck: 'takes the board down when news lands, and puts it back after',
  },

  // The sensors and actions the composer offers, for a player who opens it.
  sensors: {
    mid: 'the going rate',
    stale: 'how far the price has left your board',
    drift: 'which way the price has left your board',
    spread: 'the gap between the best two prices out there',
    position: 'how many sacks you are holding',
    cash: 'the money behind your board',
    volume: 'sacks traded last tick',
    flow: 'which way the crowd is going',
    disagreement: 'how far apart the crowd is',
    rumour: 'a runner has news',
  },
  actions: {
    requote: 'wipe the board and write it again',
    resize: 'change how many at a time',
    widen: 'take a bigger cut',
    narrow: 'take a smaller cut',
    lean: 'lean both prices one way',
    cut: 'sell some of what you hold',
    pull: 'take the board down',
    push: 'put the board back up',
  },
  clerkCards: {
    firstName: 'follow the price',
    firstWhy: 'Wipes your board and writes it again when the price walks off it. Hire one and you stop pressing space.',
  },

  cities: ['Two Rivers', 'Saltmarsh', 'Longbarrow', 'Kettle', 'Ninefold', 'Greenway', 'Harrow', 'Stonemouth', 'Wintergate', 'Alderfen'],

  intro: {
    title: 'You have the only board',
    lead: 'Everybody here buys and sells grain. You are the one with a board on the wall, so they all have to deal with you.',
    // The first line is filled from the board behind this sheet, so it reads
    // the two prices the player is about to be looking at rather than a pair
    // of numbers made up for an example.
    steps: [
      'Your board says you pay {bid} for a sack and you charge {ask} for one. You keep the {cut}.',
      'The crowd moves the price all day. When it walks away from your board, wipe it and write it again.',
      "That's the whole game. Everything else is buying yourself more of it.",
    ],
    go: 'Take the board',
  },
};

// Replace {name} with values. A placeholder with nothing to fill it is left
// alone rather than blanked, so a missing value is visible instead of silent.
export function fill(text, values = {}) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
}

// Pick from a pool with the run's generator. The pools vary the words, never
// the meaning, so which one comes out cannot change what the player learns.
export function pick(pool, r) {
  if (!Array.isArray(pool) || pool.length === 0) return '';
  return pool[Math.floor((r ? r.next() : 0) * pool.length) % pool.length];
}

export default CONTENT;
