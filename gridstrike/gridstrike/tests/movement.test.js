import test from 'node:test';
import assert from 'node:assert/strict';
import { stepPlayer, newPlayerState } from '../src/shared/movement.js';
import { GAME } from '../config/game.js';
import { box } from '../src/shared/util.js';

const C = GAME.move;
const DT = 1 / 120;
const flat = () => ({ groundY: 0, boxes: [] });
const idle = { moveX: 0, moveZ: 0, yaw: 0, jumpPressed: false, crouch: false, crouchPressed: false, sprint: true };
const run = (s, input, secs, world = flat()) => {
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) stepPlayer(s, { ...input }, DT, world);
  return s;
};
const hs = (s) => Math.hypot(s.vel[0], s.vel[2]);

test('sprint accelerates to sprint speed and no further', () => {
  const s = newPlayerState();
  run(s, { ...idle, moveZ: 1 }, 1);
  assert.ok(Math.abs(hs(s) - C.sprintSpeed) < 0.05, `speed ${hs(s)}`);
  assert.ok(s.pos[2] < 0, 'forward is -Z at yaw 0');
});

test('reaches 90% of sprint speed quickly (responsive, not floaty)', () => {
  const s = newPlayerState();
  let t = 0;
  while (hs(s) < 0.9 * C.sprintSpeed && t < 2) { stepPlayer(s, { ...idle, moveZ: 1 }, DT, flat()); t += DT; }
  assert.ok(t < 0.35, `took ${t.toFixed(3)}s`);
});

test('ground friction stops the player quickly when input is released', () => {
  const s = newPlayerState();
  run(s, { ...idle, moveZ: 1 }, 1);
  let t = 0;
  while (hs(s) > 0.05 && t < 2) { stepPlayer(s, idle, DT, flat()); t += DT; }
  assert.ok(t < 0.5, `stopped in ${t.toFixed(3)}s`);
});

test('diagonal input is not faster than straight input', () => {
  const s = newPlayerState();
  run(s, { ...idle, moveX: 1, moveZ: 1 }, 1);
  assert.ok(hs(s) <= C.sprintSpeed + 0.05, `${hs(s)}`);
});

test('jump apex matches v^2 / 2g and the player lands back on the ground', () => {
  const s = newPlayerState();
  stepPlayer(s, { ...idle, jumpPressed: true }, DT, flat());
  let apex = 0, steps = 0;
  while (!s.grounded && steps++ < 2000) { stepPlayer(s, idle, DT, flat()); apex = Math.max(apex, s.pos[1]); }
  const expected = (C.jumpSpeed ** 2) / (2 * C.gravity);
  assert.ok(Math.abs(apex - expected) < 0.05, `apex ${apex} expected ${expected}`);
  assert.ok(s.grounded && s.pos[1] === 0);
});

test('jump buffer: pressing jump shortly before landing jumps on landing', () => {
  const s = newPlayerState([0, 1.0, 0]); s.grounded = false;
  let landedAt = null, jumpedAt = null, t = 0;
  while (t < 1.5) {
    const timeToLand = Math.sqrt(2 * 1.0 / C.gravity);
    const press = t >= timeToLand - 0.06 && t < timeToLand - 0.05; // single-tick press 60 ms before landing
    const wasGrounded = s.grounded;
    stepPlayer(s, { ...idle, jumpPressed: press }, DT, flat());
    if (!wasGrounded && s.vel[1] > 1 && jumpedAt === null && t > timeToLand - 0.06) jumpedAt = t;
    if (s.grounded && landedAt === null) landedAt = t;
    t += DT;
  }
  assert.ok(jumpedAt !== null, 'buffered jump fired');
  assert.ok(jumpedAt - (Math.sqrt(2 / C.gravity)) < 0.05, 'fires at (or within a tick of) landing');
});

test('jump buffer expires: a press 200 ms before landing is ignored', () => {
  const s = newPlayerState([0, 2.0, 0]); s.grounded = false;
  const tl = Math.sqrt(2 * 2.0 / C.gravity);
  let t = 0, jumped = false;
  while (t < tl + 0.3) {
    stepPlayer(s, { ...idle, jumpPressed: t >= tl - 0.2 && t < tl - 0.19 }, DT, flat());
    if (s.grounded === false && s.vel[1] > 2 && t > tl) jumped = true;
    t += DT;
  }
  assert.equal(jumped, false);
});

