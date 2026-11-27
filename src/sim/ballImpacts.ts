// Moves the Ball from impact to impact within one step (`?bc=impact`, spec
// `Proposed Ball Moves From Impact to Impact`). Motion, sound and loudness all
// come from impacts that happened: the Ball goes to its next impact with a
// particle or a wall, the masses decide what follows, and it goes on with the
// time that is left.
//
// Pure code. Works on the particle arrays of `OverlapParticles`; particles
// never touch each other.

import {
  DISC_INERTIA,
  OVERLAP_PUSH_OUT,
  OVERLAP_RESTING_SPEED,
  TOUCH_DISTANCE,
} from './overlapConstants';

// Named knobs. Each one shapes one behaviour.
// Times the Ball may be turned by impacts, and its path looked up again,
// within one step. After that it keeps hitting what its last path meets, so a
// dense crowd stays cheap.
export const IMPACT_MAX_TURNS = 8;
// A held Ball follows the pointer continuously: it aims again this many times
// per step, so it follows a round dot instead of leaving it on a straight line.
export const IMPACT_HELD_SLICES = 4;

// Numerical tolerances, not behaviour.
// A pair closer than this (px) is in contact: solved together, not hit again.
const SKIN = 0.02;
// Impacts turn the Ball when together they move the rest of its step by more
// than this (px); lighter touches do not change what the Ball meets next.
const TURN_DISTANCE = 0.1;
// Least part of the Ball's momentum a held Ball pushes with.
const MIN_PUSH_SHARE = 0.02;
// A planned impact still happens when the Ball comes this close (px).
const MEET_DISTANCE = 0.5;
// Solver passes over contacts that act together. A notch between two dots
// needs about 12 to settle; a single contact stops after one. A crowd of
// contacts gets fewer, about `SOLVE_WORK` contact visits in all.
const MAX_PASSES = 24;
const MIN_PASSES = 2;
const SOLVE_WORK = 400;
const SETTLED_SPEED = 0.01;
// Each turn looks at every near dot again. In a crowd the turns are limited to
// about this many looks in all.
const TURN_WORK = 4000;

const WALL_LEFT = 1;
const WALL_RIGHT = 2;
const WALL_TOP = 4;
const WALL_BOTTOM = 8;
const WALLS = [WALL_LEFT, WALL_RIGHT, WALL_TOP, WALL_BOTTOM];

export type ImpactBall = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  friction: number;
  angvel: number;
  // The pointer holds the Ball: `vx`, `vy` are then the command to reach the
  // pointer within the step, not the Ball's own speed.
  held?: boolean;
};

export type ImpactParams = {
  width: number;
  height: number;
  radius: number;
  mass: number;
  friction: number;
  restitution: number;
  wallRestitution: number;
};

// The particle state this works on (`OverlapParticles`).
export type ImpactParticles = {
  readonly count: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly angvel: Float64Array;
  // Touching the Ball at the end of the previous step.
  readonly ballTouch: Uint8Array;
  // Hit this step, and the relative speed of the first hit.
  readonly ballPushed: Uint8Array;
  readonly ballHitEnergy: Float64Array;
};

// The Ball at the end of the step.
export type BallEnd = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angvel: number;
  // Speed of the Ball after each wall it began to touch in this step.
  wallHits: number[];
};

export class BallImpactWalk {
  // Walls the Ball touched at the end of the previous step.
  private wallTouch = 0;

  // Scratch, reused every step.
  private near = new Int32Array(64);
  private nearCount = 0;
  private nearSpeed = -1;
  // Step time (0..1) at which `x`, `y` of a particle are valid. 0 unless an
  // impact or a contact has moved it on.
  private readonly stamp: Float64Array;
  // Planned impacts: a particle index, or -(wall bit).
  private eventWhat = new Int32Array(64);
  private eventTime = new Float64Array(64);
  private order: number[] = [];
  private contact = new Int32Array(64);
  private contactNx = new Float64Array(64);
  private contactNy = new Float64Array(64);
  private contactTarget = new Float64Array(64);
  private contactJn = new Float64Array(64);
  private contactJt = new Float64Array(64);
  private wallHit = 0;
  private readonly wallSpeed = new Float64Array(16);

  // The Ball during the walk.
  private bx = 0;
  private by = 0;
  private vx = 0;
  private vy = 0;
  private w = 0;
  private time = 0;

  // The pull of the pointer: where to, and how fast.
  private held = false;
  private targetX = 0;
  private targetY = 0;
  private command = 0;

