// Deterministic fixed-step character movement. Same code is meant to run on client (prediction) and server (authority).
import { GAME } from '../../config/game.js';

const EPS = 1e-4;

export const newPlayerState = (pos = [0, 0, 0]) => ({
  pos: [...pos], vel: [0, 0, 0],
  grounded: true, crouched: false, sliding: false, slideT: 0,
  jumpBufferT: 0, coyoteT: 0, crouchHeld: false,
});

const hullH = (s, cfg) => (s.crouched ? cfg.heightCrouch : cfg.heightStand);

const overlaps = (p, hw, h, b) =>
  p[0] + hw > b.min[0] && p[0] - hw < b.max[0] &&
  p[1] + h > b.min[1] && p[1] < b.max[1] &&
  p[2] + hw > b.min[2] && p[2] - hw < b.max[2];

function boxesFor(world, p, hw, h, pad = 1.5) {
  const q = { min: [p[0] - hw - pad, p[1] - pad, p[2] - hw - pad], max: [p[0] + hw + pad, p[1] + h + pad, p[2] + hw + pad] };
  if (typeof world.nearbyBoxes === 'function') return world.nearbyBoxes(q);
  return world.boxes || [];
}

function blocked(p, hw, h, boxes) {
  for (const b of boxes) if (overlaps(p, hw, h, b)) return true;
  return false;
}

function moveAxis(p, axis, d, hw, h, boxes, groundY) {
  p[axis] += d;
  let hit = false;
  for (const b of boxes) {
    if (!overlaps(p, hw, h, b)) continue;
    hit = true;
    const ext = axis === 1 ? h : hw;
    if (d > 0) p[axis] = b.min[axis] - ext - EPS;
    else p[axis] = b.max[axis] + (axis === 1 ? 0 : hw) + EPS;
  }
  if (axis === 1 && p[1] < groundY) { p[1] = groundY; hit = true; }
  return hit;
}

const hspeed = (v) => Math.hypot(v[0], v[2]);

function friction(vel, f, stop, dt) {
  const s = hspeed(vel);
  if (s < 1e-6) { vel[0] = vel[2] = 0; return; }
  const drop = Math.max(s, stop) * f * dt;
  const k = Math.max(0, s - drop) / s;
  vel[0] *= k; vel[2] *= k;
}

function accelerate(vel, wish, wishSpeed, accel, dt) {
  const cur = vel[0] * wish[0] + vel[2] * wish[2];
  const add = wishSpeed - cur;
  if (add <= 0) return;
  const a = Math.min(accel * wishSpeed * dt, add);
  vel[0] += wish[0] * a; vel[2] += wish[2] * a;
}

/**
 * Advance one tick.
 * input: { moveX, moveZ (+1 = forward), yaw, jumpPressed, crouch, crouchPressed, sprint }
 */
