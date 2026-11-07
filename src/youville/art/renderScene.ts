/**
 * Draws one YouVille frame from a session. Pure drawing: it never
 * mutates the session. Everything is in the fixed 960x540 world;
 * the canvas is never CSS-flipped (mirroring happened once, in the
 * pose -> world mapping).
 */
import type { Cell } from '../closetLayout';
import { CREATOR, WORLD } from '../config';
import { DOOR_METHOD_LABELS } from '../interaction';
import { getRoom } from '../rooms';
import type { YouVilleSession } from '../session';
import { drawAvatar, drawAvatarHead } from './avatarArt';
import { drawDoor, drawRoomCached } from './roomArt';
import type { NormalizedLandmark } from '../../tracking/poseTypes';
import { drawSkeleton } from '../../render/renderer';

export interface SceneInfo {
  nowMs: number;
  cameraOn: boolean;
  /** Status banner text (camera lost, model loading...), or null. */
  banner: string | null;
  landmarks: readonly NormalizedLandmark[] | null;
  debug: boolean;
  debugLines: readonly string[];
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function rrectPath(
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

/** Greedy word wrap into lines no wider than maxWidth. */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const trial = line === '' ? word : `${line} ${word}`;
    if (line !== '' && ctx.measureText(trial).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = trial;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

function bubble(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  top: number,
  maxWidth: number,
  fontPx: number,
): void {
  ctx.save();
  ctx.font = `600 ${String(fontPx)}px ${FONT}`;
  const lines = wrapText(ctx, text, maxWidth - 28);
  const lineH = fontPx * 1.3;
  const w = Math.min(
    maxWidth,
    Math.max(...lines.map((l) => ctx.measureText(l).width)) + 28,
  );
  const h = lines.length * lineH + 20;
  const x = Math.min(WORLD.width - w - 8, Math.max(8, cx - w / 2));
  rrectPath(ctx, x, top, w, h, 14);
  ctx.fillStyle = 'rgba(20, 16, 30, 0.82)';
  ctx.fill();
  ctx.fillStyle = '#fff7e0';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, x + 14, top + 10 + i * lineH));
  ctx.restore();
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  cell: Cell,
  session: YouVilleSession,
  nowMs: number,
): void {
  const creator = session.creator;
  const hovered = creator.hoveredId === cell.id;
  const chosen =
    cell.category !== 'done' &&
    creator.committed[cell.category] === cell.value;
  const flashing = creator.flashId === cell.id;

  rrectPath(ctx, cell.x, cell.y, cell.w, cell.h, 12);
  if (cell.category === 'done') {
    ctx.fillStyle = hovered ? '#ffd166' : '#f4b942';
    ctx.fill();
    ctx.fillStyle = '#2b1d00';
    ctx.font = `800 26px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Done ✓', cell.x + cell.w / 2, cell.y + cell.h / 2 + 1);
  } else if (cell.category === 'skinTone') {
    ctx.fillStyle = cell.value;
    ctx.fill();
  } else if (cell.category === 'shirtColor') {
    ctx.fillStyle = cell.value;
    ctx.fill();
  } else {
    ctx.fillStyle = '#3f3552';
    ctx.fill();
    ctx.save();
    rrectPath(ctx, cell.x, cell.y, cell.w, cell.h, 12);
    ctx.clip();
    drawAvatarHead(
      ctx,
      {
        skinTone: creator.previewAppearance().skinTone,
        hairstyle: cell.value as never,
      },
      cell.x + cell.w / 2,
      cell.y + cell.h / 2 + 4,
      Math.min(cell.w, cell.h) / 88,
    );
    ctx.restore();
  }
  if (flashing) {
    rrectPath(ctx, cell.x, cell.y, cell.w, cell.h, 12);
    ctx.fillStyle = `rgba(255,255,255,${String(0.35 + 0.25 * Math.sin(nowMs / 60))})`;
    ctx.fill();
  }
  if (chosen) {
    rrectPath(ctx, cell.x - 3, cell.y - 3, cell.w + 6, cell.h + 6, 14);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  if (hovered) {
    ctx.save();
    ctx.shadowColor = 'rgba(255, 209, 102, 0.95)';
    ctx.shadowBlur = 16;
    rrectPath(ctx, cell.x - 5, cell.y - 5, cell.w + 10, cell.h + 10, 16);
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }
}

const LEVER_TEXT: Record<string, string> = {
  idle: 'Point at an option, then hold your other arm straight out to the side',
  arming: 'Hold that arm out…',
  armed: 'Lever ready! Pull your arm down',
  pulling: 'Keep pulling…',
  latched: 'Locked in! Raise your arm again for the next one',
};

function drawCloset(
  ctx: CanvasRenderingContext2D,
  session: YouVilleSession,
  info: SceneInfo,
): void {
  const creator = session.creator;
  const layout = creator.layout;
  ctx.save();
  ctx.fillStyle = '#fff7e0';
  ctx.font = `800 28px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('The Closet', 350, 54);
  ctx.font = `600 15px ${FONT}`;
  ctx.fillStyle = 'rgba(255,247,224,0.8)';
  ctx.fillText('Pick how you look. Everything is yours to mix.', 350, 76);

  for (const row of layout.rows) {
    ctx.font = `700 17px ${FONT}`;
    ctx.fillStyle = '#fff7e0';
    ctx.textAlign = 'left';
    ctx.fillText(
      `${row.label}${creator.isComplete(row.category) ? '  ✓' : ''}`,
      350,
      row.labelY,
    );
    for (const cell of row.cells) drawCell(ctx, cell, session, info.nowMs);
  }
  drawCell(ctx, layout.done, session, info.nowMs);

  // Lever guide, bottom-left.
  const phase = creator.leverPhase;
  if (info.cameraOn) {
    const text = LEVER_TEXT[phase] ?? '';
    bubble(ctx, text, 190, 462, 330, 14);
    // Lever progress pips.
    const steps = ['idle', 'armed', 'pulling', 'latched'] as const;
    const idx =
      phase === 'arming' ? 0 : Math.max(0, steps.indexOf(phase));
    steps.forEach((_s, i) => {
      ctx.beginPath();
      ctx.arc(40 + i * 22, 524, 6, 0, Math.PI * 2);
      ctx.fillStyle = i <= idx && phase !== 'idle' ? '#ffd166' : 'rgba(255,255,255,0.28)';
      ctx.fill();
    });
  } else {
    bubble(ctx, 'Tap or click an option, or use the arrow keys and Enter.', 190, 470, 330, 14);
  }
  ctx.restore();

  // Pose cursor (hand pointer).
  const cursor = creator.cursor;
  if (cursor !== null) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, CREATOR.cursorRadiusPx, 0, Math.PI * 2);
    ctx.strokeStyle = creator.hoveredId === null ? '#ffffff' : '#ffd166';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    ctx.restore();
  }
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  session: YouVilleSession,
  info: SceneInfo,
): void {
  const room = getRoom(session.roomId);
  ctx.clearRect(0, 0, WORLD.width, WORLD.height);
  drawRoomCached(ctx, room);

  // Doors (glow when usable).
  const near = session.nearbyDoor;
  for (const door of room.doors) {
    const glow =
      near !== null && near.id === door.id
        ? 0.5 + 0.5 * Math.sin(info.nowMs / 220)
        : 0;
    drawDoor(ctx, door, room.id, glow);
  }

  if (room.id === 'closet') {
    // Mirror avatar: front view, larger, wearing the live preview.
    drawAvatar(ctx, session.displayAppearance, {
      x: session.creator.layout.avatar.x,
      footY: session.creator.layout.avatar.y,
      facing: 1,
      walkPhase: 0,
      walking: false,
      view: 'front',
      scale: 1.55,
    });
  } else {
    drawAvatar(ctx, session.displayAppearance, {
      x: session.mover.x,
      footY: WORLD.floorY + 14,
      facing: session.mover.facing,
      walkPhase: session.walkPhase,
      walking: session.mover.moving,
      view: 'side',
      scale: 1,
    });
  }

  if (room.id === 'closet') {
    drawCloset(ctx, session, info);
  } else {
    // Room title + hint.
    ctx.save();
    ctx.font = `800 22px ${FONT}`;
    ctx.fillStyle = 'rgba(40, 24, 10, 0.7)';
    ctx.textAlign = 'left';
    ctx.fillText(room.title, 20, 36);
    ctx.restore();
    if (session.hint !== null) {
      const door = session.nearbyDoor;
      if (door !== null) {
        bubble(ctx, `${DOOR_METHOD_LABELS[session.doorMethod]}: ${session.hint}`, door.x - 150, door.hitRect.y - 112, 380, 15);
      } else {
        bubble(ctx, session.hint, WORLD.width / 2, 16, 460, 16);
      }
    }
  }

  if (info.banner !== null) {
    bubble(ctx, info.banner, WORLD.width / 2, 70, 520, 16);
  }

  if (info.debug) drawDebug(ctx, info);

  // Fade overlay is always last.
  const alpha = session.transition.alpha;
  if (alpha > 0) {
    ctx.fillStyle = `rgba(14, 10, 22, ${String(alpha)})`;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  }
}

function drawDebug(ctx: CanvasRenderingContext2D, info: SceneInfo): void {
  ctx.save();
  // Skeleton PIP: landmarks only (never video), drawn once-mirrored.
  if (info.landmarks !== null) {
    const s = 0.3;
    ctx.save();
    ctx.translate(WORLD.width - WORLD.width * s - 10, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, WORLD.width * s, WORLD.height * s);
    ctx.scale(s, s);
    drawSkeleton(ctx, info.landmarks, WORLD.width, WORLD.height);
    ctx.restore();
  }
  ctx.font = `12px ui-monospace, monospace`;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(8, 44, 330, 14 * info.debugLines.length + 8);
  ctx.fillStyle = '#9dffb0';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  info.debugLines.forEach((l, i) => ctx.fillText(l, 14, 48 + i * 14));
  ctx.restore();
}