  private dt = 0;
  private sumR = 0;
  private r = 0;
  private R = 0;
  private friction = 0;
  private restitution = 0;
  private wallRestitution = 0;
  private ballMass = 0;
  private invBall = 0;
  private invParticle = 0;
  private invSum = 0;
  private invInertiaBall = 0;
  private invInertiaParticle = 0;
  private invTangent = 0;
  // Limits of the particle centers and of the Ball's center.
  private left = 0;
  private right = 0;
  private top = 0;
  private bottom = 0;
  private ballLeft = 0;
  private ballRight = 0;
  private ballTop = 0;
  private ballBottom = 0;

  constructor(private readonly dots: ImpactParticles) {
    this.stamp = new Float64Array(dots.count);
  }

  // Runs one step. Positions of hit particles are set so that moving them by
  // their new velocity for the whole step ends at the right place.
  run(dt: number, ball: ImpactBall, params: ImpactParams): BallEnd {
    this.begin(dt, ball, params);
    this.collectNear();

    const slices = this.held ? IMPACT_HELD_SLICES : 1;
    let turns = clamp(Math.floor(TURN_WORK / Math.max(this.nearCount, 1)), 1, IMPACT_MAX_TURNS);
    for (let slice = 0; slice < slices; slice += 1) {
      const end = (slice + 1) / slices;
      this.aim();
      this.settleContacts(end);
      while (this.walkToTurn(end, turns > 0)) {
        turns -= 1;
        this.aim();
        this.settleContacts(end);
      }
      this.advanceBall(end);
    }
    this.finish();
    if (this.held) {
      // No hidden speed: let go now, the Ball goes on as it was seen to move.
      this.vx = (this.bx - ball.x) / dt;
      this.vy = (this.by - ball.y) / dt;
    }
    return {
      x: this.bx,
      y: this.by,
      vx: this.vx,
      vy: this.vy,
      angvel: this.w,
      wallHits: this.takeWallHits(),
    };
  }

  // The Ball is away (`Touch`): it touches no wall when it comes back.
  leave() {
    this.wallTouch = 0;
  }

  private begin(dt: number, ball: ImpactBall, params: ImpactParams) {
    this.dt = dt;
    this.bx = ball.x;
    this.by = ball.y;
    this.vx = ball.vx;
    this.vy = ball.vy;
    this.w = ball.angvel;
    this.time = 0;
    this.held = ball.held === true;
    this.targetX = ball.x + ball.vx * dt;
    this.targetY = ball.y + ball.vy * dt;
    this.command = Math.hypot(ball.vx, ball.vy);
    this.wallHit = 0;
    this.nearSpeed = -1;

    this.r = params.radius;
    this.R = ball.radius;
    this.sumR = this.r + this.R;
    // Rapier's default `Average` combine rule.
    this.friction = (ball.friction + params.friction) * 0.5;
    this.restitution = params.restitution;
    this.wallRestitution = params.wallRestitution;
    this.ballMass = ball.mass;
    this.invParticle = params.mass > 0 ? 1 / params.mass : 0;
    this.invInertiaParticle = this.r > 0 ? this.invParticle / (DISC_INERTIA * this.r * this.r) : 0;
    this.useMassShare(1);

    this.left = this.r;
    this.top = this.r;
    this.right = Math.max(params.width - this.r, this.left);
    this.bottom = Math.max(params.height - this.r, this.top);
    // A field narrower than the Ball holds it in the middle.
    this.ballLeft = Math.min(this.R, params.width * 0.5);
    this.ballTop = Math.min(this.R, params.height * 0.5);
    this.ballRight = params.width - this.ballLeft;
    this.ballBottom = params.height - this.ballTop;
    this.bx = clamp(this.bx, this.ballLeft, this.ballRight);
    this.by = clamp(this.by, this.ballTop, this.ballBottom);
  }

  // Solves with a part of the Ball's mass (see `settleContacts`).
  private useMassShare(share: number) {
    const mass = this.ballMass * share;
    this.invBall = mass > 0 ? 1 / mass : 0;
    this.invSum = this.invBall + this.invParticle;
    this.invInertiaBall = this.R > 0 ? this.invBall / (DISC_INERTIA * this.R * this.R) : 0;
    this.invTangent = this.invSum
      + this.r * this.r * this.invInertiaParticle
      + this.R * this.R * this.invInertiaBall;
  }

