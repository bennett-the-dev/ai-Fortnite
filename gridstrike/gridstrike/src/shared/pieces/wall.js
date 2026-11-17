// WALL: own geometry + own 3x3 edit grid. Not shared with any other piece.
import { G, H, T } from '../grid.js';
import { box } from '../util.js';

export const TYPE = 'wall';
export const COLS = 3, ROWS = 3, TILES = 9;
export const FULL = (1 << TILES) - 1;

// Tile index = row * 3 + col, row 0 = bottom, col 0 = low end of the wall's run axis.
export const idx = (row, col) => row * COLS + col;

export const defaultState = () => ({ mask: FULL });

// Selection = tiles removed. Empty selection means full wall.
export const stateFromRemoved = (removed) => {
  let mask = FULL;
  for (const i of removed) mask &= ~(1 << i);
  return { mask };
};
export const removedOf = (state) => {
  const r = [];
  for (let i = 0; i < TILES; i++) if (!(state.mask & (1 << i))) r.push(i);
  return r;
};

// Rule: at least one tile must remain. Any other shape rule is UNVERIFIED (see research doc R-2).
export const validate = (state) => state.mask !== 0 && (state.mask & ~FULL) === 0;

export const PRESETS = {
  window: [idx(1, 1)],
  door: [idx(0, 1)],
  doorTall: [idx(0, 1), idx(1, 1)],
  openRow: [idx(1, 0), idx(1, 1), idx(1, 2)],
  cornerLow: [idx(0, 0)],
  lowerHalfOpen: [idx(0, 0), idx(0, 1), idx(0, 2)],
};

export function solids(p) {
  const out = [];
  const tw = G / COLS, th = H / ROWS;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!(p.state.mask & (1 << idx(r, c)))) continue;
    const y0 = p.gl * H + r * th, y1 = y0 + th;
    if (p.o === 0) {
      const z = p.gz * G, x0 = p.gx * G + c * tw;
      out.push(box(x0, y0, z - T / 2, x0 + tw, y1, z + T / 2));
    } else {
      const x = p.gx * G, z0 = p.gz * G + c * tw;
      out.push(box(x - T / 2, y0, z0, x + T / 2, y1, z0 + tw));
    }
  }
  return out;
}

// Lattice vertices [x, level, z] the piece touches (used for structural support).
export function vertices(p) {
  const { gx, gl, gz } = p;
  return p.o === 0
    ? [[gx, gl, gz], [gx + 1, gl, gz], [gx, gl + 1, gz], [gx + 1, gl + 1, gz]]
    : [[gx, gl, gz], [gx, gl, gz + 1], [gx, gl + 1, gz], [gx, gl + 1, gz + 1]];
}
