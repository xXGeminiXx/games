// ===========================================================================
// CONFIGURATION
//
// Every name, every word on screen and every number worth turning lives in
// this file and nowhere else. Change something here and the whole game follows:
// the browser tab, the readout, the colours, the physics, the save slot.
//
// Nothing here is read more than once per load, so a change takes effect on
// refresh. Nothing here needs a build step.
//
// HOW TO RENAME THE GAME
//   Set identity.name. That alone retitles the tab and the save slot. If you
//   want an existing save to carry over, leave identity.storagePrefix pinned to
//   its current value instead of letting it follow the name.
//
// HOW TO TRY A NUMBER WITHOUT EDITING THIS FILE
//   Append overrides to the URL, which is the fastest way to test a hosted
//   build from a phone:
//     ?set=seeding.bodiesPerClick=8&set=seeding.launchSpeed=0.9
//   They last for that one page load. To make one stick in this browser, open
//   the console and run:
//     localStorage.setItem('cfg', '{"seeding":{"bodiesPerClick":8}}')
//   Clear it with localStorage.removeItem('cfg'). Set dev.allowOverrides to
//   false to switch both off entirely.
// ===========================================================================

export const CONFIG = {

  // -------------------------------------------------------------------------
  // IDENTITY - what the game is called and where it keeps its things
  // -------------------------------------------------------------------------
  identity: {
    name: 'Accretion',
    tagline: 'a blank field, and whatever gravity makes of it',

    // Prefixes every browser storage key this game writes. Changing it starts
    // every player from a clean slate; keeping it preserves saves across a
    // rename.
    storagePrefix: 'accretion',
  },

  // -------------------------------------------------------------------------
  // TEXT - every word the player reads
  //
  // The game is close to wordless on purpose. These are all of them.
  // -------------------------------------------------------------------------
  text: {
    // The figure in the corner, and what it is called. It is the mass of
    // everything in the field, and it is the figure the run's own ceiling is
    // measured against, so what it is called has to be what is measured.
    massLabel: 'total mass',

    // The line along the bottom. It says the least it can and then stops: the
    // first prompt, one nudge to repeat it, and then silence.
    promptFirst:  'click the void',
    promptSecond: 'again',
    promptDone:   '',

    // Shown when the field holds as much mass as a run may hold and a click
    // can add nothing. It names the control that gets out of it rather than
    // pointing at a place on the screen, because a direction goes stale the
    // moment anything moves.
    promptFull:   'the field is full. it holds all the mass one run can carry. start over for a new one.',
    promptNearFull: 'the field is nearly full. what is here keeps working, but almost nothing more will fit.',
    // Starting over is not the ending: the ending keeps what was learned and
    // this throws it away, so the question has to say so.
    confirmAgain: 'Start over? This run and everything learned in it are thrown away.',

    // WHAT THE FIELD SAYS THE FIRST TIME IT MAKES SOMETHING. One line, along
    // the bottom, the first time each of these happens, then quiet. Keyed by
    // what happened; the wording is the whole of the game's narration.
    discoveries: {
      rock: 'rock',
      planetesimal: 'planetesimal',
      planet: 'a world',
      'gas giant': 'a gas giant',
      'brown dwarf': 'a brown dwarf - not quite a star',
      star: 'first light',
      'red giant': 'the star swells: a red giant',
      'red supergiant': 'a red supergiant',
      'planetary nebula': 'the star sheds its outer layers: a planetary nebula',
      supernova: 'supernova',
      collapse: 'the core gives way. the star goes dark from the inside',
      detonation: 'the white dwarf detonates',
      'white dwarf': 'a white dwarf, cooling forever',
      'neutron star': 'a neutron star',
      'black hole': 'a black hole',
      'second generation': 'the thrown gas gathers and ignites again',
    },
    // How long a discovery line stays before the bottom goes quiet again.
    captionSeconds: 7,
    // The spectroscopic reading, assembled beside the flux figure.
    starSolar:  'solar',
    starMain:   'main sequence',
    starGiant:  'giant',
    starLeft:   'left',

    // THE BOARD. The figure beside the mass, the word for a node already
    // known from an earlier universe, the prefix on a node that is waiting on
    // another, and what is said when the board first appears and when an
    // era turns.
    fluxLabel: 'flux',
    known: 'known',
    // Printed before the name of the thing a locked row is waiting on. It is a
    // requirement, not a running order, and the row still carries its price -
    // which is the whole point: the two reasons a row cannot be bought have to
    // read differently.
    needs: 'needs ',
    // The first line a player gets about the currency and the list it buys.
    boardAppears: 'what happens in the field earns flux. flux buys the research above.',
    eraPrefix: 'the era of ',

    // THE ENDING. Said once, by the player's own hand.
    endingTitle: 'the universe closes',
    endingClass: 'it was',
    endingSeeds: 'seeds',
    endingMinutes: 'minutes',
    // A run shorter than a minute rounded to "0 minutes", which reads as a
    // fault rather than as a short run.
    endingSeconds: 'seconds',
    endingStars: 'stars',
    endingDeaths: 'deaths',
    endingRemnants: 'left behind',
    endingFlux: 'flux earned',
    endingAgain: 'begin again, keeping the research',
  },

  // -------------------------------------------------------------------------
  // GAME - the research window and the laws
  //
  // What each thing pays and what each node costs live in src/research.js
  // beside the nodes themselves; these are the dials of the layer around it.
  // -------------------------------------------------------------------------
  game: {
    // Seeds per second at full infall. Each is a click's worth of matter
    // falling in on its own, once the infall law is held.
    infallPerSecond: 1.2,
    // How often the figures on the page are refreshed. Text costs layout;
    // the field does not need it every frame.
    hudEveryMs: 200,
    // Autosave to browser storage this often, and on every purchase.
    autosave: true,
    saveEverySeconds: 12,

    // STAR FORMATION, the last law. Infall then arrives as whole clouds: this
    // many bodies at the dial's top (a fifth of it at the bottom), each
    // standing for a share of everything the field already represents - the
    // same compounding the click uses for mass, applied to population. That
    // is what carries a field past a galaxy: the ladder from cluster to
    // galaxy to the web to a universe is counted in what is represented, not
    // in what is tracked, and it climbs by doubling.
    cloudBodies: 90,
    popShare: 0.024,
    // A cloud's radius, as a share of the field's extent.
    cloudRadius: 0.05,

    // THE CLOSE. How long the universe takes to become one point and go.
    closeSeconds: 2.2,
  },

  // -------------------------------------------------------------------------
  // SEEDING - what a click puts into the field
  //
  // A click is a seed, not a placement. Mass arrives with a little scatter and
  // a little sideways momentum, so two clicks in the same spot make a system
  // rather than a stack.
  // -------------------------------------------------------------------------
  seeding: {
    bodiesPerClick: 3,

    // SCATTER RADIUS IN SCREEN PIXELS, converted through the live projection.
    //
    // It used to be a world-space radius that grew with the click count, which
    // was wrong twice over: mass ended up arriving a long way from where the
    // player had actually pointed, and a fixed number of world units is the
    // whole screen early in a run and an invisible speck later on. Pixels are
    // right at every scale and always land under the cursor.
    spreadPixels: 26,

    // AND AT LEAST THIS MANY BODY-RADII, whichever is larger.
    //
    // Pixels alone are not enough, because a seeded body has a SIZE and at a
    // pulled-back camera a few pixels is smaller than the thing being placed.
    // Measured before this existed: three bodies arrived 0.74 units apart with
    // a combined radius of 2.21, so they were born inside one another and
    // merged on the first step. Every click looked like three arrivals and was
    // one, and the scatter that is supposed to make a system made a stack.
    spreadRadii: 3.5,

    // AND NEVER MORE THAN THIS MANY PIXELS FROM THE CURSOR, whatever the
    // radii ask for.
    //
    // The two rules above pull opposite ways and both are right. Bodies must
    // not be born inside one another, and mass must arrive where the player
    // pointed. Late in a run a seeded body is large, so the radii floor alone
    // put mass six hundred pixels from the click - the same defect the pixel
    // scatter was introduced to fix, arriving from the other direction.
    //
    // Where they genuinely conflict, the cursor wins. A body so large that its
    // own siblings cannot clear it is a body they were going to merge into
    // immediately anyway, and "the click did something somewhere else" is a
    // worse failure than "the click made one thing instead of three".
    spreadMaxPixels: 90,

    // How far each body may swing off its spoke, as a share of the angle
    // between spokes. Zero puts every click on the same rigid star.
    angleJitter: 0.55,

    // How much a body's mass may vary from the mean, as a share of it. A field
    // built from one repeated object does not look like it grew, it looks like
    // it was stamped.
    massJitter: 0.45,

    // Sideways speed given to each body, across the line from the click centre.
    // Zero drops everything straight in and the field collapses to a point.
    launchSpeed: 0.35,

    massPerBody: 1,

    // HOW A CLICK KEEPS UP WITH THE LADDER.
    //
    // The kind ladder is exponential - rock begins at 2^12 units of mass,
    // planetesimal at 2^24, star at 2^64 - and a click used to contribute a
    // flat three. Reaching the SECOND rung took about fourteen hundred clicks
    // and every rung above it was unreachable by any amount of clicking at all,
    // so the field could only ever be dust. Everything else that looked wrong
    // followed from that: nothing changed colour because nothing ever changed
    // kind.
    //
    // A click now seeds a share of what the field has already become, which is
    // how accretion actually works - a bigger cloud sweeps up faster - and it
    // is what makes the ladder something a run can climb. `massPerBody` is the
    // floor under it, so the opening is unchanged.
    // Measured: at this share the ladder is climbed over a long session rather
    // than sprinted. Too generous and the last three rungs land in three
    // consecutive clicks, which turns the end of the arc into a blur.
    clickShare: 0.024,

    // WHERE THE FIELD STOPS TAKING MASS.
    //
    // The ladder no longer has a top rung by mass - a black hole is something
    // a star becomes by dying, not a weight class - so this is only the stop
    // that keeps a finished run from compounding for ever. It sits far past
    // anything a session reaches.
    //
    // This used to be 1e12, pinned there by a defect, not a decision: seeding
    // mixed absolute and code units, which broke mass conservation the moment
    // the unit ledger first rebased (total about 4.9e12) and compounded into
    // quarantined bodies and infinities. That seam is fixed - docs/BUGS.md has
    // the full account - and the soundness of the field itself is measured far
    // beyond this value: a full click-driven arc reached 2.0e27 and a driven
    // stress run reached 4.2e60, both with zero bodies quarantined and zero
    // mass lost.
    //
    // A real ending is designed in docs/ENDING.md and src/rebirth.js and is not
    // wired. This is not that: it is the stop that keeps a finished run from
    // compounding forever. The deepest total a stopped run can touch is about
    // 1.03e27 - the ceiling plus one final click - and runs were measured
    // clean to twice that through this exact path.
    massCeiling: 1e45,
    // A run that reaches the ceiling cannot be clicked again, and until this
    // there was nothing on screen to say it was coming - the figure in the
    // corner climbs with no number beside it to be measured against. Rather
    // than print a limit nobody would read for an hour, the field says so once
    // when it is nearly there, in the same line every other event uses.
    ceilingWarnAt: 0.9,

    // Clicks after which the prompt goes quiet for good.
    promptFadesAt: 3,
  },

  // -------------------------------------------------------------------------
  // MATTER - what each kind of thing looks like, and what it is called
  //
  // The simulation gates every kind above dust behind research and emits a
  // BLOCKED event the moment the field has earned a promotion it cannot take.
  // That event is the arc: it fires exactly when the player has built something
  // the world does not have a name for yet.
  //
  // STARS ARE NOT IN THESE TABLES. A star's colour, brightness and size follow
  // from its mass through the real relations in src/stellar.js - a red dwarf
  // at 2300 K, the sun at 5800, a blue giant past 30000 - and a giant, a white
  // dwarf, a neutron star and thrown gas each have their own law there. The
  // entries at those indices below are only fallbacks for a consumer that
  // cannot ask.
  //
  // TEMPERATURE IS THE WHOLE VISUAL LANGUAGE. The renderer colours a body by
  // its temperature, and with none supplied every object in the universe came
  // out at the same dull red - which is why the field never appeared to change
  // no matter what was built in it. These are the colours of the arc: cold
  // rock, warming worlds, ignition, and the blue-white things at the end.
  //
  // COLD MATTER IS NOT A BLACK BODY, and getting that wrong was the second half
  // of the same complaint. Below about a thousand kelvin an object emits almost
  // nothing a human eye can see, so what it looks like is what it REFLECTS -
  // grey silicate, rust-brown regolith, blue-white ice. Painting that band with
  // the emission law instead gives every cold thing the same saturated red,
  // because the low end of the black-body curve has no colour information in
  // it at all. Reflectance below, emission above, crossfaded between the two,
  // is both the honest law and the one with an actual arc in it.
  // -------------------------------------------------------------------------
  matter: {
    // Kelvin per kind, indexed by the simulation's own kind codes. Physical
    // enough to be honest, spaced enough to be legible.
    //   dust rock planetesimal planet gas-giant protostar star giant-star
    //   white-dwarf neutron-star black-hole, then the aggregate kinds.
    //
    // The first four carry most of a run's playing time - a measured arc
    // reaches a gas giant around click 1270 and a black hole around 2430 - so
    // they are spread deliberately wide across the cold band rather than
    // bunched at the bottom of it. Cold grains, a sunlit asteroid, a body being
    // hammered by accretion, and a young world still molten. A gas giant sits
    // BELOW a molten planet on purpose: a giant's visible cloud deck really is
    // cooler than the surface of a world that has not finished forming.
    // The last five are aggregates - populations drawn as one object because
    // there are too many of them to resolve - and their temperature is the
    // luminosity-weighted mean of what is inside. A condensed group at this
    // scale is mostly unresolved small bodies, so it is warm rather than
    // stellar; the larger tiers are dominated by starlight and are given it.
    temperature: [
      120, 310, 640, 1250, 900, 1500, 5800, 3700,
      30000, 46000, 22000, 1600, 4200, 4600, 5000, 5400,
    ],

    // How brightly each kind shines, relative to a main-sequence star at 1.
    // Indexed the same way.
    //
    // This is what makes ignition an EVENT. The aperture exposes for the
    // brightest thing on screen, so what matters is never a body's absolute
    // brightness but its brightness beside its neighbours: a field of cold
    // dust opens the aperture and reads perfectly well, and the moment one
    // thing in it starts producing its own light everything else sinks into
    // the dark around it. Flat values here and nothing ever stands out.
    luminosity: [
      0.07, 0.11, 0.15, 0.22, 0.30, 0.12, 1.00, 1.40,
      0.60, 1.60, 1.00, 0.70, 0.70, 0.70, 0.70, 0.70,
    ],

    // HOW BRIGHT A STAR IS, FOR THE APERTURE. Real luminosity spans nine
    // orders of magnitude across the main sequence, and an aperture that
    // exposed for that would show one star and nothing else. The drawn
    // brightness is luminosity to this power: a red dwarf comes out a third
    // of the sun, a ten-solar-mass star a few times it. The floor and ceiling
    // bound it.
    starLumExponent: 0.18,
    starLumFloor: 0.22,
    starLumCeiling: 3.2,

    // How much a body's own heat may lift it above its kind's temperature, as
    // a share. Bounded, because heat is not calibrated against anything - what
    // is being claimed is only that a violently accreting body runs hotter than
    // a settled one, which is true at any scale.
    heatLift: 0.45,

    // THE COLOUR OF MATTER THAT DOES NOT GLOW, as stops of kelvin and hue.
    //
    // Read as a reflectance ramp: what a surface at that temperature is made
    // of, and therefore what colour it comes back as. Ices and shadowed grains
    // are a cold slate; bare silicate is a neutral warm grey; iron-rich
    // regolith is dun brown; and the last step before a body starts to glow is
    // a dark scorched rust. Between the stops the colour is interpolated, so
    // the cold half of the run is a continuous journey rather than four steps.
    reflectance: [
      [40, '#6d7f9c'],     // ice and shadowed dust
      [260, '#8e8b84'],    // bare silicate
      [640, '#9c7554'],    // iron-rich regolith
      [1050, '#7f4327'],   // scorched, about to glow
    ],

    // Where a body stops being lit and starts being a light. Below glowFrom it
    // is painted entirely by reflectance; above glowFull entirely by emission;
    // between them the two crossfade. 850 K is about where a surface begins to
    // show a visible dull red, and by 2400 K its own light is all there is.
    glowFrom: 850,
    glowFull: 2400,

    // The coldest and hottest temperatures the colour ramp resolves. Anything
    // outside is clamped to the end. The cold floor is well under the coldest
    // kind so the ramp has room to be a ramp there.
    coldest: 40,
    hottest: 46000,

    // HOW MUCH OF A BODY IS GLOW, at the cold end of the ramp. Each is applied
    // to a cold body and lifted toward 1 as it becomes an emitter, so the same
    // crossfade that decides a body's colour decides its form.
    //
    // These are the numbers that answer "why does everything look like a
    // glowing ball". Every body was drawn as a bright core inside a halo five
    // radii wide, which is a fair picture of a star and a completely wrong one
    // of a rock: an asteroid has no corona, and it has no glowing centre
    // either. Its light comes off a SURFACE, and the renderer already draws a
    // limb-darkened sphere for that - it was simply being washed out from
    // underneath by a glow that should not have been there.
    corona: 0.14,        // halo strength on cold matter
    // AND HOW FAR IT REACHES, as a multiple of the body's own radius. The
    // brightness of the glow and the size of it are separate questions and
    // only fixing the first leaves a fainter fog around everything. A rock's
    // light stops at its surface; a star's does not.
    coronaReach: 1.18,
    coreGlow: 0.16,      // central glow on a cold body once it has an edge
    surface: 0.95,       // strength of the lit sphere on cold matter

    // SURFACE DETAIL on bodies large enough to show it.
    //
    // A perfectly smooth disc reads as a gradient, not as a place, because a
    // radial falloff is what a gradient IS - the eye has nothing to catch on
    // and calls it a glow. Patches of differing albedo, half of them brighter
    // and half of them darker, break that: the average stays where the aperture
    // put it and the face acquires terrain. They are placed by the body's own
    // identity, so a rock has the same face every time it is looked at and
    // nothing shimmers.
    //
    // Bounded hard: only bodies above a real size on screen qualify, and only a
    // few of them per frame, because this is the one part of the body pass
    // whose cost is not already fixed. Set patches to 0 to switch it off.
    detailMinPx: 14,     // screen radius under which a body has no visible terrain
    detailBodies: 12,    // most bodies given terrain in one frame
    detailPatches: 9,    // patches on each, about half of them dark
    // Per patch, and low on purpose: several land on the same face and their
    // effect ADDS, so a value that looks right for one floods the body with
    // nine and the terrain becomes the surface instead of a variation in it.
    detailAlpha: 0.22,   // how far one patch lifts or sinks the surface under it

    // What the field says when it first makes something it has no name for.
    // The blank prefix keeps the line as quiet as the rest of the game.
    discoveryPrefix: '',
  },

  // -------------------------------------------------------------------------
  // STELLAR - how long stars live and how they die
  //
  // The relations themselves are physics (src/stellar.js); these set the
  // clock they run on and the visible size of a few things that are, in
  // truth, too extreme to draw. Handed to the simulation at creation.
  // -------------------------------------------------------------------------
  stellar: {
    // How long a sun-like star shines, in seconds of play. Lifetime falls as
    // mass to the -2.5: a half-sun lives six times this, a three-sun star a
    // sixteenth of it. FEEDING A STAR SHORTENS ITS LIFE, which is the one real
    // decision a player has about one.
    sunLifeSeconds: 240,
    // No star dies faster than this once it has ignited, so a massive star is
    // on screen long enough to be seen as the blue thing it is before it goes.
    lifeFloorSeconds: 12,
    // The giant phase, as a share of main-sequence life, with its own floor so
    // the swelling is watchable.
    giantShare: 0.12,
    giantFloorSeconds: 9,
    // How much a giant swells. Real giants swell a hundredfold; in a field
    // where orbits sit a few radii out that would swallow the whole system
    // every time, so these are the visible fraction of the truth.
    giantSwell: 6,
    supergiantSwell: 11,
    // Mass at death, in suns, deciding what is left: below the first, a white
    // dwarf; then a neutron star; then a black hole born in a supernova; then
    // a black hole born without one, the star going dark from the inside;
    // then pair instability, which leaves nothing at all.
    fateWhiteDwarf: 8,
    fateNeutronStar: 25,
    fateBlackHole: 40,
    fatePairInstability: 130,
    fateDirectAgain: 250,
    // A white dwarf fed past the first detonates; a neutron star fed past the
    // second collapses, quietly, into a black hole.
    chandrasekhar: 1.4,
    tov: 2.3,
    // How long thrown gas must cool before it can gather into a new star, and
    // how long it lasts before it has thinned into the void if nothing does.
    gasCoolSeconds: 25,
    gasLifeSeconds: 75,
    // How long each way of dying takes, in seconds.
    deathSeconds: {
      collapse: 3.6,
      supernova: 5.0,
      nebula: 7.0,
      detonation: 1.8,
      quiet: 1.4,
    },
  },

  // -------------------------------------------------------------------------
  // FIELD - the simulation itself
  //
  // These are handed straight to the simulation. Full notes on what each one
  // costs live beside its use in src/sim.js.
  // -------------------------------------------------------------------------
  field: {
    // Identical seeds and identical inputs produce an identical universe.
    seed: 20260827,

    // WHAT ONE UNIT OF LENGTH IS, IN METRES. The field's own units are
    // arbitrary; this is what lets the view print a span in kilometres and
    // name the scale it is looking at. It follows from the mass unit: a star
    // ignites at 2^64 units of mass and at 0.08 solar masses, so one unit is
    // about nine billion kilograms - a boulder some ninety metres across -
    // and a solid of unit mass has unit radius.
    metersPerUnit: 88,

    capacity: 4096,      // starting pool size; grows on demand
    hardCap:  32768,     // absolute ceiling on individually tracked bodies

    // Milliseconds of simulation allowed per frame. Past this the field starts
    // condensing groups it can no longer afford to resolve, which it would do
    // eventually anyway.
    budgetMs: 8,

    // Barnes-Hut opening angle. Lower is more exact and more expensive.
    theta: 0.75,

    // Longest step the simulation will take in one frame, in seconds. A tab
    // returning from the background must not hand it a whole minute at once.
    maxStepSeconds: 0.05,
  },

  // -------------------------------------------------------------------------
  // LAYOUT - where the two pieces of text sit
  //
  // The renderer owns the top left corner: it prints the stratum the view is
  // currently in, and how far across the screen reaches. The bound mass figure
  // is laid out UNDER that block, in the same gutter, so the corner reads as
  // one column instead of two overlapping ones. Move either of them and check
  // the corner again.
  // -------------------------------------------------------------------------
  layout: {
    hudLeft: 30,        // px from the left edge; 30 matches the renderer's gutter
    hudTop: 74,         // px from the top; clears the renderer's own two lines

    promptLeft: 30,     // the line along the bottom
    promptBottom: 30,
  },

  // -------------------------------------------------------------------------
  // CAMERA - how the view moves
  // -------------------------------------------------------------------------
  camera: {
    // DECADES OF ZOOM PER WHEEL NOTCH.
    //
    // It was one, which is a factor of TEN per notch, and it was being applied
    // on top of the renderer's own handler rather than instead of it - so a
    // single notch moved the view more than a decade and did it twice, toward
    // two different anchors. The scroll was uncontrollable and this is why.
    //
    // At this setting a notch is about forty per cent, which is a step a hand
    // can aim with, and a decade takes six of them.
    zoomStep: 0.16,

    // WHAT COUNTS AS ONE NOTCH, IN WHEEL PIXELS.
    //
    // A mouse detent reports about a hundred and twenty; a trackpad reports a
    // few, dozens of times a second. Reading the SIGN of the wheel and calling
    // it a notch is right for the first and ruinous for the second - a light
    // two-finger flick delivered thirty events, each worth a full notch, and
    // moved the view five orders of magnitude. Dividing by this makes a mouse
    // behave exactly as it did and makes a trackpad proportional to the gesture.
    wheelPixelsPerNotch: 120,

    // HOW MUCH OF THE SHORT SIDE OF THE SCREEN THE FIELD FILLS.
    //
    // Measured: at 0.62 the run sits in frame with a clear margin all the way
    // round and the light around its edge is inside the glass rather than cut
    // off by it. Higher crowds the instrumentation in the corners; much lower
    // and the field reads as a small object being looked at rather than as the
    // thing the screen is for.
    frameFill: 0.62,

    // HOW LONG THE FRAME TAKES TO PULL BACK, AND TO CLOSE BACK IN, in seconds.
    //
    // Different on purpose, and the asymmetry is the whole trick. An
    // exponential ease lags a growing target by rate times its time constant,
    // permanently - so the pull-back constant is literally how far out of frame
    // the field's growth is allowed to push it, and it is short. Closing in is
    // long because a field shrinks when it MERGES, and a camera that chased
    // every merge would dive at the survivor each time two things touched.
    pullBackSeconds: 0.85,
    closeInSeconds: 3.2,

    // THE FASTEST THE VIEW MAY CHANGE SCALE, in decades per second.
    //
    // A decade every two seconds reads unmistakably as travelling through
    // scale. Ten times that reads as a cut. Measured before this existed: a
    // single frame moved the view two hundred and fifty decades per second.
    maxDecadesPerSecond: 0.5,

    // HOW LONG THE FRAME TAKES TO SLIDE ACROSS TO WHERE THE FIELD IS, seconds.
    // The field drifts under its own momentum and the frame goes with it; too
    // quick and the vacuum appears to slide about, too slow and the field sits
    // against an edge.
    followSeconds: 0.55,

    // HOW FAR PAST THE FIELD THE PLAYER MAY DRAG, in half-screens.
    //
    // There is exactly one thing to look at in this game and it is very easy to
    // put it behind an edge of the screen and have no way to tell which edge.
    // The limit is measured from the far side of the field rather than from the
    // middle of the screen, which makes it a promise that holds at any zoom: at
    // full drag the near side of the field is still this fraction of the way
    // from the middle of the screen to its nearest edge. Measured over a run
    // and a five thousand pixel drag, fifteen of eighteen bodies stay in frame
    // here; at 0.9 only three do, and what is left is the outer glow.
    // Escape, Home or 0 returns to the automatic frame from anywhere.
    panLimitScreens: 0.45,
  },

  // -------------------------------------------------------------------------
  // PALETTE - the whole colour vocabulary
  //
  // The field lights itself, so these are only the surfaces around it: the
  // ground it sits on and the few figures laid over the top.
  // -------------------------------------------------------------------------
  palette: {
    void:   '#04050a',   // the ground everything sits on
    ink:    '#c8cede',   // body text
    figure: '#e6ebf5',   // the one number that matters
    label:  '#5d6579',   // what that number is called
    quiet:  '#4a5164',   // the prompt along the bottom
  },

  // -------------------------------------------------------------------------
  // DEV - switches that only matter while tuning
  // -------------------------------------------------------------------------
  dev: {
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
// ---------------------------------------------------------------------------

/** Namespaced browser storage key. */
export const storageKey = (slot) => CONFIG.identity.storagePrefix + '.' + slot;

/** The options the simulation is built with. */
export const simOptions = () => ({
  seed: CONFIG.field.seed,
  capacity: CONFIG.field.capacity,
  hardCap: CONFIG.field.hardCap,
  budgetMs: CONFIG.field.budgetMs,
  theta: CONFIG.field.theta,
  stellar: CONFIG.stellar,
});


// ---------------------------------------------------------------------------
// APPLYING IDENTITY TO THE PAGE
//
// The document carries the game's name and colours in several places. This
// puts them all there from the one source, so the markup never has to repeat a
// value that lives above.
// ---------------------------------------------------------------------------

export function applyIdentity(doc) {
  const d = doc || document;
  const p = CONFIG.palette;

  d.title = CONFIG.identity.name;

  // A headless harness supplies enough of a document to boot the game and no
  // more, so every surface touched here is optional.
  const root = d.documentElement;
  const setVar = (name, value) => {
    if (root && root.style && typeof root.style.setProperty === 'function') {
      root.style.setProperty(name, value);
    }
  };
  setVar('--void', p.void);
  setVar('--ink', p.ink);
  setVar('--figure', p.figure);
  setVar('--label', p.label);
  setVar('--quiet', p.quiet);

  const byId = (id) => (typeof d.getElementById === 'function' ? d.getElementById(id) : null);

  const hud = byId('hud');
  if (hud) {
    hud.style.left = CONFIG.layout.hudLeft + 'px';
    hud.style.top = CONFIG.layout.hudTop + 'px';
  }

  const label = byId('masslabel');
  if (label) label.textContent = CONFIG.text.massLabel;

  const note = byId('note');
  if (note) {
    note.textContent = CONFIG.text.promptFirst;
    note.style.left = CONFIG.layout.promptLeft + 'px';
    note.style.bottom = CONFIG.layout.promptBottom + 'px';
  }

  // The tab icon is drawn from the palette rather than shipped as a file, so a
  // recolour needs no asset and the game still has no binary dependencies.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" fill="' + p.void + '"/>' +
    '<circle cx="16" cy="16" r="5" fill="' + p.figure + '"/>' +
    '<circle cx="27" cy="9" r="1.6" fill="' + p.ink + '"/>' +
    '<circle cx="6" cy="23" r="2.2" fill="' + p.ink + '"/>' +
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
