// The `Fish` shape (PoC): a fish seen from above, and how its body bends.
// Pure geometry, no drawing, so it can be tested and reused by both the
// particle mesh and the ball's vector path.
//
// Units are physics radii, centred on the physics disc, nose toward +x. The
// outline is a spindle: a rounded, slightly pointed nose, widest a little
// behind the disc centre (so it always covers the disc), then a long taper;
// it is about 4 body widths long, with two pectoral fins behind the head and
// a fan-shaped tail fin that is not split (from above, a tail fin shows
// nearly edge-on). The tail length does not depend on speed.
//
// The body bends along a spine measured by arc length behind the disc
// centre. Bending changes the spine's direction, not just its sideways
// offset, so the body keeps its length even in a tight C-shaped turn. The
// part in front of the disc centre stays rigid, so the head stays on the
// physics position.

export type Polygon = Array<[number, number]>;

// phase: tail-beat phase in radians. swing: beat size, 0 (still) to 1.
// curl: turn bend, -1 to 1; positive bends toward +y, the inside of a turn
// whose heading angle is increasing.
export type FishPose = { phase: number; swing: number; curl: number };

export const STRAIGHT_FISH: FishPose = { phase: 0, swing: 0, curl: 0 };

export const FISH_NOSE_RADII = 1.35;
export const FISH_TAIL_RADII = 8;
export const FISH_LENGTH_RADII = FISH_NOSE_RADII + FISH_TAIL_RADII;
// Furthest reach sideways of the straight fish (pectoral fins).
export const FISH_HALF_SPAN_RADII = 2.4;

// Beat: a wave travels from head to tail. The spine's angle swings by up to
// FISH_BEAT_ANGLE at the tail tip, growing as u^1.5 along the body; at swing
// 1 the tail tip moves about +-0.7 radii.
export const FISH_BEAT_ANGLE = 0.4;
const FISH_WAVES_ON_BODY = 0.8;
// Turn: the spine's direction changes by up to FISH_CURL_ANGLE from head
// to tail. The body gets thinner toward the tail, and the tail fin is
// thinnest, so it bends most there: the bend angle grows as
// FISH_CURL_EVEN * u + (1 - FISH_CURL_EVEN) * u^3, which makes the
// curvature about 6.6 times larger at the tail tip than near the head.
// These two numbers are the curl's design knobs: total bend and how much
// of it goes to the tail. The user tried 2.2 rad, then 4.4 rad (the tail
// wrapped too far), and chose the middle (2026-11-03).
export const FISH_CURL_ANGLE = 3.3;
const FISH_CURL_EVEN = 0.35;

// Widest point, and its half-width; a little wider than the disc.
const FISH_WIDEST_X = -1;
const FISH_WIDEST_HALF = 1.15;
const FISH_PEDUNCLE_X = -6.3;
const FISH_PEDUNCLE_HALF = 0.12;
const FISH_TAIL_FIN_HALF = 0.5;
// The last part of the fan rounds off to the tip.
const FISH_TAIL_ROUND = 0.25;
const FISH_FIN_ROOT = 1.6;
const FISH_FIN_LENGTH = 1.4;
const FISH_FIN_HALF = 0.32;
const FISH_FIN_ANGLE = (50 * Math.PI) / 180;
// Pectoral fins scull a little, in opposite directions, with the beat.
const FISH_FIN_SCULL = (8 * Math.PI) / 180;

// Body half-width at x (straight fish).
export function fishHalfWidth(x: number) {
  if (x >= FISH_NOSE_RADII || x <= -FISH_TAIL_RADII) {
    return 0;
  }
  if (x >= FISH_WIDEST_X) {
    // Head: a quarter ellipse from the nose to the widest point.
    const t = (x - FISH_WIDEST_X) / (FISH_NOSE_RADII - FISH_WIDEST_X);
    return FISH_WIDEST_HALF * Math.sqrt(1 - t * t);
  }
  if (x >= FISH_PEDUNCLE_X) {
    const t = (x - FISH_WIDEST_X) / (FISH_PEDUNCLE_X - FISH_WIDEST_X);
    return FISH_PEDUNCLE_HALF
      + (FISH_WIDEST_HALF - FISH_PEDUNCLE_HALF) * Math.cos((t * Math.PI) / 2) ** 1.4;
  }
  // Tail fin: a fan that flares out of the narrow peduncle, then rounds off.
  const t = (x - FISH_PEDUNCLE_X) / (-FISH_TAIL_RADII - FISH_PEDUNCLE_X);
  const open = 1 - FISH_TAIL_ROUND;
  if (t <= open) {
    return FISH_PEDUNCLE_HALF
      + (FISH_TAIL_FIN_HALF - FISH_PEDUNCLE_HALF) * Math.sin(((t / open) * Math.PI) / 2) ** 1.2;
  }
  const end = (t - open) / FISH_TAIL_ROUND;
  return FISH_TAIL_FIN_HALF * Math.sqrt(1 - end * end);
}

