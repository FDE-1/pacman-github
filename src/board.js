"use strict";

/**
 * @fileoverview Board construction and graph utilities.
 *
 * The maze is an edge graph: walls live BETWEEN cells (on edges), never on
 * cells. The ghost house is a 3-cell strip near the board center, sealed by
 * perimeter walls except for a door that only ghosts may cross. Every wall
 * placement is validated with a reachability check so that every pellet
 * remains reachable by Pac-Man.
 *
 * @typedef {[number, number]} Cell Column/row coordinate pair.
 * @typedef {object} Board
 * @property {number} W                 Number of week columns.
 * @property {number} H                 Number of weekday rows (7).
 * @property {Array<Array<?number>>} grid grid[col][row] = daily count or null.
 * @property {Set<string>} edgeWalls    Walls, keyed by normalized edge key.
 * @property {Set<string>} dots         Regular pellets (cell keys).
 * @property {Set<string>} pellets      Power pellets (cell keys).
 * @property {Cell} pacStart            Pac-Man spawn cell.
 * @property {Cell} ghostHome           Center cell of the ghost house.
 * @property {Cell[]} house             The three ghost-house cells.
 * @property {Set<string>} houseSet     House cells as keys.
 * @property {string} ghostDoor         Edge key of the ghosts-only door.
 */

const { GRID, GAME } = require("./config");

/** Four cardinal directions, as [dCol, dRow]. */
const DIRS = Object.freeze([
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]);

/**
 * Cell key, used in sets and maps.
 * @param {number} c Column. @param {number} r Row.
 * @returns {string}
 */
function key(c, r) {
  return c + "," + r;
}

/**
 * Normalized key for the edge between two adjacent cells (order-independent).
 * @param {Cell} a @param {Cell} b
 * @returns {string}
 */
function edgeKey(a, b) {
  const [x, y] = a;
  const [u, v] = b;
  return x < u || (x === u && y < v) ? `${x},${y}|${u},${v}` : `${u},${v}|${x},${y}`;
}

/**
 * Walkable neighbors of a cell. The ghost-house door counts as a wall for
 * Pac-Man but is crossable by ghosts.
 *
 * @param {Board} board
 * @param {Cell} cell
 * @param {boolean} [asGhost=false] Apply ghost movement rules.
 * @returns {Cell[]}
 */
function neighbors(board, [c, r], asGhost = false) {
  const out = [];
  for (const [dc, dr] of DIRS) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= board.W || nr >= board.H) continue;
    if (board.grid[nc][nr] === null) continue; // days outside the calendar
    const ek = edgeKey([c, r], [nc, nr]);
    if (board.edgeWalls.has(ek) && !(asGhost && ek === board.ghostDoor)) continue;
    out.push([nc, nr]);
  }
  return out;
}

/**
 * Set of cell keys reachable from `start` under Pac-Man movement rules.
 * @param {Board} board @param {Cell} start
 * @returns {Set<string>}
 */
