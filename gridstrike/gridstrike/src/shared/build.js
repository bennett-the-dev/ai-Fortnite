// Authoritative build world. Pure logic (no rendering, no I/O) so the same code can run on client (prediction) and server (validation).
import { GAME } from '../../config/game.js';
import { boxesOverlap, mulberry32, rayBox } from './util.js';
import * as wall from './pieces/wall.js';
import * as floor from './pieces/floor.js';
import * as stair from './pieces/stair.js';
import * as cone from './pieces/cone.js';

export const MODULES = { wall, floor, stair, cone };

export const wallKey = (gx, gl, gz, o) => `W${gx},${gl},${gz},${o}`;
export const cellKey = (gx, gl, gz) => `P${gx},${gl},${gz}`; // floor / stair / cone share this slot

export function slotKeyOf(type, gx, gl, gz, o = 0) {
  return type === 'wall' ? wallKey(gx, gl, gz, o) : cellKey(gx, gl, gz);
}

const vkey = (v) => `${v[0]},${v[1]},${v[2]}`;

export class BuildWorld {
  constructor({ seed = 1, config = GAME } = {}) {
    this.cfg = config;
    this.pieces = new Map();    // key -> piece
    this.pending = new Map();   // key -> { opensAt, entrants: [{player, req}], prevOwner }
    this.lastPlaceAt = new Map(); // playerId -> time
    this.rng = mulberry32(seed);
    this.groundY = 0;
  }

  // ---- queries -----------------------------------------------------------
  get(key) { return this.pieces.get(key); }

  solidsOf(p) {
    if (!p._solids) p._solids = MODULES[p.type].solids(p);
    return p._solids;
  }

  allBoxes() {
    const out = [];
    for (const p of this.pieces.values()) out.push(...this.solidsOf(p));
    return out;
  }

  nearbyBoxes(aabb) {
    const out = [];
    for (const p of this.pieces.values()) for (const b of this.solidsOf(p)) if (boxesOverlap(b, aabb)) out.push(b);
    return out;
  }

  /** Closest piece hit along a ray. Edits change solids, so windows really let rays through. */
  raycast(origin, dir, maxT = Infinity) {
    let best = null;
    for (const p of this.pieces.values()) for (const b of this.solidsOf(p)) {
      const t = rayBox(origin, dir, b, maxT);
      if (t !== null && (!best || t < best.t)) best = { t, key: p.key, piece: p };
    }
    return best;
  }

  // ---- support -----------------------------------------------------------
  _verts(p) { return MODULES[p.type].vertices(p); }

  /** Keys of pieces connected to the ground through shared lattice vertices. */
  supportedKeys(extra = null) {
    const byVertex = new Map();
    const all = [...this.pieces.values()];
    if (extra) all.push(extra);
    for (const p of all) for (const v of this._verts(p)) {
      const k = vkey(v);
      if (!byVertex.has(k)) byVertex.set(k, []);
      byVertex.get(k).push(p);
    }
    const seen = new Set(), queue = [];
    for (const p of all) if (this._verts(p).some((v) => v[1] === 0)) { seen.add(p.key); queue.push(p); }
    while (queue.length) {
      const p = queue.pop();
      for (const v of this._verts(p)) for (const q of byVertex.get(vkey(v))) {
        if (!seen.has(q.key)) { seen.add(q.key); queue.push(q); }
      }
    }
    return seen;
  }

  collapseUnsupported() {
    const ok = this.supportedKeys();
    const removed = [];
    for (const k of [...this.pieces.keys()]) if (!ok.has(k)) { this.pieces.delete(k); removed.push(k); }
    return removed;
  }

  // ---- placement ---------------------------------------------------------
  _build(req, player) {
    const { type, gx, gl, gz } = req;
    const o = req.o ?? 0;
    const key = slotKeyOf(type, gx, gl, gz, o);
    const mat = this.cfg.materials[req.mat || 'wood'];
    const piece = {
      key, type, gx, gl, gz, o,
      dir: req.dir ?? 0,
      owner: player.id, team: player.team ?? null,
      matType: req.mat || 'wood', hp: mat.hp, maxHp: mat.hp,
      state: MODULES[type].defaultState(),
    };
    return piece;
  }

  _style(player) { return this.cfg.styles[player.style || 'classic']; }

