import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildWorld, MODULES, wallKey, cellKey } from '../src/shared/build.js';
import { snapWall, snapCell, G, H } from '../src/shared/grid.js';
import { boxUpPlan, runPlan } from '../src/shared/styles.js';
import { GAME } from '../config/game.js';

const mkPlayer = (id, style = 'competitive', mats = 1000) => ({ id, team: id, style, mats: { wood: mats, brick: mats, metal: mats } });

test('grid dimensions match the sourced 512 x 384 cm piece size', () => {
  assert.equal(G, 5.12);
  assert.equal(H, 3.84);
});

test('wall snapping picks the nearest edge and canonical orientation', () => {
  assert.deepEqual(snapWall(0.2 * G + 0, 0.1, 0.9 * G), { gx: 0, gl: 0, gz: 1, o: 0 }); // nearest = south edge
  assert.deepEqual(snapWall(0.05 * G, 0.1, 0.5 * G), { gx: 0, gl: 0, gz: 0, o: 1 });
  assert.deepEqual(snapWall(0.95 * G, 0.1, 0.5 * G), { gx: 1, gl: 0, gz: 0, o: 1 });
  assert.deepEqual(snapWall(0.5 * G, H + 0.1, 0.02 * G), { gx: 0, gl: 1, gz: 0, o: 0 });
  assert.deepEqual(snapCell(G * 2.5, H * 2 + 0.1, -0.1), { gx: 2, gl: 2, gz: -1 });
});

test('all four piece types place on the ground and consume materials', () => {
  const w = new BuildWorld();
  const p = mkPlayer('a');
  let t = 0;
  for (const req of [
    { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 },
    { type: 'floor', gx: 5, gl: 0, gz: 0 },
    { type: 'stair', gx: 10, gl: 0, gz: 0, dir: 1 },
    { type: 'cone', gx: 15, gl: 0, gz: 0 },
  ]) {
    const r = w.place(p, req, t);
    assert.ok(r.ok, `${req.type}: ${r.reason}`);
    t += 0.2;
  }
  assert.equal(w.pieces.size, 4);
  assert.equal(p.mats.wood, 1000 - 40);
});

