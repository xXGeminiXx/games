# Games

The index of the games, plus the builds of the three that are served from here.

**https://xxgeminixx.github.io/games/**

The three hosted here are plain ES modules: no build step, no package manager, no
bundler, no dependencies, and nothing fetched from anywhere. Clone one and it
runs, as long as it is served over http rather than opened off the filesystem,
which is the one thing browsers refuse to do with modules.

## What is here

| | |
|---|---|
| [swarm-breaker](swarm-breaker/) | One decision a turn: the angle. A growing swarm does the rest. |
| [accretion](accretion/) | A blank field, a click, and whatever gravity makes of it. |
| [barrow](barrow/) | The dead dig; you keep the books. An idle horde, endless strata, and a market that moves when you sell into it. |

And one that is listed but not hosted here:

| | |
|---|---|
| [Iron Spine](https://xxgeminixx.github.io/TheIronSpine/) | A modular weapon train, merged car by car through twenty waves. Lives at [its own repository](https://github.com/xXGeminiXx/TheIronSpine) and stays there: a save belongs to the address it was made at, and moving the game would discard every one of them. |

## Changing things without editing files

Every name, label, colour and tunable number in the three games hosted here lives
in that game's `config.js`. Anything in there can also be set from the address bar for a
single page load, which is the quickest way to try something on a phone:

    ?set=board.cols=12
    ?set=identity.name=Something%20Else&set=palette.swarm=%23ff5cf0

To make a change stick in one browser, put a patch in storage from the console:

    localStorage.setItem('cfg', '{"board":{"cols":12}}')
    localStorage.removeItem('cfg')

## Constraints

Everything listed here draws its graphics from primitives and math rather than
from image files, sends nothing anywhere, and measures nothing. A save lives in
the browser that made it.

The three hosted here hold to two more that Iron Spine does not:

**No audio.** Nothing is signalled by sound. Every piece of state a player needs
is on screen where it can be read.

**No dependencies.** Nothing is fetched from a CDN or anywhere else. Iron Spine
loads Phaser from one, which is why it is linked rather than served from here.

## License

MIT.
