"use strict";

/**
 * @fileoverview SVG renderer. Replays a simulation timeline as a fully
 * self-contained animated SVG (pure SMIL, no JavaScript, loops forever).
 *
 * Synchronization contract:
 * - Pac-Man's track is EXACT to the tick (no smoothing), so pellets vanish
 *   precisely when he crosses them and deaths happen on contact;
 * - ghost tracks are smoothed: their reduced speeds (implemented as skipped
 *   ticks in the simulation) become continuous slower motion instead of
 *   stop-and-go. Smoothing is anchored at every mode change, bounding drift
 *   to under one tick so frightened/eaten/revive moments stay aligned.
 */

const { GRID, ANIMATION, THEMES, GHOSTS, levelFor } = require("./config");
const { MODE } = require("./simulate");

/**
 * Pac-Man body path: a circle of radius `r` centered at the origin with a
 * mouth wedge of `deg` degrees on each side of the +x axis.
 *
 * @param {number} r @param {number} deg
 * @returns {string} SVG path data.
 */
function pacmanPath(r, deg) {
  const a = (deg * Math.PI) / 180;
  const x = (r * Math.cos(a)).toFixed(3);
  const y = (r * Math.sin(a)).toFixed(3);
  return `M 0 0 L ${x} ${-y} A ${r} ${r} 0 1 0 ${x} ${y} Z`;
}

/** Classic ghost silhouette (dome + wavy skirt), centered at the origin. */
const GHOST_SHAPE =
  "M -5.5 0.5 A 5.5 5.5 0 0 1 5.5 0.5 L 5.5 5.5 L 3.7 4.1 L 1.85 5.5 " +
  "L 0 4.1 L -1.85 5.5 L -3.7 4.1 L -5.5 5.5 Z";

/**
 * Render the animated SVG.
 *
 * @param {Array<Array<?number>>} grid Contribution grid.
 * @param {import('./board').Board} board
 * @param {import('./simulate').Timeline} tl
 * @param {keyof typeof THEMES} themeName
 * @returns {string} SVG document.
 */
