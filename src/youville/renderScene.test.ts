import { describe, expect, it } from 'vitest';
import { renderScene } from './art/renderScene';
import { drawRoomStatic } from './art/roomArt';
import { WORLD } from './config';
import { ROOMS } from './rooms';
import { YouVilleSession } from './session';
import { HAIRSTYLES } from '../creator/avatarAppearance';

/** A no-op 2D context that records fill colours and text, and never throws. */
function fakeContext(): {
  ctx: CanvasRenderingContext2D;
  fills: string[];
  texts: string[];
} {
  const fills: string[] = [];
  const texts: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get: (target, prop: string) => {
      if (prop === 'measureText') return (t: string) => ({ width: t.length * 7 });
      if (prop === 'fill') return () => { fills.push(String(target.fillStyle)); };
      if (prop === 'fillRect') return () => { fills.push(String(target.fillStyle)); };
      if (prop === 'fillText') return (t: string) => { texts.push(t); };
      if (prop in target) return target[prop];
      return () => undefined;
    },
    set: (target, prop: string, value: unknown) => {
      target[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, texts };
}

const info = {
  nowMs: 1000,
  cameraOn: false,
  banner: null,
  landmarks: null,
  debug: false,
  debugLines: [],
} as const;

describe('renderScene (smoke)', () => {
  it('draws the bedroom with the closet-door hint and fade overlay without throwing', () => {
    const s = new YouVilleSession();
    const rec = fakeContext();
    expect(() => { renderScene(rec.ctx, s, info); }).not.toThrow();
    expect(rec.texts.join(' ')).toContain('Your Room');
    expect(rec.texts.join(' ')).toContain('closet');
  });

  it('draws the closet creator: every category, Done, and the chosen colours', () => {
    const s = new YouVilleSession();
    s.pressEnter(0); // not near the door: no-op
    s.creator.enter();
    s.roomId = 'closet';
    const rec = fakeContext();
    renderScene(rec.ctx, s, { ...info, cameraOn: true });
    const text = rec.texts.join(' ');
    expect(text).toContain('Skin tone');
    expect(text).toContain('Hair');
    expect(text).toContain('Shirt');
    expect(text).toContain('Done');
    // The avatar's real skin tone and shirt color are painted, not just stored.
    expect(rec.fills).toContain(s.appearance.skinTone);
    expect(rec.fills).toContain(s.appearance.shirtColor);
  });

  it('every hairstyle and every room draws', () => {
    for (const hairstyle of HAIRSTYLES) {
      const s = new YouVilleSession({ ...new YouVilleSession().appearance, hairstyle });
      expect(() => { renderScene(fakeContext().ctx, s, info); }).not.toThrow();
    }
    for (const room of Object.values(ROOMS)) {
      expect(() => { drawRoomStatic(fakeContext().ctx, room); }).not.toThrow();
    }
  });

  it('fade overlay paints the whole world while the transition runs', () => {
    const s = new YouVilleSession();
    s.transition.begin({ toRoom: 'closet', spawnX: 222 });
    s.transition.update(400);
    const rec = fakeContext();
    renderScene(rec.ctx, s, info);
    expect(rec.fills.some((f) => f.startsWith('rgba(14, 10, 22'))).toBe(true);
    expect(WORLD.width).toBe(960);
  });
});
