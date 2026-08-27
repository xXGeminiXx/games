# Games

Playable builds, served straight from this repository.

**https://xxgeminixx.github.io/games/**

Each game is plain ES modules: no build step, no package manager, no bundler,
no dependencies, and nothing fetched from anywhere. Clone it and it runs, as
long as it is served over http rather than opened off the filesystem, which is
the one thing browsers refuse to do with modules.

## What is here

| | |
|---|---|
| [swarm-breaker](swarm-breaker/) | One decision a turn: the angle. A growing swarm does the rest. |
| [accretion](accretion/) | A blank field, a click, and whatever gravity makes of it. |

## Changing things without editing files

Every name, label, colour and tunable number in a game lives in its
`config.js`. Anything in there can also be set from the address bar for a
single page load, which is the quickest way to try something on a phone:

    ?set=board.cols=12
    ?set=identity.name=Something%20Else&set=palette.swarm=%23ff5cf0

To make a change stick in one browser, put a patch in storage from the console:

    localStorage.setItem('cfg', '{"board":{"cols":12}}')
    localStorage.removeItem('cfg')

## Constraints these share

**No assets.** Every pixel is drawn from primitives and math. No images, no
sprites, no webfonts.

**No audio.** Nothing is signalled by sound. Every piece of state a player needs
is on screen where it can be read.

**No network.** Nothing is sent anywhere and nothing is measured. A save lives in
the browser it was made in.

## License

MIT.