// The spine behind the disc centre. Point j sits at arc length `s[j]`; its
// straight-fish x is -s[j]. With `tailDensity` 0 the points are evenly
// spaced; above 0 (up to 1) the segments shorten toward the tail, where the
// bend is strongest (0.5 makes the last segment a third of the first).
// `angle[j]` is the body direction there (toward the nose), so the normal
// toward +y is (-sin, cos). Tables are precomputed, so one pose costs two
// trig calls per segment plus two per fish.
export class FishSpine {
  readonly s: Float64Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly angle: Float64Array;
  private readonly segmentLength: Float64Array;
  private readonly beatSize: Float64Array;
  private readonly waveCos: Float64Array;
  private readonly waveSin: Float64Array;
  private readonly curlSize: Float64Array;

  constructor(readonly length: number, readonly segments: number, tailDensity = 0) {
    this.s = new Float64Array(segments + 1);
    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments;
      this.s[index] = length * (t + tailDensity * (t - t * t));
    }
    this.segmentLength = new Float64Array(segments);
    this.x = new Float64Array(segments + 1);
    this.y = new Float64Array(segments + 1);
    this.angle = new Float64Array(segments + 1);
    this.beatSize = new Float64Array(segments);
    this.waveCos = new Float64Array(segments);
    this.waveSin = new Float64Array(segments);
    this.curlSize = new Float64Array(segments);
    for (let index = 0; index < segments; index += 1) {
      this.segmentLength[index] = this.s[index + 1] - this.s[index];
      // Midpoint of the segment, as a share of the tail length.
      const u = (this.s[index] + this.s[index + 1]) / 2 / FISH_TAIL_RADII;
      this.beatSize[index] = FISH_BEAT_ANGLE * u ** 1.5;
      this.waveCos[index] = Math.cos(2 * Math.PI * FISH_WAVES_ON_BODY * u);
      this.waveSin[index] = Math.sin(2 * Math.PI * FISH_WAVES_ON_BODY * u);
      this.curlSize[index] = -FISH_CURL_ANGLE * (FISH_CURL_EVEN * u + (1 - FISH_CURL_EVEN) * u ** 3);
    }
  }

  compute(pose: FishPose) {
    const { x, y, angle } = this;
    const sinPhase = Math.sin(pose.phase) * pose.swing;
    const cosPhase = Math.cos(pose.phase) * pose.swing;
    let previous = 0;
    for (let index = 0; index < this.segments; index += 1) {
      // sin(phase - wave) = sin(phase)cos(wave) - cos(phase)sin(wave)
      const theta = this.beatSize[index] * (sinPhase * this.waveCos[index] - cosPhase * this.waveSin[index])
        + this.curlSize[index] * pose.curl;
      const step = this.segmentLength[index];
      x[index + 1] = x[index] - step * Math.cos(theta);
      y[index + 1] = y[index] - step * Math.sin(theta);
      angle[index] = index === 0 ? 0 : (previous + theta) / 2;
      previous = theta;
    }
    angle[this.segments] = previous;
    return this;
  }
}

// Fine spine for outlines (the ball, and the texture the mesh bends).
const OUTLINE_SPINE = new FishSpine(FISH_TAIL_RADII, 160);
const FIN_ROOT_INDEX = Math.round((FISH_FIN_ROOT / FISH_TAIL_RADII) * OUTLINE_SPINE.segments);

