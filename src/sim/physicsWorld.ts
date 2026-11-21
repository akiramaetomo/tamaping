import {
  nextWallTurn,
  wallTurnVelocity,
  weavePushFromAgility,
  weaveRangeFromSight,
  weaveVelocity,
  type WallTurn,
} from './ballWeave';
import { contactMaterial } from './contactMaterials';
import {
  randomDirectionVelocity,
  spiralSpeedFactor,
  startBallPosition,
  type PresetStart,
} from './presetStart';
import {
  OverlapParticles,
  type OverlapBall,
  type OverlapImpact,
  type OverlapParams,
} from './overlapParticles';
import {
  FreeSpotFinder,
  OverlapSeparator,
  PHYSICAL_ENTRY_FRAME_MS,
  PHYSICAL_ENTRY_HANDOVER,
  PHYSICAL_ENTRY_MAX_FRAMES,
  PHYSICAL_FLOW_HEADROOM,
  PHYSICAL_FLOW_PER_STEP,
  PHYSICAL_REST_COVER,
  findCoveredDots,
  needsPhysicalSpread,
  overlapEstimate,
  physicalCapacity,
  physicalEntryBudget,
  physicalTimeLimitMs,
} from './physicalEntry';
import type { ColliderLayout, CollisionMode, DotpingSettings, OverlapEngine } from './settings';

type RapierModule = any;

type BodyRole = 'particle' | 'control' | 'wall-x' | 'wall-y';
// `angle` (rad) and `angvel` (rad/s) are the body's turn and spin; missing
// means 0 (a fresh dot).
type BodyState = { x: number; y: number; vx: number; vy: number; angle?: number; angvel?: number };
// A dot that rests (not simulated, not drawn) under a simulated host dot, at
// a fixed offset from it. `id` and `host` are dot IDs. `angle` is the dot's
// own turn when it went to rest, kept while it rests, so the spin pattern
// does not jump when it comes back.
type RestingDot = { id: number; host: number; dx: number; dy: number; angle: number };
// `Physical collision` entry state for the debug overlay: the TS spread of a
// packed crowd, then resting dots being released, waiting for step headroom,
// or waiting because the field has no free spot.
export type PhysicalEntryState = 'spreading' | 'flow-out' | 'at-limit' | 'field-full';
// Smoothing of the measured Rapier step time (share of each new step).
const STEP_COST_SMOOTHING = 0.2;
// Steps left out of the step time after a build or a change of the dot set,
// so the first step's setup cost does not count.
const STEP_COST_SETTLE_STEPS = 3;
// Steps to wait after a time-limit search found no covered dot, or after
// the flow-out found no free spot.
const LIMIT_RETRY_STEPS = 30;
type PreservedState = {
  control: BodyState;
  particles: BodyState[];
};

export type ImpactEvent = {
  kind: 'ball-wall' | 'particle-wall' | 'ball-particle' | 'particle-particle';
  energy: number;
};

export type ParticleFormationTarget = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type StepMetrics = {
  durationMs: number;
  // JS work around `world.step`: control drive, linking, gravity / containment, impacts.
  preStepMs: number;
  postStepMs: number;
  lengthUnit: number;
  colliderLayout: ColliderLayout;
  colliderCount: number;
  // Engine that moved the particles this step (`js` only with `?ov=js` in
  // `Independent overlap`).
  overlapEngine?: OverlapEngine;
  // `Physical collision` entry (see `physicalEntry.ts`): set while a packed
  // crowd is spread, or while dots rest.
  physicalEntry?: PhysicalEntryState;
  // Dots resting under others: not simulated, not drawn.
  restingDots?: number;
  // Set only with `?entry=held` (the first version of the entry).
  physicalEntryMode?: 'held';
  // Target frame rate behind the physics time limit (`?physfps=`), set
  // while `physicalEntry` is.
  physicalTargetFps?: number;
};

export type ParticleDiagnostics = {
  total: number;
  visible: number;
  outOfBounds: number;
  nonFinite: number;
  maxSpeed: number;
  maxOutOfBoundsDistance: number;
  recoveredLastStep: number;
};

export type DotSnapshot = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  speed: number;
  // Turned angle in radians (Rapier `rotation()`). For particles it is read
  // only while `readParticleAngles` is on, and is 0 otherwise.
  angle: number;
  visible: boolean;
};

export type WorldSnapshot = {
  width: number;
  height: number;
  particles: DotSnapshot[];
  controlBall: DotSnapshot;
  collisionMode: CollisionMode;
};

const GROUP_CONTROL = 0x0001;
const GROUP_PARTICLE = 0x0002;
const GROUP_WALL = 0x0004;
const VELOCITY_COMBI_BLEND = 0.52;
const VELOCITY_COMBI_MAX_SPEED = 2400;
const LINK_FLASH_SPEED = 36;
const FLASH_SPIRAL_RADIAL_STEP_SCALE = 0.42;
const CONTROL_GRAVITY_STRENGTH = 32_000_000;
const CONTROL_GRAVITY_MAX_ACCEL = 3_600;
const PARTICLE_CONTAINMENT_EPSILON = 0.25;

function groups(membership: number, filter: number) {
  return (membership << 16) | filter;
}

function isWallRole(role: BodyRole) {
  return role === 'wall-x' || role === 'wall-y';
}

// One trial-engine particle behind the small part of Rapier's body API that
// the shared velocity rules use, so gravity, linking, weave, starts and
// snapshots work unchanged on both engines.
class OverlapParticleBody {
  constructor(
    private readonly store: OverlapParticles,
    private readonly index: number,
  ) {}

  translation() {
    return { x: this.store.x[this.index], y: this.store.y[this.index] };
  }

  linvel() {
    return { x: this.store.vx[this.index], y: this.store.vy[this.index] };
  }

  setTranslation(position: { x: number; y: number }) {
    this.store.x[this.index] = position.x;
    this.store.y[this.index] = position.y;
  }

  setLinvel(velocity: { x: number; y: number }) {
    this.store.vx[this.index] = velocity.x;
    this.store.vy[this.index] = velocity.y;
  }

  // Spin in rad/s and the turned angle, like Rapier's `angvel()` / `rotation()`.
  angvel() {
    return this.store.angvel[this.index];
  }

  rotation() {
    return this.store.angle[this.index];
  }

  // Damping is read from the settings every step.
  setLinearDamping() {}
}

export class DotpingPhysicsWorld {
  private world!: any;
  private eventQueue!: any;
  private particles: any[] = [];
  // Particle angles cost one WASM read per body on Rapier, so the snapshot
  // reads them only while something draws them (shape `Turn` = `Spin`).
  readParticleAngles = false;
  // Set while the trial engine moves the particles (`?ov=js`).
  private overlap: OverlapParticles | null = null;
  // `Physical collision` entry (spec `Safe Entry Into Physical Collision`):
  // frames spent spreading a packed crowd with the TS engine (-1 when not
  // spreading); the ID of each simulated dot, aligned with `particles`; the
  // resting dots; Rapier's smoothed step time (-1 until measured); steps
  // left out of it; steps to wait before the next time-limit search and before
  // the next free-spot search; and what the resting dots wait for.
  private entryFrames = -1;
  private ids: number[] = [];
  private resting: RestingDot[] = [];
  // Legacy entry (`?entry=held`): tail dots held off the field, with their
  // states as they were when held.
  private held: Array<{ id: number; state: BodyState }> = [];
  private stepCostMs = -1;
  private settleSteps = 0;
  private limitWait = 0;
  private flowWait = 0;
  private restState: 'flow-out' | 'at-limit' | 'field-full' = 'at-limit';
  private readonly separator = new OverlapSeparator();
  private particleWallColliders: any[] = [];
  private particleContactColliders: any[] = [];
  private controlBall!: any;
  private controlWallCollider: any = null;
  private controlContactCollider: any = null;
  private wallColliders: any[] = [];
  private colliderRoles = new Map<number, BodyRole>();
  private settings: DotpingSettings;
  private pointerActive = false;
  private weaveWallTurn: WallTurn | null = null;
  private weaveLastSpeed = 0;
  private pointerX = 0;
  private pointerY = 0;
  private particleDiagnostics: ParticleDiagnostics = emptyParticleDiagnostics();
  private diagnosticsEnabled = false;
  private controlBallPresent = true;