  // Particles that the Ball, or their own motion, could bring into contact
  // in the rest of the step. A list made for a faster Ball still holds.
  private collectNear() {
    const { dots, dt } = this;
    const rest = (1 - this.time) * dt;
    const speed = Math.max(Math.hypot(this.vx, this.vy), this.held ? this.command : 0);
    if (speed <= this.nearSpeed) {
      return;
    }
    this.nearSpeed = speed;
    const base = this.sumR + speed * rest + 1;
    this.nearCount = 0;
    for (let k = 0; k < dots.count; k += 1) {
      const dx = this.xAt(k) - this.bx;
      const dy = this.yAt(k) - this.by;
      const reach = base + (Math.abs(dots.vx[k]) + Math.abs(dots.vy[k])) * rest;
      if (dx * dx + dy * dy <= reach * reach) {
        if (this.nearCount === this.near.length) {
          this.near = growInt(this.near);
        }
        this.near[this.nearCount] = k;
        this.nearCount += 1;
      }
    }
  }

  private xAt(k: number) {
    return this.dots.x[k] + this.dots.vx[k] * (this.time - this.stamp[k]) * this.dt;
  }

  private yAt(k: number) {
    return this.dots.y[k] + this.dots.vy[k] * (this.time - this.stamp[k]) * this.dt;
  }

  // Puts a particle at its place at the current time of the walk.
  private bring(k: number) {
    const x = this.xAt(k);
    const y = this.yAt(k);
    this.dots.x[k] = x;
    this.dots.y[k] = y;
    this.stamp[k] = this.time;
  }

  private advanceBall(time: number) {
    const span = (time - this.time) * this.dt;
    this.bx = clamp(this.bx + this.vx * span, this.ballLeft, this.ballRight);
    this.by = clamp(this.by + this.vy * span, this.ballTop, this.ballBottom);
    this.time = time;
  }

  // A held Ball has no momentum of its own: it heads for the pointer with the
  // time that is left, never faster than the command of this step.
  private aim() {
    if (!this.held || this.time === 0) {
      return;
    }
    const rest = (1 - this.time) * this.dt;
    const dx = this.targetX - this.bx;
    const dy = this.targetY - this.by;
    const distance = Math.hypot(dx, dy);
    if (rest <= 0 || distance < 1e-9) {
      this.vx = 0;
      this.vy = 0;
      return;
    }
    const speed = Math.min(distance / rest, this.command);
    this.vx = (dx / distance) * speed;
    this.vy = (dy / distance) * speed;
  }

  // Solves every contact at the Ball together. Pressing is not hitting: a
  // held Ball pushes the dots it already touches and does not bounce off them
  // again on every step. The pull gives it the command's momentum once per step,
  // so until `end` it pushes with that part of it; otherwise the push on the
  // dots would grow with the number of times it aims again.
  private settleContacts(end: number) {
    const { dots } = this;
    this.useMassShare(this.held ? Math.max(end - this.time, MIN_PUSH_SHARE) : 1);
    let count = 0;
    const limit = (this.sumR + SKIN) * (this.sumR + SKIN);
    for (let n = 0; n < this.nearCount; n += 1) {
      const k = this.near[n];
      const dx = this.xAt(k) - this.bx;
      const dy = this.yAt(k) - this.by;
      if (dx * dx + dy * dy > limit) {
        continue;
      }
      this.bring(k);
      count = this.addContact(count, k);
      const c = count - 1;
      const vn = this.approach(c);
      if (vn >= 0) {
        continue;
      }
      const fresh = !dots.ballTouch[k] && !dots.ballPushed[k];
      if ((!this.held || fresh) && vn < -OVERLAP_RESTING_SPEED) {
        this.contactTarget[c] = -this.restitution * vn;
      }
      this.recordHit(k);
    }
    this.solve(count);
    this.useMassShare(1);
  }

