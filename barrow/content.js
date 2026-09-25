// ===========================================================================
// CONTENT
//
// Every line the player reads. Nothing here is a number and nothing here is
// read by the simulation: this file is the writing, and config.js is the
// tuning. They are kept apart so a line can be rewritten without touching a
// rate, and a rate can be turned without reading a paragraph.
//
// Most entries are POOLS. A pool is an array; the run picks one entry from it
// using the run's seed, so two runs of the same game are not worded the same.
// A pool of one is a line that never varies. Holes in braces - {name}, {n},
// {t} - are filled where the line is used.
//
// The voice: plain sentences, one image each, present tense, sentence case.
// Nothing is explained twice and nothing is cute.
//
// CAPITALS. Sentences take them; the game once ran entirely lower case as an
// homage and it read like something translated by a machine, which is the
// fastest way to make good writing look cheap. The materials are the one
// exception: they are common nouns, stored lower case so they read right
// inside a sentence ("the floor gives out onto amber"), and capitalised by
// whichever panel shows one as a label. A line that has to BEGIN with a word
// the game supplies writes its hole with a capital - {Name} - and config's
// fill() capitalises the value.
// ===========================================================================

export const CONTENT = {

  // -------------------------------------------------------------------------
  // THE LOG - the running account of the dig, newest line on top
  // -------------------------------------------------------------------------
  log: {
    start: [
      'A hill nobody has ever plowed. The ground gives under your boot.',
      'You bought this field cheap. The hill came with it.',
      'The map calls it a mound and says nothing else. Start digging.',
    ],
    firstDig: [
      'Soil. It comes up easy. Too easy.',
      'First spadeful. Soft as a garden.',
    ],
    firstSale: [
      'The builders in town pay for soil. Your first coin.',
    ],
    firstBone: [
      'Spadeful six comes up holding a hand. The fingers close around yours.',
      'A bone in the dirt. It twitches.',
    ],
    raiseShown: [
      'Bones raise the dead, and the dead will dig for you.',
    ],
    firstRaise: [
      'Your first digger climbs out of the hole and takes the spade.',
    ],
    faceShown: [
      'The floor of the cut is hard. Send some of them down to break through it.',
    ],
    breakthrough: [
      'Broke through to {name}.',
    ],
    newMarket: [
      '{Name} sells for more than anything above it. The deeper, the richer.',
    ],
    ritesShown: [
      'Coin buys better spades and faster picks.',
    ],
    // Said once, the first time a save from before the market came out is
    // opened. Only the parts that came to something are said.
    marketGone: {
      head: 'The market is gone: whatever the dead dig sells the moment it comes up.',
      sold: 'What you had on hand sold for {coin} coin.',
      back: 'The market\'s upgrades paid back {coin} coin.',
    },
    handsDone: [
      'Your hands are done. The dead dig. You keep the books.',
    ],
    sealShown: [
      'This barrow is deep enough to fill in. Filling it in pays relics, and relics buy things you keep forever.',
    ],
    away: [
      'You were away {t}.',
    ],
    slow: [
      'With nobody watching, they got {t} of digging done.',
    ],
    waiting: [
      '{Who} is waiting at the gate.',
    ],
    seamFound: [
      'The {name} here is {seam}: {line}.',
    ],
    hordeMilestones: [
      [100,    '100 diggers. The field is getting crowded.'],
      [1000,   '1,000 diggers. Birds won\'t land here anymore.'],
      [10000,  '10,000 diggers. They can hear the digging in town.'],
      [100000, '100,000 diggers. The whole hill hums.'],
      [1e6,    '1 million diggers. It\'s more hole than hill now.'],
      [1e8,    '100 million diggers. More dead than the county ever buried.'],
      [1e10,   '10 billion diggers. Where are they all coming from? Down, mostly.'],
      [1e13,   '10 trillion diggers. The lords below have started to notice.'],
      [1e16,   '10 quadrillion diggers. Nobody is counting but you.'],
    ],
    depthMilestones: [
      [8,  'Layer 9. Something under layer 10 knocks back when they dig.'],
      [45, 'Layer 46. It\'s warm down here, and getting warmer.'],
    ],
  },

  // -------------------------------------------------------------------------
  // SEAMS - what makes one layer different from the layer above it
  //
  // Every stratum below the surface may carry one of these. It changes one
  // thing about the ground and gives the layer a character the player can
  // work with or work around. `tag` is the word the panels show beside the
  // layer; `line` hovers it and carries the multipliers from config.seams.
  // -------------------------------------------------------------------------
  seams: {
    rich:     { tag: 'rich',      line: 'worth 2.2x as much' },
    dense:    { tag: 'dense',     line: 'worth 2.8x, and 1.8x as hard to dig' },
    brittle:  { tag: 'brittle',   line: 'digs 2x as fast, worth 0.6x' },
    bonefield:{ tag: 'bonefield', here: 'a bonefield', line: '3.2x the bones, worth 0.7x' },
    thin:     { tag: 'thin',      here: 'a thin seam', line: 'worth 1.8x, but 1.3x as hard to dig' },
    wide:     { tag: 'wide',      here: 'a wide seam', line: 'digs out 1.8x as fast' },
    salted:   { tag: 'salted',    line: 'worth 1.5x, and the floor under it is 1.3x as thick' },
    still:    { tag: 'still',     line: 'worth 1.3x the plain ground' },
    hollow:   { tag: 'hollow',    line: 'the floor under it is 0.35x as thick' },
    sealed:   { tag: 'sealed',    here: 'sealed off', line: 'worth 1.7x, behind a floor 2.6x as thick' },
    flooded:  { tag: 'flooded',   line: '2.2x the bones, worth 1.4x, 2x as hard to dig' },
    burnt:    { tag: 'burnt',     line: 'worth 1.9x, but 1.4x as hard to dig' },
  },


  // -------------------------------------------------------------------------
  // CHAMBERS - the story, one room at a time
  //
  // Every few strata the dead do not break into a layer, they break into a
  // room. A chamber is a scene and a choice of two, and the choice is kept
  // for the rest of the run. Chambers are grouped by band, which is how deep
  // the shaft has gone and therefore what kind of place it is passing through.
  //
  // A boon is one of: dig, bones, value, face, soft (raise cost),
  // windfall (seconds of the current income, paid at once), diggers (a share
  // of the diggers, raised free), rem (relics paid when the barrow is filled in).
  // -------------------------------------------------------------------------
  chambers: {
    bands: [
      // band 0 - the mound itself, and the people who piled it up
      [
        {
          title: 'The builder',
          lines: [
            'A stone box in the middle of the mound, and in it a man laid out with his tools.',
            'He built this hill. He never left it.',
          ],
          offers: [
            { name: 'Take the tools', line: 'Bronze shoes for every spade.', boon: { dig: 1.35 } },
            { name: 'Raise the builder', line: 'He knows this ground better than you do.', boon: { face: 1.6 } },
          ],
        },
        {
          title: 'The grain pit',
          lines: [
            'A clay-lined pit packed with grain that went black a thousand years ago.',
            'Somebody stored a whole winter down here and never came back for it.',
          ],
          offers: [
            { name: 'Sell the lot', line: 'The old pottery sells for a fortune.', boon: { windfall: 900 } },
            { name: 'Line the tunnels with it', line: 'Clay walls hold, so they can dig down faster.', boon: { face: 1.5 } },
          ],
        },
        {
          title: 'The boundary dead',
          lines: [
            'A ring of skeletons standing upright in the clay, facing out, a pace apart.',
            'Guards. Whatever they were guarding is still in the middle.',
          ],
          offers: [
            { name: 'Break the ring', line: 'They fall in and join the work, all at once.', boon: { diggers: 0.6 } },
            { name: 'Leave them standing', line: 'With the ring watching, the ground gives up more bones.', boon: { bones: 1.4 } },
          ],
        },
      ],
      // band 1 - older graves, under the mound, that the mound was built to hide
      [
        {
          title: 'The long house',
          lines: [
            'A hall longer than the field above it, roofed with beams that never rotted.',
            'The dead lie head to foot down both walls, hundreds of them, every one holding a tool.',
          ],
          offers: [
            { name: 'Wake the room', line: 'Hundreds of them stand up and reach for the wall.', boon: { diggers: 1.1 } },
            { name: 'Take the roof beams', line: 'Wood that won\'t rot, sold to men who don\'t ask.', boon: { windfall: 1800, value: 1.15 } },
          ],
        },
        {
          title: 'The smith',
          lines: [
            'A floor of slag and charcoal, and a hearth still holding its shape.',
            'Somebody worked metal down here before the hill was built.',
          ],
          offers: [
            { name: 'Relight the hearth', line: 'Everything comes up clean instead of raw.', boon: { value: 1.4 } },
            { name: 'Take the anvil', line: 'The spades come off it sharper than they went on.', boon: { dig: 1.4 } },
          ],
        },
        {
          title: 'The drowned',
          lines: [
            'Black water fills the cut to the waist and won\'t drain.',
            'There are shapes standing in it up to their chins, waiting.',
          ],
          offers: [
            { name: 'Ask them up', line: 'They come out dripping and go straight to work.', boon: { diggers: 0.8, bones: 1.25 } },
            { name: 'Drain it into the lower cut', line: 'The water eats the floor for you.', boon: { face: 1.8 } },
          ],
        },
      ],
      // band 2 - a shaft. not a grave. somebody cut this on purpose
      [
        {
          title: 'The first shaft',
          lines: [
            'Your cut runs into a shaft that isn\'t yours. Square, straight, tool marks still sharp.',
            'Somebody sank this from a long way up and stopped right here.',
          ],
          offers: [
            { name: 'Follow it down', line: 'Their shaft is better than yours. Use it.', boon: { face: 2.0 } },
            { name: 'Follow it up', line: 'It comes out two counties over, where they pay more for what you dig.', boon: { value: 1.4 } },
          ],
        },
        {
          title: 'The tally wall',
          lines: [
            'One wall is covered in tally marks. Hundreds of thousands of them.',
            'They\'re counting the dead. The count keeps going, down into the floor.',
          ],
          offers: [
            { name: 'Read the wall', line: 'Whatever they counted, it teaches you the price of everything.', boon: { value: 1.6 } },
            { name: 'Add your own mark', line: 'The hill notices. More of them come up unasked.', boon: { bones: 1.7 } },
          ],
        },
        {
          title: 'The bone room',
          lines: [
            'Bones stacked floor to ceiling, sorted by kind. Skulls in one bay, long bones in the next.',
            'Somebody spent a lifetime tidying up down here.',
          ],
          offers: [
            { name: 'Empty the bays', line: 'A lifetime of sorting, raised in an afternoon.', boon: { diggers: 1.5 } },
            { name: 'Keep the order', line: 'Work the ground the way they sorted the bones and nothing is wasted.', boon: { bones: 1.9 } },
          ],
        },
      ],
      // band 3 - sealed, deliberately, by people who knew what they were doing
      [
        {
          title: 'The plug',
          lines: [
            'The shaft ends at one huge stone, dropped in and mortared at the edges.',
            'It was set from below. Whoever placed it went down first and stayed.',
          ],
          offers: [
            { name: 'Break it', line: 'A week of work and half of them. Then it\'s open.', boon: { face: 2.6 } },
            { name: 'Work around it', line: 'The flanking cuts open four layers at once.', boon: { value: 1.8 } },
          ],
        },
        {
          title: 'The register',
          lines: [
            'Shelves of clay tablets. Every one is a name and a depth.',
            'The last few are in your handwriting. You haven\'t written them yet.',
          ],
          offers: [
            { name: 'Read to the end', line: 'You learn what the ground is worth before you dig it.', boon: { value: 1.8 } },
            { name: 'Close the book', line: 'You put it back and the hill gets on with it, faster.', boon: { dig: 1.8 } },
          ],
        },
        {
          title: 'The ones who dug down',
          lines: [
            'A work gang, still in a line, still facing the floor, tools in hand.',
            'They were digging the same way you are. They never stopped either.',
          ],
          offers: [
            { name: 'Put them back to work', line: 'They take up where they left off.', boon: { diggers: 2.0, dig: 1.2 } },
            { name: 'Take what they carried', line: 'The packs are full of things from further down than you\'ve been.', boon: { windfall: 5400, value: 1.3 } },
          ],
        },
      ],
      // band 4 - past any record. the ground stops being ground
      [
        {
          title: 'The floor that isn\'t stone',
          lines: [
            'The floor rings wrong. It\'s warm, it gives a little, and it goes on in every direction.',
            'The dead won\'t stand on it. They dig it holding on to the walls.',
          ],
          offers: [
            { name: 'Cut into it', line: 'It closes behind them and doesn\'t seem to mind.', boon: { face: 3.0, bones: 1.5 } },
            { name: 'Go around', line: 'The long way round opens more ground than the short way did.', boon: { value: 2.3 } },
          ],
        },
        {
          title: 'The count',
          lines: [
            'More tally marks, in the same hand as the wall far above.',
            'The count is nearly done. It\'s counting the dead you\'ve raised, and it\'s nearly caught up.',
          ],
          offers: [
            { name: 'Finish the count', line: 'You write the last figure yourself. The books have never been cleaner.', boon: { value: 2.2, rem: 12 } },
            { name: 'Break the wall', line: 'The count stops. Everything down here comes up faster.', boon: { dig: 2.2 } },
          ],
        },
        {
          title: 'The older barrow',
          lines: [
            'Under everything, there\'s another hill: a burial mound, buried, with a ditch around it.',
            'Somebody built a barrow down here in the dark, where nobody would ever see it.',
          ],
          offers: [
            { name: 'Dig it out', line: 'A whole hill of them, and every one comes up standing.', boon: { diggers: 3.0 } },
            { name: 'Dig under it', line: 'Whatever it was built over is worth more than the hill.', boon: { face: 2.4, value: 1.7 } },
          ],
        },
      ],
    ],
  },

  // -------------------------------------------------------------------------
  // ROOMS OF THEIR OWN - two in every lord's ten, beside the shared ones.
  // config.chambers.pools says which lords draw from which.
  // -------------------------------------------------------------------------
  lordRooms: {
    pater: [
      {
        title: 'The sorting floor',
        lines: [
          'Long tables, and on them, bones sorted by size. Somebody was halfway through a new pile.',
          'A tag on the pile says: "Yours. Please return."',
        ],
        offers: [
          { name: 'Take the pile', line: 'Every bone on the table stands up and grabs a spade.', boon: { diggers: 1.5 } },
          { name: 'Finish the sorting', line: 'Sorted bones go further.', boon: { soft: 1.6 } },
        ],
      },
      {
        title: 'The choir',
        lines: [
          'Skulls on shelves from floor to ceiling, all facing the door. The jaws move when you walk in.',
          'They\'re singing. Badly.',
        ],
        offers: [
          { name: 'Let them sing', line: 'The diggers work to the beat.', boon: { dig: 1.5 } },
          { name: 'Take the shelves down', line: 'Bone by the cartload.', boon: { bones: 1.7 } },
        ],
      },
    ],
    rey: [
      {
        title: 'The miners\' shrine',
        lines: [
          'A little horned statue in a niche. Someone left him cigar stubs and a cup that still smells of rum.',
          'There\'s a pile of silver at his feet.',
        ],
        offers: [
          { name: 'Leave him a gift', line: 'He likes you now. Everything sells higher.', boon: { value: 1.6 } },
          { name: 'Take the silver', line: 'An hour of income, right now.', boon: { windfall: 3600 } },
        ],
      },
      {
        title: 'The flooded drift',
        lines: [
          'An old mine tunnel, knee deep in something that shines like a mirror. It\'s quicksilver.',
          'The ore carts are still on the rails, still loaded.',
        ],
        offers: [
          { name: 'Push the carts out', line: 'Sell what the old miners left behind.', boon: { windfall: 2400, value: 1.2 } },
          { name: 'Drain it', line: 'The floor under it gives way faster.', boon: { face: 1.8 } },
        ],
      },
    ],
    dona: [
      {
        title: 'The long table',
        lines: [
          'A banquet table set for a hundred. Every chair has a skeleton in it and every plate is full.',
          '"Sit! Sit! Nobody ever leaves this party."',
        ],
        offers: [
          { name: 'Pull up a chair', line: 'Her guests lend a hand.', boon: { diggers: 2 } },
          { name: 'Take the silverware', line: 'Solid gold forks. Everything sells higher.', boon: { value: 1.6 } },
        ],
      },
      {
        title: 'The dance floor',
        lines: [
          'Candles on every step, marigolds everywhere, and the dead dancing in pairs.',
          'The band waves at you with bony hands.',
        ],
        offers: [
          { name: 'Dance', line: 'Everyone digs faster after a dance.', boon: { dig: 1.6 } },
          { name: 'Hire the band', line: 'The dead dig to the music, and more of them get up for it.', boon: { soft: 1.5 } },
        ],
      },
    ],
    sepulturero: [
      {
        title: 'His other shaft',
        lines: [
          'A second shaft, cut from below, running up to meet yours.',
          'The walls are neat. Better than yours, honestly.',
        ],
        offers: [
          { name: 'Use his shaft', line: 'Digging down goes faster.', boon: { face: 2 } },
          { name: 'Take his tools', line: 'Good shovels, well kept.', boon: { dig: 1.5 } },
        ],
      },
      {
        title: 'The headstone yard',
        lines: [
          'A room full of blank headstones, stacked like plates.',
          'One of them already has your name on it. The date is blank.',
        ],
        offers: [
          { name: 'Sell the stone', line: 'Fine marble. Everyone wants it.', boon: { value: 1.7 } },
          { name: 'Break yours', line: 'You feel better. So do the diggers.', boon: { dig: 1.3, face: 1.4 } },
        ],
      },
    ],
    neb: [
      {
        title: 'The hall of scales',
        lines: [
          'A hall of brass scales, a feather on every one.',
          'Every scale tips toward you as you walk past.',
        ],
        offers: [
          { name: 'Weigh the gold', line: 'Everything is worth more on these scales.', boon: { value: 1.7 } },
          { name: 'Weigh the dead', line: 'The light ones stand up and dig.', boon: { diggers: 1.2, bones: 1.3 } },
        ],
      },
      {
        title: 'The painted tomb',
        lines: [
          'Walls painted with jackals, boats and a long line of the dead waiting their turn.',
          'The last figure in the line has a spade. It looks like one of yours.',
        ],
        offers: [
          { name: 'Copy the map', line: 'The paint shows where to dig. Digging down goes faster.', boon: { face: 1.8 } },
          { name: 'Scrape the paint', line: 'Lapis and gold leaf, sold by the pound.', boon: { windfall: 3000 } },
        ],
      },
    ],
    natron: [
      {
        title: 'The drying room',
        lines: [
          'Rows of bodies on stone slabs, packed in white salt.',
          'They\'ve been drying for three thousand years. They\'re nearly ready.',
        ],
        offers: [
          { name: 'Wake them early', line: 'Salted dead dig all day.', boon: { diggers: 1.5, dig: 1.2 } },
          { name: 'Take the salt', line: 'Salt sells anywhere.', boon: { value: 1.6 } },
        ],
      },
      {
        title: 'The jar room',
        lines: [
          'Shelves of stone jars, each with a little carved head on the lid.',
          'Something inside one of them is knocking.',
        ],
        offers: [
          { name: 'Open the jars', line: 'What was kept is yours now.', boon: { bones: 1.8 } },
          { name: 'Leave them sealed', line: 'She appreciates it. The ground gives easier.', boon: { face: 1.5, dig: 1.2 } },
        ],
      },
    ],
    mortifer: [
      {
        title: 'The warm gate',
        lines: [
          'An archway of black stone, warm to the touch, standing in the middle of the room with no wall around it.',
          'Walk through it and you come out the other side of the same room. The diggers won\'t go near it.',
        ],
        offers: [
          { name: 'Walk through', line: 'The dead will follow you anywhere after that.', boon: { soft: 1.8 } },
          { name: 'Break it', line: 'Black stone sells for a fortune.', boon: { value: 1.8 } },
        ],
      },
      {
        title: 'The waiting line',
        lines: [
          'A line of the dead, shoulder to shoulder, going down a stair farther than your lamp reaches.',
          'They step aside to let your diggers pass. Somebody told them you were coming.',
        ],
        offers: [
          { name: 'Join the line', line: 'A few hundred of them join yours instead.', boon: { diggers: 2.5 } },
          { name: 'Cut ahead', line: 'Your crew takes the fast way down.', boon: { face: 2.2 } },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // THE LORDS - who is under the hill. Numbers live in config.lords.
  //
  // `meet` is what a lord says the first time a player ever breaks his door;
  // `again` is what he says every time after. `gifts` line up with
  // config.lords.list[id].gifts: a name for the button and a line that says
  // what it does. `trophy` is what the first meeting leaves the player for
  // good, and `rule` is what his ten layers do while the dig is in them.
  // -------------------------------------------------------------------------
  lords: {
    rex: {
      his: 'his',
      name: 'Rex Mortis',
      meet: [
        '"So. Somebody finally dug down to me."',
        '"I am Rex Mortis. This hill is my grave, and those are my people you\'ve been putting to work."',
        '"Keep them, they were bored. But the ground under me belongs to others, and they\'re less friendly."',
      ],
      again: ['"You again. Take them. They like you better anyway."'],
      rule: 'The first ten layers. Nothing strange yet.',
      gifts: [
        { name: 'His war band', line: 'They climb out of the floor and pick up spades.' },
        { name: 'His bronze', line: 'Bronze tools from his grave. Everyone digs 2x faster.' },
      ],
      trophy: { name: 'Rex Mortis\'s crown', line: 'Every barrow starts 3 layers down.' },
      power: { name: 'Rex Mortis\'s banner', line: 'Every layer you break into brings up new diggers, as many as 5 minutes of bones would raise.' },
      artifact: { name: 'Rex Mortis\'s war horn', line: 'Past layer 50 your crew digs down 2x faster.' },
    },
    pater: {
      his: 'his',
      name: 'Pater Ossium',
      meet: [
        '"Careful. You\'re standing on my children."',
        '"I am Pater Ossium. Every bone under these hills is sorted, counted and mine. You\'ve been borrowing."',
        '"Take what you like. There\'s always more of the dead than the living."',
      ],
      again: ['"Back for more of my children? Count them on your way out."'],
      rule: '3x the bones in his layers, but what you dig sells for less.',
      gifts: [
        { name: 'Open his bone houses', line: '2x the bones for the rest of this barrow.' },
        { name: 'His blessing', line: 'Every bone raises 2x as many diggers.' },
      ],
      trophy: { name: 'Pater Ossium\'s throne', line: 'A cart of bones every time you break a layer.' },
      power: { name: 'Pater Ossium\'s charnel', line: 'The ground gives up 2x the bones.' },
      artifact: { name: 'Pater Ossium\'s reliquary', line: 'Past layer 50 the ground gives up 3x the bones.' },
    },
    rey: {
      his: 'his',
      name: 'Rey Muerto',
      meet: [
        '"Ay, a visitor! The miners used to bring me cigars and a little something to drink."',
        '"I am Rey Muerto, and everything that shines under these hills is mine. You brought me diggers who don\'t breathe. Even better."',
        '"Go on. Take some silver up with you. Sell it high."',
      ],
      again: ['"My favorite thief! Sell it high."'],
      rule: 'Everything in his layers is worth 2.2x.',
      gifts: [
        { name: 'His silver', line: 'Everything sells for 2x.' },
        { name: 'His miners', line: 'His miners never stopped. Everyone digs 2x faster.' },
      ],
      trophy: { name: 'Rey Muerto\'s lamp', line: 'Every layer down to the next door is named.' },
      power: { name: 'Rey Muerto\'s mint', line: 'Everything sells for 2x.' },
      artifact: { name: 'Rey Muerto\'s coin press', line: 'Past layer 50 everything sells for 3x.' },
    },
    dona: {
      his: 'her',
      name: 'Doña Calavera',
      meet: [
        '"Finally, company! Down here it\'s a party every night and nobody ever leaves."',
        '"I am Doña Calavera. Your dead have terrible manners. I love them."',
        '"Take something from the table. It\'s a celebration."',
      ],
      again: ['"You came back to the party! Everyone, look who\'s here."'],
      rule: 'Callers come up the track 2x as often while you dig her layers.',
      gifts: [
        { name: 'Her table', line: 'An hour of income right now, and everything sells for 50% more.' },
        { name: 'Her guests', line: 'They follow you up the shaft and start digging.' },
      ],
      trophy: { name: 'Doña Calavera\'s candle', line: 'Callers wait at the gate until you answer them.' },
      power: { name: 'Doña Calavera\'s guest list', line: 'Callers come 2x as often and pay 2x.' },
      artifact: { name: 'Doña Calavera\'s mask', line: 'Past layer 50 every lord\'s door breaks 2x faster.' },
    },
    sepulturero: {
      his: 'his',
      name: 'El Sepulturero',
      meet: [
        '"You dig down. I dig up. We were bound to meet in the middle."',
        '"I am El Sepulturero. Forty years I\'ve been cutting graves, and you\'re the first to cut into mine."',
        '"Take my shovel if you want. I have others."',
      ],
      again: ['"Middle of the tunnel again. We have to stop meeting like this."'],
      rule: 'He dug half of it already: floors in his layers are half as thick.',
      gifts: [
        { name: 'His tunnels', line: 'They run deep. Digging down is 2.5x faster.' },
        { name: 'His crew', line: 'They join yours. Everyone digs 2x faster.' },
      ],
      trophy: { name: 'El Sepulturero\'s shovel', line: 'Every lord\'s door breaks 2x faster.' },
      power: { name: 'El Sepulturero\'s night crew', line: 'Digging down is 2x faster.' },
      artifact: { name: 'El Sepulturero\'s lantern', line: 'Past layer 50 your crew digs down 2x faster.' },
    },
    neb: {
      his: 'his',
      name: 'Neb-Amenti',
      meet: [
        '"Stand on the scale."',
        '"I am Neb-Amenti, Lord of the West. Everything that comes down here gets weighed. Hearts, gold, diggers. You\'re lighter than I expected."',
        '"Your dead passed. Barely. Take your reward."',
      ],
      again: ['"On the scale. Same as last time."'],
      rule: 'Everything in his layers sells for 3x, but the ground is 1.5x as hard.',
      gifts: [
        { name: 'His gold', line: 'Everything sells for 2.5x.' },
        { name: 'His scales', line: 'Everything sells for 50% more, and everyone digs 2x faster.' },
      ],
      trophy: { name: 'Neb-Amenti\'s scales', line: 'Filling in pays 50% more relics.' },
      power: { name: 'Neb-Amenti\'s measure', line: 'Everyone digs 2x faster.' },
      artifact: { name: 'Neb-Amenti\'s plumb line', line: 'Past layer 50 everyone digs 2x faster.' },
    },
    natron: {
      his: 'her',
      name: 'Mother Natron',
      meet: [
        '"Wipe your feet. I just salted these floors."',
        '"I am Mother Natron. I dried and wrapped every king who ever lay under these hills, and they keep forever."',
        '"Yours won\'t keep at all, the way you work them. Here. Let me help."',
      ],
      again: ['"Wipe your feet."'],
      rule: 'Salt cuts easy: her layers dig 1.7x faster.',
      gifts: [
        { name: 'Her wrappings', line: 'Every bone raises 2.5x as many diggers.' },
        { name: 'Her salts', line: '2x the bones for the rest of this barrow.' },
      ],
      trophy: { name: 'Mother Natron\'s jar', line: '1 in 100 of your diggers comes with you to the next barrow.' },
      power: { name: 'Mother Natron\'s salt', line: 'While you\'re away the dead dig at 90% of full speed instead of 75%.' },
      artifact: { name: 'Mother Natron\'s hook', line: 'Past layer 50 every lord\'s door breaks 2x faster.' },
    },
    mortifer: {
      his: 'his',
      name: 'Mortifer',
      meet: [
        '"Well done. Truly. Fifty layers, and every spadeful dug by someone I sent you."',
        '"You thought you were raising the dead. They were coming home. You just handed them shovels."',
        '"I am Mortifer. Every lord you broke answers to me. Now, so do you."',
        '"Go back up. Fill your hill in. Dig another. I\'ll be here, a little deeper every time."',
        'That was the bottom of the first round. From here every lord comes back, harder, and pays more.',
      ],
      again: ['"Back again? Good. The dead missed you."'],
      rule: 'His layers are worth 2x and hold 2x the bones, but the ground is 40% harder.',
      gifts: [
        { name: 'His fire', line: 'Everyone digs 3x faster and digs down 2x faster.' },
        { name: 'His hoard', line: 'Everything sells for 3x, and 2x the bones.' },
      ],
      trophy: { name: 'Mortifer\'s ring', line: 'Every lord\'s hoard is 2x bigger.' },
      power: { name: 'Mortifer\'s call', line: 'The dead raise themselves: every spare bone stands up as a digger. Auto-raise, by the raise buttons, turns it off.' },
      artifact: { name: 'Mortifer\'s key', line: 'Past layer 50 everyone digs 2x faster, and your crew digs down 2x faster.' },
    },
  },

  // What a pass around the lords puts on them. Numbers in config.lords.affixes.
  affixes: {
    elder:     { name: 'Elder',      line: 'Door 2x as thick, hoard 2x as big.' },
    crowned:   { name: 'Crowned',    line: 'Door 3x as thick, hoard 3x as big.' },
    hungry:    { name: 'Hungry',     line: 'Eats 1% of your diggers at the door every minute.' },
    ironbound: { name: 'Iron-Bound', line: 'Door 2.5x as thick, hoard 2.5x as big.' },
    jealous:   { name: 'Jealous',    line: 'Everything in these layers sells for half.' },
    wrathful:  { name: 'Wrathful',   line: 'Callers stay away from these layers.' },
  },

  // The door, the hoard and the goal, as the page says them.
  doors: {
    passTitles: ['', 'Twice-Buried', 'Thrice-Buried'],
    passMany: 'Buried {n} Times',
    doorTag: '\'s door',
    broke: 'BROKE THROUGH: {Name}\'s door. {His} hoard: {coin} coin and {n} relics.',
    trophy: 'You keep {Name} for good: {line}',
    artifact: 'You take {Name}. {line}',
    artifactMore: '{Name} again: you have {n} now, and each one counts. {line}',
    newDepth: 'Deepest yet: +{relics} relics.',
    crew: 'Biggest crew yet: +{relics} relics.',
    rankUp: 'RANK UP: you\'re {name} now.',
  },

  // The hills a barrow can be dug in. Numbers in config.hills.
  hills: {
    plain:   { name: 'A plain hill',      line: 'Nothing strange about it.' },
    drowned: { name: 'A drowned hill',    line: '2x the bones, but floors are 1.3x as thick.' },
    kings:   { name: 'A king\'s hill',    line: 'Everything is worth 1.6x, but floors are 1.25x as thick.' },
    plague:  { name: 'A plague hill',     line: 'Every bone raises 2x as many diggers, but prices are 0.8x.' },
    burned:  { name: 'A burned hill',     line: 'Everything sells for 1.4x, but callers come half as often.' },
    road:    { name: 'A hill by the road', line: 'Callers come 2x as often, but prices are 0.85x.' },
    stony:   { name: 'A stony hill',      line: 'Everything is worth 2x, but digging is 1.5x as hard.' },
    soft:    { name: 'A soft hill',       line: 'Digging goes 1.4x as fast, but prices are 0.75x.' },
    pick:    'Fill in, then dig next at:',
    here:    'This hill: {name}. {line}',
  },

  // What each rank hands over, in the order config.ranks.keys lists them.
  rankKeys: {
    startDeeper: 'Every barrow starts 1 layer deeper.',
    clearFinds: 'Clearing a layer turns up 2x the finds.',
    hillTwo:   'When you fill in, pick your next hill from 2.',
    hillThree: 'When you fill in, pick your next hill from 3.',
    readTwo:   'You always see 2 layers down.',
    openMore:  'Every barrow keeps 1 more old layer open.',
    autoBuy:   'Coin upgrades can buy themselves.',
    assay:     'Every barrow starts with See One Layer Down.',
    doorsEasy: 'Every lord\'s door breaks 25% faster.',
    autoSeal:  'A barrow can fill itself in at a layer you pick.',
    hoardPlus: 'Every lord\'s hoard is 50% bigger.',
    bothGifts: 'Lords give you both of their gifts.',
    lordHoard: 'You\'re a lord of the dead yourself: every hoard is 2x bigger.',
  },

  // -------------------------------------------------------------------------
  // FINDS - what the crew turns up as it digs a layer out
  //
  // One is picked for each find from the seed, the layer and the mark.
  // -------------------------------------------------------------------------
  finds: {
    items: [
      'a pot of old coins',
      'a bronze brooch',
      'a jar of teeth',
      'a rusted sword',
      'a gold ring still on the finger',
      'a lead coffin nobody paid for',
      'a purse of silver',
      'a carved bone comb',
      'a helmet with a hole in it',
      'a sack of burial gifts',
      'a silver cup',
      'a string of amber beads',
      'a chest of pay that never reached the soldiers',
      'a bishop\'s ring',
      'a pocket watch, still ticking',
      'a pile of old spades, still sharp',
    ],
    found:   'The crew turns up {item} in the {name}. +{coin} coin.',
    cleared: 'The {name} layer is dug out. In the last of it, {item}: +{coin} coin and +{bones} bones.',
  },

  // -------------------------------------------------------------------------
  // VISITORS - who comes up the track while the work goes on
  //
  // One at a time, at long irregular gaps. Every one is an offer with two
  // answers and no clock the player has to beat: they wait a good while and
  // if they leave, another comes. Nothing here punishes being away.
  // -------------------------------------------------------------------------
  visitors: {
    buyer: {
      name: 'A buyer',
      lines: [
        '"I\'ll pay {mult}x for {name}. As much as your crew can dig while I\'m here."',
        '"There\'s a jeweler in town who can\'t get enough {name}. {mult}x what it\'s worth."',
        '"My client wants {name}, and he doesn\'t haggle. {mult}x its worth."',
        '"I\'ve got an empty cart and a long road. Fill it with {name} and I\'ll pay {mult}x."',
        'A woman in a good coat asks after your {name}. "{mult}x its worth, for all you can dig."',
      ],
      offer: 'For the next {t}, every bit of {name} the crew digs sells for that. Put diggers on the {name} layer to make the most of it.',
      take: 'Deal',
      pass: 'No thanks',
      taken: 'Deal. For {t}, {name} sells for {mult}x.',
      passed: 'The buyer rides off.',
      lasting: 'A buyer pays {x}x for {name}, {t} left.',
    },
    bonecart: {
      name: 'A bone cart',
      lines: [
        '"Churchyard\'s being cleared. Bones by the cartload, cheap."',
        '"Don\'t ask where these came from."',
        '"Fresh from a plague pit. Well. Not fresh."',
        '"The monks ran out of room in the crypt. Their loss."',
        '"My brother took the good horse and left me this lot. Buy it so I can go home."',
      ],
      offer: '{N} bones on the cart, for {coin} coin.',
      take: 'Buy the load',
      pass: 'No thanks',
      taken: '+{N} bones.',
      passed: 'The cart rolls on to the next buyer.',
    },
    gang: {
      name: 'A work gang',
      lines: [
        '"We need work. We\'re not picky."',
        '"The pits on the coast closed. We\'ll dig for you."',
        '"Somebody sent us. Didn\'t say who."',
        'A line of gray, quiet men comes up the track. None of them will say where they\'re from.',
        '"We heard you never pay and never let anybody go home. We\'re in."',
      ],
      offer: '{N} of them, and they work for free.',
      take: 'Hire them',
      pass: 'No work here',
      taken: '+{N} diggers. They go down the shaft and don\'t come back up.',
      passed: 'They walk back down the track.',
    },
    reeve: {
      name: 'The tax man',
      lines: [
        '"The county wants its cut of whatever you\'re digging up."',
        '"Noise complaints. A small payment makes them go away."',
        '"I have a warrant to see your books. Or you could just pay me."',
        '"Digging on the king\'s land takes the king\'s leave. His leave costs money."',
        '"Somebody complained about the smell. I\'m sure we can sort it out."',
      ],
      offer: 'He wants {coin} coin. Pay him and everything sells for 18% more this barrow. Refuse and he has your carts stopped at the county line for a while.',
      take: 'Pay him',
      pass: 'Slam the gate',
      taken: 'Paid the tax man {coin}. Everything sells for 18% more.',
      passed: '"You\'ll regret that." Your carts are stopped at the county line: everything sells for 30% less for 10 minutes.',
      lasting: 'Carts stopped at the county line: everything sells for {x}x, {t} left.',
    },
    relic: {
      name: 'A peddler',
      lines: [
        '"Dug it out of a hill just like yours. Could be anything."',
        '"Wrapped it myself. No peeking till you pay."',
        '"Came out of your own field last year. Want it back?"',
        '"My granny swore by it. She lived to a hundred and two."',
        '"Found it in a dead man\'s pocket. He won\'t miss it."',
      ],
      offer: 'He wants {coin} coin for it. You find out what it does after you buy it.',
      take: 'Buy it',
      pass: 'No thanks',
      taken: 'The peddler\'s charm: {boon}',
      passed: 'He wraps it back up and leaves.',
    },
    surveyor: {
      name: 'A surveyor',
      lines: [
        '"I\'ve walked your field with my rod. I know what\'s down there."',
        '"Want to know what\'s under you? I charge by the layer."',
        '"Forty years sinking shafts for the crown. I can read your ground."',
        '"I can tell what\'s under a field by the way the grass grows. Try me."',
      ],
      offer: 'He\'ll name your next {n} layers for {coin} coin.',
      reading: 'Below you: {name}.',
      take: 'Pay him',
      pass: 'I\'ll find out',
      taken: '{Reading}',
      passed: 'He rolls up his charts and leaves.',
    },
    // Each of these goes with what happens after: what they leave, what they
    // do if there's nothing to leave, and how they go if they're sent home.
    mourner: {
      name: 'A mourner',
      lines: [
        { say: 'A woman stands at the edge of the hole a long time. She doesn\'t say anything.',
          taken: 'When she\'s gone there\'s {coin} coin on the heap where she stood.',
          nothing: 'She stays a while longer, then goes.',
          passed: 'She goes without a word.' },
        { say: '"Have you found a man named Tom? He\'d be about my age. Well. He was."',
          taken: '"If you find him, give him this." She leaves {coin} coin.',
          nothing: '"If you find him, tell him I came." She goes.',
          passed: 'She goes to ask at the next hill.' },
        { say: 'An old man asks if he can sit by the hole a while.',
          taken: 'He sits till dark, then leaves {coin} coin on the heap for the crew.',
          nothing: 'He sits till dark and goes home.',
          passed: 'He nods and goes, slowly.' },
        { say: '"My husband\'s in your crew. The tall one. Is he working hard?"',
          taken: '"Good. He never did at home." She leaves {coin} coin.',
          nothing: '"Good. He never did at home." She goes.',
          passed: '"Tell him I asked." She goes.' },
        { say: 'A boy with a fistful of flowers asks which way is down.',
          taken: 'He drops the flowers down the shaft. His father leaves {coin} coin at the gate.',
          nothing: 'He drops the flowers down the shaft and runs home.',
          passed: 'He throws the flowers over the gate and runs off.' },
      ],
      take: 'Let them stay',
      pass: 'Send them home',
      taken: 'They leave {coin} coin on the heap.',
      nothing: 'They stay a while, look down the hole, and go.',
      passed: 'They go quietly.',
    },
    preacher: {
      name: 'A preacher',
      lines: [
        '"Let me say a few words over your dead. A coin for the hat, if you can spare it."',
        '"I buried half this parish. Least I can do is pray over the other half."',
        'A preacher in a coat gone green with age asks to bless the hole.',
        '"Your crew needs praying for, friend. So does my supper."',
      ],
      offer: 'He asks {coin} coin, and the crew finds {x}x the bones for {t}.',
      take: 'Pay him',
      pass: 'Not today',
      taken: 'He prays over the hole till he\'s hoarse. The crew finds {x}x the bones for {t}.',
      passed: '"Suit yourself." He walks on.',
      lasting: 'Prayed over: {x}x bones, {t} left.',
    },
    tinker: {
      name: 'A tinker',
      lines: [
        'A tinker with his tools on his back asks if your spades need sharpening.',
        '"Your dead are digging with the tools they were buried with. Let me sharpen those."',
        '"Blunt spades, the lot of them. I could hear it from the road."',
        '"Every spade on the hill, sharp as the day it was made. Won\'t take long."',
      ],
      offer: 'He charges {coin} coin, and the crew digs {x}x as fast for {t}.',
      take: 'Pay him',
      pass: 'Not today',
      taken: 'He works down the line sharpening spades. The crew digs {x}x as fast for {t}.',
      passed: 'He shoulders his tools and walks on.',
      lasting: 'Sharp spades: {x}x digging, {t} left.',
    },
    cups: {
      name: 'A man with three cups',
      lines: [
        'A man sets three cups and a pea on your gatepost. "Find the pea. Easy money."',
        '"Care for a game while your dead do the work?"',
        '"Three cups, one pea. You look like a lucky sort."',
        '"Keep your eye on the pea. That\'s all there is to it."',
      ],
      offer: 'Bet {coin} coin. Find the pea and he pays you {x}x that. Miss and he keeps it.',
      take: 'Bet',
      pass: 'Walk away',
      won: 'You find the pea. He pays {coin} coin and doesn\'t look happy about it.',
      lost: 'Empty cup. He pockets your {stake} coin and is down the road before you look up.',
      passed: 'He scoops up his cups and tries the next farm.',
    },
    collector: {
      name: 'A collector',
      lines: [
        { say: '"Your crew turned up a ring with a name cut inside it. I collect those."',
          taken: 'He pays {coin} coin for the ring.',
          passed: 'He trades {n} relics for the ring.' },
        { say: '"That little clay horse by your spoil heap is older than the church. I\'d like it."',
          taken: 'He pays {coin} coin for the clay horse.',
          passed: 'He trades {n} relics for the clay horse.' },
        { say: '"There\'s a coin in your spoil with a king on it nobody\'s heard of. I\'ll buy it."',
          taken: 'He pays {coin} coin for the old coin.',
          passed: 'He trades {n} relics for the old coin.' },
        { say: '"One of your diggers has a silver tooth. I don\'t suppose he needs it."',
          taken: 'He pays {coin} coin for the tooth. The digger doesn\'t notice.',
          passed: 'He trades {n} relics for the tooth. The digger doesn\'t notice.' },
      ],
      offer: 'He\'ll pay {coin} coin for it, or {n} relics.',
      take: 'Take the coin',
      pass: 'Take the relics',
      taken: 'He pays {coin} coin for it.',
      passed: 'He trades {n} relics for it.',
    },
    herald: {
      name: '{Lord}\'s herald',
      lines: [
        '"{lord} has heard you digging. He\'d rather you came in by the door than through the wall."',
        'A herald in {lord}\'s colors stops at the gate. "My lord keeps a side door. For a fee."',
        '"I carry {lord}\'s keys. Not all of them. Enough of them."',
        '"{lord} is expecting you. Might as well make it quick."',
      ],
      offer: 'He wants {coin} coin, and your crew breaks {lord}\'s door {pct}% faster.',
      take: 'Pay him',
      pass: 'Send him back',
      taken: 'The herald goes down the shaft ahead of your crew. {lord}\'s door breaks {pct}% faster.',
      passed: 'The herald goes back down the track to tell {lord}.',
    },
  },

  // -------------------------------------------------------------------------
  // RITES - what coin buys. The numbers live in config.rites.
  //
  // `line` is what the row shows and has to fit a narrow column on a narrow
  // window; `long` is the whole sentence, and it is what the row says when it
  // is hovered. Nothing important may live only in the long one.
  // -------------------------------------------------------------------------
  rites: {
    hands:     { name: 'Sharper Spades', line: '+50% dig speed',
                 long: 'Every level: the dead dig 50% faster.' },
    grave:     { name: 'More From a Bone', line: '+50% diggers per bone',
                 long: 'Every level: each bone raises 50% more diggers.' },
    picks:     { name: 'Better Picks',   line: '+25% dig-down speed',
                 long: 'Every level: breaking through floors is 25% faster.' },
    assay:     { name: 'See One Layer Down', line: 'Know the next layer early',
                 long: 'Shows the layer under the floor, and what it is like, before you break into it.' },
    workings:  { name: 'Keep a Layer Open', line: '+1 old layer kept working',
                 long: 'Every level: the dead keep one more old layer working instead of leaving it.' },
    crier:     { name: 'Town Crier',     line: 'Callers come sooner, pay more',
                 long: 'Every level: callers come up the track 15% sooner and pay 25% more.' },
    vigil:     { name: 'Night Shift',    line: '+4 hours digging while away',
                 long: 'The dead dig for 12 hours while you are away, plus 4 more hours per level.' },
    survey:    { name: 'See Five Layers Down', line: 'See the next 5 layers',
                 long: 'Names the next five layers and what they are like, on the Digging down row and on the hill.' },
    records:   { name: 'Keep the Books', line: '+3 relics when you fill in',
                 long: 'Every level: filling this barrow in pays 3 more relics.' },
    pits:      { name: 'Dig Up the Burials', line: '+40% bones found',
                 long: 'Every level: the ground gives up 40% more bones. Stops at 12 levels.' },
  },

  // -------------------------------------------------------------------------
  // FILLING IT IN - ending a run and starting the next one. The code calls
  // this the seal; the player fills the hole in and walks away with relics.
  // -------------------------------------------------------------------------
  seal: {
    title: 'Fill it in',
    button: 'Fill In This Barrow',
    confirm: 'Sure? Relics, rank, trophies and artifacts carry on. Everything else is buried.',
    notYet: 'Not yet',
    locked: 'Reach layer {depth} to fill this barrow in for relics.',
    ready: 'Filling in ends this barrow. Coin, diggers, layers and coin upgrades are buried with it. Relics, rank, trophies and artifacts carry on to the next hill.',
    yieldNow: 'Fill in now for {n} relics.',
    yieldPaid: 'Paid {n} relics.',
    oathsNote: 'Bought with relics. Kept in every barrow from now on.',
    doneLines: [
      'You fill it in from the bottom up. By spring it\'s a field again.',
      'The last cart goes out, the shaft goes in, and the grass grows back.',
    ],
    openLines: [
      'New hill, three valleys over. The ground there is soft too.',
      'On to the next hill. You know what\'s under it now.',
    ],
    statLine: 'Barrow {n} filled in: layer {depth}, {coin} coin, {horde} diggers.',
    // The card the next barrow opens with.
    ending: {
      title: 'Barrow {n} filled in',
      depth: 'Reached layer {depth}. Your best is layer {best}.',
      best: 'Reached layer {depth}. That\'s your best yet.',
      lords: 'Lords broken: {n}.',
      noLords: 'No lords broken this time.',
      paid: 'Filling in paid {n} relics. You\'re {rank} now.',
      totals: 'Earned {coin} coin and raised {horde} diggers.',
      button: 'On to the next hill',
    },
    record: 'Barrow {n}: layer {depth}, {lords} lords, {relics} relics.',
    recordTitle: 'Your barrows',
  },


  // -------------------------------------------------------------------------
  // OATHS - what relics buy, and what carries from one barrow to the next.
  // The numbers live in config.oaths.
  // -------------------------------------------------------------------------
  oaths: {
    dead:    { name: 'Head Start',     line: 'Start every barrow with 8 diggers',
               long: 'Every barrow starts with diggers already working, 4x more per level.' },
    ground:  { name: 'Start Deeper',   line: 'Start every barrow 1 layer down',
               long: 'Every barrow starts 1 more layer down per level, never past the first lord\'s door.' },
    books:   { name: 'Old Habits',     line: 'Start with your first upgrades',
               long: 'Every barrow starts with See One Layer Down, then Town Crier, then Night Shift, one per level.' },
    hands:   { name: 'Strong Hands',   line: '+35% dig speed, every barrow',
               long: 'The dead dig 35% faster per level, in every barrow from now on.' },
    marrow:  { name: 'Deep Marrow',    line: '+40% diggers per bone, every barrow',
               long: 'Each bone raises 40% more diggers per level, in every barrow from now on.' },
    roads:   { name: 'Old Roads',      line: 'Everything sells for 35% more, every barrow',
               long: 'Every level: everything the dead dig sells for 35% more, in every barrow.' },
    purse:   { name: 'Nest Egg',       line: 'Start every barrow with 500 coin',
               long: 'Every barrow starts with coin in hand, 8x more per level.' },
    night:   { name: 'Long Nights',    line: '+8 hours digging while away',
               long: 'The dead dig 8 hours longer per level while you are away, in every barrow.' },
    calling: { name: 'Known Name',     line: 'Callers 18% sooner, pay 25% more',
               long: 'Callers come up the track 18% sooner and pay 25% more per level, in every barrow.' },
    depth:   { name: 'Deep Picks',     line: '+35% dig-down speed, every barrow',
               long: 'Breaking through floors is 35% faster per level, in every barrow.' },
  },
};

/** Everything a run needs from the writing, gathered so nothing else imports it twice. */
export default CONTENT;
