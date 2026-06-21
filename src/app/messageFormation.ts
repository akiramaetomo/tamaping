export type MessagePoint = {
  x: number;
  y: number;
};

export type MessagePointBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type MessageFormationTarget = MessagePoint & {
  vx: number;
  vy: number;
};

export const MESSAGE_FORMATION_MIN_FONT_SIZE = 18;
export const MESSAGE_FORMATION_DESKTOP_FONT_RATIO = 0.26;
export const MESSAGE_FORMATION_MOBILE_FONT_RATIO = 0.34;
export const MESSAGE_FORMATION_SAMPLE_ALPHA = 48;
const MESSAGE_FORMATION_TEXT_PARTICLE_RATIO = 0.45;
const MESSAGE_FORMATION_TEXT_PARTICLE_FLOOR = 120;
const MESSAGE_FORMATION_MOBILE_LINE_UNITS = 8;
const MESSAGE_FORMATION_MOBILE_MAX_LINES = 2;
export const MESSAGE_FORMATION_LINE_HEIGHT_RATIO = 1.12;
export const MESSAGE_DOT_FONT_HEIGHT = 7;
export const MESSAGE_DOT_FONT_GAP = 1;
export const MESSAGE_DOT_FONT_LINE_GAP = 2;

export function cleanPresetMessageText(name: unknown) {
  if (typeof name !== 'string') {
    return 'Custom';
  }

  const cleaned = name
    .replace(/^User\s+\d+\s*:\s*/i, '')
    .replace(/^\d+\.\s*/, '')
    .trim();
  return cleaned || 'Custom';
}

export function effectivePresetMessageText(
  name: string | null | undefined,
  formationLabel: string | null | undefined,
) {
  return cleanPresetMessageText(formationLabel ?? name);
}

export function presetDisplayLabel(name: string, formationLabel: string | null | undefined) {
  const label = cleanPresetMessageText(formationLabel);
  if (label !== 'Custom') {
    return `${name} / ${label}`;
  }

  return name;
}

export function messageLines(text: string, mobile: boolean) {
  const normalized = text.replace(/\s+/g, ' ').trim() || 'Custom';
  if (!mobile || messageLineUnits(normalized) <= MESSAGE_FORMATION_MOBILE_LINE_UNITS) {
    return [normalized];
  }

  const words = normalized.split(' ').filter(Boolean);
  if (words.length > 1) {
    return bestMobileWordSplit(words);
  }

  return splitMessageByUnits(normalized, MESSAGE_FORMATION_MOBILE_LINE_UNITS);
}

export function messageBlockHeightRatio(lineCount: number) {
  return 1 + Math.max(lineCount - 1, 0) * MESSAGE_FORMATION_LINE_HEIGHT_RATIO;
}

export function messagePointBounds(points: MessagePoint[]): MessagePointBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return { minX, minY, maxX, maxY };
}

export function createMessageTargetsFromPoints(
  points: MessagePoint[],
  particleCount: number,
  width: number,
  height: number,
  particleRadius: number,
): MessageFormationTarget[] {
  const targets: MessageFormationTarget[] = [];
  const bounds = messagePointBounds(points);
  const textPointBudget = Math.max(
    MESSAGE_FORMATION_TEXT_PARTICLE_FLOOR,
    Math.floor(particleCount * MESSAGE_FORMATION_TEXT_PARTICLE_RATIO),
  );
  const textPointCount = Math.min(points.length, particleCount, textPointBudget);

  for (let index = 0; index < textPointCount; index += 1) {
    const sourceIndex = textPointCount <= points.length
      ? Math.floor((index * points.length) / Math.max(textPointCount, 1))
      : index;
    targets.push(messageTargetFromPoint(points[sourceIndex]));
  }

  for (let index = textPointCount; index < particleCount; index += 1) {
    targets.push(
      messageCornerStashTarget(
        width,
        height,
        particleRadius,
        index - textPointCount,
        particleCount - textPointCount,
        bounds,
      ),
    );
  }

  return targets;
}

