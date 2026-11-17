// Minimal Build Lab client. All gameplay rules come from src/shared (the same code the tests exercise).
// Rendering here is placeholder geometry; this file has NOT been exercised in a browser yet (see IMPLEMENTATION_STATUS.md).
import * as THREE from 'three';
import { NAMES, GAME_TITLE } from '../config/names.js';
import { GAME } from '../config/game.js';
import { BuildWorld, MODULES } from '../src/shared/build.js';
import { EditSession, EditInput } from '../src/shared/edit.js';
import { stepPlayer, newPlayerState } from '../src/shared/movement.js';
import { snapWall, snapCell, G } from '../src/shared/grid.js';

document.title = `${GAME_TITLE} - ${NAMES.modes.buildLab}`;

// ---- state ------------------------------------------------------------------
const world = new BuildWorld({ seed: 1234 });
const me = { id: 'me', team: 'me', style: 'competitive', mats: { wood: 1e9, brick: 1e9, metal: 1e9 } }; // BUILD LAB: unlimited materials
const styles = Object.keys(GAME.styles);
const player = newPlayerState([0.5 * G, 0, 3 * G]);
let yaw = 0, pitch = -0.25, selected = 'wall', buildHeld = false;
const keys = new Set();
let clock = 0;

const session = new EditSession(world, me.id, GAME.styles[me.style]);
const input = new EditInput(session, { edit: ['key:KeyG', 'wheel:down'], reset: ['key:KeyR', 'wheel:down'] });
const applyStyle = () => {
  session.opts = { ...session.opts, ...GAME.styles[me.style] };
  input.bindings = GAME.styles[me.style].scrollReset
    ? { edit: ['key:KeyG', 'wheel:down'], reset: ['key:KeyR', 'wheel:down'] }
    : { edit: ['key:KeyG'], reset: ['key:KeyR'] };
};
applyStyle();

// ---- three.js ---------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc4e8);
scene.fog = new THREE.Fog(0x9fc4e8, 60, 220);
const camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.1, 400);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(30, 60, 20); scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: 0x6aa36b }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);
scene.add(new THREE.GridHelper(600, 600 / G, 0x2f5f3a, 0x3d7a49));

const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.2, 4, 8), new THREE.MeshLambertMaterial({ color: 0xff7a1a }));
scene.add(body);

const matByOwner = (p) => new THREE.MeshLambertMaterial({ color: p.owner === me.id ? 0xb98a52 : 0xa85050 });
const pieceGroup = new THREE.Group(); scene.add(pieceGroup);
const boxMesh = (b, mat) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]), mat);
  m.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
  return m;
};
function rebuild() {
  pieceGroup.clear();
  for (const p of world.pieces.values()) { const mat = matByOwner(p); for (const b of world.solidsOf(p)) pieceGroup.add(boxMesh(b, mat)); }
}
const ghost = new THREE.Group(); scene.add(ghost);
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.45 });
const editMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.6 });
const setGhost = (boxes, mat) => { ghost.clear(); for (const b of boxes) ghost.add(boxMesh(b, mat)); };

// ---- aiming -----------------------------------------------------------------
function viewDir() { return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)]; }
function camOrigin() {
  const d = viewDir(), eye = [player.pos[0], player.pos[1] + 1.6, player.pos[2]];
  return { eye, cam: [eye[0] - d[0] * 4.2, eye[1] - d[1] * 4.2 + 0.4, eye[2] - d[2] * 4.2] };
}
function aimPoint() {
  const { eye } = camOrigin(), d = viewDir();
  const hit = world.raycast(eye, d, 12);
  let t = hit ? hit.t : 12, key = hit ? hit.key : null;
  if (d[1] < -1e-4) { const tg = -eye[1] / d[1]; if (tg > 0 && tg < t) { t = tg; key = null; } }
  return { pt: [eye[0] + d[0] * t, eye[1] + d[1] * t, eye[2] + d[2] * t], key, t };
}
function placementRequest() {
  const f = [-Math.sin(yaw), -Math.cos(yaw)];
  // build in front of the player, level with their feet
  const px = player.pos[0] + f[0] * 2.2, pz = player.pos[2] + f[1] * 2.2, py = player.pos[1] + 0.1;
  if (selected === 'wall') return { type: 'wall', ...snapWall(px, py, pz), mat: 'wood' };
  const c = snapCell(px, py, pz);
  const dir = Math.round(((-yaw) / (Math.PI / 2)) % 4 + 4) % 4;
  return { type: selected, ...c, dir, mat: 'wood' };
}
function previewPiece() {
  const r = placementRequest();
  return { ...r, o: r.o ?? 0, state: MODULES[r.type].defaultState(), key: 'preview' };
}

