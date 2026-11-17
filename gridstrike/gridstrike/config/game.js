// Central tunables. Anything marked UNVERIFIED has no confirmed source yet (see the internal mechanics research doc).

export const GAME = {
  // Piece footprint: 512 x 384 x 24 cm (sourced: official modeling guidelines, research doc R-1). Units are metres.
  grid: { size: 5.12, height: 3.84, thickness: 0.24 },

  // Costs and hit points: UNVERIFIED, placeholder values until checked.
  materials: {
    wood: { hp: 150, cost: 10 },
    brick: { hp: 300, cost: 10 },
    metal: { hp: 400, cost: 10 },
  },

  build: {
    maxPieces: 600,
    // Contested replacement (R-4): after a piece is destroyed the server holds the slot for
    // this many seconds; everyone who tries to rebuild in that window joins a pool and one wins.
    replaceDelay: 0.15,
    // 'nonOwnerFlip' | 'anyFlip' | 'ownerPriority'  (the three options the developers said they were weighing)
    replacePolicy: 'nonOwnerFlip',
    // Only wall/floor/stair/cone in this slot-sharing rule: floor, stair and cone share one cell slot. UNVERIFIED design choice.
    cellSlotShared: true,
  },

  // Per-style behaviour (R-4: 0.05 s and 0.15 s are both documented turbo-build gaps from different eras).
  styles: {
    classic:     { minPlaceGap: 0.15, confirmEditOnRelease: false, editOnRelease: false, scrollReset: false },
    competitive: { minPlaceGap: 0.05, confirmEditOnRelease: true,  editOnRelease: false, scrollReset: true },
    shell:       { minPlaceGap: 0.15, confirmEditOnRelease: false, editOnRelease: false, scrollReset: false },
  },

  // Movement tuning. Original values; no source gave numbers (R-6). Tune by feel, tests lock the invariants.
  move: {
    gravity: 28, jumpSpeed: 8.4,
    walkSpeed: 5.0, sprintSpeed: 7.4, crouchSpeed: 2.6,
    groundAccel: 55, friction: 7, stopSpeed: 1.5,
    airAccel: 25, airCap: 1.6,
    coyoteTime: 0.08, jumpBuffer: 0.10,
    slideMinSpeed: 5.5, slideBoost: 1.1, slideFriction: 1.4, slideMaxTime: 1.1, slideEndSpeed: 3.0, slideSteer: 6,
    momentumCap: 1.12,
    halfWidth: 0.3, heightStand: 1.8, heightCrouch: 1.2, stepHeight: 0.5,
  },
  moveRules: { bhop: false, airStrafe: true },
};
