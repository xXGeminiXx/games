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
// The voice: lower case, plain sentences, one image each, present tense.
// Nothing is explained twice and nothing is cute.
// ===========================================================================

export const CONTENT = {

  // -------------------------------------------------------------------------
  // THE LOG - the running account of the dig, newest line on top
  // -------------------------------------------------------------------------
  log: {
    start: [
      'the ground here is soft. it should not be.',
      'there is a hill in this field that nobody has ever ploughed.',
      'the map calls this a mound. it does not say whose.',
      'you bought the field cheap. the hill came with it.',
    ],
    firstDig: [
      'soil, and it comes up far too easily.',
      'the spade goes in to the shoulder on the first push.',
    ],
    sellShown: [
      'there is a yard in town that buys fill and asks nothing.',
      'the builders in town take clean soil by the cartload.',
    ],
    firstSale: [
      'coin. the first of it, and it spends.',
      'coin, counted into your hand at the yard gate.',
    ],
    firstBone: [
      'the sixth spadeful comes up holding a hand. the fingers close.',
      'a hand in the dirt. it is not finished with the work.',
      'bone, and it moves when the light hits it.',
    ],
    raiseShown: [
      'it wants to be put to work. you find you know how to ask.',
      'there is a way to ask it to stand. nobody taught you that.',
    ],
    firstRaise: [
      'the first of them climbs out of the hole and starts to dig.',
      'it stands, takes the spade out of your hands, and gets on with it.',
    ],
    faceShown: [
      'there is harder ground under this. set some of them against it.',
      'the floor of the cut rings like stone. that is the way down.',
    ],
    breakthrough: [
      'the floor gives out onto {name}.',
      'they are through. {name} under the whole cut.',
      '{name}. the shovels change their sound.',
      'the last foot comes away wet and there is {name} behind it.',
    ],
    newMarket: [
      'word gets to town. there are buyers for {name}.',
      'a factor rides out to ask how much {name} you have.',
      '{name} has a buyer before the first cart is loaded.',
      'the yard sends a boy to ask whether the {name} is for sale.',
    ],
    marketShown: [
      'prices move on their own. learn to read them.',
      'the yard pays less each time you come back the same day.',
    ],
    buckled: [
      'you put more {name} on the market than it wanted. the price sits on the floor until it forgets.',
      'the {name} buyers have all they can hold. come back when they are hungry.',
      'nobody in the county needs another ounce of {name} today.',
    ],
    ritesShown: [
      'coin buys more than shovels, if you know who to ask.',
      'there are people who take money to make this go faster. some of them are alive.',
    ],
    handsDone: [
      'your hands are done. you keep the books now.',
      'you have not touched a spade in a week and the hole is deeper than ever.',
    ],
    away: [
      'you were gone {t}. they did not stop.',
      'you come back after {t}. the spoil heap has moved twice.',
      '{t} away. the hole went on without you, as it does.',
    ],
    seamFound: [
      'the {name} runs {seam} here.',
      'this {name} is {seam}.',
    ],
    hordeMilestones: [
      [100,    'a hundred of them under the hill.'],
      [1000,   'a thousand. no bird lands in this field any more.'],
      [10000,  'ten thousand. the ground carries a sound now, low and even.'],
      [100000, 'a hundred thousand. the hill breathes when they change over.'],
      [1e6,    'a million. it is more hole than hill.'],
      [1e8,    'a hundred million. the field is a lid on something.'],
      [1e10,   'ten billion. more than were ever buried in this country.'],
      [1e13,   'ten trillion. whatever is down there, they outnumber it.'],
      [1e16,   'the number stopped meaning anything a while back. they keep digging.'],
    ],
    depthMilestones: [
      [4,  'four layers. the topsoil is a rumour.'],
      [8,  'eight. these graves were cut before anyone wrote anything down.'],
      [12, 'twelve. nothing here was buried by people who left a name.'],
      [16, 'sixteen. the walls are cut square. someone was here first.'],
      [22, 'twenty two. you have stopped writing down what they bring up.'],
      [30, 'thirty. the books are the only proof any of this is happening.'],
      [40, 'forty. there is no word for ground this old.'],
      [55, 'fifty five. the shaft goes down past anything that was ever alive.'],
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
    rich:     { tag: 'rich',     line: 'the seam is fat with it. every cart comes up loaded.' },
    dense:    { tag: 'dense',    line: 'hard going, and worth it. what comes out is worth double.' },
    brittle:  { tag: 'brittle',  line: 'it comes apart at a touch. the digging is fast and the pay is thin.' },
    bonefield:{ tag: 'bonefield',line: 'they were tipped in here by the cartload. the ground is more bone than earth.' },
    thin:     { tag: 'thin',     line: 'rare enough that a handful moves the price and a cartload ruins it.' },
    wide:     { tag: 'wide',     line: 'the whole county wants this. sell as fast as they can dig it.' },
    salted:   { tag: 'salted',   line: 'the price will not sit still. it swings on rumour.' },
    still:    { tag: 'still',    line: 'a steady price, year in and out. nobody gets excited about it.' },
    hollow:   { tag: 'hollow',   line: 'half of it is already open. the floor was never solid.' },
    sealed:   { tag: 'sealed',   line: 'this floor was laid down to keep something on one side of it.' },
    flooded:  { tag: 'flooded',  line: 'black water to the knee. the dead do not mind and they find more down here.' },
    burnt:    { tag: 'burnt',    line: 'the whole layer went up once. what survived is worth carrying.' },
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
          title: 'the builder',
          lines: [
            'the spades stop. there is a stone box in the middle of the mound, and a man laid out in it with his tools beside him.',
            'he built this hill over somebody else. he has been lying on top of the work for a very long time.',
          ],
          offers: [
            { name: 'take the tools', line: 'bronze shoes for the spades. everything cuts faster.', boon: { dig: 1.35 } },
            { name: 'raise the builder', line: 'he knows this ground better than you ever will.', boon: { face: 1.6 } },
          ],
        },
        {
          title: 'the grain pit',
          lines: [
            'a pit lined with clay, packed to the top with grain that went black a thousand years ago.',
            'they buried a winter here in case the world ended. the world did not.',
          ],
          offers: [
            { name: 'sell the lot', line: 'the pottery alone is worth a season of digging.', boon: { windfall: 900 } },
            { name: 'line the tunnels with it', line: 'clay walls hold. the cut goes down without shoring.', boon: { face: 1.5 } },
          ],
        },
        {
          title: 'the boundary dead',
          lines: [
            'a ring of them stood upright in the clay, facing out, spaced a pace apart.',
            'they were put here to keep something in, or to keep the neighbours out. nobody left a note.',
          ],
          offers: [
            { name: 'break the ring', line: 'they fall in and join the work. all of them at once.', boon: { diggers: 0.6 } },
            { name: 'leave them standing', line: 'the ones inside dig harder with the ring watching.', boon: { bones: 1.4 } },
          ],
        },
      ],
      // band 1 - older graves, under the mound, that the mound was built to hide
      [
        {
          title: 'the long house',
          lines: [
            'the tunnel opens into a room longer than the field above it, roofed with beams that have not rotted.',
            'the dead are laid head to foot down both walls, in their hundreds, and every one of them is holding a tool.',
          ],
          offers: [
            { name: 'wake the room', line: 'hundreds of them stand up at once and reach for the wall.', boon: { diggers: 1.1 } },
            { name: 'take the roof beams', line: 'wood that will not rot, sold to men who do not ask.', boon: { windfall: 1800, value: 1.15 } },
          ],
        },
        {
          title: 'the smith',
          lines: [
            'a floor of slag and charcoal, and a hearth still holding its shape.',
            'somebody worked metal down here when the hill above was still flat ground.',
          ],
          offers: [
            { name: 'relight the hearth', line: 'everything the dead carry up is worth more clean than raw.', boon: { value: 1.4 } },
            { name: 'take the anvil', line: 'the spades come off it sharper than they went on.', boon: { dig: 1.4 } },
          ],
        },
        {
          title: 'the drowned',
          lines: [
            'black water fills the cut to the waist and does not drain.',
            'there are shapes standing in it, patient, up to their chins. they have been waiting to be asked.',
          ],
          offers: [
            { name: 'ask them up', line: 'they come out of the water still dripping and go straight to work.', boon: { diggers: 0.8, bones: 1.25 } },
            { name: 'drain it into the lower cut', line: 'the water eats the floor for you. the way down opens.', boon: { face: 1.8 } },
          ],
        },
      ],
      // band 2 - a shaft. not a grave. somebody cut this on purpose
      [
        {
          title: 'the first shaft',
          lines: [
            'the cut runs into a shaft that is not yours. square, plumb, tool marks still sharp on the walls.',
            'somebody sank this from above, a long way above, and stopped at exactly this depth.',
          ],
          offers: [
            { name: 'follow it down', line: 'their shaft is better than yours. use it.', boon: { face: 2.0 } },
            { name: 'follow it up', line: 'it surfaces two counties over, in a yard that pays well and stays quiet.', boon: { absorb: 1.6 } },
          ],
        },
        {
          title: 'the tally wall',
          lines: [
            'one wall of the chamber is covered end to end in marks. hundreds of thousands of them, cut small and even.',
            'they are counting something. the count is not finished and the marks go into the floor.',
          ],
          offers: [
            { name: 'read the wall', line: 'whatever they were counting, it teaches you the price of everything.', boon: { value: 1.5, absorb: 1.3 } },
            { name: 'add your own mark', line: 'the hill notices. more of them come up out of the ground unasked.', boon: { bones: 1.7 } },
          ],
        },
        {
          title: 'the ossuary',
          lines: [
            'the chamber is stacked floor to ceiling with bone, sorted by kind. skulls in one bay, long bones in another.',
            'someone spent a lifetime tidying the dead into order down here.',
          ],
          offers: [
            { name: 'empty the bays', line: 'a lifetime of sorting, raised in an afternoon.', boon: { diggers: 1.5 } },
            { name: 'keep the order', line: 'work the seams the way they sorted the bones and nothing is wasted.', boon: { bones: 1.9 } },
          ],
        },
      ],
      // band 3 - sealed, deliberately, by people who knew what they were doing
      [
        {
          title: 'the plug',
          lines: [
            'the shaft ends in a single stone the width of the cut, dropped in from above and mortared at the edge.',
            'it was set from the far side. whoever placed it went down first and stayed there.',
          ],
          offers: [
            { name: 'break it', line: 'it takes a week and it takes half the horde. the way is open.', boon: { face: 2.6 } },
            { name: 'work around it', line: 'the flanking cuts open four seams at once.', boon: { value: 1.6, absorb: 1.5 } },
          ],
        },
        {
          title: 'the register',
          lines: [
            'a chamber of shelves, and on the shelves, tablets. every one is a name and a depth.',
            'the last entries are in a hand you recognise. it is yours, and you have not written them yet.',
          ],
          offers: [
            { name: 'read to the end', line: 'you learn what this is worth before you dig it.', boon: { value: 1.8 } },
            { name: 'close the book', line: 'you put it back on the shelf and the hill gets on with it, faster.', boon: { dig: 1.8 } },
          ],
        },
        {
          title: 'the ones who dug down',
          lines: [
            'a work gang, still in a line, still facing the floor, tools still in their hands.',
            'they were digging in the same direction you are. they did not stop either.',
          ],
          offers: [
            { name: 'put them back to work', line: 'they take up where they left off without being asked twice.', boon: { diggers: 2.0, dig: 1.2 } },
            { name: 'take what they carried', line: 'the packs are full of things from further down than you have been.', boon: { windfall: 5400, value: 1.3 } },
          ],
        },
      ],
      // band 4 - past any record. the ground stops being ground
      [
        {
          title: 'the floor that is not stone',
          lines: [
            'the face rings wrong. what is under the last layer is warm, and it gives slightly, and it goes on in every direction.',
            'the dead will not stand on it. they dig it holding the walls.',
          ],
          offers: [
            { name: 'cut into it', line: 'it closes behind them. it does not seem to mind.', boon: { face: 3.0, bones: 1.5 } },
            { name: 'go around', line: 'the long way round opens more ground than the short way ever did.', boon: { value: 2.0, absorb: 1.8 } },
          ],
        },
        {
          title: 'the count',
          lines: [
            'the walls of this one are marked too. same hand as the tally wall, a mile up and a thousand years earlier.',
            'the count is nearly finished here. it is counting the dead in your hill, and it is nearly caught up.',
          ],
          offers: [
            { name: 'finish the count', line: 'you write the last figure yourself. the books have never been cleaner.', boon: { value: 2.2, rem: 12 } },
            { name: 'break the wall', line: 'the count stops. everything down here comes up faster.', boon: { dig: 2.2 } },
          ],
        },
        {
          title: 'the older barrow',
          lines: [
            'below the shaft, below the sealed floor, there is a hill. a mound, buried, with a ditch cut round it.',
            'somebody piled this up down here, in the dark, where nothing has ever needed a landmark.',
          ],
          offers: [
            { name: 'dig it out', line: 'a whole hill of them, and every one comes up standing.', boon: { diggers: 3.0 } },
            { name: 'dig under it', line: 'whatever it was built over is worth more than the hill.', boon: { face: 2.4, value: 1.7 } },
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
      name: 'a buyer',
      lines: [
        'a man with a good coat and a bad horse wants {name}, and he is paying {mult}x what the yard pays.',
        'a factor from the coast will take {name} off you at {mult}x the going rate. he does not say who for.',
        'a woman with two carts and no name wants every ounce of {name} you have, at {mult}x.',
      ],
      take: 'sell to them',
      pass: 'send them off',
      taken: 'the carts go out loaded. {coin} coin, and no questions on either side.',
      passed: 'they wait an hour at the gate and then they go.',
      empty: 'they look at the empty yard, and at you, and they go.',
    },
    bonecart: {
      name: 'the bone cart',
      lines: [
        'a cart comes up the track full of bone from a churchyard being cleared. the driver wants coin, not talk.',
        'a man is selling the contents of a plague pit by weight. he seems glad to be rid of it.',
        'two brothers with a wagon have dug up somewhere they should not have. they want it gone tonight.',
      ],
      take: 'buy the load',
      pass: 'turn it away',
      taken: '{n} bones tipped in the yard. they are standing before the cart is out of the gate.',
      passed: 'the cart goes on down the road to whoever else is buying.',
    },
    gang: {
      name: 'a work gang',
      lines: [
        'a gang of diggers walks up the track looking for work. they are not particular about what kind.',
        'a dozen men out of the closed pits at the coast are at your gate, asking.',
        'someone has sent you labour. you did not ask for it and nobody says who did.',
      ],
      take: 'set them on',
      pass: 'no work here',
      taken: 'they go down the shaft. they do not come back up, and the count goes up by {n}.',
      passed: 'they walk back down the track in the rain.',
    },
    reeve: {
      name: 'the reeve',
      lines: [
        'the reeve rides out about the noise. he is owed something, and he will say what once he has been paid.',
        'the county wants a tithe on whatever is coming out of this field.',
        'a clerk with a warrant would like to see the books. he can be talked out of it.',
      ],
      take: 'pay him',
      pass: 'shut the gate',
      taken: 'he takes {coin} and rides off. the roads are open to your carts after that.',
      passed: 'he writes something down and rides off. the yards are cool on your goods for a while.',
    },
    relic: {
      name: 'a peddler',
      lines: [
        'a peddler has something wrapped in cloth that he will not unwrap until you name a price.',
        'a thin man is selling a thing he says came out of a hill like this one, three counties over.',
        'someone is selling back to you something that came out of your own field last year.',
      ],
      take: 'buy it',
      pass: 'let him keep it',
      taken: 'it goes in the yard and the work changes. {boon}',
      passed: 'he wraps it up again and goes.',
    },
    surveyor: {
      name: 'a surveyor',
      lines: [
        'a surveyor has been walking the field with a rod, and he has worked out what is under it.',
        'a woman with charts wants to tell you what the next layer down is. for a fee.',
        'a man who used to sink shafts for the crown offers to read the ground for you.',
      ],
      take: 'hear him out',
      pass: 'you will find out',
      taken: '{reading}',
      passed: 'he rolls the charts up and goes.',
    },
    mourner: {
      name: 'a mourner',
      lines: [
        'a woman comes up the track and stands at the edge of the cut for a long time without saying anything.',
        'an old man asks whether you have turned up a name he gives you. you have not.',
        'someone leaves flowers on the spoil heap and is gone before anyone gets to the gate.',
      ],
      take: 'let them look',
      pass: 'send them home',
      taken: 'they leave something on the heap on the way out. {coin} coin, and the field is quiet after.',
      passed: 'they go without arguing, which is worse.',
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
    hands:     { name: 'deeper hands',   line: 'they dig half again as fast.',
                 long: 'every level of this makes the dead dig half again as fast as they did.' },
    grave:     { name: 'mass grave',     line: 'bones go half again as far.',
                 long: 'every bone raises half again as much of the dead as it did before.' },
    ledger:    { name: 'the ledger',     line: 'the figures under every price.',
                 long: 'the base price, what each market takes, how fast it recovers, how choked it is, and the right to buy at those prices as well as sell.' },
    picks:     { name: 'grave picks',    line: 'the face gives way faster.',
                 long: 'the floor under the deepest cut gives way a quarter faster for every level of this.' },
    broker:    { name: 'a factor',       line: 'somebody sells for you.',
                 long: 'a factor sells into the room each market has, for a cut. he never touches bones: the horde is your decision.' },
    routes:    { name: 'trade routes',   line: 'every market takes more.',
                 long: 'every market takes half again as much again before the price buckles.' },
    haste:     { name: 'quick markets',  line: 'markets forget faster.',
                 long: 'every market recovers a quarter faster from whatever you sold into it.' },
    foresight: { name: 'foresight',      line: 'the chart is drawn ahead.',
                 long: 'the swell in every price is drawn ahead of now as well as behind it.' },
    assay:     { name: 'the assay',      line: 'read a layer before you cut in.',
                 long: 'you know what the ground under the face is, and what it is worth, before you break into it.' },
    workings:  { name: 'wider workings', line: 'one more layer stays open.',
                 long: 'the dead keep one more layer open behind them instead of abandoning it.' },
    crier:     { name: 'the crier',      line: 'visitors come oftener.',
                 long: 'word gets around. people come up the track sooner, and they pay better when they get there.' },
    vigil:     { name: 'the long vigil', line: 'they work longer alone.',
                 long: 'the dead keep working four hours longer than they would while nobody is watching.' },
  },

  // -------------------------------------------------------------------------
  // THE SEAL - ending a run and starting the next one
  // -------------------------------------------------------------------------
  seal: {
    title: 'the seal',
    button: 'seal the barrow',
    confirm: 'seal it. everything below goes back to the dark',
    locked: 'reach {depth} layers down to learn how this ends.',
    ready: 'you know how to close a hole like this. what you learned doing it stays learned.',
    yield: '{n} remembered',
    doneLines: [
      'you fill it in from the bottom up. it takes a season and it takes all of them.',
      'the field is a field again by spring. you can still find the ditch if you know.',
      'the last cart goes out, the shaft goes in, and the grass comes back over it.',
    ],
    openLines: [
      'there is another hill three valleys over. the ground there is soft too.',
      'the next field is cheaper than the last one. you know why now.',
      'you start again on ground you have never seen, knowing exactly what is under it.',
    ],
    statLine: 'seal {n}. {depth} layers, {coin} coin, {horde} of them.',
    remembrance: 'remembrance',
    oathsTitle: 'what you remember',
    finaleTitle: 'the bottom',
    finaleLines: [
      'the shaft runs out. not into rock, into nothing: an edge, and past it the same dark going down.',
      'the dead stop at the lip and will not go on. every one of them turns and looks back up the shaft at you.',
      'you have been digging somebody out. the books say so, and the books have never been wrong.',
      'you keep the books. you close them. then you go and find another hill.',
    ],
  },

  // -------------------------------------------------------------------------
  // OATHS - what carries from one barrow to the next. Numbers in config.
  // -------------------------------------------------------------------------
  oaths: {
    dead:    { name: 'the dead remember',    line: 'begin with them standing.',
               long: 'every barrow after this one opens with a horde already on its feet.' },
    ground:  { name: 'the ground remembers', line: 'begin with layers open.',
               long: 'every barrow after this one opens with its first layers already cut through.' },
    books:   { name: 'the books remember',   line: 'begin holding a rite.',
               long: 'every barrow after this one opens with the rites you always buy first already held.' },
    hands:   { name: 'old hands',            line: 'they dig faster, forever.',
               long: 'the dead dig faster in every barrow you will ever open.' },
    marrow:  { name: 'deep marrow',          line: 'bone goes further, forever.',
               long: 'a bone raises more of the dead in every barrow you will ever open.' },
    roads:   { name: 'the old roads',        line: 'markets take more, forever.',
               long: 'every market in every barrow takes more before its price buckles.' },
    purse:   { name: 'a full purse',         line: 'begin with coin in hand.',
               long: 'every barrow after this one opens with coin already counted out.' },
    night:   { name: 'the long night',       line: 'they work far longer alone.',
               long: 'the dead keep working eight hours longer than they would while nobody is watching.' },
    calling: { name: 'the calling',          line: 'visitors find you faster.',
               long: 'people come up the track sooner and pay better, in every barrow.' },
    depth:   { name: 'the deep habit',       line: 'the face gives way faster.',
               long: 'the floor under the deepest cut gives way faster in every barrow.' },
  },
};

/** Everything a run needs from the writing, gathered so nothing else imports it twice. */
export default CONTENT;
