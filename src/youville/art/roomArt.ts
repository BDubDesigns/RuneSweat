/**
 * Room drawing from modular shape data (`rooms.ts`).
 *
 * The static layer of each room (wall, floor, props) is composed from
 * small vector shapes and rendered once into a cached offscreen
 * canvas; doors and highlights are drawn live on top. Editing a prop
 * means editing its shape list, not regenerating a giant raster.
 */
import { WORLD } from '../config';
import type { DoorDef, RoomDef, Shape } from '../rooms';

function rrect(
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

export function drawShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  switch (shape.kind) {
    case 'rect':
      if (shape.r !== undefined && shape.r > 0) {
        rrect(ctx, shape.x, shape.y, shape.w, shape.h, shape.r);
        ctx.fillStyle = shape.fill;
        ctx.fill();
      } else {
        ctx.fillStyle = shape.fill;
        ctx.fillRect(shape.x, shape.y, shape.w, shape.h);
      }
      break;
    case 'circle':
      ctx.beginPath();
      ctx.arc(shape.x, shape.y, shape.r, 0, Math.PI * 2);
      ctx.fillStyle = shape.fill;
      ctx.fill();
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(shape.x, shape.y, shape.rx, shape.ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = shape.fill;
      ctx.fill();
      break;
    case 'line':
      ctx.beginPath();
      ctx.moveTo(shape.x1, shape.y1);
      ctx.lineTo(shape.x2, shape.y2);
      ctx.strokeStyle = shape.stroke;
      ctx.lineWidth = shape.width;
      ctx.lineCap = 'round';
      ctx.stroke();
      break;
  }
}

/** Wall, floor and props: everything static about a room. */
export function drawRoomStatic(
  ctx: CanvasRenderingContext2D,
  room: RoomDef,
): void {
  const { floorY, width, height } = WORLD;
  ctx.fillStyle = room.wall;
  ctx.fillRect(0, 0, width, floorY);
  // Soft wall stripes.
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let x = 0; x < width; x += 80) ctx.fillRect(x, 0, 40, floorY);
  ctx.fillStyle = room.floor;
  ctx.fillRect(0, floorY, width, height - floorY);
  ctx.fillStyle = room.baseboard;
  ctx.fillRect(0, floorY - 10, width, 10);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 2;
  for (let y = floorY + 26; y < height; y += 26) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (const prop of room.props) {
    for (const shape of prop.shapes) drawShape(ctx, shape);
  }
}

const cache = new Map<string, CanvasImageSource>();

/** Draw a room's static layer, through a cached offscreen canvas when a DOM exists. */
export function drawRoomCached(
  ctx: CanvasRenderingContext2D,
  room: RoomDef,
): void {
  let layer = cache.get(room.id);
  if (layer === undefined && typeof document !== 'undefined') {
    const off = document.createElement('canvas');
    off.width = WORLD.width;
    off.height = WORLD.height;
    const octx = off.getContext('2d');
    if (octx !== null) {
      drawRoomStatic(octx, room);
      cache.set(room.id, off);
      layer = off;
    }
  }
  if (layer === undefined) {
    drawRoomStatic(ctx, room);
    return;
  }
  ctx.drawImage(layer, 0, 0);
}

/** A doorway; `glow` (0..1) lights it when it is usable. */
export function drawDoor(
  ctx: CanvasRenderingContext2D,
  door: DoorDef,
  roomId: string,
  glow: number,
): void {
  const { x, y, w, h } = door.hitRect;
  ctx.save();
  if (glow > 0) {
    ctx.shadowColor = `rgba(255, 214, 102, ${String(0.35 + 0.65 * glow)})`;
    ctx.shadowBlur = 10 + 22 * glow;
  }
  // Frame.
  rrect(ctx, x - 8, y - 8, w + 16, h + 8, 8);
  ctx.fillStyle = '#6b4526';
  ctx.fill();
  ctx.restore();
  if (roomId === 'bedroom') {
    // Closet door: louvred wood.
    rrect(ctx, x, y, w, h, 4);
    ctx.fillStyle = '#c99a62';
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,55,25,0.55)';
    ctx.lineWidth = 3;
    for (let ly = y + 22; ly < y + h - 24; ly += 16) {
      ctx.beginPath();
      ctx.moveTo(x + 14, ly);
      ctx.lineTo(x + w - 14, ly);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x + 20, y + h * 0.55, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#f2d36b';
    ctx.fill();
  } else {
    // Closet's inner door back to the room.
    rrect(ctx, x, y, w, h, 4);
    ctx.fillStyle = '#d8b07a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + w - 20, y + h * 0.55, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#f2d36b';
    ctx.fill();
  }
}
