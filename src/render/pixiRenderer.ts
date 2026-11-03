import { Application, Container, Graphics, Sprite, UPDATE_PRIORITY } from 'pixi.js';
import {
  AFTERGLOW_BAND_WIDTH,
  AFTERGLOW_STAMP_RADIUS,
  AfterglowBuffer,
  afterglowStampTextures,
} from './afterglow';
import { RAY_TEXTURE_RADIUS, rayTexture, redrawRayTexture } from './fxTextures';
import {
  BALL_CURVE,
  BALL_TRAIL_MAX_RADII,
  BALL_TRAIL_SECONDS,
  AFTERGLOW_MAX_SECONDS,
  NO_MOTION_FX,
  afterglowLife,
  afterglowTint,
  SpeedHold,
  TrailHistory,
  rayAlpha,
  rayScale,
  rayShapeExponent,
  shapeRotation,
  shapeTurns,
  speedFactor,
  type MotionFx,
} from './motionFx';
import { FishMotion, fishParts, type Polygon } from './fishBody';
import type { WorldSnapshot } from '../sim/physicsWorld';
import type {
  BallPalette,
  ParticleGlowMode,
  ParticlePalette,
  ParticleRenderer,
} from '../sim/settings';
import { paletteColor, speedColor, speedColorToward, vividGlowColor } from './particleColors';
import { SpriteParticleLayer } from './spriteParticleLayer';

// The ball's body outline in one frame, for the afterglow: a circle, or
// polygons (star, fish) in world coordinates, or nothing (`none`).
// `discRadius` is the disc stamped there, inside the outline; `bandRadius`
// the half-width of the band stamped along a step.
type BallFootprint = {
  x: number;
  y: number;
  ballRadius: number;
  radius: number;
  discRadius: number;
  bandRadius: number;
  polygons: number[][] | null;
  outline: boolean;
};

type BallStyle = {
  glow: number;
  glowAlpha: number;
  fill: number;
  fillAlpha: number;
  highlight: number;
  highlightAlpha: number;
  shade: number;
  shadeAlpha: number;
  stroke: number;
  strokeAlpha: number;
  center: number;
  centerAlpha: number;
};

const PARTICLE_RIM_ALPHA = 0.72;
const LEADER_COLOR = 0xf7fbff;
const LEADER_RIM_ALPHA = 0.94;
const LEADER_HALO_ALPHA = 0.18;
const LEADER_HALO_SCALE = 1.75;
const BALL_STAR_INNER_RATIO = 0.5;
// Ball trail segments: width and opacity taper toward the oldest point.
// Per segment; about five resampled segments overlap near the head.
const BALL_TRAIL_ALPHA = 0.24;
const BALL_TRAIL_SPACING_RADII = 0.4;
const BALL_TRAIL_MIN_WIDTH = 0.15;
// Afterglow: screen pixels added to each cut-out's radius. Negative: the
// cut-out sits just inside the body's edge, so the glow reaches under the
// body's antialiased edge and no dark seam separates them. (A cut-out
// larger than the body showed as a thin black ring.) A resting dot stamps
// no glow, so there is nothing to hide at its edge.
const AFTERGLOW_ERASE_GROW_PX = -0.5;
// A ball that moved further than this many radii in one frame was placed,
// not moving, and leaves no glow.
const BALL_AFTERGLOW_MAX_STEP_RADII = 12;
const BALL_GLOW_SPEED_SECONDS = 0.2;
// Band pieces about this many band half-widths long, at most this many.
const BALL_AFTERGLOW_PIECE_RADII = 0.25;
const BALL_AFTERGLOW_MAX_PIECES = 16;
// Half-width of a five-point star across any direction, against its outer
// radius (about sin 72 degrees); the band along a star's step is this wide.
const STAR_SPAN = Math.sin((2 * Math.PI) / 5);

