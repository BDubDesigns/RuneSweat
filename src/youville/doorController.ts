/**
 * DoorInteractionController: the single gatekeeper for every doorway.
 *
 * Gesture recognizers (and Enter / touch / the closet lever) produce
 * *signals*; this controller decides whether a signal becomes an
 * {@link InteractionIntent}. It enforces:
 *  - door proximity (proximity doors only),
 *  - pose freshness (a stale or lost body never feeds a recognizer),
 *  - a cooldown after every intent / transition,
 *  - input lock while a transition runs,
 *  - exactly-once delivery (one intent per completed gesture).
 *
 * It knows nothing about destinations: the session maps an intent's
 * `targetId` to a {@link DoorDef} and starts the transition.
 */
import type { BodyState } from '../core/bodyState';
import { DOOR_INTERACTION } from './config';
import type { GestureRegistry } from './gestures/registry';
import type {
  DoorInputMethod,
  InteractionIntent,
  IntentSource,
} from './interaction';
import { doorInRange, findDoor, type RoomDef } from './rooms';

export interface DoorUpdateInput {
  room: RoomDef;
  avatarX: number;
  /** Latest body, or null when there is none. */
  body: BodyState | null;
  /** The caller's verdict that `body` is current and usable. */
  poseFresh: boolean;
  nowMs: number;
  method: DoorInputMethod;
  /** True while a room transition is running. */
  locked: boolean;
}

export class DoorInteractionController {
  private cooldownUntilMs = Number.NEGATIVE_INFINITY;

  public constructor(private readonly registry: GestureRegistry) {}

  /** Start the cooldown (also called when a transition completes). */
  public startCooldown(nowMs: number): void {
    this.cooldownUntilMs = nowMs + DOOR_INTERACTION.cooldownMs;
    this.registry.resetAll();
  }

  public cooling(nowMs: number): boolean {
    return nowMs < this.cooldownUntilMs;
  }

  /** The door a gesture or Enter would use right now, if any. */
  public activeDoor(room: RoomDef, avatarX: number) {
    return doorInRange(room, avatarX);
  }

  /** Feed the selected motion recognizer. Returns an intent at most once per gesture. */
  public update(input: DoorUpdateInput): InteractionIntent | null {
    const { room, avatarX, body, poseFresh, nowMs, method, locked } = input;
    const door = doorInRange(room, avatarX);
    const blocked =
      locked || door === null || !poseFresh || this.cooling(nowMs);
    // Only the selected recognizer ever runs; switching preference
    // resets the others without rebuilding any scene.
    for (const recognizer of this.registry.all()) {
      if (blocked || recognizer.id !== method) recognizer.reset();
    }
    if (blocked || door === null) return null;
    const recognizer = this.registry.get(method);
    if (recognizer === null) return null; // 'touch' has no motion recognizer
    if (!recognizer.update(body, nowMs)) return null;
    return this.emit(door.action, door.id, method, nowMs);
  }

  /**
   * Enter key / tap / click on the door button. Always available
   * whatever gesture is selected, but still bound to proximity,
   * cooldown and the transition lock.
   */
  public requestManual(
    room: RoomDef,
    avatarX: number,
    nowMs: number,
    locked: boolean,
  ): InteractionIntent | null {
    if (locked || this.cooling(nowMs)) return null;
    const door = doorInRange(room, avatarX);
    if (door === null) return null;
    return this.emit(door.action, door.id, 'touch', nowMs);
  }

  /** A UI-activated door (the closet's Done). */
  public requestUiDoor(
    room: RoomDef,
    doorId: string,
    source: IntentSource,
    nowMs: number,
    locked: boolean,
  ): InteractionIntent | null {
    if (locked || this.cooling(nowMs)) return null;
    const door = findDoor(room, doorId);
    if (door === null || door.activation !== 'ui') return null;
    return this.emit(door.action, door.id, source, nowMs);
  }

  private emit(
    action: InteractionIntent['action'],
    targetId: string,
    source: IntentSource,
    nowMs: number,
  ): InteractionIntent {
    this.startCooldown(nowMs);
    return { action, targetId, source };
  }
}
