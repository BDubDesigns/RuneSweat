import { describe, expect, it } from 'vitest';
import {
  HAIRSTYLES,
  isAppearanceChoice,
  SHIRT_COLORS,
  SKIN_TONES,
  STARTER_APPEARANCE,
  withAppearanceChoice,
} from './avatarAppearance';

describe('YouVille avatar appearance model', () => {
  it('starts with a darker skin tone and no gender field', () => {
    expect(STARTER_APPEARANCE.skinTone).toBe('#5e3829');
    expect(Object.keys(STARTER_APPEARANCE).sort()).toEqual([
      'hairstyle',
      'shirtColor',
      'skinTone',
    ]);
  });

  it('offers a range of skin tones, hairstyles/textures and outfit colors', () => {
    expect(SKIN_TONES).toHaveLength(10);
    expect(new Set(SKIN_TONES).size).toBe(SKIN_TONES.length);
    expect(HAIRSTYLES).toContain('coils');
    expect(HAIRSTYLES).toContain('locs');
    expect(HAIRSTYLES).toContain('braids');
    expect(SHIRT_COLORS.length).toBeGreaterThanOrEqual(5);
  });

  it('updates a single choice without mutating the previous preview', () => {
    const original = { ...STARTER_APPEARANCE };
    const updated = withAppearanceChoice(original, 'hairstyle', 'locs');
    expect(updated.hairstyle).toBe('locs');
    expect(updated.skinTone).toBe(original.skinTone);
    expect(original.hairstyle).toBe('coils');
  });

  it('rejects arbitrary strings and unknown color identifiers', () => {
    expect(isAppearanceChoice('skinTone', '#30201c')).toBe(true);
    expect(isAppearanceChoice('skinTone', 'not-a-color')).toBe(false);
    expect(isAppearanceChoice('hairstyle', 'coils')).toBe(true);
    expect(isAppearanceChoice('hairstyle', '<svg>')).toBe(false);
    expect(isAppearanceChoice('shirtColor', 123)).toBe(false);
  });
});
