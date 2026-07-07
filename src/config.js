"use strict";

/**
 * @fileoverview Central configuration: grid geometry, animation timing,
 * gameplay tuning, color themes and ghost roster. Every magic number in the
 * project lives here so behavior can be tuned in one place.
 */

/** Grid geometry, in SVG pixels. */
const GRID = Object.freeze({
  /** Side length of one calendar cell. */
  CELL: 12,
  /** Gap between two adjacent cells (walls are drawn inside this gap). */
  GAP: 3,
  /** Padding around the whole grid. */
  PAD: 14,
  /** A contribution calendar always has 7 rows (one per weekday). */
  ROWS: 7,
});

/** Animation timing. */
const ANIMATION = Object.freeze({
  /** Wall-clock seconds per simulation tick (one cell of movement). */
  TICK_SECONDS: 0.16,
  /** Period of Pac-Man's chomping mouth, in seconds. */
  MOUTH_PERIOD_SECONDS: 0.32,
  /**
   * Trajectory smoothing: pauses shorter than this many ticks are absorbed
   * into continuous slower motion; longer pauses stay as visible waits.
   */
  HOLD_KEEP_TICKS: 3,
});

/** Gameplay tuning. All durations are in simulation ticks. */
const GAME = Object.freeze({
  /** How long ghosts stay frightened after a power pellet. */
  FRIGHT_TICKS: 26,
  /** Hard cap on simulation length (safety net; games end far earlier). */
  MAX_TICKS: 2600,
  /** Arcade-style alternation: chase, then scatter to home corners. */
  CHASE_TICKS: 32,
  SCATTER_TICKS: 16,
  /** Delay between successive ghost releases from the house. */
  GHOST_RELEASE_INTERVAL: 10,
  /** Scene freeze duration after Pac-Man is caught. */
  DEATH_FREEZE_TICKS: 3,
  /** Idle frames appended after the board is cleared, before looping. */
  VICTORY_PAUSE_TICKS: 8,
  /**
   * Pac-Man risk escalation: after this many ticks without eating he relaxes
   * the dead-end safety margin ("starving"), and after DESPERATE_TICKS he
   * ignores dead-end depth entirely (last pellets often sit in guarded
   * cul-de-sacs).
   */
  STARVING_TICKS: 50,
  DESPERATE_TICKS: 110,
  /** The N highest-contribution days become power pellets (arcade has 4). */
  POWER_PELLET_COUNT: 4,
  /** Random walls: fraction of inter-cell edges that may become walls. */
  WALL_EDGE_FRACTION: 0.2,
  /** Random walls: cap proportional to pellet count keeps sparse boards open. */
  WALL_TARGET_FACTOR: 1.2,
  WALL_TARGET_BONUS: 12,
  /** Pac-Man considers a cell unsafe if the nearest ghost is closer than this. */
  SAFE_GHOST_DISTANCE: 2,
  /** Ghost speed: normal ghosts skip one tick out of N (¾ speed). */
  GHOST_SKIP_MODULO: 4,
  /** Clyde switches from chase to scatter below this distance to Pac-Man. */
  CLYDE_SHYNESS_DISTANCE: 8,
  /** Pinky aims this many cells ahead of Pac-Man's heading. */
  PINKY_LOOKAHEAD: 4,
  /** Frightened ghosts pick a fully random move with this probability. */
  FRIGHTENED_RANDOMNESS: 0.25,
  /** Ghost count scales down on sparse boards to keep the game winnable. */
  GHOST_COUNT_THRESHOLDS: Object.freeze([
    Object.freeze({ minTargets: 80, ghosts: 4 }),
    Object.freeze({ minTargets: 30, ghosts: 3 }),
    Object.freeze({ minTargets: 0, ghosts: 2 }),
  ]),
});

/**
 * Color themes. Contribution cells keep GitHub's green ramp, deliberately
 * paled so the sprites stand out. The dark theme ships its own opaque
 * background: its white walls must stay visible on any page background.
 *
 * @typedef {object} Theme
 * @property {?string} background Opaque background color, or null for transparent.
 * @property {string} emptyCell   Fill for zero-contribution days.
 * @property {string[]} greens    Four-step contribution intensity ramp.
 * @property {string} wall        Maze wall stroke color.
 * @property {string} ghostDoor   Ghost-house door color (arcade pink).
 * @property {string} dot         Regular pellet fill.
 * @property {string} pellet      Power pellet fill.
 * @property {string} pacman      Pac-Man body color.
 * @property {string} frightened  Ghost body color while frightened.
 */
const THEMES = Object.freeze({
  light: Object.freeze({
    background: null,
    emptyCell: "#ebedf0",
    greens: Object.freeze(["#ddf4e4", "#bfe9cb", "#9bd9ae", "#79c694"]),
    wall: "#2436c7",
    ghostDoor: "#ffb8de",
    dot: "#ffb8ae",
    pellet: "#ffb8ae",
    pacman: "#ffce00",
    frightened: "#2121de",
  }),
  dark: Object.freeze({
    background: "#0d1117",
    emptyCell: "#161b22",
    greens: Object.freeze(["#0d2a1c", "#143d28", "#1c5435", "#266b44"]),
    wall: "#e6edf3",
    ghostDoor: "#ffb8de",
    dot: "#ffd9a8",
    pellet: "#ffd9a8",
    pacman: "#ffce00",
    frightened: "#2121de",
  }),
});

/**
 * Ghost roster, in release order. Personalities follow the arcade:
 * Blinky chases directly, Pinky ambushes ahead, Inky flanks using Blinky's
 * position, Clyde chases from afar but scatters when close.
 */
const GHOSTS = Object.freeze([
  Object.freeze({ name: "blinky", color: "#ff0000" }),
  Object.freeze({ name: "pinky", color: "#ffb8de" }),
  Object.freeze({ name: "inky", color: "#00ffde" }),
  Object.freeze({ name: "clyde", color: "#ffb847" }),
]);

/**
 * Map a daily contribution count to a 0–3 intensity level.
 * Level only affects cell color; ANY day with >= 1 contribution gets a pellet.
 *
 * @param {number} count Daily contribution count.
 * @returns {0|1|2|3} Intensity level.
 */
function levelFor(count) {
  if (count >= 10) return 3;
  if (count >= 5) return 2;
  if (count >= 2) return 1;
  return 0;
}

module.exports = { GRID, ANIMATION, GAME, THEMES, GHOSTS, levelFor };
