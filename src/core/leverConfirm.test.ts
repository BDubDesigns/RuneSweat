import { describe, expect, it } from 'vitest';
import type { ArmState } from './bodyState';
import { LeverConfirmDetector } from './leverConfirm';

function arm(angleDeg: number, extended = true): ArmState {
  return {
    side: 'right',
    raised: false,
    extended,
    angleDeg,
    angleDegRaw: angleDeg,
    lengthTorsoFrac: 1.1,
  };
}

function ready(detector: LeverConfirmDetector): void {
  expect(detector.update(arm(90), 'blue', 0)).toBeNull();
  expect(detector.update(arm(92), 'blue', 200)).toBeNull();
  expect(detector.snapshot().phase).toBe('armed');
}

describe('LeverConfirmDetector', () => {
  it('confirms the hovered choice only after a horizontal hold and deliberate downward pull', () => {
    const d = new LeverConfirmDetector();
    ready(d);
    expect(d.update(arm(125), 'blue', 260)).toBeNull();
    expect(d.update(arm(160), 'blue', 330)).toBeNull();
    expect(d.update(arm(166), 'blue', 470)).toBe('blue');
    expect(d.snapshot().phase).toBe('latched');
  });

  it('freezes the hovered item when the lever first moves', () => {
    const d = new LeverConfirmDetector();
    ready(d);
    d.update(arm(125), 'curly', 260);
    d.update(arm(160), 'straight', 330);
    expect(d.update(arm(165), 'bald', 470)).toBe('curly');
  });

  it('does not double-fire until the arm is lifted and held sideways again', () => {
    const d = new LeverConfirmDetector();
    ready(d);
    d.update(arm(125), 'skin', 260);
    d.update(arm(160), 'skin', 330);
    expect(d.update(arm(160), 'skin', 470)).toBe('skin');
    expect(d.update(arm(160), 'skin', 590)).toBeNull();
    expect(d.update(arm(90), 'hair', 700)).toBeNull();
    expect(d.update(arm(90), 'hair', 920)).toBeNull();
    expect(d.snapshot().phase).toBe('armed');
    d.update(arm(125), 'hair', 960);
    d.update(arm(160), 'hair', 1010);
    expect(d.update(arm(160), 'hair', 1140)).toBe('hair');
  });

  it('does not commit when no item was highlighted as the pull started', () => {
    const d = new LeverConfirmDetector();
    ready(d);
    d.update(arm(125), null, 260);
    d.update(arm(160), 'some-item', 330);
    expect(d.update(arm(160), 'some-item', 470)).toBeNull();
  });

  it('ignores one-frame jump from horizontal straight to vertical', () => {
    const d = new LeverConfirmDetector();
    ready(d);
    expect(d.update(arm(175), 'blue', 250)).toBeNull();
    expect(d.update(arm(175), 'blue', 500)).toBeNull();
  });

  it('requires an extended arm and stable horizontal pose before arming', () => {
    const d = new LeverConfirmDetector();
    d.update(arm(90, false), 'blue', 0);
    d.update(arm(130), 'blue', 200);
    expect(d.snapshot().phase).toBe('idle');
    d.update(arm(90), 'blue', 250);
    d.update(arm(90), 'blue', 280);
    expect(d.snapshot().phase).toBe('arming');
  });

  it('resets on lost tracking and refuses stale or non-monotonic frames', () => {
    const d = new LeverConfirmDetector();
    ready(d);
    d.update(arm(125), 'blue', 260);
    expect(d.update(null, 'blue', 290)).toBeNull();
    expect(d.snapshot().phase).toBe('idle');
    d.update(arm(90), 'blue', 500);
    expect(d.update(arm(160), 'blue', 500)).toBeNull();
    expect(d.snapshot().phase).toBe('arming');
  });

  it('rejects a wrist identity/sign flip mid-pull', () => {
    const d = new LeverConfirmDetector();
    ready(d);
    d.update(arm(125), 'blue', 260);
    d.update(arm(-130), 'blue', 300);
    expect(d.snapshot().phase).toBe('idle');
    expect(d.update(arm(-170), 'blue', 490)).toBeNull();
  });

  it('can handle a lever arm extending to camera-left', () => {
    const d = new LeverConfirmDetector();
    d.update(arm(-90), 'locs', 0);
    d.update(arm(-90), 'locs', 200);
    d.update(arm(-125), 'locs', 260);
    d.update(arm(-160), 'locs', 330);
    expect(d.update(arm(-165), 'locs', 470)).toBe('locs');
  });

  it('cancels slow or reversed partial pulls', () => {
    const d = new LeverConfirmDetector();
    ready(d);
    d.update(arm(125), 'blue', 260);
    d.update(arm(90), 'blue', 350);
    expect(d.snapshot().phase).toBe('armed');
    d.update(arm(125), 'blue', 400);
    expect(d.update(arm(160), 'blue', 1900)).toBeNull();
  });
});
