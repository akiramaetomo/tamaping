import { CanvasSource, Container, Particle, ParticleContainer, Sprite, Texture } from 'pixi.js';
import {
  RAY_TEXTURE_RADIUS,
  TRAIL_HEAD_RADIUS,
  TRAIL_HEAD_X,
  TRAIL_TEXTURE_WIDTH,
  rayTexture,
  redrawRayTexture,
  starPath,
  trailTexture,
} from './fxTextures';
import { AFTERGLOW_BAND_WIDTH, AFTERGLOW_STAMP_RADIUS, afterglowStampTextures } from './afterglow';
import { FishMesh } from './fishMesh';
import {
  AFTERGLOW_MAX_SECONDS,
  afterglowLife,
  afterglowTint,
  followDirection,
  rayAlpha,
  rayScale,
  rayShapeExponent,
  shapeRotation,
  shapeTurns,
  speedFactor,
  trailAlpha,
  trailLength,
} from './motionFx';
import { particleColor } from './particleColors';
import type { BodyShape } from '../sim/settings';

// `none` hides the body batch (and the leader halo); the effects still draw.
export type ParticleShape = BodyShape;

// Large enough that Size 100 at Pixi resolution 2 stays sharp; mipmaps keep
// small dots from shimmering.
const TEXTURE_SIZE = 512;
// Leaves a texel border so the antialiased edge is not clipped.
const TEXTURE_RADIUS = TEXTURE_SIZE / 2 - 2;
const STAR_SCALE = 1.3;
const STAR_INNER_RATIO = 0.48;
const EFFECT_PROPERTIES = { position: true, vertex: true, color: true, rotation: true, uvs: false };
// A dot that moved further than this many radii in one frame was placed
// (Reset, formations, resize), not moving, and leaves no glow.
const AFTERGLOW_MAX_STEP_RADII = 12;
// Half-width of a five-point star across any direction, against its outer
// radius (about sin 72 degrees); the band along a star's step is this wide,
// so the points do not stick out of the trail as teeth.
const STAR_SPAN = Math.sin((2 * Math.PI) / 5);

// Particle bodies as sprites in one ParticleContainer. Per particle, each
// frame updates only position, scale and color (tint + alpha). Rotation is a
// static property, uploaded each frame only while the shape turns. `Fish`
// replaces the body batch with one bending mesh (fishMesh.ts). The optional
// PoC effects add a trail container under the bodies and an additive ray
// container above them; each is hidden, and not updated, while off. The
// afterglow's stamps and footprints live in `stamps`, `prestamps` and
// `erasers`, which the afterglow buffer draws (afterglow.ts).
export class SpriteParticleLayer {
  readonly view = new Container();
  readonly stamps = new Container();
  readonly prestamps = new Container();
  readonly erasers = new Container();
  private readonly fillTexture = circleTexture(100);
  private readonly halo = new Sprite(this.fillTexture);
  private readonly body: ParticleContainer<Particle>;
  private readonly bodyTexture: Texture<CanvasSource>;
  private readonly trailTexture = trailTexture();
  private readonly rayTexture = rayTexture();
  private readonly trails = new ParticleContainer<Particle>({
    texture: this.trailTexture,
    dynamicProperties: EFFECT_PROPERTIES,
  });
  private readonly rays = new ParticleContainer<Particle>({
    texture: this.rayTexture,
    dynamicProperties: EFFECT_PROPERTIES,
  });
  private readonly dirX: number[] = [];
  private readonly dirY: number[] = [];
  // Afterglow, created on first use. Each dot stamps a band from its last
  // position to here; its opacity is the glow's life (afterglow.ts).
  // Circles cut out full discs, since a moving ring sweeps its inside too;
  // stars cut out the star. `none` has no body to cut out, so it draws a
  // stroke instead: a band and a round head whose width follows speed, so a
  // still dot leaves nothing.
  private afterglowLayers: AfterglowLayers | null = null;
  private readonly lastX: number[] = [];
  private readonly lastY: number[] = [];
  private afterglow = false;
  // World units added to each cut-out's radius (negative: just inside the
  // body's edge, so no dark seam shows between body and glow).
  private eraseGrow = 0;
  // Created on first use of the `Fish` shape.
  private fishMesh: FishMesh | null = null;
  private rimWidthPercent: number;
  private shape: ParticleShape = 'circle';
  private shapeTurn = false;
  private raysTurn = false;
  private raysCurve = 1;