  // Moves the Ball to the next impact that turns it, resolving the lighter
  // ones on the way. Returns false when nothing turns it before `end`, or when
  // it may not turn any more (`mayTurn`).
  private walkToTurn(end: number, mayTurn: boolean) {
    const events = this.planImpacts(end);
    const planVx = this.vx;
    const planVy = this.vy;
    const meet = (this.sumR + MEET_DISTANCE) * (this.sumR + MEET_DISTANCE);
    for (let e = 0; e < events; e += 1) {
      const slot = this.order[e];
      const what = this.eventWhat[slot];
      this.advanceBall(Math.max(this.eventTime[slot], this.time));
      if (what < 0) {
        if (this.hitWall(-what) && mayTurn) {
          this.solveTouching();
          this.collectNear();
          return true;
        }
        continue;
      }
      const dx = this.xAt(what) - this.bx;
      const dy = this.yAt(what) - this.by;
      if (dx * dx + dy * dy > meet) {
        continue;
      }
      this.bring(what);
      this.addContact(0, what);
      const vn = this.approach(0);
      if (vn >= 0) {
        continue;
      }
      if (vn < -OVERLAP_RESTING_SPEED) {
        this.contactTarget[0] = -this.restitution * vn;
      }
      this.recordHit(what);
      this.solve(1);
      const change = Math.hypot(this.vx - planVx, this.vy - planVy);
      if (mayTurn && change * (1 - this.time) * this.dt > TURN_DISTANCE) {
        // The Ball has a new course: the dots at its surface take part, and
        // the next impacts have to be looked up again.
        this.solveTouching();
        this.collectNear();
        return true;
      }
    }
    return false;
  }

  // A wall has `Wall Bounce` and no friction. A held Ball does not bounce off
  // a wall that it presses against.
  private hitWall(wall: number) {
    const horizontal = (wall & (WALL_LEFT | WALL_RIGHT)) !== 0;
    const sign = wall & (WALL_LEFT | WALL_TOP) ? 1 : -1;
    const inward = (horizontal ? this.vx : this.vy) * sign;
    if (inward >= 0) {
      return false;
    }
    const pressing = this.held && (this.wallTouch & wall) !== 0;
    const away = -inward < OVERLAP_RESTING_SPEED || pressing ? 0 : -inward * this.wallRestitution;
    if (horizontal) {
      this.vx = away * sign;
    } else {
      this.vy = away * sign;
    }
    this.recordWall(wall);
    return true;
  }

  // The contacts at the Ball keep it from entering them; no bounce.
  private solveTouching() {
    let count = 0;
    const limit = (this.sumR + SKIN) * (this.sumR + SKIN);
    for (let n = 0; n < this.nearCount; n += 1) {
      const k = this.near[n];
      const dx = this.xAt(k) - this.bx;
      const dy = this.yAt(k) - this.by;
      if (dx * dx + dy * dy <= limit) {
        this.bring(k);
        count = this.addContact(count, k);
        if (this.approach(count - 1) < -OVERLAP_RESTING_SPEED) {
          this.recordHit(k);
        }
      }
    }
    this.solve(count);
  }

  // Walls within `distance` of the Ball's surface.
  private wallsAt(distance: number) {
    return (this.bx <= this.ballLeft + distance ? WALL_LEFT : 0)
      | (this.bx >= this.ballRight - distance ? WALL_RIGHT : 0)
      | (this.by <= this.ballTop + distance ? WALL_TOP : 0)
      | (this.by >= this.ballBottom - distance ? WALL_BOTTOM : 0);
  }

  // Times of impact up to `end` along the current velocities, in order.
  private planImpacts(end: number) {
    const { dots, dt } = this;
    const span = (end - this.time) * dt;
    if (span <= 0) {
      return 0;
    }
    const skinSq = (this.sumR + SKIN) * (this.sumR + SKIN);
    let count = 0;
    count = this.planWall(count, WALL_LEFT, this.ballLeft - this.bx, this.vx, span);
    count = this.planWall(count, WALL_RIGHT, this.ballRight - this.bx, this.vx, span);
    count = this.planWall(count, WALL_TOP, this.ballTop - this.by, this.vy, span);
    count = this.planWall(count, WALL_BOTTOM, this.ballBottom - this.by, this.vy, span);
    for (let n = 0; n < this.nearCount; n += 1) {
      const k = this.near[n];
      const px = this.xAt(k) - this.bx;
      const py = this.yAt(k) - this.by;
      const distSq = px * px + py * py;
      if (distSq <= skinSq) {
        continue;
      }
      const mx = (dots.vx[k] - this.vx) * span;
      const my = (dots.vy[k] - this.vy) * span;
      const b = px * mx + py * my;
      if (b >= 0) {
        continue;
      }
      const a = mx * mx + my * my;
      const disc = b * b - a * (distSq - this.sumR * this.sumR);
      if (disc < 0) {
        continue;
      }
      const t = (-b - Math.sqrt(disc)) / a;
      if (t >= 0 && t <= 1) {
        count = this.addEvent(count, k, t * span);
      }
    }
    this.order.length = count;
    for (let e = 0; e < count; e += 1) {
      this.order[e] = e;
    }
    if (count > 1) {
      this.order.sort((left, right) => this.eventTime[left] - this.eventTime[right]);
    }
    return count;
  }

