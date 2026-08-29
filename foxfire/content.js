// ===========================================================================
// THE WRITING
//
// Every sentence the game says lives here. Most entries are POOLS: a list of
// ways to say the same thing, and each organism picks one by its seed, so two
// players do not read the same forest. Holes are written {name}; a hole with
// a capital, {Name}, is capitalised after filling so it can open a sentence.
//
// Numbers and short labels live in config.js. This file is only prose.
// ===========================================================================

export const CONTENT = {

  // -------------------------------------------------------------------------
  // THE SCALES - what a level is called, and what its nodes are
  // -------------------------------------------------------------------------
  levels: [
    { name: 'the floor', wood: 'a log', soil: 'bare soil', root: 'a root', many: 'logs' },
    { name: 'the stand', wood: 'a windthrow', soil: 'a bog', root: 'a grove', many: 'windthrows' },
    { name: 'the wood', wood: 'a blowdown', soil: 'a fen', root: 'a woodland', many: 'blowdowns' },
    { name: 'the range', wood: 'a burn', soil: 'a moor', root: 'a valley of trees', many: 'burns' },
    { name: 'the land', wood: 'a dead forest', soil: 'a plain', root: 'a forest', many: 'dead forests' },
    { name: 'the world', wood: 'a dead continent', soil: 'a desert', root: 'a continent', many: 'dead continents' },
  ],
  // Past the roster: {n} is the ordinal of the world.
  beyondLevel: { name: 'the {n} world', wood: 'a dead world', soil: 'a bare world', root: 'a living world', many: 'dead worlds' },
  ordinals: ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'],

  // -------------------------------------------------------------------------
  // TRAITS
  // -------------------------------------------------------------------------
  traits: {
    lignin:     { name: 'Lignin enzymes',   line: 'Dead wood is eaten half again as fast, each time' },
    cables:     { name: 'Rhizomorphs',      line: 'Tips travel in bootlace cables and move faster' },
    branching:  { name: 'Branching',        line: 'Every new tip costs less' },
    reach:      { name: 'Foraging',         line: 'A tip looks a cell further for something to reach' },
    symbiosis:  { name: 'Symbiosis',        line: 'Every tree pays more for what it is sent' },
    parasitism: { name: 'Parasitism',       line: 'A tree can be drained and felled for its wood' },
    transfer:   { name: 'Transfer',         line: 'Sugar can be sent to a kind of tree so it grows faster' },
    rot:        { name: 'Rot',              line: 'A felled tree leaves more wood behind' },
    frost:      { name: 'Frost hardiness',  line: 'Winter no longer slows the tips' },
    reserve:    { name: 'Reserves',         line: 'The organism keeps working for more hours while you are gone' },
    evergreen:  { name: 'Evergreen trade',  line: 'The trees still pay a little through the winter' },
  },

  genome: {
    headstart: { name: 'Rich spore',   line: 'Every organism after this begins with more tips' },
    quick:     { name: 'Quick hyphae', line: 'Tips are faster in every organism after this' },
    enzymes:   { name: 'Old enzymes',  line: 'Everything yields more in every organism after this' },
    memory:    { name: 'Memory',       line: 'Traits cost less in every organism after this' },
    patience:  { name: 'Patience',     line: 'More hours count while you are gone' },
  },

  // -------------------------------------------------------------------------
  // THE LOG - pools, picked by seed
  // -------------------------------------------------------------------------
  log: {
    start: [
      'A spore settles on a dead log. It is dark and damp, and that is enough.',
      'Something lands on a fallen log and does not blow away.',
      'A log has been on the ground for years. Today a spore finds it.',
    ],
    firstHand: [
      'A thread pushes out of the spore and into the rot.',
      'The first thread finds the grain of the wood and follows it.',
    ],
    handReach: [
      'A thread reaches {thing}.',
      'By hand, a thread finds {thing}.',
    ],
    firstTip: [
      'A tip grows at the end of the thread and goes looking on its own.',
      'The first tip sets off. It does not need to be told where.',
    ],
    tipsGrown: [
      '{n} tips now. They find what they find.',
      'The front is {n} tips wide.',
    ],
    firstWood: [
      'The tips reach {thing}. It is eaten from the inside.',
      'The thread runs into {thing} and starts to take it apart.',
    ],
    firstSoil: [
      'A thread runs through {thing}. There are minerals in it, and nothing to spend them on yet.',
      'The tips cross {thing}. Minerals, loose in the dark.',
    ],
    firstRoot: [
      'A thread touches {thing}. The tree on the other end is alive, and it is interested.',
      'The tips find {thing}. Sugar comes down it in exchange for what the soil holds.',
    ],
    firstTrade: [
      'The {kind} pays in sugar for minerals. Send it more and it pays less for each.',
      'The first trade: minerals up the root, sugar down. The {kind} sets the price.',
    ],
    woodGone: [
      '{Thing} is finished. Nothing left in it but the threads.',
      '{Thing} has been eaten hollow.',
    ],
    ringOpened: [
      'The reach widens. {n} more places to find.',
      'Further out now. {n} places nobody has touched.',
    ],
    lastRing: [
      'The tips have reached the edge of {level}.',
      'There is no further to go on {level}. Beyond it is something bigger.',
    ],
    beyond: [
      'Everything so far is one node of {level}.',
      'Seen from {level}, the whole organism is a point of light.',
    ],
    firstFell: [
      'A {kind} is being drained. It will fall.',
      'The threads turn on a {kind}. It does not know yet.',
    ],
    treeFelled: [
      'A {kind} dies. Dead wood now, and a lot of it.',
      'The {kind} goes over. The threads are already inside.',
    ],
    regrown: [
      'A seedling comes up where the {kind} was.',
      'Something green in the gap the {kind} left.',
    ],
    season: {
      0: ['Spring. The trees want everything the soil has.', 'Spring, and the roots are pulling hard.'],
      1: ['Summer. Steady trade, steady growth.', 'Summer settles in.'],
      2: ['Autumn. The leaves come down and the logs fatten.', 'Autumn. The trees pay less and the floor is littered with food.'],
      3: ['Winter. The trees go quiet. The wood is still there.', 'Winter. Nothing comes down the roots. The tips slow in the cold.'],
    },
    away: [
      'Away {t}.',
      '{t} passed.',
    ],
    fruit: [
      'Mushrooms come up through the whole of {level}, and then the spores go.',
      'The organism fruits. For a few days the ground is covered, and then there is only the wind.',
    ],
    fruitOpen: [
      'A spore settles, carrying what the last one learned.',
      'The wind has put a spore down somewhere new. It remembers.',
    ],
    canFruit: [
      'The organism is big enough to fruit. It would end here, and what it learned would travel.',
    ],
    canBeyond: [
      'Enough of {level} is threaded to go beyond it.',
    ],
    milestoneTips: [
      '{n} tips. A front, not a thread.',
    ],
    milestoneArea: [
      'The organism covers {area}.',
    ],
    largest: [
      'Larger than any single living thing has ever been.',
    ],
  },

  // -------------------------------------------------------------------------
  // SHORT LINES ON THE FURNITURE
  // -------------------------------------------------------------------------
  ui: {
    handIdle: 'Push a thread out by hand',
    handDone: 'The tips do this now',
    tipsLine: '{n} foraging. The next costs {cost}.',
    carryLine: 'They carry {carried} of {produced} minerals/s.',
    carryShort: 'They carry {carried} of {produced} minerals/s; the rest leaches away.',
    reachLine: 'Ring {ring} of {rings} on {level}. {reached} of {total} reached.',
    reachClosed: '{level} is fully open.',
    beyondLine: 'Fold all of {level} into one point and start on {next}.',
    beyondNeeds: 'Reach {pct} of {level} first.',
    seasonLine: '{name}, {left} left.',
    sporesNote: 'Fruiting ends this organism. You would carry {n} spores.',
    sporesHeld: '{n} spores unspent.',
    belowLine: '{sugar} sugar/s and {minerals} minerals/s arrive from below.',
    policyKeep: 'Milk',
    treeDead: 'dead',
    treeYoung: 'young',
    noTrees: 'No living trees reached.',
    winter: 'Winter: the trees pay a quarter',
    evergreenWinter: 'Winter: evergreen trade',
    largestNote: 'Larger than the largest living thing on Earth',
  },
};