export class PixiRenderer {
  private readonly app = new Application();
  private readonly particles = new Graphics();
  private readonly control = new Graphics();
  private readonly table = new Graphics();
  private readonly ballTrail = new Graphics();
  private readonly ballTrailHistory = new TrailHistory();
  private readonly ballSpeedHold = new SpeedHold();
  // Ball fish beat and turn curl; the ball draws its bent outline live.
  private readonly ballFish = new FishMotion();
  private ballFishAt = -1;
  private ballRays: Sprite | null = null;
  private afterglow: AfterglowBuffer | null = null;
  // Ball afterglow: a disc at last frame's position and a band to here are
  // stamped, and the outline here is cut out.
  private readonly ballStamps = new Container();
  private readonly ballDisc = new Sprite(afterglowStampTextures().disc);
  // The band is split into pieces whose age runs from last frame's to this
  // frame's, so neighbouring frames' glow dies evenly: the ball steps far
  // per frame, and one age per band left sawtooth edges on curves.
  private readonly ballBands: Sprite[] = [];
  private readonly ballFootprint = new Graphics();
  private lastBallFootprint: BallFootprint | null = null;
  // The ball's speed for its glow's life, smoothed: the held speed still
  // steps between frames with and without a pointer event, and neighbouring
  // stamps with different lives would die at different times (dark slats).
  private ballGlowSpeed = 0;
  private ballGlowAt = -1;
  private particleFx: MotionFx = NO_MOTION_FX;
  private ballFx: MotionFx = NO_MOTION_FX;
  private spriteParticles: SpriteParticleLayer | null = null;
  private tableWidth = -1;
  private tableHeight = -1;
  private particleBaseColors: number[] = [];
  // Glow target per dot for the sprite path; empty when stale.
  private particleGlowTargets: number[] = [];
  private particlePalette: ParticlePalette = 'blue';
  private particleRimWidthPercent = 20;
  private particleBrightnessResponse = 1;
  private particleGlowMode: ParticleGlowMode = 'gold';
  private particleGlowVividness = 0.85;
  private particleLeaderVisible = false;
  private ballPalette: BallPalette = 'blue';
  private ballRimEnabled = true;
  private renderStartedAt = 0;
  private renderTimeListener: ((ms: number) => void) | null = null;

  // `graphics` keeps the old path (one Graphics rebuilt every frame, table
  // redrawn every frame) unchanged, for `?pr=graphics` comparisons.
  constructor(
    private readonly root: HTMLElement,
    readonly particleRenderer: ParticleRenderer = 'sprite',
  ) {}

  get rendererName() {
    return this.app.renderer.name;
  }

  get resolution() {
    return this.app.renderer.resolution;
  }

  // Pixi renders from its own ticker at LOW priority; these bracket that call.
  setRenderTimeListener(listener: ((ms: number) => void) | null) {
    const ticker = this.app.ticker;
    ticker.remove(this.markRenderStart);
    ticker.remove(this.markRenderEnd);
    this.renderTimeListener = listener;
    if (listener) {
      ticker.add(this.markRenderStart, undefined, UPDATE_PRIORITY.LOW + 1);
      ticker.add(this.markRenderEnd, undefined, UPDATE_PRIORITY.UTILITY);
    }
  }

  private readonly markRenderStart = () => {
    this.renderStartedAt = performance.now();
  };

  private readonly markRenderEnd = () => {
    this.renderTimeListener?.(performance.now() - this.renderStartedAt);
  };

  get canvas() {
    return this.app.canvas;
  }

  get width() {
    return this.app.renderer.width;
  }

  get height() {
    return this.app.renderer.height;
  }

  async init() {
    await this.app.init({
      resizeTo: window,
      background: '#05070b',
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      powerPreference: 'high-performance',
    });

    this.app.canvas.className = 'stage';
    this.root.appendChild(this.app.canvas);
    this.ballRays = new Sprite(rayTexture(rayShapeExponent(this.ballFx.raysCurve)));
    this.ballRays.anchor.set(0.5);
    this.ballRays.blendMode = 'add';
    this.ballRays.visible = false;
    this.afterglow = new AfterglowBuffer(this.app.renderer);
    this.ballDisc.anchor.set(0.5);
    this.ballStamps.addChild(this.ballDisc);
    this.afterglow.stamps.addChild(this.ballStamps);
    this.afterglow.erasers.addChild(this.ballFootprint);
    if (this.particleRenderer === 'sprite') {
      this.spriteParticles = new SpriteParticleLayer(this.particleRimWidthPercent);
      this.afterglow.prestamps.addChild(this.spriteParticles.prestamps);
      this.afterglow.stamps.addChild(this.spriteParticles.stamps);
      this.afterglow.erasers.addChild(this.spriteParticles.erasers);
      this.app.stage.addChild(
        this.table,
        this.afterglow.view,
        this.spriteParticles.view,
        this.ballTrail,
        this.control,
        this.ballRays,
      );
      this.setParticleFx(this.particleFx);
    } else {
      this.app.stage.addChild(
        this.table,
        this.afterglow.view,
        this.particles,
        this.ballTrail,
        this.control,
        this.ballRays,
      );
    }
  }

