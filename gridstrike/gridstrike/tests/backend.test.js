import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, tx } from '../backend/lib/db.js';
import * as auth from '../backend/lib/auth.js';
import * as eco from '../backend/lib/economy.js';
import { rotation, CATALOG } from '../backend/lib/catalog.js';
import { DEFAULTS } from '../backend/config.js';
import { simulate } from '../backend/lib/netsim.js';
import { createApp } from '../backend/server.js';

const cfg = DEFAULTS;
const mkUser = (db, name = 'alice') => { const id = auth.register(db, { username: name, password: 'correct horse' }); eco.grantStarterItems(db, id); return id; };
const bolts = (db, id) => db.prepare('SELECT bolts FROM users WHERE id = ?').get(id).bolts;

test('passwords are hashed (never plaintext), verify correctly, and bad input is rejected', () => {
  const db = openDb();
  const id = mkUser(db);
  const row = db.prepare('SELECT pw_hash FROM users WHERE id = ?').get(id);
  assert.ok(row.pw_hash.startsWith('scrypt$') && !row.pw_hash.includes('correct horse'));
  assert.ok(auth.verifyPassword('correct horse', row.pw_hash));
  assert.equal(auth.verifyPassword('wrong', row.pw_hash), false);
  assert.throws(() => auth.register(db, { username: 'a', password: 'correct horse' }), /Username/);
  assert.throws(() => auth.register(db, { username: "bob'; DROP TABLE users;--", password: 'correct horse' }), /Username/);
  assert.throws(() => auth.register(db, { username: 'ALICE', password: 'correct horse' }), /taken/, 'case-insensitive unique');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, 1);
});

test('sessions: tokens are stored hashed, expire, and logout invalidates them', () => {
  const db = openDb();
  const id = mkUser(db);
  const { token } = auth.login(db, { username: 'alice', password: 'correct horse' });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sessions WHERE token_hash = ?').get(token).c, 0, 'raw token is not stored');
  assert.equal(auth.userFromToken(db, token).id, id);
  assert.equal(auth.userFromToken(db, 'x'.repeat(43)), null);
  auth.logout(db, token);
  assert.equal(auth.userFromToken(db, token), null);
  const t2 = auth.issueSession(db, id, -1);
  assert.equal(auth.userFromToken(db, t2), null, 'expired');
  assert.throws(() => auth.login(db, { username: 'alice', password: 'nope' }), /Wrong/);
  assert.throws(() => auth.login(db, { username: 'ghost', password: 'nope' }), /Wrong/, 'same error for unknown user');
});

test('rewards: 5 per elimination, 25 per win, streak bonus, idempotent per match id', () => {
  const db = openDb();
  const a = mkUser(db, 'alice'), b = mkUser(db, 'bobby');
  const r = eco.awardMatch(db, cfg, 'm1', [{ userId: a, eliminations: 10, won: true }, { userId: b, eliminations: 3, won: false }], 1000);
  assert.equal(bolts(db, a), 10 * 5 + 25 + 10, 'elims + win + multi-elim bonus');
  assert.equal(bolts(db, b), 3 * 5);
  assert.equal(r.awards.length, 2);
  const again = eco.awardMatch(db, cfg, 'm1', [{ userId: a, eliminations: 10, won: true }], 2000);
  assert.equal(again.duplicate, true);
  assert.equal(bolts(db, a), 85, 'replaying a match pays nothing');
  const u = db.prepare('SELECT wins, eliminations, matches, xp FROM users WHERE id = ?').get(a);
  assert.deepEqual({ wins: u.wins, eliminations: u.eliminations, matches: u.matches }, { wins: 1, eliminations: 10, matches: 1 });
  assert.ok(u.xp > 0);
});

test('rewards are admin-configurable', () => {
  const db = openDb(); const a = mkUser(db);
  const custom = { ...cfg, rewards: { ...cfg.rewards, perElimination: 7, perWin: 100, multiElim: null } };
  eco.awardMatch(db, custom, 'mx', [{ userId: a, eliminations: 2, won: true }]);
  assert.equal(bolts(db, a), 114);
});

test('daily login reward can be claimed once per UTC day', () => {
  const db = openDb(); const a = mkUser(db);
  const day1 = Date.UTC(2026, 0, 5, 12);
  eco.claimDaily(db, cfg, a, day1);
  assert.throws(() => eco.claimDaily(db, cfg, a, day1 + 3600e3), /already/);
  eco.claimDaily(db, cfg, a, day1 + 864e5);
  assert.equal(bolts(db, a), 40);
});

