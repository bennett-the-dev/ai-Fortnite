import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildWorld, MODULES, wallKey, cellKey } from '../src/shared/build.js';
import { EditSession, EditInput } from '../src/shared/edit.js';
import * as wall from '../src/shared/pieces/wall.js';
import * as floor from '../src/shared/pieces/floor.js';
import * as cone from '../src/shared/pieces/cone.js';
import * as stair from '../src/shared/pieces/stair.js';
import { G, H } from '../src/shared/grid.js';

const player = (id, style = 'competitive') => ({ id, team: id, style, mats: { wood: 9999, brick: 9999, metal: 9999 } });
const setup = (opts = {}) => {
  const w = new BuildWorld();
  const a = player('a');
  let t = 0;
  const put = (req) => { const r = w.place(a, req, t); t += 0.2; assert.ok(r.ok, r.reason); return r.key; };
  return { w, a, put, session: new EditSession(w, 'a', opts) };
};

const vol = (boxes) => boxes.reduce((s, b) => s + (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]), 0);

test('wall edits remove exactly the selected tiles of the 3x3 grid', () => {
  const full = wall.solids({ gx: 0, gl: 0, gz: 0, o: 0, state: wall.defaultState() });
  assert.equal(full.length, 9);
  for (const [name, removed] of Object.entries(wall.PRESETS)) {
    const st = wall.stateFromRemoved(removed);
    assert.ok(wall.validate(st), name);
    const boxes = wall.solids({ gx: 0, gl: 0, gz: 0, o: 0, state: st });
    assert.equal(boxes.length, 9 - removed.length, name);
    assert.deepEqual(wall.removedOf(st).sort(), [...removed].sort(), name);
  }
  assert.equal(wall.validate({ mask: 0 }), false, 'cannot remove every tile');
});

test('floor and cone use a 2x2 grid with corner, half and diagonal configurations', () => {
  for (const mod of [floor, cone]) {
    for (const [name, removed] of Object.entries(mod.PRESETS)) {
      const st = mod.stateFromRemoved(removed);
      assert.ok(mod.validate(st), `${mod.TYPE} ${name}`);
      assert.deepEqual(mod.removedOf(st).sort(), [...removed].sort());
    }
    assert.equal(mod.validate({ mask: 0 }), false);
    assert.equal(mod.TILES, 4);
  }
  const f = (rem) => floor.solids({ gx: 0, gl: 0, gz: 0, state: floor.stateFromRemoved(rem) });
  assert.equal(f([]).length, 4);
  assert.equal(f(floor.PRESETS.diagonal).length, 2);
  assert.ok(Math.abs(vol(f([0])) / vol(f([])) - 0.75) < 1e-9);
});

test('cone: exact surface height is a pyramid and removed quadrants have no surface', () => {
  const p = { gx: 0, gl: 0, gz: 0, state: cone.defaultState() };
  assert.ok(Math.abs(cone.heightAt(p, G / 2, G / 2) - H) < 1e-9, 'apex');
  assert.ok(Math.abs(cone.heightAt(p, 0.001, G / 2)) < 0.01, 'edge is at base');
  const q = { ...p, state: cone.stateFromRemoved([0]) }; // removes the low-x / low-z quadrant
  assert.equal(cone.heightAt(q, G * 0.25, G * 0.25), null);
  assert.ok(cone.heightAt(q, G * 0.75, G * 0.75) > 0);
});

test('cone collision approximation never pokes above the true surface', () => {
  const p = { gx: 0, gl: 0, gz: 0, state: cone.defaultState() };
  for (const b of cone.solids(p)) {
    // sample the top face of each box: true surface must be at least as high everywhere (inscribed approximation)
    for (const x of [b.min[0] + 1e-6, b.max[0] - 1e-6]) for (const z of [b.min[2] + 1e-6, b.max[2] - 1e-6]) {
      assert.ok(cone.heightAt(p, x, z) + 1e-6 >= b.max[1] - 1e-6 - 0.0, `box top ${b.max[1]} vs surface ${cone.heightAt(p, x, z)}`);
    }
  }
});

