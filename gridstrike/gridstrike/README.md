# GRIDSTRIKE (working title; change it in `config/names.js`)

Browser-based competitive building shooter. Plain JavaScript modules + Three.js for rendering; all gameplay logic is custom and lives in `src/shared/` so the same code can later run on the server (authority) and client (prediction).

**Status: early. Stage 1-3 logic is implemented and unit-tested; there is no weapon or cosmetics code yet; a tested backend (accounts, BOLTS, STORE, WebSocket build rooms) exists in `backend/`.** See `IMPLEMENTATION_STATUS.md` for exactly what works and what is unverified.

## Run
```
cd gridstrike
node --test          # 69 automated tests (Node >= 20, no dependencies)
npm run serve        # static server on http://localhost:8080 -> Build Lab sandbox
```
The client loads Three.js from a CDN, so the browser needs internet access. The Build Lab client has not been run in a browser yet.

Backend (accounts, BOLTS, STORE, WebSocket rooms, VPS deployment): see `START_HERE.md` and `backend/BACKEND_HOW_TO.md`. `npm run backend` serves everything on :3000.

## Layout
- `config/names.js` all game-facing names; `config/game.js` all tunables
- `src/shared/pieces/{wall,floor,stair,cone}.js` separate geometry + edit grid per piece
- `src/shared/build.js` authoritative build world (placement, support, ownership, replacement)
- `src/shared/edit.js` edit sessions + scroll-wheel reset input mapping
- `src/shared/movement.js` deterministic movement
- `src/shared/styles.js` Classic / Competitive / Shell behaviour and box-up macro
- `client/` Build Lab sandbox; `tests/` node:test suites

## Docs
internal mechanics research notes, `COMMUNITY_FEATURES.md`, `IMPLEMENTATION_STATUS.md`, `TEST_PLAN.md`, `DEPLOYMENT.md`, `VPS_SETUP.md`, `ASSET_LICENSES.md`.

This is not legal advice; have branding reviewed before any public launch.