test('store: rotation is deterministic and daily; purchases need balance, a stocked item, and are atomic', () => {
  const t = Date.UTC(2026, 5, 1, 3);
  const r1 = rotation(t), r2 = rotation(t + 3600e3), r3 = rotation(t + 864e5);
  assert.deepEqual(r1, r2, 'same day, same shop');
  assert.notDeepEqual([r1.featured, r1.daily], [r3.featured, r3.daily], 'next day rotates');
  assert.equal(r1.featured.length + r1.daily.length, 6);

  const db = openDb(); const a = mkUser(db);
  const stocked = CATALOG.find((i) => r1.daily.includes(i.id));
  const absent = CATALOG.find((i) => i.rotating && !r1.daily.includes(i.id) && !r1.featured.includes(i.id));
  assert.throws(() => eco.purchase(db, cfg, a, stocked.id, t), /Not enough/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM inventory WHERE user_id = ?').get(a).c, 2, 'failed purchase grants nothing');
  db.prepare('UPDATE users SET bolts = 5000 WHERE id = ?').run(a);
  assert.throws(() => eco.purchase(db, cfg, a, absent.id, t), /not in the STORE/);
  const res = eco.purchase(db, cfg, a, stocked.id, t);
  assert.equal(res.balance, 5000 - stocked.price);
  assert.throws(() => eco.purchase(db, cfg, a, stocked.id, t), /already own/);
  assert.throws(() => eco.purchase(db, cfg, a, 'outfit_rookie', t), /not_for_sale|Not/);
  assert.throws(() => eco.purchase(db, cfg, a, 'nope', t), /Unknown/);
  assert.equal(bolts(db, a), 5000 - stocked.price);
});

test('ledger: every balance change has a row and the rows add up to the balance', () => {
  const db = openDb(); const a = mkUser(db);
  const t = Date.UTC(2026, 5, 1);
  eco.awardMatch(db, cfg, 'm9', [{ userId: a, eliminations: 20, won: true }], t);
  eco.claimDaily(db, cfg, a, t);
  tx(db, () => eco.credit(db, a, 5000, 'admin_grant', 'test', t)); // goes through the ledger like every other change
  const item = CATALOG.find((i) => rotation(t).daily.includes(i.id));
  eco.purchase(db, cfg, a, item.id, t);
  const sum = db.prepare('SELECT SUM(delta) s FROM transactions WHERE user_id = ?').get(a).s;
  assert.equal(sum, bolts(db, a));
  assert.ok(eco.ledger(db, a).length >= 3);
});

test('database refuses a negative balance even if code tried to set one', () => {
  const db = openDb(); const a = mkUser(db);
  assert.throws(() => db.prepare('UPDATE users SET bolts = -5 WHERE id = ?').run(a));
});

test('equip requires ownership and puts the item in its slot', () => {
  const db = openDb(); const a = mkUser(db);
  assert.throws(() => eco.equip(db, a, 'outfit_prism'), /do not own/);
  db.prepare("INSERT INTO inventory VALUES (?, 'outfit_circuit', 0)").run(a);
  eco.equip(db, a, 'outfit_circuit');
  assert.equal(eco.profile(db, a).equipped.outfit, 'outfit_circuit');
});

test('rate limiter blocks bursts and refills over time', () => {
  const lim = auth.makeLimiter(3);
  assert.deepEqual([lim('k', 0), lim('k', 0), lim('k', 0), lim('k', 0)], [true, true, true, false]);
  assert.equal(lim('k', 21000), true, 'one token per 20 s at 3/min');
  assert.equal(lim('other', 0), true);
});

test('network simulation really delays, drops and jitters outgoing packets', async () => {
  const got = [];
  const t0 = performance.now();
  const s = simulate((m) => got.push([m, performance.now() - t0]), { latencyMs: 80 });
  s('a'); assert.equal(got.length, 0, 'not delivered immediately');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(got.length, 1);
  assert.ok(got[0][1] >= 75, `delivered after ${got[0][1].toFixed(0)} ms`);
  const dropped = []; simulate((m) => dropped.push(m), { loss: 1 })('x'); await new Promise((r) => setTimeout(r, 10));
  assert.equal(dropped.length, 0);
  assert.equal(simulate(got.push, {}), got.push, 'zero settings add no overhead');
  const delays = [];
  let n = 0; const rng = () => [0, 1, 0.5][n++ % 3];
  simulate(() => {}, { latencyMs: 100, jitterMs: 20, rng, setT: (f, d) => delays.push(d) })('a');
  simulate(() => {}, { latencyMs: 100, jitterMs: 20, rng, setT: (f, d) => delays.push(d) })('b');
  assert.ok(delays.every((d) => d >= 80 && d <= 120));
});

// ---------- end-to-end over real HTTP + WebSocket ----------
async function boot(extra = {}) {
  const db = openDb();
  const app = createApp({ db, cfg: { ...cfg, limits: { ...cfg.limits, authPerMinute: 1000, apiPerMinute: 10000 } }, ...extra });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path, { method = 'GET', body, token } = {}) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { db, app, base, call, done: () => app.close() };
}

