// GRIDSTRIKE backend: static files + JSON API + WebSocket game rooms, one Node process, zero npm dependencies.
// Run: node backend/server.js   (reads .env-style variables from the process environment; see .env.example)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDb } from './lib/db.js';
import * as auth from './lib/auth.js';
import * as eco from './lib/economy.js';
import { CATALOG, rotation } from './lib/catalog.js';
import { attachWs } from './lib/ws.js';
import { RoomManager } from './lib/rooms.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const STATIC_ROOTS = ['/client/', '/src/shared/', '/config/']; // only these folders are public; backend/, data/, .env are never served

export function createApp({ db, cfg = loadConfig(), trustProxy = process.env.TRUST_PROXY === '1', now = () => Date.now() } = {}) {
  const authLimit = auth.makeLimiter(cfg.limits.authPerMinute);
  const apiLimit = auth.makeLimiter(cfg.limits.apiPerMinute);
  const rooms = new RoomManager({ netCfg: cfg.net });
  const wsPerIp = new Map();

  const ipOf = (req) => (trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || '?';

  const readJson = (req) => new Promise((ok, bad) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > cfg.limits.maxBodyBytes) { bad(new auth.ApiError(413, 'too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { bad(new auth.ApiError(400, 'bad_json')); } });
    req.on('error', bad);
  });

  const send = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(obj));
  };

  const bearer = (req) => { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7) : null; };
  const needUser = (req) => { const u = auth.userFromToken(db, bearer(req)); if (!u) throw new auth.ApiError(401, 'unauthorized'); return u; };

  async function api(req, res, path) {
    const ip = ipOf(req);
    if (!apiLimit(ip)) throw new auth.ApiError(429, 'rate_limited');
    const m = req.method;
    if (path === '/api/health' && m === 'GET') { db.prepare('SELECT 1').get(); return send(res, 200, { ok: true, uptime: Math.round(process.uptime()), rooms: rooms.rooms.size }); }
    if (path === '/api/register' && m === 'POST') {
      if (!authLimit(`r:${ip}`)) throw new auth.ApiError(429, 'rate_limited');
      const body = await readJson(req);
      const id = auth.register(db, body);
      eco.grantStarterItems(db, id);
      return send(res, 201, { token: auth.issueSession(db, id, cfg.limits.sessionDays), profile: eco.profile(db, id) });
    }
    if (path === '/api/login' && m === 'POST') {
      if (!authLimit(`l:${ip}`)) throw new auth.ApiError(429, 'rate_limited');
      const { token, userId } = auth.login(db, await readJson(req), cfg.limits.sessionDays);
      return send(res, 200, { token, profile: eco.profile(db, userId) });
    }
    const user = needUser(req);
    if (path === '/api/logout' && m === 'POST') { auth.logout(db, bearer(req)); return send(res, 200, { ok: true }); }
    if (path === '/api/me' && m === 'GET') return send(res, 200, eco.profile(db, user.id));
    if (path === '/api/ledger' && m === 'GET') return send(res, 200, { entries: eco.ledger(db, user.id) });
    if (path === '/api/password' && m === 'POST') { const b = await readJson(req); auth.changePassword(db, user.id, b.oldPassword, b.newPassword); return send(res, 200, { ok: true }); }
    if (path === '/api/daily' && m === 'POST') return send(res, 200, eco.claimDaily(db, cfg, user.id, now()));
    if (path === '/api/store' && m === 'GET') {
      const r = rotation(now(), cfg.store);
      const pick = (ids) => ids.map((id) => CATALOG.find((i) => i.id === id));
      return send(res, 200, { featured: pick(r.featured), daily: pick(r.daily), nextRotationAt: r.nextRotationAt, permanent: CATALOG.filter((i) => !i.rotating && !i.starter) });
    }
    if (path === '/api/store/purchase' && m === 'POST') return send(res, 200, eco.purchase(db, cfg, user.id, (await readJson(req)).itemId, now()));
    if (path === '/api/wardrobe/equip' && m === 'POST') return send(res, 200, eco.equip(db, user.id, (await readJson(req)).itemId));
    if (path === '/api/settings' && m === 'GET') { const r = db.prepare('SELECT json FROM settings WHERE user_id = ?').get(user.id); return send(res, 200, r ? JSON.parse(r.json) : {}); }
    if (path === '/api/settings' && m === 'PUT') {
      const b = await readJson(req);
      const json = JSON.stringify(b);
      if (json.length > 8192) throw new auth.ApiError(413, 'too_large');
      db.prepare('INSERT INTO settings (user_id, json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json').run(user.id, json); // settings are preferences only, never money/inventory
      return send(res, 200, { ok: true });
    }
    throw new auth.ApiError(404, 'not_found');
  }

  async function serveStatic(req, res, path) {
    if (path === '/') path = '/client/index.html';
    if (!STATIC_ROOTS.some((p) => path.startsWith(p))) { res.writeHead(404).end('not found'); return; }
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' }).end(body);
    } catch { res.writeHead(404).end('not found'); }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path.startsWith('/api/')) await api(req, res, path); else await serveStatic(req, res, path);
    } catch (e) {
      if (e instanceof auth.ApiError) return send(res, e.status, { error: e.code, message: e.message });
      console.error('unhandled', e);
      send(res, 500, { error: 'server_error' });
    }
  });

  // ---- WebSocket: first message must authenticate; then room messages ----
  attachWs(server, {
    onConnection(conn, req) {
      const ip = ipOf(req);
      if ((wsPerIp.get(ip) || 0) >= cfg.limits.maxConnectionsPerIp) { conn.close(1013); return; }
      wsPerIp.set(ip, (wsPerIp.get(ip) || 0) + 1);
      let player = null, room = null, count = 0, windowStart = Date.now();
      const kick = setTimeout(() => { if (!player) conn.close(4001); }, 5000); // must authenticate within 5 s
      conn.on('message', (raw) => {
        const t = Date.now();
        if (t - windowStart > 1000) { windowStart = t; count = 0; }
        if (++count > cfg.limits.wsMessagesPerSecond) { conn.close(4008); return; }
        let msg; try { msg = JSON.parse(raw); } catch { conn.close(1003); return; }
        if (!player) {
          if (msg.t !== 'auth') { conn.close(4001); return; }
          const u = auth.userFromToken(db, msg.token);
          if (!u) { conn.close(4001); return; }
          clearTimeout(kick);
          const id = typeof msg.room === 'string' && /^[a-z0-9_-]{1,24}$/i.test(msg.room) ? msg.room : 'lab';
          room = rooms.get(id);
          player = room.join(u, conn, msg.style);
          return;
        }
        room.handle(player, msg);
      });
      conn.on('close', () => {
        clearTimeout(kick);
        wsPerIp.set(ip, Math.max(0, (wsPerIp.get(ip) || 1) - 1));
        if (player && room && room.players.get(player.id)?.conn === conn) room.leave(player.id);
      });
    },
  });

  const upgraded = new Set(); // WebSocket sockets are no longer tracked by http.Server, so remember them for shutdown
  server.on('upgrade', (req, socket) => { upgraded.add(socket); socket.on('close', () => upgraded.delete(socket)); });
  const ticker = setInterval(() => rooms.tick(), 25);
  ticker.unref();
  return { server, rooms, close: () => { clearInterval(ticker); for (const s of upgraded) s.destroy(); server.closeAllConnections?.(); server.close(); } };
}

// ---- entrypoint ----
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = openDb(process.env.DB_PATH || join(ROOT, 'data', 'gridstrike.db'));
  const app = createApp({ db });
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1'; // bind to localhost; Nginx is the public face
  app.server.listen(port, host, () => console.log(`gridstrike backend on http://${host}:${port}`));
  const stop = () => { app.close(); db.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
