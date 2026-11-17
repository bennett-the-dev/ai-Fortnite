import { GAME } from '../../config/game.js';

export const G = GAME.grid.size;      // cell width/depth
export const H = GAME.grid.height;    // storey height
export const T = GAME.grid.thickness; // piece thickness

// Cell and level lookup for a world point.
export const cellOf = (x, z) => [Math.floor(x / G), Math.floor(z / G)];
export const levelOf = (y) => Math.floor(y / H + 1e-9);

/**
 * Snap a world point to the nearest wall edge inside its cell.
 * Wall orientation o: 0 = runs along X at z = gz*G, 1 = runs along Z at x = gx*G.
 */
export function snapWall(x, y, z) {
  const gx = Math.floor(x / G), gz = Math.floor(z / G), gl = levelOf(y);
  const fx = x / G - gx, fz = z / G - gz;
  const d = [fz, 1 - fz, fx, 1 - fx]; // north, south, west, east
  const m = Math.min(...d), i = d.indexOf(m);
  if (i === 0) return { gx, gl, gz, o: 0 };
  if (i === 1) return { gx, gl, gz: gz + 1, o: 0 };
  if (i === 2) return { gx, gl, gz, o: 1 };
  return { gx: gx + 1, gl, gz, o: 1 };
}

export const snapCell = (x, y, z) => ({ gx: Math.floor(x / G), gl: levelOf(y), gz: Math.floor(z / G) });

export const cellOrigin = (gx, gl, gz) => [gx * G, gl * H, gz * G];