  render(snapshot: WorldSnapshot) {
    const afterglow = this.beginAfterglow();
    if (this.spriteParticles) {
      if (snapshot.width !== this.tableWidth || snapshot.height !== this.tableHeight) {
        this.tableWidth = snapshot.width;
        this.tableHeight = snapshot.height;
        this.drawTable(snapshot.width, snapshot.height);
      }
      this.drawSpriteParticles(this.spriteParticles, snapshot);
    } else {
      this.drawTable(snapshot.width, snapshot.height);
      this.drawParticles(snapshot);
    }
    this.drawControl(snapshot);
    afterglow?.finish();
  }

  // PoC afterglow buffer state for the debug overlay.
  get afterglowState() {
    return this.afterglow?.view.visible ? this.afterglow.format : 'off';
  }

  // Before the bodies are updated: sizes the buffer and draws the stamps
  // that can only show last frame's pose. The rest is drawn in finish().
  private beginAfterglow() {
    const afterglow = this.afterglow;
    if (!afterglow) {
      return null;
    }
    const particles = this.particleFx.afterglow && this.spriteParticles !== null;
    if (!particles && !this.ballFx.afterglow) {
      if (afterglow.view.visible) {
        afterglow.stop();
      }
      return null;
    }
    const viewScale = this.app.stage.scale.x;
    this.spriteParticles?.setAfterglow(particles, AFTERGLOW_ERASE_GROW_PX / viewScale);
    afterglow.begin(viewScale);
    return afterglow;
  }

  resize() {
    this.app.renderer.resize(window.innerWidth, window.innerHeight);
  }

  dispose() {
    this.afterglow?.destroy();
    this.spriteParticles?.destroy();
    this.ballRays?.texture.destroy(true);
    this.app.destroy(true);
  }

  // View Scale: snapshots are in world units; the stage maps them to screen px.
  setViewScale(scale: number) {
    this.app.stage.scale.set(scale);
  }

  setParticlePalette(palette: ParticlePalette) {
    if (this.particlePalette === palette) {
      return;
    }

    this.particlePalette = palette;
    this.particleBaseColors = [];
  }

  setParticleRimWidth(width: number) {
    this.particleRimWidthPercent = Math.max(5, Math.min(width, 100));
    this.spriteParticles?.setRimWidth(this.particleRimWidthPercent);
  }

  setParticleBrightnessResponse(response: number) {
    this.particleBrightnessResponse = Math.max(0, Math.min(response, 100));
  }

  setParticleGlowMode(mode: ParticleGlowMode) {
    this.particleGlowMode = mode;
    this.particleGlowTargets = [];
  }

  setParticleGlowVividness(vividness: number) {
    this.particleGlowVividness = Math.max(0, Math.min(vividness, 2));
    this.particleGlowTargets = [];
  }

  setParticleLeaderVisible(visible: boolean) {
    this.particleLeaderVisible = visible;
  }

  setBallPalette(palette: BallPalette) {
    this.ballPalette = palette;
  }

  setBallRimEnabled(enabled: boolean) {
    this.ballRimEnabled = enabled;
  }

  // PoC shapes and motion effects; the `graphics` particle path ignores them.
  setParticleFx(fx: MotionFx) {
    this.particleFx = fx;
    if (!fx.afterglow) {
      this.spriteParticles?.setAfterglow(false);
    }
    this.spriteParticles?.setEffects(fx.rays, fx.trail, fx.raysTurn, fx.raysCurve);
    this.spriteParticles?.setShape(fx.shape, fx.shapeTurn);
  }

