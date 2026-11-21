// Trial engine for `Independent overlap` particles (spec `Proposed Physics
// Load Reduction`, step (b), `?ov=js`). Particles never touch each other, so
// the only contacts are the control Ball and the four walls: the work is one
// Ball times N particles per step, with no broad-phase. Pure code, no Rapier
// or DOM; the Ball itself stays a Rapier body and is passed in per step.

export type OverlapBall = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  friction: number;
  // Spin in rad/s (Rapier's `angvel`). Friction at a contact turns both bodies.
  angvel: number;
};

export type OverlapParams = {
  width: number;
  height: number;
  radius: number;
  mass: number;
  friction: number;
  // `Contact Bounce`, used for Ball-particle contacts.
  restitution: number;
  // `Wall Bounce`.
  wallRestitution: number;
  linearDamping: number;
};

export type OverlapImpact = {
  kind: 'particle-wall' | 'ball-particle';
  energy: number;
};

// Named knobs of the trial (see the spec). Each one shapes one behaviour.
// Below this approach speed (px/s) a contact does not bounce, so particles
// pressed onto the Ball or a wall rest instead of jittering.
export const OVERLAP_RESTING_SPEED = 15;
// Share of an overlap pushed out per step (positions only); Rapier 0.14's
// contact error reduction at 60 Hz is 0.239.
export const OVERLAP_PUSH_OUT = 0.24;
// Solver passes over the Ball's contacts; many particles touch it at once.
export const OVERLAP_ITERATIONS = 4;
// A pair closer than this (px) counts as touching, for sound events.
const TOUCH_DISTANCE = 0.5;
// Moment of inertia of a solid disc, I = k m r^2, as Rapier gives a ball
// collider. Rapier bodies here have no angular damping, so a spin lasts
// until a contact with friction changes it (walls have friction 0).
const DISC_INERTIA = 0.5;

const WALL_LEFT = 1;
const WALL_RIGHT = 2;
const WALL_TOP = 4;
const WALL_BOTTOM = 8;

export class OverlapParticles {
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  // Spin (rad/s) and the turned angle (rad), for drawing a pattern later.
  readonly angvel: Float64Array;
  readonly angle: Float64Array;
  // Touch state of the previous step, so a contact sounds only when it starts.
  private readonly ballTouch: Uint8Array;
  private readonly wallTouch: Uint8Array;
  // Set when the solver pushed the particle this step: a hit that separates
  // within the step still counts as a contact, as in Rapier's events.
  private readonly ballPushed: Uint8Array;
  // Relative speed before that push. Rapier reports a contact the step
  // before it resolves it, so its event energy is the approach speed.
  private readonly ballHitEnergy: Float64Array;
  // Contact scratch, reused every step.
  private contactIndex = new Int32Array(64);
  private contactNx = new Float64Array(64);
  private contactNy = new Float64Array(64);
  private contactTarget = new Float64Array(64);
  private contactDepth = new Float64Array(64);
  private contactEnergy = new Float64Array(64);
  // Relative velocity before solving, and the time of impact (0..1 of the
  // step) for a bounce that happens part way through the step.
  private contactWx = new Float64Array(64);
  private contactWy = new Float64Array(64);
  private contactToi = new Float64Array(64);
  private contactJn = new Float64Array(64);
  private contactJt = new Float64Array(64);

  constructor(readonly count: number) {
    this.x = new Float64Array(count);
    this.y = new Float64Array(count);
    this.vx = new Float64Array(count);
    this.vy = new Float64Array(count);
    this.angvel = new Float64Array(count);
    this.angle = new Float64Array(count);
    this.ballTouch = new Uint8Array(count);
    this.wallTouch = new Uint8Array(count);
    this.ballPushed = new Uint8Array(count);
    this.ballHitEnergy = new Float64Array(count);
  }

  set(index: number, x: number, y: number, vx: number, vy: number) {
    this.x[index] = x;
    this.y[index] = y;
    this.vx[index] = vx;
    this.vy[index] = vy;
  }

