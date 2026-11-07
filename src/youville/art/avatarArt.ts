/**
 * YouVille avatar drawing: modular vector shapes.
 *
 * The AvatarAppearance (what the player chose) and the pose
 * (`AvatarPose`: facing, walk phase, view) are SEPARATE data models;
 * this module only combines them at draw time. There is no gender
 * switch and no gendered asset: one body, every skin tone, every
 * hairstyle.
 */
import type { AvatarAppearance, Hairstyle } from '../../creator/avatarAppearance';

export type AvatarView = 'side' | 'front';

export interface AvatarPose {
  /** World x of the feet. */
  x: number;
  /** World y of the soles. */
  footY: number;
  /** -1 = faces left, 1 = faces right (side view only). */
  facing: -1 | 1;
  /** Walk-cycle phase in radians-ish; ignored when `walking` is false. */
  walkPhase: number;
  walking: boolean;
  view: AvatarView;
  scale: number;
}

const HAIR = '#2a1a13';
const PANTS = '#3c4a6e';
const SHOE = '#231c1c';

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
): void {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function disc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Hair behind the head (drawn before the head). Local coords, head centre (0, hy). */
function drawHairBack(
  ctx: CanvasRenderingContext2D,
  style: Hairstyle,
  hy: number,
  view: AvatarView,
): void {
  const spread = view === 'front' ? 1 : 0.7;
  switch (style) {
    case 'long':
      fillRoundRect(ctx, -26 * spread - 2, hy - 8, 52 * spread + 4, 78, 14, HAIR);
      break;
    case 'locs':
      for (let i = -4; i <= 4; i += 1) {
        const len = 44 + ((i * 7) % 5) * 5;
        fillRoundRect(ctx, i * 6.2 * spread - 2.6, hy - 6, 5.4, len, 2.7, HAIR);
      }
      break;
    case 'braids':
      for (const side of [-1, 1]) {
        if (view === 'side' && side === 1) continue;
        for (let k = 0; k < 6; k += 1) {
          disc(ctx, side * 22 * spread - (view === 'side' ? 6 : 0), hy + 8 + k * 9, 4.6, HAIR);
        }
        disc(ctx, side * 22 * spread - (view === 'side' ? 6 : 0), hy + 62, 3.4, '#c9573a');
      }
      break;
    default:
      break;
  }
}

/** Hair on top of the head. */
function drawHairFront(
  ctx: CanvasRenderingContext2D,
  style: Hairstyle,
  hy: number,
  view: AvatarView,
): void {
  const cap = (radius: number, from: number, to: number): void => {
    ctx.beginPath();
    ctx.arc(0, hy, radius, Math.PI * from, Math.PI * to);
    ctx.closePath();
    ctx.fillStyle = HAIR;
    ctx.fill();
  };
  switch (style) {
    case 'buzz':
      cap(25.2, 1.08, 1.92);
      break;
    case 'short':
      cap(26.5, 1.0, 2.0);
      fillRoundRect(ctx, -22, hy - 22, 30, 10, 5, HAIR);
      break;
    case 'curls':
      cap(24, 1.0, 2.0);
      for (let i = 0; i < 7; i += 1) {
        const a = Math.PI * (1.02 + (i / 6) * 0.96);
        disc(ctx, Math.cos(a) * 25, hy + Math.sin(a) * 25, 8.5, HAIR);
      }
      disc(ctx, 0, hy - 30, 9, HAIR);
      break;
    case 'coils':
      cap(24, 1.0, 2.0);
      for (let ring = 0; ring < 2; ring += 1) {
        const r = 25 + ring * 5;
        const n = 10 + ring * 3;
        for (let i = 0; i < n; i += 1) {
          const a = Math.PI * (1.0 + (i / (n - 1)) * 1.0);
          disc(ctx, Math.cos(a) * r, hy + Math.sin(a) * r, 5.4, HAIR);
        }
      }
      break;
    case 'braids':
      cap(25.5, 1.0, 2.0);
      for (let i = -3; i <= 3; i += 1) {
        ctx.beginPath();
        ctx.moveTo(i * 7.5, hy - 25);
        ctx.lineTo(i * 7.5 * 0.8, hy - 4);
        ctx.strokeStyle = '#4a3328';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      break;
    case 'locs':
      cap(25.5, 1.0, 2.0);
      break;
    case 'long':
      cap(26.5, 1.0, 2.0);
      fillRoundRect(ctx, -24, hy - 24, 48, 14, 7, HAIR);
      break;
  }
  void view;
}

/**
 * Draw the avatar's head and hair only (closet hairstyle swatches).
 * Centre of the head at (cx, cy), radius ~24 * scale.
 */
export function drawAvatarHead(
  ctx: CanvasRenderingContext2D,
  appearance: Pick<AvatarAppearance, 'skinTone' | 'hairstyle'>,
  cx: number,
  cy: number,
  scale: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  drawHairBack(ctx, appearance.hairstyle, 0, 'front');
  disc(ctx, 0, 0, 24, appearance.skinTone);
  drawFace(ctx, 0, 'front');
  drawHairFront(ctx, appearance.hairstyle, 0, 'front');
  ctx.restore();
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  hy: number,
  view: AvatarView,
): void {
  const eye = '#1c1414';
  if (view === 'front') {
    disc(ctx, -8.5, hy - 1, 2.6, eye);
    disc(ctx, 8.5, hy - 1, 2.6, eye);
  } else {
    disc(ctx, 9, hy - 1, 2.6, eye);
  }
  ctx.beginPath();
  ctx.arc(view === 'front' ? 0 : 6, hy + 5, 8, Math.PI * 0.2, Math.PI * 0.8);
  ctx.strokeStyle = eye;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.stroke();
}

export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  appearance: AvatarAppearance,
  pose: AvatarPose,
): void {
  const { skinTone, hairstyle, shirtColor } = appearance;
  const swing = pose.walking ? Math.sin(pose.walkPhase) : 0;
  const bob = pose.walking ? Math.abs(Math.cos(pose.walkPhase)) * 2.5 : 0;
  const hy = -134 - bob;

  ctx.save();
  ctx.translate(pose.x, pose.footY);
  ctx.scale(pose.scale * (pose.view === 'side' ? pose.facing : 1), pose.scale);

  // Ground shadow.
  ctx.beginPath();
  ctx.ellipse(0, 1, 34, 7, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fill();

  const front = pose.view === 'front';
  drawHairBack(ctx, hairstyle, hy, pose.view);

  // Legs.
  const legW = 15;
  const legH = 52;
  if (front) {
    fillRoundRect(ctx, -17 - swing * 2, -legH, legW, legH - 4, 5, PANTS);
    fillRoundRect(ctx, 2 + swing * 2, -legH, legW, legH - 4, 5, PANTS);
    fillRoundRect(ctx, -19, -8, 19, 8, 4, SHOE);
    fillRoundRect(ctx, 0, -8, 19, 8, 4, SHOE);
  } else {
    fillRoundRect(ctx, -7 - swing * 12, -legH, legW, legH - 4, 5, PANTS);
    fillRoundRect(ctx, -7 + swing * 12, -legH, legW, legH - 4, 5, PANTS);
    fillRoundRect(ctx, -6 - swing * 12, -8, 22, 8, 4, SHOE);
    fillRoundRect(ctx, -6 + swing * 12, -8, 22, 8, 4, SHOE);
  }

  // Back arm (side view), torso, front arm.
  if (!front) {
    fillRoundRect(ctx, -6 + swing * 14, -104, 12, 46, 6, skinTone);
  }
  fillRoundRect(ctx, front ? -26 : -20, -112, front ? 52 : 40, 64, 14, shirtColor);
  if (front) {
    fillRoundRect(ctx, -40, -106, 13, 48, 6.5, skinTone);
    fillRoundRect(ctx, 27, -106, 13, 48, 6.5, skinTone);
  } else {
    fillRoundRect(ctx, -6 - swing * 14, -104, 12, 46, 6, skinTone);
    // Shirt sleeve over the arm.
    fillRoundRect(ctx, -7 - swing * 14, -108, 14, 20, 6, shirtColor);
  }

  // Neck + head.
  fillRoundRect(ctx, -6, hy + 16, 12, 14, 4, skinTone);
  disc(ctx, 0, hy, 24, skinTone);
  drawFace(ctx, hy, pose.view);
  drawHairFront(ctx, hairstyle, hy, pose.view);

  ctx.restore();
}