  setBallFx(fx: MotionFx) {
    // The held heading and speed also turn the shape, set the fish beat and
    // the afterglow's life, so the hold runs while any of them needs it.
    if (!fx.rays && fx.shape !== 'fish' && !(fx.shapeTurn && shapeTurns(fx.shape)) && !fx.afterglow) {
      this.ballSpeedHold.reset();
    }
    if (!fx.trail) {
      this.ballTrailHistory.clear();
      this.ballTrail.clear();
    }
    if (!fx.afterglow) {
      this.setBallAfterglow(null, 0, 0);
    }
    if (this.ballRays && fx.raysCurve !== this.ballFx.raysCurve) {
      redrawRayTexture(this.ballRays.texture, rayShapeExponent(fx.raysCurve));
    }
    this.ballFx = fx;
  }

  private drawTable(width: number, height: number) {
    this.table.clear();
    this.table.rect(0, 0, width, height).fill(0x05070b);
    this.table.rect(1, 1, width - 2, height - 2).stroke({
      color: 0x233044,
      width: 2,
      alpha: 0.75,
    });
  }

  private drawParticles(snapshot: WorldSnapshot) {
    this.particles.clear();
    this.ensureParticleColors(snapshot.particles.length);

    for (let index = 0; index < snapshot.particles.length; index += 1) {
      const dot = snapshot.particles[index];
      const baseColor = this.particleBaseColors[index];
      let color = baseColor;

      if (this.particleBrightnessResponse > 0) {
        color = speedColor(
          dot.speed,
          baseColor,
          this.particleBrightnessResponse,
          this.particleGlowMode,
          this.particleGlowVividness,
          index,
        );
      }

      if (this.particleLeaderVisible && index === 0) {
        this.particles.circle(dot.x, dot.y, dot.radius * LEADER_HALO_SCALE).fill({
          color: LEADER_COLOR,
          alpha: LEADER_HALO_ALPHA,
        });
        color = LEADER_COLOR;
      }

      this.drawParticle(dot.x, dot.y, dot.radius, color, index === 0);
    }
  }

  private drawParticle(
    x: number,
    y: number,
    radius: number,
    color: number,
    isLeader: boolean,
  ) {
    const rimAlpha = this.particleLeaderVisible && isLeader ? LEADER_RIM_ALPHA : PARTICLE_RIM_ALPHA;
    const rimWidth = radius * (this.particleRimWidthPercent / 100);

    if (this.particleRimWidthPercent >= 100) {
      this.particles.circle(x, y, radius).fill({ color, alpha: rimAlpha });
      return;
    }

    const rimRadius = Math.max(radius - rimWidth / 2, 0.001);
    this.particles.circle(x, y, rimRadius).stroke({
      color,
      width: rimWidth,
      alpha: rimAlpha,
    });
  }

  // Same colors and alphas as drawParticles, written into sprites.
  private drawSpriteParticles(layer: SpriteParticleLayer, snapshot: WorldSnapshot) {
    const particles = snapshot.particles;
    const count = particles.length;
    this.ensureParticleColors(count);
    const brightness = this.particleBrightnessResponse;
    const glowTargets = brightness > 0 ? this.ensureParticleGlowTargets(count) : null;
    const leaderVisible = this.particleLeaderVisible && count > 0;
    layer.setCount(count);

    for (let index = 0; index < count; index += 1) {
      const dot = particles[index];
      const baseColor = this.particleBaseColors[index];
      let color = glowTargets
        ? speedColorToward(dot.speed, baseColor, brightness, glowTargets[index])
        : baseColor;
      let alpha = PARTICLE_RIM_ALPHA;
      if (leaderVisible && index === 0) {
        color = LEADER_COLOR;
        alpha = LEADER_RIM_ALPHA;
      }
      layer.setParticle(index, dot.x, dot.y, dot.radius, color, alpha, dot.vx, dot.vy, dot.speed);
    }
    layer.finishFrame();

    if (leaderVisible) {
      const leader = particles[0];
      layer.setHalo(
        true,
        leader.x,
        leader.y,
        leader.radius * LEADER_HALO_SCALE,
        LEADER_COLOR,
        LEADER_HALO_ALPHA,
      );
    } else {
      layer.setHalo(false);
    }
  }

