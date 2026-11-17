// STAIR: directional piece. Own edit model: rotation (dir), flip (reverse rise), and a 2x2 half-run/half-width mask.
// Whether this matches the reference game's stair edit set exactly is UNVERIFIED (research doc R-2).
import { G, H } from '../grid.js';
import { box } from '../util.js';

export const TYPE = 'stair';
export const COLS = 2, ROWS = 2, TILES = 4; // row = low/high half of the run, col = left/right half of the width
export const FULL = 0b1111;
export const STEPS = 8;
export const idx = (row, col) => row * COLS + col;

// dir: rise direction. 0 = -Z, 1 = +X, 2 = +Z, 3 = -X.
export const defaultState = () => ({ mask: FULL, flip: false });
export const effectiveDir = (p) => (p.dir + (p.state.flip ? 2 : 0)) % 4;

export const removedOf = (state) => {
  const r = [];
  for (let i = 0; i < TILES; i++) if (!(state.mask & (1 << i))) r.push(i);
  return r;
};
// Selection edits only the mask; flip is a separate toggle so chained edits keep it.
export const stateFromRemoved = (removed, prev = { flip: false }) => {
  let mask = FULL;
  for (const i of removed) mask &= ~(1 << i);
  return { mask, flip: !!prev.flip };
};
export const validate = (state) => state.mask !== 0 && (state.mask & ~FULL) === 0 && typeof state.flip === 'boolean';

export const PRESETS = {
  halfWidthLeft: [idx(0, 0), idx(1, 0)],
  halfWidthRight: [idx(0, 1), idx(1, 1)],
  lowerHalfOpen: [idx(0, 0), idx(0, 1)],
  upperHalfOpen: [idx(1, 0), idx(1, 1)],      // "half stair" (research R-2: top two or bottom two tiles)
  cornerRemoved: [idx(1, 1)],                 // single-tile "door" style opening
  peanutButter: [idx(0, 0), idx(0, 1), idx(1, 0)], // three tiles removed, one corner stays as cover (L shape)
};

// local (u forward, v right), both 0..1 -> world fractions (x, z) inside the cell.
function toWorld(dir, u, v) {
  switch (dir) {
    case 0: return [v, 1 - u];
    case 1: return [u, v];
    case 2: return [1 - v, u];
    default: return [1 - u, 1 - v];
  }
}

export function solids(p) {
  const out = [];
  const d = effectiveDir(p), step = H / STEPS;
  for (let i = 0; i < STEPS; i++) {
    const row = i < STEPS / 2 ? 0 : 1;
    const u0 = i / STEPS, u1 = (i + 1) / STEPS;
    for (let col = 0; col < 2; col++) {
      if (!(p.state.mask & (1 << idx(row, col)))) continue;
      const v0 = col * 0.5, v1 = v0 + 0.5;
      const a = toWorld(d, u0, v0), b = toWorld(d, u1, v1);
      out.push(box(
        (p.gx + a[0]) * G, p.gl * H, (p.gz + a[1]) * G,
        (p.gx + b[0]) * G, p.gl * H + (i + 1) * step, (p.gz + b[1]) * G,
      ));
    }
  }
  return out;
}

export function vertices(p) {
  const { gx, gl, gz } = p;
  const d = effectiveDir(p);
  const top = [toWorld(d, 1, 0), toWorld(d, 1, 1)].map(([fx, fz]) => [gx + Math.round(fx), gl + 1, gz + Math.round(fz)]);
  return [[gx, gl, gz], [gx + 1, gl, gz], [gx, gl, gz + 1], [gx + 1, gl, gz + 1], ...top];
}