  private planWall(count: number, wall: number, distance: number, speed: number, span: number) {
    const towards = wall & (WALL_LEFT | WALL_TOP) ? speed < 0 : speed > 0;
    const seconds = towards ? distance / speed : -1;
    return seconds >= 0 && seconds <= span ? this.addEvent(count, -wall, seconds) : count;
  }

  private addEvent(count: number, what: number, seconds: number) {
    if (count === this.eventWhat.length) {
      this.eventWhat = growInt(this.eventWhat);
      this.eventTime = growFloat(this.eventTime);
    }
    this.eventWhat[count] = what;
    this.eventTime[count] = this.time + seconds / this.dt;
    return count + 1;
  }

  private recordHit(k: number) {
    const { dots } = this;
    if (!dots.ballPushed[k]) {
      dots.ballPushed[k] = 1;
      dots.ballHitEnergy[k] = Math.hypot(dots.vx[k] - this.vx, dots.vy[k] - this.vy);
    }
  }

  // The speed after the bounce, as Rapier's event gave it: a dead wall is
  // quiet.
  private recordWall(wall: number) {
    if (!(this.wallHit & wall)) {
      this.wallHit |= wall;
      this.wallSpeed[wall] = Math.hypot(this.vx, this.vy);
    }
  }

  private addContact(count: number, k: number) {
    if (count === this.contact.length) {
      this.contact = growInt(this.contact);
      this.contactNx = growFloat(this.contactNx);
      this.contactNy = growFloat(this.contactNy);
      this.contactTarget = growFloat(this.contactTarget);
      this.contactJn = growFloat(this.contactJn);
      this.contactJt = growFloat(this.contactJt);
    }
    const dx = this.dots.x[k] - this.bx;
    const dy = this.dots.y[k] - this.by;
    const distance = Math.hypot(dx, dy);
    this.contact[count] = k;
    this.contactNx[count] = distance > 1e-6 ? dx / distance : 1;
    this.contactNy[count] = distance > 1e-6 ? dy / distance : 0;
    this.contactTarget[count] = 0;
    this.contactJn[count] = 0;
    this.contactJt[count] = 0;
    return count + 1;
  }

  // Normal speed of contact `c`; negative while approaching.
  private approach(c: number) {
    const k = this.contact[c];
    return (this.dots.vx[k] - this.vx) * this.contactNx[c]
      + (this.dots.vy[k] - this.vy) * this.contactNy[c];
  }

  // Accumulated normal and friction impulses (projected Gauss-Seidel), until
  // they settle. See `docs/tech/matching-a-physics-engines-contacts.md`. Walls
  // at the Ball keep it inside.
  private solve(count: number) {
    const { dots, r, R } = this;
    const walls = this.wallsAt(SKIN);
    this.keepOffWalls(walls);
    if (count === 0 || this.invSum <= 0) {
      return;
    }
    const rest = Math.max((1 - this.time) * this.dt, 1e-6);
    const single = count === 1 && walls === 0;
    const passes = clamp(Math.floor(SOLVE_WORK / count), MIN_PASSES, MAX_PASSES);
    for (let pass = 0; pass < passes; pass += 1) {
      let change = 0;
      for (let c = 0; c < count; c += 1) {
        const k = this.contact[c];
        const nx = this.contactNx[c];
        const ny = this.contactNy[c];
        const wx = dots.vx[k] - this.vx;
        const wy = dots.vy[k] - this.vy;

        const vn = wx * nx + wy * ny;
        const previousJn = this.contactJn[c];
        const jn = Math.max(previousJn + (this.contactTarget[c] - vn) / this.invSum, 0);
        const dn = jn - previousJn;
        this.contactJn[c] = jn;

        const vt = -wx * ny + wy * nx - r * dots.angvel[k] - R * this.w;
        const previousJt = this.contactJt[c];
        const limit = this.friction * jn;
        const jt = Math.min(Math.max(previousJt - vt / this.invTangent, -limit), limit);
        const tangentStep = jt - previousJt;
        this.contactJt[c] = jt;

        const ix = nx * dn - ny * tangentStep;
        const iy = ny * dn + nx * tangentStep;
        this.vx -= ix * this.invBall;
        this.vy -= iy * this.invBall;
        dots.angvel[k] -= r * tangentStep * this.invInertiaParticle;
        this.w -= R * tangentStep * this.invInertiaBall;

        // A wall holds the particle: it may close its gap to the wall within
        // the step, and no more. The next pass then pushes back on the Ball.
        // (On its way to a wall bounce it can be past the wall for now.)
        dots.vx[k] = clamp(
          dots.vx[k] + ix * this.invParticle,
          Math.min((this.left - dots.x[k]) / rest, 0),
          Math.max((this.right - dots.x[k]) / rest, 0),
        );
        dots.vy[k] = clamp(
          dots.vy[k] + iy * this.invParticle,
          Math.min((this.top - dots.y[k]) / rest, 0),
          Math.max((this.bottom - dots.y[k]) / rest, 0),
        );
        change = Math.max(change, Math.abs(dn) * this.invSum, Math.abs(tangentStep) * this.invSum);
      }
      this.keepOffWalls(walls);
      if (change < SETTLED_SPEED || (single && pass > 0)) {
        break;
      }
    }
  }