  private drawControl(snapshot: WorldSnapshot) {
    const ball = snapshot.controlBall;
    this.control.clear();
    if (this.ballRays) {
      this.ballRays.visible = false;
    }
    if (!ball.visible) {
      this.ballTrailHistory.clear();
      this.ballTrail.clear();
      this.setBallAfterglow(null, 0, 0);
      return;
    }

    const style = ballStyle(this.ballPalette);
    if (this.ballFx.trail) {
      this.drawBallTrail(ball, style.fill);
    }

    // `none` draws no body; the effects alone show where the ball is.
    const shape = this.ballFx.shape;
    const turning = this.ballFx.shapeTurn && shapeTurns(shape);
    // One held heading per frame, shared by the shape and the rays.
    const now = performance.now();
    // The afterglow uses the held speed: a frame without a pointer event
    // would otherwise stamp the long life of a still ball.
    const strokes = this.ballFx.afterglow && shape === 'none';
    const motion = this.ballFx.rays || turning || shape === 'fish' || this.ballFx.afterglow
      ? this.ballSpeedHold.update(ball.speed, ball.vx, ball.vy, now)
      : null;
    const rotation = shapeRotation(shape, turning, motion?.heading ?? 0);
    // The afterglow follows the body outline, not the darker glow around it.
    // Without a body, it is a stroke whose width follows speed.
    const strokeRadius = ball.radius * (strokes ? speedFactor(motion?.speed ?? 0, BALL_CURVE) : 1);
    const footprint: BallFootprint = {
      x: ball.x,
      y: ball.y,
      ballRadius: ball.radius,
      radius: strokeRadius,
      discRadius: strokeRadius,
      bandRadius: strokeRadius,
      polygons: null,
      outline: shape !== 'none',
    };
    if (shape === 'star') {
      const outer = ball.radius * 1.3;
      const inner = outer * BALL_STAR_INNER_RATIO;
      footprint.polygons = [starPoints(ball.x, ball.y, outer, inner, rotation)];
      footprint.discRadius = inner;
      footprint.bandRadius = outer * STAR_SPAN;
      this.control
        .star(ball.x, ball.y, 5, outer * 1.04, inner * 1.04, rotation)
        .fill({ color: style.glow, alpha: style.glowAlpha });
      this.control
        .star(ball.x, ball.y, 5, outer, inner, rotation)
        .fill({ color: style.fill, alpha: style.fillAlpha });
      if (this.ballRimEnabled) {
        this.control.star(ball.x, ball.y, 5, outer, inner, rotation).stroke({
          color: style.stroke,
          width: 2,
          alpha: style.strokeAlpha,
        });
      }
    } else if (shape === 'fish') {
      const seconds = this.ballFishAt < 0 ? 0 : Math.min(Math.max(now - this.ballFishAt, 0) / 1000, 0.1);
      this.ballFishAt = now;
      const pose = this.ballFish.update(
        speedFactor(motion?.speed ?? 0, BALL_CURVE),
        turning ? (motion?.heading ?? 0) : null,
        seconds,
      );
      const parts = fishParts(pose);
      footprint.polygons = parts.map((part) => fishPoints(part, ball.x, ball.y, ball.radius, rotation));
      for (const part of parts) {
        this.control
          .poly(fishPoints(part, ball.x, ball.y, ball.radius * 1.04, rotation))
          .fill({ color: style.glow, alpha: style.glowAlpha });
      }
      for (const part of parts) {
        const outline = fishPoints(part, ball.x, ball.y, ball.radius, rotation);
        this.control.poly(outline).fill({ color: style.fill, alpha: style.fillAlpha });
        if (this.ballRimEnabled) {
          this.control.poly(outline).stroke({
            color: style.stroke,
            width: 2,
            alpha: style.strokeAlpha,
          });
        }
      }
    } else if (shape === 'circle') {
      this.control
        .circle(ball.x, ball.y, ball.radius * 1.04)
        .fill({ color: style.glow, alpha: style.glowAlpha });
      this.control
        .circle(ball.x, ball.y, ball.radius)
        .fill({ color: style.fill, alpha: style.fillAlpha });
      this.control.circle(ball.x - ball.radius * 0.18, ball.y - ball.radius * 0.2, ball.radius * 0.56).fill({
        color: style.highlight,
        alpha: style.highlightAlpha,
      });
      this.control.circle(ball.x + ball.radius * 0.18, ball.y + ball.radius * 0.18, ball.radius * 0.72).fill({
        color: style.shade,
        alpha: style.shadeAlpha,
      });
      if (this.ballRimEnabled) {
        this.control.circle(ball.x, ball.y, ball.radius).stroke({
          color: style.stroke,
          width: 2,
          alpha: style.strokeAlpha,
        });
      }
    }
    if (shape !== 'none') {
      this.control.circle(ball.x, ball.y, Math.max(ball.radius * 0.16, 4)).fill({
        color: style.center,
        alpha: style.centerAlpha,
      });
    }

    if (this.ballFx.afterglow) {
      const seconds = this.ballGlowAt < 0 ? 0 : Math.max(now - this.ballGlowAt, 0) / 1000;
      this.ballGlowAt = now;
      this.ballGlowSpeed += ((motion?.speed ?? 0) - this.ballGlowSpeed) * (1 - Math.exp(-seconds / BALL_GLOW_SPEED_SECONDS));
      this.setBallAfterglow(footprint, style.fill, this.ballGlowSpeed, seconds);
    }

    if (motion && this.ballFx.rays && this.ballRays) {
      const factor = speedFactor(motion.speed, BALL_CURVE);
      this.ballRays.visible = true;
      this.ballRays.position.set(ball.x, ball.y);
      this.ballRays.rotation = this.ballFx.raysTurn ? motion.heading : 0;
      this.ballRays.scale.set(rayScale(factor, ball.radius) / RAY_TEXTURE_RADIUS);
      // Additive: the light highlight color reads on every palette.
      this.ballRays.tint = style.highlight;
      this.ballRays.alpha = rayAlpha(factor);
    }
  }

