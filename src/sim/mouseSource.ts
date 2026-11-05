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

import { SIM } from '../core/config';
import { PoseLandmark, type PoseFrameSource, type RawPoseFrame, type NormalizedLandmark } from '../tracking/poseTypes';
import { clamp, lerp } from '../render/stage';

/** Grace after both arms are fully down before the clasp releases, in ms.
 * The tracker lags the raw motion, so the smoothed wrists cross the
 * strike line ~100 ms after the raw drop ends; 500 ms clears that lag
 * with margin and still lands inside the machine's 700 ms hit cooldown,
 * so the release snap (wrists back to the sides) can never corrupt a
 * judgment. */
const CLASP_RELEASE_GRACE_MS = 500;

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

    const armPoints = (side: 'left' | 'right'): {
      elbow: NormalizedLandmark;
      wrist: NormalizedLandmark;
    } => {
      const shoulder = shoulderFor(side);
      const arm = side === 'left' ? this.leftArm : this.rightArm;
      if (this.clasped) {
        // One handle on the midline: the wrist travels the chop arc
        // from overhead (raiseT 1) to waist height (raiseT 0), staying
        // at the body's center the whole way. Each arm follows its own
        // raiseT, so releasing one hand early lets that wrist drop while
        // the other stays up — the grip genuinely breaks.
        const wrist = lm(
          torsoX,
          shoulderY - (2 * arm.raiseT - 1) * SIM.armLength,
        );
        const elbow = lm(
          shoulder.x + (wrist.x - shoulder.x) * 0.55,
          shoulder.y + (wrist.y - shoulder.y) * 0.55,
        );
        return { elbow, wrist };
      }
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
      const elbow = lm(
        shoulder.x + dirX * SIM.armLength * 0.55,
        shoulder.y + dirY * SIM.armLength * 0.55,
      );
      const wrist = lm(
        shoulder.x + dirX * SIM.armLength,
        shoulder.y + dirY * SIM.armLength,
      );
      return { elbow, wrist };
    };

    const left = armPoints('left');
    const right = armPoints('right');
    const legBend = this.ducking ? 0.25 : 0;
    const kneeY = hipY + SIM.legLength * 0.5;
    const ankleY = hipY + SIM.legLength;

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
    landmarks[PoseLandmark.LEFT_ANKLE] = lm(torsoX - hipHalf, ankleY);
    landmarks[PoseLandmark.RIGHT_ANKLE] = lm(torsoX + hipHalf, ankleY);
    landmarks[PoseLandmark.LEFT_HEEL] = lm(torsoX - hipHalf - 0.01, ankleY);
    landmarks[PoseLandmark.RIGHT_HEEL] = lm(torsoX + hipHalf + 0.01, ankleY);
    landmarks[PoseLandmark.LEFT_FOOT_INDEX] = lm(torsoX - hipHalf + 0.02, ankleY + 0.01);
    landmarks[PoseLandmark.RIGHT_FOOT_INDEX] = lm(torsoX + hipHalf - 0.02, ankleY + 0.01);

    return {
      timestampMs: nowMs,
      landmarks,
      sourceId: this.id,
      provenance: this.provenance,
    };
  }
}
