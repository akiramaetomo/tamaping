import type { ColliderLayout, CollisionMode, DotpingSettings } from './settings';

type RapierModule = any;

type BodyRole = 'particle' | 'control' | 'wall-x' | 'wall-y';
type BodyState = { x: number; y: number; vx: number; vy: number };
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
  lengthUnit: number;
  colliderLayout: ColliderLayout;
  colliderCount: number;
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
  radius: number;
  speed: number;
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

export class DotpingPhysicsWorld {
  private world!: any;
  private eventQueue!: any;
  private particles: any[] = [];
  private particleWallColliders: any[] = [];
  private particleContactColliders: any[] = [];
  private controlBall!: any;
  private controlWallCollider: any = null;
  private controlContactCollider: any = null;
  private wallColliders: any[] = [];
  private colliderRoles = new Map<number, BodyRole>();
  private settings: DotpingSettings;
  private pointerActive = false;
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
    if (this.particles.length <= 0) {
      return;
    }

    const positions = this.flashParticlePositions();
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      const position = positions[index];
      particle.setTranslation({ x: position.x, y: position.y }, true);
      particle.setLinvel({ x: position.vx, y: position.vy }, true);
    }
  }

  // Same jittered-grid scatter that a freshly built scene starts with.
  arrangeRandomParticles() {
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
  }

  arrangeParticlesToTargets(targets: ParticleFormationTarget[]) {
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
    this.world.timestep = dt;
    this.driveControlBall(dt);
    const previousVelocities = this.captureParticleVelocities();

    this.applyVelocityCombi(dt, previousVelocities);
    this.applyControlGravity(dt);

    const startedAt = performance.now();
    this.world.step(this.eventQueue);
    const durationMs = performance.now() - startedAt;
    this.containControlBall();
    this.containParticles();
    return {
      impacts: this.collectImpacts(),
      metrics: {
        durationMs,
        lengthUnit: this.settings.rapierLengthUnit,
        colliderLayout: this.settings.colliderLayout,
        colliderCount: this.colliderCount,
      },
    };
  }

  snapshot(): WorldSnapshot {
    const particles = this.particles.map((body) => {
      const pos = body.translation();
      const vel = body.linvel();
      return {
        x: pos.x,
        y: pos.y,
        radius: this.settings.particleRadius,
        speed: Math.hypot(vel.x, vel.y),
        visible: true,
      };
    });

    const controlPosition = this.controlBall.translation();
    const controlVelocity = this.controlBall.linvel();
    return {
      width: this.widthValue,
      height: this.heightValue,
      particles,
      controlBall: {
        x: controlPosition.x,
        y: controlPosition.y,
        radius: this.settings.controlBallRadius,
        speed: Math.hypot(controlVelocity.x, controlVelocity.y),
        visible: this.controlBallPresent,
      },
      collisionMode: this.settings.collisionMode,
    };
  }

  private rebuild(preserved?: PreservedState) {
    this.colliderRoles.clear();
    this.particles = [];
    this.particleWallColliders = [];
    this.particleContactColliders = [];
    this.wallColliders = [];
    this.controlWallCollider = null;
    this.controlContactCollider = null;
    this.world = new this.rapier.World({ x: 0, y: 0 });
    this.world.lengthUnit = this.settings.rapierLengthUnit;
    this.eventQueue = new this.rapier.EventQueue(true);

    this.createWalls();
    this.createControlBall(preserved?.control);
    this.createParticles(preserved?.particles);
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
    const collider = this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(halfWidth, halfHeight)
        .setRestitution(this.settings.wallRestitution)
        .setFriction(0)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS)
        .setCollisionGroups(groups(GROUP_WALL, GROUP_CONTROL | GROUP_PARTICLE)),
      body,
    );
    this.colliderRoles.set(collider.handle, role);
    this.wallColliders.push(collider);
  }

  private createControlBall(state?: BodyState) {
    const radius = this.settings.controlBallRadius;
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic()
        .setTranslation(
          state ? clamp(state.x, radius, this.widthValue - radius) : this.widthValue * 0.5,
          state ? clamp(state.y, radius, this.heightValue - radius) : this.heightValue * 0.68,
        )
        .setLinvel(state?.vx ?? 0, state?.vy ?? 0)
        .setCcdEnabled(true)
        .setCanSleep(false)
        .setLinearDamping(this.settings.controlBallLinearDamping),
    );
    this.controlBall = body;

    if (this.settings.colliderLayout === 'single') {
      const collider = this.world.createCollider(
        this.rapier.ColliderDesc.ball(radius)
          .setDensity(this.settings.controlBallMass / Math.max(Math.PI * radius * radius, 1))
          .setRestitution(this.settings.contactRestitution)
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

  private createParticles(preserved?: BodyState[]) {
    const positions = this.particlePositions(preserved);
    const particleFilter = this.particleCollisionFilter();

    for (const position of positions) {
      const radius = this.settings.particleRadius;
      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.dynamic()
          .setTranslation(position.x, position.y)
          .setLinvel(position.vx, position.vy)
          .setLinearDamping(this.settings.particleLinearDamping),
      );

      if (this.settings.colliderLayout === 'single') {
        const collider = this.world.createCollider(
          this.rapier.ColliderDesc.ball(radius)
            .setDensity(this.settings.particleMass / Math.max(Math.PI * radius * radius, 1))
            .setRestitution(this.settings.contactRestitution)
            .setFriction(this.settings.particleFriction)
            .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS)
            .setCollisionGroups(groups(GROUP_PARTICLE, GROUP_WALL | particleFilter)),
          body,
        );
        this.particles.push(body);
        this.particleWallColliders.push(collider);
        this.particleContactColliders.push(collider);
        this.colliderRoles.set(collider.handle, 'particle');
        continue;
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
  }

  private particlePositions(preserved?: BodyState[]) {
    const count = this.settings.particleCount;
    const cols = Math.ceil(Math.sqrt((count * this.widthValue) / this.heightValue));
    const rows = Math.ceil(count / cols);
    const xSpacing = this.widthValue / (cols + 1);
    const ySpacing = this.heightValue / (rows + 1);
    const positions: Array<{ x: number; y: number; vx: number; vy: number }> = [];

    for (let i = 0; i < count; i += 1) {
      const existing = preserved?.[i];
      if (existing) {
        positions.push({
          x: clamp(existing.x, this.settings.particleRadius, this.widthValue - this.settings.particleRadius),
          y: clamp(existing.y, this.settings.particleRadius, this.heightValue - this.settings.particleRadius),
          vx: existing.vx,
          vy: existing.vy,
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
      });
    }

    return positions;
  }

  private flashParticlePositions() {
    const count = this.particles.length;
    const radius = this.settings.particleRadius;
    const spacing = Math.max(radius * 2.35, 10);
    const control = this.controlBall.translation();
    const startRadius = this.settings.controlBallRadius + radius * 3.2;
    const radialStep = spacing * FLASH_SPIRAL_RADIAL_STEP_SCALE;
    const positions: Array<{ x: number; y: number; vx: number; vy: number }> = [];
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
      const pulse = index === 0 ? 0 : LINK_FLASH_SPEED * (0.65 + ((index % 5) * 0.07));

      positions.push({
        x,
        y,
        vx: tangent.x * pulse,
        vy: tangent.y * pulse,
      });

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

  private applyVelocityCombi(dt: number, previousVelocities: Array<{ x: number; y: number }>) {
    if (
      this.settings.dotCombiMode !== 'velocity' ||
      this.settings.collisionMode !== 'independence-overlapping'
    ) {
      return;
    }

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
      particles: this.particles.map((particle) => bodyState(particle)),
    };
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
      callIfFunction(this.controlContactCollider, 'setRestitution', this.settings.contactRestitution);
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
      for (const collider of this.particleContactColliders) {
        callIfFunction(collider, 'setRestitution', this.settings.contactRestitution);
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
  return { x: pos.x, y: pos.y, vx: vel.x, vy: vel.y };
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
    previous.colliderLayout !== next.colliderLayout
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