  constructor(
    private readonly rapier: RapierModule,
    private widthValue: number,
    private heightValue: number,
    settings: DotpingSettings,
  ) {
    this.settings = { ...settings };
    this.rebuild();
  }

  get particleCount() {
    return this.particles.length;
  }

  get lengthUnit() {
    return this.settings.rapierLengthUnit;
  }

  get colliderLayout() {
    return this.settings.colliderLayout;
  }

  get overlapEngine(): OverlapEngine {
    return this.overlap ? 'js' : 'rapier';
  }

  get physicalEntry(): PhysicalEntryState | null {
    if (this.entryFrames >= 0) {
      return 'spreading';
    }
    if (this.resting.length > 0) {
      return this.restState;
    }
    return null;
  }

  // Dots resting under others (not simulated, not drawn); `particleCount`
  // counts the simulated ones.
  get restingParticleCount() {
    return this.resting.length + this.held.length;
  }

  private get legacyEntry() {
    return this.settings.physicalEntryMode === 'held';
  }

  get colliderCount() {
    return this.world?.colliders?.len?.() ?? 0;
  }

  getParticleDiagnostics() {
    return { ...this.particleDiagnostics };
  }

  setDiagnosticsEnabled(enabled: boolean) {
    this.diagnosticsEnabled = enabled;
  }

  updateSettings(settings: DotpingSettings) {
    const preserved = this.captureState();
    const previous = this.settings;
    this.settings = { ...settings };

    if (needsWorldRebuild(previous, this.settings)) {
      this.rebuild(preserved);
      return;
    }

    this.applyRuntimeSettings();
    this.syncControlBallPresence();
  }

  // `remap` maps body positions proportionally to the new size (View Scale
  // `Fit`); otherwise bodies keep their positions and are clamped (`1:1`).
  resize(width: number, height: number, remap = false) {
    const preserved = this.captureState();
    if (preserved && remap) {
      const sx = width / Math.max(this.widthValue, 1);
      const sy = height / Math.max(this.heightValue, 1);
      const map = (state: BodyState): BodyState => ({ ...state, x: state.x * sx, y: state.y * sy });
      preserved.control = map(preserved.control);
      preserved.particles = preserved.particles.map(map);
    }
    this.widthValue = width;
    this.heightValue = height;
    this.rebuild(preserved);
  }

  reset() {
    this.rebuild();
  }