// Body, then the two pectoral fins, for one pose. Fins are separate polygons
// drawn over the body.
export function fishParts(pose: FishPose = STRAIGHT_FISH): Polygon[] {
  const spine = OUTLINE_SPINE.compute(pose);
  const upper: Polygon = [];
  const lower: Polygon = [];
  // Rigid head front, denser near the nose where the outline curves fast.
  const headSteps = 16;
  for (let index = 0; index < headSteps; index += 1) {
    const x = FISH_NOSE_RADII * Math.cos(((index / headSteps) * Math.PI) / 2);
    const w = fishHalfWidth(x);
    upper.push([x, w]);
    lower.push([x, -w]);
  }
  for (let index = 0; index <= spine.segments; index += 1) {
    const w = fishHalfWidth(-spine.s[index]);
    const nx = -Math.sin(spine.angle[index]);
    const ny = Math.cos(spine.angle[index]);
    upper.push([spine.x[index] + nx * w, spine.y[index] + ny * w]);
    lower.push([spine.x[index] - nx * w, spine.y[index] - ny * w]);
  }
  // Nose and tail tip are shared by both sides.
  const body: Polygon = [...upper, ...lower.slice(1, -1).reverse()];

  const rootX = spine.x[FIN_ROOT_INDEX];
  const rootY = spine.y[FIN_ROOT_INDEX];
  const rootAngle = spine.angle[FIN_ROOT_INDEX];
  const tx = Math.cos(rootAngle);
  const ty = Math.sin(rootAngle);
  const rootHalf = fishHalfWidth(-FISH_FIN_ROOT);
  const fin = (side: 1 | -1) => {
    const angle = FISH_FIN_ANGLE + side * FISH_FIN_SCULL * pose.swing * Math.sin(pose.phase);
    // Backward along the body, turned outward to this side.
    const dx = -tx * Math.cos(angle) - side * ty * Math.sin(angle);
    const dy = -ty * Math.cos(angle) + side * tx * Math.sin(angle);
    const px = -dy;
    const py = dx;
    const bx = rootX - side * ty * (rootHalf - 0.2);
    const by = rootY + side * tx * (rootHalf - 0.2);
    const steps = 16;
    const edge: Polygon = [];
    const other: Polygon = [];
    for (let index = 0; index <= steps; index += 1) {
      const a = index / steps;
      // A paddle: widest a little past the middle, rounded at the tip.
      const h = FISH_FIN_HALF * Math.sin(Math.PI * a) ** 0.6 * (0.7 + 0.3 * a);
      const cx = bx + dx * FISH_FIN_LENGTH * a;
      const cy = by + dy * FISH_FIN_LENGTH * a;
      edge.push([cx + px * h, cy + py * h]);
      other.push([cx - px * h, cy - py * h]);
    }
    return [...edge, ...other.slice(1, -1).reverse()] as Polygon;
  };

  return [body, fin(1), fin(-1)];
}

// Motion. A fish at rest barely moves: a very slow, small beat (one beat in
// 10 s) keeps it alive without looking busy. Faster fish beat faster and
// wider, on the effects' logarithmic speed factor (0 at rest, 1 fast).
const FISH_REST_BEAT_HZ = 0.1;
const FISH_FAST_BEAT_HZ = 3.5;
const FISH_REST_SWING = 0.1;
// Turning: full curl at this heading turn rate (rad/s), reached and
// released over about FISH_CURL_SECONDS.
export const FISH_CURL_FULL_TURN = 4;
const FISH_CURL_SECONDS = 0.12;

function clamp01(value: number) {
  return Math.max(0, Math.min(value, 1));
}

export function fishBeatHz(factor: number) {
  return FISH_REST_BEAT_HZ + (FISH_FAST_BEAT_HZ - FISH_REST_BEAT_HZ) * clamp01(factor);
}

export function fishSwing(factor: number) {
  return FISH_REST_SWING + (1 - FISH_REST_SWING) * clamp01(factor);
}

// Signed smallest turn from one heading to the next, in (-pi, pi].
export function headingDelta(from: number, to: number) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) {
    delta -= Math.PI * 2;
  } else if (delta <= -Math.PI) {
    delta += Math.PI * 2;
  }
  return delta;
}

// The turn rate eases toward the measured one. It is smoothed before it is
// limited: a heading that only changes on some frames (the pointer-driven
// ball) gives rates that alternate between 0 and double, and limiting each
// one first would halve the curl.
export function followTurnRate(rate: number, measured: number, seconds: number) {
  if (!(seconds > 0)) {
    return rate;
  }
  return rate + (measured - rate) * (1 - Math.exp(-seconds / FISH_CURL_SECONDS));
}

// Share of full curl for a smoothed turn rate.
export function curlForTurnRate(rate: number) {
  return Math.max(-1, Math.min(rate / FISH_CURL_FULL_TURN, 1));
}

// Per-fish beat and curl state. One per particle (or the ball).
export class FishMotion {
  phase: number;
  private turnRate = 0;
  private heading: number | null = null;

  constructor(phase = 0) {
    this.phase = phase;
  }

  // `heading` is the body's facing (null while the shape does not turn,
  // which also releases the curl).
  update(factor: number, heading: number | null, seconds: number): FishPose {
    this.phase = (this.phase + Math.PI * 2 * fishBeatHz(factor) * seconds) % (Math.PI * 2);
    let measured = 0;
    if (heading !== null && this.heading !== null && seconds > 0) {
      measured = headingDelta(this.heading, heading) / seconds;
    }
    this.heading = heading;
    this.turnRate = followTurnRate(this.turnRate, measured, seconds);
    return { phase: this.phase, swing: fishSwing(factor), curl: curlForTurnRate(this.turnRate) };
  }
}
