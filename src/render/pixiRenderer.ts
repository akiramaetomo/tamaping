import { Application, Graphics } from 'pixi.js';
import type { WorldSnapshot } from '../sim/physicsWorld';
import type { BallPalette, ParticleGlowMode, ParticlePalette } from '../sim/settings';

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

export class PixiRenderer {
  private readonly app = new Application();
  private readonly particles = new Graphics();
  private readonly control = new Graphics();
  private readonly table = new Graphics();
  private particleBaseColors: number[] = [];
  private particlePalette: ParticlePalette = 'blue';
  private particleRimWidthPercent = 20;
  private particleBrightnessResponse = 1;
  private particleGlowMode: ParticleGlowMode = 'gold';
  private particleGlowVividness = 0.85;
  private particleLeaderVisible = false;
  private ballPalette: BallPalette = 'blue';
  private ballRimEnabled = true;

  constructor(private readonly root: HTMLElement) {}

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
    this.app.stage.addChild(this.table, this.particles, this.control);
  }

  render(snapshot: WorldSnapshot) {
    this.drawTable(snapshot.width, snapshot.height);
    this.drawParticles(snapshot);
    this.drawControl(snapshot);
  }

  resize() {
    this.app.renderer.resize(window.innerWidth, window.innerHeight);
  }

  dispose() {
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
  }

  setParticleBrightnessResponse(response: number) {
    this.particleBrightnessResponse = Math.max(0, Math.min(response, 100));
  }

  setParticleGlowMode(mode: ParticleGlowMode) {
    this.particleGlowMode = mode;
  }

  setParticleGlowVividness(vividness: number) {
    this.particleGlowVividness = Math.max(0, Math.min(vividness, 2));
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
        this.particles.circle(dot.x, dot.y, dot.radius * 1.75).fill({
          color: 0xf7fbff,
          alpha: 0.18,
        });
        color = 0xf7fbff;
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
    const rimAlpha = this.particleLeaderVisible && isLeader ? 0.94 : PARTICLE_RIM_ALPHA;
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

  private drawControl(snapshot: WorldSnapshot) {
    const ball = snapshot.controlBall;
    this.control.clear();
    if (!ball.visible) {
      return;
    }

    const style = ballStyle(this.ballPalette);
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
    this.control.circle(ball.x, ball.y, Math.max(ball.radius * 0.16, 4)).fill({
      color: style.center,
      alpha: style.centerAlpha,
    });
  }

  private ensureParticleColors(count: number) {
    if (this.particleBaseColors.length === count) {
      return;
    }

    this.particleBaseColors = Array.from({ length: count }, (_, index) =>
      paletteColor(this.particlePalette, index),
    );
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

function paletteColor(palette: ParticlePalette, index: number) {
  switch (palette) {
    case 'green':
      return javaRgb(index, 28, 70, 145, 80, 58, 70);
    case 'yellow':
      return javaRgb(index, 190, 55, 160, 70, 46, 50);
    case 'red':
      return javaRgb(index, 0x80, 127, 0, 90, 0, 90);
    case 'pink':
      return javaRgb(index, 210, 45, 80, 45, 120, 45);
    case 'orange':
      return javaRgb(index, 210, 45, 90, 65, 26, 45);
    case 'white':
      return javaRgb(index, 205, 45, 215, 35, 225, 30);
    case 'pastel':
      return javaRgb(index, 0x80, 64, 0x80, 64, 0x80, 64);
    case 'colorful':
      return colorfulFamilyColor(index);
    case 'blue':
    default:
      return javaRgb(index, 0, 90, 0, 90, 0x80, 127);
  }
}

function javaRgb(
  index: number,
  redBase: number,
  redRange: number,
  greenBase: number,
  greenRange: number,
  blueBase: number,
  blueRange: number,
) {
  return rgbToHex(
    redBase + seeded(index * 3 + 11) * redRange,
    greenBase + seeded(index * 5 + 29) * greenRange,
    blueBase + seeded(index * 7 + 47) * blueRange,
  );
}

function colorfulFamilyColor(index: number) {
  const family = Math.floor(seeded(index + 101) * 6);
  const baseHue = [205, 325, 35, 145, 275, 55][family];
  const hue = baseHue + (seeded(index * 3 + 17) - 0.5) * 30;
  return hslToHex(hue, 68 + seeded(index * 5 + 31) * 18, 58 + seeded(index * 7 + 43) * 18);
}

function speedColor(
  speed: number,
  baseColor: number,
  response: number,
  glowMode: ParticleGlowMode,
  vividness: number,
  index: number,
) {
  if (response <= 0) {
    return baseColor;
  }

  const adjustedSpeed = speed * response;
  const t = smoothstep(clamp01(adjustedSpeed / 1900));
  const hot = smoothstep(clamp01((adjustedSpeed - 780) / 1700));
  const target = vividGlowColor(glowMode, index, vividness);
  const targetMix = 0.24 + hot * 0.58;
  const energeticColor = mixRgb(baseColor, target, targetMix);
  const whitePeak = smoothstep(clamp01((adjustedSpeed - 2800) / 2100));
  const peakColor = mixRgb(energeticColor, 0xffffff, whitePeak * 0.85);
  return mixRgb(baseColor, peakColor, Math.max(t * 0.9, whitePeak * 0.94));
}

function vividGlowColor(mode: ParticleGlowMode, index: number, vividness: number) {
  const target = glowColor(mode, index);
  if (mode === 'white') {
    return target;
  }

  if (vividness < 1) {
    return mixRgb(0xf8fbff, target, vividness);
  }

  return saturateRgb(target, 1 + (vividness - 1) * 0.42);
}

function glowColor(mode: ParticleGlowMode, index: number) {
  switch (mode) {
    case 'white':
      return 0xf8fbff;
    case 'cyan':
      return 0x00dcff;
    case 'pink':
      return 0xff25b8;
    case 'red':
      return 0xff2424;
    case 'green':
      return 0x38ff45;
    case 'rainbow':
      return hslToHex((index * 53 + 35) % 360, 96, 56);
    case 'gold':
    default:
      return 0xffc400;
  }
}

function seeded(value: number) {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function hslToHex(h: number, s: number, l: number) {
  const sat = s / 100;
  const light = l / 100;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = h / 60;
  const x = chroma * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [chroma, x, 0]
      : hp < 2
        ? [x, chroma, 0]
        : hp < 3
          ? [0, chroma, x]
          : hp < 4
            ? [0, x, chroma]
            : hp < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const m = light - chroma / 2;
  return rgbToHex((r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255);
}

function mixRgb(a: number, b: number, t: number) {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return rgbToHex(
    ar + (br - ar) * t,
    ag + (bg - ag) * t,
    ab + (bb - ab) * t,
  );
}

function saturateRgb(color: number, factor: number) {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;

  if (max === min) {
    return color;
  }

  const delta = max - min;
  const saturation = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;

  if (max === r) {
    hue = (g - b) / delta + (g < b ? 6 : 0);
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  return hslToHex((hue / 6) * 360, clamp01(saturation * factor) * 100, light * 100);
}

function lightenRgb(color: number, amount: number) {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return rgbToHex(
    r + (255 - r) * amount,
    g + (255 - g) * amount,
    b + (255 - b) * amount,
  );
}

function rgbToHex(r: number, g: number, b: number) {
  return ((clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b)) >>> 0;
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number) {
  return value * value * (3 - 2 * value);
}
