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
      'The ground here is soft. It shouldn\'t be.',
      'There\'s a hill in this field that nobody has ever plowed.',
      'The map calls this a mound. It doesn\'t say whose.',
      'You bought the field cheap. The hill came with it.',
    ],
    firstDig: [
      'Soil, and it comes up far too easily.',
      'The spade goes in to the shoulder on the first push.',
    ],
    sellShown: [
      'There\'s a yard in town that buys fill and asks nothing.',
      'The builders in town take clean soil by the cartload.',
    ],
    firstSale: [
      'Coin. The first of it, and it spends.',
      'Coin, counted into your hand at the yard gate.',
    ],
    firstBone: [
      'The sixth spadeful comes up holding a hand. The fingers close.',
      'A hand in the dirt, and it isn\'t done working.',
      'Bone, and it moves when the light hits it.',
    ],
    raiseShown: [
      'It wants to be put to work. Bones will stand it up.',
      'Bones raise the dead, and the dead dig.',
    ],
    firstRaise: [
      'The first of them climbs out of the hole and starts to dig.',
      'It stands, takes the spade out of your hands, and gets on with it.',
    ],
    faceShown: [
      'Harder ground under this. Put some of them on digging down.',
      'The floor of the cut rings like stone. Set some of them to dig down through it.',
    ],
    breakthrough: [
      'The floor gives out onto {name}.',
      'They\'re through. {Name} under the whole cut.',
      '{Name}. The shovels change their sound.',
      'The last foot comes away wet and there\'s {name} behind it.',
    ],
    newMarket: [
      'Word gets to town. There are buyers for {name}.',
      'A man rides out to ask how much {name} you have.',
      '{Name} has a buyer before the first cart is loaded.',
      'The yard sends a boy to ask whether the {name} is for sale.',
    ],
    marketShown: [
      'Every sale pushes that price down, and it climbs back over a minute.',
      'The yard pays less each time you come back the same day.',
    ],
    buckled: [
      'You put more {name} on the market than it wanted. The price sits on the floor until it forgets.',
      'The {name} buyers have all they can hold. Come back when they\'re hungry.',
      'Nobody in the county needs another ounce of {name} today.',
    ],
    ritesShown: [
      'Coin buys sharper spades, faster picks and a man who sells for you.',
      'There are people who take money to make this go faster. Some of them are alive.',
    ],
    handsDone: [
      'Your hands are done. You keep the books now.',
      'You haven\'t touched a spade in a week and the hole is deeper than ever.',
    ],
    sealShown: [
      'This hole is deep enough to fill in now. It pays relics, and relics are all a barrow ever leaves you.',
      'You could close this barrow and keep the relics. There are other hills.',
      'Filling it in ends the barrow and pays relics. Everything else goes back in the hole.',
    ],
    away: [
      'You were gone {t}. They didn\'t stop.',
      'You come back after {t}. The spoil heap has moved twice.',
      '{T} away. The hole went on without you.',
    ],
    waiting: [
      'Somebody\'s been waiting at the gate a while.',
      'There\'s a cart at the gate and somebody sitting on it.',
      'Somebody walked up the track while you were out and stayed.',
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
      [1e6,    'A million. It\'s more hole than hill.'],
      [1e8,    'A hundred million. The field is a lid on something.'],
      [1e10,   'Ten billion. More than were ever buried in this country.'],
      [1e13,   'Ten trillion. Whatever is down there, they outnumber it.'],
      [1e16,   'The number stopped meaning anything a while back. They keep digging.'],
    ],
    depthMilestones: [
      [4,  'Four layers. The topsoil is a rumor.'],
      [8,  'Eight. These graves were cut before anyone wrote anything down.'],
      [12, 'Twelve. Nothing here was buried by people who left a name.'],
      [16, 'Sixteen. The walls are cut square. Someone was here first.'],
      [22, 'Twenty two. You\'ve stopped writing down what they bring up.'],
      [30, 'Thirty. Nobody in town believes the depth when you tell them.'],
      [40, 'Forty. The shaft is deeper now than the hill is wide.'],
      [55, 'Fifty five. The shaft goes down past anything that was ever alive.'],
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
    rich:     { tag: 'rich',     line: 'Fat with it. Worth 2.2x.' },
    dense:    { tag: 'dense',    line: 'Hard going. Worth 2.8x, and 1.8x the work to cut.' },
    brittle:  { tag: 'brittle',  line: 'It falls apart. Digs twice as fast, worth 0.6x.' },
    bonefield:{ tag: 'bonefield',line: 'Tipped in by the cartload. 3.2x the bones, worth 0.7x.' },
    thin:     { tag: 'thin',     line: 'Rare. Worth 1.8x, and the market takes 0.4x before the price drops.' },
    wide:     { tag: 'wide',     line: 'The whole county wants it. The market takes 2.8x.' },
    salted:   { tag: 'salted',   line: 'The price runs on rumor. It swings 2.8x as far.' },
    still:    { tag: 'still',    line: 'Nobody gets excited about it. Worth 1.2x, and the price barely moves.' },
    hollow:   { tag: 'hollow',   line: 'Half of it is already open. 0.35x the floor to cut through.' },
    sealed:   { tag: 'sealed',   line: 'Laid down to keep something under it. Worth 1.7x, behind 2.6x the floor.' },
    flooded:  { tag: 'flooded',  line: 'Black water to the knee. 2.2x the bones, worth 1.4x, twice the work.' },
    burnt:    { tag: 'burnt',    line: 'It all went up once. Worth 1.9x, and the market takes 0.7x.' },
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
            'The spades stop. There\'s a stone box in the middle of the mound with a man laid out in it, tools beside him.',
            'He built this hill over somebody else, and he\'s been lying on top of the work a long time.',
          ],
          offers: [
            { name: 'Take the tools', line: 'Bronze shoes for every spade.', boon: { dig: 1.35 } },
            { name: 'Raise the builder', line: 'He knows this ground better than you do.', boon: { face: 1.6 } },
          ],
        },
        {
          title: 'The grain pit',
          lines: [
            'A pit lined with clay, packed to the top with grain that went black a thousand years ago.',
            'They buried a winter here in case the world ended. It didn\'t.',
          ],
          offers: [
            { name: 'Sell the lot', line: 'The pottery alone is worth a season.', boon: { windfall: 900 } },
            { name: 'Line the tunnels with it', line: 'Clay walls hold. The cut goes down without shoring.', boon: { face: 1.5 } },
          ],
        },
        {
          title: 'The boundary dead',
          lines: [
            'A ring of them stood upright in the clay, facing out, a pace apart.',
            'They were put here to keep something in, or to keep the neighbors out.',
          ],
          offers: [
            { name: 'Break the ring', line: 'They fall in and join the work, all at once.', boon: { diggers: 0.6 } },
            { name: 'Leave them standing', line: 'The ones inside dig harder with the ring watching.', boon: { bones: 1.4 } },
          ],
        },
      ],
      // band 1 - older graves, under the mound, that the mound was built to hide
      [
        {
          title: 'The long house',
          lines: [
            'The tunnel opens into a room longer than the field above it, roofed with beams that never rotted.',
            'The dead are laid head to foot down both walls in their hundreds, every one holding a tool.',
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
            'Somebody worked metal down here when the hill above was flat ground.',
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
            'There are shapes standing in it up to their chins, waiting to be asked.',
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
            'The cut runs into a shaft that isn\'t yours. Square, plumb, tool marks still sharp on the walls.',
            'Somebody sank this from a long way above and stopped at exactly this depth.',
          ],
          offers: [
            { name: 'Follow it down', line: 'Their shaft is better than yours. Use it.', boon: { face: 2.0 } },
            { name: 'Follow it up', line: 'It surfaces two counties over, in a quiet yard that pays.', boon: { absorb: 1.6 } },
          ],
        },
        {
          title: 'The tally wall',
          lines: [
            'One wall is covered end to end in marks. Hundreds of thousands of them, cut small and even.',
            'They\'re counting something. The count isn\'t finished and the marks go into the floor.',
          ],
          offers: [
            { name: 'Read the wall', line: 'Whatever they counted, it teaches you the price of everything.', boon: { value: 1.5, absorb: 1.3 } },
            { name: 'Add your own mark', line: 'The hill notices. More of them come up unasked.', boon: { bones: 1.7 } },
          ],
        },
        {
          title: 'The bone room',
          lines: [
            'Stacked floor to ceiling with bone, sorted by kind. Skulls in one bay, long bones in another.',
            'Somebody spent a lifetime tidying the dead into order down here.',
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
            'The shaft ends in one stone the width of the cut, dropped in from above and mortared at the edge.',
            'It was set from the far side. Whoever placed it went down first and stayed.',
          ],
          offers: [
            { name: 'Break it', line: 'A week of work and half of them. Then it\'s open.', boon: { face: 2.6 } },
            { name: 'Work around it', line: 'The flanking cuts open four layers at once.', boon: { value: 1.6, absorb: 1.5 } },
          ],
        },
        {
          title: 'The register',
          lines: [
            'A room of shelves, and on the shelves, tablets. Every one is a name and a depth.',
            'The last entries are in a hand you recognize. It\'s yours, and you haven\'t written them yet.',
          ],
          offers: [
            { name: 'Read to the end', line: 'You learn what the ground is worth before you dig it.', boon: { value: 1.8 } },
            { name: 'Close the book', line: 'You put it back and the hill gets on with it, faster.', boon: { dig: 1.8 } },
          ],
        },
        {
          title: 'The ones who dug down',
          lines: [
            'A work gang, still in a line, still facing the floor, tools in their hands.',
            'They were digging the same direction you are. They didn\'t stop either.',
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
            'The floor rings wrong. What\'s under the last layer is warm, it gives a little, and it goes on in every direction.',
            'The dead won\'t stand on it. They dig it holding the walls.',
          ],
          offers: [
            { name: 'Cut into it', line: 'It closes behind them and doesn\'t seem to mind.', boon: { face: 3.0, bones: 1.5 } },
            { name: 'Go around', line: 'The long way round opens more ground than the short way did.', boon: { value: 2.0, absorb: 1.8 } },
          ],
        },
        {
          title: 'The count',
          lines: [
            'These walls are marked too. Same hand as the tally wall, a mile up and a thousand years earlier.',
            'The count is nearly finished here. It\'s counting the dead in your hill, and it\'s nearly caught up.',
          ],
          offers: [
            { name: 'Finish the count', line: 'You write the last figure yourself. The books have never been cleaner.', boon: { value: 2.2, rem: 12 } },
            { name: 'Break the wall', line: 'The count stops. Everything down here comes up faster.', boon: { dig: 2.2 } },
          ],
        },
        {
          title: 'The older barrow',
          lines: [
            'Below the shaft, below the sealed floor, there\'s a hill. A mound, buried, with a ditch cut round it.',
            'Somebody piled this up down here, in the dark, where nothing ever needed a landmark.',
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
        'A man with a good coat and a bad horse wants {name}, and he\'s paying {mult}x what the yard pays.',
        'A dealer from the coast will take {name} off you at {mult}x the going rate. He doesn\'t say who for.',
        'A woman with two carts and no name wants every ounce of {name} you have, at {mult}x.',
      ],
      take: 'Sell to them',
      pass: 'Send them off',
      taken: 'The carts go out loaded: {n} {name} for {coin} coin, and no questions either way.',
      passed: 'They wait an hour at the gate and then they go.',
      empty: 'They look at the empty yard, then at you, and they go.',
    },
    bonecart: {
      name: 'A bone cart',
      lines: [
        'A cart comes up the track full of bone from a churchyard being cleared. The driver wants coin and no conversation.',
        'A man is selling the contents of a plague pit by the cartload. He seems glad to be rid of it.',
        'Two brothers with a wagon have dug up somewhere they shouldn\'t have. They want it gone tonight.',
      ],
      offer: '{N} bones on the cart.',
      take: 'Buy the load',
      pass: 'Turn it away',
      taken: '{N} bones tipped in the yard. They\'re standing before the cart is out of the gate.',
      passed: 'The cart goes on down the road to whoever else is buying.',
    },
    gang: {
      name: 'A work gang',
      lines: [
        'A gang of diggers walks up the track looking for work. They aren\'t particular about what kind.',
        'A dozen men out of the closed pits at the coast are at your gate, asking.',
        'Somebody has sent you help. You didn\'t ask for it and nobody says who did.',
      ],
      offer: '{N} of them, and they work for nothing.',
      take: 'Set them on',
      pass: 'No work here',
      taken: 'They go down the shaft and don\'t come back up. {N} more of them are digging.',
      passed: 'They walk back down the track in the rain.',
    },
    reeve: {
      name: 'A tax man',
      lines: [
        'A man rides out from the county about the noise. He\'s owed something, and he\'ll say what once he\'s paid.',
        'The county wants a cut of whatever is coming out of this field.',
        'A clerk with a warrant would like to see the books. He can be talked out of it.',
      ],
      offer: 'Pay and every market takes 18% more for the rest of this barrow. Refuse and one market turns cold on you.',
      take: 'Pay him',
      pass: 'Shut the gate',
      taken: 'He takes {coin} and rides off. The roads are open to your carts after that.',
      passed: 'He writes something down and rides off. The yards are cool on what you sell for a while.',
    },
    relic: {
      name: 'A peddler',
      lines: [
        'A peddler has a charm wrapped in cloth. He won\'t unwrap it until you name a price.',
        'A thin man is selling something he says came out of a hill like this one, three counties over.',
        'Somebody is selling back to you a thing that came out of your own field last year.',
      ],
      offer: 'You don\'t find out what it does until you\'ve bought it.',
      take: 'Buy it',
      pass: 'Let him keep it',
      taken: 'It goes in the yard and the work changes. {Boon}',
      passed: 'It goes back under the cloth and up the track.',
    },
    surveyor: {
      name: 'A surveyor',
      lines: [
        'A surveyor has been walking the field with a rod, and he\'s worked out what\'s under it.',
        'A woman with charts wants to tell you what the next layer down is, for a fee.',
        'A man who used to sink shafts for the crown offers to read the ground for you.',
      ],
      offer: 'You see the next {n} layers before they break into them.',
      reading: 'Under the floor: {name}.',
      take: 'Hear the reading',
      pass: 'You\'ll find out',
      taken: '{Reading}',
      passed: 'The charts are rolled up and taken back down the track.',
    },
    mourner: {
      name: 'A mourner',
      lines: [
        'A woman comes up the track and stands at the edge of the cut a long time without saying anything.',
        'An old man asks whether you\'ve turned up a name he gives you. You haven\'t.',
        'Someone leaves flowers on the spoil heap and is gone before anyone gets to the gate.',
      ],
      take: 'Let them look',
      pass: 'Send them home',
      taken: 'They leave {coin} coin on the heap on the way out, and the field goes quiet.',
      passed: 'They go back down the track without a word.',
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
    hands:     { name: 'Sharper spades', line: 'They dig 50% faster.',
                 long: 'Every level makes the dead dig 50% faster than they did.' },
    grave:     { name: 'More from a bone', line: 'A bone raises 50% more.',
                 long: 'Every level makes each bone raise 50% more of the dead.' },
    ledger:    { name: 'Show the numbers', line: 'The figures under every price.',
                 long: 'Shows what every material usually goes for, how much a market takes, how fast it comes back and how full it is. You can buy at those prices as well as sell.' },
    picks:     { name: 'Better picks',   line: 'They dig down 25% faster.',
                 long: 'The floor under the deepest cut gives way 25% faster for every level.' },
    broker:    { name: 'Hire a seller',  line: 'He sells for you, for a cut.',
                 long: 'He sells into the room each market has and takes a cut of the coin. He never sells bones.' },
    routes:    { name: 'Trade routes',   line: 'Markets take 50% more.',
                 long: 'Every market takes 50% more before its price drops.' },
    haste:     { name: 'Quick buyers',   line: 'Prices come back 25% faster.',
                 long: 'Every market shrugs off what you sold into it 25% faster.' },
    foresight: { name: 'Prices ahead',   line: 'See where a price is going.',
                 long: 'The chart draws the swell in every price ahead of now as well as behind, so you can sell into the top of it.' },
    assay:     { name: 'See one layer down', line: 'Know the next layer early.',
                 long: 'You see the next layer down, and what it\'s worth, before they break into it.' },
    workings:  { name: 'Keep a layer open', line: 'One more old layer keeps working.',
                 long: 'The dead keep one more layer behind them working instead of walking away from it.' },
    crier:     { name: 'Spread the word', line: 'Visitors come sooner, pay more.',
                 long: 'Word gets around. People come up the track 15% sooner per level and pay 25% better when they get there.' },
    vigil:     { name: 'Longer alone',   line: '4 more hours while you are gone.',
                 long: 'The dead work 12 hours while you\'re away, and 4 hours longer for every level of this.' },
    survey:    { name: 'See five layers down', line: 'Name the next 5 layers now.',
                 long: 'The next five layers down show their names and their ground on the panel and on the hill before anybody stands in them.' },
    records:   { name: 'More relics',     line: '3 more relics for filling in.',
                 long: 'Every level is 3 more relics when you fill this barrow in.' },
    pits:      { name: 'Work the burials', line: 'The ground holds 45% more of them.',
                 long: 'They stop cutting clean and start working the burials. Every level turns up 45% more of the dead out of the same ground.' },
  },

  // -------------------------------------------------------------------------
  // FILLING IT IN - ending a run and starting the next one. The code calls
  // this the seal; the player fills the hole in and walks away with relics.
  // -------------------------------------------------------------------------
  seal: {
    title: 'Fill it in',
    button: 'Fill in the barrow',
    confirm: 'Fill it in. You keep the relics and nothing else',
    locked: 'Get {depth} layers down and you can fill this barrow in for relics.',
    ready: 'Filling it in ends this barrow. The dead, the coin, what they dug, the layers and everything coin bought go back in the hole. You keep the relics, and relics buy things that carry into every barrow after this one.',
    yieldNow: 'Filling it in now pays {n} relics.',
    yieldPaid: 'The barrow paid {n} relics.',
    oathsNote: 'Relics come out of a barrow you filled in. Everything here holds in every barrow you open after it.',
    doneLines: [
      'You fill it in from the bottom up. It takes a season and it takes all of them.',
      'The field is a field again by spring. You can still find the ditch if you know where.',
      'The last cart goes out, the shaft goes in, and the grass comes back over it.',
    ],
    openLines: [
      'There\'s another hill three valleys over. The ground there is soft too.',
      'The next field is cheaper than the last one. You know why now.',
      'You start again on ground you\'ve never seen, knowing exactly what\'s under it.',
    ],
    statLine: 'Barrow {n} filled in. {depth} layers, {coin} coin, {horde} of them.',
    finaleLines: [
      'The shaft runs out at an edge, and past it the same dark going down.',
      'The dead stop at the lip and won\'t go on. Every one of them turns and looks back up the shaft at you.',
      'You\'ve been digging somebody out. The books say so, and the books have never been wrong.',
      'You close the books and go find another hill.',
    ],
  },

  // -------------------------------------------------------------------------
  // OATHS - what relics buy, and what carries from one barrow to the next.
  // The numbers live in config.oaths.
  // -------------------------------------------------------------------------
  oaths: {
    dead:    { name: 'Start with diggers',   line: 'Every barrow opens with 8 of them.',
               long: 'Every barrow after this one opens with diggers already on their feet, 4x bigger for every level.' },
    ground:  { name: 'Start layers down',    line: 'Every barrow opens 1 layer already cut.',
               long: 'Every barrow after this one opens with one more layer already cut through for every level.' },
    books:   { name: 'Start with upgrades', line: 'Keep the first upgrades you bought.',
               long: 'Every barrow after this one opens holding what coin bought first: Show the numbers, then Prices ahead, then Hire a seller.' },
    hands:   { name: 'Faster hands',         line: 'They dig 35% faster in every barrow.',
               long: 'The dead dig 35% faster per level, in every barrow you\'ll ever open.' },
    marrow:  { name: 'Bones go further',     line: 'A bone raises 40% more, every barrow.',
               long: 'A bone raises 40% more of the dead per level, in every barrow you\'ll ever open.' },
    roads:   { name: 'Markets take more',    line: 'Every market takes 35% more, forever.',
               long: 'Every market in every barrow takes 35% more per level before its price drops.' },
    purse:   { name: 'Start with coin',      line: 'Every barrow opens with 500 coin.',
               long: 'Every barrow after this one opens with coin already counted out, 8x more for every level.' },
    night:   { name: 'They dig longer alone',line: 'They work 8 hours longer while away.',
               long: 'The dead work 8 hours longer per level while you\'re away, in every barrow.' },
    calling: { name: 'Visitors come sooner', line: 'Gaps 18% shorter, they pay 25% more.',
               long: 'People come up the track 18% sooner and pay 25% better per level, in every barrow.' },
    depth:   { name: 'Dig down faster',      line: 'They dig down 35% faster.',
               long: 'The floor under the deepest cut gives way 35% faster per level, in every barrow.' },
  },
};

/** Everything a run needs from the writing, gathered so nothing else imports it twice. */
export default CONTENT;