test('HTTP API: register, login, me, secured routes, health, no secret file leakage', async () => {
  const s = await boot();
  try {
    assert.equal((await s.call('/api/health')).json.ok, true);
    assert.equal((await s.call('/api/me')).status, 401);
    const reg = await s.call('/api/register', { method: 'POST', body: { username: 'player_one', password: 'longpassword' } });
    assert.equal(reg.status, 201);
    assert.equal((await s.call('/api/register', { method: 'POST', body: { username: 'player_one', password: 'longpassword' } })).status, 409);
    const me = await s.call('/api/me', { token: reg.json.token });
    assert.equal(me.json.username, 'player_one');
    assert.equal(me.json.bolts, 0);
    assert.ok(me.json.inventory.includes('outfit_rookie'));
    assert.equal(JSON.stringify(me.json).includes('pw_hash'), false);
    const lg = await s.call('/api/login', { method: 'POST', body: { username: 'player_one', password: 'longpassword' } });
    assert.equal(lg.status, 200);
    assert.equal((await s.call('/api/login', { method: 'POST', body: { username: 'player_one', password: 'bad' } })).status, 401);
    for (const p of ['/backend/server.js', '/data/gridstrike.db', '/.env', '/../package.json', '/%2e%2e/package.json']) {
      const r = await fetch(s.base + p); assert.equal(r.status, 404, p);
    }
    assert.equal((await fetch(s.base + '/client/index.html')).status, 200);
    assert.equal((await fetch(s.base + '/src/shared/build.js')).status, 200);
    const big = await fetch(s.base + '/api/login', { method: 'POST', body: 'x'.repeat(40000) }).catch(() => ({ status: 413 }));
    assert.ok([413, 400].includes(big.status));
  } finally { s.done(); }
});

test('client cannot set currency or claim ownership: no HTTP route accepts a balance, and purchase checks the server', async () => {
  const s = await boot();
  try {
    const reg = await s.call('/api/register', { method: 'POST', body: { username: 'cheater', password: 'longpassword' } });
    const token = reg.json.token;
    for (const path of ['/api/me', '/api/settings']) {
      const r = await s.call(path, { method: 'PUT', token, body: { bolts: 999999 } });
      assert.ok([404, 200].includes(r.status));
    }
    assert.equal((await s.call('/api/me', { token })).json.bolts, 0, 'stuffing bolts into settings changes nothing');
    const buy = await s.call('/api/store/purchase', { method: 'POST', token, body: { itemId: 'outfit_prism', price: 0, bolts: 99999 } });
    assert.ok(buy.status >= 400, JSON.stringify(buy.json));
    assert.equal((await s.call('/api/wardrobe/equip', { method: 'POST', token, body: { itemId: 'outfit_prism' } })).status, 403);
    const daily = await s.call('/api/daily', { method: 'POST', token });
    assert.equal(daily.status, 200);
    assert.equal((await s.call('/api/daily', { method: 'POST', token })).status, 409);
    assert.equal((await s.call('/api/me', { token })).json.bolts, 20);
  } finally { s.done(); }
});

const wsClient = (base) => new Promise((resolve, reject) => {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const inbox = []; const waiters = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const w = waiters.findIndex((x) => x.pred(m)); if (w >= 0) waiters.splice(w, 1)[0].res(m); else inbox.push(m); };
  const api = {
    ws, inbox,
    send: (o) => ws.send(JSON.stringify(o)),
    next: (pred = () => true, ms = 2000) => new Promise((res, rej) => {
      const i = inbox.findIndex(pred); if (i >= 0) return res(inbox.splice(i, 1)[0]);
      const w = { pred, res }; waiters.push(w); setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); rej(new Error('timeout; waiting for ' + String(pred) + ' inbox=' + JSON.stringify(inbox))); } }, ms);
    }),
    closed: new Promise((r) => { ws.onclose = (e) => r(e.code); }),
  };
  ws.onopen = () => resolve(api); ws.onerror = reject;
});

