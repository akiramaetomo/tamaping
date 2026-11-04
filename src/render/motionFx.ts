// Experimental shapes and motion effects (PoC): one body shape, with light
// rays and a comet trail drawn over it. Physics stays circular; these only
// change how a dot is drawn.
//
// The app is about near-stillness: the slower a dot, the more delicate the
// effect must be, but it must never vanish. Strengths therefore follow a
// logarithmic speed curve, log(1 + speed / knee) / log(1 + full / knee),
// which spends most of its range on speeds a player can barely see, and
// nothing switches off at a threshold.

import type { BodyShape } from '../sim/settings';

export type MotionFx = {
  shape: BodyShape;
  // The shape turns to the direction of motion (Star, Fish and Sparkle).
  shapeTurn: boolean;
  // Sparkle spike curvature, -1 to 1; see rayShapeExponent.
  shapeCurve: number;
  // Multiplier on the body's own alphas (1 = the original look).
  opacity: number;
  rays: boolean;
  // Rays turn with the direction of motion; off keeps a fixed upright X,
  // which the user found calmer.
  raysTurn: boolean;
  // Spike outline curvature, -1 to 1; see rayShapeExponent.
  raysCurve: number;
  trail: boolean;
  // Tail / Trail opacity and length multipliers.
  trailOpacity: number;
  trailLength: number;
  // Afterglow buffer: the body leaves a fading glow along its path.
  afterglow: boolean;
  // Afterglow opacity and time-stretch multipliers.
  afterglowStrength: number;
  afterglowLength: number;
};

export const NO_MOTION_FX: MotionFx = {
  shape: 'circle',
  shapeTurn: false,
  shapeCurve: -0.75,
  opacity: 1,
  rays: false,
  raysTurn: false,
  raysCurve: -0.75,
  trail: false,
  trailOpacity: 1,
  trailLength: 1,
  afterglow: false,
  afterglowStrength: 1,
  afterglowLength: 1,
};

// The `Curve` setting maps to the spike's superellipse exponent 2^curve:
// 1 is the original brush-tip ellipse, 0 straight sides, and -1 sides that
// curve inwards (an astroid, the four-cusp hypocycloid, is about -0.585).
export const RAY_CURVE_MIN = -1;
export const RAY_CURVE_MAX = 1;

export function rayShapeExponent(curve: number) {
  const value = Number.isFinite(curve) ? curve : RAY_CURVE_MAX;
  return 2 ** Math.max(RAY_CURVE_MIN, Math.min(value, RAY_CURVE_MAX));
}

// Only shapes with a front can turn; a circle looks the same at every
// angle.
export function shapeTurns(shape: BodyShape) {
  return shape === 'fish' || shape === 'star' || shape === 'sparkle';
}

// `Sparkle` is light, not a solid body: like the old `None` it has no
// outline to cut out of the afterglow (which becomes a stroke), and the
// ball trail runs into its centre.
export function hasSolidBody(shape: BodyShape) {
  return shape !== 'sparkle';
}

// Body rotation for a heading (0 = +x). The fish's head faces +x; the star
// points up, so a quarter turn puts one point in front. A turning sparkle
// follows the heading like Rays `Turn`.
export function shapeRotation(shape: BodyShape, turn: boolean, heading: number) {
  if (!turn || !shapeTurns(shape)) {
    return 0;
  }
  return shape === 'star' ? heading + Math.PI / 2 : heading;
}

// Sparkle: the Rays X at the rays' rest size, whatever the speed.
export function sparkleScale(radius: number) {
  return rayScale(0, radius);
}

export type SpeedCurve = { knee: number; full: number };

// Dots: calm drifting is about 30-150 world units/s, fast play 600-1000,
// and "is it moving at all" is about 1-5.
export const DOT_CURVE: SpeedCurve = { knee: 3, full: 1000 };
// The ball is driven much faster (max 5200).
export const BALL_CURVE: SpeedCurve = { knee: 10, full: 3000 };

// Trail length from the dot centre backwards, in radii. One radius is under
// the body, so length 1 shows nothing and the tail grows out continuously.
const TRAIL_REST_RADII = 1;
export const TRAIL_MAX_RADII = 19;
const TRAIL_MAX_ALPHA = 1;
// Below this factor the trail's opacity eases toward 0 instead of cutting
// off, so a dot coming to rest keeps a faint, shrinking tail.
const TRAIL_FADE_FACTOR = 0.15;
const TRAIL_SLOW_ALPHA = 0.7;
// Rays are always on. The spikes fade toward their tips, so a flare radius
// of 2.5 radii shows about one radius of X beyond the body at rest.
const RAY_REST_RADII = 2.5;
const RAY_MAX_RADII = 5;
const RAY_REST_ALPHA = 0.35;
const RAY_MAX_ALPHA = 0.95;

