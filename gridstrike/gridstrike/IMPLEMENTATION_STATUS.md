# IMPLEMENTATION STATUS

Last updated: 2026-11-16 (session 1 continued: backend added)

## Test results
`cd gridstrike && node --test` -> **69 passed, 0 failed** (building 14, editing 21, movement 18, backend 16). Node 22.23.4 in a sandbox with no browser and no real VPS.

## Milestone gate (movement, building, editing must pass before networking/backend/economy)
| Gate item | Logic + automated tests | Hands-on feel / browser |
|---|---|---|
| Movement | done (see caveats) | NOT verified: no browser run, tuning untested by a human |
| Building | done | NOT verified |
| Editing | done for wall/floor/cone; stairs are a guess | NOT verified |
**Gate is therefore NOT yet passed.** Tests prove the rules are internally consistent, not that they match the reference game or feel right. Backend and economy were added later at the owner's explicit request (see Backend section); cosmetics art was not started.

## Completed (implemented and tested)
- Project scaffold, one-file naming config (`config/names.js`), one-file tunables (`config/game.js`)
- Grid snapping, wall/floor/stair/cone placement with slot rules, structural support + collapse, materials cost, piece limit, per-style turbo-build gap
- Separate geometry + edit grid per piece (wall 3x3, floor 2x2, cone 2x2, stair rotate/flip/2x2 mask); edits change real collision and ray results; preview geometry is produced by the same function as the final geometry
- Edit session: select, confirm, cancel, reset, confirm-on-release, edit-on-release, chained edits, ownership validation
- Scroll-wheel reset input workflow (shared wheel bind -> edit then reset in one tick)
- Piece control: ownership, destroy -> contested replacement window with three configurable policies, seeded RNG
- Shell style: `boxUpPlan` (4 walls + cone) through the normal validated path
- Deterministic fixed-step movement: acceleration, friction, air strafe, jump buffer, coyote time, slide, crouch with ceiling check, step-up, AABB collision vs the live build world

## Implemented but NOT verified
- `client/` Build Lab (Three.js via CDN, placeholder boxes): syntax-checked and served locally (HTTP 200), **never loaded in a browser**. Expect bugs.

## Backend (added 2026-11-16; see backend/BACKEND_HOW_TO.md)
Done + tested (real HTTP and WebSocket): accounts (scrypt), sessions, rate limits, BOLTS ledger, match rewards (idempotent), daily reward, STORE rotation + purchases, wardrobe equip, settings storage, authoritative build rooms over WebSocket (place/edit/reset/contested replacement/ping), latency-jitter-loss simulation, SQLite backup + restore.
Written but NOT tested on a real server: Nginx config, systemd unit, install.sh.
Not built: matchmaking, game modes, combat/hit validation/lag compensation (no weapons yet), client prediction + reconciliation, ranked/leaderboards/season track/challenges, email recovery, cosmetic art, admin panel. `awardMatch()` exists but nothing calls it.
Milestone gate note: the spec says no backend before movement/building/editing are verified by hand. The owner explicitly asked for the backend, so it was built, but the gate is still unmet.

## Not started
Weapons/combat/prefiring, client prediction/reconciliation, game modes, matchmaking, cosmetics art, ranked, season track, controller, mobile touch HUD, performance mode, audio, art, anti-cheat beyond server authority.

## Known issues / risks
- Researched 2026-11-16: stair tile edits, floor/cone grids and the support rule now have secondary sources, but floor 2x2 vs 3x3 conflicts between sources and cones differ from the reference (corner-raise model not implemented). Material costs, hit points, cone height remain UNVERIFIED.
- Cone collision is a conservative stepped approximation; exact surface exists via `heightAt` but is not used by movement/rays.
- Structural support uses shared lattice vertices only (no distance limit, no load model).
- Tactical-sprint stamina, hurdle, bhop rule variants beyond on/off not implemented.
- Pieces do not yet push or block placement when a player stands inside them.
- Broadphase is a linear scan over all pieces; fine for hundreds of pieces, not for the final map.
- Research sections R-7+ not done.

## Exact next task
1. Owner: pick the default ruleset (classic 0.15 s vs competitive).
2. Open `client/index.html` via `npm run serve` in a real browser, fix whatever breaks, and tune movement by feel.
3. Then finish research R-7 (prefiring, shotgun, pullout) before Stage 4 (weapons).
4. Then: deploy the backend to the VPS following backend/BACKEND_HOW_TO.md and report any step that fails.
