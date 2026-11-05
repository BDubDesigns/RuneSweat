/**
 * Mouse/touch simulator: a full-body pose driven by the pointer.
 *
 * This is a permanent fixture, not a demo: it is the playable fallback when
 * there is no camera, so its geometry is normalized exactly like the real
 * pose math (same torso length, arm length, raise thresholds).
 *
 * How to play with it:
 * - Move the pointer: the body moves left/right (torso follows the pointer).
 * - Hold the LEFT mouse button: raise the LEFT arm straight up.
 *   Hold the RIGHT mouse button: raise the RIGHT arm straight up.
 *   Release to lower (reload). The button is the side — the pointer is
 *   the torso, so it cannot also aim the arm.
 * - `Q` / `E`: raise the left / right arm angled outward (~35°), for
 *   testing angled shots. `A` / `D`: raise the left / right arm straight up.
 * - `W` (hold): jump. `S` (hold): duck. (v3.1: Space used to be jump;
 *   Space is now the pause toggle in main.ts, so jump moved to W. The
 *   real-camera body jump is unaffected — it comes from landmarks.)
 * - `P` (hold): press both forge buttons — for the refiner (v3.4,
 *   retargeted v3.5). Both wrists animate out to the pedestal buttons
 *   (from `PRESS`: hip-mid ±`buttonOffsetTorsoFrac`, at the zone top
 *   `buttonZoneTopOffsetTorsoFrac`) and push down to hip line +
 *   `pressDepthTorsoFrac` while held; release returns them to rest.
 *   The press is a deliberate downward push: the wrists travel down
 *   into the button zones, they do not teleport into them. `X` (legs
 *   wide) is gone with the star jumps — the sim can now play a full
 *   refiner batch. `W` jump stays as a general sim capability (it still
 *   drives `BodyState.jumping`, shown in the debug HUD) — it is just no
 *   longer the refiner's input.
 * - Mouse (v3.6): the pointer HAND. The mouse position drives the
 *   left (pointer) wrist directly — move the mouse over a recipe card
 *   or a hub button and the left hand points at it. The wrist follows
 *   with a ~120 ms lag, like a hand, not a teleporting cursor. A held
 *   arm raise (mouse button / A / Q) overrides the follow for that arm
 *   while held, and the clasp / press override it too — pointing never
 *   fights a swing or a press.
 * - `C` (hold, v3.6): confirm. The RIGHT (confirm) wrist animates to
 *   the top-right action circle and holds there — hold it ~2 s and the
 *   dwell fires (clicks the highlighted thing, or goes to town with
 *   nothing highlighted). Release returns the hand to rest. C, not
 *   anything else: P is the press, F is fullscreen, W/S/Q/E/A/D are
 *   already sim keys.
 *
 * Two-handed clasp (Swing Lab v2): when BOTH arms are raised straight up
 * at the same time (A+D, or both mouse buttons), the hands grip one
 * handle — both wrists follow a single point on the body's midline that
 * travels from overhead down to waist height, instead of each arm
 * sweeping its own arc from its own shoulder. Two independent arcs
 * cannot keep the wrists together: the wrists bulge apart mid-swing
 * (over a torso length at chest height), which no real clasped chop
 * does. The clasp latches on when both straight-up raises are held and
 * stays latched through the drop after release. It only releases 500 ms
 * after both arms are fully down again: the body tracker smooths the
 * wrists, so it still sees them mid-drop when the raw motion has
 * already ended, and the hands must still read as together when the
 * smoothed wrists cross the strike line — releasing the latch at the
 * bottom would snap the raw wrists back to the sides and the smoothed
 * gap would trip the machine's hands-apart check before the hit lands.
 * A single arm, or an angled (Q/E) raise, still follows its own arc.
 * Between chops the hands rest together at waist height rather than
 * hanging at the sides — that is what keeping a grip on the pickaxe
 * looks like. One wart: a single-arm raise started inside the release
 * grace still follows the handle (its angle reads ~19° instead of 0°)
 * until the arms rest again.
 */

import { ACTION_BUTTON, PRESS, SIM, STAGE } from '../core/config';
import { PoseLandmark, type PoseFrameSource, type RawPoseFrame, type NormalizedLandmark } from '../tracking/poseTypes';
import { clamp, lerp, toNormalized } from '../render/stage';

