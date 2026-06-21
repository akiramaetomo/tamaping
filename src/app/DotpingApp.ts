import { AudioEngine } from '../audio/audioEngine';
import { PixiRenderer } from '../render/pixiRenderer';
import {
  DotpingPhysicsWorld,
  type ImpactEvent,
  type ParticleFormationTarget,
  type StepMetrics,
} from '../sim/physicsWorld';
import {
  createCurrentPresetExport,
  createUserPresetExport,
  deleteUserPreset,
  FACTORY_PRESETS,
  importUserPresets,
  loadUserPresets,
  parsePresetExport,
  presetFromSettings,
  saveUserPreset,
  type FactoryPresetInitialFormation,
  type PresetPinnedGroup,
  type PresetSettings,
  type UserPreset,
} from '../sim/presets';
import {
  DEFAULT_SETTINGS,
  type AudioWaveform,
  type BallPalette,
  type CollisionMode,
  type ControlBallMode,
  type DotCombiMode,
  type DotpingSettings,
  type GravityMode,
  type ParticleGlowMode,
  type ParticlePalette,
} from '../sim/settings';
import {
  createPinButton,
  createRange,
  createSelect,
  createSettingsGroup,
  createTextSelect,
  createToggle,
  type RangeControl,
} from './controls';
import {
  DEBUG_COPY_FALLBACK_TEXT,
  DEFAULT_DEBUG_PROFILE,
  copyTextWithFallback,
  createAudioDebugLines,
  createPhysicsDebugLines as createPhysicsDebugTextLines,
  debugProfileFromLocation,
  type DebugProfile,
} from './debugPanel';
import {
  MESSAGE_FORMATION_DESKTOP_FONT_RATIO,
  MESSAGE_FORMATION_LINE_HEIGHT_RATIO,
  MESSAGE_FORMATION_MIN_FONT_SIZE,
  MESSAGE_FORMATION_MOBILE_FONT_RATIO,
  MESSAGE_FORMATION_SAMPLE_ALPHA,
  createDotFontMessagePoints,
  createMessageTargetsFromPoints,
  effectivePresetMessageText,
  messageBlockHeightRatio,
  messageLines,
} from './messageFormation';
import {
  PARTICLE_LOAD_VALUE_CLASSES,
  estimateParticleLoad,
  particleLoadTitle,
} from './particleLoad';
import { PresetPanel } from './presetPanel';
import {
  AUDIO_UI_MAX,
  DAMPING_UI_MAX,
  LOG_UI_MAX,
  PARTICLE_GLOW_VIVIDNESS_MAX,
  WEIGHT_UI_MAX,
  audioDurationFromSlider,
  audioFrequencyFromSlider,
  audioSpreadFromSlider,
  brightnessResponseFromSlider,
  controlBallSizeFromSlider,
  dampingFromSlider,
  formatAudioDuration,
  formatAudioFrequency,
  formatAudioSpread,
  formatBrightnessResponse,
  formatControlBallSize,
  formatDamping,
  formatGravityStrength,
  formatVividness,
  formatWeight,
  gravityStrengthFromSlider,
  particleWeightFromSlider,
  sliderFromAudioDuration,
  sliderFromAudioFrequency,
  sliderFromAudioSpread,
  sliderFromBrightnessResponse,
  sliderFromControlBallSize,
  sliderFromDamping,
  sliderFromGravityStrength,
  sliderFromParticleWeight,
  sliderFromWeight,
  weightFromSlider,
} from './settingScales';

type RapierModule = any;

type PointerState = {
  active: boolean;
  pointerId: number | null;
  x: number;
  y: number;
};

type PinnableGroupId = Exclude<PresetPinnedGroup, null>;
type AudioPanelId = 'ball' | 'particle';
type SettingsMenuSize = 'small' | 'medium' | 'large';

type PinnableSettingsGroup = {
  id: PinnableGroupId;
  title: string;
  element: HTMLDivElement;
  marker: Comment;
  pinButton: HTMLButtonElement;
};

