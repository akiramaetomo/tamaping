import type { DotpingSettings } from '../sim/settings';
import { debugVisibleFromParams } from './debugPanel';

// Hidden diagnostic overrides read from the page URL, such as `?lu=10`,
// `?cl=split`, `?pr=graphics` and `?debug=1`. Invalid values keep the defaults.
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

  if (debugVisibleFromParams(params)) {
    settings.debug = true;
  }

  return settings;
}