  constructor(rimWidthPercent: number) {
    this.rimWidthPercent = rimWidthPercent;
    this.bodyTexture = circleTexture(rimWidthPercent);
    this.body = new ParticleContainer<Particle>({
      texture: this.bodyTexture,
      dynamicProperties: { position: true, vertex: true, color: true, rotation: false, uvs: false },
    });
    this.halo.anchor.set(0.5);
    this.halo.visible = false;
    this.trails.visible = false;
    this.rays.visible = false;
    this.rays.blendMode = 'add';
    this.view.addChild(this.halo, this.trails, this.body, this.rays);
  }

  // `grow` is in world units; see eraseGrow.
  setAfterglow(on: boolean, grow = 0) {
    this.eraseGrow = grow;
    if (this.afterglow === on) {
      return;
    }
    this.afterglow = on;
    if (on && !this.afterglowLayers) {
      this.afterglowLayers = this.createAfterglowLayers();
    }
    this.resetAfterglow();
  }

  private createAfterglowLayers(): AfterglowLayers {
    const container = (texture: Texture) =>
      new ParticleContainer<Particle>({ texture, dynamicProperties: EFFECT_PROPERTIES });
    const textures = afterglowStampTextures();
    const layers = {
      heads: container(textures.disc),
      bands: container(textures.band),
      discFootprints: container(this.fillTexture),
      starFootprints: container(this.bodyTexture),
    };
    this.stamps.addChild(layers.bands, layers.heads);
    this.erasers.addChild(layers.discFootprints, layers.starFootprints);
    return layers;
  }

  // Empties the stamps and shows the ones for the current shape. The fish
  // stamps its own mesh, so it needs no band.
  private resetAfterglow() {
    this.lastX.length = 0;
    this.lastY.length = 0;
    const layers = this.afterglowLayers;
    if (layers) {
      const on = this.afterglow;
      for (const container of Object.values(layers)) {
        container.removeParticles();
      }
      layers.bands.visible = on && this.shape !== 'fish';
      layers.heads.visible = on && this.shape === 'none';
      layers.discFootprints.visible = on && this.shape === 'circle';
      layers.starFootprints.visible = on && this.shape === 'star';
    }
    if (this.fishMesh && (this.afterglow || this.fishMesh.hasAfterglow)) {
      const { stamp, footprint } = this.fishMesh.afterglowViews();
      if (!stamp.parent) {
        this.prestamps.addChild(stamp);
        this.erasers.addChild(footprint);
      }
      stamp.visible = this.afterglow && this.shape === 'fish';
      footprint.visible = stamp.visible;
    }
  }

  setEffects(rays: boolean, trail: boolean, raysTurn: boolean, raysCurve: number) {
    this.raysTurn = raysTurn;
    if (this.raysCurve !== raysCurve) {
      this.raysCurve = raysCurve;
      redrawRayTexture(this.rayTexture, rayShapeExponent(raysCurve));
    }
    this.rays.visible = rays;
    this.trails.visible = trail;
    if (!rays) {
      this.rays.removeParticles();
    }
    if (!trail) {
      this.trails.removeParticles();
    }
  }

