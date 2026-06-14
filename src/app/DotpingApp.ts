import { AudioEngine } from '../audio/audioEngine';
import { PixiRenderer } from '../render/pixiRenderer';
import { DotpingPhysicsWorld, type ImpactEvent, type StepMetrics } from '../sim/physicsWorld';
import {
  createCurrentPresetExport,
  createUserPresetExport,
  FACTORY_PRESETS,
  importUserPresets,
  loadUserPresets,
  parsePresetExport,
  presetFromSettings,
  saveUserPreset,
  USER_PRESET_COUNT,
  type PresetSettings,
  type UserPreset,
} from '../sim/presets';
import {
  DEFAULT_SETTINGS,
  type BallPalette,
  type CollisionMode,
  type ControlBallMode,
  type DotCombiMode,
  type DotpingSettings,
  type GravityMode,
  type ParticleGlowMode,
  type ParticlePalette,
} from '../sim/settings';

type RapierModule = any;

type PointerState = {
  active: boolean;
  pointerId: number | null;
  x: number;
  y: number;
};

type PinnableGroupId = 'mode' | 'ball' | 'particles' | 'interaction' | 'audio';

type PinnableSettingsGroup = {
  id: PinnableGroupId;
  title: string;
  element: HTMLDivElement;
  marker: Comment;
  pinButton: HTMLButtonElement;
};

const DAMPING_UI_MAX = 1000;
const DAMPING_PHYSICS_MAX = 3;
const DAMPING_CURVE_POWER = 2;
const WEIGHT_UI_MAX = 1000;
const WEIGHT_MIN = 0.1;
const WEIGHT_MAX = 200;
const AUDIO_UI_MAX = 1000;
const CONTROL_BALL_SIZE_MIN = 2;
const CONTROL_BALL_SIZE_MAX = 200;
const AUDIO_FREQUENCY_MIN = 100;
const AUDIO_FREQUENCY_MAX = 10000;
const AUDIO_SPREAD_MIN = 1;
const AUDIO_SPREAD_MAX = 2;
const AUDIO_DURATION_MIN = 1;
const AUDIO_DURATION_MAX = 1000;
const PARTICLE_BRIGHTNESS_RESPONSE_MIN = 1;
const PARTICLE_BRIGHTNESS_RESPONSE_MAX = 100;
const PARTICLE_GLOW_VIVIDNESS_MAX = 2;
const DEBUG_AVERAGE_ALPHA = 0.08;

export class DotpingApp {
  private readonly audio = new AudioEngine();
  private readonly pointer: PointerState = {
    active: false,
    pointerId: null,
    x: 0,
    y: 0,
  };

  private renderer: PixiRenderer | null = null;
  private physics: DotpingPhysicsWorld | null = null;
  private settings: DotpingSettings = { ...DEFAULT_SETTINGS };
  private lastTime = 0;
  private accumulator = 0;
  private frameHandle = 0;
  private fixedStepsLastFrame = 0;
  private averageStepMs = 0;
  private lastStepMetrics: StepMetrics = {
    durationMs: 0,
    lengthUnit: DEFAULT_SETTINGS.rapierLengthUnit,
    colliderLayout: DEFAULT_SETTINGS.colliderLayout,
    colliderCount: 0,
  };
  private lastDebugText = '';
  private debugEl: HTMLDivElement | null = null;
  private debugCopyButton: HTMLButtonElement | null = null;
  private debugCopyFeedbackTimer = 0;
  private debugCopyFeedbackButton: HTMLButtonElement | null = null;
  private hudEl: HTMLDivElement | null = null;
  private pinnedSettingsEl: HTMLDivElement | null = null;
  private settingsButton: HTMLButtonElement | null = null;
  private settingsHeightButton: HTMLButtonElement | null = null;
  private presetSelect: HTMLSelectElement | null = null;
  private saveSlotSelect: HTMLSelectElement | null = null;
  private saveNameInput: HTMLInputElement | null = null;
  private saveButton: HTMLButtonElement | null = null;
  private presetStatusEl: HTMLSpanElement | null = null;
  private userPresets: Array<UserPreset | null> = [];
  private pinnableGroups: PinnableSettingsGroup[] = [];
  private activePinnedGroupId: PinnableGroupId | null = null;
  private settingsMenuCompact = false;
  private syncUiFromSettings = () => {};

  constructor(
    private readonly root: HTMLElement,
    private readonly rapier: RapierModule,
  ) {}

