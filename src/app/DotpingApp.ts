import { AudioEngine } from '../audio/audioEngine';
import {
  ATTACK_TEST_OPTIONS,
  DEFAULT_ATTACK_TEST_MODE,
  DEFAULT_LOOKAHEAD_MS,
  DEFAULT_STEAL_FADE_MS,
  DEFAULT_TRIGGER_TEST_MODE,
  LOOKAHEAD_OPTIONS,
  STEAL_FADE_OPTIONS,
  TRIGGER_TEST_OPTIONS,
  type AttackTestMode,
  type LookaheadMs,
  type StealFadeMs,
  type TriggerTestMode,
} from '../audio/triggerTiming';
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
  DEFAULT_DESIGN_VIEWPORT,
  computeViewScale,
  loadViewScaleMode,
  saveViewScaleMode,
  viewScaleTitle,
  type ViewScale,
  type ViewScaleMode,
  type Viewport,
} from '../sim/viewScale';
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
  ControlRegistry,
  type ControlDefinition,
  type LiveControlInstance,
} from './controlRegistry';
import {
  attachPickButton,
  createPinButton,
  createRange,
  createSettingsGroup,
  createSettingsTabs,
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
  debugVisibleFromParams,
  type DebugProfile,
} from './debugPanel';
import { shouldShowSoundUnlock } from './soundUnlock';
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
import {
  EMPTY_MY_PANEL,
  MY_PANEL_MAX_ITEMS,
  loadMyPanelState,
  restoreDefaultMyPanelItems,
  saveMyPanelState,
  toggleMyPanelItem,
  type MyPanelState,
} from './myPanel';
import { PresetPanel, fillPresetOptions, syncPresetSelectValue } from './presetPanel';
import {
  FrontPresetBar,
  loadFrontPresetBarVisible,
  presetBrowseOrder,
  saveFrontPresetBarVisible,
  stepPresetValue,
  type PresetStep,
} from './frontPresetBar';
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
import {
  SETTINGS_TABS,
  isCardVisibleInTab,
  loadSettingsTab,
  resolveInitialSettingsTab,
  saveSettingsTab,
  type SettingsCardId,
  type SettingsTabId,
} from './settingsTabs';

type RapierModule = any;

type PointerState = {
  active: boolean;
  pointerId: number | null;
  x: number;
  y: number;
};

type PinnableGroupId = Exclude<PresetPinnedGroup, null>;
type AudioPanelId = 'ball' | 'particle';

type PinnableSettingsGroup = {
  id: PinnableGroupId;
  title: string;
  element: HTMLDivElement;
  marker: Comment;
  pinButton: HTMLButtonElement;
};

type ControlCardId = ControlDefinition['card'];

type ControlSpecBase = {
  id: string;
  card: ControlCardId;
  label: string;
  panelLabel: string;
};

type RangeSettingSpec = ControlSpecBase & {
  min: number;
  max: number;
  step: number;
  slider: () => number;
  format: () => string;
  onInput: (value: number) => void;
  visual?: boolean;
  // Returns an optional cleanup for when a My Panel copy is removed.
  decorate?: (control: RangeControl) => (() => void) | void;
};

type SelectSettingSpec<T extends string | number> = ControlSpecBase & {
  options: Array<[T, string]>;
  read: () => T;
  onChange: (value: string) => void;
  visual?: boolean;
  title?: string;
};

type ToggleSettingSpec = ControlSpecBase & {
  read: () => boolean;
  onChange: (checked: boolean) => void;
  enabled?: () => boolean;
  visual?: boolean;
  // Layout class used only inside the source card, not in My Panel.
  primaryClassName?: string;
};

type ActionControlSpec = ControlSpecBase & {
  title: string;
  onClick: (button: HTMLButtonElement) => void;
  primaryClassName?: string;
};

type PickButton = {
  id: string;
  button: HTMLButtonElement;
};