  setShape(shape: ParticleShape, turn: boolean) {
    const wasTurning = this.bodyTurns;
    this.shapeTurn = turn;
    if (this.shape !== shape) {
      this.shape = shape;
      this.body.visible = shape === 'circle' || shape === 'star';
      if (shape === 'fish' && !this.fishMesh) {
        this.fishMesh = new FishMesh();
        this.view.addChildAt(this.fishMesh.view, this.view.getChildIndex(this.body) + 1);
      }
      if (this.fishMesh) {
        this.fishMesh.view.visible = shape === 'fish';
      }
      this.redrawBody();
      this.resetAfterglow();
    }
    // Bodies are drawn with rotation 0 from now on; upload that once.
    if (wasTurning && !this.bodyTurns) {
      for (const particle of this.body.particleChildren) {
        particle.rotation = 0;
      }
      this.body.update();
    }
  }

  private get bodyTurns() {
    return this.shapeTurn && shapeTurns(this.shape);
  }

  // The rim width is global, not per particle, so one body texture serves all
  // dots. It is redrawn in place: destroying a texture that the shared
  // particle shader still binds also destroys that shader's bind group.
  setRimWidth(percent: number) {
    if (this.rimWidthPercent === percent) {
      return;
    }

    this.rimWidthPercent = percent;
    this.redrawBody();
  }

  private redrawBody() {
    if (this.shape === 'none') {
      return;
    }
    if (this.shape === 'fish') {
      this.fishMesh?.draw(this.rimWidthPercent);
      return;
    }
    drawShape(this.bodyTexture.source.resource as HTMLCanvasElement, this.rimWidthPercent, this.shape);
    this.bodyTexture.source.update();
  }

  setCount(count: number) {
    if (this.dirX.length > count) {
      this.dirX.length = count;
      this.dirY.length = count;
    }
    if (this.lastX.length > count) {
      this.lastX.length = count;
      this.lastY.length = count;
    }
    const afterglow = this.afterglowLayers ? Object.values(this.afterglowLayers) : [];
    for (const container of [this.trails, this.rays, ...afterglow]) {
      if (container.particleChildren.length > count) {
        container.removeParticles(count);
      }
    }

    // Called once per frame before the particles are set, so this marks the
    // rotations set below for upload.
    if (this.bodyTurns && this.body.visible) {
      this.body.update();
    }
    if (this.shape === 'fish') {
      this.fishMesh?.setCount(count);
    }

    const particles = this.body.particleChildren;
    if (particles.length > count) {
      this.body.removeParticles(count);
      return;
    }

    while (particles.length < count) {
      this.body.addParticle(
        new Particle({ texture: this.bodyTexture, anchorX: 0.5, anchorY: 0.5 }),
      );
    }
  }

  setParticle(
    index: number,
    x: number,
    y: number,
    radius: number,
    color: number,
    alpha: number,
    vx = 0,
    vy = 0,
    speed = 0,
  ) {
    const turning = this.bodyTurns;
    const fish = this.shape === 'fish' ? this.fishMesh : null;
    if (!this.trails.visible && !this.rays.visible && !turning && !fish) {
      this.setBody(index, x, y, radius, color, alpha, 0, speed);
      return;
    }

    const factor = speedFactor(speed);
    const heading = this.trails.visible || this.rays.visible || turning
      ? this.smoothedHeading(index, vx, vy, speed, factor)
      : 0;
    if (fish) {
      const life = this.afterglow ? afterglowLife(speed, radius) / AFTERGLOW_MAX_SECONDS : 0;
      fish.setFish(index, x, y, radius, particleColor(color, alpha), factor, turning ? heading : null, life);
    } else {
      this.setBody(index, x, y, radius, color, alpha, shapeRotation(this.shape, turning, heading), speed);
    }
    if (this.trails.visible) {
      const trail = effectParticle(
        this.trails,
        index,
        this.trailTexture,
        TRAIL_HEAD_X / TRAIL_TEXTURE_WIDTH,
      );
      trail.x = x;
      trail.y = y;
      trail.rotation = heading;
      trail.scaleX = trailLength(factor, radius) / TRAIL_HEAD_X;
      trail.scaleY = radius / TRAIL_HEAD_RADIUS;
      trail.color = particleColor(color, trailAlpha(factor) * alpha);
    }
    if (this.rays.visible) {
      const ray = effectParticle(this.rays, index, this.rayTexture, 0.5);
      const scale = rayScale(factor, radius) / RAY_TEXTURE_RADIUS;
      ray.x = x;
      ray.y = y;
      ray.rotation = this.raysTurn ? heading : 0;
      ray.scaleX = scale;
      ray.scaleY = scale;
      ray.color = particleColor(color, rayAlpha(factor));
    }
  }

