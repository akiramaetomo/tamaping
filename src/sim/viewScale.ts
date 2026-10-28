export type ViewScaleMode = '1:1' | 'fit';

export type Viewport = {
  width: number;
  height: number;
};

export type ViewScale = {
  mode: ViewScaleMode;
  scale: number;
  worldWidth: number;
  worldHeight: number;
};

// Presets without a recorded design screen were tuned on a phone in portrait.
export const DEFAULT_DESIGN_VIEWPORT: Viewport = { width: 360, height: 800 };
export const DEFAULT_VIEW_SCALE_MODE: ViewScaleMode = 'fit';
export const DESIGN_VIEWPORT_MIN = 100;
export const DESIGN_VIEWPORT_MAX = 10000;

const VIEW_SCALE_STORAGE_KEY = 'dotping.viewScale.v1';

// In `fit`, physics runs in a world with the design screen's area and the
// device's aspect ratio; rendering and input are scaled by `scale`.
export function computeViewScale(
  screen: Viewport,
  design: Viewport,
  mode: ViewScaleMode,
): ViewScale {
  const screenWidth = Math.max(screen.width, 1);
  const screenHeight = Math.max(screen.height, 1);
  if (mode !== 'fit') {
    return { mode: '1:1', scale: 1, worldWidth: screenWidth, worldHeight: screenHeight };
  }

  const designArea = Math.max(design.width, 1) * Math.max(design.height, 1);
  const scale = Math.sqrt((screenWidth * screenHeight) / designArea);
  return {
    mode: 'fit',
    scale,
    worldWidth: screenWidth / scale,
    worldHeight: screenHeight / scale,
  };
}

export function normalizeDesignViewport(value: unknown): Viewport | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<Viewport>;
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return {
    width: Math.round(Math.max(DESIGN_VIEWPORT_MIN, Math.min(width, DESIGN_VIEWPORT_MAX))),
    height: Math.round(Math.max(DESIGN_VIEWPORT_MIN, Math.min(height, DESIGN_VIEWPORT_MAX))),
  };
}

export function viewScaleLabel(view: ViewScale) {
  return view.mode === 'fit' ? `Fit ×${view.scale.toFixed(2)}` : '1:1';
}

export function viewScaleTitle(view: ViewScale, design: Viewport, screen: Viewport) {
  const screenText = `${Math.round(screen.width)}×${Math.round(screen.height)}`;
  if (view.mode !== 'fit') {
    return `1:1: screen px as is (${screenText}). Press for Fit.`;
  }

  return `Fit: design ${design.width}×${design.height} -> screen ${screenText} (×${view.scale.toFixed(2)}). Press for 1:1.`;
}

export function loadViewScaleMode(): ViewScaleMode {
  try {
    const stored = window.localStorage.getItem(VIEW_SCALE_STORAGE_KEY);
    return stored === '1:1' || stored === 'fit' ? stored : DEFAULT_VIEW_SCALE_MODE;
  } catch {
    return DEFAULT_VIEW_SCALE_MODE;
  }
}

export function saveViewScaleMode(mode: ViewScaleMode) {
  try {
    window.localStorage.setItem(VIEW_SCALE_STORAGE_KEY, mode);
  } catch {
    // The choice still applies for this session.
  }
}
