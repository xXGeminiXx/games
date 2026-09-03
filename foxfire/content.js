// ===========================================================================
// THE WRITING
//
// Every sentence the game says lives here. Most entries are POOLS: a list of
// ways to say the same thing, and each organism picks one by its seed, so two
// players do not read the same forest. Holes are written {name}; a hole with
// a capital, {Name}, is capitalised after filling so it can open a sentence.
//
// The voice is a field notebook kept on one patch of ground over years:
// first person plural, short declarative sentences, local names for trees.
// The lines in a pool are not one sentence reworded. Each is a different
// observation of the same event, so two organisms read as two notebooks.
//
// Numbers and short labels live in config.js. This file is only prose.
// ===========================================================================

export const CONTENT = {

  // -------------------------------------------------------------------------
  // THE SCALES - what a level is called, and what its nodes are
  //
  // The same three things at six sizes: dead wood to eat, bare ground that
  // gives up minerals, and living roots to trade with. A log on the floor is
  // a windthrow in the stand and a dead forest in the land. Every noun here
  // has to read inside a sentence: "A thread reaches {thing}."
  // -------------------------------------------------------------------------
  levels: [
    { name: 'the floor', wood: 'a log',            soil: 'bare soil', root: 'a root',             many: 'logs' },
    { name: 'the stand', wood: 'a windthrow',      soil: 'a bog',     root: 'a grove',            many: 'windthrows' },
    { name: 'the wood',  wood: 'a blowdown',       soil: 'a fen',     root: 'a woodland',         many: 'blowdowns' },
    { name: 'the range', wood: 'a dead ridge',     soil: 'a moor',    root: 'a wooded valley',    many: 'dead ridges' },
    { name: 'the land',  wood: 'a dead forest',    soil: 'a plain',   root: 'a forest',           many: 'dead forests' },
    { name: 'the world', wood: 'a dead continent', soil: 'a desert',  root: 'a living continent', many: 'dead continents' },
  ],
  // Past the roster: {n} is the ordinal of the world, counted outward from
  // here, so the scales keep reading as distance once the names run out.
  beyondLevel: { name: 'the {n} world out', wood: 'a dead world', soil: 'a bare world', root: 'a living world', many: 'dead worlds' },
  ordinals: ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'],

  // -------------------------------------------------------------------------
  // TRAITS - one line each, stating what changes
  // -------------------------------------------------------------------------
  traits: {
    lignin:     { name: 'Lignin enzymes',   line: 'Dead wood is broken down half again as fast' },
    cables:     { name: 'Rhizomorphs',      line: 'Tips run in bootlace cables and travel faster' },
    branching:  { name: 'Branching',        line: 'Every new tip costs less than it did' },
    reach:      { name: 'Foraging',         line: 'A tip looks further for the next place to reach' },
    symbiosis:  { name: 'Symbiosis',        line: 'Every tree pays more for what it\'s sent' },
    parasitism: { name: 'Parasitism',       line: 'A tree can be drained and felled for its wood' },
    transfer:   { name: 'Transfer',         line: 'Sugar can be sent to a kind of tree so it grows faster' },
    rot:        { name: 'Rot',              line: 'A felled tree leaves more wood behind it' },
    frost:      { name: 'Frost hardiness',  line: 'Cold no longer slows the tips in winter' },
    reserve:    { name: 'Reserves',         line: 'The fungus keeps working for more hours while you\'re away' },
    evergreen:  { name: 'Evergreen trade',  line: 'The trees keep paying a little through the winter' },
    instinctExtend: { name: 'Opens rings itself', line: 'The fungus opens the next ring once the front has nothing left to reach' },
    instinctTips:   { name: 'Grows tips itself',  line: 'The fungus grows the front when the ground gives up more than the tips carry' },
    instinctBeyond: { name: 'Goes beyond itself',  line: 'The fungus folds a finished level and moves up on its own, once you switch it on' },
  },

  genome: {
    headstart: { name: 'Rich spore',   line: 'Every fungus after this one begins with more tips' },
    quick:     { name: 'Quick hyphae', line: 'Tips are faster in every fungus after this one' },
    enzymes:   { name: 'Old enzymes',  line: 'Wood, soil and trees all yield more, in every fungus after this one' },
    memory:    { name: 'Memory',       line: 'Traits cost less to learn in every fungus after this one' },
    patience:  { name: 'Patience',     line: 'The fungus keeps working for still more hours away, in every fungus after this one' },
  },

  // -------------------------------------------------------------------------
  // THE LOG - pools, picked by seed
  // -------------------------------------------------------------------------
  log: {
    start: [
      'A spore comes down on a dead log. Dark, damp, well rotted. That\'s all it asks for.',
      'You\'ve watched this log go soft for 9 years. Today something has taken hold in it.',
      'One spore, one fallen log. You drive a stake beside it and open the notebook.',
      'The log has lain here since the storm. There\'s a spore on it now, and it doesn\'t blow off.',
    ],
    firstHand: [
      'A thread pushes out of the spore and into the rot.',
      'The first thread takes the grain of the wood and follows it in.',
      'One thread, finer than a hair, working along the wet side of the log.',
    ],
    handReach: [
      'A thread reaches {thing}.',
      'You follow a thread out to {thing} and lose it under the litter.',
      'One thread has crossed to {thing} and holds there.',
    ],
    firstTip: [
      'A tip forms at the end of the thread and sets off. Nothing directs it.',
      'The first tip leaves the wood. It doesn\'t need to be told where to go.',
      'There\'s a growing point out ahead of the thread now, and it moves on its own.',
    ],
    tipsGrown: [
      '{n} tips out now. They find what they find.',
      'The front is {n} tips wide.',
      'You count {n} tips along the edge.',
    ],
    firstWood: [
      'The tips reach {thing}. It\'s being eaten from the inside.',
      'A thread is into {thing}. The wood will go soft first, then hollow.',
      'You open {thing} with a knife. White lace all through the grain.',
    ],
    firstSoil: [
      'A thread runs through {thing}. There are minerals in it, and nothing yet to spend them on.',
      'The tips cross {thing}. Bare ground gives up what wood can\'t.',
      'You take a core out of {thing}. Threads at every depth you cut.',
    ],
    firstRoot: [
      'A thread touches {thing}. The tree on the other end is alive, and it\'s interested.',
      'The tips find {thing}. Sugar comes down it in exchange for what the soil holds.',
      'Contact at {thing}. Inside a day the fine roots are sheathed in pale thread.',
    ],
    firstTrade: [
      'The {kind} pays sugar for minerals. Send it more and it pays less for each.',
      'First trade with the {kind}: minerals up the root, sugar down. The tree sets the price.',
      'The {kind} is buying. The price falls as you send more, and it never falls to nothing.',
    ],
    woodGone: [
      '{Thing} is finished. Nothing left in it but the threads.',
      '{Thing} has been eaten hollow. A hand goes straight through it.',
      '{Thing} is spent. It holds its shape until the next rain and then it\'s soil.',
    ],
    ringOpened: [
      'The reach widens. {n} more places to find.',
      'Further out now. {n} places nobody has touched.',
      'You move the stakes out one ring. {n} new places inside the line.',
    ],
    lastRing: [
      'The tips have reached the edge of {level}.',
      'There\'s no further to go on {level}. Something bigger starts past the edge.',
      'The far stakes of {level} are set. Nothing more at this size.',
    ],
    beyond: [
      'Everything so far is one point of {level}. What\'s under it keeps working.',
      'You redraw the map. A year of threading is one mark on {level}.',
      'Seen from {level}, the whole fungus is a single point. You begin again at the middle of it.',
    ],
    below: [
      'What is left down on {level} sends up {sugar} sugar a second and {minerals} minerals a second, and it needs nothing from you.',
      'The old ground pays its own way now: {sugar} sugar and {minerals} minerals a second, arriving from under the new map.',
      'You keep the books on {level} out of habit. It is {sugar} sugar and {minerals} minerals a second, every second, unattended.',
    ],
    firstFell: [
      'A {kind} is being drained. It will fall.',
      'The threads have turned on a {kind}. It carries on as though nothing has changed.',
      'You mark a {kind}. It pays hard for a short while, and then it\'s wood.',
    ],
    treeFelled: [
      'A {kind} dies. Dead wood now, and a lot of it.',
      'The {kind} goes over. The threads were already inside it.',
      'A {kind} came down in the night. You found it in the morning, threaded end to end.',
    ],
    regrown: [
      'A seedling comes up where the {kind} stood.',
      'Something green in the gap the {kind} left. It will take years.',
      'The {kind} is down to soil, and its own seed is up in the light it let in.',
    ],
    season: {
      0: [
        'The trees want everything the soil has.',
        'The roots are pulling hard. The best trade of the year.',
        'By midday the floor is warm and everything moves at once.',
      ],
      1: [
        'Steady trade, steady growth.',
        'The canopy is closed and the floor stays damp under it.',
        'You take the same measurements for weeks and they come back the same.',
      ],
      2: [
        'The leaves come down and the logs fatten.',
        'The trees pay less and the floor is littered with food.',
        'Litter to the ankle. Wood you\'d written off has weight in it again.',
      ],
      3: [
        'The trees go quiet. The wood is still there.',
        'Nothing comes down the roots. The tips slow in the cold.',
        'You came at dusk and the whole lace was lit, cold green, out to the edge.',
      ],
    },
    aimSet: [
      'You put a stake in the ground out there. The threads thicken on that side within the day.',
      'A mark out on the plot, and the front leans toward it.',
      'You mark where you want it and the growing points take the hint.',
    ],
    bestKind: [
      'The prices have turned. The {kind} pays most for the next mineral now.',
      'Best price on the plot is the {kind} this season. Move the minerals to it.',
      'The {kind} has come up. Nothing else on this ground pays as well for a mineral today.',
    ],
    away: [
      'Away {t}. The fungus kept working.',
      '{t} since the last entry. You read the marks and catch up.',
      'You were gone {t}. Nothing here waited on you.',
    ],
    fruit: [
      'Mushrooms come up through the whole of {level}, and then the spores go.',
      'The fungus fruits. For a few days the ground is covered, and then there\'s only the wind.',
      'It ends the way you\'ve seen it end. All at once, everywhere on {level}, and then bare ground.',
    ],
    fruitOpen: [
      'A spore settles, carrying what the last one learned.',
      'The wind has put a spore down somewhere new. It isn\'t starting from nothing.',
      'New ground, new notebook. The fungus isn\'t quite beginning again.',
    ],
    canFruit: [
      'The fungus is big enough to fruit. It would end here, and what it learned would travel.',
      'It could fruit now. Everything standing would go, and the spores would carry the rest.',
      'Ready to fruit. Ground here would be given up for ground anywhere.',
    ],
    canBeyond: [
      'Enough of {level} is threaded to go beyond it.',
      'Half of {level} carries thread. What\'s here would keep paying from below.',
      'You could fold {level} into one point and begin on the ground above it.',
    ],
    milestoneTips: [
      '{n} tips. The edge moves as one front now.',
      '{n} tips out. You stopped counting them one at a time some while back.',
      'The count is past {n}. The edge moves faster than you can walk it.',
    ],
    milestoneArea: [
      'The fungus covers {area}.',
      'You measure it at {area}, and the edge is still moving.',
      'Measured today: {area} of ground with thread under it.',
    ],
    largest: [
      'Past the largest living thing anyone has measured. You write the figure down and carry on.',
      'A honey fungus in Oregon held the record at about 9.65 square kilometres. This is past it.',
      'Nothing alive has been recorded this large. There\'s no bigger example to set beside it.',
    ],
  },

  // -------------------------------------------------------------------------
  // SHORT LINES ON THE FURNITURE
  // -------------------------------------------------------------------------
  ui: {
    handIdle: 'Press until the fungus can grow its first tip.',
    handDone: 'The tips do this now.',
    tipsLine: '{n} foraging. The next costs {cost}.',
    carryLine: 'They carry {carried} of {produced} minerals/s.',
    carryShort: 'They carry {carried} of {produced} minerals/s. The rest leaches away; more tips would carry it.',
    reachLine: 'Ring {ring} of {rings} on {level}. {reached} of {total} places reached.',
    reachClosed: '{level} is open to its edge. {reached} of {total} places reached.',
    beyondLine: 'All of {level} becomes one point of {next}. Half of what it pays now keeps arriving from below.',
    beyondNeeds: 'Reach {pct} of {level} first.',
    sporesNote: 'Fruiting ends this fungus. It would carry {n} spores.',
    sporesNeeds: 'This fungus can fruit once it reaches {level}.',
    sporesHeld: '{n} spores unspent.',
    belowLine: '{sugar} sugar/s and {minerals} minerals/s arrive from below.',
    aimIdle: 'Click the floor and the tips work toward that spot first. Nothing gets closed off - they just get there sooner.',
    aimSet:  'The tips are working toward the mark.',
    noTrees: 'No living trees reached.',
    sharesNote: 'Share splits the minerals between the kinds. Every mineral a kind gets fetches less than the one before, so spreading them beats piling them on one kind.',
    treeBest: 'Pays best in {season}.',
    shareGain: 'One more share here is worth {gain} sugar/s.',
    shareCost: 'One more share here costs {gain} sugar/s.',
    treeFell: 'One grown tree is worth {felled} sugar felled, or {kept} traded each season.',
    treeFeed: 'Feeding pays for itself in {time}.',
    treeFeedNever: 'Feeding wouldn\'t pay for itself here yet.',
    winter: 'Winter: the trees pay a quarter of the usual',
    evergreenWinter: 'Winter: evergreen trade keeps them trading',
    largestNote: 'Larger than the largest living thing on Earth',

    // What an absence is written up as, behind the line from the pool above:
    // how far the organism got through it, and what it has to show.
    awayCapped: 'Its reserves ran out after {t}.',
    awayPlaces: '{n} places reached',

    // The one entry an instinct is worth. It is written the first time that
    // habit does anything and never again, because an organism that reports
    // every purchase is not worth reading.
    instinctExtend: 'The stakes were out a ring further this morning and nobody moved them. It does this for itself now.',
    instinctTips:   'The front thickened overnight where the ground was giving up more than it could carry. You weren\'t here.',
    instinctBeyond: 'It has folded a finished level on its own. You came back to a map you didn\'t draw.',

    // The compass at the top of the journal. One of these is showing at any
    // moment, and each one says a fact and then the move it argues for.
    next: {
      hand:     'Press Grow a thread. Each press eats a little of the log and pushes the threads out.',
      firstTip: 'You can afford a tip. A tip forages on its own and never stops, so buy one and stop pressing.',
      waste:    'Bare soil and dead wood are giving up {produced} minerals a second and {lost} of it is leaching away. Tips carry the minerals to the trees, so grow more tips.',
      ring:     'The tips have reached everything inside the line. Open the next ring and there\'s more ground to work.',
      saving:   'Nothing left to reach inside the line. The next ring costs {cost} and you have {have}.',
      beyond:   '{Level} is worked out. Go beyond: all of it becomes one place on {next}, and half of what it pays now keeps arriving.',
      beyondSaving: '{Level} is threaded end to end. Going beyond costs {cost} and you have {have}. It turns all of this into one place on {next}.',
      beyondNeeds: 'Going beyond needs {need} places on {level} reached and you have {reached}. The tips are still getting there.',
      market:   '{Best} pays {bestPrice} for the next mineral and {Worst} pays {worstPrice}. Give {Best} more of the share and take it off {Worst}.',
      trait:    'You can afford {name}. A trait lasts as long as this fungus does.',
      winter:   'Winter. The trees pay a quarter of the usual until spring. The wood and the soil don\'t care.',
      winterEvergreen: 'Winter, and the evergreen trade is holding. The trees pay six tenths of the usual until spring where they would have paid a quarter.',
      idle:     'Sugar is piling up. It buys tips, ground, and traits, and nothing else.',
    },
  },

  // -------------------------------------------------------------------------
  // WHAT HAPPENS TO THE GROUND
  //
  // Weather and neighbours: things done to the plot rather than on it. Holes:
  // {thing} is the node noun at this scale, {n} a count, {level} the scale.
  // -------------------------------------------------------------------------
  events: {
    drought: [
      'The rain has stopped. The ground goes pale and hard, and it gives up less than it should.',
      'A dry spell on {level}. The bare ground holds what little is left in it.',
      'No rain since the last entry. The threads are thin wherever the soil has dried out.',
    ],
    droughtEnds: [
      'Rain, and then more rain. The ground is dark again and giving.',
      'The dry spell breaks. Inside a day the soil is working as it was.',
      'Water back in the ground. You can smell it from the edge of the plot.',
    ],
    windthrow: [
      'A storm in the night. {n} trees down on wet ground, and every one of them is food.',
      'The wind came through and left {thing} where there had been standing timber.',
      'Trees down the whole west edge. The wood is green yet, but it won\'t stay that way.',
    ],
    fire: [
      'Fire through part of {level}. The threads in it are gone and the trees are standing snags.',
      'Smoke for two days. {n} places burned over, and nothing under them came through.',
      'The ground burned. What\'s left of the trees is black poles, and the soil under them is ash.',
    ],
    fireOut: [
      'The fire is out. The burn is charred to its edge and full of dead wood.',
      'Rain finished it. The burned wood is charred outside and sound within, and the threads are into it inside a day.',
      'The burn has cooled. Threads are over the edge of it already.',
    ],
    rival: [
      'Another fungus at the edge of the reach. Coarser lace, and it\'s taking ground.',
      'A second fungus on {level}. Where the two fronts meet there\'s a dark line, and neither side crosses it.',
      'Something else is working the same wood. It came in from the north edge and it isn\'t slowing.',
    ],
    rivalGone: [
      'The other fungus is overgrown. The dark line is gone and one fungus holds the ground behind it.',
      'Nothing left of the second front. You cut a log on the old line and found one kind of thread in it.',
      'The rival is under. It held for a season and then it didn\'t.',
    ],
    rivalGains: [
      'The other front moved in this season. {n} places that carried thread are on its side of the line now.',
      'The rival gained ground. It opens dead wood faster than your notes said it would.',
      'The line has moved toward the middle of {level}. {n} places lost since the last entry.',
    ],
  },
};