  private setBody(
    index: number,
    x: number,
    y: number,
    radius: number,
    color: number,
    alpha: number,
    rotation: number,
    speed: number,
  ) {
    const packed = particleColor(color, alpha);
    if (this.afterglow) {
      this.setAfterglowDot(index, x, y, radius, rotation, color, speed);
    }
    if (!this.body.visible) {
      return;
    }
    const particle = this.body.particleChildren[index];
    const scale = radius / bodyRadiusTexels(this.shape);
    particle.x = x;
    particle.y = y;
    particle.rotation = rotation;
    particle.scaleX = scale;
    particle.scaleY = scale;
    particle.color = packed;
  }

  // Stamps a band from the last position to here, and cuts out the
  // footprint here. A new dot starts where it is, so it stamps nothing.
  private setAfterglowDot(
    index: number,
    x: number,
    y: number,
    radius: number,
    rotation: number,
    color: number,
    speed: number,
  ) {
    const layers = this.afterglowLayers;
    if (!layers) {
      return;
    }
    const star = this.shape === 'star';
    const footprints = star ? layers.starFootprints : layers.discFootprints;
    const texels = star ? bodyRadiusTexels('star') : TEXTURE_RADIUS;
    const fresh = index >= this.lastX.length;
    const lastX = fresh ? x : this.lastX[index];
    const lastY = fresh ? y : this.lastY[index];
    this.lastX[index] = x;
    this.lastY[index] = y;

    // A jump leaves nothing where the dot was.
    const dx = x - lastX;
    const dy = y - lastY;
    const step = Math.hypot(dx, dy);
    const moved = step <= radius * AFTERGLOW_MAX_STEP_RADII;
    // Opacity carries the glow's life. Without a body, the stroke also gets
    // a round head here. With a body, the bands alone make the trail: a dot
    // moves less than its size per frame, and a disc at each joint, one
    // frame fresher than the bands, showed as beads.
    const outline = this.shape !== 'none';
    const width = outline ? 1 : speedFactor(speed);
    const life = afterglowLife(speed, radius);
    const glow = particleColor(afterglowTint(color, life), life / AFTERGLOW_MAX_SECONDS);
    if (!outline) {
      const head = effectParticle(layers.heads, index, layers.heads.texture, 0.5);
      head.x = x;
      head.y = y;
      head.scaleX = (radius * width) / AFTERGLOW_STAMP_RADIUS;
      head.scaleY = head.scaleX;
      head.color = glow;
    }

    const band = effectParticle(layers.bands, index, layers.bands.texture, 0);
    band.x = lastX;
    band.y = lastY;
    band.rotation = Math.atan2(dy, dx);
    band.scaleX = moved ? step / AFTERGLOW_BAND_WIDTH : 0;
    band.scaleY = (star ? radius * STAR_SCALE * STAR_SPAN : radius * width) / AFTERGLOW_STAMP_RADIUS;
    band.color = glow;

    if (!outline) {
      return;
    }
    const footprint = effectParticle(footprints, index, footprints.texture, 0.5);
    footprint.x = x;
    footprint.y = y;
    footprint.rotation = rotation;
    footprint.scaleX = (radius + this.eraseGrow) / texels;
    footprint.scaleY = footprint.scaleX;
  }

  // Called once per frame after the particles are set.
  finishFrame() {
    if (this.shape === 'fish') {
      this.fishMesh?.finishFrame();
    }
  }