export function stepPlayer(s, input, dt, world, cfg = GAME.move, rules = GAME.moveRules) {
  const sinY = Math.sin(input.yaw || 0), cosY = Math.cos(input.yaw || 0);
  const fwd = [-sinY, 0, -cosY], right = [cosY, 0, -sinY];
  const wx = right[0] * (input.moveX || 0) + fwd[0] * (input.moveZ || 0);
  const wz = right[2] * (input.moveX || 0) + fwd[2] * (input.moveZ || 0);
  const wl = Math.hypot(wx, wz);
  const hasInput = wl > 1e-6;
  const wishDir = hasInput ? [wx / wl, 0, wz / wl] : [0, 0, 0]; // unit vector; magnitude handled by wishMag
  const wishMag = Math.min(1, wl);
  const groundY = world.groundY ?? 0;
  const hw = cfg.halfWidth;

  // timers
  s.jumpBufferT = input.jumpPressed ? cfg.jumpBuffer : Math.max(0, s.jumpBufferT - dt);
  s.coyoteT = s.grounded ? cfg.coyoteTime : Math.max(0, s.coyoteT - dt);

  // slide start
  if (s.grounded && input.crouchPressed && !s.sliding && hspeed(s.vel) >= cfg.slideMinSpeed) {
    s.sliding = true; s.slideT = 0;
    const cap = cfg.sprintSpeed * cfg.slideBoost * 1.02;
    const sp = hspeed(s.vel), nsp = Math.min(sp * cfg.slideBoost, Math.max(cap, sp));
    s.vel[0] *= nsp / sp; s.vel[2] *= nsp / sp;
  }
  if (s.sliding) {
    s.slideT += dt;
    if (!input.crouch || s.slideT > cfg.slideMaxTime || hspeed(s.vel) < cfg.slideEndSpeed || !s.grounded) s.sliding = false;
  }

  // crouch / stand (standing blocked by ceiling keeps you crouched)
  const wantCrouch = input.crouch || s.sliding;
  if (wantCrouch) s.crouched = true;
  else if (s.crouched) {
    const boxes = boxesFor(world, s.pos, hw, cfg.heightStand);
    if (!blocked(s.pos, hw, cfg.heightStand, boxes)) s.crouched = false;
  }

  const maxSpeed = s.crouched ? cfg.crouchSpeed : (input.sprint ? cfg.sprintSpeed : cfg.walkSpeed);
  let skipFriction = false;

  // jump
  if (s.jumpBufferT > 0 && (s.grounded || s.coyoteT > 0) && !(s.crouched && !s.sliding && wantCrouch && false)) {
    s.vel[1] = cfg.jumpSpeed;
    s.grounded = false; s.coyoteT = 0; s.jumpBufferT = 0; s.sliding = false;
    skipFriction = true; // landing-frame friction is skipped so momentum carries into the jump
    if (!rules.bhop) {
      const cap = cfg.sprintSpeed * cfg.momentumCap, sp = hspeed(s.vel);
      if (sp > cap) { s.vel[0] *= cap / sp; s.vel[2] *= cap / sp; }
    }
  }

  if (s.grounded && !skipFriction) {
    if (s.sliding) {
      friction(s.vel, cfg.slideFriction, cfg.stopSpeed, dt);
      if (hasInput) accelerate(s.vel, wishDir, cfg.slideEndSpeed, cfg.slideSteer, dt);
    } else {
      friction(s.vel, cfg.friction, cfg.stopSpeed, dt);
      if (hasInput) accelerate(s.vel, wishDir, maxSpeed * wishMag, cfg.groundAccel, dt);
    }
  } else if (!s.grounded) {
    s.vel[1] -= cfg.gravity * dt;
    if (hasInput && rules.airStrafe) accelerate(s.vel, wishDir, Math.min(maxSpeed, cfg.airCap) * wishMag, cfg.airAccel, dt);
  }

  // integrate: horizontal (with step-up), then vertical
  const h = hullH(s, cfg);
  const p0 = [...s.pos];
  const boxes = boxesFor(world, s.pos, hw, h, 2 + hspeed(s.vel) * dt);
  const moveH = (p) => {
    const hx = moveAxis(p, 0, s.vel[0] * dt, hw, h, boxes, groundY);
    const hz = moveAxis(p, 2, s.vel[2] * dt, hw, h, boxes, groundY);
    return hx || hz;
  };
  const p = [...p0];
  let hitH = moveH(p);
  let stepped = false;
  if (hitH && s.grounded && s.vel[1] <= 0) {
    const q = [...p0]; q[1] += cfg.stepHeight;
    if (!blocked(q, hw, h, boxes)) {
      moveH(q);
      moveAxis(q, 1, -(cfg.stepHeight + 0.01), hw, h, boxes, groundY);
      const gain = Math.hypot(q[0] - p0[0], q[2] - p0[2]) - Math.hypot(p[0] - p0[0], p[2] - p0[2]);
      if (gain > 1e-3 && q[1] - p0[1] <= cfg.stepHeight + 1e-3) { p[0] = q[0]; p[1] = q[1]; p[2] = q[2]; stepped = true; }
    }
  }
  if (hitH && !stepped) { /* wall contact: velocity into the wall is dropped below */ }
  const vHit = moveAxis(p, 1, s.vel[1] * dt, hw, h, boxes, groundY);
  if (vHit) s.vel[1] = 0;

  // zero velocity components that were blocked
  if (Math.abs(p[0] - (p0[0] + s.vel[0] * dt)) > 1e-6 && !stepped) s.vel[0] = 0;
  if (Math.abs(p[2] - (p0[2] + s.vel[2] * dt)) > 1e-6 && !stepped) s.vel[2] = 0;

  s.pos = p;

  // ground probe
  const probe = [p[0], p[1] - 0.02, p[2]];
  s.grounded = s.vel[1] <= 0 && (p[1] <= groundY + 1e-3 || blocked(probe, hw, h, boxes));
  if (s.grounded) s.vel[1] = 0;
  return s;
}