// Ball trail: path history kept for this long, sampled at this interval.
// How much of it is drawn is limited by path length (BALL_TRAIL_MAX_RADII),
// so a slow ball shows its whole recent path and a fast one a fixed length.
export const BALL_TRAIL_SECONDS = 2.5;
export const BALL_TRAIL_SAMPLE_MS = 16;
export const BALL_TRAIL_MAX_RADII = 12;

// Afterglow (afterglow.ts), design knobs:
// - AFTERGLOW_SECONDS: how long a fast body's glow lives.
// - AFTERGLOW_FADE_SECONDS: the glow's light falls to 37% after this long
//   (to 5% after three times this), at any frame rate.
// - AFTERGLOW_MIN_LENGTH_RADII: a slower body's glow lives longer, so that
//   it reaches at least this many radii behind the body.
// - AFTERGLOW_MAX_SECONDS: the longest any glow lives, so an almost still
//   body does not paint for long.
// - AFTERGLOW_STRENGTH: opacity of the glow at its brightest.
export const AFTERGLOW_SECONDS = 0.9;
export const AFTERGLOW_FADE_SECONDS = 0.6;
export const AFTERGLOW_MIN_LENGTH_RADII = 6;
export const AFTERGLOW_MAX_SECONDS = 3;
export const AFTERGLOW_STRENGTH = 0.45;

// Seconds the glow left by a body at this speed lives (on its centre line):
// long enough to reach the minimum length, within the limits. Below the
// speed that needs the longest life, the life shrinks back toward the
// short one, so an almost still (jittering) body does not paint for long.
export function afterglowLife(speed: number, radius: number) {
  const minLength = AFTERGLOW_MIN_LENGTH_RADII * Math.max(radius, 0);
  if (!(speed > 0) || !(minLength > 0)) {
    return AFTERGLOW_SECONDS;
  }
  const slowest = minLength / AFTERGLOW_MAX_SECONDS;
  if (speed < slowest) {
    return AFTERGLOW_SECONDS + (AFTERGLOW_MAX_SECONDS - AFTERGLOW_SECONDS) * (speed / slowest);
  }
  return Math.min(Math.max(minLength / speed, AFTERGLOW_SECONDS), AFTERGLOW_MAX_SECONDS);
}

// A longer-lived glow is drawn dimmer, so that slow bodies leave a longer
// but quieter glow: colour brightness sqrt(short life / life).
export function afterglowBrightness(life: number) {
  return life > AFTERGLOW_SECONDS ? Math.sqrt(AFTERGLOW_SECONDS / life) : 1;
}

// A colour with its brightness scaled, for a dimmer glow.
export function scaleColor(rgb: number, scale: number) {
  const k = Math.max(0, Math.min(scale, 1));
  const r = Math.round(((rgb >> 16) & 0xff) * k);
  const g = Math.round(((rgb >> 8) & 0xff) * k);
  const b = Math.round((rgb & 0xff) * k);
  return (r << 16) | (g << 8) | b;
}

// The tint a stamp uses for a glow of this life: the colour, dimmed by
// afterglowBrightness and scaled by AFTERGLOW_SECONDS / life, because the
// stamp's opacity (life / AFTERGLOW_MAX_SECONDS) also multiplies its light.
// `age` stamps the glow as if it were that many seconds old already: its
// opacity is then (life - age) / AFTERGLOW_MAX_SECONDS, and its light has
// faded by that much.
export function afterglowTint(rgb: number, life: number, age = 0) {
  const seconds = Math.max(life, AFTERGLOW_SECONDS);
  const stored = Math.max(seconds - Math.max(age, 0), 1e-3);
  const light = Math.exp(-Math.max(age, 0) / AFTERGLOW_FADE_SECONDS);
  return scaleColor(rgb, (afterglowBrightness(seconds) * AFTERGLOW_SECONDS * light) / stored);
}

// Share of the longest life that one frame of this length uses up. The
// glow is aged by time, not by frame count. A long stall clears it.
export function afterglowDecay(seconds: number) {
  return seconds > 0 ? seconds / AFTERGLOW_MAX_SECONDS : 0;
}

export function speedFactor(speed: number, curve: SpeedCurve = DOT_CURVE) {
  if (!(speed > 0) || !(curve.knee > 0) || !(curve.full > 0)) {
    return 0;
  }
  return Math.min(Math.log1p(speed / curve.knee) / Math.log1p(curve.full / curve.knee), 1);
}