  private keepOffWalls(walls: number) {
    if ((walls & WALL_LEFT && this.vx < 0) || (walls & WALL_RIGHT && this.vx > 0)) {
      const wall = this.vx < 0 ? WALL_LEFT : WALL_RIGHT;
      this.vx = 0;
      this.recordWall(wall);
    }
    if ((walls & WALL_TOP && this.vy < 0) || (walls & WALL_BOTTOM && this.vy > 0)) {
      const wall = this.vy < 0 ? WALL_TOP : WALL_BOTTOM;
      this.vy = 0;
      this.recordWall(wall);
    }
  }

  // Walls the Ball began to touch in this step, as the speed of each hit.
  private takeWallHits() {
    const touching = this.wallHit | this.wallsAt(TOUCH_DISTANCE);
    const started = touching & ~this.wallTouch;
    this.wallTouch = touching;
    const hits: number[] = [];
    if (started) {
      for (const wall of WALLS) {
        if (started & wall) {
          hits.push(this.wallHit & wall ? this.wallSpeed[wall] : Math.hypot(this.vx, this.vy));
        }
      }
    }
    return hits;
  }

  // Pushes out what still overlaps (a crowd after the last turn, a changed
  // Size, a new start), moving positions only, one contact after another. Then sets the particle
  // positions back to the start of the step for the caller.
  private finish() {
    const { dots, dt } = this;
    const sumSq = this.sumR * this.sumR;
    for (let n = 0; n < this.nearCount && this.invSum > 0; n += 1) {
      const k = this.near[n];
      const x = this.xAt(k);
      const y = this.yAt(k);
      const dx = x - this.bx;
      const dy = y - this.by;
      const distSq = dx * dx + dy * dy;
      if (distSq >= sumSq) {
        continue;
      }
      const distance = Math.sqrt(distSq);
      const nx = distance > 1e-6 ? dx / distance : 1;
      const ny = distance > 1e-6 ? dy / distance : 0;
      const push = ((this.sumR - distance) * OVERLAP_PUSH_OUT) / this.invSum;
      const wantX = x + nx * push * this.invParticle;
      const wantY = y + ny * push * this.invParticle;
      const gotX = clamp(wantX, this.left, this.right);
      const gotY = clamp(wantY, this.top, this.bottom);
      dots.x[k] = gotX;
      dots.y[k] = gotY;
      this.stamp[k] = 1;
      // What a wall keeps the particle from taking, the Ball takes.
      this.bx -= nx * push * this.invBall + (wantX - gotX);
      this.by -= ny * push * this.invBall + (wantY - gotY);
    }
    this.bx = clamp(this.bx, this.ballLeft, this.ballRight);
    this.by = clamp(this.by, this.ballTop, this.ballBottom);
    for (let k = 0; k < dots.count; k += 1) {
      const stamp = this.stamp[k];
      if (stamp !== 0) {
        dots.x[k] -= dots.vx[k] * stamp * dt;
        dots.y[k] -= dots.vy[k] * stamp * dt;
        this.stamp[k] = 0;
      }
    }
  }
}

function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value;
}

function growInt(old: Int32Array) {
  const next = new Int32Array(old.length * 2);
  next.set(old);
  return next;
}

function growFloat(old: Float64Array) {
  const next = new Float64Array(old.length * 2);
  next.set(old);
  return next;
}
