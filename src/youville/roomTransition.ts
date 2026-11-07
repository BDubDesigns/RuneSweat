/**
 * The one reusable room transition, used by every doorway:
 *
 *   enter intent -> input disabled -> fade old room out -> switch room
 *   + spawn point (while fully covered) -> fade new room in -> input
 *   restored.
 *
 * Pure and time-driven (`update(dtMs)`), so fade progression is unit
 * testable without a browser. Rapid or interrupted intents while a
 * transition is running are rejected, not queued: exactly one
 * transition runs per accepted intent.
 */
import { TRANSITION } from './config';
import type { RoomId } from './rooms';

export type TransitionPhase = 'idle' | 'fadingOut' | 'holding' | 'fadingIn';

export interface TransitionPlan {
  toRoom: RoomId;
  spawnX: number;
}

export interface TransitionUpdate {
  /** Set exactly once per transition, on the frame the room must switch. */
  switchTo: TransitionPlan | null;
  /** True on the frame the transition finished and input is restored. */
  finished: boolean;
}

const NOTHING: TransitionUpdate = { switchTo: null, finished: false };

export class RoomTransition {
  private current: TransitionPhase = 'idle';
  private elapsedMs = 0;
  private plan: TransitionPlan | null = null;

  public get phase(): TransitionPhase {
    return this.current;
  }

  /** Input must be ignored whenever a transition is running. */
  public get busy(): boolean {
    return this.current !== 'idle';
  }

  /** Black overlay opacity, 0 (clear) .. 1 (fully covered). */
  public get alpha(): number {
    switch (this.current) {
      case 'idle':
        return 0;
      case 'fadingOut':
        return Math.min(1, this.elapsedMs / TRANSITION.fadeOutMs);
      case 'holding':
        return 1;
      case 'fadingIn':
        return Math.max(0, 1 - this.elapsedMs / TRANSITION.fadeInMs);
    }
  }

  /** Start a transition. Returns false (and changes nothing) if one is running. */
  public begin(plan: TransitionPlan): boolean {
    if (this.busy) return false;
    this.plan = plan;
    this.current = 'fadingOut';
    this.elapsedMs = 0;
    return true;
  }

  public update(dtMs: number): TransitionUpdate {
    if (this.current === 'idle' || !(dtMs > 0)) return NOTHING;
    this.elapsedMs += dtMs;
    switch (this.current) {
      case 'fadingOut':
        if (this.elapsedMs < TRANSITION.fadeOutMs) return NOTHING;
        this.current = 'holding';
        this.elapsedMs = 0;
        // The room switches on the very frame the screen is fully covered.
        return { switchTo: this.plan, finished: false };
      case 'holding':
        if (this.elapsedMs < TRANSITION.holdMs) return NOTHING;
        this.current = 'fadingIn';
        this.elapsedMs = 0;
        return NOTHING;
      case 'fadingIn':
        if (this.elapsedMs < TRANSITION.fadeInMs) return NOTHING;
        this.current = 'idle';
        this.elapsedMs = 0;
        this.plan = null;
        return { switchTo: null, finished: true };
      default:
        return NOTHING;
    }
  }
}
