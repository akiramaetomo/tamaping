import {
  CanvasSource,
  Container,
  GlProgram,
  Mesh,
  MeshGeometry,
  RenderTexture,
  Shader,
  Sprite,
  Texture,
  UniformGroup,
  type Renderer,
} from 'pixi.js';
import {
  AFTERGLOW_FADE_SECONDS,
  AFTERGLOW_MAX_SECONDS,
  AFTERGLOW_SECONDS,
  AFTERGLOW_STRENGTH,
  afterglowDecay,
} from './motionFx';

// Afterglow (PoC): screen-sized buffers that hold, per pixel, light (rgb)
// and how long the glow there has left to live (alpha).
//
// - The glow buffer is kept between frames (read from one buffer, written
//   to the other, then swapped). Each frame the light fades by
//   exp(-dt / AFTERGLOW_FADE_SECONDS) and the life goes down by dt; then
//   every body's swept path since the last frame (its last footprint plus
//   a band to where it is now) is stamped with the `max` blend, so
//   overlapping stamps do not add up into rings or beads.
// - Light and life are kept apart on purpose. `max` works per channel, so
//   where two stamps overlap the light may come from one and the life from
//   the other. Light that fades the same everywhere stays right per
//   channel; life only decides where the glow is still shown.
// - A stamp's life is longest on its centre line and 0 at its edge, so as
//   the glow dies it narrows to a point. Slow bodies stamp a longer life,
//   so their glow reaches further behind them (afterglowLife).
// - The shown buffer is made each frame from the glow buffer: the light,
//   where life is left, with every body's current footprint cut out. Shown
//   under the bodies, the glow starts at each body's edge; a still body
//   cuts out its own stamp, so it leaves nothing and looks the same as
//   without the effect.
//
// Stamps store their light scaled by AFTERGLOW_SECONDS / MAX (afterglowTint),
// so that the stamp's opacity can carry its life. The knobs are in
// motionFx.ts.

// The light stored by a stamp, against the light shown.
const LIGHT_GAIN = AFTERGLOW_MAX_SECONDS / AFTERGLOW_SECONDS;
// Seconds of remaining life over which the glow's edge goes from shown to
// gone, so that the narrowing edge stays soft.
const EDGE_SECONDS = 0.3;

export type AfterglowFormat = 'rgba16float' | 'rgba8unorm';

// Stamp textures: a disc and a band whose alpha is the life profile across
// them, 1 - (d / r)^2, so the glow narrows smoothly to its centre line.
export const AFTERGLOW_STAMP_RADIUS = 126;
const STAMP_TEXTURE_SIZE = 256;
export const AFTERGLOW_BAND_WIDTH = 4;

let stampTextures: { disc: Texture; band: Texture } | null = null;

export function afterglowStampTextures() {
  if (!stampTextures) {
    const center = STAMP_TEXTURE_SIZE / 2;
    stampTextures = {
      disc: profileTexture(STAMP_TEXTURE_SIZE, (x, y) => Math.hypot(x + 0.5 - center, y + 0.5 - center)),
      band: profileTexture(AFTERGLOW_BAND_WIDTH, (_x, y) => Math.abs(y + 0.5 - center)),
    };
  }
  return stampTextures;
}

function profileTexture(width: number, distance: (x: number, y: number) => number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = STAMP_TEXTURE_SIZE;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas is not available for afterglow textures');
  }
  const image = context.createImageData(width, STAMP_TEXTURE_SIZE);
  for (let y = 0; y < STAMP_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = distance(x, y) / AFTERGLOW_STAMP_RADIUS;
      const offset = (y * width + x) * 4;
      image.data.fill(255, offset, offset + 3);
      image.data[offset + 3] = Math.round(255 * Math.max(0, 1 - d * d));
    }
  }
  context.putImageData(image, 0, 0);
  return new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: 'linear' }) });
}