  // Phase 1, before Rapier steps: damping, then the Ball contacts solved with
  // the Ball's velocity for this step. Returns the Ball's new velocity and
  // spin, which the caller writes back to Rapier. `ball` is null while the
  // Ball is absent.
  solveBall(dt: number, ball: OverlapBall | null, params: OverlapParams) {
    const damping = 1 / (1 + dt * params.linearDamping);
    if (damping !== 1) {
      for (let index = 0; index < this.count; index += 1) {
        this.vx[index] *= damping;
        this.vy[index] *= damping;
      }
    }

    if (!ball) {
      return null;
    }

    const unchanged = { vx: ball.vx, vy: ball.vy, angvel: ball.angvel, dx: 0, dy: 0 };
    const contacts = this.findBallContacts(dt, ball, params);
    if (contacts === 0) {
      return unchanged;
    }

    const invBall = ball.mass > 0 ? 1 / ball.mass : 0;
    const invParticle = params.mass > 0 ? 1 / params.mass : 0;
    const invSum = invBall + invParticle;
    if (invSum <= 0) {
      return unchanged;
    }
    // Rapier's default `Average` combine rule.
    const friction = (ball.friction + params.friction) * 0.5;
    const left = params.radius;
    const top = params.radius;
    const right = Math.max(params.width - params.radius, left);
    const bottom = Math.max(params.height - params.radius, top);
    let bvx = ball.vx;
    let bvy = ball.vy;
    let bw = ball.angvel;
    // Spin terms. A tangential impulse j at the contact point changes the
    // particle's spin by -r j / I_p and the Ball's by -R j / I_b; the contact
    // point's sliding speed then changes by j x tangentMass^-1.
    const r = params.radius;
    const R = ball.radius;
    const invInertiaParticle = r > 0 ? invParticle / (DISC_INERTIA * r * r) : 0;
    const invInertiaBall = R > 0 ? invBall / (DISC_INERTIA * R * R) : 0;
    const invTangent = invSum + r * r * invInertiaParticle + R * R * invInertiaBall;

    for (let pass = 0; pass < OVERLAP_ITERATIONS; pass += 1) {
      for (let c = 0; c < contacts; c += 1) {
        const index = this.contactIndex[c];
        const nx = this.contactNx[c];
        const ny = this.contactNy[c];
        const wx = this.vx[index] - bvx;
        const wy = this.vy[index] - bvy;

        // Normal: the pair may separate freely, but not approach faster than
        // the target allows. Accumulated impulse stays >= 0.
        const vn = wx * nx + wy * ny;
        const previousJn = this.contactJn[c];
        const jn = Math.max(previousJn + (this.contactTarget[c] - vn) / invSum, 0);
        const dn = jn - previousJn;
        this.contactJn[c] = jn;

        // Friction: Coulomb, capped by the normal impulse. It acts on the
        // sliding speed of the contact point, which includes both spins
        // (tangent t = (-ny, nx); the particle's surface there moves at
        // -r w_p along t, the Ball's at +R w_b).
        const vt = -wx * ny + wy * nx - r * this.angvel[index] - R * bw;
        const previousJt = this.contactJt[c];
        const limit = friction * jn;
        const jt = Math.min(Math.max(previousJt - vt / invTangent, -limit), limit);
        const tangentStep = jt - previousJt;
        this.contactJt[c] = jt;

        const ix = nx * dn - ny * tangentStep;
        const iy = ny * dn + nx * tangentStep;
        bvx -= ix * invBall;
        bvy -= iy * invBall;
        this.angvel[index] -= r * tangentStep * invInertiaParticle;
        bw -= R * tangentStep * invInertiaBall;

        // A wall holds the particle: it may close its gap to the wall within
        // this step, and no more. The next pass then pushes back on the Ball,
        // so a particle pinned at a wall stops the Ball, as Rapier solves it.
        const px = this.x[index];
        const py = this.y[index];
        this.vx[index] = clamp(this.vx[index] + ix * invParticle, (left - px) / dt, (right - px) / dt);
        this.vy[index] = clamp(this.vy[index] + iy * invParticle, (top - py) / dt, (bottom - py) / dt);
      }
    }

    // Overlap is pushed out by moving positions only, so the correction adds
    // no lasting speed (as Rapier removes its correction velocity after
    // solving). Shared by inverse mass; the Ball's share goes to the caller.
    let bdx = 0;
    let bdy = 0;
    for (let c = 0; c < contacts; c += 1) {
      const index = this.contactIndex[c];
      if (this.contactJn[c] > 0) {
        this.ballPushed[index] = 1;
        this.ballHitEnergy[index] = this.contactEnergy[c];
        const toi = this.contactToi[c];
        if (toi > 0) {
          // Moving with the old velocity until the impact and with the new
          // one after it, instead of with the new one for the whole step.
          const wx = this.vx[index] - bvx;
          const wy = this.vy[index] - bvy;
          this.x[index] = clamp(this.x[index] + (this.contactWx[c] - wx) * toi * dt, left, right);
          this.y[index] = clamp(this.y[index] + (this.contactWy[c] - wy) * toi * dt, top, bottom);
        }
      }
      const nx = this.contactNx[c];
      const ny = this.contactNy[c];
      // One contact after another (Gauss-Seidel), each seeing how far the
      // Ball has already been pushed: many overlapping particles share one
      // correction instead of each adding a full one.
      const depth = this.contactDepth[c] + bdx * nx + bdy * ny;
      if (this.contactDepth[c] <= 0 || depth <= 0) {
        continue;
      }
      const push = (depth * OVERLAP_PUSH_OUT) / invSum;
      const wantX = this.x[index] + nx * push * invParticle;
      const wantY = this.y[index] + ny * push * invParticle;
      const gotX = clamp(wantX, left, right);
      const gotY = clamp(wantY, top, bottom);
      this.x[index] = gotX;
      this.y[index] = gotY;
      // What a wall keeps the particle from taking, the Ball takes.
      bdx -= nx * push * invBall + (wantX - gotX);
      bdy -= ny * push * invBall + (wantY - gotY);
    }

    return { vx: bvx, vy: bvy, angvel: bw, dx: bdx, dy: bdy };
  }