function messageCornerStashTarget(
  width: number,
  height: number,
  particleRadius: number,
  index: number,
  count: number,
  bounds: MessagePointBounds,
): MessageFormationTarget {
  const margin = Math.max(
    particleRadius * 2,
    Math.min(width, height) * 0.025,
  );
  const spacing = Math.max(
    particleRadius * 2.2,
    Math.min(width, height) * 0.018,
    8,
  );
  const safePadding = Math.max(particleRadius * 4, Math.min(width, height) * 0.08);
  const safeTop = Math.max(margin, bounds.minY - safePadding);
  const safeBottom = Math.min(height - margin, bounds.maxY + safePadding);
  const messageCenterY = (bounds.minY + bounds.maxY) * 0.5;

  if (messageCenterY < height * 0.42 && height - safeBottom > spacing * 2) {
    return messageLowerStashTarget(width, height, index, count, margin, spacing, safeBottom);
  }

  if (safeTop - margin > spacing * 2 && messageCenterY > height * 0.58) {
    return messageUpperStashTarget(width, index, count, margin, spacing, safeTop);
  }

  const cornerIndex = index % 4;
  const localIndex = Math.floor(index / 4);
  const localCount = Math.max(1, Math.ceil(count / 4));
  const columns = Math.max(1, Math.ceil(Math.sqrt(localCount)));
  const row = Math.floor(localIndex / columns);
  const column = localIndex % columns;
  const fromRight = cornerIndex === 1 || cornerIndex === 3;
  const fromBottom = cornerIndex >= 2;
  const jitterX = (((index + 1) * 0.7548776662466927) % 1 - 0.5) * 0.36;
  const jitterY = (((index + 1) * 0.5698402909980532) % 1 - 0.5) * 0.36;
  const localX = margin + (column + 0.5 + jitterX) * spacing;
  const localY = margin + (row + 0.5 + jitterY) * spacing;

  return {
    x: fromRight ? width - localX : localX,
    y: fromBottom ? height - localY : localY,
    vx: 0,
    vy: 0,
  };
}

function messageLowerStashTarget(
  width: number,
  height: number,
  index: number,
  count: number,
  margin: number,
  spacing: number,
  safeBottom: number,
): MessageFormationTarget {
  const localCount = Math.max(1, Math.ceil(count / 2));
  const sideIndex = index % 2;
  const localIndex = Math.floor(index / 2);
  const availableHeight = Math.max(height - safeBottom - margin, spacing);
  const rows = Math.max(1, Math.floor(availableHeight / spacing));
  const row = localIndex % rows;
  const column = Math.floor(localIndex / rows);
  const fromRight = sideIndex === 1;
  const maxColumns = Math.max(1, Math.ceil(localCount / rows));
  const columnOffset = column % maxColumns;
  const jitterX = (((index + 1) * 0.7548776662466927) % 1 - 0.5) * 0.36;
  const jitterY = (((index + 1) * 0.5698402909980532) % 1 - 0.5) * 0.36;
  const localX = margin + (columnOffset + 0.5 + jitterX) * spacing;
  const y = height - margin - (row + 0.5 + jitterY) * spacing;

  return {
    x: fromRight ? width - localX : localX,
    y: Math.max(safeBottom, y),
    vx: 0,
    vy: 0,
  };
}

function messageUpperStashTarget(
  width: number,
  index: number,
  count: number,
  margin: number,
  spacing: number,
  safeTop: number,
): MessageFormationTarget {
  const localCount = Math.max(1, Math.ceil(count / 2));
  const sideIndex = index % 2;
  const localIndex = Math.floor(index / 2);
  const availableHeight = Math.max(safeTop - margin, spacing);
  const rows = Math.max(1, Math.floor(availableHeight / spacing));
  const row = localIndex % rows;
  const column = Math.floor(localIndex / rows);
  const fromRight = sideIndex === 1;
  const maxColumns = Math.max(1, Math.ceil(localCount / rows));
  const columnOffset = column % maxColumns;
  const jitterX = (((index + 1) * 0.7548776662466927) % 1 - 0.5) * 0.36;
  const jitterY = (((index + 1) * 0.5698402909980532) % 1 - 0.5) * 0.36;
  const localX = margin + (columnOffset + 0.5 + jitterX) * spacing;
  const y = margin + (row + 0.5 + jitterY) * spacing;

  return {
    x: fromRight ? width - localX : localX,
    y: Math.min(safeTop, y),
    vx: 0,
    vy: 0,
  };
}

