import { Buffer, BufferUsage, Geometry, GlProgram, Mesh, Shader, Texture, UniformGroup } from 'pixi.js';
import {
  RAY_FOOTPRINT_MAX_MARGIN,
  rayFootprintShare,
  rayFootprintTemplate,
} from './rayFootprint';

// Every dot's Rays X in one instanced draw. The square sprite painted its
// whole square, about 3/4 of it transparent; additive blending still costs
// a pixel there, and 10000 dots at full speed fill well over 100 million
// device pixels a frame. Here each X is drawn over an outline that hugs it
// (rayFootprint.ts), with the same texture at the same texture
// coordinates, so every pixel it does draw looks as before.
//
// The outline is grown by RAY_MARGIN_PX device pixels on every side. At
// small sizes the texture is read from a smaller mipmap level, whose blur
// spreads the spikes' edges a little beyond the full-size drawing; the
// margin keeps that blur.

// Device pixels added around the X. Measured on a PC (Edge, no MSAA,
// against the square sprites): 0 loses up to 0.5% of the light of small
// dots and changes pixels by up to 47/255; from 1.5 every scene stays
// within 3/255 with the same total light. 2 leaves room for other GPUs.
export const RAY_MARGIN_PX = 2;

// Same maths as Pixi's particle shader (tint and alpha per instance,
// premultiplied), with the corner computed from the template.
const VERTEX = `
attribute vec2 aBase;
attribute vec2 aGrow;
attribute vec2 aCentre;
attribute vec2 aRadiusRotation;
attribute vec4 aColor;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform float uMarginWorld;

varying vec2 vUV;
varying vec4 vColor;

void main(void) {
  float radius = aRadiusRotation.x;
  float margin = radius > 0.0
    ? clamp(uMarginWorld / radius, 0.0, ${RAY_FOOTPRINT_MAX_MARGIN.toFixed(6)})
    : 0.0;
  vec2 local = aBase + aGrow * margin;
  vUV = local * 0.5 + 0.5;
  float c = cos(aRadiusRotation.y);
  float s = sin(aRadiusRotation.y);
  vec2 v = vec2(local.x * c - local.y * s, local.x * s + local.y * c) * radius + aCentre;
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(v, 1.0)).xy, 0.0, 1.0);
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

export class RayMesh {
  readonly view: Mesh<Geometry, Shader>;
  private readonly uniforms = new UniformGroup({ uMarginWorld: { value: 0, type: 'f32' } });
  private readonly template = rayFootprintTemplate();
  private capacity = 0;
  private centres = new Float32Array(0);
  private radiusRotations = new Float32Array(0);
  private colors = new Uint32Array(0);
  private centreBuffer: Buffer | null = null;
  private radiusRotationBuffer: Buffer | null = null;
  private colorBuffer: Buffer | null = null;
  private count = 0;
  // Sum of the flare radius squared over the rays drawn this frame (world
  // units), for the fill estimate.
  private radiusSquares = 0;
  private marginWorld = 0;

  constructor(texture: Texture) {
    const shader = new Shader({
      glProgram: GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: 'ray-mesh' }),
      resources: { uTexture: texture.source, rayUniforms: this.uniforms },
    });
    this.view = new Mesh({ geometry: this.buildGeometry(1), shader, texture });
    this.view.blendMode = 'add';
    this.view.geometry.instanceCount = 0;
  }

  // Called once per frame before the rays are set. `pixelsPerUnit` is
  // device pixels per world unit (view scale times renderer resolution).
  begin(count: number, pixelsPerUnit: number) {
    if (count > this.capacity) {
      const old = this.view.geometry;
      this.view.geometry = this.buildGeometry(Math.max(count, this.capacity * 2));
      old.destroy(true);
    }
    this.count = count;
    this.view.geometry.instanceCount = count;
    this.radiusSquares = 0;
    this.marginWorld = pixelsPerUnit > 0 ? RAY_MARGIN_PX / pixelsPerUnit : 0;
    this.uniforms.uniforms.uMarginWorld = this.marginWorld;
  }

  // `radius` is the flare radius (centre to spike tip) in world units.
  setRay(index: number, x: number, y: number, radius: number, rotation: number, color: number) {
    this.centres[index * 2] = x;
    this.centres[index * 2 + 1] = y;
    this.radiusRotations[index * 2] = radius;
    this.radiusRotations[index * 2 + 1] = rotation;
    this.colors[index] = color;
    this.radiusSquares += radius * radius;
  }

  hideRay(index: number) {
    this.radiusRotations[index * 2] = 0;
  }

  // Uploads this frame's rays.
  finishFrame() {
    if (this.count === 0) {
      return;
    }
    this.centreBuffer?.update(this.count * 2 * 4);
    this.radiusRotationBuffer?.update(this.count * 2 * 4);
    this.colorBuffer?.update(this.count * 4);
  }

  // Device pixels drawn this frame, and what the square sprites would have
  // drawn, ignoring the screen's edges and overlap. The outline's share is
  // taken at the margin of a ray of the frame's root-mean-square size.
  fill(pixelsPerUnit: number) {
    const square = 4 * this.radiusSquares * pixelsPerUnit * pixelsPerUnit;
    const rms = this.count > 0 ? Math.sqrt(this.radiusSquares / this.count) * pixelsPerUnit : 0;
    const margin = rms > 0 ? Math.min(RAY_MARGIN_PX / rms, RAY_FOOTPRINT_MAX_MARGIN) : 0;
    return { drawn: square * rayFootprintShare(margin), square };
  }

  destroy() {
    this.view.destroy();
  }

  private buildGeometry(capacity: number) {
    this.capacity = capacity;
    const centres = new Float32Array(capacity * 2);
    const radiusRotations = new Float32Array(capacity * 2);
    const colors = new Uint32Array(capacity);
    centres.set(this.centres.subarray(0, Math.min(this.centres.length, centres.length)));
    radiusRotations.set(this.radiusRotations.subarray(0, Math.min(this.radiusRotations.length, radiusRotations.length)));
    colors.set(this.colors.subarray(0, Math.min(this.colors.length, colors.length)));
    this.centres = centres;
    this.radiusRotations = radiusRotations;
    this.colors = colors;
    const usage = BufferUsage.VERTEX | BufferUsage.COPY_DST;
    this.centreBuffer = new Buffer({ data: centres, usage, label: 'ray-centres' });
    this.radiusRotationBuffer = new Buffer({ data: radiusRotations, usage, label: 'ray-radius-rotations' });
    this.colorBuffer = new Buffer({ data: colors, usage, label: 'ray-colors' });
    const geometry = new Geometry({
      attributes: {
        aBase: { buffer: new Buffer({ data: this.template.base, usage, label: 'ray-base' }), format: 'float32x2' },
        aGrow: { buffer: new Buffer({ data: this.template.grow, usage, label: 'ray-grow' }), format: 'float32x2' },
        aCentre: { buffer: this.centreBuffer, format: 'float32x2', instance: true },
        aRadiusRotation: { buffer: this.radiusRotationBuffer, format: 'float32x2', instance: true },
        aColor: { buffer: this.colorBuffer, format: 'unorm8x4', instance: true },
      },
      indexBuffer: new Buffer({
        data: this.template.indices,
        usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
        label: 'ray-indices',
      }),
    });
    return geometry;
  }
}

