/**
 * Town hub (v3.2): town is a PLACE, not a pause menu. Going to town
 * takes the player OUT of the activity they are in and INTO town; the
 * hub is a full-screen, opaque screen, and the game is NOT drawn
 * behind it (main.ts skips the whole game render while the hub is
 * open, and this module paints its own opaque backdrop first).
 * Leaving town means picking an activity — Mine, Refiner, or Bix's
 * shop — or pressing Space / Escape / the Back button, which returns
 * to the last activity. The auto-pause (body out of frame) is a
 * different thing: it freezes the activity and never opens the hub.
 *
 * Worker A owns the pause state machine that opens / closes this;
 * this module owns only the town screen itself — what it shows and
 * what its taps do.
 *
 * INTERFACE (for the coordinator wiring it into `main.ts`):
 * ```ts
 * const hub = new TownHub({
 *   onLeaveTown: () => { /* leave town, return to the last activity *\/ },
 *   onOpenMine: () => { /* switch to the mine (Swing Lab) *\/ },
 *   onOpenRefiner: () => { /* switch to the Refiner game *\/ },
 *   onReset: () => { /* save was reset — refresh any cached HUD *\/ },
 * });
 * hub.open();                 // show town (pause machine calls this)
 * hub.close();                // hide it (no callback — the caller resumes)
 * hub.isOpen;                 // boolean
 * hub.setReturnLabel('⛏ Back to the mine');  // label of the Back button
 * hub.render(ctx, nowMs);     // draw the town screen; reads the inventory store live
 * hub.handlePointer(x, y);    // canvas-space tap; true when a button was hit
 * hub.handlePointerMove(x, y);// hover tracking (main.ts forwards pointermove)
 * hub.handlePointerDown(x, y);// arms the pressed state (sinks the button)
 * hub.handlePointerUp(x, y);  // activates the pressed button on release over it
 * hub.handleKey(key);         // ' ' / 'Escape' leaves town + calls onLeaveTown; true when handled
 * hub.snapshot();             // { open, screen, resetArmed } — for tests / debug HUD
 * ```
 * `main.ts` owns the canvas pointer listener and converts client
 * coordinates to canvas space (same pattern as Swing Lab's
 * `pointerDownAt`); it forwards taps to `handlePointer` while the
 * hub is open, and forwards Space / Escape to `handleKey`.
 * Leaving town returns to the last activity — the hub never switches
 * games itself except through `onOpenMine` / `onOpenRefiner`.
 *
 * WHAT IT SHOWS (main screen):
 * - Inventory: ore by tier with the real images, refined materials,
 *   Credits.
 * - Mines open to you: Ferrite Shale — The Jag; Galvanite — Deep Jag,
 *   locked until Mining 5.
 * - Activity spots: Mine (back to Swing Lab), Refiner (playable) and
 *   Bix's shop (sell). Other activities (combat etc.) appear as
 *   "coming soon" stubs only — they are NOT built and NOT tappable.
 *
 * BIX'S SHOP (shop screen): sell ore / refined for Credits at the
 * `BIX` config prices — Sell 1 and Sell all per item. No daily
 * limits (RuneSpace has them; NOT imported). No buying this round.
 * The prices are ACTIVE-GAME-ONLY, not RuneSpace canon (see `BIX`
 * in `core/config.ts`).
 *
 * RESET: the Reset button is two-tap — first tap arms it ("Tap again
 * to confirm"), second tap clears the save via the inventory store
 * and fires `onReset`. A tap anywhere else disarms it.
 */

import { BIX, RENDER } from '../core/config';
import { assetUrl } from '../core/assetUrl';
import {
  inventory,
  type InventoryItemId,
  type InventoryStore,
} from '../core/inventory';
import { MINING_TIERS } from '../games/swing-lab/tiers';

/** Callbacks the coordinator wires to `main.ts` + the game switcher. */
export interface TownHubCallbacks {
  /** Leave town and return to the last activity (Mine / Refiner). */
  onLeaveTown: () => void;
  /** Switch to the mine (Swing Lab). */
  onOpenMine: () => void;
  /** Switch to the Refiner game. */
  onOpenRefiner: () => void;
  /** The save was reset (after the two-tap confirm). */
  onReset: () => void;
}

