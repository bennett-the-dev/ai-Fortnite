# Mechanics research (INTERNAL - rename to MECHANICS_RESEARCH.md before the repo is ever public)

Research date: 2026-11-15. Method: web search + page fetch. Web access was available this session.
Rule from the spec: every finding records season/mode/platform. Where a source does not say, it is marked **era unknown**.
Status key: **VERIFIED** (primary/official source), **SECONDARY** (community guide, not official), **UNVERIFIED** (no source found; implemented as a guess and flagged), **NOT RESEARCHED**.

> Honest scope note: this is a first pass covering what Stage 1-3 needed. Sections R-7 onward are not done yet. The spec says to ask the owner for gameplay references rather than guess edit patterns; see "Questions for the owner" at the bottom.

---

## R-1 Piece dimensions and grid  - VERIFIED
1. **How it works:** every wall, floor, stair and roof footprint is one 512 x 512 cm grid cell. Wall 512 x 384 x 24 cm. Floor 512 x 512, 24 thick. Stair 512 x 512 x 384 high.
2. **Competitive use:** all piece control and box geometry assumes this lattice.
3. **This game:** `config/game.js` -> `grid` (5.12 m x 3.84 m x 0.24 m).
4. **Implementation:** `src/shared/grid.js`, piece modules.
5. **Test:** `tests/building.test.js` "grid dimensions match...".
6. **Source:** Epic dev docs, architectural modeling guidelines (UEFN, era unknown, covers the editor's grid pieces; it does not describe cones/pyramids, so cone height = one storey is **UNVERIFIED**): https://dev.epicgames.com/documentation/en-us/uefn/architectural-modeling-guidelines-in-unreal-editor-for-fortnite

## R-2 Edit grids  - PARTLY VERIFIED (updated 2026-11-16 with more sources)
1. **How it works (sources, era unknown unless noted):**
   - Cones/pyramids: 2x2 grid, one point per corner; the fan wiki says pyramids accept any configuration while other pieces have a fixed set of shapes (SECONDARY).
   - Walls: 3x3 (spec; fan wiki also says 3x3). Named wall edits from a guide: door (left/centre/right), window (left/centre/right), double window, half wall, quarter wall, column, arch, wedge (SECONDARY).
   - Floors: a guide lists single-square opening, half opening, wedge balcony and "bridge" (two opposite corners), which fits a **2x2** floor grid. **Conflict:** the fan wiki says walls AND floors use 3x3. I kept the spec's 2x2 for floors; flagged for owner/reference check.
   - Stairs/ramps: one guide describes a **four-tile** edit (top-left/right, bottom-left/right): one tile = door, two adjacent = window or half stair (top pair or bottom pair), three tiles with one corner left = "peanut butter" L shape. Another guide builds angled/spiral/side-rail stairs by dragging corners. Neither describes a separate flip button; redirecting a ramp is done by re-editing it. (SECONDARY)
   - Roofs/cones (guide): remove one square = tall triangle; remove two adjacent = ramp; remove two opposite corners = tent.
   - Validity (fan wiki): a build only has to stay connected to the ground or a wall at one point; disconnected tiles collapse. No other shape rules. Matches this game's rule (>= 1 tile remains + support collapse).
2. **Use:** window/door peeks, cone peeks, half-stair exits from under a ramp.
3. **This game:** separate modules per piece. Stair = rotation + optional flip + 2x2 mask, with presets `halfWidthLeft/Right`, `lowerHalfOpen`, `upperHalfOpen` (half stair), `cornerRemoved`, `peanutButter`. **Deviation:** in the sources "selecting" tiles means removing them and all four selected flattens a ramp; here the selection is the removed set and removing all four is rejected. Corner-drag shapes (spiral, side rail) and the reference cone model (raising corners) are NOT implemented; cones use removable quadrants instead. Flip is kept as an extra convenience (UNVERIFIED as a real mechanic).
4. **Test:** `tests/editing.test.js` (21 tests).
5. **Sources:**
   - https://fortnite.fandom.com/wiki/Building (fan wiki, SECONDARY)
   - https://aperuai.com/en/blog/cmnsop0sq00ced6anrur1c6cg (stair tile edits, SECONDARY)
   - https://forums.tomshardware.com/faq/fortnite-battle-royale-%E2%80%93-advanced-stairs-editing-guide.3339078/ (stair builds, SECONDARY)
   - https://progameguides.com/fortnite/fortnite-guides/fortnite-editing-guide/ (floor/wall/roof edits, SECONDARY)
   - https://gamertagmythras.com/blog/fortnite/fortnite-editing-guide (SECONDARY)

## R-3 Scroll-wheel reset  - VERIFIED (PC mouse+keyboard only)
1. **How it works:** two actions, Building Edit and Reset Building Edit, each get a secondary bind on the **same wheel direction**. One wheel tick performs edit then reset. Without it, resetting is two presses even with confirm-on-release. The wheel must not also cycle weapons. Confirm-on-release is optional. Does not work on controller.
2. **Use:** single-motion instant reset while piece-controlling.
3. **This game:** `EditInput` fires bound actions in fixed order edit -> reset per wheel tick; reset only affects pieces the player owns.
4. **Test:** 4 tests in `tests/editing.test.js` (shared bind, edit-only bind, no-bind, enemy wall).
5. **Source:** https://prosettings.net/blog/how-to-set-up-scroll-wheel-reset-in-fortnite/ (era unknown, current-era settings menu naming).

## R-4 Piece control, wall replacement, turbo-build gap  - SECONDARY + historical official
1. **How it works:** whoever places a piece most recently controls it (community guide). Official note (v10.20 era, 2019): minimum gap between turbo placements raised 0.05 s -> 0.15 s; planned rate-of-fire model (first piece instant, then one per 0.15 s); when a piece is destroyed the server waits 0.15 s before allowing a rebuild, entrants join a pool and one wins (options considered: coin flip among non-owners, among everyone, or owner priority). Whether this shipped exactly this way, and what current seasons do, is **UNVERIFIED**.
2. **Use:** take the enemy wall, cone over it, retake instantly, refresh walls before they break.
3. **This game:** `config.build.replaceDelay` 0.15 s, `replacePolicy` one of the three options above (default `nonOwnerFlip`), per-style `minPlaceGap` (classic 0.15, competitive 0.05, shell 0.15). Seeded RNG so the server result is reproducible.
4. **Not implemented:** "placing a wall over an enemy's edited/open wall takes it" (guide implies it; no mechanics source). Not guessed.
5. **Test:** 4 tests in `tests/building.test.js` including a 200-seed fairness test (arrival order inside the window does not bias the winner).
6. **Sources:** https://fortniteinsider.com/epic-games-address-fortnite-turbo-building-and-upcoming-changes-improvements (2019, v10.20 era); https://gamertagmythras.com/blog/fortnite/fortnite-piece-control-guide (SECONDARY).

## R-5 Edit on release / confirm on release  - SECONDARY
1. Confirm-on-release applies the edit when the edit key is released after selecting tiles; highlighted as the highest-impact edit toggle (SECONDARY, era unknown).
2. "Edit on release" (starting the edit session on key release) is described by the spec; I did not find a mechanics source. Implemented as `armed -> editing on release`. **UNVERIFIED** semantics.
3. Tests: `tests/editing.test.js`.

## R-6 Movement  - UNVERIFIED numbers
Sources describe tactical sprint (stamina-limited), slide keeps momentum and lowers the hitbox, jump/crouch used for jump-resets. **No source gave any numeric value** (speeds, jump height, slide distance). All numbers in `config.move` are original tuning, checked only for invariants (reaches 90% sprint speed < 0.35 s, stops < 0.5 s, jump apex = v^2/2g, buffer 100 ms, coyote 80 ms). Tactical-sprint stamina is not implemented yet. Source: https://gamertagmythras.com/blog/fortnite/fortnite-movement-guide

## R-7 onward  - NOT RESEARCHED
Prefiring, shotgun mechanics, weapon pullout timing, competitive sensitivity, controller settings, mobile building controls, Performance Mode page, popular creative/1v1 maps, box fight mechanics, matchmaking, bubble-wrap/tarp patterns. These block Stage 4+ work.

## Questions for the owner
1. (Optional now) If you have gameplay clips, they would settle the floor 2x2-vs-3x3 conflict and the cone corner-raise model. I researched the rest myself.
2. Which ruleset do you want the defaults to match: classic (0.15 s gap) or a competitive-era ruleset?
