export const DAMPING_UI_MAX = 1000;
const DAMPING_PHYSICS_MIN = 0.001;
const DAMPING_PHYSICS_MAX = 100;
export const LOG_UI_MAX = 1000;
export const WEIGHT_UI_MAX = LOG_UI_MAX;
const WEIGHT_MIN = 0.1;
const WEIGHT_MAX = 1000;
const PARTICLE_WEIGHT_MIN = 0.01;
const PARTICLE_WEIGHT_MAX = 100;
const GRAVITY_STRENGTH_MIN = 0.01;
const GRAVITY_STRENGTH_MAX = 100;
export const AUDIO_UI_MAX = LOG_UI_MAX;
const CONTROL_BALL_SIZE_MIN = 2;
const CONTROL_BALL_SIZE_MAX = 200;
const AUDIO_FREQUENCY_MIN = 30;
const AUDIO_FREQUENCY_MAX = 10000;
const AUDIO_SPREAD_MIN = 1;
const AUDIO_SPREAD_MAX = 2;
const AUDIO_DURATION_MIN = 1;
const AUDIO_DURATION_MAX = 1000;
const PARTICLE_BRIGHTNESS_RESPONSE_MIN = 1;
const PARTICLE_BRIGHTNESS_RESPONSE_MAX = 100;
export const PARTICLE_GLOW_VIVIDNESS_MAX = 2;

export function dampingFromSlider(sliderValue: number) {
  if (sliderValue <= 0) {
    return 0;
  }
  return logValueFromSlider(
    sliderValue,
    DAMPING_PHYSICS_MIN,
    DAMPING_PHYSICS_MAX,
  );
}

export function sliderFromDamping(damping: number) {
  if (damping <= 0) {
    return 0;
  }
  return sliderFromLogValue(damping, DAMPING_PHYSICS_MIN, DAMPING_PHYSICS_MAX);
}

export function formatDamping(damping: number) {
  if (damping <= 0) {
    return '0';
  }
  if (damping < 1) {
    return damping.toFixed(3);
  }
  if (damping < 10) {
    return damping.toFixed(2);
  }
  if (damping < 100) {
    return damping.toFixed(1);
  }
  return `${Math.round(damping)}`;
}

export function gravityStrengthFromSlider(sliderValue: number) {
  return logValueFromSlider(
    sliderValue,
    GRAVITY_STRENGTH_MIN,
    GRAVITY_STRENGTH_MAX,
  );
}

export function sliderFromGravityStrength(strength: number) {
  return sliderFromLogValue(strength, GRAVITY_STRENGTH_MIN, GRAVITY_STRENGTH_MAX);
}

export function formatGravityStrength(strength: number) {
  if (strength < 1) {
    return `${strength.toFixed(2)}G`;
  }
  if (strength < 10) {
    return `${strength.toFixed(2)}G`;
  }
  return `${strength.toFixed(1)}G`;
}

export function weightFromSlider(sliderValue: number) {
  const normalized = Math.max(0, Math.min(sliderValue / WEIGHT_UI_MAX, 1));
  const logMin = Math.log(WEIGHT_MIN);
  const logMax = Math.log(WEIGHT_MAX);
  return Math.exp(logMin + (logMax - logMin) * normalized);
}

export function sliderFromWeight(weight: number) {
  const clamped = Math.max(WEIGHT_MIN, Math.min(weight, WEIGHT_MAX));
  const logMin = Math.log(WEIGHT_MIN);
  const logMax = Math.log(WEIGHT_MAX);
  return Math.round(WEIGHT_UI_MAX * ((Math.log(clamped) - logMin) / (logMax - logMin)));
}

export function formatWeight(weight: number) {
  if (weight < 1) {
    return weight.toFixed(2);
  }
  if (weight < 10) {
    return weight.toFixed(1);
  }
  return `${Math.round(weight)}`;
}

export function particleWeightFromSlider(sliderValue: number) {
  return logValueFromSlider(sliderValue, PARTICLE_WEIGHT_MIN, PARTICLE_WEIGHT_MAX);
}