/**
 * The town screen's background fill — fully opaque, always. The hub
 * is a place, not a dimmed overlay over the game: nothing shows
 * through it, and main.ts draws no game behind it either.
 */
export const TOWN_BACKGROUND = '#0d0d18';

export type TownHubScreen = 'main' | 'shop';

/** Sellable items, in hub display order. */
export const BIX_SELLABLE: readonly {
  id: InventoryItemId;
  name: string;
  image: string;
}[] = [
  { id: 'ferrite-shale', name: 'Ferrite Shale', image: 'item-art/ferrite-shale.webp' },
  { id: 'galvanite', name: 'Galvanite', image: 'item-art/galvanite.webp' },
  { id: 'refined-ferrite', name: 'Refined Ferrite', image: 'item-art/refined-ferrite.webp' },
  { id: 'galvanic-stock', name: 'Galvanic Stock', image: 'item-art/galvanic-stock.webp' },
] as const;

/** Bix's sell price for one unit of `id` (Credits), or undefined. */
export function bixSellPrice(id: InventoryItemId): number | undefined {
  return BIX.sellPrices[id];
}

/**
 * Sell `qty` of `id` from `store` at the Bix price. Returns the
 * Credits gained (0 when nothing was sold — not owned, or no price).
 * Caps at what the player owns.
 */
export function sellItems(
  store: InventoryStore,
  id: InventoryItemId,
  qty: number,
): number {
  const price = bixSellPrice(id);
  if (price === undefined || qty <= 0) return 0;
  const owned = store.count(id);
  const selling = Math.min(Math.floor(qty), owned);
  if (selling <= 0) return 0;
  if (!store.remove(id, selling)) return 0;
  const gained = selling * price;
  store.addCredits(gained);
  return gained;
}

/** Sell exactly one unit. Returns Credits gained (0 when none owned). */
export function sellOne(store: InventoryStore, id: InventoryItemId): number {
  return sellItems(store, id, 1);
}

/** Sell everything owned of `id`. Returns Credits gained. */
export function sellAll(store: InventoryStore, id: InventoryItemId): number {
  return sellItems(store, id, store.count(id));
}

/** Read-only snapshot, for tests / the debug HUD. */
export interface TownHubSnapshot {
  open: boolean;
  screen: TownHubScreen;
  /** Reset is armed (one tap done, waiting for the confirm tap). */
  resetArmed: boolean;
  credits: number;
}

interface LoadedImage {
  img: HTMLImageElement;
  loaded: boolean;
}

function loadImage(relativePath: string): LoadedImage | null {
  if (typeof Image === 'undefined') return null;
  const img = new Image();
  const entry: LoadedImage = { img, loaded: false };
  img.onload = () => {
    entry.loaded = true;
  };
  img.onerror = () => {
    entry.loaded = false;
  };
  img.src = assetUrl(relativePath);
  return entry;
}

interface ButtonRect {
  x: number;
  y: number;
  w: number;
  h: number;
  action: string;
}

const COMING_SOON: readonly string[] = ['⚔️ Combat — coming soon'];

/**
 * Shared button look (v3.3): the hub's flat muddy-brown rectangles
 * read as form fields, not game UI. Every button is now a real game
 * button — opaque vertical gradient, darker 4px lip at the base,
 * rounded corners, soft drop shadow — with a clear hierarchy:
 * primary (big gold: the play actions), secondary (muted slate: Back
 * / Sell 1), destructive (small, red-tinted: Reset save, so a
 * wipe-your-save action never competes with the play buttons).
 * The refiner's Leave chip uses the same painter (secondary style),
 * so the look is one implementation, not two.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'destructive';
export type ButtonState = 'idle' | 'hover' | 'pressed';

export interface ButtonStyle {
  /** Gradient top / bottom (idle). */
  top: string;
  bottom: string;
  /** Gradient top / bottom while hovered (brighter). */
  hoverTop: string;
  hoverBottom: string;
  /** Gradient top / bottom while pressed (darker — the button sinks). */
  pressedTop: string;
  pressedBottom: string;
  /** Border colour. */
  border: string;
  /** 4px lip at the base (darker than the gradient bottom). */
  lip: string;
  /** Label text colour. */
  text: string;
}

