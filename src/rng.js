"use strict";

/**
 * @fileoverview Deterministic pseudo-random number generator (xorshift32).
 * Given the same seed and the same contribution data, the generator produces
 * byte-identical SVG output — a hard requirement for reproducible builds and
 * snapshot testing.
 */

/**
 * Create a seeded PRNG.
 *
 * @param {number} seed Any integer; 0 is coerced to 1.
 * @returns {() => number} Function returning a float in [0, 1).
 */
function createRng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

module.exports = { createRng };
