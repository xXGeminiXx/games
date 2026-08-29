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
    lignin:     { name: 'Lignin enzymes',   line: 'Dead wood is broken down half again as fast, each level' },
    cables:     { name: 'Rhizomorphs',      line: 'Tips run in bootlace cables and travel faster' },
    branching:  { name: 'Branching',        line: 'Every new tip costs less than it did' },
    reach:      { name: 'Foraging',         line: 'A tip looks a cell further for something to reach' },
    symbiosis:  { name: 'Symbiosis',        line: 'Every tree pays more for what it is sent' },
    parasitism: { name: 'Parasitism',       line: 'A tree can be drained and felled for its wood' },
    transfer:   { name: 'Transfer',         line: 'Sugar can be sent to a kind of tree so it grows faster' },
    rot:        { name: 'Rot',              line: 'A felled tree leaves more wood behind it' },
    frost:      { name: 'Frost hardiness',  line: 'Cold no longer slows the tips in winter' },
    reserve:    { name: 'Reserves',         line: 'The organism keeps working for more hours while you are away' },
    evergreen:  { name: 'Evergreen trade',  line: 'The trees keep paying a little through the winter' },
  },

  genome: {
    headstart: { name: 'Rich spore',   line: 'Every organism after this one begins with more tips' },
    quick:     { name: 'Quick hyphae', line: 'Tips are faster in every organism after this one' },
    enzymes:   { name: 'Old enzymes',  line: 'Wood, soil and root all yield more, in every organism after' },
    memory:    { name: 'Memory',       line: 'Traits are learned cheaper in every organism after this one' },
    patience:  { name: 'Patience',     line: 'More of the hours you are away are counted' },
  },

  // -------------------------------------------------------------------------
  // THE LOG - pools, picked by seed
  // -------------------------------------------------------------------------
  log: {
    start: [
      'A spore comes down on a dead log. Dark, damp, well rotted. That is all it asks for.',
      'We have watched this log go soft for 9 years. Today something has taken hold in it.',
      'One spore, one fallen log. We drive a stake beside it and open the notebook.',
      'The log has lain here since the storm. There is a spore on it now, and it does not blow off.',
    ],
    firstHand: [
      'A thread pushes out of the spore and into the rot.',
      'The first thread takes the grain of the wood and follows it in.',
      'One thread, finer than a hair, working along the wet side of the log.',
    ],
    handReach: [
      'A thread reaches {thing}.',
      'We follow a thread out to {thing} and lose it under the litter.',
      'One thread has crossed to {thing} and holds there.',
    ],
    firstTip: [
      'A tip forms at the end of the thread and sets off. Nothing directs it.',
      'The first tip leaves the wood. It does not need to be told where to go.',
      'There is a growing point out ahead of the thread now, and it moves on its own.',
    ],
    tipsGrown: [
      '{n} tips out now. They find what they find.',
      'The front is {n} tips wide.',
      'We count {n} tips along the edge. The count is the thing that matters.',
    ],
    firstWood: [
      'The tips reach {thing}. It is being eaten from the inside.',
      'A thread is into {thing}. The wood will go soft first, then hollow.',
      'We open {thing} with a knife. White lace all through the grain.',
    ],
    firstSoil: [
      'A thread runs through {thing}. There are minerals in it, and nothing yet to spend them on.',
      'The tips cross {thing}. Bare ground gives up what wood cannot.',
      'We take a core out of {thing}. Threads at every depth we cut.',
    ],
    firstRoot: [
      'A thread touches {thing}. The tree on the other end is alive, and it is interested.',
      'The tips find {thing}. Sugar comes down it in exchange for what the soil holds.',
      'Contact at {thing}. Inside a day the fine roots are sheathed in pale thread.',
    ],
    firstTrade: [
      'The {kind} pays sugar for minerals. Send it more and it pays less for each.',
      'First trade with the {kind}: minerals up the root, sugar down. The tree sets the price.',
      'The {kind} is buying. The price falls as we send more, and it never falls to nothing.',
    ],
    woodGone: [
      '{Thing} is finished. Nothing left in it but the threads.',
      '{Thing} has been eaten hollow. A hand goes straight through it.',
      '{Thing} is spent. It holds its shape until the next rain and then it is soil.',
    ],
    ringOpened: [
      'The reach widens. {n} more places to find.',
      'Further out now. {n} places nobody has touched.',
      'We move the stakes out one ring. {n} new places inside the line.',
    ],
    lastRing: [
      'The tips have reached the edge of {level}.',
      'There is no further to go on {level}. Beyond it is something bigger.',
      'The far stakes of {level} are set. Nothing more at this size.',
    ],
    beyond: [
      'Everything so far is one node of {level}. What is under it keeps working.',
      'We redraw the map. A year of threading is one mark on {level}.',
      'Seen from {level}, the whole organism is a single point. We begin again at the middle of it.',
    ],
    firstFell: [
      'A {kind} is being drained. It will fall.',
      'The threads have turned on a {kind}. It carries on as though nothing has changed.',
      'We mark a {kind}. It pays hard for a short while, and then it is wood.',
    ],
    treeFelled: [
      'A {kind} dies. Dead wood now, and a lot of it.',
      'The {kind} goes over. The threads were already inside it.',
      'A {kind} came down in the night. We found it in the morning, threaded end to end.',
    ],
    regrown: [
      'A seedling comes up where the {kind} stood.',
      'Something green in the gap the {kind} left. It will take years.',
      'The {kind} is down to soil, and its own seed is up in the light it let in.',
    ],
    season: {
      0: [
        'Spring. The trees want everything the soil has.',
        'Spring, and the roots are pulling hard. The best trade of the year.',
        'Spring. By midday the floor is warm and everything moves at once.',
      ],
      1: [
        'Summer. Steady trade, steady growth.',
        'Summer. The canopy is closed and the floor stays damp under it.',
        'Summer. We take the same measurements for weeks and they come back the same.',
      ],
      2: [
        'Autumn. The leaves come down and the logs fatten.',
        'Autumn. The trees pay less and the floor is littered with food.',
        'Autumn. Litter to the ankle. Wood we had written off has weight in it again.',
      ],
      3: [
        'Winter. The trees go quiet. The wood is still there.',
        'Winter. Nothing comes down the roots. The tips slow in the cold.',
        'Winter. We came at dusk and the whole lace was lit, cold green, out to the edge.',
      ],
    },
    away: [
      'Away {t}. The organism kept working.',
      '{t} since the last entry. We read the marks and catch up.',
      'We were gone {t}. Nothing here waited on us.',
    ],
    fruit: [
      'Mushrooms come up through the whole of {level}, and then the spores go.',
      'The organism fruits. For a few days the ground is covered, and then there is only the wind.',
      'It ends the way we have seen it end. All at once, everywhere on {level}, and then bare ground.',
    ],
    fruitOpen: [
      'A spore settles, carrying what the last one learned.',
      'The wind has put a spore down somewhere new. It is not starting from nothing.',
      'New ground, new notebook. The organism is not quite beginning again.',
    ],
    canFruit: [
      'The organism is big enough to fruit. It would end here, and what it learned would travel.',
      'It could fruit now. Everything standing would go, and the spores would carry the rest.',
      'Ready to fruit. Ground here would be given up for ground anywhere.',
    ],
    canBeyond: [
      'Enough of {level} is threaded to go beyond it.',
      'Half of {level} carries thread. What is here would keep paying from below.',
      'We could fold {level} into one point and begin on the ground above it.',
    ],
    milestoneTips: [
      '{n} tips. A front, not a thread.',
      '{n} tips out. We stopped counting them one at a time some while back.',
      'The count is past {n}. The edge moves faster than we can walk it.',
    ],
    milestoneArea: [
      'The organism covers {area}.',
      'We have it at {area}, and the edge is still moving.',
      'Measured today: {area} of ground with thread under it.',
    ],
    largest: [
      'Past the largest living thing anyone has measured. We write the figure down and carry on.',
      'A honey fungus in Oregon held the record at about 9.65 square kilometres. This is past it.',
      'Nothing alive has been recorded this large. There is no bigger example to set beside it.',
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
    carryShort: 'They carry {carried} of {produced} minerals/s. The rest leaches away.',
    reachLine: 'Ring {ring} of {rings} on {level}. {reached} of {total} reached.',
    reachClosed: '{level} is open to its edge.',
    beyondLine: 'Fold all of {level} into one point and begin on {next}.',
    beyondNeeds: 'Thread {pct} of {level} first.',
    sporesNote: 'Fruiting ends this organism. It would carry {n} spores.',
    sporesHeld: '{n} spores unspent.',
    belowLine: '{sugar} sugar/s and {minerals} minerals/s arrive from below.',
    noTrees: 'No living trees reached.',
    winter: 'Winter: the trees pay a quarter',
    evergreenWinter: 'Winter: evergreen trade',
    largestNote: 'Larger than the largest living thing on Earth',
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
      'Water back in the ground. We can smell it from the edge of the plot.',
    ],
    windthrow: [
      'A storm in the night. {n} trees down on wet ground, and every one of them is food.',
      'The wind came through and left {thing} where there had been standing timber.',
      'Trees down the whole west edge. The wood is green yet, but it will not stay that way.',
    ],
    fire: [
      'Fire through part of {level}. The threads in it are gone and the trees are standing snags.',
      'Smoke for two days. {n} places burned over, and nothing under them came through.',
      'The ground burned. What is left of the trees is black poles, and the soil under them is ash.',
    ],
    fireOut: [
      'The fire is out. The burn is charred to its edge and full of dead wood.',
      'Rain finished it. The burned wood is charred outside and sound within, and the threads are into it inside a day.',
      'The burn has cooled. Threads are over the edge of it already.',
    ],
    rival: [
      'Another fungus at the edge of the reach. Coarser lace, and it is taking ground.',
      'A second organism on {level}. Where the two fronts meet there is a dark line, and neither side crosses it.',
      'Something else is working the same wood. It came in from the north edge and it is not slowing.',
    ],
    rivalGone: [
      'The other fungus is overgrown. The dark line is gone and the ground behind it is one organism.',
      'Nothing left of the second front. We cut a log on the old line and found one kind of thread in it.',
      'The rival is under. It held for a season and then it did not.',
    ],
    rivalGains: [
      'The other front moved in this season. {n} places that carried thread are on its side of the line now.',
      'The rival gained ground. It opens dead wood faster than the notes would have had us expect.',
      'The line has moved toward the middle of {level}. {n} places lost since the last entry.',
    ],
  },
};
