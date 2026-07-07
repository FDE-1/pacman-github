"use strict";

/**
 * Renderer tests: SMIL validity (keyTimes bounds and monotonicity,
 * values/keyTimes cardinality), structural XML balance, theme behavior,
 * and byte-level determinism of the full pipeline.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createRng } = require("../src/rng");
const { generateMockGrid } = require("../src/github");
const { buildBoard } = require("../src/board");
const { simulate } = require("../src/simulate");
const { renderSvg } = require("../src/render");
const { THEMES } = require("../src/config");

function render(seed = 1234, theme = "light") {
  const rand = createRng(seed);
  const grid = generateMockGrid(rand);
  const board = buildBoard(grid, rand);
  const tl = simulate(board, rand);
  return renderSvg(grid, board, tl, theme);
}

test("every keyTimes list starts at 0, is strictly increasing, ends <= 1", () => {
  const svg = render();
  const lists = [...svg.matchAll(/keyTimes="([^"]+)"/g)].map((m) =>
    m[1].split(";").map(Number)
  );
  assert.ok(lists.length > 0, "no animations found");
  for (const kts of lists) {
    assert.equal(kts[0], 0, "keyTimes must start at 0");
    for (let i = 1; i < kts.length; i++) {
      assert.ok(kts[i] > kts[i - 1], `keyTimes not strictly increasing at index ${i}`);
    }
    assert.ok(kts[kts.length - 1] <= 1 + 1e-9, "keyTimes must end <= 1");
  }
});

test("translate animations end exactly at keyTime 1 (linear calcMode)", () => {
  const svg = render();
  const translates = [
    ...svg.matchAll(/type="translate"[\s\S]*?keyTimes="([^"]+)"/g),
  ].map((m) => m[1].split(";").map(Number));
  assert.ok(translates.length >= 3, "expected Pac-Man + ghosts translate tracks");
  for (const kts of translates) {
    assert.ok(Math.abs(kts[kts.length - 1] - 1) < 1e-9, "linear track must end at 1");
  }
});

test("values and keyTimes have matching cardinality", () => {
  const svg = render();
  const anims = [
    ...svg.matchAll(/values="([^"]+)"\s+keyTimes="([^"]+)"/g),
    ...svg.matchAll(/keyTimes="([^"]+)"\s+values="([^"]+)"/g),
  ];
  // Also catch attribute pairs split across the same tag.
  const tags = [...svg.matchAll(/<animate(?:Transform)?\b[^>]*>/g)].map((m) => m[0]);
  for (const tag of tags) {
    const values = tag.match(/values="([^"]+)"/);
    const keyTimes = tag.match(/keyTimes="([^"]+)"/);
    if (!values || !keyTimes) continue;
    assert.equal(
      values[1].split(";").length,
      keyTimes[1].split(";").length,
      `cardinality mismatch in: ${tag.slice(0, 80)}…`
    );
  }
  assert.ok(anims.length + tags.length > 0);
});

test("SVG structure is balanced", () => {
  const svg = render();
  assert.ok(svg.startsWith("<svg "));
  assert.ok(svg.trimEnd().endsWith("</svg>"));
  for (const tag of ["g", "path", "circle"]) {
    const open = (svg.match(new RegExp(`<${tag}[\\s>]`, "g")) || []).length;
    const selfClosed = (svg.match(new RegExp(`<${tag}[^>]*/>`, "g")) || []).length;
    const closed = (svg.match(new RegExp(`</${tag}>`, "g")) || []).length;
    assert.equal(open - selfClosed, closed, `unbalanced <${tag}> tags`);
  }
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(svg), "unescaped ampersand");
});

test("dark theme ships an opaque background; light theme stays transparent", () => {
  const dark = render(1234, "dark");
  assert.ok(dark.includes(`fill="${THEMES.dark.background}"`), "missing dark background");
  assert.ok(dark.includes(THEMES.dark.wall), "missing dark walls");
  const light = render(1234, "light");
  assert.ok(!light.includes('width="100%" height="100%"'), "light theme should be transparent");
});

test("full pipeline is byte-identical for a given seed", () => {
  assert.equal(render(777, "dark"), render(777, "dark"));
});

test("sprites carry a static initial transform (non-SMIL renderers)", () => {
  const svg = render();
  const groups = svg.match(/<g transform="translate\([\d. ]+\)">/g) || [];
  assert.ok(groups.length >= 3, "expected initial transforms on Pac-Man and ghosts");
});
