"use strict";

/**
 * @fileoverview Game simulation. Runs a full Pac-Man game on the board and
 * records a tick-by-tick timeline that the renderer replays as SMIL
 * animations. The simulation is deterministic given the same board and PRNG.
 *
 * Rules implemented:
 * - Pac-Man heads for the nearest pellet, avoids ghosts, refuses to enter a
 *   dead end he cannot exit in time, and hunts frightened ghosts;
 * - ghosts follow their arcade personalities, alternate chase/scatter, move
 *   slightly slower than Pac-Man, never overlap each other, and may only
 *   re-enter the house after being eaten;
 * - a power pellet frightens all ghosts; an eaten ghost's eyes travel back
 *   to the house, where it revives and exits again;
 * - when Pac-Man is caught the scene freezes briefly on the death cell, then
 *   everyone respawns and play continues until the board is cleared.
 *
 * @typedef {import('./board').Board} Board
 * @typedef {[number, number]} Cell
 * @typedef {object} Timeline
 * @property {Cell[]} pac                Pac-Man position per tick.
 * @property {number[]} pacDir           Pac-Man heading per tick (degrees).
 * @property {Array<{pos: Cell[], mode: string[]}>} ghosts Per-ghost tracks.
 * @property {Map<string, number>} dotEaten    Cell key -> tick eaten.
 * @property {Map<string, number>} pelletEaten Cell key -> tick eaten.
 * @property {number[]} deaths           Ticks at which Pac-Man was caught.
 * @property {number} ticks              Total tick count.
 * @property {number} remaining          Pellets left when the loop ended (0 = cleared).
 */

const { GAME, GHOSTS } = require("./config");
const {
  key,
  neighbors,
  bfsDistances,
  multiBfs,
  deadEndDepths,
  manhattan,
} = require("./board");

/** Ghost mode constants. `HOME` is a render-only state (waiting pre-release). */
const MODE = Object.freeze({ NORMAL: "n", FRIGHTENED: "f", EATEN: "e", HOME: "h" });

/** Clamp a number into [lo, hi]. */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Heading angle in degrees for a unit direction vector. */
function dirAngle([dc, dr]) {
  if (dc === 1) return 0;
  if (dc === -1) return 180;
  if (dr === 1) return 90;
  return 270;
}

/**
 * Run the game and record its timeline.
 *
 * @param {Board} board
 * @param {() => number} rand Seeded PRNG.
 * @returns {Timeline}
 */
