import { CanvasSource, Texture } from 'pixi.js';

// Canvas-drawn white textures for the experimental motion effects; color
// comes from tint at draw time.

export const RAY_TEXTURE_SIZE = 256;
// Texels from the centre to the end of a spike.
export const RAY_TEXTURE_RADIUS = RAY_TEXTURE_SIZE / 2;

export const TRAIL_TEXTURE_WIDTH = 256;
export const TRAIL_TEXTURE_HEIGHT = 64;
// The streak's head is a half disc centred here; the tail runs left to x = 0.
export const TRAIL_HEAD_RADIUS = TRAIL_TEXTURE_HEIGHT / 2;
export const TRAIL_HEAD_X = TRAIL_TEXTURE_WIDTH - TRAIL_HEAD_RADIUS;

export function rayTexture() {
  const canvas = createCanvas(RAY_TEXTURE_SIZE, RAY_TEXTURE_SIZE);
  const context = context2d(canvas);
  const center = RAY_TEXTURE_SIZE / 2;

  const core = context.createRadialGradient(center, center, 0, center, center, center * 0.42);
  core.addColorStop(0, 'rgba(255,255,255,0.9)');
  core.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = core;
  context.fillRect(0, 0, RAY_TEXTURE_SIZE, RAY_TEXTURE_SIZE);

  // An X: two equal spikes at +-45 degrees to the texture's x axis, which
  // the sprite turns to the direction of motion.
  // Thickness is a share of the texture size; 0.02 read as needles.
  drawSpike(context, center, Math.PI / 4, 1, 0.05);
  drawSpike(context, center, -Math.PI / 4, 1, 0.05);
  return texture(canvas, true);
}

export function trailTexture() {
  const canvas = createCanvas(TRAIL_TEXTURE_WIDTH, TRAIL_TEXTURE_HEIGHT);
  const context = context2d(canvas);
  const mid = TRAIL_TEXTURE_HEIGHT / 2;

  const fade = context.createLinearGradient(0, 0, TRAIL_HEAD_X, 0);
  fade.addColorStop(0, 'rgba(255,255,255,0)');
  fade.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  fade.addColorStop(1, 'rgba(255,255,255,0.95)');
  context.fillStyle = fade;
  context.beginPath();
  context.moveTo(0, mid);
  context.quadraticCurveTo(TRAIL_HEAD_X * 0.6, mid - TRAIL_HEAD_RADIUS * 0.45, TRAIL_HEAD_X, 0);
  context.arc(TRAIL_HEAD_X, mid, TRAIL_HEAD_RADIUS, -Math.PI / 2, Math.PI / 2);
  context.quadraticCurveTo(TRAIL_HEAD_X * 0.6, mid + TRAIL_HEAD_RADIUS * 0.45, 0, mid);
  context.fill();
  return texture(canvas, false);
}

// Five-point star path whose points touch `radius`, pointing up.
export function starPath(
  context: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  innerRatio: number,
) {
  context.moveTo(cx, cy - radius);
  for (let index = 1; index < 10; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    const r = index % 2 === 0 ? radius : radius * innerRatio;
    context.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  }
  context.closePath();
}

function drawSpike(
  context: CanvasRenderingContext2D,
  center: number,
  angle: number,
  length: number,
  thickness: number,
) {
  const half = RAY_TEXTURE_RADIUS * length;
  context.save();
  context.translate(center, center);
  context.rotate(angle);
  const gradient = context.createLinearGradient(-half, 0, half, 0);
  // Stays visible close to the tips, so the drawn size matches the flare
  // radius instead of fading out halfway.
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.1, 'rgba(255,255,255,0.3)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.9, 'rgba(255,255,255,0.3)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.beginPath();
  context.ellipse(0, 0, half, RAY_TEXTURE_SIZE * thickness, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas is not available for effect textures');
  }
  return context;
}

function texture(canvas: HTMLCanvasElement, mipmaps: boolean) {
  const source = new CanvasSource({
    resource: canvas,
    autoGenerateMipmaps: mipmaps,
    scaleMode: 'linear',
  });
  return new Texture({ source });
}