  /**
   * Try to place a piece. Returns { ok, key?, reason?, pending? }.
   * Server-side validation: rate, materials, limits, slot, support.
   */
  place(player, req, now) {
    if (!MODULES[req.type]) return { ok: false, reason: 'badType' };
    if (!Number.isInteger(req.gx) || !Number.isInteger(req.gl) || !Number.isInteger(req.gz)) return { ok: false, reason: 'badCoords' };
    if (req.gl < 0) return { ok: false, reason: 'belowGround' };
    const piece = this._build(req, player);
    const mat = this.cfg.materials[piece.matType];
    if (!mat) return { ok: false, reason: 'badMaterial' };

    // Turbo-build gap: first piece immediate, then at most one per gap.
    const last = this.lastPlaceAt.get(player.id);
    const gap = this._style(player).minPlaceGap;
    if (last !== undefined && now - last < gap - 1e-9) return { ok: false, reason: 'rate' };

    if ((player.mats[piece.matType] ?? 0) < mat.cost) return { ok: false, reason: 'materials' };

    // Contested replacement window.
    const pend = this.pending.get(piece.key);
    if (pend && now < pend.opensAt - 1e-9) {
      if (!pend.entrants.some((e) => e.player.id === player.id)) pend.entrants.push({ player, req });
      this.lastPlaceAt.set(player.id, now);
      return { ok: true, key: piece.key, pending: true };
    }

    if (this.pieces.has(piece.key)) return { ok: false, reason: 'occupied' };
    if (this.pieces.size >= this.cfg.build.maxPieces) return { ok: false, reason: 'limit' };
    if (!this.supportedKeys(piece).has(piece.key)) return { ok: false, reason: 'unsupported' };

    player.mats[piece.matType] -= mat.cost;
    this.pieces.set(piece.key, piece);
    this.lastPlaceAt.set(player.id, now);
    return { ok: true, key: piece.key };
  }

  /** Resolve contested replacements whose window has elapsed. Call every server tick. Returns events. */
  resolvePending(now) {
    const events = [];
    for (const [key, pend] of [...this.pending]) {
      if (now < pend.opensAt - 1e-9) continue;
      this.pending.delete(key);
      if (!pend.entrants.length || this.pieces.has(key)) continue;
      const winner = this._pickWinner(pend);
      for (const e of this._orderForFallback(pend, winner)) {
        const piece = this._build(e.req, e.player);
        const mat = this.cfg.materials[piece.matType];
        if ((e.player.mats[piece.matType] ?? 0) < mat.cost) continue;
        if (!this.supportedKeys(piece).has(piece.key)) continue;
        e.player.mats[piece.matType] -= mat.cost;
        this.pieces.set(key, piece);
        events.push({ type: 'replaced', key, owner: e.player.id, entrants: pend.entrants.length });
        break;
      }
    }
    return events;
  }

  _pickWinner(pend) {
    const policy = this.cfg.build.replacePolicy;
    let pool = pend.entrants;
    if (policy === 'nonOwnerFlip') {
      const non = pool.filter((e) => e.player.id !== pend.prevOwner);
      if (non.length) pool = non;
    } else if (policy === 'ownerPriority') {
      const own = pool.find((e) => e.player.id === pend.prevOwner);
      if (own) return own;
    }
    return pool[Math.floor(this.rng() * pool.length)];
  }

  _orderForFallback(pend, winner) {
    return [winner, ...pend.entrants.filter((e) => e !== winner)];
  }

  // ---- damage / destruction ---------------------------------------------
  destroy(key, now) {
    const p = this.pieces.get(key);
    if (!p) return { ok: false };
    this.pieces.delete(key);
    this.pending.set(key, { opensAt: now + this.cfg.build.replaceDelay, entrants: [], prevOwner: p.owner });
    const collapsed = this.collapseUnsupported();
    return { ok: true, collapsed };
  }

  damage(key, amount, now) {
    const p = this.pieces.get(key);
    if (!p) return { ok: false };
    p.hp -= amount;
    if (p.hp <= 0) return { ok: true, destroyed: true, ...this.destroy(key, now) };
    return { ok: true, destroyed: false, hp: p.hp };
  }

  // ---- editing (server-authoritative) ------------------------------------
  /** Apply a new edit state. Only the owner may edit. Chained edits just call this repeatedly. */
  applyEdit(playerId, key, newState) {
    const p = this.pieces.get(key);
    if (!p) return { ok: false, reason: 'missing' };
    if (p.owner !== playerId) return { ok: false, reason: 'notOwner' };
    const mod = MODULES[p.type];
    if (!mod.validate(newState)) return { ok: false, reason: 'invalid' };
    p.state = { ...newState };
    p._solids = null;
    return { ok: true };
  }

  resetEdit(playerId, key) {
    const p = this.pieces.get(key);
    if (!p) return { ok: false, reason: 'missing' };
    return this.applyEdit(playerId, key, MODULES[p.type].defaultState());
  }

  /** Stair-only rotation (dir+1). Owner only. */
  rotateStair(playerId, key) {
    const p = this.pieces.get(key);
    if (!p || p.type !== 'stair') return { ok: false, reason: 'missing' };
    if (p.owner !== playerId) return { ok: false, reason: 'notOwner' };
    p.dir = (p.dir + 1) % 4;
    p._solids = null;
    return { ok: true };
  }
}
