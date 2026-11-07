/**
 * Room data. Rooms and doors are plain data: the interaction
 * controller, the transition and the renderer read these records and
 * never special-case "the bedroom" or "the closet".
 *
 * Interactables live in WORLD coordinates (the fixed 960x540 room),
 * never in camera/video coordinates.
 */
import { WORLD } from './config';

export type RoomId = 'bedroom' | 'closet';

/** A modular vector shape. Rooms are composed of these, drawn (and cached) by the renderer. */
export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string; r?: number }
  | { kind: 'circle'; x: number; y: number; r: number; fill: string }
  | { kind: 'ellipse'; x: number; y: number; rx: number; ry: number; fill: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number };

export interface Prop {
  id: string;
  shapes: readonly Shape[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A data-configured doorway. `activation: 'proximity'` doors need the
 * avatar inside `reach` of `x` (motion gesture or Enter); `'ui'` doors
 * are triggered by an on-screen control (the closet's Done) and skip
 * the proximity gate.
 */
export interface DoorDef {
  id: string;
  action: 'enter' | 'exit';
  activation: 'proximity' | 'ui';
  /** World x of the door's centre. */
  x: number;
  /** Half-width of the interaction region, world px. */
  reach: number;
  /** Visible, highlightable doorway. */
  hitRect: Rect;
  destinationRoomId: RoomId;
  /** Where the avatar appears in the destination room. */
  arrivalX: number;
}

export interface RoomDef {
  id: RoomId;
  title: string;
  wall: string;
  floor: string;
  baseboard: string;
  /** Bounded walking range, or null when the avatar stands still. */
  walk: { minX: number; maxX: number } | null;
  /** Where the avatar starts when the session begins here. */
  spawnX: number;
  doors: readonly DoorDef[];
  props: readonly Prop[];
}

const floorY = WORLD.floorY;

const BEDROOM: RoomDef = {
  id: 'bedroom',
  title: 'Your Room',
  wall: '#e9d8b8',
  floor: '#a9714a',
  baseboard: '#8c5a39',
  walk: { minX: 70, maxX: 890 },
  spawnX: 360,
  doors: [
    {
      id: 'closet-door',
      action: 'enter',
      activation: 'proximity',
      x: 820,
      reach: 90,
      hitRect: { x: 756, y: 170, w: 128, h: floorY - 170 },
      destinationRoomId: 'closet',
      arrivalX: 222,
    },
  ],
  props: [
    {
      id: 'window',
      shapes: [
        { kind: 'rect', x: 150, y: 90, w: 150, h: 130, fill: '#f6f1e4', r: 8 },
        { kind: 'rect', x: 160, y: 100, w: 130, h: 110, fill: '#9fd3f0', r: 4 },
        { kind: 'circle', x: 250, y: 140, r: 16, fill: '#fff3b0' },
        { kind: 'ellipse', x: 195, y: 175, rx: 28, ry: 11, fill: '#ffffff' },
        { kind: 'rect', x: 222, y: 100, w: 6, h: 110, fill: '#f6f1e4' },
        { kind: 'rect', x: 160, y: 152, w: 130, h: 6, fill: '#f6f1e4' },
      ],
    },
    {
      id: 'wall-art',
      shapes: [
        { kind: 'rect', x: 436, y: 96, w: 110, h: 84, fill: '#7a5230', r: 4 },
        { kind: 'rect', x: 444, y: 104, w: 94, h: 68, fill: '#f4e9d2' },
        { kind: 'circle', x: 470, y: 128, r: 12, fill: '#e0745c' },
        { kind: 'rect', x: 488, y: 134, w: 44, h: 30, fill: '#6d9c78' },
      ],
    },
    {
      id: 'bed',
      shapes: [
        { kind: 'rect', x: 36, y: 328, w: 20, h: floorY - 328, fill: '#7a5230', r: 4 },
        { kind: 'rect', x: 36, y: floorY - 62, w: 268, h: 62, fill: '#8a5c38', r: 6 },
        { kind: 'rect', x: 44, y: floorY - 92, w: 252, h: 38, fill: '#7fa7c4', r: 10 },
        { kind: 'rect', x: 62, y: floorY - 112, w: 70, h: 28, fill: '#fff6e6', r: 12 },
        { kind: 'rect', x: 150, y: floorY - 96, w: 140, h: 42, fill: '#5e8aab', r: 10 },
        { kind: 'rect', x: 284, y: floorY - 40, w: 14, h: 40, fill: '#7a5230', r: 3 },
      ],
    },
    {
      id: 'rug',
      shapes: [
        { kind: 'ellipse', x: 520, y: floorY + 34, rx: 170, ry: 22, fill: '#b5566a' },
        { kind: 'ellipse', x: 520, y: floorY + 34, rx: 140, ry: 16, fill: '#d9889a' },
        { kind: 'ellipse', x: 520, y: floorY + 34, rx: 90, ry: 9, fill: '#f0c6cf' },
      ],
    },
    {
      id: 'plant',
      shapes: [
        { kind: 'rect', x: 650, y: floorY - 44, w: 34, h: 44, fill: '#c0643c', r: 5 },
        { kind: 'circle', x: 667, y: floorY - 62, r: 20, fill: '#4f8a52' },
        { kind: 'circle', x: 650, y: floorY - 50, r: 14, fill: '#5ea162' },
        { kind: 'circle', x: 684, y: floorY - 52, r: 14, fill: '#5ea162' },
      ],
    },
  ],
};

const CLOSET: RoomDef = {
  id: 'closet',
  title: 'The Closet',
  wall: '#6a5a7e',
  floor: '#4d4160',
  baseboard: '#3b3149',
  walk: null,
  spawnX: 222,
  doors: [
    {
      id: 'closet-exit',
      action: 'exit',
      activation: 'ui',
      x: 70,
      reach: 90,
      hitRect: { x: 18, y: 190, w: 104, h: floorY - 190 },
      destinationRoomId: 'bedroom',
      arrivalX: 770,
    },
  ],
  props: [
    {
      id: 'rail',
      shapes: [
        { kind: 'rect', x: 0, y: 120, w: 960, h: 8, fill: '#c9b896', r: 3 },
        { kind: 'rect', x: 200, y: 126, w: 5, h: 26, fill: '#c9b896' },
        { kind: 'rect', x: 430, y: 126, w: 5, h: 26, fill: '#c9b896' },
      ],
    },
    {
      id: 'mirror',
      shapes: [
        { kind: 'rect', x: 116, y: 138, w: 214, h: 300, fill: '#8d7bb0', r: 14 },
        { kind: 'rect', x: 128, y: 150, w: 190, h: 276, fill: '#d9e8f2', r: 8 },
        { kind: 'line', x1: 150, y1: 178, x2: 196, y2: 132, stroke: '#ffffff', width: 6 },
      ],
    },
  ],
};

export const ROOMS: Readonly<Record<RoomId, RoomDef>> = {
  bedroom: BEDROOM,
  closet: CLOSET,
};

export function getRoom(id: RoomId): RoomDef {
  return ROOMS[id];
}

/** Door in this room whose interaction region contains worldX (proximity doors only). */
export function doorInRange(room: RoomDef, worldX: number): DoorDef | null {
  for (const door of room.doors) {
    if (door.activation !== 'proximity') continue;
    if (Math.abs(worldX - door.x) <= door.reach) return door;
  }
  return null;
}

export function findDoor(room: RoomDef, doorId: string): DoorDef | null {
  return room.doors.find((d) => d.id === doorId) ?? null;
}
