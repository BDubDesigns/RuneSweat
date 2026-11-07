/**
 * YouVille's intentionally small, gender-free appearance model.
 *
 * The creator holds this object in memory for the first phone playtest.
 * Do not persist it under RuneSweat's legacy localStorage key; a future
 * authenticated API will store the same IDs in the independent DB.
 */
export const SKIN_TONES = [
  '#f6dec5',
  '#edc4a0',
  '#dca77c',
  '#c88d64',
  '#b47753',
  '#965e3d',
  '#794a31',
  '#5e3829',
  '#472b22',
  '#30201c',
] as const;

export const HAIRSTYLES = [
  'buzz',
  'short',
  'curls',
  'coils',
  'braids',
  'locs',
  'long',
] as const;

export const SHIRT_COLORS = [
  '#6694a9',
  '#b56c87',
  '#e0aa56',
  '#6d9c78',
  '#8d76b1',
  '#f0f0dc',
] as const;

export type SkinTone = (typeof SKIN_TONES)[number];
export type Hairstyle = (typeof HAIRSTYLES)[number];
export type ShirtColor = (typeof SHIRT_COLORS)[number];

export interface AvatarAppearance {
  skinTone: SkinTone;
  hairstyle: Hairstyle;
  shirtColor: ShirtColor;
}

export type AppearanceCategory = keyof AvatarAppearance;

export const STARTER_APPEARANCE: Readonly<AvatarAppearance> = {
  skinTone: '#5e3829',
  hairstyle: 'coils',
  shirtColor: '#6694a9',
};

/** Safe creator preview: changing an option does not mutate previous state. */
export function withAppearanceChoice<K extends AppearanceCategory>(
  appearance: AvatarAppearance,
  category: K,
  choice: AvatarAppearance[K],
): AvatarAppearance {
  return { ...appearance, [category]: choice };
}

/**
 * Validates untrusted selections (including future saved/API data) against
 * curated renderable assets. It never infers race, gender or appearance
 * from the camera.
 */
export function isAppearanceChoice(
  category: AppearanceCategory,
  value: unknown,
): boolean {
  if (typeof value !== 'string') return false;
  switch (category) {
    case 'skinTone':
      return (SKIN_TONES as readonly string[]).includes(value);
    case 'hairstyle':
      return (HAIRSTYLES as readonly string[]).includes(value);
    case 'shirtColor':
      return (SHIRT_COLORS as readonly string[]).includes(value);
  }
}
