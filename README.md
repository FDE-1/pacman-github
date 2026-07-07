# pacman-eats-everything 🟡👻

[![CI](https://github.com/FDE-1/pacman-github/actions/workflows/ci.yml/badge.svg)](https://github.com/FDE-1/pacman-github/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Zero runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-success)

An animated Pac-Man contribution graph for your GitHub profile — a **full
simulated game**, not a canned animation. Unlike `pacman-contribution-graph`,
**every day with at least one contribution carries a pellet**: no minimum
threshold, every contribution counts.

## Features

- **Faithful calendar.** Contribution cells keep GitHub's green intensity
  ramp (deliberately paled so the sprites stand out), in light and dark
  themes. The dark theme ships its own opaque background so its white walls
  stay visible on any page.
- **One pellet per contribution day.** Your 4 highest-contribution days
  become power pellets, like the arcade's four.
- **A real maze.** Walls are segments drawn *between* cells, never on them.
  Each wall placement is validated by a reachability check, so every pellet
  is guaranteed reachable. Wall density adapts to your activity level.
- **A central ghost house** with an arcade-pink, ghosts-only door. Blinky
  spawns outside above the door; Pinky, Inky and Clyde exit one by one. The
  house is placed on the 3-cell strip that sacrifices the fewest
  contributions (ideally three empty days).
- **Arcade ghost AI.** Blinky chases directly, Pinky ambushes 4 cells ahead,
  Inky flanks using Blinky's position, Clyde chases from afar and scatters
  when close — with the classic chase/scatter alternation. Ghosts never
  overlap each other.
- **A real Pac-Man AI.** He heads for the nearest pellet, avoids ghosts,
  refuses to enter a dead end he cannot exit in time, and hunts frightened
  ghosts after a power pellet. Eaten ghosts become traveling eyes that
  return to the house through the door, revive, and exit again.
- **Arcade deaths.** When caught, the scene freezes on the death cell, then
  everyone respawns and play continues until the board is fully cleared —
  the simulation is verified to always complete.
- **Self-contained output.** The game is simulated in Node at generation
  time and replayed as pure SMIL animations: the final SVG has no
  JavaScript, loops forever, and weighs ~100 KiB. Zero runtime dependencies.
- **Deterministic.** Same contributions + same seed = byte-identical SVG.

## Setup

1. Create a repository (e.g. `pacman-eats-everything`) containing this
   project (`src/`, `test/`, `.github/`, `package.json`, …).

2. In **Settings → Actions → General → Workflow permissions**, enable
   **Read and write permissions** (required to push to the `output` branch).

3. Run it once: **Actions → Generate Pac-Man → Run workflow**. After ~1
   minute, an `output` branch appears with `pacman-light.svg` and
   `pacman-dark.svg`. The cron then regenerates them nightly at 00:00 UTC.
   The workflow picks up the repository owner automatically — nothing to
   edit.

4. In your profile README (the special `<username>/<username>` repository),
   add:

```html
<picture>
  <source media="(prefers-color-scheme: dark)"
          srcset="https://raw.githubusercontent.com/FDE-1/pacman-eats-everything/output/pacman-dark.svg">
  <img alt="Pac-Man contribution graph"
       src="https://raw.githubusercontent.com/FDE-1/pacman-eats-everything/output/pacman-light.svg">
</picture>
```

The `<picture>` element switches themes with the visitor's color scheme.
Note: GitHub caches images through its Camo proxy, so updates can take a few
minutes to show up.

## CLI usage

```bash
# With your real contributions (any token with read:user scope)
GITHUB_TOKEN=ghp_xxx node src/index.js --username FDE-1 --theme light --output dist/pacman-light.svg

# Offline, with deterministic fake data
node src/index.js --mock --theme dark --output dist/test.svg

# Different wall layout and game unfold
node src/index.js --mock --seed 777 --output dist/test.svg
```

| Option       | Description                                      | Default      |
| ------------ | ------------------------------------------------ | ------------ |
| `--username` | GitHub login                                     | (required)   |
| `--theme`    | `light` or `dark`                                | `light`      |
| `--output`   | Output SVG path                                  | `pacman.svg` |
| `--seed`     | PRNG seed (wall layout + game unfold)            | `1234`       |
| `--mock`     | Deterministic fake data, no token needed         | off          |
| `--help`     | Show usage                                       |              |

Exit codes: `0` success, `1` runtime failure, `2` usage error.

## Architecture

```
src/
  config.js     All tunables: geometry, timing, gameplay, themes, ghosts
  rng.js        Seeded xorshift32 PRNG (reproducible builds)
  github.js     GraphQL client (timeout + retries with backoff) and mock data
  board.js      Edge-graph maze: BFS utilities, ghost house, wall placement
  simulate.js   Game loop: Pac-Man AI, ghost personalities, collisions
  render.js     Timeline -> SMIL SVG (trajectory compression and smoothing)
  index.js      CLI entry point and orchestration
test/
  board.test.js     Board invariants (pellets, reachability, sealed house)
  simulate.test.js  Gameplay invariants across seeds (completion, sync,
                    contact deaths, freeze, no ghost overlap, determinism)
  render.test.js    SMIL validity, structural balance, byte-determinism
```

The pipeline is strictly `fetch → build board → simulate → render`: each
stage is a pure function of its inputs (plus the seeded PRNG), which is what
makes snapshot testing and byte-level reproducibility possible.

Two rendering decisions worth knowing about:

- **Pac-Man's track is exact to the tick** — pellets vanish precisely when
  he crosses them and deaths happen on contact.
- **Ghost tracks are smoothed**: their reduced speeds (skipped ticks in the
  simulation) are rendered as continuous slower motion instead of
  stop-and-go. Smoothing is anchored at every mode change, bounding drift to
  under one tick so frightened/eaten/revive moments stay aligned.

## Development

```bash
npm ci          # install dev tooling (ESLint only; runtime has no deps)
npm test        # node:test suite — 50 tests across 8 seeds + extreme profiles
npm run lint    # ESLint (flat config)
npm run smoke   # generate both themes from mock data into dist/
```

CI runs lint, tests and the smoke generation on every push and pull request.

### Tuning

Everything lives in [`src/config.js`](src/config.js): theme colors, animation
speed (`ANIMATION.TICK_SECONDS`), frightened duration, chase/scatter rhythm,
wall density, power-pellet count, ghost-count thresholds, and Pac-Man's
risk-taking timers.

## License

[MIT](LICENSE)