/** Grace after both arms are fully down before the clasp releases, in ms.
 * The tracker lags the raw motion, so the smoothed wrists cross the
 * strike line ~100 ms after the raw drop ends; 500 ms clears that lag
 * with margin and still lands inside the machine's 700 ms hit cooldown,
 * so the release snap (wrists back to the sides) can never corrupt a
 * judgment. */
const CLASP_RELEASE_GRACE_MS = 500;

/**
 * Press animation time (ms, v3.4): `P` held drives `pressT` 0 -> 1.
 * First half: wrists travel out to the buttons at the zone top
 * (`PRESS.buttonZoneTopOffsetTorsoFrac`); second half: they push
 * down to hip line + `PRESS.pressDepthTorsoFrac`. The push half is
 * ~120 ms, so the downward leg runs at ~1 torso length/s raw — a
 * deliberate push the press detector can read as downward motion,
 * not a teleport into the zones. Button offset and depth come from
 * `PRESS` (v3.5): the sim must press the same zones the detector
 * reads, or the sim batch can never complete.
 */
const PRESS_ANIM_MS = 240;

/**
 * Pointer-hand follow time (ms, v3.6): the left wrist chases the
 * mouse position with this time constant — a hand, not a teleporting
 * cursor. ~120 ms (the arm-raise time) so the hand lands on the
 * thing just after the mouse does.
 */
const POINTER_HAND_ANIM_MS = 120;

/** Confirm-hand travel time (ms, v3.6): same feel as the press. */
const CONFIRM_ANIM_MS = 240;

/**
 * Where the confirm hand goes (v3.6): the action circle's centre,
 * in normalized video space — the circle is fixed in canvas space
 * (`ACTION_BUTTON` + `STAGE`), so its video-space target is fixed
 * too. The sim's right wrist animates here while C is held.
 */
const CONFIRM_TARGET: { x: number; y: number } = toNormalized(
  {
    x: STAGE.width - ACTION_BUTTON.centreMarginRightPx,
    y: ACTION_BUTTON.centreYPx,
  },
  STAGE.width,
  STAGE.height,
);

interface ArmSim {
  /** 0 = down, 1 = fully raised. Animates toward `target`. */
  raiseT: number;
  target: number;
  /** Direction the arm points when raised, in degrees from straight up. */
  angleDeg: number;
}

function lm(x: number, y: number): NormalizedLandmark {
  return { x, y, visibility: SIM.visibility };
}

export class MouseSource implements PoseFrameSource {
  public readonly id = 'mouse';
  public readonly provenance = 'simulated' as const;

  private running = false;
  private pointer: { x: number; y: number } = { x: 0.5, y: SIM.standingHipY };
  private pointerLeftDown = false;
  private pointerRightDown = false;
  private leftArm: ArmSim = { raiseT: 0, target: 0, angleDeg: 0 };
  private rightArm: ArmSim = { raiseT: 0, target: 0, angleDeg: 0 };
  private keyLeft = false;
  private keyRight = false;
  /** Q / E held: angled arm raise (~35° outward). */
  private keyLeftAngled = false;
  private keyRightAngled = false;
  /** Both arms raised straight up together: wrists share one handle. */
  private clasped = false;
  /** When the clasp may release after both arms are fully down (ms). */
  private claspReleaseAtMs: number | null = null;
  private jumping = false;
  private ducking = false;
  /** P held: both wrists press the forge buttons (v3.4, refiner). */
  private pressing = false;
  /** 0 = rest, 1 = fully pressed. Animates toward `pressing ? 1 : 0`. */
  private pressT = 0;
  /**
   * Pointer hand (v3.6): video-space target the LEFT wrist follows
   * (set from the mouse position by main.ts), or null for the
   * classic hanging arm. `pointerHandCurrent` is the smoothed wrist
   * chasing it — null until the first follow frame, so the hand
   * starts from where it hangs instead of snapping to the mouse.
   */
  private pointerHandTarget: { x: number; y: number } | null = null;
  private pointerHandCurrent: { x: number; y: number } | null = null;
  /** C held: the RIGHT wrist travels to the action circle (v3.6). */
  private confirming = false;
  /** 0 = rest, 1 = on the circle. Animates toward `confirming ? 1 : 0`. */
  private confirmT = 0;
  private lastNowMs: number | null = null;

  public start(nowMs: number): void {
    this.running = true;
    this.lastNowMs = nowMs;
  }

