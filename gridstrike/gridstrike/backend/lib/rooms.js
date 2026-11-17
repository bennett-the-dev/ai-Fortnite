// Authoritative build rooms. Every placement/edit goes through the SAME shared BuildWorld the tests exercise;
// the client only sends intents, the server validates (rate, ownership, materials, support) and broadcasts results.
import { BuildWorld, MODULES } from '../../src/shared/build.js';
import { GAME } from '../../config/game.js';
import { simulate } from './netsim.js';

const TYPES = new Set(['wall', 'floor', 'stair', 'cone']);
const MATS = new Set(['wood', 'brick', 'metal']);
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

export class Room {
  constructor(id, { netCfg = {}, now = () => performance.now() / 1000, seed = 1 } = {}) {
    this.id = id; this.now = now; this.netCfg = netCfg;
    this.world = new BuildWorld({ seed });
    this.players = new Map(); // playerId -> { id, name, style, mats, send }
  }

  join(user, conn, style = 'competitive') {
    const id = `u${user.id}`;
    const old = this.players.get(id);
    if (old) old.conn.close(4000); // one connection per account per room
    const send = simulate((m) => conn.send(m), this.netCfg);
    const p = { id, name: user.username, team: id, style: GAME.styles[style] ? style : 'competitive', mats: { wood: 1e9, brick: 1e9, metal: 1e9 }, conn, send };
    this.players.set(id, p);
    p.send(JSON.stringify({ t: 'joined', you: id, style: p.style, pieces: [...this.world.pieces.values()].map(this._pub) }));
    this._broadcast({ t: 'player', id, name: p.name }, id);
    return p;
  }

  leave(id) { this.players.delete(id); this._broadcast({ t: 'left', id }); }

  _pub = (p) => ({ key: p.key, type: p.type, gx: p.gx, gl: p.gl, gz: p.gz, o: p.o, dir: p.dir, owner: p.owner, mat: p.matType, hp: p.hp, state: p.state });

  _broadcast(obj, exceptId = null) {
    const s = JSON.stringify(obj);
    for (const [id, pl] of this.players) if (id !== exceptId) pl.send(s);
  }

  /** Handle one parsed client message. Never throws on bad input: bad input gets an error reply. */
  handle(player, msg) {
    const reply = (o) => player.send(JSON.stringify(o));
    const t = this.now();
    switch (msg && msg.t) {
      case 'ping': return reply({ t: 'pong', ts: msg.ts, server: Date.now() });
      case 'place': {
        const r = msg.req;
        if (!r || !TYPES.has(r.type) || !int(r.gx, -1000, 1000) || !int(r.gl, 0, 50) || !int(r.gz, -1000, 1000)) return reply({ t: 'rej', seq: msg.seq, reason: 'badRequest' });
        const req = { type: r.type, gx: r.gx, gl: r.gl, gz: r.gz, o: r.o === 1 ? 1 : 0, dir: int(r.dir, 0, 3) ? r.dir : 0, mat: MATS.has(r.mat) ? r.mat : 'wood' };
        const res = this.world.place(player, req, t);
        if (!res.ok) return reply({ t: 'rej', seq: msg.seq, reason: res.reason });
        if (res.pending) return reply({ t: 'pending', seq: msg.seq, key: res.key });
        return this._broadcast({ t: 'place', seq: msg.seq, by: player.id, piece: this._pub(this.world.get(res.key)) });
      }
      case 'edit': {
        const piece = this.world.get(msg.key);
        if (!piece) return reply({ t: 'rej', seq: msg.seq, reason: 'missing' });
        const mod = MODULES[piece.type];
        if (!Array.isArray(msg.removed) || msg.removed.length > mod.TILES || !msg.removed.every((i) => int(i, 0, mod.TILES - 1))) return reply({ t: 'rej', seq: msg.seq, reason: 'badRequest' });
        const state = piece.type === 'stair' ? mod.stateFromRemoved(msg.removed, { flip: msg.flip === true }) : mod.stateFromRemoved(msg.removed);
        const res = this.world.applyEdit(player.id, msg.key, state);
        if (!res.ok) return reply({ t: 'rej', seq: msg.seq, reason: res.reason });
        return this._broadcast({ t: 'edit', seq: msg.seq, by: player.id, key: msg.key, state });
      }
      case 'reset': {
        const res = this.world.resetEdit(player.id, msg.key);
        if (!res.ok) return reply({ t: 'rej', seq: msg.seq, reason: res.reason });
        return this._broadcast({ t: 'edit', seq: msg.seq, by: player.id, key: msg.key, state: this.world.get(msg.key).state });
      }
      default: return reply({ t: 'rej', reason: 'unknownMessage' });
    }
  }

  /** Call ~every 20-50 ms: resolves contested replacement windows and tells everyone. */
  tick() {
    for (const e of this.world.resolvePending(this.now())) this._broadcast({ t: 'place', by: e.owner, replaced: true, piece: this._pub(this.world.get(e.key)) });
  }
}

export class RoomManager {
  constructor(opts = {}) { this.opts = opts; this.rooms = new Map(); }
  get(id) { if (!this.rooms.has(id)) this.rooms.set(id, new Room(id, this.opts)); return this.rooms.get(id); }
  tick() { for (const r of this.rooms.values()) r.tick(); }
}