test('invalid placements are rejected: duplicate slot, no support, no materials, bad coords', () => {
  const w = new BuildWorld();
  const p = mkPlayer('a');
  assert.ok(w.place(p, { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 0).ok);
  assert.equal(w.place(p, { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 1).reason, 'occupied');
  assert.equal(w.place(p, { type: 'floor', gx: 20, gl: 3, gz: 20 }, 2).reason, 'unsupported');
  assert.equal(w.place(p, { type: 'wall', gx: 1.5, gl: 0, gz: 0, o: 0 }, 3).reason, 'badCoords');
  assert.equal(w.place(p, { type: 'wall', gx: 0, gl: -1, gz: 0, o: 0 }, 4).reason, 'belowGround');
  const broke = mkPlayer('b', 'competitive', 5);
  assert.equal(w.place(broke, { type: 'wall', gx: 9, gl: 0, gz: 9, o: 0 }, 5).reason, 'materials');
});

test('floor, stair and cone share one cell slot; walls use edge slots', () => {
  const w = new BuildWorld();
  const p = mkPlayer('a');
  assert.ok(w.place(p, { type: 'floor', gx: 0, gl: 0, gz: 0 }, 0).ok);
  assert.equal(w.place(p, { type: 'stair', gx: 0, gl: 0, gz: 0, dir: 0 }, 1).reason, 'occupied');
  assert.ok(w.place(p, { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 2).ok);
  assert.ok(w.place(p, { type: 'wall', gx: 0, gl: 0, gz: 0, o: 1 }, 3).ok);
});

test('structural support: a ramp can climb, a floating piece cannot, and destroying the base collapses what hangs on it', () => {
  const w = new BuildWorld();
  const p = mkPlayer('a');
  let t = 0;
  const go = (req) => { const r = w.place(p, req, t); t += 0.2; return r; };
  assert.ok(go({ type: 'stair', gx: 0, gl: 0, gz: 0, dir: 1 }).ok);        // rises toward +x, top edge at level 1, x = 1
  assert.ok(go({ type: 'floor', gx: 1, gl: 1, gz: 0 }).ok);                // floor at level 1 touches stair top vertices
  assert.equal(go({ type: 'floor', gx: 9, gl: 1, gz: 9 }).reason, 'unsupported');
  const res = w.destroy(cellKey(0, 0, 0), t);
  assert.ok(res.ok);
  assert.deepEqual(res.collapsed, [cellKey(1, 1, 0)]);
});

test('turbo gap: first piece is immediate, second is rate-limited per style', () => {
  const w = new BuildWorld();
  const classic = mkPlayer('c', 'classic');
  assert.ok(w.place(classic, { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 0).ok);
  assert.equal(w.place(classic, { type: 'wall', gx: 1, gl: 0, gz: 0, o: 0 }, 0.10).reason, 'rate');
  assert.ok(w.place(classic, { type: 'wall', gx: 1, gl: 0, gz: 0, o: 0 }, 0.15).ok);
  const comp = mkPlayer('k', 'competitive');
  assert.ok(w.place(comp, { type: 'wall', gx: 5, gl: 0, gz: 0, o: 0 }, 1).ok);
  assert.ok(w.place(comp, { type: 'wall', gx: 6, gl: 0, gz: 0, o: 0 }, 1.06).ok);
});

test('piece limit is enforced', () => {
  const cfg = { ...GAME, build: { ...GAME.build, maxPieces: 3 } };
  const w = new BuildWorld({ config: cfg });
  const p = mkPlayer('a');
  let t = 0, last;
  for (let i = 0; i < 4; i++) { last = w.place(p, { type: 'floor', gx: i, gl: 0, gz: 0 }, t); t += 0.2; }
  assert.equal(last.reason, 'limit');
});

test('ownership: only the owner may edit; enemy edit is rejected', () => {
  const w = new BuildWorld();
  const a = mkPlayer('a'), b = mkPlayer('b');
  w.place(a, { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 0);
  const key = wallKey(0, 0, 0, 0);
  assert.equal(w.applyEdit('b', key, MODULES.wall.stateFromRemoved([4])).reason, 'notOwner');
  assert.ok(w.applyEdit('a', key, MODULES.wall.stateFromRemoved([4])).ok);
  assert.equal(w.resetEdit('b', key).reason, 'notOwner');
});

test('piece control: destroyed slot is held for the replace delay and one entrant wins, paying only the winner', () => {
  const w = new BuildWorld({ seed: 7 });
  const a = mkPlayer('a'), b = mkPlayer('b'), c = mkPlayer('c');
  w.place(a, { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 0);
  const key = wallKey(0, 0, 0, 0);
  w.damage(key, 9999, 1.0);
  assert.equal(w.pieces.has(key), false);
  const r1 = w.place(b, { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 1.02);
  const r2 = w.place(c, { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 1.10);
  const r3 = w.place(a, { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 1.12);
  assert.ok(r1.pending && r2.pending && r3.pending);
  assert.equal(w.pieces.has(key), false, 'nothing is placed before the window closes');
  assert.deepEqual(w.resolvePending(1.10), []);
  const ev = w.resolvePending(1.16);
  assert.equal(ev.length, 1);
  assert.notEqual(ev[0].owner, 'a', 'nonOwnerFlip: the previous owner cannot win while others entered');
  assert.equal(ev[0].entrants, 3);
  assert.equal(w.get(key).owner, ev[0].owner);
  // a paid 10 for its original wall; only the winner pays for the replacement, losers keep their materials.
  const spent = { a: 1000 - a.mats.wood, b: 1000 - b.mats.wood, c: 1000 - c.mats.wood };
  assert.equal(spent.a, 10 + (ev[0].owner === 'a' ? 10 : 0));
  assert.equal(spent[ev[0].owner] - (ev[0].owner === 'a' ? 10 : 0), 10);
  const losers = ['b', 'c'].filter((id) => id !== ev[0].owner);
  for (const id of losers) assert.equal(spent[id], 0);
});

test('ownerPriority policy hands the slot back to the previous owner', () => {
  const cfg = { ...GAME, build: { ...GAME.build, replacePolicy: 'ownerPriority' } };
  const w = new BuildWorld({ config: cfg, seed: 3 });
  const a = mkPlayer('a'), b = mkPlayer('b');
  w.place(a, { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 0);
  const key = wallKey(0, 0, 0, 0);
  w.destroy(key, 1);
  w.place(b, { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 1.01);
  w.place(a, { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 1.14);
  const ev = w.resolvePending(1.2);
  assert.equal(ev[0].owner, 'a');
});

test('replacement is independent of arrival order within the window (ping fairness)', () => {
  const wins = { b: 0, c: 0 };
  for (let seed = 1; seed <= 200; seed++) {
    const w = new BuildWorld({ seed });
    const a = mkPlayer('a'), b = mkPlayer('b'), c = mkPlayer('c');
    w.place(a, { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 0);
    const key = wallKey(0, 0, 0, 0);
    w.destroy(key, 1);
    w.place(b, { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 1.001); // b arrives first
    w.place(c, { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 1.149); // c arrives last
    wins[w.resolvePending(1.2)[0].owner]++;
  }
  assert.ok(wins.b > 60 && wins.c > 60, `b=${wins.b} c=${wins.c}`);
});

test('shell style: boxing up places 4 walls + cone and the result is solid', () => {
  const w = new BuildWorld();
  const p = mkPlayer('a', 'shell');
  const { results } = runPlan(w, p, boxUpPlan(0, 0, 0), 0);
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  assert.equal(w.pieces.size, 5);
  const centre = [0.5 * G, 1.0, 0.5 * G];
  for (const dir of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    const hit = w.raycast(centre, dir, G);
    assert.ok(hit && hit.piece.type === 'wall');
  }
  assert.ok(w.raycast(centre, [0, 1, 0], 10));
});

test('every piece module exposes separate geometry and a separate edit grid', () => {
  assert.equal(MODULES.wall.TILES, 9);
  assert.equal(MODULES.floor.TILES, 4);
  assert.equal(MODULES.cone.TILES, 4);
  assert.equal(MODULES.stair.TILES, 4);
  assert.notEqual(MODULES.wall.solids, MODULES.floor.solids);
  assert.notEqual(MODULES.floor.solids, MODULES.cone.solids);
});
