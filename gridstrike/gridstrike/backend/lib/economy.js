// All currency, XP, ownership and reward changes go through here, inside SQLite transactions.
// The browser can never set a balance: it can only ask for a purchase/equip/daily claim, and the server decides.
import { tx } from './db.js';
import { ApiError } from './auth.js';
import { CATALOG, SLOTS, itemById, inStore } from './catalog.js';

/** Change a balance and write the ledger row in one step. Idempotent when `ref` is given. Must run inside tx(). */
export function credit(db, userId, delta, reason, ref = null, now = Date.now()) {
  if (!Number.isInteger(delta)) throw new Error('delta must be an integer');
  if (ref !== null) {
    const dup = db.prepare('SELECT 1 FROM transactions WHERE user_id = ? AND reason = ? AND ref = ?').get(userId, reason, ref);
    if (dup) return { duplicate: true };
  }
  const u = db.prepare('SELECT bolts FROM users WHERE id = ?').get(userId);
  if (!u) throw new ApiError(404, 'no_user');
  const after = u.bolts + delta;
  if (after < 0) throw new ApiError(402, 'insufficient_bolts', 'Not enough BOLTS.');
  db.prepare('UPDATE users SET bolts = ? WHERE id = ?').run(after, userId);
  db.prepare('INSERT INTO transactions (user_id, delta, reason, ref, balance_after, ts) VALUES (?, ?, ?, ?, ?, ?)').run(userId, delta, reason, ref, after, now);
  return { duplicate: false, balance: after };
}

export function grantStarterItems(db, userId, now = Date.now()) {
  for (const it of CATALOG.filter((i) => i.starter)) {
    db.prepare('INSERT OR IGNORE INTO inventory (user_id, item_id, acquired_at) VALUES (?, ?, ?)').run(userId, it.id, now);
    db.prepare('INSERT OR IGNORE INTO equipped (user_id, slot, item_id) VALUES (?, ?, ?)').run(userId, it.slot, it.id);
  }
}

/**
 * Called ONLY by the game server when a match it ran has ended. Never exposed over HTTP.
 * players: [{ userId, eliminations, won }]. Idempotent per matchId (a replay pays nothing).
 */
export function awardMatch(db, cfg, matchId, players, now = Date.now()) {
  const R = cfg.rewards;
  return tx(db, () => {
    if (db.prepare('SELECT 1 FROM matches WHERE id = ?').get(matchId)) return { duplicate: true, awards: [] };
    db.prepare('INSERT INTO matches (id, processed_at) VALUES (?, ?)').run(matchId, now);
    const awards = [];
    for (const p of players) {
      const elims = Math.max(0, Math.min(200, p.eliminations | 0)); // sanity clamp; real counts come from server combat
      let bolts = elims * R.perElimination + (p.won ? R.perWin : 0);
      if (R.multiElim && elims >= R.multiElim.threshold) bolts += R.multiElim.bonus;
      const xp = elims * R.xpPerElimination + (p.won ? R.xpPerWin : 0) + R.xpPerMatch;
      if (bolts > 0) credit(db, p.userId, bolts, 'match_reward', matchId, now);
      db.prepare('UPDATE users SET xp = xp + ?, wins = wins + ?, eliminations = eliminations + ?, matches = matches + 1 WHERE id = ?')
        .run(xp, p.won ? 1 : 0, elims, p.userId);
      awards.push({ userId: p.userId, bolts, xp });
    }
    return { duplicate: false, awards };
  });
}

export function claimDaily(db, cfg, userId, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  return tx(db, () => {
    const u = db.prepare('SELECT last_daily FROM users WHERE id = ?').get(userId);
    if (u.last_daily === day) throw new ApiError(409, 'already_claimed', 'Daily reward already claimed.');
    db.prepare('UPDATE users SET last_daily = ? WHERE id = ?').run(day, userId);
    return credit(db, userId, cfg.rewards.daily, 'daily_login', day, now);
  });
}

export function purchase(db, cfg, userId, itemId, now = Date.now()) {
  const item = typeof itemId === 'string' ? itemById(itemId) : null;
  if (!item) throw new ApiError(404, 'no_item', 'Unknown item.');
  if (item.starter) throw new ApiError(400, 'not_for_sale');
  if (item.rotating && !inStore(item.id, now, cfg.store)) throw new ApiError(409, 'not_in_store', 'That item is not in the STORE today.');
  return tx(db, () => {
    if (db.prepare('SELECT 1 FROM inventory WHERE user_id = ? AND item_id = ?').get(userId, item.id)) throw new ApiError(409, 'already_owned', 'You already own that.');
    const r = credit(db, userId, -item.price, 'purchase', item.id, now);
    db.prepare('INSERT INTO inventory (user_id, item_id, acquired_at) VALUES (?, ?, ?)').run(userId, item.id, now);
    return { itemId: item.id, balance: r.balance };
  });
}

export function equip(db, userId, itemId) {
  const item = typeof itemId === 'string' ? itemById(itemId) : null;
  if (!item) throw new ApiError(404, 'no_item');
  if (!db.prepare('SELECT 1 FROM inventory WHERE user_id = ? AND item_id = ?').get(userId, item.id)) throw new ApiError(403, 'not_owned', 'You do not own that item.');
  db.prepare('INSERT INTO equipped (user_id, slot, item_id) VALUES (?, ?, ?) ON CONFLICT(user_id, slot) DO UPDATE SET item_id = excluded.item_id').run(userId, item.slot, item.id);
  return { slot: item.slot, itemId: item.id };
}

export function profile(db, userId) {
  const u = db.prepare('SELECT id, username, bolts, xp, wins, eliminations, matches, rating, created_at FROM users WHERE id = ?').get(userId);
  const inv = db.prepare('SELECT item_id FROM inventory WHERE user_id = ?').all(userId).map((r) => r.item_id);
  const eq = Object.fromEntries(db.prepare('SELECT slot, item_id FROM equipped WHERE user_id = ?').all(userId).map((r) => [r.slot, r.item_id]));
  return { ...u, level: 1 + Math.floor(Math.sqrt(u.xp / 100)), inventory: inv, equipped: eq };
}

export const ledger = (db, userId, limit = 50) => db.prepare('SELECT delta, reason, ref, balance_after, ts FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);
export { SLOTS };
