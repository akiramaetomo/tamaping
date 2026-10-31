import { CanvasSource, Container, Particle, ParticleContainer, Sprite, Texture } from 'pixi.js';
import { particleColor } from './particleColors';

// Large enough that Size 100 at Pixi resolution 2 stays sharp; mipmaps keep
// small dots from shimmering.
const TEXTURE_SIZE = 512;
// Leaves a texel border so the antialiased edge is not clipped.
const TEXTURE_RADIUS = TEXTURE_SIZE / 2 - 2;

// Particle bodies as sprites in one ParticleContainer. Per particle, each
// frame updates only position, scale and color (tint + alpha). Glow and trail
// layers go above the body layer when they are added.
export class SpriteParticleLayer {
  readonly view = new Container();
  private readonly fillTexture = circleTexture(100);
  private readonly halo = new Sprite(this.fillTexture);
  private readonly body: ParticleContainer<Particle>;
  private readonly bodyTexture: Texture<CanvasSource>;
  private rimWidthPercent: number;

  constructor(rimWidthPercent: number) {
    this.rimWidthPercent = rimWidthPercent;
    this.bodyTexture = circleTexture(rimWidthPercent);
    this.body = new ParticleContainer<Particle>({
      texture: this.bodyTexture,
      dynamicProperties: { position: true, vertex: true, color: true, rotation: false, uvs: false },
    });
    this.halo.anchor.set(0.5);
    this.halo.visible = false;
    this.view.addChild(this.halo, this.body);
  }

  // The rim width is global, not per particle, so one body texture serves all
  // dots. It is redrawn in place: destroying a texture that the shared
  // particle shader still binds also destroys that shader's bind group.
  setRimWidth(percent: number) {
    if (this.rimWidthPercent === percent) {
      return;
    }

    this.rimWidthPercent = percent;
    drawCircle(this.bodyTexture.source.resource as HTMLCanvasElement, percent);
    this.bodyTexture.source.update();
  }

  setCount(count: number) {
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

  setParticle(index: number, x: number, y: number, radius: number, color: number, alpha: number) {
    const particle = this.body.particleChildren[index];
    const scale = radius / TEXTURE_RADIUS;
    particle.x = x;
    particle.y = y;
    particle.scaleX = scale;
    particle.scaleY = scale;
    particle.color = particleColor(color, alpha);
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
  }
}

// White disc, or an inside-only ring of the given width for Rim width < 100%,
// matching the old Graphics stroke that spans radius - rimWidth .. radius.
function circleTexture(rimWidthPercent: number) {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  drawCircle(canvas, rimWidthPercent);

  const source = new CanvasSource({
    resource: canvas,
    autoGenerateMipmaps: true,
    scaleMode: 'linear',
  });
  // Trilinear blending between mip levels softened small dots' edges.
  source.mipmapFilter = 'nearest';
  return new Texture({ source });
}

function drawCircle(canvas: HTMLCanvasElement, rimWidthPercent: number) {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas is not available for particle textures');
  }

  const center = TEXTURE_SIZE / 2;
  context.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.arc(center, center, TEXTURE_RADIUS, 0, Math.PI * 2);
  if (rimWidthPercent < 100) {
    const innerRadius = TEXTURE_RADIUS * (1 - rimWidthPercent / 100);
    context.moveTo(center + innerRadius, center);
    context.arc(center, center, innerRadius, 0, Math.PI * 2, true);
  }
  context.fill('evenodd');
}
