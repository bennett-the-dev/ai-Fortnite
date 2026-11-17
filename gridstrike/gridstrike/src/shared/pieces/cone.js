// CONE: four-sided pyramid, own 2x2 edit grid (one tile per pyramid face-quadrant).
import { G, H } from '../grid.js';
import { box } from '../util.js';

export const TYPE = 'cone';
export const COLS = 2, ROWS = 2, TILES = 4;
export const FULL = 0b1111;
export const STEPS = 4; // collision approximation resolution
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
  halfOpen: [idx(0, 0), idx(0, 1)],
  diagonal: [idx(0, 1), idx(1, 0)],
};

const quadrantOf = (p, x, z) => {
  const cx = (p.gx + 0.5) * G, cz = (p.gz + 0.5) * G;
  return idx(z >= cz ? 1 : 0, x >= cx ? 1 : 0);
};

/** Exact pyramid surface height (world y) at (x,z), or null if outside the cell or in a removed quadrant. */
export function heightAt(p, x, z) {
  const cx = (p.gx + 0.5) * G, cz = (p.gz + 0.5) * G;
  const m = Math.max(Math.abs(x - cx), Math.abs(z - cz));
  if (m > G / 2) return null;
  if (!(p.state.mask & (1 << quadrantOf(p, x, z)))) return null;
  return p.gl * H + H * (1 - m / (G / 2));
}

/**
 * Collision: conservative inscribed stepped approximation (boxes sit at or below the true surface).
 * Exact surface is available through heightAt(); ray tests should use heightAt-aware code later.
 */
export function solids(p) {
  const out = [];
  const cx = (p.gx + 0.5) * G, cz = (p.gz + 0.5) * G, R = G / 2;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!(p.state.mask & (1 << idx(r, c)))) continue;
    const qx0 = p.gx * G + c * R, qz0 = p.gz * G + r * R; // quadrant corner
    for (let k = 1; k < STEPS; k++) {
      const rad = R * (1 - k / STEPS); // nested squares shrinking toward the apex
      const x0 = Math.max(qx0, cx - rad), x1 = Math.min(qx0 + R, cx + rad);
      const z0 = Math.max(qz0, cz - rad), z1 = Math.min(qz0 + R, cz + rad);
      if (x1 - x0 <= 1e-9 || z1 - z0 <= 1e-9) continue;
      // Inscribed: the lowest surface height inside this footprint is at its outer radius.
      out.push(box(x0, p.gl * H, z0, x1, p.gl * H + H * (1 - rad / R), z1));
    }
  }
  return out;
}

export function vertices(p) {
  const { gx, gl, gz } = p;
  return [[gx, gl, gz], [gx + 1, gl, gz], [gx, gl, gz + 1], [gx + 1, gl, gz + 1]];
}