// ---- input ------------------------------------------------------------------
const el = renderer.domElement, overlay = document.getElementById('click');
overlay.addEventListener('click', () => el.requestPointerLock());
document.addEventListener('pointerlockchange', () => { overlay.style.display = document.pointerLockElement === el ? 'none' : 'flex'; });
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== el) return;
  const sens = session.active ? 0.0016 : 0.0022; // separate edit / aim sensitivity hook
  yaw -= e.movementX * sens; pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * sens));
});
const SELECT = { KeyQ: 'wall', KeyF: 'floor', KeyC: 'stair', KeyV: 'cone' };
let jumpQueued = false, crouchQueued = false;
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Space') jumpQueued = true;
  if (e.code === 'ControlLeft') crouchQueued = true;
  if (SELECT[e.code]) { selected = SELECT[e.code]; buildHeld = true; }
  if (e.code === 'KeyB') { me.style = styles[(styles.indexOf(me.style) + 1) % styles.length]; applyStyle(); }
  if (e.code === 'KeyX') session.toggleFlip();
  if (e.code === 'Enter') { session.confirm(); rebuild(); }
  if (e.code === 'Escape') session.cancel();
  if (/^Digit[1-9]$/.test(e.code) && session.active) {
    const i = Number(e.code.slice(5)) - 1;
    session.select(i, !session.selection.has(i));
  }
  if (e.code === 'KeyG' || e.code === 'KeyR') { input.setTarget(aimPoint().key); input.handle({ type: 'down', code: e.code }); rebuild(); }
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (SELECT[e.code] && SELECT[e.code] === selected) buildHeld = false;
  if (e.code === 'KeyG') { input.handle({ type: 'up', code: 'KeyG' }); rebuild(); }
});
addEventListener('wheel', (e) => {
  if (document.pointerLockElement !== el) return;
  input.setTarget(aimPoint().key);
  input.handle({ type: 'wheel', code: e.deltaY > 0 ? 'down' : 'up' });
  rebuild();
});
addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== el || e.button !== 0) return;
  if (session.active) return;
  const res = world.place(me, placementRequest(), clock);
  if (res.ok) rebuild();
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

// ---- loop -------------------------------------------------------------------
const DT = 1 / 120;
let acc = 0, last = performance.now(), frames = 0, fps = 0, fpsT = 0;
const stats = document.getElementById('stats');
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; acc += dt;
  while (acc >= DT) {
    const inp = {
      moveX: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      moveZ: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
      yaw, jumpPressed: jumpQueued, crouch: keys.has('ControlLeft'), crouchPressed: crouchQueued, sprint: !keys.has('AltLeft'),
    };
    jumpQueued = crouchQueued = false;
    stepPlayer(player, inp, DT, world);
    clock += DT; acc -= DT;
    world.resolvePending(clock);
  }
  // preview
  if (session.active) setGhost(session.previewSolids(), editMat);
  else if (buildHeld) setGhost(MODULES[selected].solids(previewPiece()), ghostMat);
  else ghost.clear();

  const { cam, eye } = camOrigin();
  camera.position.set(...cam); camera.lookAt(eye[0], eye[1] + 0.2, eye[2]);
  body.position.set(player.pos[0], player.pos[1] + (player.crouched ? 0.6 : 0.9), player.pos[2]);
  renderer.render(scene, camera);

  frames++; fpsT += dt;
  if (fpsT >= 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  stats.textContent = `${fps} FPS | style: ${NAMES.buildStyles[me.style]} | piece: ${NAMES.pieces[selected]} | speed ${Math.hypot(player.vel[0], player.vel[2]).toFixed(1)} m/s${player.sliding ? ' | SLIDE' : ''} | edit: ${session.state}`;
  requestAnimationFrame(tick);
}
rebuild();
requestAnimationFrame(tick);
