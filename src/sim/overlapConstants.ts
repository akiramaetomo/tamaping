// Constants shared by the TS overlap engine's contact rules
// (`overlapParticles.ts`, `ballImpacts.ts`).

// Named knobs of the trial (see the spec). Each one shapes one behaviour.
// Below this approach speed (px/s) a contact does not bounce, so particles
// pressed onto the Ball or a wall rest instead of jittering.
export const OVERLAP_RESTING_SPEED = 15;
// Share of an overlap pushed out per step (positions only); Rapier 0.14's
// contact error reduction at 60 Hz is 0.239.
export const OVERLAP_PUSH_OUT = 0.24;
// Solver passes over the Ball's contacts; many particles touch it at once.
export const OVERLAP_ITERATIONS = 4;
// Moment of inertia of a solid disc, I = k m r^2, as Rapier gives a ball
// collider. Rapier bodies here have no angular damping, so a spin lasts
// until a contact with friction changes it (walls have friction 0).
export const DISC_INERTIA = 0.5;
// A pair closer than this (px) counts as touching, for sound events.
export const TOUCH_DISTANCE = 0.5;
