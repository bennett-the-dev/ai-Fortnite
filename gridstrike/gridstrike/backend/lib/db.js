// SQLite via Node's built-in node:sqlite (no npm packages). Fine for one VPS and thousands of players.
// If you outgrow it, the SQL here is portable to PostgreSQL with small changes.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw_hash TEXT NOT NULL,
  bolts INTEGER NOT NULL DEFAULT 0 CHECK (bolts >= 0),
  xp INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  eliminations INTEGER NOT NULL DEFAULT 0,
  matches INTEGER NOT NULL DEFAULT 0,
  rating INTEGER NOT NULL DEFAULT 1000,
  last_daily TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);
CREATE TABLE IF NOT EXISTS equipped (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  item_id TEXT NOT NULL,
  PRIMARY KEY (user_id, slot)
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  balance_after INTEGER NOT NULL,
  ts INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tx_idem ON transactions(user_id, reason, ref) WHERE ref IS NOT NULL;
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  json TEXT NOT NULL
);
`;

export function openDb(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside one IMMEDIATE transaction (all-or-nothing, serialised against other writers). */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