function renderSvg(grid, board, tl, themeName) {
  const theme = THEMES[themeName] || THEMES.light;
  const { W, H } = board;
  const { CELL, GAP, PAD } = GRID;
  const STEP = CELL + GAP;

  const width = PAD * 2 + W * STEP - GAP;
  const height = PAD * 2 + H * STEP - GAP;
  const cx = (c) => PAD + c * STEP + CELL / 2;
  const cy = (r) => PAD + r * STEP + CELL / 2;

  const T = tl.ticks;
  const DUR = (T * ANIMATION.TICK_SECONDS).toFixed(2);
  const kt = (tick) => (tick / T).toFixed(5);

  // --- Calendar cells: GitHub's green ramp, paled so sprites stand out ----
  const cells = [];
  for (let c = 0; c < W; c++) {
    for (let r = 0; r < H; r++) {
      const v = grid[c][r];
      if (v === null) continue;
      const x = PAD + c * STEP;
      const y = PAD + r * STEP;
      const fill = v > 0 ? theme.greens[levelFor(v)] : theme.emptyCell;
      cells.push(
        `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${fill}"/>`
      );
    }
  }

  // --- Walls: segments drawn BETWEEN cells, inside the gap ------------------
  const wallEls = [];
  const WALL_W = 2.6; // stroke width
  const OVER = 1.6; // slight overhang so adjoining walls connect visually

  /** Render one edge as a wall segment with the given stroke color. */
  function edgeSegment(edge, stroke) {
    const [a, b] = edge.split("|").map((p) => p.split(",").map(Number));
    if (a[1] === b[1]) {
      // Side-by-side cells -> vertical wall in the gap.
      const c = Math.min(a[0], b[0]);
      const r = a[1];
      const x = PAD + c * STEP + CELL + GAP / 2;
      const y1 = PAD + r * STEP - OVER;
      const y2 = PAD + r * STEP + CELL + OVER;
      return (
        `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" ` +
        `stroke="${stroke}" stroke-width="${WALL_W}" stroke-linecap="round"/>`
      );
    }
    // Stacked cells -> horizontal wall in the gap.
    const c = a[0];
    const r = Math.min(a[1], b[1]);
    const y = PAD + r * STEP + CELL + GAP / 2;
    const x1 = PAD + c * STEP - OVER;
    const x2 = PAD + c * STEP + CELL + OVER;
    return (
      `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" ` +
      `stroke="${stroke}" stroke-width="${WALL_W}" stroke-linecap="round"/>`
    );
  }

  for (const ek of board.edgeWalls) {
    if (ek === board.ghostDoor) continue; // the door gets its own color
    wallEls.push(edgeSegment(ek, theme.wall));
  }
  wallEls.push(edgeSegment(board.ghostDoor, theme.ghostDoor));

  // --- Pellets & power pellets ----------------------------------------------
  const dotEls = [];
  /** Discrete opacity drop at the tick the pellet is eaten. */
  function eatenAnim(eatTick) {
    if (eatTick === undefined) return "";
    return (
      `<animate attributeName="opacity" dur="${DUR}s" repeatCount="indefinite" ` +
      `calcMode="discrete" values="1;0" keyTimes="0;${kt(eatTick)}"/>`
    );
  }
  for (const k of board.dots) {
    const [c, r] = k.split(",").map(Number);
    dotEls.push(
      `<circle cx="${cx(c)}" cy="${cy(r)}" r="2" fill="${theme.dot}">` +
        eatenAnim(tl.dotEaten.get(k)) +
        `</circle>`
    );
  }
  for (const k of board.pellets) {
    const [c, r] = k.split(",").map(Number);
    dotEls.push(
      `<circle cx="${cx(c)}" cy="${cy(r)}" r="3.4" fill="${theme.pellet}">` +
        `<animate attributeName="r" values="3.4;2.4;3.4" dur="0.6s" repeatCount="indefinite"/>` +
        eatenAnim(tl.pelletEaten.get(k)) +
        `</circle>`
    );
  }

  // --- Trajectory compression + smoothing -----------------------------------
  /**
   * Convert a per-tick position track into SMIL keypoints.
   *
   * holdKeep=1 keeps the timeline EXACT (no pause absorbed) — used for
   * Pac-Man, who must stay synchronized with pellets and collisions.
   * holdKeep=3 + anchorTicks smooths ghost micro-pauses into continuous
   * slower motion; anchors at every mode change bound drift to < 1 tick.
   *
   * @param {Array<[number, number]>} positions Position per tick.
   * @param {{holdKeep?: number, anchorTicks?: number[]}} [opts]
   */
  function compress(positions, { holdKeep = ANIMATION.HOLD_KEEP_TICKS, anchorTicks = [] } = {}) {
    const N = positions.length;

    // 1) Events: start + every arrival on a new cell.
    const ev = [
      { t: 0, c: positions[0][0], r: positions[0][1], jump: false, hold: 0, mark: false },
    ];
    let ai = 0;
    for (let i = 1; i < N; i++) {
      const [c, r] = positions[i];
      const [pc, pr] = positions[i - 1];
      if (c === pc && r === pr) continue;
      let mark = false;
      while (ai < anchorTicks.length && anchorTicks[ai] <= i) {
        mark = true;
        ai++;
      }
      ev.push({
        t: i,
        c,
        r,
        mark,
        jump: Math.abs(c - pc) + Math.abs(r - pr) > 1,
        hold: i - 1 - ev[ev.length - 1].t,
      });
    }

    // 2) Keypoints; long pauses and teleports insert anchored hold points
    // (the sprite keeps its position, then departs or jumps).
    const raw = [];
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (i > 0 && (e.jump || e.hold >= holdKeep)) {
        const p = ev[i - 1];
        raw.push({ t: e.jump ? e.t - 0.02 : e.t - 1, c: p.c, r: p.r, anchor: true });
        raw.push({ t: e.t, c: e.c, r: e.r, anchor: true });
      } else {
        raw.push({ t: e.t, c: e.c, r: e.r, anchor: i === 0 || e.mark });
      }
    }
    // Hold the final position until the end of the loop.
    const last = raw[raw.length - 1];
    if (last.t < N - 1) raw.push({ t: N - 1, c: last.c, r: last.r, anchor: true });
    raw[raw.length - 1].anchor = true;

    // 3) Smoothing: between two anchors, intermediate times are spread
    // uniformly along the path (constant speed).
    let a = 0;
    for (let b = 1; b < raw.length; b++) {
      if (!raw[b].anchor) continue;
      const span = b - a;
      for (let j = 1; j < span; j++) {
        raw[a + j].t = raw[a].t + ((raw[b].t - raw[a].t) * j) / span;
      }
      a = b;
    }

    // 4) Prune collinear constant-speed points.
    const pts = [raw[0]];
    for (let i = 1; i < raw.length - 1; i++) {
      const p = pts[pts.length - 1];
      const q = raw[i];
      const n = raw[i + 1];
      const cross = (q.c - p.c) * (n.r - p.r) - (q.r - p.r) * (n.c - p.c);
      const frac = (q.t - p.t) / (n.t - p.t);
      const fx = (n.c - p.c) * frac + p.c;
      const fy = (n.r - p.r) * frac + p.r;
      const onLine = cross === 0 && Math.abs(fx - q.c) < 1e-6 && Math.abs(fy - q.r) < 1e-6;
      if (!onLine || q.anchor) pts.push(q);
    }
    pts.push(raw[raw.length - 1]);

    return {
      values: pts.map((p) => `${cx(p.c)} ${cy(p.r)}`).join(";"),
      keyTimes: pts.map((p) => (p.t / T).toFixed(5)).join(";"),
      init: `translate(${cx(pts[0].c)} ${cy(pts[0].r)})`,
    };
  }

  // --- Pac-Man ---------------------------------------------------------------
  const pacTr = compress(tl.pac, { holdKeep: 1 });
  // Discrete rotation: the sprite turns when LEAVING a cell (tick i-1), not
  // on arrival — otherwise it travels a full cell facing the wrong way.
  const rot = [{ t: 0, a: tl.pacDir[0] }];
  for (let i = 1; i < tl.pacDir.length; i++) {
    if (tl.pacDir[i] !== tl.pacDir[i - 1]) {
      const tTurn = i - 1;
      if (rot[rot.length - 1].t === tTurn) rot[rot.length - 1].a = tl.pacDir[i];
      else rot.push({ t: tTurn, a: tl.pacDir[i] });
    }
  }
  const rotValues = rot.map((p) => p.a).join(";");
  const rotKeyTimes = rot.map((p) => kt(p.t)).join(";");

  const R = 6.2;
  const mouthOpen = pacmanPath(R, 38);
  const mouthHalf = pacmanPath(R, 18);
  const mouthShut = pacmanPath(R, 3);
  const pacmanEl = `
  <g transform="${pacTr.init}">
    <animateTransform attributeName="transform" type="translate"
      values="${pacTr.values}" keyTimes="${pacTr.keyTimes}"
      dur="${DUR}s" calcMode="linear" repeatCount="indefinite"/>
    <g>
      <animateTransform attributeName="transform" type="rotate"
        values="${rotValues}" keyTimes="${rotKeyTimes}"
        dur="${DUR}s" calcMode="discrete" repeatCount="indefinite"/>
      <path fill="${theme.pacman}" d="${mouthOpen}">
        <animate attributeName="d" dur="${ANIMATION.MOUTH_PERIOD_SECONDS}s" repeatCount="indefinite"
          values="${mouthOpen};${mouthHalf};${mouthShut};${mouthHalf};${mouthOpen}"/>
      </path>
    </g>
  </g>`;

  // --- Ghosts -----------------------------------------------------------------
  const ghostEls = tl.ghosts.map((g, i) => {
    // Anchors at mode changes keep smoothing drift under one tick, so the
    // key moments (frightened, eaten, revived) stay exactly aligned.
    const anchorTicks = [];
    for (let k = 1; k < g.mode.length; k++) {
      if (g.mode[k] !== g.mode[k - 1]) anchorTicks.push(k);
    }
    const tr = compress(g.pos, { anchorTicks });

    // Body color (normal vs frightened) and opacity (eaten = eyes only).
    const fillV = [];
    const fillK = [];
    const opV = [];
    const opK = [];
    let lastFill = null;
    let lastOp = null;
    for (let tick = 0; tick < g.mode.length; tick++) {
      const m = g.mode[tick];
      const fill = m === MODE.FRIGHTENED ? theme.frightened : GHOSTS[i].color;
      const op = m === MODE.EATEN ? "0" : "1";
      if (fill !== lastFill) {
        fillV.push(fill);
        fillK.push(kt(tick));
        lastFill = fill;
      }
      if (op !== lastOp) {
        opV.push(op);
        opK.push(kt(tick));
        lastOp = op;
      }
    }
    const fillAnim =
      fillV.length > 1
        ? `<animate attributeName="fill" dur="${DUR}s" repeatCount="indefinite" ` +
          `calcMode="discrete" values="${fillV.join(";")}" keyTimes="${fillK.join(";")}"/>`
        : "";
    const opAnim =
      opV.length > 1
        ? `<animate attributeName="opacity" dur="${DUR}s" repeatCount="indefinite" ` +
          `calcMode="discrete" values="${opV.join(";")}" keyTimes="${opK.join(";")}"/>`
        : "";

    return `
  <g transform="${tr.init}">
    <animateTransform attributeName="transform" type="translate"
      values="${tr.values}" keyTimes="${tr.keyTimes}"
      dur="${DUR}s" calcMode="linear" repeatCount="indefinite"/>
    <path d="${GHOST_SHAPE}" fill="${GHOSTS[i].color}">${fillAnim}${opAnim}</path>
    <circle cx="-2.1" cy="-1.2" r="1.7" fill="#ffffff"/>
    <circle cx="2.1" cy="-1.2" r="1.7" fill="#ffffff"/>
    <circle cx="-1.6" cy="-1.2" r="0.9" fill="#1b2a5e"/>
    <circle cx="2.6" cy="-1.2" r="0.9" fill="#1b2a5e"/>
  </g>`;
  });

  const background = theme.background
    ? `<rect width="100%" height="100%" rx="8" fill="${theme.background}"/>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <desc>Pac-Man vs ghosts on the contribution graph (${themeName} theme) — ${T} ticks, ${tl.deaths.length} lives lost</desc>
  ${background}
  <g>${cells.join("")}</g>
  <g>${wallEls.join("")}</g>
  <g>${dotEls.join("")}</g>
  ${ghostEls.join("")}
  ${pacmanEl}
</svg>`;
}

module.exports = { renderSvg, pacmanPath };