export const BUTTON_STYLES: Record<ButtonVariant, ButtonStyle> = {
  primary: {
    top: '#ffcf5c',
    bottom: '#dd9a1d',
    hoverTop: '#ffe08a',
    hoverBottom: '#f2b53e',
    pressedTop: '#e5ac33',
    pressedBottom: '#bd7f14',
    border: '#8a5a00',
    lip: '#96630a',
    text: '#241a05',
  },
  secondary: {
    top: '#34344e',
    bottom: '#1e1e33',
    hoverTop: '#45456a',
    hoverBottom: '#2a2a45',
    pressedTop: '#282840',
    pressedBottom: '#171728',
    border: '#5a5a80',
    lip: '#12121f',
    text: '#e8e8f0',
  },
  destructive: {
    top: '#4a232b',
    bottom: '#33161d',
    hoverTop: '#5d2c36',
    hoverBottom: '#401c24',
    pressedTop: '#3a1b22',
    pressedBottom: '#281017',
    border: '#8a4a55',
    lip: '#1f0d11',
    text: '#f2a8b0',
  },
};

/** Corner radius for buttons (clamped to half the button height). */
const BUTTON_RADIUS = 12;
/** Height of the darker lip at the button's base. */
const BUTTON_LIP_HEIGHT = 4;
/** How far a pressed button sinks. */
const BUTTON_PRESS_OFFSET = 2;

/** Rounded-rect path (manual arcs — no roundRect dependency). */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Split a label's leading emoji/icon from its text ('⛏ Mine' -> ['⛏', 'Mine']). */
function splitLeadingIcon(label: string): { icon: string; text: string } {
  const match = /^[^\p{L}\p{N}\s]+/u.exec(label);
  if (match === null) return { icon: '', text: label };
  return { icon: match[0], text: label.slice(match[0].length).trimStart() };
}

/** Text width, with a rough fallback for stub contexts without measureText. */
function measureTextWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontPx: number,
): number {
  const metrics =
    typeof ctx.measureText === 'function' ? ctx.measureText(text) : undefined;
  if (metrics !== undefined && typeof metrics.width === 'number') {
    return metrics.width;
  }
  return text.length * fontPx * 0.6;
}

/**
 * Paint one game button: opaque gradient body over a darker lip,
 * rounded corners, drop shadow (removed when pressed — the button
 * sinks 2px instead), and the label with its leading icon drawn
 * bigger, centred as a group. Primary labels are bold; the icon is
 * always `fontPx + 8`. Fully opaque throughout — nothing shows
 * through from behind.
 */
