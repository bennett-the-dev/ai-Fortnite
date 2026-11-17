// FLOOR: own geometry + own 2x2 edit grid.
import { G, H, T } from '../grid.js';
import { box } from '../util.js';

export const TYPE = 'floor';
export const COLS = 2, ROWS = 2, TILES = 4;
export const FULL = 0b1111;

// Tile index = row * 2 + col; col runs along +X, row runs along +Z.
export const idx = (row, col) => row * COLS + col;

export const defaultState = () => ({ mask: FULL });
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
export const validate = (state) => state.mask !== 0 && (state.mask & ~FULL) === 0;

export const PRESETS = {
  cornerRemoved: [idx(0, 0)],
  halfX: [idx(0, 0), idx(1, 0)],
  halfZ: [idx(0, 0), idx(0, 1)],
  diagonal: [idx(0, 1), idx(1, 0)],
  threeOpen: [idx(0, 0), idx(0, 1), idx(1, 0)],
};

// Floor surface sits at y = level * H; slab extends T below it.
export function solids(p) {
  const out = [];
  const hw = G / 2, y1 = p.gl * H, y0 = y1 - T;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!(p.state.mask & (1 << idx(r, c)))) continue;
    const x0 = p.gx * G + c * hw, z0 = p.gz * G + r * hw;
    out.push(box(x0, y0, z0, x0 + hw, y1, z0 + hw));
  }
  return out;
}

export function vertices(p) {
  const { gx, gl, gz } = p;
  return [[gx, gl, gz], [gx + 1, gl, gz], [gx, gl, gz + 1], [gx + 1, gl, gz + 1]];
}