export const DOT_FONT_5X7: Record<string, readonly string[]> = {
  ' ': [
    '000',
    '000',
    '000',
    '000',
    '000',
    '000',
    '000',
  ],
  '!': [
    '00100',
    '00100',
    '00100',
    '00100',
    '00100',
    '00000',
    '00100',
  ],
  '?': [
    '01110',
    '10001',
    '00001',
    '00010',
    '00100',
    '00000',
    '00100',
  ],
  '.': [
    '00000',
    '00000',
    '00000',
    '00000',
    '00000',
    '00000',
    '00100',
  ],
  '-': [
    '00000',
    '00000',
    '00000',
    '11111',
    '00000',
    '00000',
    '00000',
  ],
  '0': [
    '01110',
    '10001',
    '10011',
    '10101',
    '11001',
    '10001',
    '01110',
  ],
  '1': [
    '00100',
    '01100',
    '00100',
    '00100',
    '00100',
    '00100',
    '01110',
  ],
  '2': [
    '01110',
    '10001',
    '00001',
    '00010',
    '00100',
    '01000',
    '11111',
  ],
  '3': [
    '11110',
    '00001',
    '00001',
    '01110',
    '00001',
    '00001',
    '11110',
  ],
  '4': [
    '00010',
    '00110',
    '01010',
    '10010',
    '11111',
    '00010',
    '00010',
  ],
  '5': [
    '11111',
    '10000',
    '10000',
    '11110',
    '00001',
    '00001',
    '11110',
  ],
  '6': [
    '01110',
    '10000',
    '10000',
    '11110',
    '10001',
    '10001',
    '01110',
  ],
  '7': [
    '11111',
    '00001',
    '00010',
    '00100',
    '01000',
    '01000',
    '01000',
  ],
  '8': [
    '01110',
    '10001',
    '10001',
    '01110',
    '10001',
    '10001',
    '01110',
  ],
  '9': [
    '01110',
    '10001',
    '10001',
    '01111',
    '00001',
    '00001',
    '01110',
  ],
  A: [
    '01110',
    '10001',
    '10001',
    '11111',
    '10001',
    '10001',
    '10001',
  ],
  B: [
    '11110',
    '10001',
    '10001',
    '11110',
    '10001',
    '10001',
    '11110',
  ],
  C: [
    '01111',
    '10000',
    '10000',
    '10000',
    '10000',
    '10000',
    '01111',
  ],
  D: [
    '11110',
    '10001',
    '10001',
    '10001',
    '10001',
    '10001',
    '11110',
  ],
  E: [
    '11111',
    '10000',
    '10000',
    '11110',
    '10000',
    '10000',
    '11111',
  ],
  F: [
    '11111',
    '10000',
    '10000',
    '11110',
    '10000',
    '10000',
    '10000',
  ],
  G: [
    '01111',
    '10000',
    '10000',
    '10011',
    '10001',
    '10001',
    '01110',
  ],
  H: [
    '10001',
    '10001',
    '10001',
    '11111',
    '10001',
    '10001',
    '10001',
  ],
  I: [
    '01110',
    '00100',
    '00100',
    '00100',
    '00100',
    '00100',
    '01110',
  ],
  J: [
    '00111',
    '00010',
    '00010',
    '00010',
    '00010',
    '10010',
    '01100',
  ],
  K: [
    '10001',
    '10010',
    '10100',
    '11000',
    '10100',
    '10010',
    '10001',
  ],
  L: [
    '10000',
    '10000',
    '10000',
    '10000',
    '10000',
    '10000',
    '11111',
  ],
  M: [
    '10001',
    '11011',
    '10101',
    '10101',
    '10001',
    '10001',
    '10001',
  ],
  N: [
    '10001',
    '11001',
    '10101',
    '10011',
    '10001',
    '10001',
    '10001',
  ],
  O: [
    '01110',
    '10001',
    '10001',
    '10001',
    '10001',
    '10001',
    '01110',
  ],
  P: [
    '11110',
    '10001',
    '10001',
    '11110',
    '10000',
    '10000',
    '10000',
  ],
  Q: [
    '01110',
    '10001',
    '10001',
    '10001',
    '10101',
    '10010',
    '01101',
  ],
  R: [
    '11110',
    '10001',
    '10001',
    '11110',
    '10100',
    '10010',
    '10001',
  ],
  S: [
    '01111',
    '10000',
    '10000',
    '01110',
    '00001',
    '00001',
    '11110',
  ],
  T: [
    '11111',
    '00100',
    '00100',
    '00100',
    '00100',
    '00100',
    '00100',
  ],
  U: [
    '10001',
    '10001',
    '10001',
    '10001',
    '10001',
    '10001',
    '01110',
  ],
  V: [
    '10001',
    '10001',
    '10001',
    '10001',
    '10001',
    '01010',
    '00100',
  ],
  W: [
    '10001',
    '10001',
    '10001',
    '10101',
    '10101',
    '10101',
    '01010',
  ],
  X: [
    '10001',
    '10001',
    '01010',
    '00100',
    '01010',
    '10001',
    '10001',
  ],
  Y: [
    '10001',
    '10001',
    '01010',
    '00100',
    '00100',
    '00100',
    '00100',
  ],
  Z: [
    '11111',
    '00001',
    '00010',
    '00100',
    '01000',
    '10000',
    '11111',
  ],
};

export function isDotFontLine(line: string) {
  return Array.from(line.toUpperCase()).every((char) => DOT_FONT_5X7[char]);
}

