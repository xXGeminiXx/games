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
      'The ground here is soft. It should not be.',
      'There is a hill in this field that nobody has ever ploughed.',
      'The map calls this a mound. It does not say whose.',
      'You bought the field cheap. The hill came with it.',
    ],
    firstDig: [
      'Soil, and it comes up far too easily.',
      'The spade goes in to the shoulder on the first push.',
    ],
    sellShown: [
      'There is a yard in town that buys fill and asks nothing.',
      'The builders in town take clean soil by the cartload.',
    ],
    firstSale: [
      'Coin. The first of it, and it spends.',
      'Coin, counted into your hand at the yard gate.',
    ],
    firstBone: [
      'The sixth spadeful comes up holding a hand. The fingers close.',
      'A hand in the dirt. It is not finished with the work.',
      'Bone, and it moves when the light hits it.',
    ],
    raiseShown: [
      'It wants to be put to work. You find you know how to ask.',
      'There is a way to ask it to stand. Nobody taught you that.',
    ],
    firstRaise: [
      'The first of them climbs out of the hole and starts to dig.',
      'It stands, takes the spade out of your hands, and gets on with it.',
    ],
    faceShown: [
      'There is harder ground under this. Set some of them against it.',
      'The floor of the cut rings like stone. That is the way down.',
    ],
    breakthrough: [
      'The floor gives out onto {name}.',
      'They are through. {Name} under the whole cut.',
      '{Name}. The shovels change their sound.',
      'The last foot comes away wet and there is {name} behind it.',
    ],
    newMarket: [
      'Word gets to town. There are buyers for {name}.',
      'A factor rides out to ask how much {name} you have.',
      '{Name} has a buyer before the first cart is loaded.',
      'The yard sends a boy to ask whether the {name} is for sale.',
    ],
    marketShown: [
      'Prices move on their own. Learn to read them.',
      'The yard pays less each time you come back the same day.',
    ],
    buckled: [
      'You put more {name} on the market than it wanted. The price sits on the floor until it forgets.',
      'The {name} buyers have all they can hold. Come back when they are hungry.',
      'Nobody in the county needs another ounce of {name} today.',
    ],
    ritesShown: [
      'Coin buys more than shovels, if you know who to ask.',
      'There are people who take money to make this go faster. Some of them are alive.',
    ],
    handsDone: [
      'Your hands are done. You keep the books now.',
      'You have not touched a spade in a week and the hole is deeper than ever.',
    ],
    away: [
      'You were gone {t}. They did not stop.',
      'You come back after {t}. The spoil heap has moved twice.',
      '{T} away. The hole went on without you, as it does.',
    ],
    seamFound: [
      'The {name} runs {seam} here.',
      'This {name} is {seam}.',
    ],
    hordeMilestones: [
      [100,    'A hundred of them under the hill.'],
      [1000,   'A thousand. No bird lands in this field any more.'],
      [10000,  'Ten thousand. The ground carries a sound now, low and even.'],
      [100000, 'A hundred thousand. The hill breathes when they change over.'],
      [1e6,    'A million. It is more hole than hill.'],
      [1e8,    'A hundred million. The field is a lid on something.'],
      [1e10,   'Ten billion. More than were ever buried in this country.'],
      [1e13,   'Ten trillion. Whatever is down there, they outnumber it.'],
      [1e16,   'The number stopped meaning anything a while back. They keep digging.'],
    ],
    depthMilestones: [
      [4,  'Four layers. The topsoil is a rumour.'],
      [8,  'Eight. These graves were cut before anyone wrote anything down.'],
      [12, 'Twelve. Nothing here was buried by people who left a name.'],
      [16, 'Sixteen. The walls are cut square. Someone was here first.'],
      [22, 'Twenty two. You have stopped writing down what they bring up.'],
      [30, 'Thirty. The books are the only proof any of this is happening.'],
      [40, 'Forty. There is no word for ground this old.'],
      [55, 'Fifty five. The shaft goes down past anything that was ever alive.'],
    ],
  },

  // -------------------------------------------------------------------------
  // SEAMS - what makes one layer different from the layer above it
  //
  // Every stratum below the surface may carry one of these. It changes one
  // thing about the ground and gives the layer a character the player can
  // work with or work around. `tag` is what the panels show.
  // -------------------------------------------------------------------------
  seams: {
    rich:     { tag: 'rich',     line: 'The seam is fat with it. Every cart comes up loaded.' },
    dense:    { tag: 'dense',    line: 'Hard going, and worth it. What comes out is worth double.' },
    brittle:  { tag: 'brittle',  line: 'It comes apart at a touch. The digging is fast and the pay is thin.' },
    bonefield:{ tag: 'bonefield',line: 'They were tipped in here by the cartload. The ground is more bone than earth.' },
    thin:     { tag: 'thin',     line: 'Rare enough that a handful moves the price and a cartload ruins it.' },
    wide:     { tag: 'wide',     line: 'The whole county wants this. Sell as fast as they can dig it.' },
    salted:   { tag: 'salted',   line: 'The price will not sit still. It swings on rumour.' },
    still:    { tag: 'still',    line: 'A steady price, year in and out. Nobody gets excited about it.' },
    hollow:   { tag: 'hollow',   line: 'Half of it is already open. The floor was never solid.' },
    sealed:   { tag: 'sealed',   line: 'This floor was laid down to keep something on one side of it.' },
    flooded:  { tag: 'flooded',  line: 'Black water to the knee. The dead do not mind and they find more down here.' },
    burnt:    { tag: 'burnt',    line: 'The whole layer went up once. What survived is worth carrying.' },
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
  // of the horde, raised free), rem (remembrance at the seal).
  // -------------------------------------------------------------------------
  chambers: {
    bands: [
      // band 0 - the mound itself, and the people who piled it up
      [
        {
          title: 'The builder',
          lines: [
            'The spades stop. There is a stone box in the middle of the mound, and a man laid out in it with his tools beside him.',
            'He built this hill over somebody else. He has been lying on top of the work for a very long time.',
          ],
          offers: [
            { name: 'Take the tools', line: 'Bronze shoes for the spades. Everything cuts faster.', boon: { dig: 1.35 } },
            { name: 'Raise the builder', line: 'He knows this ground better than you ever will.', boon: { face: 1.6 } },
          ],
        },
        {
          title: 'The grain pit',
          lines: [
            'A pit lined with clay, packed to the top with grain that went black a thousand years ago.',
            'They buried a winter here in case the world ended. The world did not.',
          ],
          offers: [
            { name: 'Sell the lot', line: 'The pottery alone is worth a season of digging.', boon: { windfall: 900 } },
            { name: 'Line the tunnels with it', line: 'Clay walls hold. The cut goes down without shoring.', boon: { face: 1.5 } },
          ],
        },
        {
          title: 'The boundary dead',
          lines: [
            'A ring of them stood upright in the clay, facing out, spaced a pace apart.',
            'They were put here to keep something in, or to keep the neighbours out. Nobody left a note.',
          ],
          offers: [
            { name: 'Break the ring', line: 'They fall in and join the work. All of them at once.', boon: { diggers: 0.6 } },
            { name: 'Leave them standing', line: 'The ones inside dig harder with the ring watching.', boon: { bones: 1.4 } },
          ],
        },
      ],
      // band 1 - older graves, under the mound, that the mound was built to hide
      [
        {
          title: 'The long house',
          lines: [
            'The tunnel opens into a room longer than the field above it, roofed with beams that have not rotted.',
            'The dead are laid head to foot down both walls, in their hundreds, and every one of them is holding a tool.',
          ],
          offers: [
            { name: 'Wake the room', line: 'Hundreds of them stand up at once and reach for the wall.', boon: { diggers: 1.1 } },
            { name: 'Take the roof beams', line: 'Wood that will not rot, sold to men who do not ask.', boon: { windfall: 1800, value: 1.15 } },
          ],
        },
        {
          title: 'The smith',
          lines: [
            'A floor of slag and charcoal, and a hearth still holding its shape.',
            'Somebody worked metal down here when the hill above was still flat ground.',
          ],
          offers: [
            { name: 'Relight the hearth', line: 'Everything the dead carry up is worth more clean than raw.', boon: { value: 1.4 } },
            { name: 'Take the anvil', line: 'The spades come off it sharper than they went on.', boon: { dig: 1.4 } },
          ],
        },
        {
          title: 'The drowned',
          lines: [
            'Black water fills the cut to the waist and does not drain.',
            'There are shapes standing in it, patient, up to their chins. They have been waiting to be asked.',
          ],
          offers: [
            { name: 'Ask them up', line: 'They come out of the water still dripping and go straight to work.', boon: { diggers: 0.8, bones: 1.25 } },
            { name: 'Drain it into the lower cut', line: 'The water eats the floor for you. The way down opens.', boon: { face: 1.8 } },
          ],
        },
      ],
      // band 2 - a shaft. not a grave. somebody cut this on purpose
      [
        {
          title: 'The first shaft',
          lines: [
            'The cut runs into a shaft that is not yours. Square, plumb, tool marks still sharp on the walls.',
            'Somebody sank this from above, a long way above, and stopped at exactly this depth.',
          ],
          offers: [
            { name: 'Follow it down', line: 'Their shaft is better than yours. Use it.', boon: { face: 2.0 } },
            { name: 'Follow it up', line: 'It surfaces two counties over, in a yard that pays well and stays quiet.', boon: { absorb: 1.6 } },
          ],
        },
        {
          title: 'The tally wall',
          lines: [
            'One wall of the chamber is covered end to end in marks. Hundreds of thousands of them, cut small and even.',
            'They are counting something. The count is not finished and the marks go into the floor.',
          ],
          offers: [
            { name: 'Read the wall', line: 'Whatever they were counting, it teaches you the price of everything.', boon: { value: 1.5, absorb: 1.3 } },
            { name: 'Add your own mark', line: 'The hill notices. More of them come up out of the ground unasked.', boon: { bones: 1.7 } },
          ],
        },
        {
          title: 'The ossuary',
          lines: [
            'The chamber is stacked floor to ceiling with bone, sorted by kind. Skulls in one bay, long bones in another.',
            'Someone spent a lifetime tidying the dead into order down here.',
          ],
          offers: [
            { name: 'Empty the bays', line: 'A lifetime of sorting, raised in an afternoon.', boon: { diggers: 1.5 } },
            { name: 'Keep the order', line: 'Work the seams the way they sorted the bones and nothing is wasted.', boon: { bones: 1.9 } },
          ],
        },
      ],
      // band 3 - sealed, deliberately, by people who knew what they were doing
      [
        {
          title: 'The plug',
          lines: [
            'The shaft ends in a single stone the width of the cut, dropped in from above and mortared at the edge.',
            'It was set from the far side. Whoever placed it went down first and stayed there.',
          ],
          offers: [
            { name: 'Break it', line: 'It takes a week and it takes half the horde. The way is open.', boon: { face: 2.6 } },
            { name: 'Work around it', line: 'The flanking cuts open four seams at once.', boon: { value: 1.6, absorb: 1.5 } },
          ],
        },
        {
          title: 'The register',
          lines: [
            'A chamber of shelves, and on the shelves, tablets. Every one is a name and a depth.',
            'The last entries are in a hand you recognise. It is yours, and you have not written them yet.',
          ],
          offers: [
            { name: 'Read to the end', line: 'You learn what this is worth before you dig it.', boon: { value: 1.8 } },
            { name: 'Close the book', line: 'You put it back on the shelf and the hill gets on with it, faster.', boon: { dig: 1.8 } },
          ],
        },
        {
          title: 'The ones who dug down',
          lines: [
            'A work gang, still in a line, still facing the floor, tools still in their hands.',
            'They were digging in the same direction you are. They did not stop either.',
          ],
          offers: [
            { name: 'Put them back to work', line: 'They take up where they left off without being asked twice.', boon: { diggers: 2.0, dig: 1.2 } },
            { name: 'Take what they carried', line: 'The packs are full of things from further down than you have been.', boon: { windfall: 5400, value: 1.3 } },
          ],
        },
      ],
      // band 4 - past any record. the ground stops being ground
      [
        {
          title: 'The floor that is not stone',
          lines: [
            'The face rings wrong. What is under the last layer is warm, and it gives slightly, and it goes on in every direction.',
            'The dead will not stand on it. They dig it holding the walls.',
          ],
          offers: [
            { name: 'Cut into it', line: 'It closes behind them. It does not seem to mind.', boon: { face: 3.0, bones: 1.5 } },
            { name: 'Go around', line: 'The long way round opens more ground than the short way ever did.', boon: { value: 2.0, absorb: 1.8 } },
          ],
        },
        {
          title: 'The count',
          lines: [
            'The walls of this one are marked too. Same hand as the tally wall, a mile up and a thousand years earlier.',
            'The count is nearly finished here. It is counting the dead in your hill, and it is nearly caught up.',
          ],
          offers: [
            { name: 'Finish the count', line: 'You write the last figure yourself. The books have never been cleaner.', boon: { value: 2.2, rem: 12 } },
            { name: 'Break the wall', line: 'The count stops. Everything down here comes up faster.', boon: { dig: 2.2 } },
          ],
        },
        {
          title: 'The older barrow',
          lines: [
            'Below the shaft, below the sealed floor, there is a hill. A mound, buried, with a ditch cut round it.',
            'Somebody piled this up down here, in the dark, where nothing has ever needed a landmark.',
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
        'A man with a good coat and a bad horse wants {name}, and he is paying {mult}x what the yard pays.',
        'A factor from the coast will take {name} off you at {mult}x the going rate. He does not say who for.',
        'A woman with two carts and no name wants every ounce of {name} you have, at {mult}x.',
      ],
      take: 'Sell to them',
      pass: 'Send them off',
      taken: 'The carts go out loaded: {n} {name} for {coin} coin, and no questions on either side.',
      passed: 'They wait an hour at the gate and then they go.',
      empty: 'They look at the empty yard, and at you, and they go.',
    },
    bonecart: {
      name: 'The bone cart',
      lines: [
        'A cart comes up the track full of bone from a churchyard being cleared. The driver wants coin, not talk.',
        'A man is selling the contents of a plague pit by weight. He seems glad to be rid of it.',
        'Two brothers with a wagon have dug up somewhere they should not have. They want it gone tonight.',
      ],
      offer: 'There are {n} bones on it.',
      take: 'Buy the load',
      pass: 'Turn it away',
      taken: '{N} bones tipped in the yard. They are standing before the cart is out of the gate.',
      passed: 'The cart goes on down the road to whoever else is buying.',
    },
    gang: {
      name: 'A work gang',
      lines: [
        'A gang of diggers walks up the track looking for work. They are not particular about what kind.',
        'A dozen men out of the closed pits at the coast are at your gate, asking.',
        'Someone has sent you labour. You did not ask for it and nobody says who did.',
      ],
      offer: 'There are {n} of them, and they want no wage.',
      take: 'Set them on',
      pass: 'No work here',
      taken: 'They go down the shaft. They do not come back up, and {n} more of them are digging.',
      passed: 'They walk back down the track in the rain.',
    },
    reeve: {
      name: 'The reeve',
      lines: [
        'The reeve rides out about the noise. He is owed something, and he will say what once he has been paid.',
        'The county wants a tithe on whatever is coming out of this field.',
        'A clerk with a warrant would like to see the books. He can be talked out of it.',
      ],
      offer: 'Paid, he opens the roads: every market takes more for the rest of this barrow. Refused, one of them turns cold on you.',
      take: 'Pay him',
      pass: 'Shut the gate',
      taken: 'He takes {coin} and rides off. The roads are open to your carts after that.',
      passed: 'He writes something down and rides off. The yards are cool on your goods for a while.',
    },
    relic: {
      name: 'A peddler',
      lines: [
        'A peddler has something wrapped in cloth that he will not unwrap until you name a price.',
        'A thin man is selling a thing he says came out of a hill like this one, three counties over.',
        'Someone is selling back to you something that came out of your own field last year.',
      ],
      offer: 'Nobody says what it does until it is bought.',
      take: 'Buy it',
      pass: 'Let him keep it',
      taken: 'It goes in the yard and the work changes. {Boon}',
      passed: 'It goes back under the cloth and up the track.',
    },
    surveyor: {
      name: 'A surveyor',
      lines: [
        'A surveyor has been walking the field with a rod, and he has worked out what is under it.',
        'A woman with charts wants to tell you what the next layer down is. For a fee.',
        'A man who used to sink shafts for the crown offers to read the ground for you.',
      ],
      offer: 'The next {n} layers get read before you break into them.',
      reading: 'Below the face: {name}.',
      take: 'Hear the reading',
      pass: 'You will find out',
      taken: '{Reading}',
      passed: 'The charts are rolled up and taken back down the track.',
    },
    mourner: {
      name: 'A mourner',
      lines: [
        'A woman comes up the track and stands at the edge of the cut for a long time without saying anything.',
        'An old man asks whether you have turned up a name he gives you. You have not.',
        'Someone leaves flowers on the spoil heap and is gone before anyone gets to the gate.',
      ],
      take: 'Let them look',
      pass: 'Send them home',
      taken: 'They leave something on the heap on the way out. {Coin} coin, and the field is quiet after.',
      passed: 'They go without arguing, which is worse.',
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
    hands:     { name: 'Deeper hands',   line: 'They dig half again as fast.',
                 long: 'Every level of this makes the dead dig half again as fast as they did.' },
    grave:     { name: 'Mass grave',     line: 'Bones go half again as far.',
                 long: 'Every bone raises half again as much of the dead as it did before.' },
    ledger:    { name: 'The ledger',     line: 'The figures under every price.',
                 long: 'The base price, what each market takes, how fast it recovers, how choked it is, and the right to buy at those prices as well as sell.' },
    picks:     { name: 'Grave picks',    line: 'The face gives way faster.',
                 long: 'The floor under the deepest cut gives way a quarter faster for every level of this.' },
    broker:    { name: 'A factor',       line: 'Somebody sells for you.',
                 long: 'A factor sells into the room each market has, for a cut. He never touches bones: the horde is your decision.' },
    routes:    { name: 'Trade routes',   line: 'Sell more before prices fall.',
                 long: 'Every market takes half again as much as it did before the price buckles.' },
    haste:     { name: 'Quick markets',  line: 'Prices recover faster.',
                 long: 'Every market recovers a quarter faster from whatever you sold into it.' },
    foresight: { name: 'Foresight',      line: 'The chart is drawn ahead.',
                 long: 'The swell in every price is drawn ahead of now as well as behind it.' },
    assay:     { name: 'The assay',      line: 'Read the layer under the face.',
                 long: 'You know what the ground under the face is, and what it is worth, before you break into it.' },
    workings:  { name: 'Wider workings', line: 'One more layer stays open.',
                 long: 'The dead keep one more layer open behind them instead of abandoning it.' },
    crier:     { name: 'The crier',      line: 'Visitors come sooner.',
                 long: 'Word gets around. People come up the track sooner, and they pay better when they get there.' },
    vigil:     { name: 'The long vigil', line: 'They dig longer while away.',
                 long: 'The dead work twelve hours while you are away, and four hours longer for every level of this.' },
  },

  // -------------------------------------------------------------------------
  // THE SEAL - ending a run and starting the next one
  // -------------------------------------------------------------------------
  seal: {
    title: 'The seal',
    button: 'Seal the barrow',
    confirm: 'Seal it. You keep only what you remember',
    locked: 'Reach {depth} layers down and this barrow can be sealed for remembrance.',
    ready: 'You know how to close a hole like this. Sealing ends the barrow: the dead, the coin, the goods, the layers and the rites all go back to the dark. What it pays is remembrance, and remembrance buys oaths that hold in every barrow you open after it.',
    yieldNow: 'Sealing now pays {n} remembrance.',
    yieldPaid: 'The barrow paid {n} remembrance.',
    doneLines: [
      'You fill it in from the bottom up. It takes a season and it takes all of them.',
      'The field is a field again by spring. You can still find the ditch if you know.',
      'The last cart goes out, the shaft goes in, and the grass comes back over it.',
    ],
    openLines: [
      'There is another hill three valleys over. The ground there is soft too.',
      'The next field is cheaper than the last one. You know why now.',
      'You start again on ground you have never seen, knowing exactly what is under it.',
    ],
    statLine: 'Barrow {n} sealed. {depth} layers, {coin} coin, {horde} of them.',
    finaleLines: [
      'The shaft runs out. Not into rock, into nothing: an edge, and past it the same dark going down.',
      'The dead stop at the lip and will not go on. Every one of them turns and looks back up the shaft at you.',
      'You have been digging somebody out. The books say so, and the books have never been wrong.',
      'You keep the books. You close them. Then you go and find another hill.',
    ],
  },

  // -------------------------------------------------------------------------
  // OATHS - what carries from one barrow to the next. Numbers in config.
  // -------------------------------------------------------------------------
  oaths: {
    dead:    { name: 'The dead remember',    line: 'Open every barrow with a horde.',
               long: 'Every barrow after this one opens with a horde already on its feet.' },
    ground:  { name: 'The ground remembers', line: 'Open every barrow with layers cut.',
               long: 'Every barrow after this one opens with its first layers already cut through.' },
    books:   { name: 'The books remember',   line: 'Open every barrow holding a rite.',
               long: 'Every barrow after this one opens with the rites you always buy first already held.' },
    hands:   { name: 'Old hands',            line: 'They dig faster, forever.',
               long: 'The dead dig faster in every barrow you will ever open.' },
    marrow:  { name: 'Deep marrow',          line: 'Bone goes further, forever.',
               long: 'A bone raises more of the dead in every barrow you will ever open.' },
    roads:   { name: 'The old roads',        line: 'Markets take more, forever.',
               long: 'Every market in every barrow takes more before its price buckles.' },
    purse:   { name: 'A full purse',         line: 'Open every barrow with coin in hand.',
               long: 'Every barrow after this one opens with coin already counted out.' },
    night:   { name: 'The long night',       line: 'They dig far longer while away.',
               long: 'The dead work eight hours longer while you are away, in every barrow you will ever open.' },
    calling: { name: 'The calling',          line: 'Visitors come sooner and pay more.',
               long: 'People come up the track sooner and pay better, in every barrow.' },
    depth:   { name: 'The deep habit',       line: 'The face gives way faster.',
               long: 'The floor under the deepest cut gives way faster in every barrow.' },
  },
};

/** Everything a run needs from the writing, gathered so nothing else imports it twice. */
export default CONTENT;
