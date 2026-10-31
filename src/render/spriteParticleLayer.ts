import { CanvasSource, Container, Particle, ParticleContainer, Sprite, Texture } from 'pixi.js';
import {
  RAY_TEXTURE_RADIUS,
  TRAIL_HEAD_RADIUS,
  TRAIL_HEAD_X,
  TRAIL_TEXTURE_WIDTH,
  rayTexture,
  starPath,
  trailTexture,
} from './fxTextures';
import {
  followDirection,
  rayAlpha,
  rayScale,
  speedFactor,
  trailAlpha,
  trailLength,
} from './motionFx';
import { particleColor } from './particleColors';

export type ParticleShape = 'circle' | 'star';

// Large enough that Size 100 at Pixi resolution 2 stays sharp; mipmaps keep
// small dots from shimmering.
const TEXTURE_SIZE = 512;
// Leaves a texel border so the antialiased edge is not clipped.
const TEXTURE_RADIUS = TEXTURE_SIZE / 2 - 2;
// A star whose points touch the physics radius looks smaller than the dot,
// so its points reach a little past it.
const STAR_SCALE = 1.3;
const STAR_INNER_RATIO = 0.48;
const EFFECT_PROPERTIES = { position: true, vertex: true, color: true, rotation: true, uvs: false };

// Particle bodies as sprites in one ParticleContainer. Per particle, each
// frame updates only position, scale and color (tint + alpha). The optional
// PoC effects add a trail container under the bodies and an additive ray
// container above them; each is hidden, and not updated, while off.
export class SpriteParticleLayer {
  readonly view = new Container();
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
  private rimWidthPercent: number;
  private shape: ParticleShape = 'circle';
  private raysTurn = false;

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

  setEffects(rays: boolean, trail: boolean, raysTurn: boolean) {
    this.raysTurn = raysTurn;
    this.rays.visible = rays;
    this.trails.visible = trail;
    if (!rays) {
      this.rays.removeParticles();
    }
    if (!trail) {
      this.trails.removeParticles();
    }
  }

  setShape(shape: ParticleShape) {
    if (this.shape === shape) {
      return;
    }

    this.shape = shape;
    this.redrawBody();
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
    drawShape(this.bodyTexture.source.resource as HTMLCanvasElement, this.rimWidthPercent, this.shape);
    this.bodyTexture.source.update();
  }

  setCount(count: number) {
    if (this.dirX.length > count) {
      this.dirX.length = count;
      this.dirY.length = count;
    }
    for (const container of [this.trails, this.rays]) {
      if (container.particleChildren.length > count) {
        container.removeParticles(count);
      }
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
    const particle = this.body.particleChildren[index];
    const scale = (radius / TEXTURE_RADIUS) * (this.shape === 'star' ? STAR_SCALE : 1);
    particle.x = x;
    particle.y = y;
    particle.scaleX = scale;
    particle.scaleY = scale;
    particle.color = particleColor(color, alpha);

    if (!this.trails.visible && !this.rays.visible) {
      return;
    }

    const factor = speedFactor(speed);
    const heading = this.smoothedHeading(index, vx, vy, speed, factor);
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
    this.halo.visible = visible;
    if (!visible) {
      return;
    }

    this.halo.position.set(x, y);
    this.halo.scale.set(radius / TEXTURE_RADIUS);
    this.halo.tint = color;
    this.halo.alpha = alpha;
  }

  destroy() {
    this.view.destroy({ children: true });
    this.bodyTexture.destroy(true);
    this.fillTexture.destroy(true);
    this.trailTexture.destroy(true);
    this.rayTexture.destroy(true);
  }
}

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
