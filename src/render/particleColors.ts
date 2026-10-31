import type { ParticleGlowMode, ParticlePalette } from '../sim/settings';

// Particle colors: stable per-dot palette colors and the speed glow mix.

export function paletteColor(palette: ParticlePalette, index: number) {
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

// Same packing as Pixi's Particle tint/alpha setters (BGR plus alpha byte),
// without going through Color for every dot every frame.
export function particleColor(rgb: number, alpha: number) {
  const bgr = ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff);
  return bgr + (((alpha * 255) | 0) << 24);
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

export function speedColor(
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

  return speedColorToward(speed, baseColor, response, vividGlowColor(glowMode, index, vividness));
}

// Same as speedColor, with the glow target from vividGlowColor passed in, so
// callers can cache it per dot (it depends only on mode, vividness and index).
export function speedColorToward(
  speed: number,
  baseColor: number,
  response: number,
  target: number,
) {
  if (response <= 0) {
    return baseColor;
  }

  const adjustedSpeed = speed * response;
  const t = smoothstep(clamp01(adjustedSpeed / 1900));
  const hot = smoothstep(clamp01((adjustedSpeed - 780) / 1700));
  const targetMix = 0.24 + hot * 0.58;
  const energeticColor = mixRgb(baseColor, target, targetMix);
  const whitePeak = smoothstep(clamp01((adjustedSpeed - 2800) / 2100));
  const peakColor = mixRgb(energeticColor, 0xffffff, whitePeak * 0.85);
  return mixRgb(baseColor, peakColor, Math.max(t * 0.9, whitePeak * 0.94));
}

export function vividGlowColor(mode: ParticleGlowMode, index: number, vividness: number) {
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
