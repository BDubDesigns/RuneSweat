/**
 * YouVilleSession: the pure (DOM-free, canvas-free) game state.
 *
 * It owns the current room, the avatar's world position and
 * appearance, the door-interaction preference, the door controller,
 * the room transition and the closet creator, and advances them from
 * a body state plus touch/keyboard inputs. The renderer and the DOM
 * bootstrap only read it, which makes the whole loop
 * (bedroom -> door -> fade -> closet -> pick -> done -> fade ->
 * bedroom) testable with synthetic bodies.
 */
import type { BodyState } from '../core/bodyState';
import {
  STARTER_APPEARANCE,
  type AvatarAppearance,
} from '../creator/avatarAppearance';
import { CharacterCreator, type CreatorResult } from './characterCreator';
import { DOOR_INTERACTION, WALK } from './config';
import { DoorInteractionController } from './doorController';
import { createDefaultGestureRegistry } from './gestures/registry';
import {
  DOOR_METHOD_HINTS,
  type DoorInputMethod,
  type InteractionIntent,
} from './interaction';
import { LateralMover } from './lateralMover';
import { RoomTransition } from './roomTransition';
import {
  doorInRange,
  findDoor,
  getRoom,
  type DoorDef,
  type RoomDef,
  type RoomId,
} from './rooms';

/** The latest pose as the app sees it. */
export interface PoseInput {
  body: BodyState | null;
  /** Loop-clock ms when the last DISTINCT frame arrived (null = never). */
  receivedAtMs: number | null;
}

export class YouVilleSession {
  public roomId: RoomId = 'bedroom';
  public doorMethod: DoorInputMethod = 'travolta';
  public readonly creator: CharacterCreator;
  public readonly transition = new RoomTransition();
  public readonly mover: LateralMover;
  public readonly gestures = createDefaultGestureRegistry();
  public readonly doors = new DoorInteractionController(this.gestures);

  /** -1/0/1 held by arrows / A,D / touch buttons. */
  public touchDir: -1 | 0 | 1 = 0;
  /** Walk-cycle phase for the avatar renderer. */
  public walkPhase = 0;
  /** True once the player has visited the closet (retires the soft guide). */
  public visitedCloset = false;
  /** Whether the pose is currently usable (camera mode HUD). */
  public poseFresh = false;
  /** Loop-clock ms the pose most recently became fresh (null while not). */
  private freshSinceMs: number | null = null;
  /** Transitions started, for tests and the debug overlay. */
  public transitionCount = 0;
  /** The last accepted intent, for the debug overlay. */
  public lastIntent: InteractionIntent | null = null;

  public constructor(initial: AvatarAppearance = STARTER_APPEARANCE) {
    this.creator = new CharacterCreator(initial);
    this.mover = new LateralMover(getRoom('bedroom').spawnX);
  }

  public get room(): RoomDef {
    return getRoom(this.roomId);
  }

  /** The committed appearance (survives every room change). */
  public get appearance(): AvatarAppearance {
    return this.creator.committed;
  }

  /** What the avatar should be drawn wearing right now. */
  public get displayAppearance(): AvatarAppearance {
    return this.roomId === 'closet'
      ? this.creator.previewAppearance()
      : this.creator.committed;
  }

  /** The proximity door the avatar can use now, if any. */
  public get nearbyDoor(): DoorDef | null {
    return this.transition.busy ? null : doorInRange(this.room, this.mover.x);
  }

  /** Context-sensitive instruction for the HUD. */
  public get hint(): string | null {
    if (this.transition.busy) return null;
    if (this.roomId === 'closet') return null;
    if (this.nearbyDoor !== null) return DOOR_METHOD_HINTS[this.doorMethod];
    if (!this.visitedCloset) return 'The closet door is on the right. Walk over to it.';
    return null;
  }

  public setDoorMethod(method: DoorInputMethod): void {
    this.doorMethod = method;
    // Takes effect immediately, no scene rebuild; stale progress is dropped.
    this.gestures.resetAll();
  }

  /** Is this pose recent and usable? */
  private isFresh(pose: PoseInput | null, nowMs: number): boolean {
    if (pose === null || pose.body === null || pose.receivedAtMs === null) return false;
    return (
      pose.body.present &&
      pose.body.bodyUsable &&
      nowMs - pose.receivedAtMs <= DOOR_INTERACTION.poseMaxAgeMs
    );
  }

  public update(dtMs: number, nowMs: number, pose: PoseInput | null): void {
    const step = this.transition.update(dtMs);
    if (step.switchTo !== null) {
      this.roomId = step.switchTo.toRoom;
      this.mover.place(step.switchTo.spawnX);
      this.gestures.resetAll();
      if (this.roomId === 'closet') {
        this.visitedCloset = true;
        this.creator.enter();
      }
    }
    if (step.finished) this.doors.startCooldown(nowMs);

    this.poseFresh = this.isFresh(pose, nowMs);
    if (!this.poseFresh) this.freshSinceMs = null;
    else this.freshSinceMs ??= nowMs;
    if (this.transition.busy) {
      // Input is disabled for the whole fade; no gesture can build up.
      this.gestures.resetAll();
      return;
    }
    const body = this.poseFresh && pose !== null ? pose.body : null;
    const room = this.room;

    // Walking waits for the tracker to settle after a pose (re)appears.
    const settled =
      this.freshSinceMs !== null &&
      nowMs - this.freshSinceMs >= WALK.resumeSettleMs;
    this.mover.step(
      dtMs,
      body === null || !settled ? null : body.torsoX,
      this.touchDir,
      room.walk,
    );
    if (this.mover.moving) this.walkPhase += dtMs * 0.012;

    let intent = this.doors.update({
      room,
      avatarX: this.mover.x,
      body,
      poseFresh: this.poseFresh,
      nowMs,
      method: this.doorMethod,
      locked: this.transition.busy,
    });

    if (this.roomId === 'closet') {
      const result = this.creator.update(nowMs, body);
      if (result !== null && result.kind === 'done') {
        intent = this.doors.requestUiDoor(
          room,
          'closet-exit',
          'lever',
          nowMs,
          this.transition.busy,
        );
      }
    }
    if (intent !== null) this.startTransition(intent);
  }

  /** Enter key / tap on the door button, in the bedroom. */
  public pressEnter(nowMs: number): boolean {
    if (this.roomId === 'closet') return false;
    const intent = this.doors.requestManual(
      this.room,
      this.mover.x,
      nowMs,
      this.transition.busy,
    );
    return intent !== null && this.startTransition(intent);
  }

  /** Done button / confirmed Done cell by touch, mouse or keyboard. */
  public handleCreatorResult(result: CreatorResult | null, nowMs: number): boolean {
    if (result === null || result.kind !== 'done') return false;
    const intent = this.doors.requestUiDoor(
      this.room,
      'closet-exit',
      'touch',
      nowMs,
      this.transition.busy,
    );
    return intent !== null && this.startTransition(intent);
  }

  /** Map an accepted intent to its door's data and begin the one transition. */
  private startTransition(intent: InteractionIntent): boolean {
    const door = findDoor(this.room, intent.targetId);
    if (door === null) return false;
    const started = this.transition.begin({
      toRoom: door.destinationRoomId,
      spawnX: door.arrivalX,
    });
    if (started) {
      this.lastIntent = intent;
      this.transitionCount += 1;
      this.gestures.resetAll();
    }
    return started;
  }
}
