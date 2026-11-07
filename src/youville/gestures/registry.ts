/**
 * Gesture recognizer registry: the door controller looks recognizers
 * up by the player's chosen {@link DoorInputMethod}, so adding a new
 * gesture (or a future on-device voice adapter) means registering a
 * strategy here, not editing the closet or the bedroom.
 */
import type { DoorInputMethod, GestureRecognizer } from '../interaction';
import { TDropRecognizer } from './tDrop';
import { TravoltaRecognizer } from './travolta';

export class GestureRegistry {
  private readonly recognizers = new Map<string, GestureRecognizer>();

  public register(recognizer: GestureRecognizer): void {
    this.recognizers.set(recognizer.id, recognizer);
  }

  public get(method: DoorInputMethod): GestureRecognizer | null {
    return this.recognizers.get(method) ?? null;
  }

  public all(): readonly GestureRecognizer[] {
    return [...this.recognizers.values()];
  }

  public resetAll(): void {
    for (const recognizer of this.recognizers.values()) recognizer.reset();
  }
}

/** The 0.1 registry: Travolta and T-drop. Touch needs no recognizer. */
export function createDefaultGestureRegistry(): GestureRegistry {
  const registry = new GestureRegistry();
  registry.register(new TravoltaRecognizer());
  registry.register(new TDropRecognizer());
  return registry;
}
