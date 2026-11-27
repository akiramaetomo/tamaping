import type { DotpingSettings } from '../sim/settings';
import { debugVisibleFromParams } from './debugPanel';

// Hidden diagnostic overrides read from the page URL, such as `?lu=10`,
// `?cl=split`, `?ov=js`, `?bc=sink`, `?entry=held`, `?pr=graphics`, `?rays=quad`, `?aa=on`, `?fx=trail` and `?debug=1`. Invalid values keep the defaults.
export function settingsFromUrl(defaults: DotpingSettings, search: string): DotpingSettings {
  const params = new URLSearchParams(search);
  const settings = { ...defaults };
  const lengthUnit = Number(params.get('rapierLengthUnit') ?? params.get('lu'));

  if (Number.isFinite(lengthUnit) && lengthUnit > 0) {
    settings.rapierLengthUnit = Math.min(lengthUnit, 1000);
  }

  const colliderLayout = params.get('colliderLayout') ?? params.get('cl');
  if (colliderLayout === 'single' || colliderLayout === 'split') {
    settings.colliderLayout = colliderLayout;
  }

  const overlapEngine = params.get('overlapEngine') ?? params.get('ov');
  if (overlapEngine === 'rapier' || overlapEngine === 'js') {
    settings.overlapEngine = overlapEngine;
  }

  const ballContact = params.get('overlapBallContact') ?? params.get('bc');
  if (ballContact === 'surface' || ballContact === 'sink' || ballContact === 'impact') {
    settings.overlapBallContact = ballContact;
  }

  const physicalEntryMode = params.get('physicalEntryMode') ?? params.get('entry');
  if (physicalEntryMode === 'rest' || physicalEntryMode === 'held') {
    settings.physicalEntryMode = physicalEntryMode;
  }

  const physicalTargetFps = Number(params.get('physicalTargetFps') ?? params.get('physfps'));
  if (Number.isFinite(physicalTargetFps) && physicalTargetFps >= 1 && physicalTargetFps <= 240) {
    settings.physicalTargetFps = physicalTargetFps;
  }

  const particleRenderer = params.get('particleRenderer') ?? params.get('pr');
  if (particleRenderer === 'sprite' || particleRenderer === 'graphics') {
    settings.particleRenderer = particleRenderer;
  }

  const antialias = params.get('canvasAntialias') ?? params.get('aa');
  if (antialias === 'on' || antialias === 'off') {
    settings.canvasAntialias = antialias === 'on';
  }

  const rayDrawing = params.get('rayDrawing') ?? params.get('rays');
  if (rayDrawing === 'mesh' || rayDrawing === 'quad') {
    settings.rayDrawing = rayDrawing;
  }

  // `?fx=rays,trail,afterglow` turns the PoC motion effects on for dots and ball;
  // `star`, `fish` or `sparkle` sets both shapes, and `shapeturn` turns
  // them to the direction of motion.
  const fx = (params.get('fx') ?? '').split(',');
  if (fx.includes('rays')) {
    settings.particleFxRays = true;
    settings.ballFxRays = true;
  }
  if (fx.includes('trail')) {
    settings.particleFxTrail = true;
    settings.ballFxTrail = true;
  }
  if (fx.includes('afterglow')) {
    settings.particleFxAfterglow = true;
    settings.ballFxAfterglow = true;
  }
  for (const shape of ['star', 'fish', 'sparkle'] as const) {
    if (fx.includes(shape)) {
      settings.particleShape = shape;
      settings.ballShape = shape;
    }
  }
  if (fx.includes('shapeturn')) {
    settings.particleShapeTurn = 'motion';
    settings.ballShapeTurn = 'motion';
  }
  // `spin`: both cards turn with the body's physical angle.
  if (fx.includes('spin')) {
    settings.particleShapeTurn = 'spin';
    settings.ballShapeTurn = 'spin';
  }
  // `weave` opens the trial scene for judging `Weave` by hand. Particles barely
  // move, and the gaps between them are wider than the ball.
  if (fx.includes('weave')) {
    Object.assign(settings, {
      ballWeave: true,
      ballShape: 'fish',
      ballShapeTurn: 'motion',
      controlBallRadius: 12,
      controlBallMass: 0.1,
      controlBallLinearDamping: 0,
      particleCount: 100,
      particleRadius: 4,
      particleMass: 100,
      particleLinearDamping: 100,
      collisionMode: 'collision-physical',
      gravityMode: 'antigravity',
      gravityStrength: 0.5,
      contactRestitution: 0.8,
      wallRestitution: 0.8,
    } satisfies Partial<DotpingSettings>);
  }

  if (debugVisibleFromParams(params)) {
    settings.debug = true;
  }

  return settings;
}