function bfsReachable(board, start) {
  const seen = new Set([key(...start)]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of neighbors(board, cur)) {
      const k = key(...n);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return seen;
}

/**
 * Single-source BFS distance map.
 * @param {Board} board @param {Cell} from @param {boolean} [asGhost=false]
 * @returns {Map<string, number>}
 */
function bfsDistances(board, from, asGhost = false) {
  const dist = new Map([[key(...from), 0]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    const d = dist.get(key(...cur));
    for (const n of neighbors(board, cur, asGhost)) {
      const k = key(...n);
      if (dist.has(k)) continue;
      dist.set(k, d + 1);
      queue.push(n);
    }
  }
  return dist;
}

/**
 * Multi-source BFS: distance from each cell to its nearest source.
 * @param {Board} board
 * @param {Array<Cell|string>} sources Cells or cell keys.
 * @param {boolean} [asGhost=false]
 * @returns {Map<string, number>}
 */
function multiBfs(board, sources, asGhost = false) {
  const dist = new Map();
  let frontier = [];
  for (const src of sources) {
    const k = typeof src === "string" ? src : key(...src);
    if (!dist.has(k)) {
      dist.set(k, 0);
      frontier.push(k.split(",").map(Number));
    }
  }
  while (frontier.length) {
    const next = [];
    for (const cur of frontier) {
      const d = dist.get(key(...cur));
      for (const n of neighbors(board, cur, asGhost)) {
        const k = key(...n);
        if (dist.has(k)) continue;
        dist.set(k, d + 1);
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}

/**
 * Dead-end depth of every cell (0 = on a cycle / safe junction).
 * Computed by iteratively peeling degree-<=1 leaves; the deeper a cell sits
 * inside a cul-de-sac, the larger its value. Pac-Man uses this to avoid
 * entering corridors he cannot exit before a ghost arrives.
 *
 * @param {Board} board
 * @returns {Map<string, number>} Missing keys mean depth 0.
 */
function deadEndDepths(board) {
  const { W, H, grid } = board;
  const degree = new Map();
  const cells = [];
  for (let c = 0; c < W; c++) {
    for (let r = 0; r < H; r++) {
      if (grid[c][r] === null) continue;
      cells.push([c, r]);
      degree.set(key(c, r), neighbors(board, [c, r]).length);
    }
  }
  const depth = new Map();
  const removed = new Set();
  let frontier = cells.filter(([c, r]) => degree.get(key(c, r)) <= 1);
  let level = 1;
  while (frontier.length) {
    const next = [];
    for (const [c, r] of frontier) {
      const k = key(c, r);
      if (removed.has(k)) continue;
      removed.add(k);
      depth.set(k, level);
      for (const n of neighbors(board, [c, r])) {
        const nk = key(...n);
        if (removed.has(nk)) continue;
        degree.set(nk, degree.get(nk) - 1);
        if (degree.get(nk) <= 1) next.push(n);
      }
    }
    frontier = next;
    level++;
  }
  return depth;
}

/** Manhattan distance between two cells. */
function manhattan(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

/**
 * Build the playable board from a contribution grid.
 *
 * Invariants guaranteed by construction:
 * - every day with >= 1 contribution carries a pellet, except the (at most 3)
 *   days sacrificed to the ghost house — chosen to minimize that loss;
 * - the POWER_PELLET_COUNT highest-contribution days are power pellets;
 * - every pellet remains reachable by Pac-Man (checked per wall placement);
 * - the ghost house is sealed except for a ghosts-only door at its top center.
 *
 * @param {Array<Array<?number>>} grid grid[col][row] = daily count or null.
 * @param {() => number} rand Seeded PRNG.
 * @returns {Board}
 */
function buildBoard(grid, rand) {
  const W = grid.length;
  const H = GRID.ROWS;

  // --- Ghost house: the 3-cell strip near the center that sacrifices the
  // fewest contributions (ideally three empty days), since Pac-Man can never
  // enter it. Search radiates outward from the center column.
  let house = null;
  let bestScore = Infinity;
  const c0 = Math.floor(W / 2);
  for (let off = 0; off <= 4 && bestScore > 0; off++) {
    for (const sign of off === 0 ? [1] : [1, -1]) {
      const cc = c0 + off * sign;
      for (const rr of [3, 2, 4]) {
        if (cc - 1 < 0 || cc + 1 >= W) continue;
        const strip = [
          [cc - 1, rr],
          [cc, rr],
          [cc + 1, rr],
        ];
        if (strip.some(([c, r]) => grid[c][r] === null)) continue;
        const score = strip.reduce((acc, [c, r]) => acc + grid[c][r], 0);
        if (score < bestScore) {
          bestScore = score;
          house = strip;
        }
        if (bestScore === 0) break;
      }
    }
  }
  if (!house) {
    house = [
      [c0 - 1, 3],
      [c0, 3],
      [c0 + 1, 3],
    ];
  }
  const houseSet = new Set(house.map(([c, r]) => key(c, r)));
  const ghostHome = house[1];
  const ghostDoor = edgeKey(ghostHome, [ghostHome[0], ghostHome[1] - 1]);

  // --- Pellets: one per contribution day outside the house.
  const dots = new Set();
  const pellets = new Set();
  const byCount = [];
  let totalCells = 0;

  for (let c = 0; c < W; c++) {
    for (let r = 0; r < H; r++) {
      const v = grid[c][r];
      if (v === null) continue;
      totalCells++;
      if (v > 0 && !houseSet.has(key(c, r))) {
        dots.add(key(c, r));
        byCount.push([key(c, r), v]);
      }
    }
  }

  byCount.sort((a, b) => b[1] - a[1]);
  for (const [k] of byCount.slice(0, Math.min(GAME.POWER_PELLET_COUNT, byCount.length))) {
    dots.delete(k);
    pellets.add(k);
  }

  // --- Pac-Man spawn: first valid calendar cell outside the house.
  let pacStart = [0, 0];
  outer: for (let c = 0; c < W; c++) {
    for (let r = 0; r < H; r++) {
      if (grid[c][r] !== null && !houseSet.has(key(c, r))) {
        pacStart = [c, r];
        break outer;
      }
    }
  }

  /** @type {Board} */
  const board = {
    W,
    H,
    grid,
    edgeWalls: new Set(),
    dots,
    pellets,
    pacStart,
    ghostHome,
    house,
    houseSet,
    ghostDoor,
  };

  // --- House walls: the full perimeter. The door edge is also stored as a
  // wall (it blocks Pac-Man); neighbors() lets ghosts cross it.
  for (const [c, r] of house) {
    for (const [dc, dr] of DIRS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= W || nr >= H) continue;
      if (houseSet.has(key(nc, nr))) continue; // interior stays open
      board.edgeWalls.add(edgeKey([c, r], [nc, nr]));
    }
  }

  // --- Random maze walls on inter-cell edges, density adapted to pellet
  // count so sparse profiles keep an open, winnable board. Each candidate is
  // kept only if every Pac-Man-reachable cell stays reachable.
  const edges = [];
  for (let c = 0; c < W; c++) {
    for (let r = 0; r < H; r++) {
      if (grid[c][r] === null || houseSet.has(key(c, r))) continue;
      if (c + 1 < W && grid[c + 1][r] !== null && !houseSet.has(key(c + 1, r))) {
        edges.push([
          [c, r],
          [c + 1, r],
        ]);
      }
      if (r + 1 < H && grid[c][r + 1] !== null && !houseSet.has(key(c, r + 1))) {
        edges.push([
          [c, r],
          [c, r + 1],
        ]);
      }
    }
  }
  const shuffled = edges
    .map((e) => [rand(), e])
    .sort((a, b) => a[0] - b[0])
    .map(([, e]) => e);

  const nTargets = dots.size + pellets.size;
  const maxWalls = Math.floor(
    Math.min(
      shuffled.length * GAME.WALL_EDGE_FRACTION,
      nTargets * GAME.WALL_TARGET_FACTOR + GAME.WALL_TARGET_BONUS
    )
  );
  const pacReachable = totalCells - house.length;

  let placed = 0;
  for (const [a, b] of shuffled) {
    if (placed >= maxWalls) break;
    const ek = edgeKey(a, b);
    board.edgeWalls.add(ek);
    if (bfsReachable(board, pacStart).size === pacReachable) placed++;
    else board.edgeWalls.delete(ek);
  }

  return board;
}

module.exports = {
  DIRS,
  key,
  edgeKey,
  neighbors,
  bfsReachable,
  bfsDistances,
  multiBfs,
  deadEndDepths,
  manhattan,
  buildBoard,
};
