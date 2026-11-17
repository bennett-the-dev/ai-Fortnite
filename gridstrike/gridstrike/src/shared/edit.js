// Edit session state machine + input mapper. Flags come from the building style / player settings.
// Selection semantics: the selection is the set of tiles REMOVED from the piece.
import { MODULES } from './build.js';

export class EditSession {
  /**
   * @param world BuildWorld
   * @param playerId string
   * @param opts { confirmEditOnRelease, editOnRelease }
   */
  constructor(world, playerId, opts = {}) {
    this.world = world;
    this.playerId = playerId;
    this.opts = { confirmEditOnRelease: false, editOnRelease: false, ...opts };
    this.state = 'idle';      // idle | armed | editing
    this.key = null;
    this.selection = new Set();
    this.flip = false;
  }

  get active() { return this.state === 'editing'; }

  _begin(key) {
    const p = this.world.get(key);
    if (!p || p.owner !== this.playerId) return false;
    this.key = key;
    this.state = 'editing';
    const mod = MODULES[p.type];
    this.selection = new Set(mod.removedOf(p.state));
    this.flip = !!p.state.flip;
    return true;
  }

  /** Edit key pressed while aiming at targetKey. */
  pressEdit(targetKey) {
    if (this.state === 'editing') return this.confirm(); // second press confirms when not using release-confirm
    if (this.opts.editOnRelease) { this.state = 'armed'; this.key = targetKey; return true; }
    return this._begin(targetKey);
  }

  /** Edit key released. */
  releaseEdit() {
    if (this.state === 'armed') { const k = this.key; this.state = 'idle'; return this._begin(k); }
    if (this.state === 'editing' && this.opts.confirmEditOnRelease) return this.confirm();
    return true;
  }

  /** Toggle a tile in the selection (mouse drag / keyboard / controller all land here). */
  select(i, on = true) {
    if (this.state !== 'editing') return false;
    const p = this.world.get(this.key);
    if (!p || i < 0 || i >= MODULES[p.type].TILES) return false;
    on ? this.selection.add(i) : this.selection.delete(i);
    return true;
  }

  toggleFlip() {
    const p = this.world.get(this.key);
    if (this.state !== 'editing' || !p || p.type !== 'stair') return false;
    this.flip = !this.flip;
    return true;
  }

  /** What the piece will look like if confirmed. Built by the same module functions the server uses. */
  previewState() {
    const p = this.world.get(this.key);
    if (!p) return null;
    const mod = MODULES[p.type];
    return p.type === 'stair' ? mod.stateFromRemoved([...this.selection], { flip: this.flip }) : mod.stateFromRemoved([...this.selection]);
  }

  previewSolids() {
    const p = this.world.get(this.key);
    if (!p) return [];
    const copy = { ...p, state: this.previewState() };
    return MODULES[p.type].solids(copy);
  }

  confirm() {
    if (this.state !== 'editing') return false;
    const st = this.previewState();
    const res = this.world.applyEdit(this.playerId, this.key, st);
    this._end();
    return res.ok;
  }

  cancel() { this._end(); return true; }

  /** Reset the piece to its full shape. Works from idle (with target) or mid-edit. */
  reset(targetKey = null) {
    const key = this.state === 'editing' ? this.key : targetKey;
    if (!key) return false;
    const res = this.world.resetEdit(this.playerId, key);
    this._end();
    return res.ok;
  }

  _end() { this.state = 'idle'; this.key = null; this.selection = new Set(); this.flip = false; }
}

/**
 * Maps raw inputs (key presses, wheel ticks) to edit actions.
 * Scroll-wheel reset = the same wheel direction bound to both `edit` and `reset`:
 * one tick fires edit then reset in that fixed order, so a single flick resets the piece you aim at.
 */
export class EditInput {
  constructor(session, bindings) {
    this.session = session;
    this.bindings = bindings; // { edit: ['key:KeyG','wheel:down'], reset: ['key:KeyR','wheel:down'] }
    this.ctx = { targetKey: null };
  }

  setTarget(key) { this.ctx.targetKey = key; }

  _actionsFor(code) {
    const acts = [];
    for (const a of ['edit', 'reset']) if ((this.bindings[a] || []).includes(code)) acts.push(a);
    return acts;
  }

  /** ev: { type: 'down'|'up'|'wheel', code: 'KeyG' | 'down' | 'up' } */
  handle(ev) {
    const code = ev.type === 'wheel' ? `wheel:${ev.code}` : `key:${ev.code}`;
    const acts = this._actionsFor(code);
    if (!acts.length) return false;
    if (ev.type === 'wheel') {
      // Wheel has no release; each tick is a press that also completes immediately.
      for (const a of acts) this._fire(a, true);
      return true;
    }
    for (const a of acts) this._fire(a, ev.type === 'down');
    return true;
  }

  _fire(action, down) {
    const s = this.session;
    if (action === 'edit') return down ? s.pressEdit(this.ctx.targetKey) : s.releaseEdit();
    if (action === 'reset' && down) return s.reset(this.ctx.targetKey);
    return false;
  }
}
