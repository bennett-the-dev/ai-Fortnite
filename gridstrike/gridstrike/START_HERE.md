# GRIDSTRIKE package: two parts

## PART 1: THE GAME  (folders `client/`, `src/shared/`, `config/`, `tests/`)
Building, editing, piece control, movement logic + Build Lab sandbox. Read `README.md`, `IMPLEMENTATION_STATUS.md`, `FORTNITE_RESEARCH.md` (internal; rename before going public).
Run: `node --test` then `npm run serve` -> http://localhost:8080

## PART 2: BACKEND AND HOW TO DO IT  (folder `backend/`)
Accounts, BOLTS economy, STORE, WARDROBE, WebSocket build rooms, deployment files for your VPS.
**Start with `backend/BACKEND_HOW_TO.md`.** Files: `backend/server.js`, `backend/lib/*`, `backend/deploy/*` (Nginx, systemd, installer, backup, .env.example).
Run locally: `npm run backend` -> http://127.0.0.1:3000 (serves the game too, with API + WebSocket).

Both parts share code (`src/shared`, `config`), so keep the folder structure as-is when you upload it to the server.
