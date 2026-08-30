// ---------------------------------------------------------------------------
// Open Outcry - every sentence the player reads.
//
// The voice is pit-terse: what someone standing at the rail would actually
// say, present tense, short, never congratulating and never explaining twice.
// Lowercase on the slate, because that is a hand writing on a wall; sentence
// case in the panel, because that is a note somebody wrote down.
//
// Anything in braces is filled by the game. Pools are picked from with the
// run's seeded generator, so a line varies without ever varying what it means:
// two sentences for one state must imply the same cause.
//
// The page carries no copy of its own. Every heading and static label in
// index.html names its string here with a data-t attribute and the interface
// fills it in, so a word is changed in one place and a test proves every name
// resolves to something.
// ---------------------------------------------------------------------------

export const CONTENT = {
  sections: {
    pits: 'Pits',
    quote: 'Your quote',
    ladder: 'Price ladder',
    clerks: 'Clerks',
    seat: 'Your seat',
    runners: 'Runners',
    corner: 'Corner a pit',
    city: 'Next city',
    log: 'Floor log',
    save: 'Your run',
    keys: 'Keys',
  },

  labels: {
    funds: 'funds',
    take: 'take',
    bid: 'bid',
    offer: 'offer',
    size: 'size',
    spread: 'spread',
    position: 'position',
    crowd: 'crowd',
    share: 'your share',
    requote: 'Requote',
    requoteHint: 'Both sides back around the mid, at your spread. R.',
    pull: 'Pull',
    pullHint: 'Take both sides off the board. Nothing of yours can fill.',
    push: 'Push',
    flatten: 'Flatten',
    flattenHint: 'Sell what you\'re carrying into the bid, now, at whatever it pays.',
    owned: 'you have {n}',
    openPit: 'Open the {pit} pit',
    clerkSlots: '{used} of {n} clerks working',
    seatNow: '{bps} basis points of every trade in this pit',
    seatTaken: 'the seat has paid {n}',
    runnerLead: '{n} ticks of warning',
    runnerNone: 'No runners. News reaches you when it reaches the pit.',
    cornerCall: 'Call the corner',
    cornerNeed: 'Hold {pct} of the float to call it. You hold {have}.',
    cornerPays: 'Pays about {funds} and {rep} reputation.',
    cityGo: 'Take the road to {city}',
    cityNeed: 'Corner a pit first. The next city won\'t seat a trader nobody has heard of.',
    cityRep: '{n} reputation to spend',
    cityHave: '{n} bought',
    reputation: 'reputation',
    exportSave: 'Copy the run out',
    importDo: 'Load it',
    reset: 'Start over',
    resetConfirm: 'Start over? The pits, the clerks and the funds are gone.',
    copied: 'Copied.',
    importBad: 'That isn\'t a run: {why}',
    fold: 'Hide the panel',
    unfold: 'Show the panel',
    keys: 'Keys',
    closeKeys: 'Close',
    hint: 'R requotes, F flattens, 1 to 6 pick a pit, P hides the panel, ? for keys',
    away: 'Away for {away}, {counted} counted.',
    awayRan: 'The floor ran {ticks} ticks and the till was paid at that rate: {funds}.',
    awayNothing: 'The floor ran while you were gone and the till took nothing.',
  },

  keys: [
    ['R', 'requote both sides'],
    ['F', 'flatten the position'],
    ['Q', 'pull both sides off'],
    ['1 - 6', 'go to a pit'],
    ['[ ]', 'narrow or widen the spread'],
    ['- =', 'smaller or bigger size'],
    ['P', 'hide the panel'],
    ['?', 'this list'],
  ],

  // What the slate says about the pit, under the price. One of these is
  // chosen by what the tick actually did, never at random.
  why: {
    quiet: ['nobody is trading', 'the pit is quiet', 'no prints'],
    upBuyers: ['buyers are lifting the offer', 'the crowd leans to the offer', 'they are paying up'],
    downSellers: ['sellers are hitting the bid', 'the crowd leans to the bid', 'stock is coming out'],
    flatBoth: ['both sides are working', 'trade is even', 'it is changing hands'],
    thin: ['the book is thin', 'nobody is quoting', 'there is nothing resting'],
    wide: ['the spread is wide', 'they are far apart'],
    producers: ['the makers are selling', 'supply is coming in'],
    households: ['the households are buying', 'they need it'],
    speculators: ['the punters are in it', 'the position takers are working'],
  },

  fills: {
    bought: 'bought {qty} at {price}',
    sold: 'sold {qty} at {price}',
    both: 'turned {qty} at {price}',
  },

  events: {
    quote: 'bid {bid} for {size}, offer {size} at {ask}',
    pulled: 'quote off the board',
    flattened: 'flattened {qty} at {price}',
    flattenNothing: 'nothing to flatten',
    requote: 'requoted {bid} at {ask}',
    swept: 'swept {n} to the till',
    crowdGrew: '{n} more take the floor',
    clerkHired: 'a clerk starts on the {pit} pit',
    seatUp: 'the seat takes {bps} basis points now',
    seatPaid: 'the seat paid {n}',
    pitOpened: 'the {pit} pit opens',
    pitCornered: 'the {pit} pit closes. {funds} and {rep} reputation.',
    runnerHired: 'a runner takes the road, {lead} ticks of warning',
    rumour: 'runner: {text}',
    shockHit: '{text}',
    cityLeft: 'the road to {city}. {n} reputation to spend.',
    citySpent: '{label}, {n} spent',
  },

  // What a runner brings in, and what it reads like when it lands. The two
  // must describe the same event: the runner's line is the news, the arrival
  // line is the thing itself.
  rumours: {
    harvest: { news: 'a heavy harvest is coming into {pit}', land: 'the harvest lands. {pit} is everywhere', dir: 'down' },
    drought: { news: 'the season has failed where {pit} comes from', land: 'the failed season reaches the pit. {pit} is short', dir: 'up' },
    fire: { news: 'a fire in the {pit} stores', land: 'the {pit} stores are gone', dir: 'up' },
    war: { news: 'levies are buying {pit} by the wagon', land: 'the levies are here, buying {pit}', dir: 'up' },
    road: { news: 'a new road reaches the {pit} country', land: 'the road is open. {pit} comes in cheaper', dir: 'down' },
  },

  // One paragraph per pit, said the way a floor would describe it. These say
  // how the crowd behaves, which is the only thing that differs.
  pits: {
    grain:  'The crowd finds a price and stays near it. Quote around the mid and the spread is yours.',
    salt:   'A salt trader holds an opinion for a long time. News takes a while to be believed, so reading it early pays.',
    timber: 'Everybody writes the same ticket here, so orders arrive in big lumps and one of them moves the price further than you expect.',
    iron:   'Iron trends. A print above where they thought it was makes them expect another one, and it runs.',
    cloth:  'Cloth sits still and then corrects hard. When it goes, big orders cross the spread to get filled.',
    oil:    'Oil runs, breaks and runs again. Nothing here settles, and a stale quote is run over inside a tick.',
  },

  // What the clerks can read and what they can do, in the player's words.
  sensors: {
    mid: 'the mid',
    stale: 'how far the mid has left your quote',
    drift: 'which way the mid has left your quote',
    spread: 'the spread on the book',
    position: 'what you are carrying',
    cash: 'the cash behind your quote',
    volume: 'units traded last tick',
    flow: 'which side is being taken',
    disagreement: 'how far apart the crowd is',
    rumour: 'a runner has news',
  },
  actions: {
    requote: 'requote both sides',
    resize: 'change the size',
    widen: 'widen the spread',
    narrow: 'narrow the spread',
    lean: 'lean the quote',
    cut: 'cut the position',
    pull: 'pull the quote',
    push: 'put the quote back',
  },
  clerkCards: {
    firstName: 'follow the mid',
    firstWhy: 'A clerk who requotes when the mid moves away from you. Hire one and you stop clicking Requote.',
  },

  cities: ['Two Rivers', 'Saltmarsh', 'Longbarrow', 'Kettle', 'Ninefold', 'Greenway', 'Harrow', 'Stonemouth', 'Wintergate', 'Alderfen'],

  intro: {
    title: 'Making a market',
    body: 'Write a bid on the left and an offer on the right, with a size under them. The crowd trades against your quotes. You keep the spread when both sides fill, and you lose when the price runs and leaves you holding one side.',
    go: 'Take the rail',
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
