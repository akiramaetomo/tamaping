import { Buffer, BufferUsage, CanvasSource, Geometry, GlProgram, Mesh, Shader, Texture } from 'pixi.js';
import { AFTERGLOW_MAX_SECONDS, AFTERGLOW_SECONDS } from './motionFx';
import {
  FISH_HALF_SPAN_RADII,
  FISH_LENGTH_RADII,
  FISH_NOSE_RADII,
  FISH_TAIL_RADII,
  FishMotion,
  FishSpine,
  STRAIGHT_FISH,
  fishParts,
  type FishPose,
  type Polygon,
} from './fishBody';

// Particle fish as one bending mesh: the straight fish is drawn once into a
// texture, and every frame each fish's strip of quads is bent along its own
// spine (beat and turn curl). All fish share one draw call; colour is per
// vertex, so each fish keeps its own tint.

const MARGIN = 4;
const TEXTURE_WIDTH = 512;
const TEXTURE_HEIGHT = 272;
// Texels per physics radius (53).
const TEXELS = Math.floor((TEXTURE_WIDTH - 2 * MARGIN) / FISH_LENGTH_RADII);
const HEAD_X = MARGIN + FISH_TAIL_RADII * TEXELS;
// Texture edges in radii from the disc centre.
const FRONT_EDGE = (TEXTURE_WIDTH - HEAD_X) / TEXELS;
const BACK_EDGE = HEAD_X / TEXELS;
const SIDE_EDGE = TEXTURE_HEIGHT / 2 / TEXELS;
// Bend resolution: segments behind the disc centre, shorter toward the
// tail where the curl bends most (the last is a third of the first). The
// part in front stays rigid, so it needs one column at the texture's front
// edge.
const SEGMENTS = 20;
const TAIL_DENSITY = 0.5;
const COLUMNS = SEGMENTS + 2;
const VERTICES = COLUMNS * 2;
const INDICES = (COLUMNS - 1) * 6;
// Each column reaches only as far as the fish does there, plus this margin
// (radii), not to the texture's edge. A tall column folds over itself on
// the inside of a tight bend and scrambles even a narrow tail; a short one
// only folds when the bend is tighter than the fish is wide.
const EXTENT_MARGIN = 0.15;
// Half-width (radii) over which the afterglow's life falls to 0 across the
// fish: a little wider than the body, so the body's glow keeps its width.
const AFTERGLOW_HALF_WIDTH_RADII = 1.3;
// Longest frame step for the beat, so a stalled tab does not jump.
const MAX_FRAME_SECONDS = 0.1;

if (FRONT_EDGE < FISH_NOSE_RADII || SIDE_EDGE < FISH_HALF_SPAN_RADII) {
  throw new Error('Fish texture is too small for the fish');
}

// Same maths as the particle shader: tint and alpha per vertex, with
// premultiplied alpha.
const VERTEX = `
attribute vec2 aPosition;
attribute vec2 aUV;
attribute vec4 aColor;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

varying vec2 vUV;
varying vec4 vColor;

void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  vColor = vec4(aColor.rgb * aColor.a, aColor.a);
}
`;

const FRAGMENT = `
varying vec2 vUV;
varying vec4 vColor;

uniform sampler2D uTexture;

void main(void) {
  gl_FragColor = texture2D(uTexture, vUV) * vColor;
}
`;

// Afterglow stamp: the fish's colour as light, and the glow's life (aLife,
// a share of the longest life) as alpha, as afterglowTint does for
// sprites. Both fall from the fish's centre line to its sides, so the glow
// narrows as it dies; the fins, further out, leave little. A longer life
// is dimmer (afterglowBrightness).
const STAMP_VERTEX = `
attribute vec2 aPosition;
attribute vec2 aUV;
attribute vec4 aColor;
attribute float aLife;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

varying vec2 vUV;
varying vec3 vRgb;
varying float vLife;

void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  float seconds = max(aLife * ${AFTERGLOW_MAX_SECONDS.toFixed(4)}, ${AFTERGLOW_SECONDS.toFixed(4)});
  vRgb = aColor.rgb * sqrt(${AFTERGLOW_SECONDS.toFixed(4)} / seconds)
    * ${(AFTERGLOW_SECONDS / AFTERGLOW_MAX_SECONDS).toFixed(4)};
  vLife = aLife;
}
`;