  arrangeFlashParticles() {
    this.wakeRestingDots();
    if (this.particles.length <= 0) {
      return;
    }

    const positions = this.spiralParticlePositions();
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      const position = positions[index];
      const pulse = index === 0 ? 0 : LINK_FLASH_SPEED * (0.65 + ((index % 5) * 0.07));
      particle.setTranslation({ x: position.x, y: position.y }, true);
      particle.setLinvel({ x: position.tx * pulse, y: position.ty * pulse }, true);
    }
    this.guardPhysicalEntry();
  }

  // Puts the scene in a preset's start state. The Ball goes first, because the
  // spiral winds around it. `nameTargets` holds the name layout; without it a
  // `name` start falls back to the scatter. Settings stay as they are.
  applyStart(
    start: PresetStart,
    nameTargets: ParticleFormationTarget[] | null = null,
    random: () => number = Math.random,
  ) {
    this.wakeRestingDots();
    const radius = this.settings.controlBallRadius;
    const ball = startBallPosition(start, this.widthValue, this.heightValue, radius);
    // An absent Ball (`Touch`) keeps its place but must not drift while hidden.
    const ballVelocity = this.controlBallPresent
      ? randomDirectionVelocity(start.ballSpeed, random)
      : { vx: 0, vy: 0 };
    this.controlBall.setTranslation(ball, true);
    this.controlBall.setLinvel({ x: ballVelocity.vx, y: ballVelocity.vy }, true);
    this.weaveWallTurn = null;
    this.weaveLastSpeed = Math.hypot(ballVelocity.vx, ballVelocity.vy);

    const count = this.particles.length;
    if (count <= 0) {
      return;
    }

    const particleRadius = this.settings.particleRadius;
    const useName = start.formation === 'name' && nameTargets !== null && nameTargets.length > 0;
    const spiral = start.formation === 'spiral' ? this.spiralParticlePositions() : null;
    const scatter = !spiral && !useName ? this.particlePositions() : null;
    for (let index = 0; index < count; index += 1) {
      let x: number;
      let y: number;
      let velocity: { vx: number; vy: number };
      if (spiral) {
        const position = spiral[index];
        const speed = start.particleSpeed * spiralSpeedFactor(index);
        x = position.x;
        y = position.y;
        velocity = { vx: position.tx * speed, vy: position.ty * speed };
      } else {
        const target = useName ? nameTargets![index % nameTargets!.length] : scatter![index];
        x = clampToPlayfield(target.x, particleRadius, this.widthValue);
        y = clampToPlayfield(target.y, particleRadius, this.heightValue);
        velocity = randomDirectionVelocity(start.particleSpeed, random);
      }
      const particle = this.particles[index];
      particle.setTranslation({ x, y }, true);
      particle.setLinvel({ x: velocity.vx, y: velocity.vy }, true);
    }
    this.guardPhysicalEntry();
  }

  // Same jittered-grid scatter that a freshly built scene starts with.
  arrangeRandomParticles() {
    this.wakeRestingDots();
    if (this.particles.length <= 0) {
      return;
    }

    const positions = this.particlePositions();
    const count = Math.min(this.particles.length, positions.length);
    for (let index = 0; index < count; index += 1) {
      const particle = this.particles[index];
      const position = positions[index];
      particle.setTranslation({ x: position.x, y: position.y }, true);
      particle.setLinvel({ x: position.vx, y: position.vy }, true);
    }
    this.guardPhysicalEntry();
  }

  arrangeParticlesToTargets(targets: ParticleFormationTarget[]) {
    this.wakeRestingDots();
    if (this.particles.length <= 0 || targets.length <= 0) {
      return false;
    }

    const radius = this.settings.particleRadius;
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      const target = targets[index % targets.length];
      particle.setTranslation(
        {
          x: clampToPlayfield(target.x, radius, this.widthValue),
          y: clampToPlayfield(target.y, radius, this.heightValue),
        },
        true,
      );
      particle.setLinvel({ x: target.vx, y: target.vy }, true);
    }

    this.guardPhysicalEntry();
    return true;
  }

  setPointer(active: boolean, x: number, y: number) {
    const wasActive = this.pointerActive;
    this.pointerActive = active;
    this.pointerX = x;
    this.pointerY = y;

    if (this.settings.controlBallMode === 'touch') {
      if (active && !wasActive) {
        this.showTouchControlBall(x, y);
      } else if (!active && wasActive) {
        this.hideTouchControlBall();
      }
    }
  }

  step(dt: number): { impacts: ImpactEvent[]; metrics: StepMetrics } {
    const preStartedAt = performance.now();
    this.world.timestep = dt;
    this.driveControlBall(dt);
    this.applyVelocityCombi(dt);
    this.applyControlGravity(dt);
    this.applyBallWeave(dt);

    const startedAt = performance.now();
    const overlap = this.overlap;
    if (overlap) {
      const ballVelocity = overlap.solveBall(dt, this.overlapBall(), this.overlapParams());
      if (ballVelocity) {
        this.controlBall.setLinvel({ x: ballVelocity.vx, y: ballVelocity.vy }, true);
        this.controlBall.setAngvel(ballVelocity.angvel, true);
        if (ballVelocity.dx !== 0 || ballVelocity.dy !== 0) {
          const position = this.controlBall.translation();
          this.controlBall.setTranslation(
            { x: position.x + ballVelocity.dx, y: position.y + ballVelocity.dy },
            true,
          );
        }
      }
    }
    this.world.step(this.eventQueue);
    const overlapImpacts: OverlapImpact[] = [];
    if (overlap) {
      overlap.integrate(dt, this.overlapBall(), this.overlapParams(), overlapImpacts);
    }
    const endedAt = performance.now();
    this.containControlBall();
    this.containParticles();
    const impacts = this.collectImpacts();
    for (const impact of overlapImpacts) {
      if (impact.energy > 12) {
        impacts.push(impact);
      }
    }
    const spreading = this.entryFrames >= 0;
    if (spreading) {
      this.advancePhysicalEntry();
    } else if (!overlap && this.settings.collisionMode === 'collision-physical' && !this.legacyEntry) {
      this.keepPhysicsTimeLimit(endedAt - startedAt);
    }
    const entry = spreading ? 'spreading' : this.physicalEntry;
    return {
      impacts,
      metrics: {
        durationMs: endedAt - startedAt,
        preStepMs: startedAt - preStartedAt,
        postStepMs: performance.now() - endedAt,
        lengthUnit: this.settings.rapierLengthUnit,
        colliderLayout: this.settings.colliderLayout,
        colliderCount: this.colliderCount,
        overlapEngine: overlap ? 'js' : 'rapier',
        ...(entry ? { physicalEntry: entry } : {}),
        ...(this.restingParticleCount > 0 ? { restingDots: this.restingParticleCount } : {}),
        ...(this.legacyEntry ? { physicalEntryMode: 'held' as const } : {}),
        ...(entry && !this.legacyEntry ? { physicalTargetFps: this.settings.physicalTargetFps } : {}),
      },
    };
  }

  // One frame of the spread: push overlapping particles apart for a bounded
  // time; dots still covered after it rest. Rapier takes over once the crowd
  // has some room. When the frames run out, every dot that still overlaps a
  // dot drawn above it rests first, so Rapier never receives a packed crowd.
  private advancePhysicalEntry() {
    const store = this.overlap;
    if (!store) {
      this.entryFrames = -1;
      return;
    }
    const radius = this.settings.particleRadius;
    const target = physicalEntryBudget(store.count) * PHYSICAL_ENTRY_HANDOVER;
    const startedAt = performance.now();
    let estimate: number;
    do {
      this.separator.pass(
        store.x, store.y, store.count, radius, this.widthValue, this.heightValue, store.vx, store.vy,
      );
      estimate = overlapEstimate(store.x, store.y, store.count, radius);
    } while (estimate > target && performance.now() - startedAt < PHYSICAL_ENTRY_FRAME_MS);
    this.entryFrames += 1;

    if (this.legacyEntry) {
      // The first version: hand over whatever the spread reached.
      if (estimate <= target || this.entryFrames >= PHYSICAL_ENTRY_MAX_FRAMES) {
        this.handOverToRapier();
      }
      return;
    }
    if (estimate > target) {
      const last = this.entryFrames >= PHYSICAL_ENTRY_MAX_FRAMES;
      this.restDots(
        findCoveredDots(store.x, store.y, this.ids, store.count, radius, last ? 1 : PHYSICAL_REST_COVER),
        store.x,
        store.y,
      );
      if (!last) {
        return;
      }
    }
    this.handOverToRapier();
  }

  // The spread is done: the simulated dots become Rapier bodies in the same
  // world (walls and Ball stay), and the resting dots keep their hosts.
  private handOverToRapier() {
    const store = this.overlap;
    this.overlap = null;
    this.entryFrames = -1;
    this.particles = [];
    this.particleWallColliders = [];
    this.particleContactColliders = [];
    if (store) {
      for (let index = 0; index < store.count; index += 1) {
        this.addRapierParticle(
          store.x[index], store.y[index], store.vx[index], store.vy[index], store.angle[index], store.angvel[index],
        );
      }
    }
    this.restartStepCost();
  }

  private restartStepCost() {
    this.stepCostMs = -1;
    this.settleSteps = STEP_COST_SETTLE_STEPS;
    this.limitWait = 0;
    this.flowWait = 0;
    this.restState = 'at-limit';
  }

  // Physics time limit in `Physical collision`: above it, covered dots
  // rest; well below it, resting dots flow out. Between the two nothing
  // changes, so the count does not swing.
  private keepPhysicsTimeLimit(costMs: number) {
    if (this.settleSteps > 0) {
      this.settleSteps -= 1;
      return;
    }
    this.stepCostMs = this.stepCostMs < 0
      ? costMs
      : this.stepCostMs + (costMs - this.stepCostMs) * STEP_COST_SMOOTHING;
    const cost = this.stepCostMs;
    const limitMs = physicalTimeLimitMs(this.settings.physicalTargetFps);
    if (cost >= limitMs * PHYSICAL_FLOW_HEADROOM) {
      this.restState = 'at-limit';
    }
    if (cost > limitMs) {
      if (this.limitWait > 0) {
        this.limitWait -= 1;
        return;
      }
      // About as many as bring the step back under the limit, at most half.
      const count = this.particles.length;
      const share = Math.min(1 - limitMs / cost, 0.5);
      const limit = Math.max(1, Math.ceil(count * share));
      const { xs, ys } = this.particlePositionArrays();
      const rested = this.restDots(
        findCoveredDots(xs, ys, this.ids, count, this.settings.particleRadius, PHYSICAL_REST_COVER, limit),
        xs,
        ys,
      );
      if (rested > 0) {
        this.restartStepCost();
      } else {
        this.limitWait = LIMIT_RETRY_STEPS;
      }
      return;
    }
    if (this.resting.length > 0 && cost < limitMs * PHYSICAL_FLOW_HEADROOM) {
      if (this.flowWait > 0) {
        this.flowWait -= 1;
        return;
      }
      const { released, full } = this.releaseRestingDots(PHYSICAL_FLOW_PER_STEP);
      if (full) {
        this.flowWait = LIMIT_RETRY_STEPS;
      }
      this.restState = released > 0 ? 'flow-out' : 'field-full';
    }
  }

  // Positions of the simulated dots, in `particles` order.
  private particlePositionArrays() {
    const count = this.particles.length;
    const xs = new Float64Array(count);
    const ys = new Float64Array(count);
    for (let index = 0; index < count; index += 1) {
      const position = this.particles[index].translation();
      xs[index] = position.x;
      ys[index] = position.y;
    }
    return { xs, ys };
  }

  // Puts the simulated dots that `host` marks (per `particles` index, the
  // index of the covering dot, or -1) to rest under their hosts. Dots that
  // already rested under a dot that now rests move to its host. Returns the
  // number of dots put to rest.
  private restDots(host: Int32Array, xs: ArrayLike<number>, ys: ArrayLike<number>) {
    const moved = new Map<number, RestingDot>();
    for (let index = 0; index < host.length; index += 1) {
      const over = host[index];
      if (over >= 0) {
        moved.set(this.ids[index], {
          id: this.ids[index],
          host: this.ids[over],
          dx: xs[index] - xs[over],
          dy: ys[index] - ys[over],
          angle: this.particles[index].rotation(),
        });
      }
    }
    if (moved.size === 0) {
      return 0;
    }
    for (const dot of this.resting) {
      const hostRest = moved.get(dot.host);
      if (hostRest) {
        dot.host = hostRest.host;
        dot.dx += hostRest.dx;
        dot.dy += hostRest.dy;
      }
    }
    this.resting.push(...moved.values());

    const keep: number[] = [];
    for (let index = 0; index < host.length; index += 1) {
      if (host[index] < 0) {
        keep.push(index);
      }
    }
    const store = this.overlap;
    if (store) {
      const next = new OverlapParticles(keep.length);
      this.particles = keep.map((index, slot) => {
        next.set(slot, store.x[index], store.y[index], store.vx[index], store.vy[index]);
        next.angle[slot] = store.angle[index];
        next.angvel[slot] = store.angvel[index];
        return new OverlapParticleBody(next, slot);
      });
      this.overlap = next;
    } else {
      for (let index = 0; index < host.length; index += 1) {
        if (host[index] >= 0) {
          this.colliderRoles.delete(this.particleWallColliders[index].handle);
          this.colliderRoles.delete(this.particleContactColliders[index].handle);
          this.world.removeRigidBody(this.particles[index]);
        }
      }
      this.particles = keep.map((index) => this.particles[index]);
      this.particleWallColliders = keep.map((index) => this.particleWallColliders[index]);
      this.particleContactColliders = keep.map((index) => this.particleContactColliders[index]);
    }
    this.ids = keep.map((index) => this.ids[index]);
    return moved.size;
  }

  // Releases up to `limit` resting dots into Rapier, each at the free spot
  // nearest to where it rests, with its host's velocity. The last to rest
  // come out first. Stops when the field has no free spot left (`full`).
  private releaseRestingDots(limit: number) {
    const { xs, ys } = this.particlePositionArrays();
    const slotOf = new Map<number, number>();
    this.ids.forEach((id, index) => slotOf.set(id, index));
    const ball = this.controlBallPresent
      ? { ...this.controlBall.translation(), radius: this.settings.controlBallRadius }
      : null;
    const finder = new FreeSpotFinder(
      xs, ys, xs.length, this.settings.particleRadius, this.widthValue, this.heightValue, ball,
    );
    let released = 0;
    let full = false;
    while (released < limit && this.resting.length > 0) {
      const dot = this.resting[this.resting.length - 1];
      // A host is always simulated; without one, the dot comes out near the
      // middle of the field.
      const slot = slotOf.get(dot.host);
      const spot = slot === undefined
        ? finder.find(this.widthValue / 2, this.heightValue / 2)
        : finder.find(xs[slot] + dot.dx, ys[slot] + dot.dy);
      if (!spot) {
        full = true;
        break;
      }
      this.resting.pop();
      const host = slot === undefined ? null : this.particles[slot];
      const velocity = host ? host.linvel() : { x: 0, y: 0 };
      this.addRapierParticle(spot.x, spot.y, velocity.x, velocity.y, dot.angle, host ? host.angvel() : 0);
      this.ids.push(dot.id);
      released += 1;
    }
    return { released, full };
  }

  // Brings every resting dot back and restores ID order, so a start or an
  // arrangement places all `Count` dots in order. The crowd is measured
  // again afterwards (`guardPhysicalEntry`).
  private wakeRestingDots() {
    const ordered = this.ids.every((id, index) => id === index);
    if (this.resting.length === 0 && this.held.length === 0 && ordered) {
      return;
    }
    this.rebuild(this.captureState(), { plain: true });
  }

  // After a start or arrangement moved Rapier particles: a packed result
  // goes through the spread like any other entry.
  private guardPhysicalEntry() {
    if (
      this.settings.collisionMode !== 'collision-physical' ||
      this.overlap ||
      this.particles.length <= 1
    ) {
      return;
    }
    const xs = new Float64Array(this.particles.length);
    const ys = new Float64Array(this.particles.length);
    this.particles.forEach((particle, index) => {
      const position = particle.translation();
      xs[index] = position.x;
      ys[index] = position.y;
    });
    if (needsPhysicalSpread(xs, ys, xs.length, this.settings.particleRadius)) {
      this.rebuild(this.captureState());
    }
  }

  // The Ball as the trial engine sees it; null while it is absent (`Touch`).
  private overlapBall(): OverlapBall | null {
    if (!this.controlBallPresent) {
      return null;
    }
    const position = this.controlBall.translation();
    const velocity = this.controlBall.linvel();
    return {
      x: position.x,
      y: position.y,
      vx: velocity.x,
      vy: velocity.y,
      radius: this.settings.controlBallRadius,
      mass: this.settings.controlBallMass,
      friction: this.settings.controlBallFriction,
      angvel: this.controlBall.angvel(),
    };
  }

  private overlapParams(): OverlapParams {
    return {
      width: this.widthValue,
      height: this.heightValue,
      radius: this.settings.particleRadius,
      mass: this.settings.particleMass,
      friction: this.settings.particleFriction,
      restitution: this.material().contactRestitution,
      wallRestitution: this.settings.wallRestitution,
      linearDamping: this.settings.particleLinearDamping,
    };
  }

  // Particles in ID order, so each dot keeps its colour and drawing order.
  // Resting dots are included at their hosts with `visible: false`.
  snapshot(): WorldSnapshot {
    const angles = this.readParticleAngles;
    const radius = this.settings.particleRadius;
    const particles: DotSnapshot[] = new Array(this.particles.length + this.resting.length + this.held.length);
    for (let index = 0; index < this.particles.length; index += 1) {
      const body = this.particles[index];
      const pos = body.translation();
      const vel = body.linvel();
      particles[this.ids[index]] = {
        x: pos.x,
        y: pos.y,
        vx: vel.x,
        vy: vel.y,
        radius,
        speed: Math.hypot(vel.x, vel.y),
        angle: angles ? body.rotation() : 0,
        visible: true,
      };
    }
    for (const dot of this.resting) {
      const host = particles[dot.host];
      particles[dot.id] = { ...host, x: host.x + dot.dx, y: host.y + dot.dy, angle: dot.angle, visible: false };
    }
    for (const { id, state } of this.held) {
      particles[id] = {
        ...state,
        radius,
        speed: Math.hypot(state.vx, state.vy),
        angle: state.angle ?? 0,
        visible: false,
      };
    }

    const controlPosition = this.controlBall.translation();
    const controlVelocity = this.controlBall.linvel();
    return {
      width: this.widthValue,
      height: this.heightValue,
      particles,
      controlBall: {
        x: controlPosition.x,
        y: controlPosition.y,
        vx: controlVelocity.x,
        vy: controlVelocity.y,
        radius: this.settings.controlBallRadius,
        speed: Math.hypot(controlVelocity.x, controlVelocity.y),
        angle: this.controlBall.rotation(),
        visible: this.controlBallPresent,
      },
      collisionMode: this.settings.collisionMode,
    };
  }

  // `entry.plain`: every dot becomes a Rapier body without measuring the
  // crowd (a start or arrangement measures it after moving the dots).
  private rebuild(preserved?: PreservedState, entry?: { plain: boolean }) {
    this.colliderRoles.clear();
    this.particles = [];
    this.overlap = null;
    this.entryFrames = -1;
    this.ids = [];
    this.resting = [];
    this.held = [];
    this.restartStepCost();
    this.particleWallColliders = [];
    this.particleContactColliders = [];
    this.wallColliders = [];
    this.controlWallCollider = null;
    this.controlContactCollider = null;
    // Rapier worlds live in WASM memory, which the JS garbage collector never
    // reclaims; without `free()` every resize, rebuild or preset change leaked
    // a whole world. Nothing keeps a handle into the old world past this point.
    this.eventQueue?.free();
    this.world?.free();
    this.world = new this.rapier.World({ x: 0, y: 0 });
    this.world.lengthUnit = this.settings.rapierLengthUnit;
    this.eventQueue = new this.rapier.EventQueue(true);

    this.createWalls();
    this.createControlBall(preserved?.control);
    this.createParticles(preserved?.particles, entry);
    this.syncControlBallPresence();
    this.particleDiagnostics = this.measureParticles(0);
  }

  private createWalls() {
    const thickness = 80;
    this.createWall(
      -thickness / 2,
      this.heightValue / 2,
      thickness / 2,
      this.heightValue,
      'wall-x',
    );
    this.createWall(
      this.widthValue + thickness / 2,
      this.heightValue / 2,
      thickness / 2,
      this.heightValue,
      'wall-x',
    );
    this.createWall(
      this.widthValue / 2,
      -thickness / 2,
      this.widthValue,
      thickness / 2,
      'wall-y',
    );
    this.createWall(
      this.widthValue / 2,
      this.heightValue + thickness / 2,
      this.widthValue,
      thickness / 2,
      'wall-y',
    );
  }

  private createWall(
    x: number,
    y: number,
    halfWidth: number,
    halfHeight: number,
    role: 'wall-x' | 'wall-y',
  ) {
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(x, y),
    );
    let desc = this.rapier.ColliderDesc.cuboid(halfWidth, halfHeight)
      .setRestitution(this.settings.wallRestitution)
      .setFriction(0)
      .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS)
      .setCollisionGroups(groups(GROUP_WALL, GROUP_CONTROL | GROUP_PARTICLE));
    if (this.settings.colliderLayout === 'single') {
      const multiply = this.rapier.CoefficientCombineRule.Multiply;
      desc = desc
        .setRestitution(this.material().wallRestitution)
        .setRestitutionCombineRule(multiply)
        .setFrictionCombineRule(multiply);
    }
    const collider = this.world.createCollider(desc, body);
    this.colliderRoles.set(collider.handle, role);
    this.wallColliders.push(collider);
  }

  private createControlBall(state?: BodyState) {
    const radius = this.settings.controlBallRadius;
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic()
        .setTranslation(
          state ? clamp(state.x, radius, this.widthValue - radius) : this.widthValue * 0.5,
          state ? clamp(state.y, radius, this.heightValue - radius) : this.heightValue * 0.5,
        )
        .setRotation(state?.angle ?? 0)
        .setLinvel(state?.vx ?? 0, state?.vy ?? 0)
        .setAngvel(state?.angvel ?? 0)
        .setCcdEnabled(true)
        .setCanSleep(false)
        .setLinearDamping(this.settings.controlBallLinearDamping),
    );
    this.controlBall = body;

    if (this.settings.colliderLayout === 'single') {
      const collider = this.world.createCollider(
        this.rapier.ColliderDesc.ball(radius)
          .setDensity(this.settings.controlBallMass / Math.max(Math.PI * radius * radius, 1))
          .setRestitution(this.material().contactRestitution)
          .setFriction(this.settings.controlBallFriction)
          .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS)
          .setCollisionGroups(groups(GROUP_CONTROL, GROUP_WALL | GROUP_PARTICLE)),
        body,
      );
      this.controlWallCollider = collider;
      this.controlContactCollider = collider;
      this.colliderRoles.set(collider.handle, 'control');
      return;
    }

    const wallCollider = this.world.createCollider(
      this.rapier.ColliderDesc.ball(radius)
        .setDensity(0)
        .setRestitution(this.settings.wallRestitution)
        .setFriction(0)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS)
        .setCollisionGroups(groups(GROUP_CONTROL, GROUP_WALL)),
      body,
    );
    const contactCollider = this.world.createCollider(
      this.rapier.ColliderDesc.ball(radius)
        .setDensity(this.settings.controlBallMass / Math.max(Math.PI * radius * radius, 1))
        .setRestitution(this.settings.contactRestitution)
        .setFriction(this.settings.controlBallFriction)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS)
        .setCollisionGroups(groups(GROUP_CONTROL, GROUP_PARTICLE)),
      body,
    );
    this.controlWallCollider = wallCollider;
    this.controlContactCollider = contactCollider;
    this.colliderRoles.set(wallCollider.handle, 'control');
    this.colliderRoles.set(contactCollider.handle, 'control');
  }

  private createParticles(preserved?: BodyState[], entry?: { plain: boolean }) {
    const positions = this.particlePositions(preserved);
    let active = positions.map((_, id) => id);

    // A packed crowd is spread before Rapier takes over, and the dots
    // covered by others in it rest under their hosts first (not simulated,
    // not drawn). A crowd that needs no spread keeps every dot, so presets
    // keep their fill.
    let spread = false;
    if (this.settings.collisionMode === 'collision-physical' && !entry?.plain) {
      const xs = positions.map((position) => position.x);
      const ys = positions.map((position) => position.y);
      const radius = this.settings.particleRadius;
      spread = needsPhysicalSpread(xs, ys, positions.length, radius);
      if (spread && this.legacyEntry) {
        const fit = physicalCapacity(this.widthValue, this.heightValue, radius);
        this.held = positions.slice(fit).map((state, index) => ({ id: fit + index, state }));
        active = active.slice(0, fit);
      } else if (spread) {
        const host = findCoveredDots(xs, ys, active, positions.length, radius);
        active = [];
        host.forEach((over, id) => {
          if (over < 0) {
            active.push(id);
          } else {
            this.resting.push({
              id, host: over, dx: xs[id] - xs[over], dy: ys[id] - ys[over], angle: positions[id].angle,
            });
          }
        });
      }
    }
    this.ids = active;

    if (
      spread ||
      (this.settings.overlapEngine === 'js' &&
        this.settings.collisionMode === 'independence-overlapping')
    ) {
      const overlap = new OverlapParticles(active.length);
      active.forEach((id, index) => {
        const position = positions[id];
        overlap.set(index, position.x, position.y, position.vx, position.vy);
        overlap.angle[index] = position.angle;
        overlap.angvel[index] = position.angvel;
        this.particles.push(new OverlapParticleBody(overlap, index));
      });
      this.overlap = overlap;
      this.entryFrames = spread ? 0 : -1;
      return;
    }

    for (const id of active) {
      const position = positions[id];
      this.addRapierParticle(position.x, position.y, position.vx, position.vy, position.angle, position.angvel);
    }
  }

  // One Rapier particle with the current settings, appended to `particles`.
  private addRapierParticle(x: number, y: number, vx: number, vy: number, angle = 0, angvel = 0) {
    const radius = this.settings.particleRadius;
    const particleFilter = this.particleCollisionFilter();
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic()
        .setTranslation(x, y)
        .setRotation(angle)
        .setLinvel(vx, vy)
        .setAngvel(angvel)
        .setLinearDamping(this.settings.particleLinearDamping),
    );

    if (this.settings.colliderLayout === 'single') {
      const collider = this.world.createCollider(
        this.rapier.ColliderDesc.ball(radius)
          .setDensity(this.settings.particleMass / Math.max(Math.PI * radius * radius, 1))
          .setRestitution(this.material().contactRestitution)
          .setFriction(this.settings.particleFriction)
          .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS)
          .setCollisionGroups(groups(GROUP_PARTICLE, GROUP_WALL | particleFilter)),
        body,
      );
      this.particles.push(body);
      this.particleWallColliders.push(collider);
      this.particleContactColliders.push(collider);
      this.colliderRoles.set(collider.handle, 'particle');
      return;
    }

    const wallCollider = this.world.createCollider(
      this.rapier.ColliderDesc.ball(radius)
        .setDensity(0)
        .setRestitution(this.settings.wallRestitution)
        .setFriction(0)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS)
        .setCollisionGroups(groups(GROUP_PARTICLE, GROUP_WALL)),
      body,
    );
    const contactCollider = this.world.createCollider(
      this.rapier.ColliderDesc.ball(radius)
        .setDensity(this.settings.particleMass / Math.max(Math.PI * radius * radius, 1))
        .setRestitution(this.settings.contactRestitution)
        .setFriction(this.settings.particleFriction)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS)
        .setCollisionGroups(groups(GROUP_PARTICLE, particleFilter)),
      body,
    );
    this.particles.push(body);
    this.particleWallColliders.push(wallCollider);
    this.particleContactColliders.push(contactCollider);
    this.colliderRoles.set(wallCollider.handle, 'particle');
    this.colliderRoles.set(contactCollider.handle, 'particle');
  }

  private particlePositions(preserved?: BodyState[]) {
    const count = this.settings.particleCount;
    const cols = Math.ceil(Math.sqrt((count * this.widthValue) / this.heightValue));
    const rows = Math.ceil(count / cols);
    const xSpacing = this.widthValue / (cols + 1);
    const ySpacing = this.heightValue / (rows + 1);
    const positions: Array<{ x: number; y: number; vx: number; vy: number; angle: number; angvel: number }> = [];

    for (let i = 0; i < count; i += 1) {
      const existing = preserved?.[i];
      if (existing) {
        positions.push({
          x: clamp(existing.x, this.settings.particleRadius, this.widthValue - this.settings.particleRadius),
          y: clamp(existing.y, this.settings.particleRadius, this.heightValue - this.settings.particleRadius),
          vx: existing.vx,
          vy: existing.vy,
          angle: existing.angle ?? 0,
          angvel: existing.angvel ?? 0,
        });
        continue;
      }

      const col = i % cols;
      const row = Math.floor(i / cols);
      const jitterX = (Math.random() - 0.5) * xSpacing * 0.45;
      const jitterY = (Math.random() - 0.5) * ySpacing * 0.45;
      positions.push({
        x: (col + 1) * xSpacing + jitterX,
        y: (row + 1) * ySpacing + jitterY,
        vx: (Math.random() - 0.5) * 60,
        vy: (Math.random() - 0.5) * 60,
        angle: 0,
        angvel: 0,
      });
    }

    return positions;
  }

  // Particles in ID order along a spiral around the Ball, each with the unit
  // direction along the spiral (`tx`, `ty`).
  private spiralParticlePositions() {
    const count = this.particles.length;
    const radius = this.settings.particleRadius;
    const spacing = Math.max(radius * 2.35, 10);
    const control = this.controlBall.translation();
    const startRadius = this.settings.controlBallRadius + radius * 3.2;
    const radialStep = spacing * FLASH_SPIRAL_RADIAL_STEP_SCALE;
    const positions: Array<{ x: number; y: number; tx: number; ty: number }> = [];
    let theta = -Math.PI * 0.35;

    for (let index = 0; index < count; index += 1) {
      const spiralRadius = startRadius + radialStep * Math.max(theta + Math.PI * 0.35, 0);
      const rawX = control.x + Math.cos(theta) * spiralRadius;
      const rawY = control.y + Math.sin(theta) * spiralRadius;
      const x = clampToPlayfield(rawX, radius, this.widthValue);
      const y = clampToPlayfield(rawY, radius, this.heightValue);
      const dx = x - control.x;
      const dy = y - control.y;
      const distance = Math.hypot(dx, dy);
      const tangent = distance > 0.001
        ? { x: -dy / distance, y: dx / distance }
        : { x: 0, y: 0 };

      positions.push({ x, y, tx: tangent.x, ty: tangent.y });

      theta += (spacing / Math.max(spiralRadius, spacing)) * 1.08;
    }

    return positions;
  }

  private driveControlBall(dt: number) {
    if (!this.controlBallPresent || !this.pointerActive) {
      return;
    }

    const pos = this.controlBall.translation();
    const radius = this.settings.controlBallRadius;
    const targetX = clamp(this.pointerX, radius, this.widthValue - radius);
    const targetY = clamp(this.pointerY, radius, this.heightValue - radius);
    const desiredX = targetX - pos.x;
    const desiredY = targetY - pos.y;
    const distance = Math.hypot(desiredX, desiredY);

    if (distance < 0.01) {
      this.controlBall.setLinvel({ x: 0, y: 0 }, true);
      return;
    }

    const speed = Math.min(
      (distance / Math.max(dt, 0.001)) * this.settings.pointerVelocityScale,
      this.settings.controlBallMaxSpeed,
    );

    this.controlBall.setLinvel(
      {
        x: (desiredX / distance) * speed,
        y: (desiredY / distance) * speed,
      },
      true,
    );
  }

  private containControlBall() {
    if (!this.controlBallPresent) {
      return;
    }

    const radius = this.settings.controlBallRadius;
    const position = this.controlBall.translation();
    const velocity = this.controlBall.linvel();
    const nextX = clampToPlayfield(position.x, radius, this.widthValue);
    const nextY = clampToPlayfield(position.y, radius, this.heightValue);

    if (nextX === position.x && nextY === position.y) {
      return;
    }

    let nextVx = velocity.x;
    let nextVy = velocity.y;
    const bounce = this.settings.wallRestitution;

    if (nextX !== position.x) {
      nextVx = position.x < nextX ? Math.abs(velocity.x) * bounce : -Math.abs(velocity.x) * bounce;
    }

    if (nextY !== position.y) {
      nextVy = position.y < nextY ? Math.abs(velocity.y) * bounce : -Math.abs(velocity.y) * bounce;
    }

    this.controlBall.setTranslation({ x: nextX, y: nextY }, true);
    this.controlBall.setLinvel({ x: nextVx, y: nextVy }, true);
  }

  private showTouchControlBall(x: number, y: number) {
    const radius = this.settings.controlBallRadius;
    this.controlBallPresent = true;
    this.controlBall.setTranslation(
      {
        x: clampToPlayfield(x, radius, this.widthValue),
        y: clampToPlayfield(y, radius, this.heightValue),
      },
      true,
    );
    this.controlBall.setLinvel({ x: 0, y: 0 }, true);
    this.setControlCollidersEnabled(true);
  }

  private hideTouchControlBall() {
    this.controlBallPresent = false;
    this.controlBall.setLinvel({ x: 0, y: 0 }, true);
    this.setControlCollidersEnabled(false);
  }

  private syncControlBallPresence() {
    if (this.settings.controlBallMode === 'touch') {
      if (this.pointerActive) {
        this.showTouchControlBall(this.pointerX, this.pointerY);
      } else {
        this.hideTouchControlBall();
      }
      return;
    }

    this.controlBallPresent = true;
    this.setControlCollidersEnabled(true);
  }

  private setControlCollidersEnabled(enabled: boolean) {
    if (this.settings.colliderLayout === 'single') {
      setColliderEnabled(
        this.controlContactCollider,
        enabled,
        groups(GROUP_CONTROL, GROUP_WALL | GROUP_PARTICLE),
      );
      return;
    }

    setColliderEnabled(this.controlWallCollider, enabled, groups(GROUP_CONTROL, GROUP_WALL));
    setColliderEnabled(this.controlContactCollider, enabled, groups(GROUP_CONTROL, GROUP_PARTICLE));
  }

  private containParticles() {
    const radius = this.settings.particleRadius;
    let recovered = 0;
    let outOfBounds = 0;
    let nonFinite = 0;
    let maxSpeed = 0;
    let maxOutOfBoundsDistance = 0;

    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      const position = particle.translation();
      const velocity = particle.linvel();
      const positionFinite = isFiniteVector(position);
      const velocityFinite = isFiniteVector(velocity);

      if (!velocityFinite) {
        nonFinite += 1;
      } else if (this.diagnosticsEnabled) {
        maxSpeed = Math.max(maxSpeed, Math.hypot(velocity.x, velocity.y));
      }

      if (!positionFinite) {
        if (velocityFinite) {
          nonFinite += 1;
        }
        particle.setTranslation(this.safeParticlePosition(index), true);
        particle.setLinvel({ x: 0, y: 0 }, true);
        recovered += 1;
        continue;
      }

      const nextX = clampToPlayfield(position.x, radius, this.widthValue);
      const nextY = clampToPlayfield(position.y, radius, this.heightValue);
      const outX = Math.abs(nextX - position.x) > PARTICLE_CONTAINMENT_EPSILON;
      const outY = Math.abs(nextY - position.y) > PARTICLE_CONTAINMENT_EPSILON;

      if (!outX && !outY && velocityFinite) {
        continue;
      }

      if (outX || outY) {
        outOfBounds += 1;
        if (this.diagnosticsEnabled) {
          maxOutOfBoundsDistance = Math.max(
            maxOutOfBoundsDistance,
            outOfBoundsDistance(position, radius, this.widthValue, this.heightValue),
          );
        }
      }

      let nextVx = velocityFinite ? velocity.x : 0;
      let nextVy = velocityFinite ? velocity.y : 0;
      const bounce = this.settings.wallRestitution;

      if (outX) {
        nextVx = position.x < nextX ? Math.abs(nextVx) * bounce : -Math.abs(nextVx) * bounce;
      }

      if (outY) {
        nextVy = position.y < nextY ? Math.abs(nextVy) * bounce : -Math.abs(nextVy) * bounce;
      }

      particle.setTranslation({ x: nextX, y: nextY }, true);
      particle.setLinvel({ x: nextVx, y: nextVy }, true);
      recovered += 1;
    }

    if (!this.diagnosticsEnabled) {
      this.particleDiagnostics = {
        ...emptyParticleDiagnostics(),
        total: this.particles.length,
        outOfBounds,
        nonFinite,
        recoveredLastStep: recovered,
      };
      return;
    }

    this.particleDiagnostics = {
      ...this.measureParticles(recovered),
      outOfBounds,
      nonFinite,
      maxSpeed,
      maxOutOfBoundsDistance,
    };
  }

  private measureParticles(recoveredLastStep: number): ParticleDiagnostics {
    const radius = this.settings.particleRadius;
    let visible = 0;
    let outOfBounds = 0;
    let nonFinite = 0;
    let maxSpeed = 0;
    let maxOutOfBoundsDistance = 0;

    for (const particle of this.particles) {
      const position = particle.translation();
      const velocity = particle.linvel();
      const positionFinite = isFiniteVector(position);
      const velocityFinite = isFiniteVector(velocity);

      if (!positionFinite || !velocityFinite) {
        nonFinite += 1;
        continue;
      }

      const speed = Math.hypot(velocity.x, velocity.y);
      maxSpeed = Math.max(maxSpeed, speed);

      const outsideDistance = outOfBoundsDistance(position, radius, this.widthValue, this.heightValue);
      if (outsideDistance > PARTICLE_CONTAINMENT_EPSILON) {
        outOfBounds += 1;
        maxOutOfBoundsDistance = Math.max(maxOutOfBoundsDistance, outsideDistance);
        continue;
      }

      visible += 1;
    }

    return {
      total: this.particles.length,
      visible,
      outOfBounds,
      nonFinite,
      maxSpeed,
      maxOutOfBoundsDistance,
      recoveredLastStep,
    };
  }

  private safeParticlePosition(index: number) {
    const radius = this.settings.particleRadius;
    const cols = Math.max(1, Math.floor(this.widthValue / Math.max(radius * 4, 1)));
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = radius * 2 + col * radius * 4;
    const y = radius * 2 + row * radius * 4;

    return {
      x: clampToPlayfield(x, radius, this.widthValue),
      y: clampToPlayfield(y, radius, this.heightValue),
    };
  }

  private applyVelocityCombi(dt: number) {
    if (
      this.settings.dotCombiMode !== 'velocity' ||
      this.settings.collisionMode !== 'independence-overlapping'
    ) {
      return;
    }

    // Read only when linking is on: every other scene skipped the result.
    const previousVelocities = this.captureParticleVelocities();

    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      const current = particle.linvel();
      const leader = previousVelocities[index - 1];
      const inheritedX = leader
        ? current.x * (1 - VELOCITY_COMBI_BLEND) + leader.x * VELOCITY_COMBI_BLEND
        : current.x;
      const inheritedY = leader
        ? current.y * (1 - VELOCITY_COMBI_BLEND) + leader.y * VELOCITY_COMBI_BLEND
        : current.y;

      particle.setLinvel(
        limitVelocity(
          {
            x: inheritedX,
            y: inheritedY,
          },
          VELOCITY_COMBI_MAX_SPEED,
        ),
        true,
      );
    }
  }

  private applyControlGravity(dt: number) {
    if (
      !this.controlBallPresent ||
      this.settings.gravityMode === 'none' ||
      this.settings.gravityStrength <= 0
    ) {
      return;
    }

    const directionSign = this.settings.gravityMode === 'antigravity' ? -1 : 1;
    const center = this.controlBall.translation();
    const softening = Math.max(this.settings.controlBallRadius * 0.9, 1);
    const contactDistance = this.settings.controlBallRadius + this.settings.particleRadius;
    const contactReliefDistance = this.settings.particleRadius * 4;

    for (const particle of this.particles) {
      const pos = particle.translation();
      const velocity = particle.linvel();
      const dx = center.x - pos.x;
      const dy = center.y - pos.y;
      const distance = Math.hypot(dx, dy);

      if (distance <= 0.001) {
        continue;
      }

      const surfaceGap = distance - contactDistance;
      const contactScale = clamp(surfaceGap / Math.max(contactReliefDistance, 1), 0, 1);
      const acceleration = Math.min(
        (CONTROL_GRAVITY_STRENGTH * this.settings.gravityStrength) /
          (distance * distance + softening * softening),
        CONTROL_GRAVITY_MAX_ACCEL * this.settings.gravityStrength,
      ) * contactScale;

      particle.setLinvel(
        limitVelocity(
          {
            x: velocity.x + (dx / distance) * acceleration * directionSign * dt,
            y: velocity.y + (dy / distance) * acceleration * directionSign * dt,
          },
          VELOCITY_COMBI_MAX_SPEED,
        ),
        true,
      );
    }
  }

  // Only a released ball steers: the pointer sets the velocity while pressed.
  private applyBallWeave(dt: number) {
    if (!this.settings.ballWeave || !this.controlBallPresent || this.pointerActive) {
      this.weaveWallTurn = null;
      this.weaveLastSpeed = 0;
      return;
    }

    const velocity = this.controlBall.linvel();
    const ball = this.controlBall.translation();
    const push = weavePushFromAgility(this.settings.ballWeaveAgility);
    const speed = Math.hypot(velocity.x, velocity.y);
    // Steering keeps the speed, so any change beyond damping came from a contact.
    const expectedSpeed = this.weaveLastSpeed / (1 + dt * this.settings.controlBallLinearDamping);
    const contact = Math.abs(speed - expectedSpeed) > 1;
    this.weaveLastSpeed = speed;

    this.weaveWallTurn = this.settings.ballWeaveWalls
      ? nextWallTurn(
          this.weaveWallTurn,
          velocity,
          ball,
          this.settings.controlBallRadius,
          this.widthValue,
          this.heightValue,
          push,
          contact,
        )
      : null;

    this.controlBall.setLinvel(
      this.weaveWallTurn
        ? wallTurnVelocity(velocity, this.weaveWallTurn, push, dt)
        : weaveVelocity(
            velocity,
            ball,
            this.settings.controlBallRadius + this.settings.particleRadius,
            this.particles.map((particle) => particle.translation()),
            dt,
            push,
            weaveRangeFromSight(this.settings.ballWeaveSight),
          ),
      true,
    );
  }

  private collectImpacts() {
    const impacts: ImpactEvent[] = [];
    this.eventQueue.drainCollisionEvents(
      (handleA: number, handleB: number, started: boolean) => {
        if (!started) {
          return;
        }

        const roleA = this.colliderRoles.get(handleA);
        const roleB = this.colliderRoles.get(handleB);
        if (!roleA || !roleB) {
          return;
        }

        const kind = this.impactKind(roleA, roleB);
        if (!kind) {
          return;
        }

        const energy = this.impactEnergy(handleA, handleB);
        if (energy > 12) {
          impacts.push({ kind, energy });
        }
      },
    );

    return impacts;
  }

  private impactKind(roleA: BodyRole, roleB: BodyRole): ImpactEvent['kind'] | null {
    const hasWall = isWallRole(roleA) || isWallRole(roleB);
    const hasControl = roleA === 'control' || roleB === 'control';
    const hasParticle = roleA === 'particle' || roleB === 'particle';

    if (hasWall && hasControl) {
      return 'ball-wall';
    }

    if (hasWall && hasParticle) {
      return 'particle-wall';
    }

    if (hasControl && hasParticle) {
      return 'ball-particle';
    }

    if (roleA === 'particle' && roleB === 'particle') {
      return 'particle-particle';
    }

    return null;
  }

  // Restitution values for the `single` layout; see `contactMaterials.ts`.
  private material() {
    return contactMaterial(this.settings.contactRestitution, this.settings.wallRestitution);
  }

  private particleCollisionFilter() {
    switch (this.settings.collisionMode) {
      case 'collision-physical':
        return GROUP_CONTROL | GROUP_PARTICLE;
      case 'independence-overlapping':
      default:
        return GROUP_CONTROL;
    }
  }

  private impactEnergy(handleA: number, handleB: number) {
    const colliderA = this.world.getCollider(handleA);
    const colliderB = this.world.getCollider(handleB);
    const bodyA = colliderA.parent();
    const bodyB = colliderB.parent();
    const velA = bodyA?.linvel() ?? { x: 0, y: 0 };
    const velB = bodyB?.linvel() ?? { x: 0, y: 0 };
    return Math.hypot(velA.x - velB.x, velA.y - velB.y);
  }

  private captureState(): PreservedState | undefined {
    if (!this.controlBall) {
      return undefined;
    }

    return {
      control: bodyState(this.controlBall),
      particles: this.particleStatesInOrder(),
    };
  }

  // Every dot in ID order; a resting dot at its host plus its offset, with
  // the host's velocity.
  private particleStatesInOrder(): BodyState[] {
    const states: BodyState[] = new Array(this.particles.length + this.resting.length + this.held.length);
    this.particles.forEach((particle, index) => {
      states[this.ids[index]] = bodyState(particle);
    });
    for (const dot of this.resting) {
      const host = states[dot.host];
      states[dot.id] = { ...host, x: host.x + dot.dx, y: host.y + dot.dy, angle: dot.angle };
    }
    for (const { id, state } of this.held) {
      states[id] = state;
    }
    return states;
  }

  private captureParticleVelocities() {
    return this.particles.map((particle) => {
      const velocity = particle.linvel();
      return { x: velocity.x, y: velocity.y };
    });
  }

  private applyRuntimeSettings() {
    callIfFunction(
      this.controlBall,
      'setLinearDamping',
      this.settings.controlBallLinearDamping,
    );

    if (this.settings.colliderLayout === 'single') {
      const material = this.material();
      callIfFunction(this.controlContactCollider, 'setRestitution', material.contactRestitution);
      callIfFunction(this.controlContactCollider, 'setFriction', this.settings.controlBallFriction);
      callIfFunction(
        this.controlContactCollider,
        'setDensity',
        this.settings.controlBallMass /
          Math.max(Math.PI * this.settings.controlBallRadius * this.settings.controlBallRadius, 1),
      );

      for (const wallCollider of this.wallColliders) {
        callIfFunction(wallCollider, 'setRestitution', material.wallRestitution);
      }

      for (const particle of this.particles) {
        callIfFunction(particle, 'setLinearDamping', this.settings.particleLinearDamping);
      }

      const particleDensity =
        this.settings.particleMass /
        Math.max(Math.PI * this.settings.particleRadius * this.settings.particleRadius, 1);
      for (const collider of this.particleContactColliders) {
        callIfFunction(collider, 'setRestitution', material.contactRestitution);
        callIfFunction(collider, 'setFriction', this.settings.particleFriction);
        callIfFunction(collider, 'setDensity', particleDensity);
      }
      return;
    }

    callIfFunction(
      this.controlWallCollider,
      'setRestitution',
      this.settings.wallRestitution,
    );
    callIfFunction(
      this.controlContactCollider,
      'setRestitution',
      this.settings.contactRestitution,
    );
    callIfFunction(this.controlContactCollider, 'setFriction', this.settings.controlBallFriction);
    callIfFunction(
      this.controlContactCollider,
      'setDensity',
      this.settings.controlBallMass /
        Math.max(Math.PI * this.settings.controlBallRadius * this.settings.controlBallRadius, 1),
    );

    for (const wallCollider of this.wallColliders) {
      callIfFunction(wallCollider, 'setRestitution', this.settings.wallRestitution);
    }

    for (const particle of this.particles) {
      callIfFunction(particle, 'setLinearDamping', this.settings.particleLinearDamping);
    }

    const particleDensity =
      this.settings.particleMass /
      Math.max(Math.PI * this.settings.particleRadius * this.settings.particleRadius, 1);
    for (const collider of this.particleWallColliders) {
      callIfFunction(collider, 'setRestitution', this.settings.wallRestitution);
    }

    for (const collider of this.particleContactColliders) {
      callIfFunction(collider, 'setRestitution', this.settings.contactRestitution);
      callIfFunction(collider, 'setFriction', this.settings.particleFriction);
      callIfFunction(collider, 'setDensity', particleDensity);
    }
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampToPlayfield(value: number, radius: number, size: number) {
  if (size <= radius * 2) {
    return size * 0.5;
  }

  return clamp(value, radius, size - radius);
}

function bodyState(body: any): BodyState {
  const pos = body.translation();
  const vel = body.linvel();
  return { x: pos.x, y: pos.y, vx: vel.x, vy: vel.y, angle: body.rotation(), angvel: body.angvel() };
}

function limitVelocity(velocity: { x: number; y: number }, maxSpeed: number) {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (speed <= maxSpeed || speed <= 0.001) {
    return velocity;
  }

  return {
    x: (velocity.x / speed) * maxSpeed,
    y: (velocity.y / speed) * maxSpeed,
  };
}

function needsWorldRebuild(previous: DotpingSettings, next: DotpingSettings) {
  return (
    previous.collisionMode !== next.collisionMode ||
    previous.particleCount !== next.particleCount ||
    previous.particleRadius !== next.particleRadius ||
    previous.controlBallRadius !== next.controlBallRadius ||
    previous.controlBallMass !== next.controlBallMass ||
    previous.rapierLengthUnit !== next.rapierLengthUnit ||
    previous.colliderLayout !== next.colliderLayout ||
    previous.overlapEngine !== next.overlapEngine ||
    previous.physicalEntryMode !== next.physicalEntryMode
  );
}

function callIfFunction(target: any, method: string, ...args: unknown[]) {
  if (target && typeof target[method] === 'function') {
    target[method](...args);
  }
}

function setColliderEnabled(collider: any, enabled: boolean, enabledGroups: number) {
  callIfFunction(collider, 'setEnabled', enabled);
  callIfFunction(collider, 'setCollisionGroups', enabled ? enabledGroups : 0);
}

function isFiniteVector(value: { x: number; y: number }) {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
}

function outOfBoundsDistance(
  position: { x: number; y: number },
  radius: number,
  width: number,
  height: number,
) {
  const outsideLeft = Math.max(radius - position.x, 0);
  const outsideRight = Math.max(position.x - (width - radius), 0);
  const outsideTop = Math.max(radius - position.y, 0);
  const outsideBottom = Math.max(position.y - (height - radius), 0);
  return Math.max(outsideLeft, outsideRight, outsideTop, outsideBottom);
}

function emptyParticleDiagnostics(): ParticleDiagnostics {
  return {
    total: 0,
    visible: 0,
    outOfBounds: 0,
    nonFinite: 0,
    maxSpeed: 0,
    maxOutOfBoundsDistance: 0,
    recoveredLastStep: 0,
  };
}