  // Per-dot travel direction that turns slowly near rest, so the X and the
  // tail of an almost still dot do not flicker with contact noise.
  private smoothedHeading(index: number, vx: number, vy: number, speed: number, factor: number) {
    const dirX = this.dirX;
    const dirY = this.dirY;
    if (index >= dirX.length) {
      const fresh = speed > 0;
      dirX[index] = fresh ? vx / speed : 1;
      dirY[index] = fresh ? vy / speed : 0;
    } else {
      [dirX[index], dirY[index]] = followDirection(dirX[index], dirY[index], vx, vy, speed, factor);
    }
    return Math.atan2(dirY[index], dirX[index]);
  }

  // The No.1 leader halo, drawn under every body.
  setHalo(visible: boolean, x = 0, y = 0, radius = 0, color = 0xffffff, alpha = 1) {
    // Without bodies, a lone halo would read as a ghost dot.
    this.halo.visible = visible && this.shape !== 'none';
    if (!this.halo.visible) {
      return;
    }

    this.halo.position.set(x, y);
    this.halo.scale.set(radius / TEXTURE_RADIUS);
    this.halo.tint = color;
    this.halo.alpha = alpha;
  }

  destroy() {
    // The fish mesh destroys its own afterglow views first.
    this.fishMesh?.destroy();
    for (const layer of [this.stamps, this.prestamps, this.erasers]) {
      layer.destroy({ children: true });
    }
    this.view.destroy({ children: true });
    this.bodyTexture.destroy(true);
    this.fillTexture.destroy(true);
    this.trailTexture.destroy(true);
    this.rayTexture.destroy(true);
  }
}

// Texels per physics radius. A star whose points touch the physics radius
// looks smaller than the dot, so its points reach a little past it.
function bodyRadiusTexels(shape: ParticleShape) {
  return shape === 'star' ? TEXTURE_RADIUS / STAR_SCALE : TEXTURE_RADIUS;
}

type AfterglowLayers = {
  heads: ParticleContainer<Particle>;
  bands: ParticleContainer<Particle>;
  discFootprints: ParticleContainer<Particle>;
  starFootprints: ParticleContainer<Particle>;
};

// Effect sprites are created on first use, so they cost nothing until the
// effect is turned on.
function effectParticle(
  container: ParticleContainer<Particle>,
  index: number,
  texture: Texture,
  anchorX: number,
) {
  const particles = container.particleChildren;
  while (particles.length <= index) {
    container.addParticle(new Particle({ texture, anchorX, anchorY: 0.5 }));
  }
  return particles[index];
}

// White disc, or an inside-only ring of the given width for Rim width < 100%,
// matching the old Graphics stroke that spans radius - rimWidth .. radius.
function circleTexture(rimWidthPercent: number) {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  drawShape(canvas, rimWidthPercent, 'circle');

  const source = new CanvasSource({
    resource: canvas,
    autoGenerateMipmaps: true,
    scaleMode: 'linear',
  });
  // Trilinear blending between mip levels softened small dots' edges.
  source.mipmapFilter = 'nearest';
  return new Texture({ source });
}

function drawShape(canvas: HTMLCanvasElement, rimWidthPercent: number, shape: ParticleShape) {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas is not available for particle textures');
  }

  const center = TEXTURE_SIZE / 2;
  const innerRadius = TEXTURE_RADIUS * (1 - rimWidthPercent / 100);
  context.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  context.fillStyle = '#ffffff';
  context.beginPath();
  if (shape === 'star') {
    // Rim: a smaller concentric star cut out of the larger one.
    starPath(context, center, center, TEXTURE_RADIUS, STAR_INNER_RATIO);
    if (rimWidthPercent < 100) {
      starPath(context, center, center, innerRadius, STAR_INNER_RATIO);
    }
  } else {
    context.arc(center, center, TEXTURE_RADIUS, 0, Math.PI * 2);
    if (rimWidthPercent < 100) {
      context.moveTo(center + innerRadius, center);
      context.arc(center, center, innerRadius, 0, Math.PI * 2, true);
    }
  }
  context.fill('evenodd');
}

