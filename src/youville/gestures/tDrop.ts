/**
 * T-drop door gesture.
 *
 * Hold both arms horizontally (a T) long enough to be a deliberate
 * start pose, then bring BOTH arms down beside the body inside a
 * finite window and hold them there briefly. Standing with arms down
 * never arms it; a one-armed drop, a half-T and a slow drift all
 * time out. After firing it latches until a fresh T is held.
 */
import type { ArmState, BodyState } from '../../core/bodyState';
import { T_DROP } from '../config';
import type { GestureRecognizer } from '../interaction';

type Phase = 'idle' | 'holding' | 'armed' | 'dropping' | 'latched';

function horizontal(arm: ArmState): boolean {
  const a = Math.abs(arm.angleDeg);
  return (
    arm.extended &&
    a >= T_DROP.horizontalMinDeg &&
    a <= T_DROP.horizontalMaxDeg
  );
}

function isDown(arm: ArmState): boolean {
  return Math.abs(arm.angleDeg) >= T_DROP.downMinDeg;
}

export class TDropRecognizer implements GestureRecognizer {
  public readonly id = 't-drop' as const;

  private phase: Phase = 'idle';
  private sinceMs = 0;
  private leftTMs = 0;
  private downSinceMs: number | null = null;
  private asymmetricSinceMs: number | null = null;
  private lastStepMs: number | null = null;

  public reset(): void {
    this.phase = 'idle';
    this.downSinceMs = null;
    this.asymmetricSinceMs = null;
    this.lastStepMs = null;
  }

  public debugPhase(): string {
    return this.phase;
  }

  public update(body: BodyState | null, nowMs: number): boolean {
    if (
      body === null ||
      !body.present ||
      !body.bodyUsable ||
      !Number.isFinite(nowMs)
    ) {
      this.reset();
      return false;
    }
    if (this.lastStepMs !== null && nowMs <= this.lastStepMs) return false;
    this.lastStepMs = nowMs;

    const l = body.leftArm;
    const r = body.rightArm;
    // A real T has the arms on opposite sides of the body.
    const t =
      horizontal(l) &&
      horizontal(r) &&
      Math.sign(l.angleDeg) !== Math.sign(r.angleDeg);
    const bothDown = isDown(l) && isDown(r);

    switch (this.phase) {
      case 'latched':
        if (t) {
          this.phase = 'holding';
          this.sinceMs = nowMs;
        } else if (!bothDown) {
          this.phase = 'idle';
        }
        return false;
      case 'idle':
        if (t) {
          this.phase = 'holding';
          this.sinceMs = nowMs;
        }
        return false;
      case 'holding':
        if (!t) {
          this.phase = 'idle';
        } else if (nowMs - this.sinceMs >= T_DROP.holdMs) {
          this.phase = 'armed';
        }
        return false;
      case 'armed':
        if (t) return false;
        this.phase = 'dropping';
        this.leftTMs = nowMs;
        this.downSinceMs = null;
        this.asymmetricSinceMs = null;
        return this.dropping(l, r, bothDown, nowMs);
      case 'dropping':
        if (t) {
          // Arms came back out: the hold restarts from scratch.
          this.phase = 'holding';
          this.sinceMs = nowMs;
          return false;
        }
        return this.dropping(l, r, bothDown, nowMs);
    }
  }

  private dropping(
    l: ArmState,
    r: ArmState,
    bothDown: boolean,
    nowMs: number,
  ): boolean {
    if (nowMs - this.leftTMs > T_DROP.dropMaxMs) {
      this.phase = 'idle';
      return false;
    }
    // One arm still out while the other fell = an accidental drop.
    if (horizontal(l) !== horizontal(r)) {
      this.asymmetricSinceMs ??= nowMs;
      if (nowMs - this.asymmetricSinceMs > T_DROP.asymmetryMs) {
        this.phase = 'idle';
        return false;
      }
    } else {
      this.asymmetricSinceMs = null;
    }
    if (!bothDown) {
      this.downSinceMs = null;
      return false;
    }
    this.downSinceMs ??= nowMs;
    if (nowMs - this.downSinceMs < T_DROP.downHoldMs) return false;
    this.phase = 'latched';
    return true;
  }
}
