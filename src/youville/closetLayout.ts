/**
 * Closet selection layout: FIXED in scene/screen (world) coordinates.
 *
 * Targets never follow the player's hips or hands (the old refinery
 * moving-button bug), and nothing here is derived from camera data.
 * Pure functions so layout and hit-testing are unit-testable.
 */
import {
  HAIRSTYLES,
  SHIRT_COLORS,
  SKIN_TONES,
  isAppearanceChoice,
  type AppearanceCategory,
  type AvatarAppearance,
} from '../creator/avatarAppearance';

export type CellCategory = AppearanceCategory | 'done';

export interface Cell {
  /** `category:value`, or `done`. */
  id: string;
  category: CellCategory;
  value: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ClosetRow {
  category: AppearanceCategory;
  label: string;
  /** y of the row label baseline. */
  labelY: number;
  cells: Cell[];
}

export interface ClosetLayout {
  rows: ClosetRow[];
  done: Cell;
  /** Where the mirror avatar stands. */
  avatar: { x: number; y: number };
  /** All cells in focus order (row-major, Done last). */
  all: Cell[];
}

const PANEL_X = 350;
const PANEL_W = 590;
const GAP = 8;

function rowCells(
  category: AppearanceCategory,
  values: readonly string[],
  y: number,
  maxCell: number,
  height: number,
): Cell[] {
  const n = values.length;
  const w = Math.min(maxCell, Math.floor((PANEL_W - GAP * (n - 1)) / n));
  return values.map((value, i) => ({
    id: `${category}:${value}`,
    category,
    value,
    x: PANEL_X + i * (w + GAP),
    y,
    w,
    h: height,
  }));
}

export function closetLayout(): ClosetLayout {
  const rows: ClosetRow[] = [
    {
      category: 'skinTone',
      label: 'Skin tone',
      labelY: 108,
      cells: rowCells('skinTone', SKIN_TONES, 120, 56, 56),
    },
    {
      category: 'hairstyle',
      label: 'Hair',
      labelY: 214,
      cells: rowCells('hairstyle', HAIRSTYLES, 226, 80, 80),
    },
    {
      category: 'shirtColor',
      label: 'Shirt',
      labelY: 342,
      cells: rowCells('shirtColor', SHIRT_COLORS, 354, 80, 64),
    },
  ];
  const done: Cell = {
    id: 'done',
    category: 'done',
    value: 'done',
    x: PANEL_X + PANEL_W - 230,
    y: 446,
    w: 230,
    h: 64,
  };
  return {
    rows,
    done,
    avatar: { x: 222, y: 438 },
    all: [...rows.flatMap((r) => r.cells), done],
  };
}

/** The topmost cell containing (x, y), or null. */
export function hitTestCell(
  layout: ClosetLayout,
  x: number,
  y: number,
): Cell | null {
  for (const cell of layout.all) {
    if (x >= cell.x && x <= cell.x + cell.w && y >= cell.y && y <= cell.y + cell.h) {
      return cell;
    }
  }
  return null;
}

/** Parse a cell id into a validated appearance choice, or 'done', or null. */
export function parseCellId(
  id: string,
):
  | { kind: 'done' }
  | { kind: 'choice'; category: AppearanceCategory; value: string }
  | null {
  if (id === 'done') return { kind: 'done' };
  const sep = id.indexOf(':');
  if (sep < 0) return null;
  const category = id.slice(0, sep);
  const value = id.slice(sep + 1);
  if (
    category !== 'skinTone' &&
    category !== 'hairstyle' &&
    category !== 'shirtColor'
  ) {
    return null;
  }
  return isAppearanceChoice(category, value)
    ? { kind: 'choice', category, value }
    : null;
}

/** Cell id for the currently chosen value of a category. */
export function selectedCellId(
  appearance: AvatarAppearance,
  category: AppearanceCategory,
): string {
  return `${category}:${appearance[category]}`;
}

/**
 * Keyboard focus movement over the grid: left/right move within a
 * row, up/down move between rows (and Done), keeping the column when
 * possible.
 */
export function moveFocus(
  layout: ClosetLayout,
  currentId: string | null,
  dx: -1 | 0 | 1,
  dy: -1 | 0 | 1,
): string {
  const lines: Cell[][] = [...layout.rows.map((r) => r.cells), [layout.done]];
  let row = 0;
  let col = 0;
  if (currentId !== null) {
    for (let r = 0; r < lines.length; r += 1) {
      const c = (lines[r] ?? []).findIndex((cell) => cell.id === currentId);
      if (c >= 0) {
        row = r;
        col = c;
      }
    }
  }
  row = Math.min(lines.length - 1, Math.max(0, row + dy));
  const line = lines[row] ?? [];
  col = Math.min(line.length - 1, Math.max(0, col + dx));
  return (line[col] ?? layout.done).id;
}