const DEBUG_AVERAGE_ALPHA = 0.08;
const PARTICLE_RADIUS_MAX = 100;
const PARTICLE_RIM_WIDTH_MIN = 5;
const PARTICLE_RIM_WIDTH_MAX = 100;
const SETTINGS_MENU_SIZE_ORDER: readonly SettingsMenuSize[] = ['small', 'medium', 'large'];
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
  private presetPanel: PresetPanel | null = null;
  private userPresets: Array<UserPreset | null> = [];
  private pinnableGroups: PinnableSettingsGroup[] = [];
  private activePinnedGroupId: PinnableGroupId | null = null;
  private activePresetValue = 'custom';
  private activePresetSnapshot: PresetSettings | null = null;
  private settingsMenuSize: SettingsMenuSize = 'small';
  private debugProfile: DebugProfile = DEFAULT_DEBUG_PROFILE;
  private activeAudioPanel: AudioPanelId = 'ball';
  private particleSizeValueEl: HTMLSpanElement | null = null;
  private syncUiFromSettings = () => {};

  constructor(
    private readonly root: HTMLElement,
    private readonly rapier: RapierModule,
  ) {}

  async start() {
    this.settings = settingsFromUrl(DEFAULT_SETTINGS);
    this.debugProfile = debugProfileFromLocation(window.location.search);
    this.audio.setTuning(this.settings);
    this.userPresets = loadUserPresets();
    this.renderer = new PixiRenderer(this.root);
    await this.renderer.init();
    this.renderer.setParticlePalette(this.settings.particlePalette);
    this.renderer.setParticleRimWidth(this.settings.particleRimWidth);
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
    this.restartFrameLoop();
  }

  dispose() {
    if (this.frameHandle !== 0) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
    }
    this.renderer?.dispose();
  }

  private readonly tick = (time: number) => {
    this.frameHandle = 0;
    try {
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
    } catch (error) {
      this.pauseFrameLoop(error);
      return;
    }

    this.frameHandle = requestAnimationFrame(this.tick);
  };

  private restartFrameLoop() {
    if (this.frameHandle !== 0) {
      cancelAnimationFrame(this.frameHandle);
    }
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.tick);
  }

  private pauseFrameLoop(error: unknown) {
    console.error('Dotping frame loop paused', error);
    this.accumulator = 0;
    this.fixedStepsLastFrame = 0;
    this.setPresetStatus('Scene paused - press Reset');
  }

  private resetScene() {
    const pointerId = this.pointer.pointerId;
    if (pointerId !== null && this.renderer?.canvas.hasPointerCapture(pointerId)) {
      this.renderer.canvas.releasePointerCapture(pointerId);
    }
    this.pointer.active = false;
    this.pointer.pointerId = null;
    const physics = this.requirePhysics();
    physics.reset();
    physics.setPointer(false, this.pointer.x, this.pointer.y);
    this.restartFrameLoop();
    this.setPresetStatus('Scene reset');
  }

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
      this.settingsMenuSize = nextSettingsMenuSize(this.settingsMenuSize);
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

    const mode = createTextSelect<CollisionMode>(
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

    const color = createTextSelect<ParticlePalette>(
      'Color',
      [
        ['blue', 'Blue'],
        ['green', 'Green'],
        ['yellow', 'Yellow'],
        ['red', 'Red'],
        ['pink', 'Pink'],
        ['orange', 'Orange'],
        ['white', 'White'],
        ['pastel', 'Pastel'],
        ['colorful', 'Colorful'],
      ],
      this.settings.particlePalette,
    );
    color.input.addEventListener('change', () => {
      this.updateSettings({ particlePalette: color.input.value as ParticlePalette }, false);
    });
    color.wrap.classList.add('hud__control--visual');

    const particleRimWidth = createRange(
      'Rim %',
      PARTICLE_RIM_WIDTH_MIN,
      PARTICLE_RIM_WIDTH_MAX,
      5,
      this.settings.particleRimWidth,
    );
    particleRimWidth.input.addEventListener('input', () => {
      const particleRimWidthValue = Number(particleRimWidth.input.value);
      particleRimWidth.value.textContent = `${particleRimWidthValue}%`;
      this.updateSettings({ particleRimWidth: particleRimWidthValue }, false);
    });
    particleRimWidth.value.textContent = `${this.settings.particleRimWidth}%`;
    particleRimWidth.wrap.classList.add('hud__control--visual');

    const particleBrightness = createRange(
      'Bright',
      0,
      AUDIO_UI_MAX,
      1,
      sliderFromBrightnessResponse(this.settings.particleBrightnessResponse),
    );
    particleBrightness.input.addEventListener('input', () => {
      const particleBrightnessResponse = brightnessResponseFromSlider(
        Number(particleBrightness.input.value),
      );
      particleBrightness.value.textContent = formatBrightnessResponse(
        particleBrightnessResponse,
      );
      this.updateSettings({ particleBrightnessResponse }, false);
    });
    particleBrightness.value.textContent = formatBrightnessResponse(
      this.settings.particleBrightnessResponse,
    );
    particleBrightness.wrap.classList.add('hud__control--visual');

    const particleGlow = createTextSelect<ParticleGlowMode>(
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
    particleGlow.wrap.classList.add('hud__control--visual');

    const particleVivid = createRange(
      'Vivid',
      0,
      PARTICLE_GLOW_VIVIDNESS_MAX,
      0.05,
      this.settings.particleGlowVividness,
    );
    particleVivid.input.addEventListener('input', () => {
      const particleGlowVividness = Number(particleVivid.input.value);
      particleVivid.value.textContent = formatVividness(particleGlowVividness);
      this.updateSettings({ particleGlowVividness }, false);
    });
    particleVivid.value.textContent = formatVividness(this.settings.particleGlowVividness);
    particleVivid.wrap.classList.add('hud__control--visual');

    const combi = createTextSelect<DotCombiMode>(
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

    const particleLeader = createToggle('No.1', this.settings.particleLeaderVisible);
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

    const linkName = document.createElement('button');
    linkName.className = 'hud__button hud__link-name';
    linkName.type = 'button';
    linkName.textContent = 'Name';
    linkName.addEventListener('click', () => {
      this.arrangePresetNameParticles();
    });

    const linkOptions = document.createElement('div');
    linkOptions.className = 'hud__link-options';
    linkOptions.append(particleLeader.wrap, linkFlash, linkName);

    const syncLinkingOptions = () => {
      const linkingEnabled = this.settings.dotCombiMode === 'velocity';
      particleLeader.input.disabled = !linkingEnabled;
      particleLeader.wrap.classList.toggle('is-disabled', !linkingEnabled);
      linkFlash.title = 'Arrange particles around the ball';
      linkFlash.setAttribute('aria-label', linkFlash.title);
      linkName.title = 'Arrange particles into the current preset name';
      linkName.setAttribute('aria-label', linkName.title);
    };

    const gravity = createTextSelect<GravityMode>(
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

    const gravityStrength = createRange(
      'Gravity strength',
      0,
      LOG_UI_MAX,
      1,
      sliderFromGravityStrength(this.settings.gravityStrength),
    );
    gravityStrength.input.addEventListener('input', () => {
      const strength = gravityStrengthFromSlider(Number(gravityStrength.input.value));
      gravityStrength.value.textContent = formatGravityStrength(strength);
      this.updateSettings({ gravityStrength: strength });
    });
    gravityStrength.value.textContent = formatGravityStrength(this.settings.gravityStrength);

    const dots = createSelect(
      'Count',
      [0, 1, 3, 10, 30, 100, 200, 500, 1000, 2000, 5000, 10000],
      this.settings.particleCount,
    );
    dots.input.addEventListener('change', () => {
      const particleCount = Number(dots.input.value);
      this.updateSettings({ particleCount });
    });

    const ball = createRange(
      'Size',
      0,
      AUDIO_UI_MAX,
      1,
      sliderFromControlBallSize(this.settings.controlBallRadius),
    );
    ball.input.addEventListener('input', () => {
      const controlBallRadius = controlBallSizeFromSlider(Number(ball.input.value));
      ball.value.textContent = formatControlBallSize(controlBallRadius);
      this.updateSettings({ controlBallRadius });
    });
    ball.value.textContent = formatControlBallSize(this.settings.controlBallRadius);

    const ballColor = createTextSelect<BallPalette>(
      'Color',
      [
        ['black', 'Black'],
        ['blue', 'Blue'],
        ['green', 'Green'],
        ['yellow', 'Yellow'],
        ['red', 'Red'],
        ['pink', 'Pink'],
        ['orange', 'Orange'],
        ['white', 'White'],
      ],
      this.settings.controlBallPalette,
    );
    ballColor.input.addEventListener('change', () => {
      this.updateSettings(
        { controlBallPalette: ballColor.input.value as BallPalette },
        false,
      );
    });
    ballColor.wrap.classList.add('hud__control--visual');

    const ballRim = createToggle('Rim', this.settings.controlBallRimEnabled);
    ballRim.input.addEventListener('change', () => {
      this.updateSettings({ controlBallRimEnabled: ballRim.input.checked }, false);
    });
    ballRim.wrap.classList.add('hud__toggle--visual');

    const ballMode = createTextSelect<ControlBallMode>(
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

    const particle = createRange(
      'Size',
      2,
      PARTICLE_RADIUS_MAX,
      1,
      this.settings.particleRadius,
    );
    this.particleSizeValueEl = particle.value;
    particle.input.addEventListener('input', () => {
      const particleRadius = Number(particle.input.value);
      particle.value.textContent = `${particleRadius}`;
      this.updateSettings({ particleRadius });
      this.syncParticleLoadValue();
    });

    const particleWeight = createRange(
      'Weight',
      0,
      LOG_UI_MAX,
      1,
      sliderFromParticleWeight(this.settings.particleMass),
    );
    particleWeight.input.addEventListener('input', () => {
      const particleMass = particleWeightFromSlider(Number(particleWeight.input.value));
      particleWeight.value.textContent = formatWeight(particleMass);
      this.updateSettings({ particleMass });
    });
    particleWeight.value.textContent = formatWeight(this.settings.particleMass);

    const wallBounce = createRange(
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

    const contactBounce = createRange(
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

    const weight = createRange(
      'Weight',
      0,
      WEIGHT_UI_MAX,
      1,
      sliderFromWeight(this.settings.controlBallMass),
    );
    weight.input.addEventListener('input', () => {
      const controlBallMass = weightFromSlider(Number(weight.input.value));
      weight.value.textContent = formatWeight(controlBallMass);
      this.updateSettings({ controlBallMass });
    });
    weight.value.textContent = formatWeight(this.settings.controlBallMass);

    const ballDrag = this.createDampingRange('Damping', this.settings.controlBallLinearDamping);
    ballDrag.input.addEventListener('input', () => {
      const controlBallLinearDamping = dampingFromSlider(Number(ballDrag.input.value));
      ballDrag.value.textContent = formatDamping(controlBallLinearDamping);
      this.updateSettings({ controlBallLinearDamping });
    });

    const dotDrag = this.createDampingRange('Damping', this.settings.particleLinearDamping);
    dotDrag.input.addEventListener('input', () => {
      const particleLinearDamping = dampingFromSlider(Number(dotDrag.input.value));
      dotDrag.value.textContent = formatDamping(particleLinearDamping);
      this.updateSettings({ particleLinearDamping });
    });

    const friction = createRange(
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

    const audioBallTab = document.createElement('button');
    audioBallTab.className = 'hud__button hud__audio-tab';
    audioBallTab.type = 'button';
    audioBallTab.textContent = 'Ball';
    audioBallTab.setAttribute('aria-pressed', 'true');

    const audioParticleTab = document.createElement('button');
    audioParticleTab.className = 'hud__button hud__audio-tab';
    audioParticleTab.type = 'button';
    audioParticleTab.textContent = 'Particle';
    audioParticleTab.setAttribute('aria-pressed', 'false');

    const audioTabs = document.createElement('div');
    audioTabs.className = 'hud__audio-tabs';
    audioTabs.append(audioBallTab, audioParticleTab);

    const audioBallPanel = document.createElement('div');
    audioBallPanel.className = 'hud__audio-panel';

    const audioParticlePanel = document.createElement('div');
    audioParticlePanel.className = 'hud__audio-panel';

    const syncAudioPanel = () => {
      const showBall = this.activeAudioPanel === 'ball';
      audioBallPanel.hidden = !showBall;
      audioParticlePanel.hidden = showBall;
      audioBallTab.setAttribute('aria-pressed', `${showBall}`);
      audioParticleTab.setAttribute('aria-pressed', `${!showBall}`);
    };

    audioBallTab.addEventListener('click', () => {
      this.activeAudioPanel = 'ball';
      syncAudioPanel();
    });
    audioParticleTab.addEventListener('click', () => {
      this.activeAudioPanel = 'particle';
      syncAudioPanel();
    });

    const audioBallWave = createTextSelect<AudioWaveform>(
      'Wave',
      [
        ['sine', 'Sine'],
        ['triangle', 'Triangle'],
        ['sawtooth', 'Sawtooth'],
        ['square', 'Square'],
      ],
      this.settings.audioBallWaveform,
    );
    audioBallWave.input.addEventListener('change', () => {
      this.updateSettings(
        { audioBallWaveform: audioBallWave.input.value as AudioWaveform },
        false,
      );
    });

    const audioBallFrequency = createRange(
      'Pitch',
      0,
      AUDIO_UI_MAX,
      1,
      sliderFromAudioFrequency(this.settings.audioBallFrequencyHz),
    );
    audioBallFrequency.input.addEventListener('input', () => {
      const audioBallFrequencyHz = audioFrequencyFromSlider(
        Number(audioBallFrequency.input.value),
      );
      audioBallFrequency.value.textContent = formatAudioFrequency(audioBallFrequencyHz);
      this.updateSettings({ audioBallFrequencyHz }, false);
    });
    audioBallFrequency.value.textContent = formatAudioFrequency(
      this.settings.audioBallFrequencyHz,
    );

    const audioBallSpread = createRange(
      'Spread',
      0,
      AUDIO_UI_MAX,
      1,
      sliderFromAudioSpread(this.settings.audioBallFrequencySpread),
    );
    audioBallSpread.input.addEventListener('input', () => {
      const audioBallFrequencySpread = audioSpreadFromSlider(
        Number(audioBallSpread.input.value),
      );
      audioBallSpread.value.textContent = formatAudioSpread(audioBallFrequencySpread);
      this.updateSettings({ audioBallFrequencySpread }, false);
    });
    audioBallSpread.value.textContent = formatAudioSpread(
      this.settings.audioBallFrequencySpread,
    );

    const audioBallLength = createRange(
      'Sound Len.',
      0,
      AUDIO_UI_MAX,
      1,
      sliderFromAudioDuration(this.settings.audioBallDurationMs),
    );
    audioBallLength.input.addEventListener('input', () => {
      const audioBallDurationMs = audioDurationFromSlider(
        Number(audioBallLength.input.value),
      );
      audioBallLength.value.textContent = formatAudioDuration(audioBallDurationMs);
      this.updateSettings({ audioBallDurationMs }, false);
    });
    audioBallLength.value.textContent = formatAudioDuration(
      this.settings.audioBallDurationMs,
    );

    audioBallPanel.append(
      audioBallWave.wrap,
      audioBallFrequency.wrap,
      audioBallSpread.wrap,
      audioBallLength.wrap,
    );

    const audioParticleWave = createTextSelect<AudioWaveform>(
      'Wave',
      [
        ['sine', 'Sine'],
        ['triangle', 'Triangle'],
        ['sawtooth', 'Sawtooth'],
        ['square', 'Square'],
      ],
      this.settings.audioParticleWaveform,
    );
    audioParticleWave.input.addEventListener('change', () => {
      this.updateSettings(
        { audioParticleWaveform: audioParticleWave.input.value as AudioWaveform },
        false,
      );
    });

    const audioParticleFrequency = createRange(
      'Pitch',
      0,
      AUDIO_UI_MAX,
      1,
      sliderFromAudioFrequency(this.settings.audioParticleFrequencyHz),
    );
    audioParticleFrequency.input.addEventListener('input', () => {
      const audioParticleFrequencyHz = audioFrequencyFromSlider(
        Number(audioParticleFrequency.input.value),
      );
      audioParticleFrequency.value.textContent = formatAudioFrequency(
        audioParticleFrequencyHz,
      );
      this.updateSettings({ audioParticleFrequencyHz }, false);
    });
    audioParticleFrequency.value.textContent = formatAudioFrequency(
      this.settings.audioParticleFrequencyHz,
    );

    const audioParticleSpread = createRange(
      'Spread',
      0,
      AUDIO_UI_MAX,
      1,
      sliderFromAudioSpread(this.settings.audioParticleFrequencySpread),
    );
    audioParticleSpread.input.addEventListener('input', () => {
      const audioParticleFrequencySpread = audioSpreadFromSlider(
        Number(audioParticleSpread.input.value),
      );
      audioParticleSpread.value.textContent = formatAudioSpread(
        audioParticleFrequencySpread,
      );
      this.updateSettings({ audioParticleFrequencySpread }, false);
    });
    audioParticleSpread.value.textContent = formatAudioSpread(
      this.settings.audioParticleFrequencySpread,
    );

    const audioParticleLength = createRange(
      'Sound Len.',
      0,
      AUDIO_UI_MAX,
      1,
      sliderFromAudioDuration(this.settings.audioParticleDurationMs),
    );
    audioParticleLength.input.addEventListener('input', () => {
      const audioParticleDurationMs = audioDurationFromSlider(
        Number(audioParticleLength.input.value),
      );
      audioParticleLength.value.textContent = formatAudioDuration(audioParticleDurationMs);
      this.updateSettings({ audioParticleDurationMs }, false);
    });
    audioParticleLength.value.textContent = formatAudioDuration(
      this.settings.audioParticleDurationMs,
    );

    audioParticlePanel.append(
      audioParticleWave.wrap,
      audioParticleFrequency.wrap,
      audioParticleSpread.wrap,
      audioParticleLength.wrap,
    );
    syncAudioPanel();

    const sound = createToggle('Sound', this.settings.soundEnabled);
    sound.input.addEventListener('change', () => {
      this.updateSettings({ soundEnabled: sound.input.checked }, false, false);
      this.audio.setEnabled(sound.input.checked);
    });

    const debug = createToggle('Debug', this.settings.debug);
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
    reset.title = 'Reset scene with current settings and restart graphics';
    reset.setAttribute('aria-label', 'Reset scene with current settings and restart graphics');
    reset.addEventListener('click', () => this.resetScene());

    const modePin = createPinButton<PinnableGroupId>('mode', 'Mode', (id) => {
      this.togglePinnedGroup(id);
    });
    const ballPin = createPinButton<PinnableGroupId>('ball', 'Ball', (id) => {
      this.togglePinnedGroup(id);
    });
    const particlesPin = createPinButton<PinnableGroupId>('particles', 'Particles', (id) => {
      this.togglePinnedGroup(id);
    });
    const interactionPin = createPinButton<PinnableGroupId>('interaction', 'Interaction', (id) => {
      this.togglePinnedGroup(id);
    });
    const audioPin = createPinButton<PinnableGroupId>('audio', 'Audio', (id) => {
      this.togglePinnedGroup(id);
    });

    const modeGroup = createSettingsGroup('Mode', 'mode', [
      mode.wrap,
      combi.wrap,
      linkOptions,
      gravity.wrap,
      gravityStrength.wrap,
    ], modePin);
    const ballGroup = createSettingsGroup('Ball', 'ball', [
      ballMode.wrap,
      ball.wrap,
      weight.wrap,
      ballDrag.wrap,
      ballColor.wrap,
      ballRim.wrap,
    ], ballPin);
    const dotsGroup = createSettingsGroup('Particles', 'particles', [
      dots.wrap,
      particle.wrap,
      particleWeight.wrap,
      dotDrag.wrap,
      color.wrap,
      particleRimWidth.wrap,
      particleGlow.wrap,
      particleBrightness.wrap,
      particleVivid.wrap,
    ], particlesPin);
    const interactionGroup = createSettingsGroup('Interaction', 'interaction', [
      wallBounce.wrap,
      contactBounce.wrap,
      friction.wrap,
    ], interactionPin);
    const audioGroup = createSettingsGroup('Audio', 'audio', [
      audioTabs,
      audioBallPanel,
      audioParticlePanel,
    ], [sound.wrap, audioPin]);
    const utilityGroup = createSettingsGroup('Utility', 'utility', [
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
        sliderFromBrightnessResponse(this.settings.particleBrightnessResponse)
      }`;
      particleBrightness.value.textContent = formatBrightnessResponse(
        this.settings.particleBrightnessResponse,
      );
      particleRimWidth.input.value = `${this.settings.particleRimWidth}`;
      particleRimWidth.value.textContent = `${this.settings.particleRimWidth}%`;
      particleGlow.input.value = this.settings.particleGlowMode;
      particleVivid.input.value = `${this.settings.particleGlowVividness}`;
      particleVivid.value.textContent = formatVividness(this.settings.particleGlowVividness);
      ballColor.input.value = this.settings.controlBallPalette;
      ballRim.input.checked = this.settings.controlBallRimEnabled;
      ballMode.input.value = this.settings.controlBallMode;
      combi.input.value = this.settings.dotCombiMode;
      particleLeader.input.checked = this.settings.particleLeaderVisible;
      gravity.input.value = this.settings.gravityMode;
      gravityStrength.input.value = `${
        sliderFromGravityStrength(this.settings.gravityStrength)
      }`;
      gravityStrength.value.textContent = formatGravityStrength(
        this.settings.gravityStrength,
      );
      syncSelectValue(dots.input, this.settings.particleCount);
      ball.input.value = `${sliderFromControlBallSize(this.settings.controlBallRadius)}`;
      ball.value.textContent = formatControlBallSize(this.settings.controlBallRadius);
      particle.input.value = `${this.settings.particleRadius}`;
      particle.value.textContent = `${this.settings.particleRadius}`;
      this.syncParticleLoadValue();
      particleWeight.input.value = `${sliderFromParticleWeight(this.settings.particleMass)}`;
      particleWeight.value.textContent = formatWeight(this.settings.particleMass);
      wallBounce.input.value = `${this.settings.wallRestitution}`;
      wallBounce.value.textContent = this.settings.wallRestitution.toFixed(2);
      contactBounce.input.value = `${this.settings.contactRestitution}`;
      contactBounce.value.textContent = this.settings.contactRestitution.toFixed(2);
      weight.input.value = `${sliderFromWeight(this.settings.controlBallMass)}`;
      weight.value.textContent = formatWeight(this.settings.controlBallMass);
      ballDrag.input.value = `${sliderFromDamping(this.settings.controlBallLinearDamping)}`;
      ballDrag.value.textContent = formatDamping(this.settings.controlBallLinearDamping);
      dotDrag.input.value = `${sliderFromDamping(this.settings.particleLinearDamping)}`;
      dotDrag.value.textContent = formatDamping(this.settings.particleLinearDamping);
      friction.input.value = `${this.settings.controlBallFriction}`;
      friction.value.textContent = this.settings.controlBallFriction.toFixed(3);
      audioBallWave.input.value = this.settings.audioBallWaveform;
      audioBallFrequency.input.value = `${
        sliderFromAudioFrequency(this.settings.audioBallFrequencyHz)
      }`;
      audioBallFrequency.value.textContent = formatAudioFrequency(
        this.settings.audioBallFrequencyHz,
      );
      audioBallSpread.input.value = `${
        sliderFromAudioSpread(this.settings.audioBallFrequencySpread)
      }`;
      audioBallSpread.value.textContent = formatAudioSpread(
        this.settings.audioBallFrequencySpread,
      );
      audioBallLength.input.value = `${
        sliderFromAudioDuration(this.settings.audioBallDurationMs)
      }`;
      audioBallLength.value.textContent = formatAudioDuration(
        this.settings.audioBallDurationMs,
      );
      audioParticleWave.input.value = this.settings.audioParticleWaveform;
      audioParticleFrequency.input.value = `${
        sliderFromAudioFrequency(this.settings.audioParticleFrequencyHz)
      }`;
      audioParticleFrequency.value.textContent = formatAudioFrequency(
        this.settings.audioParticleFrequencyHz,
      );
      audioParticleSpread.input.value = `${
        sliderFromAudioSpread(this.settings.audioParticleFrequencySpread)
      }`;
      audioParticleSpread.value.textContent = formatAudioSpread(
        this.settings.audioParticleFrequencySpread,
      );
      audioParticleLength.input.value = `${
        sliderFromAudioDuration(this.settings.audioParticleDurationMs)
      }`;
      audioParticleLength.value.textContent = formatAudioDuration(
        this.settings.audioParticleDurationMs,
      );
      syncAudioPanel();
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
    this.setSettingsPanelOpen(true);

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
      this.syncParticleLoadValue();
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
    this.syncParticleLoadValue();
    this.renderer?.setParticlePalette(this.settings.particlePalette);
    this.renderer?.setParticleRimWidth(this.settings.particleRimWidth);
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

  private arrangePresetNameParticles(reportStatus = true) {
    const physics = this.requirePhysics();
    if (physics.particleCount <= 0) {
      if (reportStatus) {
        this.setPresetStatus('No particles');
      }
      return false;
    }

    const text = this.currentPresetMessageText();
    const targets = this.createMessageFormationTargets(text, physics.particleCount);
    if (targets.length <= 0 || !physics.arrangeParticlesToTargets(targets)) {
      if (reportStatus) {
        this.setPresetStatus('Name unavailable');
      }
      return false;
    }

    if (reportStatus) {
      this.setPresetStatus('Name formed');
    }
    return true;
  }

  private currentPresetMessageText() {
    const value = this.activePresetValue;
    if (value.startsWith('factory:')) {
      const id = value.slice('factory:'.length);
      const preset = FACTORY_PRESETS.find((candidate) => candidate.id === id);
      return effectivePresetMessageText(preset?.name, preset?.formationLabel);
    }

    if (value.startsWith('user:')) {
      const index = Number(value.slice('user:'.length));
      const preset = this.userPresets[index];
      return effectivePresetMessageText(preset?.name, preset?.formationLabel);
    }

    return 'Custom';
  }

  private currentPresetFormationLabel() {
    const value = this.activePresetValue;
    if (value.startsWith('factory:')) {
      const id = value.slice('factory:'.length);
      const preset = FACTORY_PRESETS.find((candidate) => candidate.id === id);
      return effectivePresetMessageText(preset?.name, preset?.formationLabel);
    }

    if (value.startsWith('user:')) {
      const index = Number(value.slice('user:'.length));
      const preset = this.userPresets[index];
      return effectivePresetMessageText(preset?.name, preset?.formationLabel);
    }

    return null;
  }

  private currentPresetExportName() {
    const value = this.activePresetValue;
    if (value.startsWith('factory:')) {
      const id = value.slice('factory:'.length);
      const preset = FACTORY_PRESETS.find((candidate) => candidate.id === id);
      return preset?.name ?? 'Current';
    }

    if (value.startsWith('user:')) {
      const index = Number(value.slice('user:'.length));
      return this.userPresets[index]?.name ?? 'Current';
    }

    return 'Current';
  }

  private createMessageFormationTargets(
    text: string,
    particleCount: number,
  ): ParticleFormationTarget[] {
    const renderer = this.requireRenderer();
    const width = Math.max(Math.floor(renderer.width), 1);
    const height = Math.max(Math.floor(renderer.height), 1);
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    const settingsOpen = this.isSettingsPanelOpen();
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

    const message = text.trim() || 'Custom';
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
        this.settings.particleRadius,
      );
    }

    const fontSize = this.messageFontSize(
      context,
      lines,
      textBoxWidth,
      textBoxHeight,
      mobile,
    );
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `800 ${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
    this.drawMessageLines(context, lines, centerX, centerY, textBoxWidth, fontSize);

    const image = context.getImageData(0, 0, width, height);
    const points = this.sampleMessagePixels(image, fontSize);
    if (points.length <= 0) {
      return [];
    }

    return createMessageTargetsFromPoints(
      points,
      particleCount,
      width,
      height,
      this.settings.particleRadius,
    );
  }

  private messageFontSize(
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
      context.font = `800 ${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
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

  private drawMessageLines(
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

  private sampleMessagePixels(image: ImageData, fontSize: number) {
    const points: Array<{ x: number; y: number }> = [];
    const step = Math.max(
      4,
      Math.floor(Math.max(this.settings.particleRadius * 2.25, fontSize / 13)),
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

  private syncParticleLoadValue() {
    const valueEl = this.particleSizeValueEl;
    if (!valueEl) {
      return;
    }

    for (const className of PARTICLE_LOAD_VALUE_CLASSES) {
      valueEl.classList.remove(className);
    }

    const renderer = this.renderer;
    const load = estimateParticleLoad({
      width: renderer?.width ?? 0,
      height: renderer?.height ?? 0,
      particleCount: this.settings.particleCount,
      particleRadius: this.settings.particleRadius,
    });
    if (load.level !== 'normal') {
      valueEl.classList.add(`hud__value--load-${load.level}`);
    }
    valueEl.title = particleLoadTitle(load);
  }

  private setSettingsPanelOpen(open: boolean) {
    this.hudEl?.classList.toggle('hud--open', open);
    this.settingsButton?.setAttribute('aria-expanded', `${open}`);
    this.applyPinnedSettingsPlacement();
    this.syncPresetSelectSelection();
  }

  private applySettingsMenuHeightMode() {
    const size = this.settingsMenuSize;
    this.hudEl?.classList.toggle('hud--small', size === 'small');
    this.hudEl?.classList.toggle('hud--compact', size === 'medium');
    if (!this.settingsHeightButton) {
      return;
    }
    const nextSize = nextSettingsMenuSize(size);
    const title = `Settings size: ${settingsMenuSizeLabel(size)}. Use ${settingsMenuSizeLabel(nextSize)}.`;
    this.settingsHeightButton.title = title;
    this.settingsHeightButton.setAttribute('aria-label', title);
    this.settingsHeightButton.dataset.size = size;
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
    const settingsOpen = this.isSettingsPanelOpen();
    const isClosingFrontPinnedGroup = !settingsOpen && this.activePinnedGroupId === id;
    this.setPinnedGroup(
      this.activePinnedGroupId === id ? null : id,
      !isClosingFrontPinnedGroup,
    );
  }

  private setPinnedGroup(id: PresetPinnedGroup, markPresetCustom = true) {
    this.activePinnedGroupId = id && this.pinnableGroups.some((group) => group.id === id)
      ? id
      : null;
    this.applyPinnedSettingsPlacement();
    if (markPresetCustom) {
      this.markPresetCustom();
    }
  }

  private applyPinnedSettingsPlacement() {
    const pinnedHost = this.pinnedSettingsEl;
    const settingsOpen = this.isSettingsPanelOpen();

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

  private isSettingsPanelOpen() {
    return this.hudEl?.classList.contains('hud--open') ?? false;
  }

  private createPresetControls() {
    this.presetPanel = new PresetPanel(
      {
        onPresetChange: (value) => {
          this.applySelectedPreset(value);
        },
        onSaveCurrent: () => {
          this.saveCurrentPreset();
        },
        onDeleteSelected: () => {
          this.deleteSelectedUserPreset();
        },
        onExportCurrent: () => {
          this.exportCurrentPreset();
        },
        onExportUsers: () => {
          this.exportUserPresets();
        },
        onImportFile: (input) => {
          void this.importPresetFile(input);
        },
        getCurrentFormationLabel: () => this.currentPresetFormationLabel(),
      },
      this.userPresets,
      this.activePresetValue,
    );
    return this.presetPanel.element;
  }

  private renderPresetOptions(selectedValue: string) {
    if (!this.presetPanel) {
      return;
    }

    this.activePresetValue = selectedValue;
    if (selectedValue === 'custom') {
      this.activePresetSnapshot = null;
    }
    this.presetPanel.renderPresetOptions(selectedValue, this.userPresets);
    this.syncPresetSelectSelection();
  }

  private applySelectedPreset(value: string) {
    if (value === 'custom') {
      this.markPresetCustom('Custom tuning');
      return;
    }

    const preset = this.presetSettingsForValue(value);
    if (!preset) {
      this.markPresetCustom('Empty slot');
      return;
    }

    this.applyPreset(preset, value, this.initialFormationForPresetValue(value));
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

  private initialFormationForPresetValue(value: string): FactoryPresetInitialFormation | null {
    if (!value.startsWith('factory:')) {
      return null;
    }

    const id = value.slice('factory:'.length);
    return FACTORY_PRESETS.find((preset) => preset.id === id)?.initialFormation ?? null;
  }

  private applyPreset(
    preset: PresetSettings,
    selectedValue: string,
    initialFormation: FactoryPresetInitialFormation | null = null,
  ) {
    const { pinnedGroup, ...settings } = preset;
    this.updateSettings(settings, true, false);
    if (Object.prototype.hasOwnProperty.call(preset, 'pinnedGroup')) {
      this.setPinnedGroup(pinnedGroup ?? null, false);
    }
    this.syncUiFromSettings();
    this.activePresetValue = selectedValue;
    this.activePresetSnapshot = presetFromSettings(this.settings, this.activePinnedGroupId);
    this.syncPresetSelectSelection();
    this.applyInitialPresetFormation(initialFormation);
    this.setPresetStatus('Applied');
  }

  private applyInitialPresetFormation(initialFormation: FactoryPresetInitialFormation | null) {
    if (!initialFormation || initialFormation === 'random') {
      return;
    }

    if (initialFormation === 'flash') {
      this.requirePhysics().arrangeFlashParticles();
      return;
    }

    this.arrangePresetNameParticles(false);
  }

  private saveCurrentPreset() {
    const index = this.presetPanel?.selectedUserPresetSlot() ?? null;
    if (index === null) {
      this.setPresetStatus('Choose save slot');
      return;
    }

    this.userPresets = saveUserPreset(
      this.userPresets,
      index,
      this.presetPanel?.saveName ?? '',
      presetFromSettings(this.settings, this.activePinnedGroupId),
      this.presetPanel?.formationLabel ?? '',
    );
    const selectedValue = `user:${index}`;
    this.activePresetSnapshot = presetFromSettings(this.settings, this.activePinnedGroupId);
    this.renderPresetOptions(selectedValue);
    this.renderSaveDestinationOptions('');
    this.setPresetStatus(`Saved User ${index + 1}`);
  }

  private deleteSelectedUserPreset() {
    const index = this.presetPanel?.selectedUserPresetSlot() ?? null;
    if (index === null || !this.userPresets[index]) {
      this.setPresetStatus('Choose saved slot');
      return;
    }

    const selectedValue = `user:${index}`;
    this.userPresets = deleteUserPreset(this.userPresets, index);
    if (this.activePresetValue === selectedValue) {
      this.activePresetValue = 'custom';
      this.activePresetSnapshot = null;
    }
    this.renderPresetOptions(this.activePresetValue);
    this.renderSaveDestinationOptions('');
    this.setPresetStatus(`Deleted User ${index + 1}`);
  }

  private renderSaveDestinationOptions(selectedValue: string) {
    this.presetPanel?.renderSaveDestinationOptions(
      selectedValue,
      this.userPresets,
      this.currentPresetFormationLabel(),
    );
  }

  private exportCurrentPreset() {
    const exportFile = createCurrentPresetExport(
      this.currentPresetExportName(),
      this.settings,
      this.activePinnedGroupId,
      this.currentPresetFormationLabel(),
    );
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

    const selected = this.presetPanel?.selectedUserPresetSlot() ?? null;
    if (selected === null) {
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
    const currentPreset = presetFromSettings(this.settings, this.activePinnedGroupId);
    if (
      this.activePresetSnapshot &&
      presetSettingsEqual(currentPreset, this.activePresetSnapshot)
    ) {
      this.syncPresetSelectSelection();
      this.setPresetStatus('Applied');
      return;
    }

    if (this.activePresetSnapshot && this.activePresetValue !== 'custom') {
      this.syncPresetSelectSelection();
      this.setPresetStatus('Modified');
      return;
    }

    this.activePresetValue = 'custom';
    this.activePresetSnapshot = null;
    this.syncPresetSelectSelection();
    this.setPresetStatus(status);
  }

  private syncPresetSelectSelection() {
    if (!this.presetPanel) {
      return;
    }

    this.activePresetValue = this.presetPanel.syncPresetSelectSelection(
      this.activePresetValue,
    );
  }

  private setPresetStatus(status: string) {
    this.presetPanel?.setStatus(status);
  }

  private createDampingRange(labelText: string, initial: number): RangeControl {
    const control = createRange(
      labelText,
      0,
      DAMPING_UI_MAX,
      1,
      sliderFromDamping(initial),
    );
    control.value.textContent = formatDamping(initial);
    return control;
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

    const debugLines = this.debugProfile === 'audio'
      ? createAudioDebugLines(this.audio.getDiagnostics(), this.debugProfile)
      : this.createPhysicsDebugLines(deltaSeconds, impactCount);
    this.lastDebugText = debugLines.join('\n');
    this.debugEl.textContent = this.lastDebugText;
  }

  private createPhysicsDebugLines(deltaSeconds: number, impactCount: number) {
    const physics = this.requirePhysics();
    return createPhysicsDebugTextLines({
      profile: this.debugProfile,
      deltaSeconds,
      collisionMode: this.settings.collisionMode,
      gravityMode: this.settings.gravityMode,
      particleCount: physics.particleCount,
      particleDiagnostics: physics.getParticleDiagnostics(),
      fixedStepsLastFrame: this.fixedStepsLastFrame,
      averageStepMs: this.averageStepMs,
      lastStepMetrics: this.lastStepMetrics,
      impactCount,
      activeVoiceCount: this.audio.activeVoiceCount,
    });
  }

  private async copyDebugText(sourceButton?: HTMLButtonElement) {
    const text = this.lastDebugText || DEBUG_COPY_FALLBACK_TEXT;
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

function presetSettingsEqual(a: PresetSettings, b: PresetSettings) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function nextSettingsMenuSize(size: SettingsMenuSize): SettingsMenuSize {
  const index = SETTINGS_MENU_SIZE_ORDER.indexOf(size);
  return SETTINGS_MENU_SIZE_ORDER[(index + 1) % SETTINGS_MENU_SIZE_ORDER.length];
}

function settingsMenuSizeLabel(size: SettingsMenuSize) {
  if (size === 'small') {
    return 'Small';
  }
  if (size === 'medium') {
    return 'Medium';
  }
  return 'Large';
}

function syncSelectValue(select: HTMLSelectElement, value: string | number) {
  const nextValue = `${value}`;
  if (!Array.from(select.options).some((option) => option.value === nextValue)) {
    const option = document.createElement('option');
    option.value = nextValue;
    option.textContent = nextValue;
    option.dataset.generated = 'true';
    select.appendChild(option);
  }
  select.value = nextValue;
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