  async start() {
    this.settings = settingsFromUrl(DEFAULT_SETTINGS);
    this.audio.setTuning(this.settings);
    this.userPresets = loadUserPresets();
    this.renderer = new PixiRenderer(this.root);
    await this.renderer.init();
    this.renderer.setParticlePalette(this.settings.particlePalette);
    this.renderer.setParticleBrightnessResponse(this.settings.particleBrightnessResponse);
    this.renderer.setParticleGlowMode(this.settings.particleGlowMode);
    this.renderer.setParticleGlowVividness(this.settings.particleGlowVividness);
    this.renderer.setParticleLeaderVisible(this.shouldShowParticleLeader());
    this.renderer.setBallPalette(this.settings.controlBallPalette);
    this.renderer.setBallRimEnabled(this.settings.controlBallRimEnabled);

    this.physics = new DotpingPhysicsWorld(
      this.rapier,
      this.renderer.width,
      this.renderer.height,
      this.settings,
    );
    this.physics.setDiagnosticsEnabled(this.settings.debug);

    this.buildUi();
    this.attachEvents();
    this.lastTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.tick);
  }

  dispose() {
    cancelAnimationFrame(this.frameHandle);
    this.renderer?.dispose();
  }

  private readonly tick = (time: number) => {
    const renderer = this.requireRenderer();
    const physics = this.requirePhysics();
    const deltaSeconds = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;
    this.accumulator += deltaSeconds;

    physics.setPointer(this.pointer.active, this.pointer.x, this.pointer.y);

    const fixedStep = 1 / 60;
    let impacts: ImpactEvent[] = [];
    let fixedSteps = 0;
    while (this.accumulator >= fixedStep) {
      const result = physics.step(fixedStep);
      impacts = result.impacts;
      this.recordStepMetrics(result.metrics);
      this.accumulator -= fixedStep;
      fixedSteps += 1;
    }
    this.fixedStepsLastFrame = fixedSteps;

    renderer.render(physics.snapshot());
    this.audio.playImpacts(impacts);
    this.updateDebug(deltaSeconds, impacts.length);

    this.frameHandle = requestAnimationFrame(this.tick);
  };

  private buildUi() {
    const settingsButton = document.createElement('button');
    settingsButton.className = 'settings-button';
    settingsButton.type = 'button';
    settingsButton.setAttribute('aria-controls', 'settings-panel');
    settingsButton.setAttribute('aria-expanded', 'false');
    settingsButton.setAttribute('aria-label', 'Settings');
    settingsButton.title = 'Settings';
    settingsButton.addEventListener('click', () => {
      this.setSettingsPanelOpen(!this.hudEl?.classList.contains('hud--open'));
    });
    this.settingsButton = settingsButton;
    this.root.appendChild(settingsButton);

    const pinnedSettings = document.createElement('div');
    pinnedSettings.className = 'pinned-settings';
    pinnedSettings.setAttribute('aria-label', 'Pinned settings');
    pinnedSettings.hidden = true;
    this.pinnedSettingsEl = pinnedSettings;
    this.root.appendChild(pinnedSettings);

    const panel = document.createElement('div');
    panel.className = 'hud';
    panel.id = 'settings-panel';
    panel.setAttribute('aria-label', 'Settings');
    this.hudEl = panel;

    const header = document.createElement('div');
    header.className = 'hud__header';

    const headerTitle = document.createElement('span');
    headerTitle.className = 'hud__header-title';
    headerTitle.textContent = 'Settings';

    const heightToggle = document.createElement('button');
    heightToggle.className = 'hud__icon-button hud__height-toggle';
    heightToggle.type = 'button';
    heightToggle.addEventListener('click', () => {
      this.settingsMenuCompact = !this.settingsMenuCompact;
      this.applySettingsMenuHeightMode();
    });
    this.settingsHeightButton = heightToggle;

    const close = document.createElement('button');
    close.className = 'hud__icon-button hud__close';
    close.type = 'button';
    close.textContent = 'x';
    close.title = 'Close settings';
    close.setAttribute('aria-label', 'Close settings');
    close.addEventListener('click', () => this.setSettingsPanelOpen(false));

    header.append(headerTitle, heightToggle, close);

    const presetGroup = this.createPresetControls();

    const mode = this.createTextSelect<CollisionMode>(
      'Particle Model',
      [
        ['independence-overlapping', 'Independent overlap'],
        ['collision-physical', 'Physical collision'],
      ],
      this.settings.collisionMode,
    );
    mode.input.addEventListener('change', () => {
      this.updateSettings({ collisionMode: mode.input.value as CollisionMode });
      syncLinkingOptions();
    });

    const color = this.createTextSelect<ParticlePalette>(
      'Color',
      [
        ['blue', 'Blue'],
        ['red', 'Red'],
        ['pastel', 'Pastel'],
        ['colorful', 'Colorful'],
        ['pink', 'Pink'],
      ],
      this.settings.particlePalette,
    );
    color.input.addEventListener('change', () => {
      this.updateSettings({ particlePalette: color.input.value as ParticlePalette }, false);
    });

    const particleBrightness = this.createRange(
      'Bright',
      0,
      AUDIO_UI_MAX,
      1,
      this.sliderFromBrightnessResponse(this.settings.particleBrightnessResponse),
    );
    particleBrightness.input.addEventListener('input', () => {
      const particleBrightnessResponse = this.brightnessResponseFromSlider(
        Number(particleBrightness.input.value),
      );
      particleBrightness.value.textContent = this.formatBrightnessResponse(
        particleBrightnessResponse,
      );
      this.updateSettings({ particleBrightnessResponse }, false);
    });
    particleBrightness.value.textContent = this.formatBrightnessResponse(
      this.settings.particleBrightnessResponse,
    );

    const particleGlow = this.createTextSelect<ParticleGlowMode>(
      'Glow',
      [
        ['gold', 'Gold'],
        ['white', 'White'],
        ['cyan', 'Cyan'],
        ['pink', 'Pink'],
        ['red', 'Red'],
        ['green', 'Green'],
        ['rainbow', 'Rainbow'],
      ],
      this.settings.particleGlowMode,
    );
    particleGlow.input.addEventListener('change', () => {
      this.updateSettings(
        { particleGlowMode: particleGlow.input.value as ParticleGlowMode },
        false,
      );
    });

    const particleVivid = this.createRange(
      'Vivid',
      0,
      PARTICLE_GLOW_VIVIDNESS_MAX,
      0.05,
      this.settings.particleGlowVividness,
    );
    particleVivid.input.addEventListener('input', () => {
      const particleGlowVividness = Number(particleVivid.input.value);
      particleVivid.value.textContent = this.formatVividness(particleGlowVividness);
      this.updateSettings({ particleGlowVividness }, false);
    });
    particleVivid.value.textContent = this.formatVividness(this.settings.particleGlowVividness);

    const combi = this.createTextSelect<DotCombiMode>(
      'Particle linking',
      [
        ['off', 'Off'],
        ['velocity', 'Velocity'],
      ],
      this.settings.dotCombiMode,
    );
    combi.input.addEventListener('change', () => {
      this.updateSettings({ dotCombiMode: combi.input.value as DotCombiMode });
      syncLinkingOptions();
    });

    const particleLeader = this.createToggle('No.1', this.settings.particleLeaderVisible);
    particleLeader.wrap.classList.add('hud__link-leader');
    particleLeader.input.addEventListener('change', () => {
      this.updateSettings({ particleLeaderVisible: particleLeader.input.checked }, false);
      syncLinkingOptions();
    });

    const linkFlash = document.createElement('button');
    linkFlash.className = 'hud__button hud__link-flash';
    linkFlash.type = 'button';
    linkFlash.textContent = 'Flash';
    linkFlash.addEventListener('click', () => {
      this.requirePhysics().arrangeFlashParticles();
    });

    const linkOptions = document.createElement('div');
    linkOptions.className = 'hud__link-options';
    linkOptions.append(particleLeader.wrap, linkFlash);

    const syncLinkingOptions = () => {
      const linkingEnabled = this.settings.dotCombiMode === 'velocity';
      particleLeader.input.disabled = !linkingEnabled;
      particleLeader.wrap.classList.toggle('is-disabled', !linkingEnabled);
      linkFlash.title = 'Arrange particles around the ball';
      linkFlash.setAttribute('aria-label', linkFlash.title);
    };

    const gravity = this.createTextSelect<GravityMode>(
      'Gravity',
      [
        ['none', 'Zero-G'],
        ['gravity', 'Gravity'],
        ['antigravity', 'Anti-gravity'],
      ],
      this.settings.gravityMode,
    );
    gravity.input.addEventListener('change', () => {
      this.updateSettings({ gravityMode: gravity.input.value as GravityMode });
    });

    const gravityStrength = this.createRange(
      'Gravity strength',
      0,
      3,
      0.05,
      this.settings.gravityStrength,
    );
    gravityStrength.input.addEventListener('input', () => {
      const strength = Number(gravityStrength.input.value);
      gravityStrength.value.textContent = strength.toFixed(2);
      this.updateSettings({ gravityStrength: strength });
    });
    gravityStrength.value.textContent = this.settings.gravityStrength.toFixed(2);

    const dots = this.createSelect(
      'Count',
      [1, 3, 10, 30, 100, 200, 500, 1000, 2000, 5000, 10000],
      this.settings.particleCount,
    );
    dots.input.addEventListener('change', () => {
      const particleCount = Number(dots.input.value);
      this.updateSettings({ particleCount });
    });

    const ball = this.createRange(
      'Size',
      0,
      AUDIO_UI_MAX,
      1,
      this.sliderFromControlBallSize(this.settings.controlBallRadius),
    );
    ball.input.addEventListener('input', () => {
      const controlBallRadius = this.controlBallSizeFromSlider(Number(ball.input.value));
      ball.value.textContent = this.formatControlBallSize(controlBallRadius);
      this.updateSettings({ controlBallRadius });
    });
    ball.value.textContent = this.formatControlBallSize(this.settings.controlBallRadius);

    const ballColor = this.createTextSelect<BallPalette>(
      'Color',
      [
        ['black-hole', 'Black hole'],
        ['calm-blue', 'Calm blue'],
        ['solar-yellow', 'Solar yellow'],
        ['red-core', 'Red core'],
        ['pink-glow', 'Pink glow'],
        ['white-star', 'White star'],
      ],
      this.settings.controlBallPalette,
    );
    ballColor.input.addEventListener('change', () => {
      this.updateSettings(
        { controlBallPalette: ballColor.input.value as BallPalette },
        false,
      );
    });

    const ballRim = this.createToggle('Rim', this.settings.controlBallRimEnabled);
    ballRim.input.addEventListener('change', () => {
      this.updateSettings({ controlBallRimEnabled: ballRim.input.checked }, false);
    });

    const ballMode = this.createTextSelect<ControlBallMode>(
      'Ball mode',
      [
        ['persistent', 'Persistent'],
        ['touch', 'Touch'],
      ],
      this.settings.controlBallMode,
    );
    ballMode.input.addEventListener('change', () => {
      this.updateSettings({ controlBallMode: ballMode.input.value as ControlBallMode });
    });

    const particle = this.createRange(
      'Size',
      2,
      50,
      1,
      this.settings.particleRadius,
    );
    particle.input.addEventListener('input', () => {
      const particleRadius = Number(particle.input.value);
      particle.value.textContent = `${particleRadius}`;
      this.updateSettings({ particleRadius });
    });

    const wallBounce = this.createRange(
      'Wall Bounce',
      0,
      1,
      0.01,
      this.settings.wallRestitution,
    );
    wallBounce.input.addEventListener('input', () => {
      const wallRestitution = Number(wallBounce.input.value);
      wallBounce.value.textContent = wallRestitution.toFixed(2);
      this.updateSettings({
        wallRestitution,
      });
    });
    wallBounce.value.textContent = this.settings.wallRestitution.toFixed(2);

    const contactBounce = this.createRange(
      'Contact Bounce',
      0,
      1,
      0.01,
      this.settings.contactRestitution,
    );
    contactBounce.input.addEventListener('input', () => {
      const contactRestitution = Number(contactBounce.input.value);
      contactBounce.value.textContent = contactRestitution.toFixed(2);
      this.updateSettings({
        contactRestitution,
      });
    });
    contactBounce.value.textContent = this.settings.contactRestitution.toFixed(2);

    const weight = this.createRange(
      'Weight',
      0,
      WEIGHT_UI_MAX,
      1,
      this.sliderFromWeight(this.settings.controlBallMass),
    );
    weight.input.addEventListener('input', () => {
      const controlBallMass = this.weightFromSlider(Number(weight.input.value));
      weight.value.textContent = this.formatWeight(controlBallMass);
      this.updateSettings({ controlBallMass });
    });
    weight.value.textContent = this.formatWeight(this.settings.controlBallMass);

    const ballDrag = this.createDampingRange('Damping', this.settings.controlBallLinearDamping);
    ballDrag.input.addEventListener('input', () => {
      const controlBallLinearDamping = this.dampingFromSlider(Number(ballDrag.input.value));
      ballDrag.value.textContent = this.formatDamping(controlBallLinearDamping);
      this.updateSettings({ controlBallLinearDamping });
    });

    const dotDrag = this.createDampingRange('Damping', this.settings.particleLinearDamping);
    dotDrag.input.addEventListener('input', () => {
      const particleLinearDamping = this.dampingFromSlider(Number(dotDrag.input.value));
      dotDrag.value.textContent = this.formatDamping(particleLinearDamping);
      this.updateSettings({ particleLinearDamping });
    });

    const friction = this.createRange(
      'Friction',
      0,
      0.25,
      0.005,
      this.settings.controlBallFriction,
    );
    friction.input.addEventListener('input', () => {
      const contactFriction = Number(friction.input.value);
      friction.value.textContent = contactFriction.toFixed(3);
      this.updateSettings({
        controlBallFriction: contactFriction,
        particleFriction: contactFriction,
      });
    });
    friction.value.textContent = this.settings.controlBallFriction.toFixed(3);

    const audioFrequency = this.createRange(
      'Pitch',
      0,
      AUDIO_UI_MAX,
      1,
      this.sliderFromAudioFrequency(this.settings.audioFrequencyHz),
    );
    audioFrequency.input.addEventListener('input', () => {
      const audioFrequencyHz = this.audioFrequencyFromSlider(Number(audioFrequency.input.value));
      audioFrequency.value.textContent = this.formatAudioFrequency(audioFrequencyHz);
      this.updateSettings({ audioFrequencyHz }, false);
    });
    audioFrequency.value.textContent = this.formatAudioFrequency(this.settings.audioFrequencyHz);

    const audioSpread = this.createRange(
      'Spread',
      0,
      AUDIO_UI_MAX,
      1,
      this.sliderFromAudioSpread(this.settings.audioFrequencySpread),
    );
    audioSpread.input.addEventListener('input', () => {
      const audioFrequencySpread = this.audioSpreadFromSlider(Number(audioSpread.input.value));
      audioSpread.value.textContent = this.formatAudioSpread(audioFrequencySpread);
      this.updateSettings({ audioFrequencySpread }, false);
    });
    audioSpread.value.textContent = this.formatAudioSpread(this.settings.audioFrequencySpread);

    const audioLength = this.createRange(
      'Sound Len.',
      0,
      AUDIO_UI_MAX,
      1,
      this.sliderFromAudioDuration(this.settings.audioDurationMs),
    );
    audioLength.input.addEventListener('input', () => {
      const audioDurationMs = this.audioDurationFromSlider(Number(audioLength.input.value));
      audioLength.value.textContent = this.formatAudioDuration(audioDurationMs);
      this.updateSettings({ audioDurationMs }, false);
    });
    audioLength.value.textContent = this.formatAudioDuration(this.settings.audioDurationMs);

    const sound = this.createToggle('Sound', this.settings.soundEnabled);
    sound.input.addEventListener('change', () => {
      this.updateSettings({ soundEnabled: sound.input.checked }, false, false);
      this.audio.setEnabled(sound.input.checked);
    });

    const debug = this.createToggle('Debug', this.settings.debug);
    debug.input.addEventListener('change', () => {
      this.updateSettings({ debug: debug.input.checked }, false, false);
      this.requirePhysics().setDiagnosticsEnabled(debug.input.checked);
    });

    const copyDebug = document.createElement('button');
    copyDebug.className = 'hud__button';
    copyDebug.type = 'button';
    copyDebug.textContent = 'Copy Debug';
    copyDebug.title = 'Copy current debug diagnostics';
    copyDebug.setAttribute('aria-label', 'Copy current debug diagnostics');
    copyDebug.addEventListener('click', () => {
      void this.copyDebugText(copyDebug);
    });

    const reset = document.createElement('button');
    reset.className = 'hud__button';
    reset.type = 'button';
    reset.textContent = 'Reset';
    reset.title = 'Reset scene with current settings';
    reset.setAttribute('aria-label', 'Reset scene with current settings');
    reset.addEventListener('click', () => this.requirePhysics().reset());

    const modePin = this.createPinButton('mode', 'Mode');
    const ballPin = this.createPinButton('ball', 'Ball');
    const particlesPin = this.createPinButton('particles', 'Particles');
    const interactionPin = this.createPinButton('interaction', 'Interaction');
    const audioPin = this.createPinButton('audio', 'Audio');

    const modeGroup = this.createSettingsGroup('Mode', 'mode', [
      mode.wrap,
      gravity.wrap,
      gravityStrength.wrap,
      combi.wrap,
      linkOptions,
    ], modePin);
    const ballGroup = this.createSettingsGroup('Ball', 'ball', [
      ball.wrap,
      ballColor.wrap,
      ballRim.wrap,
      ballMode.wrap,
      weight.wrap,
      ballDrag.wrap,
    ], ballPin);
    const dotsGroup = this.createSettingsGroup('Particles', 'particles', [
      dots.wrap,
      particle.wrap,
      dotDrag.wrap,
      color.wrap,
      particleBrightness.wrap,
      particleGlow.wrap,
      particleVivid.wrap,
    ], particlesPin);
    const interactionGroup = this.createSettingsGroup('Interaction', 'interaction', [
      wallBounce.wrap,
      contactBounce.wrap,
      friction.wrap,
    ], interactionPin);
    const audioGroup = this.createSettingsGroup('Audio', 'audio', [
      audioFrequency.wrap,
      audioSpread.wrap,
      audioLength.wrap,
    ], [sound.wrap, audioPin]);
    const utilityGroup = this.createSettingsGroup('Utility', 'utility', [
      debug.wrap,
      copyDebug,
      reset,
    ]);
    const modeMarker = this.registerPinnableGroup('mode', 'Mode', modeGroup, modePin);
    const ballMarker = this.registerPinnableGroup('ball', 'Ball', ballGroup, ballPin);
    const particlesMarker = this.registerPinnableGroup(
      'particles',
      'Particles',
      dotsGroup,
      particlesPin,
    );
    const interactionMarker = this.registerPinnableGroup(
      'interaction',
      'Interaction',
      interactionGroup,
      interactionPin,
    );
    const audioMarker = this.registerPinnableGroup('audio', 'Audio', audioGroup, audioPin);

    this.syncUiFromSettings = () => {
      mode.input.value = this.settings.collisionMode;
      color.input.value = this.settings.particlePalette;
      particleBrightness.input.value = `${
        this.sliderFromBrightnessResponse(this.settings.particleBrightnessResponse)
      }`;
      particleBrightness.value.textContent = this.formatBrightnessResponse(
        this.settings.particleBrightnessResponse,
      );
      particleGlow.input.value = this.settings.particleGlowMode;
      particleVivid.input.value = `${this.settings.particleGlowVividness}`;
      particleVivid.value.textContent = this.formatVividness(this.settings.particleGlowVividness);
      ballColor.input.value = this.settings.controlBallPalette;
      ballRim.input.checked = this.settings.controlBallRimEnabled;
      ballMode.input.value = this.settings.controlBallMode;
      combi.input.value = this.settings.dotCombiMode;
      particleLeader.input.checked = this.settings.particleLeaderVisible;
      gravity.input.value = this.settings.gravityMode;
      gravityStrength.input.value = `${this.settings.gravityStrength}`;
      gravityStrength.value.textContent = this.settings.gravityStrength.toFixed(2);
      dots.input.value = `${this.settings.particleCount}`;
      ball.input.value = `${this.sliderFromControlBallSize(this.settings.controlBallRadius)}`;
      ball.value.textContent = this.formatControlBallSize(this.settings.controlBallRadius);
      particle.input.value = `${this.settings.particleRadius}`;
      particle.value.textContent = `${this.settings.particleRadius}`;
      wallBounce.input.value = `${this.settings.wallRestitution}`;
      wallBounce.value.textContent = this.settings.wallRestitution.toFixed(2);
      contactBounce.input.value = `${this.settings.contactRestitution}`;
      contactBounce.value.textContent = this.settings.contactRestitution.toFixed(2);
      weight.input.value = `${this.sliderFromWeight(this.settings.controlBallMass)}`;
      weight.value.textContent = this.formatWeight(this.settings.controlBallMass);
      ballDrag.input.value = `${this.sliderFromDamping(this.settings.controlBallLinearDamping)}`;
      ballDrag.value.textContent = this.formatDamping(this.settings.controlBallLinearDamping);
      dotDrag.input.value = `${this.sliderFromDamping(this.settings.particleLinearDamping)}`;
      dotDrag.value.textContent = this.formatDamping(this.settings.particleLinearDamping);
      friction.input.value = `${this.settings.controlBallFriction}`;
      friction.value.textContent = this.settings.controlBallFriction.toFixed(3);
      audioFrequency.input.value = `${this.sliderFromAudioFrequency(this.settings.audioFrequencyHz)}`;
      audioFrequency.value.textContent = this.formatAudioFrequency(this.settings.audioFrequencyHz);
      audioSpread.input.value = `${this.sliderFromAudioSpread(this.settings.audioFrequencySpread)}`;
      audioSpread.value.textContent = this.formatAudioSpread(this.settings.audioFrequencySpread);
      audioLength.input.value = `${this.sliderFromAudioDuration(this.settings.audioDurationMs)}`;
      audioLength.value.textContent = this.formatAudioDuration(this.settings.audioDurationMs);
      sound.input.checked = this.settings.soundEnabled;
      debug.input.checked = this.settings.debug;
      syncLinkingOptions();
    };
    syncLinkingOptions();

    panel.append(
      header,
      presetGroup,
      modeMarker,
      modeGroup,
      ballMarker,
      ballGroup,
      particlesMarker,
      dotsGroup,
      interactionMarker,
      interactionGroup,
      audioMarker,
      audioGroup,
      utilityGroup,
    );
    this.root.appendChild(panel);
    this.applySettingsMenuHeightMode();

    this.debugEl = document.createElement('div');
    this.debugEl.className = 'debug';
    this.root.appendChild(this.debugEl);

    const debugCopyButton = document.createElement('button');
    debugCopyButton.className = 'debug-copy-button';
    debugCopyButton.type = 'button';
    debugCopyButton.textContent = 'Copy Debug';
    debugCopyButton.title = 'Copy current debug diagnostics';
    debugCopyButton.setAttribute('aria-label', 'Copy current debug diagnostics');
    debugCopyButton.hidden = true;
    debugCopyButton.addEventListener('click', () => {
      void this.copyDebugText(debugCopyButton);
    });
    this.debugCopyButton = debugCopyButton;
    this.root.appendChild(debugCopyButton);
  }

  private attachEvents() {
    const canvas = this.requireRenderer().canvas;

    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);
      this.audio.unlock();
      this.pointer.active = true;
      this.pointer.pointerId = event.pointerId;
      this.setPointerFromEvent(event);
    });

    canvas.addEventListener('pointermove', (event) => {
      if (this.pointer.pointerId === event.pointerId) {
        this.setPointerFromEvent(event);
      }
    });

    canvas.addEventListener('pointerup', (event) => this.releasePointer(event));
    canvas.addEventListener('pointercancel', (event) => this.releasePointer(event));

    window.addEventListener('resize', () => {
      const renderer = this.requireRenderer();
      renderer.resize();
      this.requirePhysics().resize(renderer.width, renderer.height);
      if (!window.matchMedia('(max-width: 760px)').matches) {
        this.setSettingsPanelOpen(false);
      }
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.setSettingsPanelOpen(false);
      }
    });
  }

  private setPointerFromEvent(event: PointerEvent) {
    const canvas = this.requireRenderer().canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = this.requireRenderer().width / rect.width;
    const scaleY = this.requireRenderer().height / rect.height;
    this.pointer.x = (event.clientX - rect.left) * scaleX;
    this.pointer.y = (event.clientY - rect.top) * scaleY;
  }

  private releasePointer(event: PointerEvent) {
    if (this.pointer.pointerId !== event.pointerId) {
      return;
    }

    this.setPointerFromEvent(event);
    this.pointer.active = false;
    this.pointer.pointerId = null;
  }

  private updateSettings(
    patch: Partial<DotpingSettings>,
    rebuild = true,
    markPresetCustom = true,
  ) {
    this.settings = { ...this.settings, ...patch };
    this.audio.setEnabled(this.settings.soundEnabled);
    this.audio.setTuning(this.settings);

    if (markPresetCustom) {
      this.markPresetCustom();
    }

    if (rebuild) {
      this.requirePhysics().updateSettings(this.settings);
    }
    this.renderer?.setParticlePalette(this.settings.particlePalette);
    this.renderer?.setParticleBrightnessResponse(this.settings.particleBrightnessResponse);
    this.renderer?.setParticleGlowMode(this.settings.particleGlowMode);
    this.renderer?.setParticleGlowVividness(this.settings.particleGlowVividness);
    this.renderer?.setParticleLeaderVisible(this.shouldShowParticleLeader());
    this.renderer?.setBallPalette(this.settings.controlBallPalette);
    this.renderer?.setBallRimEnabled(this.settings.controlBallRimEnabled);
  }

  private shouldShowParticleLeader() {
    return this.settings.particleLeaderVisible && this.settings.dotCombiMode === 'velocity';
  }

  private setSettingsPanelOpen(open: boolean) {
    this.hudEl?.classList.toggle('hud--open', open);
    this.settingsButton?.setAttribute('aria-expanded', `${open}`);
    this.applyPinnedSettingsPlacement();
  }

  private applySettingsMenuHeightMode() {
    const compact = this.settingsMenuCompact;
    this.hudEl?.classList.toggle('hud--compact', compact);
    if (!this.settingsHeightButton) {
      return;
    }
    const title = compact ? 'Use full settings height' : 'Use compact settings height';
    this.settingsHeightButton.title = title;
    this.settingsHeightButton.setAttribute('aria-label', title);
    this.settingsHeightButton.setAttribute('aria-pressed', `${compact}`);
  }

  private createPinButton(id: PinnableGroupId, title: string) {
    const button = document.createElement('button');
    button.className = 'hud__button hud__pin-button';
    button.type = 'button';
    button.textContent = 'Pin';
    button.title = `Pin ${title} settings to front`;
    button.setAttribute('aria-label', `Pin ${title} settings to front`);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => this.togglePinnedGroup(id));
    return button;
  }

  private registerPinnableGroup(
    id: PinnableGroupId,
    title: string,
    element: HTMLDivElement,
    pinButton: HTMLButtonElement,
  ) {
    const marker = document.createComment(`dotping ${id} settings group`);
    this.pinnableGroups.push({ id, title, element, marker, pinButton });
    return marker;
  }

  private togglePinnedGroup(id: PinnableGroupId) {
    this.activePinnedGroupId = this.activePinnedGroupId === id ? null : id;
    this.applyPinnedSettingsPlacement();
  }

  private applyPinnedSettingsPlacement() {
    const pinnedHost = this.pinnedSettingsEl;
    const settingsOpen = this.hudEl?.classList.contains('hud--open') ?? false;

    for (const group of this.pinnableGroups) {
      const parent = group.marker.parentNode;
      if (parent && group.marker.nextSibling !== group.element) {
        parent.insertBefore(group.element, group.marker.nextSibling);
      }
    }

    const pinnedGroup = this.pinnableGroups.find(
      (group) => group.id === this.activePinnedGroupId,
    );
    const showPinnedGroup = Boolean(pinnedHost && pinnedGroup && !settingsOpen);

    if (pinnedHost) {
      pinnedHost.hidden = !showPinnedGroup;
      if (showPinnedGroup && pinnedGroup) {
        pinnedHost.dataset.group = pinnedGroup.id;
        pinnedHost.appendChild(pinnedGroup.element);
      } else {
        delete pinnedHost.dataset.group;
      }
    }

    for (const group of this.pinnableGroups) {
      const isActive = group.id === this.activePinnedGroupId;
      group.pinButton.textContent = isActive ? 'Pinned' : 'Pin';
      group.pinButton.title = isActive
        ? `Unpin ${group.title} settings`
        : `Pin ${group.title} settings to front`;
      group.pinButton.setAttribute(
        'aria-label',
        isActive
          ? `Unpin ${group.title} settings`
          : `Pin ${group.title} settings to front`,
      );
      group.pinButton.setAttribute('aria-pressed', `${isActive}`);
      group.element.classList.toggle('hud__group--pinned', isActive && showPinnedGroup);
    }
  }

  private createPresetControls() {
    const wrap = document.createElement('div');
    wrap.className = 'hud__preset';

    const title = document.createElement('span');
    title.className = 'hud__preset-title';
    title.textContent = 'Preset';

    const presetSelect = document.createElement('select');
    presetSelect.className = 'hud__select hud__preset-select';
    presetSelect.setAttribute('aria-label', 'Preset');
    this.presetSelect = presetSelect;
    this.renderPresetOptions('custom');
    presetSelect.addEventListener('change', () => {
      this.applySelectedPreset(presetSelect.value);
    });

    const nameInput = document.createElement('input');
    nameInput.className = 'hud__preset-name';
    nameInput.type = 'text';
    nameInput.maxLength = 40;
    nameInput.placeholder = 'Preset name';
    nameInput.setAttribute('aria-label', 'Preset name');
    this.saveNameInput = nameInput;

    const saveLabel = document.createElement('span');
    saveLabel.className = 'hud__preset-save-label';
    saveLabel.textContent = 'Save to';

    const saveSlotSelect = document.createElement('select');
    saveSlotSelect.className = 'hud__select hud__preset-save-select';
    saveSlotSelect.setAttribute('aria-label', 'Save preset destination');
    this.saveSlotSelect = saveSlotSelect;
    const noDestination = document.createElement('option');
    noDestination.value = '';
    noDestination.textContent = 'Not selected';
    saveSlotSelect.appendChild(noDestination);
    for (let index = 0; index < USER_PRESET_COUNT; index += 1) {
      const option = document.createElement('option');
      option.value = `${index}`;
      option.textContent = userSlotLabel(index, this.userPresets[index]);
      saveSlotSelect.appendChild(option);
    }
    saveSlotSelect.value = '';
    saveSlotSelect.addEventListener('change', () => {
      this.syncSaveDestination();
    });

    const saveButton = document.createElement('button');
    saveButton.className = 'hud__button hud__preset-save';
    saveButton.type = 'button';
    saveButton.textContent = 'Save Current';
    saveButton.disabled = true;
    this.saveButton = saveButton;
    saveButton.addEventListener('click', () => {
      this.saveCurrentPreset();
    });

    const exportCurrent = document.createElement('button');
    exportCurrent.className = 'hud__button hud__preset-export';
    exportCurrent.type = 'button';
    exportCurrent.textContent = 'Export Current';
    exportCurrent.addEventListener('click', () => {
      this.exportCurrentPreset();
    });

    const exportUsers = document.createElement('button');
    exportUsers.className = 'hud__button hud__preset-export';
    exportUsers.type = 'button';
    exportUsers.textContent = 'Export Users';
    exportUsers.addEventListener('click', () => {
      this.exportUserPresets();
    });

    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = 'application/json,.json';
    importInput.hidden = true;
    importInput.addEventListener('change', () => {
      void this.importPresetFile(importInput);
    });

    const importButton = document.createElement('button');
    importButton.className = 'hud__button hud__preset-export';
    importButton.type = 'button';
    importButton.textContent = 'Import';
    importButton.addEventListener('click', () => {
      importInput.click();
    });

    const status = document.createElement('span');
    status.className = 'hud__preset-status';
    status.textContent = 'Ready';
    this.presetStatusEl = status;

    wrap.append(
      title,
      presetSelect,
      saveLabel,
      saveSlotSelect,
      nameInput,
      saveButton,
      exportCurrent,
      exportUsers,
      importButton,
      importInput,
      status,
    );
    return wrap;
  }

  private renderPresetOptions(selectedValue: string) {
    if (!this.presetSelect) {
      return;
    }

    this.presetSelect.replaceChildren();

    const custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = 'Custom';
    this.presetSelect.appendChild(custom);

    const factoryGroup = document.createElement('optgroup');
    factoryGroup.label = 'Factory Presets';
    for (const preset of FACTORY_PRESETS) {
      const option = document.createElement('option');
      option.value = `factory:${preset.id}`;
      option.textContent = preset.name;
      factoryGroup.appendChild(option);
    }
    this.presetSelect.appendChild(factoryGroup);

    const userGroup = document.createElement('optgroup');
    userGroup.label = 'User Presets';
    for (let index = 0; index < USER_PRESET_COUNT; index += 1) {
      const preset = this.userPresets[index];
      const option = document.createElement('option');
      option.value = `user:${index}`;
      option.textContent = preset ? userSlotLabel(index, preset) : `User ${index + 1} (empty)`;
      option.disabled = !preset;
      userGroup.appendChild(option);
    }
    this.presetSelect.appendChild(userGroup);
    this.presetSelect.value = selectedValue;
  }

  private applySelectedPreset(value: string) {
    if (value === 'custom') {
      this.setPresetStatus('Custom tuning');
      return;
    }

    const preset = this.presetSettingsForValue(value);
    if (!preset) {
      this.markPresetCustom('Empty slot');
      return;
    }

    this.applyPreset(preset, value);
  }

  private presetSettingsForValue(value: string): PresetSettings | null {
    if (value.startsWith('factory:')) {
      const id = value.slice('factory:'.length);
      return FACTORY_PRESETS.find((preset) => preset.id === id)?.settings ?? null;
    }

    if (value.startsWith('user:')) {
      const index = Number(value.slice('user:'.length));
      return this.userPresets[index]?.settings ?? null;
    }

    return null;
  }

  private applyPreset(preset: PresetSettings, selectedValue: string) {
    this.updateSettings(preset, true, false);
    this.syncUiFromSettings();
    if (this.presetSelect) {
      this.presetSelect.value = selectedValue;
    }
    this.setPresetStatus('Applied');
  }

  private saveCurrentPreset() {
    const index = Number(this.saveSlotSelect?.value);
    if (!Number.isInteger(index) || index < 0 || index >= USER_PRESET_COUNT) {
      this.setPresetStatus('Choose save slot');
      return;
    }

    this.userPresets = saveUserPreset(
      this.userPresets,
      index,
      this.saveNameInput?.value ?? '',
      presetFromSettings(this.settings),
    );
    const selectedValue = `user:${index}`;
    this.renderPresetOptions(selectedValue);
    this.renderSaveDestinationOptions('');
    this.setPresetStatus(`Saved User ${index + 1}`);
  }

  private syncSaveDestination() {
    const index = Number(this.saveSlotSelect?.value);
    const hasDestination = Number.isInteger(index) && index >= 0 && index < USER_PRESET_COUNT;

    if (this.saveButton) {
      this.saveButton.disabled = !hasDestination;
    }

    if (!this.saveNameInput) {
      return;
    }

    if (!hasDestination) {
      this.saveNameInput.value = '';
      return;
    }

    this.saveNameInput.value = this.userPresets[index]?.name ?? `User ${index + 1}`;
  }

  private renderSaveDestinationOptions(selectedValue: string) {
    if (!this.saveSlotSelect) {
      return;
    }

    this.saveSlotSelect.replaceChildren();
    const noDestination = document.createElement('option');
    noDestination.value = '';
    noDestination.textContent = 'Not selected';
    this.saveSlotSelect.appendChild(noDestination);

    for (let index = 0; index < USER_PRESET_COUNT; index += 1) {
      const option = document.createElement('option');
      option.value = `${index}`;
      option.textContent = userSlotLabel(index, this.userPresets[index]);
      this.saveSlotSelect.appendChild(option);
    }

    this.saveSlotSelect.value = selectedValue;
    this.syncSaveDestination();
  }

  private exportCurrentPreset() {
    const exportFile = createCurrentPresetExport('Current', this.settings);
    this.downloadPresetJson(exportFile, 'dotping-current-preset.json');
    this.setPresetStatus('Exported current');
  }

  private exportUserPresets() {
    const savedCount = this.userPresets.filter(Boolean).length;
    if (savedCount <= 0) {
      this.setPresetStatus('No user presets');
      return;
    }

    const exportFile = createUserPresetExport(this.userPresets);
    this.downloadPresetJson(exportFile, 'dotping-user-presets.json');
    this.setPresetStatus(`Exported ${savedCount}`);
  }

  private async importPresetFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    try {
      const incoming = parsePresetExport(await file.text());
      if (incoming.length <= 0) {
        this.setPresetStatus('No presets found');
        return;
      }

      const emptyCount = this.userPresets.filter((preset) => !preset).length;
      const overwriteStart = this.importOverwriteStart(incoming.length, emptyCount);
      if (incoming.length > emptyCount && overwriteStart === null) {
        this.setPresetStatus('Select overwrite slot');
        return;
      }

      const result = importUserPresets(this.userPresets, incoming, overwriteStart);
      this.userPresets = result.presets;
      this.renderPresetOptions('custom');
      this.renderSaveDestinationOptions('');
      this.setPresetStatus(`Imported ${result.imported}`);
    } catch {
      this.setPresetStatus('Import failed');
    }
  }

  private importOverwriteStart(importCount: number, emptyCount: number) {
    if (importCount <= emptyCount) {
      return null;
    }

    const selected = Number(this.saveSlotSelect?.value);
    if (!Number.isInteger(selected) || selected < 0 || selected >= USER_PRESET_COUNT) {
      return null;
    }
    return selected;
  }

  private downloadPresetJson(exportFile: unknown, filename: string) {
    const blob = new Blob([`${JSON.stringify(exportFile, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  private markPresetCustom(status = 'Custom') {
    if (this.presetSelect) {
      this.presetSelect.value = 'custom';
    }
    this.setPresetStatus(status);
  }

  private setPresetStatus(status: string) {
    if (this.presetStatusEl) {
      this.presetStatusEl.textContent = status;
    }
  }

  private createRange(
    labelText: string,
    min: number,
    max: number,
    step: number,
    initial: number,
  ) {
    const wrap = document.createElement('label');
    wrap.className = 'hud__control';

    const label = document.createElement('span');
    label.textContent = labelText;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = `${min}`;
    input.max = `${max}`;
    input.step = `${step}`;
    input.value = `${initial}`;

    const value = document.createElement('span');
    value.className = 'hud__value';
    value.textContent = `${initial}`;

    wrap.append(label, input, value);
    return { wrap, input, value };
  }

  private createSettingsGroup(
    titleText: string,
    accent: string,
    controls: HTMLElement[],
    titleAction?: HTMLElement | HTMLElement[],
  ): HTMLDivElement {
    const group = document.createElement('div');
    group.className = `hud__group hud__group--${accent}`;

    const header = document.createElement('div');
    header.className = 'hud__group-header';

    const title = document.createElement('span');
    title.className = 'hud__group-title';
    title.textContent = titleText;

    header.append(title);
    if (titleAction) {
      const actionWrap = document.createElement('div');
      actionWrap.className = 'hud__group-actions';
      const actions = Array.isArray(titleAction) ? titleAction : [titleAction];
      for (const action of actions) {
        action.classList.add('hud__group-title-action');
        actionWrap.append(action);
      }
      header.append(actionWrap);
    }

    group.append(header, ...controls);
    return group;
  }

  private createDampingRange(labelText: string, initial: number) {
    const control = this.createRange(
      labelText,
      0,
      DAMPING_UI_MAX,
      1,
      this.sliderFromDamping(initial),
    );
    control.value.textContent = this.formatDamping(initial);
    return control;
  }

  private dampingFromSlider(sliderValue: number) {
    const normalized = Math.max(0, Math.min(sliderValue / DAMPING_UI_MAX, 1));
    return DAMPING_PHYSICS_MAX * normalized ** DAMPING_CURVE_POWER;
  }

  private sliderFromDamping(damping: number) {
    const normalized = Math.max(0, Math.min(damping / DAMPING_PHYSICS_MAX, 1));
    return Math.round(DAMPING_UI_MAX * normalized ** (1 / DAMPING_CURVE_POWER));
  }

  private formatDamping(damping: number) {
    return damping < 1 ? damping.toFixed(3) : damping.toFixed(2);
  }

  private weightFromSlider(sliderValue: number) {
    const normalized = Math.max(0, Math.min(sliderValue / WEIGHT_UI_MAX, 1));
    const logMin = Math.log(WEIGHT_MIN);
    const logMax = Math.log(WEIGHT_MAX);
    return Math.exp(logMin + (logMax - logMin) * normalized);
  }

  private sliderFromWeight(weight: number) {
    const clamped = Math.max(WEIGHT_MIN, Math.min(weight, WEIGHT_MAX));
    const logMin = Math.log(WEIGHT_MIN);
    const logMax = Math.log(WEIGHT_MAX);
    return Math.round(WEIGHT_UI_MAX * ((Math.log(clamped) - logMin) / (logMax - logMin)));
  }

  private formatWeight(weight: number) {
    if (weight < 1) {
      return weight.toFixed(2);
    }
    if (weight < 10) {
      return weight.toFixed(1);
    }
    return `${Math.round(weight)}`;
  }

  private controlBallSizeFromSlider(sliderValue: number) {
    const size = this.logValueFromSlider(
      sliderValue,
      CONTROL_BALL_SIZE_MIN,
      CONTROL_BALL_SIZE_MAX,
    );
    return Math.round(size);
  }

  private sliderFromControlBallSize(size: number) {
    return this.sliderFromLogValue(size, CONTROL_BALL_SIZE_MIN, CONTROL_BALL_SIZE_MAX);
  }

  private formatControlBallSize(size: number) {
    return `${Math.round(size)}`;
  }

  private brightnessResponseFromSlider(sliderValue: number) {
    if (sliderValue <= 0) {
      return 0;
    }
    return this.logValueFromSlider(
      sliderValue,
      PARTICLE_BRIGHTNESS_RESPONSE_MIN,
      PARTICLE_BRIGHTNESS_RESPONSE_MAX,
    );
  }

  private sliderFromBrightnessResponse(response: number) {
    if (response <= 0) {
      return 0;
    }
    return this.sliderFromLogValue(
      response,
      PARTICLE_BRIGHTNESS_RESPONSE_MIN,
      PARTICLE_BRIGHTNESS_RESPONSE_MAX,
    );
  }

  private formatBrightnessResponse(response: number) {
    if (response <= 0) {
      return '0.00x';
    }
    if (response < 10) {
      return `${response.toFixed(2)}x`;
    }
    return `${response.toFixed(1)}x`;
  }

  private formatVividness(vividness: number) {
    return `${vividness.toFixed(2)}x`;
  }

  private audioFrequencyFromSlider(sliderValue: number) {
    return this.logValueFromSlider(sliderValue, AUDIO_FREQUENCY_MIN, AUDIO_FREQUENCY_MAX);
  }

  private sliderFromAudioFrequency(frequencyHz: number) {
    return this.sliderFromLogValue(frequencyHz, AUDIO_FREQUENCY_MIN, AUDIO_FREQUENCY_MAX);
  }

  private formatAudioFrequency(frequencyHz: number) {
    if (frequencyHz >= 9950) {
      return '10kHz';
    }
    if (frequencyHz >= 1000) {
      return `${(frequencyHz / 1000).toFixed(1)}kHz`;
    }
    return `${Math.round(frequencyHz)}Hz`;
  }

  private audioSpreadFromSlider(sliderValue: number) {
    return this.logValueFromSlider(sliderValue, AUDIO_SPREAD_MIN, AUDIO_SPREAD_MAX);
  }

  private sliderFromAudioSpread(spread: number) {
    return this.sliderFromLogValue(spread, AUDIO_SPREAD_MIN, AUDIO_SPREAD_MAX);
  }

  private formatAudioSpread(spread: number) {
    return `${spread.toFixed(2)}x`;
  }

  private audioDurationFromSlider(sliderValue: number) {
    return this.logValueFromSlider(sliderValue, AUDIO_DURATION_MIN, AUDIO_DURATION_MAX);
  }

  private sliderFromAudioDuration(durationMs: number) {
    return this.sliderFromLogValue(durationMs, AUDIO_DURATION_MIN, AUDIO_DURATION_MAX);
  }

  private formatAudioDuration(durationMs: number) {
    return `${Math.round(durationMs)}ms`;
  }

  private logValueFromSlider(sliderValue: number, min: number, max: number) {
    const normalized = Math.max(0, Math.min(sliderValue / AUDIO_UI_MAX, 1));
    const logMin = Math.log(min);
    const logMax = Math.log(max);
    return Math.exp(logMin + (logMax - logMin) * normalized);
  }

  private sliderFromLogValue(value: number, min: number, max: number) {
    const clamped = Math.max(min, Math.min(value, max));
    const logMin = Math.log(min);
    const logMax = Math.log(max);
    return Math.round(AUDIO_UI_MAX * ((Math.log(clamped) - logMin) / (logMax - logMin)));
  }

  private createSelect(labelText: string, values: number[], initial: number) {
    const wrap = document.createElement('label');
    wrap.className = 'hud__control hud__control--select';

    const label = document.createElement('span');
    label.textContent = labelText;

    const input = document.createElement('select');
    input.className = 'hud__select';
    for (const value of values) {
      const option = document.createElement('option');
      option.value = `${value}`;
      option.textContent = `${value}`;
      input.appendChild(option);
    }
    input.value = `${initial}`;

    wrap.append(label, input);
    return { wrap, input };
  }

  private createTextSelect<T extends string>(
    labelText: string,
    values: Array<[T, string]>,
    initial: T,
  ) {
    const wrap = document.createElement('label');
    wrap.className = 'hud__control hud__control--select';

    const label = document.createElement('span');
    label.textContent = labelText;

    const input = document.createElement('select');
    input.className = 'hud__select';
    for (const [value, text] of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      input.appendChild(option);
    }
    input.value = initial;

    wrap.append(label, input);
    return { wrap, input };
  }

  private createToggle(labelText: string, initial: boolean) {
    const wrap = document.createElement('label');
    wrap.className = 'hud__toggle';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = initial;

    const label = document.createElement('span');
    label.textContent = labelText;

    wrap.append(input, label);
    return { wrap, input };
  }

  private updateDebug(deltaSeconds: number, impactCount: number) {
    if (!this.debugEl) {
      return;
    }

    this.debugEl.hidden = !this.settings.debug;
    if (this.debugCopyButton) {
      this.debugCopyButton.hidden = !this.settings.debug;
    }
    if (!this.settings.debug) {
      return;
    }

    const physics = this.requirePhysics();
    const particleDiagnostics = physics.getParticleDiagnostics();
    this.lastDebugText = [
      'dotping_debug',
      `fps=${Math.round(1 / Math.max(deltaSeconds, 0.001))}`,
      `particle_model=${particleModelLabel(this.settings.collisionMode)}`,
      `gravity=${gravityLabel(this.settings.gravityMode)}`,
      `dots=${physics.particleCount}`,
      `visible_dots=${particleDiagnostics.visible}`,
      `out_of_bounds_dots=${particleDiagnostics.outOfBounds}`,
      `nonfinite_dots=${particleDiagnostics.nonFinite}`,
      `recovered_dots_last_step=${particleDiagnostics.recoveredLastStep}`,
      `max_dot_speed=${particleDiagnostics.maxSpeed.toFixed(1)}`,
      `max_out_distance=${particleDiagnostics.maxOutOfBoundsDistance.toFixed(1)}`,
      `fixed_steps=${this.fixedStepsLastFrame}`,
      `ms_per_step=${this.averageStepMs.toFixed(2)}`,
      `rapier_length_unit=${this.lastStepMetrics.lengthUnit}`,
      `collider_layout=${this.lastStepMetrics.colliderLayout}`,
      `colliders=${this.lastStepMetrics.colliderCount}`,
      `hits=${impactCount}`,
      `voices=${this.audio.activeVoiceCount}`,
    ].join('\n');
    this.debugEl.textContent = this.lastDebugText;
  }

  private async copyDebugText(sourceButton?: HTMLButtonElement) {
    const text = this.lastDebugText || 'dotping_debug\nstatus=not_available';
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (!copyTextWithFallback(text)) {
        throw new Error('Clipboard API unavailable');
      }
      this.setPresetStatus('Copied debug');
      this.showDebugCopyFeedback(sourceButton);
    } catch {
      if (copyTextWithFallback(text)) {
        this.setPresetStatus('Copied debug');
        this.showDebugCopyFeedback(sourceButton);
        return;
      }

      this.setPresetStatus('Copy failed');
    }
  }

  private showDebugCopyFeedback(sourceButton?: HTMLButtonElement) {
    if (!sourceButton) {
      return;
    }

    window.clearTimeout(this.debugCopyFeedbackTimer);
    if (this.debugCopyFeedbackButton && this.debugCopyFeedbackButton !== sourceButton) {
      this.resetDebugCopyFeedback(this.debugCopyFeedbackButton);
    }

    const originalText = sourceButton.dataset.defaultText || sourceButton.textContent || 'Copy Debug';
    sourceButton.dataset.defaultText = originalText;
    sourceButton.textContent = 'Copied';
    sourceButton.classList.add('is-confirmed');
    this.debugCopyFeedbackButton = sourceButton;
    this.debugCopyFeedbackTimer = window.setTimeout(() => {
      this.resetDebugCopyFeedback(sourceButton);
    }, 1200);
  }

  private resetDebugCopyFeedback(button: HTMLButtonElement) {
    button.textContent = button.dataset.defaultText || 'Copy Debug';
    button.classList.remove('is-confirmed');
    if (this.debugCopyFeedbackButton === button) {
      this.debugCopyFeedbackButton = null;
    }
  }

  private recordStepMetrics(metrics: StepMetrics) {
    this.lastStepMetrics = metrics;
    this.averageStepMs =
      this.averageStepMs <= 0
        ? metrics.durationMs
        : this.averageStepMs * (1 - DEBUG_AVERAGE_ALPHA) + metrics.durationMs * DEBUG_AVERAGE_ALPHA;
  }

  private requireRenderer() {
    if (!this.renderer) {
      throw new Error('Renderer is not initialized');
    }
    return this.renderer;
  }

  private requirePhysics() {
    if (!this.physics) {
      throw new Error('Physics is not initialized');
    }
    return this.physics;
  }
}

function particleModelLabel(mode: CollisionMode) {
  return mode === 'collision-physical'
    ? 'Physical collision'
    : 'Independent overlap';
}

function gravityLabel(mode: GravityMode) {
  switch (mode) {
    case 'gravity':
      return 'Gravity';
    case 'antigravity':
      return 'Anti-gravity';
    case 'none':
    default:
      return 'Zero-G';
  }
}

function userSlotLabel(index: number, preset: UserPreset | null | undefined) {
  const slot = `User ${String(index + 1).padStart(2, '0')}`;
  return preset ? `${slot}: ${preset.name}` : slot;
}

function settingsFromUrl(defaults: DotpingSettings): DotpingSettings {
  const params = new URLSearchParams(window.location.search);
  const settings = { ...defaults };
  const lengthUnit = Number(params.get('rapierLengthUnit') ?? params.get('lu'));

  if (Number.isFinite(lengthUnit) && lengthUnit > 0) {
    settings.rapierLengthUnit = Math.min(lengthUnit, 1000);
  }

  const colliderLayout = params.get('colliderLayout') ?? params.get('cl');
  if (colliderLayout === 'single' || colliderLayout === 'split') {
    settings.colliderLayout = colliderLayout;
  }

  return settings;
}

function copyTextWithFallback(text: string) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