  // Phase 2, after Rapier has moved the Ball: move the particles, bounce
  // them off the walls, and report contacts that started this step.
  // `ball` holds the Ball's position and velocity after the Rapier step.
  integrate(
    dt: number,
    ball: OverlapBall | null,
    params: OverlapParams,
    impacts: OverlapImpact[],
  ) {
    const r = params.radius;
    const left = r;
    const top = r;
    const right = params.width - r;
    const bottom = params.height - r;
    const narrowX = right <= left;
    const narrowY = bottom <= top;
    const bounce = params.wallRestitution;
    const touchLimit = ball ? ball.radius + r + TOUCH_DISTANCE : 0;

    for (let index = 0; index < this.count; index += 1) {
      let x = this.x[index] + this.vx[index] * dt;
      let y = this.y[index] + this.vy[index] * dt;
      let vx = this.vx[index];
      let vy = this.vy[index];
      // Speed before any wall bounce: the event energy Rapier reports.
      const approachSpeed = Math.hypot(vx, vy);
      let walls = 0;

      if (narrowX) {
        x = params.width * 0.5;
      } else if (x <= left + TOUCH_DISTANCE) {
        walls |= WALL_LEFT;
        if (x < left) {
          x = Math.min(left + (left - x) * bounce, right);
          vx = bounceSpeed(Math.abs(vx), bounce);
        }
      } else if (x >= right - TOUCH_DISTANCE) {
        walls |= WALL_RIGHT;
        if (x > right) {
          x = Math.max(right - (x - right) * bounce, left);
          vx = -bounceSpeed(Math.abs(vx), bounce);
        }
      }

      if (narrowY) {
        y = params.height * 0.5;
      } else if (y <= top + TOUCH_DISTANCE) {
        walls |= WALL_TOP;
        if (y < top) {
          y = Math.min(top + (top - y) * bounce, bottom);
          vy = bounceSpeed(Math.abs(vy), bounce);
        }
      } else if (y >= bottom - TOUCH_DISTANCE) {
        walls |= WALL_BOTTOM;
        if (y > bottom) {
          y = Math.max(bottom - (y - bottom) * bounce, top);
          vy = -bounceSpeed(Math.abs(vy), bounce);
        }
      }

      this.x[index] = x;
      this.y[index] = y;
      this.vx[index] = vx;
      this.vy[index] = vy;
      this.angle[index] += this.angvel[index] * dt;

      const started = walls & ~this.wallTouch[index];
      this.wallTouch[index] = walls;
      if (started) {
        // One event per wall, as Rapier reports one per wall pair.
        for (let bit = started; bit; bit &= bit - 1) {
          impacts.push({ kind: 'particle-wall', energy: approachSpeed });
        }
      }

      let touching = 0;
      if (ball) {
        const dx = x - ball.x;
        const dy = y - ball.y;
        const pushed = this.ballPushed[index];
        touching = pushed || dx * dx + dy * dy <= touchLimit * touchLimit ? 1 : 0;
        this.ballPushed[index] = 0;
        if (touching && !this.ballTouch[index]) {
          impacts.push({
            kind: 'ball-particle',
            energy: pushed ? this.ballHitEnergy[index] : Math.hypot(vx - ball.vx, vy - ball.vy),
          });
        }
      }
      this.ballTouch[index] = touching;
    }
  }