export function paintButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  variant: ButtonVariant = 'secondary',
  state: ButtonState = 'idle',
  fontPx = 22,
): void {
  const style = BUTTON_STYLES[variant];
  const radius = Math.min(BUTTON_RADIUS, h / 2 - 1);
  const dy = state === 'pressed' ? BUTTON_PRESS_OFFSET : 0;
  const by = y + dy;
  const top =
    state === 'pressed' ? style.pressedTop : state === 'hover' ? style.hoverTop : style.top;
  const bottom =
    state === 'pressed'
      ? style.pressedBottom
      : state === 'hover'
        ? style.hoverBottom
        : style.bottom;
  ctx.save();
  // Drop shadow (pressed: sunk, no shadow). It is cast by the lip
  // fill below, then cleared so the body + border draw shadow-free.
  if (state !== 'pressed') {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = state === 'hover' ? 10 : 6;
    ctx.shadowOffsetY = state === 'hover' ? 4 : 3;
  }
  // Bottom lip: full rounded rect in the lip colour; the gradient
  // body sits on top of it, leaving a 4px 3D lip at the base.
  ctx.fillStyle = style.lip;
  roundRectPath(ctx, x, by, w, h, radius);
  ctx.fill();
  ctx.shadowColor = 'rgba(0, 0, 0, 0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  // Gradient body (stub contexts without createLinearGradient fall
  // back to the flat top colour — never throws).
  const gradient = ctx.createLinearGradient(0, by, 0, by + h - BUTTON_LIP_HEIGHT);
  if (gradient !== null && gradient !== undefined && typeof gradient.addColorStop === 'function') {
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = top;
  }
  roundRectPath(ctx, x, by, w, h - BUTTON_LIP_HEIGHT, radius);
  ctx.fill();
  // Border.
  ctx.strokeStyle = style.border;
  ctx.lineWidth = 2;
  roundRectPath(ctx, x, by, w, h, radius);
  ctx.stroke();
  // Label, centred in the gradient body (above the lip): leading
  // icon drawn bigger, then the text, centred as a group.
  const { icon, text } = splitLeadingIcon(label);
  const textFont = `${variant === 'primary' ? '700 ' : ''}${fontPx}px ${RENDER.gameFont}`;
  const cy = by + (h - BUTTON_LIP_HEIGHT) / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = style.text;
  if (icon === '') {
    ctx.font = textFont;
    ctx.textAlign = 'center';
    ctx.fillText(text, x + w / 2, cy);
  } else {
    const iconFont = `${fontPx + 8}px ${RENDER.gameFont}`;
    ctx.font = iconFont;
    const iconW = measureTextWidth(ctx, icon, fontPx + 8);
    ctx.font = textFont;
    const textW = measureTextWidth(ctx, text, fontPx);
    const gap = 8;
    let cx = x + (w - (iconW + gap + textW)) / 2;
    ctx.font = iconFont;
    ctx.fillText(icon, cx, cy);
    cx += iconW + gap;
    ctx.font = textFont;
    ctx.fillText(text, cx, cy);
  }
  ctx.restore();
}

/** True when two rects overlap (touching edges does not count). */
export function rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * The bottom button row's rects, both screens: Back to the activity
 * + Reset save (main), Back to town (shop). Single source of truth
 * for the renderers AND the skyline's clear zone — the three rects
 * never move without this moving with them. A fixed 3-tuple, so
 * indexing one is never undefined.
 */
export interface ButtonRowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export function bottomButtonRects(
  width: number,
  height: number,
): [ButtonRowRect, ButtonRowRect, ButtonRowRect] {
  const bottomY = height - 64;
  return [
    { x: 24, y: bottomY, w: 320, h: 48 },
    { x: width - 24 - 240, y: bottomY + 4, w: 240, h: 40 },
    { x: 24, y: bottomY, w: 220, h: 48 },
  ];
}

export interface SkylineHouse {
  x: number;
  top: number;
  w: number;
  h: number;
  /** Lit window, or null when it would poke out at a bottom button's edge. */
  window: { x: number; y: number; w: number; h: number } | null;
}

/**
 * Rooftop skyline layout (pure geometry): dark houses with triangular
 * roofs along the bottom, heights 36–84 px, so the roofs peek above
 * the bottom button row in the gaps between buttons. A house's lit
 * window is dropped when it would intersect any bottom button rect —
 * the gold square peeking out at the Back / Reset buttons' edges is
 * what this fixes. The house bodies still run to the bottom edge
 * behind the buttons (the opaque buttons cover them).
 */
export function skylineLayout(width: number, height: number): SkylineHouse[] {
  const houses: SkylineHouse[] = [];
  const buttons = bottomButtonRects(width, height);
  let x = 0;
  let house = 0;
  while (x < width) {
    const w = 74 + ((house * 37) % 40);
    const h = 36 + ((house * 53) % 48);
    const top = height - h;
    const window = { x: x + w / 2 - 5, y: top + 14, w: 10, h: 12 };
    houses.push({
      x,
      top,
      w,
      h,
      window: buttons.some((b) => rectsIntersect(window, b)) ? null : window,
    });
    x += w + 14;
    house += 1;
  }
  return houses;
}