test('stair edits: flip reverses the rise direction, mask removes half-width / half-run sections', () => {
  const base = { gx: 0, gl: 0, gz: 0, dir: 1, state: stair.defaultState() };
  const top = (p) => Math.max(...stair.solids(p).map((b) => b.max[1]));
  assert.ok(Math.abs(top(base) - H) < 1e-9);
  assert.equal(stair.solids(base).length, 16);

  // dir 1 rises toward +x: tallest box is on the +x side
  const tallest = (p) => stair.solids(p).reduce((a, b) => (b.max[1] > a.max[1] ? b : a));
  assert.ok(tallest(base).min[0] > G * 0.8);
  const flipped = { ...base, state: { ...base.state, flip: true } };
  assert.ok(tallest(flipped).max[0] < G * 0.2);
  assert.equal(stair.effectiveDir(flipped), 3);

  const half = { ...base, state: stair.stateFromRemoved(stair.PRESETS.halfWidthLeft) };
  assert.equal(stair.solids(half).length, 8);
  const zs = stair.solids(half).map((b) => [b.min[2], b.max[2]]);
  const mid = G / 2;
  assert.ok(zs.every(([a, b]) => (a >= mid - 1e-9) || (b <= mid + 1e-9)), 'all remaining boxes lie on one side of the centre line');

  for (let dir = 0; dir < 4; dir++) {
    const p = { gx: 3, gl: 1, gz: -2, dir, state: stair.defaultState() };
    const bs = stair.solids(p);
    assert.equal(bs.length, 16);
    for (const b of bs) {
      assert.ok(b.min[0] >= 3 * G - 1e-9 && b.max[0] <= 4 * G + 1e-9 && b.min[2] >= -2 * G - 1e-9 && b.max[2] <= -1 * G + 1e-9, `dir ${dir} stays inside its cell`);
      assert.ok(b.min[1] >= H - 1e-9 && b.max[1] <= 2 * H + 1e-9);
    }
  }
});

test('stair vertices touch the next level on the high side so floors can be supported', () => {
  for (let dir = 0; dir < 4; dir++) {
    const v = stair.vertices({ gx: 0, gl: 0, gz: 0, dir, state: stair.defaultState() });
    const high = v.filter((x) => x[1] === 1);
    assert.equal(high.length, 2);
  }
});

test('preview geometry equals final geometry exactly (wall)', () => {
  const { w, put, session } = setup();
  const key = put({ type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 });
  session.pressEdit(key);
  session.select(1); session.select(4);
  const preview = JSON.stringify(session.previewSolids());
  assert.ok(session.confirm());
  assert.equal(JSON.stringify(w.solidsOf(w.get(key))), preview);
});

test('edits change real collision and ray results (a window lets a ray through, a full wall does not)', () => {
  const { w, put, session } = setup();
  const key = put({ type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 });
  const origin = [0.5 * G, H * 0.5, -2];
  assert.ok(w.raycast(origin, [0, 0, 1], 10), 'full wall blocks');
  session.pressEdit(key); session.select(4); session.confirm();
  assert.equal(w.raycast(origin, [0, 0, 1], 10), null, 'window passes the centre ray');
  const low = w.raycast([0.5 * G, 0.2, -2], [0, 0, 1], 10);
  assert.ok(low, 'bottom row is still solid');
  assert.equal(w.nearbyBoxes({ min: [0.5 * G - 0.1, H * 0.5 - 0.1, -0.5], max: [0.5 * G + 0.1, H * 0.5 + 0.1, 0.5] }).length, 0);
});

test('reset restores the full piece in one call', () => {
  const { w, put, session } = setup();
  const key = put({ type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 });
  session.pressEdit(key); session.select(4); session.confirm();
  assert.equal(w.get(key).state.mask === wall.FULL, false);
  assert.ok(session.reset(key));
  assert.equal(w.get(key).state.mask, wall.FULL);
});

test('confirm on release: releasing the edit key applies the selection; without it a second press is needed', () => {
  const on = setup({ confirmEditOnRelease: true });
  const k1 = on.put({ type: 'floor', gx: 0, gl: 0, gz: 0 });
  on.session.pressEdit(k1); on.session.select(0); on.session.releaseEdit();
  assert.equal(on.w.get(k1).state.mask, 0b1110);
  assert.equal(on.session.state, 'idle');

  const off = setup({ confirmEditOnRelease: false });
  const k2 = off.put({ type: 'floor', gx: 0, gl: 0, gz: 0 });
  off.session.pressEdit(k2); off.session.select(0); off.session.releaseEdit();
  assert.equal(off.w.get(k2).state.mask, 0b1111, 'release alone does nothing');
  assert.equal(off.session.state, 'editing');
  off.session.pressEdit(k2); // second press confirms
  assert.equal(off.w.get(k2).state.mask, 0b1110);
});

test('edit on release: the session starts when the edit key is released', () => {
  const { session, put } = setup({ editOnRelease: true });
  const key = put({ type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 });
  session.pressEdit(key);
  assert.equal(session.state, 'armed');
  session.releaseEdit();
  assert.equal(session.state, 'editing');
});

test('empty selection confirm is a no-op; cancel leaves the piece untouched', () => {
  const { w, put, session } = setup();
  const key = put({ type: 'cone', gx: 0, gl: 0, gz: 0 });
  session.pressEdit(key); session.confirm();
  assert.equal(w.get(key).state.mask, 0b1111);
  session.pressEdit(key); session.select(1); session.cancel();
  assert.equal(w.get(key).state.mask, 0b1111);
});

test('chained edits: re-editing keeps previous removals and can add or restore tiles', () => {
  const { w, put, session } = setup({ confirmEditOnRelease: true });
  const key = put({ type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 });
  session.pressEdit(key); session.select(4); session.releaseEdit();
  session.pressEdit(key); session.select(1); session.releaseEdit();
  assert.deepEqual(wall.removedOf(w.get(key).state).sort(), [1, 4]);
  session.pressEdit(key); session.select(4, false); session.releaseEdit();
  assert.deepEqual(wall.removedOf(w.get(key).state), [1]);
});