test('WebSocket: must authenticate; two players share one authoritative build world; ownership is enforced', async () => {
  const s = await boot();
  try {
    const tok = async (n) => (await s.call('/api/register', { method: 'POST', body: { username: n, password: 'longpassword' } })).json.token;
    const [ta, tb] = [await tok('alpha'), await tok('bravo')];

    const anon = await wsClient(s.base);
    anon.send({ t: 'place', req: {} });
    assert.equal(await anon.closed, 4001, 'unauthenticated sockets are closed');

    const a = await wsClient(s.base), b = await wsClient(s.base);
    a.send({ t: 'auth', token: ta, room: 'r1', style: 'competitive' });
    const ja = await a.next((m) => m.t === 'joined');
    b.send({ t: 'auth', token: tb, room: 'r1', style: 'classic' });
    await b.next((m) => m.t === 'joined');

    a.send({ t: 'place', seq: 1, req: { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 } });
    const placedB = await b.next((m) => m.t === 'place');
    assert.equal(placedB.piece.owner, ja.you);
    assert.equal(placedB.piece.type, 'wall');
    await a.next((m) => m.t === 'place');

    b.send({ t: 'edit', seq: 2, key: placedB.piece.key, removed: [4] });
    assert.equal((await b.next((m) => m.t === 'rej')).reason, 'notOwner');

    a.send({ t: 'edit', seq: 3, key: placedB.piece.key, removed: [4] });
    const ed = await b.next((m) => m.t === 'edit');
    assert.equal(ed.state.mask, 0b111101111);

    a.send({ t: 'edit', seq: 4, key: placedB.piece.key, removed: [99] });
    assert.equal((await a.next((m) => m.t === 'rej')).reason, 'badRequest');
    await new Promise((r) => setTimeout(r, 80)); // let the 0.05 s competitive build gap pass
    a.send({ t: 'place', seq: 5, req: { type: 'floor', gx: 500, gl: 9, gz: 0 } });
    assert.equal((await a.next((m) => m.t === 'rej')).reason, 'unsupported');
    a.send({ t: 'place', seq: 6, req: { type: 'sphere', gx: 0, gl: 0, gz: 0 } });
    assert.equal((await a.next((m) => m.t === 'rej')).reason, 'badRequest');

    a.send({ t: 'reset', seq: 7, key: placedB.piece.key });
    assert.equal((await b.next((m) => m.t === 'edit')).state.mask, 0b111111111);

    a.send({ t: 'ping', ts: 123 });
    assert.equal((await a.next((m) => m.t === 'pong')).ts, 123);

    const late = await wsClient(s.base);
    late.send({ t: 'auth', token: tb, room: 'r1' });
    const snap = await late.next((m) => m.t === 'joined');
    assert.equal(snap.pieces.length, 1, 'late joiner receives the current world');
    assert.equal(await b.closed, 4000, 'second connection for the same account replaces the first');
    a.ws.close(); late.ws.close();
  } finally { s.done(); }
});

test('WebSocket: contested wall replacement is resolved by the server tick, not by arrival order', async () => {
  let clock = 0;
  const s = await boot();
  try {
    const room = s.app.rooms.get('dm');
    room.now = () => clock;
    const mk = async (n) => { const t = (await s.call('/api/register', { method: 'POST', body: { username: n, password: 'longpassword' } })).json.token; const c = await wsClient(s.base); c.send({ t: 'auth', token: t, room: 'dm', style: 'competitive' }); await c.next((m) => m.t === 'joined'); return c; };
    const [a, b, c] = [await mk('play_a'), await mk('play_b'), await mk('play_c')];
    const req = { type: 'wall', gx: 0, gl: 0, gz: 0, o: 0 };
    a.send({ t: 'place', seq: 1, req }); const placed = await a.next((m) => m.t === 'place');
    room.world.destroy(placed.piece.key, clock = 1.0);
    clock = 1.02; b.send({ t: 'place', seq: 2, req }); await b.next((m) => m.t === 'pending');
    clock = 1.10; c.send({ t: 'place', seq: 3, req }); await c.next((m) => m.t === 'pending');
    assert.equal(room.world.pieces.size, 0);
    clock = 1.20; room.tick();
    const rep = await a.next((m) => m.t === 'place' && m.replaced);
    assert.ok(['u2', 'u3'].includes(rep.piece.owner) && rep.piece.owner !== 'u1');
    [a, b, c].forEach((x) => x.ws.close());
  } finally { s.done(); }
});

test('WebSocket: bad JSON and message floods get the socket closed', async () => {
  const s = await boot();
  try {
    const t = (await s.call('/api/register', { method: 'POST', body: { username: 'flood', password: 'longpassword' } })).json.token;
    const c = await wsClient(s.base);
    c.send({ t: 'auth', token: t }); await c.next((m) => m.t === 'joined');
    for (let i = 0; i < 200; i++) c.send({ t: 'ping', ts: i });
    assert.equal(await c.closed, 4008);
    const d = await wsClient(s.base); d.ws.send('not json'); assert.equal(await d.closed, 1003);
  } finally { s.done(); }
});