  // Stamps a disc at last frame's position and a band from there to here,
  // and cuts out the outline here; null clears both. Opacity carries the
  // glow's life, from the speed. Without an outline (`none`) there is no
  // body to cut out: the disc is the stroke's round head here, and both are
  // as wide as the speed makes them, so a still ball leaves nothing.
  private setBallAfterglow(
    footprint: BallFootprint | null,
    color: number,
    speed: number,
    frameSeconds = 0,
  ) {
    const last = this.lastBallFootprint;
    this.lastBallFootprint = footprint;
    this.ballDisc.visible = false;
    for (const band of this.ballBands) {
      band.visible = false;
    }
    this.ballFootprint.clear();
    if (!footprint) {
      return;
    }
    const seconds = afterglowLife(speed, footprint.ballRadius);
    // Stamps a glow `age` seconds old already (see afterglowTint).
    const stamp = (sprite: Sprite, x: number, y: number, rotation: number, scale: number, age: number) =>
      placeStamp(
        sprite,
        x,
        y,
        rotation,
        scale,
        afterglowTint(color, seconds, age),
        Math.max(seconds - age, 0) / AFTERGLOW_MAX_SECONDS,
      );
    const dx = last ? footprint.x - last.x : 0;
    const dy = last ? footprint.y - last.y : 0;
    const step = Math.hypot(dx, dy);
    // A jump leaves nothing where the ball was.
    if (last && step <= footprint.ballRadius * BALL_AFTERGLOW_MAX_STEP_RADII) {
      const head = footprint.outline ? last : footprint;
      const headAge = footprint.outline ? frameSeconds : 0;
      stamp(this.ballDisc, head.x, head.y, 0, head.discRadius / AFTERGLOW_STAMP_RADIUS, headAge);
      const pieces = Math.min(
        Math.ceil(step / (BALL_AFTERGLOW_PIECE_RADII * footprint.bandRadius)),
        BALL_AFTERGLOW_MAX_PIECES,
      );
      const rotation = Math.atan2(dy, dx);
      for (let index = 0; index < pieces; index += 1) {
        const band = this.ballBand(index);
        const from = index / pieces;
        stamp(
          band,
          last.x + dx * from,
          last.y + dy * from,
          rotation,
          footprint.bandRadius / AFTERGLOW_STAMP_RADIUS,
          frameSeconds * (1 - (index + 1) / pieces),
        );
        band.scale.x = step / pieces / AFTERGLOW_BAND_WIDTH;
      }
    }
    if (!footprint.outline) {
      return;
    }
    const grow = AFTERGLOW_ERASE_GROW_PX / this.app.stage.scale.x;
    drawFootprint(this.ballFootprint, footprint, grow).fill({ color: 0xffffff, alpha: 1 });
  }