const DEBUG_AVERAGE_ALPHA = 0.08;
const PARTICLE_RADIUS_MAX = 100;
const PARTICLE_RIM_WIDTH_MIN = 5;
const PARTICLE_RIM_WIDTH_MAX = 100;
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
  private soundUnlockButton: HTMLButtonElement | null = null;
  private lastCanvasUnlockAttemptAt = -1;
  private debugCopyFeedbackTimer = 0;
  private debugCopyFeedbackButton: HTMLButtonElement | null = null;
  private hudEl: HTMLDivElement | null = null;
  private pinnedSettingsEl: HTMLDivElement | null = null;
  private settingsButton: HTMLButtonElement | null = null;
  private viewScaleButton: HTMLButtonElement | null = null;
  private viewScaleMode: ViewScaleMode = 'fit';
  private designViewport: Viewport = DEFAULT_DESIGN_VIEWPORT;
  private view: ViewScale = computeViewScale({ width: 1, height: 1 }, DEFAULT_DESIGN_VIEWPORT, '1:1');
  private presetPanel: PresetPanel | null = null;
  private frontPresetBar: FrontPresetBar | null = null;
  private frontPresetBarVisible = true;
  private userPresets: Array<UserPreset | null> = [];
  private pinnableGroups: PinnableSettingsGroup[] = [];
  private activePinnedGroupId: PinnableGroupId | null = null;
  private activePresetValue = 'custom';
  // Where front bar browsing resumes after the tuning turned Custom.
  private lastAppliedPresetValue: string | null = null;
  private activePresetSnapshot: PresetSettings | null = null;
  private debugProfile: DebugProfile = DEFAULT_DEBUG_PROFILE;
  private activeAudioPanel: AudioPanelId = 'ball';
  private readonly particleSizeValueEls = new Set<HTMLSpanElement>();
  private readonly controls = new ControlRegistry();
  private cardPicks: PickButton[] = [];
  private myPanelPicks: PickButton[] = [];
  private myPanelInstances: LiveControlInstance[] = [];
  private myPanelState: MyPanelState = EMPTY_MY_PANEL;
  private myPanelEl: HTMLDivElement | null = null;
  private readonly myPanelMarker = document.createComment('dotping my settings group');
  private myPanelItemsEl: HTMLDivElement | null = null;
  private myPanelHintEl: HTMLParagraphElement | null = null;
  private myPanelPinButton: HTMLButtonElement | null = null;
  private settingsCards = new Map<SettingsCardId, HTMLElement>();
  private settingsTabs: ReturnType<typeof createSettingsTabs<SettingsTabId>> | null = null;
  private activeSettingsTab: SettingsTabId = 'all';
  private triggerTestMode: TriggerTestMode = DEFAULT_TRIGGER_TEST_MODE;
  private stealFadeMs: StealFadeMs = DEFAULT_STEAL_FADE_MS;
  private attackTestMode: AttackTestMode = DEFAULT_ATTACK_TEST_MODE;
  private lookaheadMs: LookaheadMs = DEFAULT_LOOKAHEAD_MS;
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
    this.frontPresetBarVisible = loadFrontPresetBarVisible();
    this.viewScaleMode = loadViewScaleMode();
    this.renderer = new PixiRenderer(this.root);
    await this.renderer.init();
    this.view = this.computeView();
    this.renderer.setViewScale(this.view.scale);
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
      this.view.worldWidth,
      this.view.worldHeight,
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
      this.updateSoundUnlockButton(time);
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
    const viewScaleButton = document.createElement('button');
    viewScaleButton.className = 'view-scale-button';
    viewScaleButton.type = 'button';
    viewScaleButton.addEventListener('click', () => {
      this.setViewScaleMode(this.viewScaleMode === 'fit' ? '1:1' : 'fit');
    });
    this.viewScaleButton = viewScaleButton;
    this.root.appendChild(viewScaleButton);
    this.syncViewScaleButton();

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

    const close = document.createElement('button');
    close.className = 'hud__icon-button hud__close';
    close.type = 'button';
    close.textContent = 'x';
    close.title = 'Close settings';
    close.setAttribute('aria-label', 'Close settings');
    close.addEventListener('click', () => this.setSettingsPanelOpen(false));

    this.activeSettingsTab = resolveInitialSettingsTab(
      loadSettingsTab(),
      window.matchMedia('(max-width: 760px)').matches,
    );
    this.settingsTabs = createSettingsTabs<SettingsTabId>(SETTINGS_TABS, (tab) => {
      this.setSettingsTab(tab);
    });

    header.append(this.settingsTabs.element, close);

    const presetGroup = this.createPresetControls();

    const el = (definition: ControlDefinition) => this.defineControl(definition);
    const flashTitle = 'Arrange particles around the ball';
    const nameTitle = 'Arrange particles into the current preset name';

    const modeModel = el(this.selectSetting<CollisionMode>({
      id: 'mode.model',
      card: 'mode',
      label: 'Particle Model',
      panelLabel: 'Particle Model',
      options: [
        ['independence-overlapping', 'Independent overlap'],
        ['collision-physical', 'Physical collision'],
      ],
      read: () => this.settings.collisionMode,
      onChange: (value) => this.updateSettings({ collisionMode: value as CollisionMode }),
    }));
    const modeLinking = el(this.selectSetting<DotCombiMode>({
      id: 'mode.linking',
      card: 'mode',
      label: 'Particle linking',
      panelLabel: 'Particle linking',
      options: [
        ['off', 'Off'],
        ['velocity', 'Velocity'],
      ],
      read: () => this.settings.dotCombiMode,
      onChange: (value) => this.updateSettings({ dotCombiMode: value as DotCombiMode }),
    }));
    const modeLeader = el(this.toggleSetting({
      id: 'mode.leader',
      card: 'mode',
      label: 'No.1',
      panelLabel: 'No.1',
      primaryClassName: 'hud__link-leader',
      read: () => this.settings.particleLeaderVisible,
      enabled: () => this.settings.dotCombiMode === 'velocity',
      onChange: (checked) => this.updateSettings({ particleLeaderVisible: checked }, false),
    }));
    const modeRandom = el(this.actionControl({
      id: 'mode.random',
      card: 'mode',
      label: 'Random',
      panelLabel: 'Random',
      title: 'Scatter particles to random starting positions',
      primaryClassName: 'hud__link-random',
      onClick: () => this.requirePhysics().arrangeRandomParticles(),
    }));
    const modeFlash = el(this.actionControl({
      id: 'mode.flash',
      card: 'mode',
      label: 'Flash',
      panelLabel: 'Flash',
      title: flashTitle,
      primaryClassName: 'hud__link-flash',
      onClick: () => this.requirePhysics().arrangeFlashParticles(),
    }));
    const modeName = el(this.actionControl({
      id: 'mode.name',
      card: 'mode',
      label: 'Name',
      panelLabel: 'Name',
      title: nameTitle,
      primaryClassName: 'hud__link-name',
      onClick: () => {
        this.arrangePresetNameParticles();
      },
    }));

    const linkOptions = document.createElement('div');
    linkOptions.className = 'hud__link-options';
    linkOptions.append(modeLeader, modeRandom, modeFlash, modeName);

    const modeGravity = el(this.selectSetting<GravityMode>({
      id: 'mode.gravity',
      card: 'mode',
      label: 'Gravity',
      panelLabel: 'Gravity',
      options: [
        ['none', 'Zero-G'],
        ['gravity', 'Gravity'],
        ['antigravity', 'Anti-gravity'],
      ],
      read: () => this.settings.gravityMode,
      onChange: (value) => this.updateSettings({ gravityMode: value as GravityMode }),
    }));
    const modeGravityStrength = el(this.rangeSetting({
      id: 'mode.gravityStrength',
      card: 'mode',
      label: 'Gravity strength',
      panelLabel: 'Gravity strength',
      min: 0,
      max: LOG_UI_MAX,
      step: 1,
      slider: () => sliderFromGravityStrength(this.settings.gravityStrength),
      format: () => formatGravityStrength(this.settings.gravityStrength),
      onInput: (value) => this.updateSettings({ gravityStrength: gravityStrengthFromSlider(value) }),
    }));

    const ballMode = el(this.selectSetting<ControlBallMode>({
      id: 'ball.mode',
      card: 'ball',
      label: 'Ball mode',
      panelLabel: 'Ball mode',
      options: [
        ['persistent', 'Persistent'],
        ['touch', 'Touch'],
      ],
      read: () => this.settings.controlBallMode,
      onChange: (value) => this.updateSettings({ controlBallMode: value as ControlBallMode }),
    }));
    const ballSize = el(this.rangeSetting({
      id: 'ball.size',
      card: 'ball',
      label: 'Size',
      panelLabel: 'Ball size',
      min: 0,
      max: AUDIO_UI_MAX,
      step: 1,
      slider: () => sliderFromControlBallSize(this.settings.controlBallRadius),
      format: () => formatControlBallSize(this.settings.controlBallRadius),
      onInput: (value) => this.updateSettings({ controlBallRadius: controlBallSizeFromSlider(value) }),
    }));
    const ballWeight = el(this.rangeSetting({
      id: 'ball.weight',
      card: 'ball',
      label: 'Weight',
      panelLabel: 'Ball weight',
      min: 0,
      max: WEIGHT_UI_MAX,
      step: 1,
      slider: () => sliderFromWeight(this.settings.controlBallMass),
      format: () => formatWeight(this.settings.controlBallMass),
      onInput: (value) => this.updateSettings({ controlBallMass: weightFromSlider(value) }),
    }));
    const ballDamping = el(this.rangeSetting({
      id: 'ball.damping',
      card: 'ball',
      label: 'Damping',
      panelLabel: 'Ball damping',
      min: 0,
      max: DAMPING_UI_MAX,
      step: 1,
      slider: () => sliderFromDamping(this.settings.controlBallLinearDamping),
      format: () => formatDamping(this.settings.controlBallLinearDamping),
      onInput: (value) => this.updateSettings({ controlBallLinearDamping: dampingFromSlider(value) }),
    }));
    const ballColor = el(this.selectSetting<BallPalette>({
      id: 'ball.color',
      card: 'ball',
      label: 'Color',
      panelLabel: 'Ball color',
      visual: true,
      options: [
        ['black', 'Black'],
        ['blue', 'Blue'],
        ['green', 'Green'],
        ['yellow', 'Yellow'],
        ['red', 'Red'],
        ['pink', 'Pink'],
        ['orange', 'Orange'],
        ['white', 'White'],
      ],
      read: () => this.settings.controlBallPalette,
      onChange: (value) => this.updateSettings({ controlBallPalette: value as BallPalette }, false),
    }));
    const ballRim = el(this.toggleSetting({
      id: 'ball.rim',
      card: 'ball',
      label: 'Rim',
      panelLabel: 'Ball rim',
      visual: true,
      read: () => this.settings.controlBallRimEnabled,
      onChange: (checked) => this.updateSettings({ controlBallRimEnabled: checked }, false),
    }));

    const particleCount = el(this.selectSetting<number>({
      id: 'particles.count',
      card: 'particles',
      label: 'Count',
      panelLabel: 'Particle count',
      options: [0, 1, 3, 10, 30, 100, 200, 500, 1000, 2000, 5000, 10000].map(
        (count): [number, string] => [count, `${count}`],
      ),
      read: () => this.settings.particleCount,
      onChange: (value) => this.updateSettings({ particleCount: Number(value) }),
    }));
    const particleSize = el(this.rangeSetting({
      id: 'particles.size',
      card: 'particles',
      label: 'Size',
      panelLabel: 'Particle size',
      min: 2,
      max: PARTICLE_RADIUS_MAX,
      step: 1,
      slider: () => this.settings.particleRadius,
      format: () => `${this.settings.particleRadius}`,
      onInput: (value) => this.updateSettings({ particleRadius: value }),
      decorate: (control) => {
        this.particleSizeValueEls.add(control.value);
        this.syncParticleLoadValue();
        return () => this.particleSizeValueEls.delete(control.value);
      },
    }));
    const particleWeight = el(this.rangeSetting({
      id: 'particles.weight',
      card: 'particles',
      label: 'Weight',
      panelLabel: 'Particle weight',
      min: 0,
      max: LOG_UI_MAX,
      step: 1,
      slider: () => sliderFromParticleWeight(this.settings.particleMass),
      format: () => formatWeight(this.settings.particleMass),
      onInput: (value) => this.updateSettings({ particleMass: particleWeightFromSlider(value) }),
    }));
    const particleDamping = el(this.rangeSetting({
      id: 'particles.damping',
      card: 'particles',
      label: 'Damping',
      panelLabel: 'Particle damping',
      min: 0,
      max: DAMPING_UI_MAX,
      step: 1,
      slider: () => sliderFromDamping(this.settings.particleLinearDamping),
      format: () => formatDamping(this.settings.particleLinearDamping),
      onInput: (value) => this.updateSettings({ particleLinearDamping: dampingFromSlider(value) }),
    }));
    const particleColor = el(this.selectSetting<ParticlePalette>({
      id: 'particles.color',
      card: 'particles',
      label: 'Color',
      panelLabel: 'Particle color',
      visual: true,
      options: [
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
      read: () => this.settings.particlePalette,
      onChange: (value) => this.updateSettings({ particlePalette: value as ParticlePalette }, false),
    }));
    const particleRimWidth = el(this.rangeSetting({
      id: 'particles.rim',
      card: 'particles',
      label: 'Rim %',
      panelLabel: 'Particle rim %',
      visual: true,
      min: PARTICLE_RIM_WIDTH_MIN,
      max: PARTICLE_RIM_WIDTH_MAX,
      step: 5,
      slider: () => this.settings.particleRimWidth,
      format: () => `${this.settings.particleRimWidth}%`,
      onInput: (value) => this.updateSettings({ particleRimWidth: value }, false),
    }));
    const particleGlow = el(this.selectSetting<ParticleGlowMode>({
      id: 'particles.glow',
      card: 'particles',
      label: 'Glow',
      panelLabel: 'Glow',
      visual: true,
      options: [
        ['gold', 'Gold'],
        ['white', 'White'],
        ['cyan', 'Cyan'],
        ['pink', 'Pink'],
        ['red', 'Red'],
        ['green', 'Green'],
        ['rainbow', 'Rainbow'],
      ],
      read: () => this.settings.particleGlowMode,
      onChange: (value) => this.updateSettings({ particleGlowMode: value as ParticleGlowMode }, false),
    }));
    const particleBrightness = el(this.rangeSetting({
      id: 'particles.bright',
      card: 'particles',
      label: 'Bright',
      panelLabel: 'Bright',
      visual: true,
      min: 0,
      max: AUDIO_UI_MAX,
      step: 1,
      slider: () => sliderFromBrightnessResponse(this.settings.particleBrightnessResponse),
      format: () => formatBrightnessResponse(this.settings.particleBrightnessResponse),
      onInput: (value) => this.updateSettings({
        particleBrightnessResponse: brightnessResponseFromSlider(value),
      }, false),
    }));
    const particleVivid = el(this.rangeSetting({
      id: 'particles.vivid',
      card: 'particles',
      label: 'Vivid',
      panelLabel: 'Vivid',
      visual: true,
      min: 0,
      max: PARTICLE_GLOW_VIVIDNESS_MAX,
      step: 0.05,
      slider: () => this.settings.particleGlowVividness,
      format: () => formatVividness(this.settings.particleGlowVividness),
      onInput: (value) => this.updateSettings({ particleGlowVividness: value }, false),
    }));

    const wallBounce = el(this.rangeSetting({
      id: 'interaction.wallBounce',
      card: 'interaction',
      label: 'Wall Bounce',
      panelLabel: 'Wall Bounce',
      min: 0,
      max: 1,
      step: 0.01,
      slider: () => this.settings.wallRestitution,
      format: () => this.settings.wallRestitution.toFixed(2),
      onInput: (value) => this.updateSettings({ wallRestitution: value }),
    }));
    const contactBounce = el(this.rangeSetting({
      id: 'interaction.contactBounce',
      card: 'interaction',
      label: 'Contact Bounce',
      panelLabel: 'Contact Bounce',
      min: 0,
      max: 1,
      step: 0.01,
      slider: () => this.settings.contactRestitution,
      format: () => this.settings.contactRestitution.toFixed(2),
      onInput: (value) => this.updateSettings({ contactRestitution: value }),
    }));
    const friction = el(this.rangeSetting({
      id: 'interaction.friction',
      card: 'interaction',
      label: 'Friction',
      panelLabel: 'Friction',
      min: 0,
      max: 0.25,
      step: 0.005,
      slider: () => this.settings.controlBallFriction,
      format: () => this.settings.controlBallFriction.toFixed(3),
      onInput: (value) => this.updateSettings({
        controlBallFriction: value,
        particleFriction: value,
      }),
    }));

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

    audioBallPanel.append(...this.defineAudioVoiceControls('ball'));
    audioParticlePanel.append(...this.defineAudioVoiceControls('particle'));
    syncAudioPanel();

    const sound = el(this.toggleSetting({
      id: 'audio.sound',
      card: 'audio',
      label: 'Sound',
      panelLabel: 'Sound',
      read: () => this.settings.soundEnabled,
      onChange: (checked) => {
        this.updateSettings({ soundEnabled: checked }, false, false);
        this.audio.setEnabled(checked);
      },
    }));

    const debug = el(this.toggleSetting({
      id: 'utility.debug',
      card: 'utility',
      label: 'Debug',
      panelLabel: 'Debug',
      read: () => this.settings.debug,
      onChange: (checked) => {
        this.updateSettings({ debug: checked }, false, false);
        this.requirePhysics().setDiagnosticsEnabled(checked);
      },
    }));

    // Audio research comparison controls: session-only, not saved and not in presets.
    const triggerTest = el(this.selectSetting<TriggerTestMode>({
      id: 'utility.triggerTest',
      card: 'utility',
      label: 'Trigger Test',
      panelLabel: 'Trigger Test',
      title: 'Start-time spread for same-frame impact sounds (not saved)',
      options: TRIGGER_TEST_OPTIONS,
      read: () => this.triggerTestMode,
      onChange: (value) => {
        this.triggerTestMode = value as TriggerTestMode;
        this.audio.setTriggerTestMode(this.triggerTestMode);
      },
    }));
    const stealFade = el(this.selectSetting<StealFadeMs>({
      id: 'utility.stealFade',
      card: 'utility',
      label: 'Steal Fade',
      panelLabel: 'Steal Fade',
      title: 'Fade-out length for stolen voices, for comparison (not saved)',
      options: STEAL_FADE_OPTIONS,
      read: () => this.stealFadeMs,
      onChange: (value) => {
        this.stealFadeMs = Number(value) as StealFadeMs;
        this.audio.setStealFadeMs(this.stealFadeMs);
      },
    }));
    const attackTest = el(this.selectSetting<AttackTestMode>({
      id: 'utility.attack',
      card: 'utility',
      label: 'Attack',
      panelLabel: 'Attack',
      title: 'Attack ramp shape for new voices, for comparison (not saved)',
      options: ATTACK_TEST_OPTIONS,
      read: () => this.attackTestMode,
      onChange: (value) => {
        this.attackTestMode = value as AttackTestMode;
        this.audio.setAttackTestMode(this.attackTestMode);
      },
    }));
    const lookahead = el(this.selectSetting<LookaheadMs>({
      id: 'utility.lookahead',
      card: 'utility',
      label: 'Lookahead',
      panelLabel: 'Lookahead',
      title: 'Schedule voices this far ahead of the audio clock, for comparison (not saved)',
      options: LOOKAHEAD_OPTIONS,
      read: () => this.lookaheadMs,
      onChange: (value) => {
        this.lookaheadMs = Number(value) as LookaheadMs;
        this.audio.setLookaheadMs(this.lookaheadMs);
      },
    }));
    const copyDebug = el(this.actionControl({
      id: 'utility.copyDebug',
      card: 'utility',
      label: 'Copy Debug',
      panelLabel: 'Copy Debug',
      title: 'Copy current debug diagnostics',
      onClick: (button) => {
        void this.copyDebugText(button);
      },
    }));
    const reset = el(this.actionControl({
      id: 'utility.reset',
      card: 'utility',
      label: 'Reset',
      panelLabel: 'Reset',
      title: 'Reset scene with current settings and restart graphics',
      onClick: () => this.resetScene(),
    }));

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
      modeModel,
      modeLinking,
      linkOptions,
      modeGravity,
      modeGravityStrength,
    ], modePin);
    const ballGroup = createSettingsGroup('Ball', 'ball', [
      ballMode,
      ballSize,
      ballWeight,
      ballDamping,
      ballColor,
      ballRim,
    ], ballPin);
    const dotsGroup = createSettingsGroup('Particles', 'particles', [
      particleCount,
      particleSize,
      particleWeight,
      particleDamping,
      particleColor,
      particleRimWidth,
      particleGlow,
      particleBrightness,
      particleVivid,
    ], particlesPin);
    const interactionGroup = createSettingsGroup('Interaction', 'interaction', [
      wallBounce,
      contactBounce,
      friction,
    ], interactionPin);
    const audioGroup = createSettingsGroup('Audio', 'audio', [
      audioTabs,
      audioBallPanel,
      audioParticlePanel,
    ], [sound, audioPin]);
    const utilityGroup = createSettingsGroup('Utility', 'utility', [
      debug,
      triggerTest,
      stealFade,
      attackTest,
      lookahead,
      copyDebug,
      reset,
    ]);
    const myGroup = this.createMyPanelGroup();
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
    this.settingsCards = new Map<SettingsCardId, HTMLElement>([
      ['preset', presetGroup],
      ['my', myGroup],
      ['mode', modeGroup],
      ['ball', ballGroup],
      ['particles', dotsGroup],
      ['interaction', interactionGroup],
      ['audio', audioGroup],
      ['utility', utilityGroup],
    ]);

    this.syncUiFromSettings = () => {
      this.controls.syncAll();
      syncAudioPanel();
    };

    // My Panel copies need every definition, so load it after all controls exist.
    this.myPanelState = loadMyPanelState(this.controls.ids());
    this.renderMyPanel();

    panel.append(
      header,
      presetGroup,
      this.myPanelMarker,
      myGroup,
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
    this.setSettingsPanelOpen(false);

    this.debugEl = document.createElement('div');
    this.debugEl.className = 'debug';
    this.root.appendChild(this.debugEl);

    this.createFrontPresetBar();

    this.soundUnlockButton = document.createElement('button');
    this.soundUnlockButton.type = 'button';
    this.soundUnlockButton.className = 'sound-unlock-button';
    this.soundUnlockButton.textContent = 'Tap for sound';
    this.soundUnlockButton.hidden = true;
    this.soundUnlockButton.addEventListener('click', () => {
      this.audio.unlock();
    });
    this.root.appendChild(this.soundUnlockButton);

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

  private defineControl(definition: ControlDefinition) {
    const instance = this.controls.define(definition);
    this.attachPick(definition.id, definition.panelLabel, instance.element, this.cardPicks);
    return instance.element;
  }

  private rangeSetting(spec: RangeSettingSpec): ControlDefinition {
    return {
      id: spec.id,
      card: spec.card,
      kind: 'setting',
      panelLabel: spec.panelLabel,
      create: (label, changed) => {
        const control = createRange(label ?? spec.label, spec.min, spec.max, spec.step, spec.slider());
        control.value.textContent = spec.format();
        if (spec.visual) {
          control.wrap.classList.add('hud__control--visual');
        }
        control.input.addEventListener('input', () => {
          spec.onInput(Number(control.input.value));
          control.value.textContent = spec.format();
          changed();
        });
        const dispose = spec.decorate?.(control) ?? undefined;
        return {
          element: control.wrap,
          sync: () => {
            control.input.value = `${spec.slider()}`;
            control.value.textContent = spec.format();
          },
          dispose,
        };
      },
    };
  }

  private selectSetting<T extends string | number>(spec: SelectSettingSpec<T>): ControlDefinition {
    return {
      id: spec.id,
      card: spec.card,
      kind: 'setting',
      panelLabel: spec.panelLabel,
      create: (label, changed) => {
        const control = createTextSelect<T>(label ?? spec.label, spec.options, spec.read());
        syncSelectValue(control.input, spec.read());
        if (spec.visual) {
          control.wrap.classList.add('hud__control--visual');
        }
        if (spec.title) {
          control.input.title = spec.title;
        }
        control.input.addEventListener('change', () => {
          spec.onChange(control.input.value);
          changed();
        });
        return {
          element: control.wrap,
          sync: () => syncSelectValue(control.input, spec.read()),
        };
      },
    };
  }

  private toggleSetting(spec: ToggleSettingSpec): ControlDefinition {
    return {
      id: spec.id,
      card: spec.card,
      kind: 'setting',
      panelLabel: spec.panelLabel,
      create: (label, changed) => {
        const control = createToggle(label ?? spec.label, spec.read());
        if (spec.visual) {
          control.wrap.classList.add('hud__toggle--visual');
        }
        if (label === null && spec.primaryClassName) {
          control.wrap.classList.add(spec.primaryClassName);
        }
        const sync = () => {
          control.input.checked = spec.read();
          if (spec.enabled) {
            const enabled = spec.enabled();
            control.input.disabled = !enabled;
            control.wrap.classList.toggle('is-disabled', !enabled);
          }
        };
        control.input.addEventListener('change', () => {
          spec.onChange(control.input.checked);
          changed();
        });
        sync();
        return { element: control.wrap, sync };
      },
    };
  }

  private actionControl(spec: ActionControlSpec): ControlDefinition {
    return {
      id: spec.id,
      card: spec.card,
      kind: 'action',
      panelLabel: spec.panelLabel,
      create: (label) => {
        // The wrapper hosts the pick marker, which cannot be nested inside a button.
        const wrap = document.createElement('span');
        wrap.className = 'hud__action';
        if (label === null && spec.primaryClassName) {
          wrap.classList.add(spec.primaryClassName);
        }
        const button = document.createElement('button');
        button.className = 'hud__button';
        button.type = 'button';
        button.textContent = label ?? spec.label;
        button.title = spec.title;
        button.setAttribute('aria-label', spec.title);
        button.addEventListener('click', () => spec.onClick(button));
        wrap.append(button);
        return { element: wrap, sync: () => {} };
      },
    };
  }

  private defineAudioVoiceControls(voice: AudioPanelId) {
    const isBall = voice === 'ball';
    const prefix = isBall ? 'Ball' : 'Particle';
    const keys = isBall
      ? {
          waveform: 'audioBallWaveform',
          frequency: 'audioBallFrequencyHz',
          spread: 'audioBallFrequencySpread',
          duration: 'audioBallDurationMs',
        } as const
      : {
          waveform: 'audioParticleWaveform',
          frequency: 'audioParticleFrequencyHz',
          spread: 'audioParticleFrequencySpread',
          duration: 'audioParticleDurationMs',
        } as const;

    return [
      this.defineControl(this.selectSetting<AudioWaveform>({
        id: `audio.${voice}.wave`,
        card: 'audio',
        label: 'Wave',
        panelLabel: `${prefix} wave`,
        options: [
          ['sine', 'Sine'],
          ['triangle', 'Triangle'],
          ['sawtooth', 'Sawtooth'],
          ['square', 'Square'],
        ],
        read: () => this.settings[keys.waveform],
        onChange: (value) => this.updateSettings(
          { [keys.waveform]: value as AudioWaveform } as Partial<DotpingSettings>,
          false,
        ),
      })),
      this.defineControl(this.rangeSetting({
        id: `audio.${voice}.pitch`,
        card: 'audio',
        label: 'Pitch',
        panelLabel: `${prefix} pitch`,
        min: 0,
        max: AUDIO_UI_MAX,
        step: 1,
        slider: () => sliderFromAudioFrequency(this.settings[keys.frequency]),
        format: () => formatAudioFrequency(this.settings[keys.frequency]),
        onInput: (value) => this.updateSettings({
          [keys.frequency]: audioFrequencyFromSlider(value),
        } as Partial<DotpingSettings>, false),
      })),
      this.defineControl(this.rangeSetting({
        id: `audio.${voice}.spread`,
        card: 'audio',
        label: 'Spread',
        panelLabel: `${prefix} spread`,
        min: 0,
        max: AUDIO_UI_MAX,
        step: 1,
        slider: () => sliderFromAudioSpread(this.settings[keys.spread]),
        format: () => formatAudioSpread(this.settings[keys.spread]),
        onInput: (value) => this.updateSettings({
          [keys.spread]: audioSpreadFromSlider(value),
        } as Partial<DotpingSettings>, false),
      })),
      this.defineControl(this.rangeSetting({
        id: `audio.${voice}.length`,
        card: 'audio',
        label: 'Sound Len.',
        panelLabel: `${prefix} sound len.`,
        min: 0,
        max: AUDIO_UI_MAX,
        step: 1,
        slider: () => sliderFromAudioDuration(this.settings[keys.duration]),
        format: () => formatAudioDuration(this.settings[keys.duration]),
        onInput: (value) => this.updateSettings({
          [keys.duration]: audioDurationFromSlider(value),
        } as Partial<DotpingSettings>, false),
      })),
    ];
  }

  private attachPick(id: string, panelLabel: string, host: HTMLElement, picks: PickButton[]) {
    const button = attachPickButton(host, panelLabel, () => this.toggleMyPanelItem(id));
    picks.push({ id, button });
    this.syncPickButton(id, button);
  }

  private syncPickButton(id: string, button: HTMLButtonElement) {
    const picked = this.myPanelState.items.includes(id);
    const full = this.myPanelState.items.length >= MY_PANEL_MAX_ITEMS;
    const label = button.dataset.label ?? id;
    button.setAttribute('aria-pressed', `${picked}`);
    button.disabled = !picked && full;
    button.title = picked
      ? `Remove ${label} from My Panel`
      : full
        ? `My Panel is full (${MY_PANEL_MAX_ITEMS})`
        : `Add ${label} to My Panel`;
    button.setAttribute('aria-label', button.title);
  }

  private syncPickButtons() {
    for (const pick of [...this.cardPicks, ...this.myPanelPicks]) {
      this.syncPickButton(pick.id, pick.button);
    }
  }

  private createMyPanelGroup() {
    const pin = document.createElement('button');
    pin.className = 'hud__button hud__pin-button';
    pin.type = 'button';
    pin.addEventListener('click', () => {
      this.togglePinnedGroup('my');
    });
    this.myPanelPinButton = pin;

    const restoreDefault = document.createElement('button');
    restoreDefault.className = 'hud__button hud__pin-button';
    restoreDefault.type = 'button';
    restoreDefault.textContent = 'Default';
    restoreDefault.title = 'Restore the default My Panel items';
    restoreDefault.setAttribute('aria-label', restoreDefault.title);
    restoreDefault.addEventListener('click', () => {
      this.myPanelState = restoreDefaultMyPanelItems(this.controls.ids());
      saveMyPanelState(this.myPanelState);
      this.renderMyPanel();
    });

    const items = document.createElement('div');
    items.className = 'hud__my-items';
    this.myPanelItemsEl = items;

    const hint = document.createElement('p');
    hint.className = 'hud__my-hint';
    hint.textContent = `Tap the dot at the left of a setting to add it here (up to ${MY_PANEL_MAX_ITEMS}).`;
    this.myPanelHintEl = hint;

    const group = createSettingsGroup('My Panel', 'my', [hint, items], [restoreDefault, pin]);
    this.myPanelEl = group;
    return group;
  }

  private renderMyPanel() {
    const itemsEl = this.myPanelItemsEl;
    if (!itemsEl) {
      return;
    }

    for (const instance of this.myPanelInstances) {
      this.controls.release(instance);
    }
    this.myPanelInstances = [];
    this.myPanelPicks = [];
    itemsEl.replaceChildren();

    let actionRow: HTMLDivElement | null = null;
    for (const id of this.myPanelState.items) {
      const definition = this.controls.definition(id);
      if (!definition) {
        continue;
      }
      const instance = this.controls.createInstance(id, definition.panelLabel);
      // Shows the item's label in its source card's colour.
      instance.element.dataset.source = definition.card;
      this.myPanelInstances.push(instance);
      this.attachPick(id, definition.panelLabel, instance.element, this.myPanelPicks);
      if (definition.kind === 'action') {
        // Neighbouring buttons such as Flash and Name share one row.
        if (!actionRow) {
          actionRow = document.createElement('div');
          actionRow.className = 'hud__my-actions';
          itemsEl.append(actionRow);
        }
        actionRow.append(instance.element);
      } else {
        actionRow = null;
        itemsEl.append(instance.element);
      }
    }

    const count = this.myPanelState.items.length;
    if (this.myPanelHintEl) {
      this.myPanelHintEl.hidden = count > 0;
    }
    itemsEl.hidden = count <= 0;
    this.syncParticleLoadValue();
    this.syncPickButtons();
    this.applySettingsTab();
    this.applyPinnedSettingsPlacement();
  }

  private toggleMyPanelItem(id: string) {
    const next = toggleMyPanelItem(this.myPanelState, id);
    if (next === this.myPanelState) {
      return;
    }
    this.myPanelState = next;
    saveMyPanelState(this.myPanelState);
    this.renderMyPanel();
  }

  private setSettingsTab(tab: SettingsTabId) {
    this.activeSettingsTab = tab;
    saveSettingsTab(tab);
    this.applySettingsTab();
    if (this.hudEl) {
      this.hudEl.scrollTop = 0;
    }
  }

  private applySettingsTab() {
    const tab = this.activeSettingsTab;
    const count = this.myPanelState.items.length;
    for (const [card, element] of this.settingsCards) {
      element.classList.toggle('is-tab-hidden', !isCardVisibleInTab(card, tab, count));
    }
    this.hudEl?.classList.toggle('hud--single', tab !== 'all');
    this.settingsTabs?.select(tab);
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

    // Touch pointerdown does not grant user activation; touch pointerup does.
    canvas.addEventListener('pointerup', (event) => {
      this.audio.unlock();
      this.lastCanvasUnlockAttemptAt = performance.now();
      this.releasePointer(event);
    });

    // A tap on any Settings control also carries activation; start audio right
    // there instead of waiting for the next canvas touch.
    const unlockFromPage = () => this.audio.unlock();
    for (const type of ['pointerup', 'click', 'keydown']) {
      document.addEventListener(type, unlockFromPage, { capture: true });
    }
    canvas.addEventListener('pointercancel', (event) => this.releasePointer(event));

    // iPadOS shows its text loupe on long press even with user-select: none.
    // Pointer events still fire after the touch default is cancelled.
    canvas.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });

    window.addEventListener('resize', () => {
      const renderer = this.requireRenderer();
      renderer.resize();
      this.applyViewScale();
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
    const scaleX = this.requireRenderer().width / rect.width / this.view.scale;
    const scaleY = this.requireRenderer().height / rect.height / this.view.scale;
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
    const width = Math.max(Math.floor(this.view.worldWidth), 1);
    const height = Math.max(Math.floor(this.view.worldHeight), 1);
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
    if (this.particleSizeValueEls.size <= 0) {
      return;
    }

    const load = estimateParticleLoad({
      width: this.view.worldWidth,
      height: this.view.worldHeight,
      particleCount: this.settings.particleCount,
      particleRadius: this.settings.particleRadius,
    });
    const title = particleLoadTitle(load);
    for (const valueEl of this.particleSizeValueEls) {
      for (const className of PARTICLE_LOAD_VALUE_CLASSES) {
        valueEl.classList.remove(className);
      }
      if (load.level !== 'normal') {
        valueEl.classList.add(`hud__value--load-${load.level}`);
      }
      valueEl.title = title;
    }
  }

  private screenViewport(): Viewport {
    const renderer = this.requireRenderer();
    return { width: renderer.width, height: renderer.height };
  }

  // The preset's design screen as it is recorded on Save and Export: the
  // current world size (the browser size in `1:1`).
  private worldViewport(): Viewport {
    return { width: this.view.worldWidth, height: this.view.worldHeight };
  }

  private computeView() {
    return computeViewScale(this.screenViewport(), this.designViewport, this.viewScaleMode);
  }

  // Recomputes the world size after a resize, a mode change or a new design
  // screen. `1:1` keeps today's clamp-on-resize behaviour; `Fit` maps bodies
  // proportionally so the scene keeps its layout.
  private applyViewScale() {
    const previous = this.view;
    const next = this.computeView();
    this.view = next;
    this.requireRenderer().setViewScale(next.scale);
    if (
      this.physics
      && (previous.worldWidth !== next.worldWidth || previous.worldHeight !== next.worldHeight)
    ) {
      this.physics.resize(next.worldWidth, next.worldHeight, previous.mode === 'fit' || next.mode === 'fit');
    }
    this.syncParticleLoadValue();
    this.syncViewScaleButton();
  }

  private setViewScaleMode(mode: ViewScaleMode) {
    this.viewScaleMode = mode;
    saveViewScaleMode(mode);
    this.applyViewScale();
  }

  private syncViewScaleButton() {
    const button = this.viewScaleButton;
    if (!button || !this.renderer) {
      return;
    }

    const fit = this.view.mode === 'fit';
    button.replaceChildren();
    const mode = document.createElement('span');
    mode.className = 'view-scale-button__mode';
    mode.textContent = fit ? 'Fit' : '1:1';
    button.appendChild(mode);
    if (fit) {
      const factor = document.createElement('span');
      factor.className = 'view-scale-button__factor';
      factor.textContent = `×${this.view.scale.toFixed(2)}`;
      button.appendChild(factor);
    }
    button.classList.toggle('view-scale-button--fit', fit);
    button.setAttribute('aria-pressed', `${fit}`);
    const title = viewScaleTitle(this.view, this.designViewport, this.screenViewport());
    button.title = title;
    button.setAttribute('aria-label', title);
  }

  private setSettingsPanelOpen(open: boolean) {
    this.hudEl?.classList.toggle('hud--open', open);
    this.settingsButton?.setAttribute('aria-expanded', `${open}`);
    this.applyPinnedSettingsPlacement();
    this.syncPresetSelectSelection();
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
    this.activePinnedGroupId =
      id === 'my' || (id && this.pinnableGroups.some((group) => group.id === id))
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

    const myPanel = this.myPanelEl;
    const restore = (marker: Comment, element: HTMLElement) => {
      const parent = marker.parentNode;
      if (parent && marker.nextSibling !== element) {
        parent.insertBefore(element, marker.nextSibling);
      }
    };
    if (myPanel) {
      restore(this.myPanelMarker, myPanel);
    }
    for (const group of this.pinnableGroups) {
      restore(group.marker, group.element);
    }

    const pinnedGroup = this.pinnableGroups.find(
      (group) => group.id === this.activePinnedGroupId,
    );
    const showPinnedGroup = Boolean(pinnedHost && pinnedGroup && !settingsOpen);
    // One pin slot: My Panel or one card, never both.
    const myPanelPinned = this.activePinnedGroupId === 'my';
    const showMyPanel = Boolean(
      pinnedHost &&
      myPanel &&
      !settingsOpen &&
      myPanelPinned &&
      this.myPanelState.items.length > 0,
    );

    if (pinnedHost) {
      pinnedHost.hidden = !showPinnedGroup && !showMyPanel;
      if (showMyPanel && myPanel) {
        pinnedHost.appendChild(myPanel);
      }
      if (showPinnedGroup && pinnedGroup) {
        pinnedHost.dataset.group = pinnedGroup.id;
        pinnedHost.appendChild(pinnedGroup.element);
      } else {
        delete pinnedHost.dataset.group;
      }
    }

    myPanel?.classList.toggle('hud__group--pinned', showMyPanel);
    if (this.myPanelPinButton) {
      this.myPanelPinButton.textContent = myPanelPinned ? 'Pinned' : 'Pin';
      this.myPanelPinButton.title = myPanelPinned ? 'Unpin My Panel' : 'Pin My Panel to front';
      this.myPanelPinButton.setAttribute('aria-label', this.myPanelPinButton.title);
      this.myPanelPinButton.setAttribute('aria-pressed', `${myPanelPinned}`);
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
        onFrontMenuChange: (visible) => {
          this.setFrontPresetBarVisible(visible);
        },
      },
      this.userPresets,
      this.activePresetValue,
      this.frontPresetBarVisible,
    );
    this.defineControl(this.presetSelectControl(this.presetPanel));
    return this.presetPanel.element;
  }

  private createFrontPresetBar() {
    const bar = new FrontPresetBar({
      onPresetChange: (value) => {
        this.applySelectedPreset(value);
      },
      onStep: (step) => {
        this.stepPreset(step);
      },
    });
    bar.visible = this.frontPresetBarVisible;
    this.frontPresetBar = bar;
    this.root.appendChild(bar.element);
    this.syncPresetSelectSelection();
  }

  private setFrontPresetBarVisible(visible: boolean) {
    this.frontPresetBarVisible = visible;
    saveFrontPresetBarVisible(visible);
    if (this.frontPresetBar) {
      this.frontPresetBar.visible = visible;
    }
    if (this.presetPanel) {
      this.presetPanel.frontMenuVisible = visible;
    }
  }

  private stepPreset(step: PresetStep) {
    const value = stepPresetValue(
      presetBrowseOrder(this.userPresets),
      this.activePresetValue,
      this.lastAppliedPresetValue,
      step,
    );
    if (value) {
      this.applySelectedPreset(value);
    }
  }

  private presetSelectControl(presetPanel: PresetPanel): ControlDefinition {
    return {
      id: 'preset.select',
      card: 'preset',
      kind: 'setting',
      panelLabel: 'Preset',
      create: (label) => {
        // The Preset card keeps its own select; it syncs through PresetPanel.
        if (label === null) {
          return { element: presetPanel.selectRow, sync: () => {} };
        }

        const control = createTextSelect<string>(label, [], '');
        let optionsVersion = -1;
        const sync = () => {
          if (optionsVersion !== presetPanel.optionsVersion) {
            fillPresetOptions(control.input, this.userPresets);
            optionsVersion = presetPanel.optionsVersion;
          }
          syncPresetSelectValue(control.input, this.activePresetValue);
        };
        control.input.addEventListener('change', () => {
          this.applySelectedPreset(control.input.value);
        });
        sync();
        return { element: control.wrap, sync };
      },
    };
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

    this.designViewport = this.designViewportForPresetValue(value);
    this.applyViewScale();
    this.applyPreset(preset, value, this.initialFormationForPresetValue(value));
  }

  private designViewportForPresetValue(value: string): Viewport {
    if (value.startsWith('user:')) {
      const index = Number(value.slice('user:'.length));
      return this.userPresets[index]?.designViewport ?? DEFAULT_DESIGN_VIEWPORT;
    }

    return DEFAULT_DESIGN_VIEWPORT;
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
    this.lastAppliedPresetValue = selectedValue;
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
      this.worldViewport(),
    );
    this.designViewport = this.userPresets[index]?.designViewport ?? this.designViewport;
    this.syncViewScaleButton();
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
      this.worldViewport(),
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
    this.controls.syncId('preset.select');
    this.frontPresetBar?.sync(
      this.activePresetValue,
      this.userPresets,
      this.presetPanel.optionsVersion,
    );
  }

  private setPresetStatus(status: string) {
    this.presetPanel?.setStatus(status);
  }

  private updateSoundUnlockButton(now: number) {
    if (!this.soundUnlockButton) {
      return;
    }
    const visible = shouldShowSoundUnlock({
      soundEnabled: this.settings.soundEnabled,
      contextState: this.audio.contextState,
      lastCanvasAttemptAt: this.lastCanvasUnlockAttemptAt,
      now,
    });
    if (this.soundUnlockButton.hidden === visible) {
      this.soundUnlockButton.hidden = !visible;
    }
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
      ? createAudioDebugLines(this.audio.getDiagnostics(), this.debugProfile, deltaSeconds)
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
      view: this.view,
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

function syncSelectValue(select: HTMLSelectElement, value: string | number) {
  const nextValue = `${value}`;
  for (const option of Array.from(select.options)) {
    if (option.dataset.generated === 'true' && option.value !== nextValue) {
      option.remove();
    }
  }
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

  if (debugVisibleFromParams(params)) {
    settings.debug = true;
  }

  return settings;
}
