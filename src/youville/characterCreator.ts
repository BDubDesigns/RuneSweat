/**
 * CharacterCreator: the closet's appearance state machine.
 *
 * Inputs (all optional, any mix):
 *  - hand pointing + lever (camera): one hand's wrist is the cursor
 *    over FIXED cells, the other, extended arm is the lever; pulling
 *    it confirms the option that was hovered when the pull began
 *    (`LeverConfirmDetector`, from draft PR #2),
 *  - mouse hover/click and touch taps,
 *  - keyboard focus (arrows) + Enter.
 *
 * The creator never moves a cell: layout comes from `closetLayout()`.
 * A hovered option is previewed live on the avatar (`previewAppearance`);
 * only a confirmation commits it. Hand roles can be swapped.
 */
import {
  STARTER_APPEARANCE,
  withAppearanceChoice,
  type AppearanceCategory,
  type AvatarAppearance,
} from '../creator/avatarAppearance';
import type { BodyState } from '../core/bodyState';
import { LeverConfirmDetector, type LeverPhase } from '../core/leverConfirm';
import { PointerController, type Selectable } from '../core/pointer';
import { handPoint } from '../core/pointer';
import { toCanvas } from '../render/stage';
import {
  closetLayout,
  hitTestCell,
  moveFocus,
  parseCellId,
  type ClosetLayout,
} from './closetLayout';
import { CREATOR, WORLD } from './config';

export type CreatorResult =
  | { kind: 'choice'; category: AppearanceCategory; value: string }
  | { kind: 'done' };

export type HandRole = 'left' | 'right';

export class CharacterCreator {
  public readonly layout: ClosetLayout = closetLayout();

  /** The hand that points; the other arm is the lever. */
  public pointerHand: HandRole = 'left';

  private committedAppearance: AvatarAppearance;
  private readonly done = new Set<AppearanceCategory>();
  private readonly pointer = new PointerController();
  private readonly lever = new LeverConfirmDetector();
  private readonly selectables: Selectable[];

  private poseHoverId: string | null = null;
  private mouseHoverId: string | null = null;
  private focusId: string | null = null;
  private poseCursor: { x: number; y: number } | null = null;
  private flash: { id: string; untilMs: number } | null = null;

  public constructor(initial: AvatarAppearance = STARTER_APPEARANCE) {
    this.committedAppearance = { ...initial };
    this.selectables = this.layout.all.map((c) => ({
      id: c.id,
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
    }));
  }

  public get committed(): AvatarAppearance {
    return this.committedAppearance;
  }

  /** Categories the player has deliberately chosen in. */
  public isComplete(category: AppearanceCategory): boolean {
    return this.done.has(category);
  }

  /** The id being previewed/highlighted right now (pose > mouse > keyboard). */
  public get hoveredId(): string | null {
    return this.poseHoverId ?? this.mouseHoverId ?? this.focusId;
  }

  /** Pose cursor in world coordinates, or null when no hand is tracked. */
  public get cursor(): { x: number; y: number } | null {
    return this.poseCursor;
  }

  public get leverPhase(): LeverPhase {
    return this.lever.snapshot().phase;
  }

  public get flashId(): string | null {
    return this.flash === null ? null : this.flash.id;
  }

  /** Appearance with the hovered option applied (live preview). */
  public previewAppearance(): AvatarAppearance {
    const id = this.hoveredId;
    if (id === null) return this.committedAppearance;
    const parsed = parseCellId(id);
    if (parsed === null || parsed.kind !== 'choice') return this.committedAppearance;
    return withAppearanceChoice(
      this.committedAppearance,
      parsed.category,
      parsed.value as never,
    );
  }

  /** Called when the player walks into the closet. */
  public enter(): void {
    this.lever.reset();
    this.pointer.clear();
    this.poseHoverId = null;
    this.mouseHoverId = null;
    this.focusId = null;
    this.poseCursor = null;
    this.flash = null;
  }

  /** Swap which hand points and which arm is the lever. */
  public swapHands(): void {
    this.pointerHand = this.pointerHand === 'left' ? 'right' : 'left';
    this.lever.reset();
  }

  /**
   * Advance one step. `body` is null whenever the pose is missing,
   * stale or gated: the cursor disappears, the hover clears and the
   * lever resets, so nothing can confirm from a stale pose.
   * Returns the lever's confirmation, if one just happened.
   */
  public update(nowMs: number, body: BodyState | null): CreatorResult | null {
    if (this.flash !== null && nowMs >= this.flash.untilMs) this.flash = null;
    if (body === null || !body.present) {
      this.poseCursor = null;
      this.poseHoverId = null;
      this.pointer.clear();
      this.lever.reset();
      return null;
    }
    const wrist = handPoint(body, this.pointerHand);
    this.poseCursor = toCanvas(
      { x: wrist.x, y: wrist.y, visibility: 1 },
      WORLD.width,
      WORLD.height,
    );
    this.pointer.update(this.poseCursor, this.selectables);
    this.poseHoverId = this.pointer.hoveredId;

    const leverArm = this.pointerHand === 'left' ? body.rightArm : body.leftArm;
    const confirmed = this.lever.update(leverArm, this.poseHoverId, nowMs);
    return confirmed === null ? null : this.confirm(confirmed, nowMs);
  }

  /** Mouse position in world coordinates (null = left the canvas). */
  public setMouseHover(point: { x: number; y: number } | null): void {
    this.mouseHoverId =
      point === null ? null : (hitTestCell(this.layout, point.x, point.y)?.id ?? null);
  }

  /** Click / touch tap at a world point. */
  public tap(point: { x: number; y: number }, nowMs: number): CreatorResult | null {
    const cell = hitTestCell(this.layout, point.x, point.y);
    return cell === null ? null : this.confirm(cell.id, nowMs);
  }

  public moveKeyboardFocus(dx: -1 | 0 | 1, dy: -1 | 0 | 1): void {
    this.focusId = moveFocus(this.layout, this.focusId, dx, dy);
  }

  public confirmKeyboardFocus(nowMs: number): CreatorResult | null {
    return this.focusId === null ? null : this.confirm(this.focusId, nowMs);
  }

  /** Commit a cell id (shared by lever, tap and keyboard). */
  public confirm(id: string, nowMs: number): CreatorResult | null {
    const parsed = parseCellId(id);
    if (parsed === null) return null;
    this.flash = { id, untilMs: nowMs + CREATOR.confirmFlashMs };
    if (parsed.kind === 'done') return { kind: 'done' };
    this.committedAppearance = withAppearanceChoice(
      this.committedAppearance,
      parsed.category,
      parsed.value as never,
    );
    this.done.add(parsed.category);
    return { kind: 'choice', category: parsed.category, value: parsed.value };
  }
}