  private ballBand(index: number) {
    while (this.ballBands.length <= index) {
      const band = new Sprite(afterglowStampTextures().band);
      band.anchor.set(0, 0.5);
      band.visible = false;
      this.ballBands.push(band);
      this.ballStamps.addChildAt(band, 0);
    }
    return this.ballBands[index];
  }

  // Comet tail from the ball's recent path: round-capped segments that thin
  // and fade along the path, so the tail bends with the motion. The drawn
  // length is capped by path distance, and segments also fade with age, so
  // a ball that stops keeps a tail that dissolves gently instead of
  // vanishing. The path is resampled at a fixed spacing: translucent round
  // caps overlap, and with raw 16 ms samples a slow ball stacked dozens of
  // them into an opaque slab.
  private drawBallTrail(ball: { x: number; y: number; radius: number }, color: number) {
    const history = this.ballTrailHistory;
    const now = performance.now();
    history.push(ball.x, ball.y, now);
    this.ballTrail.clear();
    const count = history.length;
    const maxLength = ball.radius * BALL_TRAIL_MAX_RADII;
    const maxAgeMs = BALL_TRAIL_SECONDS * 1000;
    const spacing = ball.radius * BALL_TRAIL_SPACING_RADII;
    let travelled = 0;
    let pending = 0;
    let from = history.at(0);

    for (let index = 1; index < count && travelled < maxLength; index += 1) {
      const to = history.at(index);
      const step = Math.hypot(to.x - history.at(index - 1).x, to.y - history.at(index - 1).y);
      travelled += step;
      pending += step;
      if (pending < spacing && index < count - 1) {
        continue;
      }
      if (pending === 0) {
        continue;
      }
      pending = 0;
      const segmentFrom = from;
      from = to;
      // Segments inside the ball would show through the star shape and the
      // translucent fill as a disc; the visible tail starts at the edge.
      // Without a body, the tail runs into the centre.
      if (this.ballFx.shape !== 'none' && Math.hypot(to.x - ball.x, to.y - ball.y) < ball.radius) {
        continue;
      }
      const along = Math.min(travelled / maxLength, 1);
      const fresh = Math.max(1 - (now - to.time) / maxAgeMs, 0);
      const width = ball.radius * 2 * Math.max(1 - along, BALL_TRAIL_MIN_WIDTH);
      this.ballTrail.moveTo(segmentFrom.x, segmentFrom.y).lineTo(to.x, to.y).stroke({
        color,
        width,
        alpha: BALL_TRAIL_ALPHA * (1 - along) * Math.sqrt(fresh),
        cap: 'round',
      });
    }
  }

  private ensureParticleColors(count: number) {
    if (this.particleBaseColors.length === count) {
      return;
    }

    this.particleBaseColors = Array.from({ length: count }, (_, index) =>
      paletteColor(this.particlePalette, index),
    );
  }

  private ensureParticleGlowTargets(count: number) {
    if (this.particleGlowTargets.length !== count) {
      this.particleGlowTargets = Array.from({ length: count }, (_, index) =>
        vividGlowColor(this.particleGlowMode, index, this.particleGlowVividness),
      );
    }
    return this.particleGlowTargets;
  }
}

