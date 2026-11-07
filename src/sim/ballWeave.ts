// `Weave`: the released ball steers around nearby particles by itself, like a
// fish swimming between rocks or a bicycle in a crowd. It is the ball's own
// behaviour, not a force between bodies: particles receive nothing, and the
// ball's speed never changes. See `Ball Weave` in the spec.
//
// `Weight` deliberately plays no part here: one control changes one behaviour.
// See `Design Principles` in the spec.

// Hardest sideways push the ball can make (px/s^2) at `Agility` 50. The turning
// radius is speed^2 / push, so a fast ball cannot turn in time and hits.
export const WEAVE_PUSH = 1000;
// Surface-to-surface distance at which the ball starts to react (px) at `Sight` 50.
export const WEAVE_RANGE = 40;
// `Agility` 0 to 100 gives a push of 125 to 8000, with 1000 at 50.
export function weavePushFromAgility(agility: number) {
  return WEAVE_PUSH * 2 ** ((3 * (agility - 50)) / 50);
}
// `Sight` 0 to 100 gives a range of 20 to 80, doubling every 50. A wider range
// closes the gaps between particles, so the ball would stop passing through.
export function weaveRangeFromSight(sight: number) {
  return WEAVE_RANGE * 2 ** ((sight - 50) / 50);
}
// Steepest turn (rad/s), which keeps a slow ball from spinning on the spot.
export const WEAVE_MAX_TURN_RATE = 20;
// A wall turn leaves this much clearance to the wall (px).
const WEAVE_WALL_MARGIN = 8;
// A wall turn ends heading away from the wall at no less than this, about 20
// degrees, so a shallow approach does not run along the wall.
const WEAVE_WALL_MIN_EXIT = 0.35;
// A particle this far off the ball's line (px) gets the full sideways reaction.
// Closer to the line the reaction fades, so a dead-centre approach still hits.
const WEAVE_SIDE_SOFTNESS = 6;
// Below this speed (px/s) the ball has no direction worth steering.
const WEAVE_MIN_SPEED = 5;

type Vector = { x: number; y: number };

export function weaveVelocity(
  velocity: Vector,
  ball: Vector,
  contactDistance: number,
  particles: readonly Vector[],
  dt: number,
  maxPush = WEAVE_PUSH,
  range = WEAVE_RANGE,
): Vector {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (speed < WEAVE_MIN_SPEED) {
    return velocity;
  }

  const forwardX = velocity.x / speed;
  const forwardY = velocity.y / speed;
  let push = 0;

  for (const particle of particles) {
    const toX = particle.x - ball.x;
    const toY = particle.y - ball.y;
    const distance = Math.hypot(toX, toY);
    const gap = distance - contactDistance;
    const ahead = toX * forwardX + toY * forwardY;
    if (gap >= range || ahead <= 0 || distance <= 0.001) {
      continue;
    }

    // Left of the line pushes right and the other way round, so the two sides
    // of a gap cancel at its centre.
    const lateral = toY * forwardX - toX * forwardY;
    const side = clamp(lateral / WEAVE_SIDE_SOFTNESS, -1, 1);
    const near = clamp((range - gap) / range, 0, 1);
    push -= side * maxPush * near * near * (3 - 2 * near) * (ahead / distance);
  }

  return turned(velocity, speed, push, dt);
}

// A turn in progress in front of a wall: the wall's outward direction, which way
// to turn, and the angle left to turn (radians). Counting the angle, rather than
// waiting for a heading, always ends: the heading moves in steps and can miss it.
export type WallTurn = { normalX: number; normalY: number; sign: number; remaining: number };

// Starts a turn at the last moment that still clears a wall, and keeps it until
// the heading mirrors the approach, like a bounce with no contact. A contact ends
// the turn, so the ball is not held against particles piled at the wall. It is
// not smart enough to watch particles during the turn, which is intended.
export function nextWallTurn(
  current: WallTurn | null,
  velocity: Vector,
  ball: Vector,
  ballRadius: number,
  width: number,
  height: number,
  maxPush: number,
  contact: boolean,
): WallTurn | null {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (contact || speed < WEAVE_MIN_SPEED) {
    return null;
  }

  const forwardX = velocity.x / speed;
  const forwardY = velocity.y / speed;
  const radius = Math.max((speed * speed) / maxPush, speed / WEAVE_MAX_TURN_RATE);
  const walls = [
    [-1, 0, ball.x - ballRadius],
    [1, 0, width - ball.x - ballRadius],
    [0, -1, ball.y - ballRadius],
    [0, 1, height - ball.y - ballRadius],
  ];
  let turn = current && current.remaining > 0 ? current : null;

  for (const [normalX, normalY, distance] of walls) {
    const heading = forwardX * normalX + forwardY * normalY;
    if (heading <= 0.02 || (turn && turn.normalX === normalX && turn.normalY === normalY)) {
      continue;
    }
    // The distance a circle of this radius needs to become parallel to the wall.
    const clearance = radius * (1 - Math.sqrt(Math.max(0, 1 - heading * heading)));
    if (distance <= clearance + WEAVE_WALL_MARGIN) {
      turn = {
        normalX,
        normalY,
        sign: forwardX * normalY - forwardY * normalX >= 0 ? -1 : 1,
        // From the approach to parallel, then on to the mirror of the approach.
        remaining: Math.asin(Math.min(heading, 1)) + Math.asin(Math.max(Math.min(heading, 1), WEAVE_WALL_MIN_EXIT)),
      };
    }
  }

  return turn;
}

// Turns by this step's share of the wall turn, and counts it off the turn.
export function wallTurnVelocity(velocity: Vector, turn: WallTurn, maxPush: number, dt: number): Vector {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (speed < WEAVE_MIN_SPEED) {
    return velocity;
  }
  const rate = Math.min(maxPush / speed, WEAVE_MAX_TURN_RATE);
  const angle = Math.min(rate * dt, turn.remaining);
  turn.remaining -= angle;
  return rotated(velocity, turn.sign * angle);
}

function turned(velocity: Vector, speed: number, push: number, dt: number): Vector {
  return rotated(velocity, clamp(push / speed, -WEAVE_MAX_TURN_RATE, WEAVE_MAX_TURN_RATE) * dt);
}

function rotated(velocity: Vector, angle: number): Vector {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: velocity.x * cos - velocity.y * sin,
    y: velocity.x * sin + velocity.y * cos,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
