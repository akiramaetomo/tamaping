import type { DotpingSettings } from '../sim/settings';
import { debugVisibleFromParams } from './debugPanel';

// Hidden diagnostic overrides read from the page URL, such as `?lu=10`,
// `?cl=split`, `?pr=graphics`, `?fx=trail` and `?debug=1`. Invalid values keep the defaults.
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

  const particleRenderer = params.get('particleRenderer') ?? params.get('pr');
  if (particleRenderer === 'sprite' || particleRenderer === 'graphics') {
    settings.particleRenderer = particleRenderer;
  }

  // `?fx=rays,trail,star` turns the PoC motion effects on for dots and ball.
  const fx = (params.get('fx') ?? '').split(',');
  if (fx.includes('rays')) {
    settings.particleFxRays = true;
    settings.ballFxRays = true;
  }
  if (fx.includes('trail')) {
    settings.particleFxTrail = true;
    settings.ballFxTrail = true;
  }
  if (fx.includes('star')) {
    settings.particleFxStar = true;
    settings.ballFxStar = true;
  }

  if (debugVisibleFromParams(params)) {
    settings.debug = true;
  }

  return settings;
}
