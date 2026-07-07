"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createRng } = require("../src/rng");
const { generateMockGrid } = require("../src/github");
const { GAME } = require("../src/config");
const {
  key,
  edgeKey,
  neighbors,
  bfsReachable,
  buildBoard,
} = require("../src/board");

test("edgeKey is order-independent", () => {
  assert.equal(edgeKey([1, 2], [2, 2]), edgeKey([2, 2], [1, 2]));
  assert.equal(edgeKey([5, 3], [5, 4]), edgeKey([5, 4], [5, 3]));
  assert.notEqual(edgeKey([1, 2], [2, 2]), edgeKey([1, 3], [2, 3]));
});

test("rng is deterministic and in [0, 1)", () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 1000; i++) {
    const va = a();
    assert.equal(va, b());
    assert.ok(va >= 0 && va < 1);
  }
});

function makeBoard(seed = 1234) {
  const rand = createRng(seed);
  const grid = generateMockGrid(rand);
  return { grid, board: buildBoard(grid, rand) };
}

test("every contribution day outside the house carries a pellet", () => {
  const { grid, board } = makeBoard();
  for (let c = 0; c < board.W; c++) {
    for (let r = 0; r < board.H; r++) {
      const v = grid[c][r];
      if (v === null || v === 0) continue;
      const k = key(c, r);
      if (board.houseSet.has(k)) continue;
      assert.ok(board.dots.has(k) || board.pellets.has(k), `missing pellet at ${k}`);
    }
  }
});

test("exactly POWER_PELLET_COUNT power pellets on a dense board", () => {
  const { board } = makeBoard();
  assert.equal(board.pellets.size, GAME.POWER_PELLET_COUNT);
});

test("every pellet is reachable by Pac-Man", () => {
  const { board } = makeBoard();
  const reachable = bfsReachable(board, board.pacStart);
  for (const k of [...board.dots, ...board.pellets]) {
    assert.ok(reachable.has(k), `pellet ${k} is unreachable`);
  }
});

test("the ghost house is sealed for Pac-Man but its door opens for ghosts", () => {
  const { board } = makeBoard();
  const reachable = bfsReachable(board, board.pacStart);
  for (const k of board.houseSet) {
    assert.ok(!reachable.has(k), `Pac-Man can enter house cell ${k}`);
  }
  // The cell above the door reaches the house center as a ghost only.
  const aboveDoor = [board.ghostHome[0], board.ghostHome[1] - 1];
  const asPac = neighbors(board, aboveDoor, false).map((n) => key(...n));
  const asGhost = neighbors(board, aboveDoor, true).map((n) => key(...n));
  assert.ok(!asPac.includes(key(...board.ghostHome)));
  assert.ok(asGhost.includes(key(...board.ghostHome)));
});

test("house placement is deterministic and near the center", () => {
  const { board } = makeBoard();
  const c0 = Math.floor(board.W / 2);
  assert.ok(Math.abs(board.ghostHome[0] - c0) <= 5, "house drifted too far from center");
  const again = makeBoard();
  assert.deepEqual(again.board.house, board.house);
});

test("sparse boards stay open: wall count scales with pellet count", () => {
  const rand = createRng(7);
  const grid = generateMockGrid(rand, { emptyProbability: 0.95 });
  const board = buildBoard(grid, rand);
  const nTargets = board.dots.size + board.pellets.size;
  assert.ok(
    board.edgeWalls.size <=
      nTargets * GAME.WALL_TARGET_FACTOR + GAME.WALL_TARGET_BONUS + board.house.length * 4,
    "too many walls for a sparse board"
  );
});