// Half-float keeps colour and life exact through the frame-to-frame copy.
// In 8 bits the life still runs out, but colours band and lives round.
function bufferFormat(renderer: Renderer): AfterglowFormat {
  const gl = renderer as Renderer & { context?: { extensions?: { colorBufferFloat?: unknown } } };
  if (renderer.name === 'webgpu' || gl.context?.extensions?.colorBufferFloat) {
    return 'rgba16float';
  }
  return 'rgba8unorm';
}

const VERTEX = `
attribute vec2 aPosition;
attribute vec2 aUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

varying vec2 vUV;

void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

// Ages the glow: life goes down by uValue (a share of the longest life),
// light fades by the factor uFade.
const AGE_FRAGMENT = `
varying vec2 vUV;

uniform sampler2D uTexture;
uniform float uValue;
uniform float uFade;

void main(void) {
  vec4 glow = texture2D(uTexture, vUV);
  float life = glow.a - uValue;
  if (life <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  gl_FragColor = vec4(glow.rgb * uFade, life);
}
`;

// Shows the glow: the light where life is left, its edge softened over
// EDGE_SECONDS (uValue converts life to that share). Light brighter than
// white is scaled down as a whole, so it keeps its hue.
const SHOW_FRAGMENT = `
varying vec2 vUV;

uniform sampler2D uTexture;
uniform float uValue;

void main(void) {
  vec4 glow = texture2D(uTexture, vUV);
  vec3 light = glow.rgb * ${LIGHT_GAIN.toFixed(4)};
  float peak = max(max(light.r, light.g), light.b);
  if (glow.a <= 0.0 || peak <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  light /= max(peak, 1.0);
  float shown = clamp(glow.a * uValue, 0.0, 1.0);
  gl_FragColor = vec4(light * shown, min(peak, 1.0) * shown);
}
`;

// A screen-sized quad that draws a buffer through one of the shaders above.
class BufferPass {
  readonly view: Mesh<MeshGeometry, Shader>;
  private readonly uniforms = new UniformGroup({
    uValue: { value: 0, type: 'f32' },
    uFade: { value: 1, type: 'f32' },
  });

  constructor(source: RenderTexture, fragment: string, name: string) {
    const shader = new Shader({
      glProgram: GlProgram.from({ vertex: VERTEX, fragment, name }),
      resources: { uTexture: source.source, afterglowUniforms: this.uniforms },
    });
    const geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.view = new Mesh({ geometry, shader });
  }

  set value(value: number) {
    this.uniforms.uniforms.uValue = value;
  }

  set fade(fade: number) {
    this.uniforms.uniforms.uFade = fade;
  }

  resize(width: number, height: number) {
    this.view.scale.set(width, height);
  }

  destroy() {
    this.view.destroy({ children: true });
  }
}

export class AfterglowBuffer {
  // The shown buffer: add it to the stage under the bodies.
  readonly view = new Sprite(Texture.EMPTY);
  // Filled by the bodies' owners, in world units. `prestamps` is drawn at
  // the start of a frame, before the bodies are updated, for stamps that
  // can only show last frame's pose (the fish mesh).
  readonly prestamps = new Container();
  readonly stamps = new Container();
  readonly erasers = new Container();
  readonly format: AfterglowFormat;
  // Each layer is drawn inside a pass container: Pixi applies a container's
  // blend mode to its children, but not to the root of a render call, where
  // `max` and `erase` were lost (the cut-outs then drew white discs).
  private readonly prestampPass = new Container();
  private readonly stampPass = new Container();
  private readonly eraserPass = new Container();
  private glow: [RenderTexture, RenderTexture] | null = null;
  private shown: RenderTexture | null = null;
  // Per glow buffer: the passes that read it.
  private agePasses: BufferPass[] = [];
  private showPasses: BufferPass[] = [];
  // The glow buffer that holds the current glow.
  private current = 0;
  private size = '';
  private lastAt = -1;

  constructor(private readonly renderer: Renderer) {
    this.format = bufferFormat(renderer);
    this.view.alpha = AFTERGLOW_STRENGTH;
    this.view.visible = false;
    this.prestamps.blendMode = 'max';
    this.stamps.blendMode = 'max';
    this.erasers.blendMode = 'erase';
    this.prestampPass.addChild(this.prestamps);
    this.stampPass.addChild(this.stamps);
    this.eraserPass.addChild(this.erasers);
  }

  // Start of a frame with the effect on, before the bodies are updated:
  // sizes the buffers for the screen (clearing them whenever the screen,
  // resolution or view scale changes, since the old glow would no longer
  // line up), ages the glow by the time since the last frame, and draws the
  // prestamps.
  begin(viewScale: number, now = performance.now()) {
    const screen = this.renderer.screen;
    const resolution = this.renderer.resolution;
    const size = `${screen.width}x${screen.height}@${resolution}/${viewScale}`;
    if (!this.glow || !this.shown) {
      // `dynamic`, so the sprite showing a buffer follows a resize.
      const create = () => RenderTexture.create({
        width: screen.width,
        height: screen.height,
        resolution,
        format: this.format,
        scaleMode: 'nearest',
        dynamic: true,
      });
      this.glow = [create(), create()];
      this.shown = create();
      this.view.texture = this.shown;
      this.agePasses = this.glow.map((source) => new BufferPass(source, AGE_FRAGMENT, 'afterglow-age'));
      this.showPasses = this.glow.map((source) => new BufferPass(source, SHOW_FRAGMENT, 'afterglow-show'));
      for (const pass of this.showPasses) {
        pass.value = AFTERGLOW_MAX_SECONDS / EDGE_SECONDS;
      }
    }
    if (size !== this.size) {
      this.size = size;
      for (const texture of [...this.glow, this.shown]) {
        texture.resize(screen.width, screen.height, resolution);
        this.clear(texture);
      }
      for (const pass of [...this.agePasses, ...this.showPasses]) {
        pass.resize(screen.width, screen.height);
      }
      for (const layer of [this.prestamps, this.stamps, this.erasers]) {
        layer.scale.set(viewScale);
      }
      this.view.scale.set(1 / viewScale);
      this.lastAt = -1;
    }
    this.view.visible = true;
    const seconds = this.lastAt < 0 ? 0 : Math.max(now - this.lastAt, 0) / 1000;
    this.lastAt = now;
    const from = this.current;
    this.current = 1 - from;
    const age = this.agePasses[from];
    age.value = afterglowDecay(seconds);
    age.fade = Math.exp(-seconds / AFTERGLOW_FADE_SECONDS);
    this.draw(age.view, this.glow[this.current], true);
    this.draw(this.prestampPass, this.glow[this.current], false);
  }

  // End of a frame, after the bodies are updated: stamps the swept paths,
  // then makes the shown buffer with the current footprints cut out.
  finish() {
    if (this.glow && this.shown) {
      this.draw(this.stampPass, this.glow[this.current], false);
      this.draw(this.showPasses[this.current].view, this.shown, true);
      this.draw(this.eraserPass, this.shown, false);
    }
  }

  // Off: drop the glow, so turning it on again starts clean.
  stop() {
    this.view.visible = false;
    this.lastAt = -1;
    for (const texture of [...(this.glow ?? []), this.shown]) {
      if (texture) {
        this.clear(texture);
      }
    }
  }

  destroy() {
    this.view.destroy();
    for (const pass of [this.prestampPass, this.stampPass, this.eraserPass]) {
      pass.destroy({ children: true });
    }
    for (const pass of [...this.agePasses, ...this.showPasses]) {
      pass.destroy();
    }
    for (const texture of [...(this.glow ?? []), this.shown]) {
      texture?.destroy(true);
    }
  }

  private draw(container: Container, target: RenderTexture, clear: boolean) {
    this.renderer.render({ container, target, clear, clearColor: [0, 0, 0, 0] });
  }

  private clear(target: RenderTexture) {
    this.renderer.clear({ target, clearColor: [0, 0, 0, 0] });
  }
}
