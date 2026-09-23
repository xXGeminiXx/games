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
    sellShown: [
      'The builders in town will buy that soil.',
    ],
    firstSale: [
      'Your first coin.',
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
      'Buyers in town want {name}.',
    ],
    marketShown: [
      'Every sale pushes a price down. It climbs back in about a minute.',
    ],
    buckled: [
      'Too much {name} at once. The price is on the floor until the buyers get hungry again.',
    ],
    ritesShown: [
      'Coin buys better spades, faster picks and someone to sell for you.',
    ],
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
      'Someone is waiting at the gate.',
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
    thin:     { tag: 'thin',      here: 'a thin seam', line: 'worth 1.8x, but its market takes 0.4x' },
    wide:     { tag: 'wide',      here: 'a wide seam', line: 'its market takes 2.8x more' },
    salted:   { tag: 'salted',    line: 'its price swings 2.8x wider' },
    still:    { tag: 'still',     line: 'worth 1.2x, and the price barely moves' },
    hollow:   { tag: 'hollow',    line: 'the floor under it is 0.35x as thick' },
    sealed:   { tag: 'sealed',    here: 'sealed off', line: 'worth 1.7x, behind a floor 2.6x as thick' },
    flooded:  { tag: 'flooded',   line: '2.2x the bones, worth 1.4x, 2x as hard to dig' },
    burnt:    { tag: 'burnt',     line: 'worth 1.9x, but its market takes 0.7x' },
  },


  // -------------------------------------------------------------------------
  // CHAMBERS - the story, one room at a time
  //
  // Every few strata the dead do not break into a layer, they break into a
  // room. A chamber is a scene and a choice of two, and the choice is kept
  // for the rest of the run. Chambers are grouped by band, which is how deep
  // the shaft has gone and therefore what kind of place it is passing through.
  //
  // A boon is one of: dig, bones, absorb, value, face, soft (raise cost),
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
            { name: 'Follow it up', line: 'It surfaces two counties over, in a quiet yard that pays.', boon: { absorb: 1.6 } },
          ],
        },
        {
          title: 'The tally wall',
          lines: [
            'One wall is covered in tally marks. Hundreds of thousands of them.',
            'They\'re counting the dead. The count keeps going, down into the floor.',
          ],
          offers: [
            { name: 'Read the wall', line: 'Whatever they counted, it teaches you the price of everything.', boon: { value: 1.5, absorb: 1.3 } },
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
            { name: 'Work around it', line: 'The flanking cuts open four layers at once.', boon: { value: 1.6, absorb: 1.5 } },
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
            { name: 'Go around', line: 'The long way round opens more ground than the short way did.', boon: { value: 2.0, absorb: 1.8 } },
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
          { name: 'Take the silverware', line: 'Solid gold forks. Everything sells higher.', boon: { value: 1.5, absorb: 1.3 } },
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
          { name: 'Sell the stone', line: 'Fine marble. The markets want it.', boon: { value: 1.4, absorb: 1.4 } },
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
          { name: 'Take the salt', line: 'Salt sells anywhere.', boon: { value: 1.3, absorb: 1.6 } },
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
        { name: 'His old buyers', line: 'Every market takes 3x more before the price drops.' },
      ],
      trophy: { name: 'Rey Muerto\'s lamp', line: 'Every layer down to the next door is named.' },
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
      rule: 'Everything in his layers sells for 3x, but the markets fill up fast.',
      gifts: [
        { name: 'His gold', line: 'Everything sells for 2.5x.' },
        { name: 'His scales', line: 'Markets take 2.5x more and pay 50% more.' },
      ],
      trophy: { name: 'Neb-Amenti\'s scales', line: 'Your seller takes no cut.' },
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
    upgrade: 'New upgrade in every barrow from now on: {name} ({line}).',
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
    burned:  { name: 'A burned hill',     line: 'Markets take 2x more, but callers come half as often.' },
    road:    { name: 'A hill by the road', line: 'Callers come 2x as often, but prices are 0.85x.' },
    stony:   { name: 'A stony hill',      line: 'Everything is worth 2x, but digging is 1.5x as hard.' },
    soft:    { name: 'A soft hill',       line: 'Digging goes 1.4x as fast, but prices are 0.75x.' },
    pick:    'Fill in, then dig next at:',
    here:    'This hill: {name}. {line}',
  },

  // What each rank hands over, in the order config.ranks.keys lists them.
  rankKeys: {
    ledger:    'Every barrow starts with Show the Numbers.',
    broker:    'Every barrow starts with Hire a Seller.',
    hillTwo:   'When you fill in, pick your next hill from 2.',
    hillThree: 'When you fill in, pick your next hill from 3.',
    readTwo:   'You always see 2 layers down.',
    foresight: 'Every barrow starts with Prices Ahead.',
    autoBuy:   'Coin upgrades can buy themselves.',
    assay:     'Every barrow starts with See One Layer Down.',
    broker2:   'Your seller starts every barrow at level 2.',
    autoSeal:  'A barrow can fill itself in at a layer you pick.',
    hoardPlus: 'Every lord\'s hoard is 50% bigger.',
    bothGifts: 'Lords give you both of their gifts.',
    lordHoard: 'You\'re a lord of the dead yourself: every hoard is 2x bigger.',
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
        '"I\'ll take all the {name} you\'ve got at {mult}x the yard price. No questions."',
        '"{mult}x what the yard pays for your {name}. Deal?"',
        '"My client wants {name}. {mult}x the going rate, and he doesn\'t haggle."',
      ],
      take: 'Sell',
      pass: 'No thanks',
      taken: 'Sold {n} {name} for {coin} coin.',
      passed: 'The buyer rides off.',
      empty: '"You don\'t have any. Waste of my time."',
    },
    bonecart: {
      name: 'A bone cart',
      lines: [
        '"Churchyard\'s being cleared. Bones by the cartload, cheap."',
        '"Don\'t ask where these came from."',
        '"Fresh from a plague pit. Well. Not fresh."',
      ],
      offer: '{N} bones on the cart.',
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
      ],
      offer: 'Pay him and every market takes 18% more this barrow. Refuse and one market goes cold on you.',
      take: 'Pay him',
      pass: 'Slam the gate',
      taken: 'Paid the tax man {coin}. Every market takes 18% more.',
      passed: '"You\'ll regret that." One market goes cold for a while.',
    },
    relic: {
      name: 'A peddler',
      lines: [
        '"Dug it out of a hill just like yours. Could be anything."',
        '"Wrapped it myself. No peeking till you pay."',
        '"Came out of your own field last year. Want it back?"',
      ],
      offer: 'You find out what it does after you buy it.',
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
      ],
      offer: 'He\'ll name your next {n} layers.',
      reading: 'Below you: {name}.',
      take: 'Pay him',
      pass: 'I\'ll find out',
      taken: '{Reading}',
      passed: 'He rolls up his charts and leaves.',
    },
    mourner: {
      name: 'A mourner',
      lines: [
        'A woman stands at the edge of the hole for a long time. She doesn\'t say anything.',
        '"Have you found a man named Tom? He\'d be about my age. Well. He was."',
        'Someone leaves flowers on the spoil heap and walks away.',
      ],
      take: 'Let them stay',
      pass: 'Send them home',
      taken: 'They leave {coin} coin on the heap on the way out.',
      passed: 'They go quietly.',
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
    ledger:    { name: 'Show the Numbers', line: 'See prices, demand and limits',
                 long: 'Shows what each material usually sells for, how much its market takes and how fast it recovers. Lets you buy back, too.' },
    picks:     { name: 'Better Picks',   line: '+25% dig-down speed',
                 long: 'Every level: breaking through floors is 25% faster.' },
    broker:    { name: 'Hire a Seller',  line: 'Sells for you, takes a cut',
                 long: 'He sells what you dig into each market without crashing the price, for a cut. He never sells bones.' },
    routes:    { name: 'Trade Routes',   line: '+50% market size',
                 long: 'Every level: every market takes 50% more before its price drops.' },
    haste:     { name: 'Quick Buyers',   line: '+25% price recovery',
                 long: 'Every level: prices climb back 25% faster after you sell.' },
    foresight: { name: 'Prices Ahead',   line: 'See where prices are going',
                 long: 'The price charts show where each price is heading, so you can sell at the top.' },
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
    // One from each lord, on the panel for good once his door has been broken.
    muster:    { name: 'Rex\'s Muster',     line: 'New layers bring diggers',
                 long: 'From Rex Mortis. Every level: each layer you break into brings up as many new diggers as 1 minute of bones would raise.' },
    ossuary:   { name: 'Pater\'s Bone Pit', line: '+50% bones found',
                 long: 'From Pater Ossium. Every level: the ground gives up 50% more bones.' },
    mint:      { name: 'Rey\'s Mint',       line: 'Everything sells for 50% more',
                 long: 'From Rey Muerto. Every level: everything sells for 50% more.' },
    invites:   { name: 'Doña\'s Invitations', line: 'Callers come sooner, pay 50% more',
                 long: 'From Doña Calavera. Every level: callers come up the track 50% more often and pay 50% more.' },
    spades:    { name: 'Sepulturero\'s Spades', line: '+50% dig-down speed',
                 long: 'From El Sepulturero. Every level: breaking through floors is 50% faster.' },
    balance:   { name: 'Neb-Amenti\'s Balance', line: '+50% market size',
                 long: 'From Neb-Amenti. Every level: every market takes 50% more before its price drops.' },
    jars:      { name: 'Mother Natron\'s Jars', line: '+1 in 100 diggers kept',
                 long: 'From Mother Natron. Every level: 1 more in 100 of your diggers comes with you to the next barrow.' },
    raising:   { name: 'Mortifer\'s Call',  line: 'The dead raise themselves',
                 long: 'From Mortifer. Every spare bone raises diggers, every second. The Auto-raise switch by the raise buttons turns it off.' },
  },

  // -------------------------------------------------------------------------
  // FILLING IT IN - ending a run and starting the next one. The code calls
  // this the seal; the player fills the hole in and walks away with relics.
  // -------------------------------------------------------------------------
  seal: {
    title: 'Fill it in',
    button: 'Fill In This Barrow',
    confirm: 'Sure? Relics, rank and trophies carry on. Everything else is buried.',
    notYet: 'Not yet',
    locked: 'Reach layer {depth} to fill this barrow in for relics.',
    ready: 'Filling in ends this barrow. Coin, diggers, layers and coin upgrades are buried with it. Relics, rank and trophies carry on to the next hill.',
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
               long: 'Every barrow starts with Show the Numbers, then Prices Ahead, then Hire a Seller, one per level.' },
    hands:   { name: 'Strong Hands',   line: '+35% dig speed, every barrow',
               long: 'The dead dig 35% faster per level, in every barrow from now on.' },
    marrow:  { name: 'Deep Marrow',    line: '+40% diggers per bone, every barrow',
               long: 'Each bone raises 40% more diggers per level, in every barrow from now on.' },
    roads:   { name: 'Old Roads',      line: '+35% market size, every barrow',
               long: 'Every market takes 35% more per level before its price drops, in every barrow.' },
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