function simulate(board, rand) {
  const dots = new Set(board.dots);
  const pellets = new Set(board.pellets);

  const pac = { pos: [...board.pacStart], dir: /** @type {Cell} */ ([1, 0]) };

  // Fewer pellets => fewer ghosts, to keep sparse boards winnable.
  const nTargets = dots.size + pellets.size;
  const ghostCount = GAME.GHOST_COUNT_THRESHOLDS.find((t) => nTargets >= t.minTargets).ghosts;

  // Arcade-style spawn: Blinky starts OUTSIDE, just above the door; the
  // others wait inside the house, one per cell (ghosts never overlap).
  const aboveDoor = [board.ghostHome[0], board.ghostHome[1] - 1];
  const slots = [aboveDoor, board.house[1], board.house[0], board.house[2]];
  const homeSlot = (i) => slots[i % slots.length];
  const ghosts = GHOSTS.slice(0, ghostCount).map((g, i) => ({
    ...g,
    pos: [...homeSlot(i)],
    prev: [...homeSlot(i)],
    mode: MODE.NORMAL,
    releaseAt: i * GAME.GHOST_RELEASE_INTERVAL,
  }));

  let frightTimer = 0;
  let lastEat = 0;
  const deadDepth = deadEndDepths(board);

  /** @type {Timeline} */
  const tl = {
    pac: [[...pac.pos]],
    pacDir: [dirAngle(pac.dir)],
    ghosts: ghosts.map((g) => ({ pos: [[...g.pos]], mode: [g.mode] })),
    dotEaten: new Map(),
    pelletEaten: new Map(),
    deaths: [],
    ticks: 0,
    remaining: 0,
  };

  let tick = 0;
  let freezeUntil = -1; // scene freeze after a death
  let pendingRespawn = false; // teleport to apply once the freeze ends

  function recordFrame() {
    tl.pac.push([...pac.pos]);
    tl.pacDir.push(dirAngle(pac.dir));
    ghosts.forEach((g, i) => {
      tl.ghosts[i].pos.push([...g.pos]);
      tl.ghosts[i].mode.push(tick < g.releaseAt ? MODE.HOME : g.mode);
    });
  }

  while ((dots.size || pellets.size) && tick < GAME.MAX_TICKS) {
    tick++;

    // ----- Death freeze: everyone stays put on the death cell -----
    if (tick <= freezeUntil) {
      recordFrame();
      continue;
    }
    if (pendingRespawn) {
      pac.pos = [...board.pacStart];
      pac.dir = [1, 0];
      ghosts.forEach((g, i) => {
        const slot = homeSlot(i);
        g.pos = [...slot];
        g.prev = [...slot];
        g.mode = MODE.NORMAL;
        g.releaseAt = tick + 4 + i * 8;
      });
      frightTimer = 0;
      pendingRespawn = false;
      recordFrame();
      continue;
    }

    // ----- Pac-Man -----
    const activeGhosts = ghosts.filter((g) => g.mode === MODE.NORMAL && tick >= g.releaseAt);
    // Ghost-view BFS: accounts for the house door they can cross.
    const ghostD = multiBfs(
      board,
      activeGhosts.map((g) => g.pos),
      true
    );
    const gd = (cell) => ghostD.get(key(...cell)) ?? Infinity;

    // Targets: pellets, power pellets, and frightened ghosts (worth eating).
    const targets = new Set([...dots, ...pellets]);
    for (const g of ghosts) if (g.mode === MODE.FRIGHTENED) targets.add(key(...g.pos));
    const targetD = multiBfs(board, [...targets]);
    const td = (cell) => targetD.get(key(...cell)) ?? Infinity;

    const candidates = [...neighbors(board, pac.pos), pac.pos];

    // Risk escalation: the last pellets often sit in guarded dead ends.
    const starving = tick - lastEat > GAME.STARVING_TICKS;
    const desperate = tick - lastEat > GAME.DESPERATE_TICKS;

    // A cell is safe if the nearest ghost is far enough AND, for dead ends,
    // there is time to enter and exit before a ghost can seal the entrance.
    const safe = candidates.filter((n) => {
      if (gd(n) < GAME.SAFE_GHOST_DISTANCE) return false;
      if (desperate) return true;
      const dd = deadDepth.get(key(...n)) || 0;
      const margin = starving ? dd + 2 : 2 * dd + 1;
      if (dd > 0 && activeGhosts.length && gd(n) <= margin) return false;
      return true;
    });

    let step;
    const prevPac = tl.pac[tl.pac.length - 1];
    const isPrev = (n) => (n[0] === prevPac[0] && n[1] === prevPac[1] ? 1 : 0);
    if (safe.length) {
      // Toward the nearest pellet; ties broken by ghost distance, then by
      // penalizing U-turns, then randomly (breaks deterministic loops).
      safe.sort(
        (a, b) => td(a) - td(b) || gd(b) - gd(a) || isPrev(a) - isPrev(b) || rand() - 0.5
      );
      step = safe[0];
    } else if (candidates.length) {
      // No safe option: flee as far from ghosts as possible.
      candidates.sort((a, b) => gd(b) - gd(a));
      step = candidates[0];
    }

    if (step && (step[0] !== pac.pos[0] || step[1] !== pac.pos[1])) {
      pac.dir = [step[0] - pac.pos[0], step[1] - pac.pos[1]];
      pac.pos = step;
    }

    // Eat the pellet under Pac-Man, if any.
    const pk = key(...pac.pos);
    if (dots.has(pk)) {
      dots.delete(pk);
      tl.dotEaten.set(pk, tick);
      lastEat = tick;
    }
    if (pellets.has(pk)) {
      pellets.delete(pk);
      tl.pelletEaten.set(pk, tick);
      lastEat = tick;
      frightTimer = GAME.FRIGHT_TICKS;
      for (const g of ghosts) if (g.mode === MODE.NORMAL) g.mode = MODE.FRIGHTENED;
    }

    // ----- Ghosts -----
    if (frightTimer > 0) {
      frightTimer--;
      if (frightTimer === 0) {
        for (const g of ghosts) if (g.mode === MODE.FRIGHTENED) g.mode = MODE.NORMAL;
      }
    }

    for (const g of ghosts) {
      if (tick < g.releaseAt) continue;
      // Ghosts are slightly slower than Pac-Man (3 cells out of 4), and
      // slower still while frightened (1 out of 2). Eyes travel full speed.
      if (g.mode === MODE.FRIGHTENED && tick % 2 === 1) continue;
      if (
        g.mode !== MODE.FRIGHTENED &&
        g.mode !== MODE.EATEN &&
        tick % GAME.GHOST_SKIP_MODULO === GAME.GHOST_SKIP_MODULO - 1
      ) {
        continue;
      }

      // Arcade alternation: CHASE_TICKS of chase, then SCATTER_TICKS during
      // which each ghost heads to its home corner (gives Pac-Man breathing room).
      const phase = tick % (GAME.CHASE_TICKS + GAME.SCATTER_TICKS);
      const scatter = phase >= GAME.CHASE_TICKS;
      const corners = {
        blinky: [board.W - 1, 0],
        pinky: [0, 0],
        inky: [board.W - 1, board.H - 1],
        clyde: [0, board.H - 1],
      };

      let target;
      if (g.mode === MODE.EATEN) {
        target = board.ghostHome;
      } else if (g.mode === MODE.FRIGHTENED) {
        target = null; // random flight
      } else if (scatter) {
        target = corners[g.name];
      } else {
        switch (g.name) {
          case "blinky":
            target = pac.pos;
            break;
          case "pinky":
            target = [
              clamp(pac.pos[0] + pac.dir[0] * GAME.PINKY_LOOKAHEAD, 0, board.W - 1),
              clamp(pac.pos[1] + pac.dir[1] * GAME.PINKY_LOOKAHEAD, 0, board.H - 1),
            ];
            break;
          case "inky":
            target = [
              clamp(2 * pac.pos[0] - ghosts[0].pos[0], 0, board.W - 1),
              clamp(2 * pac.pos[1] - ghosts[0].pos[1], 0, board.H - 1),
            ];
            break;
          case "clyde":
            target =
              manhattan(g.pos, pac.pos) > GAME.CLYDE_SHYNESS_DISTANCE
                ? pac.pos
                : [0, board.H - 1];
            break;
          default:
            target = pac.pos;
        }
      }

      const inHouse = board.houseSet.has(key(...g.pos));
      // Cells occupied by OTHER ghosts are forbidden (sequential processing
      // guarantees ghosts never overlap or cross through each other).
      const occupied = new Set(ghosts.filter((o) => o !== g).map((o) => key(...o.pos)));
      const free = (n) => !occupied.has(key(...n));
      // A ghost may only RE-enter the house after being eaten.
      let opts = neighbors(board, g.pos, true).filter(
        (n) => free(n) && (g.mode === MODE.EATEN || inHouse || !board.houseSet.has(key(...n)))
      );
      if (!opts.length) opts = neighbors(board, g.pos, true).filter(free);
      if (!opts.length) continue; // blocked: wait in place

      const noReverse = opts.filter((n) => !(n[0] === g.prev[0] && n[1] === g.prev[1]));
      const pool = noReverse.length ? noReverse : opts;

      let next;
      if (g.mode === MODE.FRIGHTENED) {
        pool.sort((a, b) => manhattan(b, pac.pos) - manhattan(a, pac.pos));
        next =
          rand() < GAME.FRIGHTENED_RANDOMNESS
            ? pool[Math.floor(rand() * pool.length)]
            : pool[0];
      } else {
        const dmap = bfsDistances(board, target || pac.pos, true);
        const dv = (n) => dmap.get(key(...n)) ?? 1e9;
        pool.sort((a, b) => dv(a) - dv(b));
        // Among equally good moves, pick randomly (breaks infinite loops).
        const best = pool.filter((n) => dv(n) === dv(pool[0]));
        next = best[Math.floor(rand() * best.length)];
      }
      g.prev = g.pos;
      g.pos = next;
      if (g.mode === MODE.EATEN && board.houseSet.has(key(...g.pos))) {
        g.mode = MODE.NORMAL; // back home: revive, then exit again
        g.releaseAt = tick + 6;
      }
    }

    // ----- Collisions -----
    for (const g of ghosts) {
      if (tick < g.releaseAt) continue;
      const sameCell = g.pos[0] === pac.pos[0] && g.pos[1] === pac.pos[1];
      const swapped =
        g.pos[0] === tl.pac[tl.pac.length - 1][0] &&
        g.pos[1] === tl.pac[tl.pac.length - 1][1] &&
        g.prev[0] === pac.pos[0] &&
        g.prev[1] === pac.pos[1];
      if (!sameCell && !swapped) continue;

      if (g.mode === MODE.FRIGHTENED) {
        g.mode = MODE.EATEN; // eyes head back to the house
      } else if (g.mode === MODE.NORMAL) {
        // Pac-Man is caught: this tick is recorded ON the death cell (he
        // visually reaches the ghost), then the scene freezes before the
        // respawn — exactly like the arcade death pause.
        tl.deaths.push(tick);
        freezeUntil = tick + GAME.DEATH_FREEZE_TICKS;
        pendingRespawn = true;
        break;
      }
    }

    recordFrame();
  }

  // Short victory pause before the loop restarts.
  for (let i = 0; i < GAME.VICTORY_PAUSE_TICKS; i++) {
    tick++;
    recordFrame();
  }

  tl.ticks = tl.pac.length - 1;
  tl.remaining = dots.size + pellets.size;
  return tl;
}

module.exports = { simulate, MODE, dirAngle };
