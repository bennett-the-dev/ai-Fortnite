export const box = (x0, y0, z0, x1, y1, z1) => ({
  min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
  max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
});

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const boxesOverlap = (a, b) =>
  a.min[0] < b.max[0] && a.max[0] > b.min[0] &&
  a.min[1] < b.max[1] && a.max[1] > b.min[1] &&
  a.min[2] < b.max[2] && a.max[2] > b.min[2];

// Slab test. Returns distance t along dir (dir need not be normalised; t is in units of dir) or null.
export function rayBox(o, d, b, maxT = Infinity) {
  let tmin = 0, tmax = maxT;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      if (o[i] < b.min[i] || o[i] > b.max[i]) return null;
    } else {
      let t1 = (b.min[i] - o[i]) / d[i], t2 = (b.max[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}
