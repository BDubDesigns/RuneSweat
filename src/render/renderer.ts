/**
 * Canvas 2D renderer: mirrored video + skeleton + stickman.
 *
 * Mirroring rule (same as the Spider-Man repo): the video is mirrored in
 * code with `setTransform(-1, 0, 0, 1, w, 0)` and landmarks go through
 * `toCanvas()`. The transform is cleared before any HUD text is drawn, so
 * HUD text is never mirrored. Nothing here uses CSS `scaleX(-1)`.
 */

import { RENDER } from '../core/config';
import {
  actionButtonGeometry,
  actionButtonLabel,
  type ActionButtonMode,
} from '../core/actionButton';
import { letterboxRect, toCanvas, type Vec2 } from './stage';
import {
  PoseLandmark,
  SKELETON_CONNECTIONS,
  type NormalizedLandmark,
} from '../tracking/poseTypes';

/**
 * Draw the video frame mirrored, letterboxed into the stage preserving its
 * aspect ratio — never stretched. The stage background is filled first so
 * the pillarbox/letterbox bars match the stage, not the page.
 */
export function drawVideoMirrored(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
): void {
  drawStageBackground(ctx, width, height);
  const rect = letterboxRect(video.videoWidth, video.videoHeight, width, height);
  ctx.save();
  // Mirror within the letterbox rect: x maps rect.x -> rect.x + rect.width
  // reversed, y passes through unchanged.
  ctx.setTransform(-1, 0, 0, 1, 2 * rect.x + rect.width, 0);
  ctx.drawImage(video, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

export interface BlockingOverlayOptions {
  /** Big headline, e.g. "Step back — I can't see your body". */
  title: string;
  /** Smaller second line (may be empty). */
  subtitle: string;
  /**
   * Draw the framing ghost: a stickman outline centred on the stage
   * showing where shoulders/hips should be. Off for the model-failure
   * overlay, where framing is not the problem.
   */
  showGhost: boolean;
}

/**
 * Blocking overlay: dim the stage, show a big kid-readable message, and
 * optionally a framing ghost. Drawn after the game so it sits on top of
 * everything except the debug HUD.
 */
export function drawBlockingOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: BlockingOverlayOptions,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(11, 11, 18, 0.78)';
  ctx.fillRect(0, 0, width, height);

  if (options.showGhost) {
    const cx = width / 2;
    const top = height * 0.16;
    const scale = height * 0.62;
    ctx.strokeStyle = 'rgba(232, 232, 240, 0.85)';
    ctx.fillStyle = 'rgba(232, 232, 240, 0.85)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    // Head.
    ctx.beginPath();
    ctx.arc(cx, top + scale * 0.07, scale * 0.07, 0, Math.PI * 2);
    ctx.stroke();
    // Torso: shoulders -> hips.
    const shoulderY = top + scale * 0.2;
    const hipY = top + scale * 0.55;
    ctx.beginPath();
    ctx.moveTo(cx, shoulderY);
    ctx.lineTo(cx, hipY);
    ctx.stroke();
    // Arms out wide, legs apart — the pose the gate wants to see.
    const shoulderHalf = scale * 0.16;
    const hipHalf = scale * 0.1;
    ctx.beginPath();
    ctx.moveTo(cx - shoulderHalf, shoulderY);
    ctx.lineTo(cx + shoulderHalf, shoulderY);
    ctx.moveTo(cx - hipHalf, hipY);
    ctx.lineTo(cx - hipHalf * 1.4, top + scale);
    ctx.moveTo(cx + hipHalf, hipY);
    ctx.lineTo(cx + hipHalf * 1.4, top + scale);
    ctx.stroke();
    // Joint dots at shoulders + hips.
    for (const [x, y] of [
      [cx - shoulderHalf, shoulderY],
      [cx + shoulderHalf, shoulderY],
      [cx - hipHalf, hipY],
      [cx + hipHalf, hipY],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const titleY = options.showGhost ? height * 0.86 : height * 0.44;
  ctx.font = `700 34px ${RENDER.gameFont}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(options.title, width / 2, titleY);
  if (options.subtitle !== '') {
    ctx.font = `24px ${RENDER.gameFont}`;
    ctx.fillStyle = '#e8e8f0';
    ctx.fillText(options.subtitle, width / 2, titleY + 44);
  }
  ctx.restore();
}

/**
 * Gate banner geometry (v3.2): a small pill at the very top of the
 * stage — no dim, no ghost. It must clear the game title / phase
 * banner below it (drawn at y 58, glyph tops ~y 41), so the pill
 * bottom (top + height = 40) sits 1 px above that line, and it must
 * clear the recipe-picker cards (top y 140) by a wide margin.
 */
export const GATE_BANNER = {
  /** Pill top edge, px from the stage top. */
  top: 6,
  /** Pill height in px. */
  height: 34,
  /** Horizontal padding inside the pill, each side, in px. */
  paddingX: 18,
  /** Minimum pill width in px (short messages still read as a banner). */
  minWidth: 220,
  /** Text size in px. */
  fontPx: 20,
} as const;

/** Canvas-space rect of the gate banner pill for `message`. */
export interface GateBannerRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Pure: the pill rect for a message of `textWidthPx` (measured with
 * `ctx.measureText`, or estimated). Centred, capped to the stage with
 * a 12 px margin each side so a long message can never run off the
 * stage — the pill grows, the stage never scrolls.
 */
export function gateBannerRect(
  width: number,
  textWidthPx: number,
): GateBannerRect {
  const w = Math.min(
    Math.max(
      textWidthPx + GATE_BANNER.paddingX * 2,
      GATE_BANNER.minWidth,
    ),
    width - 24,
  );
  return {
    x: (width - w) / 2,
    y: GATE_BANNER.top,
    w,
    h: GATE_BANNER.height,
  };
}

/**
 * Small top banner for a lost body while an activity screen is up
 * (v3.2): an opaque pill with the gate message, nothing else. No dim
 * rect, no framing ghost — the picker, tier chips and "Leave to town"
 * stay visible and tappable underneath it. See `shouldShowGateBanner`
 * in `core/gate.ts` for when the hub uses this instead of
 * `drawBlockingOverlay`.
 */
export function drawGateBanner(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  message: string,
): void {
  ctx.save();
  // Font FIRST, then measure (v3.3): the pill width is measured
  // with this font, so measuring before the font is set sizes the
  // pill for whatever font the previous draw left behind — the Nov 4
  // playtest frame showed the text running past the pill edge
  // ("I can't see your knees — ste").
  ctx.font = `700 ${GATE_BANNER.fontPx}px ${RENDER.gameFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textWidth =
    typeof ctx.measureText === 'function'
      ? ctx.measureText(message).width
      : message.length * (GATE_BANNER.fontPx * 0.55);
  const rect = gateBannerRect(width, textWidth);
  // Solid card colour, never translucent: the banner sits over live
  // game art and must read at a glance.
  ctx.fillStyle = '#1f1f33';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(message, width / 2, rect.y + rect.h / 2);
  ctx.restore();
  void height;
}
/**
 * The top-right action button (v3.6): one context-sensitive circle
 * that replaces the bottom-left "Leave to town" chip. Drawn by
 * `main.ts` after the game / hub, on top of everything except the
 * gate overlay and the debug HUD.
 *
 * - `town` mode: houses icon + "Town" label — dwell goes to town.
 * - `ok` mode: checkmark icon + "OK" label — dwell clicks the
 *   highlighted thing.
 * The icon change IS the mode signal, so the two icons are drawn
 * shapes (never emoji): a pair of little houses, and a checkmark.
 *
 * `progress` 0..1 is the dwell fill: a gold arc sweeps around the
 * circle as the confirm hand holds, over a faint full track ring so
 * the affordance reads even before the hold starts.
 */
export const ACTION_BUTTON_STYLE = {
  /** Opaque slate body — nothing shows through from behind. */
  body: '#232338',
  /** Gold border + dwell arc. */
  border: '#ffd166',
  /** Brighter gold while hovering a selectable (ok mode). */
  borderBright: '#ffe08a',
  /** Faint full track ring the dwell arc fills over. */
  track: 'rgba(255, 209, 102, 0.25)',
  /** Icon fill (houses) and checkmark stroke. */
  icon: '#f8f8f2',
  /** Roof colour on the houses icon. */
  roof: '#ffd166',
  /** Label text under the circle. */
  label: '#e8e8f0',
} as const;

export function drawActionButton(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: ActionButtonMode,
  progress: number,
): void {
  const geometry = actionButtonGeometry(width, height);
  const { cx, cy, r } = geometry;
  ctx.save();
  // Opaque body.
  ctx.fillStyle = ACTION_BUTTON_STYLE.body;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Dwell track: faint full ring just outside the body.
  ctx.strokeStyle = ACTION_BUTTON_STYLE.track;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
  ctx.stroke();
  // Dwell fill: gold arc sweeping clockwise from the top.
  if (progress > 0) {
    ctx.strokeStyle = ACTION_BUTTON_STYLE.border;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(
      cx,
      cy,
      r + 6,
      -Math.PI / 2,
      -Math.PI / 2 + progress * Math.PI * 2,
    );
    ctx.stroke();
  }
  // Gold border.
  ctx.strokeStyle =
    mode === 'ok'
      ? ACTION_BUTTON_STYLE.borderBright
      : ACTION_BUTTON_STYLE.border;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  // Icon: houses (town) or checkmark (ok) — drawn shapes, no emoji.
  if (mode === 'town') {
    drawHousesIcon(ctx, cx, cy);
  } else {
    ctx.strokeStyle = ACTION_BUTTON_STYLE.icon;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy + 1);
    ctx.lineTo(cx - 4, cy + 11);
    ctx.lineTo(cx + 15, cy - 10);
    ctx.stroke();
  }
  // Label under the circle, changing with the mode.
  ctx.font = `700 16px ${RENDER.gameFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ACTION_BUTTON_STYLE.label;
  ctx.fillText(actionButtonLabel(mode), cx, cy + r + 18);
  ctx.restore();
}

/** Two little houses side by side, centred on (cx, cy). */
function drawHousesIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
): void {
  ctx.save();
  ctx.fillStyle = ACTION_BUTTON_STYLE.icon;
  for (const hx of [cx - 13, cx + 13]) {
    // Body.
    ctx.fillRect(hx - 10, cy - 2, 20, 14);
    // Roof.
    ctx.fillStyle = ACTION_BUTTON_STYLE.roof;
    ctx.beginPath();
    ctx.moveTo(hx - 12, cy - 2);
    ctx.lineTo(hx, cy - 12);
    ctx.lineTo(hx + 12, cy - 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = ACTION_BUTTON_STYLE.icon;
  }
  ctx.restore();
}

/**
 * Pointer cursor (v3.6): a gold ring + centre dot at the pointer
 * (left wrist) canvas position, so the hand reads as a cursor. The
 * ring is drawn ON TOP of Worker A's hand circle — the hand circle
 * is the hitbox, this ring is the "you are pointing here" treatment.
 * The ring radius follows A's hand circle (`handCircleRadiusPx` in
 * `render/avatar.ts`, 0.125 torso lengths): the ring sits just
 * outside the hand circle at any body distance, so it can never end
 * up buried inside a big close-up hand circle or floating far off a
 * small far-away one. Hovering a selectable thing brightens the
 * ring and pushes it a little further out, so the highlight is
 * visible at the cursor as well as on the thing.
 *
 * The centre is the pointer point — the BodyState smoothed wrist,
 * the same position the detectors use. A's circle centre is the
 * avatar's own smoothed wrist; the two smoothers track the same
 * wrist, so the ring and the circle stay on top of each other.
 */
export const POINTER_CURSOR = {
  /** Ring sits this far outside the hand circle. */
  ringMarginPx: 6,
  /** Ring sits this far outside the hand circle while hovering. */
  ringMarginHoverPx: 10,
  lineWidthPx: 3,
  lineWidthHoverPx: 4,
  dotRadiusPx: 4,
} as const;

export function drawPointerCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  handRadiusPx: number,
  hovering: boolean,
): void {
  ctx.save();
  ctx.strokeStyle = hovering
    ? ACTION_BUTTON_STYLE.borderBright
    : ACTION_BUTTON_STYLE.border;
  ctx.lineWidth = hovering
    ? POINTER_CURSOR.lineWidthHoverPx
    : POINTER_CURSOR.lineWidthPx;
  ctx.beginPath();
  ctx.arc(
    x,
    y,
    handRadiusPx +
      (hovering
        ? POINTER_CURSOR.ringMarginHoverPx
        : POINTER_CURSOR.ringMarginPx),
    0,
    Math.PI * 2,
  );
  ctx.stroke();
  ctx.fillStyle = ACTION_BUTTON_STYLE.border;
  ctx.beginPath();
  ctx.arc(x, y, POINTER_CURSOR.dotRadiusPx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Hover glow ring for a selectable the pointer is over (v3.6): a
 * bright gold stroke just outside the rect, with a soft shadow so it
 * reads as a glow, not a border. `main.ts` draws this around a
 * refiner picker card (the hub reuses its own button hover state
 * instead — same gold, same meaning).
 */
export function drawHoverRing(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
): void {
  ctx.save();
  ctx.shadowColor = 'rgba(255, 209, 102, 0.9)';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = ACTION_BUTTON_STYLE.borderBright;
  ctx.lineWidth = 4;
  ctx.strokeRect(rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6);
  ctx.restore();
}

export function drawStageBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.fillStyle = RENDER.stageColor;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function canvasPoint(
  lm: NormalizedLandmark,
  width: number,
  height: number,
): Vec2 {
  return toCanvas(lm, width, height);
}

/** Draw the skeleton connections + joint dots for one pose. */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly NormalizedLandmark[],
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.strokeStyle = RENDER.skeletonColor;
  ctx.lineWidth = RENDER.skeletonLineWidthPx;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [a, b] of SKELETON_CONNECTIONS) {
    const la = landmarks[a];
    const lb = landmarks[b];
    if (la === undefined || lb === undefined) continue;
    const pa = canvasPoint(la, width, height);
    const pb = canvasPoint(lb, width, height);
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }
  ctx.stroke();

  // Joint dots: left side blue, right side orange, centre white.
  for (let i = 0; i < landmarks.length; i += 1) {
    const lm = landmarks[i];
    if (lm === undefined) continue;
    const p = canvasPoint(lm, width, height);
    ctx.fillStyle = jointColor(i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, RENDER.landmarkRadiusPx, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function jointColor(index: number): string {
  const leftSide: ReadonlySet<number> = new Set([
    PoseLandmark.LEFT_EYE,
    PoseLandmark.LEFT_EAR,
    PoseLandmark.LEFT_SHOULDER,
    PoseLandmark.LEFT_ELBOW,
    PoseLandmark.LEFT_WRIST,
    PoseLandmark.LEFT_HIP,
    PoseLandmark.LEFT_KNEE,
    PoseLandmark.LEFT_ANKLE,
  ]);
  const rightSide: ReadonlySet<number> = new Set([
    PoseLandmark.RIGHT_EYE,
    PoseLandmark.RIGHT_EAR,
    PoseLandmark.RIGHT_SHOULDER,
    PoseLandmark.RIGHT_ELBOW,
    PoseLandmark.RIGHT_WRIST,
    PoseLandmark.RIGHT_HIP,
    PoseLandmark.RIGHT_KNEE,
    PoseLandmark.RIGHT_ANKLE,
  ]);
  if (leftSide.has(index)) return RENDER.leftColor;
  if (rightSide.has(index)) return RENDER.rightColor;
  return RENDER.torsoColor;
}

/**
 * Draw a pose as a stickman inside an arbitrary rectangle (used for the
 * falling target in Dance Pose Drop). The pose's normalized coordinates are
 * mapped into `rect`; the drawing is NOT mirrored — the target is a picture,
 * not the player.
 */
export function drawStickmanInRect(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly NormalizedLandmark[],
  rect: { x: number; y: number; width: number; height: number },
  color: string = RENDER.skeletonColor,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, rect.width / 40);
  ctx.lineCap = 'round';
  const map = (lm: NormalizedLandmark): Vec2 => ({
    x: rect.x + lm.x * rect.width,
    y: rect.y + lm.y * rect.height,
  });
  ctx.beginPath();
  for (const [a, b] of SKELETON_CONNECTIONS) {
    const la = landmarks[a];
    const lb = landmarks[b];
    if (la === undefined || lb === undefined) continue;
    const pa = map(la);
    const pb = map(lb);
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }
  ctx.stroke();
  for (const lm of landmarks) {
    const p = map(lm);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, rect.width / 60), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