  public stop(): void {
    this.running = false;
    this.lastNowMs = null;
    this.clasped = false;
    this.claspReleaseAtMs = null;
    this.pressing = false;
    this.pressT = 0;
    this.pointerHandTarget = null;
    this.pointerHandCurrent = null;
    this.confirming = false;
    this.confirmT = 0;
  }

  /**
   * Pointer position in normalized video space. `button` is the mouse
   * button held (0 = left, 2 = right); `pressed` is whether any button is
   * held. The pointer steers the torso; the button picks the arm.
   */
  public setPointer(
    point: { x: number; y: number },
    pressed: boolean,
    button = 0,
  ): void {
    this.pointer = { x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) };
    if (!pressed) {
      this.pointerLeftDown = false;
      this.pointerRightDown = false;
      return;
    }
    if (button === 2) this.pointerRightDown = true;
    else this.pointerLeftDown = true;
  }

  /** Keyboard arm raise: `A` = left, `D` = right, straight up. */
  public setKeyArm(side: 'left' | 'right', raised: boolean): void {
    if (side === 'left') this.keyLeft = raised;
    else this.keyRight = raised;
  }

  /** Keyboard angled arm raise: `Q` = left ~-35°, `E` = right ~+35°. */
  public setKeyArmAngled(side: 'left' | 'right', raised: boolean): void {
    if (side === 'left') this.keyLeftAngled = raised;
    else this.keyRightAngled = raised;
  }

  public setJumping(jumping: boolean): void {
    this.jumping = jumping;
  }

  public setDucking(ducking: boolean): void {
    this.ducking = ducking;
  }

  /** P (hold): press both forge buttons (v3.4, refiner). */
  public setPressing(pressing: boolean): void {
    this.pressing = pressing;
  }

  /**
   * Pointer hand (v3.6): the video-space point the LEFT wrist
   * follows — main.ts passes the mouse position (already in video
   * space via `toNormalized`). Null restores the classic hanging
   * arm. A held raise (mouse button / A / Q) overrides the follow
   * while held; the clasp and the press override it too.
   */
  public setPointerHand(point: { x: number; y: number } | null): void {
    this.pointerHandTarget =
      point === null
        ? null
        : { x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) };
    if (point === null) this.pointerHandCurrent = null;
  }

  /** C (hold): move the RIGHT (confirm) wrist to the action circle. */
  public setConfirming(confirming: boolean): void {
    this.confirming = confirming;
  }

  private advanceArm(arm: ArmSim, dtMs: number): void {
    // Move toward the target at a fixed rate for a snappy, predictable feel.
    const step = dtMs / SIM.raiseMs;
    if (arm.raiseT < arm.target) arm.raiseT = Math.min(arm.target, arm.raiseT + step);
    else if (arm.raiseT > arm.target) arm.raiseT = Math.max(arm.target, arm.raiseT - step);
  }

  public frameAt(nowMs: number): RawPoseFrame | null {
    if (!this.running) return null;
    const dtMs = this.lastNowMs === null ? 0 : Math.max(nowMs - this.lastNowMs, 0);
    this.lastNowMs = nowMs;

    const torsoX = this.pointer.x;
    const hipY =
      SIM.standingHipY -
      (this.jumping ? SIM.jumpRise : 0) +
      (this.ducking ? SIM.duckDrop : 0);
    const shoulderY = hipY - SIM.torsoLength;
    const halfShoulder = SIM.shoulderWidth / 2;
    const hipHalf = halfShoulder * 0.8;

    // Which arms are raised, and at what angle. Pointer buttons raise an
    // arm straight up on their side; Q/E raise an arm angled outward;
    // A/D raise an arm straight up. Pointer buttons win over keys.
    const leftRaised =
      this.pointerLeftDown || this.keyLeft || this.keyLeftAngled;
    const rightRaised =
      this.pointerRightDown || this.keyRight || this.keyRightAngled;
    this.leftArm.target = leftRaised ? 1 : 0;
    this.rightArm.target = rightRaised ? 1 : 0;
    this.leftArm.angleDeg = this.keyLeftAngled ? -35 : 0;
    this.rightArm.angleDeg = this.keyRightAngled ? 35 : 0;
    this.advanceArm(this.leftArm, dtMs);
    this.advanceArm(this.rightArm, dtMs);

    // Clasp latch: both arms straight up at once means one two-handed
    // grip. Latches on when both straight-up raises are held; stays
    // latched through the drop after release, and only releases
    // CLASP_RELEASE_GRACE_MS after both arms are fully down, so the
    // tracker (which lags the raw motion) still sees the wrists
    // together when it crosses the strike line. Angled (Q/E) raises
    // never clasp. Raising an arm again inside the grace cancels the
    // release and the latch holds.
    const leftStraight =
      (this.pointerLeftDown || this.keyLeft) && !this.keyLeftAngled;
    const rightStraight =
      (this.pointerRightDown || this.keyRight) && !this.keyRightAngled;
    if (leftStraight && rightStraight) {
      this.clasped = true;
      this.claspReleaseAtMs = null;
    } else if (this.clasped) {
      if (this.leftArm.raiseT > 0 || this.rightArm.raiseT > 0) {
        this.claspReleaseAtMs = null;
      } else if (this.claspReleaseAtMs === null) {
        this.claspReleaseAtMs = nowMs + CLASP_RELEASE_GRACE_MS;
      } else if (nowMs >= this.claspReleaseAtMs) {
        this.clasped = false;
        this.claspReleaseAtMs = null;
      }
    }

    const shoulderFor = (side: 'left' | 'right'): { x: number; y: number } =>
      side === 'left'
        ? { x: torsoX - halfShoulder, y: shoulderY }
        : { x: torsoX + halfShoulder, y: shoulderY };

    // Press animation: P held drives pressT 0 -> 1 over PRESS_ANIM_MS;
    // release drives it back to 0 at the same rate.
    const pressTarget = this.pressing ? 1 : 0;
    const pressStep = dtMs / PRESS_ANIM_MS;
    if (this.pressT < pressTarget) {
      this.pressT = Math.min(pressTarget, this.pressT + pressStep);
    } else if (this.pressT > pressTarget) {
      this.pressT = Math.max(pressTarget, this.pressT - pressStep);
    }

    // Confirm animation: C held drives confirmT 0 -> 1 over
    // CONFIRM_ANIM_MS; release drives it back to 0 at the same rate.
    const confirmTarget = this.confirming ? 1 : 0;
    const confirmStep = dtMs / CONFIRM_ANIM_MS;
    if (this.confirmT < confirmTarget) {
      this.confirmT = Math.min(confirmTarget, this.confirmT + confirmStep);
    } else if (this.confirmT > confirmTarget) {
      this.confirmT = Math.max(confirmTarget, this.confirmT - confirmStep);
    }

    const armPoints = (side: 'left' | 'right'): {
      elbow: NormalizedLandmark;
      wrist: NormalizedLandmark;
    } => {
      const shoulder = shoulderFor(side);
      const arm = side === 'left' ? this.leftArm : this.rightArm;
      let wrist: NormalizedLandmark;
      let elbow: NormalizedLandmark;
      if (this.clasped) {
        // One handle on the midline: the wrist travels the chop arc
        // from overhead (raiseT 1) to waist height (raiseT 0), staying
        // at the body's center the whole way. Each arm follows its own
        // raiseT, so releasing one hand early lets that wrist drop while
        // the other stays up — the grip genuinely breaks.
        wrist = lm(
          torsoX,
          shoulderY - (2 * arm.raiseT - 1) * SIM.armLength,
        );
        elbow = lm(
          shoulder.x + (wrist.x - shoulder.x) * 0.55,
          shoulder.y + (wrist.y - shoulder.y) * 0.55,
        );
      } else {
        const raised = arm.raiseT;
        // Down direction: arm hangs at the side. Up direction: `angleDeg`
        // from straight up. Interpolate by raiseT. Down is ~170° from up
        // (not 10°): the wrist must hang BELOW the shoulder when down.
        const downAngleRad =
          side === 'left' ? -Math.PI * 0.94 : Math.PI * 0.94;
        const upAngleRad = (arm.angleDeg * Math.PI) / 180;
        // Blend the direction angle from "hanging" to "raised".
        const angleRad = lerp(downAngleRad, upAngleRad, raised);
        // Direction vector in video space (y down): angle measured from
        // straight up, positive toward video-right.
        const dirX = Math.sin(angleRad);
        const dirY = -Math.cos(angleRad);
        elbow = lm(
          shoulder.x + dirX * SIM.armLength * 0.55,
          shoulder.y + dirY * SIM.armLength * 0.55,
        );
        wrist = lm(
          shoulder.x + dirX * SIM.armLength,
          shoulder.y + dirY * SIM.armLength,
        );
      }
      if (side === 'left' && this.pointerHandTarget !== null) {
        // Pointer hand (v3.6): the mouse drives the left wrist. Only
        // when the arm is not raised and not clasped — a held raise
        // (mouse button / A / Q) overrides the follow while held, and
        // the clasp branch above already returned the handle wrist,
        // so pointing never fights a swing. The wrist chases the
        // target with a ~120 ms time constant (a hand, not a
        // teleporting cursor); it starts from where it hangs, so the
        // first follow frame does not snap. While overridden, the
        // smoothed position resets, so the follow resumes from the
        // live wrist instead of gliding in from a stale point.
        const raised =
          this.pointerLeftDown || this.keyLeft || this.keyLeftAngled;
        if (raised || this.clasped) {
          this.pointerHandCurrent = null;
        } else {
          const target = this.pointerHandTarget;
          if (this.pointerHandCurrent === null) {
            this.pointerHandCurrent = { x: wrist.x, y: wrist.y };
          }
          const step = Math.min(1, dtMs / POINTER_HAND_ANIM_MS);
          this.pointerHandCurrent = {
            x: lerp(this.pointerHandCurrent.x, target.x, step),
            y: lerp(this.pointerHandCurrent.y, target.y, step),
          };
          wrist = lm(this.pointerHandCurrent.x, this.pointerHandCurrent.y);
          elbow = lm(
            shoulder.x + (wrist.x - shoulder.x) * 0.55,
            shoulder.y + (wrist.y - shoulder.y) * 0.55,
          );
        }
      }
      if (side === 'right' && this.confirmT > 0) {
        // Confirm hand (v3.6): C held moves the right wrist to the
        // action circle and holds it there. First half of confirmT:
        // travel to the circle (blended from the current wrist, so
        // no teleport); second half: hold on the circle. On release
        // confirmT runs back down and the wrist returns to rest the
        // same way. The press override below still wins if P and C
        // are held together — a press is the more specific input.
        let px: number;
        let py: number;
        if (this.confirmT <= 0.5) {
          const t = this.confirmT / 0.5;
          px = lerp(wrist.x, CONFIRM_TARGET.x, t);
          py = lerp(wrist.y, CONFIRM_TARGET.y, t);
        } else {
          px = CONFIRM_TARGET.x;
          py = CONFIRM_TARGET.y;
        }
        wrist = lm(px, py);
        elbow = lm(
          shoulder.x + (px - shoulder.x) * 0.55,
          shoulder.y + (py - shoulder.y) * 0.55,
        );
      }
      if (this.pressT > 0) {
        // Forge press (v3.4, retargeted v3.5): both wrists leave
        // wherever they were and press the pedestal buttons — the
        // same numbers as the detector's zones (core/pressDetector,
        // from PRESS): centres at hip-mid ±buttonOffsetTorsoFrac,
        // zone top at hip + buttonZoneTopOffsetTorsoFrac, pressed
        // depth hip + pressDepthTorsoFrac. First half of pressT:
        // travel out to the buttons at the zone top (blended from the
        // current wrist, so no teleport); second half: the deliberate
        // downward push into the pressed position. On release pressT
        // runs back down and the wrists return to rest the same way.
        const dir = side === 'left' ? -1 : 1;
        const buttonX =
          torsoX + dir * PRESS.buttonOffsetTorsoFrac * SIM.torsoLength;
        const zoneTopY =
          hipY + PRESS.buttonZoneTopOffsetTorsoFrac * SIM.torsoLength;
        const pressedY = hipY + PRESS.pressDepthTorsoFrac * SIM.torsoLength;
        let px: number;
        let py: number;
        if (this.pressT <= 0.5) {
          const t = this.pressT / 0.5;
          px = lerp(wrist.x, buttonX, t);
          py = lerp(wrist.y, zoneTopY, t);
        } else {
          const t = (this.pressT - 0.5) / 0.5;
          px = buttonX;
          py = lerp(zoneTopY, pressedY, t);
        }
        wrist = lm(px, py);
        elbow = lm(
          shoulder.x + (px - shoulder.x) * 0.55,
          shoulder.y + (py - shoulder.y) * 0.55,
        );
      }
      return { elbow, wrist };
    };

    const left = armPoints('left');
    const right = armPoints('right');
    const legBend = this.ducking ? 0.25 : 0;
    const kneeY = hipY + SIM.legLength * 0.5;
    const ankleY = hipY + SIM.legLength;
    // Ankles stay at hip width: the legs-wide input is gone with the
    // star jumps (v3.4) — nothing in the game reads ankle spread now.
    const ankleHalf = hipHalf;

    const landmarks: NormalizedLandmark[] = new Array<NormalizedLandmark>(33);
    const nose = lm(torsoX, shoulderY - 0.09);
    landmarks[PoseLandmark.NOSE] = nose;
    landmarks[PoseLandmark.LEFT_EYE_INNER] = lm(torsoX - 0.015, nose.y - 0.01);
    landmarks[PoseLandmark.LEFT_EYE] = lm(torsoX - 0.03, nose.y - 0.01);
    landmarks[PoseLandmark.LEFT_EYE_OUTER] = lm(torsoX - 0.045, nose.y - 0.01);
    landmarks[PoseLandmark.RIGHT_EYE_INNER] = lm(torsoX + 0.015, nose.y - 0.01);
    landmarks[PoseLandmark.RIGHT_EYE] = lm(torsoX + 0.03, nose.y - 0.01);
    landmarks[PoseLandmark.RIGHT_EYE_OUTER] = lm(torsoX + 0.045, nose.y - 0.01);
    landmarks[PoseLandmark.LEFT_EAR] = lm(torsoX - 0.06, nose.y);
    landmarks[PoseLandmark.RIGHT_EAR] = lm(torsoX + 0.06, nose.y);
    landmarks[PoseLandmark.MOUTH_LEFT] = lm(torsoX - 0.02, nose.y + 0.03);
    landmarks[PoseLandmark.MOUTH_RIGHT] = lm(torsoX + 0.02, nose.y + 0.03);
    landmarks[PoseLandmark.LEFT_SHOULDER] = lm(torsoX - halfShoulder, shoulderY);
    landmarks[PoseLandmark.RIGHT_SHOULDER] = lm(torsoX + halfShoulder, shoulderY);
    landmarks[PoseLandmark.LEFT_ELBOW] = left.elbow;
    landmarks[PoseLandmark.RIGHT_ELBOW] = right.elbow;
    landmarks[PoseLandmark.LEFT_WRIST] = left.wrist;
    landmarks[PoseLandmark.RIGHT_WRIST] = right.wrist;
    landmarks[PoseLandmark.LEFT_PINKY] = lm(left.wrist.x - 0.01, left.wrist.y + 0.02);
    landmarks[PoseLandmark.RIGHT_PINKY] = lm(right.wrist.x + 0.01, right.wrist.y + 0.02);
    landmarks[PoseLandmark.LEFT_INDEX] = lm(left.wrist.x - 0.005, left.wrist.y + 0.025);
    landmarks[PoseLandmark.RIGHT_INDEX] = lm(right.wrist.x + 0.005, right.wrist.y + 0.025);
    landmarks[PoseLandmark.LEFT_THUMB] = lm(left.wrist.x + 0.01, left.wrist.y + 0.01);
    landmarks[PoseLandmark.RIGHT_THUMB] = lm(right.wrist.x - 0.01, right.wrist.y + 0.01);
    landmarks[PoseLandmark.LEFT_HIP] = lm(torsoX - hipHalf, hipY);
    landmarks[PoseLandmark.RIGHT_HIP] = lm(torsoX + hipHalf, hipY);
    landmarks[PoseLandmark.LEFT_KNEE] = lm(torsoX - hipHalf - legBend * 0.1, kneeY);
    landmarks[PoseLandmark.RIGHT_KNEE] = lm(torsoX + hipHalf + legBend * 0.1, kneeY);
    landmarks[PoseLandmark.LEFT_ANKLE] = lm(torsoX - ankleHalf, ankleY);
    landmarks[PoseLandmark.RIGHT_ANKLE] = lm(torsoX + ankleHalf, ankleY);
    landmarks[PoseLandmark.LEFT_HEEL] = lm(torsoX - ankleHalf - 0.01, ankleY);
    landmarks[PoseLandmark.RIGHT_HEEL] = lm(torsoX + ankleHalf + 0.01, ankleY);
    landmarks[PoseLandmark.LEFT_FOOT_INDEX] = lm(torsoX - ankleHalf + 0.02, ankleY + 0.01);
    landmarks[PoseLandmark.RIGHT_FOOT_INDEX] = lm(torsoX + ankleHalf - 0.02, ankleY + 0.01);

    return {
      timestampMs: nowMs,
      landmarks,
      sourceId: this.id,
      provenance: this.provenance,
    };
  }
}