const STAMP_FRAGMENT = `
varying vec2 vUV;
varying vec3 vRgb;
varying float vLife;

uniform sampler2D uTexture;

void main(void) {
  float side = (vUV.y - 0.5) * ${(TEXTURE_HEIGHT / TEXELS).toFixed(4)} / ${AFTERGLOW_HALF_WIDTH_RADII.toFixed(4)};
  float profile = texture2D(uTexture, vUV).a * clamp(1.0 - side * side, 0.0, 1.0);
  gl_FragColor = vec4(vRgb * profile, vLife * profile);
}
`;

// Afterglow footprint: the fish's shape at full opacity, whatever its tint,
// with the same antialiased edge as the fish, so no dark seam shows
// between the fish and its glow.
const FOOTPRINT_FRAGMENT = `
varying vec2 vUV;

uniform sampler2D uTexture;

void main(void) {
  gl_FragColor = vec4(texture2D(uTexture, vUV).a);
}
`;

export class FishMesh {
  readonly view: Mesh<Geometry, Shader>;
  private readonly source: CanvasSource;
  private readonly texture: Texture;
  private readonly spine = new FishSpine(BACK_EDGE, SEGMENTS, TAIL_DENSITY);
  // Half-height of each column, in radii; column 0 is the front edge.
  private readonly extents = columnExtents([FRONT_EDGE, ...this.spine.s].map((s, col) => (col === 0 ? s : -s)));
  private readonly motions: FishMotion[] = [];
  private positions = new Float32Array(0);
  private colors = new Uint32Array(0);
  private lives = new Float32Array(0);
  private positionBuffer: Buffer | null = null;
  private colorBuffer: Buffer | null = null;
  private lifeBuffer: Buffer | null = null;
  // The same buffers plus the afterglow life, for the afterglow stamp only;
  // the fish shader has no life attribute.
  private stampGeometry: Geometry | null = null;
  private count = 0;
  private rimWidthPercent = -1;
  private frameSeconds = 0;
  private lastFrameAt = -1;
  // Afterglow stamp and footprint, created on first use. Both share the
  // fish buffers: drawn before the fish are set, the stamp shows last
  // frame's bend; drawn after, the footprint shows this frame's.
  private afterglow: { stamp: Mesh<Geometry, Shader>; footprint: Mesh<Geometry, Shader> } | null = null;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_WIDTH;
    canvas.height = TEXTURE_HEIGHT;
    this.source = new CanvasSource({ resource: canvas, autoGenerateMipmaps: true, scaleMode: 'linear' });
    // Same as the round body texture: trilinear blending softened small dots.
    this.source.mipmapFilter = 'nearest';
    this.texture = new Texture({ source: this.source });
    const shader = new Shader({
      glProgram: GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: 'fish-mesh' }),
      resources: { uTexture: this.source },
    });
    this.view = new Mesh({ geometry: this.buildGeometry(0), shader, texture: this.texture });
  }

  // Redrawn in place, so the shader's texture binding stays valid.
  draw(rimWidthPercent: number) {
    if (this.rimWidthPercent === rimWidthPercent) {
      return;
    }
    this.rimWidthPercent = rimWidthPercent;
    const canvas = this.source.resource as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('2D canvas is not available for the fish texture');
    }
    context.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
    drawFish(context, HEAD_X, TEXTURE_HEIGHT / 2, fishParts(STRAIGHT_FISH), rimWidthPercent);
    this.source.update();
  }

  // Called once per frame before the fish are set.
  setCount(count: number) {
    const now = performance.now();
    this.frameSeconds = this.lastFrameAt < 0
      ? 0
      : Math.min(Math.max(now - this.lastFrameAt, 0) / 1000, MAX_FRAME_SECONDS);
    this.lastFrameAt = now;

    if (this.motions.length > count) {
      this.motions.length = count;
    }
    if (count !== this.count) {
      const old = this.view.geometry;
      const oldStamp = this.stampGeometry;
      this.view.geometry = this.buildGeometry(count);
      if (this.afterglow && this.stampGeometry) {
        this.afterglow.stamp.geometry = this.stampGeometry;
        this.afterglow.footprint.geometry = this.view.geometry;
      }
      // Shares the old buffers (destroying a buffer twice is harmless) and
      // owns the life buffer.
      oldStamp?.destroy(true);
      old.destroy(true);
    }
  }

  // `heading` is the facing used for rotation and turn curl, or null when
  // the fish does not turn (it then faces +x and does not curl). `life` is
  // its afterglow life, a share of the longest life.
  setFish(
    index: number,
    x: number,
    y: number,
    radius: number,
    color: number,
    factor: number,
    heading: number | null,
    life = 0,
  ) {
    const motions = this.motions;
    while (motions.length <= index) {
      // Golden-ratio spacing spreads the beat phases, so a school does not
      // beat in step.
      motions.push(new FishMotion(((motions.length * 0.6180339887) % 1) * Math.PI * 2));
    }
    const pose = motions[index].update(factor, heading, this.frameSeconds);
    this.writeFish(index, x, y, radius, heading ?? 0, color, pose);
    this.lives.fill(life, index * VERTICES, (index + 1) * VERTICES);
  }

  // Uploads this frame's vertices.
  finishFrame() {
    this.positionBuffer?.update();
    this.colorBuffer?.update();
    if (this.afterglow) {
      this.lifeBuffer?.update();
    }
  }

  get hasAfterglow() {
    return this.afterglow !== null;
  }

  // The stamp draws the fish's colour with its afterglow life; the
  // footprint draws the fish's shape at full opacity. Their blend modes
  // come from the afterglow buffer.
  afterglowViews() {
    if (!this.afterglow) {
      const mesh = (vertex: string, fragment: string, name: string, geometry: Geometry) => new Mesh({
        geometry,
        shader: new Shader({
          glProgram: GlProgram.from({ vertex, fragment, name }),
          resources: { uTexture: this.source },
        }),
        texture: this.texture,
      });
      this.afterglow = {
        stamp: mesh(STAMP_VERTEX, STAMP_FRAGMENT, 'fish-afterglow', this.stampGeometry ?? this.view.geometry),
        footprint: mesh(VERTEX, FOOTPRINT_FRAGMENT, 'fish-footprint', this.view.geometry),
      };
    }
    return this.afterglow;
  }

  destroy() {
    this.afterglow?.stamp.destroy();
    this.afterglow?.footprint.destroy();
    this.stampGeometry?.destroy(true);
    this.view.destroy();
    this.texture.destroy(false);
    this.source.destroy();
  }

  private writeFish(
    index: number,
    x: number,
    y: number,
    radius: number,
    rotation: number,
    color: number,
    pose: FishPose,
  ) {
    const spine = this.spine.compute(pose);
    const cos = Math.cos(rotation) * radius;
    const sin = Math.sin(rotation) * radius;
    const positions = this.positions;
    let offset = index * VERTICES * 2;
    // Writes one column: a spine point and the two ends of its extent.
    let col = 0;
    const column = (px: number, py: number, nx: number, ny: number) => {
      const extent = this.extents[col];
      col += 1;
      const ux = px + nx * extent;
      const uy = py + ny * extent;
      const lx = px - nx * extent;
      const ly = py - ny * extent;
      positions[offset] = x + ux * cos - uy * sin;
      positions[offset + 1] = y + ux * sin + uy * cos;
      positions[offset + 2] = x + lx * cos - ly * sin;
      positions[offset + 3] = y + lx * sin + ly * cos;
      offset += 4;
    };
    column(FRONT_EDGE, 0, 0, 1);
    for (let point = 0; point <= SEGMENTS; point += 1) {
      const angle = spine.angle[point];
      column(spine.x[point], spine.y[point], -Math.sin(angle), Math.cos(angle));
    }
    this.colors.fill(color, index * VERTICES, (index + 1) * VERTICES);
  }

  private buildGeometry(count: number) {
    this.count = count;
    this.positions = new Float32Array(Math.max(count, 1) * VERTICES * 2);
    this.colors = new Uint32Array(Math.max(count, 1) * VERTICES);
    this.lives = new Float32Array(Math.max(count, 1) * VERTICES);
    const uvs = new Float32Array(this.positions.length);
    const indices = new Uint32Array(Math.max(count, 1) * INDICES);
    for (let fish = 0; fish < count; fish += 1) {
      const vertexBase = fish * VERTICES;
      for (let col = 0; col < COLUMNS; col += 1) {
        // Column 0 is the front edge; then the spine from the disc centre
        // back to the texture's back edge.
        const textureX = col === 0 ? FRONT_EDGE : -this.spine.s[col - 1];
        const u = (HEAD_X + textureX * TEXELS) / TEXTURE_WIDTH;
        const uvOffset = (vertexBase + col * 2) * 2;
        const v = (this.extents[col] * TEXELS) / TEXTURE_HEIGHT;
        // +y side is lower in the canvas.
        uvs[uvOffset] = u;
        uvs[uvOffset + 1] = 0.5 + v;
        uvs[uvOffset + 2] = u;
        uvs[uvOffset + 3] = 0.5 - v;
        if (col > 0) {
          const a = vertexBase + (col - 1) * 2;
          const i = (fish * (COLUMNS - 1) + col - 1) * 6;
          indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i);
        }
      }
    }
    const usage = BufferUsage.VERTEX | BufferUsage.COPY_DST;
    this.positionBuffer = new Buffer({ data: this.positions, usage, label: 'fish-positions' });
    this.colorBuffer = new Buffer({ data: this.colors, usage, label: 'fish-colors' });
    this.lifeBuffer = new Buffer({ data: this.lives, usage, label: 'fish-afterglow-lives' });
    const attributes = {
      aPosition: { buffer: this.positionBuffer, format: 'float32x2' as const },
      aUV: { buffer: new Buffer({ data: uvs, usage, label: 'fish-uvs' }), format: 'float32x2' as const },
      aColor: { buffer: this.colorBuffer, format: 'unorm8x4' as const },
    };
    const indexBuffer = new Buffer({
      data: count > 0 ? indices : new Uint32Array(0),
      usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
      label: 'fish-indices',
    });
    this.stampGeometry = new Geometry({
      attributes: { ...attributes, aLife: { buffer: this.lifeBuffer, format: 'float32' } },
      indexBuffer,
    });
    return new Geometry({ attributes, indexBuffer });
  }
}

