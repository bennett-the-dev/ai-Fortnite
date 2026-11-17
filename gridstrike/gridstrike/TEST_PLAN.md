# TEST PLAN

Run everything: `node --test` (Node >= 20). Deterministic; no network.

| Area | Status | File | Covered |
|---|---|---|---|
| Building | automated, passing | tests/building.test.js | dimensions, snapping, all 4 piece types, invalid placement, slot sharing, support/collapse, turbo gap per style, limit, ownership, replacement window + policies + order fairness, shell box-up |
| Editing | automated, passing | tests/editing.test.js | per-piece grids and presets, cone exact surface, stair flip/mask/orientation, preview == final, collision + ray change after edit, reset, confirm/edit on release, cancel, chained and rapid edits, scroll-wheel reset (4 cases), ownership |
| Movement | automated, passing | tests/movement.test.js | acceleration, friction, diagonal cap, jump apex, jump buffer, coyote, air strafe, momentum cap, slide, crouch ceiling, collision, step-up, determinism, build-world collision |
| Combat | not written (feature not built) | - | shotgun pellets, headshots, falloff, reload, prefire, structure damage |
| Networking | partial, passing | tests/backend.test.js | real WebSocket clients: auth, shared world, ownership, contested replacement via server tick, flood/bad JSON, latency/jitter/loss wrapper. NOT yet: prediction, reconciliation, lag compensation, reconnection, full 0-200 ms matrix run |
| Economy | automated, passing | tests/backend.test.js | rewards (5/25, bonus, configurable, idempotent), daily, purchases, ledger sums, negative-balance constraint, client cannot set balance |
| Mobile / performance | not written | - | touch, multi-touch, HUD layout, quality profiles |
| Browser / feel | **manual, not done** | - | load client, build/edit/move by hand, measure FPS on named hardware |

A feature is "complete" only when its row is automated and passing and any manual row for it has been checked by a human.