function walkOffLedge() {
  const world = { groundY: 0, boxes: [box(-5, -1, -30, 5, 1, 0)] }; // 1 m high platform ending at z = 0, running toward +z
  const s = newPlayerState([0, 1.0, -3]);
  s.grounded = true;
  let guard = 0;
  while (s.grounded && guard++ < 2000) stepPlayer(s, { ...idle, moveZ: -1 /* back toward +z needs yaw */, yaw: Math.PI }, DT, world);
  return { s, world };
}

test('coyote time: a jump shortly after walking off a ledge still works, a late one does not', () => {
  const early = walkOffLedge();
  assert.equal(early.s.grounded, false, 'player left the ledge');
  run(early.s, idle, 0.04, early.world);
  stepPlayer(early.s, { ...idle, jumpPressed: true }, DT, early.world);
  assert.ok(early.s.vel[1] > 3, `jump fired within the coyote window, vy ${early.s.vel[1]}`);

  const late = walkOffLedge();
  run(late.s, idle, 0.2, late.world);
  const vyBefore = late.s.vel[1];
  stepPlayer(late.s, { ...idle, jumpPressed: true }, DT, late.world);
  assert.ok(late.s.vel[1] <= vyBefore, 'no air jump after the window');
});

test('air strafing: turning while strafing gains speed; holding forward or a fixed strafe does not exceed the air cap', () => {
  const mk = () => { const s = newPlayerState([0, 50, 0]); s.grounded = false; s.vel = [0, 0, -C.walkSpeed]; return s; };
  const b = mk(); run(b, { ...idle, moveZ: 1 }, 0.4);
  assert.ok(hs(b) <= C.walkSpeed + 0.01, `forward speed ${hs(b)}`);

  const fixed = mk(); run(fixed, { ...idle, moveX: 1 }, 0.6);
  assert.ok(hs(fixed) <= Math.hypot(C.walkSpeed, C.airCap) + 0.05, `fixed strafe speed ${hs(fixed)}`);

  const turned = mk();
  for (let i = 0; i < Math.round(0.8 / DT); i++) {
    const sp = hs(turned), px = -turned.vel[2] / sp, pz = turned.vel[0] / sp; // unit vector perpendicular to velocity
    stepPlayer(turned, { ...idle, moveX: 1, yaw: Math.atan2(-pz, px) }, DT, mk.world || { groundY: 0, boxes: [] });
  }
  assert.ok(hs(turned) > C.walkSpeed + 0.5, `mouse-turned strafe speed ${hs(turned)}`);
});

test('airborne horizontal input has limited authority compared with ground', () => {
  const g = newPlayerState(); run(g, { ...idle, moveZ: 1 }, 0.1);
  const a = newPlayerState([0, 5, 0]); a.grounded = false; run(a, { ...idle, moveZ: 1 }, 0.1);
  assert.ok(hs(g) > hs(a) * 3);
});

test('momentum is preserved through a jump but bunny-hop speed gain is capped when bhop is off', () => {
  const s = newPlayerState(); run(s, { ...idle, moveZ: 1 }, 1);
  const before = hs(s);
  stepPlayer(s, { ...idle, moveZ: 1, jumpPressed: true }, DT, flat());
  assert.ok(hs(s) >= before - 0.01, 'no speed loss on takeoff');
  assert.ok(hs(s) <= C.sprintSpeed * C.momentumCap + 0.01);
});

test('slide: boosts sprint speed, then decays more slowly than normal friction, then ends', () => {
  const s = newPlayerState(); run(s, { ...idle, moveZ: 1 }, 1);
  const v0 = hs(s);
  stepPlayer(s, { ...idle, moveZ: 1, crouch: true, crouchPressed: true }, DT, flat());
  assert.ok(s.sliding);
  assert.ok(hs(s) > v0, 'slide boost');
  const dist0 = s.pos[2];
  run(s, { ...idle, crouch: true }, 0.5);
  assert.ok(hs(s) > 3, `still carrying speed after 0.5 s: ${hs(s)}`);
  assert.ok(Math.abs(s.pos[2] - dist0) > 2.5, 'covered real distance while sliding');
  run(s, { ...idle, crouch: true }, 1.5);
  assert.equal(s.sliding, false, 'slide ends');
});

