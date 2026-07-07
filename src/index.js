#!/usr/bin/env node
"use strict";

/**
 * @fileoverview CLI entry point. Orchestrates: fetch contributions -> build
 * board -> simulate game -> render SVG -> write file.
 *
 * Exit codes: 0 success, 1 runtime failure, 2 usage error.
 */

const fs = require("node:fs");
const path = require("node:path");

const { ANIMATION, THEMES } = require("./config");
const { createRng } = require("./rng");
const { fetchContributionGrid, generateMockGrid } = require("./github");
const { buildBoard } = require("./board");
const { simulate } = require("./simulate");
const { renderSvg } = require("./render");

const USAGE = `pacman-eats-everything — animated Pac-Man contribution graph

Usage:
  node src/index.js --username <login> [--theme light|dark] [--output <file>] [--seed <int>]
  node src/index.js --mock [--theme light|dark] [--output <file>] [--seed <int>]

Options:
  --username <login>   GitHub username (requires GITHUB_TOKEN in the environment)
  --theme <name>       "light" (default) or "dark"
  --output <file>      Output SVG path (default: pacman.svg)
  --seed <int>         PRNG seed: wall layout and game unfold (default: 1234)
  --mock               Use deterministic fake data (no token needed)
  --help               Show this help
`;

/**
 * Parse CLI arguments.
 * @param {string[]} argv
 * @returns {{username?: string, theme: string, output: string, seed: number,
 *            mock: boolean, help: boolean}}
 */
function parseArgs(argv) {
  const args = { theme: "light", output: "pacman.svg", seed: 1234, mock: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--username":
        args.username = argv[++i];
        break;
      case "--theme":
        args.theme = argv[++i];
        break;
      case "--output":
        args.output = argv[++i];
        break;
      case "--seed":
        args.seed = Number.parseInt(argv[++i], 10);
        break;
      case "--mock":
        args.mock = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new UsageError(`Unknown option: ${a}`);
    }
  }
  return args;
}

class UsageError extends Error {}

/** Validate parsed arguments, throwing UsageError on problems. */
function validateArgs(args) {
  if (!args.mock && !args.username) {
    throw new UsageError("--username is required (or use --mock).");
  }
  if (!(args.theme in THEMES)) {
    throw new UsageError(
      `Unknown theme "${args.theme}". Available: ${Object.keys(THEMES).join(", ")}.`
    );
  }
  if (!Number.isInteger(args.seed)) {
    throw new UsageError("--seed must be an integer.");
  }
}

/** @param {string[]} argv */
async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  validateArgs(args);

  const rand = createRng(args.seed);

  let grid;
  if (args.mock) {
    grid = generateMockGrid(rand);
  } else {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new UsageError("The GITHUB_TOKEN environment variable is required.");
    }
    grid = await fetchContributionGrid(args.username, token);
  }

  const board = buildBoard(grid, rand);
  const timeline = simulate(board, rand);
  const svg = renderSvg(grid, board, timeline, args.theme);

  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, svg, "utf8");

  const seconds = Math.round(timeline.ticks * ANIMATION.TICK_SECONDS);
  process.stdout.write(
    `OK -> ${args.output} | ${board.dots.size} pellets + ${board.pellets.size} power pellets | ` +
      `${board.edgeWalls.size} walls | ${timeline.ticks} ticks (~${seconds}s) | ` +
      `${timeline.deaths.length} lives lost | ${timeline.remaining} pellets remaining | ` +
      `${(svg.length / 1024).toFixed(0)} KiB\n`
  );
  return 0;
}

main(process.argv)
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof UsageError) {
      process.stderr.write(`Error: ${err.message}\n\n${USAGE}`);
      process.exit(2);
    }
    process.stderr.write(`Error: ${err.stack || err}\n`);
    process.exit(1);
  });
