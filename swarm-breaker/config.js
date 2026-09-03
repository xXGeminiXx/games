// ===========================================================================
// CONFIGURATION
//
// Every name, every label, every number worth turning lives in this file and
// nowhere else. Change something here and the whole game follows: the browser
// tab, the header, the shop, the colours, the physics, the save slot.
//
// Nothing in here is read more than once per load, so a change takes effect on
// refresh. Nothing in here needs a build step.
//
// HOW TO RENAME THE GAME
//   Set identity.name. That alone retitles the tab, the header and the save
//   slot. If you want the save from the old name to carry over, leave
//   identity.storagePrefix pinned to its current value instead of letting it
//   follow the name.
//
// HOW TO TRY A NUMBER WITHOUT EDITING THIS FILE
//   Append overrides to the URL, which is the fastest way to test a hosted
//   build from a phone:
//     ?set=board.cols=10&set=swarm.speed=16
//   They last for that one page load. To make one stick in this browser, open
//   the console and run:
//     localStorage.setItem('cfg', '{"board":{"cols":10}}')
//   Clear it with localStorage.removeItem('cfg'). Set dev.allowOverrides to
//   false to switch both off entirely.
// ===========================================================================

export const CONFIG = {

  // -------------------------------------------------------------------------
  // IDENTITY - what the game is called and where it keeps its things
  // -------------------------------------------------------------------------
  identity: {
    name: 'Swarm Breaker',
    tagline: 'aim once. the swarm does the work.',

    // Prefixes every browser storage key this game writes. Changing it starts
    // every player from a clean slate; keeping it preserves saves across a
    // rename.
    storagePrefix: 'swarmbreaker',
  },

  // -------------------------------------------------------------------------
  // TEXT - every word the player reads
  //
  // Nothing below is referenced by id anywhere else, so any of it can be
  // rewritten freely. Renaming a currency here renames it everywhere it is
  // shown.
  // -------------------------------------------------------------------------
  text: {
    // The four figures across the top of the screen. The fourth one belongs to
    // the field, and says whichever of these the field it is drawing has to
    // say: a descending field names its generator, a field that fills says how
    // full it is.
    stats: {
      depth:   'depth',      // how far the field has descended
      swarm:   'swarm',      // how many bodies fire each turn
      essence: 'essence',    // the currency
      pattern: 'pattern',    // which generator is drawing the field
      // How much of the board is standing, shown as "16/32". The label has to
      // name the MEASURE and not the thing measured - "field" reads as the
      // name of the playfield, which is already what every other word on
      // screen calls it, and leaves the fraction beside it unexplained.
      fill:    'fill',
    },

    hintIdle:    'drag to aim · release to fire',
    hintFiring:  'the swarm is working',

    // The banner over a cleared board.
    clearTitle:  'field cleared',
    clearNote:   '+',

    // Shown on the aim line when a drag is flatter than the launcher will take.
    aimLimit:    'limit',

    difficultyLabel: 'difficulty',
    tradeLabel: 'trading',
    // It abandons the run in progress and starts another one. It does not
    // touch awards, best depths or the chosen mode, and RESET is the word
    // players expect to mean exactly that - wiping everything they have.
    resetButton:     'restart',

    // Shown when a block reaches the swarm line.
    overTitle:   'the swarm is overrun',
    // Shown when a field that fills rather than descends runs out of room. It
    // says FULL because that is the word the mode promises the player on the
    // menu and the word its readout counts toward; a second word for the same
    // event is a word the player has to translate.
    overFull:    'the field is full',
    // Banner over the field the turn a run outlasts everything its tier had
    // scripted. Nothing stops - this says so, and the run carries on. The
    // title is the same phrase the award for the same event uses, so one
    // thing that happens has one name.
    crossTitle:  'past the last row',
    crossNote:   'harder now, and it never stops',
    overAgain:   'again',
    overDepth:   'depth',
    overSwarm:   'swarm',
    overMenu:    'menu',

    // The mode screen. It carries the modes, the difficulty, the awards and
    // the way back into a run, so the button that opens it says MENU rather
    // than naming the one part of it a player happens to be looking for.
    menuPlay:       'play',
    menuResume:     'resume run',
    menuButton:     'menu',
    // The label over the list of modes. This is the first screen anyone sees
    // and nothing else on it says that picking a row is what starts a run, so
    // it says so here - directly above the rows, where it is read before they
    // are clicked rather than at the bottom of a card that scrolls.
    menuModeLabel:  'pick a mode to start',
    // THE BOARD. Every state is a word as well as a colour, and none of them
    // is an accusation: a run that does not replay keeps its place and the
    // likeliest reason is that it was played on an older build.
    boardTitle: 'board',
    boardLocal: 'your runs on this device',
    boardOpen: 'everyone',
    boardCrew: 'crew ',
    boardYou: 'you',
    boardNote: 'A finished run writes itself down, so anybody can replay it. Each row says whether anybody has.',
    boardEmpty: 'No runs yet. Finish one and it lands here.',
    boardCheck: 'check the top runs',
    boardChecking: 'replaying...',
    boardStates: {
      unverified: 'unchecked',
      witnessed: 'checked by N',
      mismatch: 'no replay match',
      unverifiedNote: 'Nobody has replayed this run yet.',
      witnessedNote: 'N other players replayed this run and got the same result.',
      mismatchNote: 'Someone replayed this run and reached a different result. Usually that means it was played on an older build. It keeps its place.',
      truncatedNote: 'This run was too long to write down, so nobody can replay it. It keeps its place.',
      noLogNote: 'This run posted no replay, so there\'s nothing to check. It keeps its place.',
    },
    dailyName: "today's field",
    dailyBlurb: 'The same field for everyone, every day. No timer, nothing to miss.',
    menuBestLabel:  'best depth',
    menuNoBest:     'not yet played',
    menuHint:       'esc reopens this  \u00b7  drag to aim, release to fire',

    // WHAT THE BRACKETS AROUND A BLOCK MEAN.
    //
    // A few blocks in a hundred carry four corner brackets in a colour, and
    // the colour is the only thing that says what breaking one will do. That
    // is a private vocabulary until it is written down somewhere the player
    // can read it, and the moment before a run starts is the one moment they
    // are reading rather than aiming.
    menuKinds:      'bracketed blocks do something extra when they break: '
                  + 'cyan grows the swarm, gold pays, violet breaks more than '
                  + 'itself, green sharpens every hit for good, red is trouble.',
  },

  // -------------------------------------------------------------------------
  // MODES - the fields a run can be played on
  //
  // A mode is a recipe: how the field ARRIVES (src/arrival.js), what decides
  // its LAYOUT, and how wide it is. The swarm, the angle, the economy, the
  // block kinds and the difficulty ladder are the same in all of them, so a
  // mode is safe to add: give it an id here, give it a recipe in src/modes.js,
  // and the menu picks it up.
  // -------------------------------------------------------------------------
  modes: {
    // What a fresh install plays.
    default: 'swarm',

    list: [
      {
        // The id stays `swarm` because saves and stored bests are keyed on it.
        // The NAME says what the field does, because the swarm is in all three
        // modes and naming one of them after it tells a player nothing about
        // which one they are picking.
        id: 'swarm',
        name: 'descent',
        tell: 'the main game',
        blurb: 'Eight columns, one row at a time. The rule drawing the field '
             + 'changes as you go deeper, and the readout names the one '
             + 'running now. Play this one first.',
      },
      {
        id: 'fractal',
        name: 'fractal',
        // The old tell named the object; this one names the thing that plays
        // differently, which is that the view keeps pulling back.
        tell: 'a picture that pulls back',
        blurb: 'Julia sets and the Mandelbrot set, dealt downward. The blocks '
             + 'are pieces of the picture itself, cut along its bands and rays '
             + 'and never square, and the swarm slips through every gap in the '
             + 'lace. You start close in and the view pulls back until the '
             + 'whole set is on the screen. Pale lace breaks easily. The dark '
             + 'rim barely gives.',
      },
      {
        // The earlier fractal field - whole geometric constructions (gasket,
        // mesh, Cantor bars, canopy) dealt on a widening lattice. Kept
        // playable but off the menu; a save started on it still runs on it.
        id: 'figures',
        name: 'figures',
        hidden: true,
        tell: 'whole figures, dealt downward',
        blurb: 'A complete construction is built first - gasket, mesh, Cantor '
             + 'bars, canopy - then dealt one row at a time so it assembles as '
             + 'it falls. The field widens to give the figures room.',
      },
      {
        id: 'bloom',
        name: 'bloom',
        tell: 'it grows where you leave it',
        blurb: 'Nothing descends. Blocks accrete onto whatever is still '
             + 'standing and stay where they land, so a clump you left is the '
             + 'seed the next one grows from. The run ends when the board '
             + 'fills up. Nothing has to reach you.',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // BLOOM - the growing field
  //
  // The mode has no sequence of its own. What arrives next is decided entirely
  // by what is on the board when the turn ends, so these numbers shape a
  // process rather than a pattern, and the only way to read them is to play it.
  // -------------------------------------------------------------------------
  bloom: {
    // Share of the playable field the board may hold before the run is over.
    // A growing field never seals itself - growth needs somewhere to grow - so
    // a limit at the last cell is a limit that never arrives. At this setting
    // the board crossing it is something a player watches coming for several
    // turns.
    fillShare: 0.58,

    // Blocks grown per turn when the difficulty has nothing to say. In play the
    // tier's number is used instead; this is the floor under it.
    budget: 3,

    // Blocks placed when the board is completely clear. A perfect turn should
    // buy a quiet one, not a free one.
    seedCells: 3,

    // Extra weight a candidate cell gets for sitting directly BELOW the mass.
    // This is what makes the field creep toward the swarm line as it thickens,
    // so the board filling up is something to watch rather than a number to
    // read.
    hang: 0.55,

    // How much of a candidate's score is the hash of its own position. Zero
    // makes a symmetric board grow the same handful of cells every turn; too
    // much drowns the structure and the growth stops reading as growth.
    jitter: 0.5,

    // Mild preference for lower rows over higher ones, independent of where
    // the mass is. Keeps a cluster that has drifted upward from sitting out of
    // reach at the top of the field forever.
    climb: 0.14,

    // Turns a marker waits to be collected before it is gone.
    //
    // A marker in a descending field is already a limited offer - it enters at
    // the top and rides off the bottom in about eight turns - and the supply
    // line is the difficulty ladder's only working dial, so a field that kept
    // its markers forever would be a field the ladder no longer grips. Eight
    // is that same window, stated rather than inherited from the geometry.
    markerTurns: 8,

    // Markers on the board at once. A BACKSTOP, NOT A DIAL: the lifetime above
    // is what bounds the count in play, and this only stops a very long
    // lifetime ending in a board of markers with nowhere left to grow. Set low
    // enough to bind it throttles the supply line and the tiers converge, which
    // is measured and is why it is not four.
    maxMarkers: 12,

    // How full the board has to be before the readout turns hot. Early enough
    // that it is a warning rather than an announcement of something the player
    // has already lost.
    warnAt: 0.72,
  },

  // -------------------------------------------------------------------------
  // FRACTAL - the field that is a picture of a set
  //
  // Julia sets and the Mandelbrot set, laid onto the lattice (src/fractal.js)
  // and painted at pixel resolution through the blocks (src/fractal-surface.js).
  // The view pulls back over the run: cells shrink from sixty-five pixels to
  // about eleven, and the picture that a handful of blocks were pieces of
  // comes into view whole.
  // -------------------------------------------------------------------------
  fractal: {
    // THE PAN-OUT. Columns the lattice climbs through, one rung every
    // `rungRows` rows dealt, holding the last rung for the rest of the run.
    // The widest rung is also the width every panel is fitted to, so the
    // widest view shows a whole picture. Forty-eight is a 10.8px cell, just
    // wider than a body, so a one-cell hole in the filigree is still a hole a
    // body can find.
    ladder: [8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48],
    rungRows: 6,

    // HOW FAST THE FIELD COMES DOWN, in pixels per turn. One row a turn at a
    // sixty-five pixel cell; six rows a turn at an eleven pixel one. Rows are
    // thinner as the view pulls back, so without this the descent would slow
    // to a crawl exactly when the picture is biggest.
    descentPx: 60,

    // Health per row, as a multiple of the tier's block number, shared among
    // the row's pieces by weight (area, and how deep into the band). Several
    // rows arriving in one turn share it by `turnScale`: 0 keeps the whole
    // TURN at one row's worth, 1 gives every row the full amount.
    rowBudget: 2,
    turnScale: 0.3,
    // Bounds on one piece's share of the tier number. A picture row can be
    // forty pieces, each a chip, or one arc that is the whole row.
    shareMin: 0.02,
    shareMax: 2,

    // THE PIECES. The band is cut along its iteration shells (`shell`
    // iterations each) and along the external rays of the `rayIter`-th
    // iterate, starting from `sectors` slices of the ray angle and doubling
    // them, up to `maxLevel` times, until no piece is larger than `maxArea`
    // cells; a piece smaller than `minArea` joins its longest neighbour.
    // Areas are in world cells, so a piece is the size of a cell or so at
    // every rung: big lace at the start, the picture's pixels at the end.
    // MEASURED with tools/mode-sim.js (6 runs a cell, aim bot median depth):
    // minArea 0.12 -> 49/49/50/39/24 across the tiers, 0.5 -> 63/66/38/37/26
    // with the aiming bot pulling further ahead of the sweep, so bigger
    // pieces reward aim a little more and read as blocks rather than dust.
    pieces: {
      maxArea: 1.6,
      minArea: 0.45,
      sectors: 4,
      rayIter: 5,
      shell: 1,
      maxLevel: 8,
    },
    // A strip more than this share band across its dealt width is a wall,
    // and its faintest pieces give way until it is not. 0 turns it off.
    maxFill: 0.7,

    // Escape-time iteration cap. Deep enough that the sixty-five pixel cells
    // at the start still show structure near the boundary; the bands past
    // this are thinner than a pixel at any size the field is shown at.
    maxIter: 160,
    // Coarse samples per cell edge, and the share past the threshold, for the
    // cell-level view that trims a panel to where its mass is.
    samples: 4,
    massShare: 0.35,
    // Share of a panel's window that becomes band. The threshold is chosen
    // per panel to hit this, so a thin dendrite and a fat rabbit are equally
    // playable. Lower is closer to the set: more lace, less halo.
    massTarget: 0.26,
    // The near band: iteration counts below this share of the cap are sky, no
    // matter what the target asks for.
    nearShare: 0.05,
    // Bounding-box scan resolution and the margin around the set.
    scan: 140,
    margin: 0.06,
    // Rows a panel may span, and empty rows between panels.
    minRows: 20,
    maxRows: 64,
    gap: 1,
    // Every Nth panel is the Mandelbrot set stood on end; the rest are Julia
    // sets from the curated list in src/fractal.js.
    mandelbrotEvery: 3,

    // THE PICTURE. A cyclic ramp over the smooth iteration count, `cycle`
    // iterations per pass, starting `phase` of the way round at the band's
    // outer edge so the sky runs down through the dark and the lace comes up
    // through blue and violet to white at the set. Dark sky in the game's own
    // void rather than the cyan of a poster, because the swarm is cyan and
    // has to stay the brightest cool thing on screen.
    ramp: [
      [0.00, '#0b1030'],
      [0.14, '#1a3aa8'],
      [0.30, '#5b5cf0'],
      [0.45, '#b48cff'],
      [0.55, '#f1e6ff'],
      [0.66, '#c26cf0'],
      [0.80, '#3a2c9e'],
      [1.00, '#0b1030'],
    ],
    inside: '#05060f',      // the interior of the set
    cycle: 40,
    phase: 0.12,
    // The picture under the empty cells, and how far a worn piece darkens.
    ghost: 0.24,
    wear: 0.6,
    // The outline traced round every piece, as an alpha of the void.
    outline: 0.6,
    // Rows from the line at which a piece's outline turns hot.
    threatRows: 2.5,
    // Share of the field's aerial haze the picture takes. The main field
    // fades its far rows to almost nothing; a picture washed out at the top is
    // just less picture, so it takes less.
    haze: 0.45,
    // A piece whose widest inside span is narrower than this carries no
    // health number - the picture is the information at that size.
    numeralMin: 22,
  },

  // -------------------------------------------------------------------------
  // BLOCKS - what a block can be besides a number
  //
  // Every block on the field is a cell with health. A KIND is what else it is.
  //
  // Special blocks are rare on purpose. A player has to trust the ordinary rule
  // before breaking it means anything, so nothing appears in the opening
  // minute, and after that a few blocks in a hundred are something else. Which
  // ones is decided from the run's seed and the block's own position, so a seed
  // always produces the same field including its surprises.
  //
  // COLOUR IS NOT DECORATION AND THERE IS NO NEW VOCABULARY TO LEARN.
  //
  // Every tint below is one of the five palette colours the game already uses
  // everywhere else, with the meaning it already has. A player who has seen the
  // readout knows what a bracket colour is promising before they break it:
  //
  //   swarm   cyan    it makes you bigger
  //   essence gold    it pays
  //   force   violet  it moves the field
  //   trade   green   it improves you, permanently
  //   hot     red     it is a problem
  //
  // Ten kinds sharing five meanings is a thing you can read at a glance. Ten
  // kinds with ten colours is a legend nobody reads.
  //
  // `from` is the depth a kind first appears at, so the vocabulary arrives a
  // piece at a time rather than all at once. `hp` multiplies the health the
  // tier asked for, for the kinds that are obstacles rather than payouts.
  //
  // THE EFFECT VERBS, all applied in one place in index.html:
  //
  //   burst {count,speed,life}  bodies thrown out in every direction. They break
  //                             blocks and collect markers like anything else,
  //                             and then they are gone - a burst is a good turn,
  //                             never a permanent gain.
  //   essence n                 paid on top of what the block was worth
  //   balls   n                 added to the swarm permanently
  //   power   n                 damage per hit, permanently
  //   clearRow                  destroy the lowest row outright
  //   column                    destroy everything in this block's column
  //   chain                     destroy every block touching this one
  //   lift    n                 push the whole field back up n rows
  //   collect                   every marker on the board is collected at once
  //   splinter {count,hp}       leaves smaller blocks behind instead of nothing
  //
  // Adding a kind means adding an entry here. It needs code only if it wants a
  // verb this list does not have.
  // -------------------------------------------------------------------------
  blocks: {
    // Share of blocks that carry a kind at all. Rare enough that seeing one is
    // an event and not a mechanic to plan around.
    share: 0.055,

    // Nothing special until the field has been ordinary for a while. A kind's
    // own `from` can push it later, never earlier.
    firstDepth: 6,

    kinds: [
      {
        id: 'burst', name: 'burst', weight: 1.0, from: 6, tint: 'force',
        // Bodies in every direction, for this turn only.
        //
        // NO FUSE. It used to carry life: 150, and that fuse KILLED ROUGHLY A
        // THIRD OF THEM IN MID AIR - measured, 8 of 26 - so the best block in
        // the game half went off. The fuse existed for one reason, which was to
        // guarantee that a body thrown flat could not bounce between the walls
        // forever and hang the turn. Every body now carries a step budget that
        // guarantees exactly that no matter what it is doing, so the fuse was
        // buying nothing and costing the thing the block is for.
        //
        // The turn already waits for every body before it closes, so with the
        // fuse gone a burst plays out in full: they break what they can reach
        // and then come home, and the turn ends when the last of them does.
        effect: { burst: { count: 26, speed: 0.78 } },
      },
      {
        id: 'vault', name: 'vault', weight: 0.9, from: 8, tint: 'essence',
        // Pays. The number is small on purpose - the windfall marker is the big
        // payout and it has to be reached; this one only has to be hit.
        effect: { essence: 40 },
      },
      {
        id: 'conscript', name: 'conscript', weight: 0.55, from: 10, tint: 'swarm',
        // The best block in the game, and the one worth changing an angle for.
        effect: { balls: 2 },
      },
      {
        id: 'lance', name: 'lance', weight: 0.7, from: 12, tint: 'force',
        // Its whole column, top to bottom. Worth setting up a shot for.
        effect: { column: true },
      },
      {
        id: 'chain', name: 'chain', weight: 0.7, from: 14, tint: 'force',
        // Everything touching it. Pays for breaking into the MIDDLE of a clump
        // rather than nibbling its edge, which is the skill the growing field
        // asks for anyway.
        effect: { chain: true },
      },
      {
        id: 'splinter', name: 'splinter', weight: 0.8, from: 16, tint: 'hot',
        // A trap. Breaking it leaves two smaller blocks where one used to be,
        // so the field gets wider rather than emptier and a careless clear can
        // cost more than it gained. The pieces go in the free cells beside
        // it, so it needs a field made of cells.
        needsLattice: true,
        effect: { splinter: { count: 2, hp: 0.45 } },
      },
      {
        id: 'lift', name: 'lift', weight: 0.45, from: 18, tint: 'force',
        // A rescue. The whole field goes back up a row, which is a turn of
        // headroom handed back at exactly the moment it is worth most.
        effect: { lift: 1 },
      },
      {
        id: 'anchor', name: 'anchor', weight: 0.9, from: 20, tint: 'hot',
        // Not a payout at all - an obstacle. Several times the health of its
        // neighbours, so it survives the pass that cleared everything around it
        // and stands there as the thing still in the way.
        hp: 3.5,
        effect: { essence: 12 },
      },
      {
        id: 'lodestone', name: 'lodestone', weight: 0.5, from: 22, tint: 'essence',
        // Every marker on the board at once. In a field where markers strand
        // out of reach this is the answer to a board that has gone wrong.
        effect: { collect: true },
      },
      {
        id: 'temper', name: 'temper', weight: 0.35, from: 26, tint: 'trade',
        // Permanent damage. The rarest thing in the game and the only kind that
        // changes every future turn.
        effect: { power: 1 },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // AWARDS - the only thing that survives a run
  //
  // A run ends and takes everything with it, which is what makes the next one a
  // decision rather than a continuation. These are the exception, and they are
  // deliberately the smallest exception possible: a list of things that have
  // happened once. None of them changes how the game plays.
  //
  // Every one is a THRESHOLD on a number that only goes up, so nothing here can
  // be missed, nothing has to be remembered, and nothing is a task. They are
  // the things that happen on the way to playing well - deeper, bigger,
  // cleaner - never a detour taken on purpose. See src/awards.js for what each
  // track measures.
  // -------------------------------------------------------------------------
  awards: {
    list: [
      // Depth. The spine of the whole thing.
      { id: 'depth-15',  track: 'depth',   at: 15,   name: 'the shelf',        note: 'reach depth 15' },
      { id: 'depth-30',  track: 'depth',   at: 30,   name: 'the drop',         note: 'reach depth 30' },
      { id: 'depth-60',  track: 'depth',   at: 60,   name: 'past the light',   note: 'reach depth 60' },
      { id: 'depth-100', track: 'depth',   at: 100,  name: 'the trench',       note: 'reach depth 100' },

      // The swarm. The number the whole game is about.
      { id: 'swarm-25',  track: 'swarm',   at: 25,   name: 'a crowd',          note: 'a swarm of 25' },
      { id: 'swarm-100', track: 'swarm',   at: 100,  name: 'a legion',         note: 'a swarm of 100' },
      { id: 'swarm-500', track: 'swarm',   at: 500,  name: 'uncountable',      note: 'a swarm of 500' },

      // Clearing. The skill the game rewards most and teaches least.
      { id: 'clear-1',   track: 'clears',  at: 1,    name: 'nothing left',     note: 'clear a board to nothing' },
      { id: 'clear-15',  track: 'clears',  at: 15,   name: 'housekeeping',     note: 'clear 15 boards' },
      // Named for what it counts. The old name was a climbing phrase that,
      // in a game with a shop, read as an award for buying nothing.
      { id: 'streak-3',  track: 'streak',  at: 3,    name: 'three clean',      note: 'clear three boards in a row' },

      // The vocabulary. Breaking a kind is how you find out what it does.
      { id: 'kinds-4',   track: 'kinds',   at: 4,    name: 'field notes',      note: 'break 4 kinds of special block' },
      { id: 'kinds-10',  track: 'kinds',   at: 10,   name: 'the whole bestiary', note: 'break every kind of special block' },

      // The rest of the run.
      { id: 'power-5',   track: 'power',   at: 5,    name: 'sharpened',        note: 'reach 5 damage a hit' },
      { id: 'rich-1000', track: 'essence', at: 1000, name: 'flush',            note: 'hold 1,000 essence in one run' },
      // TIER is what the ladder is called in the code and nowhere a player can
      // see it. On screen it is the difficulty, so that is the word here.
      { id: 'win-1',     track: 'wins',    at: 1,    name: 'past the last row',  note: 'outlast every row a difficulty has' },
      { id: 'win-3',     track: 'wins',    at: 3,    name: 'three times over',  note: 'outlast a difficulty in three runs' },
      // The ladder is the thing named after water - shallows to abyss - so an
      // award for playing all three MODES could not be named after it.
      { id: 'modes-3',   track: 'modes',   at: 3,    name: 'well traveled',   note: 'play all three modes' },
    ],

    // The banner over the field when one is won.
    wonTitle: 'award',

    // The menu heading, and what it says with none won yet.
    heading:  'awards',
    none:     'nothing yet',

    // Under the heading. None of these grants anything, and a list of names
    // with progress bars looks exactly like a list that does - so it says so
    // once, where the list is read, rather than letting a player wonder what
    // they are missing by not chasing them.
    note:     'a record of what you have done. none of them change how the game plays.',
  },

  // -------------------------------------------------------------------------
  // BOARD - the shape of the playfield
  //
  // The canvas is a fixed pixel grid scaled to fit the window, so these are
  // authoring units, not screen units. Cell size is width / cols and is not
  // set directly.
  // -------------------------------------------------------------------------
  board: {
    width:  520,
    height: 620,

    // Columns the field STARTS at. It does not stay here: see `ladder`.
    cols: 8,

    // THE VIEW PULLS BACK AS A RUN GOES ON.
    //
    // The rungs the field widens through, in order; the last one repeats
    // forever. Each step shrinks the blocks a little and fits more of them,
    // which is the only way the fractal constructions get room to be
    // themselves: eight columns holds three levels of recursion and no exact
    // Cantor set at all. Nine is on the ladder because the base three figures -
    // dust, cross, carpet - are exact only at a power of three, and sixteen
    // because the bisecting one is exact only at a multiple of eight.
    //
    // WHERE IT STOPS, AND WHY IT STOPS THERE. The ladder used to run to twenty
    // seven, which is a nineteen pixel cell: less than a third of the starting
    // size, too small to read a health number in, and small enough that the
    // first thing anyone said about the field was that the blocks were
    // shrinking. Sixteen is half the starting cell and still legible, so that
    // is the end of it. Losing twenty seven costs the base three figures their
    // second exact width and nothing else - they still land at nine.
    ladder: [8, 9, 10, 12, 14, 16],

    // Figures dealt at each rung before the field steps to the next one.
    //
    // ONE, BECAUSE THE LADDER IS CONTENT AND A RUN HAS TO REACH THE END OF IT.
    // A figure is as tall as the field can show, so it takes nine rows at eight
    // columns and sixteen at the widest, and the whole ladder is about sixty
    // eight rows. A tier feeds one row a turn and finishes between sixty and
    // ninety, so at one figure a rung a run walks the entire ladder exactly
    // once and the widest field is something the longer tiers get to. At two it
    // never passes twelve columns and the last three rungs are rungs no player
    // ever stands on.
    ladderHold: 1,

    // Seconds the view takes to settle after a widening. The lattice changes
    // between figures in one step; what the player sees is this ease. Long
    // enough not to snap, short enough to finish inside one turn.
    viewEase: 0.9,

    // Pixels of headroom at the top of the canvas, under the readout. This is
    // the CEILING - the line a body bounces off.
    topGap: 40,

    // THE LANE. Pixels between the ceiling and the first row of blocks.
    //
    // Blocks used to start at the ceiling, so the best a shot could do was
    // strike the top row from below and come straight back. A body that gets
    // ABOVE the field instead rakes the whole top row from above, over and over,
    // and that is the best thing that can happen to a shot in a game like this.
    // It could not happen at all while there was nowhere to be.
    //
    // A little wider than a body, so one can actually travel in it rather than
    // merely fit. Wider than this and it stops being a reward for a good angle
    // and becomes somewhere shots end up by accident.
    ceilingGap: 20,

    // Pixels from the bottom of the canvas to the swarm line. A block crossing
    // that line ends the run.
    floorGap: 86,
  },

  // -------------------------------------------------------------------------
  // SWARM - the bodies, and how they move
  // -------------------------------------------------------------------------
  swarm: {
    radius: 5,          // body radius in board units
    speed:  11,         // board units per frame

    // Collision is checked this many times per frame. Lower it and a fast body
    // can pass through a block; raise it and the cost per body climbs.
    substeps: 3,

    // Above this many blocks on the board, collision looks blocks up by cell
    // instead of scanning the whole list for every body on every substep. The
    // two give the same answer; the lookup is what keeps a field of a
    // thousand small cells (the picture field) from crawling under a big
    // swarm. The main field never has this many.
    indexAbove: 64,

    // THE FLATTEST SHOT THE LAUNCHER WILL TAKE, in degrees above horizontal.
    //
    // It is NOT a safety rule and it never really was one worth fifteen
    // degrees. Turns are guaranteed to end by `maxSteps` below, which bounds
    // every body no matter what the physics does; this number only exists
    // because a shot flat enough to rattle along the floor spends a whole turn
    // and returns nothing, and the launcher should not let a player throw a
    // turn away by dragging slightly too low.
    //
    // Eight rather than fifteen: low enough that the flat cross-field angles
    // are all available, high enough that the genuinely wasted ones are not.
    //
    // AND IT IS NEVER A REFUSAL. Dragging below it slides the aim along the
    // limit and the shot still fires - see fire() and the aim drawing. The old
    // behaviour was to blank the line and silently do nothing, which told the
    // player neither that there was a rule nor what it was.
    minAngleDeg: 8,

    // HOW A TURN IS GUARANTEED TO END: every body is retired after this many
    // simulation steps, whatever it is doing.
    //
    // This is the whole termination argument now, and it is deliberately a
    // construction rather than an inference. The old argument was geometric -
    // a minimum launch angle put a floor under |vy|, bounces preserved it
    // exactly, so every body reached the floor in bounded time. It was true,
    // and it was fragile in the worst way: it rested on a property of the
    // COLLISION CODE, so any future change to how a body bounces could silently
    // remove the guarantee without touching anything that looked like it was
    // about the guarantee. The ceiling skim below is exactly such a change.
    //
    // A budget cannot be undone by a physics change. The worst legal single
    // body turn ever measured is about 1,540 steps, so this is roughly twice
    // the worst real turn and should never be reached in play.
    maxSteps: 3000,

    // WHEN A TURN STARTS TO CLOSE ITSELF.
    //
    // A body's own step budget bounds one body. It does not bound a TURN, and
    // the field powers are all ways of keeping bodies up: orbit holds them on
    // a block, pull steers them off the floor, lensing and overrun buy them
    // extra crossings of it. Stacked, they took an eight-second turn to fifty
    // seconds, every turn, which is not a stronger build - it is waiting.
    //
    // So the floor comes for everything. After `settleAfter` frames every body
    // starts being pushed down, harder over the next `settleRamp` frames, and
    // a body held in orbit is let go. A long turn is still longer than a short
    // one; it just cannot be indefinite.
    settleAfter: 420,
    settleRamp:  300,
    settleForce: 0.55,

    // THE SMALLEST VERTICAL SHARE A SPRAYED BODY MAY BE THROWN AT.
    //
    // A spray goes out evenly around the circle, which means some of it goes
    // out very nearly flat - and a flat body crosses the field sideways
    // forever, because a bounce preserves its speed exactly. That is what the
    // fuse used to be for, and the fuse was a bad answer: it killed every body
    // at the same moment whether it was stuck or not.
    //
    // Nudging the flat ones off the horizontal is the answer that costs
    // nothing. Every body is thrown with a real vertical component, so every
    // body comes home on its own, so the turn ends because the burst FINISHED
    // rather than because a clock ran out.
    burstRise: 0.3,

    // THE CEILING SKIM. Share of vertical speed a body keeps when it bounces
    // off the ceiling; the rest is turned into horizontal speed, so the total
    // speed is exactly unchanged.
    //
    // A perfect mirror is what stops a body ever STAYING in the lane above the
    // field: it arrives, reverses, and leaves the way it came. Flattening it
    // instead means a body that reaches the lane skims along it, raking the top
    // row from above for as long as it can hold the line. That is the best
    // outcome a shot has, and it is earned by finding a gap.
    skim: 0.5,

    // FLOOR UNDER THE VERTICAL SHARE after skimming.
    //
    // This is the dial that decides how long a skimming body can stay up, and
    // it matters more than it looks. At 0.12 a body crosses the field
    // vertically at a tenth of its speed, and the sweep found single-body turns
    // running the full three thousand step budget - the guarantee held, but a
    // guarantee is not a pace. At 0.22 the body is still shallow enough to rake
    // several blocks a pass and still comes down on its own.
    skimFloor: 0.22,

    // HOW FAST A TURN RUNS - see turnSteps() in index.html.
    //
    // Nothing in this game is allowed to be waiting; anything tedious is
    // something essence buys past. A turn with three hundred bodies breaks that
    // rule on its own, because every one of them has to leave the field before
    // the turn can close.
    //
    // So the SIMULATION runs faster, never the bodies. Speed, radius, substeps
    // and every collision are untouched and a turn plays out exactly as it
    // would have - there are simply more of its steps inside each frame. That
    // keeps replays honest and keeps fast bodies from tunnelling, which raising
    // the speed would not.
    hasteFrom:  24,     // bodies before any speed-up at all
    hasteSwarm: 16,     // bodies per extra step after that
    hasteAfter: 180,    // steps a turn may take before time alone speeds it up
    hasteRamp:  70,     // steps per extra step after that
    hasteMax:   20,     // ceiling on steps per frame

    // Frames between bodies leaving the launcher, before the crowding term.
    // A larger swarm fires tighter: gap = max(1, round(baseGap - swarm/crowd)).
    launchGap:   4,
    launchCrowd: 20,

    // What a new run starts with when the difficulty tier does not say
    // otherwise. Tiers normally do say otherwise.
    startingPower: 1,   // damage per hit
  },

  // -------------------------------------------------------------------------
  // ECONOMY - the field's half of it
  //
  // Prices, upgrades and what a block pays live in src/economy.js. What is
  // here is only what the FIELD decides: how a row's health is divided among
  // the blocks in it, and what clearing a board to nothing pays.
  // -------------------------------------------------------------------------
  economy: {
    // WHAT A BLOCK PAYS IS NOT HERE ANY MORE.
    //
    // A block pays MATERIAL, and which material and how much of it are the
    // market's business - src/economy.js, from the column the block stood in
    // and the depth it arrived at. Upgrades are priced there too, in material
    // rather than cash. What is left in here is the field's own arithmetic:
    // how a row's health is shared out, and the one payout the field makes
    // itself for clearing a board.

    // HOW MUCH HEALTH A ROW IS WORTH, RATHER THAN A BLOCK.
    //
    // The difficulty ladder decides how much health a block carries, and it was
    // measured against a generator that put about three blocks in a row. A
    // fractal figure does not care about that: a carpet row can be solid and a
    // gasket row can hold one block. Taking the tier at its word would mean a
    // solid row arriving with nearly three times the health the tier intended,
    // which kills a run in single digit depths.
    //
    // So the tier's number is treated as the health of a ROW, and shared out
    // among whatever blocks the figure put in it. A dense row is many soft
    // blocks, a sparse row is a few hard ones, and the material colouring makes
    // which is which readable at a glance.
    //
    // ONLY THE FIGURE FIELD READS THIS. The other two give every block the
    // whole of the tier's number, so this is the one dial that moves the
    // fractal mode and nothing else.
    //
    // FOUR, MEASURED. It was three while the field widened at half the pace it
    // does now; capping the ladder so a run walks all of it made every row
    // wider, and a wider row is more blocks the swarm sweeps in one pass, which
    // took the fractal mode's swell median from 20 to 40 - twice as forgiving
    // as the field it sits beside. Four puts it back at 21. Five is not a
    // harder setting, it is a cliff: the shallows median falls from 67 to 9,
    // which is the opening becoming unsurvivable rather than the run becoming
    // harder. Measured over 32 runs a tier with tools/mode-sim.js.
    rowBlocks: 4,

    // Bounds on that sharing, so a one block row is not an unbreakable pillar
    // and a solid row is not free.
    rowShareMin: 0.5,
    rowShareMax: 2,

    // A BOARD CLEARED TO NOTHING.
    //
    // The field refills every turn, so an empty board is not a state the game
    // ever rests in - it is a single instant between the last block breaking
    // and the next one arriving, and it only happens when a shot did everything
    // it could have. That deserves paying for, and it deserves being SEEN,
    // which is what the banner is for.
    //
    // Priced like an offer - base + perDepth * depth - so it keeps pace with
    // what it could buy instead of turning into pocket change by depth forty.
    clearBonus: { base: 30, perDepth: 7 },

  },

  // -------------------------------------------------------------------------
  // DIFFICULTY - which ladder rung a run is played on
  //
  // The tiers themselves live in src/tiers.js, where each one carries the
  // measurements it was built from. Override numbers here rather than editing
  // that file, so the reasoning next to each number stays intact.
  //
  //   tierOverrides: { shallows: { supply: { start: 8 } } }
  //
  // Only the keys you name are replaced; the rest of the tier is untouched.
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // TRADING - a whole way to play, kept out of the way of the one that is not
  //
  // Off, a block pays essence and one short list spends it. On, a block pays
  // one of four ores and the desk opens: books with their own prices, a
  // refinery, consignments, an assay, and the powers that only matter to
  // somebody reading a price.
  //
  // Trading is not a later stage of a run, it is a different run. Nothing is
  // half on: a run is one or the other from its first turn and keeps what it
  // started with even if this is changed underneath it.
  // -------------------------------------------------------------------------
  trade: {
    on: false,
    offLabel: 'off',
    onLabel: 'on - four ores and a market',
  },

  difficulty: {
    defaultTier: 'swell',

    // EVERY TIER'S BLOCK HEALTH, SCALED TOGETHER.
    //
    // The ladder's own note says health is the casual dial and nothing more:
    // moved over its whole range it swung a beginner's finish rate and left
    // strong play exactly where it was, because the run was decided by the
    // supply line long before health mattered.
    //
    // That was measured against a field where a body struck the top row once
    // from below and left. It is no longer that field - there is a lane above
    // it now, and a threaded shot rakes the whole row from above - so damage
    // per shot varies far more between a good angle and a careless one than it
    // used to, and health has become the thing that decides whether a careless
    // one accomplishes anything at all. It separates the two now, which is
    // exactly what a difficulty dial is supposed to do.
    //
    // Kept as one number over the whole ladder so each tier keeps the shape it
    // was authored with and only the overall weight moves.
    healthScale: 1,


    // Tiers are designed to open one at a time. While true, every rung is
    // selectable from the start.
    unlockAll: true,

    tierOverrides: {},
  },

  // -------------------------------------------------------------------------
  // PALETTE - the whole colour vocabulary
  //
  // A colour in this game says one thing and only that thing. Change a value
  // and every surface carrying that meaning changes with it: the readout, the
  // blocks, the particles, the shop.
  // -------------------------------------------------------------------------
  palette: {
    void:  '#08090c',   // the ground everything sits on
    panel: '#0e1016',   // raised surfaces, readout backing
    rule:  '#1c2029',   // hairlines, frames, grid

    ink:   '#e6e9ef',   // anything that must be read
    dim:   '#7a828f',   // labels, units, secondary figures

    swarm:   '#5ad1ff', // the player: bodies, the pool, the launcher
    essence: '#ffc94a', // value: payout, pickups, prices
    hot:     '#ff5c46', // threat: proximity to the line, breach, loss
    force:   '#b98cff', // curvature: gravity, orbits, anything that bends
    trade:   '#6ee7a8', // supply: material, fills, contracts
    tithe:   '#8f9aa8', // obligation: costs, interest, what is owed
  },

  // -------------------------------------------------------------------------
  // FEEL - effects that change nothing about the outcome
  // -------------------------------------------------------------------------
  feel: {
    shake:     1,       // screen shake multiplier; 0 turns it off
    particles: 1,       // particle density, 0 to 1

    // HOW LOUD THE SCENERY IS. The backdrop draws a signature geometry per
    // regime, and the fractal field points each figure at the signature that
    // echoes its construction. When the backdrop is drawn at full strength that
    // agreement turns into competition: the huge shape behind the field reads
    // as the game and the blocks read as scatter in front of it. This scales
    // every signature at once, so it is the one dial to turn when the scenery
    // is shouting over the field. 0 removes the backdrop geometry entirely and
    // leaves the wash behind it.
    backdrop: 0.6,

    // null follows the operating system's reduced motion setting. true or
    // false overrides it.
    reducedMotion: null,

    // Seconds a block that APPEARS spends announcing itself, for the fields
    // where blocks are placed rather than slid in from the top edge. 0 removes
    // the flash; a block then simply exists where it did not before.
    arrivalFlash: 0.38,

    // Seconds a banner stays on screen when something happens worth seeing -
    // a board cleared to nothing, an award earned. Long enough to read, short
    // enough that it is gone before the next shot.
    momentLife: 1.6,

    // Draws the wordless opening lesson for a player who has never fired.
    onboarding: true,

    // THE PAGE AROUND THE BOARD.
    //
    // The canvas already carries a hue for whatever is being played - the wash
    // behind the field, the backdrop geometry, the horizon - and it moves as a
    // run descends from one generator to the next. The page around the canvas
    // knew none of that and stayed one flat near-black, so the frame and the
    // picture read as two images butted together, worst where the field is
    // most coloured.
    //
    // These give the page the field's own hue at a lower lightness than the
    // field's own wash, which is the whole trick: the frame belongs to the
    // picture and the BOARD is still the brightest thing on the screen. The
    // three lightnesses are the page, the raised surfaces on it (buttons, the
    // mode rows) and the hairlines between them, in percent, and they keep the
    // spacing the fixed palette had.
    //
    // Set to null to pin the page to palette.void and never touch it again.
    // `sat` is used where the field only has a hue to give; `satMax` caps a
    // field that names its own ground and names a vivid one. `page` is the
    // page's lightness in percent for a field that only gave a hue, and
    // `refShare` is the share of its own lightness taken from a field that
    // named a colour. `panel` and `line` are LIFTS above whichever of those
    // applies, so the chrome keeps the spacing the fixed palette had.
    ground: { sat: 34, satMax: 50, page: 6, refShare: 0.7, panel: 3, line: 9.5 },
  },

  // -------------------------------------------------------------------------
  // DEV - switches that only matter while tuning
  // -------------------------------------------------------------------------
  // THE BOARD'S SERVER, OR NO SERVER AT ALL.
  //
  // Empty is a complete and supported setup, not a broken one: with no
  // endpoint the game makes NO network call whatsoever, the board panel shows
  // this device's own runs, and every row reads unchecked. Fill this in only
  // after the Worker is deployed - see docs/LEADERBOARD.md for the four steps.
  boards: {
    endpoint: 'https://swarm-breaker-boards.xxgeminixx.workers.dev',
    // Remote boards only run on hosts named here, so a fork served from
    // anywhere else keeps its own runs and never calls this Worker.
    allowedHosts: ['localhost', '127.0.0.1', 'xxgeminixx.github.io'],
  },

  dev: {
    // THE CACHE BUSTER, WRITTEN DOWN.
    //
    // Every module import in index.html carries `?v=<n>`. A browser holding an
    // old copy of a module against a new index.html is the one break that
    // cannot be seen by loading the game locally, so the number is bumped on
    // every release and every import carries the same one. This is that number
    // and nothing reads it - it is here so the value has one place to be
    // checked against.
    build: 18,

    // Allows ?set= in the URL and a `cfg` entry in browser storage to patch
    // anything above. Turn off for a build you do not want poked at.
    allowOverrides: true,
  },
};


// ---------------------------------------------------------------------------
// OVERRIDES
//
// Applied in order: this file, then browser storage, then the URL. The URL wins
// so a link can carry a whole configuration.
// ---------------------------------------------------------------------------

function assignPath(target, path, value) {
  const keys = path.split('.');
  let node = target;
  for (let i = 0; i < keys.length - 1; i++) {
    if (node[keys[i]] === null || typeof node[keys[i]] !== 'object') return false;
    node = node[keys[i]];
  }
  const leaf = keys[keys.length - 1];
  if (!(leaf in node)) return false;

  // The type already in place decides how the text is read, so a number stays
  // a number and a colour stays a string.
  const was = node[leaf];
  if (typeof was === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    node[leaf] = n;
  } else if (typeof was === 'boolean') {
    node[leaf] = value === 'true' || value === '1';
  } else {
    node[leaf] = value;
  }
  return true;
}

function mergeDeep(target, patch) {
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) &&
        target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      mergeDeep(target[k], v);
    } else {
      target[k] = v;
    }
  }
}

/** Everything an override actually changed, so a session can show its own
 *  configuration rather than guessing at it. */
export const appliedOverrides = [];

(function applyOverrides() {
  if (!CONFIG.dev.allowOverrides) return;
  if (typeof window === 'undefined') return;

  try {
    const raw = localStorage.getItem('cfg');
    if (raw) {
      const patch = JSON.parse(raw);
      if (patch && typeof patch === 'object') {
        mergeDeep(CONFIG, patch);
        appliedOverrides.push('storage:cfg');
      }
    }
  } catch (e) { /* a malformed override must never stop the game loading */ }

  try {
    const params = new URLSearchParams(location.search);
    for (const entry of params.getAll('set')) {
      const eq = entry.indexOf('=');
      if (eq < 1) continue;
      const path = entry.slice(0, eq).trim();
      const value = entry.slice(eq + 1);
      if (assignPath(CONFIG, path, value)) appliedOverrides.push(path + '=' + value);
    }
  } catch (e) { /* same */ }
})();


// ---------------------------------------------------------------------------
// DERIVED VALUES
//
// Read these rather than recomputing them, so one definition of a cell or a
// storage key exists.
// ---------------------------------------------------------------------------

/** Cell size at the STARTING width. The live one moves as the view pulls back
 *  and is owned by the game, not by this file. */
export const CELL0 = CONFIG.board.width / CONFIG.board.cols;

/**
 * The ladder as one width per FIGURE, with each rung repeated `ladderHold`
 * times. Kept apart from `board.ladder` so that file stays a readable list of
 * the widths the field visits rather than a list with its own pacing baked in.
 */
export const LADDER = Object.freeze((() => {
  const hold = Math.max(1, CONFIG.board.ladderHold | 0);
  const out = [];
  for (const w of CONFIG.board.ladder) {
    for (let i = 0; i < hold; i++) out.push(Math.max(4, w | 0));
  }
  return out.length ? out : [CONFIG.board.cols];
})());

/** Width the figure numbered n is dealt at. The last rung repeats. */
export const latticeAt = (n) => LADDER[Math.min(Math.max(0, n | 0), LADDER.length - 1)];

/** Leftmost WORLD column at a given width. World column zero is the left edge
 *  of the starting field, so widening opens negative columns on one side and
 *  columns past the start width on the other, symmetrically. */
export const leftEdgeAt = (cols) => -Math.floor((cols - CONFIG.board.cols) / 2);
/** The ceiling: the line a body bounces off at the top of the field. */
export const CEIL = CONFIG.board.topGap;

/** The field top: where row zero of the blocks begins. The gap between this
 *  and the ceiling is the LANE - see board.ceilingGap. */
export const TOP = CONFIG.board.topGap + Math.max(0, CONFIG.board.ceilingGap | 0);

export const FLOOR = CONFIG.board.height - CONFIG.board.floorGap;

/** Minimum vertical component of a legal shot, as a unit vector term. */
export const MIN_AIM_Y = Math.sin(CONFIG.swarm.minAngleDeg * Math.PI / 180);

/** Namespaced browser storage key. */
export const storageKey = (slot) => CONFIG.identity.storagePrefix + '.' + slot;

/** Cost of an offer at a given depth, before any per offer multiplier. */


// ---------------------------------------------------------------------------
// APPLYING IDENTITY TO THE PAGE
//
// The document carries the game's name and colours in half a dozen places.
// This puts them all there from the one source, so the markup never has to
// repeat a value that lives above.
// ---------------------------------------------------------------------------

export function applyIdentity(doc) {
  const d = doc || document;

  d.title = CONFIG.identity.name;

  // The headless test harness supplies enough of a document to boot the game
  // and no more, so every surface touched here is optional.
  const root = d.documentElement;
  const p = CONFIG.palette;
  const setVar = (name, value) => {
    if (root && root.style && typeof root.style.setProperty === 'function') {
      root.style.setProperty(name, value);
    }
  };
  setVar('--bg', p.void);
  setVar('--panel', p.panel);
  setVar('--line', p.rule);
  setVar('--ink', p.ink);
  setVar('--dim', p.dim);
  setVar('--hot', p.hot);
  setVar('--swarm', p.swarm);
  setVar('--block', p.rule);
  setVar('--pickup', p.essence);

  const put = (id, value) => {
    const el = typeof d.getElementById === 'function' ? d.getElementById(id) : null;
    if (el) el.textContent = value;
  };
  const t = CONFIG.text;
  put('lbl-depth',   t.stats.depth);
  put('lbl-swarm',   t.stats.swarm);
  put('lbl-essence', t.stats.essence);
  put('lbl-pattern', t.stats.pattern);
  put('hint',        t.hintIdle);
  put('reset',       t.resetButton);
  put('overtitle',   t.overTitle);
  put('again',       t.overAgain);
  put('overmodes',   t.overMenu);
  put('over-lbl-depth', t.overDepth);
  put('over-lbl-swarm', t.overSwarm);

  // The mode screen.
  put('menutitle',      CONFIG.identity.name);
  put('menutag',        CONFIG.identity.tagline);
  put('lbl-difficulty', t.difficultyLabel);
  put('lbl-trade',      t.tradeLabel);
  put('modes',          t.menuButton);
  put('resume',         t.menuResume);
  put('lbl-mode',       t.menuModeLabel);
  put('menuhint',       t.menuHint);
  put('menukinds',      t.menuKinds);
  put('awnote',         CONFIG.awards.note);

  const byId = (id) => (typeof d.getElementById === 'function' ? d.getElementById(id) : null);

  const sel = byId('tier');
  if (sel) sel.title = t.difficultyLabel;

  const canvas = byId('c');
  if (canvas) { canvas.width = CONFIG.board.width; canvas.height = CONFIG.board.height; }

  // The tab icon is drawn from the palette rather than shipped as a file, so a
  // recolour needs no asset and the game still has no binary dependencies.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" fill="' + p.void + '"/>' +
    '<rect x="6" y="5" width="9" height="7" fill="' + p.rule + '"/>' +
    '<rect x="17" y="5" width="9" height="7" fill="' + p.rule + '"/>' +
    '<circle cx="16" cy="23" r="4" fill="' + p.swarm + '"/>' +
    '</svg>';
  if (typeof d.createElement !== 'function' || !d.head) return;
  let icon = byId('cfg-favicon');
  if (!icon) {
    icon = d.createElement('link');
    icon.id = 'cfg-favicon';
    icon.rel = 'icon';
    d.head.appendChild(icon);
  }
  icon.type = 'image/svg+xml';
  icon.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}
