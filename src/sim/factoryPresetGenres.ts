// Genres of the factory presets (user decision 2026-11-22, from the user's
// `dotping-preset-genres.json` in usr_data, not tracked). The drop-down shows
// one group per genre, in this order. Each factory preset belongs to exactly
// one genre, and `factoryPresetData.ts` lists the presets in the same order, so
// the factory numbers run from top to bottom. The genres mix purpose and look
// on purpose: a first, provisional tidy-up.
// `labelJa` is the user's own name for the genre; the UI shows `label` (English,
// like the rest of the UI). Spec: `Proposed Factory Preset Genres (2026-11-22)`.

export type FactoryPresetGenre = {
  label: string;
  labelJa: string;
  // Preset names as written in `factoryPresetData.ts`, in list order.
  presets: readonly string[];
};

export const FACTORY_PRESET_GENRES: readonly FactoryPresetGenre[] = [
  {
    label: 'Basics',
    labelJa: '基本形',
    presets: ['Hello Ping', 'Blue Sand 2K', 'Hello Tama', 'Glow Star 1K', 'Many-Colored Fish'],
  },
  {
    label: 'Watch',
    labelJa: '鑑賞系',
    presets: [
      'Colorful Beans',
      'Avalanche Breakdown',
      'Glow Sparkle',
      'Pink Black Hole',
      'Chromatic Objects',
      'Red Typhoon',
      'Laser Star',
    ],
  },
  {
    label: 'Synth',
    labelJa: '音声合成系',
    presets: ['Red Fire Synth', 'Jelly Synth', 'Pink Sand Scratch', '宇宙波'],
  },
  {
    label: 'Instruments',
    labelJa: '楽器系',
    presets: ['ラピスグラス', 'たまンブリン', 'Pong Kira Music', 'Springy Yellow Python'],
  },
  {
    label: 'Toys',
    labelJa: 'Toy系',
    presets: [
      'Tama Spinner',
      'Star Chenille',
      'Gyu-Pang☆',
      'おれんじブリブリ',
      '電子雲',
      'Momiji Star',
      'Jelly Red Spark',
      'ぱすてるれっど',
    ],
  },
  {
    label: 'Creatures',
    labelJa: '生物鑑賞系',
    presets: [
      'Playful Fish',
      'Nishiki Goi',
      'Linked Fish',
      'School of Fish',
      'Snake Playing with a Ball',
      'Snake Playtime',
      'Fish among the Pastel Balls',
      'Black Shoal',
    ],
  },
  {
    label: 'Art',
    labelJa: 'アート作成系',
    presets: ['Pink Sand ART'],
  },
  {
    label: 'AI-made',
    labelJa: 'AI作成系',
    presets: [
      '🤖 Giant Rings',
      '🤖 Snow Footprints',
      '🤖 Star Slalom',
      '🤖 Green Vine',
      '🤖 Wind Chimes',
      '🤖 Lone Comet',
    ],
  },
];

// Fallback group for a factory preset that no genre names (not expected; the
// tests check that every preset has a genre).
export const FACTORY_PRESET_GENRE_FALLBACK = 'Factory Presets';

export function factoryPresetGenreLabel(name: string): string {
  return FACTORY_PRESET_GENRES.find((genre) => genre.presets.includes(name))?.label
    ?? FACTORY_PRESET_GENRE_FALLBACK;
}