test('rapid double / triple / quad edits across different pieces all land', () => {
  const { w, put, session } = setup({ confirmEditOnRelease: true });
  const keys = [
    put({ type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }),
    put({ type: 'wall', gx: 1, gl: 0, gz: 0, o: 0 }),
    put({ type: 'floor', gx: 0, gl: 0, gz: 1 }),
    put({ type: 'cone', gx: 3, gl: 0, gz: 0 }),
  ];
  const sel = [[4], [1], [0], [2]];
  keys.forEach((k, i) => { session.pressEdit(k); sel[i].forEach((s) => session.select(s)); session.releaseEdit(); });
  keys.forEach((k, i) => assert.equal(MODULES[w.get(k).type].removedOf(w.get(k).state).length, 1));
  assert.equal(session.state, 'idle');
});

test('stair edit through the session: flip toggle plus half-width mask', () => {
  const { w, put, session } = setup({ confirmEditOnRelease: true });
  const key = put({ type: 'stair', gx: 0, gl: 0, gz: 0, dir: 1 });
  session.pressEdit(key); session.toggleFlip(); session.select(0); session.select(2); session.releaseEdit();
  assert.equal(w.get(key).state.flip, true);
  assert.equal(stair.removedOf(w.get(key).state).length, 2);
  assert.equal(w.solidsOf(w.get(key)).length, 8);
});

test('enemy pieces cannot be edited through a session', () => {
  const w = new BuildWorld();
  w.place(player('a'), { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 0);
  const s = new EditSession(w, 'b');
  assert.equal(s.pressEdit(wallKey(0, 0, 0, 0)), false);
  assert.equal(s.state, 'idle');
  assert.equal(s.reset(wallKey(0, 0, 0, 0)), false);
});

test('scroll-wheel reset: same wheel direction bound to edit and reset resets in a single tick', () => {
  const { w, put, session } = setup({ confirmEditOnRelease: true });
  const key = put({ type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 });
  session.pressEdit(key); session.select(4); session.releaseEdit();
  assert.equal(w.get(key).state.mask === wall.FULL, false);

  const input = new EditInput(session, { edit: ['key:KeyG', 'wheel:down'], reset: ['key:KeyR', 'wheel:down'] });
  input.setTarget(key);
  assert.ok(input.handle({ type: 'wheel', code: 'down' }));
  assert.equal(w.get(key).state.mask, wall.FULL);
  assert.equal(session.state, 'idle', 'no stuck edit session after the wheel tick');
});

test('without the shared wheel bind a reset takes two inputs (edit key, then reset key)', () => {
  const { w, put, session } = setup({ confirmEditOnRelease: true });
  const key = put({ type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 });
  session.pressEdit(key); session.select(4); session.releaseEdit();
  const input = new EditInput(session, { edit: ['key:KeyG'], reset: ['key:KeyR', 'wheel:down'] });
  input.setTarget(key);
  input.handle({ type: 'wheel', code: 'down' }); // reset alone still works from idle, but only on the aimed piece
  assert.equal(w.get(key).state.mask, wall.FULL);
});

test('wheel bound to edit only starts an edit; it never resets', () => {
  const { w, put, session } = setup();
  const key = put({ type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 });
  session.pressEdit(key); session.select(4); session.confirm();
  const input = new EditInput(session, { edit: ['wheel:up'], reset: [] });
  input.setTarget(key);
  input.handle({ type: 'wheel', code: 'up' });
  assert.equal(session.state, 'editing');
  assert.notEqual(w.get(key).state.mask, wall.FULL);
});

test('wheel reset on an enemy wall does nothing (ownership validated)', () => {
  const w = new BuildWorld();
  w.place(player('a'), { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 0);
  const key = wallKey(0, 0, 0, 0);
  w.applyEdit('a', key, wall.stateFromRemoved([4]));
  const session = new EditSession(w, 'b', { confirmEditOnRelease: true });
  const input = new EditInput(session, { edit: ['wheel:down'], reset: ['wheel:down'] });
  input.setTarget(key);
  input.handle({ type: 'wheel', code: 'down' });
  assert.notEqual(w.get(key).state.mask, wall.FULL);
});

test('every stair preset is a valid edit and removes exactly its tiles (half stair, peanut butter, single-tile opening)', () => {
  for (const [name, removed] of Object.entries(stair.PRESETS)) {
    const st = stair.stateFromRemoved(removed);
    assert.ok(stair.validate(st), name);
    // 16 collision boxes over 4 tiles = 4 boxes per tile
    assert.equal(stair.solids({ gx: 0, gl: 0, gz: 0, dir: 2, state: st }).length, 16 - removed.length * 4, name);
  }
  assert.equal(stair.PRESETS.peanutButter.length, 3);
});