export class TownHub {
  private readonly callbacks: TownHubCallbacks;
  private openFlag = false;
  private screen: TownHubScreen = 'main';
  private resetArmed = false;
  /**
   * Label of the button that returns to the last activity — set by
   * main.ts when town opens ('⛏ Back to the mine' from mining,
   * '🔥 Back to refining' from the refiner). Space does the same
   * thing as this button.
   */
  private returnLabel = '⛏ Back to the mine';
  private buttons: ButtonRect[] = [];
  private readonly images = new Map<string, LoadedImage>();
  /**
   * Hover / pressed state for the canvas buttons (v3.3): hovered
   * brightens, pressed sinks 2px with the shadow removed. Set by
   * handlePointerMove / handlePointerDown, cleared on pointerup and
   * whenever the hub opens or closes. main.ts forwards pointermove
   * while the hub is open; handlePointer (tap) is the down+up pair
   * for callers that only forward taps.
   */
  private hoverAction: string | null = null;
  private pressedAction: string | null = null;

  public constructor(callbacks: TownHubCallbacks) {
    this.callbacks = callbacks;
    for (const item of BIX_SELLABLE) {
      const image = loadImage(item.image);
      if (image !== null) this.images.set(item.id, image);
    }
  }

  /** Show the hub (always opens on the main screen). */
  public open(): void {
    this.openFlag = true;
    this.screen = 'main';
    this.resetArmed = false;
    this.hoverAction = null;
    this.pressedAction = null;
  }

  /** Hide the hub. No callback — the caller resumes the game. */
  public close(): void {
    this.openFlag = false;
    this.resetArmed = false;
    this.hoverAction = null;
    this.pressedAction = null;
  }

  /** Action of the button under the pointer, or null. */
  public get hoveredButton(): string | null {
    return this.hoverAction;
  }

  /** Action of the button being pressed, or null. */
  public get pressedButton(): string | null {
    return this.pressedAction;
  }

  public get isOpen(): boolean {
    return this.openFlag;
  }

  /** Label of the button that returns to the last activity. */
  public get returnActivityLabel(): string {
    return this.returnLabel;
  }

  /** Set the return button's label (main.ts sets it on entering town). */
  public setReturnLabel(label: string): void {
    this.returnLabel = label;
  }

  public get currentScreen(): TownHubScreen {
    return this.screen;
  }

  public snapshot(): TownHubSnapshot {
    return {
      open: this.openFlag,
      screen: this.screen,
      resetArmed: this.resetArmed,
      credits: inventory.credits,
    };
  }

  private buttonAt(x: number, y: number): ButtonRect | null {
    for (const button of this.buttons) {
      if (x < button.x || x > button.x + button.w || y < button.y || y > button.y + button.h) {
        continue;
      }
      return button;
    }
    return null;
  }

  /**
   * Canvas-space pointer move: tracks which button (if any) the
   * pointer is over, so the next render draws it hovered. Returns
   * true when the pointer is over a button.
   */
  public handlePointerMove(x: number, y: number): boolean {
    if (!this.openFlag) return false;
    const hit = this.buttonAt(x, y);
    this.hoverAction = hit === null ? null : hit.action;
    return hit !== null;
  }

  /**
   * Canvas-space pointer down: arms the pressed state (the button
   * draws sunk on the next render); activation happens on
   * pointerup over the same button. A down that misses every button
   * disarms the Reset confirm.
   */
  public handlePointerDown(x: number, y: number): boolean {
    if (!this.openFlag) return false;
    const hit = this.buttonAt(x, y);
    if (hit === null) {
      this.resetArmed = false;
      return false;
    }
    this.pressedAction = hit.action;
    return true;
  }

