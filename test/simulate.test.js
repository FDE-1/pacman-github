"use strict";

/**
 * Integration tests for the game simulation. These encode the gameplay
 * invariants that past visual bugs taught us to guard:
 * - the game always completes (every pellet eaten);
 * - each pellet is eaten exactly when Pac-Man stands on its cell;
 * - on death, a ghost is on (or crossing through) Pac-Man, the scene then
 *   freezes in place before the respawn;
 * - ghosts never overlap;
 * - the whole pipeline is deterministic for a given seed.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createRng } = require("../src/rng");
const { generateMockGrid } = require("../src/github");
const { buildBoard } = require("../src/board");
const { simulate } = require("../src/simulate");
const { GAME } = require("../src/config");

const SEEDS = [1234, 777, 42, 9001, 5, 31337, 2024, 99];

function run(seed, mockOpts) {
  const rand = createRng(seed);
  const grid = generateMockGrid(rand, mockOpts);
  const board = buildBoard(grid, rand);
  const tl = simulate(board, rand);
  return { board, tl };
}

for (const seed of SEEDS) {
  test(`seed ${seed}: game completes — every pellet eaten`, () => {
    const { tl } = run(seed);
    assert.equal(tl.remaining, 0, `${tl.remaining} pellets left after ${tl.ticks} ticks`);
    assert.ok(tl.ticks < GAME.MAX_TICKS, "hit the tick safety cap");
  });

  test(`seed ${seed}: pellets vanish exactly under Pac-Man`, () => {
    const { tl } = run(seed);
    for (const [k, t] of [...tl.dotEaten, ...tl.pelletEaten]) {
      const [c, r] = k.split(",").map(Number);
      assert.deepEqual(tl.pac[t], [c, r], `pellet ${k} desynced at tick ${t}`);
    }
  });

  test(`seed ${seed}: deaths are contact deaths followed by a freeze`, () => {
    const { tl } = run(seed);
    for (const t of tl.deaths) {
      const p = tl.pac[t];
      const contact = tl.ghosts.some((g) => {
        const gp = g.pos[t];
        return Math.abs(gp[0] - p[0]) + Math.abs(gp[1] - p[1]) <= 1;
      });
      assert.ok(contact, `death at tick ${t} without a ghost in contact`);
      for (let d = 1; d <= GAME.DEATH_FREEZE_TICKS; d++) {
        assert.deepEqual(tl.pac[t + d], p, `freeze broken at tick ${t + d}`);
      }
    }
  });

  test(`seed ${seed}: ghosts never overlap`, () => {
    const { tl } = run(seed);
    for (let i = 0; i < tl.pac.length; i++) {
      const seen = new Set();
      for (const g of tl.ghosts) {
        const k = g.pos[i][0] + "," + g.pos[i][1];
        assert.ok(!seen.has(k), `ghost overlap at tick ${i} on ${k}`);
        seen.add(k);
      }
    }
  });
}

test("simulation is deterministic for a given seed", () => {
  const a = run(1234);
  const b = run(1234);
  assert.deepEqual(a.tl.pac, b.tl.pac);
  assert.deepEqual(a.tl.deaths, b.tl.deaths);
  assert.deepEqual([...a.tl.dotEaten], [...b.tl.dotEaten]);
});

test("extreme profiles complete too (sparse and dense)", () => {
  const sparse = run(1234, { emptyProbability: 0.95 });
  assert.equal(sparse.tl.remaining, 0, "sparse board did not complete");
  const dense = run(1234, { emptyProbability: 0 });
  assert.equal(dense.tl.remaining, 0, "dense board did not complete");
});

test("ghost count scales down on sparse boards", () => {
  const sparse = run(1234, { emptyProbability: 0.95 });
  assert.ok(sparse.tl.ghosts.length < 4, "expected fewer ghosts on a sparse board");
});