test('slide cannot start below the minimum speed', () => {
  const s = newPlayerState(); run(s, { ...idle, moveZ: 1, sprint: false }, 0.5);
  assert.ok(hs(s) < C.slideMinSpeed + 0.01);
  stepPlayer(s, { ...idle, crouch: true, crouchPressed: true }, DT, flat());
  assert.equal(s.sliding, false);
});

test('crouch lowers speed and standing is blocked by a low ceiling', () => {
  const world = { groundY: 0, boxes: [box(-5, 1.3, -5, 5, 2, 5)] }; // ceiling at 1.3 m: crouch fits (1.2), stand (1.8) does not
  const s = newPlayerState();
  run(s, { ...idle, crouch: true, moveZ: 1 }, 0.8, world);
  assert.ok(s.crouched);
  assert.ok(hs(s) <= C.crouchSpeed + 0.05);
  run(s, { ...idle, crouch: false }, 0.2, world);
  assert.ok(s.crouched, 'still crouched under the ceiling');
  const open = newPlayerState(); run(open, { ...idle, crouch: true }, 0.2); run(open, idle, 0.2);
  assert.equal(open.crouched, false);
});

test('solid pieces block movement and the player cannot tunnel at sprint speed', () => {
  const world = { groundY: 0, boxes: [box(-3, 0, -5.12, 3, 3.84, -4.88)] };
  const s = newPlayerState();
  run(s, { ...idle, moveZ: 1 }, 3, world);
  assert.ok(s.pos[2] > -4.88 + C.halfWidth - 1e-3, `z ${s.pos[2]}`);
  assert.ok(hs(s) < 0.2);
});

test('walking up stair-sized steps works; a 1 m ledge does not', () => {
  const steps = [];
  for (let i = 0; i < 8; i++) steps.push(box(-1, 0, -(i + 1) * 0.64, 1, (i + 1) * 0.48, -i * 0.64)); // 0.48 m risers
  const s = newPlayerState([0, 0, 0.5]);
  let peak = 0;
  for (let i = 0; i < Math.round(1.0 / DT); i++) { stepPlayer(s, { ...idle, moveZ: 1 }, DT, { groundY: 0, boxes: steps }); peak = Math.max(peak, s.pos[1]); }
  assert.ok(peak > 3.8, `climbed to ${peak} (top step is 3.84 m)`);

  const ledge = newPlayerState([0, 0, 2]);
  run(ledge, { ...idle, moveZ: 1 }, 1.5, { groundY: 0, boxes: [box(-2, 0, -3, 2, 1.0, 0)] });
  assert.ok(ledge.pos[1] < 0.01 && ledge.pos[2] >= 0.3 - 1e-3 + 0 - 0.05, `blocked at ${ledge.pos}`);
});

test('determinism: identical inputs give identical state (needed for prediction and reconciliation)', () => {
  const seq = [];
  for (let i = 0; i < 600; i++) seq.push({ ...idle, moveZ: i % 200 < 150 ? 1 : 0, moveX: i % 90 < 30 ? 1 : 0, jumpPressed: i % 137 === 0, crouch: i % 211 < 20, crouchPressed: i % 211 === 0, yaw: i * 0.01 });
  const a = newPlayerState(), b = newPlayerState();
  for (const inp of seq) { stepPlayer(a, { ...inp }, DT, flat()); stepPlayer(b, { ...inp }, DT, flat()); }
  assert.deepEqual(a, b);
});

test('movement collides with the real build world (a built wall stops the player, a window edit does not stop a thrown-through ray but still blocks body)', async () => {
  const { BuildWorld } = await import('../src/shared/build.js');
  const w = new BuildWorld();
  const p = { id: 'a', style: 'competitive', mats: { wood: 99, brick: 0, metal: 0 } };
  w.place(p, { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 }, 0);
  const s = newPlayerState([2.5, 0, 3]);
  run(s, { ...idle, moveZ: 1 }, 2, w);
  assert.ok(s.pos[2] > 0.3 - 0.01, `stopped at ${s.pos[2]}`);
});