  // Lists the particles that touch the Ball, or will touch it within this
  // step (a swept test, so a fast Ball cannot skip a particle), with the
  // contact normal and the target normal speed.
  private findBallContacts(dt: number, ball: OverlapBall, params: OverlapParams) {
    const sumR = ball.radius + params.radius;
    const e = params.restitution;
    let contacts = 0;

    for (let index = 0; index < this.count; index += 1) {
      const px = this.x[index] - ball.x;
      const py = this.y[index] - ball.y;
      const mx = (this.vx[index] - ball.vx) * dt;
      const my = (this.vy[index] - ball.vy) * dt;
      const distSq = px * px + py * py;
      const reach = sumR + Math.abs(mx) + Math.abs(my);
      if (distSq > reach * reach) {
        continue;
      }

      let nx: number;
      let ny: number;
      let gap: number;
      const dist = Math.sqrt(distSq);
      if (dist < sumR) {
        // Already overlapping: push apart along the center line.
        if (dist > 1e-6) {
          nx = px / dist;
          ny = py / dist;
        } else {
          nx = 1;
          ny = 0;
        }
        gap = dist - sumR;
      } else {
        // Not touching yet. Like Rapier 0.14, whose predictive contacts reach
        // only 0.002 px here, a pair that will overlap at the end of the step
        // is left alone and resolved on the next step; the Ball sinks into a
        // crowd as it does today. Only a pass that would skip the particle
        // or pass it (a fast Ball, Rapier's CCD case) is caught here. Rapier
        // runs CCD once a step moves the Ball further than its own radius.
        const ex = px + mx;
        const ey = py + my;
        const a = mx * mx + my * my;
        if (ex * ex + ey * ey < sumR * sumR && a <= ball.radius * ball.radius) {
          continue;
        }
        const b = px * mx + py * my;
        if (a <= 1e-12 || b >= 0) {
          continue;
        }
        const disc = b * b - a * (distSq - sumR * sumR);
        if (disc < 0) {
          continue;
        }
        const t = (-b - Math.sqrt(disc)) / a;
        if (t > 1) {
          continue;
        }
        const cx = px + mx * t;
        const cy = py + my * t;
        const cLen = Math.hypot(cx, cy) || 1;
        nx = cx / cLen;
        ny = cy / cLen;
        gap = Math.max(px * nx + py * ny - sumR, 0);
      }

      const wx = this.vx[index] - ball.vx;
      const wy = this.vy[index] - ball.vy;
      const vn = wx * nx + wy * ny;
      let target: number;
      let toi = 0;
      if (vn < -OVERLAP_RESTING_SPEED) {
        target = -e * vn;
        // A bounce part way through the step: the particle first travels to
        // the contact point (corrected after solving).
        toi = gap > 0 ? Math.min(gap / (-vn * dt), 1) : 0;
      } else if (gap > 0) {
        // Not bouncing: allow it to close the gap, and no more.
        target = -gap / dt;
      } else {
        target = 0;
      }

      if (contacts === this.contactIndex.length) {
        this.growContacts();
      }
      this.contactIndex[contacts] = index;
      this.contactNx[contacts] = nx;
      this.contactNy[contacts] = ny;
      this.contactTarget[contacts] = target;
      this.contactDepth[contacts] = gap < 0 ? -gap : 0;
      this.contactEnergy[contacts] = Math.hypot(wx, wy);
      this.contactWx[contacts] = wx;
      this.contactWy[contacts] = wy;
      this.contactToi[contacts] = toi;
      this.contactJn[contacts] = 0;
      this.contactJt[contacts] = 0;
      contacts += 1;
    }

    return contacts;
  }

  private growContacts() {
    const size = this.contactIndex.length * 2;
    const grow = <T extends Int32Array | Float64Array>(old: T, next: T) => {
      next.set(old);
      return next;
    };
    this.contactIndex = grow(this.contactIndex, new Int32Array(size));
    this.contactNx = grow(this.contactNx, new Float64Array(size));
    this.contactNy = grow(this.contactNy, new Float64Array(size));
    this.contactTarget = grow(this.contactTarget, new Float64Array(size));
    this.contactDepth = grow(this.contactDepth, new Float64Array(size));
    this.contactEnergy = grow(this.contactEnergy, new Float64Array(size));
    this.contactWx = grow(this.contactWx, new Float64Array(size));
    this.contactWy = grow(this.contactWy, new Float64Array(size));
    this.contactToi = grow(this.contactToi, new Float64Array(size));
    this.contactJn = grow(this.contactJn, new Float64Array(size));
    this.contactJt = grow(this.contactJt, new Float64Array(size));
  }
}

function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value;
}

function bounceSpeed(speed: number, bounce: number) {
  return speed < OVERLAP_RESTING_SPEED ? 0 : speed * bounce;
}