  /**
   * Canvas-space pointer up: activates the pressed button when the
   * pointer is still over it, then clears the pressed state.
   * Releasing off the button (or with nothing pressed) cancels.
   */
  public handlePointerUp(x: number, y: number): boolean {
    if (!this.openFlag) return false;
    const pressed = this.pressedAction;
    this.pressedAction = null;
    if (pressed === null) return false;
    const hit = this.buttonAt(x, y);
    if (hit === null || hit.action !== pressed) return false;
    return this.activate(pressed);
  }

  /**
   * Canvas-space tap (down + up in one call, for callers that only
   * forward taps). Returns true when a hub button was hit (the
   * caller should swallow the tap); false when the tap missed
   * everything (a miss also disarms a pending Reset confirm).
   */
  public handlePointer(x: number, y: number): boolean {
    if (!this.openFlag) return false;
    if (!this.handlePointerDown(x, y)) return false;
    return this.handlePointerUp(x, y);
  }

  /**
   * Key handling: Space / Escape leaves town and returns to the last
   * activity — the same as the Back button. Returns true when the key
   * was handled.
   */
  public handleKey(key: string): boolean {
    if (!this.openFlag) return false;
    if (key === ' ' || key === 'Escape' || key === 'Esc') {
      this.close();
      this.callbacks.onLeaveTown();
      return true;
    }
    return false;
  }

  /** Draw the town screen. Reads the inventory store live every frame. */
  public render(ctx: CanvasRenderingContext2D, _nowMs: number): void {
    if (!this.openFlag) return;
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    ctx.save();
    // Town's own backdrop: fully opaque, painted first. The game is
    // never drawn behind the hub, and nothing shows through this.
    this.drawTownBackdrop(ctx, width, height);
    if (this.screen === 'shop') this.renderShop(ctx, width, height);
    else this.renderMain(ctx, width, height);
    ctx.restore();
  }

