// Experimental motion effects (PoC): light rays, comet trail and star shape.
// Physics stays circular; these only change how a moving dot is drawn.
//
// The app is about near-stillness: the slower a dot, the more delicate the
// effect must be, but it must never vanish. Strengths therefore follow a
// logarithmic speed curve, log(1 + speed / knee) / log(1 + full / knee),
// which spends most of its range on speeds a player can barely see, and
// nothing switches off at a threshold.

export type MotionFx = {
  rays: boolean;
  // Rays turn with the direction of motion; off keeps a fixed upright X,
  // which the user found calmer.
  raysTurn: boolean;
  trail: boolean;
  star: boolean;
};

export const NO_MOTION_FX: MotionFx = { rays: false, raysTurn: false, trail: false, star: false };

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

export function speedFactor(speed: number, curve: SpeedCurve = DOT_CURVE) {
  if (!(speed > 0) || !(curve.knee > 0) || !(curve.full > 0)) {
    return 0;
  }
  return Math.min(Math.log1p(speed / curve.knee) / Math.log1p(curve.full / curve.knee), 1);
}

// Streak length in world units, measured from the dot centre backwards.
export function trailLength(factor: number, radius: number) {
  if (!(radius > 0)) {
    return 0;
  }
  return radius * (TRAIL_REST_RADII + (TRAIL_MAX_RADII - TRAIL_REST_RADII) * factor);
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