export function sliderFromParticleWeight(weight: number) {
  return sliderFromLogValue(weight, PARTICLE_WEIGHT_MIN, PARTICLE_WEIGHT_MAX);
}

export function controlBallSizeFromSlider(sliderValue: number) {
  const size = logValueFromSlider(
    sliderValue,
    CONTROL_BALL_SIZE_MIN,
    CONTROL_BALL_SIZE_MAX,
  );
  return Math.round(size);
}

export function sliderFromControlBallSize(size: number) {
  return sliderFromLogValue(size, CONTROL_BALL_SIZE_MIN, CONTROL_BALL_SIZE_MAX);
}

export function formatControlBallSize(size: number) {
  return `${Math.round(size)}`;
}

export function brightnessResponseFromSlider(sliderValue: number) {
  if (sliderValue <= 0) {
    return 0;
  }
  return logValueFromSlider(
    sliderValue,
    PARTICLE_BRIGHTNESS_RESPONSE_MIN,
    PARTICLE_BRIGHTNESS_RESPONSE_MAX,
  );
}

export function sliderFromBrightnessResponse(response: number) {
  if (response <= 0) {
    return 0;
  }
  return sliderFromLogValue(
    response,
    PARTICLE_BRIGHTNESS_RESPONSE_MIN,
    PARTICLE_BRIGHTNESS_RESPONSE_MAX,
  );
}

export function formatBrightnessResponse(response: number) {
  if (response <= 0) {
    return '0.00x';
  }
  if (response < 10) {
    return `${response.toFixed(2)}x`;
  }
  return `${response.toFixed(1)}x`;
}

export function formatVividness(vividness: number) {
  return `${vividness.toFixed(2)}x`;
}

export function audioFrequencyFromSlider(sliderValue: number) {
  return logValueFromSlider(sliderValue, AUDIO_FREQUENCY_MIN, AUDIO_FREQUENCY_MAX);
}

export function sliderFromAudioFrequency(frequencyHz: number) {
  return sliderFromLogValue(frequencyHz, AUDIO_FREQUENCY_MIN, AUDIO_FREQUENCY_MAX);
}

export function formatAudioFrequency(frequencyHz: number) {
  if (frequencyHz >= 9950) {
    return '10kHz';
  }
  if (frequencyHz >= 1000) {
    return `${(frequencyHz / 1000).toFixed(1)}kHz`;
  }
  return `${Math.round(frequencyHz)}Hz`;
}

export function audioSpreadFromSlider(sliderValue: number) {
  return logValueFromSlider(sliderValue, AUDIO_SPREAD_MIN, AUDIO_SPREAD_MAX);
}

export function sliderFromAudioSpread(spread: number) {
  return sliderFromLogValue(spread, AUDIO_SPREAD_MIN, AUDIO_SPREAD_MAX);
}

export function formatAudioSpread(spread: number) {
  return `${spread.toFixed(2)}x`;
}

export function audioDurationFromSlider(sliderValue: number) {
  return logValueFromSlider(sliderValue, AUDIO_DURATION_MIN, AUDIO_DURATION_MAX);
}

export function sliderFromAudioDuration(durationMs: number) {
  return sliderFromLogValue(durationMs, AUDIO_DURATION_MIN, AUDIO_DURATION_MAX);
}

export function formatAudioDuration(durationMs: number) {
  return `${Math.round(durationMs)}ms`;
}

export function logValueFromSlider(sliderValue: number, min: number, max: number) {
  const normalized = Math.max(0, Math.min(sliderValue / LOG_UI_MAX, 1));
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  return Math.exp(logMin + (logMax - logMin) * normalized);
}

export function sliderFromLogValue(value: number, min: number, max: number) {
  const clamped = Math.max(min, Math.min(value, max));
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  return Math.round(LOG_UI_MAX * ((Math.log(clamped) - logMin) / (logMax - logMin)));
}