// Streak length in world units, measured from the dot centre backwards.
// `scale` (the Tail `Length`) stretches the growth; the rest length stays
// under the body.
export function trailLength(factor: number, radius: number, scale = 1) {
  if (!(radius > 0)) {
    return 0;
  }
  const growth = Math.max(Number.isFinite(scale) ? scale : 1, 0);
  return radius * (TRAIL_REST_RADII + (TRAIL_MAX_RADII - TRAIL_REST_RADII) * factor * growth);
}

// An alpha times a multiplier, kept within 0..1.
export function scaledAlpha(alpha: number, multiplier: number) {
  const value = alpha * multiplier;
  return Number.isFinite(value) ? Math.max(0, Math.min(value, 1)) : 0;
}

export function trailAlpha(factor: number) {
  if (!(factor > 0)) {
    return 0;
  }
  if (factor < TRAIL_FADE_FACTOR) {
    const t = factor / TRAIL_FADE_FACTOR;
    return TRAIL_SLOW_ALPHA * t * (2 - t);
  }
  const t = (factor - TRAIL_FADE_FACTOR) / (1 - TRAIL_FADE_FACTOR);
  return TRAIL_SLOW_ALPHA + (TRAIL_MAX_ALPHA - TRAIL_SLOW_ALPHA) * t;
}

// Flare radius (centre to spike tip); the X keeps its shape, so it scales
// evenly.
export function rayScale(factor: number, radius: number) {
  return radius * (RAY_REST_RADII + (RAY_MAX_RADII - RAY_REST_RADII) * factor);
}

export function rayAlpha(factor: number) {
  return RAY_REST_ALPHA + (RAY_MAX_ALPHA - RAY_REST_ALPHA) * Math.max(0, Math.min(factor, 1));
}

// Exponentially smoothed travel direction. Near rest the velocity direction
// is mostly contact noise, so the slower the dot, the slower its heading
// turns; a resting dot keeps the last direction it had.
const HEADING_MIN_FOLLOW = 0.04;

export function followDirection(
  dirX: number,
  dirY: number,
  vx: number,
  vy: number,
  speed: number,
  factor: number,
): [number, number] {
  if (!(speed > 0)) {
    return [dirX, dirY];
  }
  const follow = HEADING_MIN_FOLLOW + (1 - HEADING_MIN_FOLLOW) * factor * factor;
  const x = dirX + (vx / speed - dirX) * follow;
  const y = dirY + (vy / speed - dirY) * follow;
  const length = Math.hypot(x, y);
  return length > 1e-6 ? [x / length, y / length] : [vx / speed, vy / speed];
}

export function headingOf(vx: number, vy: number) {
  return vx === 0 && vy === 0 ? 0 : Math.atan2(vy, vx);
}

// Peak-hold with exponential decay for the ball's speed and heading. The
// pointer drive snaps the ball onto the pointer in one step, so frames with
// no new pointer event report speed 0; without the hold the rays strobe.
export class SpeedHold {
  private speed = 0;
  private heading = 0;
  private time = -1;

  constructor(private readonly decaySeconds = 0.12) {}

  update(speed: number, vx: number, vy: number, time: number) {
    const dt = this.time < 0 ? 0 : Math.max(time - this.time, 0) / 1000;
    this.time = time;
    const held = this.speed * Math.exp(-dt / this.decaySeconds);
    if (speed > 0 && speed >= held) {
      this.speed = speed;
      this.heading = headingOf(vx, vy);
    } else {
      this.speed = held;
    }
    return { speed: this.speed, heading: this.heading };
  }

  reset() {
    this.speed = 0;
    this.time = -1;
  }
}

export type TrailPoint ={ x: number; y: number; time: number };

// Time-sampled position history for the ball trail. Points closer than the
// sample interval are skipped so the trail length does not depend on FPS.
export class TrailHistory {
  private readonly points: TrailPoint[] = [];

  constructor(
    private readonly durationMs = BALL_TRAIL_SECONDS * 1000,
    private readonly sampleMs = BALL_TRAIL_SAMPLE_MS,
  ) {}

  get length() {
    return this.points.length;
  }

  // Newest first.
  at(index: number) {
    return this.points[this.points.length - 1 - index];
  }

  push(x: number, y: number, time: number) {
    const last = this.points[this.points.length - 1];
    if (last && time - last.time < this.sampleMs) {
      last.x = x;
      last.y = y;
      return;
    }

    this.points.push({ x, y, time });
    while (this.points.length > 0 && time - this.points[0].time > this.durationMs) {
      this.points.shift();
    }
  }

  clear() {
    this.points.length = 0;
  }
}
