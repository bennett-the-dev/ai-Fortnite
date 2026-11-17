import crypto from 'node:crypto';
import { tx } from './db.js';

export class ApiError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

const USER_RE = /^[A-Za-z0-9_]{3,16}$/;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${h.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, N, r, p, saltB, hashB] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(saltB, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(got, expected);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const DUMMY = hashPassword('dummy-password-for-timing'); // verify against this when the user does not exist, so timing does not reveal usernames

export function register(db, { username, password }) {
  if (typeof username !== 'string' || !USER_RE.test(username)) throw new ApiError(400, 'bad_username', 'Username must be 3-16 letters, digits or underscores.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new ApiError(400, 'bad_password', 'Password must be 8-128 characters.');
  const hash = hashPassword(password);
  try {
    const r = db.prepare('INSERT INTO users (username, pw_hash, created_at) VALUES (?, ?, ?)').run(username, hash, Date.now());
    return Number(r.lastInsertRowid);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new ApiError(409, 'username_taken', 'That username is taken.');
    throw e;
  }
}

export function login(db, { username, password }, days = 14) {
  if (typeof username !== 'string' || typeof password !== 'string') throw new ApiError(400, 'bad_request');
  const u = db.prepare('SELECT id, pw_hash FROM users WHERE username = ?').get(username);
  const ok = verifyPassword(password, u ? u.pw_hash : DUMMY);
  if (!u || !ok) throw new ApiError(401, 'bad_credentials', 'Wrong username or password.');
  return { token: issueSession(db, u.id, days), userId: u.id };
}

export function issueSession(db, userId, days = 14) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), userId, Date.now() + days * 864e5);
  return token;
}

/** Returns user row or null. Tokens are stored only as SHA-256 hashes. */
export function userFromToken(db, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const row = db.prepare('SELECT s.user_id AS id, s.expires_at, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(sha(token));
  if (!row) return null;
  if (row.expires_at < Date.now()) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token)); return null; }
  return { id: row.id, username: row.username };
}

export const logout = (db, token) => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));

export function changePassword(db, userId, oldPw, newPw) {
  const u = db.prepare('SELECT pw_hash FROM users WHERE id = ?').get(userId);
  if (!u || !verifyPassword(String(oldPw), u.pw_hash)) throw new ApiError(401, 'bad_credentials');
  if (typeof newPw !== 'string' || newPw.length < 8 || newPw.length > 128) throw new ApiError(400, 'bad_password');
  tx(db, () => {
    db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(hashPassword(newPw), userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); // sign out everywhere
  });
}

/** Simple in-memory token-bucket limiter keyed by string. */
export function makeLimiter(perMinute) {
  const buckets = new Map();
  return (key, now = Date.now()) => {
    let b = buckets.get(key);
    if (!b) { b = { tokens: perMinute, ts: now }; buckets.set(key, b); }
    b.tokens = Math.min(perMinute, b.tokens + ((now - b.ts) / 60000) * perMinute);
    b.ts = now;
    if (buckets.size > 50000) for (const [k, v] of buckets) if (now - v.ts > 120000) buckets.delete(k);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}
