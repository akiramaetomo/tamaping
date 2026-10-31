import type { ParticleFormationTarget } from '../sim/physicsWorld';
import {
  MESSAGE_FORMATION_DESKTOP_FONT_RATIO,
  MESSAGE_FORMATION_LINE_HEIGHT_RATIO,
  MESSAGE_FORMATION_MIN_FONT_SIZE,
  MESSAGE_FORMATION_MOBILE_FONT_RATIO,
  MESSAGE_FORMATION_SAMPLE_ALPHA,
  createDotFontMessagePoints,
  createMessageTargetsFromPoints,
  messageBlockHeightRatio,
  messageLines,
} from './messageFormation';

// Name formation targets for the current world. Dot-font text uses the pure
// helpers in messageFormation.ts; other text is drawn on an offscreen canvas
// and sampled.

export type MessageFormationOptions = {
  text: string;
  particleCount: number;
  particleRadius: number;
  worldWidth: number;
  worldHeight: number;
  mobile: boolean;
  settingsOpen: boolean;
};

type AlphaImage = Pick<ImageData, 'width' | 'height' | 'data'>;

const MESSAGE_FONT_FAMILY = 'Inter, ui-sans-serif, system-ui, sans-serif';

export function createMessageFormationTargets(
  options: MessageFormationOptions,
): ParticleFormationTarget[] {
  const { particleCount, particleRadius, mobile, settingsOpen } = options;
  const width = Math.max(Math.floor(options.worldWidth), 1);
  const height = Math.max(Math.floor(options.worldHeight), 1);
  const margin = mobile
    ? Math.max(6, width * 0.025)
    : Math.max(18, Math.min(width, height) * 0.06);
  const textBoxWidth = Math.max(width - margin * 2, 1);
  const textBoxHeight = Math.max(height * (mobile ? (settingsOpen ? 0.32 : 0.44) : 0.42), 1);
  const centerX = width * 0.5;
  const centerY = height * (mobile ? (settingsOpen ? 0.24 : 0.36) : 0.5);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return [];
  }

  const message = options.text.trim() || 'Custom';
  const lines = messageLines(message, mobile);
  const dotFontPoints = createDotFontMessagePoints(
    lines,
    textBoxWidth,
    textBoxHeight,
    centerX,
    centerY,
  );
  if (dotFontPoints.length > 0) {
    return createMessageTargetsFromPoints(
      dotFontPoints,
      particleCount,
      width,
      height,
      particleRadius,
    );
  }

  const fontSize = messageFontSize(context, lines, textBoxWidth, textBoxHeight, mobile);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `800 ${fontSize}px ${MESSAGE_FONT_FAMILY}`;
  drawMessageLines(context, lines, centerX, centerY, textBoxWidth, fontSize);

  const image = context.getImageData(0, 0, width, height);
  const points = sampleMessagePixels(image, fontSize, particleRadius);
  if (points.length <= 0) {
    return [];
  }

  return createMessageTargetsFromPoints(
    points,
    particleCount,
    width,
    height,
    particleRadius,
  );
}

// Grid-samples opaque pixels. The step grows with the particle size and the
// font size so large text does not produce far more points than particles.
export function sampleMessagePixels(image: AlphaImage, fontSize: number, particleRadius: number) {
  const points: Array<{ x: number; y: number }> = [];
  const step = Math.max(
    4,
    Math.floor(Math.max(particleRadius * 2.25, fontSize / 13)),
  );

  for (let y = 0; y < image.height; y += step) {
    for (let x = 0; x < image.width; x += step) {
      const alpha = image.data[(y * image.width + x) * 4 + 3] ?? 0;
      if (alpha >= MESSAGE_FORMATION_SAMPLE_ALPHA) {
        points.push({ x, y });
      }
    }
  }

  return points;
}

function messageFontSize(
  context: CanvasRenderingContext2D,
  lines: string[],
  maxWidth: number,
  maxHeight: number,
  mobile: boolean,
) {
  const fontRatio = mobile
    ? MESSAGE_FORMATION_MOBILE_FONT_RATIO
    : MESSAGE_FORMATION_DESKTOP_FONT_RATIO;
  let fontSize = Math.min(
    Math.max(
      MESSAGE_FORMATION_MIN_FONT_SIZE,
      maxHeight / messageBlockHeightRatio(lines.length),
    ),
    Math.max(MESSAGE_FORMATION_MIN_FONT_SIZE, maxWidth * fontRatio),
  );

  while (fontSize > MESSAGE_FORMATION_MIN_FONT_SIZE) {
    context.font = `800 ${fontSize}px ${MESSAGE_FONT_FAMILY}`;
    const maxLineWidth = Math.max(...lines.map((line) => context.measureText(line).width));
    if (
      maxLineWidth <= maxWidth &&
      fontSize * messageBlockHeightRatio(lines.length) <= maxHeight
    ) {
      break;
    }
    fontSize *= 0.92;
  }

  return Math.max(MESSAGE_FORMATION_MIN_FONT_SIZE, Math.floor(fontSize));
}

function drawMessageLines(
  context: CanvasRenderingContext2D,
  lines: string[],
  centerX: number,
  centerY: number,
  maxWidth: number,
  fontSize: number,
) {
  const lineGap = fontSize * MESSAGE_FORMATION_LINE_HEIGHT_RATIO;
  const firstY = centerY - ((lines.length - 1) * lineGap) / 2;
  for (let index = 0; index < lines.length; index += 1) {
    context.fillText(lines[index], centerX, firstY + index * lineGap, maxWidth);
  }
}