export function dotFontLineWidth(line: string) {
  return Array.from(line.toUpperCase()).reduce((width, char, index) => {
    const glyph = DOT_FONT_5X7[char] ?? DOT_FONT_5X7['?'];
    return width + (glyph[0]?.length ?? 0) + (index > 0 ? MESSAGE_DOT_FONT_GAP : 0);
  }, 0);
}

export function createDotFontMessagePoints(
  lines: string[],
  maxWidth: number,
  maxHeight: number,
  centerX: number,
  centerY: number,
) {
  if (!lines.every(isDotFontLine)) {
    return [];
  }

  const uppercaseLines = lines.map((line) => line.toUpperCase());
  const lineWidths = uppercaseLines.map(dotFontLineWidth);
  const maxLineWidth = Math.max(...lineWidths);
  const totalHeight =
    uppercaseLines.length * MESSAGE_DOT_FONT_HEIGHT +
    Math.max(uppercaseLines.length - 1, 0) * MESSAGE_DOT_FONT_LINE_GAP;
  if (maxLineWidth <= 0 || totalHeight <= 0) {
    return [];
  }

  const cellSize = Math.max(
    1,
    Math.min(maxWidth / maxLineWidth, maxHeight / totalHeight),
  );
  const points: MessagePoint[] = [];
  const blockHeight = totalHeight * cellSize;
  const top = centerY - blockHeight / 2;

  for (let lineIndex = 0; lineIndex < uppercaseLines.length; lineIndex += 1) {
    const line = uppercaseLines[lineIndex];
    const lineWidth = lineWidths[lineIndex] * cellSize;
    const left = centerX - lineWidth / 2;
    const yOffset =
      top + lineIndex * (MESSAGE_DOT_FONT_HEIGHT + MESSAGE_DOT_FONT_LINE_GAP) * cellSize;
    let xOffset = left;

    for (const char of Array.from(line)) {
      const glyph = DOT_FONT_5X7[char] ?? DOT_FONT_5X7['?'];
      for (let row = 0; row < glyph.length; row += 1) {
        for (let column = 0; column < glyph[row].length; column += 1) {
          if (glyph[row][column] !== '1') {
            continue;
          }
          points.push({
            x: xOffset + (column + 0.5) * cellSize,
            y: yOffset + (row + 0.5) * cellSize,
          });
        }
      }
      xOffset += (glyph[0].length + MESSAGE_DOT_FONT_GAP) * cellSize;
    }
  }

  return points;
}

function messageTargetFromPoint(point: MessagePoint): MessageFormationTarget {
  return {
    x: point.x,
    y: point.y,
    vx: 0,
    vy: 0,
  };
}

function bestMobileWordSplit(words: string[]) {
  let bestLines: string[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let split = 1; split < words.length; split += 1) {
    const left = words.slice(0, split).join(' ');
    const right = words.slice(split).join(' ');
    const leftUnits = messageLineUnits(left);
    const rightUnits = messageLineUnits(right);
    const overflow = Math.max(
      leftUnits - MESSAGE_FORMATION_MOBILE_LINE_UNITS,
      rightUnits - MESSAGE_FORMATION_MOBILE_LINE_UNITS,
      0,
    );
    const score =
      Math.max(leftUnits, rightUnits) +
      Math.abs(leftUnits - rightUnits) * 0.25 +
      overflow * 4;

    if (score < bestScore) {
      bestScore = score;
      bestLines = [left, right];
    }
  }

  return bestLines ?? [words.join(' ')];
}

function splitMessageByUnits(text: string, targetUnits: number) {
  const totalUnits = messageLineUnits(text);
  const firstLineUnits = totalUnits <= targetUnits * MESSAGE_FORMATION_MOBILE_MAX_LINES
    ? Math.ceil(totalUnits / MESSAGE_FORMATION_MOBILE_MAX_LINES)
    : targetUnits;
  const chars = Array.from(text);
  let splitIndex = 0;
  let units = 0;

  for (let index = 0; index < chars.length; index += 1) {
    const nextUnits = messageCharUnits(chars[index]);
    if (index > 0 && units + nextUnits > firstLineUnits) {
      break;
    }
    units += nextUnits;
    splitIndex = index + 1;
  }

  return [
    chars.slice(0, splitIndex).join(''),
    chars.slice(splitIndex).join(''),
  ].filter(Boolean);
}

export function messageLineUnits(text: string) {
  return Array.from(text).reduce((total, char) => total + messageCharUnits(char), 0);
}

export function messageCharUnits(char: string) {
  if (char.trim() === '') {
    return 1;
  }

  return /[ -~]/.test(char) ? 1 : 2;
}