  /**
   * Town's own look (v3.2): a night sky with stars, a moon, and a
   * rooftop skyline along the bottom — all opaque shapes over the
   * solid background fill, so the screen is opaque everywhere. The
   * content (header, inventory, buttons) is drawn over it.
   */
  private drawTownBackdrop(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    ctx.fillStyle = TOWN_BACKGROUND;
    ctx.fillRect(0, 0, width, height);
    // Stars: fixed pseudo-random positions (seeded, so the sky does
    // not shimmer between frames), upper half only.
    ctx.fillStyle = '#e8e8f0';
    let seed = 1234567;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 48; i++) {
      const x = rand() * width;
      const y = rand() * height * 0.55;
      const s = rand() < 0.2 ? 2 : 1;
      ctx.fillRect(x, y, s, s);
    }
    // Moon, top right.
    ctx.fillStyle = '#f5f0d8';
    ctx.beginPath();
    ctx.arc(width - 84, 78, 24, 0, Math.PI * 2);
    ctx.fill();
    // Rooftop skyline along the bottom, behind the buttons: dark
    // houses with lit windows. Heights vary 36–84 px, so the roofs
    // peek above the bottom button row in the gaps between buttons.
    // Windows that would intersect a bottom button rect are dropped
    // by skylineLayout — no lit square pokes out at a button's edge.
    for (const house of skylineLayout(width, height)) {
      ctx.fillStyle = '#17172b';
      ctx.fillRect(house.x, house.top, house.w, house.h);
      // Triangular roof.
      ctx.fillStyle = '#1e1e38';
      ctx.beginPath();
      ctx.moveTo(house.x - 4, house.top);
      ctx.lineTo(house.x + house.w / 2, house.top - 18);
      ctx.lineTo(house.x + house.w + 4, house.top);
      ctx.closePath();
      ctx.fill();
      // One lit window (unless it would overlap a bottom button).
      if (house.window !== null) {
        ctx.fillStyle = '#ffd166';
        ctx.fillRect(house.window.x, house.window.y, house.window.w, house.window.h);
      }
    }
  }

  private activate(action: string): boolean {
    if (action === 'leave-town') {
      this.close();
      this.callbacks.onLeaveTown();
      return true;
    }
    if (action === 'mine') {
      this.close();
      this.callbacks.onOpenMine();
      return true;
    }
    if (action === 'refiner') {
      this.close();
      this.callbacks.onOpenRefiner();
      return true;
    }
    if (action === 'shop') {
      this.screen = 'shop';
      this.resetArmed = false;
      return true;
    }
    if (action === 'shop-back') {
      this.screen = 'main';
      return true;
    }
    if (action === 'reset') {
      if (!this.resetArmed) {
        this.resetArmed = true;
        return true;
      }
      inventory.reset();
      this.resetArmed = false;
      this.callbacks.onReset();
      return true;
    }
    if (action.startsWith('sell-one:')) {
      sellOne(inventory, action.slice('sell-one:'.length) as InventoryItemId);
      return true;
    }
    if (action.startsWith('sell-all:')) {
      sellAll(inventory, action.slice('sell-all:'.length) as InventoryItemId);
      return true;
    }
    // Coming-soon stubs are not buttons; anything else is inert.
    return false;
  }

  private drawHeader(
    ctx: CanvasRenderingContext2D,
    width: number,
    title: string,
  ): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 34px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 6;
    ctx.strokeText(title, width / 2, 48);
    ctx.fillText(title, width / 2, 48);
    ctx.font = `22px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffd166';
    const snap = inventory.snapshot();
    ctx.fillText(
      `💰 ${snap.credits} Credits · ⛏️ Mining Lv ${inventory.level('mining')} · 🔥 Refining Lv ${inventory.level('refining')}`,
      width / 2,
      86,
    );
  }

  /**
   * One hub button (v3.3): the shared game-button look from
   * paintButton — gradient, lip, rounded corners, shadow — in the
   * given variant, drawn hovered / pressed from the pointer state.
   * The button rect is registered for handlePointer* hit-testing.
   */
  private drawButton(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    action: string,
    opts: { variant?: ButtonVariant; fontPx?: number } = {},
  ): void {
    this.buttons.push({ x, y, w, h, action });
    const variant = opts.variant ?? 'secondary';
    const state: ButtonState =
      this.pressedAction === action
        ? 'pressed'
        : this.hoverAction === action
          ? 'hover'
          : 'idle';
    paintButton(ctx, x, y, w, h, label, variant, state, opts.fontPx ?? 22);
  }

  private drawItemIcon(
    ctx: CanvasRenderingContext2D,
    id: string,
    x: number,
    y: number,
    size: number,
  ): void {
    const img = this.images.get(id);
    if (img !== undefined && img.loaded) {
      ctx.drawImage(img.img, x - size / 2, y - size / 2, size, size);
      return;
    }
    ctx.fillStyle = '#d97b3f';
    ctx.beginPath();
    ctx.moveTo(x, y - size / 2);
    ctx.lineTo(x + size * 0.35, y);
    ctx.lineTo(x, y + size / 2);
    ctx.lineTo(x - size * 0.35, y);
    ctx.closePath();
    ctx.fill();
  }

  private renderMain(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    this.buttons = [];
    this.drawHeader(ctx, width, '🏠 Town Hub');
    const margin = 24;
    const colW = (width - margin * 3) / 2;
    const leftX = margin;
    const rightX = margin * 2 + colW;
    let y = 116;

    // LEFT: inventory.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 24px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('🎒 Inventory', leftX, y);
    y += 34;
    ctx.font = `20px ${RENDER.gameFont}`;
    for (const item of BIX_SELLABLE) {
      const owned = inventory.count(item.id);
      this.drawItemIcon(ctx, item.id, leftX + 18, y, 30);
      ctx.fillStyle = '#e8e8f0';
      ctx.fillText(`${item.name} × ${owned}`, leftX + 40, y);
      y += 36;
    }

    // LEFT, below inventory: mines.
    y += 10;
    ctx.font = `700 24px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('⛏️ Mines', leftX, y);
    y += 34;
    ctx.font = `20px ${RENDER.gameFont}`;
    const miningLevel = inventory.level('mining');
    for (const tier of MINING_TIERS) {
      const unlocked = miningLevel >= tier.requiredMiningLevel;
      ctx.fillStyle = unlocked ? '#e8e8f0' : '#b9b9d6';
      ctx.fillText(
        unlocked
          ? `⛏️ ${tier.name} — ${tier.location}`
          : `🔒 ${tier.name} — ${tier.location} (Mining ${tier.requiredMiningLevel})`,
        leftX,
        y,
      );
      y += 32;
    }

    // RIGHT: activity spots. Leaving town means picking one of these
    // (or the Back button / Space, which returns to the last one).
    let ry = 116;
    ctx.font = `700 24px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText('📍 Activities', rightX, ry);
    ry += 40;
    this.drawButton(
      ctx, rightX, ry, colW, 52, '⛏ Mine — The Jag', 'mine', { variant: 'primary' },
    );
    ry += 62;
    this.drawButton(
      ctx, rightX, ry, colW, 52, '🔥 Refiner — refine ore', 'refiner', { variant: 'primary' },
    );
    ry += 62;
    this.drawButton(
      ctx, rightX, ry, colW, 52, "🛒 Bix's Shop — sell", 'shop', { variant: 'primary' },
    );
    ry += 62;
    for (const stub of COMING_SOON) {
      ctx.font = `20px ${RENDER.gameFont}`;
      ctx.fillStyle = '#8a8aa8';
      ctx.fillText(stub, rightX, ry + 20);
      ry += 36;
    }

    // BOTTOM: back to the last activity (Space does the same) + reset.
    // The rects come from bottomButtonRects — the same rects the
    // skyline's clear zone is computed from, so the two never drift.
    // Reset is deliberately the small destructive one: a wipe-your-save
    // action must never carry the same visual weight as Back.
    const bottomRects = bottomButtonRects(width, height);
    const backRect = bottomRects[0];
    const resetRect = bottomRects[1];
    this.drawButton(ctx, backRect.x, backRect.y, backRect.w, backRect.h, `${this.returnLabel} (Space)`, 'leave-town', {
      variant: 'secondary',
      fontPx: 20,
    });
    this.drawButton(
      ctx,
      resetRect.x,
      resetRect.y,
      resetRect.w,
      resetRect.h,
      this.resetArmed ? '⚠️ Tap again to confirm' : '🗑 Reset save',
      'reset',
      { variant: 'destructive', fontPx: 16 },
    );
  }

  private renderShop(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    this.buttons = [];
    this.drawHeader(ctx, width, "🛒 Bix's Shop — sell");
    const margin = 24;
    const rowW = width - margin * 2;
    let y = 122;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `20px ${RENDER.gameFont}`;
    ctx.fillStyle = '#b9b9d6';
    ctx.fillText('Bix buys your ore and refined goods. No buying this round.', margin, y);
    y += 40;
    for (const item of BIX_SELLABLE) {
      const owned = inventory.count(item.id);
      const price = bixSellPrice(item.id) ?? 0;
      this.drawItemIcon(ctx, item.id, margin + 18, y, 30);
      ctx.font = `22px ${RENDER.gameFont}`;
      ctx.fillStyle = '#e8e8f0';
      ctx.fillText(`${item.name} × ${owned} — ${price} cr each`, margin + 40, y);
      const sellOneW = 110;
      const sellAllW = 130;
      const sellAllX = margin + rowW - sellAllW;
      const sellOneX = sellAllX - 10 - sellOneW;
      this.drawButton(ctx, sellOneX, y - 20, sellOneW, 40, 'Sell 1', `sell-one:${item.id}`, {
        fontPx: 18,
      });
      this.drawButton(ctx, sellAllX, y - 20, sellAllW, 40, 'Sell all', `sell-all:${item.id}`, {
        fontPx: 18,
        variant: owned > 0 ? 'primary' : 'secondary',
      });
      y += 52;
    }
    const shopBackRect = bottomButtonRects(width, height)[2];
    this.drawButton(ctx, shopBackRect.x, shopBackRect.y, shopBackRect.w, shopBackRect.h, '⬅ Back to town', 'shop-back', {
      variant: 'secondary',
    });
  }
}