function ballStyle(palette: BallPalette): BallStyle {
  switch (palette) {
    case 'black':
      return {
        glow: 0x11182a,
        glowAlpha: 0.48,
        fill: 0x02040a,
        fillAlpha: 0.78,
        highlight: 0x586586,
        highlightAlpha: 0.13,
        shade: 0x000000,
        shadeAlpha: 0.34,
        stroke: 0x8ea0c8,
        strokeAlpha: 0.72,
        center: 0x05070d,
        centerAlpha: 0.92,
      };
    case 'green':
      return {
        glow: 0x173d25,
        glowAlpha: 0.3,
        fill: 0x55c77a,
        fillAlpha: 0.4,
        highlight: 0xc5ffd6,
        highlightAlpha: 0.21,
        shade: 0x1e7a42,
        shadeAlpha: 0.16,
        stroke: 0x79e89a,
        strokeAlpha: 0.88,
        center: 0x3a9b58,
        centerAlpha: 0.72,
      };
    case 'yellow':
      return {
        glow: 0x5b4310,
        glowAlpha: 0.28,
        fill: 0xffc44d,
        fillAlpha: 0.42,
        highlight: 0xfff4b8,
        highlightAlpha: 0.23,
        shade: 0xb97618,
        shadeAlpha: 0.15,
        stroke: 0xffd36a,
        strokeAlpha: 0.9,
        center: 0xd49524,
        centerAlpha: 0.7,
      };
    case 'red':
      return {
        glow: 0x4d1114,
        glowAlpha: 0.3,
        fill: 0xd94a4a,
        fillAlpha: 0.42,
        highlight: 0xffb0a6,
        highlightAlpha: 0.2,
        shade: 0x7d1d25,
        shadeAlpha: 0.16,
        stroke: 0xff7a76,
        strokeAlpha: 0.88,
        center: 0x9b2b31,
        centerAlpha: 0.72,
      };
    case 'pink':
      return {
        glow: 0x552144,
        glowAlpha: 0.3,
        fill: 0xe774b7,
        fillAlpha: 0.4,
        highlight: 0xffd0ef,
        highlightAlpha: 0.22,
        shade: 0xa83372,
        shadeAlpha: 0.15,
        stroke: 0xff93cf,
        strokeAlpha: 0.88,
        center: 0xbd4b8f,
        centerAlpha: 0.72,
      };
    case 'orange':
      return {
        glow: 0x60300d,
        glowAlpha: 0.3,
        fill: 0xff8a33,
        fillAlpha: 0.41,
        highlight: 0xffd2a3,
        highlightAlpha: 0.22,
        shade: 0xaf4d16,
        shadeAlpha: 0.16,
        stroke: 0xffaa57,
        strokeAlpha: 0.9,
        center: 0xc76424,
        centerAlpha: 0.72,
      };
    case 'white':
      return {
        glow: 0x647184,
        glowAlpha: 0.26,
        fill: 0xf1f8ff,
        fillAlpha: 0.48,
        highlight: 0xffffff,
        highlightAlpha: 0.28,
        shade: 0x98adc0,
        shadeAlpha: 0.16,
        stroke: 0xc7d8e8,
        strokeAlpha: 0.95,
        center: 0xaebfce,
        centerAlpha: 0.72,
      };
    case 'blue':
    default:
      return {
        glow: 0x162f3e,
        glowAlpha: 0.24,
        fill: 0x6bb8d8,
        fillAlpha: 0.34,
        highlight: 0xbcecff,
        highlightAlpha: 0.18,
        shade: 0x2f6f8e,
        shadeAlpha: 0.12,
        stroke: 0x3f7890,
        strokeAlpha: 0.95,
        center: 0x477f96,
        centerAlpha: 0.78,
      };
  }
}

function placeStamp(
  sprite: Sprite,
  x: number,
  y: number,
  rotation: number,
  scale: number,
  color: number,
  alpha: number,
) {
  sprite.visible = true;
  sprite.position.set(x, y);
  sprite.rotation = rotation;
  sprite.scale.set(scale);
  sprite.tint = color;
  sprite.alpha = alpha;
}

// A footprint's outline as a path; `grow` changes a circle's radius
// (polygons are drawn as they are).
function drawFootprint(graphics: Graphics, footprint: BallFootprint, grow: number) {
  if (!footprint.polygons) {
    return graphics.circle(footprint.x, footprint.y, footprint.radius + grow);
  }
  for (const polygon of footprint.polygons) {
    graphics.poly(polygon);
  }
  return graphics;
}

// Same points as Graphics.star: the first point at `rotation` - 90 degrees.
function starPoints(x: number, y: number, outer: number, inner: number, rotation: number) {
  const points: number[] = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = rotation - Math.PI / 2 + (index * Math.PI) / 5;
    points.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  return points;
}

// One fish part in world coordinates, head centre at (x, y), nose turned to
// `rotation`.
function fishPoints(part: Polygon, x: number, y: number, radius: number, rotation: number) {
  const cos = Math.cos(rotation) * radius;
  const sin = Math.sin(rotation) * radius;
  const points: number[] = [];
  for (const [px, py] of part) {
    points.push(x + px * cos - py * sin, y + px * sin + py * cos);
  }
  return points;
}
