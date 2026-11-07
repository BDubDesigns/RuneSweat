/**
 * Lateral movement of the avatar in room (world) coordinates.
 *
 * Camera mode is RELATIVE: the avatar moves by the player's torso
 * shift since a per-session anchor, never to an absolute position
 * mapped from the camera frame. So:
 *  - the room never moves with the skeleton,
 *  - losing the pose just freezes the avatar, and when tracking
 *    returns the anchor is re-taken at the avatar's current spot: no
 *    teleport,
 *  - the avatar is smoothed, speed-capped and clamped to the room,
 *  - reaching a wall slides the anchor so the player can immediately
 *    step back.
 *
 * Mirroring is applied exactly once, here: the camera frame is not
 * mirrored, so a torso shift of +dx in video space is -dx in the room.
 *
 * The world-position abstraction is deliberately plain (`x`, bounds)
 * so the later outdoor scrolling street can reuse it with a camera.
 */
import { WALK } from './config';

export interface WalkBounds {
  minX: number;
  maxX: number;
}

export class LateralMover {
  public x: number;
  /** -1 facing left, 1 facing right. */
  public facing: -1 | 1 = 1;
  /** True while the avatar moved noticeably this step (drives the walk cycle). */
  public moving = false;

  private anchorTorso: number | null = null;
  private anchorX = 0;

  public constructor(startX: number) {
    this.x = startX;
  }

  /** Put the avatar somewhere (room change). Drops the camera anchor. */
  public place(x: number): void {
    this.x = x;
    this.anchorTorso = null;
    this.moving = false;
  }

  /**
   * Advance one step.
   * @param torsoX smoothed hip-mid x in video space, or null when the
   *   pose is lost/stale/gated (the avatar holds still).
   * @param touchDir -1/0/1 from arrows, A/D or touch buttons.
   */
  public step(
    dtMs: number,
    torsoX: number | null,
    touchDir: -1 | 0 | 1,
    bounds: WalkBounds | null,
  ): void {
    const before = this.x;
    if (bounds === null) {
      this.moving = false;
      this.anchorTorso = null;
      return;
    }
    const dtSec = dtMs / 1000;
    if (touchDir !== 0) {
      this.x += touchDir * WALK.touchSpeedPxPerSec * dtSec;
      // Hands-off camera until the touch input ends, then re-anchor.
      this.anchorTorso = null;
    } else if (torsoX === null || !Number.isFinite(torsoX)) {
      this.anchorTorso = null;
    } else {
      if (this.anchorTorso === null) {
        this.anchorTorso = torsoX;
        this.anchorX = this.x;
      }
      // Mirror applied once: video x shrinking = player stepping right = avatar right.
      let shift = this.anchorTorso - torsoX;
      if (Math.abs(shift) < WALK.deadZone) shift = 0;
      const raw = this.anchorX + shift * WALK.cameraGainPx;
      const clamped = Math.min(bounds.maxX, Math.max(bounds.minX, raw));
      // Slide the anchor when pinned to a wall so reversing is instant.
      this.anchorX += clamped - raw;
      const tau = Math.max(WALK.smoothingTauMs, 1);
      const smoothed = (clamped - this.x) * (1 - Math.exp(-dtMs / tau));
      const cap = WALK.maxCameraSpeedPxPerSec * dtSec;
      this.x += Math.min(cap, Math.max(-cap, smoothed));
    }
    this.x = Math.min(bounds.maxX, Math.max(bounds.minX, this.x));
    const dx = this.x - before;
    this.moving = dtSec > 0 && Math.abs(dx) / dtSec > 12;
    if (dx > 0.01) this.facing = 1;
    else if (dx < -0.01) this.facing = -1;
  }
}
