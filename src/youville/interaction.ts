/**
 * Shared contracts for door interaction.
 *
 * A gesture recognizer only emits *intent* ("this body just performed
 * my gesture"). It never knows the destination room and never touches
 * room state: the {@link DoorInteractionController} turns recognizer
 * output into an {@link InteractionIntent} after enforcing proximity,
 * cooldown, pose freshness and exactly-once delivery.
 */
import type { BodyState } from '../core/bodyState';

/** Player-selectable ways to open a door. 'voice' is a future adapter. */
export type DoorInputMethod = 'travolta' | 't-drop' | 'touch';

/** Where an intent came from (the closet's Done lever is not a door method). */
export type IntentSource = DoorInputMethod | 'lever';

export interface InteractionIntent {
  action: 'enter' | 'exit';
  targetId: string;
  source: IntentSource;
}

/** Motion gesture strategy. `update` returns true once per completed gesture. */
export interface GestureRecognizer {
  readonly id: Exclude<DoorInputMethod, 'touch'>;
  reset(): void;
  update(body: BodyState | null, nowMs: number): boolean;
  /** Short state label for the debug overlay. */
  debugPhase(): string;
}

/** Methods the player can pick in the Door Interaction setting. */
export const DOOR_INPUT_METHODS: readonly DoorInputMethod[] = [
  'travolta',
  't-drop',
  'touch',
];

export const DOOR_METHOD_LABELS: Record<DoorInputMethod, string> = {
  travolta: 'Disco point',
  't-drop': 'T-drop',
  touch: 'Touch only',
};

/** Context-sensitive instruction shown next to a usable door. */
export const DOOR_METHOD_HINTS: Record<DoorInputMethod, string> = {
  travolta:
    'Point up to one side, swing your hand down across your body, then back up. Or press Enter.',
  't-drop':
    'Hold both arms out in a T, then drop both arms to your sides. Or press Enter.',
  touch: 'Press Enter (or tap the door button).',
};