// Half-height per column (x in radii, front to back): the straight fish's
// reach between the neighbouring columns, plus the margin.
function columnExtents(xs: number[]) {
  const points = fishParts(STRAIGHT_FISH).flat();
  const extents = new Float64Array(xs.length);
  for (let col = 0; col < xs.length; col += 1) {
    const front = xs[Math.max(col - 1, 0)];
    const back = xs[Math.min(col + 1, xs.length - 1)];
    let reach = 0;
    for (const [x, y] of points) {
      if (x <= front && x >= back) {
        reach = Math.max(reach, Math.abs(y));
      }
    }
    extents[col] = Math.min(reach + EXTENT_MARGIN, SIDE_EDGE);
  }
  return extents;
}

// Each part (body, two fins) is filled, or, for Rim width < 100%, gets an
// inside-only rim: clipped to the part and stroked twice as wide, so thin
// parts close up into solid fill. Fin rims are drawn over the body rim.
function drawFish(
  context: CanvasRenderingContext2D,
  headX: number,
  headY: number,
  parts: Polygon[],
  rimWidthPercent: number,
) {
  context.fillStyle = '#ffffff';
  context.strokeStyle = '#ffffff';
  context.lineJoin = 'round';
  for (const part of parts) {
    const path = new Path2D();
    for (const [x, y] of part) {
      path.lineTo(headX + x * TEXELS, headY + y * TEXELS);
    }
    path.closePath();
    if (rimWidthPercent >= 100) {
      context.fill(path);
      continue;
    }
    context.save();
    context.clip(path);
    context.lineWidth = 2 * TEXELS * (rimWidthPercent / 100);
    context.stroke(path);
    context.restore();
  }
}
